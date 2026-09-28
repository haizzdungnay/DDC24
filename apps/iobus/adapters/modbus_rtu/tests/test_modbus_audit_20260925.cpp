/**
 * @file  test_modbus_audit_20260925.cpp
 * @brief Test hồi quy cho các finding FW SOM của audit Modbus 2026-09-25
 *        (`docs/07_records/reviews/MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md`).
 *
 * Mỗi test dựng lại ĐÚNG kịch bản làm lỗi lộ ra — trên bo Forlinx hoặc khi đọc
 * mã — chứ không kiểm lại logic đã sửa bằng chính logic đó.
 */
#include <atomic>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <functional>
#include <memory>
#include <pthread.h>
#include <sched.h>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#endif
#include <gtest/gtest.h>

#include "bus_worker.hpp"
#include "device_profile.hpp"
#include "ext_cache.hpp"
#include "fieldbus_metrics.hpp"
#include "modbus_master.hpp"
#include "thread_policy.hpp"

using namespace iobus::fieldbus;

/* ---------------------------------------------------------------------------
 * `MBA-FW-01` — thread không thuộc vòng IOP phải chạy SCHED_OTHER.
 * ------------------------------------------------------------------------ */

TEST(MbaThreadPolicy, HaVeSchedOtherVaDatTenThread)
{
    bool demoted = false;
    int policy = -1;
    char name[16] = {};
    std::thread worker([&]() {
        demoted = demote_to_normal_sched("mb-bus9");
        struct sched_param sp {};
        ::pthread_getschedparam(::pthread_self(), &policy, &sp);
        ::pthread_getname_np(::pthread_self(), name, sizeof(name));
    });
    worker.join();
    EXPECT_TRUE(demoted);
    EXPECT_EQ(policy, SCHED_OTHER);
    EXPECT_STREQ(name, "mb-bus9");
}

/* Tái lập đúng cơ chế trên bo: thread cha ở SCHED_FIFO, thread con tạo bằng
 * `std::thread` THỪA HƯỞNG nó. Cần quyền RT — máy dev/CI không có thì bỏ qua
 * (bằng chứng target nằm ở báo cáo board). */
TEST(MbaThreadPolicy, ThreadConThuaHuongFifoVaDuocHaVeOther)
{
    struct sched_param rt {};
    rt.sched_priority = 1;
    int old_policy = 0;
    struct sched_param old_param {};
    ::pthread_getschedparam(::pthread_self(), &old_policy, &old_param);
    if (::pthread_setschedparam(::pthread_self(), SCHED_FIFO, &rt) != 0)
        GTEST_SKIP() << "không có quyền SCHED_FIFO trên máy này";

    int inherited = -1, after = -1;
    std::thread child([&]() {
        struct sched_param sp {};
        ::pthread_getschedparam(::pthread_self(), &inherited, &sp);
        demote_to_normal_sched("fb-publish");
        ::pthread_getschedparam(::pthread_self(), &after, &sp);
    });
    child.join();
    ::pthread_setschedparam(::pthread_self(), old_policy, &old_param);

    EXPECT_EQ(inherited, SCHED_FIFO) << "glibc không còn thừa hưởng lập lịch — xem lại MBA-FW-01";
    EXPECT_EQ(after, SCHED_OTHER);
}

/* ---------------------------------------------------------------------------
 * `MBA-FW-03` — FieldbusMetrics bị ghi/đọc đồng thời từ nhiều thread.
 *
 * Hai thread cùng ghi MỘT bus (tệ hơn thực tế — mỗi bus một worker — để lỗi lộ
 * nhanh) trong khi publisher chốt cửa sổ và đọc bản sao. Không khoá thì bộ đếm
 * mất lượt tăng và `latency_window_` bị `erase`/`push_back` giữa lúc bị chép.
 * ------------------------------------------------------------------------ */
TEST(MbaFieldbusMetrics, GhiDocDongThoiKhongMatBoDem)
{
    FieldbusMetrics metrics;
    metrics.init({"a", "b"}, {1, 2}, {1, 1});
    BusMetrics bus;
    bus.id = 1;
    bus.name = "RS485-1";
    metrics.init_buses({bus});

    constexpr int kPerWriter = 20000;
    std::atomic<bool> stop{false};
    auto writer = [&](uint8_t slave) {
        for (int i = 0; i < kPerWriter; i++) {
            metrics.record_bus_transaction(1, static_cast<uint32_t>(100 + i % 50), (i % 7) != 0, TransactionKind::Read);
            metrics.set_bus_state(1, (i % 2) ? "RUNNING" : "PORT_ERROR");
            metrics.update(slave, (i % 5) != 0, static_cast<uint64_t>(i));
            metrics.record_write_failed(slave);
        }
    };
    std::thread reader([&]() {
        while (!stop.load()) {
            metrics.roll_bus_window(1, 100000);
            const BusMetrics copy = metrics.bus(0);
            (void)copy.state.size();
            (void)metrics.get(0).total_polls;
        }
    });
    std::thread w1(writer, 0);
    std::thread w2(writer, 1);
    w1.join();
    w2.join();
    stop.store(true);
    reader.join();

    EXPECT_EQ(metrics.bus(0).total_transactions, static_cast<uint64_t>(2 * kPerWriter));
    EXPECT_EQ(metrics.get(0).write_failed, static_cast<uint64_t>(kPerWriter));
    EXPECT_EQ(metrics.get(1).total_polls, static_cast<uint64_t>(kPerWriter));
}

#ifdef MKDDC_ENABLE_MODBUS
namespace {

SlaveConfig audit_slave(uint8_t addr, const std::string& profile, const std::string& name,
                        uint8_t bus_id = 1)
{
    SlaveConfig sl;
    sl.addr       = addr;
    sl.bus_id     = bus_id;
    sl.profile    = profile;
    sl.name       = name;
    sl.poll_ms    = 1;
    sl.timeout_ms = 100;
    sl.retry      = 1;
    return sl;
}

std::string audit_profile(const std::string& tag, const std::string& json)
{
    const std::string path = "/tmp/mkddc_mba_" + tag + "_" + std::to_string(::getpid()) + ".json";
    std::ofstream f(path);
    f << json;
    return path;
}

struct AuditPty {
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
    ~AuditPty() { if (master_fd >= 0) ::close(master_fd); }
};

/* Slave libmodbus thật trên PTY. `on_request` chạy TRƯỚC khi trả lời, trên
 * thread của slave — chỗ để chen một hành động vào đúng giữa một giao dịch. */
struct AuditSlave {
    modbus_t*         ctx     = nullptr;
    modbus_mapping_t* mapping = nullptr;
    std::thread       thread;
    std::atomic<bool> stop{false};
    std::function<void(uint8_t fc)> on_request;

    void start(const std::string& dev, int pty_master, int bits, int input_bits, int regs)
    {
        ctx = modbus_new_rtu(dev.c_str(), 19200, 'N', 8, 1);
        ASSERT_NE(ctx, nullptr);
        modbus_set_slave(ctx, 1);
        modbus_set_socket(ctx, pty_master);
        modbus_set_indication_timeout(ctx, 0, 200000);
        mapping = modbus_mapping_new(bits, input_bits, regs, regs);
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
                if (on_request) on_request(fc);
                if (modbus_reply(ctx, request, n, mapping) < 0) break;
            }
        });
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
    ~AuditSlave() { finish(); }
};

std::unique_ptr<kx_plc_shm_t> audit_shm()
{
    auto shm = std::make_unique<kx_plc_shm_t>();
    std::memset(shm.get(), 0, sizeof(kx_plc_shm_t));
    shm->magic = KX_SHM_MAGIC;
    shm->seq   = 2;
    return shm;
}

} // namespace

/* `MBA-FW-05` — MỘT block trả exception không được kéo CẢ thiết bị OFFLINE.
 *
 * Slave có coil 0..15 nhưng chỉ 8 discrete input (0..7): DI ở 64 là địa chỉ
 * không tồn tại ⇒ slave trả ILLEGAL DATA ADDRESS (0x02). Trước bản sửa, lỗi đó
 * đi chung nhánh với timeout: cả dải slot của slave rơi STALE/BAD, và sau hai
 * lượt thì thiết bị OFFLINE — coil vốn đọc tốt cũng mất giá trị. */
TEST(MbaBlockException, ExceptionChiLamBadBlockDoThietBiVanOnline)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("blkexc",
        R"json({"points":[{"name":"do1","fc":1,"addr":0,"count":1,"type":"bool","writable":true},)json"
        R"json({"name":"di1","fc":2,"addr":64,"count":1,"type":"bool"}]})json");
    AuditSlave slave;
    slave.start(pty.slave_dev, pty.master_fd, 16, 8, 16);
    slave.mapping->tab_bits[0] = 1;

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "ck509"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));

    ExtCache cache;
    FieldbusMetrics metrics;
    for (uint64_t t = 1; t <= 4; t++)
        master.poll_once(t * 1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    slave.finish();

    EXPECT_EQ(cache.sample(0).quality, KX_EXTQ_GOOD) << "coil đọc tốt bị kéo xuống theo block lỗi";
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 1.0);
    EXPECT_EQ(cache.sample(1).quality, KX_EXTQ_BAD);
    EXPECT_EQ(cache.sample(1).quality_reason, KX_EXTR_DEVICE_EXCEPTION);
    EXPECT_EQ(cache.sample(1).exception_code, 0x02);
    EXPECT_TRUE(metrics.get(0).online) << "thiết bị ĐANG trả lời mà bị báo OFFLINE";
    EXPECT_FALSE(metrics.get(0).e302_triggered);
    EXPECT_NE(metrics.frames().to_json(0, 50).find("\"exception\""), std::string::npos)
        << "Frame Monitor phải phân loại được exception, không gộp vào 'error'";

    master.close();
    ::unlink(profile.c_str());
}

/* `MBA-FW-04` — lệnh ghi MỚI chen vào đúng lúc lệnh cũ cùng register đang bay.
 *
 * Đường cờ `dirty` có request_id rỗng; bản cũ hợp nhất theo (slave, fc, reg,
 * request_id) nên lệnh mới bị đánh "đã gửi" và xoá. Thiết bị kẹt ở giá trị cũ
 * trong khi dedup `last_written_` đã ghi nhận giá trị mới ⇒ không bao giờ phát
 * lại. Slave giả chen lệnh mới vào ĐÚNG giữa giao dịch ghi đầu tiên. */
TEST(MbaWriteQueue, LenhMoiChenGiuaGiaoDichGhiKhongBiMat)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("inflight",
        R"json({"points":[{"name":"do1","fc":1,"addr":0,"count":1,"type":"bool","writable":true}]})json");
    AuditSlave slave;

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "ck508"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));

    auto coil = [](float value) {
        PendingWrite w{};
        w.slave_addr = 1;
        w.fc         = 5;
        w.reg_addr   = 0;
        w.value      = value;
        w.type       = PointType::Bool;
        w.byte_order = ByteOrder::AB;
        w.scale      = 1.0f;
        return w;   /* request_id rỗng — đúng hình dạng đường cờ dirty */
    };
    std::atomic<bool> injected{false};
    BusWorker* worker = master.bus_by_id(1);
    ASSERT_NE(worker, nullptr);
    slave.on_request = [&](uint8_t fc) {
        if (fc == 5 && !injected.exchange(true)) worker->enqueue_write(coil(0.0f));
    };
    slave.start(pty.slave_dev, pty.master_fd, 16, 16, 16);

    ExtCache cache;
    FieldbusMetrics metrics;
    ASSERT_TRUE(master.submit_write(coil(1.0f)));
    master.poll_once(1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    ASSERT_TRUE(injected.load()) << "slave giả chưa thấy lệnh ghi đầu tiên";
    master.poll_once(2000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    /* Giá trị THẬT ở thiết bị — đọc thẳng bảng coil của slave. */
    const int coil_at_device = slave.mapping->tab_bits[0];
    slave.finish();

    EXPECT_EQ(coil_at_device, 0) << "thiết bị kẹt ở giá trị cũ: lệnh mới đã bị nuốt";
    EXPECT_EQ(metrics.get(0).write_failed, 0u);
    /* Hai lệnh ghi đều phải lên dây: 1 rồi 0. Vòng nhớ khung ghi lại mọi lần phát. */
    const std::string frames = metrics.frames().to_json(0, 50);
    size_t writes = 0;
    for (size_t pos = frames.find("\"fc\":5"); pos != std::string::npos;
         pos = frames.find("\"fc\":5", pos + 1))
        writes++;
    EXPECT_EQ(writes, 2u) << "lệnh ghi chen giữa giao dịch bị mất — setpoint cuối biến mất im lặng: "
                          << frames;
    EXPECT_EQ(worker->pending_write_count(), 0u);

    master.close();
    ::unlink(profile.c_str());
}

/* `MBA-FW-02` — khởi động lại iobus KHÔNG được phát lại lệnh cũ trong plc_shm.
 *
 * Log bo 2026-09-24 08:36–08:39: 171 sự kiện ghi coil ngay sau khi iobus khởi
 * động, toàn là setpoint cũ mà Core vẫn để `dirty=1`. */
TEST(MbaWriteBaseline, KhoiDongLaiKhongPhatLaiLenhCu)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("baseline",
        R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "vfd"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));

    auto shm = audit_shm();
    shm->ext_count = 1;
    std::strncpy(shm->ext[0].name, "sp", sizeof(shm->ext[0].name) - 1);
    shm->ext[0].dirty    = 1;
    shm->ext[0].setpoint = 50.0;   /* lệnh ra từ trước khi iobus khởi động */
    shm->ext_cmd_seq[0] = 1;

    master.drain_ext_writes(shm.get(), 1000);
    EXPECT_EQ(master.bus(0).pending_write_count(), 0u)
        << "setpoint cũ bị phát lại ngay sau khởi động (F-FW-07)";

    /* Lệnh MỚI sau khởi động vẫn phải đi. */
    shm->ext[0].setpoint = 60.0;
    shm->ext_cmd_seq[0] = 2;
    master.drain_ext_writes(shm.get(), 1100);
    EXPECT_EQ(master.bus(0).pending_write_count(), 1u);

    master.close();
    ::unlink(profile.c_str());
}

/* `MBA-FW-02` — slot trong plc_shm đang mang Point KHÁC thì không phát. */
TEST(MbaWriteBaseline, SlotLechDanhTinhThiKhongPhat)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("identity",
        R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "vfd"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));

    auto shm = audit_shm();
    shm->ext_count = 1;
    master.drain_ext_writes(shm.get(), 1000);   /* lượt mốc, chưa có lệnh */

    /* Core chưa đổi tên slot sang generation mới: lệnh ở slot là của Point cũ. */
    std::strncpy(shm->ext[0].name, "point-cu", sizeof(shm->ext[0].name) - 1);
    shm->ext[0].dirty    = 1;
    shm->ext[0].setpoint = 5.0;
    shm->ext_cmd_seq[0] = 1;
    master.drain_ext_writes(shm.get(), 1100);
    EXPECT_EQ(master.bus(0).pending_write_count(), 0u)
        << "giá trị của Point cũ bị ghi xuống register của Point mới";

    std::memset(shm->ext[0].name, 0, sizeof(shm->ext[0].name));
    std::strncpy(shm->ext[0].name, "sp", sizeof(shm->ext[0].name) - 1);
    master.drain_ext_writes(shm.get(), 1200);
    EXPECT_EQ(master.bus(0).pending_write_count(), 0u)
        << "lệnh của Point cũ không được sống lại sau khi tên slot khớp";
    shm->ext_cmd_seq[0] = 2; /* Core phát intent MỚI cho Point đúng. */
    master.drain_ext_writes(shm.get(), 1300);
    EXPECT_EQ(master.bus(0).pending_write_count(), 1u);

    master.close();
    ::unlink(profile.c_str());
}

/* `MBA-FW-09` — `bit_index` và `min_value`/`max_value` mà BE sinh vào profile
 * phải CÓ TÁC DỤNG. Trước bản sửa iobus không đọc hai khoá này: ba điểm bit trên
 * register 0x0005 đều publish 5 với nhãn GOOD, và 500 °C lọt qua biên 0..100. */
TEST(MbaProfileOptions, BitIndexVaBienKyThuatCoTacDung)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("bits",
        R"json({"points":[)json"
        R"json({"name":"b0","fc":3,"addr":10,"count":1,"type":"bool","bit_index":0},)json"
        R"json({"name":"b1","fc":3,"addr":10,"count":1,"type":"bool","bit_index":1},)json"
        R"json({"name":"b2","fc":3,"addr":10,"count":1,"type":"bool","bit_index":2},)json"
        R"json({"name":"temp","fc":3,"addr":11,"count":1,"type":"uint16","min_value":0,"max_value":100}]})json");
    AuditSlave slave;
    slave.start(pty.slave_dev, pty.master_fd, 16, 16, 32);
    slave.mapping->tab_registers[10] = 0x0005;
    slave.mapping->tab_registers[11] = 500;

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "vfd"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    ExtCache cache;
    FieldbusMetrics metrics;

    master.poll_once(1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 1.0) << "bit 0 của 0x0005";
    EXPECT_DOUBLE_EQ(cache.sample(1).value, 0.0) << "bit 1 của 0x0005";
    EXPECT_DOUBLE_EQ(cache.sample(2).value, 1.0) << "bit 2 của 0x0005";
    EXPECT_EQ(cache.sample(1).quality, KX_EXTQ_GOOD);
    EXPECT_EQ(cache.sample(3).quality, KX_EXTQ_BAD) << "500 ngoài biên 0..100 mà vẫn GOOD";
    EXPECT_EQ(cache.sample(3).quality_reason, KX_EXTR_OUT_OF_RANGE);

    slave.mapping->tab_registers[11] = 42;
    master.poll_once(2000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    EXPECT_EQ(cache.sample(3).quality, KX_EXTQ_GOOD);
    EXPECT_DOUBLE_EQ(cache.sample(3).value, 42.0);
    const int64_t good_ts = cache.sample(3).sample_utc_ms;

    slave.mapping->tab_registers[11] = 900;
    master.poll_once(3000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    const std::string frames = metrics.frames().to_json(0, 50);
    slave.finish();
    EXPECT_EQ(cache.sample(3).quality, KX_EXTQ_BAD);
    EXPECT_DOUBLE_EQ(cache.sample(3).value, 42.0) << "mẫu ngoài biên không được đè giá trị tốt cuối cùng";
    EXPECT_EQ(cache.sample(3).sample_utc_ms, good_ts) << "BAD không được làm mẫu trẻ lại";
    /* Ba điểm bit + điểm kề bên đi CHUNG một giao dịch FC03 addr 10 count 2. */
    EXPECT_NE(frames.find("\"addr\":10,\"count\":2"), std::string::npos) << frames;

    master.close();
    ::unlink(profile.c_str());
}

/* Điểm bit khai `writable` bị từ chối ngay ở parser: ghi FC06 là đè cả register. */
TEST(MbaProfileOptions, DiemBitKhongDuocKhaiGhi)
{
    const std::string profile = audit_profile("bitw",
        R"json({"points":[{"name":"run","fc":3,"addr":1,"count":1,"type":"bool","bit_index":3,"writable":true},)json"
        R"json({"name":"ok","fc":3,"addr":2,"count":1,"type":"uint16"}]})json");
    DeviceProfile prof;
    load_device_profile(profile, &prof);
    ASSERT_EQ(prof.points.size(), 1u) << "điểm bit writable phải bị loại";
    EXPECT_EQ(prof.points[0].name, "ok");
    ::unlink(profile.c_str());
}

/* `MBA-FW-07` — cùng slave_id trên hai dây: lệnh ghi phải đi đúng dây. */
TEST(MbaWriteRouting, CungDiaChiHaiDayPhaiNoiRoBus)
{
    AuditPty pty1, pty2;
    pty1.open_pair();
    pty2.open_pair();
    const std::string p1 = audit_profile("route1",
        R"json({"points":[{"name":"sp1","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    const std::string p2 = audit_profile("route2",
        R"json({"points":[{"name":"sp2","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");

    FieldbusConfig cfg;
    BusConfig b1;
    b1.id = 1;
    b1.device = pty1.slave_dev;
    BusConfig b2;
    b2.id = 2;
    b2.device = pty2.slave_dev;
    cfg.buses = {b1, b2};
    cfg.slaves.push_back(audit_slave(4, p1, "mtr-day1", 1));
    cfg.slaves.push_back(audit_slave(4, p2, "vfd-day2", 2));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));

    PendingWrite w{};
    w.slave_addr = 4;
    w.fc         = 6;
    w.reg_addr   = 0;
    w.value      = 7.0f;
    w.type       = PointType::Uint16;
    w.byte_order = ByteOrder::AB;
    w.scale      = 1.0f;
    w.request_id = "route";

    EXPECT_FALSE(master.submit_write(w, 0)) << "không nói bus mà địa chỉ trùng trên hai dây ⇒ phải từ chối";
    EXPECT_TRUE(master.submit_write(w, 2));
    EXPECT_EQ(master.bus_by_id(1)->pending_write_count(), 0u) << "lệnh cho dây 2 rơi sang dây 1";
    EXPECT_EQ(master.bus_by_id(2)->pending_write_count(), 1u);

    master.close();
    ::unlink(p1.c_str());
    ::unlink(p2.c_str());
}

/* F06 (EV-PROG-FBD-ST-MB-20260925) — Core NHẢ quyền ghi (`dirty=0` + `ext_cmd_seq`
 * mới) khi Program bị Disable/Stop. Chủ sở hữu chốt 2026-09-26: thiết bị về
 * `safe_value` của điểm; điểm không khai `safe_value` thì GIỮ giá trị cuối. Trên
 * bo, DO kẹt ở 1 suốt 18 phút sau Disable vì trước bản này không có lệnh nào. */
TEST(MbaExtRelease, NhaQuyenGhiThiVeSafeValueHoacGiuNguyen)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("release",
        R"json({"points":[{"name":"do_safe","fc":1,"addr":0,"count":1,"type":"bool","writable":true,"safe_value":0},{"name":"do_hold","fc":1,"addr":1,"count":1,"type":"bool","writable":true}]})json");
    AuditSlave slave;
    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "ck508"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    slave.start(pty.slave_dev, pty.master_fd, 16, 16, 16);

    auto shm = audit_shm();
    shm->ext_count = 2;
    std::strncpy(shm->ext[0].name, "do_safe", sizeof(shm->ext[0].name) - 1);
    std::strncpy(shm->ext[1].name, "do_hold", sizeof(shm->ext[1].name) - 1);
    master.drain_ext_writes(shm.get(), 1000);   /* lượt mốc */

    ExtCache cache;
    FieldbusMetrics metrics;
    /* Program bật cả hai DO. */
    for (int i = 0; i < 2; i++) {
        shm->ext[i].dirty    = 1;
        shm->ext[i].setpoint = 1.0;
        shm->ext_cmd_seq[i]  = 1;
    }
    master.drain_ext_writes(shm.get(), 1100);
    ASSERT_EQ(master.bus(0).pending_write_count(), 2u);
    master.poll_once(1200, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    /* Program bị Disable: Core nhả cả hai slot. */
    for (int i = 0; i < 2; i++) {
        shm->ext[i].dirty   = 0;
        shm->ext_cmd_seq[i] = 2;
    }
    master.drain_ext_writes(shm.get(), 2000);
    EXPECT_EQ(master.bus(0).pending_write_count(), 1u)
        << "chỉ điểm có safe_value được ghi khi nhả; điểm còn lại giữ giá trị cuối";
    master.poll_once(2100, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    /* Cùng một lần nhả đọc lại ở lượt sau KHÔNG được phát thêm. */
    master.drain_ext_writes(shm.get(), 2200);
    EXPECT_EQ(master.bus(0).pending_write_count(), 0u);
    /* Đọc bảng coil của slave TRƯỚC `finish()` — finish giải phóng mapping. */
    const int safe_coil = slave.mapping->tab_bits[0];
    const int hold_coil = slave.mapping->tab_bits[1];
    slave.finish();

    EXPECT_EQ(safe_coil, 0) << "DO có safe_value=0 phải về 0 sau khi nhả";
    EXPECT_EQ(hold_coil, 1) << "DO không khai safe_value phải giữ giá trị cuối";
    master.close();
    ::unlink(profile.c_str());
}

/* F06 — iobus khởi động lại khi slot đang ở trạng thái "đã nhả" từ trước KHÔNG
 * được coi lần nhả cũ là lệnh mới rồi ghi safe_value lên thiết bị đang chạy. */
TEST(MbaExtRelease, KhoiDongLaiKhongPhatLaiLanNhaCu)
{
    AuditPty pty;
    pty.open_pair();
    const std::string profile = audit_profile("release-baseline",
        R"json({"points":[{"name":"do_safe","fc":1,"addr":0,"count":1,"type":"bool","writable":true,"safe_value":0}]})json");
    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(audit_slave(1, profile, "ck508"));
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));

    auto shm = audit_shm();
    shm->ext_count = 1;
    std::strncpy(shm->ext[0].name, "do_safe", sizeof(shm->ext[0].name) - 1);
    shm->ext[0].dirty   = 0;
    shm->ext_cmd_seq[0] = 7;   /* lần nhả xảy ra trước khi iobus khởi động */
    master.drain_ext_writes(shm.get(), 1000);
    master.drain_ext_writes(shm.get(), 1100);
    EXPECT_EQ(master.bus(0).pending_write_count(), 0u)
        << "lần nhả cũ bị phát lại thành lệnh safe_value sau khởi động";
    master.close();
    ::unlink(profile.c_str());
}
#endif
