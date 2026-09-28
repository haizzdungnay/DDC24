/**
 * @file  main.cpp (mkddc-iobus)
 * @brief Entry: init → config → shm → UART → handshake → poll 100Hz → signal → sd_notify.
 *        Startup sequence đúng bảng 06 §13. State machine 05 §13.
 */
#include <sys/stat.h>
#include <sys/uio.h>
#include <algorithm>
#include <cstdlib>
#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <chrono>
#include <cerrno>
#include <sstream>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <thread>
#include <string>

#include <unistd.h>

#include "bridge/core_bridge.hpp"
#include "bridge/output_command.hpp"
#include "config/iobus_config.hpp"
#include "diagnostics/alarm_publisher.hpp"
#include "diagnostics/iobus_metrics.hpp"
#include "diagnostics/poll_loop_timing.hpp"
#include "io/io_cache.hpp"
#include "io/io_conditioning.hpp"
#include "io/io_scaling.hpp"
#include "io/io_types.hpp"
#include "iop/iop_client.hpp"
#include "modbus_rtu/ext_cache.hpp"
#include "modbus_rtu/fieldbus_config.hpp"
#include "modbus_rtu/fieldbus_metrics.hpp"
#include "modbus_rtu/control_channel.hpp"
#include "modbus_rtu/control_status.hpp"
#include "modbus_rtu/bus_worker.hpp"
#include "modbus_rtu/modbus_master.hpp"
#include "modbus_rtu/modbus_tcp.hpp"
#include "modbus_rtu/plc_shm_view.hpp"
#include "modbus_rtu/thread_policy.hpp"
#include "bacnet/bacnet_config.hpp"
#include "bacnet/bacnet_objects.hpp"
#include "bacnet/bacnet_server.hpp"
#include "mkddc_shm.h"
#include "platform/realtime.hpp"
#include "platform/network_address.hpp"
#include "platform/pid_file.hpp"
#include "platform/systemd_notify.hpp"
#include "build_info.h"

namespace {

std::atomic<bool> g_shutdown{false};
std::atomic<bool> g_reload{false};

void on_signal(int)
{
    g_shutdown.store(true);
}

void on_sighup(int)
{
    g_reload.store(true);
}

uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

uint64_t now_ms()
{
    return now_ns() / 1000000ull;
}

void sleep_until(struct timespec* next, uint64_t period_ns)
{
    next->tv_nsec += static_cast<long>(period_ns);
    while (next->tv_nsec >= 1000000000L) {
        next->tv_nsec -= 1000000000L;
        next->tv_sec += 1;
    }
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, next, nullptr);
}

/* Adapter IopClient → CommandSink cho OutputCommand */
class ClientSink : public iobus::CommandSink {
public:
    explicit ClientSink(iobus::IopClient& c) : c_(c) {}
    iobus::IopResult send_set_do(uint8_t mask, uint8_t value) override { return c_.set_do(mask, value); }
    iobus::IopResult send_set_ao(const uint16_t raw[KX_N_AO]) override { return c_.set_ao(raw); }
private:
    iobus::IopClient& c_;
};

const char* plc_shm_name()
{
    const char* path = KX_SHM_PLC_PATH;
    const char* base = std::strrchr(path, '/');
    return base ? base : path;
}

const kx_plc_shm_t* try_attach_plc_shm()
{
    const int fd = ::shm_open(plc_shm_name(), O_RDONLY, 0);
    if (fd < 0) return nullptr;
    void* mem = ::mmap(nullptr, sizeof(kx_plc_shm_t), PROT_READ, MAP_SHARED, fd, 0);
    ::close(fd);
    if (mem == MAP_FAILED) return nullptr;
    const auto* shm = static_cast<const kx_plc_shm_t*>(mem);
    if (__atomic_load_n(&shm->magic, __ATOMIC_ACQUIRE) != KX_SHM_MAGIC) {
        ::munmap(mem, sizeof(kx_plc_shm_t));
        return nullptr;
    }
    return shm;
}

bool send_core_command(const std::string& sock_path, const std::string& op,
                       uint32_t point_idx, float value, const std::string& user,
                       int prio)
{
    std::string point;
    if (op == "ao_setpoint" || op == "release_ao") point = "AO";
    else if (op == "do_cmd" || op == "release_bo") point = "DO";
    else if (op == "av_setpoint") point = "AV";
    else if (op == "bv_setpoint") point = "BV";
    else if (op == "msv_setpoint") point = "MSV";
    else return false;
    point += std::to_string(point_idx + 1);
    const bool release = op.rfind("release_", 0) == 0;

    const int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return false;
    struct timeval timeout {2, 0};
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, sock_path.c_str(), sizeof(addr.sun_path) - 1);
    if (::connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
        ::close(fd);
        return false;
    }

    static std::atomic<uint64_t> command_id{1};
    std::ostringstream json;
    json << "{\"id\":" << command_id.fetch_add(1)
         << ",\"op\":\"" << (release ? "release" : "write")
         << "\",\"point\":\"" << point
         << "\",\"source\":\"bacnet\",\"user\":\"" << user << "\"";
    if (!release) json << ",\"value\":" << value;
    json << ",\"priority\":" << prio << "}\n";
    const std::string request = json.str();
    if (::send(fd, request.data(), request.size(), MSG_NOSIGNAL) !=
        static_cast<ssize_t>(request.size())) {
        ::close(fd);
        return false;
    }

    char response[512] = {};
    const ssize_t n = ::recv(fd, response, sizeof(response) - 1, 0);
    ::close(fd);
    if (n <= 0) return false;
    const std::string result(response, static_cast<size_t>(n));
    return result.find("\"result\":\"accepted\"") != std::string::npos ||
           result.find("\"result\":\"released\"") != std::string::npos;
}

const char* configured_unit(const iobus::UiScaleConfig& cfg)
{
    return cfg.unit.empty() ? iobus::sensor_unit(cfg.sensor) : cfg.unit.c_str();
}

const char* configured_raw_unit(const iobus::UiScaleConfig& cfg)
{
    return cfg.enabled ? iobus::sensor_raw_unit(cfg.sensor) : "";
}

void build_ui_units(const iobus::IobusConfig& cfg, char units[KX_N_UI][8],
                    char raw_units[KX_N_UI][8])
{
    for (int i = 0; i < KX_N_UI; i++) {
        std::strncpy(units[i], configured_unit(cfg.ui[i]), sizeof(units[i]) - 1);
        units[i][sizeof(units[i]) - 1] = '\0';
        std::strncpy(raw_units[i], configured_raw_unit(cfg.ui[i]), sizeof(raw_units[i]) - 1);
        raw_units[i][sizeof(raw_units[i]) - 1] = '\0';
    }
}

/* Chuyển FieldbusMetrics sang layout SHM rồi publish cho Web (finding F-03).
 * Trước đây số liệu này chỉ sống trong iobus, nên trang Web phải bịa error rate
 * = 0 và dùng chung một poll state cho mọi slave. */
void publish_fieldbus_metrics(iobus::IoCache& cache,
                              const iobus::fieldbus::FieldbusMetrics& metrics)
{
    kx_slave_metrics_t out[KX_N_FB_SLAVE] = {};
    kx_modbus_diag_t diagnostics[KX_N_FB_SLAVE] = {};
    size_t count = metrics.size();
    if (count > KX_N_FB_SLAVE) count = KX_N_FB_SLAVE;
    for (size_t i = 0; i < count; i++) {
        const auto& m = metrics.get(static_cast<uint8_t>(i));
        out[i].last_seen_ms = m.last_seen_ms;
        out[i].total_polls  = m.total_polls;
        out[i].total_errors = m.total_errors;
        out[i].addr         = m.addr;
        out[i].online       = m.online ? 1u : 0u;
        out[i].bus_id       = m.bus_id;
        diagnostics[i].timeout_errors = m.timeout_errors;
        diagnostics[i].crc_errors = m.crc_errors;
        diagnostics[i].retry_attempts = m.retry_attempts;
        diagnostics[i].write_failed = m.write_failed;
        diagnostics[i].write_dropped = m.write_dropped;
        diagnostics[i].consecutive_errors = m.consecutive_errors;
        diagnostics[i].last_exception = m.last_exception;
    }
    cache.write_fieldbus_metrics(out, count);
    cache.write_modbus_diagnostics(diagnostics, count);

    /* MBR-B305: bus metrics đo thật. Trước bản này chúng không tồn tại, nên
     * handler Go phải điền hằng số và trang Overview hiển thị số không do thiết
     * bị nào sinh ra. */
    kx_bus_metrics_t buses[KX_N_FB_BUS] = {};
    size_t bus_count = metrics.bus_count();
    if (bus_count > KX_N_FB_BUS) bus_count = KX_N_FB_BUS;
    for (size_t i = 0; i < bus_count; i++) {
        const auto& b = metrics.bus(i);
        buses[i].total_transactions   = b.total_transactions;
        buses[i].total_errors         = b.total_errors;
        buses[i].port_reopens         = b.port_reopens;
        buses[i].latency_p50_us       = b.latency_p50_us;
        buses[i].latency_p95_us       = b.latency_p95_us;
        buses[i].latency_max_us       = b.latency_max_us;
        buses[i].baud                 = b.baud;
        buses[i].utilization_pct_x100 = b.utilization_pct_x100;
        buses[i].id                   = b.id;
        buses[i].parity               = b.parity;
        buses[i].stop_bits            = b.stop;
        std::strncpy(buses[i].name, b.name.c_str(), sizeof(buses[i].name) - 1);
        std::strncpy(buses[i].device, b.device.c_str(), sizeof(buses[i].device) - 1);
        std::strncpy(buses[i].state, b.state.c_str(), sizeof(buses[i].state) - 1);
    }
    cache.write_bus_metrics(buses, bus_count, metrics.producer_boot_id(),
                            metrics.counters_since_ms());
}

} // namespace


/* EV-PROG-FBD-ST-MB-20260925 F08 — mức log tới được journald.
 *
 * Binary in mọi dòng ra stderr với mức ở dạng CHỮ ("WARN  …", "ERROR …"), còn
 * journald chỉ hiểu tiền tố `<N>` đứng đầu dòng. Thiếu tiền tố thì mọi dòng là
 * priority info, và `journalctl -p warning` trả "No entries" trong lúc dịch vụ
 * đang cảnh báo — đúng cách baseline audit 2026-09-25 báo "0 cảnh báo" sai.
 * Chỉ bật khi chạy dưới systemd (`JOURNAL_STREAM`); buffer TĨNH, không cấp phát
 * trong đường ghi vì luồng quét RT cũng in log. Bản sao cùng nội dung nằm ở
 * `main.cpp` của binary kia (Core/iobus không có thư viện dùng chung). */
namespace {
namespace journal_level {

struct Sink {
    int    fd = -1;
    char   carry[4096];
    size_t used = 0;
};

Sink g_sink;

int level_of(const char* line, size_t n)
{
    auto starts = [&](const char* token) {
        const size_t k = std::strlen(token);
        return n >= k && std::memcmp(line, token, k) == 0;
    };
    if (starts("ERROR") || starts("ALARM") || starts("FATAL")) return 3;
    if (starts("WARN")) return 4;
    if (starts("INFO") || starts("AUDIT")) return 6;
    if (starts("DEBUG")) return 7;
    return -1;
}

void write_all(int fd, const char* data, size_t n)
{
    while (n > 0) {
        const ssize_t written = ::write(fd, data, n);
        if (written < 0) {
            if (errno == EINTR) continue;
            return;
        }
        data += written;
        n -= static_cast<size_t>(written);
    }
}

void emit_line(Sink* sink, const char* line, size_t n)
{
    const int level = level_of(line, n);
    if (level >= 0) {
        char prefix[3] = {'<', static_cast<char>('0' + level), '>'};
        struct iovec parts[2] = {{prefix, sizeof(prefix)}, {const_cast<char*>(line), n}};
        /* Một syscall ⇒ tiền tố không tách khỏi dòng. Hỏng thì ghi nguyên văn:
         * mất tiền tố còn hơn mất dòng log. */
        if (::writev(sink->fd, parts, 2) < 0) write_all(sink->fd, line, n);
    } else {
        write_all(sink->fd, line, n);
    }
}

ssize_t cookie_write(void* cookie, const char* buf, size_t size)
{
    auto* sink = static_cast<Sink*>(cookie);
    size_t start = 0;
    for (size_t i = 0; i < size; ++i) {
        if (buf[i] != '\n') continue;
        if (sink->used > 0) {
            /* Ghép phần dở của lần ghi trước với phần đầu lần này. */
            const size_t take = std::min(i + 1 - start, sizeof(sink->carry) - sink->used);
            std::memcpy(sink->carry + sink->used, buf + start, take);
            emit_line(sink, sink->carry, sink->used + take);
            sink->used = 0;
        } else {
            emit_line(sink, buf + start, i + 1 - start);
        }
        start = i + 1;
    }
    if (start < size) {
        const size_t rest = size - start;
        if (sink->used + rest > sizeof(sink->carry)) {
            /* Dòng dài bất thường: xả nguyên văn thay vì cắt mất dữ liệu. */
            write_all(sink->fd, sink->carry, sink->used);
            write_all(sink->fd, buf + start, rest);
            sink->used = 0;
        } else {
            std::memcpy(sink->carry + sink->used, buf + start, rest);
            sink->used += rest;
        }
    }
    return static_cast<ssize_t>(size);
}

/* `JOURNAL_STREAM` = "dev:inode" của stream journald mà systemd nối vào
 * stdout/stderr. Chỉ tin nó khi stderr THẬT SỰ là stream đó: tiến trình con
 * thừa hưởng biến môi trường trong khi stderr đã bị chuyển sang pipe/file
 * (test bắt stderr) thì không được gắn tiền tố. */
bool stderr_is_journal_stream()
{
    const char* value = std::getenv("JOURNAL_STREAM");
    if (value == nullptr) return false;
    unsigned long long dev = 0, ino = 0;
    if (std::sscanf(value, "%llu:%llu", &dev, &ino) != 2) return false;
    struct stat st {};
    if (::fstat(STDERR_FILENO, &st) != 0) return false;
    return static_cast<unsigned long long>(st.st_dev) == dev &&
           static_cast<unsigned long long>(st.st_ino) == ino;
}

void install_if_journald()
{
    if (!stderr_is_journal_stream()) return;
    g_sink.fd = ::dup(STDERR_FILENO);
    if (g_sink.fd < 0) return;
    cookie_io_functions_t io{};
    io.write = cookie_write;
    FILE* stream = ::fopencookie(&g_sink, "w", io);
    if (stream == nullptr) return;
    std::setvbuf(stream, nullptr, _IOLBF, 0);
    stderr = stream;
}

} // namespace journal_level
} // namespace

int main(int argc, char** argv)
{
    journal_level::install_if_journald();
    using namespace iobus;

    std::string config_path = "/data/config/io_config.conf";
    bool config_from_cli = false;
    std::string uart_override;
    std::string log_level_override;
    std::string fieldbus_config_path = "/data/config/fieldbus.conf";
    std::string fieldbus_sock_path = "/run/mkddc/fieldbus.sock";
    /* MBR-B105: kênh điều khiển tách khỏi đường snapshot — một bên là dữ liệu
     * chảy liên tục (datagram, mất được), một bên là mệnh lệnh (stream, phải ACK). */
    std::string fieldbus_control_sock_path = "/run/mkddc/modbus-control.sock";
    bool fieldbus_config_from_cli = false;
    std::string device_config_path = "/data/config/device.conf";
    std::string bacnet_config_path = "/data/config/bacnet.conf";
    std::string core_sock_path = "/run/mkddc/core.sock";
    bool bacnet_config_from_cli = false;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--version") { std::printf("version=%s git_commit=%s build_time=%s toolchain=%s\n", MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN); return 0; }
        else if (a == "--config" && i + 1 < argc)         { config_path = argv[++i]; config_from_cli = true; }
        else if (a == "--uart" && i + 1 < argc)      { uart_override = argv[++i]; }
        else if (a == "--log-level" && i + 1 < argc) { log_level_override = argv[++i]; }
        else if (a == "--fieldbus-config" && i + 1 < argc) { fieldbus_config_path = argv[++i]; fieldbus_config_from_cli = true; }
        else if (a == "--fieldbus-sock" && i + 1 < argc) { fieldbus_sock_path = argv[++i]; }
        else if (a == "--fieldbus-control-sock" && i + 1 < argc) { fieldbus_control_sock_path = argv[++i]; }
        else if (a == "--device-config" && i + 1 < argc) { device_config_path = argv[++i]; bacnet_config_from_cli = true; }
        else if (a == "--bacnet-config" && i + 1 < argc) { bacnet_config_path = argv[++i]; bacnet_config_from_cli = true; }
        else if (a == "--core-sock" && i + 1 < argc) { core_sock_path = argv[++i]; }
        else if (a == "--help") {
            std::printf("usage: mkddc-iobus [--config FILE] [--uart DEV] [--log-level LVL] [--fieldbus-config FILE] [--fieldbus-sock PATH] [--fieldbus-control-sock PATH] [--device-config FILE] [--bacnet-config FILE] [--core-sock PATH]\n");
            return 0;
        }
    }

    std::fprintf(stderr, "INFO  iobus.start version=%s git_commit=%s build_time=%s toolchain=%s pid=%d\n",
                 MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN, getpid());

    /* Pidfile cho web (health `iobus` + SIGHUP reload), ghi ngay khi khởi động
     * thay vì nhờ drop-in `ExecStartPost` (xem platform/pid_file.hpp). Guard xoá
     * nó ở mọi đường thoát. Ghi hỏng không chặn iobus: chỉ health của web và
     * reload bằng SIGHUP bị ảnh hưởng, và log nói rõ điều đó. */
    const char* pid_env = std::getenv("IOBUS_PID");
    const std::string pid_path = pid_env && pid_env[0] ? pid_env : "/run/mkddc/iobus.pid";
    const long self_pid = static_cast<long>(::getpid());
    if (iobus::write_pid_file(pid_path, self_pid))
        std::fprintf(stderr, "INFO  iobus.pidfile path=%s pid=%ld\n", pid_path.c_str(), self_pid);
    else
        std::fprintf(stderr, "WARN  iobus.pidfile_fail path=%s errno=%d (web health/reload iobus sẽ hỏng)\n",
                     pid_path.c_str(), errno);
    iobus::PidFileGuard pid_file_guard(pid_path, self_pid);

    /* 1. Load config — JSON hỏng → fail-fast exit(1) */
    IobusConfig cfg;
    if (!load_config(config_path, config_from_cli, &cfg))
        return 1;
    if (!uart_override.empty()) cfg.uart_device = uart_override;
    if (!log_level_override.empty()) cfg.log_level = log_level_override;

    /* 2. Create/attach SHM — fail → exit(1) (không có SHM thì service vô nghĩa) */
    IobusMetrics metrics;
    IoCache cache;
    if (!cache.attach())
        return 1;
    {
        char units[KX_N_UI][8];
        char raw_units[KX_N_UI][8];
        uint8_t modes[KX_N_AO];
        build_ui_units(cfg, units, raw_units);
        for (int i = 0; i < KX_N_AO; i++)
            modes[i] = 0;   /* default 0-10V (MCU boot); cập nhật sau ACK SET_AO_CFG */
        cache.write_ui_units(units, raw_units);
        cache.write_ao_mode(modes);
    }

    /* 3. Alarm socket — fail → degraded, tiếp tục */
    AlarmPublisher alarm;
    alarm.open();

    /* 4. RT + mlockall — thiếu cap → degraded, tiếp tục */
    set_rt(cfg.rt_priority);
    lock_mem();

    /* 5. Signal handler */
    struct sigaction sa {};
    sa.sa_handler = on_signal;
    sigaction(SIGTERM, &sa, nullptr);
    sigaction(SIGINT, &sa, nullptr);
    struct sigaction sa_hup {};
    sa_hup.sa_handler = on_sighup;
    sigaction(SIGHUP, &sa_hup, nullptr);
    fieldbus::FieldbusConfig fieldbus_cfg;
    /* G7: ánh xạ plc_shm giữ lâu cho luồng `mb-extcmd`. Khai TRƯỚC `modbus` để
     * sống lâu hơn nó — `~ModbusMaster` dừng luồng đang dùng ánh xạ này. */
    fieldbus::PlcShmView plc_view(plc_shm_name());
    fieldbus::ModbusMaster modbus;
    fieldbus::ModbusTcp    modbus_tcp;
    fieldbus::ExtCache ext_cache;
    fieldbus::FieldbusMetrics fieldbus_metrics;
    std::thread fieldbus_thread;
    if (!fieldbus::load_fieldbus_config(fieldbus_config_path, fieldbus_config_from_cli,
                                        &fieldbus_cfg)) {
        cache.detach();
        return 1;
    }
    /* MBR-B110: danh tính tiến trình producer. Counter tụt về 0 sau restart là
     * bình thường; thiếu boot_id thì consumer đọc nó thành "ai đó vừa reset
     * counter bằng tay" và kết luận sai về lịch sử lỗi. */
    fieldbus_metrics.set_producer_identity(
        (static_cast<uint64_t>(::getpid()) << 32) ^ static_cast<uint64_t>(::time(nullptr)),
        now_ms());

    /* MBR-B101: mỗi bus RS-485 một BusWorker trên một thread riêng. Thread ở
     * đây (fieldbus_thread) KHÔNG còn phát lệnh xuống dây; nó là publisher +
     * cầu nối write từ core, nên một bus bị chặn không giữ được nó lại. */
    const bool rtu_configured = fieldbus_cfg.loaded && !fieldbus_cfg.slaves.empty();
    /* Mở cổng ngay khi khởi động nếu cấu hình đã có slave. Kết quả KHÔNG được
     * giữ lại làm cờ điều kiện cho phần sau: cấu hình có thể đổi lúc đang chạy
     * qua kênh điều khiển, nên mọi quyết định về sau phải hỏi trạng thái thật
     * (`modbus.bus_count()`), không đọc lại một ảnh chụp lúc khởi động. */
    if (rtu_configured) modbus.open(fieldbus_cfg, ext_cache, fieldbus_metrics);
    /* Kênh điều khiển phải mở KỂ CẢ khi chưa có thiết bị nào.
     *
     * Bản trước gác nó bằng `rtu_configured` — tức "đã có ít nhất một slave" —
     * trong khi chú thích ngay dưới lại nói ngược lại. Hậu quả là một hệ thống
     * mới tinh (0 thiết bị) không có kênh điều khiển, nên MỌI thay đổi cấu hình
     * đều rơi về phương án dự phòng: khởi động lại `mkddc-iobus`, cắt luôn IOP
     * 100 Hz. Người dùng thấy đúng câu này khi bấm áp cấu hình cổng:
     *
     *   409 — "dịch vụ áp dụng thay đổi hiện không chạy"
     *
     * Nghịch lý: đường duy nhất để THOÁT khỏi trạng thái "chưa có thiết bị" lại
     * bị chính trạng thái đó khoá. Commissioning và apply_config tồn tại để SỬA
     * tình trạng chưa cấu hình, nên chúng không được phụ thuộc vào việc đã cấu
     * hình xong hay chưa. */
    const bool control_channel_wanted = true;
    if (fieldbus_cfg.loaded && !fieldbus_cfg.tcp_slaves.empty()) {
        const uint16_t tcp_offset = modbus.total_ext_count();
        modbus_tcp.open(fieldbus_cfg, tcp_offset);
    }

    /* MBR-B105: kênh điều khiển UDS. Mở kể cả khi chưa có bus nào lên được —
     * commissioning và apply_config phải dùng được để SỬA tình trạng đó. */
    fieldbus::ControlChannel fieldbus_control;
    if (control_channel_wanted) {
        fieldbus::ControlHandlers handlers;
        handlers.frames_json = [&](uint8_t bus_filter, int limit) {
            return fieldbus_metrics.frames().to_json(bus_filter, limit);
        };
        handlers.status_fields = [&]() {
            /* T63-003: nội dung dựng ở `control_status.cpp` (test được từng byte);
             * chạy trên luồng kênh điều khiển, không chạm luồng poll RT — counter
             * IOP chỉ được ĐỌC (atomic relaxed). */
            fieldbus::ControlStatusIdentity identity;
            identity.generation        = modbus.provenance().generation;
            identity.config_revision   = modbus.provenance().config_revision;
            identity.producer_boot_id  = fieldbus_metrics.producer_boot_id();
            identity.counters_since_ms = fieldbus_metrics.counters_since_ms();
            identity.ext_count         = ext_cache.count();
            identity.sequence          = ext_cache.sequence();
            const IobusMetrics::Snapshot counters = metrics.snapshot();
            fieldbus::IopCounterSnapshot iop;
            iop.rx         = counters.rx;
            iop.tx         = counters.tx;
            iop.crc_errors = counters.crc_err;
            iop.seq_errors = counters.seq_err;
            iop.timeouts   = counters.timeout;
            iop.retries    = counters.retry;
            iop.nacks      = counters.nack;
            return fieldbus::control_status_fields(identity, fieldbus_metrics.bus_snapshot(), iop);
        };
        handlers.apply_config = [&](uint64_t revision, const std::string& checksum,
                                    const std::string& path, std::string* reason,
                                    uint64_t* applied, uint64_t* generation) {
            const std::string target = path.empty() ? fieldbus_config_path : path;
            return modbus.apply_config(target, revision, checksum, ext_cache,
                                       fieldbus_metrics, reason, applied, generation);
        };
        handlers.submit_write = [&](const fieldbus::ControlWriteRequest& req,
                                    std::string* reason) {
            fieldbus::PendingWrite w{};
            w.slave_addr  = req.slave_addr;
            w.fc          = req.fc;
            w.reg_addr    = req.reg_addr;
            w.value       = static_cast<float>(req.value);
            w.type        = fieldbus::PointType::Uint16;
            w.byte_order  = fieldbus::ByteOrder::AB;
            w.scale       = 1.0f;
            w.offset      = 0.0f;
            w.ext_idx     = KX_N_EXT;   /* commissioning write không gắn slot nào */
            w.request_id  = req.request_id;
            w.enqueued_ms = now_ms();
            w.deadline_ms = req.deadline_ms ? now_ms() + req.deadline_ms : 0;
            w.readback    = req.readback;
            /* `MBA-FW-07`: chuyển `bus_id` của request xuống — trước bản này
             * nó được parse rồi bỏ, và lệnh đi tới slave ĐẦU TIÊN khớp địa chỉ
             * trên bất kỳ dây nào. */
            if (!modbus.submit_write(w, req.bus_id)) {
                if (reason) *reason = "queue_full_or_slave_not_found_or_ambiguous_bus";
                return false;
            }
            return true;
        };
        handlers.probe_read = [&](uint8_t bus_id, uint8_t slave, uint8_t fc, uint16_t addr,
                                  uint16_t count, uint32_t timeout_ms) {
            fieldbus::ControlProbeResult out;
            fieldbus::BusWorker* worker =
                bus_id ? modbus.bus_by_id(bus_id)
                       : (modbus.bus_count() ? modbus.bus_by_id(modbus.bus(0).bus_id()) : nullptr);
            if (!worker) {
                out.reason = "bus_not_found";
                return out;
            }
            const auto probe = worker->probe_read(slave, fc, addr, count, timeout_ms);
            out.ok             = probe.ok;
            out.reason         = probe.reason;
            out.value          = probe.value;
            out.exception_code = probe.exception_code;
            out.elapsed_us     = probe.elapsed_us;
            return out;
        };
        if (!fieldbus_control.start(fieldbus_control_sock_path, handlers)) {
            /* Không mở được kênh điều khiển KHÔNG được làm chết service: I/O
             * hiện trường vẫn phải chạy. Web sẽ thấy commissioning không khả
             * dụng và báo rõ, thay vì cả tủ mất điều khiển. */
            std::fprintf(stderr, "WARN  iobus.control_channel_unavailable path=%s\n",
                         fieldbus_control_sock_path.c_str());
        }
    }

    /* Luồng publish fieldbus chạy VÔ ĐIỀU KIỆN.
     *
     * Bản trước gác cả luồng này bằng `rtu_ok || rtu_configured`, hai cờ tính
     * MỘT LẦN lúc khởi động từ file cấu hình có mặt khi đó. Khởi động với 0
     * thiết bị ⇒ luồng KHÔNG BAO GIỜ được tạo. Sau đó người dùng thêm thiết bị
     * qua kênh điều khiển: `apply_config` dựng worker và mở cổng thật (log có
     * `bus_worker.open ... slaves=2`), iobus POLL BÌNH THƯỜNG — nhưng không có
     * ai publish, nên `fb_publish_seq` mãi bằng 0 và Web báo:
     *
     *   503 — "iobus chưa publish telemetry Modbus RTU"
     *
     * Nhìn từ ngoài thì Modbus "không chạy", trong khi thực tế nó chạy và chỉ
     * mỗi đường báo cáo là chết. Cùng một lớp lỗi với kênh điều khiển: một cờ
     * lúc khởi động đóng băng khả năng của hệ thống vốn được thiết kế để cấu
     * hình lại lúc đang chạy.
     *
     * Các nhánh bên trong nay hỏi TRẠNG THÁI THẬT (`modbus.bus_count()`) thay
     * vì đọc lại cờ cũ. `publish_fieldbus_metrics` chạy kể cả khi chưa có bus
     * nào: khi đó nó publish count = 0, và đó là câu trả lời ĐÚNG — "biết rồi,
     * và không có gì" khác hẳn "chưa biết" (D-07). */
    {
        if (rtu_configured) modbus.start_workers(ext_cache, fieldbus_metrics);
        /* G7 (EV-PROG-FBD-ST-MB-20260925): cầu nối ghi Core → Modbus (COR-011)
         * chạy trên luồng `mb-extcmd` RIÊNG, soi `ext_cmd_seq` mỗi 5 ms.
         *
         * Trước G7 nó nằm trong vòng `fb-publish` dưới đây, ngủ 100 ms mỗi vòng
         * và chạy SAU `modbus_tcp.poll_once` — một slave TCP treo kết nối là giữ
         * luôn mọi lệnh ghi RTU. Cộng với trần ngủ 200 ms của BusWorker, lệnh
         * Core → FC05 trên bo đo được ~377 ms. Luồng chạy vô điều kiện như
         * `fb-publish`: chưa có bus thì `drain_ext_writes` trả về ngay và luồng
         * tự soi thưa (100 ms). */
        modbus.start_ext_command_watch([&plc_view]() { return plc_view.get(now_ms()); });
        fieldbus_thread = std::thread([&]() {
            /* `MBA-FW-01`: publisher KHÔNG thuộc vòng IOP. */
            fieldbus::demote_to_normal_sched("fb-publish");
            uint64_t last_publish_ms = now_ms();
            while (!g_shutdown.load()) {
                const uint64_t poll_now = now_ms();
                const bool rtu_live = modbus.bus_count() > 0;
                if (modbus_tcp.has_slaves())
                    modbus_tcp.poll_once(poll_now, ext_cache, fieldbus_sock_path);
                if (rtu_live) {
                    const uint64_t window_us = (poll_now - last_publish_ms) * 1000ull;
                    modbus.publish(ext_cache, fieldbus_metrics, fieldbus_sock_path, window_us);
                    last_publish_ms = poll_now;
                }
                publish_fieldbus_metrics(cache, fieldbus_metrics);
                /* Nhịp publish cố định 100 ms: worker chạy độc lập nên nhịp này
                 * không còn phụ thuộc deadline của slave nào, và từ G7 cũng không
                 * còn quyết định độ trễ lệnh ghi. */
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        });
    }

    bacnet::BacnetConfig bacnet_cfg;
    bacnet::BacnetObjects bacnet_objects;
    bacnet::BacnetServer bacnet_server;
    std::thread bacnet_thread;
    if (!bacnet::load_bacnet_config(device_config_path, bacnet_config_path,
                                    bacnet_config_from_cli, &bacnet_cfg)) {
        g_shutdown.store(true);
        if (fieldbus_thread.joinable()) fieldbus_thread.join();
        modbus.stop_ext_command_watch();
        modbus.stop_workers();
        fieldbus_control.stop();
        cache.detach();
        return 1;
    }
    /* Publish trạng thái bind ngay cả khi BACnet/IP bị tắt: Web phải phân biệt
     * "iobus đã nói rõ là không bind" với "iobus cũ chưa hề ghi field này"
     * (trường hợp sau nhận ra qua độ dài segment). BACnet tắt = BMS link down,
     * đó là sự thật chứ không phải thiếu dữ liệu. */
    if (!bacnet_cfg.bip.enabled)
        cache.write_bacnet_bind(false, 0);
    if (bacnet_cfg.bip.enabled) {
        bacnet_objects.init(bacnet_cfg);
        const auto core_write = [&](const std::string& op, uint32_t idx, float value,
                                    const std::string& user, int prio) {
            return send_core_command(core_sock_path, op, idx, value, user, prio);
        };
        const auto reinit = [](bool cold) {
            std::fprintf(stderr, "WARN  bacnet.reinitialize requested cold=%u\n",
                         cold ? 1u : 0u);
        };
        bacnet_server.init(bacnet_cfg, &bacnet_objects, core_write, reinit);
        const bool bacnet_started = bacnet_server.start();
        /* F-04: publish kết quả bind THẬT. Trước đây Web suy ra "BMS online" chỉ từ
         * việc bip.enabled=true và file config có ip/port khác rỗng, nên báo online
         * cả khi bip_init() đã thất bại. */
        cache.write_bacnet_bind(bacnet_started, bacnet_cfg.bip.udp_port);
        if (bacnet_started) {
            /* Push initial unit codes into bacnet-stack AI objects (thread not yet started) */
            {
                char units[KX_N_UI][8];
                char raw_units[KX_N_UI][8];
                build_ui_units(cfg, units, raw_units);
                bacnet_objects.update_ai_units(units);
                bacnet_server.apply_ai_units();
            }
            /* ADR-012: push initial AO config into bacnet-stack */
            bacnet_objects.update_ao_config(cfg.ao_channels);
            bacnet_server.apply_ao_config();
            bacnet_thread = std::thread([&]() {
                /* `MBA-FW-01`: FW_SOM_DESIGN §2 — thread bacnet là SCHED_OTHER. */
                fieldbus::demote_to_normal_sched("bacnet");
                const kx_plc_shm_t* plc_shm = nullptr;
                std::string address_signature = ipv4_address_signature(bacnet_cfg.bip.bind_interface);
                uint64_t next_address_check_ms = 0;
                while (!g_shutdown.load()) {
                    if (!plc_shm) plc_shm = try_attach_plc_shm();
                    const uint64_t tick_ms = now_ms();
                    if (tick_ms >= next_address_check_ms) {
                        next_address_check_ms = tick_ms + 1000;
                        const std::string current = ipv4_address_signature(bacnet_cfg.bip.bind_interface);
                        if (current != address_signature) {
                            std::fprintf(stderr, "INFO  bacnet_server.address_change old=%s new=%s\n",
                                         address_signature.empty() ? "none" : address_signature.c_str(),
                                         current.empty() ? "none" : current.c_str());
                            const bool rebound = bacnet_server.rebind();
                            /* Rebind hỏng thì socket không còn phục vụ BMS — Web phải
                             * thấy điều đó thay vì giữ nguyên "online" cũ. */
                            cache.write_bacnet_bind(rebound, bacnet_cfg.bip.udp_port);
                            if (rebound) {
                                bacnet_server.apply_ai_units();
                                bacnet_server.apply_ao_config();
                                address_signature = current;
                            }
                        }
                    }
                    bacnet_server.tick(tick_ms, plc_shm);
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                }
                if (plc_shm) {
                    ::munmap(const_cast<kx_plc_shm_t*>(plc_shm),
                             sizeof(kx_plc_shm_t));
                }
            });
        }
    }

    IopClientConfig ccfg;
    ccfg.baud = cfg.baud;
    ccfg.response_timeout_ms = cfg.response_timeout_ms;
    ccfg.handshake_timeout_ms = cfg.handshake_timeout_ms;
    ccfg.max_retry = cfg.max_retry;
    IopClient client(&metrics, ccfg);
    ClientSink sink(client);
    OutputCommand output(sink);
    CoreBridge bridge(cache.shm());
    SystemdNotify sd;

    uint64_t poll_period_ns = static_cast<uint64_t>(cfg.poll_period_ms) * 1000000ull;
    const uint64_t fault_timeout_ns = static_cast<uint64_t>(IOP_FAULT_TIMEOUT_MS) * 1000000ull;
    uint64_t reconnect_ns = static_cast<uint64_t>(cfg.reconnect_interval_ms) * 1000000ull;

    bool ready_notified = false;
    uint64_t last_wdg_kick = 0;
    uint64_t last_reconnect_try = 0;
    uint64_t last_safe_retry = 0;
    uint64_t safe_blocked_since = 0;
    uint16_t prev_fault_flags = 0;
    uint32_t consecutive_poll_fail = 0;

    /* startup() — bước 6..9 của 06 §13: UART → handshake → RESET_IO → SET_AO_CFG.
     * Trả true nếu sẵn sàng NORMAL_POLL. */
    auto startup = [&]() -> bool {
        if (!client.open(cfg.uart_device))
            return false;
        IopResult hs = client.handshake();
        if (!hs.ok()) {
            alarm.publish({"IOP_INIT_FAIL", "critical", "MCU handshake failed",
                           "{\"uart\":\"" + cfg.uart_device + "\"}"});
            return false;
        }
        /* Validate BOARD_CAP_MAP against expected Rev A capability (ADR-010). */
        {
            const uint16_t cap = client.board_cap_map();
            if (!(cap & IOP_BOARD_CAP_UI_16)) {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "{\"board_cap\":\"0x%04X\"}", cap);
                alarm.publish({"IOP_CAP_MISMATCH", "critical",
                               "Board does not advertise UI_16 — wrong SKU or stale FW", buf});
                std::fprintf(stderr, "ERROR iop.cap_mismatch: UI_16 not set in board_cap=0x%04X\n", cap);
                return false;
            }
            if ((cap & IOP_BOARD_CAP_REV_A) != IOP_BOARD_CAP_REV_A) {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "{\"board_cap\":\"0x%04X\",\"expected\":\"0x%04X\"}",
                              cap, IOP_BOARD_CAP_REV_A);
                alarm.publish({"IOP_CAP_WARN", "warning",
                               "Board cap map does not match Rev A baseline", buf});
                std::fprintf(stderr, "WARN  iop.cap_mismatch: board_cap=0x%04X expected=0x%04X\n",
                             cap, IOP_BOARD_CAP_REV_A);
            }
        }
        /* `ISS-PIO-11` — chở cap vào SHM NGAY SAU khi kiểm, trước mọi bước có
         * thể fail: hai kiểm ở trên chỉ dùng cap rồi bỏ, và đó là lý do bốn
         * tầng phía trên phải viết cứng số kênh. Ghi ở đây thì kể cả khi
         * RESET_IO/SET_AO_CFG hỏng, tầng trên vẫn biết bo quảng cáo gì. */
        cache.write_board_capabilities(client.board_cap_map());

        /* RESET_IO reason=NORMAL — khuyến nghị, fail chỉ WARN */
        IopResult rst = client.reset_io(IOP_RESET_REASON_NORMAL);
        if (!rst.ok())
            std::fprintf(stderr, "WARN  iop.reset reason=normal fail code=%d (tiếp tục)\n", rst.code);
        else
            std::fprintf(stderr, "INFO  iop.reset reason=normal ack=ok\n");

        /* SET_AO_CFG nếu config có AO 4-20mA */
        uint8_t mode_mask = 0;
        bool need_cfg = false;
        for (int i = 0; i < KX_N_AO; i++) {
            if (cfg.ao_mode[i] == AoMode::MA4_20) {
                mode_mask |= static_cast<uint8_t>(1u << i);
                need_cfg = true;
            }
        }
        uint8_t applied_modes[KX_N_AO] = {0, 0, 0, 0};
        AoMode applied_enum[KX_N_AO] = {AoMode::V0_10, AoMode::V0_10, AoMode::V0_10, AoMode::V0_10};
        if (need_cfg) {
            IopResult ac = client.set_ao_cfg(mode_mask);
            if (ac.ok()) {
                for (int i = 0; i < KX_N_AO; i++) {
                    applied_modes[i] = (mode_mask >> i) & 1u;
                    applied_enum[i] = static_cast<AoMode>(applied_modes[i]);
                }
                std::fprintf(stderr, "INFO  iop.ao_cfg mask=0x%02X ack=ok\n", mode_mask);
            } else {
                std::fprintf(stderr, "ERROR iop.ao_cfg fail code=%d nack=0x%02X (không cho chạy sai mode)\n",
                             ac.code, ac.nack_err);
                return false;
            }
        }
        cache.write_ao_mode(applied_modes);
        output.set_ao_modes(applied_enum);
        output.reset_last_sent();
        client.set_status(IopStatus::NORMAL_POLL);
        cache.write_status(KX_IOP_NORMAL, metrics);
        consecutive_poll_fail = 0;
        return true;
    };

    if (!startup()) {
        client.set_status(IopStatus::RECONNECT);
        cache.write_status(KX_IOP_FAULT, metrics);
        last_reconnect_try = now_ns();
    } else {
        sd.ready();
        ready_notified = true;
    }
    if (!ready_notified) {
        sd.ready();   /* degraded: vẫn READY khi vào RECONNECT (unit 06 §10) */
        ready_notified = true;
    }

    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);
    uint64_t expected_ns = static_cast<uint64_t>(next.tv_sec) * 1000000000ull + next.tv_nsec;

    uint64_t jitter_count = 0;
    int64_t max_jitter_ns = 0;
    int64_t min_jitter_ns = -1;
    int64_t sum_jitter_ns = 0;
    /* `overruns` của `iobus.jitter` là bộ đếm TÍCH LUỸ, không reset theo phút.
     * Ở mức quá tải audit 28/09 đo được (~26k/phút) bản `uint32_t` cũ tràn sau
     * ~113 ngày và delta last−first của probe ra âm. 64 bit: định dạng dòng
     * không đổi khi giá trị < 2^32. */
    uint64_t overrun_count = 0;
    static_assert(sizeof(overrun_count) == 8, "iobus.jitter overruns phải 64 bit (T63-004)");
    uint64_t last_stats_print = expected_ns;
    /* T63-004 (PERF-SYS-05/07): tách thời gian vòng thành độ trễ đánh thức,
     * thời gian làm việc, khoảng IO_RESP, SỰ KIỆN trễ và số vòng chạy bù — xem
     * diagnostics/poll_loop_timing.hpp. Không cấp phát, không khoá. */
    PollLoopTiming loop_timing;
    constexpr int MAX_UI_FILTER_SAMPLES = 100;
    float ui_filter_buf[KX_N_UI][MAX_UI_FILTER_SAMPLES] = {};
    uint8_t ui_filter_pos[KX_N_UI] = {};
    uint8_t ui_filter_count[KX_N_UI] = {};
    uint8_t ui_filter_size[KX_N_UI] = {};
    /* ISS-PIO-24: trạng thái deadband/HOLD theo kênh, sống cùng vòng lặp poll */
    UiConditioningState ui_cond[KX_N_UI] = {};

    /* ---- Main loop: poll 10ms tuyệt-đối-thời-gian ---- */
    while (!g_shutdown.load()) {
        uint64_t actual_ns = now_ns();
        int64_t jitter_ns = static_cast<int64_t>(actual_ns) - static_cast<int64_t>(expected_ns);
        int64_t abs_jitter_ns = jitter_ns < 0 ? -jitter_ns : jitter_ns;

        if (abs_jitter_ns > max_jitter_ns) max_jitter_ns = abs_jitter_ns;
        if (min_jitter_ns < 0 || abs_jitter_ns < min_jitter_ns) min_jitter_ns = abs_jitter_ns;
        sum_jitter_ns += abs_jitter_ns;
        jitter_count++;

        if (jitter_ns > static_cast<int64_t>(poll_period_ns)) {
            overrun_count++;
        }

        if (actual_ns - last_stats_print > 60000000000ull) {
            /* Dòng `iobus.jitter` giữ nguyên từng khoá (tooling đọc theo tên
             * khoá; `overruns` vẫn đếm từng vòng lệch > 1 chu kỳ). Dòng
             * `iobus.loop_timing` của T63-004 đi CÙNG lời gọi fprintf này: không
             * thêm lần khoá FILE hay syscall nào vào vòng poll. */
            char timing_line[PollLoopTiming::kLineCapacity];
            PollLoopTiming::format_line(timing_line, sizeof(timing_line),
                                        loop_timing.minute_at(actual_ns), poll_period_ns);
            std::fprintf(stderr, "INFO  iobus.jitter min_us=%.2f max_us=%.2f avg_us=%.2f overruns=%llu count=%lu\n"
                                 "INFO  %s\n",
                         min_jitter_ns / 1000.0, max_jitter_ns / 1000.0,
                         (sum_jitter_ns / (double)jitter_count) / 1000.0,
                         static_cast<unsigned long long>(overrun_count), jitter_count, timing_line);
            last_stats_print = actual_ns;
            max_jitter_ns = 0;
            min_jitter_ns = -1;
            sum_jitter_ns = 0;
            jitter_count = 0;
            loop_timing.reset_minute();
        }
        loop_timing.on_wake(expected_ns, actual_ns);
        if (g_reload.load()) {
            g_reload.store(false);
            std::fprintf(stderr, "INFO  iobus.reload SIGHUP (ranh giới scan)\n");
            IobusConfig old_cfg = cfg;
            if (reload_config_safe(config_path, config_from_cli, cfg, uart_override, log_level_override)) {
                std::fprintf(stderr, "INFO  iobus.reload ok\n");
                poll_period_ns = static_cast<uint64_t>(cfg.poll_period_ms) * 1000000ull;
                reconnect_ns = static_cast<uint64_t>(cfg.reconnect_interval_ms) * 1000000ull;

                IopClientConfig new_ccfg;
                new_ccfg.baud = cfg.baud;
                new_ccfg.response_timeout_ms = cfg.response_timeout_ms;
                new_ccfg.handshake_timeout_ms = cfg.handshake_timeout_ms;
                new_ccfg.max_retry = cfg.max_retry;
                client.update_config(new_ccfg);

                bool ui_changed = false;
                for (int i = 0; i < KX_N_UI; i++) {
                    if (cfg.ui[i] != old_cfg.ui[i]) {
                        ui_changed = true;
                        break;
                    }
                }
                if (ui_changed) {
                    char units[KX_N_UI][8];
                    char raw_units[KX_N_UI][8];
                    build_ui_units(cfg, units, raw_units);
                    cache.write_ui_units(units, raw_units);
                    bacnet_objects.update_ai_units(units);
                    bacnet_server.apply_ai_units();
                }

                bool ao_changed = false;
                for (int i = 0; i < KX_N_AO; i++) {
                    if (cfg.ao_mode[i] != old_cfg.ao_mode[i]) {
                        ao_changed = true;
                        break;
                    }
                }
                if (ao_changed) {
                    uint8_t mode_mask = 0;
                    for (int i = 0; i < KX_N_AO; i++) {
                        if (cfg.ao_mode[i] == AoMode::MA4_20) {
                            mode_mask |= static_cast<uint8_t>(1u << i);
                        }
                    }
                    uint8_t applied_modes[KX_N_AO] = {0, 0, 0, 0};
                    AoMode applied_enum[KX_N_AO] = {AoMode::V0_10, AoMode::V0_10, AoMode::V0_10, AoMode::V0_10};
                    const IopStatus st = client.status();
                    if (st == IopStatus::NORMAL_POLL || st == IopStatus::SAFE_STATE) {
                        IopResult ac = client.set_ao_cfg(mode_mask);
                        if (ac.ok()) {
                            for (int i = 0; i < KX_N_AO; i++) {
                                applied_modes[i] = (mode_mask >> i) & 1u;
                                applied_enum[i] = static_cast<AoMode>(applied_modes[i]);
                            }
                            std::fprintf(stderr, "INFO  iop.ao_cfg mask=0x%02X ack=ok\n", mode_mask);
                        } else {
                            std::fprintf(stderr, "WARN  iop.ao_cfg fail code=%d nack=0x%02X (giữ 0-10V)\n",
                                         ac.code, ac.nack_err);
                        }
                    }
                    cache.write_ao_mode(applied_modes);
                    output.set_ao_modes(applied_enum);
                }
                /* ADR-012: always refresh AO BACnet metadata on SIGHUP (name/units/min/max) */
                bacnet_objects.update_ao_config(cfg.ao_channels);
                bacnet_server.apply_ao_config();
            } else {
                std::fprintf(stderr, "WARN  iobus.reload co phan fail — phan do giu config cu\n");
            }
        }

        const uint64_t t = now_ns();

        /* watchdog kick mỗi ≤2.5s (WatchdogSec=5) */
        if (t - last_wdg_kick > 2000000000ull) {
            sd.watchdog_kick();
            last_wdg_kick = t;
        }

        const IopStatus st = client.status();

        if (st == IopStatus::NORMAL_POLL || st == IopStatus::SAFE_STATE) {
            IopIoResp resp;
            const IopResult r = client.get_io(&resp);
            if (r.ok()) {
                loop_timing.on_io_resp(client.last_io_resp_ns());
                if (st == IopStatus::SAFE_STATE) {
                    /* nhận IO_RESP hợp lệ → RECONNECT (handshake lại) — 05 §13 */
                    client.set_status(IopStatus::RECONNECT);
                    last_reconnect_try = 0;   /* thử ngay */
                } else {
                    consecutive_poll_fail = 0;

                    /* scale + build snapshot */
                    IoSnapshot snap;
                    snap.ts_ns = now_ns();
                    float pre_math[KX_N_UI] = {};
                    for (int i = 0; i < KX_N_UI; i++) {
                        kx_quality_t q;
                        kx_reliability_t r;
                        float value = ui_to_eng(resp.ui_raw[i], cfg.ui[i], &q, &r);
                        snap.ui_raw[i] = cfg.ui[i].enabled
                            ? ui_raw_electric(resp.ui_raw[i], cfg.ui[i]) : 0.0f;
                        const uint8_t samples = cfg.ui[i].filter_samples;
                        if (q == KX_Q_GOOD && samples > 1) {
                            if (ui_filter_size[i] != samples) {
                                ui_filter_size[i] = samples;
                                ui_filter_pos[i] = 0;
                                ui_filter_count[i] = 0;
                            }
                            ui_filter_buf[i][ui_filter_pos[i]] = value;
                            ui_filter_pos[i] = static_cast<uint8_t>((ui_filter_pos[i] + 1u) % samples);
                            if (ui_filter_count[i] < samples) ui_filter_count[i]++;
                            float sum = 0.0f;
                            for (uint8_t j = 0; j < ui_filter_count[i]; j++) sum += ui_filter_buf[i][j];
                            value = sum / static_cast<float>(ui_filter_count[i]);
                        } else {
                            ui_filter_size[i] = 0;
                            ui_filter_count[i] = 0;
                            ui_filter_pos[i] = 0;
                        }
                        /* ADR-011: override reliability to COMMUNICATION_FAILURE when ADC fault.
                         * Đặt TRƯỚC điều hoà để lỗi phần cứng không bị mặt nạ
                         * range/loop che, và để chính sách failure value nhìn
                         * thấy đúng quality cuối cùng. */
                        if (resp.fault_flags & (IOP_FAULT_ADC1 | IOP_FAULT_ADC2)) {
                            q = KX_Q_BAD;
                            r = KX_REL_COMMUNICATION_FAILURE;
                        }
                        /* ISS-PIO-24 §7: mặt nạ lỗi → clamp → deadband → giá trị khi lỗi */
                        value = condition_ui_sample(cfg.ui[i], &ui_cond[i], &q, &r, value);
                        pre_math[i] = value;
                        snap.ui_value[i] = value;
                        snap.ui_raw[i] = cfg.ui[i].enabled ? ui_raw_electric(resp.ui_raw[i], cfg.ui[i]) : 0.0f;
                        snap.ui_quality[i] = static_cast<uint8_t>(q);
                        snap.ui_reliability[i] = static_cast<uint8_t>(r);
                    }
                    for (uint8_t fn = 1; fn <= 3; fn++) {
                        float aggregate = 0.0f;
                        uint8_t count = 0;
                        for (int i = 0; i < KX_N_UI; i++) {
                            if (cfg.ui[i].math_func != fn || snap.ui_quality[i] != KX_Q_GOOD) continue;
                            if (count == 0) aggregate = pre_math[i];
                            else if (fn == 1) aggregate += pre_math[i];
                            else if (fn == 2 && pre_math[i] < aggregate) aggregate = pre_math[i];
                            else if (fn == 3 && pre_math[i] > aggregate) aggregate = pre_math[i];
                            count++;
                        }
                        if (count == 0) continue;
                        if (fn == 1) aggregate /= static_cast<float>(count);
                        for (int i = 0; i < KX_N_UI; i++) {
                            if (cfg.ui[i].math_func == fn && snap.ui_quality[i] == KX_Q_GOOD) snap.ui_value[i] = aggregate;
                        }
                    }
                    /* di_state stays 0: base SKU Rev A has no DI (ADR-010) */
                    for (int i = 0; i < KX_N_DO; i++)
                        snap.do_feedback[i] = (resp.do_fb_mask >> i) & 1u;
                    snap.fault_flags = resp.fault_flags;
                    snap.iop_status = KX_IOP_NORMAL;
                    snap.mcu_temp_x10 = resp.mcu_temp_x10;
                    cache.write_io(snap, metrics);

                    /* alarm khi FAULT_FLAGS đổi */
                    if (resp.fault_flags != prev_fault_flags) {
                        if (resp.fault_flags != 0) {
                            char data[64];
                            std::snprintf(data, sizeof(data), "{\"fault_flags\":%u}", resp.fault_flags);
                            alarm.publish({"MCU_FAULT_FLAGS",
                                           (resp.fault_flags & (IOP_FAULT_WDG_RESET | IOP_FAULT_RELAY_STUCK |
                                                                IOP_FAULT_MCU_OVERTEMP | IOP_FAULT_VDD)) ? "critical" : "warning",
                                           "MCU fault flags changed", data});
                            if (resp.fault_flags & IOP_FAULT_WDG_RESET) {
                                IopDiagResp diag;
                                client.get_diag(&diag);   /* MCU clear sticky bit khi nhận GET_DIAG */
                            }
                        }
                        prev_fault_flags = resp.fault_flags;
                    }

                    /* đối chiếu DO_FB với last_sent — MCU mất state (tự safe/reset)
                     * → ép resend (xem OutputCommand::verify_feedback) */
                    output.verify_feedback(snap.do_feedback);

                    /* output: đọc lệnh core từ shm → SET_* nếu CHANGED (cùng thread, 1 owner UART) */
                    float ao_sp[KX_N_AO];
                    uint8_t do_cmd[KX_N_DO];
                    bridge.read_outputs(ao_sp, do_cmd);
                    if (output.safe_state_blocked()) {
                        if (safe_blocked_since == 0) safe_blocked_since = t;
                        if (t - safe_blocked_since > 3000000000ull) {
                            /* MCU kẹt safe >3s — chỉ thoát qua HANDSHAKE (07 §5.4)
                             * → escalate RECONNECT để handshake + RESET_IO + resync */
                            std::fprintf(stderr,
                                         "WARN  iop.safe_blocked >3s -> reconnect (resync MCU)\n");
                            client.set_status(IopStatus::RECONNECT);
                            cache.write_status(KX_IOP_FAULT, metrics);
                            output.reset_last_sent();
                            last_reconnect_try = 0;   /* thử ngay */
                            safe_blocked_since = 0;
                        } else if (t - last_safe_retry > 1000000000ull) {
                            output.clear_safe_blocked();   /* retry chậm 1s khi MCU safe */
                            last_safe_retry = t;
                        }
                    } else {
                        safe_blocked_since = 0;
                    }
                    output.process(ao_sp, do_cmd);
                }
            } else {
                consecutive_poll_fail++;
                const uint64_t last_resp = client.last_io_resp_ns();
                const bool fault_window = (last_resp == 0) ||
                                          (now_ns() - last_resp > fault_timeout_ns);
                if (st == IopStatus::NORMAL_POLL && consecutive_poll_fail >= 1 && fault_window) {
                    /* >100ms không IO_RESP hợp lệ → FAULT → RESET_IO(0x05) → SAFE_STATE */
                    client.set_status(IopStatus::FAULT);
                    std::fprintf(stderr, "ERROR iop.fault reason=MCU_TIMEOUT action=SAFE_STATE\n");
                    alarm.publish({"IOP_TIMEOUT", "critical",
                                   "MCU not responding after retries",
                                   "{\"uart\":\"" + cfg.uart_device + "\"}"});
                    client.reset_io(IOP_RESET_REASON_IOP_FAULT);   /* best-effort, 1 lần */
                    client.set_status(IopStatus::SAFE_STATE);
                    cache.write_status(KX_IOP_SAFE, metrics);
                    output.reset_last_sent();
                } else if (st == IopStatus::NORMAL_POLL) {
                    cache.mark_inputs_unreliable();
                }
            }
        } else if (st == IopStatus::RECONNECT || st == IopStatus::FAULT) {
            if (last_reconnect_try == 0 || t - last_reconnect_try >= reconnect_ns) {
                last_reconnect_try = t;
                std::fprintf(stderr, "INFO  iop.reconnect\n");
                if (startup()) {
                    /* recovered */
                } else {
                    client.set_status(IopStatus::RECONNECT);
                    cache.write_status(KX_IOP_FAULT, metrics);
                }
            }
        }

        loop_timing.on_work_end(now_ns(), poll_period_ns);
        sleep_until(&next, poll_period_ns);
        expected_ns = static_cast<uint64_t>(next.tv_sec) * 1000000000ull + next.tv_nsec;
    }

    /* Shutdown: đóng UART, KHÔNG xóa shm (core còn đọc) */
    std::fprintf(stderr, "INFO  iobus.shutdown\n");
    if (fieldbus_thread.joinable()) fieldbus_thread.join();
    /* Không nhận lệnh EXT mới trong lúc worker drain (FW_SOM_DESIGN §10). */
    modbus.stop_ext_command_watch();
    if (bacnet_thread.joinable()) bacnet_thread.join();
    bacnet_server.stop();
    /* Dừng kênh điều khiển TRƯỚC khi đóng bus: không nhận lệnh mới trong lúc
     * worker đang drain (FW_SOM_DESIGN §10). */
    fieldbus_control.stop();
    modbus.close();
    client.close();
    cache.detach();
    return 0;
}
