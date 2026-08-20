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
#include "st/st_parser.hpp"

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
        make_user_pou_graph("Hysteresis", "FUNCTION_BLOCK",
                            json{{"instance", "hyst"}})
            .dump());
    ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "" : fbd.issues.front().code);
    ASSERT_EQ(fbd.program.fbs.size(), 1U);
    const StFbDecl& decl = fbd.program.fbs.front();
    EXPECT_TRUE(decl.is_user_type);
    EXPECT_EQ(decl.user_type_name, "Hysteresis");
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

TEST(StFbdUserPou, CodegenStillRefusesUnlinkedUserCall)
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
