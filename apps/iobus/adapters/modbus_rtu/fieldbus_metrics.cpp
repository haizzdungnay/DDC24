/**
 * @file  fieldbus_metrics.cpp
 * @brief MOD-008: fieldbus metrics + alarm E302/E303.
 */
#include "fieldbus_metrics.hpp"

namespace iobus::fieldbus {

static constexpr float E303_THRESHOLD = 0.10f;   /* 10% error rate */
/* D-12: số lượt poll của một cửa sổ đánh giá E303. 20 lượt đủ để một vài lỗi lẻ
 * không kích alarm, và đủ ngắn để phát hiện bus xuống cấp trong vài chục giây ở
 * chu kỳ poll thường dùng. */
static constexpr uint32_t E303_WINDOW = 20;

void FieldbusMetrics::init(const std::vector<std::string>& names,
                            const std::vector<uint8_t>& addrs)
{
    metrics_.resize(names.size());
    for (size_t i = 0; i < names.size(); i++) {
        metrics_[i].name = names[i];
        metrics_[i].addr = addrs[i];
    }
}

void FieldbusMetrics::update(uint8_t idx, bool ok, uint64_t now_ms, uint8_t retry_limit)
{
    if (idx >= metrics_.size()) return;
    SlaveMetrics& m = metrics_[idx];
    m.total_polls++;
    m.window_polls++;
    if (!ok) {
        m.total_errors++;
        m.window_errors++;
        /* D-06: KHÔNG tăng retry_attempts ở đây. Trước bản sửa 2026-08-04 nó
         * được tăng đúng một lần cho mỗi lỗi nên luôn bằng total_errors, khiến
         * bảng chẩn đoán có hai cột "Lỗi" và "Retry" không bao giờ khác nhau —
         * vô dụng cho việc khoanh vùng, và gây hiểu nhầm rằng hệ thống đang thử
         * lại (thực tế lúc đó không hề có retry). Nay retry_attempts do
         * record_retry() đếm, mỗi lần phát lại thật một lần. */
        if (m.consecutive_errors < 255) m.consecutive_errors++;
        if (retry_limit == 0) retry_limit = 1;
        if (m.consecutive_errors >= retry_limit) m.online = false;
    } else {
        m.online = true;
        m.consecutive_errors = 0;
        m.last_seen_ms = now_ms;
    }
}

void FieldbusMetrics::record_timeout(uint8_t idx)
{
    if (idx < metrics_.size()) metrics_[idx].timeout_errors++;
}

void FieldbusMetrics::record_crc_error(uint8_t idx)
{
    if (idx < metrics_.size()) metrics_[idx].crc_errors++;
}

void FieldbusMetrics::record_retry(uint8_t idx)
{
    if (idx < metrics_.size()) metrics_[idx].retry_attempts++;
}

void FieldbusMetrics::record_write_failed(uint8_t idx)
{
    if (idx < metrics_.size()) metrics_[idx].write_failed++;
}

void FieldbusMetrics::record_write_dropped(uint8_t idx)
{
    if (idx < metrics_.size()) metrics_[idx].write_dropped++;
}

bool FieldbusMetrics::check_e302(uint8_t idx, uint8_t retry_limit)
{
    if (idx >= metrics_.size()) return false;
    SlaveMetrics& m = metrics_[idx];
    if (retry_limit == 0) retry_limit = 1;
    if (!m.online && m.consecutive_errors >= retry_limit && !m.e302_triggered) {
        m.e302_triggered = true;
        return true;
    }
    return false;
}

bool FieldbusMetrics::check_e303(uint8_t idx)
{
    if (idx >= metrics_.size()) return false;
    SlaveMetrics& m = metrics_[idx];
    /* D-12: dùng CỬA SỔ TRƯỢT thay cho tỷ lệ tích luỹ từ lúc khởi động.
     *
     * Hai khiếm khuyết của bản cũ: (1) `error_rate()` tích luỹ nên sau một giai
     * đoạn nhiễu, tỷ lệ còn vượt 10% rất lâu sau khi bus đã tốt trở lại; (2) cờ
     * e303_triggered chỉ được xoá trong reset_alarms(), mà reset_alarms() chỉ
     * được gọi khi e302 đang bật — một slave lỗi nhiều nhưng chưa bao giờ OFFLINE
     * sẽ latch E303 vĩnh viễn và không bao giờ báo lại. */
    if (m.window_polls < E303_WINDOW) return false;

    const float rate = static_cast<float>(m.window_errors) / static_cast<float>(m.window_polls);
    const bool over = rate > E303_THRESHOLD;

    /* Kết thúc cửa sổ: chốt đánh giá rồi mở cửa sổ mới. */
    m.window_polls  = 0;
    m.window_errors = 0;

    if (over && !m.e303_triggered) {
        m.e303_triggered = true;
        return true;   /* lần đầu vượt ngưỡng trong cửa sổ này */
    }
    if (!over) {
        /* Bus đã tốt trở lại trong trọn một cửa sổ ⇒ cho phép báo lại lần sau. */
        m.e303_triggered = false;
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
