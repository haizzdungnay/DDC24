/**
 * @file  test_st_exec.cpp
 * @brief ZERO_ALLOCATION_GATE + ngữ nghĩa thực thi.
 *
 *        Test quan trọng nhất file này là AllocationCounter: nó đếm số lần
 *        operator new được gọi trong 1000 chu kỳ và yêu cầu bằng 0. Đây là
 *        cách duy nhất biến "không cấp phát trong scan path" từ ý định thành
 *        thuộc tính kiểm được (PROGRAM_SOM_FW_DRAFT_DESIGN §7.2).
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"
#include "tests/allocation_probe.hpp"

namespace core {
namespace {

std::vector<uint8_t> build(const std::string& src)
{
    StIrModule mod;
    StDiagnostic diag;
    EXPECT_TRUE(compile_st_source(src, &mod, &diag))
        << diag.code << ": " << diag.message << " @" << diag.line << ":" << diag.column;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Nạp và trả runtime đã sẵn sàng chạy. */
bool make_runtime(const std::string& src, StProgramRuntime* rt)
{
    const std::vector<uint8_t> a = build(src);
    StLoadError err;
    const bool ok = rt->activate(a.data(), a.size(), &err);
    EXPECT_TRUE(ok) << err.code << ": " << err.message;
    return ok;
}

float get_real(StProgramRuntime& rt, const char* name)
{
    StValue v;
    EXPECT_TRUE(rt.get_variable(name, &v));
    return v.r;
}
int32_t get_int(StProgramRuntime& rt, const char* name)
{
    StValue v;
    EXPECT_TRUE(rt.get_variable(name, &v));
    return v.i;
}
bool get_bool(StProgramRuntime& rt, const char* name)
{
    StValue v;
    EXPECT_TRUE(rt.get_variable(name, &v));
    return v.b;
}

constexpr int64_t kSec = 1000000000ll;

} // namespace

/* ---- ZERO_ALLOCATION_GATE ---- */

TEST(StExec, ThousandCyclesAllocateNothing)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; c : BOOL; END_VAR
VAR dly : TON; n : INT; END_VAR
    b := LIMIT(0.0, a * 2.0 + 1.0, 100.0);
    dly(IN := a > 1.0, PT := T#5s);
    c := dly.Q;
    IF c THEN n := n + 1; ELSE n := 0; END_IF;
END_PROGRAM
)ST", &rt));

    rt.set_variable("a", StValue::make_real(2.0f));

    /* Chạy trước 1 chu kỳ ngoài vùng đo, để mọi khởi tạo lười (nếu có) xảy
     * ra ở đây chứ không lẫn vào phép đo. */
    rt.execute(0);

    std::size_t allocations = 0;
    bool all_ok = true;
    {
        allocation_probe::ScopedCounter counter;
        for (int i = 0; i < 1000; i++) {
            if (!rt.execute(static_cast<int64_t>(i) * kSec).ok) { all_ok = false; break; }
        }
        allocations = counter.allocations();
    }
    EXPECT_TRUE(all_ok) << "một chu kỳ bị fault trong vùng đo";
    EXPECT_EQ(allocations, 0u)
        << "scan path phải KHÔNG cấp phát; đếm được " << allocations << " lần";
}

TEST(StExec, AllocationCounterItselfWorks)
{
    /* Nếu bộ đếm hỏng thì test trên vô nghĩa — kiểm chính bộ đếm. */
    std::size_t n = 0;
    {
        allocation_probe::ScopedCounter counter;
        std::vector<int> v;
        v.reserve(64);
        n = counter.allocations();
    }
    EXPECT_GT(n, 0u);
}

/* ---- Số học ---- */

TEST(StExec, ArithmeticRealComputesCorrectly)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := (a + 1.0) * 2.0 - 3.0;
END_PROGRAM
)ST", &rt));
    rt.set_variable("a", StValue::make_real(4.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "b"), 7.0f);
}

TEST(StExec, IntegerDivisionTruncatesTowardZero)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : INT; END_VAR
VAR_OUTPUT b : INT; END_VAR
    b := a / 3;
END_PROGRAM
)ST", &rt));
    rt.set_variable("a", StValue::make_int(-7));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_EQ(get_int(rt, "b"), -2);
}

TEST(StExec, ModSignFollowsDividend)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : INT; END_VAR
VAR_OUTPUT b : INT; END_VAR
    b := a MOD 3;
END_PROGRAM
)ST", &rt));
    rt.set_variable("a", StValue::make_int(-7));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_EQ(get_int(rt, "b"), -1);
}

/* ---- Runtime fault ---- */

TEST(StExec, IntOverflowIsFaultNotWraparound)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : INT; END_VAR
VAR_OUTPUT b : INT; END_VAR
    b := a + 1;
END_PROGRAM
)ST", &rt));
    ASSERT_TRUE(rt.set_variable("a", StValue::make_int(32767)));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    ASSERT_NE(r.fault_code, nullptr);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtIntOverflow);
}

TEST(StExec, DintOverflowIsFaultNotWraparound)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : DINT; END_VAR
VAR_OUTPUT b : DINT; END_VAR
    b := a + 1;
END_PROGRAM
)ST", &rt));
    ASSERT_TRUE(rt.set_variable("a", StValue::make_dint(INT32_MAX)));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtIntOverflow);
}

TEST(StExec, UintUnderflowIsFaultNotWraparound)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : UINT; END_VAR
VAR_OUTPUT b : UINT; END_VAR
    b := a - 1;
END_PROGRAM
)ST", &rt));
    ASSERT_TRUE(rt.set_variable("a", StValue::make_uint(0)));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtIntOverflow);
}

TEST(StExec, ExplicitIntegerConversionsAreRangeChecked)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  source : DINT; END_VAR
VAR_OUTPUT narrowed : INT; unsignedValue : UINT; END_VAR
    narrowed := DINT_TO_INT(source);
    unsignedValue := DINT_TO_UINT(source);
END_PROGRAM
)ST", &rt));
    ASSERT_TRUE(rt.set_variable("source", StValue::make_dint(40000)));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtConvOutOfRange);
}

TEST(StExec, DivideByZeroIsFault)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : REAL; d : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a / d;
END_PROGRAM
)ST", &rt));
    rt.set_variable("a", StValue::make_real(1.0f));
    rt.set_variable("d", StValue::make_real(0.0f));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtDivByZero);
}

TEST(StExec, SqrtNegativeIsFault)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := SQRT(a);
END_PROGRAM
)ST", &rt));
    rt.set_variable("a", StValue::make_real(-1.0f));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtSqrtNegative);
}

TEST(StExec, LimitWithMinAboveMaxIsFault)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  lo : REAL; hi : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := LIMIT(lo, 5.0, hi);
END_PROGRAM
)ST", &rt));
    rt.set_variable("lo", StValue::make_real(10.0f));
    rt.set_variable("hi", StValue::make_real(0.0f));
    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtLimitMinMax);
}

TEST(StExec, FaultRestoresStateCompletely)
{
    /* Bảo đảm "không commit nửa chừng": chu kỳ lỗi phải để lại trạng thái
     * y hệt trước khi chạy, kể cả biến đã gán ở lệnh TRƯỚC lệnh lỗi. */
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  d : REAL; END_VAR
VAR_OUTPUT b : REAL; c : REAL; END_VAR
    b := 42.0;
    c := 1.0 / d;
END_PROGRAM
)ST", &rt));
    rt.set_variable("d", StValue::make_real(0.0f));
    const float before = get_real(rt, "b");
    const StExecResult r = rt.execute(0);
    ASSERT_FALSE(r.ok);
    EXPECT_FLOAT_EQ(get_real(rt, "b"), before)
        << "b bị commit dù chu kỳ fault ở lệnh sau";
}

TEST(StExec, FaultReportsSourcePosition)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  d : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := 1.0 / d;
END_PROGRAM
)ST", &rt));
    rt.set_variable("d", StValue::make_real(0.0f));
    const StExecResult r = rt.execute(0);
    ASSERT_FALSE(r.ok);
    EXPECT_GT(r.fault_line, 0) << "fault phải chỉ được về dòng ST gốc";
}

/* ---- Điều khiển luồng ---- */

TEST(StExec, ElsifSelectsCorrectBranch)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  a : INT; END_VAR
VAR_OUTPUT b : INT; END_VAR
    IF a > 10 THEN b := 1;
    ELSIF a > 5 THEN b := 2;
    ELSIF a > 0 THEN b := 3;
    ELSE b := 4;
    END_IF;
END_PROGRAM
)ST", &rt));
    const int cases[][2] = {{20, 1}, {7, 2}, {3, 3}, {-1, 4}};
    for (const auto& c : cases) {
        rt.set_variable("a", StValue::make_int(c[0]));
        ASSERT_TRUE(rt.execute(0).ok);
        EXPECT_EQ(get_int(rt, "b"), c[1]) << "a=" << c[0];
    }
}

TEST(StExec, LogicalOperatorsEvaluateFully)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  x : BOOL; y : BOOL; END_VAR
VAR_OUTPUT a : BOOL; o : BOOL; e : BOOL; END_VAR
    a := x AND y;
    o := x OR y;
    e := x XOR y;
END_PROGRAM
)ST", &rt));
    rt.set_variable("x", StValue::make_bool(true));
    rt.set_variable("y", StValue::make_bool(false));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FALSE(get_bool(rt, "a"));
    EXPECT_TRUE(get_bool(rt, "o"));
    EXPECT_TRUE(get_bool(rt, "e"));
}

/* ---- Function Block ---- */

TEST(StExec, TonDelaysThenLatches)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  c : BOOL; END_VAR
VAR_OUTPUT q : BOOL; el : TIME; END_VAR
VAR dly : TON; END_VAR
    dly(IN := c, PT := T#5s);
    q := dly.Q;
    el := dly.ET;
END_PROGRAM
)ST", &rt));
    rt.set_variable("c", StValue::make_bool(true));

    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FALSE(get_bool(rt, "q")) << "t=0 chưa đủ PT";

    ASSERT_TRUE(rt.execute(4 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "q")) << "t=4s chưa đủ 5s";

    ASSERT_TRUE(rt.execute(5 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "q")) << "t=5s phải lên";

    ASSERT_TRUE(rt.execute(9 * kSec).ok);
    StValue et;
    ASSERT_TRUE(rt.get_variable("el", &et));
    EXPECT_EQ(et.t, 5 * kSec) << "ET phải bão hoà tại PT, không vượt";
}

TEST(StExec, TonResetsWhenInputDrops)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  c : BOOL; END_VAR
VAR_OUTPUT q : BOOL; END_VAR
VAR dly : TON; END_VAR
    dly(IN := c, PT := T#5s);
    q := dly.Q;
END_PROGRAM
)ST", &rt));
    rt.set_variable("c", StValue::make_bool(true));
    ASSERT_TRUE(rt.execute(0).ok);
    ASSERT_TRUE(rt.execute(6 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "q"));

    rt.set_variable("c", StValue::make_bool(false));
    ASSERT_TRUE(rt.execute(7 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "q"));

    /* Bật lại: phải đếm LẠI TỪ ĐẦU, không nhớ thời gian cũ. */
    rt.set_variable("c", StValue::make_bool(true));
    ASSERT_TRUE(rt.execute(8 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "q"));
    ASSERT_TRUE(rt.execute(13 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "q"));
}

TEST(StExec, TofHoldsThenDrops)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  c : BOOL; END_VAR
VAR_OUTPUT q : BOOL; END_VAR
VAR dly : TOF; END_VAR
    dly(IN := c, PT := T#5s);
    q := dly.Q;
END_PROGRAM
)ST", &rt));
    rt.set_variable("c", StValue::make_bool(true));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_TRUE(get_bool(rt, "q")) << "TOF lên ngay khi IN đúng";

    rt.set_variable("c", StValue::make_bool(false));
    ASSERT_TRUE(rt.execute(1 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "q")) << "vẫn giữ trong PT";
    ASSERT_TRUE(rt.execute(6 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "q")) << "quá PT phải xuống";
}

TEST(StExec, RTrigFiresOneCycleOnly)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  c : BOOL; END_VAR
VAR_OUTPUT q : BOOL; END_VAR
VAR tr : R_TRIG; END_VAR
    tr(CLK := c);
    q := tr.Q;
END_PROGRAM
)ST", &rt));
    rt.set_variable("c", StValue::make_bool(false));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FALSE(get_bool(rt, "q"));

    rt.set_variable("c", StValue::make_bool(true));
    ASSERT_TRUE(rt.execute(kSec).ok);
    EXPECT_TRUE(get_bool(rt, "q")) << "sườn lên phải bắn";

    ASSERT_TRUE(rt.execute(2 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "q")) << "chỉ bắn ĐÚNG một chu kỳ";
}

TEST(StExec, TwoInstancesOfSameFbAreIndependent)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  c1 : BOOL; c2 : BOOL; END_VAR
VAR_OUTPUT q1 : BOOL; q2 : BOOL; END_VAR
VAR d1 : TON; d2 : TON; END_VAR
    d1(IN := c1, PT := T#2s);
    d2(IN := c2, PT := T#8s);
    q1 := d1.Q;
    q2 := d2.Q;
END_PROGRAM
)ST", &rt));
    rt.set_variable("c1", StValue::make_bool(true));
    rt.set_variable("c2", StValue::make_bool(true));
    ASSERT_TRUE(rt.execute(0).ok);
    ASSERT_TRUE(rt.execute(3 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "q1")) << "timer 2s đã hết";
    EXPECT_FALSE(get_bool(rt, "q2")) << "timer 8s chưa hết — hai instance phải độc lập";
}

/* ---- PID (TASK-PROG-303, DDD-CTRL-PROG-001 §7) ---- */

namespace {

std::string pid_program()
{
    return R"ST(
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
}

void set_pid_gains(StProgramRuntime& rt, float kp, float ki, float kd, float lo, float hi)
{
    rt.set_variable("kp", StValue::make_real(kp));
    rt.set_variable("ki", StValue::make_real(ki));
    rt.set_variable("kd", StValue::make_real(kd));
    rt.set_variable("lo", StValue::make_real(lo));
    rt.set_variable("hi", StValue::make_real(hi));
}

} // namespace

TEST(StExec, PidProportionalTracksErrorOnFirstCycle)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, /*kp=*/2.0f, /*ki=*/0.0f, /*kd=*/0.0f, /*lo=*/0.0f, /*hi=*/100.0f);
    rt.set_variable("sp", StValue::make_real(50.0f));
    rt.set_variable("pv", StValue::make_real(40.0f));
    rt.set_variable("act", StValue::make_real(0.0f));

    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 20.0f) << "P thuần: kp*(sp-pv) = 2*10";
    EXPECT_FALSE(get_bool(rt, "tr")) << "chu kỳ đầu không có actual trước để so, không coi là override";
}

TEST(StExec, PidIntegralAccumulatesWithConstantError)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, /*kp=*/0.0f, /*ki=*/1.0f, /*kd=*/0.0f, /*lo=*/-100.0f, /*hi=*/100.0f);
    rt.set_variable("sp", StValue::make_real(10.0f));
    rt.set_variable("pv", StValue::make_real(0.0f));

    rt.set_variable("act", StValue::make_real(0.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 0.0f) << "dt=0 ở chu kỳ đầu, chưa tích luỹ";

    rt.set_variable("act", StValue::make_real(0.0f));
    ASSERT_TRUE(rt.execute(kSec).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 10.0f) << "1s * ki(1)*error(10) = 10";

    rt.set_variable("act", StValue::make_real(10.0f));
    ASSERT_TRUE(rt.execute(2 * kSec).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 20.0f) << "tích luỹ thêm 10 sau 1s nữa";
}

TEST(StExec, PidLeavesSaturationImmediatelyWhenErrorReversesSign)
{
    /* Chữ ký của anti-windup ĐÚNG: khi error đảo dấu với biên độ áp đảo, OUT
     * phải rời saturation NGAY chu kỳ đó, không trễ vài chu kỳ như khi
     * integral bị wind up không giới hạn. */
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, /*kp=*/1.0f, /*ki=*/1.0f, /*kd=*/0.0f, /*lo=*/0.0f, /*hi=*/10.0f);
    rt.set_variable("pv", StValue::make_real(0.0f));

    rt.set_variable("sp", StValue::make_real(1000.0f));
    rt.set_variable("act", StValue::make_real(0.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 10.0f) << "error khổng lồ phải bão hoà tại out_max";

    rt.set_variable("act", StValue::make_real(10.0f));
    ASSERT_TRUE(rt.execute(kSec).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 10.0f) << "vẫn bão hoà — error chưa đổi";

    /* Đảo dấu error với biên độ áp đảo (pv nhảy vọt qua sp rất xa). */
    rt.set_variable("sp", StValue::make_real(-1000.0f));
    rt.set_variable("act", StValue::make_real(10.0f));
    ASSERT_TRUE(rt.execute(2 * kSec).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y"), 0.0f)
        << "phải rời saturation NGAY, không lết theo integral bị windup";
}

TEST(StExec, PidFreezesIntegratorAndReportsTrackingWhenOverridden)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, /*kp=*/1.0f, /*ki=*/1.0f, /*kd=*/0.0f, /*lo=*/-100.0f, /*hi=*/100.0f);
    rt.set_variable("sp", StValue::make_real(10.0f));
    rt.set_variable("pv", StValue::make_real(0.0f));

    rt.set_variable("act", StValue::make_real(0.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FALSE(get_bool(rt, "tr"));

    /* act KHÔNG khớp OUT vừa publish (0) — nguồn ưu tiên cao hơn đang thắng. */
    rt.set_variable("act", StValue::make_real(999.0f));
    ASSERT_TRUE(rt.execute(kSec).ok);
    EXPECT_TRUE(get_bool(rt, "tr"));
    const float y_overridden_1 = get_real(rt, "y");

    ASSERT_TRUE(rt.execute(2 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "tr"));
    EXPECT_FLOAT_EQ(get_real(rt, "y"), y_overridden_1)
        << "integral bị freeze — hai chu kỳ overridden liên tiếp phải cho cùng đề xuất, "
           "không được cộng dồn";

    /* Override nhả: act khớp lại OUT vừa publish. */
    rt.set_variable("act", StValue::make_real(y_overridden_1));
    ASSERT_TRUE(rt.execute(3 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "tr"));
    const float y_recovered = get_real(rt, "y");

    rt.set_variable("act", StValue::make_real(y_recovered));
    ASSERT_TRUE(rt.execute(4 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "tr"));
    EXPECT_GT(get_real(rt, "y"), y_recovered)
        << "hết override thì tích luỹ phải tiếp tục lớn dần với error còn dương";
}

TEST(StExec, PidOverflowingOutputIsFault)
{
    /* sp/pv không thể mang NaN vào FB qua API công khai — set_variable() và
     * process image (302) đã chặn non-finite tại biên trước đó. Bài test
     * này khẳng định lớp phòng thủ RIÊNG của PID: chính p_term có thể
     * overflow ra Inf từ input hữu hạn (kp/sp rất lớn), và u_raw phải bị
     * chặn trước khi trở thành lệnh output. */
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, /*kp=*/1e30f, 0.0f, 0.0f, -1e38f, 1e38f);
    rt.set_variable("sp", StValue::make_real(1e30f));
    rt.set_variable("pv", StValue::make_real(0.0f));
    rt.set_variable("act", StValue::make_real(0.0f));

    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtNonFiniteReal);
}

TEST(StExec, PidInvertedOutputRangeIsFault)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, 1.0f, 0.0f, 0.0f, /*lo=*/100.0f, /*hi=*/0.0f);
    rt.set_variable("sp", StValue::make_real(10.0f));
    rt.set_variable("pv", StValue::make_real(0.0f));
    rt.set_variable("act", StValue::make_real(0.0f));

    const StExecResult r = rt.execute(0);
    EXPECT_FALSE(r.ok);
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtLimitMinMax);
}

TEST(StExec, PidNonMonotonicTimeIsFault)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(pid_program(), &rt));
    set_pid_gains(rt, 1.0f, 1.0f, 0.0f, 0.0f, 100.0f);
    rt.set_variable("sp", StValue::make_real(10.0f));
    rt.set_variable("pv", StValue::make_real(0.0f));
    rt.set_variable("act", StValue::make_real(0.0f));

    ASSERT_TRUE(rt.execute(5 * kSec).ok);
    rt.set_variable("act", StValue::make_real(get_real(rt, "y")));
    const StExecResult r = rt.execute(5 * kSec);
    EXPECT_FALSE(r.ok) << "now_ns không tăng — dt<=0 không thể tính an toàn";
    EXPECT_STREQ(r.fault_code, st_diag_code::kRtPidInvalidDt);
}

TEST(StExec, TwoPidInstancesAreIndependent)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT  sp1 : REAL; sp2 : REAL; END_VAR
VAR_OUTPUT y1 : REAL; y2 : REAL; END_VAR
VAR l1 : PID; l2 : PID; END_VAR
    l1(SP := sp1, PV := 0.0, KP := 1.0, KI := 0.0, KD := 0.0,
       OUT_MIN := 0.0, OUT_MAX := 100.0, ACTUAL := 0.0);
    l2(SP := sp2, PV := 0.0, KP := 2.0, KI := 0.0, KD := 0.0,
       OUT_MIN := 0.0, OUT_MAX := 100.0, ACTUAL := 0.0);
    y1 := l1.OUT;
    y2 := l2.OUT;
END_PROGRAM
)ST", &rt));
    rt.set_variable("sp1", StValue::make_real(5.0f));
    rt.set_variable("sp2", StValue::make_real(5.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "y1"), 5.0f);
    EXPECT_FLOAT_EQ(get_real(rt, "y2"), 10.0f) << "kp khác nhau — hai instance phải độc lập";
}

/* ---- Vòng đời activation ---- */

TEST(StExec, FailedActivationKeepsRunningProgram)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM good
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a + 1.0;
END_PROGRAM
)ST", &rt));
    rt.set_variable("a", StValue::make_real(1.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "b"), 2.0f);

    std::vector<uint8_t> broken = build(R"ST(
PROGRAM other
VAR_OUTPUT z : REAL; END_VAR
    z := 9.0;
END_PROGRAM
)ST");
    broken[broken.size() - 1] ^= 0xFF;   /* hỏng hash */

    StLoadError err;
    EXPECT_FALSE(rt.activate(broken.data(), broken.size(), &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHash);

    /* Chương trình cũ phải vẫn chạy và vẫn đúng. */
    rt.set_variable("a", StValue::make_real(5.0f));
    ASSERT_TRUE(rt.execute(kSec).ok);
    EXPECT_FLOAT_EQ(get_real(rt, "b"), 6.0f);
    EXPECT_EQ(rt.activation_fail_count(), 1u);
}

TEST(StExec, SpecReferenceProgramBehavesAsDocumented)
{
    /* Bảng hành vi ở ST_SUBSET_SPEC §13 là normative — test này khoá nó lại. */
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM AHU_FanControl
VAR_INPUT
    SupplyTemp  : REAL;
    Setpoint    : REAL;
    Occupied    : BOOL;
END_VAR
VAR_OUTPUT
    FanEnable   : BOOL;
    FanSpeed    : REAL;
    AlarmHigh   : BOOL;
END_VAR
VAR
    StartDelay  : TON;
    HighTrig    : R_TRIG;
    Deviation   : REAL;
END_VAR
VAR RETAIN
    StartCount  : INT;
END_VAR
    Deviation := SupplyTemp - Setpoint;
    StartDelay(IN := Occupied AND (Deviation > 1.0), PT := T#30s);
    FanEnable := StartDelay.Q;
    FanSpeed := LIMIT(0.0, Deviation * 20.0, 100.0);
    AlarmHigh := Deviation > 5.0;
    HighTrig(CLK := FanEnable);
    IF HighTrig.Q THEN
        StartCount := StartCount + 1;
    END_IF;
END_PROGRAM
)ST", &rt));

    rt.set_variable("SupplyTemp", StValue::make_real(28.0f));
    rt.set_variable("Setpoint", StValue::make_real(24.0f));
    rt.set_variable("Occupied", StValue::make_bool(true));

    ASSERT_TRUE(rt.execute(1 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "FanEnable"));
    EXPECT_FLOAT_EQ(get_real(rt, "FanSpeed"), 80.0f);
    EXPECT_EQ(get_int(rt, "StartCount"), 0);

    ASSERT_TRUE(rt.execute(30 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "FanEnable")) << "t=30s: mới đúng 30s kể từ t=1s thì chưa đủ";

    ASSERT_TRUE(rt.execute(31 * kSec).ok);
    EXPECT_TRUE(get_bool(rt, "FanEnable"));
    EXPECT_EQ(get_int(rt, "StartCount"), 1) << "sườn lên đầu tiên phải đếm";

    ASSERT_TRUE(rt.execute(32 * kSec).ok);
    EXPECT_EQ(get_int(rt, "StartCount"), 1) << "không tăng nữa — chỉ đếm sườn lên";

    rt.set_variable("SupplyTemp", StValue::make_real(22.0f));
    ASSERT_TRUE(rt.execute(33 * kSec).ok);
    EXPECT_FALSE(get_bool(rt, "FanEnable"));
    EXPECT_FLOAT_EQ(get_real(rt, "FanSpeed"), 0.0f) << "kẹp dưới về 0";
}

} // namespace core
