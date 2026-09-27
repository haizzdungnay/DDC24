/**
 * @file  sim_scenario.hpp
 * @brief U-16 (REC-DDC-FIELD-USE-20260927) — chạy một package đã seal theo kịch
 *        bản đầu vào định trước và xuất CSV từng lần Program release.
 *
 *        Người viết chương trình cần chạy thử Program trên host theo kịch bản,
 *        dùng được trong CI của dự án ứng dụng. Trước đây phải tự viết harness
 *        C++ liên kết thẳng compiler và runtime. Phần này bọc ĐÚNG `SimSession`
 *        của chế độ SIMULATE (ADR-053): cùng loader/executor production, cùng
 *        lịch release theo chu kỳ, không có engine thứ hai "gần đúng".
 *
 *        Kịch bản (JSON):
 *          {
 *            "schemaVersion": 1,
 *            "durationMs": 60000,
 *            "events":  [ {"atMs": 0, "input": "PRG.CmdMode", "value": 2}, ... ],
 *            "observe": [ "PRG.DO01", "PRG.StsMode" ]      // tuỳ chọn; vắng = mọi ô
 *          }
 *        `input`/`observe` là `observation_id` = "<Program>.<Variable>" do
 *        artifact quyết định. BOOL nhận true/false hoặc 0/1; TIME nhận ms.
 */
#ifndef CORE_PROGRAMMING_SIM_SCENARIO_HPP
#define CORE_PROGRAMMING_SIM_SCENARIO_HPP

#include <cstdint>
#include <ostream>
#include <string>
#include <vector>

#include "programming/simulation/sim_session.hpp"

namespace core::programming::sim {

/* Trần của kịch bản: 24 h thời gian ảo và 10 000 sự kiện là đủ cho mọi phép
 * thử hành vi của một Program DDC, mà vẫn giới hạn được thời gian chạy trên host. */
constexpr uint64_t    kMaxScenarioDurationMs = 24ull * 3600ull * 1000ull;
constexpr std::size_t kMaxScenarioEvents     = 10000;

struct SimScenarioEvent {
    uint64_t    at_ms = 0;
    std::string input;
    double      value = 0.0;
};

struct SimScenario {
    uint64_t                      duration_ms = 0;
    std::vector<SimScenarioEvent> events;   /* đã sắp theo at_ms, ổn định */
    std::vector<std::string>      observe;  /* rỗng = mọi observation */
};

/* Trả false + `*error` khi JSON sai hình dạng hoặc vượt trần. */
bool parse_sim_scenario(const std::string& json_text, SimScenario* out, std::string* error);

struct SimScenarioResult {
    bool        ok = false;
    std::string error_code;   /* SIM-E-* của phiên, hoặc SIM-SCENARIO-* */
    std::string detail;
    uint64_t    steps = 0;    /* số base tick đã chạy */
    uint64_t    rows = 0;     /* số dòng CSV (không tính dòng tiêu đề) */
    uint64_t    fault_at_ms = 0;
};

/* Chạy kịch bản trên một phiên đã `prepare()`. Ghi dòng tiêu đề
 * `timeMs,<observe...>` rồi một dòng sau mỗi tick có ít nhất một Program
 * release. Ô chưa có giá trị (Program chưa release lần nào) để trống. */
SimScenarioResult run_sim_scenario(SimSession* session, const SimScenario& scenario, std::ostream& csv);

} // namespace core::programming::sim

#endif
