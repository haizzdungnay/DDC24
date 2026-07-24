#include "st_semantic.hpp"

#include <unordered_map>

namespace core {
namespace {

struct Symbol {
    StType type = StType::REAL;
    bool   is_output = false;
};

using SymbolTable = std::unordered_map<std::string, Symbol>;

bool resolve_expr(StExpr* e, const SymbolTable& syms, std::string* error)
{
    switch (e->kind) {
    case StExpr::Kind::LITERAL:
        e->result_type = e->literal.type;
        return true;
    case StExpr::Kind::VAR: {
        auto it = syms.find(e->var_name);
        if (it == syms.end()) {
            *error = "unbound_variable: '" + e->var_name + "' không được khai báo trong VAR_INPUT/VAR_OUTPUT";
            return false;
        }
        e->result_type = it->second.type;
        return true;
    }
    case StExpr::Kind::GT:
        if (!resolve_expr(e->lhs.get(), syms, error)) return false;
        if (!resolve_expr(e->rhs.get(), syms, error)) return false;
        if (e->lhs->result_type != StType::REAL || e->rhs->result_type != StType::REAL) {
            *error = "type_mismatch: toán tử '>' chỉ áp dụng cho REAL";
            return false;
        }
        e->result_type = StType::BOOL;
        return true;
    }
    *error = "internal_error: unknown expr kind";
    return false;
}

bool check_stmt_list(std::vector<StStmt>* stmts, const SymbolTable& syms, std::string* error);

bool check_stmt(StStmt* s, const SymbolTable& syms, std::string* error)
{
    if (s->kind == StStmt::Kind::ASSIGN) {
        auto it = syms.find(s->assign_target);
        if (it == syms.end()) {
            *error = "unbound_variable: '" + s->assign_target + "' không được khai báo";
            return false;
        }
        if (!it->second.is_output) {
            *error = "readonly_input_target: '" + s->assign_target +
                     "' là VAR_INPUT, không được gán (IEC: input read-only trong body)";
            return false;
        }
        if (!resolve_expr(s->assign_expr.get(), syms, error)) return false;
        if (s->assign_expr->result_type != it->second.type) {
            *error = "type_mismatch: gán cho '" + s->assign_target + "' sai kiểu";
            return false;
        }
        return true;
    }
    /* IF */
    if (!resolve_expr(s->if_cond.get(), syms, error)) return false;
    if (s->if_cond->result_type != StType::BOOL) {
        *error = "type_mismatch: điều kiện IF phải là BOOL";
        return false;
    }
    if (!check_stmt_list(&s->if_then, syms, error)) return false;
    if (!check_stmt_list(&s->if_else, syms, error)) return false;
    return true;
}

bool check_stmt_list(std::vector<StStmt>* stmts, const SymbolTable& syms, std::string* error)
{
    for (StStmt& s : *stmts)
        if (!check_stmt(&s, syms, error)) return false;
    return true;
}

} // namespace

bool typecheck_st_program(StProgram* prog, std::string* error)
{
    SymbolTable syms;
    for (const StVarDecl& d : prog->inputs) {
        if (syms.count(d.name)) {
            *error = "duplicate_variable: '" + d.name + "' khai báo nhiều lần";
            return false;
        }
        syms[d.name] = {d.type, false};
    }
    for (const StVarDecl& d : prog->outputs) {
        if (syms.count(d.name)) {
            *error = "duplicate_variable: '" + d.name + "' khai báo nhiều lần";
            return false;
        }
        syms[d.name] = {d.type, true};
    }
    return check_stmt_list(&prog->body, syms, error);
}

} // namespace core
