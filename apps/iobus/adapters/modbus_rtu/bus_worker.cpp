/**
 * @file  bus_worker.cpp
 * @brief MBR-B101/B102/B103/B107/B109: hiện thực BusWorker.
 *        libmodbus API guarded by MKDDC_ENABLE_MODBUS; logic compile vô điều kiện.
 */
#include "bus_worker.hpp"
#include "fieldbus_time.hpp"
#include "register_codec.hpp"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <chrono>
#include <cstring>
#include <thread>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#include <linux/serial.h>
#include <sys/ioctl.h>
#endif

namespace iobus::fieldbus {

const char* bus_state_name(BusState s)
{
    switch (s) {
        case BusState::CLOSED:       return "CLOSED";
        case BusState::OPENING:      return "OPENING";
        case BusState::RUNNING:      return "RUNNING";
        case BusState::PORT_ERROR:   return "PORT_ERROR";
        case BusState::DRAINING:     return "DRAINING";
        case BusState::SWAPPING:     return "SWAPPING";
        case BusState::CONFIG_ERROR: return "CONFIG_ERROR";
    }
    return "UNKNOWN";
}

uint32_t port_backoff_ms(uint8_t step)
{
    static const uint32_t kLadder[] = {1000u, 2000u, 5000u, 10000u, 30000u};
    const size_t n = sizeof(kLadder) / sizeof(kLadder[0]);
    return kLadder[step < n ? step : n - 1];
}

/* Số register/bit tối đa của một khối gộp — ràng buộc giao thức Modbus, không
 * phải lựa chọn thiết kế. Vượt là slave trả exception ILLEGAL_DATA_ADDRESS. */
static constexpr uint16_t kMaxRegistersPerBlock = 125;
static constexpr uint16_t kMaxBitsPerBlock      = 2000;

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

BusWorker::~BusWorker()
{
    close_port();
}

void BusWorker::bind(const BusConfig& bus, const std::vector<SlaveConfig>& slaves,
                     const std::vector<uint8_t>& global_indices, uint16_t* ext_cursor,
                     ExtCache& cache)
{
    bus_ = bus;
    slaves_.clear();
    ext_base_ = *ext_cursor;

    for (size_t i = 0; i < slaves.size(); i++) {
        BusSlaveBinding binding;
        binding.global_idx = global_indices[i];
        binding.cfg        = slaves[i];
        binding.state.poll_interval_ms = slaves[i].poll_ms;
        binding.state.offline_probe_ms = bus.offline_probe_ms;
        binding.state.online           = false;
        binding.ext_base               = *ext_cursor;

        const std::string profile_path = find_profile_path(slaves[i].profile);
        if (profile_path.empty()) {
            std::fprintf(stderr, "ERROR bus_worker.profile_not_found bus=%u slave=%s profile=%s"
                         " — slave KHÔNG được poll (lỗi cấu hình)\n",
                         bus.id, slaves[i].name.c_str(), slaves[i].profile.c_str());
            binding.config_error = true;
            slaves_.push_back(std::move(binding));
            continue;
        }
        load_device_profile(profile_path, &binding.profile);

        /* F-17: đếm theo ĐIỂM LUẬN LÝ, không theo số register. */
        const uint16_t need = ext_slots_for_profile(binding.profile);
        if (need == 0) {
            /* Không có điểm đọc nào. Cũng là lỗi cấu hình: nếu để nguyên thì
             * read_slave chạy qua vòng points rỗng và báo slave ONLINE. */
            std::fprintf(stderr, "ERROR bus_worker.profile_no_readable_points bus=%u slave=%s"
                         " profile=%s — slave KHÔNG được poll (lỗi cấu hình)\n",
                         bus.id, slaves[i].name.c_str(), slaves[i].profile.c_str());
            binding.config_error = true;
            slaves_.push_back(std::move(binding));
            continue;
        }

        const uint16_t avail = static_cast<uint16_t>(KX_N_EXT - *ext_cursor);
        if (need > avail) {
            /* F-16: tràn dải phải FAIL-CLOSED và ỒN ÀO. `continue` chứ không
             * `break`: một slave nhỏ vẫn có thể vừa chỗ còn lại. */
            std::fprintf(stderr, "ERROR bus_worker.ext_slots_exhausted bus=%u slave=%s addr=%u"
                         " need=%u avail=%u capacity=%u"
                         " — slave KHÔNG được poll (lỗi cấu hình)\n",
                         bus.id, slaves[i].name.c_str(), slaves[i].addr,
                         need, avail, static_cast<unsigned>(KX_N_EXT));
            binding.profile.points.clear();
            binding.config_error = true;
            slaves_.push_back(std::move(binding));
            continue;
        }

        binding.ext_count = need;
        *ext_cursor = static_cast<uint16_t>(*ext_cursor + need);
        build_blocks(&binding);

        /* Cấp danh tính slot NGAY, trước lần I/O đầu tiên: lần poll đầu bị lỗi
         * vẫn publish đúng Point ID và BAD/NOT_INITIALIZED thay vì bảng rỗng. */
        uint16_t init_idx = binding.ext_base;
        for (const auto& pt : binding.profile.points) {
            if (ext_slots_for_point(pt) == 0) continue;
            const bool is32 = point_type_is_32bit(pt.type);
            uint16_t logical = 0;
            for (uint16_t k = 0; k < pt.count && init_idx < KX_N_EXT; k++) {
                if (is32 && k + 1 >= pt.count) break;
                char name[24];
                ext_point_name(name, binding.cfg, pt, logical);
                cache.declare_point(init_idx, name, binding.cfg.addr, bus.id, pt.writable);
                init_idx++;
                logical++;
                if (is32) k++;
            }
        }
        slaves_.push_back(std::move(binding));
    }

    ext_span_ = static_cast<uint16_t>(*ext_cursor - ext_base_);

    /* Slave lỗi cấu hình phải hiện CONFIG_ERROR chứ không im lặng biến mất khỏi
     * bảng điểm: người vận hành cần thấy "khai báo sai", không phải một dòng
     * trống không giải thích được. */
    bool any_ok = false;
    for (auto& binding : slaves_) {
        if (binding.config_error) {
            cache.mark_range_quality(binding.ext_base, binding.ext_count,
                                     KX_EXTQ_CONFIG_ERROR, KX_EXTR_CONFIG_ERROR, false);
        } else {
            any_ok = true;
        }
    }
    if (!slaves_.empty() && !any_ok) state_ = BusState::CONFIG_ERROR;
}

/* MBR-B109: gộp các điểm đọc liền kề cùng FC thành một transaction.
 *
 * Chỉ gộp khi dải register LIỀN NHAU TUYỆT ĐỐI (next.addr == end hiện tại).
 * Không gộp qua khoảng trống, dù khoảng trống nhỏ: register không khai báo có
 * thể không tồn tại trên slave, và đọc trúng nó làm slave trả exception
 * ILLEGAL_DATA_ADDRESS cho TOÀN khối — đánh hỏng cả những điểm vốn đọc được.
 * Đổi một chút hiệu năng lấy tính đúng đắn là đúng chiều ở đây. */
void BusWorker::build_blocks(BusSlaveBinding* binding)
{
    binding->blocks.clear();

    struct Entry {
        const ProfilePoint* point;
        uint16_t ext_index;
    };
    std::vector<Entry> entries;
    uint16_t ext_idx = binding->ext_base;
    for (const auto& pt : binding->profile.points) {
        if (pt.fc != 1 && pt.fc != 2 && pt.fc != 3 && pt.fc != 4) continue;
        if (ext_slots_for_point(pt) == 0) continue;
        entries.push_back({&pt, ext_idx});
        ext_idx = static_cast<uint16_t>(ext_idx + ext_slots_for_point(pt));
    }
    /* Sắp theo (fc, addr) để phép gộp chỉ cần xét phần tử kề nhau.
     * stable_sort giữ thứ tự khai báo cho các điểm cùng địa chỉ. */
    std::stable_sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
        if (a.point->fc != b.point->fc) return a.point->fc < b.point->fc;
        return a.point->addr < b.point->addr;
    });

    for (const auto& e : entries) {
        const uint16_t limit = (e.point->fc == 1 || e.point->fc == 2)
                                   ? kMaxBitsPerBlock : kMaxRegistersPerBlock;
        ReadBlock* last = binding->blocks.empty() ? nullptr : &binding->blocks.back();
        const bool contiguous =
            last != nullptr && last->fc == e.point->fc &&
            static_cast<uint32_t>(last->addr) + last->count == e.point->addr &&
            static_cast<uint32_t>(last->count) + e.point->count <= limit;
        if (contiguous) {
            last->members.push_back({e.point, static_cast<uint16_t>(e.point->addr - last->addr),
                                     e.ext_index});
            last->count = static_cast<uint16_t>(last->count + e.point->count);
        } else {
            ReadBlock block;
            block.fc    = e.point->fc;
            block.addr  = e.point->addr;
            block.count = e.point->count;
            block.members.push_back({e.point, 0, e.ext_index});
            binding->blocks.push_back(std::move(block));
        }
    }
}

void BusWorker::set_state(BusState s, FieldbusMetrics* metrics)
{
    if (state_ == s) return;
    state_ = s;
    std::fprintf(stderr, "INFO  bus_worker.state bus=%u device=%s state=%s\n",
                 bus_.id, bus_.device.c_str(), bus_state_name(s));
    if (metrics) metrics->set_bus_state(bus_.id, bus_state_name(s));
}

bool BusWorker::errno_is_port_failure(int err) const
{
    /* Phân biệt "thiết bị không trả lời" với "cổng đã chết".
     * ETIMEDOUT/EMBBADCRC là chuyện của SLAVE — bus vẫn tốt, chỉ thiết bị im.
     * ENODEV/EIO/EBADF/ENXIO là chuyện của CỔNG: rút USB-RS485, driver rớt,
     * fd bị đóng. Gộp hai loại này lại làm một là lý do một slave chết từng
     * khiến cả bus bị đóng mở liên tục. */
    return err == ENODEV || err == EIO || err == EBADF || err == ENXIO || err == EPIPE;
}

bool BusWorker::open_port()
{
#ifndef MKDDC_ENABLE_MODBUS
    std::fprintf(stderr, "WARN  bus_worker.disabled bus=%u (build without MKDDC_ENABLE_MODBUS)\n",
                 bus_.id);
    return false;
#else
    if (!bus_.enabled) {
        state_ = BusState::CLOSED;
        return false;
    }
    if (bus_.device.empty()) {
        state_ = BusState::CONFIG_ERROR;
        std::fprintf(stderr, "ERROR bus_worker.device_empty bus=%u\n", bus_.id);
        return false;
    }
    state_ = BusState::OPENING;

    modbus_t* ctx = modbus_new_rtu(bus_.device.c_str(), static_cast<int>(bus_.baud),
                                   bus_.parity, 8, bus_.stop);
    if (!ctx) {
        std::fprintf(stderr, "ERROR bus_worker.new_rtu_fail bus=%u device=%s errno=%s\n",
                     bus_.id, bus_.device.c_str(), modbus_strerror(errno));
        state_ = BusState::PORT_ERROR;
        return false;
    }
    modbus_set_response_timeout(ctx, 0, 300000);
    modbus_set_byte_timeout(ctx, 0, 50000);

    if (modbus_connect(ctx) != 0) {
        std::fprintf(stderr, "ERROR bus_worker.connect_fail bus=%u device=%s err=%s\n",
                     bus_.id, bus_.device.c_str(), modbus_strerror(errno));
        modbus_free(ctx);
        state_ = BusState::PORT_ERROR;
        return false;
    }
    ctx_ = static_cast<void*>(ctx);
    state_ = BusState::RUNNING;
    backoff_step_ = 0;
    apply_direction_mode(modbus_get_socket(ctx));
    std::fprintf(stderr, "INFO  bus_worker.open bus=%u device=%s %u%c8%u slaves=%zu ext=[%u..%u)\n",
                 bus_.id, bus_.device.c_str(), bus_.baud, bus_.parity, bus_.stop,
                 slaves_.size(), ext_base_, static_cast<unsigned>(ext_base_ + ext_span_));
    return true;
#endif
}

/* G-D / OD-MBRTU-EXT-04 — điều khiển hướng truyền half-duplex.
 *
 * Bản trước KHÔNG gọi gì cả và device tree không có `rs485-*`, nên hệ thống
 * chạy trên một giả định KHÔNG AI PHÁT BIỂU: "transceiver tự đảo hướng". Giả
 * định im lặng có hai vấn đề — không kiểm chứng được, và khi lắp một bo khác có
 * DE/RE thì không có đường nào để đổi.
 *
 * Nay hành vi là một LỰA CHỌN TƯỜNG MINH trong config, và trạng thái THẬT của
 * driver được đọc lại rồi in ra log. Kỹ thuật viên đọc journal là biết ngay bus
 * đang chạy chế độ nào, thay vì phải suy từ việc source không gọi hàm nào.
 *
 * Phần cứng Foxlinx SOM-DDC-24 (Hardware owner xác nhận 2026-08-06): chỉ có
 * TX/RX, không có DE/RE ⇒ Auto là đúng, và BẬT nhầm chế độ RTS ở đây sẽ khiến
 * driver giữ RTS cho một chân không nối đi đâu cả. */
void BusWorker::apply_direction_mode(int fd)
{
#ifdef MKDDC_ENABLE_MODBUS
    if (fd < 0) return;

    struct serial_rs485 current {};
    const bool readable = ::ioctl(fd, TIOCGRS485, &current) == 0;
    if (!readable) {
        /* Driver không hỗ trợ ioctl ⇒ chỉ auto-direction mới chạy được. Nếu
         * config lại đòi RTS thì đó là cấu hình không thực thi được, phải nói ra. */
        if (bus_.direction == Rs485Direction::Rts) {
            std::fprintf(stderr, "ERROR bus_worker.rs485_rts_unsupported bus=%u device=%s"
                         " — driver không có TIOCSRS485; KHÔNG thể điều khiển hướng bằng RTS\n",
                         bus_.id, bus_.device.c_str());
        } else {
            std::fprintf(stderr, "INFO  bus_worker.rs485_direction bus=%u mode=auto"
                         " (driver không hỗ trợ TIOCGRS485 — dựa hoàn toàn vào transceiver)\n",
                         bus_.id);
        }
        return;
    }

    struct serial_rs485 wanted = current;
    if (bus_.direction == Rs485Direction::Rts) {
        wanted.flags |= SER_RS485_ENABLED | SER_RS485_RTS_ON_SEND;
        wanted.flags &= ~static_cast<unsigned int>(SER_RS485_RTS_AFTER_SEND);
        wanted.delay_rts_before_send = bus_.rts_delay_before_us / 1000u;
        wanted.delay_rts_after_send  = bus_.rts_delay_after_us / 1000u;
    } else {
        /* Auto: TẮT tường minh chế độ RS-485 của driver. Không phải "không làm
         * gì" — một cấu hình còn sót từ lần chạy trước hoặc từ device tree sẽ
         * khiến driver kéo RTS trên bo không có DE/RE. */
        wanted.flags &= ~static_cast<unsigned int>(SER_RS485_ENABLED);
    }

    if (::ioctl(fd, TIOCSRS485, &wanted) != 0) {
        std::fprintf(stderr, "WARN  bus_worker.rs485_set_fail bus=%u mode=%s errno=%d"
                     " — giữ nguyên cấu hình driver\n",
                     bus_.id, bus_.direction == Rs485Direction::Rts ? "rts" : "auto", errno);
    }

    struct serial_rs485 readback {};
    if (::ioctl(fd, TIOCGRS485, &readback) == 0) {
        std::fprintf(stderr, "INFO  bus_worker.rs485_direction bus=%u mode=%s driver_enabled=%d"
                     " rts_on_send=%d delay_before_ms=%u delay_after_ms=%u\n",
                     bus_.id, bus_.direction == Rs485Direction::Rts ? "rts" : "auto",
                     (readback.flags & SER_RS485_ENABLED) ? 1 : 0,
                     (readback.flags & SER_RS485_RTS_ON_SEND) ? 1 : 0,
                     readback.delay_rts_before_send, readback.delay_rts_after_send);
    }
#else
    (void)fd;
#endif
}

void BusWorker::close_port()
{
#ifdef MKDDC_ENABLE_MODBUS
    if (ctx_) {
        modbus_t* ctx = static_cast<modbus_t*>(ctx_);
        modbus_close(ctx);
        modbus_free(ctx);
        ctx_ = nullptr;
    }
#endif
    if (state_ != BusState::CONFIG_ERROR) state_ = BusState::CLOSED;
}

void BusWorker::mark_bus_down(ExtCache& cache, FieldbusMetrics& metrics)
{
    /* FW_SOM_DESIGN §3: PORT_ERROR phải publish OFFLINE/PORT_DOWN cho TOÀN BỘ
     * Point trên bus đó. Giữ nguyên GOOD cũ ở đây là nói dối: dây đã đứt. */
    for (auto& binding : slaves_) {
        cache.mark_range_quality(binding.ext_base, binding.ext_count,
                                 KX_EXTQ_OFFLINE, KX_EXTR_PORT_DOWN, false);
        binding.state.online = false;
        metrics.update(binding.global_idx, false, monotonic_ms(),
                       binding.cfg.offline_after_errors);
    }
}

void BusWorker::emit_result(const std::string& request_id, const char* status,
                            const char* reason, uint8_t exception_code)
{
    if (!result_sink_ || request_id.empty()) return;
    WriteResult result;
    result.request_id     = request_id;
    result.status         = status;
    result.reason         = reason ? reason : "";
    result.exception_code = exception_code;
    result_sink_(result);
}

bool BusWorker::enqueue_write(const PendingWrite& w)
{
    std::lock_guard<std::mutex> lock(queue_mu_);
    for (auto& pending : pending_writes_) {
        if (!pending.submitted && pending.slave_addr == w.slave_addr &&
            pending.fc == w.fc && pending.reg_addr == w.reg_addr) {
            /* Coalesce: setpoint mới thay setpoint cũ chưa gửi. Giá trị cũ
             * không còn ai muốn ghi, giữ lại nó chỉ để phát ra dây là sai. */
            const std::string superseded = pending.request_id;
            pending = w;
            if (!superseded.empty() && superseded != w.request_id)
                emit_result(superseded, "rejected", "superseded_by_newer_setpoint", 0);
            return true;
        }
    }
    if (pending_writes_.size() >= kMaxPendingWrites) {
        std::fprintf(stderr, "ERROR bus_worker.write_queue_full bus=%u slave=%u reg=%u"
                     " limit=%zu — TỪ CHỐI lệnh ghi\n",
                     bus_.id, w.slave_addr, w.reg_addr, kMaxPendingWrites);
        emit_result(w.request_id, "rejected", "write_queue_full", 0);
        return false;
    }
    pending_writes_.push_back(w);
    return true;
}

uint32_t BusWorker::sleep_ms_until_next(uint64_t now_ms) const
{
    if (slaves_.empty()) return 1000;
    uint32_t min_ms = 1000;
    bool first = true;
    for (const auto& binding : slaves_) {
        const uint32_t d = next_due_ms(binding.state, now_ms);
        if (first || d < min_ms) { min_ms = d; first = false; }
    }
    return min_ms;
}

void BusWorker::read_slave(size_t i, uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)i; (void)now_ms; (void)cache; (void)metrics;
#else
    BusSlaveBinding& binding = slaves_[i];
    const SlaveConfig& sc = binding.cfg;
    SlaveState& state = binding.state;
    modbus_t* ctx = static_cast<modbus_t*>(ctx_);

    /* F-16 fail-closed: slave thiếu profile / không có điểm đọc / hết ext slot
     * KHÔNG được báo online. Không truy vấn nó, đi thẳng đường lỗi để error_rate
     * = 100% và E302 kích — kỹ thuật viên thấy ngay thay vì "đèn xanh, bảng
     * điểm trống, log im lặng". */
    if (binding.config_error) {
        on_poll_error(&state, sc.offline_after_errors, now_ms);
        metrics.update(binding.global_idx, false, now_ms, sc.offline_after_errors);
        cache.mark_range_quality(binding.ext_base, binding.ext_count,
                                 KX_EXTQ_CONFIG_ERROR, KX_EXTR_CONFIG_ERROR, false);
        if (metrics.check_e302(binding.global_idx, 1))
            std::fprintf(stderr, "ALARM E302 modbus.slave_config_error bus=%u slave=%s addr=%u"
                         " — thiếu profile hoặc hết ext slot, slave không được poll\n",
                         bus_.id, sc.name.c_str(), sc.addr);
        return;
    }

    modbus_set_slave(ctx, sc.addr);
    modbus_set_response_timeout(ctx, sc.timeout_ms / 1000u, (sc.timeout_ms % 1000u) * 1000u);

    bool slave_ok = true;
    uint8_t exception_code = 0;
    kx_ext_quality_reason_t fail_reason = KX_EXTR_TIMEOUT;

    for (const auto& block : binding.blocks) {
        uint16_t regs[kMaxRegistersPerBlock] = {};
        std::vector<uint8_t> bits;
        if (block.fc == 1 || block.fc == 2) bits.assign(block.count, 0u);
        int rc = -1;

        /* D-05: phát lại THẬT khi giao dịch lỗi. `sc.retry` là số lần phát LẠI,
         * nên tổng số lần phát là retry + 1. Nhiễu thoáng qua trên RS-485 là
         * chuyện thường ngày ở công trình; không có bước này thì mọi khung hỏng
         * đơn lẻ đều làm cả block rơi STALE. */
        const int max_attempts = static_cast<int>(sc.retry) + 1;
        for (int attempt = 1; attempt <= max_attempts; ++attempt) {
            const int64_t t0 = monotonic_ns();
            if (block.fc == 1)
                rc = modbus_read_bits(ctx, block.addr, block.count, bits.data());
            else if (block.fc == 2)
                rc = modbus_read_input_bits(ctx, block.addr, block.count, bits.data());
            else if (block.fc == 3)
                rc = modbus_read_registers(ctx, block.addr, block.count, regs);
            else if (block.fc == 4)
                rc = modbus_read_input_registers(ctx, block.addr, block.count, regs);
            const int saved_errno = errno;
            const uint32_t elapsed_us =
                static_cast<uint32_t>((monotonic_ns() - t0) / 1000);
            metrics.record_bus_transaction(bus_.id, elapsed_us, rc >= 0);

            /* `T57-3.9` (`ADR-046` bản sửa 2026-08-19): ghi lại giao dịch VỪA
               XONG. Đây là lượt phát mà chu kỳ poll bình thường đã thực hiện —
               không có byte nào phát thêm vì mục đích quan sát. */
            {
                FrameRecord frame;
                /* Đồng hồ tường, KHÔNG phải `now_ms` của vòng quét: `now_ms`
                   là uptime (`CLOCK_MONOTONIC`) nên giao diện sẽ hiện giờ năm
                   1970 — xem chú thích ở `frame_ring.hpp`. */
                frame.at_ms = frame_wall_clock_ms();
                frame.bus = bus_.id;
                frame.slave = sc.addr;
                frame.fc = block.fc;
                frame.addr = block.addr;
                frame.count = block.count;
                frame.elapsed_us = elapsed_us;
                frame.attempt = static_cast<uint8_t>(attempt);
                frame.ok = rc >= 0;
                const char* reason = "ok";
                if (rc < 0) {
                    if (saved_errno == ETIMEDOUT) reason = "timeout";
#ifdef EMBBADCRC
                    else if (saved_errno == EMBBADCRC) reason = "crc";
#endif
                    else reason = "error";
                }
                std::snprintf(frame.reason, sizeof(frame.reason), "%s", reason);
                metrics.frames().record(frame);
            }

            if (rc >= 0) break;

            /* Đếm lỗi giao thức theo TỪNG lần phát: một lượt poll timeout 3 lần
             * là ba lần chờ hết giờ trên dây, không phải một. */
            if (saved_errno == ETIMEDOUT) {
                metrics.record_timeout(binding.global_idx);
                fail_reason = KX_EXTR_TIMEOUT;
            }
#ifdef EMBBADCRC
            if (saved_errno == EMBBADCRC) {
                metrics.record_crc_error(binding.global_idx);
                fail_reason = KX_EXTR_CRC_ERROR;
            }
#endif
            /* Exception response: slave TRẢ LỜI nhưng từ chối. Đây là thông tin
             * chẩn đoán quý nhất và v1 vứt đi hoàn toàn. */
            if (saved_errno > MODBUS_ENOBASE && saved_errno <= MODBUS_ENOBASE + 11) {
                exception_code = static_cast<uint8_t>(saved_errno - MODBUS_ENOBASE);
                fail_reason = KX_EXTR_DEVICE_EXCEPTION;
                metrics.record_exception(binding.global_idx, exception_code);
            }
            if (errno_is_port_failure(saved_errno)) {
                fail_reason = KX_EXTR_PORT_DOWN;
                std::fprintf(stderr, "ERROR bus_worker.port_failure bus=%u device=%s err=%s\n",
                             bus_.id, bus_.device.c_str(), modbus_strerror(saved_errno));
                close_port();
                state_ = BusState::PORT_ERROR;
                metrics.set_bus_state(bus_.id, bus_state_name(state_));
                mark_bus_down(cache, metrics);
                return;
            }
            if (attempt < max_attempts) {
                /* D-06: retry_attempts đếm số lần PHÁT LẠI thật, để nó không
                 * bao giờ trùng với total_errors trên bảng chẩn đoán. */
                metrics.record_retry(binding.global_idx);
            }
        }

        if (rc < 0) {
            slave_ok = false;
            /* Hết lượt phát lại ⇒ tính là MỘT lượt poll thất bại.
             * now_ms để slave chết chuyển sang nhịp probe chậm (D-04). */
            const bool went_offline = on_poll_error(&state, sc.offline_after_errors, now_ms);
            if (went_offline) {
                std::fprintf(stderr, "WARN  modbus.slave_offline bus=%u slave=%s addr=%u\n",
                             bus_.id, sc.name.c_str(), sc.addr);
            }
            if (state.retry_count >= sc.offline_after_errors) {
                cache.mark_range_quality(binding.ext_base, binding.ext_count,
                                         KX_EXTQ_OFFLINE, fail_reason, false);
            } else {
                cache.mark_range_quality(binding.ext_base, binding.ext_count,
                                         KX_EXTQ_STALE, fail_reason, true);
            }
            if (exception_code)
                cache.mark_range_exception(binding.ext_base, binding.ext_count, exception_code);
            break;
        }

        /* Decode từng điểm trong khối đã gộp. */
        const int64_t sample_mono = monotonic_ns();
        const int64_t sample_utc  = utc_ms();
        for (const auto& member : block.members) {
            const ProfilePoint& pt = *member.point;
            uint16_t ext_idx = member.ext_index;
            const bool is32 = point_type_is_32bit(pt.type);
            uint16_t logical = 0;

            for (uint16_t k = 0; k < pt.count; k++) {
                if (ext_idx >= KX_N_EXT) break;
                char point_name[24];
                ext_point_name(point_name, sc, pt, logical);

                double eng = 0.0;
                kx_ext_quality_t quality = KX_EXTQ_GOOD;
                kx_ext_quality_reason_t reason = KX_EXTR_NONE;

                if (block.fc == 1 || block.fc == 2) {
                    eng = bits[member.offset + k] ? 1.0 : 0.0;
                } else {
                    if (is32 && k + 1 >= pt.count) {
                        /* F-18: điểm 32-bit ở biên register lẻ. Log + bỏ điểm,
                         * KHÔNG tiêu ext slot và KHÔNG publish 0 với nhãn GOOD. */
                        std::fprintf(stderr, "WARN  modbus.odd_32bit bus=%u slave=%s pt=%s k=%u"
                                     " count=%u — profile misconfigured, point skipped\n",
                                     bus_.id, sc.name.c_str(), pt.name.c_str(), k, pt.count);
                        break;
                    }
                    eng = static_cast<double>(
                        decode_register(regs + member.offset + k, is32 ? 2u : 1u,
                                        pt.type, pt.byte_order, pt.scale, pt.offset));
                    if (is32) k++;
                }

                if (!std::isfinite(eng)) {
                    quality = KX_EXTQ_BAD;
                    reason  = KX_EXTR_DECODE_ERROR;
                }

                cache.set_sample(ext_idx, point_name, eng, quality, reason,
                                 sc.addr, bus_.id, true, pt.writable,
                                 sample_utc, sample_mono);
                ext_idx++;
                logical++;
            }
        }
    }

    if (slave_ok) {
        on_poll_ok(&state, now_ms);
        metrics.update(binding.global_idx, true, now_ms, sc.offline_after_errors);
        if (metrics.get(binding.global_idx).e302_triggered)
            metrics.reset_alarms(binding.global_idx);
    } else {
        metrics.update(binding.global_idx, false, now_ms, sc.offline_after_errors);
        if (metrics.check_e302(binding.global_idx, sc.offline_after_errors))
            std::fprintf(stderr, "ALARM E302 modbus.slave_offline bus=%u slave=%s addr=%u\n",
                         bus_.id, sc.name.c_str(), sc.addr);
        if (metrics.check_e303(binding.global_idx))
            std::fprintf(stderr, "ALARM E303 modbus.error_rate_high bus=%u slave=%s rate=%.1f%%\n",
                         bus_.id, sc.name.c_str(),
                         metrics.get(binding.global_idx).error_rate() * 100.0f);
    }
#endif
}

void BusWorker::note_dropped_write_slot(uint16_t ext_idx)
{
    std::lock_guard<std::mutex> lock(queue_mu_);
    /* Trùng lặp vô hại nhưng tốn bộ nhớ nếu một slot hỏng liên tục; chặn ngay. */
    for (uint16_t existing : dropped_write_slots_)
        if (existing == ext_idx) return;
    dropped_write_slots_.push_back(ext_idx);
}

void BusWorker::flush_pending(size_t i, uint64_t now_ms, FieldbusMetrics& metrics)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)i; (void)now_ms; (void)metrics;
#else
    BusSlaveBinding& binding = slaves_[i];
    const SlaveConfig& sc = binding.cfg;
    modbus_t* ctx = static_cast<modbus_t*>(ctx_);
    modbus_set_slave(ctx, sc.addr);

    /* Chỉ thread worker chạm dây, nhưng hàng đợi thì thread control cũng ghi.
     * Giữ khoá suốt vòng flush là sai (mỗi transaction tốn hàng trăm ms và sẽ
     * chặn control thread), nên lấy ảnh có khoá rồi hợp nhất lại sau. */
    std::vector<PendingWrite> batch;
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        batch = pending_writes_;
    }

    for (auto& w : batch) {
        if (w.slave_addr != sc.addr || w.submitted) continue;

        /* D-03: mốc TTL. Đường enqueue trực tiếp có thể chưa đặt, stamp ở lần
         * gặp đầu. */
        if (w.enqueued_ms == 0) w.enqueued_ms = now_ms;

        /* D-03: quá hạn ⇒ bỏ hẳn, KHÔNG phát xuống dây. Đây là chỗ chặn kịch bản
         * "thiết bị mất điện lúc 09:00, có điện lại lúc 14:00 và nhận luôn lệnh
         * cũ". Lệnh cũ phải chết cùng ngữ cảnh sinh ra nó. */
        const uint64_t ttl_deadline =
            (w.deadline_ms > 0) ? w.deadline_ms : (w.enqueued_ms + kWriteTtlMs);
        if (now_ms > ttl_deadline) {
            std::fprintf(stderr, "ERROR modbus.write_dropped_expired bus=%u slave=%s addr=%u fc=%u"
                         " reg=%u value=%g age_ms=%llu — lệnh quá hạn, KHÔNG ghi\n",
                         bus_.id, sc.name.c_str(), sc.addr, w.fc, w.reg_addr,
                         static_cast<double>(w.value),
                         static_cast<unsigned long long>(now_ms - w.enqueued_ms));
            metrics.record_write_dropped(binding.global_idx);
            emit_result(w.request_id, "timeout", "deadline_exceeded", 0);
            note_dropped_write_slot(w.ext_idx);
            w.submitted = true;
            continue;
        }

        uint16_t regs[2] = {};
        uint8_t  coil = 0;
        int rc = -1;
        const int64_t t0 = monotonic_ns();

        if (w.fc == 5 || w.fc == 15) {
            coil = (w.value != 0.0f) ? 1u : 0u;
            if (w.fc == 5)       rc = modbus_write_bit(ctx, w.reg_addr, coil);
            else /* fc==15 */    rc = modbus_write_bits(ctx, w.reg_addr, 1, &coil);
        } else if (w.fc == 6 || w.fc == 16) {
            if (!encode_register(w.value, regs, 2, w.type, w.byte_order, w.scale, w.offset)) {
                /* D-01: giá trị không encode được (ngoài dải, NaN, scale=0).
                 * Bỏ request và nói rõ lý do — im lặng ở đây từng là cách một
                 * setpoint sai biến mất mà không ai biết. */
                std::fprintf(stderr, "ERROR modbus.write_rejected_encode bus=%u slave=%s addr=%u"
                             " fc=%u reg=%u value=%g — giá trị không biểu diễn được, KHÔNG ghi\n",
                             bus_.id, sc.name.c_str(), sc.addr, w.fc, w.reg_addr,
                             static_cast<double>(w.value));
                metrics.record_write_dropped(binding.global_idx);
                emit_result(w.request_id, "rejected", "value_not_encodable", 0);
                note_dropped_write_slot(w.ext_idx);
                w.submitted = true;
                continue;
            }
            if (w.fc == 6)      rc = modbus_write_register(ctx, w.reg_addr, regs[0]);
            else /* fc==16 */    rc = modbus_write_registers(ctx, w.reg_addr, 2, regs);
        }
        const int saved_errno = errno;
        metrics.record_bus_transaction(
            bus_.id, static_cast<uint32_t>((monotonic_ns() - t0) / 1000), rc >= 0);

        w.attempts++;

        if (rc < 0) {
            metrics.record_write_failed(binding.global_idx);
            uint8_t exc = 0;
            if (saved_errno > MODBUS_ENOBASE && saved_errno <= MODBUS_ENOBASE + 11)
                exc = static_cast<uint8_t>(saved_errno - MODBUS_ENOBASE);
            /* D-03: hết lượt thử ⇒ bỏ hẳn thay vì giữ lại vô thời hạn. */
            if (w.attempts >= kMaxWriteAttempts) {
                std::fprintf(stderr, "ERROR modbus.write_dropped_attempts bus=%u slave=%s addr=%u"
                             " fc=%u reg=%u value=%g attempts=%u err=%s — bỏ lệnh, KHÔNG giữ lại\n",
                             bus_.id, sc.name.c_str(), sc.addr, w.fc, w.reg_addr,
                             static_cast<double>(w.value), w.attempts,
                             modbus_strerror(saved_errno));
                metrics.record_write_dropped(binding.global_idx);
                emit_result(w.request_id,
                            (saved_errno == ETIMEDOUT) ? "timeout" : "rejected",
                            "write_failed_after_max_attempts", exc);
                note_dropped_write_slot(w.ext_idx);
                w.submitted = true;
            } else {
                std::fprintf(stderr, "WARN  modbus.write_fail bus=%u slave=%s fc=%u addr=%u"
                             " attempt=%u/%u err=%s\n",
                             bus_.id, sc.name.c_str(), w.fc, w.reg_addr, w.attempts,
                             kMaxWriteAttempts, modbus_strerror(saved_errno));
            }
            continue;
        }

        /* MBR-B107: readback tuỳ chọn. `applied` chỉ được khẳng định khi slave
         * đã trả lời cho lệnh ghi; readback nâng thêm một bậc: xác nhận thiết bị
         * thật sự GIỮ giá trị chứ không chỉ ACK rồi bỏ qua (nhiều VFD làm vậy
         * khi tham số bị khoá). */
        WriteResult result;
        result.request_id = w.request_id;
        result.status     = "applied";
        if (w.readback && (w.fc == 6 || w.fc == 16)) {
            uint16_t rb[2] = {};
            const int n = (w.fc == 16) ? 2 : 1;
            if (modbus_read_registers(ctx, w.reg_addr, n, rb) >= 0) {
                result.has_readback   = true;
                result.readback_value = static_cast<double>(
                    decode_register(rb, static_cast<uint16_t>(n), w.type, w.byte_order,
                                    w.scale, w.offset));
            } else {
                result.reason = "readback_failed";
            }
        }
        if (!w.request_id.empty() && result_sink_) result_sink_(result);

        w.submitted = true;
    }

    /* Hợp nhất lại: chép trạng thái đã xử lý về hàng đợi thật rồi xoá phần đã
     * xong. Request mới do control thread thêm trong lúc flush KHÔNG bị mất vì
     * chúng không nằm trong `batch` và được giữ nguyên. */
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        for (const auto& done : batch) {
            for (auto& live : pending_writes_) {
                if (live.submitted) continue;
                if (live.slave_addr == done.slave_addr && live.fc == done.fc &&
                    live.reg_addr == done.reg_addr && live.request_id == done.request_id) {
                    live.attempts    = done.attempts;
                    live.submitted   = done.submitted;
                    live.enqueued_ms = done.enqueued_ms;
                    break;
                }
            }
        }
        auto it = pending_writes_.begin();
        while (it != pending_writes_.end()) {
            if (it->submitted) it = pending_writes_.erase(it);
            else ++it;
        }
    }
#endif
}

void BusWorker::poll_once(uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics)
{
    if (state_ == BusState::CONFIG_ERROR) return;
    /* Commissioning trước poll: kỹ thuật viên đang đứng cạnh tủ chờ kết quả,
     * một chu kỳ poll chậm không được biến thành mấy giây im lặng trên UI. */
    service_probes();

    /* Vòng đời cổng (MBR-B102): PORT_ERROR ⇒ đợi hết backoff rồi thử mở lại.
     * Trong lúc chờ, mọi Point trên bus giữ OFFLINE/PORT_DOWN. */
    if (!port_open()) {
        if (state_ == BusState::PORT_ERROR) {
            if (now_ms < reopen_at_ms_) return;
            const uint32_t wait = port_backoff_ms(backoff_step_);
            reopen_at_ms_ = now_ms + wait;
            if (backoff_step_ < 255) backoff_step_++;
            metrics.record_bus_reopen(bus_.id);
            if (!open_port()) {
                metrics.set_bus_state(bus_.id, bus_state_name(state_));
                mark_bus_down(cache, metrics);
                return;
            }
            metrics.set_bus_state(bus_.id, bus_state_name(state_));
        } else {
            return;
        }
    }

    /* D-04: phục vụ theo deadline sớm nhất thay vì theo thứ tự index.
     *
     * Vòng lặp cũ duyệt slave[0..n) theo index nên slave index thấp luôn được ưu
     * tiên: một slave chậm ở đầu danh sách đẩy lùi mọi slave sau nó. Sắp theo
     * "quá hạn nhiều nhất trước" cho hành vi công bằng, và với các slave cùng
     * mức quá hạn thì giữ nguyên thứ tự index (ổn định, dễ đoán). */
    struct DueSlave { uint64_t overdue; size_t idx; };
    std::vector<DueSlave> due;
    due.reserve(slaves_.size());
    for (size_t i = 0; i < slaves_.size(); i++) {
        if (!is_due(slaves_[i].state, now_ms)) continue;
        const uint64_t last = slaves_[i].state.last_poll_ms;
        /* Chưa từng poll hoặc clock nhảy lùi ⇒ ưu tiên cao nhất. */
        const uint64_t overdue = (last == 0 || now_ms < last) ? UINT64_MAX : (now_ms - last);
        due.push_back({overdue, i});
    }
    std::stable_sort(due.begin(), due.end(),
                     [](const DueSlave& a, const DueSlave& b) { return a.overdue > b.overdue; });

    for (const auto& d : due) {
        read_slave(d.idx, now_ms, cache, metrics);
        if (!port_open()) return;   /* cổng chết giữa chừng — nhường vòng sau */
        flush_pending(d.idx, now_ms, metrics);
    }
}

void BusWorker::run_loop(const std::atomic<bool>& stop, ExtCache& cache, FieldbusMetrics& metrics)
{
    metrics.set_bus_state(bus_.id, bus_state_name(state_));
    while (!stop.load(std::memory_order_relaxed)) {
        const uint64_t now = monotonic_ms();
        poll_once(now, cache, metrics);
        uint32_t wait = sleep_ms_until_next(monotonic_ms());
        if (!port_open() && state_ == BusState::PORT_ERROR) {
            const uint64_t nowb = monotonic_ms();
            wait = (reopen_at_ms_ > nowb) ? static_cast<uint32_t>(reopen_at_ms_ - nowb) : 0u;
        }
        /* Trần 200 ms: worker phải tỉnh đủ dày để phản ứng với `stop` và với
         * lệnh ghi mới, kể cả khi mọi slave đều poll chậm. */
        if (wait > 200u) wait = 200u;
        if (wait == 0u) wait = 1u;
        std::this_thread::sleep_for(std::chrono::milliseconds(wait));
    }
    /* DRAINING: transaction đang phát đã xong (chúng ta ở ngoài nó), huỷ hàng
     * đợi write chưa gửi. FW_SOM_DESIGN §10: shutdown KHÔNG ghi giá trị nào
     * xuống slave. */
    set_state(BusState::DRAINING, &metrics);
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        for (auto& w : pending_writes_)
            if (!w.submitted) emit_result(w.request_id, "rejected", "shutdown_drain", 0);
        pending_writes_.clear();
        for (auto& req : probes_) {
            req->result.reason = "worker_stopped";
            req->done = true;
        }
        probes_.clear();
    }
    probe_cv_.notify_all();
    close_port();
    metrics.set_bus_state(bus_.id, bus_state_name(state_));
}

BusWorker::ProbeResult BusWorker::probe_read(uint8_t slave_addr, uint8_t fc, uint16_t addr,
                                             uint16_t count, uint32_t timeout_ms,
                                             uint32_t wait_ms)
{
    auto req = std::make_shared<ProbeRequest>();
    req->slave_addr = slave_addr;
    req->fc         = fc;
    req->addr       = addr;
    req->count      = count;
    req->timeout_ms = timeout_ms;
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        probes_.push_back(req);
    }
    std::unique_lock<std::mutex> lock(queue_mu_);
    if (!probe_cv_.wait_for(lock, std::chrono::milliseconds(wait_ms),
                            [&req]() { return req->done; })) {
        /* Hết giờ chờ: bỏ request khỏi hàng đợi để worker không phát một lệnh
         * mà không còn ai đọc kết quả. */
        for (auto it = probes_.begin(); it != probes_.end(); ++it) {
            if (*it == req) { probes_.erase(it); break; }
        }
        ProbeResult timeout;
        timeout.reason = "probe_timeout";
        return timeout;
    }
    return req->result;
}

void BusWorker::service_probes()
{
    std::vector<std::shared_ptr<ProbeRequest>> batch;
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        batch.swap(probes_);
    }
    if (batch.empty()) return;
    for (auto& req : batch) {
        ProbeResult result = run_probe_locked(req->slave_addr, req->fc, req->addr,
                                              req->count, req->timeout_ms);
        std::lock_guard<std::mutex> lock(queue_mu_);
        req->result = result;
        req->done   = true;
    }
    probe_cv_.notify_all();
}

BusWorker::ProbeResult BusWorker::run_probe_locked(uint8_t slave_addr, uint8_t fc, uint16_t addr,
                                                   uint16_t count, uint32_t timeout_ms)
{
    ProbeResult out;
#ifndef MKDDC_ENABLE_MODBUS
    (void)slave_addr; (void)fc; (void)addr; (void)count; (void)timeout_ms;
    out.reason = "modbus_disabled";
    return out;
#else
    if (!port_open()) {
        out.reason = "port_not_open";
        return out;
    }
    if (count == 0 || count > kMaxRegistersPerBlock) {
        out.reason = "count_out_of_range";
        return out;
    }
    modbus_t* ctx = static_cast<modbus_t*>(ctx_);
    modbus_set_slave(ctx, slave_addr);
    modbus_set_response_timeout(ctx, timeout_ms / 1000u, (timeout_ms % 1000u) * 1000u);

    uint16_t regs[kMaxRegistersPerBlock] = {};
    std::vector<uint8_t> bits(count, 0u);
    const int64_t t0 = monotonic_ns();
    int rc = -1;
    if (fc == 1)      rc = modbus_read_bits(ctx, addr, count, bits.data());
    else if (fc == 2) rc = modbus_read_input_bits(ctx, addr, count, bits.data());
    else if (fc == 3) rc = modbus_read_registers(ctx, addr, count, regs);
    else if (fc == 4) rc = modbus_read_input_registers(ctx, addr, count, regs);
    else {
        out.reason = "unsupported_function_code";
        return out;
    }
    const int saved_errno = errno;
    out.elapsed_us = static_cast<uint32_t>((monotonic_ns() - t0) / 1000);

    if (rc < 0) {
        if (saved_errno > MODBUS_ENOBASE && saved_errno <= MODBUS_ENOBASE + 11)
            out.exception_code = static_cast<uint8_t>(saved_errno - MODBUS_ENOBASE);
        out.reason = modbus_strerror(saved_errno);
        return out;
    }
    out.ok    = true;
    out.value = (fc == 1 || fc == 2) ? (bits[0] ? 1.0 : 0.0)
                                     : static_cast<double>(regs[0]);
    return out;
#endif
}

} // namespace iobus::fieldbus
