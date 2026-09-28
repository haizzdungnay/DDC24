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
#include <stdlib.h>
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

/* `ISS-PIO-22` — hai điểm liền kề nhưng KHÁC nhóm poll KHÔNG được gộp.
 *
 * Gộp chúng sẽ làm điểm `slow` được đọc theo nhịp của điểm `normal`, và cả tính
 * năng mất tác dụng đúng ở chỗ nó cần nhất: một điểm cấu hình vẫn đi cùng mọi
 * lượt poll của tần số VFD, đúng triệu chứng mà issue mô tả. */
TEST(BusWorkerBlocks, PointsInDifferentPollGroupsNeverShareABlock)
{
    const std::string prof = write_profile("pollgroup",
        R"json({"points":[
            {"name":"vfd_hz","fc":3,"addr":0,"count":2,"type":"uint16","poll_group":"normal"},
            {"name":"config","fc":3,"addr":2,"count":2,"type":"uint16","poll_group":"slow"}
        ]})json");

    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "m")}, {0}, &cursor, cache);

    ASSERT_EQ(worker.slave_count(), 1u);
    const auto& blocks = worker.slave(0).blocks;
    ASSERT_EQ(blocks.size(), 2u) << "hai nhóm poll phải nằm ở hai khối riêng";
    // Sắp theo (poll_group, fc, addr) nên `normal` (=1) đứng trước `slow` (=2).
    EXPECT_EQ(blocks[0].poll_group, PollGroup::Normal);
    EXPECT_EQ(blocks[1].poll_group, PollGroup::Slow);
    EXPECT_EQ(blocks[0].members.size(), 1u);
    EXPECT_EQ(blocks[1].members.size(), 1u);
    ::unlink(prof.c_str());
}

/* Cùng nhóm poll thì vẫn gộp như cũ: `ISS-PIO-22` không được làm hỏng phép gộp
 * MBR-B109 đang tiết kiệm turnaround trên dây. */
TEST(BusWorkerBlocks, SamePollGroupStillMerges)
{
    const std::string prof = write_profile("pollgroup_same",
        R"json({"points":[
            {"name":"a","fc":3,"addr":0,"count":2,"type":"uint16","poll_group":"slow"},
            {"name":"b","fc":3,"addr":2,"count":2,"type":"uint16","poll_group":"slow"}
        ]})json");

    BusWorker worker;
    ExtCache cache;
    uint16_t cursor = 0;
    worker.bind(bus_on(1, "/dev/null"), {slave_on(1, 1, prof, "m")}, {0}, &cursor, cache);

    const auto& blocks = worker.slave(0).blocks;
    ASSERT_EQ(blocks.size(), 1u) << "cùng nhóm poll và liền địa chỉ ⇒ vẫn một khối";
    EXPECT_EQ(blocks[0].poll_group, PollGroup::Slow);
    EXPECT_EQ(blocks[0].count, 4u);
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
/* `ISS-STED-21` — ba test dưới đây mở một CỔNG NỐI TIẾP THẬT qua PTY, nên
 * chúng chỉ có nghĩa khi `MKDDC_ENABLE_MODBUS=ON`. Build `baseline`/`bacnet`
 * của CI biên dịch `ModbusMaster` ở dạng rút gọn không mở được cổng, và ba
 * test này đỏ ở đó — đỏ vì SAI CẤU HÌNH KIỂM, không phải vì sản phẩm hỏng.
 *
 * Guard chứ không xoá: với `MODBUS=ON` chúng vẫn kiểm đúng thứ cần kiểm —
 * một cổng hỏng không được làm chết cả dịch vụ fieldbus. */
#ifdef MKDDC_ENABLE_MODBUS
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
#endif /* MKDDC_ENABLE_MODBUS */

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
        metrics.record_bus_transaction(1, 300000, false, TransactionKind::Read);
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

    metrics.record_bus_transaction(1, 300000, true, TransactionKind::Read);
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
        metrics.record_bus_transaction(1, static_cast<uint32_t>(i * 1000), true, TransactionKind::Read);
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
        metrics.record_bus_transaction(1, 600000, false, TransactionKind::Read);
        for (int tick = 0; tick < 50; tick++) metrics.roll_bus_window(1, 100000);
    }
    const uint16_t pct_x100 = metrics.bus(0).utilization_pct_x100;
    EXPECT_GT(pct_x100, 500u) << "utilization rơi về gần 0 dù dây bận 12%: " << pct_x100;
    EXPECT_LT(pct_x100, 2500u) << "utilization báo quá cao: " << pct_x100;
}

/* ===================== G-D — điều khiển hướng RS-485 =====================
 *
 * Phần cứng Foxlinx SOM-DDC-24 (Hardware owner xác nhận 2026-08-06): cổng RS-485
 * chỉ có TX và RX, KHÔNG có DE/RE ⇒ transceiver tự đảo hướng.
 *
 * Điều nguy hiểm ở bản trước không phải là chọn sai chế độ, mà là KHÔNG CHỌN GÌ
 * CẢ: source không gọi `modbus_rtu_set_serial_mode()`, device tree không có
 * `rs485-*`, nên hành vi phụ thuộc hoàn toàn vào mặc định của driver và không ai
 * phát biểu điều đó ở đâu. Bộ test dưới đây khoá lại việc chế độ là một LỰA CHỌN
 * TƯỜNG MINH, mặc định khớp phần cứng thật.
 */

TEST(Rs485Direction, MacDinhLaAutoVeDungPhanCungFoxlinx)
{
    BusConfig bus;
    EXPECT_EQ(bus.direction, Rs485Direction::Auto)
        << "bo Foxlinx không có DE/RE; bật RTS mặc định sẽ kéo một chân không nối đi đâu";
    EXPECT_EQ(bus.rts_delay_before_us, 0u);
    EXPECT_EQ(bus.rts_delay_after_us, 0u);
}

TEST(Rs485Direction, DocDuocCheDoTuFieldbusConf)
{
    const std::string path = "/tmp/mkddc_fb_dir_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({
          "buses":[
            {"id":1,"device":"/dev/rs485-1","direction":"rts",
             "rts_delay_before_us":150,"rts_delay_after_us":250},
            {"id":2,"device":"/dev/rs485-2","direction":"auto"}
          ],
          "slaves":[{"addr":1,"bus_id":1,"profile":"p","name":"a"}]
        })json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    ASSERT_EQ(cfg.buses.size(), 2u);
    EXPECT_EQ(cfg.buses[0].direction, Rs485Direction::Rts);
    EXPECT_EQ(cfg.buses[0].rts_delay_before_us, 150u);
    EXPECT_EQ(cfg.buses[0].rts_delay_after_us, 250u);
    EXPECT_EQ(cfg.buses[1].direction, Rs485Direction::Auto);
}

/* Giá trị lạ phải rơi về `auto` KÈM CẢNH BÁO, không được im lặng bật RTS: bật
 * nhầm RTS trên bo auto-direction làm driver giữ RTS suốt lượt phát. */
TEST(Rs485Direction, GiaTriLaRoiVeAutoChuKhongBatRts)
{
    const std::string path = "/tmp/mkddc_fb_dirbad_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({"buses":[{"id":1,"device":"/dev/rs485-1","direction":"gpio-pc7"}],
                       "slaves":[{"addr":1,"bus_id":1,"profile":"p","name":"a"}]})json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    ASSERT_EQ(cfg.buses.size(), 1u);
    EXPECT_EQ(cfg.buses[0].direction, Rs485Direction::Auto);
}

/* Cấu hình một-bus cũ (`rs485{}`, không có `buses[]`) phải migrate sang Auto —
 * đúng hành vi nó vốn có, nay được phát biểu ra thay vì ngầm định. */
TEST(Rs485Direction, MigrationTuCauHinhCuGiuNguyenHanhViAuto)
{
    FieldbusConfig cfg;
    cfg.rs485.device = "/dev/rs485-1";
    normalize_buses(&cfg);
    ASSERT_EQ(cfg.buses.size(), 1u);
    EXPECT_EQ(cfg.buses[0].direction, Rs485Direction::Auto);
}

/* ---- Hợp đồng với file DO BE GHI RA (sự cố bo Foxlinx 2026-08-06) ---- */

/* Đây là nội dung `buses[]` đúng như BE Go ghi xuống `/data/config/fieldbus.conf`:
 * `bus_id`/`port`/`display_name`/`stop_bit`, KHÔNG phải `id`/`device`/`name`/`stop`.
 *
 * Bản trước `parse_bus` chỉ đọc bộ tên rút gọn và coi `id` + `device` là bắt
 * buộc, nên mọi bus tạo từ giao diện web đều bị LOẠI. `buses[]` rỗng, iobus rơi
 * về khối `rs485{}` cũ và chỉ chạy được một dây — bus 2 không bao giờ lên, mà
 * không có thông báo nào nói vì sao.
 *
 * Test cũ không bắt được vì chúng tự viết file bằng đúng bộ tên của iobus. */
TEST(FieldbusConfigContract, DocDuocBusTheoTuVungMaBackendThucSuGhi)
{
    const std::string path = "/tmp/mkddc_fb_be_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({
          "buses":[
            {"bus_id":"rs485-1","display_name":"Dây tầng 1","port":"/dev/rs485-1",
             "baud":38400,"parity":"E","stop_bit":2,"data_bits":8,
             "offline_probe_ms":7000,"enabled":true},
            {"bus_id":"rs485-2","display_name":"Dây tầng 2","port":"/dev/rs485-2",
             "baud":19200,"parity":"N","stop_bit":1,"data_bits":8,
             "offline_probe_ms":5000,"enabled":false}
          ],
          "slaves":[{"addr":1,"bus_id":1,"profile":"p","name":"a"}]
        })json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());

    ASSERT_EQ(cfg.buses.size(), 2u) << "bus do giao diện web tạo bị loại sạch";
    EXPECT_EQ(cfg.buses[0].id, 1u) << "số hiệu phải suy được từ \"rs485-1\"";
    EXPECT_EQ(cfg.buses[0].device, "/dev/rs485-1");
    EXPECT_EQ(cfg.buses[0].name, "Dây tầng 1");
    EXPECT_EQ(cfg.buses[0].baud, 38400u);
    EXPECT_EQ(cfg.buses[0].parity, 'E');
    EXPECT_EQ(cfg.buses[0].stop, 2u) << "stop_bit của BE bị bỏ qua ⇒ cổng mở sai khung";
    EXPECT_EQ(cfg.buses[0].offline_probe_ms, 7000u);
    EXPECT_TRUE(cfg.buses[0].enabled);

    EXPECT_EQ(cfg.buses[1].id, 2u);
    EXPECT_FALSE(cfg.buses[1].enabled)
        << "enabled:false bị nuốt ⇒ iobus vẫn phát lên dây mà giao diện báo đã tắt";
}

/* `enabled` phải đọc được cả hai dạng. Dạng số là thứ người ta gõ khi sửa file
 * trên bo (và là dạng DUY NHẤT bản cũ hiểu); dạng boolean là thứ BE ghi ra. */
TEST(FieldbusConfigContract, EnabledDocDuocCaDangSoLanBoolean)
{
    struct Case { const char* literal; bool expected; };
    const Case cases[] = {
        {"true", true}, {"false", false}, {"1", true}, {"0", false},
    };
    for (const auto& c : cases) {
        const std::string path = "/tmp/mkddc_fb_en_" + std::to_string(::getpid()) + ".json";
        {
            std::ofstream out(path);
            out << R"json({"buses":[{"bus_id":"rs485-1","port":"/dev/rs485-1","enabled":)json"
                << c.literal << R"json(}],
                 "slaves":[{"addr":1,"bus_id":1,"profile":"p","name":"a"}]})json";
        }
        FieldbusConfig cfg;
        ASSERT_TRUE(load_fieldbus_config(path, true, &cfg)) << c.literal;
        ::unlink(path.c_str());
        ASSERT_EQ(cfg.buses.size(), 1u) << c.literal;
        EXPECT_EQ(cfg.buses[0].enabled, c.expected)
            << "enabled=" << c.literal << " bị hiểu sai";
    }
}

/* Bộ tên rút gọn vẫn phải chạy: file cũ trên các bo đã triển khai dùng nó, và
 * một bản nâng cấp làm chết cấu hình đang chạy thì tệ hơn lỗi nó đi sửa. */
TEST(FieldbusConfigContract, TuVungRutGonCuVanDocDuoc)
{
    const std::string path = "/tmp/mkddc_fb_old_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({"buses":[{"id":2,"device":"/dev/rs485-2","name":"Cũ","stop":2}],
                       "slaves":[{"addr":1,"bus_id":2,"profile":"p","name":"a"}]})json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    ASSERT_EQ(cfg.buses.size(), 1u);
    EXPECT_EQ(cfg.buses[0].id, 2u);
    EXPECT_EQ(cfg.buses[0].device, "/dev/rs485-2");
    EXPECT_EQ(cfg.buses[0].name, "Cũ");
    EXPECT_EQ(cfg.buses[0].stop, 2u);
}

/* `bus_id` không suy ra được số hiệu ⇒ loại bus, KHÔNG đoán là 1. Đoán bừa sẽ
 * dồn thiết bị của mọi dây lên cùng một dây và nhìn bề ngoài vẫn "chạy". */
TEST(FieldbusConfigContract, BusIdKhongSuyDuocSoHieuThiBiLoai)
{
    const std::string path = "/tmp/mkddc_fb_bad_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({"buses":[{"bus_id":"rs485-main","port":"/dev/rs485-1"},
                                {"bus_id":"rs485-2","port":"/dev/rs485-2"}],
                       "slaves":[{"addr":1,"bus_id":2,"profile":"p","name":"a"}]})json";
    }
    FieldbusConfig cfg;
    ASSERT_TRUE(load_fieldbus_config(path, true, &cfg));
    ::unlink(path.c_str());
    ASSERT_EQ(cfg.buses.size(), 1u);
    EXPECT_EQ(cfg.buses[0].id, 2u);
}

/* ---- Cấu hình lại lúc đang chạy (sự cố bo Foxlinx 2026-08-06) ---- */

/* iobus khởi động với cấu hình RỖNG rồi được thêm thiết bị qua kênh điều khiển.
 *
 * Bản trước, `main.cpp` gác luồng publish bằng một cờ tính MỘT LẦN lúc khởi
 * động. Khởi động với 0 thiết bị ⇒ luồng không bao giờ được tạo; sau đó
 * `apply_config` dựng worker và mở cổng thật, iobus poll bình thường — nhưng
 * không ai publish, nên Web mãi báo "iobus chưa publish telemetry".
 *
 * Nhìn từ ngoài thì Modbus "không chạy", trong khi thực tế chỉ mỗi đường báo
 * cáo là chết. Test này khoá điều kiện mà `main.cpp` nay dựa vào: sau khi áp
 * cấu hình có slave, `bus_count()` phải > 0 để luồng publish biết có việc. */
/* `ISS-STED-21` — ba test dưới đây mở một CỔNG NỐI TIẾP THẬT qua PTY, nên
 * chúng chỉ có nghĩa khi `MKDDC_ENABLE_MODBUS=ON`. Build `baseline`/`bacnet`
 * của CI biên dịch `ModbusMaster` ở dạng rút gọn không mở được cổng, và ba
 * test này đỏ ở đó — đỏ vì SAI CẤU HÌNH KIỂM, không phải vì sản phẩm hỏng.
 *
 * Guard chứ không xoá: với `MODBUS=ON` chúng vẫn kiểm đúng thứ cần kiểm —
 * một cổng hỏng không được làm chết cả dịch vụ fieldbus. */
#ifdef MKDDC_ENABLE_MODBUS
TEST(RuntimeReconfigure, ApplyConfigTuCauHinhRongLamBusCountLonHonKhong)
{
    const std::string prof = write_profile("runtime_reconf",
        R"json({"points":[{"name":"r","fc":3,"addr":0,"count":1,"type":"uint16"}]})json");

    /* Cổng phải MỞ ĐƯỢC thật: `apply_config` từ chối cấu hình không mở được cổng
     * nào (và từ chối đó là hành vi đúng — xem BusWorkerIsolation). */
    const int pty_master = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty_master, 0);
    ASSERT_EQ(::grantpt(pty_master), 0);
    ASSERT_EQ(::unlockpt(pty_master), 0);
    const char* pty_slave = ::ptsname(pty_master);
    ASSERT_NE(pty_slave, nullptr);

    const std::string path = "/tmp/mkddc_fb_rt_" + std::to_string(::getpid()) + ".json";
    {
        std::ofstream out(path);
        out << R"json({"revision":1,"buses":[{"bus_id":"rs485-1","port":")json"
            << pty_slave << R"json("}],
                 "slaves":[{"addr":1,"bus_id":1,"profile":")json"
            << prof << R"json(","name":"a"}]})json";
    }

    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;

    /* Khởi động với cấu hình KHÔNG có slave nào — đúng trạng thái bo sau khi
     * người dùng xoá hết thiết bị. */
    FieldbusConfig empty;
    empty.loaded = true;
    normalize_buses(&empty);
    EXPECT_EQ(master.bus_count(), 0u) << "cấu hình rỗng thì chưa có bus nào";

    std::string reason;
    uint64_t applied = 0, generation = 0;
    const bool ok = master.apply_config(path, 1, "", cache, metrics,
                                        &reason, &applied, &generation);
    ::unlink(path.c_str());

    ASSERT_TRUE(ok) << "apply_config bị từ chối: " << reason;
    EXPECT_GT(master.bus_count(), 0u)
        << "sau khi áp cấu hình có slave, luồng publish phải thấy có bus — "
           "nếu không, iobus poll mà Web mãi báo 'chưa publish telemetry'";
    master.stop_workers();
    ::close(pty_master);
}
#endif /* MKDDC_ENABLE_MODBUS */

/* `T57-3.9` — vòng nhớ khung phải được ghi từ CHÍNH vòng quét thật.
 *
 * `FrameRing` có bộ test riêng cho hành vi của vòng nhớ; test này khoá thứ mà
 * test đó không thể khoá: rằng `poll_once` thực sự gọi tới nó. Thiếu móc nối
 * này thì mọi test vòng nhớ vẫn xanh trong khi màn hình chẩn đoán ngoài hiện
 * trường mãi mãi rỗng — và một bảng rỗng đọc thành "bus im lặng".
 */
/* `ISS-STED-21` — ba test dưới đây mở một CỔNG NỐI TIẾP THẬT qua PTY, nên
 * chúng chỉ có nghĩa khi `MKDDC_ENABLE_MODBUS=ON`. Build `baseline`/`bacnet`
 * của CI biên dịch `ModbusMaster` ở dạng rút gọn không mở được cổng, và ba
 * test này đỏ ở đó — đỏ vì SAI CẤU HÌNH KIỂM, không phải vì sản phẩm hỏng.
 *
 * Guard chứ không xoá: với `MODBUS=ON` chúng vẫn kiểm đúng thứ cần kiểm —
 * một cổng hỏng không được làm chết cả dịch vụ fieldbus. */
#ifdef MKDDC_ENABLE_MODBUS
TEST(BusWorkerFrames, PollRecordsTransactionIncludingTheFailedOnes)
{
    const std::string prof = write_profile("frames",
        R"json({"points":[{"name":"r","fc":3,"addr":0,"count":1,"type":"uint16"}]})json");

    const int pty_master = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty_master, 0);
    ASSERT_EQ(::grantpt(pty_master), 0);
    ASSERT_EQ(::unlockpt(pty_master), 0);
    const char* pty_slave = ::ptsname(pty_master);
    ASSERT_NE(pty_slave, nullptr);

    FieldbusConfig cfg;
    cfg.buses.push_back(bus_on(1, pty_slave));
    cfg.slaves.push_back(slave_on(7, 1, prof, "s7"));   /* addr=7 trên bus 1 */

    ExtCache cache;
    FieldbusMetrics metrics;
    ModbusMaster master;
    ASSERT_TRUE(master.open(cfg, cache, metrics));
    ASSERT_EQ(metrics.frames().size(), 0u);

    /* Đầu kia của pty không trả lời ⇒ giao dịch timeout. Timeout vẫn là một
     * giao dịch ĐÃ XẢY RA: đây đúng là loại khung mà người kỹ thuật cần thấy. */
    master.poll_once(1, cache, metrics, "/tmp/mkddc-no-fieldbus.sock");

    ASSERT_GT(metrics.frames().size(), 0u);
    const std::string json = metrics.frames().to_json(0, 10);
    EXPECT_NE(json.find("\"slave\":7"), std::string::npos) << json;
    EXPECT_NE(json.find("\"bus\":1"), std::string::npos) << json;
    EXPECT_NE(json.find("\"ok\":false"), std::string::npos) << json;
    EXPECT_NE(json.find("\"reason\":\"timeout\""), std::string::npos) << json;
    // Lọc theo một bus khác phải trả rỗng, không phải trả nhầm khung của bus 1.
    EXPECT_EQ(metrics.frames().to_json(2, 10), "[]");

    /* Mốc thời gian phải là đồng hồ TƯỜNG: giao diện hiện nó bằng `new Date()`.
       Dùng nhầm `CLOCK_MONOTONIC` (uptime) sẽ cho một cột giờ năm 1970 — đúng
       lỗi đã bị bắt ở đây ngày 2026-08-19. */
    const uint64_t wall_now = iobus::fieldbus::frame_wall_clock_ms();
    const size_t at_pos = json.find("\"at\":");
    ASSERT_NE(at_pos, std::string::npos);
    const uint64_t at_ms = std::strtoull(json.c_str() + at_pos + 5, nullptr, 10);
    EXPECT_GT(at_ms, wall_now - 60000ull) << "at=" << at_ms << " wall=" << wall_now;
    EXPECT_LE(at_ms, wall_now);

    master.close();
    ::close(pty_master);
    ::unlink(prof.c_str());
}
#endif /* MKDDC_ENABLE_MODBUS */

#ifdef MKDDC_ENABLE_MODBUS
/* `ISS-MBW-02`: lệnh ghi phải được phát kể cả khi KHÔNG slave nào tới hạn ĐỌC.
 *
 * Trước bản sửa, `flush_pending` chỉ có MỘT nơi gọi và nó nằm trong vòng `due`,
 * nên worker tỉnh dậy giữa hai kỳ đọc bỏ qua hàng đợi ghi. Đo trên bo Foxlinx
 * (`poll_ms=1000`): độ trễ từ lúc API trả `200 success` tới lúc relay đổi trạng
 * thái là 16 s / 60 s / 97 s / 153 s — biến thiên đúng kiểu chờ trùng nhịp.
 * (Từ G7, worker còn được ĐÁNH THỨC khi có lệnh mới thay vì ngủ theo trần
 * 200 ms — xem `test_bus_worker_wake.cpp`; test này ghim riêng việc `poll_once`
 * phục vụ hàng đợi ghi độc lập với lịch đọc.)
 *
 * Cổng phải MỞ THẬT thì `flush_pending` mới chạy tới, nên test dùng PTY chứ
 * không dùng `/dev/null`: cổng chết đẩy worker vào `PORT_ERROR` + backoff và
 * `poll_once` thoát sớm, che mất chính đoạn cần kiểm. Đầu kia của PTY không có
 * ai trả lời nên mọi giao dịch hết giờ — và đó là thứ quan sát được: hỏng
 * `kMaxWriteAttempts` lần thì lệnh bị bỏ và hàng đợi rỗng. Hàng đợi KHÔNG rỗng
 * nghĩa là chưa ai thử phát. */
TEST(BusWorkerWriteQueue, LenhGhiKhongPhaiChoToiLuotDocCuaSlave)
{
    const int pty = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty, 0);
    ASSERT_EQ(::grantpt(pty), 0);
    ASSERT_EQ(::unlockpt(pty), 0);
    const char* port = ::ptsname(pty);
    ASSERT_NE(port, nullptr);

    BusWorker worker;
    ExtCache cache;
    FieldbusMetrics metrics;
    metrics.init({"vfd"}, {1});
    uint16_t cursor = 0;
    const std::string prof = write_profile("wnodue",
        R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    /* `poll_ms` một giờ: sau lần poll đầu, slave không tới hạn ĐỌC lần nào nữa
       trong khung thời gian test. `timeout_ms` nhỏ để ba lần hết giờ không kéo
       dài bộ test. */
    SlaveConfig sl = slave_on(1, 1, prof, "vfd", 3600000);
    sl.timeout_ms  = 30;
    worker.bind(bus_on(1, port), {sl}, {0}, &cursor, cache);
    /* `bind()` cố ý KHÔNG mở cổng (để CONFIG_ERROR phân biệt được với
       PORT_ERROR); `ModbusMaster::bind_workers` mở ngay sau đó. Test phải làm
       đúng thứ tự ấy, nếu không `poll_once` thoát ở nhánh cổng đóng. */
    ASSERT_TRUE(worker.open_port());

    /* Lần poll đầu đặt `last_poll_ms`. Bỏ bước này thì `last_poll_ms == 0` làm
       slave luôn "quá hạn", vòng `due` luôn chạy và che mất lỗi cần bắt. */
    worker.poll_once(1000, cache, metrics);

    PendingWrite w{};
    w.slave_addr = 1;
    w.fc         = 6;
    w.reg_addr   = 0;
    w.value      = 42.0f;
    w.type       = PointType::Uint16;
    w.byte_order = ByteOrder::AB;
    w.scale      = 1.0f;
    w.request_id = "req-no-due";
    ASSERT_TRUE(worker.enqueue_write(w));
    ASSERT_EQ(worker.pending_write_count(), 1u);

    /* Ba vòng cách nhau 100 ms, không vòng nào có slave tới hạn ĐỌC. */
    for (uint64_t t = 1100; t <= 1300; t += 100)
        worker.poll_once(t, cache, metrics);

    EXPECT_EQ(worker.pending_write_count(), 0u)
        << "lệnh ghi vẫn nằm trong hàng đợi sau 3 vòng poll — chưa ai thử phát nó, "
           "vì `flush_pending` chỉ chạy cho slave tới hạn ĐỌC (ISS-MBW-02)";
    worker.close_port();
    ::close(pty);
    ::unlink(prof.c_str());
}

/* Slave rỗng việc thì vòng phát-nốt KHÔNG được đụng tới dây: `poll_once` giữa
 * hai kỳ đọc phải là no-op hoàn toàn khi hàng đợi trống. Không có ràng buộc này
 * thì bản sửa trên biến mỗi 100 ms thành một lượt giao dịch RS-485 vô ích, ăn
 * đúng phần băng thông mà nhịp poll thưa sinh ra để tiết kiệm. */
TEST(BusWorkerWriteQueue, KhongCoLenhChoThiKhongDungToiDay)
{
    const int pty = ::posix_openpt(O_RDWR | O_NOCTTY);
    ASSERT_GE(pty, 0);
    ASSERT_EQ(::grantpt(pty), 0);
    ASSERT_EQ(::unlockpt(pty), 0);
    const char* port = ::ptsname(pty);
    ASSERT_NE(port, nullptr);

    BusWorker worker;
    ExtCache cache;
    FieldbusMetrics metrics;
    metrics.init({"vfd"}, {1});
    uint16_t cursor = 0;
    const std::string prof = write_profile("wnoop",
        R"json({"points":[{"name":"sp","fc":3,"addr":0,"count":1,"type":"uint16","writable":true}]})json");
    SlaveConfig sl = slave_on(1, 1, prof, "vfd", 3600000);
    sl.timeout_ms  = 30;
    worker.bind(bus_on(1, port), {sl}, {0}, &cursor, cache);
    ASSERT_TRUE(worker.open_port());

    worker.poll_once(1000, cache, metrics);
    const uint64_t after_first = metrics.get(0).total_polls;

    for (uint64_t t = 1100; t <= 1500; t += 100)
        worker.poll_once(t, cache, metrics);

    EXPECT_EQ(metrics.get(0).total_polls, after_first)
        << "hàng đợi ghi trống mà vẫn phát sinh giao dịch — vòng phát-nốt phải là no-op";
    worker.close_port();
    ::close(pty);
    ::unlink(prof.c_str());
}
#endif /* MKDDC_ENABLE_MODBUS */
