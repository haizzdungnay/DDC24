/**
 * @file  programming_st_sim_main.cpp
 * @brief `mkddc-st-sim` — chạy thử một package Programming trên HOST theo kịch
 *        bản, xuất CSV từng lần Program release (U-16, REC-DDC-FIELD-USE-20260927).
 *
 *        Công cụ phát triển, KHÔNG cài lên bo. Dùng đúng `SimSession` của chế độ
 *        SIMULATE (ADR-053), nên hành vi trùng với mô phỏng trên web và với
 *        runtime trên tủ ở mức loader/executor.
 *
 *        Luồng dùng trong CI của dự án ứng dụng:
 *          mkddc-st-compile --key dev.key ... --out prg.mkir
 *          mkddc-st-package ... --out package.bin
 *          mkddc-st-sim --package package.bin --trusted-key dev.pub \
 *                       --scenario scenario.json --out run.csv
 *
 *        stdout: đúng một dòng JSON tóm tắt. Exit: 0 chạy hết kịch bản;
 *        1 Program fault hoặc kịch bản không khớp package; 2 lỗi tham số/IO/nạp.
 */
#include <array>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include <sodium.h>

#include "programming/simulation/sim_scenario.hpp"
#include "programming/simulation/sim_session.hpp"
#include "st/st_loader.hpp"
#include "st/st_profile_generated.hpp"

namespace {

using nlohmann::json;
namespace sim = core::programming::sim;

int finish(int exit_code, json summary)
{
    std::printf("%s\n", summary.dump().c_str());
    return exit_code;
}

int usage_error(const std::string& message)
{
    return finish(2, json{{"ok", false}, {"errorCode", "SIM-CLI-ARGS"}, {"detail", message}});
}

bool read_bytes(const std::string& path, std::vector<uint8_t>* out)
{
    std::ifstream file(path, std::ios::binary);
    if (!file) return false;
    out->assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    return true;
}

bool read_public_key(const std::string& path, std::array<uint8_t, 32>* key)
{
    std::ifstream file(path);
    std::string hex;
    if (!file || !(file >> hex) || hex.size() != 64) return false;
    for (std::size_t byte = 0; byte < 32; ++byte) {
        char* end = nullptr;
        const std::string pair = hex.substr(byte * 2, 2);
        const unsigned long value = std::strtoul(pair.c_str(), &end, 16);
        if (end == nullptr || *end != '\0') return false;
        (*key)[byte] = static_cast<uint8_t>(value);
    }
    return true;
}

} // namespace

int main(int argc, char** argv)
{
    std::string package_path;
    std::string scenario_path;
    std::string out_path;
    std::vector<std::string> key_paths;
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--package" && index + 1 < argc) package_path = argv[++index];
        else if (argument == "--scenario" && index + 1 < argc) scenario_path = argv[++index];
        else if (argument == "--out" && index + 1 < argc) out_path = argv[++index];
        else if (argument == "--trusted-key" && index + 1 < argc) key_paths.push_back(argv[++index]);
        else if (argument == "--help") {
            std::printf("usage: mkddc-st-sim --package <package> --scenario <json> --out <csv> "
                        "[--trusted-key <hex-public-key-file>]...\n");
            return 0;
        } else {
            return usage_error("tham số không nhận ra: " + argument);
        }
    }
    if (package_path.empty() || scenario_path.empty() || out_path.empty())
        return usage_error("cần --package, --scenario và --out");
    if (sodium_init() < 0) return finish(2, json{{"ok", false}, {"errorCode", "SIM-CLI-SODIUM"}});

    std::vector<std::array<uint8_t, 32>> keys;
    for (const std::string& path : key_paths) {
        std::array<uint8_t, 32> key{};
        if (!read_public_key(path, &key)) return usage_error("khoá tin cậy không đọc được hoặc sai độ dài: " + path);
        keys.push_back(key);
    }
    if (keys.size() > core::kMaxTrustedKeys) return usage_error("vượt số khoá tin cậy tối đa");
    core::StLoaderOptions loader_options;
    for (std::size_t index = 0; index < keys.size(); ++index) loader_options.trusted_keys[index] = keys[index].data();
    loader_options.trusted_key_count = keys.size();

    std::vector<uint8_t> package;
    if (!read_bytes(package_path, &package)) return usage_error("không đọc được package");
    std::ifstream scenario_file(scenario_path);
    if (!scenario_file) return usage_error("không đọc được kịch bản");
    std::stringstream scenario_text;
    scenario_text << scenario_file.rdbuf();
    sim::SimScenario scenario;
    std::string scenario_error;
    if (!sim::parse_sim_scenario(scenario_text.str(), &scenario, &scenario_error))
        return finish(2, json{{"ok", false}, {"errorCode", "SIM-SCENARIO-FORMAT"}, {"detail", scenario_error}});

    sim::SimSession session;
    session.set_loader_options(loader_options);
    const char* code = nullptr;
    std::string detail;
    if (!session.prepare(package, core::st_profile_generated::kProfileCode,
                         core::st_profile_generated::kTargetAbi, &code, &detail))
        return finish(2, json{{"ok", false}, {"errorCode", code != nullptr ? code : "SIM-E-PREPARE"}, {"detail", detail}});

    std::ofstream csv(out_path);
    if (!csv) return usage_error("không tạo được file CSV");
    const sim::SimScenarioResult result = sim::run_sim_scenario(&session, scenario, csv);
    csv.flush();

    json programs = json::array();
    for (const sim::SimProgramState& program : session.programs())
        programs.push_back({{"name", program.program_name}, {"periodMs", program.period_ms}});
    json inputs = json::array();
    for (const sim::SimInputDescriptor& input : session.inputs()) inputs.push_back(input.observation_id);
    json summary{{"ok", result.ok}, {"steps", result.steps}, {"rows", result.rows},
                 {"baseTickMs", session.base_tick_ms()}, {"programs", programs}, {"inputs", inputs}};
    if (!result.ok) {
        summary["errorCode"] = result.error_code;
        summary["detail"] = result.detail;
        if (result.fault_at_ms != 0 || result.steps != 0) summary["faultAtMs"] = result.fault_at_ms;
    }
    if (!csv) return finish(2, json{{"ok", false}, {"errorCode", "SIM-CLI-IO"}, {"detail", "ghi CSV lỗi"}});
    return finish(result.ok ? 0 : 1, summary);
}
