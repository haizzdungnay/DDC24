/**
 * @file  test_st_pid_closed_loop.cpp
 * @brief Issue #802 — bằng chứng vòng kín cho khối `PID` trước khi ký token
 *        Controls/Safety (`EV-PROG-PID-APPROVAL-20260928`).
 *
 *        Các test PID trong `test_st_exec.cpp` kiểm từng chu kỳ với PV cố định.
 *        Ở đây PID chạy trên runtime THẬT (artifact đã ký, `StProgramRuntime`)
 *        nối với một đối tượng quán tính bậc một, rời rạc hoá chính xác (ZOH):
 *
 *            y[k+1] = a·y[k] + (1 − a)·K·u[k],   a = exp(−Ts/τ)
 *
 *        τ = 5 s, K = 1, Ts = 100 ms; KP = 2, KI = 0,5, KD = 0; OUT 0..100.
 *        `ACTUAL` của chu kỳ k là giá trị đã THẬT SỰ áp vào đối tượng ở chu kỳ
 *        k − 1 — đúng hợp đồng DDD-CTRL-PROG-001 §7, nên override là "đối tượng
 *        nhận giá trị khác OUT", không phải một cờ test tự bật.
 *
 *        Review gate TẮT như mọi harness PID khác: bằng chứng phải dựng được
 *        độc lập với trạng thái token — nó có trước chữ ký, và vẫn phải chạy
 *        được nếu token bị thu hồi.
 *
 *        Mỗi test in một dòng `[PID-EVIDENCE]` với số đo thật để hồ sơ bằng
 *        chứng dẫn lại (chạy nhị phân `core_tests --gtest_filter=StPidClosedLoop.*`).
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

constexpr int64_t kCycleNs = 100000000ll;  // Task 100 ms
constexpr double kCycleS = 0.1;
constexpr double kTauS = 5.0;
constexpr double kPlantGain = 1.0;
constexpr float kKp = 2.0f;
constexpr float kKi = 0.5f;
constexpr float kOutMin = 0.0f;
constexpr float kOutMax = 100.0f;

int cycles(double seconds) { return static_cast<int>(std::lround(seconds / kCycleS)); }

const char* kPidProgram = R"ST(
PROGRAM t
VAR_INPUT  sp : REAL; pv : REAL; kp : REAL; ki : REAL; kd : REAL;
           lo : REAL; hi : REAL; act : REAL; END_VAR
VAR_OUTPUT y : REAL; tr : BOOL; END_VAR
VAR loop1 : PID; END_VAR
    loop1(SP := sp, PV := pv, KP := kp, KI := ki, KD := kd,
          OUT_MIN := lo, OUT_MAX := hi, ACTUAL := act);
    y := loop1.OUT;
    tr := loop1.TRACKING;
END_PROGRAM
)ST";

struct Sample {
    double t_s = 0.0;
    float sp = 0.0f;
    double pv = 0.0;       // PV đưa vào chu kỳ này
    double actual = 0.0;   // ACTUAL đưa vào chu kỳ này (giá trị áp ở chu kỳ trước)
    float out = 0.0f;      // OUT chu kỳ này
    bool tracking = false;
    double applied = 0.0;  // giá trị thật áp vào đối tượng sau chu kỳ này
};

/* Vòng kín: PID trên runtime thật + đối tượng bậc một. `feed_actual_as_out`
 * chỉ dùng cho phép PHẢN CHỨNG: controller bị báo sai rằng OUT đã được áp. */
class ClosedLoop {
public:
    bool start()
    {
        StIrModule module;
        StDiagnostic diagnostic;
        StCompileOptions options;
        options.enforce_review_gate = false;
        if (!compile_st_source(kPidProgram, &module, &diagnostic, options)) {
            ADD_FAILURE() << diagnostic.code << ": " << diagnostic.message;
            return false;
        }
        std::vector<uint8_t> bytes;
        std::string error;
        if (!serialize_st_ir(module, &bytes, &error) ||
            !sign_st_artifact(&bytes, st_test_secret_key())) {
            ADD_FAILURE() << "không đóng gói/ký được artifact: " << error;
            return false;
        }
        StLoadError load_error;
        if (!runtime_.activate(bytes.data(), bytes.size(), &load_error)) {
            ADD_FAILURE() << load_error.code << ": " << load_error.message;
            return false;
        }
        set_real("kp", kKp);
        set_real("ki", kKi);
        set_real("kd", 0.0f);
        set_real("lo", kOutMin);
        set_real("hi", kOutMax);
        return true;
    }

    /* Một chu kỳ Task. `forced` < 0 nghĩa là không override: đối tượng nhận OUT. */
    Sample step(float sp, double forced = -1.0, bool feed_actual_as_out = false)
    {
        Sample sample;
        sample.t_s = static_cast<double>(k_) * kCycleS;
        sample.sp = sp;
        sample.pv = y_;
        sample.actual = feed_actual_as_out ? last_out_ : last_applied_;
        set_real("sp", sp);
        set_real("pv", static_cast<float>(y_));
        set_real("act", static_cast<float>(sample.actual));
        const StExecResult result = runtime_.execute(k_ * kCycleNs);
        EXPECT_TRUE(result.ok) << "chu kỳ " << k_ << " fault " << result.fault_code;
        StValue value;
        EXPECT_TRUE(runtime_.get_variable("y", &value));
        sample.out = value.r;
        EXPECT_TRUE(runtime_.get_variable("tr", &value));
        sample.tracking = value.b;
        sample.applied = forced >= 0.0 ? forced : static_cast<double>(sample.out);

        y_ = a_ * y_ + (1.0 - a_) * kPlantGain * sample.applied;
        last_applied_ = sample.applied;
        last_out_ = sample.out;
        ++k_;
        return sample;
    }

    double y() const { return y_; }

private:
    void set_real(const char* name, float value)
    {
        ASSERT_TRUE(runtime_.set_variable(name, StValue::make_real(value))) << name;
    }

    StProgramRuntime runtime_;
    double a_ = std::exp(-kCycleS / kTauS);
    double y_ = 0.0;
    double last_applied_ = 0.0;
    double last_out_ = 0.0;
    int64_t k_ = 0;
};

/* Tích phân suy ngược từ OUT khi chưa bão hoà: OUT = KP·e + (I + KI·e·Ts).
 * Runtime không lộ state nội bộ, nên đây là cách đọc I mà không mở cửa sau. */
double integral_estimate(const Sample& sample)
{
    const double error = static_cast<double>(sample.sp) - sample.pv;
    return static_cast<double>(sample.out) - kKp * error - kKi * error * kCycleS;
}

} // namespace

/* (a) Đáp ứng bậc thang từ 0 lên SP = 40: vào dải ±2 % và ở lại, sai số xác
 * lập ≈ 0 (khâu I triệt tiêu sai số với đối tượng tự cân bằng). */
TEST(StPidClosedLoop, ConvergesToSetpointWithinTwoPercentAndZeroSteadyStateError)
{
    ClosedLoop loop;
    ASSERT_TRUE(loop.start());
    constexpr float kSp = 40.0f;
    const double band = 0.02 * kSp;

    std::vector<Sample> samples;
    for (int i = 0; i < cycles(60.0); ++i) samples.push_back(loop.step(kSp));

    int settle_index = -1;
    for (int i = 0; i < static_cast<int>(samples.size()); ++i) {
        if (std::abs(samples[static_cast<std::size_t>(i)].pv - kSp) > band) settle_index = -1;
        else if (settle_index < 0) settle_index = i;
    }
    ASSERT_GE(settle_index, 0) << "không vào được dải ±2 % trong 60 s";
    const double settle_s = samples[static_cast<std::size_t>(settle_index)].t_s;
    double peak = 0.0;
    for (const Sample& sample : samples) peak = std::max(peak, sample.pv);
    const double final_error = kSp - loop.y();
    bool any_tracking = false;
    for (const Sample& sample : samples) any_tracking = any_tracking || sample.tracking;

    std::printf("[PID-EVIDENCE] (a) settle2%%=%.1fs peak=%.4f overshoot=%.3f%% final_error=%.6f\n",
                settle_s, peak, (peak - kSp) / kSp * 100.0, final_error);
    EXPECT_LE(settle_s, 15.0) << "vào dải ±2 % quá chậm so với τ = 5 s";
    EXPECT_LT(std::abs(final_error), 0.01) << "sai số xác lập phải ≈ 0";
    EXPECT_FALSE(any_tracking) << "vận hành thường, ACTUAL = OUT: không được báo override giả";
}

/* (b) SP = 150 không với tới (K·OUT_MAX = 100) giữ OUT ở biên 60 s, rồi hạ SP
 * xuống 50. Anti-windup đúng thì OUT rời biên NGAY chu kỳ đầu và vọt lố ≤ 5 %;
 * tích phân bị wind up thì OUT kẹt ở biên hàng chục giây và PV lao quá đích. */
TEST(StPidClosedLoop, LeavesSaturationImmediatelyAndOvershootsAtMostFivePercent)
{
    ClosedLoop loop;
    ASSERT_TRUE(loop.start());
    constexpr float kHigh = 150.0f;
    constexpr float kLow = 50.0f;

    int saturated = 0;
    const int saturation_cycles = cycles(60.0);
    for (int i = 0; i < saturation_cycles; ++i)
        if (loop.step(kHigh).out == kOutMax) ++saturated;
    EXPECT_EQ(saturated, saturation_cycles) << "phải thật sự bão hoà suốt 60 s";
    const double pv_before = loop.y();

    std::vector<Sample> after;
    for (int i = 0; i < cycles(90.0); ++i) after.push_back(loop.step(kLow));

    int cycles_at_max = 0;
    while (cycles_at_max < static_cast<int>(after.size()) &&
           after[static_cast<std::size_t>(cycles_at_max)].out == kOutMax)
        ++cycles_at_max;
    double lowest = after.front().pv;
    for (const Sample& sample : after) lowest = std::min(lowest, sample.pv);
    const double overshoot_pct = std::max(0.0, kLow - lowest) / kLow * 100.0;
    const double overshoot_step_pct = std::max(0.0, kLow - lowest) / (pv_before - kLow) * 100.0;

    std::printf("[PID-EVIDENCE] (b) pv_at_setpoint_change=%.4f out_first=%.4f cycles_at_max_after=%d "
                "lowest_pv=%.4f overshoot=%.3f%%_of_sp %.3f%%_of_step final_pv=%.4f\n",
                pv_before, static_cast<double>(after.front().out), cycles_at_max, lowest,
                overshoot_pct, overshoot_step_pct, loop.y());
    EXPECT_EQ(cycles_at_max, 0) << "OUT phải rời OUT_MAX ngay chu kỳ đầu sau khi hạ SP";
    EXPECT_LE(overshoot_pct, 5.0);
    EXPECT_LT(std::abs(loop.y() - kLow), 0.02 * kLow) << "phải về lại dải ±2 % của SP mới";
}

/* (c) Nguồn ưu tiên cao hơn giữ đối tượng ở 10 trong 30 s. Mọi chu kỳ thấy
 * ACTUAL = 10 phải báo TRACKING, tích phân không nhận thêm gì, và lúc nhả OUT
 * nối tiếp liền mạch thay vì nhảy lên biên. Phép phản chứng ở cuối chứng minh
 * test phân biệt được: nếu controller bị báo sai rằng OUT đã được áp, tích phân
 * wind và OUT đứng ở OUT_MAX đúng lúc nhả. */
TEST(StPidClosedLoop, OverrideFreezesIntegralAndReleaseDoesNotJumpToLimit)
{
    constexpr float kSp = 30.0f;
    constexpr double kForced = 10.0;
    const int settle = cycles(60.0);
    const int hold = cycles(30.0);

    ClosedLoop loop;
    ASSERT_TRUE(loop.start());
    std::vector<Sample> samples;
    for (int i = 0; i < settle; ++i) samples.push_back(loop.step(kSp));
    for (int i = 0; i < hold; ++i) samples.push_back(loop.step(kSp, kForced));
    for (int i = 0; i < cycles(60.0); ++i) samples.push_back(loop.step(kSp));

    /* Chu kỳ `settle` là chu kỳ đầu đối tượng nhận 10; ACTUAL = 10 xuất hiện từ
     * chu kỳ kế và kéo tới chu kỳ nhả (`settle + hold`) — ACTUAL trễ một chu kỳ. */
    const std::size_t first_seen = static_cast<std::size_t>(settle + 1);
    const std::size_t release = static_cast<std::size_t>(settle + hold);
    const double integral_before = integral_estimate(samples[static_cast<std::size_t>(settle) - 1]);

    int tracking_hits = 0;
    double integral_drift = 0.0;
    float out_max_during = kOutMin;
    for (std::size_t i = first_seen; i <= release; ++i) {
        const Sample& sample = samples[i];
        if (sample.tracking) ++tracking_hits;
        integral_drift = std::max(integral_drift,
                                  std::abs(integral_estimate(sample) - integral_before));
        out_max_during = std::max(out_max_during, sample.out);
    }
    bool tracking_before = false;
    for (std::size_t i = 0; i < static_cast<std::size_t>(settle); ++i)
        tracking_before = tracking_before || samples[i].tracking;
    bool tracking_after = false;
    float out_max_after = kOutMin;
    for (std::size_t i = release + 1; i < samples.size(); ++i) {
        tracking_after = tracking_after || samples[i].tracking;
        out_max_after = std::max(out_max_after, samples[i].out);
    }
    const int expected_hits = static_cast<int>(release - first_seen + 1);
    const float release_step = samples[release].out - samples[release - 1].out;

    std::printf("[PID-EVIDENCE] (c) integral_before=%.4f max_integral_drift=%.6f tracking=%d/%d "
                "out_max_during=%.4f out_at_release=%.4f release_step=%.4f out_max_after=%.4f "
                "final_pv=%.4f\n",
                integral_before, integral_drift, tracking_hits, expected_hits,
                static_cast<double>(out_max_during), static_cast<double>(samples[release].out),
                static_cast<double>(release_step), static_cast<double>(out_max_after), loop.y());
    EXPECT_FALSE(tracking_before) << "chưa override mà đã báo TRACKING";
    EXPECT_EQ(tracking_hits, expected_hits) << "mọi chu kỳ thấy ACTUAL = 10 phải báo TRACKING";
    EXPECT_LT(integral_drift, 0.01) << "tích phân bị nạp trong lúc override";
    EXPECT_LT(samples[release].out, kOutMax) << "nhả override mà OUT nhảy lên biên";
    EXPECT_LT(std::abs(release_step), 1.0f) << "OUT phải nối tiếp liền mạch lúc nhả";
    EXPECT_LT(out_max_after, kOutMax);
    EXPECT_FALSE(tracking_after) << "đã nhả mà vẫn báo TRACKING";
    EXPECT_LT(std::abs(loop.y() - kSp), 0.02 * kSp);

    /* Phản chứng: cùng đối tượng bị giữ ở 10, nhưng ACTUAL báo đúng OUT. */
    ClosedLoop blind;
    ASSERT_TRUE(blind.start());
    for (int i = 0; i < settle; ++i) blind.step(kSp);
    Sample blind_release;
    for (int i = 0; i < hold; ++i) blind_release = blind.step(kSp, kForced, /*feed_actual_as_out=*/true);
    blind_release = blind.step(kSp, -1.0, /*feed_actual_as_out=*/true);
    std::printf("[PID-EVIDENCE] (c-phan-chung) out_at_release_without_tracking=%.4f tracking=%d\n",
                static_cast<double>(blind_release.out), blind_release.tracking ? 1 : 0);
    EXPECT_EQ(blind_release.out, kOutMax)
        << "phản chứng phải wind tới biên — nếu không, test (c) không phân biệt được gì";
    EXPECT_FALSE(blind_release.tracking);
}

/* Ngưỡng override-detect đã duyệt: 1 % dải OUT_MIN..OUT_MAX (= 1,0 với dải
 * 0..100). Lệch 0,9 không phải override; lệch 1,1 là override. */
TEST(StPidClosedLoop, OverrideDetectThresholdIsOnePercentOfOutputSpan)
{
    for (const double deviation : {0.9, 1.1}) {
        ClosedLoop loop;
        ASSERT_TRUE(loop.start());
        Sample last;
        for (int i = 0; i < cycles(60.0); ++i) last = loop.step(30.0f);
        const Sample probe = loop.step(30.0f, static_cast<double>(last.out) + deviation);
        const Sample seen = loop.step(30.0f);
        (void)probe;
        std::printf("[PID-EVIDENCE] (d) deviation=%.1f tracking=%d\n", deviation, seen.tracking ? 1 : 0);
        EXPECT_EQ(seen.tracking, deviation > 1.0) << "deviation=" << deviation;
    }
}

} // namespace core
