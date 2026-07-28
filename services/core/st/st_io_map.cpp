#include "st/st_io_map.hpp"

#include <cctype>
#include <unordered_map>
#include <utility>

#include "st/st_limits.hpp"

namespace core {
namespace {

void push_diag(std::vector<StDiagnostic>* out, const char* code, const std::string& msg)
{
    /* Trần số diagnostic: io_map hỏng nặng (vd 10000 dòng sai) không được
     * sinh response JSON khổng lồ cho BE. Khi chạm trần, phần tử cuối cùng
     * được thay bằng một diagnostic báo bị cắt bớt — BE luôn biết là còn lỗi
     * chưa hiển thị, thay vì tưởng đã hết lỗi. */
    if (out->size() >= st_limits::kMaxDiagnostics) {
        StDiagnostic& last = out->back();
        last.code = st_diag_code::kDiagnosticsTruncated;
        last.message = "diagnostic list truncated at " +
                       std::to_string(st_limits::kMaxDiagnostics) +
                       " entries; fix the reported errors and re-validate";
        last.line = 0;
        last.column = 0;
        return;
    }
    StDiagnostic d;
    d.severity = StSeverity::ERROR;
    d.code = code;
    d.message = msg;
    /* io_map entry không có source-range trong ST text — vị trí thật (nếu có)
     * là trách nhiệm của layer lưu file io_map.json (BE), line/column=0 ở
     * đây nghĩa là "không áp dụng" (xem StDiagnostic::has_position()). */
    d.line = 0;
    d.column = 0;
    out->push_back(std::move(d));
}

} // namespace

bool valid_st_point_id(const std::string& point_id)
{
    const std::size_t dash = point_id.find('-');
    if (dash == std::string::npos || dash == 0) return false;
    const std::string prefix = point_id.substr(0, dash);
    if (prefix != "UI" && prefix != "DI" && prefix != "AO" && prefix != "DO") return false;
    const std::string digits = point_id.substr(dash + 1);
    if (digits.empty()) return false;
    bool all_zero = true;
    for (char c : digits) {
        if (!std::isdigit(static_cast<unsigned char>(c))) return false;
        if (c != '0') all_zero = false;
    }
    return !all_zero;
}

bool validate_io_map(const StProgram& prog, const std::vector<StIoMapEntry>& entries,
                     std::vector<StDiagnostic>* diagnostics)
{
    diagnostics->clear();

    std::unordered_map<std::string, std::pair<StType, bool>> syms;
    for (const StVarDecl& d : prog.inputs) syms[d.name] = {d.type, false};
    for (const StVarDecl& d : prog.outputs) syms[d.name] = {d.type, true};

    std::unordered_map<std::string, int> binding_count;

    for (const StIoMapEntry& e : entries) {
        auto it = syms.find(e.variable);
        if (it == syms.end()) {
            push_diag(diagnostics, st_diag_code::kIoMapUnknownVar,
                     "io_map entry references unknown variable '" + e.variable +
                         "' (not declared in VAR_INPUT/VAR_OUTPUT)");
            continue;   /* không kiểm tra tiếp các field khác của entry sai variable */
        }
        binding_count[e.variable]++;

        const bool expect_output = it->second.second;
        const std::string expected_dir = expect_output ? "output" : "input";
        if (e.direction != "input" && e.direction != "output") {
            push_diag(diagnostics, st_diag_code::kIoMapBadDirection,
                     "io_map entry for '" + e.variable + "' has invalid direction '" + e.direction +
                         "' (must be 'input' or 'output')");
        } else if (e.direction != expected_dir) {
            push_diag(diagnostics, st_diag_code::kIoMapBadDirection,
                     "io_map entry for '" + e.variable + "' direction '" + e.direction +
                         "' does not match declared " + expected_dir);
        }

        if (e.type != it->second.first) {
            push_diag(diagnostics, st_diag_code::kIoMapTypeMismatch,
                     "io_map entry for '" + e.variable + "' type does not match declared ST type");
        }

        if (!valid_st_point_id(e.point_id)) {
            push_diag(diagnostics, st_diag_code::kIoMapBadPointId,
                     "io_map entry for '" + e.variable + "' has invalid point_id '" + e.point_id +
                         "' (expected PREFIX-NN, PREFIX in {UI,DI,AO,DO})");
        }

        if (e.has_range) {
            if (e.type == StType::BOOL) {
                push_diag(diagnostics, st_diag_code::kIoMapBadRange,
                         "io_map entry for '" + e.variable + "' declares a range but type is BOOL");
            } else if (!(e.range_min < e.range_max)) {
                push_diag(diagnostics, st_diag_code::kIoMapBadRange,
                         "io_map entry for '" + e.variable + "' has range_min >= range_max");
            }
        }
    }

    for (const auto& kv : binding_count) {
        if (kv.second > 1)
            push_diag(diagnostics, st_diag_code::kIoMapDuplicateBinding,
                     "'" + kv.first + "' has " + std::to_string(kv.second) +
                         " io_map entries, expected exactly 1");
    }

    for (const StVarDecl& d : prog.inputs)
        if (!binding_count.count(d.name))
            push_diag(diagnostics, st_diag_code::kIoMapMissingBinding,
                     "VAR_INPUT '" + d.name + "' has no io_map binding");
    for (const StVarDecl& d : prog.outputs)
        if (!binding_count.count(d.name))
            push_diag(diagnostics, st_diag_code::kIoMapMissingBinding,
                     "VAR_OUTPUT '" + d.name + "' has no io_map binding");

    return diagnostics->empty();
}

} // namespace core
