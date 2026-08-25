/**
 * @file  test_st_fbd_user_pou.cpp
 * @brief T59-105 — node FBD gọi POU người dùng, và bằng chứng ST/FBD dùng CHUNG
 *        một typed IR.
 *
 *        "Dùng chung typed IR" ở đây có nghĩa cụ thể và kiểm được: cùng một logic
 *        viết bằng ST và vẽ bằng FBD phải sinh ra ĐÚNG CÙNG một nút AST
 *        (`USER_CALL`, cùng tên, cùng thứ tự đối số). Nếu hai ngôn ngữ có hai
 *        đường lowering riêng thì sẽ có hai bộ ngữ nghĩa để trôi khỏi nhau — đúng
 *        cơ chế đã sinh ra drift ở registry Control Library.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_fbd_compile.hpp"
#include "st/st_fbd_model.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_parser.hpp"
#include "st/st_runtime.hpp"
#include "st/st_semantic.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

using json = nlohmann::json;

std::string uuid_for(unsigned family, unsigned value)
{
    char text[37];
    std::snprintf(text, sizeof(text), "%08x-0000-4000-8000-%012x", family, value);
    return text;
}

/* Đồ thị: hai INPUT REAL -> node `type_ref` (kind cho trước) -> OUTPUT REAL. */
json make_user_pou_graph(const std::string& type_ref, const std::string& kind,
                         const json& parameters = json::object())
{
    json nodes = json::array();
    json wires = json::array();
    std::vector<std::string> source_ports;
    unsigned port_id = 1;

    for (unsigned index = 0; index < 2; ++index) {
        const std::string out_port = uuid_for(4, port_id++);
        nodes.push_back({
            {"id", uuid_for(3, index + 1)},
            {"kind", "INPUT"},
            {"typeRef", "REAL"},
            {"executionOrder", index},
            {"parameters", {{"variable", index == 0 ? "a" : "b"}}},
            {"ports", json::array({{{"id", out_port}, {"name", "OUT"},
                                    {"direction", "OUTPUT"}, {"dataType", "REAL"},
                                    {"unit", nullptr}, {"order", 0}}})},
        });
        source_ports.push_back(out_port);
    }

    const std::string call_node = uuid_for(3, 100);
    json call_ports = json::array();
    for (unsigned index = 0; index < 2; ++index) {
        const std::string in_port = uuid_for(4, port_id++);
        call_ports.push_back({{"id", in_port}, {"name", "IN" + std::to_string(index + 1)},
                              {"direction", "INPUT"}, {"dataType", "REAL"},
                              {"unit", nullptr}, {"order", index}});
        wires.push_back({{"id", uuid_for(5, index + 1)},
                         {"from", {{"nodeId", uuid_for(3, index + 1)},
                                   {"portId", source_ports[index]}}},
                         {"to", {{"nodeId", call_node}, {"portId", in_port}}}});
    }
    const std::string call_output = uuid_for(4, port_id++);
    call_ports.push_back({{"id", call_output}, {"name", "OUT"}, {"direction", "OUTPUT"},
                          {"dataType", "REAL"}, {"unit", nullptr}, {"order", 2}});
    nodes.push_back({{"id", call_node}, {"kind", kind}, {"typeRef", type_ref},
                     {"executionOrder", 2}, {"parameters", parameters},
                     {"ports", call_ports}});

    const std::string sink_port = uuid_for(4, port_id++);
    nodes.push_back({{"id", uuid_for(3, 200)}, {"kind", "OUTPUT"}, {"typeRef", "REAL"},
                     {"executionOrder", 3}, {"parameters", {{"variable", "y"}}},
                     {"ports", json::array({{{"id", sink_port}, {"name", "IN"},
                                             {"direction", "INPUT"}, {"dataType", "REAL"},
                                             {"unit", nullptr}, {"order", 0}}})}});
    wires.push_back({{"id", uuid_for(5, 100)},
                     {"from", {{"nodeId", call_node}, {"portId", call_output}}},
                     {"to", {{"nodeId", uuid_for(3, 200)}, {"portId", sink_port}}}});

    return json{{"$schema", "../../fbd_v1.schema.json"},
                {"schemaVersion", 1},
                {"profileId", "revA-1t-1-5-30"},
                {"graphId", uuid_for(1, 1)},
                {"name", "UserPouGraph"},
                {"networks", json::array({{{"id", uuid_for(2, 1)},
                                           {"name", "N1"},
                                           {"order", 0},
                                           {"nodes", nodes},
                                           {"wires", wires}}})}};
}

json make_fbd_ton_block(const std::string& name)
{
    const std::string input_node = uuid_for(13, 1);
    const std::string constant_node = uuid_for(13, 2);
    const std::string ton_node = uuid_for(13, 3);
    const std::string output_node = uuid_for(13, 4);
    const std::string input_out = uuid_for(14, 1);
    const std::string constant_out = uuid_for(14, 2);
    const std::string ton_in = uuid_for(14, 3);
    const std::string ton_pt = uuid_for(14, 4);
    const std::string ton_q = uuid_for(14, 5);
    const std::string ton_et = uuid_for(14, 6);
    const std::string output_in = uuid_for(14, 7);
    return {
        {"$schema", "../../fbd_v1.schema.json"}, {"schemaVersion", 1},
        {"profileId", "revA-1t-1-5-30"}, {"graphId", uuid_for(11, 1)},
        {"name", name},
        {"networks", json::array({{
            {"id", uuid_for(12, 1)}, {"name", "MAIN"}, {"order", 0},
            {"nodes", json::array({
                {{"id", input_node}, {"kind", "INPUT"}, {"typeRef", "BOOL"},
                 {"executionOrder", 0}, {"parameters", {{"variable", "ENABLE"}}},
                 {"ports", json::array({{{"id", input_out}, {"name", "OUT"},
                                          {"direction", "OUTPUT"}, {"dataType", "BOOL"},
                                          {"unit", nullptr}, {"order", 0}}})}},
                {{"id", constant_node}, {"kind", "CONSTANT"}, {"typeRef", "TIME"},
                 {"executionOrder", 1}, {"parameters", {{"value", 1000000000}}},
                 {"ports", json::array({{{"id", constant_out}, {"name", "OUT"},
                                          {"direction", "OUTPUT"}, {"dataType", "TIME"},
                                          {"unit", nullptr}, {"order", 0}}})}},
                {{"id", ton_node}, {"kind", "FUNCTION_BLOCK"}, {"typeRef", "TON"},
                 {"executionOrder", 2}, {"parameters", {{"instance", "TIMER"}}},
                 {"ports", json::array({
                     {{"id", ton_in}, {"name", "IN"}, {"direction", "INPUT"},
                      {"dataType", "BOOL"}, {"unit", nullptr}, {"order", 0}},
                     {{"id", ton_pt}, {"name", "PT"}, {"direction", "INPUT"},
                      {"dataType", "TIME"}, {"unit", nullptr}, {"order", 1}},
                     {{"id", ton_q}, {"name", "Q"}, {"direction", "OUTPUT"},
                      {"dataType", "BOOL"}, {"unit", nullptr}, {"order", 2}},
                     {{"id", ton_et}, {"name", "ET"}, {"direction", "OUTPUT"},
                      {"dataType", "TIME"}, {"unit", nullptr}, {"order", 3}}
                 })}},
                {{"id", output_node}, {"kind", "OUTPUT"}, {"typeRef", "BOOL"},
                 {"executionOrder", 3}, {"parameters", {{"variable", "OUT"}}},
                 {"ports", json::array({{{"id", output_in}, {"name", "IN"},
                                          {"direction", "INPUT"}, {"dataType", "BOOL"},
                                          {"unit", nullptr}, {"order", 0}}})}}
            })},
            {"wires", json::array({
                {{"id", uuid_for(15, 1)},
                 {"from", {{"nodeId", input_node}, {"portId", input_out}}},
                 {"to", {{"nodeId", ton_node}, {"portId", ton_in}}}},
                {{"id", uuid_for(15, 2)},
                 {"from", {{"nodeId", constant_node}, {"portId", constant_out}}},
                 {"to", {{"nodeId", ton_node}, {"portId", ton_pt}}}},
                {{"id", uuid_for(15, 3)},
                 {"from", {{"nodeId", ton_node}, {"portId", ton_q}}},
                 {"to", {{"nodeId", output_node}, {"portId", output_in}}}}
            })}
        }})}
    };
}

const StExpr* find_user_call(const StExpr* expr)
{
    if (expr == nullptr) return nullptr;
    if (expr->kind == StExpr::Kind::USER_CALL) return expr;
    if (const StExpr* found = find_user_call(expr->lhs.get())) return found;
    if (const StExpr* found = find_user_call(expr->rhs.get())) return found;
    if (const StExpr* found = find_user_call(expr->operand.get())) return found;
    for (const auto& arg : expr->args)
        if (const StExpr* found = find_user_call(arg.get())) return found;
    return nullptr;
}

const StExpr* find_user_call(const StProgram& pou)
{
    for (const StStmt& stmt : pou.body) {
        if (stmt.kind != StStmt::Kind::ASSIGN) continue;
        if (const StExpr* found = find_user_call(stmt.assign_expr.get())) return found;
    }
    return nullptr;
}

bool has_issue(const std::vector<FbdIssue>& issues, const std::string& code)
{
    for (const FbdIssue& issue : issues)
        if (issue.code == code) return true;
    return false;
}

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

StValue read_value(StProgramRuntime* runtime, const char* name)
{
    StValue value;
    EXPECT_TRUE(runtime->get_variable(name, &value));
    return value;
}

} // namespace

TEST(StFbdUserPou, FbdFunctionNodeLowersToTheSameIrNodeAsSt)
{
    const FbdLowerResult fbd = lower_fbd_source_to_program(
        make_user_pou_graph("Blend", "FUNCTION").dump());
    ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "" : fbd.issues.front().code);

    StProgram st;
    StDiagnostic diag;
    ASSERT_TRUE(parse_st_pou(
        "PROGRAM Main\nVAR_INPUT a : REAL; b : REAL; END_VAR\n"
        "VAR_OUTPUT y : REAL; END_VAR\ny := Blend(a, b);\nEND_PROGRAM\n",
        &st, &diag))
        << diag.code << ": " << diag.message;

    const StExpr* from_fbd = find_user_call(fbd.program);
    const StExpr* from_st = find_user_call(st);
    ASSERT_NE(from_fbd, nullptr) << "FBD không sinh USER_CALL";
    ASSERT_NE(from_st, nullptr) << "ST không sinh USER_CALL";

    /* Cùng loại nút, cùng tên, cùng số đối số, cùng thứ tự đối số. */
    EXPECT_EQ(from_fbd->kind, from_st->kind);
    EXPECT_EQ(from_fbd->user_call_name, from_st->user_call_name);
    ASSERT_EQ(from_fbd->args.size(), from_st->args.size());
    for (std::size_t index = 0; index < from_st->args.size(); ++index) {
        EXPECT_EQ(from_fbd->args[index]->kind, from_st->args[index]->kind) << index;
        EXPECT_EQ(from_fbd->args[index]->var_name, from_st->args[index]->var_name) << index;
    }
}

TEST(StFbdUserPou, ArgumentOrderFollowsPortOrderNotWireOrder)
{
    /* Thứ tự đối số phải theo `order` của port. Nếu nó theo thứ tự dây nối thì
     * cùng một sơ đồ vẽ lại sẽ đổi ngữ nghĩa — lỗi im lặng tệ nhất trong FBD. */
    json graph = make_user_pou_graph("Blend", "FUNCTION");
    auto& wires = graph["networks"][0]["wires"];
    std::swap(wires[0], wires[1]);

    const FbdLowerResult fbd = lower_fbd_source_to_program(graph.dump());
    ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "" : fbd.issues.front().code);
    const StExpr* call = find_user_call(fbd.program);
    ASSERT_NE(call, nullptr);
    ASSERT_EQ(call->args.size(), 2U);
    EXPECT_EQ(call->args[0]->var_name, "a");
    EXPECT_EQ(call->args[1]->var_name, "b");
}

TEST(StFbdUserPou, UserFunctionBlockNodeBecomesUserTypedInstance)
{
    const FbdLowerResult fbd = lower_fbd_source_to_program(
        make_user_pou_graph("BandGuard", "FUNCTION_BLOCK",
                            json{{"instance", "hyst"}})
            .dump());
    ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "" : fbd.issues.front().code);
    ASSERT_EQ(fbd.program.fbs.size(), 1U);
    const StFbDecl& decl = fbd.program.fbs.front();
    EXPECT_TRUE(decl.is_user_type);
    EXPECT_EQ(decl.user_type_name, "BandGuard");
    /* `fb_type` phải giữ NONE: không có đường nào nhầm nó với FB dựng sẵn. */
    EXPECT_EQ(decl.fb_type, StFbType::NONE);
    EXPECT_EQ(decl.name, "hyst");

    /* Đối số của FB đi theo TÊN CỔNG, để lớp registry — nơi giữ interface — đối
     * chiếu được với VAR_INPUT thật của POU. */
    bool found_call = false;
    for (const StStmt& stmt : fbd.program.body) {
        if (stmt.kind != StStmt::Kind::FB_CALL) continue;
        found_call = true;
        EXPECT_EQ(stmt.fb_instance, "hyst");
        ASSERT_EQ(stmt.fb_args.size(), 2U);
        EXPECT_EQ(stmt.fb_args[0].name, "IN1");
        EXPECT_EQ(stmt.fb_args[1].name, "IN2");
    }
    EXPECT_TRUE(found_call);
}

TEST(StFbdUserPou, WrongKindTypeRefIsStillRejectedAtTheModelLayer)
{
    /* `TON` CÓ trong registry nhưng thuộc kind khác — đó là SAI KIND, không phải
     * POU người dùng. Nếu lớp model coi mọi tên lạ là POU thì lỗi này sẽ trôi
     * xuống tận compile và báo sai lý do. */
    const FbdValidationResult result = validate_and_canonicalize_fbd(
        make_user_pou_graph("TON", "FUNCTION").dump());
    EXPECT_FALSE(result.ok);
    bool found = false;
    for (const FbdIssue& issue : result.issues)
        found = found || issue.code == "FBD-SEM-TYPE-REF-001";
    EXPECT_TRUE(found);
}

TEST(StFbdUserPou, UnknownTypeRefIsAcceptedByModelAndResolvedLater)
{
    /* Lớp model KHÔNG biết tập POU nên nó không được phán. Nó chấp nhận, đánh dấu
     * `user_type_ref`, và để lớp có dữ liệu phân giải — cùng lối đã dùng cho
     * `USER_CALL` ở ST. */
    const FbdValidationResult result = validate_and_canonicalize_fbd(
        make_user_pou_graph("KhongCoTrongRegistry", "FUNCTION").dump());
    EXPECT_TRUE(result.ok) << (result.issues.empty() ? "" : result.issues.front().code);
    bool marked = false;
    for (const FbdNetwork& network : result.document.networks)
        for (const FbdNode& node : network.nodes)
            if (node.type_ref == "KhongCoTrongRegistry") marked = node.user_type_ref;
    EXPECT_TRUE(marked);
}

TEST(StFbdUserPou, CodegenRefusesOnlyAnUnlinkedUserCall)
{
    /* Trung thực về ranh giới: lower ĐƯỢC, sinh mã CHƯA. Liên kết lời gọi POU vào
     * IR chạy được thuộc T59-106. Điều bắt buộc là nó fail-closed chứ không sinh
     * ra một artifact thiếu thân hàm. */
    const FbdCompileResult compiled = compile_fbd_source(
        make_user_pou_graph("Blend", "FUNCTION").dump());
    EXPECT_FALSE(compiled.ok);
    EXPECT_FALSE(compiled.issues.empty());
    EXPECT_TRUE(compiled.module.code.empty());
    EXPECT_TRUE(has_issue(compiled.issues, "FBD-SEM-LOWER-001") ||
                has_issue(compiled.issues, "FBD-LIMIT-IR-001"))
        << compiled.issues.front().code;
}

TEST(StFbdUserPou, LinkedFbdFunctionExecutesThroughTheSharedTypedIr)
{
    FbdLowerResult fbd = lower_fbd_source_to_program(
        make_user_pou_graph("Blend", "FUNCTION").dump());
    ASSERT_TRUE(fbd.ok);
    StProgram function;
    StDiagnostic diag;
    ASSERT_TRUE(parse_st_pou(
        "FUNCTION Blend : REAL\n"
        "VAR_INPUT IN1 : REAL; IN2 : REAL; END_VAR\n"
        "Blend := IN1 + IN2;\nEND_FUNCTION\n",
        &function, &diag)) << diag.message;

    std::vector<StPouSource> sources = {{&fbd.program, {}}, {&function, {}}};
    StPouRegistryResult registry;
    ASSERT_TRUE(st_build_pou_registry(sources, {}, &registry, &diag)) << diag.message;
    ASSERT_TRUE(typecheck_st_pou_set(sources, registry, &diag))
        << diag.code << ": " << diag.message;
    StIrModule module;
    std::vector<StLinkedPouInfo> linked;
    ASSERT_TRUE(compile_st_to_ir_linked(fbd.program, fbd.canonical_source, sources,
                                        registry, &module, &linked, &diag))
        << diag.code << ": " << diag.message;
    ASSERT_EQ(linked.size(), 1U);
    EXPECT_EQ(linked[0].name, "Blend");
    EXPECT_GT(linked[0].instruction_count, 0U);

    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(module, &runtime));
    ASSERT_TRUE(runtime.set_variable("a", StValue::make_real(2.5f)));
    ASSERT_TRUE(runtime.set_variable("b", StValue::make_real(4.0f)));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_FLOAT_EQ(read_value(&runtime, "y").r, 6.5f);
}

TEST(StFbdUserPou, FbdDocumentCanDefineAUserFunction)
{
    json definition = make_user_pou_graph("MAX", "FUNCTION");
    definition["name"] = "MaxFbd";
    const std::vector<StPouTextSource> sources = {
        {"main", "Main", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR_INPUT a : REAL; b : REAL; END_VAR\n"
         "VAR_OUTPUT y : REAL; END_VAR\ny := MaxFbd(a, b);\nEND_PROGRAM\n", {}},
        {"max-fbd", "MaxFbd", StPouTextSource::Language::FBD, StPouKind::FUNCTION,
         definition.dump(), {}},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle(sources, {}, &bundle, &diag, options))
        << diag.code << ": " << diag.message;
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));
    ASSERT_TRUE(runtime.set_variable("a", StValue::make_real(7.0f)));
    ASSERT_TRUE(runtime.set_variable("b", StValue::make_real(3.0f)));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_FLOAT_EQ(read_value(&runtime, "y").r, 7.0f);
    ASSERT_EQ(bundle.programs[0].linked_pous.size(), 1U);
    EXPECT_EQ(bundle.programs[0].linked_pous[0].name, "MaxFbd");
}

TEST(StFbdUserPou, FbdDocumentCanDefineAStateIsolatedFunctionBlock)
{
    json definition = make_user_pou_graph("MAX", "FUNCTION");
    definition["name"] = "MaxFb";
    const std::vector<StPouTextSource> sources = {
        {"main", "Main", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR_INPUT x : REAL; z : REAL; END_VAR\n"
         "VAR_OUTPUT y : REAL; END_VAR\nVAR block : MaxFb; END_VAR\n"
         "block(a := x, b := z); y := block.y;\nEND_PROGRAM\n", {}},
        {"max-fbd", "MaxFb", StPouTextSource::Language::FBD,
         StPouKind::FUNCTION_BLOCK, definition.dump(), {}},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle(sources, {}, &bundle, &diag, options))
        << diag.code << ": " << diag.message;
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));
    ASSERT_TRUE(runtime.set_variable("x", StValue::make_real(1.0f)));
    ASSERT_TRUE(runtime.set_variable("z", StValue::make_real(9.0f)));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_FLOAT_EQ(read_value(&runtime, "y").r, 9.0f);
}

TEST(StFbdUserPou, FbdDefinedFunctionBlockKeepsTonStatePerInstance)
{
    const std::vector<StPouTextSource> sources = {
        {"main", "Main", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR_INPUT a : BOOL; b : BOOL; END_VAR\n"
         "VAR_OUTPUT aOut : BOOL; bOut : BOOL; END_VAR\n"
         "VAR first : DelayFb; second : DelayFb; END_VAR\n"
         "first(ENABLE := a); second(ENABLE := b); "
         "aOut := first.OUT; bOut := second.OUT;\nEND_PROGRAM\n", {}},
        {"delay-fbd", "DelayFb", StPouTextSource::Language::FBD,
         StPouKind::FUNCTION_BLOCK, make_fbd_ton_block("DelayFb").dump(), {}},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle(sources, {}, &bundle, &diag, options))
        << diag.code << ": " << diag.message;
    ASSERT_EQ(bundle.programs.size(), 1U);
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));

    ASSERT_TRUE(runtime.set_variable("a", StValue::make_bool(false)));
    ASSERT_TRUE(runtime.set_variable("b", StValue::make_bool(false)));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_FALSE(read_value(&runtime, "aOut").b);
    EXPECT_FALSE(read_value(&runtime, "bOut").b);

    ASSERT_TRUE(runtime.set_variable("a", StValue::make_bool(true)));
    ASSERT_TRUE(runtime.execute(1100000000ULL).ok);
    EXPECT_FALSE(read_value(&runtime, "aOut").b);
    EXPECT_FALSE(read_value(&runtime, "bOut").b);
    ASSERT_TRUE(runtime.execute(2200000000ULL).ok);
    EXPECT_TRUE(read_value(&runtime, "aOut").b);
    EXPECT_FALSE(read_value(&runtime, "bOut").b);

    ASSERT_TRUE(runtime.set_variable("b", StValue::make_bool(true)));
    ASSERT_TRUE(runtime.execute(2200000000ULL).ok);
    EXPECT_TRUE(read_value(&runtime, "aOut").b);
    EXPECT_FALSE(read_value(&runtime, "bOut").b);
    ASSERT_TRUE(runtime.execute(3300000000ULL).ok);
    EXPECT_TRUE(read_value(&runtime, "aOut").b);
    EXPECT_TRUE(read_value(&runtime, "bOut").b);
}

TEST(StFbdUserPou, FunctionLocalsAreReinitializedForEveryInlineCall)
{
    const std::vector<StPouTextSource> sources = {
        {"main", "", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR_OUTPUT a : INT; b : INT; END_VAR\n"
         "a := Bump(0); b := Bump(0);\nEND_PROGRAM\n", {}},
        {"bump", "", StPouTextSource::Language::ST, StPouKind::FUNCTION,
         "FUNCTION Bump : INT\nVAR_INPUT x : INT; END_VAR\nVAR tmp : INT; END_VAR\n"
         "tmp := tmp + 1; Bump := x + tmp;\nEND_FUNCTION\n", {}},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle(sources, {}, &bundle, &diag, options))
        << diag.code << ": " << diag.message;
    ASSERT_EQ(bundle.programs.size(), 1U);
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));
    for (int cycle = 0; cycle < 3; ++cycle) {
        ASSERT_TRUE(runtime.execute(cycle).ok);
        EXPECT_EQ(read_value(&runtime, "a").i, 1);
        EXPECT_EQ(read_value(&runtime, "b").i, 1);
    }
}

TEST(StFbdUserPou, UserFunctionBlockStateIsIsolatedPerInstance)
{
    const std::vector<StPouTextSource> sources = {
        {"main", "", StPouTextSource::Language::ST, StPouKind::PROGRAM,
         "PROGRAM Main\nVAR_OUTPUT aOut : INT; bOut : INT; END_VAR\n"
         "VAR a : Counter; b : Counter; END_VAR\n"
         "a(step := 1); b(step := 2); aOut := a.value; bOut := b.value;\n"
         "END_PROGRAM\n", {}},
        {"counter", "", StPouTextSource::Language::ST, StPouKind::FUNCTION_BLOCK,
         "FUNCTION_BLOCK Counter\nVAR_INPUT step : INT; END_VAR\n"
         "VAR_OUTPUT value : INT; END_VAR\nVAR count : INT; END_VAR\n"
         "count := count + step; value := count;\nEND_FUNCTION_BLOCK\n", {}},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle(sources, {}, &bundle, &diag, options))
        << diag.code << ": " << diag.message;
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_EQ(read_value(&runtime, "aOut").i, 1);
    EXPECT_EQ(read_value(&runtime, "bOut").i, 2);
    ASSERT_TRUE(runtime.execute(1).ok);
    EXPECT_EQ(read_value(&runtime, "aOut").i, 2);
    EXPECT_EQ(read_value(&runtime, "bOut").i, 4);
}

TEST(StFbdUserPou, LockedSystemLibrarySourceIsTheExecutableImplementation)
{
    StPouTextSource main;
    main.source_id = "main";
    main.source =
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
        "y := SysScale(2.0);\nEND_PROGRAM\n";
    main.requires_library = {{"SysScale", "1.2.0", "SYSTEM"}};
    StPouTextSource library_source;
    library_source.source_id = "sys-scale";
    library_source.pou_name = "SysScale";
    library_source.declared_kind = StPouKind::FUNCTION;
    library_source.source =
        "FUNCTION SysScale : REAL\nVAR_INPUT x : REAL; END_VAR\n"
        "SysScale := x * 3.0;\nEND_FUNCTION\n";
    library_source.from_library = true;
    library_source.library_entry_id = "lib-entry-sys-scale";
    library_source.version = "1.2.0";
    library_source.library_origin = "SYSTEM";
    const std::vector<StLibraryEntry> lock = {
        {"SysScale", StPouKind::FUNCTION, "1.2.0", "lib-entry-sys-scale"},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle({main, library_source}, lock, &bundle, &diag,
                                      options))
        << diag.code << ": " << diag.message;
    ASSERT_EQ(bundle.programs.size(), 1U);
    ASSERT_EQ(bundle.programs[0].linked_pous.size(), 1U);
    EXPECT_TRUE(bundle.programs[0].linked_pous[0].from_library);
    EXPECT_EQ(bundle.programs[0].linked_pous[0].library_entry_id,
              "lib-entry-sys-scale");
    EXPECT_EQ(bundle.programs[0].linked_pous[0].version, "1.2.0");
    EXPECT_EQ(bundle.programs[0].linked_pous[0].library_origin, "SYSTEM");
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_FLOAT_EQ(read_value(&runtime, "y").r, 6.0f);
}

TEST(StFbdUserPou, LockedProjectLibrarySourceExecutesWithProjectProvenance)
{
    StPouTextSource main;
    main.source_id = "main";
    main.source =
        "PROGRAM Main\nVAR_OUTPUT y : REAL; END_VAR\n"
        "y := ProjectScale(4.0);\nEND_PROGRAM\n";
    main.requires_library = {{"ProjectScale", "2.0.0", "PROJECT"}};
    StPouTextSource library_source;
    library_source.source_id = "project-scale";
    library_source.pou_name = "ProjectScale";
    library_source.declared_kind = StPouKind::FUNCTION;
    library_source.source =
        "FUNCTION ProjectScale : REAL\nVAR_INPUT x : REAL; END_VAR\n"
        "ProjectScale := x + 5.0;\nEND_FUNCTION\n";
    library_source.from_library = true;
    library_source.library_entry_id = "project-entry-scale";
    library_source.version = "2.0.0";
    library_source.library_origin = "PROJECT";
    const std::vector<StLibraryEntry> lock = {
        {"ProjectScale", StPouKind::FUNCTION, "2.0.0", "project-entry-scale",
         "PROJECT"},
    };
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    ASSERT_TRUE(compile_st_pou_bundle({main, library_source}, lock, &bundle, &diag,
                                      options))
        << diag.code << ": " << diag.message;
    ASSERT_EQ(bundle.programs.size(), 1U);
    ASSERT_EQ(bundle.programs[0].linked_pous.size(), 1U);
    const StLinkedPouInfo& linked = bundle.programs[0].linked_pous[0];
    EXPECT_TRUE(linked.from_library);
    EXPECT_EQ(linked.library_entry_id, "project-entry-scale");
    EXPECT_EQ(linked.version, "2.0.0");
    EXPECT_EQ(linked.library_origin, "PROJECT");
    StProgramRuntime runtime;
    ASSERT_TRUE(activate_module(bundle.programs[0].module, &runtime));
    ASSERT_TRUE(runtime.execute(0).ok);
    EXPECT_FLOAT_EQ(read_value(&runtime, "y").r, 9.0f);
}

TEST(StFbdUserPou, PublicBundleApiRejectsLibraryBackedProgramRoot)
{
    StPouTextSource source;
    source.source_id = "bad-library-program";
    source.pou_name = "LibraryProgram";
    source.declared_kind = StPouKind::PROGRAM;
    source.source = "PROGRAM LibraryProgram\nEND_PROGRAM\n";
    source.from_library = true;
    source.library_entry_id = "library-program-entry";
    source.version = "1.0.0";
    source.library_origin = "PROJECT";
    StCompileOptions options;
    options.enforce_review_gate = false;
    StPouBundleCompileResult bundle;
    StDiagnostic diag;
    EXPECT_FALSE(compile_st_pou_bundle({source}, {}, &bundle, &diag, options));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
    EXPECT_NE(diag.message.find("cannot be a PROGRAM"), std::string::npos)
        << diag.message;
}

TEST(StFbdUserPou, SourceMapAnchorsSurviveUserPouNodes)
{
    /* Source map phải còn nguyên cho node POU người dùng, nếu không thì diagnostic
     * của Check sẽ không trỏ được về ô người dùng đã vẽ. */
    const FbdLowerResult fbd = lower_fbd_source_to_program(
        make_user_pou_graph("Blend", "FUNCTION").dump());
    ASSERT_TRUE(fbd.ok);
    const StExpr* call = find_user_call(fbd.program);
    ASSERT_NE(call, nullptr);
    EXPECT_GT(call->line, 0);
    EXPECT_GT(call->column, 0);
}

} // namespace core
