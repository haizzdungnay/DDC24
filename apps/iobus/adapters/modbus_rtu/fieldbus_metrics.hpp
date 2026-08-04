/**
 * @file  fieldbus_metrics.hpp
 * @brief MOD-008: per-slave counters + alarm E302/E303 trigger.
 */
#ifndef IOBUS_FIELDBUS_METRICS_HPP
#define IOBUS_FIELDBUS_METRICS_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace iobus::fieldbus {

struct SlaveMetrics {
    std::string name;
    uint8_t     addr            = 0;
    bool        online          = false;
    bool        e302_triggered  = false;   /* offline alarm đã gửi */
    bool        e303_triggered  = false;   /* error rate alarm đã gửi */
    uint32_t    total_polls     = 0;
    uint32_t    total_errors    = 0;
    uint32_t    timeout_errors  = 0;
    uint32_t    crc_errors      = 0;
    /* D-06: số lần PHÁT LẠI thật (khác total_errors — một lượt poll thất bại có
     * thể gồm nhiều lần phát lại, và một lần phát lại thành công thì lượt poll
     * đó KHÔNG tính là lỗi). */
    uint32_t    retry_attempts  = 0;
    /* D-03: lệnh ghi thất bại ở một lần phát (còn có thể thử lại). */
    uint32_t    write_failed    = 0;
    /* D-03: lệnh ghi bị BỎ HẲN — hết lượt thử, quá hạn TTL, hoặc giá trị không
     * encode được. Khác write_failed: một lệnh có thể fail nhiều lần rồi mới bị
     * dropped đúng một lần. Người vận hành cần thấy con số này vì nó là "lệnh
     * của tôi đã không tới thiết bị". */
    uint32_t    write_dropped   = 0;
    uint8_t     consecutive_errors = 0;
    uint64_t    last_seen_ms    = 0;

    float error_rate() const {
        if (total_polls == 0) return 0.0f;
        return static_cast<float>(total_errors) / static_cast<float>(total_polls);
    }
};

class FieldbusMetrics {
public:
    void init(const std::vector<std::string>& slave_names,
              const std::vector<uint8_t>& slave_addrs);

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

    const SlaveMetrics& get(uint8_t idx) const { return metrics_[idx]; }
    size_t size() const { return metrics_.size(); }

private:
    std::vector<SlaveMetrics> metrics_;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_FIELDBUS_METRICS_HPP */
