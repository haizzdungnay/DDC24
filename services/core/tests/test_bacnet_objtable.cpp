/**
 * @file  test_bacnet_objtable.cpp
 * @brief BAC-004 unit tests — quality_to_reliability mapping + publish behavior.
 */
#include <sys/socket.h>
#include <gtest/gtest.h>
#include "bacnet_objtable.hpp"
#include "mkddc_shm.h"
#include "iop_protocol.h"

using namespace core;

/* ---- quality_to_reliability ---- */

TEST(BacnetObjtable, GoodQualityNoFault)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, 0, 0), 0u);  /* NO_FAULT */
}

TEST(BacnetObjtable, UncertainQuality)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_UNCERTAIN, 0, 0), 5u);  /* COMM_FAILURE */
}

TEST(BacnetObjtable, BadQuality)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_BAD, 0, 0), 5u);  /* COMM_FAILURE */
}

TEST(BacnetObjtable, AdcFaultGivesCommFailure)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_ADC1, 0), 5u);
}

TEST(BacnetObjtable, UIOverRangeCh0)
{
    /* IOP v2 (ADR-010): aggregate IOP_FAULT_UI_OV covers all 16 channels */
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 0), 1u);  /* OVER_RANGE */
}

TEST(BacnetObjtable, UIOverRangeCh3)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 3), 1u);
}

TEST(BacnetObjtable, UIOverRangeCh8)
{
    /* Second ADS131M08 channels must also trigger OVER_RANGE */
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 8), 1u);
}

TEST(BacnetObjtable, UIOverRangeCh15)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 15), 1u);
}

TEST(BacnetObjtable, NoOverRangeWithoutFlag)
{
    /* IOP_FAULT_UI_OV not set → NO_FAULT for any channel */
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, 0, 8), 0u);
}

/* ---- publish (stub shm via attach) ---- */

TEST(BacnetObjtable, AttachDetach)
{
    BacnetObjTable obj;
    /* attach() requires /dev/shm — may succeed or fail depending on env */
    const bool ok = obj.attach();
    if (ok) {
        EXPECT_TRUE(obj.attached());
        obj.detach();
        EXPECT_FALSE(obj.attached());
    } else {
        EXPECT_FALSE(obj.attached());
        SUCCEED();  /* CI without shm is acceptable */
    }
}

TEST(BacnetObjtable, ReadExtNopWhenSockNeg)
{
    BacnetObjTable obj;
    /* sockfd = -1 → no-op, no crash */
    obj.read_ext(-1);
    SUCCEED();
}

/* MOD-012 checkbox #9: core nhận ext snapshot qua socket → plc_shm.ext[] */
TEST(BacnetObjtable, ReadExtReceivesSnapshot)
{
    BacnetObjTable obj;
    if (!obj.attach()) {
        SUCCEED();   /* /dev/shm không khả dụng trong môi trường này */
        return;
    }

    int sv[2];
    ASSERT_EQ(::socketpair(AF_UNIX, SOCK_DGRAM, 0, sv), 0);

    kx_ext_snapshot_msg_t msg{};
    msg.magic           = KX_EXT_SNAP_MAGIC;
    msg.count           = 2;
    msg.points[0].value      = 3.14f;
    msg.points[0].quality    = KX_Q_GOOD;
    msg.points[0].online     = 1;
    msg.points[0].slave_addr = 10;
    msg.points[1].value      = 9.81f;
    msg.points[1].quality    = KX_Q_BAD;
    msg.points[1].online     = 0;

    ::send(sv[0], &msg, sizeof(msg), 0);
    obj.read_ext(sv[1]);

    const kx_plc_shm_t* shm = obj.shm();
    ASSERT_NE(shm, nullptr);
    EXPECT_EQ(shm->ext_count, 2u);
    EXPECT_FLOAT_EQ(shm->ext[0].value, 3.14f);
    EXPECT_EQ(shm->ext[0].quality,    KX_Q_GOOD);
    EXPECT_EQ(shm->ext[0].online,     1u);
    EXPECT_EQ(shm->ext[0].slave_addr, 10u);
    EXPECT_FLOAT_EQ(shm->ext[1].value, 9.81f);
    EXPECT_EQ(shm->ext[1].quality,    KX_Q_BAD);

    ::close(sv[0]);
    ::close(sv[1]);
    obj.detach();
}
