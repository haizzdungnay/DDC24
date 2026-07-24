#include "st_runtime.hpp"

#include <cmath>

#include "st_parser.hpp"
#include "st_semantic.hpp"

namespace core {
namespace {

bool eval_expr(const StExpr& e, const StIoImage& view, StValue* out, std::string* fault)
{
    switch (e.kind) {
    case StExpr::Kind::LITERAL:
        *out = e.literal;
        return true;
    case StExpr::Kind::VAR: {
        auto it = view.find(e.var_name);
        if (it == view.end()) {
            *fault = "unbound_at_runtime: '" + e.var_name + "' không có trong input/output image";
            return false;
        }
        if (it->second.type == StType::REAL && !std::isfinite(it->second.real_value)) {
            *fault = "nonfinite_input: '" + e.var_name + "' NaN/Inf — reject, không publish GOOD";
            return false;
        }
        *out = it->second;
        return true;
    }
    case StExpr::Kind::GT: {
        StValue lv, rv;
        if (!eval_expr(*e.lhs, view, &lv, fault)) return false;
        if (!eval_expr(*e.rhs, view, &rv, fault)) return false;
        out->type = StType::BOOL;
        out->bool_value = lv.real_value > rv.real_value;
        return true;
    }
    }
    *fault = "internal_error: unknown expr kind at runtime";
    return false;
}

bool exec_stmt_list(const std::vector<StStmt>& stmts, StIoImage* view, StIoImage* staged,
                    std::string* fault);

bool exec_stmt(const StStmt& s, StIoImage* view, StIoImage* staged, std::string* fault)
{
    if (s.kind == StStmt::Kind::ASSIGN) {
        StValue v;
        if (!eval_expr(*s.assign_expr, *view, &v, fault)) return false;
        (*view)[s.assign_target] = v;
        (*staged)[s.assign_target] = v;
        return true;
    }
    StValue cond;
    if (!eval_expr(*s.if_cond, *view, &cond, fault)) return false;
    const std::vector<StStmt>& branch = cond.bool_value ? s.if_then : s.if_else;
    return exec_stmt_list(branch, view, staged, fault);
}

bool exec_stmt_list(const std::vector<StStmt>& stmts, StIoImage* view, StIoImage* staged,
                    std::string* fault)
{
    for (const StStmt& s : stmts)
        if (!exec_stmt(s, view, staged, fault)) return false;
    return true;
}

} // namespace

bool StProgramRuntime::activate(const std::string& source, std::string* error)
{
    std::string err;
    auto candidate = std::make_unique<StProgram>();
    if (!parse_st_program(source, candidate.get(), &err)) {
        if (error) *error = err;
        activation_fail_count_++;
        return false;   /* active_ giữ nguyên (last-known-good) */
    }
    if (!typecheck_st_program(candidate.get(), &err)) {
        if (error) *error = err;
        activation_fail_count_++;
        return false;   /* active_ giữ nguyên */
    }
    active_ = std::move(candidate);   /* atomic swap: chỉ tới đây mới active */
    activation_count_++;
    return true;
}

StExecResult StProgramRuntime::execute(const StIoImage& inputs, StIoImage* outputs)
{
    StExecResult r;
    if (!active_) {
        r.error = "no_active_program";
        fault_count_++;
        return r;
    }

    /* Pre-check toàn bộ input đã khai báo: có mặt, đúng kiểu, REAL phải finite.
     * Reject SỚM trước khi đụng outputs — NaN/Inf input không được lọt vào
     * execute() để thành output "GOOD" ngẫu nhiên. */
    for (const StVarDecl& decl : active_->inputs) {
        auto it = inputs.find(decl.name);
        if (it == inputs.end() || it->second.type != decl.type) {
            r.error = "missing_or_mistyped_input: '" + decl.name + "'";
            fault_count_++;
            return r;   /* *outputs KHÔNG bị đụng */
        }
        if (decl.type == StType::REAL && !std::isfinite(it->second.real_value)) {
            r.error = "nonfinite_input: '" + decl.name + "'";
            fault_count_++;
            return r;   /* *outputs KHÔNG bị đụng */
        }
    }

    /* Staging: bắt đầu từ output hiện tại (last-known-good), evaluate view =
     * input ∪ staged-output (để statement sau đọc được output statement trước
     * gán, đúng ngữ nghĩa sequential). Chỉ commit vào *outputs khi TOÀN BỘ
     * body chạy xong không lỗi — không commit nửa chừng. */
    StIoImage staged;
    for (const StVarDecl& decl : active_->outputs) {
        auto it = outputs->find(decl.name);
        staged[decl.name] = (it != outputs->end()) ? it->second : StValue{decl.type, 0.0f, false};
    }
    StIoImage view = inputs;
    for (const auto& kv : staged) view[kv.first] = kv.second;

    std::string fault;
    if (!exec_stmt_list(active_->body, &view, &staged, &fault)) {
        r.error = fault;
        fault_count_++;
        return r;   /* staged bị hủy, *outputs KHÔNG bị đụng */
    }

    for (const auto& kv : staged) (*outputs)[kv.first] = kv.second;
    r.ok = true;
    return r;
}

} // namespace core
