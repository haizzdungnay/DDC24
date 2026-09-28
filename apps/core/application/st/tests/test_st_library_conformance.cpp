/**
 * @file  test_st_library_conformance.cpp
 * @brief T59-601 — corpus conformance ST↔FBD phủ 100% Control Library registry.
 *
 *        Vì sao cần một file riêng thay vì thêm case vào test có sẵn: bộ 20 cặp
 *        cũ khoá đúng 20 entry nó liệt kê, nên một entry MỚI thêm vào registry
 *        không làm test nào đỏ — nó chỉ đơn giản không được ai chạy. Thư viện
 *        điều khiển là thứ người dùng cuối gọi trong logic vận hành: một entry
 *        có mặt trên UI mà chưa từng chạy qua vector nào là một lời hứa chưa
 *        được kiểm.
 *
 *        Bởi vậy phép kiểm ở đây là HAI CHIỀU và tính từ chính registry
 *        machine-readable:
 *          - mọi entry trong registry phải có vector (thiếu ⇒ đỏ);
 *          - mọi vector phải trỏ tới một entry có thật (thừa ⇒ đỏ).
 *
 *        Entry có STATE (TON/TOF/R_TRIG/F_TRIG/PID) không kiểm được bằng một
 *        phép tính một chu kỳ: cái sai điển hình của chúng là state chuyển sai
 *        giữa các chu kỳ, không phải công thức trong một chu kỳ. Vì thế chúng đi
 *        bằng TRACE nhiều chu kỳ, chạy song song ST và FBD trên cùng mốc thời
 *        gian và so từng chu kỳ một.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <iterator>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_fbd_compile.hpp"
#include "st/st_library_registry_generated.hpp"
#include "st/st_runtime.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

using json = nlohmann::json;

json read_contract()
{
    std::ifstream input(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) +
                        "/fbd/equivalence_v1.json");
    return json::parse(std::string(std::istreambuf_iterator<char>(input),
                                   std::istreambuf_iterator<char>()));
}

std::set<std::string> registry_entries()
{
    std::set<std::string> names;
    for (std::string_view item : st_library_registry_generated::kOperators)
        names.emplace(item);
    for (std::string_view item : st_library_registry_generated::kFuncTable)
        names.emplace(item);
    /* Hàm KHAI TRIỂN (`EXPANSION`) cũng là entry người dùng gọi được, nên nó
     * phải nằm trong mẫu số phủ conformance — bỏ qua chúng sẽ làm "100% phủ"
     * nói dối đúng bằng số entry bị bỏ qua. */
    for (std::string_view item : st_library_registry_generated::kExpansionFunctions)
        names.emplace(item);
    for (std::string_view item : st_library_registry_generated::kFbTypes)
        names.emplace(item);
    return names;
}

std::string uuid_for(unsigned family, unsigned value)
{
    char text[37];
    std::snprintf(text, sizeof(text), "%08x-0000-4000-8000-%012x", family, value);
    return text;
}

StType type_from_name(const std::string& name)
{
    if (name == "INT") return StType::INT;
    if (name == "DINT") return StType::DINT;
    if (name == "UINT") return StType::UINT;
    if (name == "REAL") return StType::REAL;
    if (name == "TIME") return StType::TIME;
    return StType::BOOL;
}

StValue value_from_json(StType type, const json& value)
{
    switch (type) {
    case StType::BOOL: return StValue::make_bool(value.get<bool>());
    /* Issue #801: trace đầu tiên có biến vào UINT (`WORD_TO_BITS`). Dựng giá trị
     * đúng kiểu — `set_variable` từ chối UINT mang thẻ INT, đúng như nó phải. */
    case StType::INT: return StValue::make_int(value.get<int32_t>());
    case StType::DINT: return StValue::make_dint(value.get<int32_t>());
    case StType::UINT: return StValue::make_uint(value.get<uint16_t>());
    case StType::REAL: return StValue::make_real(value.get<float>());
    case StType::TIME: return StValue::make_time(value.get<int64_t>());
    }
    return StValue::make_bool(false);
}

/* Chương trình ST cho một trace: khai đúng biến vào/ra của trace rồi gọi FB một
 * lần mỗi chu kỳ. Mọi tham số đi bằng BIẾN chứ không bằng literal để ST và FBD
 * nhận cùng một giá trị từ cùng một nguồn — literal ở hai phía là hai cơ hội
 * lệch nhau mà test sẽ không phân biệt được với lỗi state. */
std::string make_trace_st_source(const json& trace)
{
    std::ostringstream source;
    source << "PROGRAM FB_CASE\nVAR_INPUT\n";
    for (const auto& input : trace["inputs"])
        source << "  " << input["variable"].get<std::string>() << " : "
               << input["type"].get<std::string>() << ";\n";
    source << "END_VAR\nVAR_OUTPUT\n";
    for (const auto& output : trace["outputs"])
        source << "  " << output["variable"].get<std::string>() << " : "
               << output["type"].get<std::string>() << ";\n";
    source << "END_VAR\nVAR\n  " << trace["instance"].get<std::string>() << " : "
           << trace["typeRef"].get<std::string>() << ";\nEND_VAR\n  "
           << trace["instance"].get<std::string>() << "(";
    bool first = true;
    for (const auto& input : trace["inputs"]) {
        if (!first) source << ", ";
        first = false;
        source << input["port"].get<std::string>() << " := "
               << input["variable"].get<std::string>();
    }
    source << ");\n";
    for (const auto& output : trace["outputs"])
        source << "  " << output["variable"].get<std::string>() << " := "
               << trace["instance"].get<std::string>() << "."
               << output["port"].get<std::string>() << ";\n";
    source << "END_PROGRAM\n";
    return source.str();
}

/* Đồ thị FBD tương đương: INPUT → FUNCTION_BLOCK → OUTPUT. Cổng của FB khai
 * ĐỦ theo bố trí trong `st_program.cpp` (kể cả cổng không nối, ví dụ `ET`) —
 * khai thiếu cổng là mô tả một khối khác với khối compiler thật sẽ dựng. */
json make_trace_graph(const json& trace)
{
    json nodes = json::array();
    json wires = json::array();
    unsigned port_id = 1;
    unsigned wire_id = 1;
    unsigned node_id = 1;
    const std::string fb_node = uuid_for(3, 500);

    json fb_ports = json::array();
    unsigned order = 0;
    std::vector<std::pair<std::string, std::string>> input_wires; /* nodeId, portId */

    for (const auto& input : trace["inputs"]) {
        const std::string source_node = uuid_for(3, node_id++);
        const std::string source_port = uuid_for(4, port_id++);
        nodes.push_back({
            {"id", source_node}, {"kind", "INPUT"}, {"typeRef", input["type"]},
            {"executionOrder", order},
            {"parameters", {{"variable", input["variable"]}}},
            {"ports", json::array({{{"id", source_port}, {"name", "OUT"},
                                     {"direction", "OUTPUT"}, {"dataType", input["type"]},
                                     {"unit", nullptr}, {"order", 0}}})},
        });
        const std::string fb_port = uuid_for(4, port_id++);
        fb_ports.push_back({{"id", fb_port}, {"name", input["port"]},
                            {"direction", "INPUT"}, {"dataType", input["type"]},
                            {"unit", nullptr}, {"order", order}});
        wires.push_back({{"id", uuid_for(5, wire_id++)},
                         {"from", {{"nodeId", source_node}, {"portId", source_port}}},
                         {"to", {{"nodeId", fb_node}, {"portId", fb_port}}}});
        ++order;
    }

    const unsigned fb_order = order;
    std::vector<std::string> output_ports;
    for (const auto& output : trace["outputs"]) {
        const std::string fb_port = uuid_for(4, port_id++);
        output_ports.push_back(fb_port);
        fb_ports.push_back({{"id", fb_port}, {"name", output["port"]},
                            {"direction", "OUTPUT"}, {"dataType", output["type"]},
                            {"unit", nullptr}, {"order", order++}});
    }
    for (const auto& unused : trace["unusedOutputPorts"]) {
        fb_ports.push_back({{"id", uuid_for(4, port_id++)}, {"name", unused["port"]},
                            {"direction", "OUTPUT"}, {"dataType", unused["type"]},
                            {"unit", nullptr}, {"order", order++}});
    }

    nodes.push_back({{"id", fb_node}, {"kind", "FUNCTION_BLOCK"},
                     {"typeRef", trace["typeRef"]}, {"executionOrder", fb_order},
                     {"parameters", {{"instance", trace["instance"]}}},
                     {"ports", fb_ports}});

    unsigned sink_order = fb_order + 1;
    for (std::size_t index = 0; index < trace["outputs"].size(); ++index) {
        const auto& output = trace["outputs"][index];
        const std::string sink_node = uuid_for(3, 600 + static_cast<unsigned>(index));
        const std::string sink_port = uuid_for(4, port_id++);
        nodes.push_back({
            {"id", sink_node}, {"kind", "OUTPUT"}, {"typeRef", output["type"]},
            {"executionOrder", sink_order++},
            {"parameters", {{"variable", output["variable"]}}},
            {"ports", json::array({{{"id", sink_port}, {"name", "IN"},
                                     {"direction", "INPUT"}, {"dataType", output["type"]},
                                     {"unit", nullptr}, {"order", 0}}})},
        });
        wires.push_back({{"id", uuid_for(5, wire_id++)},
                         {"from", {{"nodeId", fb_node}, {"portId", output_ports[index]}}},
                         {"to", {{"nodeId", sink_node}, {"portId", sink_port}}}});
    }

    return {{"$schema", "../../fbd_v1.schema.json"}, {"schemaVersion", 1},
            {"profileId", "revA-1t-1-5-30"}, {"graphId", uuid_for(1, 1)},
            {"name", "FB_CASE"},
            {"networks", json::array({{{"id", uuid_for(2, 1)}, {"name", "MAIN"},
                                        {"order", 0}, {"nodes", nodes},
                                        {"wires", wires}}})}};
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

void expect_matches(const StValue& actual, const json& expected, StType type,
                    double tolerance)
{
    switch (type) {
    case StType::BOOL: EXPECT_EQ(actual.b, expected.get<bool>()); break;
    case StType::REAL: EXPECT_NEAR(actual.r, expected.get<float>(), tolerance); break;
    case StType::TIME: EXPECT_EQ(actual.t, expected.get<int64_t>()); break;
    default: EXPECT_EQ(actual.i, expected.get<int32_t>()); break;
    }
}

} // namespace

/* ---- Phủ registry: hai chiều, tính từ chính registry sinh máy ---- */

TEST(StLibraryConformance, EveryRegistryEntryHasAConformanceVector)
{
    const json contract = read_contract();
    std::set<std::string> covered;
    for (const auto& pair : contract["pairs"])
        covered.emplace(pair["typeRef"].get<std::string>());
    for (const auto& trace : contract["stateTraces"])
        covered.emplace(trace["typeRef"].get<std::string>());

    const std::set<std::string> entries = registry_entries();
    std::vector<std::string> missing;
    for (const std::string& entry : entries)
        if (covered.count(entry) == 0) missing.push_back(entry);

    EXPECT_TRUE(missing.empty())
        << "entry trong registry nhưng KHÔNG có vector nào chạy: "
        << ::testing::PrintToString(missing);
    EXPECT_EQ(covered.size(), entries.size());
}

TEST(StLibraryConformance, NoVectorTargetsAnEntryOutsideTheRegistry)
{
    const json contract = read_contract();
    const std::set<std::string> entries = registry_entries();
    /* Chiều ngược lại quan trọng không kém: một vector trỏ tới entry đã bị gỡ
     * khỏi registry vẫn xanh mãi mãi và làm số phủ trông đẹp hơn sự thật. */
    for (const auto& pair : contract["pairs"])
        EXPECT_EQ(entries.count(pair["typeRef"].get<std::string>()), 1u)
            << pair["id"].get<std::string>();
    for (const auto& trace : contract["stateTraces"])
        EXPECT_EQ(entries.count(trace["typeRef"].get<std::string>()), 1u)
            << trace["id"].get<std::string>();
}

/* Cửa hậu vừa mở ở `compile_fbd_source(source, options)` phải KHÔNG chạm được
 * từ đường production. Không có test này, một call site quên truyền options mặc
 * định sẽ biến bộ conformance thành đường vòng qua review gate — đúng thứ mà
 * chính review gate tồn tại để chặn. */
TEST(StLibraryConformance, ProductionFbdEntryPointStillBlocksReviewGatedEntries)
{
    const json contract = read_contract();
    const json* pid_trace = nullptr;
    for (const auto& trace : contract["stateTraces"])
        if (trace["typeRef"] == "PID") pid_trace = &trace;
    ASSERT_NE(pid_trace, nullptr) << "corpus phải có trace cho entry bị gate";

    const std::string source = make_trace_graph(*pid_trace).dump();
    const FbdCompileResult blocked = compile_fbd_source(source);
    EXPECT_FALSE(blocked.ok) << "đường production KHÔNG được tự mở review gate";
    ASSERT_FALSE(blocked.issues.empty());
    EXPECT_EQ(blocked.issues[0].code, std::string(st_diag_code::kPidApprovalMissing));

    StCompileOptions harness;
    harness.enforce_review_gate = false;
    EXPECT_TRUE(compile_fbd_source(source, harness).ok)
        << "đường conformance phải dựng được, nếu không thì không có evidence để mở gate";
}

TEST(StLibraryConformance, EveryStatefulEntryMatchesCycleByCycleInStAndFbd)
{
    const json contract = read_contract();
    ASSERT_FALSE(contract["stateTraces"].empty());

    for (const auto& trace : contract["stateTraces"]) {
        SCOPED_TRACE(trace["id"].get<std::string>() + " " +
                     trace["typeRef"].get<std::string>());
        const double tolerance = trace.value("tolerance", 0.0);

        StIrModule st_module;
        StDiagnostic diagnostic;
        StCompileOptions options;
        /* Cùng lý do với các harness conformance khác (T59-205): review gate
         * chặn PID ở đường Check, còn đây chính là nơi dựng evidence cho nó. */
        options.enforce_review_gate = false;
        ASSERT_TRUE(compile_st_source(make_trace_st_source(trace), &st_module, &diagnostic,
                                      options))
            << diagnostic.code << ": " << diagnostic.message;

        const FbdCompileResult fbd =
            compile_fbd_source(make_trace_graph(trace).dump(), options);
        ASSERT_TRUE(fbd.ok) << (fbd.issues.empty() ? "không có issue" : fbd.issues[0].code);

        StProgramRuntime st_runtime;
        StProgramRuntime fbd_runtime;
        ASSERT_TRUE(make_runtime(st_module, &st_runtime));
        ASSERT_TRUE(make_runtime(fbd.module, &fbd_runtime));

        for (const auto& cycle : trace["cycles"]) {
            const int64_t now_ns = cycle["nowNs"].get<int64_t>();
            SCOPED_TRACE("nowNs=" + std::to_string(now_ns));
            for (const auto& input : trace["inputs"]) {
                const std::string variable = input["variable"].get<std::string>();
                const StType type = type_from_name(input["type"].get<std::string>());
                const StValue value = value_from_json(type, cycle["values"][variable]);
                ASSERT_TRUE(st_runtime.set_variable(variable, value));
                ASSERT_TRUE(fbd_runtime.set_variable(variable, value));
            }
            ASSERT_TRUE(st_runtime.execute(static_cast<uint64_t>(now_ns)).ok);
            ASSERT_TRUE(fbd_runtime.execute(static_cast<uint64_t>(now_ns)).ok);

            for (const auto& output : trace["outputs"]) {
                const std::string variable = output["variable"].get<std::string>();
                const StType type = type_from_name(output["type"].get<std::string>());
                StValue st_value;
                StValue fbd_value;
                ASSERT_TRUE(st_runtime.get_variable(variable, &st_value));
                ASSERT_TRUE(fbd_runtime.get_variable(variable, &fbd_value));
                expect_matches(st_value, cycle["expected"][variable], type, tolerance);
                /* Hai ngôn ngữ phải cho CÙNG một state, không chỉ cùng đáp số ở
                 * chu kỳ cuối: so từng chu kỳ mới bắt được sai lệch tích luỹ. */
                expect_matches(fbd_value, cycle["expected"][variable], type, tolerance);
            }
        }
    }
}

} // namespace core
