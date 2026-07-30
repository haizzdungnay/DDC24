#include "netcfg.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <limits.h>
#include <net/if.h>
#include <poll.h>
#include <pwd.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <initializer_list>
#include <regex>
#include <set>
#include <sstream>
#include <thread>

namespace netcfg {
namespace {

std::atomic<uint64_t> transaction_sequence{0};

int64_t epoch_now_ms()
{
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

int64_t steady_now_ms()
{
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

bool parse_ipv4(const std::string& value, uint32_t* host_order)
{
    struct in_addr address {};
    if (::inet_pton(AF_INET, value.c_str(), &address) != 1) return false;
    if (host_order) *host_order = ntohl(address.s_addr);
    return true;
}

std::string trim(std::string value)
{
    while (!value.empty() && (value.back() == '\n' || value.back() == '\r' || value.back() == ' '))
        value.pop_back();
    const size_t first = value.find_first_not_of(" \t");
    return first == std::string::npos ? std::string{} : value.substr(first);
}

bool canonical_ipv4(const std::string& value)
{
    struct in_addr address {};
    if (::inet_pton(AF_INET, value.c_str(), &address) != 1) return false;
    std::array<char, INET_ADDRSTRLEN> text {};
    return ::inet_ntop(AF_INET, &address, text.data(), text.size()) && value == text.data();
}

std::vector<std::string> parse_dns_servers(std::string value, bool* valid = nullptr)
{
    if (valid) *valid = true;
    std::replace_if(value.begin(), value.end(), [](char c) {
        return c == ',' || c == ';';
    }, ' ');
    std::istringstream fields(value);
    std::vector<std::string> servers;
    std::set<std::string> seen;
    std::string server;
    while (fields >> server) {
        if (!canonical_ipv4(server) || !seen.insert(server).second) {
            if (valid) *valid = false;
            continue;
        }
        servers.push_back(server);
    }
    return servers;
}

std::string join_dns_servers(const std::vector<std::string>& servers)
{
    std::ostringstream value;
    for (size_t index = 0; index < servers.size(); ++index) {
        if (index != 0) value << ',';
        value << servers[index];
    }
    return value.str();
}

bool valid_management_hostname(const std::string& hostname)
{
    if (hostname.empty() || hostname.size() > 63 || hostname == "localhost" ||
        hostname.front() == '-' || hostname.back() == '-') return false;
    return std::all_of(hostname.begin(), hostname.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || std::isdigit(c) || c == '-';
    });
}

bool has_only_fields(const nlohmann::json& value,
                     std::initializer_list<const char*> allowed)
{
    if (!value.is_object()) return false;
    for (auto it = value.begin(); it != value.end(); ++it) {
        const bool known = std::any_of(allowed.begin(), allowed.end(), [&](const char* field) {
            return it.key() == field;
        });
        if (!known) return false;
    }
    return true;
}

bool valid_request_shape(const nlohmann::json& request)
{
    if (!has_only_fields(request, {"version", "requestId", "action", "transactionId",
                                   "candidate"})) return false;
    if (!request.contains("candidate")) return true;
    const auto& candidate = request.at("candidate");
    if (!has_only_fields(candidate, {"interface", "mode", "ipv4", "netmask", "gateway",
                                     "dns"})) return false;
    return !candidate.contains("dns") ||
        has_only_fields(candidate.at("dns"), {"mode", "servers"});
}

std::string cidr(const Candidate& candidate)
{
    return candidate.ipv4 + "/" + std::to_string(netmask_to_prefix(candidate.netmask));
}

std::string cidr(const ActiveState& state)
{
    return state.ipv4 + "/" + std::to_string(state.prefix_length);
}

bool netmask_from_prefix(int prefix, std::string* netmask)
{
    if (prefix < 0 || prefix > 32 || !netmask) return false;
    const uint32_t mask = prefix == 0 ? 0 : 0xFFFFFFFFu << (32 - prefix);
    struct in_addr address { htonl(mask) };
    std::array<char, INET_ADDRSTRLEN> text {};
    if (!::inet_ntop(AF_INET, &address, text.data(), text.size())) return false;
    *netmask = text.data();
    return true;
}

bool restore_candidate_from(const ActiveState& previous, Candidate* restore)
{
    if (!restore || previous.interface.empty() || previous.ipv4.empty() ||
        (previous.mode != "static" && previous.mode != "dhcp")) return false;
    *restore = Candidate{previous.interface, previous.mode, {}, {}, {}};
    if (previous.mode == "static") {
        restore->ipv4 = previous.ipv4;
        restore->gateway = previous.gateway;
        if (!netmask_from_prefix(previous.prefix_length, &restore->netmask)) return false;
    }
    std::string ignored;
    return validate_candidate(*restore, &ignored);
}

bool configured_dns_matches(const Candidate& expected, const Candidate& configured)
{
    if (!expected.dns.has_value()) return !configured.dns.has_value();
    return configured.dns.has_value() && configured.dns->mode == expected.dns->mode &&
        configured.dns->servers == expected.dns->servers;
}

bool configured_profile_matches(const Candidate& expected, const Candidate& configured,
                                bool verify_dns)
{
    if (configured.interface != expected.interface || configured.mode != expected.mode)
        return false;
    if (expected.mode == "static" &&
        (configured.ipv4 != expected.ipv4 || configured.netmask != expected.netmask ||
         configured.gateway != expected.gateway)) return false;
    return !verify_dns || configured_dns_matches(expected, configured);
}

bool dhcp_candidate_ready(const Candidate& candidate, const ActiveState& active,
                          const Candidate& configured)
{
    if (active.interface != candidate.interface || active.mode != "dhcp" ||
        active.link != "up" || active.reason_code != "OK" || active.ipv4.empty() ||
        !configured_profile_matches(candidate, configured, candidate.dns.has_value())) {
        return false;
    }
    return !candidate.dns.has_value() || candidate.dns->mode == "auto" ||
        active.dns_servers == candidate.dns->servers;
}

bool restored_state_matches(const ActiveState& previous, const ActiveState& active,
                            const Candidate& previous_configured,
                            const Candidate& configured, bool verify_dns)
{
    if (active.interface != previous.interface ||
        (verify_dns && !configured_profile_matches(previous_configured, configured, true))) {
        return false;
    }

    const bool previous_runtime_verifiable = previous.link == "up" &&
        (previous.mode == "static" || previous.mode == "dhcp") && !previous.ipv4.empty();
    if (!previous_runtime_verifiable) return true;

    const bool runtime_dns_matches = !verify_dns ||
        (previous_configured.dns.has_value()
             ? previous_configured.dns->mode == "auto" ||
                   active.dns_servers == previous_configured.dns->servers
             : active.dns_servers.empty());
    return active.link == previous.link && active.mode == previous.mode &&
        active.ipv4 == previous.ipv4 &&
        active.prefix_length == previous.prefix_length && active.gateway == previous.gateway &&
        runtime_dns_matches;
}

bool write_all(int fd, const char* data, size_t size)
{
    while (size > 0) {
        const ssize_t n = ::write(fd, data, size);
        if (n > 0) {
            data += n;
            size -= static_cast<size_t>(n);
        } else if (n < 0 && errno == EINTR) {
            continue;
        } else {
            return false;
        }
    }
    return true;
}

std::string default_route_interface(std::string* gateway)
{
    std::ifstream routes("/proc/net/route");
    std::string line;
    std::getline(routes, line);
    while (std::getline(routes, line)) {
        std::istringstream fields(line);
        std::string iface, destination, gateway_hex;
        unsigned flags = 0;
        if (!(fields >> iface >> destination >> gateway_hex >> std::hex >> flags)) continue;
        if (destination != "00000000" || (flags & 0x1u) == 0) continue;
        if (gateway) {
            uint32_t raw = 0;
            std::istringstream(gateway_hex) >> std::hex >> raw;
            struct in_addr addr { raw };
            std::array<char, INET_ADDRSTRLEN> text {};
            if (::inet_ntop(AF_INET, &addr, text.data(), text.size())) *gateway = text.data();
        }
        return iface;
    }
    return {};
}

bool atomic_write_json(const std::string& path, const nlohmann::json& value,
                       std::string* reason)
{
    try {
        std::filesystem::create_directories(std::filesystem::path(path).parent_path());
    } catch (...) {
        if (reason) *reason = "JOURNAL_DIRECTORY_FAILED";
        return false;
    }
    std::string pattern = path + ".tmp.XXXXXX";
    std::vector<char> temp(pattern.begin(), pattern.end());
    temp.push_back('\0');
    const int fd = ::mkstemp(temp.data());
    if (fd < 0) {
        if (reason) *reason = "JOURNAL_WRITE_FAILED";
        return false;
    }
    (void)::fchmod(fd, 0600);
    const std::string body = value.dump(2) + "\n";
    bool ok = write_all(fd, body.data(), body.size()) && ::fsync(fd) == 0;
    const int saved_errno = errno;
    ::close(fd);
    if (ok) ok = ::rename(temp.data(), path.c_str()) == 0;
    if (!ok) {
        ::unlink(temp.data());
        errno = saved_errno;
        if (reason) *reason = "JOURNAL_WRITE_FAILED";
        return false;
    }
    const std::string directory = std::filesystem::path(path).parent_path().string();
    const int dir_fd = ::open(directory.c_str(), O_RDONLY | O_DIRECTORY);
    if (dir_fd >= 0) {
        (void)::fsync(dir_fd);
        ::close(dir_fd);
    }
    return true;
}

} // namespace

void to_json(nlohmann::json& j, const DnsConfig& value)
{
    j = {{"mode", value.mode}, {"servers", value.servers}};
}

void from_json(const nlohmann::json& j, DnsConfig& value)
{
    j.at("mode").get_to(value.mode);
    j.at("servers").get_to(value.servers);
}

void to_json(nlohmann::json& j, const Candidate& value)
{
    j = {{"interface", value.interface}, {"mode", value.mode}, {"ipv4", value.ipv4},
         {"netmask", value.netmask}, {"gateway", value.gateway}};
    if (value.dns.has_value()) j["dns"] = *value.dns;
}

void from_json(const nlohmann::json& j, Candidate& value)
{
    j.at("interface").get_to(value.interface);
    j.at("mode").get_to(value.mode);
    if (j.contains("ipv4")) j.at("ipv4").get_to(value.ipv4);
    if (j.contains("netmask")) j.at("netmask").get_to(value.netmask);
    if (j.contains("gateway")) j.at("gateway").get_to(value.gateway);
    if (j.contains("dns")) value.dns = j.at("dns").get<DnsConfig>();
    else value.dns.reset();
}

void to_json(nlohmann::json& j, const ActiveState& value)
{
    j = {{"interface", value.interface}, {"link", value.link}, {"mode", value.mode},
         {"ipv4", value.ipv4}, {"prefixLength", value.prefix_length},
         {"gateway", value.gateway}, {"adminUp", value.admin_up},
         {"carrier", value.carrier}, {"reasonCode", value.reason_code},
         {"dnsServers", value.dns_servers}};
}

void from_json(const nlohmann::json& j, ActiveState& value)
{
    value.interface = j.value("interface", "");
    value.link = j.value("link", "unknown");
    value.mode = j.value("mode", "unknown");
    value.ipv4 = j.value("ipv4", "");
    value.prefix_length = j.value("prefixLength", 0);
    value.gateway = j.value("gateway", "");
    value.admin_up = j.value("adminUp", false);
    value.carrier = j.value("carrier", false);
    value.reason_code = j.value("reasonCode", "OK");
    value.dns_servers = j.value("dnsServers", std::vector<std::string>{});
}

void to_json(nlohmann::json& j, const ManagementState& value)
{
    j = {{"hostname", value.hostname}, {"mdnsName", value.mdns_name},
         {"stable", value.stable}};
}

void to_json(nlohmann::json& j, const Transaction& value)
{
    j = {{"schemaVersion", 1}, {"id", value.id}, {"state", value.state},
         {"candidate", value.candidate}, {"previous", value.previous},
         {"previousConfiguredComplete", value.previous_configured_complete},
         {"rollbackDeadlineEpochMs", value.rollback_deadline_epoch_ms},
         {"lastReason", value.last_reason}};
    if (value.previous_configured.has_value())
        j["previousConfigured"] = *value.previous_configured;
}

void from_json(const nlohmann::json& j, Transaction& value)
{
    if (j.value("schemaVersion", 0) != 1) throw std::runtime_error("journal version");
    value.id = j.value("id", "");
    value.state = j.value("state", "idle");
    value.candidate = j.at("candidate").get<Candidate>();
    value.previous = j.at("previous").get<ActiveState>();
    if (j.contains("previousConfigured")) {
        value.previous_configured = j.at("previousConfigured").get<Candidate>();
        value.previous_configured_complete = j.value("previousConfiguredComplete", true);
    } else {
        Candidate fallback;
        if (restore_candidate_from(value.previous, &fallback)) value.previous_configured = fallback;
        else value.previous_configured.reset();
        value.previous_configured_complete = false;
    }
    value.rollback_deadline_epoch_ms = j.value("rollbackDeadlineEpochMs", int64_t{0});
    value.last_reason = j.value("lastReason", "OK");
}

int netmask_to_prefix(const std::string& netmask)
{
    uint32_t mask = 0;
    if (!parse_ipv4(netmask, &mask)) return -1;
    bool zero_seen = false;
    int prefix = 0;
    for (int bit = 31; bit >= 0; --bit) {
        const bool one = (mask & (uint32_t{1} << bit)) != 0;
        if (one && zero_seen) return -1;
        if (one) ++prefix;
        else zero_seen = true;
    }
    return prefix;
}

bool validate_candidate(const Candidate& value, std::string* reason)
{
    static const std::regex interface_pattern("^[A-Za-z0-9_.-]{1,15}$");
    if (!std::regex_match(value.interface, interface_pattern) || value.interface == "lo") {
        if (reason) *reason = "INVALID_INTERFACE";
        return false;
    }
    if (value.mode == "dhcp") {
        if (!value.ipv4.empty() || !value.netmask.empty() || !value.gateway.empty()) {
            if (reason) *reason = "DHCP_STATIC_FIELDS_PRESENT";
            return false;
        }
    } else if (value.mode != "static") {
        if (reason) *reason = "INVALID_MODE";
        return false;
    } else {
        uint32_t ip = 0, gateway = 0;
        const int prefix = netmask_to_prefix(value.netmask);
        if (!parse_ipv4(value.ipv4, &ip) || prefix < 1 || prefix > 30) {
            if (reason) *reason = "INVALID_ADDRESS";
            return false;
        }
        if ((ip >> 24) == 0 || (ip >> 24) == 127 || (ip >> 28) == 0xEu ||
            ip == 0xFFFFFFFFu) {
            if (reason) *reason = "UNUSABLE_ADDRESS";
            return false;
        }
        const uint32_t mask = 0xFFFFFFFFu << (32 - prefix);
        if ((ip & ~mask) == 0 || (ip & ~mask) == ~mask) {
            if (reason) *reason = "NETWORK_OR_BROADCAST_ADDRESS";
            return false;
        }
        if (!value.gateway.empty() &&
            (!parse_ipv4(value.gateway, &gateway) || gateway == ip ||
             (gateway & mask) != (ip & mask) || (gateway & ~mask) == 0 ||
             (gateway & ~mask) == ~mask)) {
            if (reason) *reason = "INVALID_GATEWAY";
            return false;
        }
    }

    if (!value.dns.has_value()) return true;
    if (value.dns->mode == "auto") {
        if (value.mode != "dhcp") {
            if (reason) *reason = "DNS_AUTO_REQUIRES_DHCP";
            return false;
        }
        if (!value.dns->servers.empty()) {
            if (reason) *reason = "DNS_AUTO_SERVERS_PRESENT";
            return false;
        }
        return true;
    }
    if (value.dns->mode != "manual") {
        if (reason) *reason = "INVALID_DNS_MODE";
        return false;
    }
    if (value.dns->servers.empty() || value.dns->servers.size() > 4) {
        if (reason) *reason = value.dns->servers.empty() ? "DNS_SERVERS_REQUIRED"
                                                        : "TOO_MANY_DNS_SERVERS";
        return false;
    }
    std::set<std::string> unique_servers;
    for (const auto& server : value.dns->servers) {
        if (!canonical_ipv4(server)) {
            if (reason) *reason = "INVALID_DNS_SERVER";
            return false;
        }
        if (!unique_servers.insert(server).second) {
            if (reason) *reason = "DUPLICATE_DNS_SERVER";
            return false;
        }
    }
    return true;
}

std::string LinuxPlatform::binary(const std::vector<std::string>& choices)
{
    for (const auto& path : choices) if (::access(path.c_str(), X_OK) == 0) return path;
    return {};
}

bool LinuxPlatform::run(const std::vector<std::string>& args, std::string* output)
{
    if (args.empty() || args.front().empty()) return false;
    int pipes[2];
    if (::pipe2(pipes, O_CLOEXEC) != 0) return false;
    const pid_t pid = ::fork();
    if (pid < 0) {
        ::close(pipes[0]); ::close(pipes[1]); return false;
    }
    if (pid == 0) {
        ::dup2(pipes[1], STDOUT_FILENO);
        ::dup2(pipes[1], STDERR_FILENO);
        ::close(pipes[0]); ::close(pipes[1]);
        std::vector<char*> argv;
        argv.reserve(args.size() + 1);
        for (const auto& arg : args) argv.push_back(const_cast<char*>(arg.c_str()));
        argv.push_back(nullptr);
        ::execv(argv[0], argv.data());
        _exit(127);
    }
    ::close(pipes[1]);
    std::string result;
    std::array<char, 512> buffer {};
    /* F-22: PHẢI đọc cạn pipe rồi mới bỏ phần vượt giới hạn.
     * Vòng cũ dừng ngay khi result.size() >= 4096 (điều kiện `n > 0 &&
     * result.size() < 4096` false → rơi xuống `else break`) rồi close(pipes[0]).
     * Child đang ghi tiếp nhận SIGPIPE, nên WIFEXITED(status) false và run() trả
     * FALSE cho một lệnh thực chất đã chạy đúng — biến một lần cắt output thành
     * một lần "apply thất bại" giả, trong service có cơ chế rollback fail-closed. */
    constexpr size_t kMaxOutput = 4096;
    for (;;) {
        const ssize_t n = ::read(pipes[0], buffer.data(), buffer.size());
        if (n > 0) {
            if (result.size() < kMaxOutput) {
                const size_t room = kMaxOutput - result.size();
                const size_t take = (static_cast<size_t>(n) < room) ? static_cast<size_t>(n) : room;
                result.append(buffer.data(), take);
            }
            continue;   /* tiếp tục đọc để child không bị SIGPIPE, chỉ bỏ phần thừa */
        }
        if (n == 0) break;                       /* EOF: child đã đóng stdout */
        if (errno == EINTR) continue;
        break;                                   /* lỗi đọc thật */
    }
    ::close(pipes[0]);
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    if (output) *output = trim(result);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

std::string LinuxPlatform::connection_name(const std::string& interface)
{
    const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
    std::string output;
    if (nmcli.empty() || !run({nmcli, "-g", "GENERAL.CONNECTION", "device", "show", interface}, &output))
        return {};
    output = trim(output);
    return output == "--" ? std::string{} : output;
}

std::string LinuxPlatform::configured_connection_name(const std::string& interface)
{
    const std::string active_connection = connection_name(interface);
    if (!active_connection.empty()) return active_connection;

    const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
    std::string output;
    if (nmcli.empty() || !run({nmcli, "-g", "UUID", "connection", "show"}, &output))
        return {};

    std::istringstream profiles(output);
    std::string uuid;
    while (std::getline(profiles, uuid)) {
        uuid = trim(uuid);
        if (uuid.empty()) continue;
        std::string bound_interface;
        if (run({nmcli, "-g", "connection.interface-name", "connection", "show",
                 "uuid", uuid}, &bound_interface) &&
            trim(bound_interface) == interface) {
            return uuid;
        }
    }
    return {};
}

bool LinuxPlatform::read_interface_state(const std::string& interface,
                                         InterfaceSnapshot* state) const
{
    if (!state || interface.empty()) return false;
    *state = InterfaceSnapshot{};
    struct ifaddrs* addresses = nullptr;
    if (::getifaddrs(&addresses) != 0) return false;
    for (const auto* item = addresses; item; item = item->ifa_next) {
        if (!item->ifa_name || interface != item->ifa_name) continue;
        state->present = true;
        state->admin_up = (item->ifa_flags & IFF_UP) != 0;
        state->carrier = (item->ifa_flags & IFF_RUNNING) != 0;
        if (!item->ifa_addr || item->ifa_addr->sa_family != AF_INET ||
            !state->ipv4.empty()) continue;
        std::array<char, INET_ADDRSTRLEN> text {};
        const auto* address = reinterpret_cast<const struct sockaddr_in*>(item->ifa_addr);
        if (::inet_ntop(AF_INET, &address->sin_addr, text.data(), text.size()))
            state->ipv4 = text.data();
        if (item->ifa_netmask) {
            const auto* mask = reinterpret_cast<const struct sockaddr_in*>(item->ifa_netmask);
            state->prefix_length = __builtin_popcount(ntohl(mask->sin_addr.s_addr));
        }
    }
    ::freeifaddrs(addresses);
    return true;
}

ActiveState LinuxPlatform::status(const std::string& requested_interface, std::string* reason)
{
    ActiveState result;
    result.interface = requested_interface.empty() ? default_route_interface(&result.gateway)
                                                   : requested_interface;
    const auto set_reason = [&](const std::string& value) {
        result.reason_code = value;
        if (reason) *reason = value;
    };
    if (result.interface.empty()) {
        set_reason("INTERFACE_NOT_FOUND");
        return result;
    }

    InterfaceSnapshot snapshot;
    if (!read_interface_state(result.interface, &snapshot)) {
        set_reason("KERNEL_STATE_UNAVAILABLE");
        return result;
    }
    if (!snapshot.present) {
        set_reason("INTERFACE_NOT_FOUND");
        return result;
    }

    result.admin_up = snapshot.admin_up;
    result.carrier = snapshot.carrier;
    result.link = result.admin_up && result.carrier ? "up" : "down";
    result.ipv4 = snapshot.ipv4;
    result.prefix_length = snapshot.prefix_length;
    if (!requested_interface.empty()) {
        std::string route_gateway;
        if (default_route_interface(&route_gateway) == result.interface)
            result.gateway = route_gateway;
    }

    const std::string connection = connection_name(result.interface);
    const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
    std::string mode;
    if (!connection.empty() && !nmcli.empty() &&
        run({nmcli, "-g", "ipv4.method", "connection", "show", connection}, &mode)) {
        result.mode = trim(mode) == "auto" ? "dhcp" : (trim(mode) == "manual" ? "static" : "unknown");
    }
    std::string dns_servers;
    if (!nmcli.empty() &&
        run({nmcli, "-g", "IP4.DNS", "device", "show", result.interface}, &dns_servers))
        result.dns_servers = parse_dns_servers(dns_servers);
    if (!result.admin_up) set_reason("ADMIN_DOWN");
    else if (!result.carrier) set_reason("NO_CARRIER");
    else if (result.ipv4.empty()) set_reason("NO_ACTIVE_ADDRESS");
    else set_reason("OK");
    return result;
}

Candidate LinuxPlatform::configured(const std::string& requested_interface)
{
    Candidate result;
    result.interface = requested_interface.empty() ? default_route_interface(nullptr)
                                                   : requested_interface;
    result.mode = "unknown";
    if (result.interface.empty()) return result;

    const std::string connection = configured_connection_name(result.interface);
    const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
    std::string method;
    if (connection.empty() || nmcli.empty() ||
        !run({nmcli, "-g", "ipv4.method", "connection", "show", connection}, &method))
        return result;

    method = trim(method);
    if (method == "auto") result.mode = "dhcp";
    else if (method == "manual") {
        result.mode = "static";
        std::string addresses;
        if (run({nmcli, "-g", "ipv4.addresses", "connection", "show", connection},
                &addresses)) {
            std::istringstream values(addresses);
            std::string address;
            while (std::getline(values, address)) {
                address = trim(address);
                const size_t separator = address.find('/');
                if (separator == std::string::npos) continue;
                const std::string ipv4 = address.substr(0, separator);
                const std::string prefix_text = address.substr(separator + 1);
                uint32_t ignored = 0;
                try {
                    size_t parsed = 0;
                    const int prefix = std::stoi(prefix_text, &parsed);
                    if (parsed == prefix_text.size() && parse_ipv4(ipv4, &ignored) &&
                        netmask_from_prefix(prefix, &result.netmask)) {
                        result.ipv4 = ipv4;
                        break;
                    }
                } catch (...) {
                    continue;
                }
            }
        }
        std::string gateway;
        if (run({nmcli, "-g", "ipv4.gateway", "connection", "show", connection},
                &gateway))
            result.gateway = trim(gateway);
    } else return result;

    std::string dns_output;
    std::string ignore_auto_dns;
    const bool has_dns_setting = run(
        {nmcli, "-g", "ipv4.dns", "connection", "show", connection}, &dns_output);
    bool dns_valid = true;
    const std::vector<std::string> dns = has_dns_setting
        ? parse_dns_servers(dns_output, &dns_valid) : std::vector<std::string>{};
    const bool has_ignore_setting = run(
        {nmcli, "-g", "ipv4.ignore-auto-dns", "connection", "show", connection},
        &ignore_auto_dns);
    if (!has_dns_setting || !has_ignore_setting || !dns_valid || dns.size() > 4) {
        result.mode = "unknown";
        return result;
    }
    const std::string dns_policy = trim(ignore_auto_dns);
    if (dns_policy != "yes" && dns_policy != "no") {
        result.mode = "unknown";
        return result;
    }
    if (dns_policy == "no") {
        if (!dns.empty()) {
            result.mode = "unknown";
            return result;
        }
        if (result.mode == "dhcp") result.dns = DnsConfig{"auto", {}};
        return result;
    }
    if (dns.empty()) {
        result.mode = "unknown";
        return result;
    }
    result.dns = DnsConfig{"manual", dns};
    return result;
}

std::string LinuxPlatform::management_hostname() const
{
    std::array<char, HOST_NAME_MAX + 1> hostname {};
    if (::gethostname(hostname.data(), HOST_NAME_MAX) != 0) return {};
    hostname.back() = '\0';
    return trim(hostname.data());
}

ManagementState LinuxPlatform::management()
{
    ManagementState result;
    result.hostname = management_hostname();
    result.stable = valid_management_hostname(result.hostname);
    if (!result.hostname.empty()) result.mdns_name = result.hostname + ".local";
    return result;
}

bool LinuxPlatform::preflight(const Candidate& candidate, std::string* reason)
{
    if (candidate.mode == "dhcp") return true;
    const std::string arping = binary({"/usr/sbin/arping", "/usr/bin/arping"});
    if (arping.empty()) {
        if (reason) *reason = "PREFLIGHT_UNAVAILABLE";
        return false;
    }
    std::string output;
    if (!run({arping, "-D", "-c", "2", "-w", "2", "-I", candidate.interface, candidate.ipv4}, &output)) {
        if (reason) *reason = "DUPLICATE_ADDRESS";
        return false;
    }
    return true;
}

bool LinuxPlatform::persist(const Candidate& candidate, std::string* reason,
    bool preserve_missing_dns)
{
    const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
    const std::string connection = configured_connection_name(candidate.interface);
    if (nmcli.empty() || connection.empty()) {
        if (reason) *reason = "NETWORKMANAGER_UNAVAILABLE";
        return false;
    }
    std::vector<std::string> args{nmcli, "connection", "modify", connection};
    if (candidate.mode == "dhcp") {
        args.insert(args.end(), {"ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", ""});
    } else {
        args.insert(args.end(), {"ipv4.method", "manual", "ipv4.addresses", cidr(candidate),
                                 "ipv4.gateway", candidate.gateway});
    }
    if (candidate.dns.has_value()) {
        if (candidate.dns->mode == "auto")
            args.insert(args.end(), {"ipv4.ignore-auto-dns", "no", "ipv4.dns", ""});
        else
            args.insert(args.end(), {"ipv4.ignore-auto-dns", "yes", "ipv4.dns",
                                     join_dns_servers(candidate.dns->servers)});
    } else if (!preserve_missing_dns) {
        args.insert(args.end(), {"ipv4.ignore-auto-dns", "no", "ipv4.dns", ""});
    }
    std::string output;
    if (!run(args, &output)) {
        if (reason) *reason = "PERSIST_FAILED";
        return false;
    }
    return true;
}

bool LinuxPlatform::interface_has_address(const std::string& interface,
                                          const std::string& ipv4, bool* present) const
{
    if (!present || interface.empty() || ipv4.empty()) return false;
    *present = false;
    struct ifaddrs* addresses = nullptr;
    if (::getifaddrs(&addresses) != 0) return false;
    bool found = false;
    for (const auto* item = addresses; item && !found; item = item->ifa_next) {
        if (!item->ifa_name || interface != item->ifa_name || !item->ifa_addr ||
            item->ifa_addr->sa_family != AF_INET) continue;
        std::array<char, INET_ADDRSTRLEN> text {};
        const auto* address = reinterpret_cast<const struct sockaddr_in*>(item->ifa_addr);
        found = ::inet_ntop(AF_INET, &address->sin_addr, text.data(), text.size()) &&
            ipv4 == text.data();
    }
    ::freeifaddrs(addresses);
    *present = found;
    return true;
}

void LinuxPlatform::rollback_retry_delay() const
{
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
}

bool LinuxPlatform::apply(const Candidate& candidate, const ActiveState&, std::string* reason)
{
    if (candidate.mode == "dhcp") {
        if (!persist(candidate, reason)) return false;
        const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
        std::string output;
        if (!run({nmcli, "device", "reapply", candidate.interface}, &output)) {
            if (reason) *reason = "APPLY_FAILED";
            return false;
        }
        return true;
    }
    const std::string ip = binary({"/usr/sbin/ip", "/usr/bin/ip"});
    if (ip.empty()) { if (reason) *reason = "IP_TOOL_UNAVAILABLE"; return false; }
    std::string output;
    if (!run({ip, "address", "add", cidr(candidate), "dev", candidate.interface}, &output)) {
        std::string status_reason;
        const ActiveState active = status(candidate.interface, &status_reason);
        if (active.ipv4 != candidate.ipv4) {
            if (reason) *reason = "APPLY_FAILED";
            return false;
        }
    }
    return true;
}

bool LinuxPlatform::confirm(const Candidate& candidate, const ActiveState& previous,
                            std::string* reason)
{
    if (!persist(candidate, reason)) return false;
    const std::string ip = binary({"/usr/sbin/ip", "/usr/bin/ip"});
    std::string output;
    if (candidate.mode == "static" && !candidate.gateway.empty() &&
        !run({ip, "route", "replace", "default", "via", candidate.gateway,
             "dev", candidate.interface, "src", candidate.ipv4}, &output)) {
        if (reason) *reason = "ROUTE_COMMIT_FAILED";
        return false;
    }
    if (!previous.ipv4.empty() && previous.ipv4 != candidate.ipv4) {
        (void)run({ip, "address", "del", cidr(previous), "dev", candidate.interface}, &output);
    }
    return true;
}

bool LinuxPlatform::rollback(const Candidate& candidate, const ActiveState& previous,
                              const Candidate& previous_configured,
                              bool previous_configured_complete,
                              std::string* reason)
{
    Candidate restore = previous_configured;
    std::string validation_reason;
    if (!validate_candidate(restore, &validation_reason)) {
        if (reason) *reason = "PREVIOUS_STATE_NOT_RESTORABLE";
        return false;
    }

    std::string status_reason;
    const ActiveState applied = status(candidate.interface, &status_reason);
    const std::string applied_ipv4 = candidate.mode == "dhcp" &&
        !applied.ipv4.empty() && applied.ipv4 != previous.ipv4
        ? applied.ipv4 : candidate.ipv4;

    if (!persist(restore, reason, !previous_configured_complete)) return false;
    const std::string nmcli = binary({"/usr/bin/nmcli", "/usr/sbin/nmcli"});
    if (nmcli.empty()) {
        if (reason) *reason = "NETWORKMANAGER_UNAVAILABLE";
        return false;
    }
    std::string output;
    if (!run({nmcli, "device", "reapply", previous.interface}, &output)) {
        if (reason) *reason = "ROLLBACK_REAPPLY_FAILED";
        return false;
    }

    if (!applied_ipv4.empty() && applied_ipv4 != previous.ipv4) {
        bool applied_present = false;
        if (!interface_has_address(candidate.interface, applied_ipv4, &applied_present)) {
            if (reason) *reason = "KERNEL_STATE_UNAVAILABLE";
            return false;
        }
        if (applied_present) {
            const std::string ip = binary({"/usr/sbin/ip", "/usr/bin/ip"});
            const int applied_prefix = candidate.mode == "static"
                ? netmask_to_prefix(candidate.netmask) : applied.prefix_length;
            const std::string applied_cidr = applied_ipv4 + "/" +
                std::to_string(applied_prefix);
            if (ip.empty() || applied_prefix < 1 || applied_prefix > 32 ||
                !run({ip, "address", "del", applied_cidr, "dev", candidate.interface}, &output) ||
                !interface_has_address(candidate.interface, applied_ipv4, &applied_present) ||
                applied_present) {
                if (reason) *reason = "ROLLBACK_ADDRESS_REMOVE_FAILED";
                return false;
            }
        }
    }

    constexpr int kVerifyAttempts = 20;
    for (int attempt = 0; attempt < kVerifyAttempts; ++attempt) {
        const ActiveState active = status(previous.interface, &status_reason);
        const Candidate configured_state = previous_configured_complete
            ? configured(previous.interface) : Candidate{};
        if (restored_state_matches(previous, active, previous_configured,
                                   configured_state, previous_configured_complete)) return true;
        if (attempt + 1 < kVerifyAttempts) rollback_retry_delay();
    }
    if (reason) *reason = "ROLLBACK_VERIFY_FAILED";
    return false;
}

Engine::Engine(std::shared_ptr<Platform> platform, std::string journal_path,
               std::string default_interface)
    : platform_(std::move(platform)), journal_path_(std::move(journal_path)),
      default_interface_(std::move(default_interface)), epoch_now_ms_(epoch_now_ms),
      steady_now_ms_(steady_now_ms)
{
    if (load_journal() &&
        (transaction_.state == "applying" || transaction_.state == "awaiting_confirmation") &&
        transaction_.rollback_deadline_epoch_ms > 0) {
        const int64_t remaining = std::clamp<int64_t>(
            transaction_.rollback_deadline_epoch_ms - epoch_now_ms_(), 0,
            int64_t{kRollbackMaxSeconds} * 1000);
        rollback_deadline_steady_ms_ = steady_now_ms_() + remaining;
    }
}

void Engine::set_epoch_now_for_test(std::function<int64_t()> fn)
{
    std::lock_guard<std::mutex> lock(mutex_);
    epoch_now_ms_ = std::move(fn);
}

void Engine::set_steady_now_for_test(std::function<int64_t()> fn)
{
    std::lock_guard<std::mutex> lock(mutex_);
    steady_now_ms_ = std::move(fn);
}

bool Engine::load_journal()
{
    std::ifstream input(journal_path_);
    if (!input.good()) return false;
    try {
        nlohmann::json value;
        input >> value;
        transaction_ = value.get<Transaction>();
        return true;
    } catch (...) {
        transaction_ = Transaction{};
        std::fprintf(stderr, "ERROR netcfg.journal invalid path=%s\n", journal_path_.c_str());
        return false;
    }
}

bool Engine::save_journal(std::string* reason) const
{
    nlohmann::json value = transaction_;
    return atomic_write_json(journal_path_, value, reason);
}

bool Engine::valid_request_id(const std::string& value)
{
    if (value.empty() || value.size() > 64) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return std::isalnum(c) || c == '_' || c == '.' || c == ':' || c == '-';
    });
}

std::string Engine::request_hash(const nlohmann::json& request)
{
    return std::to_string(std::hash<std::string>{}(request.dump()));
}

void Engine::remember(const std::string& request_id, const std::string& hash,
                      const nlohmann::json& value)
{
    cache_[request_id] = {hash, value};
    cache_order_.push_back(request_id);
    if (cache_order_.size() > 128) {
        cache_.erase(cache_order_.front());
        cache_order_.erase(cache_order_.begin());
    }
}

nlohmann::json Engine::response(const std::string& request_id, const std::string& result,
                                const std::string& reason_code, const std::string& message)
{
    std::string status_reason;
    const std::string iface = transaction_.candidate.interface.empty() ? default_interface_
                                                                       : transaction_.candidate.interface;
    const ActiveState active = platform_->status(iface, &status_reason);
    const Candidate configured = platform_->configured(iface);
    const ManagementState management = platform_->management();
    nlohmann::json value{{"version", kProtocolVersion}, {"requestId", request_id},
                         {"result", result}, {"reasonCode", reason_code},
                         {"state", transaction_.state}, {"active", active},
                         {"capabilities", {"dns", "management-hostname"}},
                         {"management", management}};
    if (configured.mode == "static" || configured.mode == "dhcp") {
        nlohmann::json configured_json{{"interface", configured.interface},
                                       {"mode", configured.mode}};
        if (!configured.ipv4.empty()) configured_json["ipv4"] = configured.ipv4;
        if (!configured.netmask.empty()) configured_json["netmask"] = configured.netmask;
        if (!configured.gateway.empty()) configured_json["gateway"] = configured.gateway;
        if (configured.dns.has_value()) configured_json["dns"] = *configured.dns;
        value["configured"] = std::move(configured_json);
    }
    if (!message.empty()) value["message"] = message;
    if (!transaction_.id.empty()) value["transactionId"] = transaction_.id;
    if (!transaction_.candidate.interface.empty() &&
        (transaction_.state == "staged" || transaction_.state == "applying" ||
         transaction_.state == "awaiting_confirmation"))
        value["pending"] = transaction_.candidate;
    if ((transaction_.state == "applying" || transaction_.state == "awaiting_confirmation") &&
        transaction_.rollback_deadline_epoch_ms > 0) {
        const int64_t epoch_remaining = std::max<int64_t>(
            0, transaction_.rollback_deadline_epoch_ms - epoch_now_ms_());
        const int64_t steady_remaining = rollback_deadline_steady_ms_ > 0
            ? std::max<int64_t>(0, rollback_deadline_steady_ms_ - steady_now_ms_())
            : epoch_remaining;
        const int64_t remaining = std::min(epoch_remaining, steady_remaining);
        value["rollbackRemainingS"] = std::min<int64_t>(kRollbackMaxSeconds, (remaining + 999) / 1000);
    }
    return value;
}

bool Engine::transaction_matches(const nlohmann::json& request) const
{
    return request.value("transactionId", "") == transaction_.id && !transaction_.id.empty();
}

void Engine::rollback_locked(const std::string& cause)
{
    transaction_.state = "rolling_back";
    transaction_.last_reason = cause;
    std::string ignored;
    (void)save_journal(&ignored);
    std::string reason;
    if (!transaction_.previous_configured.has_value()) {
        transaction_.state = "failed";
        transaction_.last_reason = "PREVIOUS_STATE_NOT_RESTORABLE";
    } else if (platform_->rollback(transaction_.candidate, transaction_.previous,
                                   *transaction_.previous_configured,
                                   transaction_.previous_configured_complete, &reason)) {
        transaction_.state = "rolled_back";
        transaction_.last_reason = cause;
    } else {
        transaction_.state = "failed";
        transaction_.last_reason = reason.empty() ? "ROLLBACK_FAILED" : reason;
    }
    transaction_.rollback_deadline_epoch_ms = 0;
    rollback_deadline_steady_ms_ = 0;
    (void)save_journal(&ignored);
}

void Engine::tick()
{
    std::lock_guard<std::mutex> lock(mutex_);
    if ((transaction_.state == "applying" || transaction_.state == "awaiting_confirmation") &&
        transaction_.rollback_deadline_epoch_ms > 0 &&
        (epoch_now_ms_() >= transaction_.rollback_deadline_epoch_ms ||
         (rollback_deadline_steady_ms_ > 0 && steady_now_ms_() >= rollback_deadline_steady_ms_))) {
        std::fprintf(stderr, "WARN  netcfg.transaction timeout transaction_id=%s action=rollback\n",
                     transaction_.id.c_str());
        rollback_locked("CONFIRM_TIMEOUT");
        return;
    }
    if (transaction_.state == "applying" && transaction_.candidate.mode == "dhcp") {
        std::string reason;
        const ActiveState active = platform_->status(transaction_.candidate.interface, &reason);
        const Candidate configured = platform_->configured(transaction_.candidate.interface);
        if (dhcp_candidate_ready(transaction_.candidate, active, configured)) {
            transaction_.state = "awaiting_confirmation";
            std::string ignored;
            (void)save_journal(&ignored);
        }
    }
}

nlohmann::json Engine::handle(const nlohmann::json& request)
{
    std::lock_guard<std::mutex> lock(mutex_);
    const std::string request_id = request.is_object() && request.contains("requestId") &&
        request.at("requestId").is_string() ? request.at("requestId").get<std::string>() : "";
    if (!valid_request_shape(request)) return response(request_id, "rejected", "INVALID_REQUEST");
    const std::string hash = request_hash(request);
    if (const auto it = cache_.find(request_id); it != cache_.end()) {
        if (it->second.first == hash) return it->second.second;
        return response(request_id, "rejected", "REQUEST_ID_CONFLICT");
    }
    if (request.value("version", 0) != kProtocolVersion)
        return response(request_id, "rejected", "UNSUPPORTED_VERSION");
    if (!valid_request_id(request_id)) return response(request_id, "rejected", "INVALID_REQUEST");
    const std::string action = request.value("action", "");
    nlohmann::json result;
    if (action == "status") {
        result = response(request_id, "accepted", "OK");
    } else if (action == "validate" || action == "stage") {
        Candidate candidate;
        try {
            candidate = request.at("candidate").get<Candidate>();
        } catch (...) {
            return response(request_id, "rejected", "INVALID_REQUEST");
        }
        if (candidate.interface.empty()) candidate.interface = default_interface_;
        std::string reason;
        const bool transaction_active = transaction_.state == "staged" ||
            transaction_.state == "applying" || transaction_.state == "awaiting_confirmation";
        if (!default_interface_.empty() && candidate.interface != default_interface_)
            result = response(request_id, "rejected", "INTERFACE_NOT_ALLOWED");
        else if (action == "stage" && transaction_active)
            result = response(request_id, "rejected", "TRANSACTION_IN_PROGRESS");
        else if (!validate_candidate(candidate, &reason))
            result = response(request_id, "rejected", reason);
        else if (!platform_->preflight(candidate, &reason))
            result = response(request_id, "rejected", reason.empty() ? "PREFLIGHT_FAILED" : reason);
        else if (action == "validate")
            result = response(request_id, "accepted", "OK");
        else {
            const ActiveState active = platform_->status(candidate.interface, &reason);
            const Candidate configured = platform_->configured(candidate.interface);
            if (active.interface.empty()) {
                result = response(request_id, "rejected", reason.empty() ? "KERNEL_STATE_UNAVAILABLE" : reason);
            } else if (configured.interface != candidate.interface ||
                       !validate_candidate(configured, &reason)) {
                result = response(request_id, "rejected", "PREVIOUS_STATE_NOT_RESTORABLE");
            } else {
                Transaction next;
                next.id = "net-" + std::to_string(epoch_now_ms_()) + "-" +
                          std::to_string(::getpid()) + "-" +
                          std::to_string(transaction_sequence.fetch_add(1) + 1);
                next.state = "staged";
                next.candidate = candidate;
                next.previous = active;
                next.previous_configured = configured;
                next.previous_configured_complete = true;
                const Transaction old = transaction_;
                transaction_ = next;
                if (!save_journal(&reason)) {
                    transaction_ = old;
                    result = response(request_id, "rejected", reason);
                } else result = response(request_id, "accepted", "OK");
            }
        }
    } else if (action == "apply") {
        if (!transaction_matches(request) || transaction_.state != "staged")
            result = response(request_id, "rejected", "INVALID_TRANSITION");
        else {
            std::string reason;
            transaction_.state = "applying";
            transaction_.rollback_deadline_epoch_ms = epoch_now_ms_() + int64_t{kRollbackMaxSeconds} * 1000;
            rollback_deadline_steady_ms_ = steady_now_ms_() + int64_t{kRollbackMaxSeconds} * 1000;
            if (!save_journal(&reason)) {
                transaction_.state = "staged";
                result = response(request_id, "rejected", reason);
            } else if (!platform_->apply(transaction_.candidate, transaction_.previous, &reason)) {
                rollback_locked(reason.empty() ? "APPLY_FAILED" : reason);
                result = response(request_id, "rejected", transaction_.last_reason);
            } else {
                if (transaction_.candidate.mode == "static") transaction_.state = "awaiting_confirmation";
                (void)save_journal(&reason);
                result = response(request_id, "accepted", "OK");
            }
        }
    } else if (action == "confirm") {
        if (!transaction_matches(request) || transaction_.state != "awaiting_confirmation")
            result = response(request_id, "rejected", "INVALID_TRANSITION");
        else {
            std::string reason;
            if (!platform_->confirm(transaction_.candidate, transaction_.previous, &reason))
                result = response(request_id, "rejected", reason.empty() ? "CONFIRM_FAILED" : reason);
            else {
                transaction_.state = "confirmed";
                transaction_.rollback_deadline_epoch_ms = 0;
                rollback_deadline_steady_ms_ = 0;
                transaction_.last_reason = "OK";
                if (!save_journal(&reason)) {
                    const std::string journal_reason = reason;
                    rollback_locked(journal_reason);
                    result = response(request_id, "rejected", journal_reason);
                } else result = response(request_id, "accepted", "OK");
            }
        }
    } else if (action == "rollback") {
        if (!transaction_matches(request) ||
            (transaction_.state != "staged" && transaction_.state != "applying" &&
             transaction_.state != "awaiting_confirmation"))
            result = response(request_id, "rejected", "INVALID_TRANSITION");
        else {
            rollback_locked("EXPLICIT_ROLLBACK");
            result = response(request_id, transaction_.state == "rolled_back" ? "accepted" : "rejected",
                              transaction_.last_reason);
        }
    } else {
        result = response(request_id, "rejected", "UNKNOWN_ACTION");
    }
    std::fprintf(stderr,
                 "INFO  netcfg.request request_id=%s action=%s result=%s reason_code=%s state=%s transaction_id=%s request_fingerprint=%s\n",
                 request_id.c_str(), action.c_str(), result.value("result", "rejected").c_str(),
                 result.value("reasonCode", "INTERNAL_ERROR").c_str(), transaction_.state.c_str(),
                 transaction_.id.empty() ? "-" : transaction_.id.c_str(), hash.c_str());
    remember(request_id, hash, result);
    return result;
}

Transaction Engine::transaction() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return transaction_;
}

Server::Server(Engine& engine, std::string socket_path, std::string allowed_user)
    : engine_(engine), socket_path_(std::move(socket_path)), allowed_user_(std::move(allowed_user)) {}

Server::~Server() { stop(); }

bool Server::allowed_peer(int fd, uint32_t* uid) const
{
    struct ucred cred {};
    socklen_t length = sizeof(cred);
    if (::getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &length) != 0) return false;
    if (uid) *uid = cred.uid;
    if (cred.uid == 0) return true;
    const struct passwd* user = ::getpwnam(allowed_user_.c_str());
    return user && cred.uid == user->pw_uid;
}

void Server::handle_client(int fd)
{
    struct timeval timeout {4, 0};
    (void)::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    (void)::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    std::string frame;
    std::array<char, 512> buffer {};
    while (frame.size() <= kMaxFrameBytes) {
        const ssize_t n = ::read(fd, buffer.data(), buffer.size());
        if (n > 0) {
            frame.append(buffer.data(), static_cast<size_t>(n));
            const size_t newline = frame.find('\n');
            if (newline != std::string::npos) { frame.resize(newline); break; }
        } else if (n < 0 && errno == EINTR) continue;
        else break;
    }
    nlohmann::json response;
    try {
        if (frame.empty() || frame.size() > kMaxFrameBytes) throw std::runtime_error("bad frame");
        response = engine_.handle(nlohmann::json::parse(frame));
    } catch (...) {
        response = engine_.handle(nlohmann::json{{"invalid", true}});
    }
    const std::string output = response.dump() + "\n";
    (void)write_all(fd, output.data(), output.size());
}

bool Server::run()
{
    const std::filesystem::path path(socket_path_);
    try { std::filesystem::create_directories(path.parent_path()); }
    catch (...) { return false; }
    struct sockaddr_un address {};
    if (socket_path_.size() >= sizeof(address.sun_path)) {
        errno = ENAMETOOLONG;
        return false;
    }
    ::unlink(socket_path_.c_str());
    listen_fd_ = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (listen_fd_ < 0) return false;
    const auto fail_startup = [&](const char* operation) {
        const int saved_errno = errno;
        std::fprintf(stderr, "ERROR netcfg.listen operation=%s errno=%d\n",
                     operation, saved_errno);
        ::close(listen_fd_);
        listen_fd_ = -1;
        ::unlink(socket_path_.c_str());
        errno = saved_errno;
        return false;
    };
    address.sun_family = AF_UNIX;
    std::snprintf(address.sun_path, sizeof(address.sun_path), "%s", socket_path_.c_str());
    if (::bind(listen_fd_, reinterpret_cast<struct sockaddr*>(&address), sizeof(address)) != 0)
        return fail_startup("bind");
    if (::listen(listen_fd_, 8) != 0) return fail_startup("listen");
    if (::chmod(socket_path_.c_str(), 0660) != 0) return fail_startup("chmod");
    const struct passwd* user = ::getpwnam(allowed_user_.c_str());
    if (!user) {
        errno = ENOENT;
        return fail_startup("getpwnam");
    }
    if (::chown(socket_path_.c_str(), 0, user->pw_gid) != 0)
        return fail_startup("chown");
    std::fprintf(stderr, "INFO  netcfg.listen socket=%s user=%s\n", socket_path_.c_str(), allowed_user_.c_str());
    while (!stopping_) {
        struct pollfd pfd {listen_fd_, POLLIN, 0};
        const int ready = ::poll(&pfd, 1, 250);
        engine_.tick();
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0 || !(pfd.revents & POLLIN)) continue;
        const int client = ::accept4(listen_fd_, nullptr, nullptr, SOCK_CLOEXEC);
        if (client < 0) continue;
        uint32_t peer_uid = UINT32_MAX;
        if (allowed_peer(client, &peer_uid)) {
            std::fprintf(stderr, "INFO  netcfg.peer accepted uid=%u\n", peer_uid);
            handle_client(client);
        } else std::fprintf(stderr, "WARN  netcfg.peer rejected uid=%u\n", peer_uid);
        ::close(client);
    }
    return true;
}

void Server::stop()
{
    stopping_ = true;
    if (listen_fd_ >= 0) {
        ::close(listen_fd_);
        listen_fd_ = -1;
    }
    if (!socket_path_.empty()) ::unlink(socket_path_.c_str());
}

} // namespace netcfg
