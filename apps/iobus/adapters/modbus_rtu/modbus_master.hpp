/**
 * @file  modbus_master.hpp
 * @brief MOD-006/007 + MBR-B101: điều phối các BusWorker Modbus RTU.
 *
 * `ModbusMaster` KHÔNG còn tự phát lệnh xuống dây. Nó chỉ:
 *   - chia slave theo `bus_id` và cấp phát dải ext slot toàn cục,
 *   - dựng một `BusWorker` cho mỗi bus và (tuỳ chế độ) một thread cho mỗi worker,
 *   - dịch cờ `dirty` trong plc_shm thành `PendingWrite` gửi đúng worker,
 *   - publish snapshot v2 ở MỘT chỗ duy nhất.
 *
 * Chạy priority thường (KHÔNG SCHED_FIFO — tránh chặn IOP 100 Hz).
 * Đường dẫn cổng lấy từ fieldbus.conf — KHÔNG hardcode trong code (plan 25 §1).
 */
#ifndef IOBUS_MODBUS_MASTER_HPP
#define IOBUS_MODBUS_MASTER_HPP

#include <atomic>
#include <array>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "bus_worker.hpp"
#include "device_profile.hpp"
#include "ext_cache.hpp"
#include "fieldbus_config.hpp"
#include "fieldbus_metrics.hpp"
#include "poll_scheduler.hpp"
#include "mkddc_shm.h"

namespace iobus::fieldbus {

class ModbusMaster {
public:
    ~ModbusMaster();

    /**
     * Dựng worker từ fieldbus.conf và mở cổng của từng bus.
     * Trả true nếu **ít nhất một** bus mở được: một bus hỏng không được kéo
     * theo bus còn lại (FW_SOM_DESIGN §10 "cổng không tồn tại ⇒ bus PORT_ERROR
     * + backoff; bus còn lại vẫn chạy").
     */
    bool open(const FieldbusConfig& cfg, ExtCache& cache, FieldbusMetrics& metrics);
    /* Overload giữ chữ ký cũ cho test dùng ExtCache/metrics nội bộ. */
    bool open(const FieldbusConfig& cfg);
    void close();
    bool is_open() const;

    /**
     * Chạy 1 iteration cho MỌI worker rồi publish snapshot. Dùng ở chế độ
     * đơn luồng (test, và fallback khi chỉ có một bus).
     */
    void poll_once(uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics,
                   const std::string& fieldbus_sock_path);

    /* MBR-B101: một thread cho mỗi bus. Publisher vẫn là caller (main), nên
     * chỉ có một nguồn phát snapshot. */
    void start_workers(ExtCache& cache, FieldbusMetrics& metrics);
    void stop_workers();
    bool workers_running() const;

    /* Publish snapshot v2 + chốt cửa sổ latency của từng bus. */
    void publish(ExtCache& cache, FieldbusMetrics& metrics,
                 const std::string& fieldbus_sock_path, uint64_t window_us);

    /**
     * COR-011 write bridge: đọc dirty flags từ plc_shm, enqueue PendingWrite cho
     * mỗi ext slot writable đang dirty, gửi tới worker của đúng bus.
     * now_ms dùng làm mốc tính TTL của request (D-03).
     */
    void drain_ext_writes(const kx_plc_shm_t* shm, uint64_t now_ms);

    /* Đưa một lệnh ghi có danh tính request vào đúng bus (MBR-B107).
     * Trả false nếu không tìm được slave hoặc hàng đợi đầy. */
    bool submit_write(const PendingWrite& w);
    void set_write_result_sink(const WriteResultSink& sink);

    /* Tính số ms nên sleep trước khi poll_once() kế. 0 = có slave đến hạn ngay. */
    uint32_t sleep_ms_until_next(uint64_t now_ms) const;

    /* Tổng số ext slots đã cấp phát cho RTU slaves — TCP offset bắt đầu từ đây. */
    uint16_t total_ext_count() const { return ext_cursor_; }

    size_t bus_count() const;
    const BusWorker& bus(size_t i) const { return *workers_[i]; }
    BusWorker* bus_by_id(uint8_t id);

    /* Provenance publish ra snapshot (MBR-B104). */
    const SnapshotProvenance& provenance() const { return prov_; }

    /**
     * MBR-B106: nạp lại cấu hình tại ranh giới GIỮA hai transaction.
     *
     * Trình tự bắt buộc (FW_SOM_DESIGN §9): parse+validate → dừng worker ở
     * ranh giới an toàn → dựng generation G+1 → mở lại cổng → ACK.
     * Bất kỳ bước nào hỏng ⇒ **giữ nguyên generation cũ đang chạy** và trả
     * false kèm lý do. iobus KHÔNG tự restart để áp cấu hình: restart làm gián
     * đoạn cả IOP, và đó chính là D-09 mà B212 phải loại bỏ.
     *
     * `expected_revision` = 0 nghĩa là "lấy revision ghi trong file".
     */
    bool apply_config(const std::string& config_path, uint64_t expected_revision,
                      const std::string& expected_checksum, ExtCache& cache,
                      FieldbusMetrics& metrics, std::string* reason,
                      uint64_t* applied_revision, uint64_t* generation);

    /* Nạp danh sách slave/bus vào một FieldbusMetrics rỗng. `poll_once` gọi
     * lại khi thấy metrics chưa khớp cấu hình: caller (và test) truyền đối
     * tượng metrics của riêng mình, và một metrics rỗng làm `get(idx)` chạm
     * ngoài vector. */
    void init_metrics(FieldbusMetrics& metrics) const;

private:
    void bind_workers(const FieldbusConfig& cfg, ExtCache& cache, FieldbusMetrics& metrics);
    /* Biến thể KHÔNG tự khoá, dùng bên trong khi `workers_mu_` đã được giữ.
     * `apply_config` phải dừng rồi dựng lại worker trong CÙNG một vùng khoá:
     * tách ra hai lần khoá sẽ để lộ khoảnh khắc `workers_` rỗng cho luồng
     * publish nhìn thấy, và nó sẽ báo "không có bus nào" giữa lúc áp cấu hình. */
    void start_workers_locked(ExtCache& cache, FieldbusMetrics& metrics);
    void stop_workers_locked();

    /* Bảo vệ `workers_`/`threads_` giữa luồng publish (đọc mỗi 100 ms) và luồng
     * kênh điều khiển (`apply_config` thay cả tập worker). Không có nó,
     * `bind_workers` hoán đổi vector trong khi publish đang duyệt nó. */
    mutable std::mutex workers_mu_;

    /* unique_ptr vì BusWorker giữ fd và chạy trong thread — địa chỉ phải ổn định
     * khi vector realloc. */
    std::vector<std::unique_ptr<BusWorker>> workers_;
    std::vector<std::thread> threads_;
    std::atomic<bool>        stop_flag_{false};
    uint16_t                 ext_cursor_ = 0;
    FieldbusConfig           cfg_;
    SnapshotProvenance       prov_{};
    WriteResultSink          result_sink_;
    /* Dedup setpoint: chỉ ghi khi giá trị THẬT SỰ đổi so với lần ghi trước.
     * Không có bước này, một node logic giữ nguyên setpoint sẽ phát lệnh ghi ở
     * mọi vòng poll và chiếm trọn băng thông dây. */
    std::array<float, KX_N_EXT> last_written_{};
    std::array<bool, KX_N_EXT>  has_last_written_{};
    /* ExtCache/metrics nội bộ cho overload open(cfg) một tham số (test cũ). */
    std::unique_ptr<ExtCache>       owned_cache_;
    std::unique_ptr<FieldbusMetrics> owned_metrics_;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_MODBUS_MASTER_HPP */
