/**
 * @file  control_status.hpp
 * @brief Nội dung op `status` của kênh điều khiển fieldbus (MBR-B105), tách khỏi
 *        `main.cpp` để test được từng byte.
 *
 *        T63-003 (PERF-SYS-04, PERF-API-04) — chỉ THÊM trường, mọi trường cũ giữ
 *        nguyên tên và nghĩa:
 *          - mỗi bus: `latency_read` / `latency_write` {p50_us, p95_us, max_us,
 *            sample_count, window_size, total} — latency đọc và ghi RIÊNG, kèm
 *            nhãn cửa sổ; `total_transactions`, `total_errors` của dây;
 *          - `bus_counters_epoch` + `bus_counters_since_ms`: counter và cửa sổ
 *            latency của bus về 0 mỗi lần cấu hình bus được nạp (kể cả
 *            `apply_config`, khi `producer_boot_id` KHÔNG đổi). Consumer so cặp
 *            (`producer_boot_id`, `bus_counters_epoch`) trước khi tính delta;
 *          - `iop`: counter IOP 64 bit tích luỹ kể từ lúc tiến trình khởi động —
 *            epoch của chúng là (`producer_boot_id`, `counters_since_ms`).
 *
 *        Đi qua kênh điều khiển thay vì SHM: không đổi `kx_io_shm_t`, không bump
 *        `KX_SHM_MAGIC`, nên không buộc deploy đồng bộ iobus + core + web.
 *        Chạy trên luồng kênh điều khiển (không phải luồng poll RT).
 */
#ifndef IOBUS_FIELDBUS_CONTROL_STATUS_HPP
#define IOBUS_FIELDBUS_CONTROL_STATUS_HPP

#include <cstdint>
#include <string>

#include "modbus_rtu/fieldbus_metrics.hpp"

namespace iobus::fieldbus {

struct ControlStatusIdentity {
    uint64_t generation = 0;
    uint64_t config_revision = 0;
    uint64_t producer_boot_id = 0;
    uint64_t counters_since_ms = 0;
    uint32_t ext_count = 0;
    uint64_t sequence = 0;
};

/* Counter IOP tích luỹ (bản sao POD — adapter không phụ thuộc domain). */
struct IopCounterSnapshot {
    uint64_t rx = 0;
    uint64_t tx = 0;
    uint64_t crc_errors = 0;
    uint64_t seq_errors = 0;
    uint64_t timeouts = 0;
    uint64_t retries = 0;
    uint64_t nacks = 0;
};

/* JSON object KHÔNG có ngoặc ngoài — `ControlChannel` bọc `{"result":"ok",…}`. */
std::string control_status_fields(const ControlStatusIdentity& identity,
                                  const FieldbusMetrics::BusSnapshot& buses,
                                  const IopCounterSnapshot& iop);

} // namespace iobus::fieldbus

#endif /* IOBUS_FIELDBUS_CONTROL_STATUS_HPP */
