/**
 * @file test_io_conditioning.cpp
 * @brief ISS-PIO-24 §7 — deadband / clamp / bật-tắt phát hiện lỗi / giá trị khi lỗi.
 *
 * Mỗi test dưới đây tương ứng một tiêu chí chấp nhận của issue. Điều quan trọng
 * nhất là nhóm `DefaultsPreserveLegacyBehaviour`: cấu hình cũ (không có key mới)
 * phải cho ra ĐÚNG kết quả như trước khi có issue này, nếu không thì mọi board
 * đang chạy sẽ đổi hành vi khi nâng cấp firmware.
 */
#include <gtest/gtest.h>

#include "io/io_conditioning.hpp"

using namespace iobus;

namespace {

UiScaleConfig base_cfg()
{
    UiScaleConfig cfg;
    cfg.sensor = SensorType::V0_10;
    cfg.scale_lo = 0.0f;
    cfg.scale_hi = 100.0f;
    return cfg;
}

} // namespace

/* ---- Mặc định: không đổi hành vi so với trước ISS-PIO-24 ---- */

TEST(IoConditioning, DefaultsPreserveLegacyBehaviour)
{
    UiScaleConfig cfg = base_cfg();
    EXPECT_FLOAT_EQ(cfg.deadband, 0.0f);
    EXPECT_FALSE(cfg.clamp_enabled);
    EXPECT_TRUE(cfg.range_fault_enabled);
    EXPECT_TRUE(cfg.loop_fault_enabled);
    EXPECT_EQ(cfg.failure_mode, UiFailureMode::INVALID);

    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 42.5f), 42.5f);
    EXPECT_EQ(q, KX_Q_GOOD);

    /* Lỗi over-range với cấu hình mặc định: vẫn BAD, vẫn phát giá trị vừa tính */
    q = KX_Q_BAD;
    r = KX_REL_OVER_RANGE;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 120.0f), 120.0f);
    EXPECT_EQ(q, KX_Q_BAD);
    EXPECT_EQ(r, KX_REL_OVER_RANGE);
}

/* ---- Bậc 1: mặt nạ lỗi range/loop ---- */

TEST(IoConditioning, RangeFaultDisabledRestoresGoodQuality)
{
    UiScaleConfig cfg = base_cfg();
    cfg.range_fault_enabled = false;

    kx_quality_t q = KX_Q_BAD;
    kx_reliability_t r = KX_REL_OVER_RANGE;
    apply_fault_mask(cfg, &q, &r);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_EQ(r, KX_REL_RELIABLE);

    q = KX_Q_BAD;
    r = KX_REL_UNDER_RANGE;
    apply_fault_mask(cfg, &q, &r);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoConditioning, RangeMaskDoesNotHideLoopOrCommFaults)
{
    UiScaleConfig cfg = base_cfg();
    cfg.range_fault_enabled = false; /* chỉ tắt range */

    kx_quality_t q = KX_Q_BAD;
    kx_reliability_t r = KX_REL_OPEN_LOOP;
    apply_fault_mask(cfg, &q, &r);
    EXPECT_EQ(q, KX_Q_BAD) << "tắt range fault không được che open loop";

    q = KX_Q_BAD;
    r = KX_REL_COMMUNICATION_FAILURE;
    apply_fault_mask(cfg, &q, &r);
    EXPECT_EQ(q, KX_Q_BAD) << "lỗi truyền thông không bao giờ bị mặt nạ";
    EXPECT_EQ(r, KX_REL_COMMUNICATION_FAILURE);
}

TEST(IoConditioning, LoopFaultDisabledRestoresGoodQuality)
{
    UiScaleConfig cfg = base_cfg();
    cfg.loop_fault_enabled = false;

    for (kx_reliability_t rel : {KX_REL_OPEN_LOOP, KX_REL_SHORTED_LOOP}) {
        kx_quality_t q = KX_Q_BAD;
        kx_reliability_t r = rel;
        apply_fault_mask(cfg, &q, &r);
        EXPECT_EQ(q, KX_Q_GOOD);
        EXPECT_EQ(r, KX_REL_RELIABLE);
    }

    kx_quality_t q = KX_Q_BAD;
    kx_reliability_t r = KX_REL_OVER_RANGE;
    apply_fault_mask(cfg, &q, &r);
    EXPECT_EQ(q, KX_Q_BAD) << "tắt loop fault không được che over range";
}

/* ---- Bậc 2: clamp ---- */

TEST(IoConditioning, ClampBoundsValueWhenEnabled)
{
    UiScaleConfig cfg = base_cfg();
    cfg.clamp_enabled = true;
    cfg.clamp_min = 10.0f;
    cfg.clamp_max = 30.0f;

    EXPECT_FLOAT_EQ(apply_clamp(cfg, 5.0f), 10.0f);
    EXPECT_FLOAT_EQ(apply_clamp(cfg, 35.0f), 30.0f);
    EXPECT_FLOAT_EQ(apply_clamp(cfg, 20.0f), 20.0f);
    EXPECT_FLOAT_EQ(apply_clamp(cfg, 10.0f), 10.0f);
    EXPECT_FLOAT_EQ(apply_clamp(cfg, 30.0f), 30.0f);
}

TEST(IoConditioning, ClampIgnoredWhenDisabledOrRangeInverted)
{
    UiScaleConfig cfg = base_cfg();
    cfg.clamp_min = 10.0f;
    cfg.clamp_max = 30.0f;
    EXPECT_FLOAT_EQ(apply_clamp(cfg, 99.0f), 99.0f) << "clamp_enabled=false ⇒ không kẹp";

    cfg.clamp_enabled = true;
    cfg.clamp_min = 30.0f;
    cfg.clamp_max = 10.0f;
    EXPECT_FLOAT_EQ(apply_clamp(cfg, 99.0f), 99.0f) << "dải nghịch là cấu hình hỏng, không kẹp";
}

/* ---- Bậc 3: deadband ---- */

TEST(IoConditioning, DeadbandSuppressesSmallChanges)
{
    UiScaleConfig cfg = base_cfg();
    cfg.deadband = 0.5f;
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;

    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 20.0f), 20.0f) << "mẫu đầu luôn qua";
    q = KX_Q_GOOD;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 20.2f), 20.0f) << "nhiễu nhỏ hơn deadband";
    q = KX_Q_GOOD;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 20.4f), 20.0f);
    q = KX_Q_GOOD;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 20.6f), 20.6f) << "vượt deadband ⇒ phát";
    q = KX_Q_GOOD;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 20.9f), 20.6f) << "mốc so sánh là giá trị ĐÃ PHÁT";
}

TEST(IoConditioning, DeadbandDoesNotAccumulateDrift)
{
    /* Nếu deadband so với mẫu trước (thay vì giá trị đã phát) thì chuỗi tăng
     * đều 0.4 sẽ không bao giờ phát — điểm chết đứng dù thực tế đã trôi 4 đơn vị. */
    UiScaleConfig cfg = base_cfg();
    cfg.deadband = 0.5f;
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    float last = condition_ui_sample(cfg, &st, &q, &r, 10.0f);
    for (int i = 1; i <= 10; i++) {
        q = KX_Q_GOOD;
        last = condition_ui_sample(cfg, &st, &q, &r, 10.0f + 0.4f * static_cast<float>(i));
    }
    EXPECT_GT(last, 13.0f) << "deadband phải bám giá trị đã phát, không bám mẫu liền trước";
}

TEST(IoConditioning, DeadbandZeroPassesEverything)
{
    UiScaleConfig cfg = base_cfg();
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    condition_ui_sample(cfg, &st, &q, &r, 20.0f);
    q = KX_Q_GOOD;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 20.000001f), 20.000001f);
}

/* ---- Bậc 4: chính sách giá trị khi lỗi ---- */

TEST(IoConditioning, FailureModeHoldRepublishesLastGoodValue)
{
    UiScaleConfig cfg = base_cfg();
    cfg.failure_mode = UiFailureMode::HOLD;
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    condition_ui_sample(cfg, &st, &q, &r, 23.5f);

    q = KX_Q_BAD;
    r = KX_REL_OPEN_LOOP;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, -999.0f), 23.5f);
    EXPECT_EQ(q, KX_Q_BAD) << "HOLD chỉ đổi GIÁ TRỊ, quality vẫn phải nói thật";
    EXPECT_EQ(r, KX_REL_OPEN_LOOP);
}

TEST(IoConditioning, FailureModeHoldWithoutAnyGoodSampleFallsBackToComputedValue)
{
    UiScaleConfig cfg = base_cfg();
    cfg.failure_mode = UiFailureMode::HOLD;
    UiConditioningState st;
    kx_quality_t q = KX_Q_BAD;
    kx_reliability_t r = KX_REL_OPEN_LOOP;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, -1.25f), -1.25f);
}

TEST(IoConditioning, FailureModeFixedPublishesConfiguredConstant)
{
    UiScaleConfig cfg = base_cfg();
    cfg.failure_mode = UiFailureMode::FIXED;
    cfg.failure_value = 21.0f;
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    condition_ui_sample(cfg, &st, &q, &r, 30.0f);

    q = KX_Q_BAD;
    r = KX_REL_SHORTED_LOOP;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 99.0f), 21.0f);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoConditioning, FailureModeInvalidKeepsComputedValue)
{
    UiScaleConfig cfg = base_cfg();
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    condition_ui_sample(cfg, &st, &q, &r, 30.0f);

    q = KX_Q_BAD;
    r = KX_REL_OPEN_LOOP;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 99.0f), 99.0f);
}

/* ---- Thứ tự các bậc ---- */

TEST(IoConditioning, ClampRunsBeforeDeadbandSoClampedValueIsTheReference)
{
    UiScaleConfig cfg = base_cfg();
    cfg.clamp_enabled = true;
    cfg.clamp_min = 0.0f;
    cfg.clamp_max = 50.0f;
    cfg.deadband = 1.0f;
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;

    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 80.0f), 50.0f);
    q = KX_Q_GOOD;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 120.0f), 50.0f)
        << "sau clamp hai mẫu bằng nhau ⇒ deadband giữ nguyên, không rung";
}

TEST(IoConditioning, MaskedFaultGoesThroughClampAndDeadbandNotFailurePolicy)
{
    /* Tắt phát hiện range ⇒ mẫu trở lại GOOD ⇒ phải đi nhánh clamp/deadband,
     * KHÔNG được rơi vào chính sách failure value. */
    UiScaleConfig cfg = base_cfg();
    cfg.range_fault_enabled = false;
    cfg.clamp_enabled = true;
    cfg.clamp_min = 0.0f;
    cfg.clamp_max = 100.0f;
    cfg.failure_mode = UiFailureMode::FIXED;
    cfg.failure_value = -50.0f;

    UiConditioningState st;
    kx_quality_t q = KX_Q_BAD;
    kx_reliability_t r = KX_REL_OVER_RANGE;
    EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 130.0f), 100.0f);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoConditioning, HoldDoesNotLearnValuesFromFaultySamples)
{
    UiScaleConfig cfg = base_cfg();
    cfg.failure_mode = UiFailureMode::HOLD;
    UiConditioningState st;
    kx_quality_t q = KX_Q_GOOD;
    kx_reliability_t r = KX_REL_RELIABLE;
    condition_ui_sample(cfg, &st, &q, &r, 18.0f);

    for (int i = 0; i < 5; i++) {
        q = KX_Q_BAD;
        r = KX_REL_OPEN_LOOP;
        EXPECT_FLOAT_EQ(condition_ui_sample(cfg, &st, &q, &r, 500.0f), 18.0f)
            << "giá trị giữ không được trôi theo mẫu lỗi";
    }
}

/* ---- Ánh xạ tên chế độ (khớp enum của schema Go và FE) ---- */

TEST(IoConditioning, FailureModeNamesRoundTrip)
{
    EXPECT_EQ(ui_failure_mode_from_string("invalid"), UiFailureMode::INVALID);
    EXPECT_EQ(ui_failure_mode_from_string("hold"), UiFailureMode::HOLD);
    EXPECT_EQ(ui_failure_mode_from_string("fixed"), UiFailureMode::FIXED);
    EXPECT_EQ(ui_failure_mode_from_string("khong-ton-tai"), UiFailureMode::INVALID);
    EXPECT_EQ(ui_failure_mode_from_string(nullptr), UiFailureMode::INVALID);

    EXPECT_STREQ(ui_failure_mode_name(UiFailureMode::INVALID), "invalid");
    EXPECT_STREQ(ui_failure_mode_name(UiFailureMode::HOLD), "hold");
    EXPECT_STREQ(ui_failure_mode_name(UiFailureMode::FIXED), "fixed");
}
