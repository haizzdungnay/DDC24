/**
 * @file  test_control_status.cpp
 * @brief T63-003 (PERF-SYS-04, PERF-API-04): latency bus tách đọc/ghi kèm nhãn
 *        cửa sổ, epoch counter bus khi nạp lại cấu hình, counter IOP 64 bit, và
 *        nội dung op `status` của kênh điều khiển khớp từng byte với fixture mà
 *        consumer Go (`apps/web-api/internal/modbusrtu`) cũng đọc.
 */
#include <fstream>
#include <sstream>
#include <string>

#include <gtest/gtest.h>

#include "diagnostics/iobus_metrics.hpp"
#include "modbus_rtu/control_status.hpp"
#include "modbus_rtu/fieldbus_metrics.hpp"
#include "tests/allocation_probe.hpp"

using namespace iobus::fieldbus;

namespace {

void init_one_bus(FieldbusMetrics& metrics, uint64_t now_ms = 5000)
{
    metrics.init({"s1"}, {1}, {1});
    BusMetrics bus;
    bus.id = 1;
    metrics.init_buses({bus}, now_ms);
}

std::string golden_path()
{
    return std::string(IOBUS_SOURCE_DIR) +
           "/adapters/modbus_rtu/tests/testdata/control_status_t63_003.json";
}

} // namespace

/* AC: latency công bố RIÊNG đọc và ghi. Mẫu ghi chậm không được kéo p95 của
 * đường đọc; cửa sổ trộn cũ giữ nguyên nghĩa (trộn cả hai). */
TEST(ControlStatusT63003, ReadAndWriteLatencyArePublishedSeparately)
{
    FieldbusMetrics metrics;
    init_one_bus(metrics);
    for (int i = 1; i <= 20; i++)
        metrics.record_bus_transaction(1, static_cast<uint32_t>(i * 100), true, TransactionKind::Read);
    for (int i = 1; i <= 4; i++)
        metrics.record_bus_transaction(1, static_cast<uint32_t>(50000 + i), i != 2, TransactionKind::Write);
    metrics.roll_bus_window(1, 100000);

    const BusMetrics bus = metrics.bus(0);
    EXPECT_EQ(bus.read_latency.sample_count, 20u);
    EXPECT_EQ(bus.read_latency.window_size, 128u);
    EXPECT_EQ(bus.read_latency.total, 20u);
    EXPECT_EQ(bus.read_latency.p50_us, 1100u);
    EXPECT_EQ(bus.read_latency.p95_us, 1900u);
    EXPECT_EQ(bus.read_latency.max_us, 2000u);

    EXPECT_EQ(bus.write_latency.sample_count, 4u);
    EXPECT_EQ(bus.write_latency.total, 4u);
    EXPECT_EQ(bus.write_latency.p50_us, 50003u);
    EXPECT_EQ(bus.write_latency.p95_us, 50004u);
    EXPECT_EQ(bus.write_latency.max_us, 50004u);

    /* Nghĩa cũ: cửa sổ trộn 24 mẫu, max tích luỹ, tổng giao dịch/lỗi của dây. */
    EXPECT_EQ(bus.latency_p95_us, 50003u) << "p95 trộn bị kéo bởi 4 lệnh ghi — đúng lý do phải tách";
    EXPECT_EQ(bus.latency_max_us, 50004u);
    EXPECT_EQ(bus.total_transactions, 24u);
    EXPECT_EQ(bus.total_errors, 1u);
}

/* `window_size` là sức chứa, `sample_count` là số mẫu thật trong cửa sổ, `total`
 * đếm tiếp vượt cửa sổ. p50/p95/max cùng cửa sổ 128 giao dịch GẦN NHẤT. */
TEST(ControlStatusT63003, WindowKeepsLatestSamplesWhileTotalKeepsCounting)
{
    FieldbusMetrics metrics;
    init_one_bus(metrics);
    for (int i = 1; i <= 200; i++)
        metrics.record_bus_transaction(1, static_cast<uint32_t>(i), true, TransactionKind::Read);
    metrics.roll_bus_window(1, 100000);
    const LatencyWindowStats read = metrics.bus(0).read_latency;
    EXPECT_EQ(read.sample_count, 128u);
    EXPECT_EQ(read.window_size, 128u);
    EXPECT_EQ(read.total, 200u);
    EXPECT_EQ(read.max_us, 200u);
    EXPECT_EQ(read.p50_us, 137u) << "cửa sổ là mẫu 73..200";
    const LatencyWindowStats write = metrics.bus(0).write_latency;
    EXPECT_EQ(write.sample_count, 0u) << "chưa có lệnh ghi: consumer phải hiện KHÔNG BIẾT, không phải 0 µs";
    EXPECT_EQ(write.window_size, 128u);
    EXPECT_EQ(write.p95_us, 0u);
}

/* AC: counter tích luỹ kèm epoch để phân biệt reset với giảm. `apply_config`
 * nạp lại bus ⇒ counter về 0 trong khi `producer_boot_id` KHÔNG đổi; trước
 * T63-003 consumer thấy "giảm" cùng một danh tính producer. */
TEST(ControlStatusT63003, ReloadingBusesBumpsCounterEpoch)
{
    FieldbusMetrics metrics;
    metrics.set_producer_identity(777, 1000);
    metrics.init({"s1"}, {1}, {1});
    BusMetrics bus;
    bus.id = 1;
    metrics.init_buses({bus}, 2000);
    for (int i = 0; i < 5; i++) metrics.record_bus_transaction(1, 900, true, TransactionKind::Read);
    metrics.roll_bus_window(1, 100000);
    const FieldbusMetrics::BusSnapshot before = metrics.bus_snapshot();
    ASSERT_EQ(before.buses.size(), 1u);
    EXPECT_EQ(before.bus_counters_epoch, 1u);
    EXPECT_EQ(before.bus_counters_since_ms, 2000u);
    EXPECT_EQ(before.buses[0].total_transactions, 5u);

    metrics.init_buses({bus}, 9000);   /* đường của apply_config → bind_workers → init_metrics */
    const FieldbusMetrics::BusSnapshot after = metrics.bus_snapshot();
    EXPECT_EQ(after.buses[0].read_latency.window_size, 128u)
        << "nhãn cửa sổ có ngay sau khi nạp, không đợi nhịp publish đầu tiên";
    EXPECT_EQ(after.bus_counters_epoch, 2u);
    EXPECT_EQ(after.bus_counters_since_ms, 9000u);
    EXPECT_EQ(after.buses[0].total_transactions, 0u);
    EXPECT_EQ(after.buses[0].read_latency.total, 0u);
    EXPECT_EQ(metrics.producer_boot_id(), 777u) << "producer không restart — chỉ epoch bus đổi";
    EXPECT_EQ(metrics.counters_since_ms(), 1000u);

    metrics.roll_bus_window(1, 100000);
    EXPECT_EQ(metrics.bus(0).read_latency.sample_count, 0u) << "cửa sổ cũ không sống sót qua reset";
}

/* AC: không cấp phát khi ghi mẫu (luồng BusWorker). */
TEST(ControlStatusT63003, RecordingTransactionsDoesNotAllocate)
{
    FieldbusMetrics metrics;
    init_one_bus(metrics);
    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (int i = 0; i < 1000; i++) {
            metrics.record_bus_transaction(1, static_cast<uint32_t>(i), (i % 9) != 0,
                                           (i % 3) == 0 ? TransactionKind::Write : TransactionKind::Read);
        }
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
    metrics.roll_bus_window(1, 100000);
    EXPECT_EQ(metrics.bus(0).read_latency.total + metrics.bus(0).write_latency.total, 1000u);
}

/* Counter IOP 64 bit: vượt 2^32 không tràn (ở 500 Hz uint32 tràn sau ~99 ngày
 * cùng một `producer_boot_id`). */
TEST(ControlStatusT63003, IopCountersAreSixtyFourBit)
{
    iobus::IobusMetrics metrics;
    metrics.rx_count.store(0xFFFFFFFFull, std::memory_order_relaxed);
    metrics.rx_count.fetch_add(2, std::memory_order_relaxed);
    EXPECT_EQ(metrics.snapshot().rx, 0x100000001ull);
}

/* Hợp đồng hai phía: iobus sinh ĐÚNG từng byte của fixture; consumer Go
 * (`TestControlStatusFixtureT63003` trong internal/modbusrtu) giải mã cùng file.
 * Đổi định dạng ở một phía mà không cập nhật phía kia ⇒ một trong hai test đỏ. */
TEST(ControlStatusT63003, StatusReplyMatchesSharedFixture)
{
    FieldbusMetrics metrics;
    metrics.set_producer_identity(123456789, 1000);
    metrics.init({"ahu-1", "vfd-2"}, {1, 2}, {1, 1});
    BusMetrics rs1;
    rs1.id = 1;
    rs1.name = "RS485-1";
    rs1.device = "/dev/ttyS1";
    rs1.state = "RUNNING";
    rs1.baud = 9600;
    BusMetrics rs2;
    rs2.id = 2;
    rs2.name = "RS485-2";
    rs2.device = "/dev/ttyS4";
    rs2.state = "CLOSED";
    metrics.init_buses({rs1, rs2}, 5000);
    metrics.record_bus_transaction(1, 1200, true, TransactionKind::Read);
    metrics.record_bus_transaction(1, 1500, false, TransactionKind::Read);
    metrics.record_bus_transaction(1, 1800, true, TransactionKind::Read);
    metrics.record_bus_transaction(1, 2500, true, TransactionKind::Write);
    metrics.roll_bus_window(1, 100000);
    metrics.roll_bus_window(2, 100000);

    ControlStatusIdentity identity;
    identity.generation = 3;
    identity.config_revision = 42;
    identity.producer_boot_id = metrics.producer_boot_id();
    identity.counters_since_ms = metrics.counters_since_ms();
    identity.ext_count = 12;
    identity.sequence = 77;
    IopCounterSnapshot iop;
    iop.rx = 5000000000ull;
    iop.tx = 5000000001ull;
    iop.crc_errors = 2;
    iop.seq_errors = 1;
    iop.timeouts = 3;
    iop.retries = 4;
    iop.nacks = 0;
    const std::string reply = "{\"result\":\"ok\"," +
        control_status_fields(identity, metrics.bus_snapshot(), iop) + "}";

    std::ifstream in(golden_path());
    ASSERT_TRUE(in.is_open()) << golden_path();
    std::stringstream ss;
    ss << in.rdbuf();
    std::string golden = ss.str();
    while (!golden.empty() && (golden.back() == '\n' || golden.back() == '\r')) golden.pop_back();
    EXPECT_EQ(reply, golden);

    /* Tiền tố của mỗi bus giữ đúng định dạng trước T63-003. */
    EXPECT_NE(reply.find("{\"id\":1,\"name\":\"RS485-1\",\"device\":\"/dev/ttyS1\",\"state\":\"RUNNING\","
                         "\"latency_p50_us\":1800,\"latency_p95_us\":2500,\"utilization_pct_x100\":0,"
                         "\"timeout_errors\":0,\"crc_errors\":0,\"port_reopens\":0,"),
              std::string::npos);
    EXPECT_EQ(reply.rfind("{\"result\":\"ok\",\"generation\":3,\"config_revision\":42,"
                          "\"producer_boot_id\":123456789,\"counters_since_ms\":1000,"
                          "\"ext_count\":12,\"sequence\":77,", 0), 0u);
}
