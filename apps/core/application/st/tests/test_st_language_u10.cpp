/**
 * @file  test_st_language_u10.cpp
 * @brief Issue #800 (U-10) — toán tử bit trên UINT, SHL/SHR, VAR CONSTANT, giá trị
 *        khởi tạo khi khai báo, TIME × số / TIME ÷ số.
 *
 *        Mọi ca chạy thật trên runtime (compile → artifact ký → loader → exec),
 *        không dừng ở cây cú pháp: lỗi đáng sợ của các tính năng này nằm ở
 *        ranh giới compiler ↔ runtime (opcode mang kiểu gì, hằng nằm ở slot
 *        nào, loader có chịu nạp không).
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

constexpr int64_t kMs = 1000000ll;

bool compile(const std::string& src, StIrModule* mod, StDiagnostic* diag)
{
    StCompileOptions options;
    options.enforce_review_gate = false;
    return compile_st_source(src, mod, diag, options);
}

bool make_runtime(const std::string& src, StProgramRuntime* rt, StIrModule* out = nullptr)
{
    StIrModule mod;
    StDiagnostic diag;
    if (!compile(src, &mod, &diag)) {
        ADD_FAILURE() << diag.code << ": " << diag.message << " @" << diag.line << ":"
                      << diag.column;
        return false;
    }
    std::vector<uint8_t> bytes;
    std::string err;
    if (!serialize_st_ir(mod, &bytes, &err)) { ADD_FAILURE() << err; return false; }
    if (!sign_st_artifact(&bytes, st_test_secret_key())) return false;
    StLoadError load;
    if (!rt->activate(bytes.data(), bytes.size(), &load)) {
        ADD_FAILURE() << load.code << ": " << load.message;
        return false;
    }
    if (out) *out = mod;
    return true;
}

StValue get(StProgramRuntime& rt, const char* name)
{
    StValue v;
    EXPECT_TRUE(rt.get_variable(name, &v)) << name;
    return v;
}

std::string rejected(const std::string& src)
{
    StIrModule mod;
    StDiagnostic diag;
    if (compile(src, &mod, &diag)) return "ACCEPTED";
    return diag.code + " " + diag.message;
}

} // namespace

/* ---- T-800-1: AND/OR/XOR/NOT trên UINT ---- */

TEST(StLanguageU10, BitwiseOperatorsOnUintFollowTruthTables)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT a : UINT; b : UINT; END_VAR
VAR_OUTPUT r_and : UINT; r_or : UINT; r_xor : UINT; r_not : UINT; flag : BOOL; END_VAR
    r_and := a AND b;
    r_or := a OR b;
    r_xor := a XOR b;
    r_not := NOT a;
    flag := (a AND 1) = 1;
END_PROGRAM
)ST", &rt));
    const int cases[][2] = {{0, 0}, {65535, 0}, {21845, 43690}, {61680, 3855}, {65535, 65535}};
    for (const auto& c : cases) {
        rt.set_variable("a", StValue::make_uint(static_cast<uint16_t>(c[0])));
        rt.set_variable("b", StValue::make_uint(static_cast<uint16_t>(c[1])));
        ASSERT_TRUE(rt.execute(0).ok);
        EXPECT_EQ(get(rt, "r_and").i, c[0] & c[1]) << c[0] << "," << c[1];
        EXPECT_EQ(get(rt, "r_or").i, c[0] | c[1]);
        EXPECT_EQ(get(rt, "r_xor").i, c[0] ^ c[1]);
        EXPECT_EQ(get(rt, "r_not").i, (~c[0]) & 0xFFFF);
        EXPECT_EQ(get(rt, "flag").b, (c[0] & 1) == 1);
    }
}

TEST(StLanguageU10, BooleanLogicIsUnchanged)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT a : BOOL; b : BOOL; END_VAR
VAR_OUTPUT y : BOOL; END_VAR
    y := (a AND NOT b) OR (a XOR b);
END_PROGRAM
)ST", &rt));
    for (int a = 0; a < 2; ++a)
        for (int b = 0; b < 2; ++b) {
            rt.set_variable("a", StValue::make_bool(a));
            rt.set_variable("b", StValue::make_bool(b));
            ASSERT_TRUE(rt.execute(0).ok);
            EXPECT_EQ(get(rt, "y").b, (a && !b) || (a != b));
        }
}

/* ---- T-800-2: SHL/SHR ---- */

TEST(StLanguageU10, ShiftsSaturateToZeroAtSixteenBits)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT v : UINT; n : UINT; END_VAR
VAR_OUTPUT l : UINT; r : UINT; END_VAR
    l := SHL(v, n);
    r := SHR(v, n);
END_PROGRAM
)ST", &rt));
    for (int n : {0, 1, 15, 16, 100}) {
        rt.set_variable("v", StValue::make_uint(0xA001));
        rt.set_variable("n", StValue::make_uint(static_cast<uint16_t>(n)));
        ASSERT_TRUE(rt.execute(0).ok);
        EXPECT_EQ(get(rt, "l").i, n >= 16 ? 0 : (0xA001 << n) & 0xFFFF) << "n=" << n;
        EXPECT_EQ(get(rt, "r").i, n >= 16 ? 0 : 0xA001 >> n) << "n=" << n;
    }
}

/* ---- T-800-3: phủ định ---- */

TEST(StLanguageU10, BitwiseRejectsSignedMixedAndBoolUintMix)
{
    const char* head = "PROGRAM t\nVAR_INPUT i : INT; d : DINT; u : UINT; b : BOOL; END_VAR\n"
                       "VAR_OUTPUT y : UINT; z : BOOL; END_VAR\n";
    for (const char* body : {"y := i AND u;\n", "y := d OR u;\n", "z := b AND u;\n",
                             "y := NOT i;\n", "y := SHL(i, u);\n"}) {
        const std::string result = rejected(std::string(head) + body + "END_PROGRAM\n");
        EXPECT_EQ(result.rfind(st_diag_code::kTypeMismatch, 0), 0U) << body << " → " << result;
    }
}

/* ---- T-800-4: VAR CONSTANT ---- */

TEST(StLanguageU10, VarConstantFoldsAndCostsNoWritableSlot)
{
    const std::string with_constants = R"ST(
PROGRAM t
VAR_OUTPUT y : UINT; w : TIME; END_VAR
VAR CONSTANT
    EVEN_MASK : UINT := 43690;
    ODD_MASK : UINT := NOT EVEN_MASK;
    STEP : TIME := T#500ms;
    TWO_STEPS : TIME := STEP * 2;
END_VAR
    y := ODD_MASK;
    w := TWO_STEPS;
END_PROGRAM
)ST";
    const std::string without = R"ST(
PROGRAM t
VAR_OUTPUT y : UINT; w : TIME; END_VAR
    y := 21845;
    w := T#1s;
END_PROGRAM
)ST";
    StProgramRuntime rt, plain;
    StIrModule mod, plain_mod;
    ASSERT_TRUE(make_runtime(with_constants, &rt, &mod));
    ASSERT_TRUE(make_runtime(without, &plain, &plain_mod));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_EQ(get(rt, "y").i, 21845);
    EXPECT_EQ(get(rt, "w").t, 1000 * kMs);
    /* Bốn hằng không tốn slot ghi được nào. */
    EXPECT_EQ(mod.var_slot_count, plain_mod.var_slot_count);
    for (const StIrVariable& v : mod.variables) EXPECT_NE(v.name, "EVEN_MASK");
}

TEST(StLanguageU10, VarConstantIsReadOnlyAndMustBeInitialised)
{
    EXPECT_EQ(rejected("PROGRAM t\nVAR CONSTANT K : INT := 3; END_VAR\nK := 4;\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kReadonlyInput, 0), 0U);
    EXPECT_EQ(rejected("PROGRAM t\nVAR CONSTANT K : INT; END_VAR\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kSyntaxUnexpected, 0), 0U);
    EXPECT_EQ(rejected("PROGRAM t\nVAR CONSTANT RETAIN K : INT := 1; END_VAR\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kSyntaxUnexpected, 0), 0U);
    /* Biểu thức hằng không được đọc biến thường hoặc gọi hàm. */
    EXPECT_EQ(rejected("PROGRAM t\nVAR x : INT; END_VAR\nVAR CONSTANT K : INT := x; END_VAR\n"
                       "END_PROGRAM\n").rfind(st_diag_code::kTypeMismatch, 0), 0U);
    EXPECT_EQ(rejected("PROGRAM t\nVAR CONSTANT K : REAL := ABS(-1.0); END_VAR\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kTypeMismatch, 0), 0U);
    /* Tràn khi gập là lỗi biên dịch, không phải giá trị quấn vòng. */
    EXPECT_EQ(rejected("PROGRAM t\nVAR CONSTANT K : INT := 32767 + 1; END_VAR\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kIntLiteralOutOfRange, 0), 0U);
}

/* ---- T-800-5: giá trị khởi tạo ---- */

TEST(StLanguageU10, InitialValuesApplyAtColdStartIncludingRetainDeclarations)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_OUTPUT sp : REAL := 21.5; mode : UINT := 3; on : BOOL := TRUE; dly : TIME := T#2s; END_VAR
VAR n : DINT := -7; END_VAR
VAR RETAIN count : DINT := 100; END_VAR
    count := count + 1;
END_PROGRAM
)ST", &rt));
    EXPECT_FLOAT_EQ(get(rt, "sp").r, 21.5f);
    EXPECT_EQ(get(rt, "mode").i, 3);
    EXPECT_TRUE(get(rt, "on").b);
    EXPECT_EQ(get(rt, "dly").t, 2000 * kMs);
    EXPECT_EQ(get(rt, "n").i, -7);
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_EQ(get(rt, "count").i, 101);

    EXPECT_EQ(rejected("PROGRAM t\nVAR_INPUT x : REAL := 1.0; END_VAR\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kSyntaxUnexpected, 0), 0U);
    EXPECT_EQ(rejected("PROGRAM t\nVAR x : BOOL := 1.5; END_VAR\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kTypeMismatch, 0), 0U);
}

TEST(StLanguageU10, InitialValuesInsideUserFunctionAreReappliedEveryCall)
{
    const std::vector<StPouTextSource> sources = {
        {"main", "Main", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR_INPUT x : REAL; END_VAR\nVAR_OUTPUT y : REAL; END_VAR\n"
         "y := ACC(x) + ACC(x);\nEND_PROGRAM\n", {}},
        {"acc", "ACC", StPouTextSource::Language::ST, StPouKind::FUNCTION,
         "FUNCTION ACC : REAL\nVAR_INPUT v : REAL; END_VAR\nVAR base : REAL := 10.0; END_VAR\n"
         "VAR CONSTANT GAIN : REAL := 2.0; END_VAR\n"
         "base := base + v;\nACC := base * GAIN;\nEND_FUNCTION\n", {}},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle(sources, {}, &bundle, &diag, options))
        << diag.code << ": " << diag.message;
    std::vector<uint8_t> bytes;
    std::string err;
    ASSERT_TRUE(serialize_st_ir(bundle.programs[0].module, &bytes, &err)) << err;
    ASSERT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    StProgramRuntime rt;
    StLoadError load;
    ASSERT_TRUE(rt.activate(bytes.data(), bytes.size(), &load)) << load.message;
    rt.set_variable("x", StValue::make_real(1.0f));
    ASSERT_TRUE(rt.execute(0).ok);
    /* Mỗi lời gọi bắt đầu lại từ base = 10: (10+1)*2 + (10+1)*2 = 44. */
    EXPECT_FLOAT_EQ(get(rt, "y").r, 44.0f);
}

/* ---- T-800-6: TIME × số ---- */

TEST(StLanguageU10, TimeScalesByIntegerAndRealWithRuntimeFaults)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT base : TIME; k : DINT; f : REAL; END_VAR
VAR_OUTPUT a : TIME; b : TIME; c : TIME; d : TIME; e : TIME; END_VAR
    a := base * k;
    b := k * base;
    c := base / k;
    d := base * f;
    e := base / f;
END_PROGRAM
)ST", &rt));
    rt.set_variable("base", StValue::make_time(1500 * kMs));
    rt.set_variable("k", StValue::make_dint(4));
    rt.set_variable("f", StValue::make_real(2.5f));
    ASSERT_TRUE(rt.execute(0).ok);
    EXPECT_EQ(get(rt, "a").t, 6000 * kMs);
    EXPECT_EQ(get(rt, "b").t, 6000 * kMs);
    EXPECT_EQ(get(rt, "c").t, 375 * kMs);
    EXPECT_EQ(get(rt, "d").t, 3750 * kMs);
    EXPECT_EQ(get(rt, "e").t, 600 * kMs);

    rt.set_variable("k", StValue::make_dint(0));
    const StExecResult by_zero = rt.execute(0);
    EXPECT_FALSE(by_zero.ok);
    ASSERT_NE(by_zero.fault_code, nullptr);
    EXPECT_STREQ(by_zero.fault_code, st_diag_code::kRtDivByZero);
}

TEST(StLanguageU10, NegativeTimeProductFaults)
{
    StProgramRuntime rt;
    ASSERT_TRUE(make_runtime(R"ST(
PROGRAM t
VAR_INPUT base : TIME; k : DINT; END_VAR
VAR_OUTPUT a : TIME; END_VAR
    a := base * k;
END_PROGRAM
)ST", &rt));
    rt.set_variable("base", StValue::make_time(10 * kMs));
    rt.set_variable("k", StValue::make_dint(-1));
    const StExecResult result = rt.execute(0);
    EXPECT_FALSE(result.ok);
    ASSERT_NE(result.fault_code, nullptr);
    EXPECT_STREQ(result.fault_code, st_diag_code::kRtNegativeTime);
    EXPECT_EQ(rejected("PROGRAM t\nVAR a : TIME; b : TIME; END_VAR\na := a / b;\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kTypeMismatch, 0), 0U);
    EXPECT_EQ(rejected("PROGRAM t\nVAR a : TIME; k : DINT; END_VAR\na := k / a;\nEND_PROGRAM\n")
                  .rfind(st_diag_code::kTypeMismatch, 0), 0U);
}

} // namespace core
