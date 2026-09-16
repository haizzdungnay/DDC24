/**
 * @file  test_bacnet_cov.cpp
 * @brief BAC-007 unit tests — subscription, increment-based and state-change COV.
 */
#include <gtest/gtest.h>
#include "bacnet_cov.hpp"
#include "bacnet_objects.hpp"

#include <map>
#include <memory>
#include <utility>
#include <vector>

using namespace iobus::bacnet;

namespace iobus::bacnet {
/* F-CTO-BAC-01 (#635): vòng quét COV, tách khỏi BacnetServer::dispatch_cov để
 * kiểm được phạm vi quét mà không cần mở socket BACnet.
 *
 * Khai báo ở đây chứ không ở `bacnet_server.hpp` vì Source ownership của #635
 * không mở file header đó. Chữ ký được trình liên kết kiểm: lệch chữ ký là lỗi
 * link lúc dựng, không phải hỏng im lặng lúc chạy. */
void scan_cov_objects(const BacnetObjects& objects, const kx_plc_shm_t* shm,
                      const CovNotifyFn& check);
}  // namespace iobus::bacnet

static CovSubscription make_sub(uint32_t pid, BacnetObjectType t, uint32_t inst)
{
    CovSubscription s;
    s.subscriber_process_id = pid;
    s.obj_type   = t;
    s.obj_instance = inst;
    s.active     = true;
    return s;
}

TEST(BacnetCov, SubscribeAndUnsubscribe)
{
    BacnetCov cov;
    EXPECT_TRUE(cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1)));
    EXPECT_EQ(cov.sub_count(), 1u);
    EXPECT_TRUE(cov.unsubscribe(1, BacnetObjectType::ANALOG_INPUT, 1));
    cov.expire_subs(0);
    EXPECT_EQ(cov.sub_count(), 0u);
}

TEST(BacnetCov, AnalogTriggerOnIncrement)
{
    BacnetCov cov;
    cov.set_cov_increment(BacnetObjectType::ANALOG_INPUT, 1, 0.5f);
    cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1));

    /* First check: always triggers (NaN → first) */
    auto subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, 1, 10.0f, 0);
    EXPECT_EQ(subs.size(), 1u);

    /* Small change (< increment 0.5): no trigger */
    subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, 1, 10.3f, 0);
    EXPECT_EQ(subs.size(), 0u);

    /* Large change (>= 0.5): trigger */
    subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, 1, 10.6f, 0);
    EXPECT_EQ(subs.size(), 1u);
}

TEST(BacnetCov, AnalogNoTriggerBelowIncrement)
{
    BacnetCov cov;
    cov.set_cov_increment(BacnetObjectType::ANALOG_VALUE, 5, 1.0f);
    cov.subscribe(make_sub(2, BacnetObjectType::ANALOG_VALUE, 5));

    cov.check_and_update(BacnetObjectType::ANALOG_VALUE, 5, 20.0f, 0);
    auto subs = cov.check_and_update(BacnetObjectType::ANALOG_VALUE, 5, 20.9f, 0);
    EXPECT_EQ(subs.size(), 0u);
}

TEST(BacnetCov, DigitalTriggerOnStateChange)
{
    BacnetCov cov;
    cov.subscribe(make_sub(3, BacnetObjectType::BINARY_INPUT, 2));

    /* First */
    auto subs = cov.check_and_update(BacnetObjectType::BINARY_INPUT, 2, 0.0f, 0);
    EXPECT_EQ(subs.size(), 1u);

    /* Same state: no trigger */
    subs = cov.check_and_update(BacnetObjectType::BINARY_INPUT, 2, 0.0f, 0);
    EXPECT_EQ(subs.size(), 0u);

    /* State change: trigger */
    subs = cov.check_and_update(BacnetObjectType::BINARY_INPUT, 2, 1.0f, 0);
    EXPECT_EQ(subs.size(), 1u);
}

TEST(BacnetCov, StatusFlagsChangeTriggers)
{
    BacnetCov cov;
    cov.subscribe(make_sub(4, BacnetObjectType::BINARY_VALUE, 1));

    cov.check_and_update(BacnetObjectType::BINARY_VALUE, 1, 0.0f, 0x00);
    /* Same value, different status → trigger */
    auto subs = cov.check_and_update(BacnetObjectType::BINARY_VALUE, 1, 0.0f, 0x02);
    EXPECT_EQ(subs.size(), 1u);
}

TEST(BacnetCov, MaxSubsEnforced)
{
    BacnetCov cov;
    for (int i = 0; i < BacnetCov::MAX_SUBS; i++)
        EXPECT_TRUE(cov.subscribe(make_sub(i, BacnetObjectType::ANALOG_INPUT, 1)));
    EXPECT_FALSE(cov.subscribe(make_sub(9999, BacnetObjectType::ANALOG_INPUT, 1)));
}

TEST(BacnetCov, ExpireRemovesOldSubs)
{
    BacnetCov cov;
    CovSubscription s = make_sub(10, BacnetObjectType::ANALOG_INPUT, 1);
    s.expiry_ms = 1000;
    cov.subscribe(s);
    EXPECT_EQ(cov.sub_count(), 1u);

    cov.expire_subs(500);
    EXPECT_EQ(cov.sub_count(), 1u);

    cov.expire_subs(1001);
    EXPECT_EQ(cov.sub_count(), 0u);
}

TEST(BacnetCov, UpdateExistingSub)
{
    BacnetCov cov;
    cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1));
    EXPECT_EQ(cov.sub_count(), 1u);
    /* Subscribe again with same pid+obj → update, not add */
    cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1));
    EXPECT_EQ(cov.sub_count(), 1u);
}

/* ===================================================================
 * F-CTO-BAC-01 (#635): phạm vi quét COV phải phủ ĐỦ số object của từng loại.
 *
 * Hồi quy được chặn ở đây: bản cũ quét AI và BI bằng chung cận `8`, nên
 * AI9..AI16 có giá trị sống trong SHM mà không bao giờ được kiểm COV. Khi COV
 * nối ra mạng thật (T-BAC-044..046), tám kênh UI cuối sẽ im lặng không báo
 * đổi giá trị và BMS treo số cũ mà không có lỗi nào lần ra được.
 * =================================================================== */

namespace {

/* kx_plc_shm_t lớn (256 điểm ext) — cấp phát trên heap, không để trên stack. */
std::unique_ptr<kx_plc_shm_t> make_shm()
{
    auto shm = std::make_unique<kx_plc_shm_t>();
    *shm = kx_plc_shm_t{};   /* seq = 0 (chẵn) ⇒ seqlock đọc được ngay */
    return shm;
}

/* Ghi lại mọi lần `check(...)` được gọi, theo đúng thứ tự. */
struct ScanSpy {
    std::vector<std::pair<BacnetObjectType, uint32_t>> calls;
    std::map<std::pair<uint16_t, uint32_t>, float>     values;

    CovNotifyFn fn()
    {
        return [this](BacnetObjectType t, uint32_t inst, float v, uint8_t) {
            calls.emplace_back(t, inst);
            values[{static_cast<uint16_t>(t), inst}] = v;
        };
    }

    size_t count_of(BacnetObjectType t) const
    {
        size_t n = 0;
        for (const auto& c : calls)
            if (c.first == t) ++n;
        return n;
    }

    bool saw(BacnetObjectType t, uint32_t inst) const
    {
        for (const auto& c : calls)
            if (c.first == t && c.second == inst) return true;
        return false;
    }
};

}  // namespace

TEST(BacnetCovScan, ScansAnalogInputUpToN_AI)
{
    /* Chính là lỗi F-CTO-BAC-01: AI16 phải được soi, không dừng ở AI8. */
    auto shm = make_shm();
    BacnetObjects obj;
    ScanSpy spy;

    scan_cov_objects(obj, shm.get(), spy.fn());

    EXPECT_TRUE(spy.saw(BacnetObjectType::ANALOG_INPUT, 16))
        << "AI16 không được quét — vòng COV lại bị cắt ở cận của BI";
    for (uint32_t i = 9; i <= 16; ++i)
        EXPECT_TRUE(spy.saw(BacnetObjectType::ANALOG_INPUT, i))
            << "AI" << i << " nằm ngoài phạm vi quét COV";

    EXPECT_EQ(spy.count_of(BacnetObjectType::ANALOG_INPUT),
              static_cast<size_t>(BacnetObjects::N_AI));
    EXPECT_FALSE(spy.saw(BacnetObjectType::ANALOG_INPUT, 17));
}

TEST(BacnetCovScan, ReportsChangedValueOnHighAnalogInputChannel)
{
    /* AC-5: đặt giá trị ở một kênh trong AI9..AI16, khẳng định check() nhận
     * đúng kênh đó kèm đúng giá trị. */
    auto shm = make_shm();
    shm->ai[12].value = 42.5f;          /* AI13 — nằm trong vùng từng bị bỏ sót */
    BacnetObjects obj;
    ScanSpy spy;

    scan_cov_objects(obj, shm.get(), spy.fn());

    ASSERT_TRUE(spy.saw(BacnetObjectType::ANALOG_INPUT, 13));
    EXPECT_FLOAT_EQ(
        spy.values.at({static_cast<uint16_t>(BacnetObjectType::ANALOG_INPUT), 13}),
        42.5f);
}

TEST(BacnetCovScan, HighAnalogInputChannelNotifiesSubscriber)
{
    /* Nối trọn đường: quét → check_and_update → subscriber được báo.
     * Đây là thứ thực sự đứt trước bản sửa, không chỉ là con số cận vòng lặp. */
    auto shm = make_shm();
    BacnetObjects obj;
    BacnetCov cov;

    CovSubscription sub;
    sub.subscriber_process_id = 7;
    sub.obj_type     = BacnetObjectType::ANALOG_INPUT;
    sub.obj_instance = 16;
    sub.active       = true;
    cov.subscribe(sub);
    cov.set_cov_increment(BacnetObjectType::ANALOG_INPUT, 16, 0.5f);

    size_t notified = 0;
    auto check = [&](BacnetObjectType t, uint32_t inst, float v, uint8_t sf) {
        notified += cov.check_and_update(t, inst, v, sf).size();
    };

    shm->ai[15].value = 10.0f;          /* AI16: mẫu đầu — luôn kích hoạt */
    scan_cov_objects(obj, shm.get(), check);
    EXPECT_EQ(notified, 1u) << "AI16 không phát COV lần đầu";

    notified = 0;
    shm->ai[15].value = 10.1f;          /* dưới ngưỡng 0.5 — không phát */
    scan_cov_objects(obj, shm.get(), check);
    EXPECT_EQ(notified, 0u);

    notified = 0;
    shm->ai[15].value = 11.0f;          /* vượt ngưỡng — phải phát */
    scan_cov_objects(obj, shm.get(), check);
    EXPECT_EQ(notified, 1u) << "AI16 đổi giá trị mà subscriber không được báo";
}

TEST(BacnetCovScan, EachObjectTypeScannedToItsOwnBound)
{
    /* Cận của mỗi loại phải độc lập — gộp hai loại vào một vòng chính là
     * nguyên nhân gốc. Khoá luôn sáu loại còn lại để lần sửa sau không kéo
     * nhầm loại nào về chung cận. */
    auto shm = make_shm();
    BacnetObjects obj;
    ScanSpy spy;

    scan_cov_objects(obj, shm.get(), spy.fn());

    EXPECT_EQ(spy.count_of(BacnetObjectType::ANALOG_INPUT),
              static_cast<size_t>(BacnetObjects::N_AI));
    EXPECT_EQ(spy.count_of(BacnetObjectType::BINARY_INPUT),
              static_cast<size_t>(BacnetObjects::N_BI));
    EXPECT_EQ(spy.count_of(BacnetObjectType::ANALOG_OUTPUT),
              static_cast<size_t>(BacnetObjects::N_AO));
    EXPECT_EQ(spy.count_of(BacnetObjectType::BINARY_OUTPUT),
              static_cast<size_t>(BacnetObjects::N_BO));
    EXPECT_EQ(spy.count_of(BacnetObjectType::ANALOG_VALUE),
              static_cast<size_t>(BacnetObjects::N_AV));
    EXPECT_EQ(spy.count_of(BacnetObjectType::BINARY_VALUE),
              static_cast<size_t>(BacnetObjects::N_BV));
    EXPECT_EQ(spy.count_of(BacnetObjectType::MULTI_STATE_VALUE),
              static_cast<size_t>(BacnetObjects::N_MSV));

    /* AI nhiều gấp đôi BI: nếu ai đó gộp lại một vòng, đẳng thức này vỡ. */
    EXPECT_NE(spy.count_of(BacnetObjectType::ANALOG_INPUT),
              spy.count_of(BacnetObjectType::BINARY_INPUT));
}

TEST(BacnetCovScan, NullShmIsNoOp)
{
    BacnetObjects obj;
    ScanSpy spy;
    scan_cov_objects(obj, nullptr, spy.fn());
    EXPECT_TRUE(spy.calls.empty());
}
