#include "st/st_io_map.hpp"

#include <cctype>
#include <cmath>
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

bool split_numbered_id(const std::string& point_id, std::string* prefix)
{
    const std::size_t dash = point_id.find('-');
    if (dash == std::string::npos || dash == 0) return false;
    const std::string digits = point_id.substr(dash + 1);
    if (digits.empty()) return false;
    bool all_zero = true;
    for (char c : digits) {
        if (!std::isdigit(static_cast<unsigned char>(c))) return false;
        if (c != '0') all_zero = false;
    }
    if (all_zero) return false;
    if (prefix) *prefix = point_id.substr(0, dash);
    return true;
}

bool valid_ascii_identity(const std::string& identity)
{
    if (identity.empty() || identity.size() > 23) return false;
    for (unsigned char c : identity) {
        if (c < 0x21 || c > 0x7e) return false;
    }
    return true;
}

bool valid_device_id(const std::string& device_id)
{
    if (device_id.empty() || device_id.size() > 23 ||
        !std::isalpha(static_cast<unsigned char>(device_id.front())))
        return false;
    for (char c : device_id) {
        const unsigned char uc = static_cast<unsigned char>(c);
        if (!std::isalnum(uc) && c != '_' && c != '-') return false;
    }
    return true;
}

bool validate_point_contract(const StIoMapEntry& entry, bool expect_output,
                             std::vector<StDiagnostic>* diagnostics)
{
    std::string prefix;
    bool identity_valid = false;
    bool direction_valid = true;
    bool type_valid = true;

    if (entry.category == "LOCAL") {
        identity_valid = split_numbered_id(entry.point_id, &prefix) &&
                         (prefix == "UI" || prefix == "DI" ||
                          prefix == "AO" || prefix == "DO") &&
                         entry.device_id.empty();
        if (identity_valid) {
            direction_valid = !expect_output || prefix == "AO" || prefix == "DO";
            type_valid = ((prefix == "UI" || prefix == "AO") &&
                          entry.type == StType::REAL) ||
                         ((prefix == "DI" || prefix == "DO") &&
                          entry.type == StType::BOOL);
        }
    } else if (entry.category == "VP") {
        identity_valid = split_numbered_id(entry.point_id, &prefix) &&
                         (prefix == "AV" || prefix == "BV" || prefix == "MSV") &&
                         entry.device_id.empty();
        if (identity_valid) {
            type_valid = (prefix == "AV" && entry.type == StType::REAL) ||
                         (prefix == "BV" && entry.type == StType::BOOL) ||
                         (prefix == "MSV" && entry.type == StType::UINT);
        }
    } else if (entry.category == "MB_RTU") {
        identity_valid = valid_device_id(entry.device_id) &&
                         valid_ascii_identity(entry.point_id);
        type_valid = entry.type != StType::TIME;
    } else {
        push_diag(diagnostics, st_diag_code::kIoMapBadPointId,
                  "io_map entry for '" + entry.variable + "' has unsupported category '" +
                      entry.category + "' (allowlist: LOCAL, VP, MB_RTU)");
        return false;
    }

    if (!identity_valid) {
        push_diag(diagnostics, st_diag_code::kIoMapBadPointId,
                  "io_map entry for '" + entry.variable +
                      "' has invalid discriminated point identity for category '" +
                      entry.category + "'");
    }
    if (!direction_valid || (expect_output && !entry.writable)) {
        push_diag(diagnostics, st_diag_code::kIoMapBadDirection,
                  "io_map output for '" + entry.variable +
                      "' targets a read-only or non-writable point");
    }
    if (!type_valid) {
        push_diag(diagnostics, st_diag_code::kIoMapTypeMismatch,
                  "io_map entry for '" + entry.variable +
                      "' type is incompatible with point category/kind");
    }
    return identity_valid && direction_valid && (!expect_output || entry.writable) && type_valid;
}

} // namespace

bool valid_st_point_id(const std::string& point_id)
{
    std::string prefix;
    return split_numbered_id(point_id, &prefix) &&
           (prefix == "UI" || prefix == "DI" || prefix == "AO" || prefix == "DO");
}

bool validate_io_map(const StProgram& prog, const std::vector<StIoMapEntry>& entries,
                     std::vector<StDiagnostic>* diagnostics)
{
    diagnostics->clear();

    /* Chỉ VAR_INPUT/VAR_OUTPUT tham gia io_map — VAR/VAR RETAIN là trạng thái
     * nội bộ của chương trình, không bind ra điểm vật lý. */
    std::unordered_map<std::string, std::pair<StType, bool>> syms;
    for (const StVarDecl& d : prog.vars) {
        if (d.storage == StStorage::VAR_INPUT)       syms[d.name] = {d.type, false};
        else if (d.storage == StStorage::VAR_OUTPUT) syms[d.name] = {d.type, true};
    }

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

        validate_point_contract(e, expect_output, diagnostics);

        if (e.has_range) {
            if (e.type == StType::BOOL) {
                push_diag(diagnostics, st_diag_code::kIoMapBadRange,
                         "io_map entry for '" + e.variable + "' declares a range but type is BOOL");
            } else if (!std::isfinite(e.range_min) || !std::isfinite(e.range_max) ||
                       !(e.range_min < e.range_max)) {
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

    for (const StVarDecl& d : prog.vars) {
        if (d.storage != StStorage::VAR_INPUT && d.storage != StStorage::VAR_OUTPUT) continue;
        if (binding_count.count(d.name)) continue;
        push_diag(diagnostics, st_diag_code::kIoMapMissingBinding,
                  std::string(d.storage == StStorage::VAR_INPUT ? "VAR_INPUT '" : "VAR_OUTPUT '") +
                      d.name + "' has no io_map binding");
    }

    return diagnostics->empty();
}

} // namespace core
