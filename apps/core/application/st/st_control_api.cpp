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
    j["retainState"] = st_retain_restore_state_name(p.retain_restore_state);
    j["retainDetailCode"] = p.retain_reject_code ? json(p.retain_reject_code) : json(nullptr);
    const uint64_t saved_generation = p.retain_mailbox
        ? p.retain_mailbox->last_saved_generation() : 0;
    j["retainGeneration"] = saved_generation > p.retain_generation
        ? saved_generation : p.retain_generation;
    j["retainWriteCount"] = p.retain_mailbox ? p.retain_mailbox->write_count() : 0;
    j["retainWriteFailures"] = p.retain_mailbox ? p.retain_mailbox->write_fail_count() : 0;
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
        j["hasRetain"] = prog->has_retain();

        /* TASK-PROG-305 "monitor": source/quality/freshness per input binding,
         * theo GET /runtime/monitor (Interface Spec §7/§8). Đọc lại từ
         * process_inputs đã chụp ở TASK-PROG-302, không đọc lại Point Table —
         * tránh trình bày dữ liệu khác cycle vừa chạy. */
        json inputs = json::array();
        for (uint16_t i = 0; i < p.process_input_count; ++i) {
            const StProcessInputSlot& in = p.process_inputs[i];
            std::string var_name;
            for (const StIrVariable& v : prog->variables)
                if (v.slot == in.slot) { var_name = v.name; break; }
            json e;
            e["variable"] = var_name;
            e["pointCategory"] = st_point_category_name(st_point_category(in.point_kind));
            e["pointIndex"] = in.point_index;
            e["quality"] = static_cast<int>(in.quality);
            e["source"] = static_cast<int>(in.source);
            e["observedAtNs"] = in.observed_at_ns;
            inputs.push_back(std::move(e));
        }
        j["monitorInputs"] = inputs;
        j["inputSnapshotValid"] = p.input_snapshot_valid;
    } else {
        j["programName"] = nullptr;
        j["artifactSha256"] = nullptr;
        j["hasRetain"] = false;
        j["monitorInputs"] = json::array();
        j["inputSnapshotValid"] = false;
    }
    return j;
}

json task_state_json(const StTask& t)
{
    json j;
    j["taskId"] = t.config().id;
    j["priority"] = t.config().priority;
    j["periodMs"] = t.config().period_ms;
    /* ADR-061 4.3: nguồn là µs; API supporting này giữ đúng schema
     * `st_program_control_v1` (không có `budgetUs`), nên chỉ công bố ms làm
     * tròn xuống. `budgetUs` đi qua `point_snapshot`. */
    j["budgetMs"] = t.config().budget_us / 1000u;
    j["enabled"] = t.enabled();
    j["runCount"] = t.stats().run_count;
    j["missedReleaseCount"] = t.stats().missed_release_count;
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
        const bool rev_a = sched->profile() == StSchedulerProfile::REV_A;
        json p;
        p["interfaceVersion"] = kStApiVersion;
        p["artifactSchemaVersion"] = st_ir::kSchemaVersion;
        p["compilerProfile"] = st_ir::kCompilerProfile;
        p["targetAbi"] = st_ir::kTargetAbi;
        p["compilerVersion"] = st_ir::kCompilerVersion;
        p["maxArtifactBytes"] = st_ir::kMaxArtifactSize;
        p["runtimeProfile"] = st_scheduler_profile_name(sched->profile());
        p["maxTasks"] = rev_a ? st_profile_generated::kMaxTasks
                              : st_sched_limits::kMaxTasks;
        p["maxProgramsPerTask"] = rev_a ? st_profile_generated::kMaxProgramsPerTask
                                        : st_sched_limits::kMaxProgramsPerTask;
        p["maxProgramsTotal"] = rev_a ? st_profile_generated::kMaxProgramsTotal
                                      : st_sched_limits::kMaxProgramsTotal;
        if (rev_a) p["allowedPeriodMs"] = st_profile_generated::kAllowedPeriodMs;
        else p["allowedPeriodMs"] = json::array();
        p["baseStepMs"] = st_base_step::kDefaultMs;
        p["baseStepMinMs"] = st_base_step::kMinMs;
        p["baseStepMaxMs"] = st_base_step::kMaxMs;
        p["maxTaskBudgetPercentExclusive"] = st_base_step::kMaxTaskBudgetPercent;
        /* TASK-PROG-305, OD-PROG-011: monitor 1 Hz/stale sau 3 kỳ đã DECIDED;
         * đây là bounded EVENT trace (fault/overrun/rollback/activation), không
         * phải value-sampling historian 10.000 sample/10 phút cùng quyết định —
         * phần đó cần selector/session riêng qua POST/GET /runtime/traces,
         * chưa làm ở task này (ghi rõ để không lẫn với capability dưới đây). */
        p["monitorPollHz"] = 1;
        p["monitorStaleAfterPolls"] = 3;
        p["maxTraceEvents"] = static_cast<uint32_t>(kSchedulerTraceCapacity);
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

    if (action == "program_trace") {
        json events = json::array();
        json p;
        if (const StSchedulerTrace* trace = sched->trace_log()) {
            for (std::size_t i = 0; i < trace->size(); ++i) {
                const StRuntimeTraceEvent& e = trace->at(i);
                json j;
                j["kind"] = static_cast<int>(e.kind);
                j["timestampNs"] = e.timestamp_ns;
                j["ok"] = e.ok;
                /* Không dùng toán tử ba ngôi `cond ? cptr : nullptr`: hai
                 * nhánh hợp kiểu về const char*, nullptr_t bị ép về con trỏ
                 * NULL thay vì giữ JSON null — nlohmann sẽ cố dựng std::string
                 * từ con trỏ NULL và ném exception. Phải rẽ nhánh tường minh. */
                if (e.task_id) j["taskId"] = e.task_id; else j["taskId"] = nullptr;
                if (e.instance_id) j["instanceId"] = e.instance_id; else j["instanceId"] = nullptr;
                if (e.code) j["code"] = e.code; else j["code"] = nullptr;
                events.push_back(std::move(j));
            }
            p["droppedCount"] = trace->dropped_count();
            p["capacity"] = static_cast<uint32_t>(trace->capacity());
        } else {
            p["droppedCount"] = 0;
            p["capacity"] = 0;
        }
        p["events"] = events;
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
        /* Trạng thái command là STAGED dù package cũ vẫn RUNNING/STOPPED tới
         * boundary; không sửa state runtime sớm chỉ để tạo response. */
        p["state"] = "STAGED";
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
    payload["state"] = action == "program_rollback"
        ? "STAGED" : st_program_state_name(p->state);
    if (action == "program_rollback") payload["appliedAt"] = "next_tick_boundary";
    return ok_response(request_id, payload);
}

} // namespace core
