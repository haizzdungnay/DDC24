/**
 * @file  fieldbus_metrics.cpp
 * @brief MOD-008: fieldbus metrics + alarm E302/E303.
 */
#include "fieldbus_metrics.hpp"
#include "fieldbus_time.hpp"

#include <algorithm>

namespace iobus::fieldbus {

static constexpr float E303_THRESHOLD = 0.10f;   /* 10% error rate */
/* D-12: số lượt poll của một cửa sổ đánh giá E303. 20 lượt đủ để một vài lỗi lẻ
 * không kích alarm, và đủ ngắn để phát hiện bus xuống cấp trong vài chục giây ở
 * chu kỳ poll thường dùng. */
static constexpr uint32_t E303_WINDOW = 20;

namespace {

/* p95 theo "nearest rank": chỉ số ceil(0.95·N) − 1 — cùng quy ước với cửa sổ
 * trộn cũ, để hai con số so được với nhau. */
std::size_t p95_index(std::size_t n)
{
    const std::size_t rank = (n * 95 + 99) / 100;
    return (rank == 0 ? 1 : rank) - 1;
}

/* T63-003: thống kê một ring theo loại. Sắp trên bản sao TRÊN STACK (512 byte),
 * không cấp phát; gọi ở nhịp publish 100 ms, không ở luồng RT. */
template <typename Ring>
LatencyWindowStats window_stats(const Ring& ring, uint64_t total)
{
    LatencyWindowStats out;
    out.window_size = static_cast<uint32_t>(kLatencyWindow);
    out.sample_count = ring.count;
    out.total = total;
    if (ring.count == 0) return out;
    std::array<uint32_t, kLatencyWindow> sorted{};
    std::copy(ring.samples.begin(), ring.samples.begin() + ring.count, sorted.begin());
    std::sort(sorted.begin(), sorted.begin() + ring.count);
    out.p50_us = sorted[ring.count / 2];
    out.p95_us = sorted[p95_index(ring.count)];
    out.max_us = sorted[ring.count - 1];
    return out;
}

} // namespace

void FieldbusMetrics::init_buses(const std::vector<BusMetrics>& buses)
{
    init_buses(buses, monotonic_ms());
}

void FieldbusMetrics::init(const std::vector<std::string>& names,
                            const std::vector<uint8_t>& addrs)
{
    init(names, addrs, {});
}

void FieldbusMetrics::init(const std::vector<std::string>& names,
                            const std::vector<uint8_t>& addrs,
                            const std::vector<uint8_t>& bus_ids)
{
    std::lock_guard<std::mutex> lock(mu_);
    metrics_.resize(names.size());
    for (size_t i = 0; i < names.size(); i++) {
        metrics_[i].name = names[i];
        metrics_[i].addr = addrs[i];
        metrics_[i].bus_id = (i < bus_ids.size()) ? bus_ids[i] : 1u;
    }
}

BusMetrics* FieldbusMetrics::find_bus(uint8_t bus_id)
{
    for (auto& b : buses_)
        if (b.id == bus_id) return &b;
    return nullptr;
}

void FieldbusMetrics::record_bus_transaction(uint8_t bus_id, uint32_t elapsed_us, bool ok,
                                             TransactionKind kind)
{
    std::lock_guard<std::mutex> lock(mu_);
    BusMetrics* bus = find_bus(bus_id);
    if (!bus) return;
    bus->total_transactions++;
    if (!ok) bus->total_errors++;
    bus->busy_us_window += elapsed_us;
    if (elapsed_us > bus->latency_max_us) bus->latency_max_us = elapsed_us;
    if (kind == TransactionKind::Write) bus->write_latency.total++;
    else bus->read_latency.total++;

    if (latency_window_.size() < buses_.size()) latency_window_.resize(buses_.size());
    if (kind_windows_.size() < buses_.size()) kind_windows_.resize(buses_.size());
    for (size_t i = 0; i < buses_.size(); i++) {
        if (buses_[i].id != bus_id) continue;
        auto& window = latency_window_[i];
        if (window.size() >= kLatencyWindow) window.erase(window.begin());
        window.push_back(elapsed_us);
        LatencyRing& ring = kind_windows_[i][static_cast<std::size_t>(kind)];
        ring.samples[ring.next] = elapsed_us;
        ring.next = static_cast<uint32_t>((ring.next + 1u) % kLatencyWindow);
        if (ring.count < kLatencyWindow) ring.count++;
        break;
    }
}

void FieldbusMetrics::set_bus_state(uint8_t bus_id, const char* state)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (BusMetrics* bus = find_bus(bus_id)) bus->state = state;
}

void FieldbusMetrics::record_bus_reopen(uint8_t bus_id)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (BusMetrics* bus = find_bus(bus_id)) bus->port_reopens++;
}

void FieldbusMetrics::roll_bus_window(uint8_t bus_id, uint64_t window_us)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (latency_window_.size() < buses_.size()) latency_window_.resize(buses_.size());
    for (size_t i = 0; i < buses_.size(); i++) {
        if (buses_[i].id != bus_id) continue;
        BusMetrics& bus = buses_[i];
        std::vector<uint32_t> sorted = latency_window_[i];
        if (!sorted.empty()) {
            std::sort(sorted.begin(), sorted.end());
            bus.latency_p50_us = sorted[sorted.size() / 2];
            /* p95 theo "nearest rank": chỉ số ceil(0.95·N) − 1. Với N nhỏ, cách
             * này trả về phần tử có thật thay vì một số nội suy không tồn tại. */
            bus.latency_p95_us = sorted[p95_index(sorted.size())];
        }
        /* T63-003: latency tách loại, cùng nhịp chốt với cửa sổ trộn. */
        if (i < kind_windows_.size()) {
            const auto& rings = kind_windows_[i];
            bus.read_latency = window_stats(
                rings[static_cast<std::size_t>(TransactionKind::Read)], bus.read_latency.total);
            bus.write_latency = window_stats(
                rings[static_cast<std::size_t>(TransactionKind::Write)], bus.write_latency.total);
        }
        /* Utilization = thời gian THẬT SỰ chiếm dây / thời gian trôi qua.
         * Không ước lượng từ baud và số điểm: con số ước lượng không phát hiện
         * được một slave chết ngốn trọn timeout mỗi vòng.
         *
         * Chỉ chốt khi đã tích luỹ đủ một cửa sổ. Chốt ở mỗi nhịp publish
         * (100 ms) cho ra 0 % hoặc 100 % chứ không phải tỷ lệ thật, vì một
         * transaction có thể dài hơn cả nhịp publish. */
        bus.window_elapsed_us += window_us;
        if (bus.window_elapsed_us >= kUtilizationSlotUs) {
            /* Chốt một ô rồi cộng vào tổng chạy; bớt dần phần cũ để tổng luôn
             * đại diện cho khoảng kUtilizationSlots × kUtilizationSlotUs gần
             * nhất. Dùng phép bớt tỷ lệ thay vì giữ mảng ô: cùng hiệu ứng cửa
             * sổ trượt mà không cần thêm bộ nhớ cho mỗi bus. */
            if (bus.util_elapsed_sum_us >= kUtilizationSlotUs * kUtilizationSlots) {
                bus.util_busy_sum_us -= bus.util_busy_sum_us / kUtilizationSlots;
                bus.util_elapsed_sum_us -= bus.util_elapsed_sum_us / kUtilizationSlots;
            }
            bus.util_busy_sum_us += bus.busy_us_window;
            bus.util_elapsed_sum_us += bus.window_elapsed_us;
            if (bus.util_elapsed_sum_us > 0) {
                const uint64_t pct_x100 =
                    (bus.util_busy_sum_us * 10000ull) / bus.util_elapsed_sum_us;
                bus.utilization_pct_x100 =
                    static_cast<uint16_t>(pct_x100 > 10000 ? 10000 : pct_x100);
            }
            bus.busy_us_window    = 0;
            bus.window_elapsed_us = 0;
        }
        break;
    }
}

void FieldbusMetrics::record_exception(uint8_t slave_idx, uint8_t exception_code)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (slave_idx < metrics_.size()) metrics_[slave_idx].last_exception = exception_code;
}

void FieldbusMetrics::update(uint8_t idx, bool ok, uint64_t now_ms, uint8_t retry_limit)
{
    std::lock_guard<std::mutex> lock(mu_);
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
    std::lock_guard<std::mutex> lock(mu_);
    if (idx < metrics_.size()) metrics_[idx].timeout_errors++;
}

void FieldbusMetrics::record_crc_error(uint8_t idx)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (idx < metrics_.size()) metrics_[idx].crc_errors++;
}

void FieldbusMetrics::record_retry(uint8_t idx)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (idx < metrics_.size()) metrics_[idx].retry_attempts++;
}

void FieldbusMetrics::record_write_failed(uint8_t idx)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (idx < metrics_.size()) metrics_[idx].write_failed++;
}

void FieldbusMetrics::record_write_dropped(uint8_t idx)
{
    std::lock_guard<std::mutex> lock(mu_);
    if (idx < metrics_.size()) metrics_[idx].write_dropped++;
}

bool FieldbusMetrics::check_e302(uint8_t idx, uint8_t retry_limit)
{
    std::lock_guard<std::mutex> lock(mu_);
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
    std::lock_guard<std::mutex> lock(mu_);
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
    std::lock_guard<std::mutex> lock(mu_);
    if (idx >= metrics_.size()) return;
    metrics_[idx].e302_triggered = false;
    metrics_[idx].e303_triggered = false;
    metrics_[idx].online = true;
}

} // namespace iobus::fieldbus
