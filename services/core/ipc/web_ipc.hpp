/**
 * @file  web_ipc.hpp
 * @brief Contract 07 §8 — core là server Unix stream socket /run/mkddc/core.sock,
 *        web là client. 1 message = 1 dòng JSON. Đủ 3 result: accepted / rejected /
 *        overridden (nguồn cao hơn hoặc safe-state đang thắng — COR-007).
 *        Mỗi lệnh in 1 dòng AUDIT chuẩn {id,user,point,op,value,result,active_source}.
 */
#ifndef CORE_WEB_IPC_HPP
#define CORE_WEB_IPC_HPP

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <deque>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "alarm/alarm_runtime.hpp"
#include "graph/point_table.hpp"
#include "graph/runtime_point_snapshot.hpp"

namespace core {

enum class WebCommandKind {
    Point,
    AlarmList,
    AlarmAck,
    AlarmSuppress,
    AlarmReturn,
};

struct WebCommand {
    uint64_t    id = 0;
    WebCommandKind kind = WebCommandKind::Point;
    bool        is_write = false;   /* write | release */
    bool        is_query = false;   /* query không thay đổi priority array */
    PointId     point{PointKind::AV, -1};
    std::string point_name;         /* đã sanitize [A-Za-z0-9] ≤8 — cho audit log */
    std::string alarm_id;
    double      duration_s = 0.0;
    bool        permanent = true;
    float       value = 0.0f;
    uint32_t    ttl_s = 0;          /* 0=không TTL; HMI override có TTL hữu hạn */
    std::string user;               /* đã sanitize [A-Za-z0-9_.@:-] ≤48 — cho audit */
    int         prio = 2;           /* PRIO_LOCAL_MANUAL=2 / PRIO_BACNET=3 (07 §8, BAC-CONFLICT-001) */
    int         client_fd = -1;     /* để trả response đúng connection */
    uint64_t    client_id = 0;      /* stable identity; fd có thể được OS tái sử dụng */
};

enum class SnapshotCacheState : uint8_t { UNAVAILABLE, READY, TOO_LARGE, ERROR };

#ifdef CORE_BUILD_TESTS
struct WebIpcBudgetCounters {
    std::size_t accept_attempts = 0;
    std::size_t read_bytes = 0;
    std::size_t lines = 0;
    std::size_t snapshot_accepted = 0;
    std::size_t write_bytes = 0;
};

using WebIpcSendAdapter = ssize_t (*)(int, const void*, std::size_t, int, void*);
#endif

class WebIpc {
public:
    ~WebIpc();

    /* Bind + listen. Fail → WARN, degraded (commissioning qua web tắt). */
    bool open(const std::string& sock_path = "/run/mkddc/core.sock");
    void close();

    /* Scan step 4: accept client mới + đọc JSON lines + validate.
     * Lệnh hợp lệ → trả về queue (≤64/scan, quá → rejected "busy").
     * Lệnh sai → respond rejected ngay. */
    std::vector<WebCommand> drain();

    /* Trả response cho lệnh đã xử lý — gọi SAU resolve + safe-state (scan step 7):
     * applied_value/active_source là giá trị THẬT sau khi mọi nguồn tranh chấp xong. */
    void respond_accepted(const WebCommand& cmd, float applied_value,
                          const char* active_source = "manual",
                          uint32_t remaining_ttl_s = 0);
    void respond_overridden(const WebCommand& cmd, float applied_value,
                            const char* active_source, uint32_t remaining_ttl_s = 0);
    void respond_rejected(const WebCommand& cmd, const char* error);
    void respond_alarm_list(const WebCommand& cmd, const std::vector<AlarmState>& alarms);
    void respond_alarm_ack_accepted(const WebCommand& cmd);
    void respond_alarm_suppress_accepted(const WebCommand& cmd);
    void respond_alarm_return_accepted(const WebCommand& cmd);
    void publish_point_snapshot(const RuntimePointSnapshot& snapshot);

#ifdef CORE_BUILD_TESTS
    SnapshotCacheState snapshot_cache_state_for_test() const { return snapshot_state_; }
    const RuntimePointSnapshot& snapshot_for_test() const { return snapshot_; }
    std::string_view snapshot_payload_for_test() const
    {
        return {snapshot_payload_.data(), snapshot_payload_size_};
    }
    void set_snapshot_payload_for_test(std::string payload)
    {
        snapshot_payload_size_ = std::min(payload.size(), snapshot_payload_.size());
        std::memcpy(snapshot_payload_.data(), payload.data(), snapshot_payload_size_);
    }
    void set_snapshot_payload_limit_for_test(std::size_t limit) { snapshot_payload_limit_ = limit; }
    void set_snapshot_cache_state_for_test(SnapshotCacheState state) { snapshot_state_ = state; }
    uint64_t snapshot_publish_count_for_test() const { return snapshot_publish_count_; }
    uint64_t snapshot_serialization_count_for_test() const
    {
        return snapshot_serialization_count_;
    }
    void set_send_adapter_for_test(WebIpcSendAdapter adapter, void* context)
    {
        send_adapter_ = adapter;
        send_adapter_context_ = context;
    }
    WebIpcBudgetCounters budget_counters_for_test() const { return budget_counters_; }
    std::size_t outbound_budget_remaining_for_test() const { return outbound_budget_remaining_; }
    std::size_t client_count_for_test() const { return clients_.size(); }
    int first_client_fd_for_test() const { return clients_.empty() ? -1 : clients_.front().fd; }
    void set_first_client_output_for_test(std::string output)
    {
        if (!clients_.empty()) clients_.front().output = std::move(output);
    }
    std::size_t first_client_input_size_for_test() const
    {
        return clients_.empty() ? 0 : clients_.front().input.size();
    }
    void set_publish_observer_for_test(void (*observer)(void*), void* context)
    {
        publish_observer_ = observer;
        publish_observer_context_ = context;
    }
#endif

private:
    struct Client {
        int fd;
        uint64_t id;
        std::string input;
        std::string output;
        bool read_closed = false;
        bool close_after_flush = false;
        bool hard_close = false;
        std::size_t outstanding = 0;
        std::size_t write_budget_remaining = 0;
    };

    void respond(const WebCommand& command, const std::string& json_line);
    void respond_command(const WebCommand& command, const std::string& json_line);
    void handle_line(Client& client, const std::string& line, std::vector<WebCommand>* out);
    bool handle_snapshot_line(Client& client, const std::string& line,
                              bool* snapshot_accepted);
    bool queue_response(Client& client, std::string response, bool close_after = false);
    void flush_client(Client& client, std::size_t* write_budget);
    void reap_disconnected_clients();
    ssize_t send_bytes(int fd, const void* data, std::size_t size, int flags);
    void remember_pending(uint64_t id, const std::string& request);
    void audit(const WebCommand& cmd, const char* result, const char* active_source,
                float applied_value);

    int fd_ = -1;
    std::string path_;
    RuntimePointSnapshot snapshot_;
    std::array<char, KX_POINT_SNAPSHOT_MAX_PAYLOAD> snapshot_payload_{};
    std::size_t snapshot_payload_size_ = 0;
    SnapshotCacheState snapshot_state_ = SnapshotCacheState::UNAVAILABLE;
    std::size_t snapshot_payload_limit_ = KX_POINT_SNAPSHOT_MAX_PAYLOAD;
    uint64_t snapshot_publish_count_ = 0;
    std::vector<Client> clients_;
    struct CachedResponse {
        std::string request;
        std::string response; /* rỗng khi command đang chờ scan loop xử lý */
    };
    static constexpr std::size_t RESPONSE_CACHE_LIMIT = 128;
    std::unordered_map<uint64_t, CachedResponse> response_cache_;
    std::deque<uint64_t> response_order_;
    std::size_t outbound_budget_remaining_ = KX_POINT_SNAPSHOT_MAX_PAYLOAD;
    std::size_t round_robin_cursor_ = 0;
    uint64_t next_client_id_ = 1;
#ifdef CORE_BUILD_TESTS
    WebIpcSendAdapter send_adapter_ = nullptr;
    void* send_adapter_context_ = nullptr;
    WebIpcBudgetCounters budget_counters_;
    uint64_t snapshot_serialization_count_ = 0;
    void (*publish_observer_)(void*) = nullptr;
    void* publish_observer_context_ = nullptr;
#endif
};

/* "DO1"/"AO2"/"AV3"/"BV1"/"MSV2"/"AI1"/"BI1" → PointId; false nếu không hợp lệ */
bool parse_point_name(const std::string& name, PointId* out);

} // namespace core

#endif /* CORE_WEB_IPC_HPP */
