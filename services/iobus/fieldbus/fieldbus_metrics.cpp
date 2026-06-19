/**
 * @file  fieldbus_metrics.cpp
 * @brief MOD-008: fieldbus metrics + alarm E302/E303.
 */
#include "fieldbus_metrics.hpp"

namespace iobus::fieldbus {

static constexpr float E303_THRESHOLD = 0.10f;   /* 10% error rate */

void FieldbusMetrics::init(const std::vector<std::string>& names,
                            const std::vector<uint8_t>& addrs)
{
    metrics_.resize(names.size());
    for (size_t i = 0; i < names.size(); i++) {
        metrics_[i].name = names[i];
        metrics_[i].addr = addrs[i];
    }
}

void FieldbusMetrics::update(uint8_t idx, bool ok, uint64_t now_ms)
{
    if (idx >= metrics_.size()) return;
    SlaveMetrics& m = metrics_[idx];
    m.total_polls++;
    if (!ok) {
        m.total_errors++;
    } else {
        m.online = true;
        m.last_seen_ms = now_ms;
    }
}

bool FieldbusMetrics::check_e302(uint8_t idx)
{
    if (idx >= metrics_.size()) return false;
    SlaveMetrics& m = metrics_[idx];
    if (!m.online && !m.e302_triggered) {
        m.e302_triggered = true;
        return true;
    }
    return false;
}

bool FieldbusMetrics::check_e303(uint8_t idx)
{
    if (idx >= metrics_.size()) return false;
    SlaveMetrics& m = metrics_[idx];
    if (m.error_rate() > E303_THRESHOLD && !m.e303_triggered) {
        m.e303_triggered = true;
        return true;
    }
    return false;
}

void FieldbusMetrics::reset_alarms(uint8_t idx)
{
    if (idx >= metrics_.size()) return;
    metrics_[idx].e302_triggered = false;
    metrics_[idx].e303_triggered = false;
    metrics_[idx].online = true;
}

} // namespace iobus::fieldbus
