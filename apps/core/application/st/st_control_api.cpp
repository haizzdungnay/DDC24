#include "st/st_control_api.hpp"

#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_ir.hpp"

namespace core {
namespace {

using json = nlohmann::json;

const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int b64_value(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

/* Dựng response lỗi. `keeps_running` là thông tin BE cần nhất: nó quyết định
 * BE có phải báo động cho người vận hành hay chỉ báo "gói này không nhận". */
std::string error_response(const std::string& request_id, const char* code,
                           const std::string& message, bool keeps_running = true,
                           const std::string& detail_code = "")
{
    json j;
    j["version"] = kStApiVersion;
    j["requestId"] = request_id;
    j["result"] = "error";
    j["errorCode"] = code;
    j["message"] = message;
    j["keepsRunningPackage"] = keeps_running;
    if (!detail_code.empty()) j["detailCode"] = detail_code;
    return j.dump();
}

std::string ok_response(const std::string& request_id, json payload = json::object())
{
    json j;
    j["version"] = kStApiVersion;
    j["requestId"] = request_id;
    j["result"] = "ok";
    for (auto it = payload.begin(); it != payload.end(); ++it) j[it.key()] = it.value();
    return j.dump();
}

json instance_state_json(const StProgramInstance& p, const std::string& task_id)
{
    json j;
    j["instanceId"] = p.instance_id;
    j["taskId"] = task_id;
    j["order"] = p.order;
    j["state"] = st_program_state_name(p.state);
    j["enabled"] = p.enabled;
    j["runCount"] = p.run_count;
    j["faultCount"] = p.fault_count;
    j["hasLastKnownGood"] = !p.last_known_good.empty();
    if (p.last_fault_code) {
        j["lastFault"] = {{"code", p.last_fault_code},
                          {"pc", p.last_fault_pc},
                          {"line", p.last_fault_line}};
    } else {
        j["lastFault"] = nullptr;
    }
    if (const StLoadedProgram* prog = p.runtime.program()) {
        j["programName"] = prog->program_name;
        j["artifactSha256"] = st_base64_encode(prog->sha256, 32);
        j["hasRetain"] = !prog->retain_entries.empty();
    } else {
        j["programName"] = nullptr;
        j["artifactSha256"] = nullptr;
        j["hasRetain"] = false;
    }
    return j;
}

json task_state_json(const StTask& t)
{
    json j;
    j["taskId"] = t.config().id;
    j["priority"] = t.config().priority;
    j["periodMs"] = t.config().period_ms;
    j["budgetMs"] = t.config().budget_ms;
    j["enabled"] = t.enabled();
    j["runCount"] = t.stats().run_count;
    j["lastExecNs"] = t.stats().last_exec_ns;
    j["maxExecNs"] = t.stats().max_exec_ns;
    j["overrunTotal"] = t.monitor().stats().total;
    j["overrunConsecutive"] = t.monitor().stats().consecutive;
    j["overrunThreshold"] = t.monitor().threshold();
    j["forcingSafeState"] = t.monitor().should_force_safe();
    json programs = json::array();
    for (const auto& p : t.programs()) programs.push_back(instance_state_json(*p, t.config().id));
    j["programs"] = programs;
    return j;
}

} // namespace

std::string st_base64_encode(const uint8_t* data, std::size_t n)
{
    std::string out;
    out.reserve((n + 2) / 3 * 4);
    for (std::size_t i = 0; i < n; i += 3) {
        const uint32_t a = data[i];
        const uint32_t b = (i + 1 < n) ? data[i + 1] : 0;
        const uint32_t c = (i + 2 < n) ? data[i + 2] : 0;
        const uint32_t v = (a << 16) | (b << 8) | c;
        out += kB64[(v >> 18) & 0x3F];
        out += kB64[(v >> 12) & 0x3F];
        out += (i + 1 < n) ? kB64[(v >> 6) & 0x3F] : '=';
        out += (i + 2 < n) ? kB64[v & 0x3F] : '=';
    }
    return out;
}

bool st_base64_decode(const std::string& in, std::vector<uint8_t>* out, std::size_t max_bytes)
{
    out->clear();
    /* Ước lượng trước rồi mới giải mã: từ chối sớm một chuỗi khổng lồ thay vì
     * cấp phát rồi mới phát hiện quá lớn. */
    if (in.size() / 4 * 3 > max_bytes + 3) return false;

    uint32_t acc = 0;
    int bits = 0;
    for (char ch : in) {
        if (ch == '=' ) break;
        if (ch == '\n' || ch == '\r' || ch == ' ') continue;
        const int v = b64_value(ch);
        if (v < 0) return false;
        acc = (acc << 6) | static_cast<uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out->push_back(static_cast<uint8_t>((acc >> bits) & 0xFF));
            if (out->size() > max_bytes) return false;
        }
    }
    return true;
}

std::string st_handle_control_request(StScheduler* sched, const std::string& request_json)
{
    std::string request_id;
    json req;

    /* Parse phòng thủ: request rác vẫn phải nhận được JSON trả về đúng shape,
     * nếu không BE phải xử lý hai định dạng lỗi khác nhau. */
    try {
        req = json::parse(request_json);
    } catch (...) {
        return error_response("", st_api_error::kBadRequest, "request is not valid JSON");
    }
    if (!req.is_object())
        return error_response("", st_api_error::kBadRequest, "request must be a JSON object");
    if (req.contains("requestId") && req["requestId"].is_string())
        request_id = req["requestId"].get<std::string>();
    if (!req.contains("action") || !req["action"].is_string())
        return error_response(request_id, st_api_error::kBadRequest, "missing 'action'");

    const std::string action = req["action"].get<std::string>();
    if (!sched)
        return error_response(request_id, st_api_error::kInternal, "scheduler not available");

    /* --- Truy vấn --- */

    if (action == "program_capabilities") {
        json p;
        p["interfaceVersion"] = kStApiVersion;
        p["artifactSchemaVersion"] = st_ir::kSchemaVersion;
        p["compilerProfile"] = st_ir::kCompilerProfile;
        p["targetAbi"] = st_ir::kTargetAbi;
        p["compilerVersion"] = st_ir::kCompilerVersion;
        p["maxArtifactBytes"] = st_ir::kMaxArtifactSize;
        p["maxTasks"] = st_sched_limits::kMaxTasks;
        p["maxProgramsPerTask"] = st_sched_limits::kMaxProgramsPerTask;
        p["baseTickMs"] = st_sched_limits::kBaseTickMs;
        return ok_response(request_id, p);
    }

    if (action == "program_status") {
        json tasks = json::array();
        for (const auto& t : sched->tasks()) tasks.push_back(task_state_json(*t));
        json p;
        p["tasks"] = tasks;
        p["anyForcingSafeState"] = sched->any_force_safe();
        return ok_response(request_id, p);
    }

    /* --- Lệnh trên một instance --- */

    if (!req.contains("instanceId") || !req["instanceId"].is_string())
        return error_response(request_id, st_api_error::kBadRequest, "missing 'instanceId'");
    const std::string inst = req["instanceId"].get<std::string>();

    if (!sched->find_program(inst))
        return error_response(request_id, st_api_error::kUnknownInstance,
                              "unknown instance '" + inst + "'");

    if (action == "program_stage") {
        if (!req.contains("artifact") || !req["artifact"].is_string())
            return error_response(request_id, st_api_error::kBadRequest,
                                  "missing 'artifact' (base64)");
        std::vector<uint8_t> bytes;
        if (!st_base64_decode(req["artifact"].get<std::string>(), &bytes,
                              st_ir::kMaxArtifactSize))
            return error_response(request_id, st_api_error::kBadArtifact,
                                  "artifact is not valid base64 or exceeds size limit");
        std::string err;
        if (!sched->request_activation(inst, bytes, &err)) {
            const char* code = err.rfind("artifact rejected:", 0) == 0
                                   ? st_api_error::kBadArtifact
                                   : st_api_error::kBadTransition;
            return error_response(request_id, code, err);
        }
        json p;
        p["state"] = st_program_state_name(sched->find_program(inst)->state);
        p["artifactBytes"] = bytes.size();
        /* Nói rõ activation áp ở tick kế, không phải ngay lập tức — BE không
         * được kết luận "đã chạy" khi mới stage xong. */
        p["appliedAt"] = "next_tick_boundary";
        return ok_response(request_id, p);
    }

    std::string err;
    bool ok = false;
    if (action == "program_start")        ok = sched->start(inst, &err);
    else if (action == "program_stop")    ok = sched->stop(inst, &err);
    else if (action == "program_enable")  ok = sched->enable(inst, &err);
    else if (action == "program_disable") ok = sched->disable(inst, &err);
    else if (action == "program_reset")   ok = sched->reset_fault(inst, &err);
    else if (action == "program_rollback") ok = sched->rollback(inst, &err);
    else
        return error_response(request_id, st_api_error::kUnknownAction,
                              "unknown action '" + action + "'");

    if (!ok)
        return error_response(request_id, st_api_error::kBadTransition, err);

    const StProgramInstance* p = sched->find_program(inst);
    json payload;
    payload["state"] = st_program_state_name(p->state);
    if (action == "program_rollback") payload["appliedAt"] = "next_tick_boundary";
    return ok_response(request_id, payload);
}

} // namespace core
