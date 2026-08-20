/**
 * @file  test_st_function_purity.cpp
 * @brief T59-103 — FUNCTION thuần: không state, không kênh ra thứ hai, không gọi
 *        POU có state; chữ ký lời gọi phải khớp.
 *
 *        Registry kiểm lại những quy tắc mà parser cũng kiểm. Đó KHÔNG phải trùng
 *        lặp: parser chỉ thấy nguồn ST, còn AST còn đến từ lowering FBD
 *        (T59-105). Bộ test này dựng AST TRỰC TIẾP — không đi qua parser — để
 *        chứng minh registry vẫn chặn, đúng như một producer khác sẽ gặp.
 */
#include <gtest/gtest.h>

#include <memory>
#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_pou_registry.hpp"

namespace core {
namespace {

const std::vector<StLibraryEntry> kLibrary = {
    {"Ramp", StPouKind::FUNCTION, "1.0.0"},
    {"Latch", StPouKind::FUNCTION_BLOCK, "2.1.0"},
};

/* Dựng AST thẳng tay: mô phỏng một producer KHÔNG đi qua parser ST. */
StProgram make_function(const std::string& name)
{
    StProgram pou;
    pou.kind = StPouKind::FUNCTION;
    pou.name = name;
    pou.has_return_type = true;
    pou.return_type = StType::REAL;
    pou.line = 1;
    pou.column = 10;
    StVarDecl input;
    input.name = "x";
    input.type = StType::REAL;
    input.storage = StStorage::VAR_INPUT;
    input.line = 2;
    input.column = 11;
    pou.vars.push_back(input);
    return pou;
}

StVarDecl make_var(const std::string& name, StStorage storage, int line)
{
    StVarDecl decl;
    decl.name = name;
    decl.type = StType::REAL;
    decl.storage = storage;
    decl.line = line;
    decl.column = 5;
    return decl;
}

bool build(const std::vector<const StProgram*>& pous, StDiagnostic* diag)
{
    std::vector<StPouSource> sources;
    for (const StProgram* pou : pous) sources.push_back({pou, {}});
    StPouRegistryResult result;
    return st_build_pou_registry(sources, kLibrary, &result, diag);
}

std::unique_ptr<StProgram> parse_or_die(const std::string& source)
{
    auto pou = std::make_unique<StProgram>();
    StDiagnostic diag;
    if (!parse_st_pou(source, pou.get(), &diag)) {
        ADD_FAILURE() << "parse fail " << diag.code << ": " << diag.message;
        return nullptr;
    }
    return pou;
}

} // namespace

TEST(StFunctionPurity, PureFunctionIsAccepted)
{
    const StProgram pure = make_function("Scale");
    StDiagnostic diag;
    EXPECT_TRUE(build({&pure}, &diag)) << diag.code << ": " << diag.message;
}

TEST(StFunctionPurity, RegistryRejectsStateEvenWhenParserWasBypassed)
{
    struct Case {
        const char* label;
        StStorage storage;
    };
    const Case cases[] = {
        {"VAR RETAIN", StStorage::VAR_RETAIN},
        {"VAR_OUTPUT", StStorage::VAR_OUTPUT},
    };
    for (const Case& item : cases) {
        StProgram pou = make_function("Scale");
        pou.vars.push_back(make_var("keep", item.storage, 7));
        StDiagnostic diag;
        EXPECT_FALSE(build({&pou}, &diag)) << item.label;
        EXPECT_EQ(diag.code, st_diag_code::kPouFunctionNotPure) << item.label;
        /* Vị trí phải trỏ đúng khai báo vi phạm, không phải đầu POU. */
        EXPECT_EQ(diag.line, 7) << item.label;
    }
}

TEST(StFunctionPurity, RegistryRejectsFunctionBlockInstanceInsideFunction)
{
    StProgram pou = make_function("Scale");
    StFbDecl instance;
    instance.name = "timer";
    instance.fb_type = StFbType::TON;
    instance.line = 9;
    instance.column = 5;
    pou.fbs.push_back(instance);

    StDiagnostic diag;
    EXPECT_FALSE(build({&pou}, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouFunctionNotPure);
    EXPECT_EQ(diag.line, 9);
}

TEST(StFunctionPurity, FunctionWithoutReturnTypeIsRejectedByRegistryToo)
{
    StProgram pou = make_function("Scale");
    pou.has_return_type = false;
    StDiagnostic diag;
    EXPECT_FALSE(build({&pou}, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouFunctionNotPure);
}

TEST(StFunctionPurity, FunctionCallingStatefulLibraryBlockIsImpure)
{
    /* `Latch` là FUNCTION_BLOCK trong library. FUNCTION gọi nó là mang state vào
     * một hàm thuần — mã phải nói "không thuần", không phải "sai cú pháp". */
    auto caller = parse_or_die(
        "FUNCTION Scale : REAL\nVAR_INPUT x : REAL; END_VAR\nScale := Latch(x);\nEND_FUNCTION\n");
    ASSERT_NE(caller, nullptr);
    StDiagnostic diag;
    EXPECT_FALSE(build({caller.get()}, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouFunctionNotPure);
    EXPECT_NE(diag.message.find("Latch"), std::string::npos) << diag.message;
}

TEST(StFunctionPurity, ProgramCallingFunctionBlockGetsKindCodeNotPurityCode)
{
    /* Cùng một lời gọi sai nhưng NGƯỜI GỌI khác nhau thì CÁCH SỬA khác nhau:
     * FUNCTION phải bỏ FB đi; PROGRAM phải khai instance rồi gọi qua instance.
     * Dùng chung một mã sẽ nói sai việc cần làm. */
    auto program = parse_or_die(
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\ny := Latch(1.0);\nEND_PROGRAM\n");
    ASSERT_NE(program, nullptr);
    StDiagnostic diag;
    EXPECT_FALSE(build({program.get()}, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
    EXPECT_NE(diag.message.find("instance"), std::string::npos) << diag.message;
}

TEST(StFunctionPurity, CallingAProgramIsAlwaysRejected)
{
    auto program = parse_or_die("PROGRAM Worker\nEND_PROGRAM\n");
    auto caller = parse_or_die(
        "FUNCTION Scale : REAL\nVAR_INPUT x : REAL; END_VAR\nScale := Worker(x);\nEND_FUNCTION\n");
    ASSERT_NE(program, nullptr);
    ASSERT_NE(caller, nullptr);
    StDiagnostic diag;
    EXPECT_FALSE(build({program.get(), caller.get()}, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
    EXPECT_NE(diag.message.find("PROGRAM"), std::string::npos) << diag.message;
}

TEST(StFunctionPurity, ArgumentCountMustMatchDeclaredInputs)
{
    auto callee = parse_or_die(
        "FUNCTION Two : REAL\nVAR_INPUT a : REAL; b : REAL; END_VAR\nTwo := a + b;\nEND_FUNCTION\n");
    ASSERT_NE(callee, nullptr);
    ASSERT_EQ(callee->by_storage(StStorage::VAR_INPUT).size(), 2U);

    for (const char* body : {"Scale := Two(x);\n", "Scale := Two(x, x, x);\n"}) {
        auto caller = parse_or_die(
            "FUNCTION Scale : REAL\nVAR_INPUT x : REAL; END_VAR\n" + std::string(body) +
            "END_FUNCTION\n");
        ASSERT_NE(caller, nullptr);
        StDiagnostic diag;
        EXPECT_FALSE(build({callee.get(), caller.get()}, &diag)) << body;
        EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid) << body;
        EXPECT_NE(diag.message.find("declares 2"), std::string::npos) << diag.message;
    }

    auto ok = parse_or_die(
        "FUNCTION Scale : REAL\nVAR_INPUT x : REAL; END_VAR\nScale := Two(x, x);\nEND_FUNCTION\n");
    ASSERT_NE(ok, nullptr);
    StDiagnostic diag;
    EXPECT_TRUE(build({callee.get(), ok.get()}, &diag)) << diag.code << ": " << diag.message;
}

TEST(StFunctionPurity, RegistryPublishesSignaturesForLoweringToReuse)
{
    /* Bảng chữ ký tồn tại để lớp lowering KHÔNG dựng bảng thứ hai — hai bảng song
     * song là cách drift bắt đầu. */
    auto function = parse_or_die(
        "FUNCTION Two : REAL\nVAR_INPUT a : INT; b : REAL; END_VAR\nTwo := b;\nEND_FUNCTION\n");
    auto block = parse_or_die(
        "FUNCTION_BLOCK Keeper\nVAR_INPUT s : BOOL; END_VAR\nVAR_OUTPUT q : BOOL; END_VAR\n"
        "q := s;\nEND_FUNCTION_BLOCK\n");
    ASSERT_NE(function, nullptr);
    ASSERT_NE(block, nullptr);

    std::vector<StPouSource> sources = {{function.get(), {}}, {block.get(), {}}};
    StPouRegistryResult result;
    StDiagnostic diag;
    ASSERT_TRUE(st_build_pou_registry(sources, kLibrary, &result, &diag))
        << diag.code << ": " << diag.message;

    ASSERT_EQ(result.signatures.size(), 2U);
    /* Sắp xếp ổn định theo tên: Keeper trước Two. */
    EXPECT_EQ(result.signatures[0].name, "Keeper");
    EXPECT_EQ(result.signatures[0].kind, StPouKind::FUNCTION_BLOCK);
    EXPECT_FALSE(result.signatures[0].has_return_type);

    EXPECT_EQ(result.signatures[1].name, "Two");
    EXPECT_EQ(result.signatures[1].kind, StPouKind::FUNCTION);
    EXPECT_TRUE(result.signatures[1].has_return_type);
    EXPECT_EQ(result.signatures[1].return_type, StType::REAL);
    ASSERT_EQ(result.signatures[1].input_types.size(), 2U);
    EXPECT_EQ(result.signatures[1].input_types[0], StType::INT);
    EXPECT_EQ(result.signatures[1].input_types[1], StType::REAL);
}

TEST(StFunctionPurity, FunctionBlockMayKeepStateAndCallPureFunctions)
{
    /* Chiều khẳng định: guard purity không được lan sang FUNCTION_BLOCK, nếu
     * không thì FB mất đúng khả năng làm nên nó. */
    auto block = parse_or_die(
        "FUNCTION_BLOCK Keeper\n"
        "VAR_INPUT x : REAL; END_VAR\n"
        "VAR_OUTPUT y : REAL; END_VAR\n"
        "VAR RETAIN last : REAL; END_VAR\n"
        "VAR timer : TON; END_VAR\n"
        "y := Ramp(x);\n"
        "END_FUNCTION_BLOCK\n");
    ASSERT_NE(block, nullptr);
    StDiagnostic diag;
    EXPECT_TRUE(build({block.get()}, &diag)) << diag.code << ": " << diag.message;
}

} // namespace core
