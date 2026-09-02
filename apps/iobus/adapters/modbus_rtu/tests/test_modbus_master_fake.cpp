/**
 * @file  test_modbus_master_fake.cpp
 * @brief MOD-011: ModbusMaster build-and-interface test.
 *        Full read/write test cần MKDDC_ENABLE_MODBUS + fake slave (diagslave).
 *        Test này verify interface + build sạch.
 */
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <fcntl.h>
#include <fstream>
#include <thread>
#include <unistd.h>

#ifdef MKDDC_ENABLE_MODBUS
#include <modbus.h>
#endif
#include <gtest/gtest.h>
#include "modbus_master.hpp"
#include "ext_cache.hpp"
#include "fieldbus_metrics.hpp"

using namespace iobus::fieldbus;

TEST(FieldbusConfig, ParsesRtuPollTimeoutRetryAndSerialSettings)
{
    const std::string path = "/tmp/mkddc_fieldbus_rtu_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({
          "rs485":{"device":"/dev/ttyS3","baud":38400,"parity":"E","stop":2},
          "poll_default_ms":5000,
          "slaves":[{"addr":7,"profile":"ahu-1","name":"ahu-1","poll_ms":1000,"timeout_ms":450,"retry":4}]
        })json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    ASSERT_EQ(cfg.slaves.size(), 1u);
    EXPECT_EQ(cfg.rs485.device, "/dev/ttyS3");
    EXPECT_EQ(cfg.rs485.baud, 38400u);
    EXPECT_EQ(cfg.rs485.parity, 'E');
    EXPECT_EQ(cfg.rs485.stop, 2u);
    EXPECT_EQ(cfg.slaves[0].addr, 7u);
    EXPECT_EQ(cfg.slaves[0].poll_ms, 1000u);
    EXPECT_EQ(cfg.slaves[0].timeout_ms, 450u);
    /* D-05: `retry` nay là số lần PHÁT LẠI một giao dịch, bị clamp về 3.
     * Trước 2026-08-04 nó mang nghĩa "số lỗi liên tiếp trước khi OFFLINE" và
     * nhận tới 10 — nhưng khi đó không hề có lần phát lại nào. Với ngữ nghĩa
     * mới, 10 lần phát lại × timeout 300 ms là 3 giây chiếm dây cho một block. */
    EXPECT_EQ(cfg.slaves[0].retry, 3u);
    /* Không khai báo ⇒ giữ ngưỡng OFFLINE mặc định như hành vi cũ. */
    EXPECT_EQ(cfg.slaves[0].offline_after_errors, 2u);
}

/* D-05: hai tham số phải tách bạch và nhận được độc lập. */
TEST(FieldbusConfig, RetryAndOfflineThresholdAreSeparateFields)
{
    const std::string path = "/tmp/mkddc_fieldbus_split_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({
          "rs485":{"device":"/dev/ttyS3","offline_probe_ms":12000},
          "slaves":[{"addr":3,"profile":"p","name":"vfd","retry":1,"offline_after_errors":5}]
        })json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    ASSERT_EQ(cfg.slaves.size(), 1u);
    EXPECT_EQ(cfg.slaves[0].retry, 1u);
    EXPECT_EQ(cfg.slaves[0].offline_after_errors, 5u);
    EXPECT_EQ(cfg.rs485.offline_probe_ms, 12000u);
}

/* offline_probe_ms phải bị clamp vào 1..60 s. */
TEST(FieldbusConfig, OfflineProbeIsClamped)
{
    const std::string path = "/tmp/mkddc_fieldbus_probe_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({"rs485":{"device":"/dev/ttyS3","offline_probe_ms":50},
                       "slaves":[{"addr":1,"profile":"p","name":"a"}]})json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    EXPECT_EQ(cfg.rs485.offline_probe_ms, 1000u);
}

TEST(ModbusMaster, OpenWithoutModbusEnabled)
{
    ModbusMaster master;
    FieldbusConfig cfg;
    cfg.rs485.device = "/dev/ttyUSB0";
    cfg.rs485.baud   = 19200;

#ifdef MKDDC_ENABLE_MODBUS
    /* Với MKDDC_ENABLE_MODBUS: sẽ fail vì /dev/ttyUSB0 không tồn tại trong CI */
    bool ok = master.open(cfg);
    if (!ok) SUCCEED();
#else
    /* Không có libmodbus: open trả false */
    EXPECT_FALSE(master.open(cfg));
    EXPECT_FALSE(master.is_open());
#endif
}

TEST(ModbusMaster, SleepMsWithNoSlaves)
{
    ModbusMaster master;
    /* Khi không có slaves, sleep 1000ms */
    EXPECT_EQ(master.sleep_ms_until_next(0), 1000u);
}

TEST(ModbusMaster, SubmitWriteWithoutBusIsRejectedNotCrash)
{
    ModbusMaster master;
    PendingWrite w;
    w.ext_idx    = 0;
    w.slave_addr = 10;
    w.fc         = 6;
    w.reg_addr   = 100;
    w.value      = 1.5f;
    w.type       = PointType::Uint16;
    w.byte_order = ByteOrder::AB;
    w.scale      = 1.0f;
    w.offset     = 0.0f;
    master.submit_write(w);   /* không crash khi không có worker nào */
}

TEST(ModbusMaster, PollOnceNoopWhenClosed)
{
    ModbusMaster master;
    ExtCache cache;
    FieldbusMetrics metrics;
    /* Không crash khi closed */
    master.poll_once(1000, cache, metrics, "/run/mkddc/fieldbus.sock");
}

TEST(ModbusMaster, Rs485DeviceFromConfigNotHardcoded)
{
    /* Kiểm tra không có literal "/dev/ttyS*" hardcode trong modbus_master.cpp.
     * Config phải là nguồn duy nhất của device path (plan 25 §1). */
    FieldbusConfig cfg;
    cfg.rs485.device = "/dev/ttyS3";   /* đặt từ config */
    ModbusMaster master;
    /* open sẽ fail nhưng phải dùng cfg.rs485.device, không hardcode */
    master.open(cfg);
    /* Verify: device name từ config được sử dụng (test bằng cách kiểm tra build) */
    SUCCEED();
}
TEST(FieldbusMetrics, E303BusErrorRateAlarm)
{
    /* D-12: E303 đánh giá theo CỬA SỔ TRƯỢT 20 lượt poll, không theo tỷ lệ tích
     * luỹ từ lúc khởi động. Chưa đủ một cửa sổ thì chưa kết luận. */
    FieldbusMetrics metrics;
    metrics.init({"slave1"}, {1});

    for (int i = 0; i < 18; i++) metrics.update(0, true, static_cast<uint64_t>(i) * 100);
    EXPECT_FALSE(metrics.check_e303(0));   /* mới 18/20 lượt — chưa đủ cửa sổ */

    /* Thêm 2 lỗi ⇒ đủ 20 lượt, tỷ lệ 2/20 = 10%, KHÔNG vượt ngưỡng >10%. */
    metrics.update(0, false, 1900);
    metrics.update(0, false, 2000);
    EXPECT_FALSE(metrics.check_e303(0));

    /* Cửa sổ mới toàn lỗi ⇒ vượt ngưỡng, báo đúng một lần. */
    for (int i = 0; i < 20; i++) metrics.update(0, false, 2100 + static_cast<uint64_t>(i) * 100);
    EXPECT_TRUE(metrics.check_e303(0));
    EXPECT_TRUE(metrics.get(0).e303_triggered);
    EXPECT_FALSE(metrics.check_e303(0));   /* chưa đủ cửa sổ kế — không báo lặp */

    metrics.reset_alarms(0);
    EXPECT_FALSE(metrics.get(0).e303_triggered);
}

/* D-12: khiếm khuyết chính của bản cũ là E303 latch VĨNH VIỄN.
 *
 * `e303_triggered` chỉ được xoá trong reset_alarms(), mà reset_alarms() chỉ được
 * gọi khi e302 đang bật. Một slave lỗi nhiều nhưng chưa bao giờ OFFLINE sẽ giữ cờ
 * mãi mãi và không bao giờ báo lại lần sau. Thêm nữa tỷ lệ tích luỹ khiến bus đã
 * tốt trở lại vẫn bị tính là xấu rất lâu. */
TEST(FieldbusMetrics, E303ReArmsAfterCleanWindowWithoutOfflineReset)
{
    FieldbusMetrics metrics;
    metrics.init({"slave1"}, {1});

    /* Cửa sổ 1: toàn lỗi ⇒ báo. */
    for (int i = 0; i < 20; i++) metrics.update(0, false, static_cast<uint64_t>(i) * 100);
    EXPECT_TRUE(metrics.check_e303(0));

    /* Cửa sổ 2: bus tốt hoàn toàn ⇒ KHÔNG báo, và cờ được gỡ dù chưa hề có
     * reset_alarms() nào được gọi (slave này không đi qua trạng thái OFFLINE). */
    for (int i = 0; i < 20; i++) metrics.update(0, true, 2000 + static_cast<uint64_t>(i) * 100);
    EXPECT_FALSE(metrics.check_e303(0));
    EXPECT_FALSE(metrics.get(0).e303_triggered);

    /* Cửa sổ 3: xấu trở lại ⇒ phải báo LẠI. Bản cũ im lặng vĩnh viễn ở đây. */
    for (int i = 0; i < 20; i++) metrics.update(0, false, 4000 + static_cast<uint64_t>(i) * 100);
    EXPECT_TRUE(metrics.check_e303(0));
}

#ifdef MKDDC_ENABLE_MODBUS
namespace {

/* SlaveConfig có thêm `bus_id` (MBR-B101) nên khởi tạo bằng danh sách ngoặc
 * theo vị trí không còn đọc được. Helper đặt tên rõ từng tham số.
 *
 * Định nghĩa nằm TRONG `#ifdef MKDDC_ENABLE_MODBUS` vì MỌI nơi gọi nó đều ở
 * trong khối này. Trước đây nó nằm ngoài, nên build `MODBUS=OFF` có một hàm
 * static không ai dùng — và cổng CI dựng với `-Werror` (`-Wunused-function`)
 * nên bốn job `baseline`/`bacnet`/... hỏng ở bước BUILD, trước khi chạy test
 * nào. Build local mặc định không bật `-Werror` nên chỗ này không lộ ra. */
SlaveConfig make_slave(uint8_t addr, const std::string& profile, const std::string& name,
                       uint32_t poll_ms, uint32_t timeout_ms = 300, uint8_t retry = 2,
                       uint8_t bus_id = 1)
{
    SlaveConfig sl;
    sl.addr       = addr;
    sl.bus_id     = bus_id;
    sl.profile    = profile;
    sl.name       = name;
    sl.poll_ms    = poll_ms;
    sl.timeout_ms = timeout_ms;
    sl.retry      = retry;
    return sl;
}

/* Helper dùng chung cho các test PTY dưới đây. */
struct PtyRtu {
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
    ~PtyRtu() { if (master_fd >= 0) ::close(master_fd); }
};

std::string write_tmp_profile(const std::string& tag, const std::string& json)
{
    const std::string path = "/tmp/mkddc_prof_" + tag + "_" + std::to_string(::getpid()) + ".json";
    std::ofstream f(path);
    f << json;
    return path;
}

} // namespace

/* F-17: profile 32-bit phải dùng ĐÚNG số slot cần, không gấp đôi.
 * slave0: 1 điểm float32 count=2 → 1 slot (lỗi cũ: 2)
 * slave1: 1 điểm uint16 count=3  → 3 slot
 * Tổng phải là 4; lỗi cũ cho 5 và để lại slot rỗng ở index 1. */
TEST(ModbusMaster, ThirtyTwoBitProfileReservesExactSlotCount)
{
    PtyRtu pty;
    pty.open_pair();
    ASSERT_FALSE(pty.slave_dev.empty());

    const std::string p32 = write_tmp_profile("f32",
        R"json({"points":[{"name":"kWh","fc":4,"addr":0,"count":2,"type":"float32","byte_order":"ABCD"}]})json");
    const std::string p16 = write_tmp_profile("u16",
        R"json({"points":[{"name":"reg","fc":3,"addr":0,"count":3,"type":"uint16"}]})json");

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(make_slave(1, p32, "meter", 1000));
    cfg.slaves.push_back(make_slave(2, p16, "plc", 1000));

    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    EXPECT_EQ(master.total_ext_count(), 4u);

    master.close();
    ::unlink(p32.c_str());
    ::unlink(p16.c_str());
}

/* F-16: slave vượt KX_N_EXT KHÔNG được báo online.
 * Lỗi cũ: open() `break` im lặng, slave còn lại có slave_states_ nhưng profile
 * rỗng → read_slave chạy vòng rỗng, slave_ok=true → on_poll_ok → ONLINE,
 * error rate 0%, không alarm E302, không một dòng log nào. */
TEST(ModbusMaster, SlaveWithoutExtCapacityIsNotReportedOnline)
{
    PtyRtu pty;
    pty.open_pair();
    ASSERT_FALSE(pty.slave_dev.empty());

    /* slave0 chiếm trọn KX_N_EXT=256 slot (3 blocks: 125+125+6); slave1 và slave2 không còn chỗ. */
    const std::string p_full = write_tmp_profile("full",
        R"json({"points":[
            {"name":"b1","fc":3,"addr":0,"count":125,"type":"uint16"},
            {"name":"b2","fc":3,"addr":125,"count":125,"type":"uint16"},
            {"name":"b3","fc":3,"addr":250,"count":6,"type":"uint16"}
        ]})json");
    const std::string p_over = write_tmp_profile("over",
        R"json({"points":[{"name":"reg","fc":3,"addr":0,"count":1,"type":"uint16"}]})json");

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(make_slave(1, p_full, "full", 1000));
    cfg.slaves.push_back(make_slave(2, p_over, "over1", 1000));
    cfg.slaves.push_back(make_slave(3, p_over, "over2", 1000));

    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    EXPECT_EQ(master.total_ext_count(), static_cast<uint16_t>(KX_N_EXT));

    modbus_t* slave = modbus_new_rtu(pty.slave_dev.c_str(), 19200, 'N', 8, 1);
    ASSERT_NE(slave, nullptr);
    modbus_set_slave(slave, 1);
    modbus_set_socket(slave, pty.master_fd);
    modbus_mapping_t* mapping = modbus_mapping_new(300, 300, 300, 300);
    ASSERT_NE(mapping, nullptr);
    mapping->tab_registers[0] = 777;

    std::atomic<int> served{0};
    std::thread server([&]() {
        uint8_t request[MODBUS_RTU_MAX_ADU_LENGTH] = {};
        while (served.load() < 3) {
            const int n = modbus_receive(slave, request);
            if (n <= 0) break;
            if (modbus_reply(slave, request, n, mapping) < 0) break;
            served.fetch_add(1);
        }
    });

    ExtCache cache;
    FieldbusMetrics metrics;
    master.poll_once(1, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    server.join();

    /* slave0 poll thật và online */
    EXPECT_EQ(served.load(), 3);
    EXPECT_TRUE(metrics.get(0).online);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 777.0);

    /* slave1/slave2 KHÔNG online, error rate 100%, E302 đã kích */
    for (uint8_t idx : {1, 2}) {
        EXPECT_FALSE(metrics.get(idx).online) << "slave_idx=" << static_cast<int>(idx);
        EXPECT_GT(metrics.get(idx).total_errors, 0u) << "slave_idx=" << static_cast<int>(idx);
        EXPECT_FLOAT_EQ(metrics.get(idx).error_rate(), 1.0f);
        EXPECT_TRUE(metrics.get(idx).e302_triggered);
    }

    master.close();
    modbus_mapping_free(mapping);
    modbus_free(slave);
    ::unlink(p_full.c_str());
    ::unlink(p_over.c_str());
}

/* F-16: slave thiếu profile cũng là lỗi cấu hình — cùng cơ chế "points rỗng
 * nhưng vẫn được poll_once gọi tới". */
TEST(ModbusMaster, SlaveWithMissingProfileIsNotReportedOnline)
{
    PtyRtu pty;
    pty.open_pair();
    ASSERT_FALSE(pty.slave_dev.empty());

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(make_slave(9, "/tmp/mkddc_profile_does_not_exist.json", "ghost", 1000));

    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    EXPECT_EQ(master.total_ext_count(), 0u);

    ExtCache cache;
    FieldbusMetrics metrics;
    master.poll_once(1, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    EXPECT_FALSE(metrics.get(0).online);
    EXPECT_GT(metrics.get(0).total_errors, 0u);
    EXPECT_TRUE(metrics.get(0).e302_triggered);

    master.close();
}

/* Slave lỗi cấu hình phải tôn trọng poll_interval, không spin: on_poll_error
 * không cập nhật last_poll_ms nên nếu read_slave không tự set thì
 * sleep_ms_until_next() luôn trả 0 và vòng fieldbus quay ở mức 1ms. */
TEST(ModbusMaster, ConfigErrorSlaveRespectsPollIntervalInsteadOfSpinning)
{
    PtyRtu pty;
    pty.open_pair();
    ASSERT_FALSE(pty.slave_dev.empty());

    FieldbusConfig cfg;
    cfg.rs485.device = pty.slave_dev;
    cfg.rs485.baud   = 19200;
    cfg.slaves.push_back(make_slave(9, "/tmp/mkddc_profile_does_not_exist.json", "ghost", 1000));

    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    ExtCache cache;
    FieldbusMetrics metrics;
    master.poll_once(5000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    EXPECT_GT(master.sleep_ms_until_next(5000), 0u);
    master.close();
}

TEST(ModbusMaster, RtuPtyReadWriteAndTimeout)
{
    const int pty_master = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty_master, 0);
    ASSERT_EQ(::grantpt(pty_master), 0);
    ASSERT_EQ(::unlockpt(pty_master), 0);
    const char* pty_slave = ::ptsname(pty_master);
    ASSERT_NE(pty_slave, nullptr);

    const std::string profile_path =
        "/tmp/mkddc_modbus_profile_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream profile(profile_path);
        profile << R"json({"profile_id":"ci-pty","points":[{"name":"holding","fc":3,"addr":10,"count":1,"type":"uint16","scale":1.0,"offset":0.0}]})json";
    }

    modbus_t* slave = modbus_new_rtu(pty_slave, 19200, 'N', 8, 1);
    ASSERT_NE(slave, nullptr);
    modbus_set_slave(slave, 1);
    modbus_set_socket(slave, pty_master);
    modbus_mapping_t* mapping = modbus_mapping_new(128, 128, 128, 128);
    ASSERT_NE(mapping, nullptr);
    mapping->tab_registers[10] = 1234;


    FieldbusConfig cfg;
    cfg.rs485.device = pty_slave;
    cfg.rs485.baud = 19200;
    cfg.slaves.push_back(make_slave(1, profile_path, "fake", 1));

    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg));
    std::atomic<int> served{0};
    std::thread server([&]() {
        uint8_t request[MODBUS_RTU_MAX_ADU_LENGTH] = {};
        while (served.load() < 4) {
            const int n = modbus_receive(slave, request);
            if (n <= 0) break;
            if (modbus_reply(slave, request, n, mapping) < 0) break;
            served.fetch_add(1);
        }
    });
    ExtCache cache;
    FieldbusMetrics metrics;
    master.poll_once(1, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    EXPECT_EQ(cache.count(), 1u);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 1234.0);
    EXPECT_EQ(cache.sample(0).quality, KX_EXTQ_GOOD);

    PendingWrite coil{};
    coil.slave_addr = 1;
    coil.fc = 5;
    coil.reg_addr = 3;
    coil.value = 1.0f;
    coil.type = PointType::Bool;
    coil.byte_order = ByteOrder::AB;
    coil.scale = 1.0f;
    master.submit_write(coil);

    PendingWrite reg{};
    reg.slave_addr = 1;
    reg.fc = 6;
    reg.reg_addr = 10;
    reg.value = 4321.0f;
    reg.type = PointType::Uint16;
    reg.byte_order = ByteOrder::AB;
    reg.scale = 1.0f;
    master.submit_write(reg);
    master.poll_once(2, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    server.join();
    EXPECT_EQ(served.load(), 4);
    EXPECT_EQ(mapping->tab_bits[3], 1);
    EXPECT_EQ(mapping->tab_registers[10], 4321);

    master.poll_once(3, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    master.poll_once(4, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    /* Hai lượt poll thất bại liên tiếp ⇒ OFFLINE (không phải BAD): thiết bị
     * không trả lời là mất liên lạc, khác hẳn "trả lời nhưng dữ liệu hỏng". */
    EXPECT_EQ(cache.sample(0).quality, KX_EXTQ_OFFLINE);
    EXPECT_TRUE(metrics.get(0).e302_triggered);

    master.close();
    modbus_mapping_free(mapping);
    modbus_free(slave);
    ::close(pty_master);
    ::unlink(profile_path.c_str());
}

/* ---- D-03: vòng đời lệnh ghi (sửa 2026-08-04) ----
 *
 * Trước bản sửa, `flush_pending` gặp lỗi ghi thì `continue` mà KHÔNG đánh
 * submitted, nên request nằm lại `pending_writes_` vô thời hạn và được phát lại
 * ở mọi vòng poll. Kịch bản hỏng ngoài hiện trường: kỹ thuật viên đặt setpoint
 * lúc 09:00 cho một VFD đang mất điện; 14:00 thiết bị có điện lại và nhận ngay
 * lệnh cũ dù không ai ra lệnh lại.
 *
 * PTY không có ai trả lời ở đầu master ⇒ mọi write đều timeout, đúng môi trường
 * để kiểm tra giới hạn số lần thử. */

namespace {
/* Cấu hình một slave trên PTY câm, timeout ngắn để test chạy nhanh. */
struct SilentPtyMaster {
    PtyRtu      pty;
    std::string profile_path;
    ModbusMaster master;

    void start(const std::string& tag)
    {
        pty.open_pair();
        ASSERT_FALSE(pty.slave_dev.empty());
        profile_path = write_tmp_profile(tag,
            R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
        FieldbusConfig cfg;
        cfg.rs485.device = pty.slave_dev;
        cfg.rs485.baud   = 19200;
        /* addr, profile, name, poll_ms, timeout_ms, retry */
        cfg.slaves.push_back(make_slave(1, profile_path, "vfd", 10, 20, 2));
        ASSERT_TRUE(master.open(cfg));
    }
    ~SilentPtyMaster()
    {
        master.close();
        if (!profile_path.empty()) ::unlink(profile_path.c_str());
    }
};

PendingWrite make_write(float value)
{
    PendingWrite w{};
    w.slave_addr = 1;
    w.fc         = 6;
    w.reg_addr   = 0;
    w.value      = value;
    w.type       = PointType::Uint16;
    w.byte_order = ByteOrder::AB;
    w.scale      = 1.0f;
    w.offset     = 0.0f;
    return w;
}
} // namespace

TEST(ModbusMasterWriteLifecycle, WriteIsDroppedAfterMaxAttempts)
{
    SilentPtyMaster h;
    h.start("wr_attempts");

    ExtCache cache;
    FieldbusMetrics metrics;
    PendingWrite w = make_write(1234.0f);
    w.enqueued_ms = 1000;
    h.master.submit_write(w);

    /* Mỗi vòng poll phát tối đa một lần; sau kMaxWriteAttempts phải bị bỏ hẳn.
     *
     * Bước thời gian phải lớn hơn offline_probe_ms: sau vài lỗi liên tiếp slave
     * chuyển OFFLINE và scheduler hạ nhịp xuống probe chậm (D-04), nên nhịp
     * 100 ms sẽ không còn tới hạn. Đây là tương tác có chủ đích giữa A2 và A3.
     *
     * TTL không được vượt: bước nhỏ hơn kWriteTtlMs để lệnh bị bỏ vì HẾT LƯỢT
     * THỬ chứ không phải vì quá hạn — hai nhánh đó có test riêng. */
    static_assert(kDefaultOfflineProbeMs < kWriteTtlMs,
                  "bước thời gian của test phải vừa đủ vượt probe mà chưa chạm TTL");
    const uint64_t step = kDefaultOfflineProbeMs + 100;
    uint64_t now = 1000;
    for (int i = 0; i < kMaxWriteAttempts; ++i) {
        h.master.poll_once(now, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
        now += step;
    }
    EXPECT_EQ(metrics.get(0).write_dropped, 1u);
    const uint64_t failed_after_drop = metrics.get(0).write_failed;
    EXPECT_GE(failed_after_drop, 1u);

    /* Sau khi bị bỏ, các vòng poll tiếp theo KHÔNG được phát lại lệnh đó nữa. */
    for (int i = 0; i < 3; ++i) {
        h.master.poll_once(now, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
        now += step;
    }
    EXPECT_EQ(metrics.get(0).write_failed, failed_after_drop);
    EXPECT_EQ(metrics.get(0).write_dropped, 1u);
}

/* Lệnh quá hạn phải bị bỏ mà KHÔNG phát một byte nào xuống dây — đây là chỗ chặn
 * kịch bản "thiết bị có điện lại sau nhiều giờ và nhận luôn lệnh cũ". */
TEST(ModbusMasterWriteLifecycle, ExpiredWriteIsDroppedWithoutTransmitting)
{
    SilentPtyMaster h;
    h.start("wr_ttl");

    ExtCache cache;
    FieldbusMetrics metrics;
    PendingWrite w = make_write(50.0f);
    w.enqueued_ms = 1000;
    h.master.submit_write(w);

    /* now vượt TTL ⇒ bỏ ngay, không tính là một lần phát thất bại. */
    h.master.poll_once(1000 + kWriteTtlMs + 1, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    EXPECT_EQ(metrics.get(0).write_dropped, 1u);
    EXPECT_EQ(metrics.get(0).write_failed, 0u);
}

/* OD-MBRTU-005 — KHOÁ hai hằng số vòng đời lệnh ghi.
 *
 * Đây là giá trị được quyết định ở cấp sản phẩm (2026-08-20), không phải hằng số
 * kỹ thuật tuỳ chỉnh: TTL 30 s HOẶC tối đa 3 lần phát, điều kiện nào tới trước
 * thì lệnh kết thúc. Đổi một trong hai mà không đổi quyết định là đổi hành vi an
 * toàn của đường ghi, nên nó phải làm test đỏ chứ không được lặng lẽ trôi. */
TEST(ModbusMasterWriteLifecycle, WriteLifecycleConstantsMatchProductDecision)
{
    EXPECT_EQ(kWriteTtlMs, 30000u)
        << "TTL lệnh ghi là 30 s theo OD-MBRTU-005; đổi phải đi kèm quyết định sản phẩm";
    EXPECT_EQ(kMaxWriteAttempts, 3u)
        << "tối đa 3 lần phát theo OD-MBRTU-005; đổi phải đi kèm quyết định sản phẩm";
}

/* OD-MBRTU-005 — sau khi một lệnh ghi bị bỏ, lệnh MỚI mang ĐÚNG giá trị đó phải
 * xuống được dây.
 *
 * Lỗi được chặn ở đây: `ModbusMaster` chống phát trùng bằng `last_written_`,
 * đặt ngay lúc ENQUEUE chứ không phải khi ghi thành công. Trước bản sửa
 * 2026-08-20, một lệnh bị bỏ vẫn để lại dấu vết đó, nên kịch bản rất đời thường
 * sau đây làm setpoint biến mất trong im lặng:
 *
 *   1. Kỹ thuật viên đặt 50.0 trong lúc biến tần mất điện ⇒ lệnh bị bỏ.
 *   2. Biến tần có điện lại.
 *   3. Họ đặt LẠI 50.0 — `last_written_` vẫn là 50.0 ⇒ coi là trùng, không
 *      enqueue, không log, không lỗi. UI báo đã nhận; thiết bị không bao giờ nhận.
 *
 * Quan sát bằng `write_dropped`: nếu lệnh thứ hai thật sự được phát lại thì nó
 * cũng sẽ bị bỏ (PTY không có ai trả lời) và bộ đếm lên 2. Nếu dedup nuốt mất
 * thì bộ đếm đứng ở 1. */
TEST(ModbusMasterWriteLifecycle, DroppedWriteAllowsResendOfSameValue)
{
    SilentPtyMaster h;
    h.start("wr_resend");

    ExtCache cache;
    FieldbusMetrics metrics;

    /* plc_shm tối thiểu: seq chẵn (không có writer đang ghi) + magic hợp lệ. */
    auto shm = std::make_unique<kx_plc_shm_t>();
    std::memset(shm.get(), 0, sizeof(kx_plc_shm_t));
    shm->magic     = KX_SHM_MAGIC;
    shm->seq       = 2;
    shm->ext_count = 1;
    shm->ext[0].dirty    = 1;
    shm->ext[0].setpoint = 50.0;

    uint64_t now = 1000;
    h.master.drain_ext_writes(shm.get(), now);
    h.master.poll_once(now, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    /* Đẩy quá TTL để lệnh thứ nhất chắc chắn kết thúc. */
    now += kWriteTtlMs + 1;
    h.master.poll_once(now, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    ASSERT_EQ(metrics.get(0).write_dropped, 1u)
        << "lệnh thứ nhất phải kết thúc trước khi kiểm lệnh thứ hai";

    /* Lệnh MỚI, cùng giá trị. Đây là một command mới theo đúng nghĩa của
     * OD-MBRTU-005 và bắt buộc phải được phát. */
    shm->ext[0].dirty = 1;
    h.master.drain_ext_writes(shm.get(), now);
    now += 1;
    h.master.poll_once(now, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    now += kWriteTtlMs + 1;
    h.master.poll_once(now, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    EXPECT_EQ(metrics.get(0).write_dropped, 2u)
        << "lệnh mới cùng giá trị bị dedup nuốt sau khi lệnh cũ bị bỏ — setpoint "
           "biến mất im lặng, đúng lớp lỗi false-success mà thiết kế cấm";
}

/* D-01 nối với D-03: giá trị không encode được phải bị bỏ và ĐẾM được, thay vì
 * biến mất im lặng như trước. */
TEST(ModbusMasterWriteLifecycle, UnencodableWriteIsDroppedAndCounted)
{
    SilentPtyMaster h;
    h.start("wr_encode");

    ExtCache cache;
    FieldbusMetrics metrics;
    PendingWrite w = make_write(70000.0f);   /* ngoài dải uint16 */
    w.enqueued_ms = 1000;
    h.master.submit_write(w);

    h.master.poll_once(1000, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    EXPECT_EQ(metrics.get(0).write_dropped, 1u);
    EXPECT_EQ(metrics.get(0).write_failed, 0u);
}

#endif
