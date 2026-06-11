/**
 * @file  test_safe_state.cpp
 * @brief Bảng trigger 07 §5: iop_status=FAULT → out safe; ts_ns đứng yên 4 scan →
 *        safe; hết fault → trả quyền cho resolver.
 */
#include <gtest/gtest.h>

#include "safe_state.hpp"

using namespace core;

namespace {

IoSnapshot normal_io(uint64_t ts)
{
    IoSnapshot io;
    io.ts_ns = ts;
    io.iop_status = KX_IOP_NORMAL;
    io.valid = true;
    return io;
}

OutputCmd active_out()
{
    OutputCmd out;
    for (int i = 0; i < KX_N_AO; i++) { out.ao[i] = 8.0f; out.ao_valid[i] = true; }
    for (int i = 0; i < KX_N_DO; i++) { out.dout[i] = 1; out.do_valid[i] = true; }
    return out;
}

} // namespace

TEST(SafeState, IopFaultForcesSafeOutputs)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_FAULT;
    io.ao_mode[1] = 1;   /* AO2 = 4-20mA */
    q.evaluate(t, io);

    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f) << "0-10V safe = 0V";
    EXPECT_FLOAT_EQ(out.ao[1], 4.0f) << "4-20mA safe = 4mA";
    for (int i = 0; i < KX_N_DO; i++)
        EXPECT_EQ(out.dout[i], 0) << "DO open";
}

TEST(SafeState, StaleShm4ScansForcesSafe)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    q.evaluate(t, io);   /* fresh */
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());
    EXPECT_EQ(out.dout[0], 1);

    /* ts đứng yên 4 scan → stale > 3 → safe */
    for (int i = 0; i < 4; i++)
        q.evaluate(t, io);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_EQ(out.dout[0], 0);
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f);
}

TEST(SafeState, RecoveryReturnsControlToResolver)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_FAULT;
    q.evaluate(t, io);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());

    /* hết fault + ts mới → trả quyền */
    io.iop_status = KX_IOP_NORMAL;
    io.ts_ns = 200;
    q.evaluate(t, io);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());
    EXPECT_EQ(out.dout[0], 1) << "resolver giữ nguyên giá trị";
    EXPECT_FLOAT_EQ(out.ao[0], 8.0f);
}

TEST(SafeState, SafeStatusAlsoTriggers)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_SAFE;
    q.evaluate(t, io);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_EQ(out.dout[2], 0);
}
