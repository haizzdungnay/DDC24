/**
 * @file  modbus_master.cpp
 * @brief MOD-006/007 + MBR-B101: điều phối BusWorker.
 */
#include "modbus_master.hpp"
#include "fieldbus_time.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace iobus::fieldbus {

ModbusMaster::~ModbusMaster()
{
    close();
}

void ModbusMaster::bind_workers(const FieldbusConfig& cfg, ExtCache& cache,
                                FieldbusMetrics& metrics)
{
    cfg_ = cfg;
    normalize_buses(&cfg_);
    workers_.clear();
    ext_cursor_ = 0;
    /* Generation mới ⇒ ánh xạ slot có thể đã đổi và dedup cũ vô nghĩa: lấy lại
     * mốc ở lượt drain kế tiếp thay vì phát lại (`MBA-FW-02`). */
    write_baseline_pending_ = true;

    init_metrics(metrics);

    for (const auto& bus : cfg_.buses) {
        std::vector<SlaveConfig> bus_slaves;
        std::vector<uint8_t> global_indices;
        for (size_t i = 0; i < cfg_.slaves.size(); i++) {
            if (cfg_.slaves[i].bus_id != bus.id) continue;
            bus_slaves.push_back(cfg_.slaves[i]);
            global_indices.push_back(static_cast<uint8_t>(i));
        }
        auto worker = std::make_unique<BusWorker>();
        worker->bind(bus, bus_slaves, global_indices, &ext_cursor_, cache);
        if (result_sink_) worker->set_write_result_sink(result_sink_);
        workers_.push_back(std::move(worker));
    }

    prov_.generation      = 1;
    prov_.config_revision = cfg_.revision;
    prov_.producer_boot_id = metrics.producer_boot_id();
    std::memset(prov_.config_checksum, 0, sizeof(prov_.config_checksum));
    std::strncpy(prov_.config_checksum, cfg_.checksum.c_str(),
                 sizeof(prov_.config_checksum) - 1);
    cache.set_provenance(prov_);
}

void ModbusMaster::init_metrics(FieldbusMetrics& metrics) const
{
    /* Metrics giữ thứ tự GLOBAL của cfg_.slaves để index metric không đổi khi
     * slave chuyển bus — API chẩn đoán và alarm đều tham chiếu theo index này. */
    std::vector<std::string> names;
    std::vector<uint8_t> addrs;
    std::vector<uint8_t> bus_ids;
    names.reserve(cfg_.slaves.size());
    addrs.reserve(cfg_.slaves.size());
    bus_ids.reserve(cfg_.slaves.size());
    for (const auto& slave : cfg_.slaves) {
        names.push_back(slave.name);
        addrs.push_back(slave.addr);
        bus_ids.push_back(slave.bus_id);
    }
    metrics.init(names, addrs, bus_ids);

    std::vector<BusMetrics> bus_metrics;
    for (const auto& bus : cfg_.buses) {
        BusMetrics bm;
        bm.id     = bus.id;
        bm.name   = bus.name;
        bm.device = bus.device;
        bm.baud   = bus.baud;
        bm.parity = bus.parity;
        bm.stop   = bus.stop;
        bm.state  = bus.enabled ? "OPENING" : "CLOSED";
        bus_metrics.push_back(bm);
    }
    metrics.init_buses(bus_metrics);
}

bool ModbusMaster::open(const FieldbusConfig& cfg, ExtCache& cache, FieldbusMetrics& metrics)
{
    bind_workers(cfg, cache, metrics);

    bool any_open = false;
    for (auto& worker : workers_) {
        if (worker->open_port()) any_open = true;
        metrics.set_bus_state(worker->bus_id(), bus_state_name(worker->state()));
    }
    if (!any_open && !workers_.empty()) {
        std::fprintf(stderr, "ERROR modbus_master.no_bus_opened buses=%zu"
                     " — mọi cổng RS-485 đều lỗi; worker sẽ backoff và thử lại\n",
                     workers_.size());
    }
    std::fprintf(stderr, "INFO  modbus_master.open buses=%zu slaves=%zu total_ext=%u\n",
                 workers_.size(), cfg_.slaves.size(), ext_cursor_);
    return any_open;
}

bool ModbusMaster::open(const FieldbusConfig& cfg)
{
    if (!owned_cache_)   owned_cache_   = std::make_unique<ExtCache>();
    if (!owned_metrics_) owned_metrics_ = std::make_unique<FieldbusMetrics>();
    return open(cfg, *owned_cache_, *owned_metrics_);
}

void ModbusMaster::close()
{
    stop_workers();
    for (auto& worker : workers_) worker->close_port();
    workers_.clear();
    ext_cursor_ = 0;
}

bool ModbusMaster::is_open() const
{
    for (const auto& worker : workers_)
        if (worker->port_open()) return true;
    return false;
}

BusWorker* ModbusMaster::bus_by_id(uint8_t id)
{
    for (auto& worker : workers_)
        if (worker->bus_id() == id) return worker.get();
    return nullptr;
}

void ModbusMaster::set_write_result_sink(const WriteResultSink& sink)
{
    result_sink_ = sink;
    for (auto& worker : workers_) worker->set_write_result_sink(sink);
}

void ModbusMaster::poll_once(uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics,
                             const std::string& fieldbus_sock_path)
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    /* Caller có thể truyền một metrics khác với metrics dùng lúc open() — đường
     * đi của test và của main. Metrics rỗng làm mọi `get(idx)` chạm ngoài
     * vector, nên đồng bộ trước khi worker chạm vào. */
    if (metrics.size() != cfg_.slaves.size() || metrics.bus_count() != cfg_.buses.size())
        init_metrics(metrics);
    for (auto& worker : workers_) worker->poll_once(now_ms, cache, metrics);
    cache.push_snapshot(fieldbus_sock_path);
}

void ModbusMaster::start_workers(ExtCache& cache, FieldbusMetrics& metrics)
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    start_workers_locked(cache, metrics);
}

void ModbusMaster::start_workers_locked(ExtCache& cache, FieldbusMetrics& metrics)
{
    if (!threads_.empty()) return;
    stop_flag_.store(false, std::memory_order_relaxed);
    for (auto& worker : workers_) {
        BusWorker* raw = worker.get();
        threads_.emplace_back([this, raw, &cache, &metrics]() {
            raw->run_loop(stop_flag_, cache, metrics);
        });
    }
    std::fprintf(stderr, "INFO  modbus_master.workers_started count=%zu\n", threads_.size());
}

void ModbusMaster::stop_workers()
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    stop_workers_locked();
}

void ModbusMaster::stop_workers_locked()
{
    if (threads_.empty()) return;
    stop_flag_.store(true, std::memory_order_relaxed);
    for (auto& thread : threads_)
        if (thread.joinable()) thread.join();
    threads_.clear();
}

bool ModbusMaster::workers_running() const
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    return !threads_.empty();
}

size_t ModbusMaster::bus_count() const
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    return workers_.size();
}

void ModbusMaster::publish(ExtCache& cache, FieldbusMetrics& metrics,
                           const std::string& fieldbus_sock_path, uint64_t window_us)
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    for (auto& worker : workers_) {
        metrics.set_bus_state(worker->bus_id(), bus_state_name(worker->state()));
        metrics.roll_bus_window(worker->bus_id(), window_us);
    }
    cache.push_snapshot(fieldbus_sock_path);
}

bool ModbusMaster::submit_write(const PendingWrite& w)
{
    /* Giữ khoá suốt cả tìm-worker lẫn enqueue: `apply_config` có thể thay tập
     * worker giữa hai bước đó, và khi ấy con trỏ trả về đã trỏ vào worker vừa
     * bị huỷ. */
    std::lock_guard<std::mutex> lock(workers_mu_);
    for (const auto& slave : cfg_.slaves) {
        if (slave.addr != w.slave_addr) continue;
        BusWorker* worker = bus_by_id(slave.bus_id);
        if (!worker) break;
        return worker->enqueue_write(w);
    }
    std::fprintf(stderr, "ERROR modbus_master.write_slave_not_found addr=%u reg=%u\n",
                 w.slave_addr, w.reg_addr);
    return false;
}

void ModbusMaster::drain_ext_writes(const kx_plc_shm_t* shm, uint64_t now_ms)
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    if (!shm || workers_.empty()) return;

    /* OD-MBRTU-005: lệnh ghi có vòng đời HỮU HẠN — 30 s TTL hoặc 3 lần phát,
     * điều kiện nào tới trước thì kết thúc. Khi nó kết thúc mà KHÔNG áp được,
     * dấu vết chống-phát-trùng phải bị xoá, nếu không lệnh mới mang đúng giá trị
     * cũ sẽ bị coi là trùng và không bao giờ xuống dây.
     *
     * Kịch bản thật: kỹ thuật viên đặt setpoint 50.0 lúc thiết bị mất điện ⇒
     * lệnh bị bỏ sau TTL. Thiết bị có điện lại, họ đặt LẠI 50.0 — và trước bản
     * sửa này, `last_written_` vẫn giữ 50.0 nên lệnh thứ hai bị nuốt im lặng.
     * Người vận hành thấy UI nhận lệnh, thiết bị thì không bao giờ nhận.
     *
     * Lưu ý ranh giới: TTL là tuổi thọ của LỆNH ĐANG CHỜ, không phải hẹn giờ
     * hoàn tác. Slave đã ACK ⇒ lệnh hoàn tất, giá trị nằm lại trên thiết bị. */
    for (auto& worker : workers_) {
        for (uint16_t ext_idx : worker->take_dropped_write_slots()) {
            if (ext_idx < KX_N_EXT) has_last_written_[ext_idx] = false;
        }
    }

    kx_plc_shm_t snapshot{};
    bool stable = false;
    for (int attempt = 0; attempt < 5; ++attempt) {
        const uint32_t before = __atomic_load_n(&shm->seq, __ATOMIC_ACQUIRE);
        if (before & 1u) continue;
        std::memcpy(&snapshot, shm, sizeof(snapshot));
        const uint32_t after = __atomic_load_n(&shm->seq, __ATOMIC_ACQUIRE);
        if (before == after) {
            stable = snapshot.magic == KX_SHM_MAGIC;
            break;
        }
    }
    if (!stable) return;

    /* `MBA-FW-02`: lượt mốc — xem `write_baseline_pending_`. */
    const bool baseline = write_baseline_pending_;
    if (baseline) has_last_written_.fill(false);
    size_t seeded = 0;
    size_t identity_skipped = 0;

    for (auto& worker : workers_) {
        for (size_t si = 0; si < worker->slave_count(); si++) {
            const BusSlaveBinding& binding = worker->slave(si);
            if (binding.config_error) continue;
            const SlaveConfig& sc = binding.cfg;
            uint16_t ext_idx = binding.ext_base;

            for (const auto& pt : binding.profile.points) {
                /* Mirror read_slave(): chỉ FC đọc mới tiêu ext slot. */
                if (ext_slots_for_point(pt) == 0) continue;

                const bool is32 = point_type_is_32bit(pt.type);
                uint16_t logical = 0;
                for (uint16_t k = 0; k < pt.count; k++) {
                    if (ext_idx >= KX_N_EXT) break;
                    /* Khớp read_slave: register 32-bit lẻ ở cuối bị bỏ. */
                    if (is32 && k + 1 >= pt.count) break;

                    bool eligible = pt.writable && ext_idx < snapshot.ext_count;
                    if (eligible) {
                        const kx_ext_point_t& slot = snapshot.ext[ext_idx];
                        /* `MBA-FW-02` — DANH TÍNH TRƯỚC, GIÁ TRỊ SAU. Slot `ext_idx`
                         * trong plc_shm phải đang mang đúng Point mà worker này
                         * gắn vào slot đó. Sau `apply_config`, iobus đổi ánh xạ
                         * ngay còn Core chỉ đổi tên slot khi nhận snapshot của
                         * generation mới; trong khoảng lệch đó setpoint/dirty ở
                         * slot là của Point CŨ, và phát nó ra là ghi giá trị của
                         * Point này xuống register của Point khác. */
                        char expected[24];
                        ext_point_name(expected, sc, pt, logical);
                        if (std::strncmp(slot.name, expected, sizeof(slot.name)) != 0) {
                            has_last_written_[ext_idx] = false;
                            if (slot.dirty) identity_skipped++;
                            eligible = false;
                        } else if (!slot.dirty) {
                            /* Chưa có lệnh nào ⇒ dedup không mang nghĩa gì. */
                            has_last_written_[ext_idx] = false;
                            eligible = false;
                        } else if (baseline) {
                            last_written_[ext_idx]     = static_cast<float>(slot.setpoint);
                            has_last_written_[ext_idx] = true;
                            seeded++;
                            eligible = false;
                        }
                    }

                    if (eligible &&
                        (!has_last_written_[ext_idx] ||
                         last_written_[ext_idx] !=
                             static_cast<float>(snapshot.ext[ext_idx].setpoint))) {
                        uint8_t wfc = 0;
                        if (pt.fc == 1) {
                            wfc = 5;   /* coil → FC05 write single coil */
                        } else if (pt.fc == 3) {
                            wfc = is32 ? 16u : 6u;  /* 32-bit → FC16, 16-bit → FC06 */
                        }
                        /* fc==2 discrete inputs, fc==4 input registers: không ghi được */
                        if (wfc != 0) {
                            PendingWrite w;
                            w.ext_idx     = ext_idx;
                            w.slave_addr  = sc.addr;
                            w.fc          = wfc;
                            w.reg_addr    = static_cast<uint16_t>(pt.addr + k);
                            w.value       = static_cast<float>(snapshot.ext[ext_idx].setpoint);
                            w.type        = pt.type;
                            w.byte_order  = pt.byte_order;
                            w.scale       = pt.scale;
                            w.offset      = pt.offset;
                            w.enqueued_ms = now_ms;
                            if (worker->enqueue_write(w)) {
                                last_written_[ext_idx]     = w.value;
                                has_last_written_[ext_idx] = true;
                            }
                        }
                    }

                    ext_idx++;
                    logical++;
                    if (is32) k++;   /* 32-bit tiêu 2 register cho một điểm */
                }
            }
        }
    }

    if (baseline) {
        write_baseline_pending_ = false;
        std::fprintf(stderr, "INFO  modbus_master.write_baseline generation=%llu seeded=%zu"
                     " — setpoint đang có trong plc_shm được lấy làm mốc, KHÔNG phát lại"
                     " (FW_SOM_DESIGN §10)\n",
                     static_cast<unsigned long long>(prov_.generation), seeded);
    }
    if (identity_skipped > 0 && !baseline) {
        /* Chỉ là khoảng lệch ngắn giữa iobus và Core sau apply_config; kéo dài
         * nghĩa là Core không nhận snapshot của generation mới. */
        if (identity_warn_generation_ != prov_.generation) {
            identity_warn_generation_ = prov_.generation;
            std::fprintf(stderr, "WARN  modbus_master.write_identity_mismatch generation=%llu"
                         " slots=%zu — tên slot trong plc_shm khác Point đang gắn; KHÔNG phát\n",
                         static_cast<unsigned long long>(prov_.generation), identity_skipped);
        }
    }
}

bool ModbusMaster::apply_config(const std::string& config_path, uint64_t expected_revision,
                                const std::string& expected_checksum, ExtCache& cache,
                                FieldbusMetrics& metrics, std::string* reason,
                                uint64_t* applied_revision, uint64_t* generation)
{
    auto fail = [&](const char* why) {
        if (reason) *reason = why;
        std::fprintf(stderr, "ERROR modbus_master.apply_reject reason=%s path=%s"
                     " — GIỮ generation %llu đang chạy\n",
                     why, config_path.c_str(),
                     static_cast<unsigned long long>(prov_.generation));
        return false;
    };

    FieldbusConfig next;
    if (!load_fieldbus_config(config_path, /*path_from_cli=*/true, &next))
        return fail("config_parse_error");
    if (!next.loaded)
        return fail("config_not_loaded");
    /* Kiểm chứng danh tính bản cấu hình TRƯỚC khi đụng vào worker: BE và iobus
     * phải chắc chắn đang nói về cùng một bản, nếu không thì ACK trả về một
     * revision mà BE không hề gửi. */
    if (expected_revision != 0 && next.revision != expected_revision)
        return fail("revision_mismatch");
    if (!expected_checksum.empty() && !next.checksum.empty() &&
        next.checksum.compare(0, expected_checksum.size(), expected_checksum) != 0)
        return fail("checksum_mismatch");

    normalize_buses(&next);
    if (!next.slaves.empty() && next.buses.empty())
        return fail("no_bus_configured");

    /* Ranh giới an toàn = GIỮA hai transaction Modbus, không phải giữa hai byte.
     * stop_workers() join từng thread, và mỗi thread chỉ thoát sau khi kết thúc
     * vòng poll đang chạy — đúng định nghĩa ranh giới đó. */
    /* Cả quá trình dừng → dựng lại → mở cổng → chạy lại nằm TRONG MỘT vùng
     * khoá. Nếu tách ra, luồng publish sẽ nhìn thấy khoảnh khắc `workers_` rỗng
     * ở giữa và báo "không có bus nào" ngay lúc đang áp cấu hình. */
    std::lock_guard<std::mutex> lock(workers_mu_);
    const uint64_t previous_generation = prov_.generation;
    stop_workers_locked();
    for (auto& worker : workers_) worker->close_port();

    const FieldbusConfig rollback = cfg_;
    bind_workers(next, cache, metrics);
    prov_.generation = previous_generation + 1;
    cache.set_provenance(prov_);

    bool any_open = false;
    for (auto& worker : workers_) {
        if (worker->open_port()) any_open = true;
        metrics.set_bus_state(worker->bus_id(), bus_state_name(worker->state()));
    }
    if (!any_open && !workers_.empty()) {
        /* Không mở được cổng nào với cấu hình mới ⇒ quay về bản cũ và REJECT.
         * Chạy tiếp với cấu hình mới ở đây nghĩa là tự tay đưa hệ thống vào
         * trạng thái không có I/O nào, chỉ vì một lần gõ nhầm đường dẫn cổng. */
        bind_workers(rollback, cache, metrics);
        prov_.generation = previous_generation;
        cache.set_provenance(prov_);
        for (auto& worker : workers_) worker->open_port();
        start_workers_locked(cache, metrics);
        return fail("no_port_could_be_opened");
    }

    start_workers_locked(cache, metrics);
    if (applied_revision) *applied_revision = cfg_.revision;
    if (generation)       *generation       = prov_.generation;
    std::fprintf(stderr, "INFO  modbus_master.apply_ack revision=%llu generation=%llu buses=%zu"
                 " slaves=%zu total_ext=%u\n",
                 static_cast<unsigned long long>(cfg_.revision),
                 static_cast<unsigned long long>(prov_.generation),
                 workers_.size(), cfg_.slaves.size(), ext_cursor_);
    return true;
}

uint32_t ModbusMaster::sleep_ms_until_next(uint64_t now_ms) const
{
    if (workers_.empty()) return 1000;
    uint32_t min_ms = 1000;
    for (const auto& worker : workers_) {
        const uint32_t d = worker->sleep_ms_until_next(now_ms);
        if (d < min_ms) min_ms = d;
    }
    return min_ms;
}

} // namespace iobus::fieldbus
