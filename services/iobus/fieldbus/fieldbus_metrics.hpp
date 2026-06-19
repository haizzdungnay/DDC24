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

    void update(uint8_t slave_idx, bool ok, uint64_t now_ms);

    /* E302: slave offline (retry >= 2 → offline).
     * Trả true NẾU cần gửi alarm (lần đầu offline). */
    bool check_e302(uint8_t slave_idx);

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
