/**
 * @file  modbus_tcp.cpp
 * @brief MOD-013: Modbus TCP client implementation.
 *        Reconnect state machine: DISCONNECTED → try_connect() → CONNECTED → poll.
 *        libmodbus API guarded by MKDDC_ENABLE_MODBUS; logic no-ops khi disabled.
 */
#include "modbus_tcp.hpp"
#include "register_codec.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#endif

namespace iobus::fieldbus {

static uint64_t tcp_now_ms()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000ull +
           static_cast<uint64_t>(ts.tv_nsec) / 1000000ull;
}

ModbusTcp::~ModbusTcp()
{
    close();
}

bool ModbusTcp::open(const FieldbusConfig& cfg, uint16_t ext_offset)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)cfg; (void)ext_offset;
    std::fprintf(stderr, "WARN  modbus_tcp.disabled (build without MKDDC_ENABLE_MODBUS)\n");
    return false;
#else
    if (cfg.tcp_slaves.empty()) return false;

    uint16_t idx = ext_offset;
    for (const auto& ts : cfg.tcp_slaves) {
        TcpConn conn;
        conn.cfg      = ts;
        conn.ext_base = idx;
        conn.state.poll_interval_ms = ts.poll_ms;

        const std::string profile_path = find_profile_path(ts.profile);
        if (profile_path.empty()) {
            std::fprintf(stderr, "ERROR modbus_tcp.profile_not_found slave=%s profile=%s"
                         " — slave KHÔNG được poll (lỗi cấu hình)\n",
                         ts.name.c_str(), ts.profile.c_str());
            conn.config_error = true;
        } else {
            load_device_profile(profile_path, &conn.profile);
        }

        if (!conn.config_error) {
            /* F-17: đếm theo ĐIỂM LUẬN LÝ qua ext_slots_for_profile(), không
             * theo số register (`pts += pp.count` cũ). */
            const uint16_t need  = ext_slots_for_profile(conn.profile);
            const uint16_t avail = (idx < KX_N_EXT) ? static_cast<uint16_t>(KX_N_EXT - idx) : 0u;
            if (need == 0) {
                std::fprintf(stderr, "ERROR modbus_tcp.profile_no_readable_points slave=%s"
                             " profile=%s — slave KHÔNG được poll (lỗi cấu hình)\n",
                             ts.name.c_str(), ts.profile.c_str());
                conn.config_error = true;
            } else if (need > avail) {
                /* F-08: trước đây chỗ này chỉ clamp `if (idx > KX_N_EXT) idx =
                 * KX_N_EXT;` — KHÔNG log và KHÔNG clamp conn.ext_count. Khi RTU
                 * đã tiêu hết 64 slot, mọi TCP slave nhận ext_base=64, read_conn
                 * gặp `ext_idx >= KX_N_EXT` ngay ở point đầu và thoát với
                 * slave_ok=true → on_poll_ok → slave báo ONLINE và khỏe mạnh mà
                 * không publish nổi một điểm nào. */
                std::fprintf(stderr, "ERROR modbus_tcp.ext_slots_exhausted slave=%s host=%s:%u"
                             " need=%u avail=%u capacity=%u"
                             " — slave KHÔNG được poll (lỗi cấu hình)\n",
                             ts.name.c_str(), ts.host.c_str(), ts.port,
                             need, avail, static_cast<unsigned>(KX_N_EXT));
                conn.config_error = true;
            } else {
                conn.ext_count = need;
                idx = static_cast<uint16_t>(idx + need);
            }
        }

        if (conn.config_error) {
            /* Fail-closed: không mở kết nối, không đặt trước slot nào. Slave giữ
             * trạng thái offline (on_poll_ok không bao giờ được gọi) nên không
             * bao giờ hiện "xanh" trên bảng điểm. */
            conn.profile.points.clear();
            conn.ext_count = 0;
        } else if (!try_connect(conn)) {
            /* Attempt initial connect; failure is non-fatal (will retry in poll_once) */
            conn.next_reconnect_ms = tcp_now_ms() + static_cast<uint64_t>(ts.reconnect_s) * 1000ull;
        }

        conns_.push_back(std::move(conn));
    }

    total_ext_count_ = static_cast<uint16_t>(idx - ext_offset);
    std::fprintf(stderr, "INFO  modbus_tcp.open tcp_slaves=%zu total_ext=%u\n",
                 conns_.size(), total_ext_count_);
    return !conns_.empty();
#endif
}

void ModbusTcp::close()
{
#ifdef MKDDC_ENABLE_MODBUS
    for (auto& conn : conns_) free_ctx(conn);
#endif
    conns_.clear();
    total_ext_count_ = 0;
}

bool ModbusTcp::try_connect(TcpConn& conn)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)conn;
    return false;
#else
    free_ctx(conn);

    modbus_t* ctx = modbus_new_tcp(conn.cfg.host.c_str(), conn.cfg.port);
    if (!ctx) {
        std::fprintf(stderr, "WARN  modbus_tcp.new_fail slave=%s host=%s:%u\n",
                     conn.cfg.name.c_str(), conn.cfg.host.c_str(), conn.cfg.port);
        return false;
    }

    const uint32_t timeout_sec = conn.cfg.timeout_ms / 1000u;
    const uint32_t timeout_us  = (conn.cfg.timeout_ms % 1000u) * 1000u;
    if (modbus_set_response_timeout(ctx, timeout_sec, timeout_us) != 0) {
        std::fprintf(stderr, "WARN  modbus_tcp.timeout_invalid slave=%s timeout_ms=%u\n",
                     conn.cfg.name.c_str(), conn.cfg.timeout_ms);
        modbus_free(ctx);
        return false;
    }
    modbus_set_byte_timeout(ctx, 0, 50000u);

    if (modbus_connect(ctx) != 0) {
        std::fprintf(stderr, "WARN  modbus_tcp.connect_fail slave=%s host=%s:%u err=%s\n",
                     conn.cfg.name.c_str(), conn.cfg.host.c_str(), conn.cfg.port,
                     modbus_strerror(errno));
        modbus_free(ctx);
        return false;
    }

    modbus_set_slave(ctx, conn.cfg.unit);
    conn.ctx       = static_cast<void*>(ctx);
    conn.connected = true;
    conn.offline_published = false;
    std::fprintf(stderr, "INFO  modbus_tcp.connected slave=%s host=%s:%u unit=%u\n",
                 conn.cfg.name.c_str(), conn.cfg.host.c_str(), conn.cfg.port, conn.cfg.unit);
    return true;
#endif
}

void ModbusTcp::free_ctx(TcpConn& conn)
{
#ifdef MKDDC_ENABLE_MODBUS
    if (conn.ctx) {
        modbus_t* ctx = static_cast<modbus_t*>(conn.ctx);
        modbus_close(ctx);
        modbus_free(ctx);
        conn.ctx = nullptr;
    }
#else
    (void)conn;
#endif
    conn.connected = false;
}

void ModbusTcp::mark_offline(TcpConn& conn, ExtCache& cache)
{
    free_ctx(conn);
    cache.mark_slave_offline(conn.ext_base, conn.ext_count, conn.cfg.unit);
    conn.offline_published = true;
    const uint64_t now = tcp_now_ms();
    conn.next_reconnect_ms = now + static_cast<uint64_t>(conn.cfg.reconnect_s) * 1000ull;
    std::fprintf(stderr, "WARN  modbus_tcp.slave_offline slave=%s host=%s — retry in %us\n",
                 conn.cfg.name.c_str(), conn.cfg.host.c_str(), conn.cfg.reconnect_s);
}

void ModbusTcp::read_conn(TcpConn& conn, uint64_t now_ms, ExtCache& cache)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)conn; (void)now_ms; (void)cache;
#else
    modbus_t* ctx = static_cast<modbus_t*>(conn.ctx);
    uint16_t ext_idx = conn.ext_base;
    bool slave_ok = true;

    for (const auto& pt : conn.profile.points) {
        if (ext_slots_for_point(pt) == 0) continue;   /* FC ghi không chiếm slot */
        if (ext_idx >= KX_N_EXT) break;

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
            break;
        }

        for (uint16_t k = 0; k < pt.count; k++) {
            if (ext_idx >= KX_N_EXT) break;
            char pt_name[24];
            std::snprintf(pt_name, sizeof(pt_name), "%s.%s[%u]",
                          conn.cfg.name.c_str(), pt.name.c_str(), k);

            float eng = 0.0f;
            if (pt.fc == 1 || pt.fc == 2) {
                eng = bits[k] ? 1.0f : 0.0f;
            } else {
                const bool is32 = point_type_is_32bit(pt.type);
                if (is32 && k + 1 >= pt.count) {
                    /* Misconfigured profile: 32-bit type at odd register boundary — skip.
                     * F-17: KHÔNG tiêu ext slot cho register lẻ này. Alignment
                     * của các điểm sau được ext_slots_for_profile() bảo đảm (nó
                     * cũng làm tròn xuống), nên tiêu một slot ở đây chỉ sinh
                     * đúng một điểm rỗng name=""/quality=BAD lọt vào snapshot. */
                    std::fprintf(stderr, "WARN  modbus_tcp.odd_32bit slave=%s pt=%s k=%u count=%u"
                                 " — profile misconfigured, point skipped\n",
                                 conn.cfg.name.c_str(), pt.name.c_str(), k, pt.count);
                    break;
                }
                const uint16_t cnt2 = is32 ? 2u : 1u;
                eng = decode_register(regs + k, cnt2,
                                      pt.type, pt.byte_order,
                                      pt.scale, pt.offset);
                if (is32) k++;
            }

            cache.set_point(ext_idx++, pt_name, eng, KX_Q_GOOD,
                             conn.cfg.unit, true, pt.writable);
        }
    }

    if (slave_ok) {
        on_poll_ok(&conn.state, now_ms);
    } else {
        on_poll_error(&conn.state);
        mark_offline(conn, cache);
    }
#endif
}

void ModbusTcp::poll_once(uint64_t now_ms, ExtCache& cache,
                           const std::string& fieldbus_sock_path)
{
    if (conns_.empty()) return;
    bool pushed = false;

    for (auto& conn : conns_) {
        /* F-08 fail-closed: slave lỗi cấu hình không được kết nối và không bao
         * giờ đi qua on_poll_ok, nên không bao giờ báo online. Log ERROR đã phát
         * ở open() nêu rõ tên slave, số slot cần vs còn lại. */
        if (conn.config_error) continue;

        /* Reconnect if disconnected and timer expired */
        if (!conn.connected) {
            if (now_ms >= conn.next_reconnect_ms) {
                if (!try_connect(conn)) {
                    conn.next_reconnect_ms = now_ms +
                        static_cast<uint64_t>(conn.cfg.reconnect_s) * 1000ull;
                }
            }
            if (!conn.connected) {
                if (!conn.offline_published) {
                    cache.mark_slave_offline(conn.ext_base, conn.ext_count, conn.cfg.unit);
                    conn.offline_published = true;
                    pushed = true;  /* publish the offline transition once */
                }
                continue;
            }
        }

        if (!is_due(conn.state, now_ms)) continue;

        read_conn(conn, now_ms, cache);
        pushed = true;
    }

    if (pushed) cache.push_snapshot(fieldbus_sock_path);
}

uint32_t ModbusTcp::sleep_ms_until_next(uint64_t now_ms) const
{
    if (conns_.empty()) return 1000u;
    uint32_t min_ms = 1000u;
    for (const auto& conn : conns_) {
        if (!conn.connected) {
            const uint64_t wait = (conn.next_reconnect_ms > now_ms)
                                  ? (conn.next_reconnect_ms - now_ms) : 0u;
            const uint32_t w32 = (wait > 1000u) ? 1000u : static_cast<uint32_t>(wait);
            if (w32 < min_ms) min_ms = w32;
        } else {
            const uint32_t d = next_due_ms(conn.state, now_ms);
            if (d < min_ms) min_ms = d;
        }
    }
    return min_ms;
}

} // namespace iobus::fieldbus
