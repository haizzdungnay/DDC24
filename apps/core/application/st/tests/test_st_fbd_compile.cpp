#include <gtest/gtest.h>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_compile.hpp"
#include "st/st_fbd_compile.hpp"
#include "st/st_library_registry_generated.hpp"
#include "st/st_runtime.hpp"
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

json read_json(const char* relative)
{
    std::ifstream input(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) + relative);
    return json::parse(std::string(std::istreambuf_iterator<char>(input),
                                   std::istreambuf_iterator<char>()));
}

json make_pair_graph(const json& pair)
{
    json nodes = json::array();
    json wires = json::array();
    unsigned port_id = 1;
    unsigned wire_id = 1;
    std::vector<std::string> source_ports;
    for (std::size_t index = 0; index < pair["inputs"].size(); ++index) {
        const auto& input = pair["inputs"][index];
        const std::string output_port = uuid_for(4, port_id++);
        nodes.push_back({
            {"id", uuid_for(3, static_cast<unsigned>(index + 1))},
            {"kind", "INPUT"},
            {"typeRef", input["type"]},
            {"executionOrder", index},
            {"parameters", {{"variable", input["name"]}}},
            {"ports", json::array({{{"id", output_port}, {"name", "OUT"},
                                     {"direction", "OUTPUT"}, {"dataType", input["type"]},
                                     {"unit", nullptr}, {"order", 0}}})},
        });
        source_ports.push_back(output_port);
    }

    const std::string function_node = uuid_for(3, 100);
    json function_ports = json::array();
    std::vector<std::string> function_inputs;
    for (std::size_t index = 0; index < pair["inputs"].size(); ++index) {
        const std::string input_port = uuid_for(4, port_id++);
        function_inputs.push_back(input_port);
        function_ports.push_back({{"id", input_port},
                                  {"name", "IN" + std::to_string(index + 1)},
                                  {"direction", "INPUT"},
                                  {"dataType", pair["inputs"][index]["type"]},
                                  {"unit", nullptr},
                                  {"order", index}});
        wires.push_back({
            {"id", uuid_for(5, wire_id++)},
            {"from", {{"nodeId", uuid_for(3, static_cast<unsigned>(index + 1))},
                       {"portId", source_ports[index]}}},
            {"to", {{"nodeId", function_node}, {"portId", input_port}}},
        });
    }
    const std::string function_output = uuid_for(4, port_id++);
    function_ports.push_back({{"id", function_output}, {"name", "OUT"},
                              {"direction", "OUTPUT"}, {"dataType", pair["outputType"]},
                              {"unit", nullptr}, {"order", pair["inputs"].size()}});
    /* T59-601: entry chuyển kiểu là node kind `CONVERSION` trong FBD, không phải
     * `FUNCTION` — model từ chối `INT_TO_REAL` trên node FUNCTION bằng
     * `FBD-SEM-TYPE-REF-001`, và nó từ chối ĐÚNG. Kind lấy từ registry sinh máy
     * để corpus không phải chép tay danh sách lần thứ hai. */
    const std::string type_ref = pair["typeRef"].get<std::string>();
    const bool is_conversion =
        std::any_of(st_library_registry_generated::kExplicitConversions.begin(),
                    st_library_registry_generated::kExplicitConversions.end(),
                    [&](std::string_view item) { return item == type_ref; });
    nodes.push_back({{"id", function_node},
                     {"kind", is_conversion ? "CONVERSION" : "FUNCTION"},
                     {"typeRef", pair["typeRef"]},
                     {"executionOrder", pair["inputs"].size()},
                     {"parameters", json::object()}, {"ports", function_ports}});

    const std::string output_node = uuid_for(3, 200);
    const std::string output_input = uuid_for(4, port_id++);
    nodes.push_back({
        {"id", output_node}, {"kind", "OUTPUT"}, {"typeRef", pair["outputType"]},
        {"executionOrder", pair["inputs"].size() + 1},
        {"parameters", {{"variable", "OUT"}}},
        {"ports", json::array({{{"id", output_input}, {"name", "IN"},
                                 {"direction", "INPUT"}, {"dataType", pair["outputType"]},
                                 {"unit", nullptr}, {"order", 0}}})},
    });
    wires.push_back({{"id", uuid_for(5, wire_id)},
                     {"from", {{"nodeId", function_node}, {"portId", function_output}}},
                     {"to", {{"nodeId", output_node}, {"portId", output_input}}}});

    return {{"$schema", "../../fbd_v1.schema.json"}, {"schemaVersion", 1},
            {"profileId", "revA-1t-1-5-30"}, {"graphId", uuid_for(1, 1)},
            {"name", "EQ_CASE"},
            {"networks", json::array({{{"id", uuid_for(2, 1)}, {"name", "MAIN"},
                                         {"order", 0}, {"nodes", nodes}, {"wires", wires}}})}};
}

json make_ton_graph()
{
    const std::string input_node = uuid_for(3, 1);
    const std::string constant_node = uuid_for(3, 2);
    const std::string ton_node = uuid_for(3, 3);
    const std::string output_node = uuid_for(3, 4);
    const std::string input_out = uuid_for(4, 1);
    const std::string constant_out = uuid_for(4, 2);
    const std::string ton_in = uuid_for(4, 3);
    const std::string ton_pt = uuid_for(4, 4);
    const std::string ton_q = uuid_for(4, 5);
    const std::string ton_et = uuid_for(4, 6);
    const std::string output_in = uuid_for(4, 7);
    return {
        {"$schema", "../../fbd_v1.schema.json"}, {"schemaVersion", 1},
        {"profileId", "revA-1t-1-5-30"}, {"graphId", uuid_for(1, 1)},
        {"name", "FB_CASE"},
        {"networks", json::array({{
            {"id", uuid_for(2, 1)}, {"name", "MAIN"}, {"order", 0},
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
                {{"id", uuid_for(5, 1)},
                 {"from", {{"nodeId", input_node}, {"portId", input_out}}},
                 {"to", {{"nodeId", ton_node}, {"portId", ton_in}}}},
                {{"id", uuid_for(5, 2)},
                 {"from", {{"nodeId", constant_node}, {"portId", constant_out}}},
                 {"to", {{"nodeId", ton_node}, {"portId", ton_pt}}}},
                {{"id", uuid_for(5, 3)},
                 {"from", {{"nodeId", ton_node}, {"portId", ton_q}}},
                 {"to", {{"nodeId", output_node}, {"portId", output_in}}}}
            })}
        }})}
    };
}

json make_signal_graph(bool publish)
{
    const std::string source_node = uuid_for(3, 1);
    const std::string sink_node = uuid_for(3, 2);
    const std::string source_port = uuid_for(4, 1);
    const std::string sink_port = uuid_for(4, 2);
    const json first = publish
        ? json{{"id", source_node}, {"kind", "INPUT"}, {"typeRef", "REAL"},
               {"executionOrder", 0}, {"parameters", {{"variable", "VALUE"}}},
               {"ports", json::array({{{"id", source_port}, {"name", "OUT"},
                                        {"direction", "OUTPUT"}, {"dataType", "REAL"},
                                        {"unit", nullptr}, {"order", 0}}})}}
        : json{{"id", source_node}, {"kind", "SIGNAL_READ"},
               {"typeRef", "SIGNAL_READ"}, {"executionOrder", 0},
               {"parameters", {{"signal", "SHARED_TEMP"}}},
               {"ports", json::array({{{"id", source_port}, {"name", "OUT"},
                                        {"direction", "OUTPUT"}, {"dataType", "REAL"},
                                        {"unit", nullptr}, {"order", 0}}})}};
    const json second = publish
        ? json{{"id", sink_node}, {"kind", "SIGNAL_PUBLISH"},
               {"typeRef", "SIGNAL_PUBLISH"}, {"executionOrder", 1},
               {"parameters", {{"signal", "SHARED_TEMP"}}},
               {"ports", json::array({{{"id", sink_port}, {"name", "IN"},
                                        {"direction", "INPUT"}, {"dataType", "REAL"},
                                        {"unit", nullptr}, {"order", 0}}})}}
        : json{{"id", sink_node}, {"kind", "OUTPUT"}, {"typeRef", "REAL"},
               {"executionOrder", 1}, {"parameters", {{"variable", "OBSERVED"}}},
               {"ports", json::array({{{"id", sink_port}, {"name", "IN"},
                                        {"direction", "INPUT"}, {"dataType", "REAL"},
                                        {"unit", nullptr}, {"order", 0}}})}};
    return {
        {"$schema", "../../fbd_v1.schema.json"}, {"schemaVersion", 1},
        {"profileId", "revA-1t-1-5-30"}, {"graphId", uuid_for(1, 99)},
        {"name", publish ? "SIGNAL_PRODUCER" : "SIGNAL_CONSUMER"},
        {"networks", json::array({{
            {"id", uuid_for(2, 99)}, {"name", "MAIN"}, {"order", 0},
            {"nodes", json::array({first, second})},
            {"wires", json::array({{{"id", uuid_for(5, 99)},
                                     {"from", {{"nodeId", source_node},
                                               {"portId", source_port}}},
                                     {"to", {{"nodeId", sink_node},
                                             {"portId", sink_port}}}}})}
        }})}
    };
}

std::string make_st_source(const json& pair)
{
    std::ostringstream source;
    source << "PROGRAM EQ_CASE\nVAR_INPUT\n";
    for (const auto& input : pair["inputs"]) {
        source << "  " << input["name"].get<std::string>() << " : "
               << input["type"].get<std::string>() << ";\n";
    }
    source << "END_VAR\nVAR_OUTPUT\n  OUT : " << pair["outputType"].get<std::string>()
           << ";\nEND_VAR\n  OUT := " << pair["stExpression"].get<std::string>()
           << ";\nEND_PROGRAM\n";
    return source.str();
}

bool make_runtime(const StIrModule& module, StProgramRuntime* runtime)
{
    std::vector<uint8_t> artifact;
    std::string error;
    if (!serialize_st_ir(module, &artifact, &error)) return false;
    if (!sign_st_artifact(&artifact, st_test_secret_key())) return false;
    StLoadError load_error;
    return runtime->activate(artifact.data(), artifact.size(), &load_error);
}

StValue json_value(StType type, const json& value)
{
    switch (type) {
    case StType::BOOL: return StValue::make_bool(value.get<bool>());
    case StType::INT: return StValue::make_int(value.get<int32_t>());
    case StType::DINT: return StValue::make_dint(value.get<int32_t>());
    case StType::UINT: return StValue::make_uint(value.get<uint16_t>());
    case StType::REAL: return StValue::make_real(value.get<float>());
    case StType::TIME: return StValue::make_time(value.get<int64_t>());
    }
    return StValue::make_bool(false);
}

bool value_matches(const StValue& actual, const json& expected)
{
    switch (actual.type) {
    case StType::BOOL: return actual.b == expected.get<bool>();
    case StType::INT:
    case StType::DINT:
    case StType::UINT: return actual.i == expected.get<int32_t>();
    case StType::REAL: return actual.r == expected.get<float>();
    case StType::TIME: return actual.t == expected.get<int64_t>();
    }
    return false;
}

bool has_issue(const FbdCompileResult& result, const char* code)
{
    return std::any_of(result.issues.begin(), result.issues.end(),
                       [&](const FbdIssue& issue) { return issue.code == code; });
}

TEST(StFbdCompile, EveryGoldenPairProducesByteEquivalentExecutableIrAndOutputs)
{
    const json corpus = read_json("/fbd/equivalence_v1.json");
    /* T59-601: KHÔNG khoá con số 20 nữa. Ghim một con số ở đây nghĩa là mỗi lần
     * corpus lớn thêm lại phải sửa test, và tệ hơn: một entry registry mới thêm
     * vector vẫn có thể bị bỏ quên mà không ai đỏ. Phép đếm đúng là phủ registry,
     * canh ở `test_st_library_conformance.cpp`. */
    ASSERT_GE(corpus["pairs"].size(), 20u);
    for (const auto& pair : corpus["pairs"]) {
        SCOPED_TRACE(pair["id"].get<std::string>());
        const std::string fbd_source = make_pair_graph(pair).dump();
        const FbdCompileResult fbd = compile_fbd_source(fbd_source);
        ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "không có issue" : fbd.issues[0].code);

        StIrModule st;
        StDiagnostic diagnostic;
        ASSERT_TRUE(compile_st_source(make_st_source(pair), &st, &diagnostic))
            << diagnostic.code << ": " << diagnostic.message;
        std::string reason;
        EXPECT_TRUE(fbd_ir_semantically_equivalent(st, fbd.module, &reason)) << reason;

        StProgramRuntime st_runtime;
        StProgramRuntime fbd_runtime;
        ASSERT_TRUE(make_runtime(st, &st_runtime));
        ASSERT_TRUE(make_runtime(fbd.module, &fbd_runtime));
        const auto& inputs = pair["inputs"];
        const auto& values = pair["vector"]["values"];
        ASSERT_EQ(inputs.size(), values.size());
        for (std::size_t index = 0; index < inputs.size(); ++index) {
            StType type = StType::BOOL;
            const std::string type_name = inputs[index]["type"].get<std::string>();
            if (type_name == "INT") type = StType::INT;
            else if (type_name == "DINT") type = StType::DINT;
            else if (type_name == "UINT") type = StType::UINT;
            else if (type_name == "REAL") type = StType::REAL;
            else if (type_name == "TIME") type = StType::TIME;
            const StValue value = json_value(type, values[index]);
            const std::string name = inputs[index]["name"].get<std::string>();
            ASSERT_TRUE(st_runtime.set_variable(name, value));
            ASSERT_TRUE(fbd_runtime.set_variable(name, value));
        }
        ASSERT_TRUE(st_runtime.execute(0).ok);
        ASSERT_TRUE(fbd_runtime.execute(0).ok);
        StValue st_output;
        StValue fbd_output;
        ASSERT_TRUE(st_runtime.get_variable("OUT", &st_output));
        ASSERT_TRUE(fbd_runtime.get_variable("OUT", &fbd_output));
        EXPECT_TRUE(st_value_equal(st_output, fbd_output));
        EXPECT_TRUE(value_matches(fbd_output, pair["vector"]["expected"]));
    }
}

TEST(StFbdCompile, CanonicalReorderingProducesSameExecutableIr)
{
    const json pair = read_json("/fbd/equivalence_v1.json")["pairs"][10];
    json graph = make_pair_graph(pair);
    const auto first = compile_fbd_source(graph.dump());
    ASSERT_TRUE(first.ok);
    std::reverse(graph["networks"][0]["nodes"].begin(), graph["networks"][0]["nodes"].end());
    std::reverse(graph["networks"][0]["wires"].begin(), graph["networks"][0]["wires"].end());
    const auto second = compile_fbd_source(graph.dump());
    ASSERT_TRUE(second.ok);
    std::string reason;
    EXPECT_TRUE(fbd_ir_semantically_equivalent(first.module, second.module, &reason)) << reason;
}

TEST(StFbdCompile, ExplicitConversionUsesTheSameTypedIr)
{
    json pair = {{"id", "EQ-CVT"}, {"typeRef", "INT_TO_DINT"},
                 {"inputs", json::array({{{"name", "A"}, {"type", "INT"}}})},
                 {"outputType", "DINT"}, {"stExpression", "INT_TO_DINT(A)"},
                 {"vector", {{"values", json::array({7})}, {"expected", 7}}}};
    json graph = make_pair_graph(pair);
    graph["networks"][0]["nodes"][1]["kind"] = "CONVERSION";
    const auto fbd = compile_fbd_source(graph.dump());
    ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "không có issue" : fbd.issues[0].code);
    StIrModule st;
    StDiagnostic diagnostic;
    ASSERT_TRUE(compile_st_source(make_st_source(pair), &st, &diagnostic));
    std::string reason;
    EXPECT_TRUE(fbd_ir_semantically_equivalent(st, fbd.module, &reason)) << reason;
}

TEST(StFbdCompile, TonStateTraceMatchesStructuredText)
{
    const auto fbd = compile_fbd_source(make_ton_graph().dump());
    ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "không có issue" : fbd.issues[0].code);
    StIrModule st;
    StDiagnostic diagnostic;
    ASSERT_TRUE(compile_st_source(R"ST(
PROGRAM FB_CASE
VAR_INPUT ENABLE : BOOL; END_VAR
VAR_OUTPUT OUT : BOOL; END_VAR
VAR TIMER : TON; END_VAR
TIMER(IN := ENABLE, PT := T#1s);
OUT := TIMER.Q;
END_PROGRAM
)ST", &st, &diagnostic)) << diagnostic.code << ": " << diagnostic.message;
    std::string reason;
    EXPECT_TRUE(fbd_ir_semantically_equivalent(st, fbd.module, &reason)) << reason;

    StProgramRuntime st_runtime;
    StProgramRuntime fbd_runtime;
    ASSERT_TRUE(make_runtime(st, &st_runtime));
    ASSERT_TRUE(make_runtime(fbd.module, &fbd_runtime));
    ASSERT_TRUE(st_runtime.set_variable("ENABLE", StValue::make_bool(true)));
    ASSERT_TRUE(fbd_runtime.set_variable("ENABLE", StValue::make_bool(true)));
    for (const int64_t now : {0LL, 500000000LL, 1000000000LL}) {
        ASSERT_TRUE(st_runtime.execute(now).ok);
        ASSERT_TRUE(fbd_runtime.execute(now).ok);
        StValue st_output;
        StValue fbd_output;
        ASSERT_TRUE(st_runtime.get_variable("OUT", &st_output));
        ASSERT_TRUE(fbd_runtime.get_variable("OUT", &fbd_output));
        EXPECT_TRUE(st_value_equal(st_output, fbd_output));
    }
}

TEST(StFbdCompile, RejectsUnconnectedInputWithoutPublishingPartialIr)
{
    const json pair = read_json("/fbd/equivalence_v1.json")["pairs"][0];
    json graph = make_pair_graph(pair);
    graph["networks"][0]["wires"].erase(graph["networks"][0]["wires"].begin());
    const auto result = compile_fbd_source(graph.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-UNCONNECTED-001"));
    EXPECT_TRUE(result.module.code.empty());
    EXPECT_TRUE(result.module.variables.empty());
}

TEST(StFbdCompile, PreservesUnitAnchorsWithoutChangingExecutableIr)
{
    const json pair = read_json("/fbd/equivalence_v1.json")["pairs"][10];
    json graph = make_pair_graph(pair);
    for (json& node : graph["networks"][0]["nodes"])
        for (json& port : node["ports"]) port["unit"] = "degC";
    const auto result = compile_fbd_source(graph.dump());
    ASSERT_TRUE(result.ok) << (result.issues.empty() ? "không có issue" : result.issues[0].code);
    ASSERT_FALSE(result.source_anchors.empty());
    EXPECT_TRUE(std::all_of(result.source_anchors.begin(), result.source_anchors.end(),
                            [](const FbdSourceAnchor& anchor) {
                                return anchor.has_unit && anchor.unit == "degC";
                            }));
    EXPECT_FALSE(result.module.source_map.empty());
}

TEST(StFbdCompile, RejectsLibraryNodeWithoutCommonRuntimeSemantic)
{
    /* Trước T59-003, `CTU` nằm trong allowlist model nhưng KHÔNG có lowering,
     * nên nó lọt qua lớp model rồi mới bị chặn ở lớp semantic. Nay registry chỉ
     * chứa entry compiler thật giải được, nên entry ma bị chặn SỚM HƠN ở lớp
     * model — vẫn fail-closed, và không còn class lỗi "hợp lệ ở FE, chết ở Core".
     * Test giữ nguyên ý định (typeRef không có runtime semantic bị từ chối) và
     * khoá luôn việc rejection xảy ra mà KHÔNG sinh code. */
    const json pair = read_json("/fbd/equivalence_v1.json")["pairs"][0];
    for (const char* ghost : {"CTU", "PI", "SCALE", "DEADBAND", "KHONG_TON_TAI"}) {
        json graph = make_pair_graph(pair);
        graph["networks"][0]["nodes"][2]["kind"] = "FUNCTION_BLOCK";
        graph["networks"][0]["nodes"][2]["typeRef"] = ghost;
        const auto result = compile_fbd_source(graph.dump());
        EXPECT_FALSE(result.ok) << ghost;
        EXPECT_TRUE(result.module.code.empty()) << ghost;
        EXPECT_FALSE(result.issues.empty()) << ghost;
    }
}

TEST(StFbdCompile, LibraryUnsupportedGuardStillFiresForFunctionKindMismatch)
{
    /* Guard `FBD-SEM-LIBRARY-UNSUPPORTED-001` vẫn phải sống: một typeRef hợp lệ
     * nhưng khai sai kind vẫn phải chạm đúng guard đó, chứ không phải im lặng. */
    const json pair = read_json("/fbd/equivalence_v1.json")["pairs"][0];
    json graph = make_pair_graph(pair);
    graph["networks"][0]["nodes"][2]["kind"] = "FUNCTION";
    graph["networks"][0]["nodes"][2]["typeRef"] = "TON";
    const auto result = compile_fbd_source(graph.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(result.module.code.empty());
}

TEST(StFbdCompile, RejectsHostileVariableIdentifier)
{
    const json pair = read_json("/fbd/equivalence_v1.json")["pairs"][0];
    json graph = make_pair_graph(pair);
    graph["networks"][0]["nodes"][0]["parameters"]["variable"] = "../../SECRET";
    const auto result = compile_fbd_source(graph.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-PARAM-001"));
}

TEST(StFbdCompile, RejectsFunctionBlockInstanceWithWrongType)
{
    json graph = make_ton_graph();
    graph["networks"][0]["nodes"][2]["parameters"]["instance"] = true;
    const auto result = compile_fbd_source(graph.dump());
    EXPECT_FALSE(result.ok);
    EXPECT_TRUE(has_issue(result, "FBD-SEM-PARAM-001"));
    EXPECT_TRUE(result.module.code.empty());
}

TEST(StFbdCompile, SignalReadAndPublishLowerToTheSameTypedIrAsStructuredText)
{
    const std::vector<StPublishedSignalContract> signals = {
        {"SHARED_TEMP", StType::REAL, "P_pub"},
    };
    struct Case {
        bool publish;
        const char* program_id;
        const char* st_source;
    };
    const Case cases[] = {
        {false, "P_cons",
         "PROGRAM SIGNAL_CONSUMER\nVAR_OUTPUT OBSERVED : REAL; END_VAR\n"
         "OBSERVED := SIGNAL_READ(SHARED_TEMP);\nEND_PROGRAM\n"},
        {true, "P_pub",
         "PROGRAM SIGNAL_PRODUCER\nVAR_INPUT VALUE : REAL; END_VAR\n"
         "SIGNAL_PUBLISH(SHARED_TEMP, VALUE);\nEND_PROGRAM\n"},
    };
    for (const Case& item : cases) {
        SCOPED_TRACE(item.program_id);
        StCompileOptions options;
        options.enforce_review_gate = false;
        options.program_identity = item.program_id;
        options.published_signals = signals;
        const FbdCompileResult fbd = compile_fbd_source(make_signal_graph(item.publish).dump(),
                                                        options);
        ASSERT_TRUE(fbd.ok)
            << (fbd.issues.empty() ? "không có issue"
                                   : fbd.issues[0].code + ": " + fbd.issues[0].path);
        ASSERT_EQ(fbd.module.signal_refs.size(), 1U);
        EXPECT_EQ(fbd.module.signal_refs[0].name, "SHARED_TEMP");
        EXPECT_EQ(fbd.module.signal_refs[0].type, StType::REAL);
        EXPECT_EQ(fbd.module.signal_refs[0].read, !item.publish);
        EXPECT_EQ(fbd.module.signal_refs[0].publish, item.publish);
        EXPECT_TRUE(std::any_of(fbd.module.code.begin(), fbd.module.code.end(),
                                [&](const StInstr& instruction) {
                                    return instruction.op ==
                                           (item.publish ? StOp::SIGNAL_PUBLISH
                                                         : StOp::SIGNAL_READ);
                                }));

        StIrModule st;
        StDiagnostic diagnostic;
        ASSERT_TRUE(compile_st_source(item.st_source, &st, &diagnostic, options))
            << diagnostic.code << ": " << diagnostic.message;
        std::string reason;
        EXPECT_TRUE(fbd_ir_semantically_equivalent(st, fbd.module, &reason)) << reason;
    }
}

TEST(StFbdCompile, SignalSemanticFailuresAreStableAndPublishNoPartialIr)
{
    StCompileOptions options;
    options.enforce_review_gate = false;
    options.program_identity = "P_other";
    options.published_signals = {{"SHARED_TEMP", StType::REAL, "P_pub"}};
    FbdCompileResult result = compile_fbd_source(make_signal_graph(true).dump(), options);
    ASSERT_FALSE(result.ok);
    ASSERT_FALSE(result.issues.empty());
    EXPECT_EQ(result.issues[0].code, "FBD-SEM-LOWER-001");
    EXPECT_NE(result.issues[0].path.find(st_diag_code::kSignalDuplicatePublisher),
              std::string::npos) << result.issues[0].path;
    EXPECT_TRUE(result.module.code.empty());
    EXPECT_TRUE(result.module.signal_refs.empty());

    options.program_identity = "P_cons";
    options.published_signals.clear();
    result = compile_fbd_source(make_signal_graph(false).dump(), options);
    ASSERT_FALSE(result.ok);
    ASSERT_FALSE(result.issues.empty());
    EXPECT_NE(result.issues[0].path.find(st_diag_code::kSignalConsumerMissing),
              std::string::npos) << result.issues[0].path;
    EXPECT_TRUE(result.module.code.empty());
}

} // namespace
} // namespace core
