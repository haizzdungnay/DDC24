/**
 * @file  test_programming_sim_scenario.cpp
 * @brief U-16 (REC-DDC-FIELD-USE-20260927) — chạy kịch bản trên `SimSession`
 *        (lõi của `mkddc-st-sim`). Package dựng bằng compiler + writer
 *        production, không dùng blob giả.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <sys/wait.h>
#include <unistd.h>

#include "programming/simulation/sim_error.hpp"
#include "programming/simulation/sim_scenario.hpp"
#include "programming/simulation/sim_session.hpp"
#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_test_key.hpp"

namespace core::programming::sim {
namespace {

std::vector<uint8_t> single_program_package(const std::string& name, const std::string& source, uint32_t period_ms)
{
    StIrModule module;
    StDiagnostic diagnostic;
    StCompileOptions options;
    options.enforce_review_gate = false;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic, options)) << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> ir;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &ir, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&ir, st_test_secret_key()));
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    StPackageProgram program;
    program.program_name = name;
    program.ir_blob = ir;
    program.period_ms = period_ms;
    input.programs.push_back(std::move(program));
    StPouSignature signature;
    signature.name = name;
    signature.kind = StPouKind::PROGRAM;
    input.pou_signatures.push_back(std::move(signature));
    std::vector<uint8_t> bytes;
    EXPECT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    return bytes;
}

const char* kToggleSource = R"ST(
PROGRAM Toggle
VAR_INPUT  En : BOOL; Div : INT; END_VAR
VAR_OUTPUT Q : BOOL; Runs : DINT; Ratio : INT; END_VAR
    Runs := Runs + 1;
    IF En THEN Q := NOT Q; END_IF;
    Ratio := 100 / Div;
END_PROGRAM
)ST";

void prepare(SimSession* session)
{
    const std::vector<uint8_t> package = single_program_package("Toggle", kToggleSource, 100u);
    const char* code = nullptr;
    std::string detail;
    ASSERT_TRUE(session->prepare(package, st_profile_generated::kProfileCode, st_profile_generated::kTargetAbi,
                                 &code, &detail)) << (code ? code : "") << " " << detail;
}

SimScenario scenario_from(const std::string& text)
{
    SimScenario scenario;
    std::string error;
    EXPECT_TRUE(parse_sim_scenario(text, &scenario, &error)) << error;
    return scenario;
}

std::vector<std::string> lines_of(const std::string& text)
{
    std::vector<std::string> lines;
    std::istringstream stream(text);
    for (std::string line; std::getline(stream, line);) lines.push_back(line);
    return lines;
}

TEST(SimScenario, WritesOneRowPerReleaseAndAppliesEventsAtTheirTime)
{
    SimSession session;
    prepare(&session);
    const SimScenario scenario = scenario_from(R"({"schemaVersion":1,"durationMs":1000,
        "events":[{"atMs":0,"input":"Toggle.Div","value":5},{"atMs":300,"input":"Toggle.En","value":true}],
        "observe":["Toggle.En","Toggle.Q","Toggle.Runs","Toggle.Ratio"]})");
    std::ostringstream csv;
    const SimScenarioResult result = run_sim_scenario(&session, scenario, csv);
    ASSERT_TRUE(result.ok) << result.error_code << " " << result.detail;
    const std::vector<std::string> lines = lines_of(csv.str());
    ASSERT_EQ(lines.front(), "timeMs,Toggle.En,Toggle.Q,Toggle.Runs,Toggle.Ratio");
    /* Program 100 ms chạy ở 0, 100, …, 1000 ms: 11 lần release, 11 dòng. */
    EXPECT_EQ(result.rows, 11u);
    ASSERT_EQ(lines.size(), 12u);
    EXPECT_EQ(lines[1], "0,0,0,1,20");
    EXPECT_EQ(lines[3], "200,0,0,3,20");      /* En chưa bật: Q giữ nguyên */
    EXPECT_EQ(lines[4], "300,1,1,4,20");      /* En bật đúng tại 300 ms: Q đảo */
    EXPECT_EQ(lines[5], "400,1,0,5,20");
    EXPECT_EQ(lines.back(), "1000,1,0,11,20");
}

/* Tên input gõ sai phải lộ ra TRƯỚC khi chạy tick đầu tiên. */
TEST(SimScenario, RejectsUnknownInputBeforeRunning)
{
    SimSession session;
    prepare(&session);
    const SimScenario scenario = scenario_from(R"({"schemaVersion":1,"durationMs":500,
        "events":[{"atMs":400,"input":"Toggle.Enable","value":1}]})");
    std::ostringstream csv;
    const SimScenarioResult result = run_sim_scenario(&session, scenario, csv);
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.error_code, "SIM-SCENARIO-INPUT");
    EXPECT_EQ(result.steps, 0u);
    EXPECT_TRUE(csv.str().empty());
}

/* Program fault giữa kịch bản: dừng, báo mã SIM của phiên và thời điểm ảo. */
TEST(SimScenario, StopsAtRuntimeFaultWithVirtualTime)
{
    SimSession session;
    prepare(&session);
    const SimScenario scenario = scenario_from(R"({"schemaVersion":1,"durationMs":1000,
        "events":[{"atMs":0,"input":"Toggle.Div","value":4},{"atMs":250,"input":"Toggle.Div","value":0}]})");
    std::ostringstream csv;
    const SimScenarioResult result = run_sim_scenario(&session, scenario, csv);
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.error_code, kErrExecFault);
    EXPECT_EQ(result.fault_at_ms, 300u);   /* release đầu tiên sau khi Div = 0 */
    EXPECT_EQ(result.rows, 3u);            /* 0, 100, 200 ms */
}

TEST(SimScenario, RejectsMalformedScenario)
{
    for (const char* text : {R"({"durationMs":1000})",
                             R"({"schemaVersion":1,"durationMs":0})",
                             R"({"schemaVersion":1,"durationMs":100,"events":[{"atMs":200,"input":"P.X","value":1}]})",
                             R"({"schemaVersion":1,"durationMs":100,"observe":"P.X"})",
                             R"({"schemaVersion":1,"durationMs":100,"events":[{"atMs":0,"input":"P.X","value":"on"}]})",
                             "không phải json"}) {
        SimScenario scenario;
        std::string error;
        EXPECT_FALSE(parse_sim_scenario(text, &scenario, &error)) << text;
        EXPECT_FALSE(error.empty()) << text;
    }
}

TEST(SimScenario, RejectsValueThatDoesNotFitInputType)
{
    SimSession session;
    prepare(&session);
    const SimScenario scenario = scenario_from(R"({"schemaVersion":1,"durationMs":100,
        "events":[{"atMs":0,"input":"Toggle.Div","value":2.5}]})");
    std::ostringstream csv;
    const SimScenarioResult result = run_sim_scenario(&session, scenario, csv);
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.error_code, "SIM-SCENARIO-INPUT");
}

#ifdef ST_SIM_CLI_PATH
std::string temp_file(const std::string& content)
{
    char path[] = "/tmp/mkddc-st-sim-test-XXXXXX";
    const int fd = ::mkstemp(path);
    EXPECT_GE(fd, 0);
    if (fd >= 0) ::close(fd);
    std::ofstream(path, std::ios::binary) << content;
    return path;
}

struct CliResult {
    int exit_code = -1;
    std::string stdout_text;
};

CliResult run_sim_cli(const std::string& arguments)
{
    CliResult result;
    const std::string command = std::string(ST_SIM_CLI_PATH) + " " + arguments;
    FILE* pipe = ::popen(command.c_str(), "r");
    if (pipe == nullptr) return result;
    char buffer[512];
    while (std::fgets(buffer, sizeof(buffer), pipe) != nullptr) result.stdout_text += buffer;
    const int status = ::pclose(pipe);
    result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    return result;
}

/* Chạy chính binary `mkddc-st-sim` như người dùng CI: package trên đĩa, khoá
 * công khai dạng hex, kịch bản JSON, CSV ra file; stdout một dòng JSON. */
TEST(SimScenarioCli, RunsPackageFromDiskAndWritesCsv)
{
    const std::vector<uint8_t> package = single_program_package("Toggle", kToggleSource, 100u);
    const std::string package_path = temp_file(std::string(package.begin(), package.end()));
    std::string key_hex;
    static constexpr char kHex[] = "0123456789abcdef";
    for (int index = 32; index < 64; ++index) {
        key_hex.push_back(kHex[st_test_secret_key()[index] >> 4]);
        key_hex.push_back(kHex[st_test_secret_key()[index] & 0x0F]);
    }
    const std::string key_path = temp_file(key_hex + "\n");
    const std::string scenario_path = temp_file(R"({"schemaVersion":1,"durationMs":300,
        "events":[{"atMs":0,"input":"Toggle.Div","value":2}],"observe":["Toggle.Runs","Toggle.Ratio"]})");
    const std::string csv_path = temp_file("");

    const CliResult run = run_sim_cli("--package " + package_path + " --trusted-key " + key_path +
                                      " --scenario " + scenario_path + " --out " + csv_path);
    EXPECT_EQ(run.exit_code, 0) << run.stdout_text;
    EXPECT_NE(run.stdout_text.find("\"ok\":true"), std::string::npos) << run.stdout_text;
    std::ifstream csv(csv_path);
    std::stringstream text;
    text << csv.rdbuf();
    EXPECT_EQ(text.str(), "timeMs,Toggle.Runs,Toggle.Ratio\n0,1,50\n100,2,50\n200,3,50\n300,4,50\n");

    const CliResult missing = run_sim_cli("--package " + package_path);
    EXPECT_EQ(missing.exit_code, 2);
    EXPECT_NE(missing.stdout_text.find("SIM-CLI-ARGS"), std::string::npos) << missing.stdout_text;

    for (const std::string& path : {package_path, key_path, scenario_path, csv_path}) ::unlink(path.c_str());
}
#endif

} // namespace
} // namespace core::programming::sim
