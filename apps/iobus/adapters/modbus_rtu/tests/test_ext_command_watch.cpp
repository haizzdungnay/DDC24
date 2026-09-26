/**
 * @file  test_ext_command_watch.cpp
 * @brief G7 (EV-PROG-FBD-ST-MB-20260925) — luồng `mb-extcmd` phát hiện lệnh EXT
 *        của Core và đưa nó lên dây.
 *
 * Trước G7, cầu nối ghi (`drain_ext_writes`) chạy trong vòng `fb-publish` ngủ
 * 100 ms, và BusWorker ngủ thêm tới 200 ms: lệnh Core → FC05 đo trên bo ~377 ms.
 * Test ở đây ghim:
 *   - trễ từ lúc `ext_cmd_seq` đổi tới lúc lệnh vào transport (slave PTY nhận
 *     khung) trong một base step Core (10 ms);
 *   - luồng soi có trần CPU và không quay rỗng;
 *   - đường nhanh không chụp snapshot khi không có gì đổi, nhưng không bỏ sót
 *     lệnh cần thử lại;
 *   - nguyên tắc "giá trị mới nhất" khi bus đang bận;
 *   - trần ghi-trước-đọc `kMaxWritesBeforeRead`;
 *   - `PlcShmView` ánh xạ lại khi object plc_shm bị tạo lại.
 */
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
#include <vector>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#endif
#include <gtest/gtest.h>

#include "bus_worker.hpp"
#include "ext_cache.hpp"
#include "fieldbus_metrics.hpp"
#include "fieldbus_time.hpp"
#include "modbus_master.hpp"
#include "plc_shm_view.hpp"

using namespace iobus::fieldbus;
using Clock = std::chrono::steady_clock;

namespace {

double ms_between(Clock::time_point a, Clock::time_point b)
{
    return std::chrono::duration<double, std::milli>(b - a).count();
}

/* Ghi lệnh EXT đúng như Core (`PointWriter::write`): trong seqlock, và
 * `ext_cmd_seq` bằng atomic store vì luồng soi đọc nó bằng atomic load. */
void core_command(kx_plc_shm_t* shm, uint16_t idx, double setpoint)
{
    KX_WRITE_BEGIN(shm);
    shm->ext[idx].setpoint = setpoint;
    shm->ext[idx].dirty    = 1;
    uint32_t next = __atomic_load_n(&shm->ext_cmd_seq[idx], __ATOMIC_RELAXED) + 1;
    if (next == 0) next = 1;
    __atomic_store_n(&shm->ext_cmd_seq[idx], next, __ATOMIC_RELEASE);
    KX_WRITE_END(shm);
}

std::unique_ptr<kx_plc_shm_t> watch_shm(const char* point)
{
    auto shm = std::make_unique<kx_plc_shm_t>();
    std::memset(shm.get(), 0, sizeof(kx_plc_shm_t));
    shm->magic     = KX_SHM_MAGIC;
    shm->seq       = 2;
    shm->ext_count = 1;
    std::strncpy(shm->ext[0].name, point, sizeof(shm->ext[0].name) - 1);
    return shm;
}

bool wait_until(const std::function<bool()>& cond, std::chrono::milliseconds limit)
{
    const Clock::time_point end = Clock::now() + limit;
    while (Clock::now() < end) {
        if (cond()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return cond();
}

} // namespace

#ifdef MKDDC_ENABLE_MODBUS
namespace {

std::string watch_profile(const std::string& tag, const std::string& json)
{
    const std::string path = "/tmp/mkddc_watch_" + tag + "_" + std::to_string(::getpid()) + ".json";
    std::ofstream f(path);
    f << json;
    return path;
}

const char* kCoilProfile =
    R"json({"points":[{"name":"do1","fc":1,"addr":0,"count":1,"type":"bool","writable":true}]})json";

struct WatchPty {
    int master_fd = -1;
    std::string slave_dev;
    void open_pair()
    {
        master_fd = ::posix_openpt(O_RDWR | O_NOCTTY);
        ASSERT_GE(master_fd, 0);
        ASSERT_EQ(::grantpt(master_fd), 0);
        ASSERT_EQ(::unlockpt(master_fd), 0);
        const char* name = ::ptsname(master_fd);
        ASSERT_NE(name, nullptr);
        slave_dev = name;
    }
    ~WatchPty() { if (master_fd >= 0) ::close(master_fd); }
};

/* Slave libmodbus trên PTY ghi sổ (fc, thời điểm) mọi yêu cầu. */
struct WatchSlave {
    struct Entry {
        uint8_t fc;
        Clock::time_point at;
    };
    modbus_t*         ctx     = nullptr;
    modbus_mapping_t* mapping = nullptr;
    std::thread       thread;
    std::atomic<bool> stop{false};
    std::mutex        mu;
    std::condition_variable cv;
    std::vector<Entry> log;
    std::function<void(uint8_t fc)> on_request;

    void start(const std::string& dev, int pty_master)
    {
        ctx = modbus_new_rtu(dev.c_str(), 19200, 'N', 8, 1);
        ASSERT_NE(ctx, nullptr);
        modbus_set_slave(ctx, 1);
        modbus_set_socket(ctx, pty_master);
        modbus_set_indication_timeout(ctx, 0, 100000);
        mapping = modbus_mapping_new(32, 32, 32, 32);
        ASSERT_NE(mapping, nullptr);
        thread = std::thread([this]() {
            uint8_t request[MODBUS_RTU_MAX_ADU_LENGTH] = {};
            while (!stop.load()) {
                const int n = modbus_receive(ctx, request);
                if (n <= 0) {
                    if (errno == ETIMEDOUT) continue;
                    break;
                }
                const uint8_t fc = (n > 1) ? request[1] : 0;
                {
                    std::lock_guard<std::mutex> lock(mu);
                    log.push_back({fc, Clock::now()});
                }
                cv.notify_all();
                if (on_request) on_request(fc);
                if (modbus_reply(ctx, request, n, mapping) < 0) break;
            }
        });
    }
    size_t count(uint8_t fc)
    {
        std::lock_guard<std::mutex> lock(mu);
        return static_cast<size_t>(std::count_if(log.begin(), log.end(),
                                                 [fc](const Entry& e) { return e.fc == fc; }));
    }
    Clock::time_point wait_nth(uint8_t fc, size_t n, std::chrono::milliseconds limit, bool* ok)
    {
        std::unique_lock<std::mutex> lock(mu);
        Clock::time_point at{};
        *ok = cv.wait_for(lock, limit, [&]() {
            size_t seen = 0;
            for (const auto& e : log) {
                if (e.fc != fc) continue;
                if (++seen == n) { at = e.at; return true; }
            }
            return false;
        });
        return at;
    }
    std::vector<uint8_t> fcs()
    {
        std::lock_guard<std::mutex> lock(mu);
        std::vector<uint8_t> out;
        for (const auto& e : log) out.push_back(e.fc);
        return out;
    }
    void clear()
    {
        std::lock_guard<std::mutex> lock(mu);
        log.clear();
    }
    void finish()
    {
        stop.store(true);
        if (thread.joinable()) thread.join();
        if (mapping) modbus_mapping_free(mapping);
        if (ctx) modbus_free(ctx);
        mapping = nullptr;
        ctx = nullptr;
    }
    ~WatchSlave() { finish(); }
};

SlaveConfig watch_slave_cfg(const std::string& profile, uint32_t poll_ms, uint32_t timeout_ms = 100)
{
    SlaveConfig sl;
    sl.addr       = 1;
    sl.bus_id     = 1;
    sl.profile    = profile;
    sl.name       = "ck508";
    sl.poll_ms    = poll_ms;
    sl.timeout_ms = timeout_ms;
    sl.retry      = 0;
    return sl;
}

FieldbusConfig watch_cfg(const std::string& dev, const SlaveConfig& sl)
{
    FieldbusConfig cfg;
    cfg.rs485.device = dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(sl);
    return cfg;
}

PendingWrite coil_write(uint16_t reg, float value)
{
    PendingWrite w{};
    w.ext_idx    = KX_N_EXT;
    w.slave_addr = 1;
    w.fc         = 5;
    w.reg_addr   = reg;
    w.value      = value;
    w.type       = PointType::Bool;
    w.byte_order = ByteOrder::AB;
    w.scale      = 1.0f;
    return w;
}

double process_cpu_ms()
{
    struct rusage ru {};
    ::getrusage(RUSAGE_SELF, &ru);
    return (ru.ru_utime.tv_sec + ru.ru_stime.tv_sec) * 1000.0 +
           (ru.ru_utime.tv_usec + ru.ru_stime.tv_usec) / 1000.0;
}

/* Thời gian CPU (ns) của luồng mang tên `comm` trong process này, đọc từ
 * `/proc/self/task/<tid>/schedstat` (trường đầu = ns thực chạy). Chính xác tới
 * ns, khác `getrusage` bị lượng tử hoá theo tick. -1 nếu không đọc được. */
long long thread_cpu_ns(const char* comm)
{
    DIR* dir = ::opendir("/proc/self/task");
    if (!dir) return -1;
    long long found = -1;
    while (const struct dirent* entry = ::readdir(dir)) {
        if (entry->d_name[0] == '.') continue;
        const std::string base = std::string("/proc/self/task/") + entry->d_name;
        std::ifstream name_file(base + "/comm");
        std::string name;
        if (!std::getline(name_file, name) || name != comm) continue;
        std::ifstream stat_file(base + "/schedstat");
        if (!(stat_file >> found)) found = -1;
        break;
    }
    ::closedir(dir);
    return found;
}

} // namespace

/* G7(a)+(b) — ĐƯỜNG ĐẦY ĐỦ: Core đổi `ext_cmd_seq` trong plc_shm ⇒ luồng
 * `mb-extcmd` phát hiện ⇒ BusWorker bị đánh thức ⇒ FC05 lên dây.
 *
 * Mỗi mẫu chờ một khoảng lệch pha khác nhau so với chu kỳ soi 5 ms, để phủ cả
 * trường hợp xấu nhất (lệnh tới ngay sau một lượt soi). Spec G7: phát hiện
 * ≤ 10 ms (một base step Core). Trên PTY, giao dịch FC05 tốn < 1 ms nên toàn
 * đường gần bằng trễ phát hiện. Trước G7: 0–100 ms phát hiện + 0–200 ms chờ
 * worker. */
TEST(ExtCmdWatch, TuExtCmdSeqToiDayTrongMotBaseStep)
{
    WatchPty pty;
    pty.open_pair();
    const std::string profile = watch_profile("e2e", kCoilProfile);
    WatchSlave slave;
    slave.start(pty.slave_dev, pty.master_fd);
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(watch_cfg(pty.slave_dev, watch_slave_cfg(profile, 3600000)), cache, metrics));
    auto shm = watch_shm("do1");
    kx_plc_shm_t* raw = shm.get();
    master.start_ext_command_watch([raw]() { return raw; });
    ASSERT_TRUE(wait_until([&]() { return master.ext_command_scans() >= 1; },
                           std::chrono::milliseconds(1000)))
        << "luồng mb-extcmd chưa lấy mốc";
    master.start_workers(cache, metrics);
    bool ok = false;
    slave.wait_nth(1, 1, std::chrono::milliseconds(2000), &ok);
    ASSERT_TRUE(ok) << "worker không đọc lần đầu";

    std::vector<double> latencies;
    for (int i = 0; i < 12; i++) {
        /* 11..22 ms: lệch pha đều qua hai chu kỳ soi. */
        std::this_thread::sleep_for(std::chrono::microseconds(11000 + 1000 * i));
        const Clock::time_point t0 = Clock::now();
        core_command(raw, 0, (i % 2 == 0) ? 1.0 : 0.0);
        const Clock::time_point on_wire =
            slave.wait_nth(5, static_cast<size_t>(i + 1), std::chrono::milliseconds(1000), &ok);
        ASSERT_TRUE(ok) << "lệnh thứ " << (i + 1) << " không lên dây trong 1 s";
        latencies.push_back(ms_between(t0, on_wire));
    }
    master.stop_ext_command_watch();
    master.stop_workers();
    const int coil = slave.mapping->tab_bits[0];
    slave.finish();
    master.close();
    ::unlink(profile.c_str());

    std::vector<double> sorted = latencies;
    std::sort(sorted.begin(), sorted.end());
    const double median = sorted[sorted.size() / 2];
    const double worst  = sorted.back();
    std::printf("[ ĐO       ] ext_cmd_seq→FC05 (ms): median=%.2f max=%.2f all=", median, worst);
    for (double v : latencies) std::printf(" %.2f", v);
    std::printf("\n");
    /* Trung vị là thước đo của thiết kế (≈ nửa chu kỳ soi); cực đại chừa chỗ
     * cho máy CI đang tải nhưng vẫn cách mã cũ (≥ 100 ms) cả bậc. */
    EXPECT_LE(median, 10.0) << "trễ phát hiện điển hình vượt một base step Core";
    EXPECT_LE(worst, 25.0) << "một lệnh mất " << worst << " ms từ ext_cmd_seq tới dây";
    EXPECT_EQ(coil, 0) << "giá trị cuối cùng trên thiết bị phải là lệnh cuối (0)";
}

/* G7(a) — luồng soi có trần CPU, không quay rỗng: đếm được số lần tỉnh. */
TEST(ExtCmdWatch, LuongSoiCoTranCpuVaKhongQuayRong)
{
    WatchPty pty;
    pty.open_pair();
    const std::string profile = watch_profile("cpu", kCoilProfile);
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(watch_cfg(pty.slave_dev, watch_slave_cfg(profile, 3600000)), cache, metrics));
    auto shm = watch_shm("do1");
    kx_plc_shm_t* raw = shm.get();

    const double cpu0 = process_cpu_ms();
    const Clock::time_point t0 = Clock::now();
    master.start_ext_command_watch([raw]() { return raw; });
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    /* Đọc CPU của đúng luồng `mb-extcmd` khi nó còn sống. */
    const long long thread_ns = thread_cpu_ns("mb-extcmd");
    master.stop_ext_command_watch();
    const double wall_ms = ms_between(t0, Clock::now());
    const double process_ms = process_cpu_ms() - cpu0;
    /* Ưu tiên số của riêng luồng; không đọc được thì dùng số cả process (chặn
     * trên, vì gồm cả luồng test). */
    const double cpu_ms  = (thread_ns >= 0) ? thread_ns / 1e6 : process_ms;
    const uint64_t ticks = master.ext_watch_ticks();
    const uint64_t scans = master.ext_command_scans();
    master.close();
    ::unlink(profile.c_str());

    std::printf("[ ĐO       ] mb-extcmd %.0f ms: ticks=%llu scans=%llu cpu_thread=%.3f ms (%.3f%%,"
                " %.1f µs/tick) cpu_process=%.2f ms\n",
                wall_ms, static_cast<unsigned long long>(ticks),
                static_cast<unsigned long long>(scans), cpu_ms, 100.0 * cpu_ms / wall_ms,
                ticks ? 1000.0 * cpu_ms / static_cast<double>(ticks) : 0.0, process_ms);
    /* Trần trên: không bao giờ tỉnh dày hơn chu kỳ — dấu hiệu quay rỗng. */
    EXPECT_LE(ticks, static_cast<uint64_t>(wall_ms / kExtCommandPollMs) + 3);
    /* Trần dưới: thật sự soi đủ dày để giữ trễ phát hiện ≤ 10 ms. */
    EXPECT_GE(ticks, static_cast<uint64_t>(wall_ms / kExtCommandPollMs / 2));
    /* plc_shm không đổi ⇒ chỉ lượt lấy mốc chụp snapshot. */
    EXPECT_EQ(scans, 1u) << "đường nhanh không có tác dụng: mỗi lượt soi đều chụp 24 KB";
    /* 5% một lõi là trần rất rộng; đo thật trên máy dev là vài phần nghìn. */
    EXPECT_LT(cpu_ms, 0.05 * wall_ms) << "luồng soi tốn " << cpu_ms << " ms CPU trong " << wall_ms << " ms";
}

/* Chưa có bus nào ⇒ không có gì để ghi: luồng soi thưa theo `kExtCommandIdlePollMs`. */
TEST(ExtCmdWatch, ChuaCoBusThiSoiThua)
{
    ModbusMaster master;
    auto shm = watch_shm("do1");
    kx_plc_shm_t* raw = shm.get();
    master.start_ext_command_watch([raw]() { return raw; });
    std::this_thread::sleep_for(std::chrono::milliseconds(350));
    master.stop_ext_command_watch();
    EXPECT_LE(master.ext_watch_ticks(), 350u / kExtCommandIdlePollMs + 2);
    EXPECT_EQ(master.ext_command_scans(), 0u);
}

/* `stop_ext_command_watch` đánh thức luồng ngay, kể cả khi chu kỳ dài. */
TEST(ExtCmdWatch, StopDanhThucLuongSoiNgay)
{
    ModbusMaster master;
    master.start_ext_command_watch([]() { return static_cast<const kx_plc_shm_t*>(nullptr); }, 1000);
    ASSERT_TRUE(wait_until([&]() { return master.ext_watch_ticks() >= 1; },
                           std::chrono::milliseconds(500)));
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    const Clock::time_point t0 = Clock::now();
    master.stop_ext_command_watch();
    const double stop_ms = ms_between(t0, Clock::now());
    EXPECT_LE(stop_ms, 30.0) << "luồng soi ngủ hết chu kỳ 1 s thay vì bị đánh thức";
    EXPECT_FALSE(master.ext_command_watch_running());
}

/* G7 — đường nhanh của `drain_ext_writes`: chụp snapshot CHỈ khi có thứ đổi.
 * Lệnh bị worker từ chối có test riêng ngay dưới. */
TEST(ExtCmdWatch, DuongNhanhChiChupKhiCoDoi)
{
    WatchPty pty;
    pty.open_pair();
    const std::string profile = watch_profile("fast", kCoilProfile);
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(watch_cfg(pty.slave_dev, watch_slave_cfg(profile, 3600000)), cache, metrics));
    auto shm = watch_shm("do1");

    master.drain_ext_writes(shm.get(), 1000);           /* lượt mốc */
    ASSERT_EQ(master.ext_command_scans(), 1u);
    for (uint64_t t = 1005; t < 1500; t += 5) master.drain_ext_writes(shm.get(), t);
    EXPECT_EQ(master.ext_command_scans(), 1u) << "không có gì đổi mà vẫn chụp snapshot";

    core_command(shm.get(), 0, 1.0);
    master.drain_ext_writes(shm.get(), 1500);
    EXPECT_EQ(master.ext_command_scans(), 2u);
    EXPECT_EQ(master.bus(0).pending_write_count(), 1u);
    master.drain_ext_writes(shm.get(), 1505);
    EXPECT_EQ(master.ext_command_scans(), 2u);
    EXPECT_EQ(master.bus(0).pending_write_count(), 1u) << "cùng một lệnh bị phát lại";

    /* `ext_count` đổi (Core nạp catalog mới) ⇒ phải chụp lại, rồi lại im. */
    shm->ext_count = 2;
    master.drain_ext_writes(shm.get(), 1510);
    EXPECT_EQ(master.ext_command_scans(), 3u);
    master.drain_ext_writes(shm.get(), 1515);
    EXPECT_EQ(master.ext_command_scans(), 3u);

    /* Magic sai ⇒ không chụp gì cả (trước G7: 5 lần memcpy 24 KB mỗi lượt). */
    core_command(shm.get(), 0, 0.0);
    shm->magic = 0;
    master.drain_ext_writes(shm.get(), 1520);
    EXPECT_EQ(master.ext_command_scans(), 3u);
    shm->magic = KX_SHM_MAGIC;
    master.drain_ext_writes(shm.get(), 1525);
    EXPECT_EQ(master.ext_command_scans(), 4u);
    master.close();
    ::unlink(profile.c_str());
}

/* G7 — lệnh bị worker TỪ CHỐI (hàng đợi đầy) chưa được tiêu `ext_cmd_seq`:
 * đường nhanh không được che nó, nhưng cũng không thử lại mỗi 5 ms (mỗi lần là
 * một dòng ERROR) — nhịp thử lại là `kExtWriteRetryMs`. */
TEST(ExtCmdWatch, LenhBiTuChoiDuocThuLaiTheoNhipCoTran)
{
    WatchPty pty;
    pty.open_pair();
    const std::string profile = watch_profile("retry",
        R"json({"points":[{"name":"do1","fc":1,"addr":0,"count":1,"type":"bool","writable":true},)json"
        R"json({"name":"do2","fc":1,"addr":1,"count":1,"type":"bool","writable":true}]})json");
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(watch_cfg(pty.slave_dev, watch_slave_cfg(profile, 3600000)), cache, metrics));
    auto shm = watch_shm("do1");
    shm->ext_count = 2;
    std::strncpy(shm->ext[1].name, "do2", sizeof(shm->ext[1].name) - 1);
    master.drain_ext_writes(shm.get(), 1000);           /* lượt mốc */

    /* Lấp đầy hàng đợi bằng register KHÔNG thuộc hai slot (2..65). */
    for (uint16_t reg = 2; reg < 2 + kMaxPendingWrites; reg++)
        ASSERT_TRUE(master.submit_write(coil_write(reg, 1.0f)));
    ASSERT_EQ(master.bus(0).pending_write_count(), kMaxPendingWrites);

    core_command(shm.get(), 1, 1.0);                     /* do2 — không coalesce được */
    master.drain_ext_writes(shm.get(), 2000);
    const uint64_t after_reject = master.ext_command_scans();
    EXPECT_EQ(master.bus(0).pending_write_count(), kMaxPendingWrites) << "hàng đợi có trần 64";
    /* Trong cửa sổ thử lại: đường nhanh giữ im, không chụp mỗi 5 ms. */
    for (uint64_t t = 2005; t < 2000 + kExtWriteRetryMs; t += 5) master.drain_ext_writes(shm.get(), t);
    EXPECT_EQ(master.ext_command_scans(), after_reject) << "thử lại dồn dập mỗi 5 ms";
    /* Tới hạn thử lại ⇒ chụp lại dù `ext_cmd_seq` không đổi. */
    master.drain_ext_writes(shm.get(), 2000 + kExtWriteRetryMs);
    EXPECT_EQ(master.ext_command_scans(), after_reject + 1) << "lệnh bị từ chối không được thử lại";

    master.close();
    ::unlink(profile.c_str());
}

/* G7(d) — "giá trị mới nhất tại lúc phát trên bus". Worker đang kẹt trong một
 * giao dịch đọc 80 ms; Core đổi lệnh ba lần (1 → 0 → 1). Khi dây rảnh, chỉ
 * MỘT FC05 được phát và mang giá trị cuối — không phát lại chuỗi lịch sử. */
TEST(ExtCmdWatch, BusBanThiChiPhatGiaTriMoiNhat)
{
    WatchPty pty;
    pty.open_pair();
    const std::string profile = watch_profile("latest", kCoilProfile);
    WatchSlave slave;
    std::atomic<bool> reading{false};
    std::atomic<bool> held_once{false};
    slave.on_request = [&](uint8_t fc) {
        if (fc == 1 && !held_once.exchange(true)) {
            reading.store(true);
            std::this_thread::sleep_for(std::chrono::milliseconds(80));
        }
    };
    slave.start(pty.slave_dev, pty.master_fd);
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(watch_cfg(pty.slave_dev, watch_slave_cfg(profile, 3600000, 300)),
                            cache, metrics));
    auto shm = watch_shm("do1");
    kx_plc_shm_t* raw = shm.get();
    master.start_ext_command_watch([raw]() { return raw; });
    ASSERT_TRUE(wait_until([&]() { return master.ext_command_scans() >= 1; },
                           std::chrono::milliseconds(1000)));
    master.start_workers(cache, metrics);
    ASSERT_TRUE(wait_until([&]() { return reading.load(); }, std::chrono::milliseconds(2000)));

    core_command(raw, 0, 1.0);
    std::this_thread::sleep_for(std::chrono::milliseconds(15));
    core_command(raw, 0, 0.0);
    std::this_thread::sleep_for(std::chrono::milliseconds(15));
    core_command(raw, 0, 1.0);

    bool ok = false;
    slave.wait_nth(5, 1, std::chrono::milliseconds(1000), &ok);
    ASSERT_TRUE(ok) << "không lệnh nào lên dây sau khi bus rảnh";
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    master.stop_ext_command_watch();
    master.stop_workers();
    const size_t writes = slave.count(5);
    const int coil = slave.mapping->tab_bits[0];
    slave.finish();
    master.close();
    ::unlink(profile.c_str());

    EXPECT_EQ(writes, 1u) << "bus bận mà vẫn phát lại cả chuỗi lịch sử lệnh";
    EXPECT_EQ(coil, 1) << "thiết bị không nhận giá trị MỚI NHẤT";
}

/* G7(c) — trần ghi-trước-đọc TƯỜNG MINH. Mười lệnh ghi (mười register khác
 * nhau) chờ cùng lúc slave tới hạn đọc: trên dây phải là `kMaxWritesBeforeRead`
 * lệnh ghi, rồi lượt đọc, rồi tiếp tối đa `kMaxWritesBeforeRead` lệnh ghi. */
TEST(ExtCmdPriority, TranGhiTruocMotLuotDocToiHan)
{
    ASSERT_EQ(kMaxWritesBeforeRead, 4u) << "đổi trần thì sửa luôn chuỗi kỳ vọng dưới đây";
    WatchPty pty;
    pty.open_pair();
    const std::string profile = watch_profile("bound", kCoilProfile);
    WatchSlave slave;
    slave.start(pty.slave_dev, pty.master_fd);
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(watch_cfg(pty.slave_dev, watch_slave_cfg(profile, 1000)), cache, metrics));
    master.poll_once(1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");   /* lượt đọc đầu */
    slave.clear();
    for (uint16_t reg = 0; reg < 10; reg++)
        ASSERT_TRUE(master.submit_write(coil_write(reg, 1.0f)));

    master.poll_once(2000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");  /* đọc tới hạn */
    const std::vector<uint8_t> first = slave.fcs();
    slave.clear();
    master.poll_once(2001, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");  /* đọc chưa tới hạn */
    const std::vector<uint8_t> second = slave.fcs();
    const size_t left = master.bus(0).pending_write_count();
    slave.finish();
    master.close();
    ::unlink(profile.c_str());

    const std::vector<uint8_t> want_first = {5, 5, 5, 5, 1, 5, 5, 5, 5};
    EXPECT_EQ(first, want_first) << "thứ tự trên dây không đúng trần ghi-trước-đọc";
    const std::vector<uint8_t> want_second = {5, 5};
    EXPECT_EQ(second, want_second) << "lệnh ghi còn lại không được phát ở lượt kế";
    EXPECT_EQ(left, 0u);
}
#endif /* MKDDC_ENABLE_MODBUS */

/* ---------------------------------------------------------------------------
 * `PlcShmView` — ánh xạ plc_shm giữ lâu.
 * ------------------------------------------------------------------------ */
namespace {

struct TestShm {
    std::string name;
    kx_plc_shm_t* mem = nullptr;
    explicit TestShm(const std::string& tag)
        : name("/mkddc_test_view_" + tag + "_" + std::to_string(::getpid())) {}
    bool create(size_t size = sizeof(kx_plc_shm_t), uint32_t marker = 0)
    {
        const int fd = ::shm_open(name.c_str(), O_CREAT | O_RDWR | O_TRUNC, 0600);
        if (fd < 0) return false;
        if (::ftruncate(fd, static_cast<off_t>(size)) != 0) { ::close(fd); return false; }
        if (size >= sizeof(kx_plc_shm_t)) {
            void* p = ::mmap(nullptr, sizeof(kx_plc_shm_t), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
            if (p == MAP_FAILED) { ::close(fd); return false; }
            unmap();
            mem = static_cast<kx_plc_shm_t*>(p);
            mem->magic      = KX_SHM_MAGIC;
            mem->scan_count = marker;
        }
        ::close(fd);
        return true;
    }
    void unmap()
    {
        if (mem) ::munmap(mem, sizeof(kx_plc_shm_t));
        mem = nullptr;
    }
    void remove()
    {
        unmap();
        ::shm_unlink(name.c_str());
    }
    ~TestShm() { remove(); }
};

} // namespace

TEST(PlcShmView, ChuaCoObjectThiNullRoiAnhXaKhiCoreTao)
{
    TestShm shm("late");
    shm.remove();
    PlcShmView view(shm.name, 1000);
    EXPECT_EQ(view.get(0), nullptr);
    ASSERT_TRUE(shm.create(sizeof(kx_plc_shm_t), 7));
    EXPECT_EQ(view.get(500), nullptr) << "chưa tới nhịp kiểm lại mà đã shm_open";
    const kx_plc_shm_t* p = view.get(1000);
    ASSERT_NE(p, nullptr);
    EXPECT_EQ(p->scan_count, 7u);
    EXPECT_EQ(view.map_count(), 1u);
    /* Ánh xạ giữ lâu: các lần sau không ánh xạ lại. */
    EXPECT_EQ(view.get(2000), p);
    EXPECT_EQ(view.get(3000), p);
    EXPECT_EQ(view.map_count(), 1u);
}

TEST(PlcShmView, ObjectBiTaoLaiThiAnhXaLaiKhongDocObjectMoCoi)
{
    TestShm shm("recreate");
    ASSERT_TRUE(shm.create(sizeof(kx_plc_shm_t), 1));
    PlcShmView view(shm.name, 1000);
    const kx_plc_shm_t* p = view.get(0);
    ASSERT_NE(p, nullptr);
    EXPECT_EQ(p->scan_count, 1u);

    /* Dọn /dev/shm rồi Core tạo lại — inode mới. */
    shm.remove();
    ASSERT_TRUE(shm.create(sizeof(kx_plc_shm_t), 2));
    const kx_plc_shm_t* q = view.get(1000);
    ASSERT_NE(q, nullptr);
    EXPECT_EQ(q->scan_count, 2u) << "vẫn đọc object mồ côi đã bị xoá";
    EXPECT_EQ(view.map_count(), 2u);

    /* Object biến mất ⇒ nullptr, không giữ ánh xạ cũ. */
    shm.remove();
    EXPECT_EQ(view.get(2000), nullptr);
}

TEST(PlcShmView, ObjectThieuKichThuocHoacMagicSaiThiKhongDung)
{
    TestShm shm("small");
    ASSERT_TRUE(shm.create(1024));
    PlcShmView view(shm.name, 1000);
    EXPECT_EQ(view.get(0), nullptr) << "ánh xạ object nhỏ hơn plc_shm — đọc quá cuối là SIGBUS";
    EXPECT_EQ(view.map_count(), 0u);

    ASSERT_TRUE(shm.create(sizeof(kx_plc_shm_t), 3));
    ASSERT_NE(view.get(1000), nullptr);
    shm.mem->magic = 0x12345678u;   /* Core đang khởi tạo lại */
    EXPECT_EQ(view.get(1001), nullptr);
    shm.mem->magic = KX_SHM_MAGIC;
    EXPECT_NE(view.get(1002), nullptr);
}
