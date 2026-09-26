/**
 * @file  modbus_master.hpp
 * @brief MOD-006/007 + MBR-B101: điều phối các BusWorker Modbus RTU.
 *
 * `ModbusMaster` KHÔNG còn tự phát lệnh xuống dây. Nó chỉ:
 *   - chia slave theo `bus_id` và cấp phát dải ext slot toàn cục,
 *   - dựng một `BusWorker` cho mỗi bus và (tuỳ chế độ) một thread cho mỗi worker,
 *   - dịch lệnh EXT trong plc_shm (`ext_cmd_seq` + `setpoint`/`dirty`) thành
 *     `PendingWrite` gửi đúng worker — trên luồng `mb-extcmd` riêng (G7),
 *   - publish snapshot v2 ở MỘT chỗ duy nhất.
 *
 * Chạy priority thường (KHÔNG SCHED_FIFO — tránh chặn IOP 100 Hz).
 * Đường dẫn cổng lấy từ fieldbus.conf — KHÔNG hardcode trong code (plan 25 §1).
 */
#ifndef IOBUS_MODBUS_MASTER_HPP
#define IOBUS_MODBUS_MASTER_HPP

#include <atomic>
#include <array>
#include <condition_variable>
#include <cstdint>
#include <functional>
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

/* G7(a) (EV-PROG-FBD-ST-MB-20260925) — chu kỳ luồng `mb-extcmd` soi
 * `plc_shm.ext_cmd_seq`.
 *
 * Vì sao phải POLL: plc_shm v7 không có kênh báo thức nào. Core ghi bằng seqlock
 * (`seq` tăng MỖI scan 10 ms vì object table được ghi mỗi scan, nên `seq` không
 * nói được "có lệnh EXT mới"), không gọi FUTEX_WAKE, không có eventfd. Thêm một
 * kênh như vậy là đổi hợp đồng Core ↔ iobus và chèn syscall vào đường quét
 * SCHED_FIFO của Core (ngân sách C4 ADR-061) — ngoài phạm vi G7.
 *
 * Vì sao 5 ms: Core chỉ đổi `ext_cmd_seq` ở ranh giới base step 10 ms (ADR-061),
 * và spec G7 đòi phát hiện ≤ 10 ms. Chu kỳ P cho trễ phát hiện xấu nhất
 * P + trễ đánh thức SCHED_OTHER; P = 10 ms sẽ vượt spec ngay khi luồng bị lỡ
 * nhịp dù chỉ 1 µs. P = 5 ms chừa 5 ms cho trễ đánh thức trên kernel non-RT.
 * Chi phí có trần: 200 lần tỉnh/s, mỗi lần một phép so ≤ `KX_N_EXT` số 32-bit
 * (đường nhanh, không chụp snapshot) — xem `drain_ext_writes`. */
constexpr uint32_t kExtCommandPollMs = 5;
/* Chưa có bus nào ⇒ không có gì để ghi: soi thưa, khỏi tỉnh 200 lần/s vô ích. */
constexpr uint32_t kExtCommandIdlePollMs = 100;
/* Hàng đợi ghi của worker đầy ⇒ lệnh chưa được nhận, phải thử lại. Thử theo
 * nhịp 100 ms (nhịp cũ của `fb-publish`) chứ không theo 5 ms: mỗi lần đầy là
 * một dòng ERROR, và 200 dòng/s sẽ ngập journal mà không làm hàng đợi rỗng
 * nhanh hơn. */
constexpr uint32_t kExtWriteRetryMs = 100;

/* Nguồn plc_shm cho luồng `mb-extcmd`: trả ảnh hợp lệ hoặc nullptr. Chỉ được
 * gọi từ chính luồng đó. */
using PlcShmSource = std::function<const kx_plc_shm_t*()>;

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
     * COR-011 write bridge: đọc lệnh EXT từ plc_shm, enqueue PendingWrite cho
     * mỗi ext slot writable có `ext_cmd_seq` mới, gửi tới worker của đúng bus.
     * now_ms dùng làm mốc tính TTL của request (D-03).
     *
     * G7: có ĐƯỜNG NHANH. Khi không có mốc chờ lấy, không có lệnh chờ thử lại,
     * `ext_count` và mọi `ext_cmd_seq` của dải RTU đều trùng lần chụp trước thì
     * kết quả của một lượt đầy đủ chắc chắn là "không làm gì" — mọi hành động
     * đều cần `ext_cmd_seq != last_command_seq_` — nên hàm trả về ngay mà không
     * chụp snapshot 24 KB. Nhờ vậy gọi được mỗi 5 ms.
     */
    void drain_ext_writes(const kx_plc_shm_t* shm, uint64_t now_ms);

    /**
     * G7(a) — chạy luồng `mb-extcmd` (SCHED_OTHER): mỗi `period_ms` gọi
     * `source()` rồi `drain_ext_writes`. Mốc tỉnh là mốc TUYỆT ĐỐI; trễ quá một
     * chu kỳ thì bỏ mốc đã qua chứ không chạy dồn. Gọi lại khi đang chạy là
     * no-op. KHÔNG được gọi `stop_ext_command_watch` khi đang giữ `workers_mu_`
     * (luồng có thể đang chờ chính khoá đó).
     */
    void start_ext_command_watch(PlcShmSource source, uint32_t period_ms = kExtCommandPollMs);
    void stop_ext_command_watch();
    bool ext_command_watch_running() const;
    /* Số lần luồng `mb-extcmd` tỉnh — trần CPU kiểm được bằng số. */
    uint64_t ext_watch_ticks() const { return ext_watch_ticks_.load(std::memory_order_relaxed); }
    /* Số lượt `drain_ext_writes` chụp snapshot đầy đủ (không đi đường nhanh). */
    uint64_t ext_command_scans() const { return ext_command_scans_.load(std::memory_order_relaxed); }

    /* Đưa một lệnh ghi có danh tính request vào đúng bus (MBR-B107).
     * Trả false nếu không tìm được slave hoặc hàng đợi đầy.
     *
     * `MBA-FW-07`: `bus_id` ≠ 0 ⇒ chỉ tìm slave TRÊN BUS ĐÓ. `bus_id` = 0 chỉ
     * được chấp nhận khi địa chỉ slave là duy nhất trên mọi bus — validator cho
     * phép cùng `slave_id` trên hai dây khác nhau, nên "lấy slave đầu tiên khớp
     * địa chỉ" là ghi nhầm sang thiết bị của dây kia. */
    bool submit_write(const PendingWrite& w, uint8_t bus_id = 0);
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
    /* Đường nhanh của `drain_ext_writes`; gọi khi đã giữ `workers_mu_`. */
    bool ext_commands_unchanged(const kx_plc_shm_t* shm, uint64_t now_ms) const;
    void ext_watch_loop(const PlcShmSource& source, uint32_t period_ms);

    /* Bảo vệ `workers_`/`threads_` giữa luồng publish (đọc mỗi 100 ms), luồng
     * `mb-extcmd` (drain mỗi 5 ms) và luồng kênh điều khiển (`apply_config` thay
     * cả tập worker). Không có nó, `bind_workers` hoán đổi vector trong khi
     * publish hay drain đang duyệt nó. */
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
    /* Mỗi lệnh từ Core có sequence riêng. Giá trị không đủ làm danh tính:
     * lệnh cũ bị drop vẫn giữ dirty=1, trong khi lệnh Web mới có thể cùng giá
     * trị. Chỉ sequence mới phân biệt được hai trường hợp đó. */
    std::array<uint32_t, KX_N_EXT> last_command_seq_{};
    /* `MBA-FW-02` (audit Modbus 2026-09-25): lượt `drain_ext_writes` ĐẦU TIÊN
     * sau `open`/`apply_config` chỉ GHI NHẬN setpoint đang có trong plc_shm làm
     * mốc, không phát. Cờ `dirty` là cờ MỨC — Core đặt và không ai xoá — nên
     * không có mốc này thì mỗi lần iobus khởi động lại (deploy, crash, systemd
     * restart) mọi lệnh ghi cũ đều bị phát lại. Log bo Forlinx 2026-09-24
     * 08:36–08:39: 171 sự kiện ghi coil chỉ trong 3 phút đầu sau khởi động. */
    bool write_baseline_pending_ = true;
    /* Generation đã cảnh báo lệch danh tính slot — một dòng log cho mỗi lần
     * áp cấu hình, không phải một dòng mỗi lượt drain. */
    uint64_t identity_warn_generation_ = 0;
    /* G7 — ảnh `ext_count`/`ext_cmd_seq` ở lần chụp snapshot đầy đủ gần nhất;
     * đường nhanh so với ảnh này. Bảo vệ bởi `workers_mu_`. `observed_valid_`
     * về false mỗi lần dựng lại worker: ánh xạ slot đổi thì ảnh cũ vô nghĩa. */
    std::array<uint32_t, KX_N_EXT> observed_cmd_seq_{};
    uint16_t observed_ext_count_  = 0;
    bool     observed_valid_      = false;
    /* Lượt chụp trước có lệnh eligible mà worker từ chối (hàng đợi đầy) ⇒
     * `last_command_seq_` chưa tiêu nó, phải chụp lại từ `write_retry_at_ms_`. */
    bool     write_retry_pending_ = false;
    uint64_t write_retry_at_ms_   = 0;
    std::atomic<uint64_t> ext_command_scans_{0};
    std::atomic<uint64_t> ext_watch_ticks_{0};
    /* Luồng `mb-extcmd` và chuông dừng của nó. `watch_mu_` chỉ bảo vệ
     * `watch_stop_`; luồng KHÔNG giữ nó khi gọi `drain_ext_writes`. */
    std::thread             watch_thread_;
    mutable std::mutex      watch_mu_;
    std::condition_variable watch_cv_;
    bool                    watch_stop_ = false;
    /* ExtCache/metrics nội bộ cho overload open(cfg) một tham số (test cũ). */
    std::unique_ptr<ExtCache>       owned_cache_;
    std::unique_ptr<FieldbusMetrics> owned_metrics_;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_MODBUS_MASTER_HPP */
