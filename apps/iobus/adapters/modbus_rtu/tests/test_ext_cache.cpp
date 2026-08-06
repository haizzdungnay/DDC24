/**
 * @file  test_ext_cache.cpp
 * @brief MOD-009 + MBR-B103/B104: ext sample cache, quality 5 mức, snapshot v2.
 */
#include <gtest/gtest.h>
#include "device_profile.hpp"
#include "ext_cache.hpp"

using namespace iobus::fieldbus;

namespace {

/* Ghi một mẫu GOOD với mốc thời gian giả — mọi test dưới đây cần một mẫu
 * "đã từng đọc được" trước khi kiểm hành vi xuống cấp quality. */
void good_sample(ExtCache& cache, uint16_t idx, const char* id, double value,
                 uint8_t slave = 10, uint8_t bus = 1, bool writable = false)
{
    cache.set_sample(idx, id, value, KX_EXTQ_GOOD, KX_EXTR_NONE, slave, bus,
                     true, writable, /*utc*/ 1'700'000'000'000ll, /*mono*/ 5'000'000ll);
}

} // namespace

TEST(ExtCache, SetAndGetSample)
{
    ExtCache cache;
    good_sample(cache, 0, "EXT-1.DI[0]", 1.0);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 1.0);
    EXPECT_EQ(cache.sample(0).quality, static_cast<uint8_t>(KX_EXTQ_GOOD));
    EXPECT_EQ(cache.sample(0).online, 1u);
    EXPECT_EQ(cache.sample(0).slave_addr, 10u);
    EXPECT_EQ(cache.sample(0).bus_id, 1u);
    EXPECT_EQ(std::string(cache.sample(0).point_id), "EXT-1.DI[0]");
}

TEST(ExtCache, InitQualityBadNotInitialized)
{
    ExtCache cache;
    EXPECT_EQ(cache.sample(5).quality, static_cast<uint8_t>(KX_EXTQ_BAD));
    EXPECT_EQ(cache.sample(5).quality_reason, static_cast<uint8_t>(KX_EXTR_NOT_INITIALIZED));
}

/* MBR-B001: uint32 công-tơ kWh vượt 2^24. Với float32 phép so sánh dưới đây
 * FAIL vì 4294967295 bị làm tròn — đây là lý do trường value đổi sang double. */
TEST(ExtCache, DoubleKeepsIntegerPrecisionAboveFloatMantissa)
{
    ExtCache cache;
    good_sample(cache, 0, "MB-KWH", 4294967295.0);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 4294967295.0);
    good_sample(cache, 1, "MB-KWH2", 16777217.0);
    EXPECT_DOUBLE_EQ(cache.sample(1).value, 16777217.0);
}

TEST(ExtCache, DeclarePointKeepsNotInitializedUntilFirstSample)
{
    ExtCache cache;
    cache.declare_point(2, "MB-SAT", 10, 1, false);
    EXPECT_EQ(std::string(cache.sample(2).point_id), "MB-SAT");
    EXPECT_EQ(cache.sample(2).quality, static_cast<uint8_t>(KX_EXTQ_BAD));
    EXPECT_EQ(cache.sample(2).quality_reason, static_cast<uint8_t>(KX_EXTR_NOT_INITIALIZED));
    EXPECT_EQ(cache.sample(2).online, 0u);
}

TEST(ExtCache, MarkOfflineCarriesPortDownReasonAndKeepsLastValue)
{
    ExtCache cache;
    good_sample(cache, 0, "EXT-1.DI[0]", 1.0);
    good_sample(cache, 1, "EXT-1.DI[1]", 0.0);
    cache.mark_range_quality(0, 2, KX_EXTQ_OFFLINE, KX_EXTR_PORT_DOWN, false);
    EXPECT_EQ(cache.sample(0).online, 0u);
    EXPECT_EQ(cache.sample(0).quality, static_cast<uint8_t>(KX_EXTQ_OFFLINE));
    EXPECT_EQ(cache.sample(0).quality_reason, static_cast<uint8_t>(KX_EXTR_PORT_DOWN));
    /* Giá trị cuối đọc được PHẢI còn: nó là manh mối duy nhất về tình trạng
     * ngay trước khi mất liên lạc. */
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 1.0);
    EXPECT_EQ(cache.sample(1).online, 0u);
}

TEST(ExtCache, MarkStaleKeepsLastValueOnlineDuringRetryWindow)
{
    ExtCache cache;
    good_sample(cache, 0, "MB-SAT", 21.5);
    cache.mark_slave_stale(0, 1, 10);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 21.5);
    EXPECT_EQ(cache.sample(0).online, 1u);
    EXPECT_EQ(cache.sample(0).quality, static_cast<uint8_t>(KX_EXTQ_STALE));
}

/* Điểm CHƯA TỪNG có mẫu không được mang lý do "TIMEOUT": nó chưa hề được hỏi
 * lần nào, nói timeout là mô tả sai nguyên nhân cho kỹ thuật viên hiện trường. */
TEST(ExtCache, NeverSampledPointKeepsNotInitializedEvenWhenSlaveTimesOut)
{
    ExtCache cache;
    cache.declare_point(0, "MB-NEW", 7, 1, false);
    cache.mark_range_quality(0, 1, KX_EXTQ_OFFLINE, KX_EXTR_TIMEOUT, false);
    EXPECT_EQ(cache.sample(0).quality, static_cast<uint8_t>(KX_EXTQ_BAD));
    EXPECT_EQ(cache.sample(0).quality_reason, static_cast<uint8_t>(KX_EXTR_NOT_INITIALIZED));
}

/* DATA_MODEL §6.2: quality BAD ⇒ "không publish value mới". Một lần decode lỗi
 * không được xoá mất giá trị tốt cuối cùng. */
TEST(ExtCache, BadSampleDoesNotOverwriteLastGoodValueOrTimestamp)
{
    ExtCache cache;
    good_sample(cache, 0, "MB-TEMP", 24.5);
    const int64_t good_mono = cache.sample(0).sample_mono_ns;
    cache.set_sample(0, "MB-TEMP", 999.0, KX_EXTQ_BAD, KX_EXTR_DECODE_ERROR,
                     10, 1, true, false, 9'999'999'999ll, 9'999'999'999ll);
    EXPECT_DOUBLE_EQ(cache.sample(0).value, 24.5);
    EXPECT_EQ(cache.sample(0).sample_mono_ns, good_mono);
    EXPECT_EQ(cache.sample(0).quality, static_cast<uint8_t>(KX_EXTQ_BAD));
    EXPECT_EQ(cache.sample(0).quality_reason, static_cast<uint8_t>(KX_EXTR_DECODE_ERROR));
}

TEST(ExtCache, DeviceExceptionCarriesRawModbusCode)
{
    ExtCache cache;
    good_sample(cache, 0, "MB-VFD", 50.0);
    cache.mark_range_exception(0, 1, 0x02);   /* ILLEGAL DATA ADDRESS */
    EXPECT_EQ(cache.sample(0).exception_code, 0x02);
    EXPECT_EQ(cache.sample(0).quality_reason, static_cast<uint8_t>(KX_EXTR_DEVICE_EXCEPTION));
}

TEST(ExtCache, OutOfBoundsIgnored)
{
    ExtCache cache;
    good_sample(cache, KX_N_EXT, "too-big", 99.0);
    EXPECT_EQ(cache.count(), 0u);
}

TEST(ExtCache, CountTracking)
{
    ExtCache cache;
    EXPECT_EQ(cache.count(), 0u);
    good_sample(cache, 0, "p0", 1.0);
    EXPECT_EQ(cache.count(), 1u);
    good_sample(cache, 3, "p3", 1.0);
    EXPECT_EQ(cache.count(), 4u);
}

/* MBR-B104: `sequence` phải tăng đơn điệu để consumer phát hiện mất datagram.
 * push_snapshot vào socket không tồn tại vẫn phải tăng sequence — nếu không,
 * một giai đoạn core chưa lên sẽ làm consumer thấy chuỗi liền mạch giả. */
TEST(ExtCache, SequenceIncrementsOnEveryPublishAttempt)
{
    ExtCache cache;
    good_sample(cache, 0, "p0", 1.0);
    EXPECT_EQ(cache.sequence(), 0u);
    cache.push_snapshot("/run/mkddc/does-not-exist.sock");
    EXPECT_EQ(cache.sequence(), 1u);
    cache.push_snapshot("/run/mkddc/does-not-exist.sock");
    EXPECT_EQ(cache.sequence(), 2u);
}

TEST(ExtCache, ProvenanceIsCarriedIntoSnapshot)
{
    ExtCache cache;
    SnapshotProvenance prov;
    prov.generation       = 7;
    prov.config_revision  = 42;
    prov.producer_boot_id = 0xABCDEF;
    std::snprintf(prov.config_checksum, sizeof(prov.config_checksum), "%s", "deadbeef1234");
    cache.set_provenance(prov);
    EXPECT_EQ(cache.provenance().generation, 7u);
    EXPECT_EQ(cache.provenance().config_revision, 42u);
    EXPECT_STREQ(cache.provenance().config_checksum, "deadbeef1234");
}

/* F-17: bố cục slot phải LIỀN MẠCH.
 *
 * count_ được nâng tới index cao nhất từng ghi, và push_snapshot gửi TOÀN BỘ
 * [0, count) sang core. Một slot được đặt trước nhưng không bao giờ set_sample sẽ
 * giữ point_id="" + quality=BAD và hiện lên bảng điểm web/HMI thành một dòng vô
 * danh — đúng triệu chứng cũ khi open() đếm slot theo số register. */
TEST(ExtCache, NoEmptySlotWhenBasesComeFromLogicalPointCount)
{
    DeviceProfile meter;                 /* float32 count=2 → 1 điểm luận lý */
    ProfilePoint kwh;
    kwh.name = "kWh"; kwh.fc = 4; kwh.addr = 0; kwh.count = 2;
    kwh.type = PointType::Float32; kwh.byte_order = ByteOrder::ABCD;
    meter.points.push_back(kwh);

    const uint16_t base_meter = 0;
    const uint16_t base_plc   = ext_slots_for_profile(meter);
    ASSERT_EQ(base_plc, 1u);             /* lỗi cũ: 2 → slot 1 bỏ trống */

    ExtCache cache;
    good_sample(cache, base_meter, "meter.kWh[0]", 12.5, 1);
    for (uint16_t i = 0; i < 3; i++) {
        char name[24];
        std::snprintf(name, sizeof(name), "plc.reg[%u]", i);
        good_sample(cache, static_cast<uint16_t>(base_plc + i), name,
                    static_cast<double>(i), 2);
    }

    ASSERT_EQ(cache.count(), 4u);
    for (uint16_t i = 0; i < cache.count(); i++) {
        EXPECT_STRNE(cache.sample(i).point_id, "") << "slot " << i << " rỗng";
        EXPECT_EQ(cache.sample(i).quality, static_cast<uint8_t>(KX_EXTQ_GOOD)) << "slot " << i;
    }
}
