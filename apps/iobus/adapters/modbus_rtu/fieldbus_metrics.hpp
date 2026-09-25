/**
 * @file  fieldbus_metrics.hpp
 * @brief MOD-008: per-slave counters + alarm E302/E303 trigger.
 */
#ifndef IOBUS_FIELDBUS_METRICS_HPP
#define IOBUS_FIELDBUS_METRICS_HPP

#include <cstdint>
#include <mutex>

#include "modbus_rtu/frame_ring.hpp"
#include <string>
#include <vector>

namespace iobus::fieldbus {

/* MBR-B110: counter là uint64.
 *
 * uint32 tràn sau ~4,29 tỷ lượt. Một bus poll 10 slave ở 200 ms sinh 50 lượt/s
 * ⇒ ~2,7 năm là tràn — ngắn hơn tuổi thọ một tủ điều khiển. Khi tràn, counter
 * tụt về 0 và mọi phép tính delta của FE/historian cho ra số âm khổng lồ hoặc
 * "vừa reset", cả hai đều sai. uint64 ở cùng nhịp cần 11 tỷ năm.
 *
 * `counters_since_ms` + `producer_boot_id` (ở FieldbusMetrics) trả lời câu hỏi
 * "counter này đếm từ bao giờ" — thiếu nó thì một lần iobus restart bị đọc
 * thành "hệ thống vừa được reset thủ công" (OD-MBRTU-008). */
struct SlaveMetrics {
    std::string name;
    uint8_t     addr            = 0;
    uint8_t     bus_id          = 1;
    bool        online          = false;
    bool        e302_triggered  = false;   /* offline alarm đã gửi */
    bool        e303_triggered  = false;   /* error rate alarm đã gửi */
    uint64_t    total_polls     = 0;
    uint64_t    total_errors    = 0;
    uint64_t    timeout_errors  = 0;
    uint64_t    crc_errors      = 0;
    /* D-06: số lần PHÁT LẠI thật (khác total_errors — một lượt poll thất bại có
     * thể gồm nhiều lần phát lại, và một lần phát lại thành công thì lượt poll
     * đó KHÔNG tính là lỗi). */
    uint64_t    retry_attempts  = 0;
    /* D-03: lệnh ghi thất bại ở một lần phát (còn có thể thử lại). */
    uint64_t    write_failed    = 0;
    /* D-03: lệnh ghi bị BỎ HẲN — hết lượt thử, quá hạn TTL, hoặc giá trị không
     * encode được. Khác write_failed: một lệnh có thể fail nhiều lần rồi mới bị
     * dropped đúng một lần. Người vận hành cần thấy con số này vì nó là "lệnh
     * của tôi đã không tới thiết bị". */
    uint64_t    write_dropped   = 0;
    uint8_t     consecutive_errors = 0;
    /* D-12: cửa sổ trượt cho E303. Tách khỏi total_* vì tỷ lệ tích luỹ từ lúc
     * khởi động không phản ánh được tình trạng bus hiện tại. */
    uint32_t    window_polls    = 0;
    uint32_t    window_errors   = 0;
    uint64_t    last_seen_ms    = 0;
    /* MBR-B103: mã exception Modbus gần nhất (0x01..0x0B); 0 = chưa gặp. */
    uint8_t     last_exception  = 0;

    float error_rate() const {
        if (total_polls == 0) return 0.0f;
        return static_cast<float>(total_errors) / static_cast<float>(total_polls);
    }
};

/* MBR-B110 + MBR-B305: số liệu THẬT của một sợi dây.
 *
 * Trước bản này, trang Overview lấy p50/p95/utilization từ hằng số viết cứng
 * trong handler Go — tức giao diện hiển thị số không do thiết bị nào sinh ra.
 * Đó đúng loại lỗi mà D-07 đã cấm ở tầng FE, chỉ là bị đẩy xuống một tầng.
 */
struct BusMetrics {
    uint8_t     id          = 0;
    std::string name;
    std::string device;
    /* Vòng đời BusWorker dạng chuỗi (CLOSED/OPENING/RUNNING/PORT_ERROR/...). */
    std::string state       = "CLOSED";
    uint32_t    baud        = 0;
    char        parity      = 'N';
    uint8_t     stop        = 1;
    uint64_t    total_transactions = 0;
    uint64_t    total_errors       = 0;
    uint64_t    timeout_errors     = 0;
    uint64_t    crc_errors         = 0;
    uint64_t    port_reopens       = 0;
    /* Độ trễ giao dịch đo THẬT trên dây, tính từ mẫu gần đây (cửa sổ trượt). */
    uint32_t    latency_p50_us     = 0;
    uint32_t    latency_p95_us     = 0;
    uint32_t    latency_max_us     = 0;
    /* Thời gian chiếm dây / thời gian trôi qua, ×100 để tránh float trong SHM. */
    uint16_t    utilization_pct_x100 = 0;
    uint64_t    busy_us_window      = 0;
    uint64_t    window_elapsed_us   = 0;
    /* Tổng chạy của N cửa sổ gần nhất (trung bình trượt). */
    uint64_t    util_busy_sum_us    = 0;
    uint64_t    util_elapsed_sum_us = 0;
};

/* Chu kỳ chốt MỘT ô của trung bình trượt utilization: 2 s. */
constexpr uint64_t kUtilizationSlotUs = 2000000ull;
/* Số ô giữ lại ⇒ cửa sổ hiệu dụng 16 s.
 *
 * Vì sao phải là TRUNG BÌNH TRƯỢT chứ không phải một cửa sổ đơn:
 *
 * Publisher chốt ở nhịp 100 ms trong khi một transaction timeout tốn 300 ms và
 * một slave OFFLINE chỉ được probe mỗi `offline_probe_ms` (mặc định 5 s). Với
 * cửa sổ đơn ngắn hơn chu kỳ probe, phần lớn cửa sổ có busy = 0 còn vài cửa sổ
 * có busy lớn — con số nhảy giữa 0 % và 30 % tuỳ thời điểm người dùng bấm F5.
 * Đo trên board Foxlinx 2026-08-06 với cửa sổ 2 s: latency p50 = 300 ms/giao
 * dịch mà utilization vẫn báo 0 %.
 *
 * 16 s dài hơn chu kỳ probe chậm nhất thường dùng (5 s) vài lần, nên duty cycle
 * ổn định; và vẫn đủ ngắn để một bus vừa nghẽn hiện ra trong vòng nửa phút. */
constexpr size_t kUtilizationSlots = 8;

/* `MBA-FW-03` (audit Modbus 2026-09-25): đối tượng này được CHIA SẺ giữa các
 * thread BusWorker (ghi bộ đếm slave/bus), thread publish 100 ms (chốt cửa sổ
 * latency, đọc toàn bộ để ghi io_shm) và thread kênh điều khiển (`status`,
 * `apply_config` gọi `init`). Bản trước KHÔNG có khoá: `record_bus_transaction`
 * `erase`/`push_back` vào `latency_window_` trong lúc `roll_bus_window` chép
 * chính vector đó, và `set_bus_state` gán `std::string` trong lúc publisher đọc
 * — data race trên cấu trúc cấp phát động, đủ để làm hỏng heap của tiến trình
 * đang chạy cả vòng IOP 2 ms.
 *
 * Luật: mọi hàm công khai tự lấy `mu_`; hàm đọc trả BẢN SAO, không trả tham
 * chiếu ra ngoài khoá. Hàm private (`find_bus`) giả định đã giữ khoá. */
class FieldbusMetrics {
public:
    /* `T57-3.9`: vòng nhớ khung đi CÙNG đường với metrics vì `poll_once` đã
       nhận sẵn đối tượng này — thêm một tham số nữa xuyên qua ba tầng chỉ để
       mang một con trỏ là chi phí không đổi lấy gì. */
    FrameRing& frames() { return frames_; }
    const FrameRing& frames() const { return frames_; }

    void init(const std::vector<std::string>& slave_names,
              const std::vector<uint8_t>& slave_addrs);
    /* Overload mang bus_id — cần cho tổng hợp theo bus ở tầng API. */
    void init(const std::vector<std::string>& slave_names,
              const std::vector<uint8_t>& slave_addrs,
              const std::vector<uint8_t>& slave_bus_ids);

    /* MBR-B110: mốc "counter đếm từ bao giờ" và danh tính tiến trình producer.
     * Consumer PHẢI so hai giá trị này trước khi tính delta giữa hai lần đọc;
     * lệch ⇒ counter đã reset, delta cũ vô nghĩa. */
    void set_producer_identity(uint64_t boot_id, uint64_t counters_since_ms)
    {
        std::lock_guard<std::mutex> lock(mu_);
        producer_boot_id_  = boot_id;
        counters_since_ms_ = counters_since_ms;
    }
    uint64_t producer_boot_id() const { std::lock_guard<std::mutex> lock(mu_); return producer_boot_id_; }
    uint64_t counters_since_ms() const { std::lock_guard<std::mutex> lock(mu_); return counters_since_ms_; }

    /* Bus metrics — index theo thứ tự khai báo trong config. */
    void init_buses(const std::vector<BusMetrics>& buses)
    {
        std::lock_guard<std::mutex> lock(mu_);
        buses_ = buses;
        latency_window_.assign(buses_.size(), {});
    }
    size_t bus_count() const { std::lock_guard<std::mutex> lock(mu_); return buses_.size(); }
    /* Bản SAO có khoá. `i` ngoài dải ⇒ bản rỗng thay vì chạm ngoài vector: tập
     * bus có thể vừa bị `apply_config` thay giữa hai lần gọi của người đọc. */
    BusMetrics bus(size_t i) const
    {
        std::lock_guard<std::mutex> lock(mu_);
        return i < buses_.size() ? buses_[i] : BusMetrics{};
    }
    /* Ghi nhận một giao dịch đã xong trên bus: thời gian chiếm dây thật. */
    void record_bus_transaction(uint8_t bus_id, uint32_t elapsed_us, bool ok);
    void set_bus_state(uint8_t bus_id, const char* state);
    void record_bus_reopen(uint8_t bus_id);
    /* Chốt cửa sổ latency/utilization; gọi ở nhịp publish. */
    void roll_bus_window(uint8_t bus_id, uint64_t window_us);
    /* Mã exception gần nhất của một slave. */
    void record_exception(uint8_t slave_idx, uint8_t exception_code);

    void update(uint8_t slave_idx, bool ok, uint64_t now_ms, uint8_t retry_limit = 2);
    void record_timeout(uint8_t slave_idx);
    void record_crc_error(uint8_t slave_idx);
    /* D-06: một lần PHÁT LẠI thật một giao dịch bị lỗi. Tách khỏi total_errors
     * để hai cột trên bảng chẩn đoán mang thông tin khác nhau. */
    void record_retry(uint8_t slave_idx);
    /* D-03: một lần phát lệnh ghi thất bại (vẫn có thể còn lượt thử). */
    void record_write_failed(uint8_t slave_idx);
    /* D-03: lệnh ghi bị bỏ hẳn, sẽ KHÔNG được phát lại. */
    void record_write_dropped(uint8_t slave_idx);

    /* E302: slave offline (retry >= 2 → offline).
     * Trả true NẾU cần gửi alarm (lần đầu offline). */
    bool check_e302(uint8_t slave_idx, uint8_t retry_limit = 2);

    /* E303: bus error rate > 10%.
     * Trả true NẾU cần gửi alarm (lần đầu vượt ngưỡng). */
    bool check_e303(uint8_t slave_idx);

    /* Reset alarm khi slave trở lại online. */
    void reset_alarms(uint8_t slave_idx);

    /* Bản SAO có khoá — xem luật ở đầu lớp. */
    SlaveMetrics get(uint8_t idx) const
    {
        std::lock_guard<std::mutex> lock(mu_);
        return idx < metrics_.size() ? metrics_[idx] : SlaveMetrics{};
    }
    size_t size() const { std::lock_guard<std::mutex> lock(mu_); return metrics_.size(); }

private:
    FrameRing frames_;
    /* Giả định đã giữ `mu_`. */
    BusMetrics* find_bus(uint8_t bus_id);

    mutable std::mutex mu_;

    std::vector<SlaveMetrics> metrics_;
    std::vector<BusMetrics>   buses_;
    /* Cửa sổ latency thô cho từng bus (µs), giữ tối đa kLatencyWindow mẫu. */
    std::vector<std::vector<uint32_t>> latency_window_;
    uint64_t producer_boot_id_  = 0;
    uint64_t counters_since_ms_ = 0;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_FIELDBUS_METRICS_HPP */
