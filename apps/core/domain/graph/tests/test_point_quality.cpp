/**
 * @file  test_point_quality.cpp
 * @brief Bảng quality 07 §6: FAULT/SAFE → BAD; ADC fault → BAD;
 *        stale 3-5 scan → UNCERTAIN, >5 → BAD.
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

} // namespace

TEST(PointQuality, NormalIsGood)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    t.update_inputs(io);
    q.evaluate(t, io);
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
    q.evaluate(t, io);
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
    q.evaluate(t, io);
    EXPECT_EQ(t.get({PointKind::AO, 0}).quality, KX_Q_GOOD);

    for (int s = 0; s < 4; s++) {       /* ts đứng yên 4 scan → UNCERTAIN */
        t.update_inputs(io);
        q.evaluate(t, io);
    }
    EXPECT_EQ(t.get({PointKind::AO, 0}).quality, KX_Q_UNCERTAIN);

    for (int s = 0; s < 2; s++) {       /* >5 scan → BAD */
        t.update_inputs(io);
        q.evaluate(t, io);
    }
    EXPECT_EQ(t.get({PointKind::AO, 0}).quality, KX_Q_BAD);
}

TEST(PointQuality, IopSafeMakesAllBad)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    io.iop_status = KX_IOP_SAFE;
    t.update_inputs(io);
    q.evaluate(t, io);
    EXPECT_EQ(t.get({PointKind::AI, 3}).quality, KX_Q_BAD);
}

TEST(PointQuality, AdcFaultMakesUiBad)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(1000);
    io.fault_flags = IOP_FAULT_ADC1;
    t.update_inputs(io);
    q.evaluate(t, io);
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
    q.evaluate(t, io);
    EXPECT_EQ(t.get({PointKind::AI, 2}).quality, KX_Q_BAD);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);
}

TEST(PointQuality, StaleProgressionUncertainThenBad)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(5000);
    t.update_inputs(io);
    q.evaluate(t, io);   /* scan 1: ts mới → fresh */
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);

    /* ts_ns đứng yên: scan 2,3,4 → stale_scans=1,2,3 (chưa quá 3) */
    for (int s = 0; s < 3; s++) {
        t.update_inputs(io);
        q.evaluate(t, io);
    }
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);

    /* scan 5 → stale_scans=4 > 3 → UNCERTAIN */
    t.update_inputs(io);
    q.evaluate(t, io);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_UNCERTAIN);
    EXPECT_TRUE(q.is_stale());

    /* thêm 2 scan → stale_scans=6 > 5 → BAD */
    t.update_inputs(io);
    q.evaluate(t, io);
    t.update_inputs(io);
    q.evaluate(t, io);
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_BAD);
    EXPECT_TRUE(q.is_stale_bad());
}

TEST(PointQuality, FreshTsResetsStale)
{
    PointTable t;
    PointQuality q;
    IoSnapshot io = good_io(5000);
    for (int s = 0; s < 6; s++) {
        t.update_inputs(io);
        q.evaluate(t, io);
    }
    EXPECT_TRUE(q.is_stale());

    io.ts_ns = 6000;   /* iobus sống lại */
    t.update_inputs(io);
    q.evaluate(t, io);
    EXPECT_FALSE(q.is_stale());
    EXPECT_EQ(t.get({PointKind::AI, 0}).quality, KX_Q_GOOD);
}
