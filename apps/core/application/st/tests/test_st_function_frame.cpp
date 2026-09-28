/**
 * @file  test_st_function_frame.cpp
 * @brief Issue #799 (U-08) — khung slot của lời gọi FUNCTION người dùng cấp theo
 *        ngăn xếp và được dùng chung giữa các lời gọi đã kết thúc.
 *
 *        Bất biến đắt nhất: `f(f(x), f(y))`. Nếu kết quả trả về nằm trong slot
 *        khung vừa được trả, lời gọi `f(y)` đẩy khung ở đúng vị trí đó và ghi đè
 *        kết quả của `f(x)` trước khi lời gọi ngoài kịp đọc. Test chạy thật trên
 *        runtime (artifact ký, loader thật), không chỉ nhìn IR.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

bool activate_module(const StIrModule& module, StProgramRuntime* runtime)
{
    std::vector<uint8_t> bytes;
    std::string error;
    if (!serialize_st_ir(module, &bytes, &error)) {
        ADD_FAILURE() << error;
        return false;
    }
    if (!sign_st_artifact(&bytes, st_test_secret_key())) return false;
    StLoadError load_error;
    if (!runtime->activate(bytes.data(), bytes.size(), &load_error)) {
        ADD_FAILURE() << load_error.code << ": " << load_error.message;
        return false;
    }
    return true;
}

StPouTextSource st(const std::string& name, StPouKind kind, const std::string& source)
{
    return {name, name, StPouTextSource::Language::ST, kind, source, {}};
}

/* Hàm có biến cục bộ để khung lớn hơn một slot: nếu khung chồng nhầm lên đối
 * số hay kết quả còn sống thì giá trị sai lộ ra ngay. */
const char* kSub =
    "FUNCTION SUB2 : REAL\n"
    "VAR_INPUT a : REAL; b : REAL; END_VAR\n"
    "VAR t : REAL; END_VAR\n"
    "t := a - b;\n"
    "SUB2 := t;\n"
    "END_FUNCTION\n";

const char* kInc =
    "FUNCTION INC1 : REAL\n"
    "VAR_INPUT v : REAL; END_VAR\n"
    "VAR k : REAL; END_VAR\n"
    "k := 1.0;\n"
    "INC1 := v + k;\n"
    "END_FUNCTION\n";

bool compile(const std::string& program, StIrModule* module)
{
    const std::vector<StPouTextSource> sources = {
        st("Main", StPouKind::PROGRAM, program),
        st("SUB2", StPouKind::FUNCTION, kSub),
        st("INC1", StPouKind::FUNCTION, kInc),
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    if (!compile_st_pou_bundle(sources, {}, &bundle, &diag, options)) {
        ADD_FAILURE() << diag.code << ": " << diag.message;
        return false;
    }
    *module = bundle.programs.at(0).module;
    return true;
}

float run(const StIrModule& module, float x, float y, const char* output = "r")
{
    StProgramRuntime runtime;
    if (!activate_module(module, &runtime)) return -1.0e9f;
    EXPECT_TRUE(runtime.set_variable("x", StValue::make_real(x)));
    EXPECT_TRUE(runtime.set_variable("y", StValue::make_real(y)));
    EXPECT_TRUE(runtime.execute(0).ok);
    StValue value;
    EXPECT_TRUE(runtime.get_variable(output, &value));
    return value.r;
}

} // namespace

TEST(StFunctionFrame, NestedCallsOfTheSameFunctionDoNotClobberArguments)
{
    StIrModule module;
    ASSERT_TRUE(compile(
        "PROGRAM Main\nVAR_INPUT x : REAL; y : REAL; END_VAR\n"
        "VAR_OUTPUT r : REAL; END_VAR\n"
        "r := SUB2(SUB2(x, 1.0), SUB2(y, 2.0));\nEND_PROGRAM\n", &module));
    /* (x-1) - (y-2): bảng giá trị gồm dấu âm và hai đối số bằng nhau. */
    const float cases[][2] = {{10.0f, 3.0f}, {0.0f, 0.0f}, {-4.5f, 7.25f}, {2.0f, 2.0f}};
    for (const auto& c : cases)
        EXPECT_FLOAT_EQ(run(module, c[0], c[1]), (c[0] - 1.0f) - (c[1] - 2.0f))
            << "x=" << c[0] << " y=" << c[1];
}

TEST(StFunctionFrame, ThreeLevelNestingAndCallsInsideConditions)
{
    StIrModule module;
    ASSERT_TRUE(compile(
        "PROGRAM Main\nVAR_INPUT x : REAL; y : REAL; END_VAR\n"
        "VAR_OUTPUT r : REAL; q : REAL; END_VAR\n"
        "r := INC1(SUB2(INC1(x), INC1(y)));\n"
        "IF SUB2(x, y) > 0.0 THEN\n  q := INC1(x);\nELSE\n  q := SUB2(y, INC1(x));\nEND_IF;\n"
        "END_PROGRAM\n", &module));
    EXPECT_FLOAT_EQ(run(module, 5.0f, 2.0f, "r"), (5.0f + 1.0f) - (2.0f + 1.0f) + 1.0f);
    EXPECT_FLOAT_EQ(run(module, 5.0f, 2.0f, "q"), 6.0f);
    EXPECT_FLOAT_EQ(run(module, 1.0f, 4.0f, "q"), 4.0f - 2.0f);
}

TEST(StFunctionFrame, SequentialCallsShareOneFrameInsteadOfGrowingPerCall)
{
    /* Bản inline cũ cấp 3 slot mới cho MỖI lời gọi SUB2 (kết quả + a + b + t = 4).
     * Với khung dùng chung, 1 hay 20 lời gọi tuần tự tốn cùng số slot ghi. */
    std::string one = "PROGRAM Main\nVAR_INPUT x : REAL; y : REAL; END_VAR\n"
                      "VAR_OUTPUT r : REAL; END_VAR\nr := SUB2(x, y);\nEND_PROGRAM\n";
    std::string many = "PROGRAM Main\nVAR_INPUT x : REAL; y : REAL; END_VAR\n"
                       "VAR_OUTPUT r : REAL; END_VAR\nr := 0.0;\n";
    for (int index = 0; index < 20; ++index) many += "r := r + SUB2(x, y);\n";
    many += "END_PROGRAM\n";

    StIrModule single, repeated;
    ASSERT_TRUE(compile(one, &single));
    ASSERT_TRUE(compile(many, &repeated));
    EXPECT_EQ(repeated.var_slot_count, single.var_slot_count);
    EXPECT_FLOAT_EQ(run(repeated, 3.0f, 1.0f), 40.0f);

    /* Biến khung không vào bảng biến: loader cấm hai biến cùng slot. */
    for (const StIrVariable& variable : repeated.variables)
        EXPECT_EQ(variable.name.rfind("__fn.", 0), std::string::npos) << variable.name;
}

} // namespace core
