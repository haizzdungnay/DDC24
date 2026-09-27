/**
 * @file  web_ipc.hpp
 * @brief Contract 07 §8 — core là server Unix stream socket /run/mkddc/core.sock,
 *        web là client. 1 message = 1 dòng JSON. Đủ 3 result: accepted / rejected /
 *        overridden (nguồn cao hơn hoặc safe-state đang thắng — COR-007).
 *        Mỗi lệnh in 1 dòng AUDIT chuẩn {id,user,point,op,value,result,active_source}.
 *
 * ADR-061 4.10 bước 2 (X19) — hai phía, một ranh giới:
 *   - PHÍA IPC (không RT): accept/đọc/parse/validate/cache chống lặp, dựng JSON
 *     trả lời, AUDIT, gửi socket, serialize `point_snapshot`. Chạy trên luồng
 *     `web-ipc` (SCHED_OTHER, ngoài CPU của vòng quét) khi đã
 *     `start_service_thread()`; nếu không (test, hoặc tạo thread hỏng) thì
 *     `ScanLoop` gọi `service_intake()` / `service_output()` ngay trong step như
 *     trước — cùng một đường mã, chỉ khác luồng chạy.
 *   - PHÍA LUỒNG QUÉT (RT): CHỈ `rt_next_command()` / `rt_complete()` /
 *     `rt_publish_snapshot()`. Không khoá, không cấp phát, không syscall.
 *
 * Lệnh đi qua `kWebCommandSlots` slot cấp phát sẵn. Chỉ số slot đi qua hai
 * hàng đợi SPSC (IPC→quét: lệnh đã validate; quét→IPC: lệnh đã có kết quả); ở
 * mỗi thời điểm một slot thuộc đúng MỘT bên, nên chuỗi trong `WebCommand` không
 * bao giờ bị chép hay giải phóng trên luồng quét. Hết slot ⇒ lệnh mới bị trả
 * `rejected busy` NGAY (không xếp hàng vô hạn, không rơi âm thầm).
 */
#ifndef CORE_WEB_IPC_HPP
#define CORE_WEB_IPC_HPP

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <deque>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include <poll.h>
#include <pthread.h>

#include "alarm/alarm_runtime.hpp"
#include "graph/point_table.hpp"
#include "graph/runtime_point_snapshot.hpp"
#include "runtime/latest_value_buffer.hpp"
#include "runtime/spsc_ring.hpp"
#include "schedule/schedule_runtime.hpp"

namespace core {

enum class WebCommandKind {
    Point,
    AlarmList,
    AlarmAck,
    AlarmSuppress,
    AlarmReturn,
    ScheduleState,   /* SCHD-152: BE hỏi trạng thái runtime của lịch */
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

/* 07 §8: tối đa 64 lệnh/scan, quá thì `rejected busy`. Nay là số slot của kênh
 * trao đổi: luồng quét xử lý hết mọi lệnh đang chờ ở mỗi scan, nên 64 slot
 * đang bận cũng chính là 64 lệnh trong một scan. */
constexpr std::size_t kWebCommandSlots = 64;
static_assert(kWebCommandSlots <= 256, "chi so slot di qua hang doi bang uint8_t");

/* Kết quả luồng quét điền cho một lệnh. `text` CHỈ trỏ chuỗi tĩnh (mã lỗi hoặc
 * tên nguồn thắng) — không chuỗi động nào được dựng trên luồng quét. */
enum class WebResultKind : uint8_t {
    Rejected,
    Accepted,
    Overridden,
    AlarmList,
    ScheduleState,
    AlarmAckAccepted,
    AlarmSuppressAccepted,
    AlarmReturnAccepted,
};

struct WebCommandResult {
    WebResultKind kind = WebResultKind::Rejected;
    const char*   text = "bad_request";
    float         applied_value = 0.0f;
    uint32_t      remaining_ttl_s = 0;
};

/* Một lệnh đang đi qua ranh giới. Luồng IPC ghi `cmd` rồi mới nộp; luồng quét
 * chỉ ĐỌC `cmd` và ghi `result` (+ `alarms`/`schedules` cho lệnh truy vấn);
 * luồng IPC chỉ đọc lại sau khi nhận slot về. Hai vector giữ capacity giữa các
 * lần dùng. */
struct WebCommandSlot {
    WebCommand                 cmd;
    WebCommandResult           result;
    std::vector<AlarmState>    alarms;
    std::vector<ScheduleState> schedules;
};

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
    /* SCHD-152: trả trạng thái runtime CỦA CONTROLLER cho backend. Đây là
     * "sự thật"; cấu hình mà backend giữ chỉ là "ý định". */
    void respond_schedule_state(const WebCommand& cmd, const std::vector<ScheduleState>& states);
    /* Serialize snapshot vào cache trả lời `point_snapshot` (PHÍA IPC). Luồng
     * quét KHÔNG gọi hàm này nữa — nó gọi `rt_publish_snapshot()`. */
    void publish_point_snapshot(const RuntimePointSnapshot& snapshot);

    /* ---------------- PHÍA LUỒNG QUÉT (RT) ----------------
     * Không khoá, không cấp phát, không syscall. */

    /* Lệnh kế tiếp đã được luồng IPC validate, theo thứ tự nộp; nullptr khi hết.
     * Slot thuộc luồng quét tới khi `rt_complete()`. */
    WebCommandSlot* rt_next_command();
    /* Trả slot đã điền `result` về luồng IPC để trả lời client. */
    void rt_complete(WebCommandSlot* slot);
    /* Công bố snapshot của scan vừa xong (bản mới nhất thay bản chưa ai đọc). */
    void rt_publish_snapshot(const RuntimePointSnapshot& snapshot);
    /* true khi luồng `web-ipc` đang phục vụ: luồng quét KHÔNG được gọi
     * `service_*` (hai luồng sẽ cùng chạm socket và cache). */
    bool offloaded() const { return offloaded_.load(std::memory_order_acquire); }

    /* ---------------- PHÍA IPC (không RT) ---------------- */

    /* Một lượt nhận: `drain()` rồi nộp mọi lệnh hợp lệ vào kênh trao đổi. */
    void service_intake();
    /* Trả lời mọi lệnh luồng quét đã xử lý xong (AUDIT giữ nguyên nội dung).
     * `refresh_snapshot` = serialize ngay bản snapshot mới nhất vào cache (đường
     * inline làm mỗi scan như trước; luồng `web-ipc` chỉ làm khi có yêu cầu). */
    void service_output(bool refresh_snapshot);
    /* Tạo luồng `web-ipc`: SCHED_OTHER, ngoài CPU của vòng quét. false = không
     * tạo được; IPC tiếp tục chạy inline trong luồng quét như trước. */
    bool start_service_thread(const char* thread_name = "web-ipc");
    void stop_service_thread();

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
    /* Gọi trong `rt_publish_snapshot()` — tức trên luồng quét, ở bước PUBLISH. */
    void set_rt_publish_observer_for_test(void (*observer)(void*), void* context)
    {
        rt_publish_observer_ = observer;
        rt_publish_observer_context_ = context;
    }
    /* Nộp thẳng một lệnh vào kênh như `service_intake()` làm (phía IPC). */
    bool submit_for_test(const WebCommand& command) { return submit(WebCommand(command)); }
    std::size_t free_slots_for_test() const { return free_count_; }
    /* F19: đổi cửa sổ tổng hợp log kết nối (mặc định 60 s). */
    void set_connection_log_interval_for_test(uint64_t interval_ns)
    {
        connection_log_interval_ns_ = interval_ns;
    }
    std::size_t queued_commands_for_test() const { return submit_queue_.size_approx(); }
    std::size_t completed_commands_for_test() const { return complete_queue_.size_approx(); }
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
    bool submit(WebCommand&& command);
    void log_connection_stats(bool force);
    void respond_result(const WebCommandSlot& slot);
    void refresh_snapshot_cache();
    void wait_for_io(int timeout_ms);
    void service_loop();
    /* Còn chỗ cho thêm lệnh trong lượt `drain()` hiện tại (đã tính các lệnh vừa
     * gom trong chính lượt đó). */
    bool has_command_capacity(std::size_t collected) const
    {
        return collected < kWebCommandSlots && collected < free_count_;
    }

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

    /* F19: một dòng tổng hợp mỗi cửa sổ thay cho một dòng mỗi kết nối. web-api
     * mở kết nối MỚI cho mỗi yêu cầu, nên log từng kết nối là ~3 dòng/s lúc rảnh
     * và ~50 dòng/s khi có Trace 10 ms vào journald. */
    uint64_t connection_log_interval_ns_ = 60ull * 1000000000ull;
    uint64_t connection_window_start_ns_ = 0;
    uint64_t connections_accepted_ = 0;
    uint64_t connections_refused_ = 0;

    /* Kênh trao đổi với luồng quét (X19). `free_` là của phía IPC. */
    std::array<WebCommandSlot, kWebCommandSlots> slots_{};
    std::array<uint8_t, kWebCommandSlots> free_ = make_free_list();
    std::size_t free_count_ = kWebCommandSlots;
    SpscRing<uint8_t, kWebCommandSlots> submit_queue_;    /* IPC → quét */
    SpscRing<uint8_t, kWebCommandSlots> complete_queue_;  /* quét → IPC */
    LatestValueBuffer<RuntimePointSnapshot> snapshot_exchange_;
    std::atomic<bool> offloaded_{false};
    std::atomic<bool> service_stop_{false};
    /* pthread chứ không std::thread: cần đặt kích thước stack. Unit core bật
     * `mlockall(MCL_FUTURE)`, nên stack mặc định 8 MiB của mỗi thread mới bị
     * khoá TRỌN vào RAM; luồng này chỉ cần một phần nhỏ. */
    pthread_t service_thread_{};
    bool service_thread_running_ = false;
    static void* service_thread_entry(void* self);
    char service_name_[16] = "web-ipc";
    std::vector<struct pollfd> pollfds_;

    static std::array<uint8_t, kWebCommandSlots> make_free_list()
    {
        std::array<uint8_t, kWebCommandSlots> list{};
        for (std::size_t i = 0; i < kWebCommandSlots; ++i)
            list[i] = static_cast<uint8_t>(kWebCommandSlots - 1 - i);
        return list;
    }
#ifdef CORE_BUILD_TESTS
    void (*rt_publish_observer_)(void*) = nullptr;
    void* rt_publish_observer_context_ = nullptr;
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
