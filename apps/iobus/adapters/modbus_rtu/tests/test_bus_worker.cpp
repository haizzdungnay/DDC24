/**
 * @file  test_bus_worker.cpp
 * @brief MBR-B101/B102/B103/B107/B109 — TW-MBRTU-01..09.
 *
 * Trọng tâm: những hành vi mà bản một-bus KHÔNG có và không thể có —
 * cách ly giữa hai dây, backoff cổng, gộp block đọc, trần hàng đợi ghi,
 * và quality mang đúng lý do.
 */
#include <atomic>
#include <fcntl.h>
#include <fstream>
#include <thread>
#include <unistd.h>

#include <gtest/gtest.h>

#include "bus_worker.hpp"
#include "ext_cache.hpp"
#include "fieldbus_config.hpp"
#include "fieldbus_metrics.hpp"
#include "modbus_master.hpp"

using namespace iobus::fieldbus;

namespace {

std::string write_profile(const std::string& tag, const std::string& json)
{
    const std::string path =
        "/tmp/mkddc_bw_" + tag + "_" + std::to_string(::getpid()) + ".json";
    std::ofstream f(path);
    f << json;
    return path;
}

SlaveConfig slave_on(uint8_t addr, uint8_t bus_id, const std::string& profile,
                     const std::string& name, uint32_t poll_ms = 1000)
{
    SlaveConfig sl;
    sl.addr    = addr;
    sl.bus_id  = bus_id;
    sl.profile = profile;
    sl.name    = name;
    sl.poll_ms = poll_ms;
    return sl;
}

BusConfig bus_on(uint8_t id, const std::string& device)
{
    BusConfig bus;
    bus.id     = id;
    bus.name   = "RS485-" + std::to_string(id);
    bus.device = device;
    return bus;
}

} // namespace

/* Backoff phải leo thang rồi bão hoà. Thử mở lại một cổng đã chết ở nhịp
 * mili-giây chỉ tạo bão syscall và làm ngập journal, không làm cổng sống lại. */
TEST(BusWorkerLifecycle, PortBackoffClimbsThenSaturates)
{
    EXPECT_EQ(port_backoff_ms(0), 1000u);
    EXPECT_EQ(port_backoff_ms(1), 2000u);
    EXPECT_EQ(port_backoff_ms(2), 5000u);
    EXPECT_EQ(port_backoff_ms(3), 10000u);
    EXPECT_EQ(port_backoff_ms(4), 30000u);
    EXPECT_EQ(port_backoff_ms(9), 30000u);
    EXPECT_EQ(port_backoff_ms(255), 30000u);
}

TEST(BusWorkerLifecycle, StateNamesAreStableStringsForUi)
{
    EXPECT_STREQ(bus_state_name(BusState::CLOSED), "CLOSED");
    EXPECT_STREQ(bus_state_name(BusState::OPENING), "OPENING");
    EXPECT_STREQ(bus_state_name(BusState::RUNNING), "RUNNING");
    EXPECT_STREQ(bus_state_name(BusState::PORT_ERROR), "PORT_ERROR");
    EXPECT_STREQ(bus_state_name(BusState::DRAINING), "DRAINING");
    EXPECT_STREQ(bus_state_name(BusState::SWAPPING), "SWAPPING");
    EXPECT_STREQ(bus_state_name(BusState::CONFIG_ERROR), "CONFIG_ERROR");
}

/* MBR-B101: cấu hình hai bus phải sinh HAI worker với dải ext slot RỜI NHAU.
 * Dải chồng nhau nghĩa là hai thiết bị khác nhau ghi đè giá trị của nhau. */
TEST(BusWorkerBinding, TwoBusesGetDisjointExtSlotRanges)
{
    const std::string prof = write_profile("two_bus",
        R"json({"points":[{"name":"r","fc":3,"addr":0,"count":4,"type":"uint16"}]})json");

    FieldbusConfig cfg;
    cfg.buses.push_back(bus_on(1, "/dev/null"));
    cfg.buses.push_back(bus_on(2, "/dev/null"));
    cfg.slaves.push_back(slave_on(1, 1, prof, "meter1"));
    cfg.slaves.push_back(slave_on(2, 2, prof, "vfd1"));

    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    master.open(cfg, cache, metrics);   /* /dev/null không mở được — không sao */

    ASSERT_EQ(master.bus_count(), 2u);
    EXPECT_EQ(master.bus(0).ext_base(), 0u);
    EXPECT_EQ(master.bus(0).ext_span(), 4u);
    EXPECT_EQ(master.bus(1).ext_base(), 4u);
    EXPECT_EQ(master.bus(1).ext_span(), 4u);
    EXPECT_EQ(master.total_ext_count(), 8u);

    /* Điểm phải mang đúng bus_id để FE nhóm được theo dây. */
    EXPECT_EQ(cache.sample(0).bus_id, 1u);
    EXPECT_EQ(cache.sample(4).bus_id, 2u);

    master.close();
    ::unlink(prof.c_str());
}

/* Slave khai bus_id không tồn tại phải được kéo về bus đầu tiên kèm WARN, chứ
 * không im lặng biến mất khỏi lịch poll. */
TEST(BusWorkerBinding, SlaveOnUnknownBusFallsBackInsteadOfDisappearing)
{
    const std::string prof = write_profile("fallback",
        R"json({"points":[{"name":"r","fc":3,"addr":0,"count":1,"type":"uint16"}]})json");
    FieldbusConfig cfg;
    cfg.buses.push_back(bus_on(1, "/dev/null"));
    cfg.slaves.push_back(slave_on(5, /*bus_id=*/9, prof, "orphan"));

    normalize_buses(&cfg);
    EXPECT_EQ(cfg.slaves[0].bus_id, 1u);
    ::unlink(prof.c_str());
}

/* MBR-B109: hai điểm holding register liền kề phải gộp thành MỘT transaction.
 * Trên RS-485 19200 baud mỗi lượt request/response tốn ~5 ms turnaround; gộp
 * cắt gần một nửa thời gian chiếm dây cho profile dày. */
TEST(BusWorkerBlocks, AdjacentRegistersMergeIntoOneTransaction)
{
    const std::string prof = write_profile("merge",
        R"json({"points":[
            {"name":"a","fc":3,"addr":0,"count":2,"type":"uint16"},
            {"name":"b","fc":3,"addr":2,"count":2,"type":"uint16"}
        ]})json");

    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "m")}, {0}, &cursor, cache);

    ASSERT_EQ(worker.slave_count(), 1u);
    const auto& blocks = worker.slave(0).blocks;
    ASSERT_EQ(blocks.size(), 1u) << "hai dải liền nhau phải gộp thành một khối";
    EXPECT_EQ(blocks[0].addr, 0u);
    EXPECT_EQ(blocks[0].count, 4u);
    EXPECT_EQ(blocks[0].members.size(), 2u);
    EXPECT_EQ(blocks[0].members[1].offset, 2u);
    ::unlink(prof.c_str());
}

/* Ngược lại: có KHOẢNG TRỐNG thì KHÔNG gộp. Register không khai báo có thể
 * không tồn tại trên slave, và đọc trúng nó làm slave trả ILLEGAL_DATA_ADDRESS
 * cho TOÀN khối — đánh hỏng cả những điểm vốn đọc được. */
TEST(BusWorkerBlocks, GapPreventsMergeSoOneBadRegisterCannotPoisonWholeBlock)
{
    const std::string prof = write_profile("gap",
        R"json({"points":[
            {"name":"a","fc":3,"addr":0,"count":1,"type":"uint16"},
            {"name":"b","fc":3,"addr":5,"count":1,"type":"uint16"}
        ]})json");

    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "m")}, {0}, &cursor, cache);
    EXPECT_EQ(worker.slave(0).blocks.size(), 2u);
    ::unlink(prof.c_str());
}

/* Khối gộp không được vượt trần giao thức (125 register). */
TEST(BusWorkerBlocks, MergeStopsAtProtocolLimit)
{
    const std::string prof = write_profile("limit",
        R"json({"points":[
            {"name":"a","fc":3,"addr":0,"count":100,"type":"uint16"},
            {"name":"b","fc":3,"addr":100,"count":100,"type":"uint16"}
        ]})json");

    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "m")}, {0}, &cursor, cache);
    const auto& blocks = worker.slave(0).blocks;
    ASSERT_EQ(blocks.size(), 2u);
    EXPECT_LE(blocks[0].count, 125u);
    EXPECT_LE(blocks[1].count, 125u);
    ::unlink(prof.c_str());
}

/* Điểm khác FC không được gộp chung: FC03 và FC04 là hai không gian địa chỉ
 * khác nhau, gộp lại là đọc nhầm bảng. */
TEST(BusWorkerBlocks, DifferentFunctionCodesNeverMerge)
{
    const std::string prof = write_profile("fc",
        R"json({"points":[
            {"name":"a","fc":3,"addr":0,"count":1,"type":"uint16"},
            {"name":"b","fc":4,"addr":1,"count":1,"type":"uint16"}
        ]})json");

    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "m")}, {0}, &cursor, cache);
    ASSERT_EQ(worker.slave(0).blocks.size(), 2u);
    EXPECT_NE(worker.slave(0).blocks[0].fc, worker.slave(0).blocks[1].fc);
    ::unlink(prof.c_str());
}

/* MBR-B107: hàng đợi ghi có TRẦN. Không giới hạn nghĩa là một node logic lặp
 * có thể đẩy hàng triệu request và làm iobus hết RAM — kéo theo cả IOP. */
TEST(BusWorkerWriteQueue, RejectsBeyondBoundAndReportsRejection)
{
    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    const std::string prof = write_profile("wq",
        R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "vfd")}, {0}, &cursor, cache);

    std::vector<WriteResult> results;
    worker.set_write_result_sink([&](const WriteResult& r) { results.push_back(r); });

    /* Mỗi request nhắm một register khác nhau để không bị coalesce. */
    for (size_t i = 0; i < kMaxPendingWrites; i++) {
        PendingWrite w{};
        w.slave_addr = 1;
        w.fc         = 6;
        w.reg_addr   = static_cast<uint16_t>(i);
        w.value      = 1.0f;
        w.type       = PointType::Uint16;
        w.byte_order = ByteOrder::AB;
        w.scale      = 1.0f;
        w.request_id = "req-" + std::to_string(i);
        EXPECT_TRUE(worker.enqueue_write(w)) << "request thứ " << i;
    }
    EXPECT_EQ(worker.pending_write_count(), kMaxPendingWrites);

    PendingWrite overflow{};
    overflow.slave_addr = 1;
    overflow.fc         = 6;
    overflow.reg_addr   = 9999;
    overflow.type       = PointType::Uint16;
    overflow.byte_order = ByteOrder::AB;
    overflow.scale      = 1.0f;
    overflow.request_id = "req-overflow";
    EXPECT_FALSE(worker.enqueue_write(overflow));
    EXPECT_EQ(worker.pending_write_count(), kMaxPendingWrites);

    /* Bị từ chối phải BÁO ngược về, không được im lặng nuốt lệnh. */
    ASSERT_FALSE(results.empty());
    EXPECT_EQ(results.back().request_id, "req-overflow");
    EXPECT_EQ(results.back().status, "rejected");
    EXPECT_EQ(results.back().reason, "write_queue_full");
    ::unlink(prof.c_str());
}

/* Setpoint mới thay setpoint cũ CHƯA GỬI cho cùng một register: giá trị cũ
 * không còn ai muốn ghi, phát nó ra dây là ghi một lệnh đã bị huỷ. */
TEST(BusWorkerWriteQueue, NewerSetpointSupersedesPendingOneForSameRegister)
{
    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    const std::string prof = write_profile("coalesce",
        R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "vfd")}, {0}, &cursor, cache);

    std::vector<WriteResult> results;
    worker.set_write_result_sink([&](const WriteResult& r) { results.push_back(r); });

    PendingWrite first{};
    first.slave_addr = 1; first.fc = 6; first.reg_addr = 0; first.value = 10.0f;
    first.type = PointType::Uint16; first.byte_order = ByteOrder::AB; first.scale = 1.0f;
    first.request_id = "old";
    ASSERT_TRUE(worker.enqueue_write(first));

    PendingWrite second = first;
    second.value      = 20.0f;
    second.request_id = "new";
    ASSERT_TRUE(worker.enqueue_write(second));

    EXPECT_EQ(worker.pending_write_count(), 1u);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].request_id, "old");
    EXPECT_EQ(results[0].status, "rejected");
    EXPECT_EQ(results[0].reason, "superseded_by_newer_setpoint");
    ::unlink(prof.c_str());
}

/* Slave lỗi cấu hình phải publish CONFIG_ERROR ngay từ lúc bind — trước cả
 * lần I/O đầu tiên. Bản cũ chỉ có BAD, không phân biệt được "cấu hình sai" với
 * "thiết bị trả sai", nên kỹ thuật viên đi kiểm tra đấu dây cho một lỗi khai báo. */
TEST(BusWorkerQuality, MissingProfileMarksConfigErrorBeforeAnyIo)
{
    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"),
                {slave_on(3, 1, "/tmp/mkddc_absent_profile.json", "ghost")}, {0}, &cursor, cache);

    EXPECT_EQ(worker.state(), BusState::CONFIG_ERROR);
    EXPECT_EQ(worker.slave(0).config_error, true);
    EXPECT_EQ(worker.ext_span(), 0u);
}

/* MBR-B102: một bus chết KHÔNG được kéo theo bus còn lại.
 * Đây là bất biến trung tâm của việc tách BusWorker; bản một-bus dùng chung một
 * `modbus_t*` nên một slave chết ở bus 2 giữ dây của bus 1 trọn timeout. */
TEST(BusWorkerIsolation, DeadPortOnOneBusDoesNotStopTheOther)
{
    const std::string prof = write_profile("iso",
        R"json({"points":[{"name":"r","fc":3,"addr":0,"count":1,"type":"uint16"}]})json");

    const int pty_master = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty_master, 0);
    ASSERT_EQ(::grantpt(pty_master), 0);
    ASSERT_EQ(::unlockpt(pty_master), 0);
    const char* pty_slave = ::ptsname(pty_master);
    ASSERT_NE(pty_slave, nullptr);

    FieldbusConfig cfg;
    cfg.buses.push_back(bus_on(1, pty_slave));                    /* mở được */
    cfg.buses.push_back(bus_on(2, "/dev/mkddc-does-not-exist"));   /* chết    */
    cfg.slaves.push_back(slave_on(1, 1, prof, "good"));
    cfg.slaves.push_back(slave_on(2, 2, prof, "dead"));

    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    /* "ít nhất một bus mở được" ⇒ true. Một cổng hỏng không được làm chết cả
     * dịch vụ fieldbus. */
    EXPECT_TRUE(master.open(cfg, cache, metrics));
    ASSERT_EQ(master.bus_count(), 2u);
    EXPECT_TRUE(master.bus(0).port_open());
    EXPECT_FALSE(master.bus(1).port_open());
    EXPECT_EQ(master.bus(1).state(), BusState::PORT_ERROR);

    /* Điểm trên bus chết phải OFFLINE/PORT_DOWN chứ không giữ GOOD cũ. */
    master.poll_once(1, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");
    const uint16_t dead_slot = master.bus(1).ext_base();
    EXPECT_EQ(cache.sample(dead_slot).online, 0u);

    master.close();
    ::close(pty_master);
    ::unlink(prof.c_str());
}

/* MBR-B305 — utilization phải là TỶ LỆ CHIẾM DÂY THẬT.
 *
 * Lỗi phát hiện trên board Foxlinx 2026-08-06: publisher chốt cửa sổ ở nhịp
 * 100 ms trong khi một transaction timeout tốn 300 ms, nên hầu hết cửa sổ có
 * busy = 0 và utilization báo 0 % dù p50 = 300 ms/giao dịch. Con số đó vô dụng
 * đúng vào lúc cần nó nhất: khi dây đang nghẽn vì thiết bị không trả lời.
 */
TEST(BusMetricsUtilization, AccumulatesAcrossPublishTicksInsteadOfResettingEachTime)
{
    FieldbusMetrics metrics;
    metrics.init({"s1"}, {1}, {1});
    BusMetrics bus;
    bus.id = 1;
    metrics.init_buses({bus});

    /* Một giao dịch 300 ms mỗi giây, chốt ở nhịp 100 ms như publisher thật. */
    const uint64_t tick_us = 100000;
    for (int second = 0; second < 40; second++) {
        metrics.record_bus_transaction(1, 300000, false);
        for (int tick = 0; tick < 10; tick++) metrics.roll_bus_window(1, tick_us);
    }

    /* 300 ms bận trên mỗi 1000 ms ⇒ ~30 %. Bản lỗi trả 0. */
    const uint16_t pct_x100 = metrics.bus(0).utilization_pct_x100;
    EXPECT_GT(pct_x100, 2000u) << "utilization báo quá thấp: " << pct_x100;
    EXPECT_LT(pct_x100, 4000u) << "utilization báo quá cao: " << pct_x100;
}

/* Ô chưa đủ dài thì GIỮ giá trị cũ, không chốt một số nửa vời. */
TEST(BusMetricsUtilization, KeepsPreviousValueUntilWindowIsLongEnough)
{
    FieldbusMetrics metrics;
    metrics.init({"s1"}, {1}, {1});
    BusMetrics bus;
    bus.id = 1;
    metrics.init_buses({bus});

    metrics.record_bus_transaction(1, 300000, true);
    metrics.roll_bus_window(1, 100000);   /* mới 0,1 s — chưa đủ 2 s */
    EXPECT_EQ(metrics.bus(0).utilization_pct_x100, 0u);

    /* Đủ cửa sổ ⇒ mới chốt. */
    for (int i = 0; i < 20; i++) metrics.roll_bus_window(1, 100000);
    EXPECT_GT(metrics.bus(0).utilization_pct_x100, 0u);
}

/* p50/p95 lấy từ mẫu CÓ THẬT (nearest rank), không nội suy ra một số không tồn
 * tại trong tập đo. */
TEST(BusMetricsUtilization, LatencyPercentilesComeFromObservedSamples)
{
    FieldbusMetrics metrics;
    metrics.init({"s1"}, {1}, {1});
    BusMetrics bus;
    bus.id = 1;
    metrics.init_buses({bus});

    for (int i = 1; i <= 10; i++)
        metrics.record_bus_transaction(1, static_cast<uint32_t>(i * 1000), true);
    metrics.roll_bus_window(1, 2000000);

    EXPECT_EQ(metrics.bus(0).latency_p50_us, 6000u);
    EXPECT_EQ(metrics.bus(0).latency_p95_us, 10000u);
    EXPECT_EQ(metrics.bus(0).latency_max_us, 10000u);
}

/* Lỗi gốc phát hiện trên board: slave OFFLINE chỉ được probe mỗi 5 s, dài hơn
 * một ô đo 2 s, nên cửa sổ đơn cho ra 0 % ở hầu hết thời điểm người dùng nhìn
 * màn hình. Trung bình trượt phải cho ra duty cycle ỔN ĐỊNH, khác 0. */
TEST(BusMetricsUtilization, SurvivesProbeIntervalLongerThanOneSlot)
{
    FieldbusMetrics metrics;
    metrics.init({"s1"}, {1}, {1});
    BusMetrics bus;
    bus.id = 1;
    metrics.init_buses({bus});

    /* 600 ms bận mỗi 5 s (hai lần phát × timeout 300 ms ở nhịp probe). */
    for (int cycle = 0; cycle < 30; cycle++) {
        metrics.record_bus_transaction(1, 600000, false);
        for (int tick = 0; tick < 50; tick++) metrics.roll_bus_window(1, 100000);
    }
    const uint16_t pct_x100 = metrics.bus(0).utilization_pct_x100;
    EXPECT_GT(pct_x100, 500u) << "utilization rơi về gần 0 dù dây bận 12%: " << pct_x100;
    EXPECT_LT(pct_x100, 2500u) << "utilization báo quá cao: " << pct_x100;
}
