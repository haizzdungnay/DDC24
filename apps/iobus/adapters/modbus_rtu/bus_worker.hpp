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
    /* `ISS-PIO-23` — xác nhận thiết bị THẬT SỰ giữ giá trị sau khi ghi.
     *
     * Nguồn có hai: cờ trên chính request (đường control cũ, MBR-B107) HOẶC
     * `verify_after_write` khai theo ĐIỂM trong profile. Điểm khai bật thì mọi
     * lệnh ghi vào nó đều được xác nhận, kể cả lệnh không tự yêu cầu — đó là
     * toàn bộ mục đích của một tuỳ chọn theo điểm. */
    bool     readback    = false;
    /* Dung sai so sánh cho giá trị đã scale. `0` = suy theo `scale` của điểm.
     * KHÔNG so bằng `==` trên số thực: `scale=0.1` biến 23.4 thành 234 rồi
     * ngược lại thành 23.400000572, và một phép so bằng tuyệt đối sẽ báo lệch
     * cho mọi lệnh ghi đúng. */
    double   readback_tolerance = 0.0;
    /* `MBA-FW-04` (audit Modbus 2026-09-25) — danh tính NỘI BỘ của một mục trong
     * hàng đợi, cấp lúc enqueue. `flush_pending` hợp nhất kết quả về hàng đợi
     * thật theo `seq` chứ không theo `(slave, fc, reg, request_id)`: đường ghi
     * cũ qua cờ `dirty` có `request_id` RỖNG, nên hai lệnh khác giá trị cho cùng
     * một register trùng khoá và lệnh MỚI bị đánh dấu "đã gửi" thay cho lệnh cũ. */
    uint64_t seq         = 0;
    /* Đang được `flush_pending` phát (đã chụp vào batch). Mục đang bay KHÔNG được
     * coalesce: ghi đè giá trị của nó chỉ đổi bản trong hàng đợi, còn bản trong
     * batch vẫn phát giá trị cũ — và lệnh mới biến mất khi hợp nhất. */
    bool     in_flight   = false;
};

/* Kết quả một lệnh ghi (MBR-B107). `applied` CHỈ được dùng khi slave đã trả
 * lời; timeout là `timeout`, không phải applied (FW_SOM_DESIGN §8.2). */
struct WriteResult {
    std::string request_id;
    /* accepted | applied | rejected | timeout | unverified
     *
     * `ISS-PIO-23` thêm `unverified`: slave ĐÃ ACK lệnh ghi nhưng đọc lại không
     * chứng minh được thiết bị giữ giá trị. Đây KHÔNG phải `applied` — nhiều
     * VFD ACK rồi bỏ qua khi tham số bị khoá — và cũng KHÔNG phải `rejected`,
     * vì lệnh đã thật sự đi xuống dây và có thể đã có tác dụng một phần. Gộp nó
     * vào một trong hai đầu đều là nói sai một nửa. */
    std::string status;
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
    /* `ISS-PIO-22` — mọi điểm trong một block phải CÙNG nhóm poll.
     *
     * Gộp một điểm `slow` vào block `fast` sẽ làm nó được đọc theo nhịp fast,
     * và cả tính năng mất tác dụng đúng ở chỗ nó cần nhất. */
    PollGroup poll_group = PollGroup::Normal;
    /* Mốc poll gần nhất CỦA BLOCK, không phải của slave: hai nhóm trên cùng
     * một slave đến hạn ở hai thời điểm khác nhau. */
    uint64_t last_poll_ms = 0;
    /* Mốc ĐỌC THÀNH CÔNG gần nhất của block, dùng cho ngưỡng stale theo điểm.
     * Tách khỏi `last_poll_ms`: "lần cuối ta thử hỏi" khác "lần cuối thiết bị
     * nói thật", và chỉ cái sau mới trả lời được câu hỏi dữ liệu còn tươi không. */
    uint64_t last_ok_ms = 0;
    /* `MBA-FW-05` — slave TRẢ LỜI block này bằng exception (địa chỉ không tồn
     * tại, hàm không hỗ trợ…). Đó là lỗi của BLOCK, không phải của thiết bị:
     * các block khác vẫn đọc được và thiết bị vẫn đang nói chuyện. Cờ này giữ
     * quality BAD/DEVICE_EXCEPTION của block khỏi bị lượt quét stale ghi đè
     * thành STALE/TIMEOUT — một lý do sai dẫn người vận hành đi kiểm dây. */
    bool     exception_active = false;
    uint8_t  exception_code   = 0;
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

    /* Có lệnh ghi CHƯA phát nào đang chờ cho slave này không?
     *
     * `poll_once` dùng nó để phát nốt lệnh ghi cho slave chưa tới lượt ĐỌC
     * (`ISS-MBW-02`). Phép soi này chỉ chạm hàng đợi trong bộ nhớ — slave rỗng
     * việc không tốn một byte nào trên dây. */
    bool has_pending_write_for(uint8_t slave_addr) const
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        for (const auto& w : pending_writes_)
            if (!w.submitted && w.slave_addr == slave_addr) return true;
        return false;
    }

    /* Lấy VÀ XOÁ danh sách ext slot có lệnh ghi vừa kết thúc mà KHÔNG ghi được
     * (quá hạn TTL, hết lượt thử, hoặc giá trị không encode được).
     *
     * Vì sao cần: `ModbusMaster` chống phát trùng bằng `last_written_`, được đặt
     * ngay lúc ENQUEUE. Nếu lệnh sau đó bị bỏ, `last_written_` vẫn giữ giá trị
     * cũ, nên người vận hành đặt LẠI ĐÚNG giá trị đó sẽ bị coi là trùng và lệnh
     * mới không bao giờ xuống dây — setpoint biến mất trong im lặng. Đó chính là
     * lớp lỗi "false success" mà thiết kế cấm, và nó vô hiệu hoá quy tắc "muốn
     * ghi lại thì phát sinh command mới" của OD-MBRTU-005.
     *
     * Trả về ext_idx để master xoá dấu vết dedup tương ứng. */
    std::vector<uint16_t> take_dropped_write_slots()
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        std::vector<uint16_t> out;
        out.swap(dropped_write_slots_);
        return out;
    }

private:
    void set_state(BusState s, FieldbusMetrics* metrics);
    void build_blocks(BusSlaveBinding* binding);
    /* `ISS-PIO-22` — hạ STALE cho block quá ngưỡng của chính nó. */
    void sweep_stale_blocks(uint64_t now_ms, ExtCache& cache);
    void read_slave(size_t i, uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics);
    void flush_pending(size_t i, uint64_t now_ms, FieldbusMetrics& metrics);
    /* Ghi nhận một ext slot có lệnh ghi kết thúc mà không áp được. Tự lấy
     * `queue_mu_`; chỉ được gọi từ `flush_pending` ở đoạn ĐÃ nhả khoá. */
    void note_dropped_write_slot(uint16_t ext_idx);
    void mark_bus_down(ExtCache& cache, FieldbusMetrics& metrics);
    /* `MBA-FW-06` — ghi một giao dịch GHI vào vòng nhớ khung, cùng hình dạng
     * với giao dịch đọc, để Frame Monitor thấy được lệnh ghi. */
    void record_write_frame(const PendingWrite& w, uint8_t slave, int rc, int saved_errno,
                            uint32_t elapsed_us, FieldbusMetrics& metrics);
    void emit_result(const std::string& request_id, const char* status,
                     const char* reason, uint8_t exception_code);
    /* Cổng chết ⇒ PORT_ERROR + backoff. Trả true nếu errno chỉ ra lỗi CỔNG chứ
     * không phải lỗi thiết bị. */
    bool errno_is_port_failure(int err) const;
    /* Thực thi các probe đang chờ — CHỈ gọi từ thread worker. */
    void service_probes();
    /* G-D: áp chế độ điều hướng RS-485 lên fd của cổng vừa mở, rồi đọc lại
     * trạng thái THẬT của driver và ghi log. */
    void apply_direction_mode(int fd);
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
    uint64_t                     next_write_seq_ = 1;   /* bảo vệ bởi queue_mu_ */
    /* ext slot của các lệnh ghi kết thúc mà không áp được; xem
     * `take_dropped_write_slots()`. Bảo vệ bởi `queue_mu_`. */
    std::vector<uint16_t>        dropped_write_slots_;
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

/* Tên Point của một ext slot — NGUỒN DUY NHẤT cho cả đường publish (BusWorker)
 * lẫn đường ghi (`ModbusMaster::drain_ext_writes` so danh tính slot trước khi
 * phát, `MBA-FW-02`). Điểm một slot mang đúng `point.name`; mảng nhiều slot
 * mang `<slave>.<point>[i]`. */
void ext_point_name(char out[24], const SlaveConfig& slave, const ProfilePoint& point,
                    uint16_t logical_index);

/* Phân loại kết quả một giao dịch cho vòng nhớ khung:
 * `ok` · `timeout` · `crc` · `exception` · `error`. */
const char* frame_reason(int rc, int saved_errno);

} // namespace iobus::fieldbus

#endif /* IOBUS_BUS_WORKER_HPP */
