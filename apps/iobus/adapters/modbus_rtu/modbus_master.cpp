/**
 * @file  modbus_master.cpp
 * @brief MOD-006/007 + MBR-B101: điều phối BusWorker.
 */
#include "modbus_master.hpp"
#include "fieldbus_time.hpp"
#include "thread_policy.hpp"

#include <algorithm>
#include <chrono>
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
    /* G7: ảnh `ext_cmd_seq` của generation cũ không nói gì về generation mới. */
    observed_valid_      = false;
    write_retry_pending_ = false;

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
    /* Dừng `mb-extcmd` TRƯỚC khi huỷ worker: luồng đó duyệt `workers_` trong
     * `drain_ext_writes`, còn `workers_.clear()` dưới đây không giữ khoá. */
    stop_ext_command_watch();
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
    /* G7(b): bật cờ TRƯỚC rồi mới đánh thức — `run_loop` đọc cờ trong cùng vùng
     * khoá với lần chờ, nên không lọt. Trước G7 join phải đợi worker ngủ hết
     * phần còn lại của trần 200 ms. */
    for (auto& worker : workers_) worker->wake();
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

bool ModbusMaster::submit_write(const PendingWrite& w, uint8_t bus_id)
{
    /* Giữ khoá suốt cả tìm-worker lẫn enqueue: `apply_config` có thể thay tập
     * worker giữa hai bước đó, và khi ấy con trỏ trả về đã trỏ vào worker vừa
     * bị huỷ. */
    std::lock_guard<std::mutex> lock(workers_mu_);
    const SlaveConfig* target = nullptr;
    size_t matches = 0;
    for (const auto& slave : cfg_.slaves) {
        if (slave.addr != w.slave_addr) continue;
        if (bus_id != 0 && slave.bus_id != bus_id) continue;
        if (target == nullptr) target = &slave;
        matches++;
    }
    if (matches > 1) {
        /* `MBA-FW-07`: cùng địa chỉ trên nhiều dây mà người gọi không nói dây
         * nào ⇒ TỪ CHỐI. Đoán ở đây là ghi xuống thiết bị của người khác. */
        std::fprintf(stderr, "ERROR modbus_master.write_ambiguous_slave addr=%u reg=%u buses=%zu"
                     " — cần bus_id, TỪ CHỐI lệnh ghi\n",
                     w.slave_addr, w.reg_addr, matches);
        return false;
    }
    if (target != nullptr) {
        BusWorker* worker = bus_by_id(target->bus_id);
        if (worker) return worker->enqueue_write(w);
    }
    std::fprintf(stderr, "ERROR modbus_master.write_slave_not_found bus=%u addr=%u reg=%u\n",
                 bus_id, w.slave_addr, w.reg_addr);
    return false;
}

bool ModbusMaster::ext_commands_unchanged(const kx_plc_shm_t* shm, uint64_t now_ms) const
{
    if (write_baseline_pending_ || !observed_valid_) return false;
    if (write_retry_pending_ && now_ms >= write_retry_at_ms_) return false;
    if (__atomic_load_n(&shm->ext_count, __ATOMIC_ACQUIRE) != observed_ext_count_) return false;
    /* Chỉ dải RTU `[0, ext_cursor_)`: slot TCP đứng sau và không đi đường ghi
     * này. Đọc từng số 32-bit bằng atomic load — không thể rách; nếu Core đang
     * ghi dở, lần soi này thấy giá trị cũ và lần 5 ms sau thấy giá trị mới. */
    const size_t n = std::min<size_t>(ext_cursor_, KX_N_EXT);
    for (size_t i = 0; i < n; i++) {
        if (__atomic_load_n(&shm->ext_cmd_seq[i], __ATOMIC_ACQUIRE) != observed_cmd_seq_[i])
            return false;
    }
    return true;
}

void ModbusMaster::drain_ext_writes(const kx_plc_shm_t* shm, uint64_t now_ms)
{
    std::lock_guard<std::mutex> lock(workers_mu_);
    if (!shm || workers_.empty()) return;
    /* Magic sai (Core chưa khởi tạo, hoặc layout khác) ⇒ không có gì tin được.
     * Kiểm TRƯỚC khi chụp: trước G7 lượt này tốn 5 lần memcpy 24 KB rồi mới bỏ. */
    if (__atomic_load_n(&shm->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) return;

    /* MBA-FW-08: lệnh đã bỏ KHÔNG được tạo lại chỉ vì cờ dirty vẫn là 1.
     * BusWorker giữ danh sách slot bỏ để chẩn đoán, nhưng chỉ ext_cmd_seq do
     * Core tăng mới chứng minh có intent mới. Không xoá dấu dedup khi drop. */
    for (auto& worker : workers_) {
        (void)worker->take_dropped_write_slots();
    }

    /* G7 — đường nhanh: không có gì đổi kể từ lần chụp trước ⇒ lượt đầy đủ
     * chắc chắn không phát lệnh nào (xem khai báo trong header). */
    if (ext_commands_unchanged(shm, now_ms)) return;

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
    if (baseline) last_command_seq_.fill(0);
    size_t seeded = 0;
    size_t identity_skipped = 0;
    size_t enqueue_rejected = 0;
    ext_command_scans_.fetch_add(1, std::memory_order_relaxed);

    /* U-07: lệnh của MỘT worker trong lượt này được gom lại rồi xếp vào hàng đợi
     * trong MỘT vùng khoá (`enqueue_writes`). Xếp từng lệnh một thì worker —
     * đã được đánh thức ngay ở lệnh đầu (G7) — có thể chụp hàng đợi khi mới có
     * một hai lệnh, và 8 coil Core đổi trong cùng một chu kỳ lên dây thành vài
     * giao dịch lẻ thay vì một FC15. */
    struct StagedWrite {
        PendingWrite       w;
        uint16_t           ext_idx;
        uint32_t           cmd_seq;
        bool               release;
        const SlaveConfig* slave;
        const ProfilePoint* point;
    };
    std::vector<StagedWrite> staged;
    std::vector<PendingWrite> staged_writes;
    for (auto& worker : workers_) {
        staged.clear();
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
                    /* F06 (EV-PROG-FBD-ST-MB-20260925): `dirty=0` đi cùng một
                     * `ext_cmd_seq` MỚI là Core NHẢ quyền ghi (Program Disable/
                     * Stop, hoặc lệnh cũ quá hold TTL). Chủ sở hữu chốt
                     * 2026-09-26: khi đó thiết bị về `safe_value` của điểm. */
                    bool release = false;
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
                            /* Tiêu command mang danh tính Point cũ. Khi tên
                             * slot khớp lại, sequence cũ vẫn không được ghi. */
                            last_command_seq_[ext_idx] = snapshot.ext_cmd_seq[ext_idx];
                            if (slot.dirty) identity_skipped++;
                            eligible = false;
                        } else if (baseline) {
                            /* Mốc cho CẢ slot đang nhả: iobus khởi động lại
                             * không được đọc một lần nhả cũ thành lệnh mới rồi
                             * ghi `safe_value` lên thiết bị đang chạy. */
                            last_command_seq_[ext_idx] = snapshot.ext_cmd_seq[ext_idx];
                            if (slot.dirty) seeded++;
                            eligible = false;
                        } else if (!slot.dirty) {
                            release = true;
                        }
                    }

                    if (eligible && release && snapshot.ext_cmd_seq[ext_idx] != 0 &&
                        snapshot.ext_cmd_seq[ext_idx] != last_command_seq_[ext_idx] &&
                        !pt.has_safe_value) {
                        /* Không khai `safe_value` ⇒ giữ giá trị cuối, nói ra
                         * đúng một lần cho mỗi lần nhả. */
                        std::fprintf(stderr, "WARN  modbus_master.ext_release_hold slave=%s point=%s"
                                     " — Program nhả quyền ghi nhưng điểm không khai safe_value;"
                                     " thiết bị GIỮ giá trị cuối\n",
                                     sc.name.c_str(), pt.name.c_str());
                        last_command_seq_[ext_idx] = snapshot.ext_cmd_seq[ext_idx];
                        eligible = false;
                    }
                    if (eligible && snapshot.ext_cmd_seq[ext_idx] != 0 &&
                        snapshot.ext_cmd_seq[ext_idx] != last_command_seq_[ext_idx]) {
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
                            w.value       = static_cast<float>(release ? pt.safe_value
                                                                       : snapshot.ext[ext_idx].setpoint);
                            w.type        = pt.type;
                            w.byte_order  = pt.byte_order;
                            w.scale       = pt.scale;
                            w.offset      = pt.offset;
                            w.enqueued_ms = now_ms;
                            staged.push_back({w, ext_idx, snapshot.ext_cmd_seq[ext_idx], release,
                                              &sc, &pt});
                        }
                    }

                    ext_idx++;
                    logical++;
                    if (is32) k++;   /* 32-bit tiêu 2 register cho một điểm */
                }
            }
        }
        if (staged.empty()) continue;
        staged_writes.clear();
        for (const auto& st : staged) staged_writes.push_back(st.w);
        const std::vector<bool> accepted = worker->enqueue_writes(staged_writes);
        for (size_t k = 0; k < staged.size(); k++) {
            const StagedWrite& st = staged[k];
            if (accepted[k]) {
                last_command_seq_[st.ext_idx] = st.cmd_seq;
                if (st.release)
                    std::fprintf(stderr, "INFO  modbus_master.ext_release_safe slave=%s"
                                 " point=%s safe_value=%g\n",
                                 st.slave->name.c_str(), st.point->name.c_str(),
                                 st.point->safe_value);
            } else {
                /* Hàng đợi đầy: sequence CHƯA được tiêu, lượt sau phải chụp lại
                 * dù `ext_cmd_seq` không đổi. */
                enqueue_rejected++;
            }
        }
    }

    /* G7: ghi ảnh cho đường nhanh — chỉ sau một lượt chụp NHẤT QUÁN. */
    std::copy(std::begin(snapshot.ext_cmd_seq), std::end(snapshot.ext_cmd_seq),
              observed_cmd_seq_.begin());
    observed_ext_count_  = snapshot.ext_count;
    observed_valid_      = true;
    write_retry_pending_ = enqueue_rejected > 0;
    if (write_retry_pending_) write_retry_at_ms_ = now_ms + kExtWriteRetryMs;

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

void ModbusMaster::start_ext_command_watch(PlcShmSource source, uint32_t period_ms)
{
    std::lock_guard<std::mutex> lock(watch_mu_);
    if (watch_thread_.joinable()) return;
    if (period_ms == 0) period_ms = 1;   /* 0 là vòng quay rỗng — cấm */
    watch_stop_ = false;
    watch_thread_ = std::thread([this, source = std::move(source), period_ms]() {
        ext_watch_loop(source, period_ms);
    });
    std::fprintf(stderr, "INFO  modbus_master.ext_watch_started period_ms=%u idle_period_ms=%u\n",
                 period_ms, std::max(period_ms, kExtCommandIdlePollMs));
}

void ModbusMaster::stop_ext_command_watch()
{
    {
        std::lock_guard<std::mutex> lock(watch_mu_);
        if (!watch_thread_.joinable()) return;
        watch_stop_ = true;
    }
    watch_cv_.notify_all();
    watch_thread_.join();
}

bool ModbusMaster::ext_command_watch_running() const
{
    std::lock_guard<std::mutex> lock(watch_mu_);
    return watch_thread_.joinable() && !watch_stop_;
}

void ModbusMaster::ext_watch_loop(const PlcShmSource& source, uint32_t period_ms)
{
    /* Thread tạo từ `main` đang SCHED_FIFO sẽ thừa hưởng nó (`MBA-FW-01`). */
    demote_to_normal_sched("mb-extcmd");
    using WatchClock = std::chrono::steady_clock;
    WatchClock::time_point next = WatchClock::now();
    std::unique_lock<std::mutex> lock(watch_mu_);
    while (!watch_stop_) {
        lock.unlock();
        const kx_plc_shm_t* shm = source ? source() : nullptr;
        drain_ext_writes(shm, monotonic_ms());
        ext_watch_ticks_.fetch_add(1, std::memory_order_relaxed);
        const uint32_t step_ms =
            (bus_count() > 0) ? period_ms : std::max(period_ms, kExtCommandIdlePollMs);
        lock.lock();
        const auto step = std::chrono::milliseconds(step_ms);
        next += step;
        const WatchClock::time_point now = WatchClock::now();
        /* Trễ ≥ một chu kỳ (chờ `workers_mu_` trong lúc `apply_config`, CPU
         * bận): bỏ mốc đã qua, KHÔNG chạy dồn một loạt lượt soi liền nhau. */
        if (next <= now) next = now + step;
        watch_cv_.wait_until(lock, next, [this]() { return watch_stop_; });
    }
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
