#include "st_semantic.hpp"

#include <unordered_map>

#include "st_stdlib.hpp"

namespace core {
namespace {

struct Symbol {
    StType type = StType::REAL;
    bool   is_output = false;
};

using SymbolTable = std::unordered_map<std::string, Symbol>;

void set_diag(StDiagnostic* diag, const char* code, const std::string& msg, int line, int col)
{
    diag->severity = StSeverity::ERROR;
    diag->code = code;
    diag->message = msg;
    diag->line = line;
    diag->column = col;
    diag->length = 1;
}

bool resolve_expr(StExpr* e, const SymbolTable& syms, StDiagnostic* diag)
{
    switch (e->kind) {
    case StExpr::Kind::LITERAL:
        e->result_type = e->literal.type;
        return true;
    case StExpr::Kind::VAR: {
        auto it = syms.find(e->var_name);
        if (it == syms.end()) {
            set_diag(diag, st_diag_code::kUnboundVariable,
                     "'" + e->var_name + "' is not declared in VAR_INPUT/VAR_OUTPUT",
                     e->line, e->column);
            return false;
        }
        e->result_type = it->second.type;
        return true;
    }
    case StExpr::Kind::CMP:
        if (!resolve_expr(e->lhs.get(), syms, diag)) return false;
        if (!resolve_expr(e->rhs.get(), syms, diag)) return false;
        if (e->cmp_op == StCompareOp::EQ || e->cmp_op == StCompareOp::NE) {
            if (e->lhs->result_type != e->rhs->result_type) {
                set_diag(diag, st_diag_code::kTypeMismatch,
                         "'='/'<>' requires both operands of the same type", e->line, e->column);
                return false;
            }
        } else if (e->lhs->result_type != StType::REAL || e->rhs->result_type != StType::REAL) {
            set_diag(diag, st_diag_code::kTypeMismatch,
                     "ordering comparison ('>','>=','<','<=') requires REAL operands",
                     e->line, e->column);
            return false;
        }
        e->result_type = StType::BOOL;
        return true;
    case StExpr::Kind::AND_:
    case StExpr::Kind::OR_:
        if (!resolve_expr(e->lhs.get(), syms, diag)) return false;
        if (!resolve_expr(e->rhs.get(), syms, diag)) return false;
        if (e->lhs->result_type != StType::BOOL || e->rhs->result_type != StType::BOOL) {
            set_diag(diag, st_diag_code::kTypeMismatch,
                     "'AND'/'OR' requires BOOL operands", e->line, e->column);
            return false;
        }
        e->result_type = StType::BOOL;
        return true;
    case StExpr::Kind::NOT_:
        if (!resolve_expr(e->operand.get(), syms, diag)) return false;
        if (e->operand->result_type != StType::BOOL) {
            set_diag(diag, st_diag_code::kTypeMismatch, "'NOT' requires a BOOL operand",
                     e->line, e->column);
            return false;
        }
        e->result_type = StType::BOOL;
        return true;
    case StExpr::Kind::CALL: {
        const StStdFunctionSignature* sig = find_std_function_signature(e->call_name);
        if (!sig) {
            set_diag(diag, st_diag_code::kUnknownFunction,
                     "'" + e->call_name + "' is not a known standard function", e->line, e->column);
            return false;
        }
        if (e->call_args.size() != sig->arg_types.size()) {
            set_diag(diag, st_diag_code::kArgCountMismatch,
                     "'" + e->call_name + "' expects " + std::to_string(sig->arg_types.size()) +
                         " argument(s), got " + std::to_string(e->call_args.size()),
                     e->line, e->column);
            return false;
        }
        for (std::size_t i = 0; i < e->call_args.size(); i++) {
            if (!resolve_expr(e->call_args[i].get(), syms, diag)) return false;
            if (e->call_args[i]->result_type != sig->arg_types[i]) {
                set_diag(diag, st_diag_code::kTypeMismatch,
                         "'" + e->call_name + "' argument " + std::to_string(i + 1) + " type mismatch",
                         e->call_args[i]->line, e->call_args[i]->column);
                return false;
            }
        }
        e->result_type = sig->return_type;
        return true;
    }
    }
    set_diag(diag, st_diag_code::kSyntaxUnexpected, "internal_error: unknown expr kind", e->line, e->column);
    return false;
}

bool check_stmt_list(std::vector<StStmt>* stmts, const SymbolTable& syms, StDiagnostic* diag);

bool check_stmt(StStmt* s, const SymbolTable& syms, StDiagnostic* diag)
{
    if (s->kind == StStmt::Kind::ASSIGN) {
        auto it = syms.find(s->assign_target);
        if (it == syms.end()) {
            set_diag(diag, st_diag_code::kUnboundVariable,
                     "'" + s->assign_target + "' is not declared",
                     s->assign_target_line, s->assign_target_column);
            return false;
        }
        if (!it->second.is_output) {
            set_diag(diag, st_diag_code::kReadonlyInput,
                     "'" + s->assign_target + "' is a VAR_INPUT (read-only in body per IEC semantics)",
                     s->assign_target_line, s->assign_target_column);
            return false;
        }
        if (!resolve_expr(s->assign_expr.get(), syms, diag)) return false;
        if (s->assign_expr->result_type != it->second.type) {
            set_diag(diag, st_diag_code::kTypeMismatch,
                     "assignment to '" + s->assign_target + "' has mismatched type",
                     s->assign_target_line, s->assign_target_column);
            return false;
        }
        return true;
    }
    /* IF */
    if (!resolve_expr(s->if_cond.get(), syms, diag)) return false;
    if (s->if_cond->result_type != StType::BOOL) {
        set_diag(diag, st_diag_code::kTypeMismatch, "IF condition must be BOOL",
                 s->if_cond->line, s->if_cond->column);
        return false;
    }
    if (!check_stmt_list(&s->if_then, syms, diag)) return false;
    if (!check_stmt_list(&s->if_else, syms, diag)) return false;
    return true;
}

bool check_stmt_list(std::vector<StStmt>* stmts, const SymbolTable& syms, StDiagnostic* diag)
{
    for (StStmt& s : *stmts)
        if (!check_stmt(&s, syms, diag)) return false;
    return true;
}

} // namespace

bool typecheck_st_program(StProgram* prog, StDiagnostic* diag)
{
    SymbolTable syms;
    for (const StVarDecl& d : prog->inputs) {
        if (syms.count(d.name)) {
            set_diag(diag, st_diag_code::kDuplicateVar, "'" + d.name + "' declared more than once",
                     d.line, d.column);
            return false;
        }
        syms[d.name] = {d.type, false};
    }
    for (const StVarDecl& d : prog->outputs) {
        if (syms.count(d.name)) {
            set_diag(diag, st_diag_code::kDuplicateVar, "'" + d.name + "' declared more than once",
                     d.line, d.column);
            return false;
        }
        syms[d.name] = {d.type, true};
    }
    return check_stmt_list(&prog->body, syms, diag);
}

} // namespace core
