#include "programming/simulation/sim_scenario.hpp"

#include "programming/simulation/sim_error.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include <nlohmann/json.hpp>

namespace core::programming::sim {
namespace {

bool fail(std::string* error, const std::string& message)
{
    if (error) *error = message;
    return false;
}

/* Đổi số trong kịch bản sang StValue đúng kiểu của input. Không làm tròn ngầm:
 * 2.5 cho một INT là lỗi kịch bản, không phải 2. */
bool to_value(StType type, double number, StValue* out)
{
    if (!std::isfinite(number)) return false;
    switch (type) {
    case StType::BOOL:
        if (number != 0.0 && number != 1.0) return false;
        *out = StValue::make_bool(number != 0.0);
        return true;
    case StType::REAL:
        *out = StValue::make_real(static_cast<float>(number));
        return true;
    case StType::TIME:
        if (number < 0.0 || std::floor(number) != number) return false;
        *out = StValue::make_time(static_cast<int64_t>(number) * 1000000);
        return true;
    default:
        if (std::floor(number) != number) return false;
        if (number < static_cast<double>(st_integer_min(type)) ||
            number > static_cast<double>(st_integer_max(type)))
            return false;
        *out = StValue::make_integer(type, static_cast<int32_t>(number));
        return true;
    }
}

std::string format_value(const SimObservation& observation)
{
    if (!observation.has_value) return "";
    const StValue& value = observation.value;
    char buffer[48];
    switch (value.type) {
    case StType::BOOL: return value.b ? "1" : "0";
    case StType::REAL: std::snprintf(buffer, sizeof(buffer), "%.9g", static_cast<double>(value.r)); return buffer;
    case StType::TIME:
        std::snprintf(buffer, sizeof(buffer), "%lld", static_cast<long long>(value.t / 1000000));
        return buffer;
    default: std::snprintf(buffer, sizeof(buffer), "%d", value.i); return buffer;
    }
}

} // namespace

bool parse_sim_scenario(const std::string& json_text, SimScenario* out, std::string* error)
{
    const nlohmann::json root = nlohmann::json::parse(json_text, nullptr, false);
    if (root.is_discarded() || !root.is_object()) return fail(error, "kịch bản không phải JSON object");
    if (!root.contains("schemaVersion") || root["schemaVersion"] != 1)
        return fail(error, "schemaVersion phải là 1");
    if (!root.contains("durationMs") || !root["durationMs"].is_number_unsigned())
        return fail(error, "durationMs phải là số nguyên không âm");
    SimScenario scenario;
    scenario.duration_ms = root["durationMs"].get<uint64_t>();
    if (scenario.duration_ms == 0 || scenario.duration_ms > kMaxScenarioDurationMs)
        return fail(error, "durationMs phải trong 1..86400000");
    if (root.contains("events")) {
        const nlohmann::json& events = root["events"];
        if (!events.is_array() || events.size() > kMaxScenarioEvents)
            return fail(error, "events phải là mảng tối đa 10000 phần tử");
        for (const nlohmann::json& item : events) {
            if (!item.is_object() || !item.contains("atMs") || !item["atMs"].is_number_unsigned() ||
                !item.contains("input") || !item["input"].is_string() || !item.contains("value"))
                return fail(error, "mỗi event cần atMs (số nguyên), input (chuỗi), value");
            SimScenarioEvent event;
            event.at_ms = item["atMs"].get<uint64_t>();
            event.input = item["input"].get<std::string>();
            const nlohmann::json& value = item["value"];
            if (value.is_boolean()) event.value = value.get<bool>() ? 1.0 : 0.0;
            else if (value.is_number()) event.value = value.get<double>();
            else return fail(error, "value của " + event.input + " phải là số hoặc boolean");
            if (event.at_ms > scenario.duration_ms)
                return fail(error, "event " + event.input + " nằm sau durationMs");
            scenario.events.push_back(std::move(event));
        }
    }
    std::stable_sort(scenario.events.begin(), scenario.events.end(),
                     [](const SimScenarioEvent& a, const SimScenarioEvent& b) { return a.at_ms < b.at_ms; });
    if (root.contains("observe")) {
        if (!root["observe"].is_array()) return fail(error, "observe phải là mảng chuỗi");
        for (const nlohmann::json& item : root["observe"]) {
            if (!item.is_string()) return fail(error, "observe phải là mảng chuỗi");
            scenario.observe.push_back(item.get<std::string>());
        }
    }
    *out = std::move(scenario);
    return true;
}

SimScenarioResult run_sim_scenario(SimSession* session, const SimScenario& scenario, std::ostream& csv)
{
    SimScenarioResult result;
    if (session == nullptr || !session->prepared()) {
        result.error_code = kErrCommandState;
        result.detail = "phiên chưa prepare";
        return result;
    }
    /* Kiểm TOÀN BỘ kịch bản trước khi chạy tick đầu: một tên input gõ sai ở phút
     * 50 không được lộ ra sau khi đã chạy 50 phút ảo. */
    const std::vector<SimInputDescriptor>& inputs = session->inputs();
    std::vector<StValue> event_values;
    event_values.reserve(scenario.events.size());
    for (const SimScenarioEvent& event : scenario.events) {
        const auto it = std::find_if(inputs.begin(), inputs.end(),
                                     [&](const SimInputDescriptor& d) { return d.observation_id == event.input; });
        StValue value;
        if (it == inputs.end() || !to_value(it->type, event.value, &value)) {
            result.error_code = "SIM-SCENARIO-INPUT";
            result.detail = it == inputs.end() ? "không có input " + event.input
                                               : "giá trị không hợp kiểu cho " + event.input;
            return result;
        }
        event_values.push_back(value);
    }
    std::vector<std::string> columns = scenario.observe;
    const std::vector<SimObservation> initial = session->observations();
    if (columns.empty()) {
        for (const SimObservation& observation : initial) columns.push_back(observation.observation_id);
    }
    std::vector<std::size_t> column_index;
    for (const std::string& column : columns) {
        const auto it = std::find_if(initial.begin(), initial.end(),
                                     [&](const SimObservation& o) { return o.observation_id == column; });
        if (it == initial.end()) {
            result.error_code = "SIM-SCENARIO-OBSERVE";
            result.detail = "không có observation " + column;
            return result;
        }
        column_index.push_back(static_cast<std::size_t>(it - initial.begin()));
    }

    csv << "timeMs";
    for (const std::string& column : columns) csv << ',' << column;
    csv << '\n';

    std::size_t next_event = 0;
    while (session->virtual_time_ms() <= scenario.duration_ms) {
        const uint64_t now_ms = session->virtual_time_ms();
        for (; next_event < scenario.events.size() && scenario.events[next_event].at_ms <= now_ms; ++next_event) {
            const char* code = nullptr;
            if (!session->set_input(scenario.events[next_event].input, event_values[next_event], &code)) {
                result.error_code = code != nullptr ? code : "SIM-SCENARIO-INPUT";
                result.detail = "phiên từ chối giá trị cho " + scenario.events[next_event].input;
                return result;
            }
        }
        std::vector<uint64_t> releases_before;
        for (const SimProgramState& program : session->programs()) releases_before.push_back(program.next_release_ms);
        const char* code = nullptr;
        std::string detail;
        if (!session->step(&code, &detail)) {
            result.error_code = code != nullptr ? code : "SIM-E-STEP";
            result.detail = detail;
            result.fault_at_ms = now_ms;
            return result;
        }
        result.steps++;
        bool released = false;
        const std::vector<SimProgramState>& programs = session->programs();
        for (std::size_t index = 0; index < programs.size(); ++index)
            if (programs[index].next_release_ms != releases_before[index]) released = true;
        if (!released) continue;
        const std::vector<SimObservation> observations = session->observations();
        csv << now_ms;
        for (std::size_t index : column_index) csv << ',' << format_value(observations[index]);
        csv << '\n';
        result.rows++;
    }
    result.ok = true;
    return result;
}

} // namespace core::programming::sim
