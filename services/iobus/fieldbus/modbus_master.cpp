/**
 * @file  modbus_master.cpp
 * @brief MOD-006/007: Modbus RTU master implementation.
 *        libmodbus API calls guarded by MKDDC_ENABLE_MODBUS.
 *        Compile tanpa libmodbus: open() returns false, poll_once() no-op.
 */
#include "modbus_master.hpp"

#include <cstdio>
#include <cstring>
#include <ctime>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#endif

namespace iobus::fieldbus {

#ifdef MKDDC_ENABLE_MODBUS
static uint64_t now_ms_fn()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000ull +
           static_cast<uint64_t>(ts.tv_nsec) / 1000000ull;
}
#endif

ModbusMaster::~ModbusMaster()
{
    close();
}

bool ModbusMaster::open(const FieldbusConfig& cfg)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)cfg;
    std::fprintf(stderr, "WARN  modbus_master.disabled (build without MKDDC_ENABLE_MODBUS)\n");
    return false;
#else
    cfg_ = cfg;

    /* rs485.device từ config — không hardcode (plan 25 §1) */
    const char* parity_str = "N";
    char par[2] = {cfg.rs485.parity, '\0'};
    parity_str = par;

    modbus_t* ctx = modbus_new_rtu(cfg.rs485.device.c_str(),
                                   static_cast<int>(cfg.rs485.baud),
                                   parity_str[0],
                                   8, cfg.rs485.stop);
    if (!ctx) {
        std::fprintf(stderr, "ERROR modbus_master.new_rtu_fail device=%s errno=%s\n",
                     cfg.rs485.device.c_str(), modbus_strerror(errno));
        return false;
    }

    /* Timeout 300ms/response (MODBUS_REGISTER_MAP §2) */
    modbus_set_response_timeout(ctx, 0, 300000);
    modbus_set_byte_timeout(ctx, 0, 50000);

    if (modbus_connect(ctx) != 0) {
        std::fprintf(stderr, "ERROR modbus_master.connect_fail device=%s err=%s\n",
                     cfg.rs485.device.c_str(), modbus_strerror(errno));
        modbus_free(ctx);
        return false;
    }

    ctx_ = static_cast<void*>(ctx);

    /* Init slave states + load profiles */
    slave_states_.resize(cfg.slaves.size());
    profiles_.resize(cfg.slaves.size());
    slave_ext_base_.resize(cfg.slaves.size(), 0);

    uint16_t ext_idx = 0;
    for (size_t i = 0; i < cfg.slaves.size(); i++) {
        slave_states_[i].poll_interval_ms = cfg.slaves[i].poll_ms;
        slave_states_[i].online = false;
        slave_ext_base_[i] = ext_idx;

        const std::string profile_path = find_profile_path(cfg.slaves[i].profile);
        if (profile_path.empty()) {
            std::fprintf(stderr, "ERROR modbus_master.profile_not_found slave=%s profile=%s"
                         " — slave bỏ qua\n",
                         cfg.slaves[i].name.c_str(), cfg.slaves[i].profile.c_str());
        } else {
            load_device_profile(profile_path, &profiles_[i]);
        }

        /* Đếm số ext points cho slave này */
        uint16_t pts = 0;
        for (const auto& pp : profiles_[i].points)
            pts += pp.count;
        ext_idx = static_cast<uint16_t>(ext_idx + pts);
        if (ext_idx > KX_N_EXT) { ext_idx = KX_N_EXT; break; }
    }

    std::fprintf(stderr, "INFO  modbus_master.open device=%s slaves=%zu total_ext=%u\n",
                 cfg.rs485.device.c_str(), cfg.slaves.size(), ext_idx);
    return true;
#endif
}

void ModbusMaster::close()
{
#ifdef MKDDC_ENABLE_MODBUS
    if (ctx_) {
        modbus_t* ctx = static_cast<modbus_t*>(ctx_);
        modbus_close(ctx);
        modbus_free(ctx);
        ctx_ = nullptr;
    }
#endif
}

void ModbusMaster::enqueue_write(const PendingWrite& w)
{
    pending_writes_.push_back(w);
}

uint32_t ModbusMaster::sleep_ms_until_next(uint64_t now_ms) const
{
    if (slave_states_.empty()) return 1000;
    uint32_t min_ms = slave_states_[0].poll_interval_ms;
    for (const auto& s : slave_states_) {
        const uint32_t d = next_due_ms(s, now_ms);
        if (d < min_ms) min_ms = d;
    }
    return min_ms;
}

#ifdef MKDDC_ENABLE_MODBUS
static const char* type_str(PointType t) {
    switch (t) {
        case PointType::Bool: return "bool";
        case PointType::Int16: return "int16";
        case PointType::Uint16: return "uint16";
        case PointType::Int32: return "int32";
        case PointType::Uint32: return "uint32";
        case PointType::Float32: return "float32";
    }
    return "?";
}
#endif

void ModbusMaster::read_slave(uint8_t slave_idx, uint64_t now_ms,
                               ExtCache& cache, FieldbusMetrics& metrics)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)slave_idx; (void)now_ms; (void)cache; (void)metrics;
#else
    if (slave_idx >= slave_states_.size()) return;
    modbus_t* ctx = static_cast<modbus_t*>(ctx_);
    const SlaveConfig& sc = cfg_.slaves[slave_idx];
    const DeviceProfile& prof = profiles_[slave_idx];
    SlaveState& state = slave_states_[slave_idx];

    modbus_set_slave(ctx, sc.addr);

    uint16_t ext_idx = slave_ext_base_[slave_idx];
    bool slave_ok = true;

    for (const auto& pt : prof.points) {
        if (pt.fc != 1 && pt.fc != 2 && pt.fc != 3 && pt.fc != 4) continue;

        /* Read block */
        uint16_t regs[125] = {};
        uint8_t  bits[2000] = {};
        int rc = -1;

        if (pt.fc == 1)
            rc = modbus_read_bits(ctx, pt.addr, pt.count, bits);
        else if (pt.fc == 2)
            rc = modbus_read_input_bits(ctx, pt.addr, pt.count, bits);
        else if (pt.fc == 3)
            rc = modbus_read_registers(ctx, pt.addr, pt.count, regs);
        else if (pt.fc == 4)
            rc = modbus_read_input_registers(ctx, pt.addr, pt.count, regs);

        if (rc < 0) {
            slave_ok = false;
            /* retry tracking trong on_poll_error */
            const bool went_offline = on_poll_error(&state);
            if (went_offline) {
                std::fprintf(stderr, "WARN  modbus.slave_offline slave=%s addr=%u\n",
                             sc.name.c_str(), sc.addr);
            }
            /* Đánh offline ext points */
            cache.mark_slave_offline(slave_ext_base_[slave_idx],
                                      static_cast<uint16_t>(prof.points.size()),
                                      sc.addr);
            break;
        }

        /* Decode mỗi điểm trong block */
        for (uint16_t k = 0; k < pt.count; k++) {
            if (ext_idx >= KX_N_EXT) break;
            char point_name[24];
            std::snprintf(point_name, sizeof(point_name), "%s.%s[%u]",
                          sc.name.c_str(), pt.name.c_str(), k);

            float eng = 0.0f;
            if (pt.fc == 1 || pt.fc == 2) {
                eng = bits[k] ? 1.0f : 0.0f;
            } else {
                const uint16_t count_this = (k + 1 < pt.count) ? 2u : 1u;
                eng = decode_register(regs + k, count_this,
                                       pt.type, pt.byte_order,
                                       pt.scale, pt.offset);
                /* 32-bit điểm chiếm 2 registers, tăng k thêm 1 */
                if (pt.type == PointType::Int32 || pt.type == PointType::Uint32 ||
                    pt.type == PointType::Float32) k++;
            }

            cache.set_point(ext_idx++, point_name, eng, KX_Q_GOOD,
                             sc.addr, true, pt.writable);
        }
    }

    if (slave_ok) {
        on_poll_ok(&state, now_ms);
        metrics.update(slave_idx, true, now_ms);
        /* Reset alarms khi online trở lại */
        if (metrics.get(slave_idx).e302_triggered)
            metrics.reset_alarms(slave_idx);
    } else {
        metrics.update(slave_idx, false, now_ms);
        if (metrics.check_e302(slave_idx))
            std::fprintf(stderr, "ALARM E302 modbus.slave_offline slave=%s addr=%u\n",
                         sc.name.c_str(), sc.addr);
        if (metrics.check_e303(slave_idx))
            std::fprintf(stderr, "ALARM E303 modbus.error_rate_high slave=%s rate=%.1f%%\n",
                         sc.name.c_str(), metrics.get(slave_idx).error_rate() * 100.0f);
    }
#endif
}

void ModbusMaster::flush_pending(uint8_t slave_idx)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)slave_idx;
#else
    modbus_t* ctx = static_cast<modbus_t*>(ctx_);
    const SlaveConfig& sc = cfg_.slaves[slave_idx];
    modbus_set_slave(ctx, sc.addr);

    for (auto& w : pending_writes_) {
        if (w.slave_addr != sc.addr || w.submitted) continue;
        uint16_t regs[2] = {};
        uint8_t  coil = 0;
        int rc = -1;

        if (w.fc == 5 || w.fc == 15) {
            coil = (w.value != 0.0f) ? 1u : 0u;
            if (w.fc == 5)       rc = modbus_write_bit(ctx, w.reg_addr, coil);
            else /* fc==15 */    rc = modbus_write_bits(ctx, w.reg_addr, 1, &coil);
        } else if (w.fc == 6 || w.fc == 16) {
            if (!encode_register(w.value, regs, 2, w.type, w.byte_order, w.scale, w.offset)) {
                w.submitted = true;
                continue;
            }
            if (w.fc == 6)      rc = modbus_write_register(ctx, w.reg_addr, regs[0]);
            else /* fc==16 */    rc = modbus_write_registers(ctx, w.reg_addr, 2, regs);
        }

        if (rc < 0) {
            std::fprintf(stderr, "WARN  modbus.write_fail slave=%s fc=%u addr=%u err=%s\n",
                         sc.name.c_str(), w.fc, w.reg_addr, modbus_strerror(errno));
        }
        w.submitted = true;
    }

    /* Xóa các write đã xử lý */
    auto it = pending_writes_.begin();
    while (it != pending_writes_.end()) {
        if (it->submitted) it = pending_writes_.erase(it);
        else ++it;
    }
#endif
}

void ModbusMaster::poll_once(uint64_t now_ms, ExtCache& cache,
                              FieldbusMetrics& metrics,
                              const std::string& fieldbus_sock_path)
{
    if (!ctx_) return;
    for (size_t i = 0; i < slave_states_.size(); i++) {
        if (!is_due(slave_states_[i], now_ms)) continue;
        read_slave(static_cast<uint8_t>(i), now_ms, cache, metrics);
        flush_pending(static_cast<uint8_t>(i));
    }
    /* Push snapshot sau mỗi vòng poll (SW_FIELDBUS_DESIGN §10) */
    cache.push_snapshot(fieldbus_sock_path);
}

void ModbusMaster::write_slave(uint8_t slave_idx, FieldbusMetrics& metrics)
{
    flush_pending(slave_idx);
    (void)metrics;
}

} // namespace iobus::fieldbus
