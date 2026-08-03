/**
 * @file  modbus_master.cpp
 * @brief MOD-006/007: Modbus RTU master implementation.
 *        libmodbus API calls guarded by MKDDC_ENABLE_MODBUS.
 *        Compile tanpa libmodbus: open() returns false, poll_once() no-op.
 */
#include "modbus_master.hpp"
#include "register_codec.hpp"

#include <cstdio>
#include <cstring>
#include <ctime>
#include <cerrno>
#include <cmath>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#endif

namespace iobus::fieldbus {

#ifdef MKDDC_ENABLE_MODBUS
static void ext_point_name(char out[24], const SlaveConfig& slave,
                           const ProfilePoint& point, uint16_t logical_index)
{
    if (ext_slots_for_point(point) == 1) {
        std::snprintf(out, 24, "%s", point.name.c_str());
    } else {
        std::snprintf(out, 24, "%s.%s[%u]", slave.name.c_str(),
                      point.name.c_str(), logical_index);
    }
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

    /* Giá trị từng slave được đặt lại ngay trước poll; 300 ms là mặc định bus. */
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
    slave_ext_count_.resize(cfg.slaves.size(), 0);
    slave_config_error_.assign(cfg.slaves.size(), 0);

    uint16_t ext_idx = 0;
    for (size_t i = 0; i < cfg.slaves.size(); i++) {
        slave_states_[i].poll_interval_ms = cfg.slaves[i].poll_ms;
        slave_states_[i].online = false;
        slave_ext_base_[i] = ext_idx;

        const std::string profile_path = find_profile_path(cfg.slaves[i].profile);
        if (profile_path.empty()) {
            std::fprintf(stderr, "ERROR modbus_master.profile_not_found slave=%s profile=%s"
                         " — slave KHÔNG được poll (lỗi cấu hình)\n",
                         cfg.slaves[i].name.c_str(), cfg.slaves[i].profile.c_str());
            slave_config_error_[i] = 1;
            continue;
        }
        load_device_profile(profile_path, &profiles_[i]);

        /* F-17: đếm theo ĐIỂM LUẬN LÝ, không theo số register. Trước đây đây là
         * `pts += pp.count` (số register) trong khi vòng đọc tiêu 1 slot cho mỗi
         * 2 register của điểm 32-bit → đặt trước gấp đôi số slot cần. */
        const uint16_t need = ext_slots_for_profile(profiles_[i]);
        if (need == 0) {
            /* Không có điểm đọc nào (profile rỗng, hoặc mọi điểm bị validate
             * loại, hoặc chỉ có FC ghi). Cũng là lỗi cấu hình: nếu để nguyên thì
             * read_slave chạy qua vòng points rỗng và báo slave ONLINE. */
            std::fprintf(stderr, "ERROR modbus_master.profile_no_readable_points slave=%s"
                         " profile=%s — slave KHÔNG được poll (lỗi cấu hình)\n",
                         cfg.slaves[i].name.c_str(), cfg.slaves[i].profile.c_str());
            slave_config_error_[i] = 1;
            continue;
        }

        const uint16_t avail = static_cast<uint16_t>(KX_N_EXT - ext_idx);
        if (need > avail) {
            /* F-16: tràn dải phải FAIL-CLOSED và ỒN ÀO.
             * Trước đây chỗ này `break` im lặng: các slave còn lại không được
             * load profile nên points rỗng, nhưng slave_states_ đã resize cho
             * TOÀN BỘ slave → poll_once vẫn gọi read_slave, vòng points rỗng
             * giữ slave_ok=true → on_poll_ok → slave báo ONLINE, error rate 0%,
             * không alarm E302, và không một dòng log nào.
             * Dùng `continue` chứ không `break`: xử lý dứt điểm từng slave, các
             * slave sau vẫn được xét (một slave nhỏ vẫn có thể vừa chỗ còn lại)
             * thay vì bị đẩy vào trạng thái nửa vời. */
            std::fprintf(stderr, "ERROR modbus_master.ext_slots_exhausted slave=%s addr=%u"
                         " need=%u avail=%u capacity=%u"
                         " — slave KHÔNG được poll (lỗi cấu hình)\n",
                         cfg.slaves[i].name.c_str(), cfg.slaves[i].addr,
                         need, avail, static_cast<unsigned>(KX_N_EXT));
            profiles_[i].points.clear();
            slave_config_error_[i] = 1;
            continue;
        }

        slave_ext_count_[i] = need;
        ext_idx = static_cast<uint16_t>(ext_idx + need);
    }

    std::fprintf(stderr, "INFO  modbus_master.open RS-485 opened %s %u%c8%u slaves=%zu total_ext=%u\n",
                 cfg.rs485.device.c_str(), cfg.rs485.baud, cfg.rs485.parity, cfg.rs485.stop, cfg.slaves.size(), ext_idx);
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
    for (auto& pending : pending_writes_) {
        if (!pending.submitted && pending.slave_addr == w.slave_addr &&
            pending.fc == w.fc && pending.reg_addr == w.reg_addr) {
            pending = w;  /* coalesce a newer setpoint for the same logical point */
            return;
        }
    }
    pending_writes_.push_back(w);
}

void ModbusMaster::drain_ext_writes(const kx_plc_shm_t* shm)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)shm;
#else
    if (!shm || !ctx_) return;

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

    for (size_t si = 0; si < profiles_.size(); si++) {
        const SlaveConfig& sc = cfg_.slaves[si];
        uint16_t ext_idx = slave_ext_base_[si];

        for (const auto& pt : profiles_[si].points) {
            /* Mirror read_slave(): only read FCs consume ext_idx slots
             * (ext_slots_for_point() áp đúng luật này) */
            if (ext_slots_for_point(pt) == 0) continue;

            const bool is32 = point_type_is_32bit(pt.type);
            for (uint16_t k = 0; k < pt.count; k++) {
                if (ext_idx >= KX_N_EXT) break;
                /* Khớp read_slave: register 32-bit lẻ ở cuối bị bỏ, không tiêu slot */
                if (is32 && k + 1 >= pt.count) break;

                if (pt.writable && ext_idx < snapshot.ext_count && snapshot.ext[ext_idx].dirty &&
                    (!has_last_written_[ext_idx] ||
                     last_written_[ext_idx] != snapshot.ext[ext_idx].setpoint)) {
                    /* Derive write FC from read FC + point type */
                    uint8_t wfc = 0;
                    if (pt.fc == 1) {
                        wfc = 5;   /* coil → FC05 write single coil */
                    } else if (pt.fc == 3) {
                        wfc = is32 ? 16u : 6u;  /* 32-bit → FC16, 16-bit → FC06 */
                    }
                    /* fc==2 discrete inputs, fc==4 input registers: not writable */
                    if (wfc != 0) {
                        PendingWrite w;
                        w.ext_idx    = ext_idx;
                        w.slave_addr = sc.addr;
                        w.fc         = wfc;
                        w.reg_addr   = static_cast<uint16_t>(pt.addr + k);
                        w.value      = snapshot.ext[ext_idx].setpoint;
                        w.type       = pt.type;
                        w.byte_order = pt.byte_order;
                        w.scale      = pt.scale;
                        w.offset     = pt.offset;
                        enqueue_write(w);
                    }
                }

                ext_idx++;
                /* 32-bit types consume 2 registers per logical point */
                if (is32) k++;
            }
        }
    }
#endif
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

    /* F-16 fail-closed: slave thiếu profile / không có điểm đọc / hết ext slot
     * KHÔNG được báo online. Không truy vấn nó, đi thẳng đường lỗi để
     * error_rate = 100% và E302 kích — kỹ thuật viên hiện trường thấy ngay thay
     * vì tình trạng "đèn xanh, bảng điểm trống, log im lặng". */
    if (slave_idx < slave_config_error_.size() && slave_config_error_[slave_idx]) {
        on_poll_error(&state, sc.retry);
        /* on_poll_error KHÔNG cập nhật last_poll_ms (có chủ đích: lỗi comm thật
         * được retry nhanh, bị chặn bởi timeout 300ms của libmodbus). Ở đây
         * không có I/O nào để chặn nên phải tự tôn trọng poll_interval, nếu
         * không vòng fieldbus sẽ spin ở mức 1ms. */
        state.last_poll_ms = now_ms;
        metrics.update(slave_idx, false, now_ms, sc.retry);
        cache.mark_slave_offline(slave_ext_base_[slave_idx],
                                 slave_ext_count_[slave_idx], sc.addr);
        if (metrics.check_e302(slave_idx, 1))
            std::fprintf(stderr, "ALARM E302 modbus.slave_config_error slave=%s addr=%u"
                         " — thiếu profile hoặc hết ext slot, slave không được poll\n",
                         sc.name.c_str(), sc.addr);
        return;
    }

    modbus_set_slave(ctx, sc.addr);
    modbus_set_response_timeout(ctx, sc.timeout_ms / 1000u,
                                (sc.timeout_ms % 1000u) * 1000u);

    uint16_t ext_idx = slave_ext_base_[slave_idx];
    bool slave_ok = true;

    /* Cấp danh tính slot trước lần I/O đầu tiên. Nhờ đó lần poll đầu bị lỗi vẫn
     * publish đúng Point ID và OFFLINE/STALE, không trả một bảng ext rỗng. */
    {
        uint16_t init_idx = slave_ext_base_[slave_idx];
        for (const auto& pt : prof.points) {
            if (ext_slots_for_point(pt) == 0) continue;
            const bool is32 = point_type_is_32bit(pt.type);
            uint16_t logical = 0;
            for (uint16_t k = 0; k < pt.count && init_idx < KX_N_EXT; k++) {
                if (is32 && k + 1 >= pt.count) break;
                if (cache.point(init_idx).name[0] == '\0') {
                    char name[24];
                    ext_point_name(name, sc, pt, logical);
                    cache.set_point(init_idx, name, 0.0f, KX_Q_UNCERTAIN,
                                    sc.addr, true, pt.writable);
                }
                init_idx++;
                logical++;
                if (is32) k++;
            }
        }
    }

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
            const bool went_offline = on_poll_error(&state, sc.retry);
            if (errno == ETIMEDOUT) metrics.record_timeout(slave_idx);
#ifdef EMBBADCRC
            if (errno == EMBBADCRC) metrics.record_crc_error(slave_idx);
#endif
            if (went_offline) {
                std::fprintf(stderr, "WARN  modbus.slave_offline slave=%s addr=%u\n",
                             sc.name.c_str(), sc.addr);
            }
            if (state.retry_count >= sc.retry) {
                cache.mark_slave_offline(slave_ext_base_[slave_idx],
                                         slave_ext_count_[slave_idx], sc.addr);
            } else {
                cache.mark_slave_stale(slave_ext_base_[slave_idx],
                                       slave_ext_count_[slave_idx], sc.addr);
            }
            break;
        }

        /* Decode mỗi điểm trong block */
        for (uint16_t k = 0; k < pt.count; k++) {
            if (ext_idx >= KX_N_EXT) break;
            char point_name[24];
            ext_point_name(point_name, sc, pt,
                           point_type_is_32bit(pt.type) ? k / 2u : k);

            float eng = 0.0f;
            if (pt.fc == 1 || pt.fc == 2) {
                eng = bits[k] ? 1.0f : 0.0f;
            } else {
                const bool is32 = point_type_is_32bit(pt.type);
                if (is32 && k + 1 >= pt.count) {
                    /* F-18: điểm 32-bit ở biên register lẻ. Loader đã chặn count
                     * lẻ từ 2026-07-30, đây là lưới an toàn cho ProfilePoint
                     * dựng thủ công. Xử lý GIỐNG modbus_tcp: log + bỏ điểm,
                     * KHÔNG tiêu ext slot.
                     * Trước đây RTU truyền count_this=1 cho decode_register →
                     * trả 0.0f, rồi `0*scale+offset` được publish với KX_Q_GOOD:
                     * một giá trị BỊA mang nhãn dữ liệu tốt. */
                    std::fprintf(stderr, "WARN  modbus.odd_32bit slave=%s pt=%s k=%u count=%u"
                                 " — profile misconfigured, point skipped\n",
                                 sc.name.c_str(), pt.name.c_str(), k, pt.count);
                    break;
                }
                eng = decode_register(regs + k, is32 ? 2u : 1u,
                                       pt.type, pt.byte_order,
                                       pt.scale, pt.offset);
                /* 32-bit điểm chiếm 2 registers, tăng k thêm 1 */
                if (is32) k++;
            }

            const kx_quality_t quality = std::isfinite(eng) ? KX_Q_GOOD : KX_Q_BAD;
            cache.set_point(ext_idx++, point_name, eng, quality,
                             sc.addr, true, pt.writable);
        }
    }

    if (slave_ok) {
        on_poll_ok(&state, now_ms);
        metrics.update(slave_idx, true, now_ms, sc.retry);
        /* Reset alarms khi online trở lại */
        if (metrics.get(slave_idx).e302_triggered)
            metrics.reset_alarms(slave_idx);
    } else {
        metrics.update(slave_idx, false, now_ms, sc.retry);
        if (metrics.check_e302(slave_idx, sc.retry))
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
            continue;  /* retain request for the next due poll */
        }
        if (w.ext_idx < KX_N_EXT) {
            last_written_[w.ext_idx] = w.value;
            has_last_written_[w.ext_idx] = true;
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
    if (metrics.size() != cfg_.slaves.size()) {
        std::vector<std::string> names;
        std::vector<uint8_t> addrs;
        names.reserve(cfg_.slaves.size());
        addrs.reserve(cfg_.slaves.size());
        for (const auto& slave : cfg_.slaves) {
            names.push_back(slave.name);
            addrs.push_back(slave.addr);
        }
        metrics.init(names, addrs);
    }
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
