#include "netcfg.hpp"

#include <algorithm>
#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <memory>
#include <set>

namespace {

class FakePlatform final : public netcfg::Platform {
public:
    netcfg::ActiveState active{"eth0", "up", "static", "192.168.1.50", 24, "192.168.1.1"};
    netcfg::Candidate configured_state{"eth0", "static", "192.168.1.50",
                                       "255.255.255.0", "192.168.1.1"};
    netcfg::ManagementState management_state{"mkddc-lab", "mkddc-lab.local", true};
    bool preflight_ok = true;
    bool apply_ok = true;
    bool confirm_ok = true;
    bool rollback_ok = true;
    int apply_calls = 0;
    int confirm_calls = 0;
    int rollback_calls = 0;
    bool rollback_previous_complete = true;
    netcfg::Candidate rollback_previous_configured;

    netcfg::ActiveState status(const std::string& interface, std::string* reason) override {
        auto result = active;
        if (!interface.empty()) result.interface = interface;
        if (reason) *reason = result.reason_code;
        return result;
    }
    netcfg::Candidate configured(const std::string& interface) override {
        auto result = configured_state;
        if (!interface.empty()) result.interface = interface;
        return result;
    }
    netcfg::ManagementState management() override { return management_state; }
    bool preflight(const netcfg::Candidate&, std::string* reason) override {
        if (reason) *reason = preflight_ok ? "OK" : "DUPLICATE_ADDRESS";
        return preflight_ok;
    }
    bool apply(const netcfg::Candidate& candidate, const netcfg::ActiveState&, std::string* reason) override {
        ++apply_calls;
        if (apply_ok && candidate.mode == "static") active.ipv4 = candidate.ipv4;
        if (reason) *reason = apply_ok ? "OK" : "APPLY_FAILED";
        return apply_ok;
    }
    bool confirm(const netcfg::Candidate&, const netcfg::ActiveState&, std::string* reason) override {
        ++confirm_calls;
        if (reason) *reason = confirm_ok ? "OK" : "CONFIRM_FAILED";
        return confirm_ok;
    }
    bool rollback(const netcfg::Candidate&, const netcfg::ActiveState& previous,
                  const netcfg::Candidate& previous_configured,
                  bool previous_complete, std::string* reason) override {
        ++rollback_calls;
        rollback_previous_configured = previous_configured;
        rollback_previous_complete = previous_complete;
        if (rollback_ok) active = previous;
        if (reason) *reason = rollback_ok ? "OK" : "ROLLBACK_FAILED";
        return rollback_ok;
    }
};

class FakeStatusLinuxPlatform final : public netcfg::LinuxPlatform {
public:
    netcfg::InterfaceSnapshot snapshot;
    bool kernel_state_available = true;
    std::string active_connection;
    std::string profile_uuid;
    std::string profile_interface;
    std::string profile_method;
    std::string profile_addresses;
    std::string profile_gateway;
    std::string profile_dns;
    std::string profile_ignore_auto_dns = "no";
    std::string runtime_dns;
    std::string hostname = "mkddc-lab";
    std::vector<std::vector<std::string>> commands;

    bool persist_candidate(const netcfg::Candidate& candidate, std::string* reason) {
        return persist(candidate, reason);
    }
    bool preflight(const netcfg::Candidate&, std::string* reason) override {
        if (reason) *reason = "OK";
        return true;
    }

protected:
    bool read_interface_state(const std::string&, netcfg::InterfaceSnapshot* state) const override {
        if (!kernel_state_available) return false;
        *state = snapshot;
        return true;
    }

    bool run(const std::vector<std::string>& args, std::string* output) override {
        commands.push_back(args);
        const auto return_output = [&](const std::string& value) {
            if (output) *output = value;
            return true;
        };
        /* Production nay hỏi CON-UUID (duy nhất) thay vì CONNECTION (có thể trùng
         * tên) — xem LinuxPlatform::connection_name. */
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "GENERAL.CON-UUID")
            return return_output(active_connection);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "GENERAL.CONNECTION")
            return return_output(active_connection);
        if (args.size() == 5 && args[1] == "-g" && args[2] == "UUID")
            return return_output(profile_uuid);
        if (args.size() == 7 && args[1] == "-g" && args[2] == "connection.interface-name")
            return return_output(profile_interface);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "ipv4.method")
            return return_output(profile_method);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "ipv4.addresses")
            return return_output(profile_addresses);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "ipv4.gateway")
            return return_output(profile_gateway);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "ipv4.dns")
            return return_output(profile_dns);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "ipv4.ignore-auto-dns")
            return return_output(profile_ignore_auto_dns);
        if (args.size() >= 6 && args[1] == "-g" && args[2] == "IP4.DNS")
            return return_output(runtime_dns);
        if (args.size() >= 3 && args[1] == "connection" && args[2] == "modify")
            return return_output({});
        return false;
    }

    std::string binary(const std::vector<std::string>& choices) override {
        return choices.empty() ? std::string{} : choices.front();
    }

    std::string management_hostname() const override { return hostname; }
};

class FakeLinuxPlatform final : public netcfg::LinuxPlatform {
public:
    netcfg::ActiveState current;
    netcfg::ActiveState restored_after_reapply;
    netcfg::Candidate persisted;
    netcfg::Candidate configured_state;
    bool persist_ok = true;
    bool reapply_ok = true;
    bool address_remove_ok = true;
    bool preserve_missing_dns = true;
    std::set<std::string> addresses;
    std::vector<std::vector<std::string>> commands;

    netcfg::ActiveState status(const std::string& interface, std::string* reason) override {
        auto result = current;
        if (!interface.empty()) result.interface = interface;
        if (reason) *reason = "OK";
        return result;
    }

    netcfg::Candidate configured(const std::string& interface) override {
        auto result = configured_state;
        if (!interface.empty()) result.interface = interface;
        return result;
    }

protected:
    bool run(const std::vector<std::string>& args, std::string*) override {
        commands.push_back(args);
        if (args.size() >= 4 && args[1] == "device" && args[2] == "reapply") {
            if (reapply_ok) current = restored_after_reapply;
            return reapply_ok;
        }
        if (args.size() >= 5 && args[1] == "address" && args[2] == "del") {
            if (!address_remove_ok) return false;
            addresses.erase(args[3].substr(0, args[3].find('/')));
            return true;
        }
        return true;
    }

    std::string binary(const std::vector<std::string>& choices) override {
        return choices.empty() ? std::string{} : choices.front();
    }

    bool persist(const netcfg::Candidate& candidate, std::string* reason,
                 bool preserve_dns) override {
        persisted = candidate;
        configured_state = candidate;
        preserve_missing_dns = preserve_dns;
        if (reason) *reason = persist_ok ? "OK" : "PERSIST_FAILED";
        return persist_ok;
    }

    bool interface_has_address(const std::string&, const std::string& ipv4,
                               bool* present) const override {
        if (!present) return false;
        *present = addresses.count(ipv4) != 0;
        return true;
    }

    void rollback_retry_delay() const override {}
};

std::string journal_path()
{
    const auto base = std::filesystem::temp_directory_path() /
        ("mkddc-netcfg-test-" + std::to_string(::getpid()) + "-" +
         std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(base);
    return (base / "journal.json").string();
}

nlohmann::json request(const std::string& id, const std::string& action)
{
    return {{"version", 1}, {"requestId", id}, {"action", action}};
}

nlohmann::json candidate()
{
    return {{"interface", "eth0"}, {"mode", "static"}, {"ipv4", "192.168.1.80"},
            {"netmask", "255.255.255.0"}, {"gateway", "192.168.1.1"}};
}

struct StatusReasonCase {
    const char* name;
    bool kernel_state_available;
    netcfg::InterfaceSnapshot snapshot;
    const char* expected_link;
    const char* expected_reason;
};

class NetcfgStatusReasonTest : public testing::TestWithParam<StatusReasonCase> {};

TEST_P(NetcfgStatusReasonTest, AppliesOperationalReasonPrecedence)
{
    const auto& test_case = GetParam();
    FakeStatusLinuxPlatform platform;
    platform.kernel_state_available = test_case.kernel_state_available;
    platform.snapshot = test_case.snapshot;
    std::string reason;

    const auto active = platform.status("end1", &reason);

    EXPECT_EQ(active.interface, "end1");
    EXPECT_EQ(active.link, test_case.expected_link);
    EXPECT_EQ(active.admin_up, test_case.snapshot.admin_up);
    EXPECT_EQ(active.carrier, test_case.snapshot.carrier);
    EXPECT_EQ(active.reason_code, test_case.expected_reason);
    EXPECT_EQ(reason, test_case.expected_reason);
}

INSTANTIATE_TEST_SUITE_P(
    ReasonPrecedence, NetcfgStatusReasonTest,
    testing::Values(
        StatusReasonCase{"InterfaceNotFound", true, {}, "unknown", "INTERFACE_NOT_FOUND"},
        StatusReasonCase{"KernelUnavailable", false, {}, "unknown", "KERNEL_STATE_UNAVAILABLE"},
        StatusReasonCase{"AdminDown", true, {true, false, false, {}, 0}, "down", "ADMIN_DOWN"},
        StatusReasonCase{"NoCarrier", true, {true, true, false, {}, 0}, "down", "NO_CARRIER"},
        StatusReasonCase{"NoActiveAddress", true, {true, true, true, {}, 0}, "up", "NO_ACTIVE_ADDRESS"},
        StatusReasonCase{"Ok", true, {true, true, true, "192.168.1.50", 24}, "up", "OK"}),
    [](const testing::TestParamInfo<StatusReasonCase>& info) { return info.param.name; });

TEST(NetcfgValidation, RejectsUnsafeAndInconsistentAddresses)
{
    std::string reason;
    EXPECT_TRUE(netcfg::validate_candidate(candidate().get<netcfg::Candidate>(), &reason));
    auto bad = candidate();
    bad["ipv4"] = "127.0.0.1";
    EXPECT_FALSE(netcfg::validate_candidate(bad.get<netcfg::Candidate>(), &reason));
    EXPECT_EQ(reason, "UNUSABLE_ADDRESS");
    bad = candidate();
    bad["gateway"] = "192.168.2.1";
    EXPECT_FALSE(netcfg::validate_candidate(bad.get<netcfg::Candidate>(), &reason));
    EXPECT_EQ(reason, "INVALID_GATEWAY");
    bad = {{"interface", "eth0"}, {"mode", "dhcp"}, {"ipv4", "192.168.1.2"}};
    EXPECT_FALSE(netcfg::validate_candidate(bad.get<netcfg::Candidate>(), &reason));
    EXPECT_EQ(reason, "DHCP_STATIC_FIELDS_PRESENT");
}

TEST(NetcfgValidation, EnforcesDnsModeAndCanonicalUniqueServers)
{
    struct TestCase {
        netcfg::Candidate candidate;
        bool accepted;
        const char* reason;
    };
    const std::vector<TestCase> cases{
        {{"eth0", "dhcp", {}, {}, {}, netcfg::DnsConfig{"auto", {}}}, true, ""},
        {{"eth0", "static", "192.168.1.20", "255.255.255.0", "192.168.1.1",
          netcfg::DnsConfig{"auto", {}}}, false, "DNS_AUTO_REQUIRES_DHCP"},
        {{"eth0", "dhcp", {}, {}, {}, netcfg::DnsConfig{"auto", {"1.1.1.1"}}},
         false, "DNS_AUTO_SERVERS_PRESENT"},
        {{"eth0", "dhcp", {}, {}, {}, netcfg::DnsConfig{"manual", {}}},
         false, "DNS_SERVERS_REQUIRED"},
        {{"eth0", "dhcp", {}, {}, {},
          netcfg::DnsConfig{"manual", {"1.1.1.1", "8.8.8.8", "9.9.9.9",
                                           "208.67.222.222", "208.67.220.220"}}},
         false, "TOO_MANY_DNS_SERVERS"},
        {{"eth0", "dhcp", {}, {}, {},
          netcfg::DnsConfig{"manual", {"192.168.001.1"}}},
         false, "INVALID_DNS_SERVER"},
        {{"eth0", "dhcp", {}, {}, {},
          netcfg::DnsConfig{"manual", {"1.1.1.1", "1.1.1.1"}}},
         false, "DUPLICATE_DNS_SERVER"},
        {{"eth0", "dhcp", {}, {}, {},
          netcfg::DnsConfig{"manual", {"1.1.1.1", "8.8.8.8"}}}, true, ""},
    };

    for (const auto& test_case : cases) {
        std::string reason;
        EXPECT_EQ(netcfg::validate_candidate(test_case.candidate, &reason), test_case.accepted);
        if (!test_case.accepted) {
            EXPECT_EQ(reason, test_case.reason);
        }
    }
}

TEST(NetcfgValidation, MissingDnsPreservesTheExistingProfile)
{
    const netcfg::Candidate candidate_value{"eth0", "dhcp", {}, {}, {}};
    std::string reason;

    EXPECT_TRUE(netcfg::validate_candidate(candidate_value, &reason));
    EXPECT_FALSE(candidate_value.dns.has_value());
}

TEST(NetcfgEngine, StatusIncludesConfiguredAndOperationalFields)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->configured_state = {"eth0", "dhcp", {}, {}, {}};
    platform->configured_state.dns = netcfg::DnsConfig{"auto", {}};
    platform->active.admin_up = true;
    platform->active.carrier = false;
    platform->active.reason_code = "NO_CARRIER";
    platform->active.dns_servers = {"192.168.1.1"};
    netcfg::Engine engine(platform, journal_path(), "eth0");

    const auto response = engine.handle(request("status-contract", "status"));

    ASSERT_TRUE(response.contains("configured"));
    EXPECT_EQ(response.at("configured").at("interface"), "eth0");
    EXPECT_EQ(response.at("configured").at("mode"), "dhcp");
    EXPECT_FALSE(response.at("configured").contains("ipv4"));
    EXPECT_FALSE(response.at("configured").contains("netmask"));
    EXPECT_FALSE(response.at("configured").contains("gateway"));
    EXPECT_EQ(response.at("configured").at("dns").at("mode"), "auto");
    EXPECT_TRUE(response.at("active").at("adminUp"));
    EXPECT_FALSE(response.at("active").at("carrier"));
    EXPECT_EQ(response.at("active").at("reasonCode"), "NO_CARRIER");
    EXPECT_EQ(response.at("active").at("dnsServers"),
              nlohmann::json::array({"192.168.1.1"}));
    EXPECT_EQ(response.at("capabilities"),
              nlohmann::json::array({"dns", "management-hostname"}));
    EXPECT_EQ(response.at("management").at("hostname"), "mkddc-lab");
    EXPECT_EQ(response.at("management").at("mdnsName"), "mkddc-lab.local");
    EXPECT_TRUE(response.at("management").at("stable"));
}

TEST(NetcfgEngine, StatusOmitsUnknownConfiguredProfile)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->configured_state = {"eth0", "unknown", {}, {}, {}};
    netcfg::Engine engine(platform, journal_path(), "eth0");

    const auto response = engine.handle(request("status-no-profile", "status"));

    EXPECT_FALSE(response.contains("configured"));
}

TEST(NetcfgLinuxPlatform, InactiveBoundDhcpProfileIsConfiguredButNotActive)
{
    auto platform = std::make_shared<FakeStatusLinuxPlatform>();
    platform->snapshot = {true, true, false, {}, 0};
    platform->profile_uuid = "profile-uuid";
    platform->profile_interface = "end1";
    platform->profile_method = "auto";
    netcfg::Engine engine(platform, journal_path(), "end1");

    const auto response = engine.handle(request("status-inactive-profile", "status"));

    EXPECT_EQ(response.at("configured").at("interface"), "end1");
    EXPECT_EQ(response.at("configured").at("mode"), "dhcp");
    EXPECT_EQ(response.at("active").at("mode"), "unknown");
    EXPECT_EQ(response.at("active").at("link"), "down");
    EXPECT_EQ(response.at("active").at("reasonCode"), "NO_CARRIER");
}

TEST(NetcfgLinuxPlatform, ConfiguredStaticProfileUsesFirstValidAddress)
{
    FakeStatusLinuxPlatform platform;
    platform.profile_uuid = "profile-uuid";
    platform.profile_interface = "end1";
    platform.profile_method = "manual";
    platform.profile_addresses = "not-an-address\n192.168.10.25/24\n192.168.20.25/24";
    platform.profile_gateway = "192.168.10.1";

    const auto configured = platform.configured("end1");

    EXPECT_EQ(configured.interface, "end1");
    EXPECT_EQ(configured.mode, "static");
    EXPECT_EQ(configured.ipv4, "192.168.10.25");
    EXPECT_EQ(configured.netmask, "255.255.255.0");
    EXPECT_EQ(configured.gateway, "192.168.10.1");
}

/* Hồi quy từ board thật 2026-07-31.
 *
 * Candidate DHCP KHÔNG được mang ipv4/netmask/gateway (schema v1). Bản cũ luôn
 * phát cả ba dưới dạng chuỗi rỗng, nên sau khi stage một transaction DHCP thì
 * `pending` sai schema và adapter Go từ chối: mọi lần đọc status trả 502 và cả
 * trang settings/network hỏng cho tới khi transaction được dọn thủ công. */
/* Hồi quy từ board thật 2026-07-31: giữ nguyên IP mà chỉ đổi DNS phải được phép.
 * `arping -D` chạy trên chính interface đang mang địa chỉ đó sẽ tự phát hiện
 * mình và báo DUPLICATE_ADDRESS, chặn một thao tác hợp lệ. */
namespace {
/* Mô phỏng ĐÚNG hành vi kernel Linux cho F-14.
 *
 * Với `net.ipv4.conf.<if>.promote_secondaries = 0` (mặc định trên board), xoá địa
 * chỉ PRIMARY sẽ xoá luôn mọi địa chỉ SECONDARY cùng subnet. `apply` cố ý giữ địa
 * chỉ cũ và chỉ thêm địa chỉ mới, nên khi hai địa chỉ cùng subnet thì `confirm`
 * (vốn xoá địa chỉ cũ) làm interface mất SẠCH địa chỉ. */
class PromoteSecondariesPlatform final : public netcfg::LinuxPlatform {
public:
    /* addresses[0] là primary; phần còn lại là secondary theo thứ tự thêm vào. */
    std::vector<std::string> addresses;
    bool kernel_purges_same_subnet_secondaries = true;
    std::vector<std::vector<std::string>> commands;

    static std::string subnet24(const std::string& ipv4) {
        const size_t last = ipv4.rfind('.');
        return last == std::string::npos ? ipv4 : ipv4.substr(0, last);
    }

protected:
    bool run(const std::vector<std::string>& args, std::string*) override {
        commands.push_back(args);
        if (args.size() >= 5 && args[1] == "address" && args[2] == "del") {
            const std::string victim = args[3].substr(0, args[3].find('/'));
            const bool was_primary = !addresses.empty() && addresses.front() == victim;
            const std::string net = subnet24(victim);
            std::vector<std::string> kept;
            for (const auto& a : addresses) {
                if (a == victim) continue;
                if (was_primary && kernel_purges_same_subnet_secondaries && subnet24(a) == net)
                    continue;   /* kernel xoá kèm secondary cùng subnet */
                kept.push_back(a);
            }
            addresses = kept;
            return true;
        }
        if (args.size() >= 5 && args[1] == "address" && args[2] == "add") {
            const std::string added = args[3].substr(0, args[3].find('/'));
            if (std::find(addresses.begin(), addresses.end(), added) == addresses.end())
                addresses.push_back(added);
            return true;
        }
        return true;
    }
    std::string binary(const std::vector<std::string>& choices) override {
        return choices.empty() ? std::string{} : choices.front();
    }
    bool persist(const netcfg::Candidate&, std::string* reason, bool) override {
        if (reason) *reason = "OK";
        return true;
    }
    bool interface_has_address(const std::string&, const std::string& ipv4,
                               bool* present) const override {
        if (!present) return false;
        *present = std::find(addresses.begin(), addresses.end(), ipv4) != addresses.end();
        return true;
    }
};

netcfg::Candidate static_candidate(const std::string& ipv4)
{
    netcfg::Candidate c;
    c.interface = "end1";
    c.mode = "static";
    c.ipv4 = ipv4;
    c.netmask = "255.255.255.0";
    return c;
}

netcfg::ActiveState active_at(const std::string& ipv4)
{
    netcfg::ActiveState a;
    a.interface = "end1";
    a.ipv4 = ipv4;
    a.prefix_length = 24;
    return a;
}
} // namespace

/* F-14 — hồi quy từ board thật 2026-07-31.
 * Đổi IPv4 tĩnh sang IPv4 tĩnh CÙNG subnet rồi Confirm khiến interface mất sạch
 * địa chỉ; authority vẫn báo `confirmed` còn thiết bị thì rớt khỏi mạng. */
TEST(NetcfgLinuxPlatform, ConfirmKeepsCandidateAddressWhenOldAndNewShareASubnet)
{
    PromoteSecondariesPlatform platform;
    /* Trạng thái sau apply: địa chỉ cũ là primary, địa chỉ mới là secondary. */
    platform.addresses = {"192.168.50.150", "192.168.50.161"};

    std::string reason;
    ASSERT_TRUE(platform.confirm(static_candidate("192.168.50.161"),
                                 active_at("192.168.50.150"), &reason)) << reason;

    ASSERT_EQ(platform.addresses.size(), 1u)
        << "confirm phải để lại ĐÚNG một địa chỉ";
    EXPECT_EQ(platform.addresses.front(), "192.168.50.161")
        << "địa chỉ còn lại phải là candidate, không phải rỗng và không phải địa chỉ cũ";
}

/* Khác subnet: kernel không xoá kèm, nhưng kết quả cuối vẫn phải như nhau. */
TEST(NetcfgLinuxPlatform, ConfirmKeepsCandidateAddressAcrossSubnets)
{
    PromoteSecondariesPlatform platform;
    platform.addresses = {"192.168.50.150", "10.20.30.40"};

    std::string reason;
    ASSERT_TRUE(platform.confirm(static_candidate("10.20.30.40"),
                                 active_at("192.168.50.150"), &reason)) << reason;

    ASSERT_EQ(platform.addresses.size(), 1u);
    EXPECT_EQ(platform.addresses.front(), "10.20.30.40");
}

/* DHCP: candidate không mang ipv4 nên không có gì để khẳng định lại — confirm
 * vẫn phải thành công chứ không được fail-closed nhầm. */
TEST(NetcfgLinuxPlatform, ConfirmSucceedsForDhcpWithoutCandidateAddress)
{
    PromoteSecondariesPlatform platform;
    platform.addresses = {"192.168.50.150"};

    netcfg::Candidate dhcp;
    dhcp.interface = "end1";
    dhcp.mode = "dhcp";

    std::string reason;
    EXPECT_TRUE(platform.confirm(dhcp, active_at("192.168.50.150"), &reason)) << reason;
}

/* Giữ nguyên địa chỉ (chỉ đổi DNS): không được xoá gì cả. */
TEST(NetcfgLinuxPlatform, ConfirmWithUnchangedAddressTouchesNothing)
{
    PromoteSecondariesPlatform platform;
    platform.addresses = {"192.168.50.150"};

    std::string reason;
    ASSERT_TRUE(platform.confirm(static_candidate("192.168.50.150"),
                                 active_at("192.168.50.150"), &reason)) << reason;

    ASSERT_EQ(platform.addresses.size(), 1u);
    EXPECT_EQ(platform.addresses.front(), "192.168.50.150");
    for (const auto& command : platform.commands)
        for (const auto& arg : command)
            EXPECT_NE(arg, "del") << "không được xoá địa chỉ khi địa chỉ không đổi";
}

namespace {
/* KHÔNG override preflight — đây chính là hàm đang được kiểm.
 * FakeStatusLinuxPlatform không dùng được vì nó ghi đè preflight thành luôn OK. */
class PreflightProbePlatform final : public netcfg::LinuxPlatform {
public:
    netcfg::InterfaceSnapshot snapshot;
    bool arping_says_duplicate = true;
    std::vector<std::vector<std::string>> commands;

protected:
    bool read_interface_state(const std::string&, netcfg::InterfaceSnapshot* state) const override {
        *state = snapshot;
        return true;
    }
    bool run(const std::vector<std::string>& args, std::string*) override {
        commands.push_back(args);
        return !arping_says_duplicate;   /* run()==false ⇒ DUPLICATE_ADDRESS */
    }
    std::string binary(const std::vector<std::string>& choices) override {
        return choices.empty() ? std::string{} : choices.front();
    }
};
} // namespace

TEST(NetcfgLinuxPlatform, RestagingTheAddressTheInterfaceAlreadyHoldsIsNotADuplicate)
{
    PreflightProbePlatform platform;
    platform.snapshot = {true, true, true, "192.168.50.61", 24};
    platform.arping_says_duplicate = true;   /* nếu có probe thì sẽ báo trùng */

    netcfg::Candidate candidate;
    candidate.interface = "end1";
    candidate.mode = "static";
    candidate.ipv4 = "192.168.50.61";
    candidate.netmask = "255.255.255.0";

    std::string reason;
    EXPECT_TRUE(platform.preflight(candidate, &reason)) << "reason=" << reason;

    for (const auto& command : platform.commands)
        for (const auto& arg : command)
            EXPECT_NE(arg, "-D") << "không được ARP-probe địa chỉ của chính mình";
}

/* Địa chỉ KHÁC thì vẫn phải probe và vẫn phải chặn khi trùng thật. */
TEST(NetcfgLinuxPlatform, DifferentAddressStillRunsDuplicateDetection)
{
    PreflightProbePlatform platform;
    platform.snapshot = {true, true, true, "192.168.50.61", 24};
    platform.arping_says_duplicate = true;

    netcfg::Candidate candidate;
    candidate.interface = "end1";
    candidate.mode = "static";
    candidate.ipv4 = "192.168.50.99";
    candidate.netmask = "255.255.255.0";

    std::string reason;
    EXPECT_FALSE(platform.preflight(candidate, &reason));
    EXPECT_EQ(reason, "DUPLICATE_ADDRESS");
}

TEST(NetcfgSerialization, DhcpCandidateOmitsAddressFieldsPerSchema)
{
    netcfg::Candidate dhcp;
    dhcp.interface = "end1";
    dhcp.mode = "dhcp";

    const nlohmann::json encoded = dhcp;

    EXPECT_EQ(encoded.value("mode", ""), "dhcp");
    EXPECT_FALSE(encoded.contains("ipv4")) << "schema cấm ipv4 khi mode=dhcp";
    EXPECT_FALSE(encoded.contains("netmask")) << "schema cấm netmask khi mode=dhcp";
    EXPECT_FALSE(encoded.contains("gateway")) << "schema cấm gateway khi mode=dhcp";
}

TEST(NetcfgSerialization, StaticCandidateKeepsAddressesAndDropsEmptyGateway)
{
    netcfg::Candidate stat;
    stat.interface = "end1";
    stat.mode = "static";
    stat.ipv4 = "192.168.50.61";
    stat.netmask = "255.255.255.0";
    /* gateway để trống: profile hợp lệ, nhưng không được phát "" ra ngoài. */

    const nlohmann::json encoded = stat;

    EXPECT_EQ(encoded.value("ipv4", ""), "192.168.50.61");
    EXPECT_EQ(encoded.value("netmask", ""), "255.255.255.0");
    EXPECT_FALSE(encoded.contains("gateway")) << "gateway rỗng phải được bỏ hẳn";

    /* Vòng round-trip phải giữ nguyên ngữ nghĩa. */
    const auto decoded = encoded.get<netcfg::Candidate>();
    EXPECT_EQ(decoded.ipv4, "192.168.50.61");
    EXPECT_TRUE(decoded.gateway.empty());
}

/* Hồi quy từ board thật 2026-07-31.
 *
 * NetworkManager cho phép NHIỀU profile trùng tên, và trên Orange Pi đã có hai
 * profile cùng tên "end1". Khi netcfg truyền TÊN vào `nmcli connection show`,
 * nmcli khớp cả hai và in một khối cho mỗi profile, nên `-g ipv4.method` trả về
 * "manual\n\nmanual". Code cũ so sánh nguyên chuỗi đó với "manual" nên luôn sai:
 * mode rơi về "unknown", configured thành null, và MỌI lần stage sau đó bị từ
 * chối bằng PREVIOUS_STATE_NOT_RESTORABLE — thiết bị không còn đổi được mạng qua
 * giao diện cho tới khi có người vào SSH dọn profile trùng. */
TEST(NetcfgLinuxPlatform, DuplicateProfileNamesDoNotBreakConfiguredReadback)
{
    FakeStatusLinuxPlatform platform;
    platform.profile_uuid = "profile-uuid";
    platform.profile_interface = "end1";
    /* nmcli khớp 2 profile trùng tên → mỗi thuộc tính in thành nhiều khối. */
    platform.profile_method = "manual\n\nmanual";
    platform.profile_addresses = "192.168.50.61/24\n\n192.168.50.61/24";
    platform.profile_gateway = "\n\n";

    const auto configured = platform.configured("end1");

    EXPECT_EQ(configured.mode, "static") << "output nhiều khối phải đọc theo dòng đầu";
    EXPECT_EQ(configured.ipv4, "192.168.50.61");
    EXPECT_EQ(configured.netmask, "255.255.255.0");

    std::string reason;
    EXPECT_TRUE(netcfg::validate_candidate(configured, &reason))
        << "profile đọc lại phải hợp lệ, nếu không stage bị chặn vĩnh viễn: " << reason;
}

/* Định danh profile phải là UUID: tên profile không đảm bảo duy nhất. */
TEST(NetcfgLinuxPlatform, ActiveProfileIsResolvedByUuidNotByName)
{
    FakeStatusLinuxPlatform platform;
    platform.snapshot = {true, true, true, "192.168.50.61", 24};
    platform.active_connection = "4ece069b-4afb-4aed-b1cb-f06ca0fd48b2";
    platform.profile_method = "manual";

    std::string reason;
    const auto active = platform.status("end1", &reason);

    EXPECT_EQ(active.mode, "static");
    bool asked_for_uuid = false;
    for (const auto& command : platform.commands)
        for (const auto& arg : command)
            if (arg == "GENERAL.CON-UUID") asked_for_uuid = true;
    EXPECT_TRUE(asked_for_uuid) << "phải tra cứu profile theo UUID duy nhất";
}

TEST(NetcfgLinuxPlatform, StageRejectsUnrepresentableStaticHybridDnsProfile)
{
    auto platform = std::make_shared<FakeStatusLinuxPlatform>();
    platform->snapshot = {true, true, true, "192.168.1.50", 24};
    platform->active_connection = "wired-end1";
    platform->profile_method = "manual";
    platform->profile_addresses = "192.168.1.50/24";
    platform->profile_gateway = "192.168.1.1";
    platform->profile_dns = "1.1.1.1";
    platform->profile_ignore_auto_dns = "no";
    netcfg::Engine engine(platform, journal_path(), "end1");
    auto stage = request("stage-static-hybrid-dns", "stage");
    stage["candidate"] = {
        {"interface", "end1"}, {"mode", "static"}, {"ipv4", "192.168.1.80"},
        {"netmask", "255.255.255.0"}, {"gateway", "192.168.1.1"}};

    const auto response = engine.handle(stage);

    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("reasonCode"), "PREVIOUS_STATE_NOT_RESTORABLE");
    EXPECT_EQ(engine.transaction().state, "idle");
}

TEST(NetcfgLinuxPlatform, ReportsConfiguredAndRuntimeDnsSeparately)
{
    FakeStatusLinuxPlatform platform;
    platform.active_connection = "wired-end1";
    platform.profile_method = "auto";
    platform.profile_ignore_auto_dns = "yes";
    platform.profile_dns = "1.1.1.1\n8.8.8.8";
    platform.runtime_dns = "1.1.1.1,8.8.8.8\n1.1.1.1";
    platform.snapshot = {true, true, true, "192.168.1.50", 24};
    std::string reason;

    const auto configured = platform.configured("end1");
    const auto active = platform.status("end1", &reason);

    ASSERT_TRUE(configured.dns.has_value());
    EXPECT_EQ(configured.dns->mode, "manual");
    EXPECT_EQ(configured.dns->servers,
              (std::vector<std::string>{"1.1.1.1", "8.8.8.8"}));
    EXPECT_EQ(active.dns_servers,
              (std::vector<std::string>{"1.1.1.1", "8.8.8.8"}));
}

TEST(NetcfgLinuxPlatform, PersistsManualDnsWithNetworkManagerFlags)
{
    FakeStatusLinuxPlatform platform;
    platform.active_connection = "wired-end1";
    const netcfg::Candidate candidate_value{
        "end1", "dhcp", {}, {}, {},
        netcfg::DnsConfig{"manual", {"1.1.1.1", "8.8.8.8"}}};
    std::string reason;

    ASSERT_TRUE(platform.persist_candidate(candidate_value, &reason));
    ASSERT_GE(platform.commands.size(), 2u);
    EXPECT_EQ(platform.commands.back(), (std::vector<std::string>{
        "/usr/bin/nmcli", "connection", "modify", "wired-end1",
        "ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", "",
        "ipv4.ignore-auto-dns", "yes", "ipv4.dns", "1.1.1.1,8.8.8.8"}));
}

TEST(NetcfgLinuxPlatform, PersistsAutomaticDnsByClearingManualOverrides)
{
    FakeStatusLinuxPlatform platform;
    platform.active_connection = "wired-end1";
    const netcfg::Candidate candidate_value{
        "end1", "dhcp", {}, {}, {}, netcfg::DnsConfig{"auto", {}}};
    std::string reason;

    ASSERT_TRUE(platform.persist_candidate(candidate_value, &reason));
    EXPECT_EQ(platform.commands.back(), (std::vector<std::string>{
        "/usr/bin/nmcli", "connection", "modify", "wired-end1",
        "ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", "",
        "ipv4.ignore-auto-dns", "no", "ipv4.dns", ""}));
}

TEST(NetcfgLinuxPlatform, MissingDnsLeavesNetworkManagerDnsPropertiesUntouched)
{
    FakeStatusLinuxPlatform platform;
    platform.active_connection = "wired-end1";
    const netcfg::Candidate candidate_value{"end1", "dhcp", {}, {}, {}};
    std::string reason;

    ASSERT_TRUE(platform.persist_candidate(candidate_value, &reason));
    EXPECT_EQ(platform.commands.back(), (std::vector<std::string>{
        "/usr/bin/nmcli", "connection", "modify", "wired-end1",
        "ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", ""}));
}

TEST(NetcfgLinuxPlatform, ReportsManagementHostnameWithoutMutatingIt)
{
    FakeStatusLinuxPlatform platform;
    platform.hostname = "mkddc-zone-3";

    const auto management = platform.management();

    EXPECT_EQ(management.hostname, "mkddc-zone-3");
    EXPECT_EQ(management.mdns_name, "mkddc-zone-3.local");
    EXPECT_TRUE(management.stable);
    EXPECT_TRUE(platform.commands.empty());
}

TEST(NetcfgEngine, RejectsUnknownRequestCandidateAndDnsFields)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");

    auto top_level = request("unknown-top", "status");
    top_level["unexpected"] = true;
    EXPECT_EQ(engine.handle(top_level).at("reasonCode"), "INVALID_REQUEST");

    auto candidate_field = request("unknown-candidate", "validate");
    candidate_field["candidate"] = candidate();
    candidate_field["candidate"]["unexpected"] = true;
    EXPECT_EQ(engine.handle(candidate_field).at("reasonCode"), "INVALID_REQUEST");

    auto dns_field = request("unknown-dns", "validate");
    dns_field["candidate"] = candidate();
    dns_field["candidate"]["dns"] = {
        {"mode", "manual"}, {"servers", {"1.1.1.1"}}, {"unexpected", true}};
    EXPECT_EQ(engine.handle(dns_field).at("reasonCode"), "INVALID_REQUEST");
}

TEST(NetcfgEngine, StageJournalsConfiguredDnsSnapshot)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->configured_state.dns =
        netcfg::DnsConfig{"manual", {"192.168.1.1", "1.1.1.1"}};
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-dns-snapshot", "stage");
    stage["candidate"] = candidate();
    stage["candidate"]["dns"] = {
        {"mode", "manual"}, {"servers", {"8.8.8.8"}}};

    const auto staged = engine.handle(stage);
    ASSERT_EQ(staged.at("result"), "accepted");
    EXPECT_EQ(staged.at("pending").at("dns").at("servers"),
              nlohmann::json::array({"8.8.8.8"}));
    const auto transaction = engine.transaction();
    ASSERT_TRUE(transaction.previous_configured.has_value());
    ASSERT_TRUE(transaction.previous_configured->dns.has_value());
    EXPECT_TRUE(transaction.previous_configured_complete);
    EXPECT_EQ(transaction.previous_configured->dns->servers,
              (std::vector<std::string>{"192.168.1.1", "1.1.1.1"}));
}

TEST(NetcfgEngine, LegacyJournalFallbackPreservesUnknownDnsDuringRollback)
{
    auto platform = std::make_shared<FakePlatform>();
    const std::string path = journal_path();
    const nlohmann::json legacy_journal{
        {"schemaVersion", 1},
        {"id", "legacy-tx"},
        {"state", "staged"},
        {"candidate", candidate()},
        {"previous", {
            {"interface", "eth0"}, {"link", "up"}, {"mode", "static"},
            {"ipv4", "192.168.1.50"}, {"prefixLength", 24},
            {"gateway", "192.168.1.1"}}},
        {"rollbackDeadlineEpochMs", 0},
        {"lastReason", "OK"}};
    {
        std::ofstream output(path);
        output << legacy_journal.dump(2) << '\n';
    }
    netcfg::Engine engine(platform, path, "eth0");
    auto rollback = request("legacy-rollback", "rollback");
    rollback["transactionId"] = "legacy-tx";

    ASSERT_EQ(engine.handle(rollback).at("result"), "accepted");
    EXPECT_FALSE(platform->rollback_previous_complete);
    EXPECT_FALSE(platform->rollback_previous_configured.dns.has_value());
    EXPECT_EQ(platform->rollback_previous_configured.ipv4, "192.168.1.50");
}

TEST(NetcfgEngine, StaticStageApplyConfirmIsDurableAndIdempotent)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    int64_t now = 100000;
    engine.set_epoch_now_for_test([&] { return now; });

    auto stage = request("stage-1", "stage");
    stage["candidate"] = candidate();
    const auto staged = engine.handle(stage);
    ASSERT_EQ(staged.at("result"), "accepted");
    ASSERT_EQ(staged.at("state"), "staged");
    const std::string transaction = staged.at("transactionId");

    auto apply = request("apply-1", "apply");
    apply["transactionId"] = transaction;
    const auto applied = engine.handle(apply);
    EXPECT_EQ(applied.at("state"), "awaiting_confirmation");
    EXPECT_EQ(applied.at("rollbackRemainingS"), 120);
    EXPECT_EQ(platform->apply_calls, 1);
    EXPECT_EQ(engine.handle(apply), applied);
    EXPECT_EQ(platform->apply_calls, 1);

    auto confirm = request("confirm-1", "confirm");
    confirm["transactionId"] = transaction;
    EXPECT_EQ(engine.handle(confirm).at("state"), "confirmed");
    EXPECT_EQ(platform->confirm_calls, 1);
}

TEST(NetcfgEngine, RequestIdConflictCannotRepeatMutation)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto first = request("same", "stage");
    first["candidate"] = candidate();
    ASSERT_EQ(engine.handle(first).at("result"), "accepted");
    auto conflict = first;
    conflict["candidate"]["ipv4"] = "192.168.1.81";
    EXPECT_EQ(engine.handle(conflict).at("reasonCode"), "REQUEST_ID_CONFLICT");
}

TEST(NetcfgEngine, DeadlineAutomaticallyRollsBack)
{
    auto platform = std::make_shared<FakePlatform>();
    const std::string path = journal_path();
    netcfg::Engine engine(platform, path, "eth0");
    int64_t now = 5000;
    engine.set_epoch_now_for_test([&] { return now; });
    auto stage = request("stage-timeout", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-timeout", "apply");
    apply["transactionId"] = transaction;
    ASSERT_EQ(engine.handle(apply).at("state"), "awaiting_confirmation");
    now += 120000;
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "rolled_back");
    EXPECT_EQ(engine.transaction().last_reason, "CONFIRM_TIMEOUT");
    EXPECT_EQ(platform->rollback_calls, 1);
    EXPECT_EQ(platform->active.ipv4, "192.168.1.50");

    netcfg::Engine recovered(platform, path, "eth0");
    EXPECT_EQ(recovered.transaction().state, "rolled_back");
}

TEST(NetcfgEngine, FailedApplyRollsBackAndReportsFailureCause)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->apply_ok = false;
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-fail", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-fail", "apply");
    apply["transactionId"] = transaction;
    const auto response = engine.handle(apply);
    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("state"), "rolled_back");
    EXPECT_EQ(platform->rollback_calls, 1);
}

TEST(NetcfgEngine, FailedRollbackNeverReportsRolledBack)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->apply_ok = false;
    platform->rollback_ok = false;
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-rollback-fail", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-rollback-fail", "apply");
    apply["transactionId"] = transaction;

    const auto response = engine.handle(apply);

    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("state"), "failed");
    EXPECT_EQ(engine.transaction().last_reason, "ROLLBACK_FAILED");
}

TEST(NetcfgEngine, StageRejectsAnUnrestorablePreviousState)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->active.mode = "unknown";
    platform->configured_state.mode = "unknown";
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-no-rollback", "stage");
    stage["candidate"] = candidate();

    const auto response = engine.handle(stage);

    EXPECT_EQ(response.at("result"), "rejected");
    EXPECT_EQ(response.at("reasonCode"), "PREVIOUS_STATE_NOT_RESTORABLE");
    EXPECT_EQ(engine.transaction().state, "idle");
}

TEST(NetcfgEngine, DhcpWaitsForARealLeaseBeforeConfirmation)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    int64_t now = 1000;
    engine.set_epoch_now_for_test([&] { return now; });
    auto stage = request("stage-dhcp", "stage");
    stage["candidate"] = {{"interface", "eth0"}, {"mode", "dhcp"}};
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-dhcp", "apply");
    apply["transactionId"] = transaction;
    EXPECT_EQ(engine.handle(apply).at("state"), "applying");
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "applying");
    platform->active.ipv4 = "192.168.1.99";
    platform->active.mode = "dhcp";
    platform->configured_state = {"eth0", "dhcp", {}, {}, {}};
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "awaiting_confirmation");
}

TEST(NetcfgEngine, DhcpSameLeaseDnsChangeCanAwaitConfirmation)
{
    auto platform = std::make_shared<FakePlatform>();
    platform->active.mode = "dhcp";
    platform->active.dns_servers = {"192.168.1.1"};
    platform->configured_state = {
        "eth0", "dhcp", {}, {}, {},
        netcfg::DnsConfig{"manual", {"192.168.1.1"}}};
    const std::string previous_ipv4 = platform->active.ipv4;
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-dhcp-dns", "stage");
    stage["candidate"] = {
        {"interface", "eth0"}, {"mode", "dhcp"},
        {"dns", {{"mode", "manual"}, {"servers", {"1.1.1.1", "8.8.8.8"}}}}};
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-dhcp-dns", "apply");
    apply["transactionId"] = transaction;

    ASSERT_EQ(engine.handle(apply).at("state"), "applying");
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "applying");

    platform->configured_state.dns =
        netcfg::DnsConfig{"manual", {"1.1.1.1", "8.8.8.8"}};
    platform->active.dns_servers = {"1.1.1.1", "8.8.8.8"};
    engine.tick();

    EXPECT_EQ(platform->active.ipv4, previous_ipv4);
    EXPECT_EQ(engine.transaction().state, "awaiting_confirmation");
}

TEST(NetcfgEngine, RefusesToReplaceAnUnfinishedTransaction)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto first = request("stage-first", "stage");
    first["candidate"] = candidate();
    ASSERT_EQ(engine.handle(first).at("result"), "accepted");
    auto second = request("stage-second", "stage");
    second["candidate"] = candidate();
    second["candidate"]["ipv4"] = "192.168.1.81";
    const auto rejected = engine.handle(second);
    EXPECT_EQ(rejected.at("reasonCode"), "TRANSACTION_IN_PROGRESS");
    EXPECT_EQ(engine.transaction().candidate.ipv4, "192.168.1.80");
}

TEST(NetcfgEngine, ConfirmedStateDoesNotReportCandidateAsPending)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-confirmed", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-confirmed", "apply");
    apply["transactionId"] = transaction;
    ASSERT_EQ(engine.handle(apply).at("result"), "accepted");
    auto confirm = request("confirm-confirmed", "confirm");
    confirm["transactionId"] = transaction;
    const auto confirmed = engine.handle(confirm);
    ASSERT_EQ(confirmed.at("result"), "accepted");
    EXPECT_FALSE(confirmed.contains("pending"));
}

TEST(NetcfgEngine, ConfiguredInterfaceIsAnEnforcedAllowlist)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    auto stage = request("stage-wifi", "stage");
    stage["candidate"] = candidate();
    stage["candidate"]["interface"] = "wlan0";
    EXPECT_EQ(engine.handle(stage).at("reasonCode"), "INTERFACE_NOT_ALLOWED");
}

TEST(NetcfgEngine, MonotonicDeadlineRollsBackEvenIfWallClockMovesBackward)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    int64_t epoch = 100000;
    int64_t steady = 5000;
    engine.set_epoch_now_for_test([&] { return epoch; });
    engine.set_steady_now_for_test([&] { return steady; });
    auto stage = request("stage-clock", "stage");
    stage["candidate"] = candidate();
    const std::string transaction = engine.handle(stage).at("transactionId");
    auto apply = request("apply-clock", "apply");
    apply["transactionId"] = transaction;
    ASSERT_EQ(engine.handle(apply).at("state"), "awaiting_confirmation");
    epoch -= 60000;
    steady += 120000;
    engine.tick();
    EXPECT_EQ(engine.transaction().state, "rolled_back");
    EXPECT_EQ(engine.transaction().last_reason, "CONFIRM_TIMEOUT");
}

TEST(NetcfgLinuxPlatform, DhcpRollbackReappliesStaticProfileAndRemovesNewLease)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = {"eth0", "up", "dhcp", "192.168.1.99", 24, "192.168.1.1"};
    platform.restored_after_reapply = previous;
    platform.addresses = {previous.ipv4, platform.current.ipv4};
    const netcfg::Candidate dhcp{"eth0", "dhcp", {}, {}, {}};
    const netcfg::Candidate previous_profile{"eth0", "static", "192.168.1.50",
                                              "255.255.255.0", "192.168.1.1"};
    std::string reason;

    EXPECT_TRUE(platform.rollback(dhcp, previous, previous_profile, true, &reason));
    EXPECT_EQ(platform.persisted.interface, previous.interface);
    EXPECT_EQ(platform.persisted.mode, "static");
    EXPECT_EQ(platform.persisted.ipv4, previous.ipv4);
    EXPECT_EQ(platform.persisted.netmask, "255.255.255.0");
    EXPECT_EQ(platform.persisted.gateway, previous.gateway);
    EXPECT_EQ(platform.addresses.count("192.168.1.99"), 0u);
    ASSERT_EQ(platform.commands.size(), 2u);
    EXPECT_EQ(platform.commands[0], (std::vector<std::string>{
        "/usr/bin/nmcli", "device", "reapply", "eth0"}));
    EXPECT_EQ(platform.commands[1], (std::vector<std::string>{
        "/usr/sbin/ip", "address", "del", "192.168.1.99/24", "dev", "eth0"}));
}

TEST(NetcfgLinuxPlatform, RollbackRestoresAndVerifiesConfiguredDnsSnapshot)
{
    FakeLinuxPlatform platform;
    netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                 "192.168.1.1"};
    previous.dns_servers = {"192.168.1.1", "1.1.1.1"};
    platform.current = {"eth0", "up", "static", "192.168.1.80", 24,
                        "192.168.1.1"};
    platform.current.dns_servers = {"8.8.8.8"};
    platform.restored_after_reapply = previous;
    platform.addresses = {previous.ipv4, platform.current.ipv4};
    const netcfg::Candidate candidate_value{
        "eth0", "static", "192.168.1.80", "255.255.255.0", "192.168.1.1",
        netcfg::DnsConfig{"manual", {"8.8.8.8"}}};
    const netcfg::Candidate previous_profile{
        "eth0", "static", "192.168.1.50", "255.255.255.0", "192.168.1.1",
        netcfg::DnsConfig{"manual", {"192.168.1.1", "1.1.1.1"}}};
    std::string reason;

    ASSERT_TRUE(platform.rollback(candidate_value, previous, previous_profile, true, &reason));
    ASSERT_TRUE(platform.persisted.dns.has_value());
    EXPECT_EQ(platform.persisted.dns->servers,
              (std::vector<std::string>{"192.168.1.1", "1.1.1.1"}));
    EXPECT_FALSE(platform.preserve_missing_dns);
}

TEST(NetcfgLinuxPlatform, RollbackRejectsUnrepresentableConfiguredSnapshotBeforePersist)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{
        "eth0", "up", "static", "192.168.1.50", 24, "192.168.1.1"};
    const netcfg::Candidate candidate_value{
        "eth0", "static", "192.168.1.80", "255.255.255.0", "192.168.1.1"};
    const netcfg::Candidate unrepresentable_snapshot{
        "eth0", "unknown", {}, {}, {}};
    std::string reason;

    EXPECT_FALSE(platform.rollback(candidate_value, previous, unrepresentable_snapshot,
                                   true, &reason));
    EXPECT_EQ(reason, "PREVIOUS_STATE_NOT_RESTORABLE");
    EXPECT_TRUE(platform.persisted.interface.empty());
    EXPECT_TRUE(platform.commands.empty());
}

TEST(NetcfgLinuxPlatform, RollbackFailsClosedWhenReapplyFails)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = {"eth0", "up", "dhcp", "192.168.1.99", 24, "192.168.1.1"};
    platform.restored_after_reapply = previous;
    platform.reapply_ok = false;
    const netcfg::Candidate dhcp{"eth0", "dhcp", {}, {}, {}};
    const netcfg::Candidate previous_profile{"eth0", "static", "192.168.1.50",
                                              "255.255.255.0", "192.168.1.1"};
    std::string reason;

    EXPECT_FALSE(platform.rollback(dhcp, previous, previous_profile, true, &reason));
    EXPECT_EQ(reason, "ROLLBACK_REAPPLY_FAILED");
}

TEST(NetcfgLinuxPlatform, RollbackFailsClosedWhenAddressRemovalFails)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = {"eth0", "up", "dhcp", "192.168.1.99", 24, "192.168.1.1"};
    platform.restored_after_reapply = previous;
    platform.addresses = {previous.ipv4, platform.current.ipv4};
    platform.address_remove_ok = false;
    const netcfg::Candidate dhcp{"eth0", "dhcp", {}, {}, {}};
    const netcfg::Candidate previous_profile{"eth0", "static", "192.168.1.50",
                                              "255.255.255.0", "192.168.1.1"};
    std::string reason;

    EXPECT_FALSE(platform.rollback(dhcp, previous, previous_profile, true, &reason));
    EXPECT_EQ(reason, "ROLLBACK_ADDRESS_REMOVE_FAILED");
}

TEST(NetcfgLinuxPlatform, RollbackAcceptsRestoredDhcpProfileWhenPreviousLinkWasOffline)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{
        "end1", "down", "unknown", {}, 0, {}, true, false, "NO_CARRIER"};
    platform.current = {
        "end1", "down", "static", "192.168.50.20", 24, "192.168.50.1",
        true, false, "NO_CARRIER"};
    platform.restored_after_reapply = previous;
    platform.addresses = {platform.current.ipv4};
    const netcfg::Candidate candidate_value{
        "end1", "static", "192.168.50.20", "255.255.255.0", "192.168.50.1"};
    const netcfg::Candidate previous_profile{
        "end1", "dhcp", {}, {}, {}, netcfg::DnsConfig{"auto", {}}};
    platform.configured_state = previous_profile;
    std::string reason;

    EXPECT_TRUE(platform.rollback(candidate_value, previous, previous_profile, true, &reason));
    EXPECT_EQ(platform.persisted.mode, "dhcp");
    ASSERT_TRUE(platform.persisted.dns.has_value());
    EXPECT_EQ(platform.persisted.dns->mode, "auto");
    EXPECT_EQ(platform.addresses.count("192.168.50.20"), 0u);
    ASSERT_EQ(platform.commands.size(), 2u);
    EXPECT_EQ(platform.commands[0], (std::vector<std::string>{
        "/usr/bin/nmcli", "device", "reapply", "end1"}));
    EXPECT_EQ(platform.commands[1], (std::vector<std::string>{
        "/usr/sbin/ip", "address", "del", "192.168.50.20/24", "dev", "end1"}));
}

TEST(NetcfgLinuxPlatform, RollbackFailsClosedWhenKernelStateDoesNotMatch)
{
    FakeLinuxPlatform platform;
    const netcfg::ActiveState previous{"eth0", "up", "static", "192.168.1.50", 24,
                                       "192.168.1.1"};
    platform.current = previous;
    platform.restored_after_reapply = previous;
    platform.restored_after_reapply.gateway = "192.168.1.254";
    const netcfg::Candidate candidate_value{"eth0", "static", "192.168.1.80",
                                             "255.255.255.0", "192.168.1.1"};
    const netcfg::Candidate previous_profile{"eth0", "static", "192.168.1.50",
                                              "255.255.255.0", "192.168.1.1"};
    std::string reason;

    EXPECT_FALSE(platform.rollback(candidate_value, previous, previous_profile, true, &reason));
    EXPECT_EQ(reason, "ROLLBACK_VERIFY_FAILED");
}

TEST(NetcfgServer, RejectsOverlongSocketPathBeforeCreatingEndpoint)
{
    auto platform = std::make_shared<FakePlatform>();
    netcfg::Engine engine(platform, journal_path(), "eth0");
    const auto socket_path = std::filesystem::temp_directory_path() /
        std::string(128, 's');
    netcfg::Server server(engine, socket_path.string(), "root");

    EXPECT_FALSE(server.run());
    EXPECT_FALSE(std::filesystem::exists(socket_path));
}

/* ---- F-22: output bị cắt KHÔNG được biến thành "lệnh thất bại" ----
 *
 * Vòng đọc cũ dừng ngay khi result.size() >= 4096 rồi close(pipes[0]). Child
 * đang ghi tiếp nhận SIGPIPE → WIFEXITED(status) false → run() trả FALSE cho một
 * lệnh thực chất đã chạy đúng (exit 0). Trong service có cơ chế rollback
 * fail-closed thì đây là tín hiệu "apply thất bại" giả.
 *
 * Script sinh ~200 KB để vượt hẳn dung lượng pipe (64 KB mặc định trên Linux):
 * nếu output nhỏ hơn dung lượng pipe thì child ghi xong và exit trước khi parent
 * đóng, SIGPIPE không xảy ra và test sẽ không phân biệt được hai hành vi. */
class ExposedRunLinuxPlatform final : public netcfg::LinuxPlatform {
public:
    using netcfg::LinuxPlatform::run;
};

TEST(NetcfgLinuxPlatform, TruncatedCommandOutputStillReportsSuccess)
{
    const auto script = std::filesystem::temp_directory_path() /
        ("mkddc_netcfg_bigout_" + std::to_string(::getpid()) + ".sh");
    {
        std::ofstream f(script);
        f << "#!/bin/sh\n"
             "line=$(printf 'a%.0s' $(seq 1 500))\n"
             "i=0\n"
             "while [ \"$i\" -lt 400 ]; do\n"
             "  printf '%s\\n' \"$line\"\n"
             "  i=$((i+1))\n"
             "done\n"
             "exit 0\n";
    }
    std::filesystem::permissions(script, std::filesystem::perms::owner_all);

    ExposedRunLinuxPlatform platform;
    std::string output;
    const bool ok = platform.run({script.string()}, &output);
    std::filesystem::remove(script);

    EXPECT_TRUE(ok) << "lệnh exit 0 nhưng run() báo thất bại (child bị SIGPIPE)";
    EXPECT_LE(output.size(), 4096u) << "phần vượt giới hạn phải bị bỏ";
    EXPECT_GT(output.size(), 4000u) << "phải giữ được phần đầu của output";
}

} // namespace
