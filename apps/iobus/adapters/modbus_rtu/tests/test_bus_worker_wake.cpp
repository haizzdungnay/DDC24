/**
 * @file  test_bus_worker_wake.cpp
 * @brief G7 (EV-PROG-FBD-ST-MB-20260925) — BusWorker thức dậy THEO SỰ KIỆN.
 *
 * Trước bản này `BusWorker::run_loop` ngủ bằng `sleep_for` với trần 200 ms.
 * Chú thích nói worker "tỉnh đủ dày để phản ứng với lệnh ghi mới", nhưng lệnh
 * ghi vào hàng đợi lúc worker vừa ngủ vẫn nằm im tới 200 ms; `stop` và probe
 * commissioning cũng vậy. Cộng với nhịp quét lệnh 100 ms của `fb-publish`, lệnh
 * Core → FC05 trễ vài trăm ms trước khi lên dây (đo trên bo: ~377 ms).
 *
 * Mọi test ở đây chỉ dùng API đã có trước bản sửa, nên chạy được trên mã cũ:
 * trên mã cũ chúng ĐỎ với độ trễ ~170 ms, trên mã mới XANH với ~1 ms. Slave là
 * libmodbus thật trên PTY; mốc "lệnh vào transport" là lúc slave nhận đủ khung
 * yêu cầu, tức lệnh đã thật sự rời master xuống dây.
 */
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
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

using namespace iobus::fieldbus;
using Clock = std::chrono::steady_clock;

#ifdef MKDDC_ENABLE_MODBUS
namespace {

/* Ngưỡng cho mọi phép đo "phải thức ngay". Mã cũ cho ~170 ms ở đúng kịch bản
 * dưới đây (worker vừa ngủ 30 ms trong chu kỳ 200 ms); mã mới cho ~1 ms trên
 * PTY. 30 ms chừa rộng cho máy CI đang tải mà vẫn cách mã cũ gần 6 lần. */
constexpr double kWakeBoundMs = 30.0;

double ms_between(Clock::time_point a, Clock::time_point b)
{
    return std::chrono::duration<double, std::milli>(b - a).count();
}

std::string wake_profile(const std::string& tag, const std::string& json)
{
    const std::string path = "/tmp/mkddc_wake_" + tag + "_" + std::to_string(::getpid()) + ".json";
    std::ofstream f(path);
    f << json;
    return path;
}

struct WakePty {
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
    ~WakePty() { if (master_fd >= 0) ::close(master_fd); }
};

/* Slave libmodbus trên PTY, GHI SỔ mọi yêu cầu nhận được: (fc, thời điểm). Sổ
 * là bằng chứng thứ tự và thời điểm lệnh lên dây — không dựa vào bộ đếm của
 * chính master, vì đó là thứ đang bị kiểm. */
struct WakeSlave {
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
    /* Chạy trên thread slave SAU khi ghi sổ, TRƯỚC khi trả lời. */
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
    /* Chờ tới khi sổ có ít nhất `n` yêu cầu mang `fc`; trả thời điểm của yêu
     * cầu thứ `n` (1-based) hoặc nullopt-kiểu-cũ qua cờ `ok`. */
    Clock::time_point wait_nth(uint8_t fc, size_t n, std::chrono::milliseconds limit, bool* ok)
    {
        std::unique_lock<std::mutex> lock(mu);
        Clock::time_point at{};
        const bool got = cv.wait_for(lock, limit, [&]() {
            size_t seen = 0;
            for (const auto& e : log) {
                if (e.fc != fc) continue;
                if (++seen == n) { at = e.at; return true; }
            }
            return false;
        });
        *ok = got;
        return at;
    }
    std::vector<Entry> snapshot()
    {
        std::lock_guard<std::mutex> lock(mu);
        return log;
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
    ~WakeSlave() { finish(); }
};

std::unique_ptr<kx_plc_shm_t> wake_shm(const char* point)
{
    auto shm = std::make_unique<kx_plc_shm_t>();
    std::memset(shm.get(), 0, sizeof(kx_plc_shm_t));
    shm->magic     = KX_SHM_MAGIC;
    shm->seq       = 2;
    shm->ext_count = 1;
    std::strncpy(shm->ext[0].name, point, sizeof(shm->ext[0].name) - 1);
    return shm;
}

SlaveConfig wake_slave_cfg(const std::string& profile, uint32_t poll_ms)
{
    SlaveConfig sl;
    sl.addr       = 1;
    sl.bus_id     = 1;
    sl.profile    = profile;
    sl.name       = "ck508";
    sl.poll_ms    = poll_ms;
    sl.timeout_ms = 100;
    sl.retry      = 0;
    return sl;
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

const char* kCoilProfile =
    R"json({"points":[{"name":"do1","fc":1,"addr":0,"count":1,"type":"bool","writable":true}]})json";

/* Dựng master + slave, chạy worker thread, đợi lượt ĐỌC đầu tiên xong. Sau đó
 * slave (poll 1 giờ) không tới hạn đọc nữa: worker chỉ còn ngủ, đúng tình
 * huống mà trần ngủ cũ làm lệnh ghi chờ. */
struct IdleWorkerRig {
    WakePty pty;
    WakeSlave slave;
    std::string profile;
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;

    void start()
    {
        pty.open_pair();
        profile = wake_profile("idle", kCoilProfile);
        slave.start(pty.slave_dev, pty.master_fd);
        FieldbusConfig cfg;
        cfg.rs485.device = pty.slave_dev;
        cfg.rs485.baud   = 19200;
        cfg.slaves.push_back(wake_slave_cfg(profile, 3600000));
        ASSERT_TRUE(master.open(cfg, cache, metrics));
        master.start_workers(cache, metrics);
        bool ok = false;
        slave.wait_nth(1, 1, std::chrono::milliseconds(2000), &ok);
        ASSERT_TRUE(ok) << "worker không đọc lần đầu";
    }
    ~IdleWorkerRig()
    {
        master.stop_workers();
        slave.finish();
        master.close();
        if (!profile.empty()) ::unlink(profile.c_str());
    }
};

} // namespace

/* G7(b) — lệnh ghi Core vào hàng đợi phải lên dây NGAY, không chờ worker tự
 * tỉnh theo trần ngủ.
 *
 * Mỗi mẫu: đợi 30 ms cho worker chắc chắn đã ngủ, đổi `ext_cmd_seq` như Core,
 * gọi `drain_ext_writes` rồi đo tới lúc slave nhận FC05. Mã cũ: worker ngủ tiếp
 * phần còn lại của 200 ms ⇒ ~170 ms mỗi mẫu. */
TEST(ExtCmdWake, LenhGhiMoiLenDayNgayKhongChoTranNgu)
{
    IdleWorkerRig rig;
    rig.start();
    if (HasFatalFailure()) return;

    auto shm = wake_shm("do1");
    rig.master.drain_ext_writes(shm.get(), monotonic_ms());   /* lượt mốc */

    std::vector<double> latencies;
    for (int i = 0; i < 5; i++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
        shm->ext[0].setpoint = (i % 2 == 0) ? 1.0 : 0.0;
        shm->ext[0].dirty    = 1;
        shm->ext_cmd_seq[0]  = static_cast<uint32_t>(i + 1);
        const Clock::time_point t0 = Clock::now();
        rig.master.drain_ext_writes(shm.get(), monotonic_ms());
        bool ok = false;
        const Clock::time_point on_wire =
            rig.slave.wait_nth(5, static_cast<size_t>(i + 1), std::chrono::milliseconds(1000), &ok);
        ASSERT_TRUE(ok) << "lệnh thứ " << (i + 1) << " không lên dây trong 1 s";
        latencies.push_back(ms_between(t0, on_wire));
    }
    for (size_t i = 0; i < latencies.size(); i++) {
        EXPECT_LE(latencies[i], kWakeBoundMs)
            << "mẫu " << i << ": lệnh nằm trong hàng đợi " << latencies[i]
            << " ms chờ worker tự tỉnh — trần ngủ đang quyết định độ trễ ghi";
    }
    std::printf("[ ĐO       ] enqueue→FC05 (ms):");
    for (double v : latencies) std::printf(" %.2f", v);
    std::printf("\n");
}

/* G7(b) — `stop` phải đánh thức worker ngay. Mã cũ: `stop_workers` chờ worker
 * ngủ hết phần còn lại của 200 ms rồi mới join được. */
TEST(ExtCmdWake, StopDanhThucWorkerNgay)
{
    IdleWorkerRig rig;
    rig.start();
    if (HasFatalFailure()) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    const Clock::time_point t0 = Clock::now();
    rig.master.stop_workers();
    const double stop_ms = ms_between(t0, Clock::now());
    EXPECT_LE(stop_ms, kWakeBoundMs)
        << "stop_workers mất " << stop_ms << " ms — worker không bị đánh thức, ngủ hết trần";
    EXPECT_FALSE(rig.master.workers_running());
    std::printf("[ ĐO       ] stop_workers (ms): %.2f\n", stop_ms);
}

/* G7(b) — probe commissioning cũng là một sự kiện: kỹ thuật viên đang chờ kết
 * quả trên UI, worker phải phục vụ ngay chứ không đợi hết giấc ngủ. */
TEST(ExtCmdWake, ProbeDanhThucWorkerNgay)
{
    IdleWorkerRig rig;
    rig.start();
    if (HasFatalFailure()) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    BusWorker* worker = rig.master.bus_by_id(1);
    ASSERT_NE(worker, nullptr);
    const Clock::time_point t0 = Clock::now();
    const auto probe = worker->probe_read(1, 1, 0, 1, 100, 1000);
    const double probe_ms = ms_between(t0, Clock::now());
    EXPECT_TRUE(probe.ok) << probe.reason;
    EXPECT_LE(probe_ms, kWakeBoundMs)
        << "probe chờ " << probe_ms << " ms — worker không bị đánh thức";
    std::printf("[ ĐO       ] probe_read (ms): %.2f\n", probe_ms);
}

/* G7(c) — lệnh ghi đang chờ đi TRƯỚC lượt đọc tới hạn của cùng lượt phục vụ.
 *
 * Mã cũ đọc slave tới hạn rồi mới flush: một lệnh điều khiển phải đợi trọn các
 * giao dịch đọc (29 ms mỗi giao dịch ở 9600 baud, nhiều block thì nhân lên). */
TEST(ExtCmdPriority, LenhGhiDiTruocLuotDocToiHan)
{
    WakePty pty;
    pty.open_pair();
    const std::string profile = wake_profile("prio", kCoilProfile);
    WakeSlave slave;
    slave.start(pty.slave_dev, pty.master_fd);
    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(wake_slave_cfg(profile, 1000));
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg, cache, metrics));

    master.poll_once(1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");   /* lượt đọc đầu */
    slave.clear();
    ASSERT_TRUE(master.submit_write(coil_write(0, 1.0f)));
    /* t = 2000: slave tới hạn ĐỌC và có lệnh GHI chờ — cùng một lượt. */
    master.poll_once(2000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    const auto log = slave.snapshot();
    slave.finish();
    master.close();
    ::unlink(profile.c_str());

    ASSERT_EQ(log.size(), 2u) << "phải có đúng một lượt đọc và một lượt ghi";
    EXPECT_EQ(log[0].fc, 5) << "lượt đọc tới hạn đi trước lệnh ghi đang chờ";
    EXPECT_EQ(log[1].fc, 1);
}

/* G7(c) — ưu tiên ghi KHÔNG được bỏ đói đọc.
 *
 * Slave giả tạo một dòng lệnh ghi không dứt: mỗi FC05 nhận được lại sinh lệnh
 * mới. Nếu ghi được ưu tiên vô điều kiện, worker phát ghi mãi và không bao giờ
 * đọc lại — giá trị đọc về đóng băng trong khi quality vẫn GOOD. Lượt đọc phải
 * giữ nhịp `poll_ms` (40 ms), khoảng cách lớn nhất giữa hai lượt đọc có trần. */
TEST(ExtCmdPriority, DongLenhGhiLienTucKhongBoDoiDoc)
{
    WakePty pty;
    pty.open_pair();
    const std::string profile = wake_profile("starve", kCoilProfile);
    WakeSlave slave;
    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(wake_slave_cfg(profile, 40));
    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg, cache, metrics));
    BusWorker* worker = master.bus_by_id(1);
    ASSERT_NE(worker, nullptr);

    std::atomic<bool> streaming{true};
    std::atomic<uint32_t> toggles{0};
    slave.on_request = [&](uint8_t fc) {
        if (fc != 5 || !streaming.load()) return;
        const uint32_t n = toggles.fetch_add(1);
        worker->enqueue_write(coil_write(0, (n % 2 == 0) ? 0.0f : 1.0f));
    };
    slave.start(pty.slave_dev, pty.master_fd);

    master.start_workers(cache, metrics);
    ASSERT_TRUE(master.submit_write(coil_write(0, 1.0f)));
    std::this_thread::sleep_for(std::chrono::milliseconds(600));
    streaming.store(false);
    master.stop_workers();
    const auto log = slave.snapshot();
    slave.finish();
    master.close();
    ::unlink(profile.c_str());

    std::vector<Clock::time_point> reads;
    size_t writes = 0;
    for (const auto& e : log) {
        if (e.fc == 1) reads.push_back(e.at);
        if (e.fc == 5) writes++;
    }
    ASSERT_GE(reads.size(), 6u) << "chỉ có " << reads.size()
                                << " lượt đọc trong 600 ms với poll 40 ms — đọc bị bỏ đói";
    double max_gap = 0.0;
    for (size_t i = 1; i < reads.size(); i++)
        max_gap = std::max(max_gap, ms_between(reads[i - 1], reads[i]));
    EXPECT_LE(max_gap, 140.0) << "khoảng cách giữa hai lượt đọc " << max_gap
                              << " ms khi poll 40 ms — dòng lệnh ghi chiếm dây";
    EXPECT_GE(writes, reads.size()) << "dòng lệnh ghi không thật sự cạnh tranh với lượt đọc";
    std::printf("[ ĐO       ] 600 ms: reads=%zu writes=%zu max_read_gap=%.1f ms\n",
                reads.size(), writes, max_gap);
}
#endif /* MKDDC_ENABLE_MODBUS */
