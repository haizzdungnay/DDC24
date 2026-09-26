/**
 * @file  test_point_quality.cpp
 * @brief Bảng quality 07 §6: FAULT/SAFE → BAD; ADC fault → BAD;
 *        stale theo THỜI GIAN (ADR-061 4.7): quá max(3 base step, 250 ms) →
 *        UNCERTAIN, quá max(5 base step, 500 ms) → BAD.
 */
#include <gtest/gtest.h>

#include "iop_protocol.h"
#include "graph/point_quality.hpp"

using namespace core;

namespace {

IoSnapshot good_io(uint64_t ts)
{
    IoSnapshot io;
    io.ts_ns = ts;
    io.iop_status = KX_IOP_NORMAL;
    for (int i = 0; i < KX_N_UI; i++) io.ui_quality[i] = KX_Q_GOOD;
    io.valid = true;
    return io;
}

constexpr uint64_t kMs = 1000000ull;

} // namespace

TEST(PointQuality, NormalIsGood)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);
    EXPECT_EQ(t.get({PointKind::BI, 0}).quality, KX_Q_GOOD);
}

TEST(PointQuality, IopFaultMakesAllBad)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    io.iop_status = KX_IOP_FAULT;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    for (int i = 0; i < KX_N_UI; i++)
        EXPECT_EQ(t.get({PointKind::AI, i}).quality, KX_Q_BAD) << "AI" << i;
    for (int i = 0; i < KX_N_DI; i++)
        EXPECT_EQ(t.get({PointKind::BI, i}).quality, KX_Q_BAD) << "BI" << i;
    /* Gap #2 analysis report: AO/BO cũng phải BAD, không được kẹt GOOD */
    for (int i = 0; i < KX_N_AO; i++)
        EXPECT_EQ(t.get({PointKind::AO, i}).quality, KX_Q_BAD) << "AO" << i;
    for (int i = 0; i < KX_N_DO; i++)
        EXPECT_EQ(t.get({PointKind::BO, i}).quality, KX_Q_BAD) << "BO" << i;
}

TEST(PointQuality, AoDegradesOnStale)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    EXPECT_EQ(t.get({PointKind::AO, 0}).quality, KX_Q_GOOD);

    t.update_inputs(io);
    q.evaluate(t, io, 260 * kMs);       /* > 250 ms → UNCERTAIN */
    EXPECT_EQ(t.get({PointKind::AO, 0}).quality, KX_Q_UNCERTAIN);

    t.update_inputs(io);
    q.evaluate(t, io, 510 * kMs);       /* > 500 ms → BAD */
    EXPECT_EQ(t.get({PointKind::AO, 0}).quality, KX_Q_BAD);
}

TEST(PointQuality, IopSafeMakesAllBad)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    io.iop_status = KX_IOP_SAFE;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    EXPECT_EQ(t.get({PointKind::AI, 3}).quality, KX_Q_BAD);
}

TEST(PointQuality, AdcFaultMakesUiBad)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    io.fault_flags = IOP_FAULT_ADC1;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    for (int i = 0; i < KX_N_UI; i++)
        EXPECT_EQ(t.get({PointKind::AI, i}).quality, KX_Q_BAD);
}

TEST(PointQuality, PerChannelBadFromIobusKept)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    io.ui_quality[2] = KX_Q_BAD;   /* iobus đã set UI_OV kênh 3 */
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    EXPECT_EQ(t.get({PointKind::AI, 2}).quality, KX_Q_BAD);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);
}

TEST(PointQuality, StaleProgressionIsTimeBasedOnTenMsBaseStep)
{
    /* ADR-061 4.7 (X18): base step 10 ms. Luật "3 scan" cũ cho UNCERTAIN sau
     * 30 ms; nay sàn thời gian 250 ms / 500 ms thắng hệ số base step. */
    PointTable t;
    PointQuality q;
    q.set_base_step_ns(10 * kMs);
    EXPECT_EQ(q.uncertain_after_ns(), 250 * kMs);
    EXPECT_EQ(q.bad_after_ns(), 500 * kMs);

    IoSnapshot io = good_io(5000);
    t.update_inputs(io);
    q.evaluate(t, io, 0);   /* ts mới → fresh */
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);

    /* 25 base step đứng yên (250 ms) — tuổi BẰNG ngưỡng chưa phải stale. */
    for (uint64_t now = 10 * kMs; now <= 250 * kMs; now += 10 * kMs) {
        t.update_inputs(io);
        q.evaluate(t, io, now);
    }
    EXPECT_EQ(q.stale_scans(), 25u);
    EXPECT_FALSE(q.is_stale()) << "30 ms của luật cũ đã qua từ lâu nhưng chưa tới 250 ms";
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);

    t.update_inputs(io);
    q.evaluate(t, io, 260 * kMs);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_UNCERTAIN);
    EXPECT_TRUE(q.is_stale());
    EXPECT_FALSE(q.is_stale_bad());

    t.update_inputs(io);
    q.evaluate(t, io, 500 * kMs);
    EXPECT_FALSE(q.is_stale_bad());
    t.update_inputs(io);
    q.evaluate(t, io, 510 * kMs);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_BAD);
    EXPECT_TRUE(q.is_stale_bad());
    EXPECT_EQ(q.stale_age_ns(), 510 * kMs);
}

TEST(PointQuality, LongBaseStepKeepsStepMultipleThresholds)
{
    /* Base step 1 s: max(3 step, 250 ms) = 3 s, max(5 step, 500 ms) = 5 s — đúng
     * hành vi "quá 3/5 scan" trước ADR-061. */
    PointTable t;
    PointQuality q;
    q.set_base_step_ns(1000 * kMs);
    IoSnapshot io = good_io(5000);
    q.evaluate(t, io, 0);
    q.evaluate(t, io, 3000 * kMs);
    EXPECT_FALSE(q.is_stale());
    q.evaluate(t, io, 4000 * kMs);
    EXPECT_TRUE(q.is_stale());
    EXPECT_FALSE(q.is_stale_bad());
    q.evaluate(t, io, 6000 * kMs);
    EXPECT_TRUE(q.is_stale_bad());
}

TEST(PointQuality, NeverReceivedSnapshotBecomesStaleByTime)
{
    /* iobus chưa lên (ts_ns = 0): mốc neo ở lần evaluate đầu, nên I/O không
     * được đứng GOOD mãi chỉ vì chưa từng có mẫu nào. */
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(0);
    q.evaluate(t, io, 100 * kMs);
    EXPECT_FALSE(q.is_stale());
    q.evaluate(t, io, 700 * kMs);
    EXPECT_TRUE(q.is_stale_bad());
}

TEST(PointQuality, FreshTsResetsStale)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(5000);
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    t.update_inputs(io);
    q.evaluate(t, io, 600 * kMs);
    EXPECT_TRUE(q.is_stale());

    io.ts_ns = 6000;   /* iobus sống lại */
    t.update_inputs(io);
    q.evaluate(t, io, 610 * kMs);
    EXPECT_FALSE(q.is_stale());
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);
}
