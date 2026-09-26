/**
 * @file  bus_worker.cpp
 * @brief MBR-B101/B102/B103/B107/B109: hiện thực BusWorker.
 *        libmodbus API guarded by MKDDC_ENABLE_MODBUS; logic compile vô điều kiện.
 */
#include "bus_worker.hpp"
#include "poll_group.hpp"
#include "thread_policy.hpp"
#include "write_verify.hpp"
#include "fieldbus_time.hpp"
#include "register_codec.hpp"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <chrono>
#include <cstring>

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

void ext_point_name(char out[24], const SlaveConfig& slave,
                    const ProfilePoint& point, uint16_t logical_index)
{
    if (ext_slots_for_point(point) == 1) {
        std::snprintf(out, 24, "%s", point.name.c_str());
    } else {
        std::snprintf(out, 24, "%s.%s[%u]", slave.name.c_str(),
                      point.name.c_str(), logical_index);
    }
}

const char* frame_reason(int rc, int saved_errno)
{
    if (rc >= 0) return "ok";
    if (saved_errno == ETIMEDOUT) return "timeout";
#ifdef MKDDC_ENABLE_MODBUS
#ifdef EMBBADCRC
    if (saved_errno == EMBBADCRC) return "crc";
#endif
    /* `MBA-FW-05`: exception response là thông tin chẩn đoán quý nhất — slave
     * TRẢ LỜI nhưng từ chối. Bản trước gộp nó vào `error`, nên Frame Monitor
     * không phân biệt được "địa chỉ không tồn tại" với "dây nhiễu". */
    if (saved_errno > MODBUS_ENOBASE && saved_errno <= MODBUS_ENOBASE + 11) return "exception";
#endif
    return "error";
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
        /* `ISS-PIO-22` — cổng ở cấp slave phải theo nhóm NHANH NHẤT mà slave này
         * thật sự dùng. Giữ nguyên `poll_ms` sẽ khiến một điểm `fast` không bao
         * giờ đạt được nhịp của nó: `read_slave` không được gọi đủ dày để block
         * fast kịp đến hạn. */
        for (const auto& block : binding.blocks) {
            const uint32_t interval = group_interval_ms(block.poll_group, slaves[i].poll_ms,
                                                        slaves[i].poll_fast_ms, slaves[i].poll_slow_ms);
            if (interval > 0 && interval < binding.state.poll_interval_ms)
                binding.state.poll_interval_ms = interval;
        }

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
    /* Sắp theo (poll_group, fc, addr) để phép gộp chỉ cần xét phần tử kề nhau.
     * `poll_group` đứng TRƯỚC vì `ISS-PIO-22`: hai điểm khác nhóm poll không
     * bao giờ được gộp, kể cả khi địa chỉ liền nhau.
     * stable_sort giữ thứ tự khai báo cho các điểm cùng địa chỉ. */
    std::stable_sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
        if (a.point->poll_group != b.point->poll_group)
            return static_cast<uint8_t>(a.point->poll_group) < static_cast<uint8_t>(b.point->poll_group);
        if (a.point->fc != b.point->fc) return a.point->fc < b.point->fc;
        return a.point->addr < b.point->addr;
    });

    for (const auto& e : entries) {
        const uint16_t limit = (e.point->fc == 1 || e.point->fc == 2)
                                   ? kMaxBitsPerBlock : kMaxRegistersPerBlock;
        ReadBlock* last = binding->blocks.empty() ? nullptr : &binding->blocks.back();
        /* `MBA-FW-09`: điểm nằm TRỌN trong dải đã có của block (nhiều điểm
         * `bit_index` trên cùng một register) đi chung giao dịch, không phát
         * thêm lượt đọc cho chính register đó. */
        const bool contained =
            last != nullptr && last->fc == e.point->fc &&
            last->poll_group == e.point->poll_group &&
            e.point->addr >= last->addr &&
            static_cast<uint32_t>(e.point->addr) + e.point->count <=
                static_cast<uint32_t>(last->addr) + last->count;
        if (contained) {
            last->members.push_back({e.point, static_cast<uint16_t>(e.point->addr - last->addr),
                                     e.ext_index});
            continue;
        }
        const bool contiguous =
            last != nullptr && last->fc == e.point->fc &&
            last->poll_group == e.point->poll_group &&
            static_cast<uint32_t>(last->addr) + last->count == e.point->addr &&
            static_cast<uint32_t>(last->count) + e.point->count <= limit;
        if (contiguous) {
            last->members.push_back({e.point, static_cast<uint16_t>(e.point->addr - last->addr),
                                     e.ext_index});
            last->count = static_cast<uint16_t>(last->count + e.point->count);
        } else {
            ReadBlock block;
            block.fc         = e.point->fc;
            block.addr       = e.point->addr;
            block.count      = e.point->count;
            block.poll_group = e.point->poll_group;
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
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        bool coalesced = false;
        for (auto& pending : pending_writes_) {
            /* `MBA-FW-04`: KHÔNG coalesce vào mục đang bay — xem `in_flight`. Lệnh
             * mới đi thành mục riêng, đứng SAU mục đang bay trong hàng đợi, nên thứ
             * tự trên dây vẫn là cũ rồi mới. */
            if (!pending.submitted && !pending.in_flight && pending.slave_addr == w.slave_addr &&
                pending.fc == w.fc && pending.reg_addr == w.reg_addr) {
                /* Coalesce: setpoint mới thay setpoint cũ chưa gửi. Giá trị cũ
                 * không còn ai muốn ghi, giữ lại nó chỉ để phát ra dây là sai.
                 * Đây là nguyên tắc "giá trị mới nhất tại lúc phát trên bus" của
                 * spec I/O mở rộng (G7(d)). */
                const std::string superseded = pending.request_id;
                pending = w;
                pending.seq       = next_write_seq_++;
                pending.in_flight = false;
                if (!superseded.empty() && superseded != w.request_id)
                    emit_result(superseded, "rejected", "superseded_by_newer_setpoint", 0);
                coalesced = true;
                break;
            }
        }
        if (!coalesced) {
            if (pending_writes_.size() >= kMaxPendingWrites) {
                std::fprintf(stderr, "ERROR bus_worker.write_queue_full bus=%u slave=%u reg=%u"
                             " limit=%zu — TỪ CHỐI lệnh ghi\n",
                             bus_.id, w.slave_addr, w.reg_addr, kMaxPendingWrites);
                emit_result(w.request_id, "rejected", "write_queue_full", 0);
                return false;
            }
            pending_writes_.push_back(w);
            pending_writes_.back().seq       = next_write_seq_++;
            pending_writes_.back().in_flight = false;
        }
        /* G7(b): lệnh mới là một SỰ KIỆN — worker phải thức ngay, không chờ trần
         * ngủ. Đặt cờ trong cùng vùng khoá với hàng đợi nên worker không thể thấy
         * lệnh mà lỡ cờ, hoặc thấy cờ mà chưa thấy lệnh. */
        wake_pending_ = true;
    }
    wake_cv_.notify_one();
    return true;
}

void BusWorker::wake()
{
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        wake_pending_ = true;
    }
    wake_cv_.notify_one();
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

    /* `ISS-PIO-22` — chỉ đọc block ĐẾN HẠN theo nhóm poll của chính nó.
     *
     * Đây là chỗ tính năng thật sự tiết kiệm dây: một điểm `slow` nằm trong
     * block riêng và chỉ chiếm dây theo nhịp `poll_slow_ms`, thay vì đi cùng
     * mọi lượt poll của thiết bị như trước bản vá. */
    bool polled_any_block = false;
    for (auto& block : binding.blocks) {
        const uint32_t interval_ms = group_interval_ms(block.poll_group, sc.poll_ms,
                                                       sc.poll_fast_ms, sc.poll_slow_ms);
        if (!block_is_due(block.last_poll_ms, now_ms, interval_ms)) continue;
        polled_any_block = true;
        block.last_poll_ms = now_ms;
        uint16_t regs[kMaxRegistersPerBlock] = {};
        std::vector<uint8_t> bits;
        if (block.fc == 1 || block.fc == 2) bits.assign(block.count, 0u);
        int rc = -1;
        /* Theo TỪNG block: lý do lỗi của block trước không được rò sang block sau. */
        uint8_t exception_code = 0;
        kx_ext_quality_reason_t fail_reason = KX_EXTR_TIMEOUT;

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
                std::snprintf(frame.reason, sizeof(frame.reason), "%s",
                              frame_reason(rc, saved_errno));
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
                /* 0x01 ILLEGAL FUNCTION / 0x02 ILLEGAL DATA ADDRESS / 0x03
                 * ILLEGAL DATA VALUE là từ chối XÁC ĐỊNH: phát lại chỉ tốn thêm
                 * dây và cho đúng câu trả lời cũ — dừng thử lại ngay. BUSY (0x06),
                 * ACKNOWLEDGE (0x05)… là thoáng qua nên vẫn được phát lại. */
                if (exception_code >= 0x01 && exception_code <= 0x03) break;
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

        if (rc < 0 && fail_reason == KX_EXTR_DEVICE_EXCEPTION) {
            /* `MBA-FW-05` (audit Modbus 2026-09-25): exception là lỗi của BLOCK.
             *
             * Bản trước đi chung nhánh với timeout: cả DẢI slot của slave bị hạ
             * STALE rồi BAD, lượt poll bị tính là lỗi, và sau `offline_after_errors`
             * lượt thì CẢ thiết bị OFFLINE — chỉ vì MỘT Point khai sai địa chỉ.
             * Người vận hành thấy cả tủ mất liên lạc trong khi dây và thiết bị
             * đều tốt; các Point đúng cũng mất giá trị theo. FW_SOM_DESIGN §6.1
             * yêu cầu exception ⇒ BAD ở cấp Point, không phải OFFLINE thiết bị.
             *
             * Nay: chỉ các Point của block này mang BAD/DEVICE_EXCEPTION (kèm mã
             * gốc), các block khác vẫn được đọc, và thiết bị vẫn là ONLINE vì nó
             * đang trả lời. */
            if (!block.exception_active || block.exception_code != exception_code) {
                std::fprintf(stderr, "WARN  modbus.block_exception bus=%u slave=%s addr=%u fc=%u"
                             " reg=%u count=%u exception=0x%02x — chỉ các Point của block này BAD,"
                             " thiết bị vẫn ONLINE\n",
                             bus_.id, sc.name.c_str(), sc.addr, block.fc, block.addr, block.count,
                             exception_code);
            }
            block.exception_active = true;
            block.exception_code   = exception_code;
            for (const auto& member : block.members) {
                const uint16_t slots = ext_slots_for_point(*member.point);
                if (slots == 0) continue;
                cache.mark_range_quality(member.ext_index, slots, KX_EXTQ_BAD,
                                         KX_EXTR_DEVICE_EXCEPTION, true);
                cache.mark_range_exception(member.ext_index, slots, exception_code);
            }
            continue;
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
            break;
        }

        if (block.exception_active) {
            std::fprintf(stderr, "INFO  modbus.block_exception_cleared bus=%u slave=%s fc=%u reg=%u\n",
                         bus_.id, sc.name.c_str(), block.fc, block.addr);
            block.exception_active = false;
            block.exception_code   = 0;
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
                    if (pt.bit_index >= 0) {
                        /* `MBA-FW-09`: một bit của register, không phải cả register. */
                        eng = ((regs[member.offset + k] >> pt.bit_index) & 1u) ? 1.0 : 0.0;
                    } else {
                        eng = static_cast<double>(
                            decode_register(regs + member.offset + k, is32 ? 2u : 1u,
                                            pt.type, pt.byte_order, pt.scale, pt.offset));
                    }
                    if (is32) k++;
                }

                if (!std::isfinite(eng)) {
                    quality = KX_EXTQ_BAD;
                    reason  = KX_EXTR_DECODE_ERROR;
                } else if ((pt.has_min && eng < pt.min_value) || (pt.has_max && eng > pt.max_value)) {
                    /* `MBA-FW-09`: ngoài biên kỹ thuật khai báo — số vô lý không
                     * được publish với nhãn GOOD. */
                    quality = KX_EXTQ_BAD;
                    reason  = KX_EXTR_OUT_OF_RANGE;
                }

                if (quality == KX_EXTQ_GOOD) {
                    cache.set_sample(ext_idx, point_name, eng, quality, reason,
                                     sc.addr, bus_.id, true, pt.writable,
                                     sample_utc, sample_mono);
                } else {
                    /* FW_SOM_DESIGN §6.1: BAD ⇒ KHÔNG cập nhật value và GIỮ mốc
                     * thời gian — mốc trả lời "lần cuối thiết bị nói thật". Bản
                     * trước ghi luôn NaN/giá trị hỏng kèm mốc mới. */
                    cache.mark_bad_sample(ext_idx, reason);
                }
                ext_idx++;
                logical++;
            }
        }
    }

    /* `ISS-PIO-22` — KHÔNG có block nào đến hạn nghĩa là lượt này không hề chạm
     * dây. Báo `on_poll_ok` ở đây sẽ giữ slave "ONLINE" vĩnh viễn mà chưa từng
     * hỏi nó câu nào — một slave đã rút cáp vẫn hiện khoẻ mạnh. Không có I/O
     * thì không có gì để báo cáo, kể cả thành công. */
    if (!polled_any_block) return;

    if (slave_ok) {
        /* Chỉ ghi mốc "đọc thật thành công" cho các block VỪA đọc trong lượt
         * này; block chưa đến hạn giữ nguyên mốc cũ và tiếp tục già đi. */
        for (auto& block : binding.blocks) {
            if (block.last_poll_ms == now_ms && !block.exception_active) block.last_ok_ms = now_ms;
        }
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

/* `ISS-PIO-22` — hạ STALE theo NGƯỠNG CỦA CHÍNH ĐIỂM.
 *
 * Trước bản vá chỉ có một đường xuống cấp: slave timeout ⇒ cả dải slot của
 * slave rơi STALE. Một thiết bị vẫn trả lời (slave ONLINE) nhưng ngừng cập nhật
 * đúng một block — vì địa chỉ đó bị gỡ, vì cảm biến rời ra — sẽ giữ giá trị cũ
 * mãi mãi với quality GOOD. Đó là kiểu nói dối êm ái nguy hiểm nhất: không có
 * cảnh báo nào, và người vận hành tin vào một con số đã chết.
 *
 * `mark_range_quality` GIỮ NGUYÊN mốc thời gian của mẫu — đúng như hợp đồng của
 * `ExtCache`: mốc trả lời "lần cuối thiết bị nói thật là khi nào", nên hạ
 * quality không được phép làm mẫu trẻ lại. */
void BusWorker::sweep_stale_blocks(uint64_t now_ms, ExtCache& cache)
{
    for (auto& binding : slaves_) {
        if (binding.config_error) continue;
        const SlaveConfig& sc = binding.cfg;
        for (const auto& block : binding.blocks) {
            /* Chưa từng đọc thành công lần nào thì slot đang mang
             * BAD/NOT_INITIALIZED từ `declare_point` — đó đã là sự thật đúng,
             * và ghi đè bằng STALE sẽ làm mất lý do cụ thể hơn. */
            if (block.last_ok_ms == 0) continue;
            if (now_ms < block.last_ok_ms) continue; /* đồng hồ lùi */
            /* BAD/DEVICE_EXCEPTION là sự thật cụ thể hơn STALE/TIMEOUT. */
            if (block.exception_active) continue;

            const uint32_t interval = group_interval_ms(block.poll_group, sc.poll_ms,
                                                        sc.poll_fast_ms, sc.poll_slow_ms);
            for (const auto& member : block.members) {
                const uint32_t threshold =
                    effective_stale_after_ms(member.point->stale_after_ms, interval);
                if (now_ms - block.last_ok_ms < threshold) continue;
                const uint16_t slots = ext_slots_for_point(*member.point);
                if (slots == 0) continue;
                cache.mark_range_quality(member.ext_index, slots,
                                         KX_EXTQ_STALE, KX_EXTR_TIMEOUT, binding.state.online);
            }
        }
    }
}

void BusWorker::note_dropped_write_slot(uint16_t ext_idx)
{
    std::lock_guard<std::mutex> lock(queue_mu_);
    /* Trùng lặp vô hại nhưng tốn bộ nhớ nếu một slot hỏng liên tục; chặn ngay. */
    for (uint16_t existing : dropped_write_slots_)
        if (existing == ext_idx) return;
    dropped_write_slots_.push_back(ext_idx);
}

void BusWorker::record_write_frame(const PendingWrite& w, uint8_t slave, int rc, int saved_errno,
                                   uint32_t elapsed_us, FieldbusMetrics& metrics)
{
    FrameRecord frame;
    frame.at_ms      = frame_wall_clock_ms();
    frame.bus        = bus_.id;
    frame.slave      = slave;
    frame.fc         = w.fc;
    frame.addr       = w.reg_addr;
    frame.count      = (w.fc == 16) ? 2u : 1u;
    frame.elapsed_us = elapsed_us;
    frame.attempt    = w.attempts;
    frame.ok         = rc >= 0;
    std::snprintf(frame.reason, sizeof(frame.reason), "%s", frame_reason(rc, saved_errno));
    metrics.frames().record(frame);
}

size_t BusWorker::oldest_pending_slave(const std::vector<bool>& visited) const
{
    std::lock_guard<std::mutex> lock(queue_mu_);
    size_t best = slaves_.size();
    uint64_t best_seq = UINT64_MAX;
    for (const auto& w : pending_writes_) {
        if (w.submitted || w.in_flight || w.seq >= best_seq) continue;
        for (size_t i = 0; i < slaves_.size(); i++) {
            if (visited[i] || slaves_[i].cfg.addr != w.slave_addr) continue;
            best = i;
            best_seq = w.seq;
            break;
        }
    }
    return best;
}

size_t BusWorker::service_writes(uint64_t now_ms, FieldbusMetrics& metrics, size_t budget)
{
    size_t used = 0;
    std::vector<bool> visited(slaves_.size(), false);
    while (used < budget && port_open()) {
        const size_t i = oldest_pending_slave(visited);
        if (i >= slaves_.size()) break;
        visited[i] = true;
        used += flush_pending(i, now_ms, metrics, budget - used);
    }
    return used;
}

size_t BusWorker::flush_pending(size_t i, uint64_t now_ms, FieldbusMetrics& metrics,
                                size_t max_items)
{
#ifndef MKDDC_ENABLE_MODBUS
    (void)i; (void)now_ms; (void)metrics; (void)max_items;
    return 0;
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
        /* `MBA-FW-04`: chỉ chụp mục của slave này, và ĐÁNH DẤU chúng đang bay
         * ngay trong vùng khoá. Từ đây tới lúc hợp nhất, `enqueue_write` không
         * được ghi đè chúng — lệnh mới cho cùng register thành mục riêng.
         *
         * G7(c): chụp tối đa `max_items` mục theo thứ tự hàng đợi; phần còn lại
         * KHÔNG bị đánh dấu đang bay và vẫn coalesce được bình thường. */
        for (auto& live : pending_writes_) {
            if (batch.size() >= max_items) break;
            if (live.submitted || live.slave_addr != sc.addr) continue;
            live.in_flight = true;
            batch.push_back(live);
        }
    }

    for (auto& w : batch) {
        if (w.slave_addr != sc.addr || w.submitted) continue;

        /* `ISS-PIO-23` — tuỳ chọn `verify_after_write` khai theo ĐIỂM cũng bật
         * xác nhận, không chỉ cờ trên request. Một điểm actuator đã khai "phải
         * kiểm chứng" thì mọi đường ghi tới nó đều phải kiểm chứng — nếu chỉ
         * nghe cờ request thì đúng những lệnh không tự yêu cầu (lịch trình,
         * chương trình ST, safe-state) lại đi qua mà không ai xác nhận. */
        for (const auto& pt : binding.profile.points) {
            if (pt.addr != w.reg_addr) continue;
            const bool coil_write = (w.fc == 5 || w.fc == 15);
            const bool coil_point = (pt.fc == 1 || pt.fc == 5 || pt.fc == 15);
            if (coil_write != coil_point) continue;
            if (pt.verify_after_write) w.readback = true;
            if (w.readback_tolerance <= 0.0) w.readback_tolerance = pt.readback_tolerance;
            break;
        }

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
        const uint32_t write_elapsed_us = static_cast<uint32_t>((monotonic_ns() - t0) / 1000);
        metrics.record_bus_transaction(bus_.id, write_elapsed_us, rc >= 0);

        w.attempts++;
        record_write_frame(w, sc.addr, rc, saved_errno, write_elapsed_us, metrics);

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
        if (w.readback) {
            /* `ISS-PIO-23` — coil cũng phải xác nhận được. Bản MBR-B107 chỉ đọc
             * lại thanh ghi, nên đúng nhóm điểm nguy hiểm nhất — relay đóng/cắt
             * — không có cách nào kiểm chứng. */
            bool read_ok = false;
            double observed = 0.0;
            if (w.fc == 5 || w.fc == 15) {
                uint8_t rb_bit = 0;
                if (modbus_read_bits(ctx, w.reg_addr, 1, &rb_bit) >= 0) {
                    read_ok  = true;
                    observed = rb_bit ? 1.0 : 0.0;
                }
            } else {
                uint16_t rb[2] = {};
                const int n = (w.fc == 16) ? 2 : 1;
                if (modbus_read_registers(ctx, w.reg_addr, n, rb) >= 0) {
                    read_ok  = true;
                    observed = static_cast<double>(
                        decode_register(rb, static_cast<uint16_t>(n), w.type, w.byte_order,
                                        w.scale, w.offset));
                }
            }

            /* Giá trị ĐÃ GHI để đối chiếu: với coil là 0/1 chuẩn hoá, với thanh
             * ghi là chính `w.value` (đơn vị kỹ thuật, cùng hệ với `decode`). */
            const double intended = (w.fc == 5 || w.fc == 15)
                                        ? ((w.value != 0.0f) ? 1.0 : 0.0)
                                        : static_cast<double>(w.value);

            /* Luật "khi nào được nói applied" nằm ở `verify_write_outcome` —
             * hàm thuần, kiểm được mà không cần dựng bus giả. Bản MBR-B107 để
             * luật này lẫn trong vòng lặp và chỉ đặt `reason`, còn `status` vẫn
             * là `applied`, nên không consumer nào phân biệt được một lệnh đã
             * xác nhận thật với một lệnh chưa chứng minh được gì. */
            const VerifyOutcome outcome =
                verify_write_outcome(read_ok, intended, observed, w.scale, w.readback_tolerance);
            result.has_readback   = read_ok;
            result.readback_value = read_ok ? observed : 0.0;
            result.status = outcome.status;
            result.reason = outcome.reason;

            if (result.status != std::string("applied")) {
                metrics.record_write_failed(binding.global_idx);
                if (!read_ok) {
                    std::fprintf(stderr, "WARN  modbus.readback_failed bus=%u slave=%s addr=%u fc=%u"
                                 " reg=%u — slave ACK lệnh ghi nhưng KHÔNG đọc lại được để xác nhận\n",
                                 bus_.id, sc.name.c_str(), sc.addr, w.fc, w.reg_addr);
                } else {
                    /* Ca mà issue nêu đích danh: nhiều VFD ACK lệnh rồi bỏ qua
                     * khi tham số bị khoá. Báo `applied` ở đây là nói dối về một
                     * thiết bị đang không nghe lời. */
                    std::fprintf(stderr, "ERROR modbus.readback_mismatch bus=%u slave=%s addr=%u"
                                 " fc=%u reg=%u written=%g read_back=%g — thiết bị KHÔNG giữ giá trị\n",
                                 bus_.id, sc.name.c_str(), sc.addr, w.fc, w.reg_addr,
                                 intended, observed);
                }
            }
        }
        if (!w.request_id.empty() && result_sink_) result_sink_(result);

        w.submitted = true;
    }

    /* Hợp nhất lại: chép trạng thái đã xử lý về hàng đợi thật rồi xoá phần đã
     * xong. Request mới do control thread thêm trong lúc flush KHÔNG bị mất vì
     * chúng không nằm trong `batch` và được giữ nguyên.
     *
     * `MBA-FW-04`: khớp theo `seq`, KHÔNG theo `(slave, fc, reg, request_id)`.
     * Khoá cũ trùng nhau cho hai lệnh ghi cùng register trên đường cờ `dirty`
     * (request_id rỗng), nên lệnh MỚI thêm trong lúc flush bị đánh "đã gửi" và
     * xoá — setpoint cuối cùng của một chuỗi thay đổi biến mất im lặng, còn dedup
     * `last_written_` ở `ModbusMaster` chặn luôn việc phát lại nó. */
    std::vector<std::string> superseded_ids;
    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        for (const auto& done : batch) {
            for (auto& live : pending_writes_) {
                if (live.seq != done.seq) continue;
                live.attempts    = done.attempts;
                live.submitted   = done.submitted;
                live.enqueued_ms = done.enqueued_ms;
                live.in_flight   = false;
                break;
            }
        }
        /* Mục phát lỗi còn chờ thử lại mà đã có lệnh MỚI HƠN cho cùng register ⇒
         * bỏ mục cũ: phát lại nó sau đó chỉ để lệnh mới ghi đè ngay là vô nghĩa,
         * và nếu lệnh mới lỗi thì thiết bị sẽ bị kéo về giá trị cũ. */
        for (auto& old_write : pending_writes_) {
            if (old_write.submitted || old_write.in_flight) continue;
            for (const auto& newer : pending_writes_) {
                if (newer.submitted || newer.seq <= old_write.seq) continue;
                if (newer.slave_addr == old_write.slave_addr && newer.fc == old_write.fc &&
                    newer.reg_addr == old_write.reg_addr) {
                    old_write.submitted = true;
                    if (!old_write.request_id.empty() && old_write.request_id != newer.request_id)
                        superseded_ids.push_back(old_write.request_id);
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
    for (const auto& id : superseded_ids)
        emit_result(id, "rejected", "superseded_by_newer_setpoint", 0);
    return batch.size();
#endif
}

void BusWorker::poll_once(uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics)
{
    /* Xoá ở ĐẦU hàm, trước mọi nhánh thoát sớm: cờ còn sót từ lượt trước mà
     * lượt này thoát ở nhánh cổng lỗi thì `run_loop` sẽ `continue` mãi mà không
     * làm gì — đúng vòng quay rỗng mà G7 cấm. */
    writes_deferred_ = false;
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

    /* Quét stale TRƯỚC khi đọc: một block quá hạn phải hạ quality ngay cả khi
     * lượt này nó lại được đọc thành công — thứ tự ngược sẽ xoá dấu vết của
     * chính khoảng thời gian dữ liệu đã cũ. Lượt đọc sau đó ghi đè bằng mẫu
     * mới, đúng như mong muốn. */
    sweep_stale_blocks(now_ms, cache);

    /* `ISS-MBW-02`: LỆNH GHI KHÔNG ĐƯỢC ĐI NHỜ LỊCH ĐỌC.
     *
     * Trước bản sửa đó `flush_pending` chỉ có MỘT nơi gọi, nằm trong vòng `due`:
     * worker tỉnh dậy mà không slave nào tới hạn ĐỌC thì lệnh ghi nằm im tới
     * lượt đọc kế. Đo trên bo Foxlinx (CK-508 slave 04, `poll_ms=1000`): từ lúc
     * API trả `200 success` tới lúc relay đổi trạng thái là 16 s / 60 s / 97 s /
     * 153 s. Ghép độ trễ ghi vào chu kỳ đọc là sai về bản chất: đọc thưa là lựa
     * chọn tiết kiệm băng thông dây; ghi thưa là lệnh điều khiển đến muộn.
     *
     * G7(c) (EV-PROG-FBD-ST-MB-20260925): GHI TRƯỚC ĐỌC, CÓ TRẦN.
     *
     * `ISS-MBW-02` vẫn để lệnh ghi đi SAU mọi lượt đọc tới hạn trong cùng lượt
     * phục vụ, nên một lệnh Core → FC05 phải đợi trọn các giao dịch đọc (29 ms
     * mỗi block ở 9600 baud, nhân với số block và số slave tới hạn). Nay trước
     * MỖI lượt đọc slave, worker phát tối đa `kMaxWritesBeforeRead` lệnh ghi
     * đang chờ — lệnh cũ nhất trước. Trần ấy giữ cho đọc không bị bỏ đói khi
     * Program đảo output nhanh hơn nhịp bus: giữa hai lượt đọc tới hạn liên tiếp
     * có tối đa `kMaxWritesBeforeRead` giao dịch ghi.
     *
     * Hai bất biến của `ISS-MBW-02` giữ nguyên: lượt ghi KHÔNG chạm lịch đọc
     * (`last_poll_ms`), và hàng đợi rỗng thì không phát một byte nào —
     * `service_writes` chỉ soi hàng đợi trong bộ nhớ. */
    size_t last_writes = service_writes(now_ms, metrics, kMaxWritesBeforeRead);
    if (!port_open()) return;
    for (const auto& d : due) {
        read_slave(d.idx, now_ms, cache, metrics);
        if (!port_open()) return;   /* cổng chết giữa chừng — nhường vòng sau */
        last_writes = service_writes(now_ms, metrics, kMaxWritesBeforeRead);
        if (!port_open()) return;
    }
    if (last_writes >= kMaxWritesBeforeRead) {
        /* Chạm trần mà hàng đợi vẫn còn ⇒ báo `run_loop` phục vụ tiếp ngay. */
        std::lock_guard<std::mutex> lock(queue_mu_);
        for (const auto& w : pending_writes_) {
            if (!w.submitted) { writes_deferred_ = true; break; }
        }
    }
}

void BusWorker::run_loop(const std::atomic<bool>& stop, ExtCache& cache, FieldbusMetrics& metrics)
{
    /* `MBA-FW-01`: thread này được tạo từ `main` đang ở SCHED_FIFO và thừa hưởng
     * nó — hạ về SCHED_OTHER trước I/O đầu tiên (FW_SOM_DESIGN §2). */
    {
        char name[16];
        std::snprintf(name, sizeof(name), "mb-bus%u", static_cast<unsigned>(bus_.id));
        demote_to_normal_sched(name);
    }
    metrics.set_bus_state(bus_.id, bus_state_name(state_));
    while (!stop.load(std::memory_order_relaxed)) {
        /* Xoá cờ TRƯỚC `poll_once`: sự kiện tới trong lúc đang phục vụ giữ cờ
         * bật, và lần chờ bên dưới trả về ngay thay vì bỏ lỡ nó. */
        {
            std::lock_guard<std::mutex> lock(queue_mu_);
            wake_pending_ = false;
        }
        const uint64_t now = monotonic_ms();
        poll_once(now, cache, metrics);
        /* Vừa chạm trần ghi mà hàng đợi còn ⇒ phục vụ tiếp, không ngủ. Không
         * quay rỗng được: cờ chỉ bật sau khi đã xử lý đủ trần mục ghi. */
        if (writes_deferred_) continue;
        uint32_t wait = sleep_ms_until_next(monotonic_ms());
        if (!port_open() && state_ == BusState::PORT_ERROR) {
            const uint64_t nowb = monotonic_ms();
            wait = (reopen_at_ms_ > nowb) ? static_cast<uint32_t>(reopen_at_ms_ - nowb) : 0u;
        }
        /* G7(b): `sleep_for` với trần 200 ms là thứ từng quyết định độ trễ ghi
         * — chú thích cũ nói worker "tỉnh đủ dày để phản ứng với lệnh ghi mới",
         * nhưng lệnh vào hàng đợi lúc worker vừa ngủ vẫn chờ tới 200 ms; `stop`
         * và probe cũng vậy. Nay worker ngủ trên `wake_cv_` và bị ĐÁNH THỨC bởi
         * chính sự kiện; trần `kWorkerMaxSleepMs` chỉ còn là lưới an toàn. */
        if (wait > kWorkerMaxSleepMs) wait = kWorkerMaxSleepMs;
        if (wait == 0u) wait = 1u;
        std::unique_lock<std::mutex> lock(queue_mu_);
        wake_cv_.wait_for(lock, std::chrono::milliseconds(wait), [&]() {
            return wake_pending_ || stop.load(std::memory_order_relaxed);
        });
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
        /* G7(b): kỹ thuật viên đang chờ kết quả trên UI — đánh thức worker
         * thay vì để probe nằm chờ hết giấc ngủ của nó. */
        wake_pending_ = true;
    }
    wake_cv_.notify_one();
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
