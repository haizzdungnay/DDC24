/**
 * @file  test_bacnet_object_map.cpp
 * @brief BAC-003/005: Object registry — names, OOS, Priority_Array integration.
 *        Does NOT require bacnet-stack or kx_plc_shm_t (no shm reads in these tests).
 */
#include <gtest/gtest.h>
#include "bacnet_objects.hpp"

using namespace iobus::bacnet;

/* Stub CoreWriteFn: always returns accepted=true, records last call */
struct WriteSpy {
    std::string last_op;
    uint32_t    last_idx  = 0;
    float       last_val  = 0.0f;
    int         last_prio = 0;
    bool        return_accepted = true;

    bool operator()(const std::string& op, uint32_t idx, float val,
                     const std::string&, int prio)
    {
        last_op   = op;
        last_idx  = idx;
        last_val  = val;
        last_prio = prio;
        return return_accepted;
    }
};

TEST(BacnetObjects, DefaultNames)
{
    BacnetObjects obj;
    EXPECT_EQ(obj.ai_name(1), "AI1");
    EXPECT_EQ(obj.ai_name(8), "AI8");
    EXPECT_EQ(obj.bi_name(1), "BI1");
    EXPECT_EQ(obj.ao_name(4), "AO4");
    EXPECT_EQ(obj.av_name(32), "AV32");
    EXPECT_EQ(obj.bv_name(16), "BV16");
    EXPECT_EQ(obj.msv_name(8), "MSV8");
}

TEST(BacnetObjects, OutOfRangeNameEmpty)
{
    BacnetObjects obj;
    EXPECT_TRUE(obj.ai_name(9).empty());
    EXPECT_TRUE(obj.ao_name(5).empty());
}

TEST(BacnetObjects, WriteAoSendsToCoreWithPrio3)
{
    BacnetObjects obj;
    WriteSpy spy;
    const bool accepted = obj.write_ao(1, 8, 5.5f, "bacnet:192.168.1.10",
                                         [&](auto&&... args){ return spy(args...); });
    EXPECT_TRUE(accepted);
    EXPECT_EQ(spy.last_op, "ao_setpoint");
    EXPECT_EQ(spy.last_idx, 0u);
    EXPECT_FLOAT_EQ(spy.last_val, 5.5f);
    EXPECT_EQ(spy.last_prio, 3);
}

TEST(BacnetObjects, WriteAoOverridden)
{
    BacnetObjects obj;
    WriteSpy spy;
    spy.return_accepted = false;  /* core returns overridden */
    const bool accepted = obj.write_ao(1, 8, 5.5f, "bacnet:10.0.0.1",
                                         [&](auto&&... args){ return spy(args...); });
    EXPECT_FALSE(accepted);
    /* Priority_Array still has slot 8 set */
    const PriorityArray* arr = obj.priority().get_array(CmdObjectType::AO, 1);
    ASSERT_NE(arr, nullptr);
    EXPECT_FLOAT_EQ(arr->slots[7], 5.5f);
}

TEST(BacnetObjects, WriteBoSendsToCoreDoCmd)
{
    BacnetObjects obj;
    WriteSpy spy;
    obj.write_bo(2, 1, 1.0f, "bacnet:10.0.0.1",
                  [&](auto&&... args){ return spy(args...); });
    EXPECT_EQ(spy.last_op, "do_cmd");
    EXPECT_EQ(spy.last_idx, 1u);
}

TEST(BacnetObjects, WriteAvSendsAvSetpoint)
{
    BacnetObjects obj;
    WriteSpy spy;
    obj.write_av(5, 3.14f, "bacnet:10.0.0.2",
                  [&](auto&&... args){ return spy(args...); });
    EXPECT_EQ(spy.last_op, "av_setpoint");
    EXPECT_EQ(spy.last_idx, 4u);
}

TEST(BacnetObjects, OosFlag)
{
    BacnetObjects obj;
    EXPECT_FALSE(obj.oos_ai(1));
    obj.set_oos_ai(1, true);
    EXPECT_TRUE(obj.oos_ai(1));
    obj.set_oos_ai(1, false);
    EXPECT_FALSE(obj.oos_ai(1));
}

TEST(BacnetObjects, CovIncrementPropagates)
{
    BacnetObjects obj;
    obj.set_cov_increment_ai(1, 0.25f);
    const ObjectCovState& st = obj.cov().get_state(BacnetObjectType::ANALOG_INPUT, 1);
    EXPECT_FLOAT_EQ(st.cov_increment, 0.25f);
}

TEST(BacnetObjects, RelinquishAoUpdatesCore)
{
    BacnetObjects obj;
    WriteSpy spy;
    auto fn = [&](auto&&... args){ return spy(args...); };

    /* Write then relinquish */
    obj.write_ao(1, 8, 5.0f, "bacnet:1.2.3.4", fn);
    const bool changed = obj.relinquish_ao(1, 8, "bacnet:1.2.3.4", fn);
    EXPECT_TRUE(changed);
    /* After relinquish, winner = relinquish_default = 0 */
    EXPECT_FLOAT_EQ(spy.last_val, 0.0f);
}

TEST(BacnetObjects, OutOfRangeWriteReturnsFalse)
{
    BacnetObjects obj;
    WriteSpy spy;
    EXPECT_FALSE(obj.write_ao(5, 8, 1.0f, "test",
                               [&](auto&&... args){ return spy(args...); }));
    EXPECT_FALSE(obj.write_bo(5, 8, 1.0f, "test",
                               [&](auto&&... args){ return spy(args...); }));
}
