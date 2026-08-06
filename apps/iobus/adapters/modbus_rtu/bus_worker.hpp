/**
 * @file  bus_worker.hpp
 * @brief MBR-B101/B102/B107: một BusWorker cho MỘT sợi dây RS-485.
 *
 * Bất biến của thiết kế (FW_SOM_DESIGN §2):
 *
 *  - **Một worker một bus, một thread.** Không bao giờ có hai luồng cùng phát
 *    trên một dây; và một worker bị chặn (cổng chết, timeout dài) KHÔNG kéo
 *    theo worker kia. Trước bản này cả hai bus dùng chung một `modbus_t*` và
 *    một vòng lặp, nên một slave chết ở bus 2 giữ dây của bus 1 trọn timeout.
 *  - Modbus không bao giờ chạy SCHED_FIFO và không chia sẻ mutex với `iop_main`.
 *  - Điểm chung duy nhất giữa các worker là `ExtCache` (ghi vào dải slot rời
 *    nhau, có mutex) và `FieldbusMetrics` (mỗi worker ghi slice riêng).
 */
#ifndef IOBUS_BUS_WORKER_HPP
#define IOBUS_BUS_WORKER_HPP

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "device_profile.hpp"
#include "ext_cache.hpp"
#include "fieldbus_config.hpp"
#include "fieldbus_metrics.hpp"
#include "poll_scheduler.hpp"

namespace iobus::fieldbus {

/* Số lần phát một lệnh ghi trước khi bỏ hẳn (D-03).
 * Chọn 3: đủ để vượt qua nhiễu thoáng qua, đủ ngắn để không giữ lệnh cũ qua một
 * sự cố mất điện thiết bị. */
constexpr uint8_t kMaxWriteAttempts = 3;

/* Tuổi tối đa của một lệnh ghi chưa gửi được, tính từ lúc enqueue.
 * Chọn 30 s: dài hơn vài chu kỳ poll chậm nhất thường dùng (10 s), ngắn hơn
 * nhiều so với thời gian một thiết bị bị cắt điện rồi cấp lại. */
constexpr uint64_t kWriteTtlMs = 30000;

/* MBR-B107: hàng đợi ghi phải CÓ TRẦN. Không giới hạn nghĩa là một client lỗi
 * (hoặc một node logic lặp) có thể đẩy hàng triệu request và làm iobus hết RAM
 * — cách hỏng tệ nhất vì nó kéo theo cả IOP. 64 khớp ngân sách FW design §11. */
constexpr size_t kMaxPendingWrites = 64;

enum class BusState {
    CLOSED,        /* chưa mở hoặc đã đóng theo cấu hình              */
    OPENING,       /* đang mở cổng                                    */
    RUNNING,       /* vòng lặp poll bình thường                       */
    PORT_ERROR,    /* cổng lỗi — backoff rồi thử OPENING lại          */
    DRAINING,      /* hoàn tất transaction đang phát, huỷ write chờ   */
    SWAPPING,      /* dựng bảng device/point của generation mới       */
    CONFIG_ERROR,  /* cấu hình không thực thi được — fail-closed      */
};

const char* bus_state_name(BusState s);

struct PendingWrite {
    uint16_t ext_idx;       /* index trong ext_cache */
    uint8_t  slave_addr;
    uint8_t  fc;
    uint16_t reg_addr;
    float    value;
    PointType type;
    ByteOrder byte_order;
    float    scale;
    float    offset;
    bool     submitted = false;
    /* D-03: trước bản sửa 2026-08-04, write lỗi được `continue` mà không đánh
     * submitted nên nằm lại hàng đợi VÔ THỜI HẠN và được thử lại ở mọi vòng poll.
     * Hệ quả thực tế: setpoint đặt lúc 09:00 cho một thiết bị đang mất điện sẽ
     * tự động được ghi lúc 14:00 khi thiết bị có điện trở lại — đúng hành vi
     * "blind replay after reconnect" mà thiết kế cấm. */
    uint8_t  attempts    = 0;   /* số lần đã phát xuống dây */
    uint64_t enqueued_ms = 0;   /* monotonic ms lúc vào hàng đợi; 0 = chưa đặt */
    /* MBR-B107: danh tính request để báo kết quả ngược về core/web. Rỗng ⇒
     * đường ghi cũ qua cờ dirty, không ai chờ kết quả. */
    std::string request_id;
    uint64_t deadline_ms = 0;   /* 0 = chỉ dùng TTL mặc định */
    bool     readback    = false;
};

/* Kết quả một lệnh ghi (MBR-B107). `applied` CHỈ được dùng khi slave đã trả
 * lời; timeout là `timeout`, không phải applied (FW_SOM_DESIGN §8.2). */
struct WriteResult {
    std::string request_id;
    std::string status;          /* accepted | applied | rejected | timeout */
    std::string reason;
    uint8_t     exception_code = 0;
    bool        has_readback   = false;
    double      readback_value = 0.0;
};

using WriteResultSink = std::function<void(const WriteResult&)>;

/* Một khối đọc đã gộp (MBR-B109). Gộp các điểm liền kề cùng FC thành một
 * transaction: hai điểm holding register ở addr 0 và 2 vốn tốn hai lượt
 * request/response — trên RS-485 19200 baud mỗi lượt là ~5 ms turnaround, nên
 * gộp giảm thời gian chiếm dây gần một nửa cho profile dày. */
struct ReadBlock {
    uint8_t  fc    = 3;
    uint16_t addr  = 0;
    uint16_t count = 1;
    /* Các điểm thuộc khối, kèm offset (đơn vị register/bit) trong khối. */
    struct Member {
        const ProfilePoint* point;
        uint16_t offset;      /* addr của điểm − addr của khối */
        uint16_t ext_index;   /* slot ext đầu tiên của điểm */
    };
    std::vector<Member> members;
};

struct BusSlaveBinding {
    uint8_t       global_idx = 0;   /* index vào cfg.slaves và FieldbusMetrics */
    SlaveConfig   cfg;
    DeviceProfile profile;
    SlaveState    state;
    uint16_t      ext_base  = 0;
    uint16_t      ext_count = 0;
    bool          config_error = false;
    std::vector<ReadBlock> blocks;
};

class BusWorker {
public:
    BusWorker() = default;
    ~BusWorker();
    /* Giữ mutex + condvar + fd nên không copy/move được. ModbusMaster dùng
     * unique_ptr để địa chỉ worker ổn định khi vector realloc. */
    BusWorker(const BusWorker&) = delete;
    BusWorker& operator=(const BusWorker&) = delete;
    BusWorker(BusWorker&&) = delete;
    BusWorker& operator=(BusWorker&&) = delete;

    /* Gắn cấu hình bus + tập slave thuộc bus này, cấp phát dải ext slot bắt đầu
     * từ *ext_cursor và đẩy cursor lên. KHÔNG mở cổng — `open_port()` làm việc
     * đó, để trạng thái CONFIG_ERROR phân biệt được với PORT_ERROR. */
    void bind(const BusConfig& bus, const std::vector<SlaveConfig>& slaves,
              const std::vector<uint8_t>& global_indices, uint16_t* ext_cursor,
              ExtCache& cache);

    bool open_port();
    void close_port();
    bool port_open() const { return ctx_ != nullptr; }

    /* Một vòng phục vụ: chọn slave đến hạn theo EDF, transact, flush write.
     * KHÔNG push snapshot — việc publish do một chỗ duy nhất làm (MBR-B104). */
    void poll_once(uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics);

    /* Vòng lặp thread của worker. Thoát khi `stop` bật. */
    void run_loop(const std::atomic<bool>& stop, ExtCache& cache, FieldbusMetrics& metrics);

    uint32_t sleep_ms_until_next(uint64_t now_ms) const;

    /* Trả false nếu hàng đợi đã đầy (MBR-B107) — caller phải báo rejected. */
    bool enqueue_write(const PendingWrite& w);
    void set_write_result_sink(WriteResultSink sink) { result_sink_ = std::move(sink); }

    /* Commissioning ad-hoc (MBR-B108). Chạy trên chính thread worker qua hàng
     * đợi lệnh để không bao giờ có hai luồng cùng phát trên dây. */
    struct ProbeResult {
        bool        ok = false;
        std::string reason;
        double      value = 0.0;
        uint8_t     exception_code = 0;
        uint32_t    elapsed_us = 0;
    };
    /* Gọi từ THREAD KHÁC (control): lệnh được xếp hàng và do chính thread
     * worker phát, nên không bao giờ có hai luồng cùng nói trên một dây.
     * Chờ tối đa `wait_ms`; hết giờ ⇒ ok=false, reason="probe_timeout". */
    ProbeResult probe_read(uint8_t slave_addr, uint8_t fc, uint16_t addr,
                           uint16_t count, uint32_t timeout_ms, uint32_t wait_ms = 3000);

    BusState state() const { return state_; }
    uint8_t  bus_id() const { return bus_.id; }
    const BusConfig& config() const { return bus_; }
    uint16_t ext_base() const { return ext_base_; }
    uint16_t ext_span() const { return ext_span_; }
    size_t   slave_count() const { return slaves_.size(); }
    const BusSlaveBinding& slave(size_t i) const { return slaves_[i]; }
    size_t   pending_write_count() const
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        return pending_writes_.size();
    }

private:
    void set_state(BusState s, FieldbusMetrics* metrics);
    void build_blocks(BusSlaveBinding* binding);
    void read_slave(size_t i, uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics);
    void flush_pending(size_t i, uint64_t now_ms, FieldbusMetrics& metrics);
    void mark_bus_down(ExtCache& cache, FieldbusMetrics& metrics);
    void emit_result(const std::string& request_id, const char* status,
                     const char* reason, uint8_t exception_code);
    /* Cổng chết ⇒ PORT_ERROR + backoff. Trả true nếu errno chỉ ra lỗi CỔNG chứ
     * không phải lỗi thiết bị. */
    bool errno_is_port_failure(int err) const;
    /* Thực thi các probe đang chờ — CHỈ gọi từ thread worker. */
    void service_probes();
    ProbeResult run_probe_locked(uint8_t slave_addr, uint8_t fc, uint16_t addr,
                                 uint16_t count, uint32_t timeout_ms);

    struct ProbeRequest {
        uint8_t  slave_addr = 0;
        uint8_t  fc = 3;
        uint16_t addr = 0;
        uint16_t count = 1;
        uint32_t timeout_ms = 500;
        bool     done = false;
        ProbeResult result;
    };
    mutable std::mutex      queue_mu_;
    std::condition_variable probe_cv_;
    std::vector<std::shared_ptr<ProbeRequest>> probes_;

    BusConfig                    bus_{};
    std::vector<BusSlaveBinding> slaves_;
    std::vector<PendingWrite>    pending_writes_;
    void*    ctx_ = nullptr;    /* modbus_t* */
    BusState state_ = BusState::CLOSED;
    uint16_t ext_base_ = 0;
    uint16_t ext_span_ = 0;
    uint8_t  backoff_step_ = 0;
    uint64_t reopen_at_ms_ = 0;
    WriteResultSink result_sink_;
};

/* Backoff khi PORT_ERROR: 1s, 2s, 5s, 10s, 30s rồi giữ 30s (FW design §3).
 * Không thử lại tức thời: mở lại một cổng đang lỗi ở nhịp mili-giây chỉ tạo
 * bão syscall và làm ngập journal, không làm cổng sống lại nhanh hơn. */
uint32_t port_backoff_ms(uint8_t step);

} // namespace iobus::fieldbus

#endif /* IOBUS_BUS_WORKER_HPP */
