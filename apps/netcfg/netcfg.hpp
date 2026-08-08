#ifndef MKDDC_NETCFG_HPP
#define MKDDC_NETCFG_HPP

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace netcfg {

constexpr int kProtocolVersion = 1;
constexpr size_t kMaxFrameBytes = 8192;
constexpr uint32_t kRollbackMaxSeconds = 120;

struct DnsConfig {
    std::string mode;
    std::vector<std::string> servers;
};

struct Candidate {
    std::string interface;
    std::string mode;
    std::string ipv4;
    std::string netmask;
    std::string gateway;
    std::optional<DnsConfig> dns;

    Candidate() = default;
    Candidate(std::string interface_value, std::string mode_value,
              std::string ipv4_value, std::string netmask_value,
              std::string gateway_value, std::optional<DnsConfig> dns_value = std::nullopt)
        : interface(std::move(interface_value)), mode(std::move(mode_value)),
          ipv4(std::move(ipv4_value)), netmask(std::move(netmask_value)),
          gateway(std::move(gateway_value)), dns(std::move(dns_value)) {}
};

struct InterfaceSnapshot {
    bool present = false;
    bool admin_up = false;
    bool carrier = false;
    std::string ipv4;
    int prefix_length = 0;
};

struct ActiveState {
    std::string interface;
    std::string link = "unknown";
    std::string mode = "unknown";
    std::string ipv4;
    int prefix_length = 0;
    std::string gateway;
    bool admin_up = false;
    bool carrier = false;
    std::string reason_code = "OK";
    std::vector<std::string> dns_servers;

    ActiveState() = default;
    ActiveState(std::string interface_value, std::string link_value,
                std::string mode_value, std::string ipv4_value,
                int prefix_length_value, std::string gateway_value,
                bool admin_up_value = false, bool carrier_value = false,
                std::string reason_code_value = "OK",
                std::vector<std::string> dns_servers_value = {})
        : interface(std::move(interface_value)), link(std::move(link_value)),
          mode(std::move(mode_value)), ipv4(std::move(ipv4_value)),
          prefix_length(prefix_length_value), gateway(std::move(gateway_value)),
          admin_up(admin_up_value), carrier(carrier_value),
          reason_code(std::move(reason_code_value)),
          dns_servers(std::move(dns_servers_value)) {}
};

struct ManagementState {
    std::string hostname;
    std::string mdns_name;
    bool stable = false;
};

struct Transaction {
    std::string id;
    std::string state = "idle";
    Candidate candidate;
    ActiveState previous;
    std::optional<Candidate> previous_configured;
    bool previous_configured_complete = false;
    int64_t rollback_deadline_epoch_ms = 0;
    std::string last_reason = "OK";
};

void to_json(nlohmann::json& j, const DnsConfig& value);
void from_json(const nlohmann::json& j, DnsConfig& value);
void to_json(nlohmann::json& j, const Candidate& value);
void from_json(const nlohmann::json& j, Candidate& value);
void to_json(nlohmann::json& j, const ActiveState& value);
void from_json(const nlohmann::json& j, ActiveState& value);
void to_json(nlohmann::json& j, const ManagementState& value);
void to_json(nlohmann::json& j, const Transaction& value);
void from_json(const nlohmann::json& j, Transaction& value);

bool validate_candidate(const Candidate& value, std::string* reason);
int netmask_to_prefix(const std::string& netmask);

/** Backend cấu hình mạng bền vững mà bo đang thực sự dùng.
 *
 * Bản đầu chỉ biết NetworkManager. Bo Foxlinx OK1126B (buildroot) KHÔNG có
 * NetworkManager mà chạy systemd-networkd, nên `configured()` luôn trả
 * mode="unknown" → response bỏ hẳn khoá `configured` → giao diện mạng rơi vào
 * ngõ cụt "no editable candidate" và mọi `stage` chết ở NETWORKMANAGER_UNAVAILABLE.
 */
enum class ConfigBackend { None, NetworkManager, Networkd };

/** Tên các interface Ethernet CÓ DÂY đang hiện diện trong kernel.
 *
 * Loại `lo`, mọi interface không phải ARPHRD_ETHER, mọi interface không có
 * thiết bị vật lý (bridge/tun/veth/dummy) và mọi interface không dây
 * (`phy80211`/`wireless`) — Wi-Fi nằm ngoài phạm vi giao dịch theo ADR-017 §1.
 * Kết quả sắp xếp theo tên để việc chọn là tất định.
 */
std::vector<std::string> list_wired_interfaces();

/** Chốt tên interface dùng cho toàn bộ vòng đời tiến trình.
 *
 * `requested` rỗng ⇒ giữ rỗng (Engine sẽ suy ra theo default route như cũ).
 * `requested` có mặt trong `wired` ⇒ giữ nguyên, cấu hình luôn thắng.
 * `requested` KHÔNG có mặt ⇒ lấy interface có dây đầu tiên đang hiện diện.
 */
std::string resolve_ethernet_interface(const std::string& requested,
                                       const std::vector<std::string>& wired);

class Platform {
public:
    virtual ~Platform() = default;
    virtual ActiveState status(const std::string& interface, std::string* reason) = 0;
    virtual Candidate configured(const std::string& interface) = 0;
    virtual ManagementState management() = 0;
    virtual bool preflight(const Candidate& candidate, std::string* reason) = 0;
    virtual bool apply(const Candidate& candidate, const ActiveState& previous,
                       std::string* reason) = 0;
    virtual bool confirm(const Candidate& candidate, const ActiveState& previous,
                         std::string* reason) = 0;
    virtual bool rollback(const Candidate& candidate, const ActiveState& previous,
                          const Candidate& previous_configured,
                          bool previous_configured_complete,
                          std::string* reason) = 0;
};

class LinuxPlatform : public Platform {
public:
    ActiveState status(const std::string& interface, std::string* reason) override;
    Candidate configured(const std::string& interface) override;
    ManagementState management() override;
    bool preflight(const Candidate& candidate, std::string* reason) override;
    bool apply(const Candidate& candidate, const ActiveState& previous,
               std::string* reason) override;
    bool confirm(const Candidate& candidate, const ActiveState& previous,
                 std::string* reason) override;
    bool rollback(const Candidate& candidate, const ActiveState& previous,
                  const Candidate& previous_configured,
                  bool previous_configured_complete,
                  std::string* reason) override;

protected:
    virtual bool run(const std::vector<std::string>& args, std::string* output);
    virtual std::string binary(const std::vector<std::string>& choices);
    virtual std::string connection_name(const std::string& interface);
    virtual std::string configured_connection_name(const std::string& interface);
    virtual bool persist(const Candidate& candidate, std::string* reason,
                         bool preserve_missing_dns = true);
    virtual bool read_interface_state(const std::string& interface,
                                      InterfaceSnapshot* state) const;
    virtual std::string management_hostname() const;
    virtual bool interface_has_address(const std::string& interface,
                                       const std::string& ipv4, bool* present) const;
    virtual void rollback_retry_delay() const;

    /* --- Chọn và triển khai backend cấu hình bền vững --- */
    virtual ConfigBackend config_backend();
    /** Đường dẫn file `.network` mà systemd-networkd ĐANG dùng cho interface. */
    virtual std::string networkd_network_file(const std::string& interface);
    /** Đọc/ghi file `.network`; tách riêng để test bơm nội dung được. */
    virtual bool read_text_file(const std::string& path, std::string* content) const;
    virtual bool write_text_file(const std::string& path, const std::string& content) const;
    virtual bool networkd_reload(const std::string& interface, std::string* reason);

    Candidate networkd_configured(const std::string& interface);
    bool networkd_persist(const Candidate& candidate, std::string* reason,
                          bool preserve_missing_dns);
    std::string networkd_managed_file(const std::string& interface) const;
    std::vector<std::string> networkd_active_dns(const std::string& interface);
};

class Engine {
public:
    Engine(std::shared_ptr<Platform> platform, std::string journal_path,
           std::string default_interface = {});

    nlohmann::json handle(const nlohmann::json& request);
    void tick();
    Transaction transaction() const;

    void set_epoch_now_for_test(std::function<int64_t()> fn);
    void set_steady_now_for_test(std::function<int64_t()> fn);

private:
    std::shared_ptr<Platform> platform_;
    std::string journal_path_;
    std::string default_interface_;
    Transaction transaction_;
    std::function<int64_t()> epoch_now_ms_;
    std::function<int64_t()> steady_now_ms_;
    int64_t rollback_deadline_steady_ms_ = 0;
    mutable std::mutex mutex_;
    std::map<std::string, std::pair<std::string, nlohmann::json>> cache_;
    std::vector<std::string> cache_order_;

    bool load_journal();
    bool save_journal(std::string* reason) const;
    nlohmann::json response(const std::string& request_id, const std::string& result,
                            const std::string& reason_code, const std::string& message = {});
    bool transaction_matches(const nlohmann::json& request) const;
    static bool valid_request_id(const std::string& value);
    static std::string request_hash(const nlohmann::json& request);
    void remember(const std::string& request_id, const std::string& hash,
                  const nlohmann::json& response);
    void rollback_locked(const std::string& cause);
};

class Server {
public:
    Server(Engine& engine, std::string socket_path, std::string allowed_user);
    ~Server();
    bool run();
    void stop();

private:
    Engine& engine_;
    std::string socket_path_;
    std::string allowed_user_;
    int listen_fd_ = -1;
    std::atomic<bool> stopping_{false};

    bool allowed_peer(int fd, uint32_t* uid) const;
    void handle_client(int fd);
};

} // namespace netcfg

#endif
