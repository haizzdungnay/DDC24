/**
 * @file  test_st_system_blocks.cpp
 * @brief Issue #801 — khối SYSTEM `RELAY_GUARD`, `STAGER`, `PULSE_GEN`,
 *        `WORD_TO_BITS`, `BITS_TO_WORD`, `UPTIME`
 *        (`SW-SYSTEM-DDC-BLOCKS-MK-DDC-24-VI` §5, T-801-1..5).
 *
 *        Test chạy trên runtime thật (artifact ký, loader thật) với đồng hồ
 *        release giả lập, vì cái sai của các khối này là cái sai THEO THỜI GIAN:
 *        nhịp trôi, đóng dồn, giữ relay quá lâu. T-801-5 dựng lại đúng bốn lỗi
 *        hiện trường bằng mã tự viết kiểu cũ và cho chạy song song với khối
 *        SYSTEM trên cùng chuỗi release — bản cũ phải tái hiện lỗi (chứng minh
 *        test đo đúng thứ cần đo), khối SYSTEM phải không mắc.
 */
#include <gtest/gtest.h>

#include <cstdint>
#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

constexpr int64_t kMs = 1000000;
constexpr int64_t kSec = 1000 * kMs;

class Program {
public:
    explicit Program(const std::string& source)
    {
        StIrModule module;
        StDiagnostic diagnostic;
        ok_ = compile_st_source(source, &module, &diagnostic);
        if (!ok_) {
            ADD_FAILURE() << diagnostic.code << ": " << diagnostic.message;
            return;
        }
        std::vector<uint8_t> bytes;
        std::string error;
        ok_ = serialize_st_ir(module, &bytes, &error) &&
              sign_st_artifact(&bytes, st_test_secret_key());
        if (!ok_) {
            ADD_FAILURE() << error;
            return;
        }
        StLoadError load_error;
        ok_ = runtime_.activate(bytes.data(), bytes.size(), &load_error);
        if (!ok_) ADD_FAILURE() << load_error.code << ": " << load_error.message;
    }

    bool ok() const { return ok_; }

    void set(const char* name, const StValue& value)
    {
        EXPECT_TRUE(runtime_.set_variable(name, value)) << name;
    }
    void set_bool(const char* name, bool value) { set(name, StValue::make_bool(value)); }

    StExecResult run(int64_t now_ns) { return runtime_.execute(now_ns); }

    StValue get(const char* name) const
    {
        StValue value;
        EXPECT_TRUE(runtime_.get_variable(name, &value)) << name;
        return value;
    }
    bool b(const char* name) const { return get(name).b; }
    int32_t i(const char* name) const { return get(name).i; }
    int64_t t(const char* name) const { return get(name).t; }

private:
    StProgramRuntime runtime_;
    bool ok_ = false;
};

/* ---- T-801-1 RELAY_GUARD ---- */

const char* kGuard = R"ST(
PROGRAM G
VAR_INPUT cmd : BOOL; en : BOOL; END_VAR
VAR_OUTPUT q : BOOL; wait : BOOL; starts : DINT; END_VAR
VAR guard : RELAY_GUARD; END_VAR
guard(CMD := cmd, ENABLE := en, MIN_ON := T#10s, MIN_OFF := T#3s);
q := guard.Q;
wait := guard.WAITING;
starts := guard.STARTS;
END_PROGRAM
)ST";

TEST(StSystemBlocks, T801_1_RelayGuardColdStartWaitsMinOffThenHonoursMinOnToOneCycle)
{
    Program p(kGuard);
    ASSERT_TRUE(p.ok());
    p.set_bool("cmd", true);
    p.set_bool("en", true);
    /* Cold start: relay phải nghỉ đủ MIN_OFF trước lần đóng đầu (chống đóng dồn
     * sau mất điện). Chu kỳ 100 ms — đóng đúng ở release đầu tiên >= 3 s. */
    int64_t closed_at = -1;
    for (int64_t now = 0; now <= 4 * kSec; now += 100 * kMs) {
        ASSERT_TRUE(p.run(now).ok);
        if (p.b("q") && closed_at < 0) closed_at = now;
        if (!p.b("q")) {
            EXPECT_TRUE(p.b("wait"));
        }
    }
    EXPECT_EQ(closed_at, 3 * kSec);
    EXPECT_EQ(p.i("starts"), 1);

    /* MIN_ON: nhả lệnh ngay sau khi đóng, relay vẫn giữ tới đúng 10 s. */
    p.set_bool("cmd", false);
    int64_t opened_at = -1;
    for (int64_t now = 4 * kSec; now <= 15 * kSec; now += 100 * kMs) {
        ASSERT_TRUE(p.run(now).ok);
        if (!p.b("q") && opened_at < 0) opened_at = now;
    }
    EXPECT_EQ(opened_at, 13 * kSec);
    EXPECT_FALSE(p.b("wait"));
}

TEST(StSystemBlocks, T801_1_RelayGuardEnableFalseCutsImmediatelyEvenInsideMinOn)
{
    Program p(kGuard);
    ASSERT_TRUE(p.ok());
    p.set_bool("cmd", true);
    p.set_bool("en", true);
    ASSERT_TRUE(p.run(0).ok);
    ASSERT_TRUE(p.run(3 * kSec).ok);
    ASSERT_TRUE(p.b("q"));
    /* 1 s sau khi đóng — còn 9 s MIN_ON — nhưng ENABLE=FALSE là cưỡng bức. */
    p.set_bool("en", false);
    ASSERT_TRUE(p.run(4 * kSec).ok);
    EXPECT_FALSE(p.b("q"));
    EXPECT_FALSE(p.b("wait")) << "WAITING = ENABLE AND (CMD XOR Q)";
    /* Bật lại ENABLE: đường nghỉ tối thiểu tính từ lúc cắt. */
    p.set_bool("en", true);
    ASSERT_TRUE(p.run(6 * kSec).ok);
    EXPECT_FALSE(p.b("q"));
    ASSERT_TRUE(p.run(7 * kSec).ok);
    EXPECT_TRUE(p.b("q"));
    EXPECT_EQ(p.i("starts"), 2);
}

/* ---- T-801-2 STAGER ---- */

const char* kStager = R"ST(
PROGRAM S
VAR_INPUT run : BOOL; demand : REAL; n : INT; hold : BOOL; END_VAR
VAR_OUTPUT stages : INT; target : INT; mask : UINT; END_VAR
VAR stg : STAGER; END_VAR
stg(RUN := run, DEMAND := demand, MAX_STAGES := n, STAGE_DELAY := T#2s, HOLD := hold);
stages := stg.STAGES;
target := stg.TARGET;
mask := stg.MASK;
END_PROGRAM
)ST";

TEST(StSystemBlocks, T801_2_StagerStepsOneAtATimeNeverFasterThanDelayAndReleasesLifo)
{
    Program p(kStager);
    ASSERT_TRUE(p.ok());
    p.set_bool("run", true);
    p.set("demand", StValue::make_real(100.0f));
    p.set("n", StValue::make_int(8));
    p.set_bool("hold", false);

    int32_t previous = 0;
    int64_t last_change = -1;
    int changes = 0;
    auto step = [&](int64_t now) {
        ASSERT_TRUE(p.run(now).ok);
        const int32_t stages = p.i("stages");
        EXPECT_LE(std::abs(stages - previous), 1) << "đổi quá một bậc tại " << now;
        if (stages != previous) {
            if (last_change >= 0) {
                EXPECT_GE(now - last_change, 2 * kSec) << now;
            }
            last_change = now;
            ++changes;
        }
        /* Bậc đóng trước ở bit thấp: MASK luôn liền khối, không "lỗ". */
        EXPECT_EQ(p.i("mask"), (1 << stages) - 1) << now;
        previous = stages;
    };
    for (int64_t now = 0; now <= 20 * kSec; now += 100 * kMs) step(now);
    EXPECT_EQ(previous, 8);
    EXPECT_EQ(p.i("target"), 8);

    /* Giảm về 2 bậc: nhả từng bậc, bit CAO nhất trước (LIFO). */
    p.set("demand", StValue::make_real(25.0f));
    for (int64_t now = 20 * kSec + 100 * kMs; now <= 40 * kSec; now += 100 * kMs) step(now);
    EXPECT_EQ(previous, 2);
    EXPECT_EQ(p.i("mask"), 3);
    EXPECT_EQ(changes, 14);
}

TEST(StSystemBlocks, T801_2_StagerHoldBlocksBothDirectionsAndRunFalseDropsToZero)
{
    Program p(kStager);
    ASSERT_TRUE(p.ok());
    p.set_bool("run", true);
    p.set("demand", StValue::make_real(50.0f));
    p.set("n", StValue::make_int(4));
    p.set_bool("hold", false);
    for (int64_t now = 0; now <= 4 * kSec; now += 100 * kMs) ASSERT_TRUE(p.run(now).ok);
    ASSERT_EQ(p.i("stages"), 2);

    p.set_bool("hold", true);
    p.set("demand", StValue::make_real(100.0f));
    for (int64_t now = 5 * kSec; now <= 15 * kSec; now += 100 * kMs) ASSERT_TRUE(p.run(now).ok);
    EXPECT_EQ(p.i("stages"), 2) << "HOLD chặn tăng";
    p.set("demand", StValue::make_real(0.0f));
    for (int64_t now = 16 * kSec; now <= 26 * kSec; now += 100 * kMs) ASSERT_TRUE(p.run(now).ok);
    EXPECT_EQ(p.i("stages"), 2) << "HOLD chặn giảm";

    p.set_bool("run", false);
    ASSERT_TRUE(p.run(27 * kSec).ok);
    EXPECT_EQ(p.i("stages"), 0);
    EXPECT_EQ(p.i("mask"), 0);
}

TEST(StSystemBlocks, T801_2_StagerMaxStagesOutsideOneToSixteenFaults)
{
    for (int32_t bad : {0, 17, -1}) {
        Program p(kStager);
        ASSERT_TRUE(p.ok());
        p.set_bool("run", true);
        p.set("demand", StValue::make_real(50.0f));
        p.set("n", StValue::make_int(bad));
        const StExecResult result = p.run(0);
        EXPECT_FALSE(result.ok) << bad;
        ASSERT_NE(result.fault_code, nullptr);
        EXPECT_STREQ(result.fault_code, st_diag_code::kRtLimitMinMax);
    }
}

/* ---- T-801-3 PULSE_GEN ---- */

const char* kPulse = R"ST(
PROGRAM P
VAR_INPUT run : BOOL; t_on : TIME; t_off : TIME; END_VAR
VAR_OUTPUT q : BOOL; tick : BOOL; count : DINT; END_VAR
VAR pg : PULSE_GEN; END_VAR
pg(RUN := run, T_ON := t_on, T_OFF := t_off);
q := pg.Q;
tick := pg.TICK;
count := pg.COUNT;
END_PROGRAM
)ST";

TEST(StSystemBlocks, T801_3_PulseGenHasZeroAccumulatedPhaseErrorOver10000Cycles)
{
    Program p(kPulse);
    ASSERT_TRUE(p.ok());
    p.set_bool("run", true);
    p.set("t_on", StValue::make_time(300 * kMs));
    p.set("t_off", StValue::make_time(400 * kMs));
    const int64_t period = 700 * kMs;
    int ticks = 0;
    int phase_errors = 0;
    for (int cycle = 0; cycle < 10000; ++cycle) {
        const int64_t now = cycle * 100 * kMs;
        ASSERT_TRUE(p.run(now).ok);
        /* Mốc lý thuyết: Q bật trong [k·T, k·T + T_ON). */
        const bool expected_q = (now % period) < 300 * kMs;
        if (p.b("q") != expected_q) ++phase_errors;
        if (p.b("tick")) {
            ++ticks;
            EXPECT_EQ(now % period, 0) << "TICK lệch pha tại " << now;
        }
    }
    EXPECT_EQ(phase_errors, 0);
    /* Chu kỳ hoàn tất trong (0, 999.9 s]: k·0.7 s với k = 1..1428. */
    EXPECT_EQ(ticks, 1428);
    EXPECT_EQ(p.i("count"), 1428);
}

TEST(StSystemBlocks, T801_3_PulseGenZeroPeriodFaultsAndRunFalseResets)
{
    Program p(kPulse);
    ASSERT_TRUE(p.ok());
    p.set_bool("run", true);
    p.set("t_on", StValue::make_time(0));
    p.set("t_off", StValue::make_time(0));
    const StExecResult result = p.run(0);
    EXPECT_FALSE(result.ok);
    ASSERT_NE(result.fault_code, nullptr);
    EXPECT_STREQ(result.fault_code, st_diag_code::kRtLimitMinMax);

    Program q(kPulse);
    ASSERT_TRUE(q.ok());
    q.set_bool("run", true);
    q.set("t_on", StValue::make_time(1 * kSec));
    q.set("t_off", StValue::make_time(1 * kSec));
    ASSERT_TRUE(q.run(0).ok);
    EXPECT_TRUE(q.b("q"));
    q.set_bool("run", false);
    ASSERT_TRUE(q.run(500 * kMs).ok);
    EXPECT_FALSE(q.b("q"));
    EXPECT_FALSE(q.b("tick"));
    /* Chạy lại: mốc mới tính từ lúc RUN lên, không kế thừa pha cũ. */
    q.set_bool("run", true);
    ASSERT_TRUE(q.run(700 * kMs).ok);
    EXPECT_TRUE(q.b("q"));
    ASSERT_TRUE(q.run(1700 * kMs).ok);
    EXPECT_FALSE(q.b("q"));
}

/* ---- T-801-4 WORD_TO_BITS ∘ BITS_TO_WORD ---- */

TEST(StSystemBlocks, T801_4_WordToBitsThenBitsToWordIsIdentityOnAll65536Values)
{
    Program p(R"ST(
PROGRAM W
VAR_INPUT w : UINT; END_VAR
VAR_OUTPUT back : UINT; b15 : BOOL; END_VAR
VAR wb : WORD_TO_BITS; END_VAR
wb(IN := w);
back := BITS_TO_WORD(wb.B00, wb.B01, wb.B02, wb.B03, wb.B04, wb.B05, wb.B06, wb.B07,
                     wb.B08, wb.B09, wb.B10, wb.B11, wb.B12, wb.B13, wb.B14, wb.B15);
b15 := wb.B15;
END_PROGRAM
)ST");
    ASSERT_TRUE(p.ok());
    int mismatches = 0;
    for (int32_t value = 0; value <= 0xFFFF; ++value) {
        p.set("w", StValue::make_uint(static_cast<uint16_t>(value)));
        ASSERT_TRUE(p.run(value).ok);
        if (p.i("back") != value) ++mismatches;
        if (p.b("b15") != ((value & 0x8000) != 0)) ++mismatches;
    }
    EXPECT_EQ(mismatches, 0);
}

TEST(StSystemBlocks, BitsToWordRejectsNonBoolArgumentsAndWrongArity)
{
    for (const char* body : {"out := BITS_TO_WORD(1, FALSE);", "out := BITS_TO_WORD();"}) {
        const std::string source = std::string("PROGRAM X\nVAR out : UINT; END_VAR\n") +
                                   body + "\nEND_PROGRAM\n";
        StIrModule module;
        StDiagnostic diagnostic;
        EXPECT_FALSE(compile_st_source(source, &module, &diagnostic)) << body;
    }
}

/* ---- UPTIME ---- */

TEST(StSystemBlocks, UptimeCountsFromFirstExecutionAndIsRejectedInsideFunction)
{
    Program p(R"ST(
PROGRAM U
VAR_OUTPUT up : TIME; END_VAR
up := UPTIME();
END_PROGRAM
)ST");
    ASSERT_TRUE(p.ok());
    ASSERT_TRUE(p.run(50 * kSec).ok);
    EXPECT_EQ(p.t("up"), 0) << "mốc là lần thực thi đầu, không phải đồng hồ tuyệt đối";
    ASSERT_TRUE(p.run(50 * kSec + 1234 * kMs).ok);
    EXPECT_EQ(p.t("up"), 1234 * kMs);

    const std::vector<StPouTextSource> sources = {
        {"Main", "Main", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR x : TIME; END_VAR\nx := F();\nEND_PROGRAM\n", {}},
        {"F", "F", StPouTextSource::Language::ST, StPouKind::FUNCTION,
         "FUNCTION F : TIME\nF := UPTIME();\nEND_FUNCTION\n", {}},
    };
    StPouBundleCompileResult bundle;
    StDiagnostic diagnostic;
    EXPECT_FALSE(compile_st_pou_bundle(sources, {}, &bundle, &diagnostic));
    EXPECT_EQ(diagnostic.code, std::string(st_diag_code::kPouFunctionNotPure));
}

/* ---- T-801-5 Tái hiện bốn lỗi hiện trường (differential) ---- */

/* Lỗi #1: nhịp tự viết bằng TON nạp lại `IN := NOT Q` mất hai release mỗi chu
 * kỳ (một để thấy Q, một để nạp lại), nên chu kỳ quét 100 ms kéo nhịp 1,0 s
 * thành 1,2 s. */
TEST(StSystemBlocks, T801_5_Bug1_SelfReloadingTonDriftsButPulseGenDoesNot)
{
    Program p(R"ST(
PROGRAM B1
VAR_OUTPUT old_ticks : DINT; new_ticks : DINT; END_VAR
VAR blink : TON; pg : PULSE_GEN; END_VAR
blink(IN := NOT blink.Q, PT := T#1s);
IF blink.Q THEN old_ticks := old_ticks + 1; END_IF;
pg(RUN := TRUE, T_ON := T#500ms, T_OFF := T#500ms);
new_ticks := pg.COUNT;
END_PROGRAM
)ST");
    ASSERT_TRUE(p.ok());
    for (int64_t now = 0; now <= 60 * kSec; now += 100 * kMs) ASSERT_TRUE(p.run(now).ok);
    EXPECT_EQ(p.i("new_ticks"), 60);
    EXPECT_EQ(p.i("old_ticks"), 50) << "bản cũ phải tái hiện đúng độ trôi 1,2 s";
}

/* Lỗi #2 và #3: bậc tải tự viết theo `TARGET` đóng dồn mọi relay trong một
 * release, và khi giảm bậc thì nhả sai bit tạo "lỗ". */
TEST(StSystemBlocks, T801_5_Bug2And3_NaiveStagingJumpsButStagerStepsAndStaysContiguous)
{
    Program p(R"ST(
PROGRAM B2
VAR_INPUT demand : REAL; END_VAR
VAR_OUTPUT old_n : INT; new_n : INT; new_mask : UINT; END_VAR
VAR stg : STAGER; END_VAR
old_n := REAL_TO_INT(demand * 7.0 / 100.0);
stg(RUN := TRUE, DEMAND := demand, MAX_STAGES := 7, STAGE_DELAY := T#1s, HOLD := FALSE);
new_n := stg.STAGES;
new_mask := stg.MASK;
END_PROGRAM
)ST");
    ASSERT_TRUE(p.ok());
    p.set("demand", StValue::make_real(0.0f));
    ASSERT_TRUE(p.run(0).ok);
    p.set("demand", StValue::make_real(100.0f));
    ASSERT_TRUE(p.run(100 * kMs).ok);
    EXPECT_EQ(p.i("old_n"), 7) << "bản cũ đóng dồn 7 relay trong một release";
    EXPECT_LE(p.i("new_n"), 1);
    int32_t previous = p.i("new_n");
    for (int64_t now = 200 * kMs; now <= 10 * kSec; now += 100 * kMs) {
        ASSERT_TRUE(p.run(now).ok);
        EXPECT_LE(p.i("new_n") - previous, 1);
        EXPECT_EQ(p.i("new_mask"), (1 << p.i("new_n")) - 1);
        previous = p.i("new_n");
    }
    EXPECT_EQ(previous, 7);
}

/* Lỗi #4: relay tự viết giữ MIN_ON bằng TON nên đổi chế độ tải vẫn bị giữ tới
 * 10 s; `RELAY_GUARD` với `ENABLE=FALSE` cắt ngay. */
TEST(StSystemBlocks, T801_5_Bug4_HandwrittenMinOnHoldsRelayButGuardCutsOnDisable)
{
    Program p(R"ST(
PROGRAM B4
VAR_INPUT cmd : BOOL; mode_ok : BOOL; END_VAR
VAR_OUTPUT old_q : BOOL; new_q : BOOL; END_VAR
VAR hold_on : TOF; guard : RELAY_GUARD; END_VAR
hold_on(IN := cmd AND mode_ok, PT := T#10s);
old_q := hold_on.Q;
guard(CMD := cmd, ENABLE := mode_ok, MIN_ON := T#10s, MIN_OFF := T#0s);
new_q := guard.Q;
END_PROGRAM
)ST");
    ASSERT_TRUE(p.ok());
    p.set_bool("cmd", true);
    p.set_bool("mode_ok", true);
    ASSERT_TRUE(p.run(0).ok);
    ASSERT_TRUE(p.run(1 * kSec).ok);
    ASSERT_TRUE(p.b("old_q"));
    ASSERT_TRUE(p.b("new_q"));
    p.set_bool("mode_ok", false);
    ASSERT_TRUE(p.run(2 * kSec).ok);
    EXPECT_TRUE(p.b("old_q")) << "bản cũ còn giữ relay sau khi đổi chế độ";
    EXPECT_FALSE(p.b("new_q"));
}

} // namespace
} // namespace core
