/**
 * @file  test_bacnet_object_map.cpp
 * @brief BAC-003/005: Object registry — names, OOS, Priority_Array integration.
 *        Does NOT require bacnet-stack or kx_plc_shm_t (no shm reads in these tests).
 */
#include <gtest/gtest.h>
#include "bacnet_objects.hpp"
#include "bacnet_server.hpp"

#ifdef MKDDC_ENABLE_BACNET
#include <bacnet/bacstr.h>
#include <bacnet/basic/object/ai.h>
#include <bacnet/basic/object/ao.h>
#endif

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
    EXPECT_EQ(obj.ai_name(1),  "AI1");
    EXPECT_EQ(obj.ai_name(8),  "AI8");
    EXPECT_EQ(obj.ai_name(9),  "AI9");   /* ADR-010: N_AI=16 */
    EXPECT_EQ(obj.ai_name(16), "AI16");
    EXPECT_EQ(obj.bi_name(1), "BI1");
    EXPECT_EQ(obj.ao_name(4), "AO4");
    EXPECT_EQ(obj.av_name(32), "AV32");
    EXPECT_EQ(obj.bv_name(16), "BV16");
    EXPECT_EQ(obj.msv_name(8), "MSV8");
}

TEST(BacnetObjects, OutOfRangeNameEmpty)
{
    BacnetObjects obj;
    EXPECT_TRUE(obj.ai_name(17).empty()); /* first index beyond 16 AIs */
    EXPECT_TRUE(obj.ao_name(5).empty());
}

TEST(BacnetObjects, UpdateAiUnitsRoundTrip)
{
    BacnetObjects obj;
    /* default: all "no-units" */
    EXPECT_EQ(obj.ai_unit(1), "no-units");

    char units[KX_N_UI][8] = {};
    std::strncpy(units[0], "mA",   7);   /* UI1 → 4-20mA */
    std::strncpy(units[1], "V",    7);   /* UI2 → 0-10V  */
    std::strncpy(units[2], "degC", 7);   /* UI3 → NTC    */
    obj.update_ai_units(units);

    EXPECT_EQ(obj.ai_unit(1), "mA");
    EXPECT_EQ(obj.ai_unit(2), "V");
    EXPECT_EQ(obj.ai_unit(3), "degC");
    EXPECT_EQ(obj.ai_unit(4), "");       /* unset → empty from units[] init */
    EXPECT_EQ(obj.ai_unit(16), "");
}

TEST(BacnetObjects, UpdateAoConfigRoundTrip)
{
    BacnetObjects obj;
    iobus::AoChannelConfig channels[KX_N_AO];
    channels[0].name = "CW VALVE";
    channels[0].units_str = "percent";
    channels[0].min_pv = 0.0f;
    channels[0].max_pv = 100.0f;
    channels[1].units_str = "Pa";
    obj.update_ao_config(channels);

    EXPECT_EQ(obj.ao_name(1), "CW VALVE");
    EXPECT_EQ(obj.ao_bacnet_units(1), 98);
    EXPECT_FLOAT_EQ(obj.ao_min_pv(1), 0.0f);
    EXPECT_FLOAT_EQ(obj.ao_max_pv(1), 100.0f);
    EXPECT_EQ(obj.ao_bacnet_units(2), 53); // pascals, not hectopascals (133)
}

#ifdef MKDDC_ENABLE_BACNET
TEST(BacnetServer, AppliesAiAndAoPropertiesToBacnetStack)
{
    BacnetConfig cfg;
    cfg.device.device_id = 4194001;
    cfg.bip.bind_interface = "lo";
    cfg.bip.udp_port = 47819;
    BacnetObjects obj;
    BacnetServer server;
    ASSERT_TRUE(server.init(cfg, &obj, {}, {}));
    ASSERT_TRUE(server.start());

    char ai_units[KX_N_UI][8] = {};
    std::strncpy(ai_units[0], "V", 7);
    std::strncpy(ai_units[1], "mA", 7);
    obj.update_ai_units(ai_units);
    server.apply_ai_units();

    iobus::AoChannelConfig channels[KX_N_AO];
    channels[0].name = "CW VALVE";
    channels[0].units_str = "percent";
    channels[0].min_pv = 0.0f;
    channels[0].max_pv = 100.0f;
    obj.update_ao_config(channels);
    server.apply_ao_config();

    EXPECT_EQ(Analog_Input_Units(1), UNITS_VOLTS);
    EXPECT_EQ(Analog_Input_Units(2), UNITS_MILLIAMPERES);
    EXPECT_EQ(Analog_Output_Units(1), UNITS_PERCENT);
    EXPECT_FLOAT_EQ(Analog_Output_Min_Pres_Value(1), 0.0f);
    EXPECT_FLOAT_EQ(Analog_Output_Max_Pres_Value(1), 100.0f);
    BACNET_CHARACTER_STRING name{};
    ASSERT_TRUE(Analog_Output_Object_Name(1, &name));
    EXPECT_EQ(std::string(reinterpret_cast<const char*>(characterstring_value(&name)),
                          characterstring_length(&name)), "CW VALVE");
    server.stop();
}
#endif

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

TEST(BacnetObjects, EngineeringPercentConvertsToPhysicalCurrent)
{
    BacnetObjects obj;
    iobus::AoChannelConfig channels[KX_N_AO];
    channels[0].mode = iobus::AoMode::MA4_20;
    channels[0].units_str = "percent";
    channels[0].min_pv = 0.0f;
    channels[0].max_pv = 100.0f;
    obj.update_ao_config(channels);

    WriteSpy spy;
    EXPECT_TRUE(obj.write_ao(1, 8, 50.0f, "bacnet:test",
                              [&](auto&&... args){ return spy(args...); }));
    EXPECT_FLOAT_EQ(spy.last_val, 12.0f) << "50% BACnet phải gửi 12mA vật lý vào core";
    const PriorityArray* arr = obj.priority().get_array(CmdObjectType::AO, 1);
    ASSERT_NE(arr, nullptr);
    EXPECT_FLOAT_EQ(arr->slots[7], 50.0f) << "Priority_Array vẫn giữ đơn vị BACnet";

    EXPECT_FALSE(obj.write_ao(1, 8, 101.0f, "bacnet:test",
                               [&](auto&&... args){ return spy(args...); }));
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
    EXPECT_EQ(spy.last_op, "release_ao");
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
TEST(BacnetServer, OutputCallbackMapsWriteAndReleaseToCore)
{
    BacnetConfig cfg;
    BacnetObjects objects;
    WriteSpy spy;
    BacnetServer server;
    server.init(cfg, &objects,
                [&](auto&&... args) { return spy(args...); },
                [](bool) {});

    server.handle_output_write(true, 2, 7.5f, false);
    EXPECT_EQ(spy.last_op, "ao_setpoint");
    EXPECT_EQ(spy.last_idx, 1u);
    EXPECT_FLOAT_EQ(spy.last_val, 7.5f);
    EXPECT_EQ(spy.last_prio, 3);

    server.handle_output_write(false, 3, 0.0f, true);
    EXPECT_EQ(spy.last_op, "release_bo");
    EXPECT_EQ(spy.last_idx, 2u);
}
