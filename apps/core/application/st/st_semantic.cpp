#include "st/st_semantic.hpp"

#include <cstdint>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "st/st_limits.hpp"

namespace core {
namespace {

void set_diag(StDiagnostic* d, const char* code, const std::string& msg, int line, int col,
              int length)
{
    d->severity = StSeverity::ERROR;
    d->code = code;
    d->message = msg;
    d->line = line;
    d->column = col;
    d->length = length > 0 ? length : 1;
}

/* Kết quả suy luận kiểu của một biểu thức.
 *
 * `poly` tồn tại để xử lý literal nguyên đa hình (SPEC §3.4): `1` chưa có
 * kiểu cho tới khi biết ngữ cảnh. Không có trạng thái này thì `r := r + 1`
 * phải viết `r := r + 1.0` — chặt hơn nhưng không an toàn hơn, chỉ phiền
 * hơn, vì literal luôn biết giá trị tại compile time. */
struct TypeInfo {
    bool   poly = false;
    StType type = StType::REAL;

    static TypeInfo make_poly() { TypeInfo t; t.poly = true; return t; }
    static TypeInfo make(StType s) { TypeInfo t; t.poly = false; t.type = s; return t; }
};

struct Symbol {
    StType    type;
    StStorage storage;
};

struct FbSymbol {
    StFbType type;
    bool     retained;
};

class Checker {
public:
    Checker(StProgram* prog, StDiagnostic* diag) : prog_(prog), diag_(diag) {}

    bool run()
    {
        if (!build_symbols()) return false;
        return check_stmts(prog_->body);
    }

private:
    StProgram*    prog_;
    StDiagnostic* diag_;
    std::unordered_map<std::string, Symbol>   vars_;
    std::unordered_map<std::string, FbSymbol> fbs_;
    /* Instance FB đã gọi trong chu kỳ. SPEC §5.3: gọi hai lần làm ngữ nghĩa
     * timer mất ý nghĩa (một lần gọi = một lần cập nhật trạng thái), nên đây
     * là lỗi chứ không phải cảnh báo. */
    std::unordered_set<std::string> fb_called_;

    bool fail(const char* code, const std::string& msg, int line, int col, int length = 1)
    {
        set_diag(diag_, code, msg, line, col, length);
        return false;
    }

    /* ---- Bảng ký hiệu ---- */

    bool build_symbols()
    {
        std::size_t retain_count = 0;
        for (const StVarDecl& v : prog_->vars) {
            if (vars_.count(v.name) || fbs_.count(v.name))
                return fail(st_diag_code::kDuplicateVar,
                            "duplicate declaration of '" + v.name + "'", v.line, v.column,
                            v.length);
            if (v.storage == StStorage::VAR_RETAIN &&
                ++retain_count > st_limits::kMaxRetainVars)
                return fail(st_diag_code::kTooManyRetainVars,
                            "RETAIN variable count exceeds limit of " +
                                std::to_string(st_limits::kMaxRetainVars),
                            v.line, v.column, v.length);
            vars_[v.name] = Symbol{v.type, v.storage};
        }
        for (const StFbDecl& f : prog_->fbs) {
            if (vars_.count(f.name) || fbs_.count(f.name))
                return fail(st_diag_code::kDuplicateVar,
                            "duplicate declaration of '" + f.name + "'", f.line, f.column,
                            f.length);
            if (f.retained && ++retain_count > st_limits::kMaxRetainVars)
                return fail(st_diag_code::kTooManyRetainVars,
                            "RETAIN variable count exceeds limit of " +
                                std::to_string(st_limits::kMaxRetainVars),
                            f.line, f.column, f.length);
            fbs_[f.name] = FbSymbol{f.fb_type, f.retained};
        }
        return true;
    }

    /* ---- Câu lệnh ---- */

    bool check_stmts(std::vector<StStmt>& stmts)
    {
        for (StStmt& s : stmts)
            if (!check_stmt(s)) return false;
        return true;
    }

    bool check_stmt(StStmt& s)
    {
        switch (s.kind) {
        case StStmt::Kind::ASSIGN:  return check_assign(s);
        case StStmt::Kind::IF:      return check_if(s);
        case StStmt::Kind::FB_CALL: return check_fb_call(s);
        }
        return true;
    }

    bool check_assign(StStmt& s)
    {
        if (fbs_.count(s.assign_target))
            return fail(st_diag_code::kAssignToFbInstance,
                        "cannot assign to function block instance '" + s.assign_target + "'",
                        s.assign_target_line, s.assign_target_column, s.assign_target_length);
        auto it = vars_.find(s.assign_target);
        if (it == vars_.end())
            return fail(st_diag_code::kUnboundVariable,
                        "undeclared variable '" + s.assign_target + "'",
                        s.assign_target_line, s.assign_target_column, s.assign_target_length);
        if (it->second.storage == StStorage::VAR_INPUT)
            return fail(st_diag_code::kReadonlyInput,
                        "'" + s.assign_target + "' is VAR_INPUT and is read-only",
                        s.assign_target_line, s.assign_target_column, s.assign_target_length);

        const StType want = it->second.type;
        TypeInfo got;
        if (!check_expr(*s.assign_expr, &got)) return false;
        if (!coerce(*s.assign_expr, &got, want)) return false;
        if (got.type != want)
            return fail(st_diag_code::kTypeMismatch,
                        std::string("cannot assign ") + st_type_name(got.type) + " to " +
                            st_type_name(want) + " variable '" + s.assign_target + "'",
                        s.assign_target_line, s.assign_target_column, s.assign_target_length);
        return true;
    }

    bool check_if(StStmt& s)
    {
        for (StIfBranch& b : s.branches) {
            if (b.cond) {
                TypeInfo t;
                if (!check_expr(*b.cond, &t)) return false;
                if (!coerce(*b.cond, &t, StType::BOOL)) return false;
                if (t.type != StType::BOOL)
                    return fail(st_diag_code::kTypeMismatch,
                                std::string("IF condition must be BOOL, got ") +
                                    st_type_name(t.type),
                                b.cond->line, b.cond->column, b.cond->length);
            }
            if (!check_stmts(b.body)) return false;
        }
        return true;
    }

    bool check_fb_call(StStmt& s)
    {
        auto it = fbs_.find(s.fb_instance);
        if (it == fbs_.end()) {
            /* Tên tồn tại nhưng không phải instance FB → nói rõ nhầm lẫn thay
             * vì báo "chưa khai báo", vì nguyên nhân thật khác hẳn. */
            if (vars_.count(s.fb_instance))
                return fail(st_diag_code::kFbFunctionConfusion,
                            "'" + s.fb_instance + "' is a variable, not a function block instance",
                            s.fb_line, s.fb_column, s.fb_length);
            StFunc dummy;
            if (st_func_from_name(s.fb_instance, &dummy))
                return fail(st_diag_code::kFbFunctionConfusion,
                            "'" + s.fb_instance +
                                "' is a standard function; use it inside an expression, "
                                "not as a statement",
                            s.fb_line, s.fb_column, s.fb_length);
            return fail(st_diag_code::kUnboundVariable,
                        "undeclared function block instance '" + s.fb_instance + "'",
                        s.fb_line, s.fb_column, s.fb_length);
        }

        if (!fb_called_.insert(s.fb_instance).second)
            return fail(st_diag_code::kFbCalledTwice,
                        "function block instance '" + s.fb_instance +
                            "' is called more than once per cycle",
                        s.fb_line, s.fb_column, s.fb_length);

        const StFbType fb = it->second.type;
        std::unordered_set<std::string> seen;
        for (StFbArg& arg : s.fb_args) {
            int idx = -1;
            for (int i = 0; i < st_fb_input_count(fb); i++) {
                const char* n = st_fb_input_name(fb, i);
                if (n && arg.name == n) { idx = i; break; }
            }
            if (idx < 0)
                return fail(st_diag_code::kBadFbParam,
                            "'" + arg.name + "' is not an input of " + st_fb_type_name(fb),
                            arg.line, arg.column, arg.length);
            if (!seen.insert(arg.name).second)
                return fail(st_diag_code::kBadFbParam,
                            "duplicate argument '" + arg.name + "'", arg.line, arg.column,
                            arg.length);

            const StType want = st_fb_input_type(fb, idx);
            TypeInfo got;
            if (!check_expr(*arg.value, &got)) return false;
            if (!coerce(*arg.value, &got, want)) return false;
            if (got.type != want)
                return fail(st_diag_code::kTypeMismatch,
                            std::string("argument '") + arg.name + "' of " + st_fb_type_name(fb) +
                                " expects " + st_type_name(want) + ", got " +
                                st_type_name(got.type),
                            arg.line, arg.column, arg.length);
        }
        return true;
    }

    /* ---- Biểu thức ---- */

    /* Chốt kiểu cho literal đa hình khi đã biết ngữ cảnh mong đợi. Không phải
     * literal đa hình thì không làm gì (kiểu đã cố định). */
    bool coerce(StExpr& e, TypeInfo* t, StType want)
    {
        if (!t->poly) return true;
        if (want == StType::INT) {
            if (e.literal_int_value > std::numeric_limits<int32_t>::max() ||
                e.literal_int_value < std::numeric_limits<int32_t>::min())
                return fail(st_diag_code::kIntLiteralOutOfRange,
                            "integer literal " + std::to_string(e.literal_int_value) +
                                " is outside INT range",
                            e.line, e.column, e.length);
            e.literal = StValue::make_int(static_cast<int32_t>(e.literal_int_value));
        } else if (want == StType::REAL) {
            e.literal = StValue::make_real(static_cast<float>(e.literal_int_value));
        } else {
            /* BOOL/TIME không nhận literal nguyên. Chốt về INT rồi để caller
             * báo type mismatch với thông điệp đúng ngữ cảnh của nó — báo ở
             * đây sẽ mất thông tin "đang ở tham số nào của hàm nào". */
            e.literal = StValue::make_int(0);
            e.result_type = StType::INT;
            e.literal_polymorphic = false;
            t->poly = false;
            t->type = StType::INT;
            return true;
        }
        e.literal_polymorphic = false;
        e.result_type = want;
        t->poly = false;
        t->type = want;
        return true;
    }

    /* Hai vế của toán tử nhị phân: bên đa hình lấy kiểu của bên cụ thể.
     * Cả hai đa hình → mặc định INT. */
    bool unify(StExpr& l, TypeInfo* lt, StExpr& r, TypeInfo* rt)
    {
        if (lt->poly && rt->poly) {
            if (!coerce(l, lt, StType::INT)) return false;
            return coerce(r, rt, StType::INT);
        }
        if (lt->poly) return coerce(l, lt, rt->type);
        if (rt->poly) return coerce(r, rt, lt->type);
        return true;
    }

    static bool is_numeric(StType t) { return t == StType::INT || t == StType::REAL; }

    bool check_expr(StExpr& e, TypeInfo* out)
    {
        switch (e.kind) {
        case StExpr::Kind::LITERAL:
            if (e.literal_polymorphic) { *out = TypeInfo::make_poly(); return true; }
            e.result_type = e.literal.type;
            *out = TypeInfo::make(e.literal.type);
            return true;

        case StExpr::Kind::VAR: {
            auto it = vars_.find(e.var_name);
            if (it == vars_.end()) {
                if (fbs_.count(e.var_name))
                    return fail(st_diag_code::kFbFunctionConfusion,
                                "'" + e.var_name +
                                    "' is a function block instance; read its output with "
                                    "'<instance>.<OUTPUT>'",
                                e.line, e.column, e.length);
                return fail(st_diag_code::kUnboundVariable,
                            "undeclared variable '" + e.var_name + "'", e.line, e.column,
                            e.length);
            }
            e.result_type = it->second.type;
            *out = TypeInfo::make(it->second.type);
            return true;
        }

        case StExpr::Kind::MEMBER: {
            auto it = fbs_.find(e.member_object);
            if (it == fbs_.end())
                return fail(st_diag_code::kUnboundVariable,
                            "undeclared function block instance '" + e.member_object + "'",
                            e.line, e.column, e.length);
            const StFbType fb = it->second.type;
            for (int i = 0; i < st_fb_output_count(fb); i++) {
                const char* n = st_fb_output_name(fb, i);
                if (n && e.member_field == n) {
                    e.result_type = st_fb_output_type(fb, i);
                    *out = TypeInfo::make(e.result_type);
                    return true;
                }
            }
            return fail(st_diag_code::kBadFbParam,
                        "'" + e.member_field + "' is not an output of " + st_fb_type_name(fb),
                        e.line, e.column, e.length);
        }

        case StExpr::Kind::UNOP: {
            TypeInfo t;
            if (!check_expr(*e.operand, &t)) return false;
            if (e.un_op == StUnOp::NOT) {
                if (!coerce(*e.operand, &t, StType::BOOL)) return false;
                if (t.type != StType::BOOL)
                    return fail(st_diag_code::kTypeMismatch,
                                std::string("NOT requires BOOL, got ") + st_type_name(t.type),
                                e.line, e.column, e.length);
                e.result_type = StType::BOOL;
            } else {
                if (t.poly && !coerce(*e.operand, &t, StType::INT)) return false;
                if (!is_numeric(t.type))
                    return fail(st_diag_code::kTypeMismatch,
                                std::string("unary '-' requires INT or REAL, got ") +
                                    st_type_name(t.type),
                                e.line, e.column, e.length);
                e.result_type = t.type;
            }
            *out = TypeInfo::make(e.result_type);
            return true;
        }

        case StExpr::Kind::BINOP: return check_binop(e, out);
        case StExpr::Kind::CALL:  return check_call(e, out);
        }
        return true;
    }

    bool check_binop(StExpr& e, TypeInfo* out)
    {
        TypeInfo lt, rt;
        if (!check_expr(*e.lhs, &lt)) return false;
        if (!check_expr(*e.rhs, &rt)) return false;

        const StBinOp op = e.bin_op;
        if (op == StBinOp::AND || op == StBinOp::OR || op == StBinOp::XOR) {
            if (!coerce(*e.lhs, &lt, StType::BOOL)) return false;
            if (!coerce(*e.rhs, &rt, StType::BOOL)) return false;
            if (lt.type != StType::BOOL || rt.type != StType::BOOL)
                return fail(st_diag_code::kTypeMismatch,
                            "logical operator requires BOOL on both sides", e.line, e.column,
                            e.length);
            e.result_type = StType::BOOL;
            *out = TypeInfo::make(StType::BOOL);
            return true;
        }

        if (!unify(*e.lhs, &lt, *e.rhs, &rt)) return false;
        if (lt.type != rt.type)
            return fail(st_diag_code::kTypeMismatch,
                        std::string("operand types differ: ") + st_type_name(lt.type) + " vs " +
                            st_type_name(rt.type) + " (no implicit conversion between variables)",
                        e.line, e.column, e.length);
        const StType t = lt.type;

        switch (op) {
        case StBinOp::ADD:
        case StBinOp::SUB:
            if (!is_numeric(t) && t != StType::TIME)
                return fail(st_diag_code::kTypeMismatch,
                            std::string("'+'/'-' require INT, REAL or TIME, got ") +
                                st_type_name(t),
                            e.line, e.column, e.length);
            e.result_type = t;
            break;
        case StBinOp::MUL:
        case StBinOp::DIV:
            if (!is_numeric(t))
                return fail(st_diag_code::kTypeMismatch,
                            std::string("'*'/'/' require INT or REAL, got ") + st_type_name(t),
                            e.line, e.column, e.length);
            e.result_type = t;
            break;
        case StBinOp::MOD:
            if (t != StType::INT)
                return fail(st_diag_code::kTypeMismatch,
                            std::string("MOD requires INT, got ") + st_type_name(t),
                            e.line, e.column, e.length);
            e.result_type = StType::INT;
            break;
        case StBinOp::LT: case StBinOp::LE: case StBinOp::GT: case StBinOp::GE:
            if (!is_numeric(t) && t != StType::TIME)
                return fail(st_diag_code::kTypeMismatch,
                            std::string("ordering comparison requires INT, REAL or TIME, got ") +
                                st_type_name(t),
                            e.line, e.column, e.length);
            e.result_type = StType::BOOL;
            break;
        case StBinOp::EQ: case StBinOp::NE:
            e.result_type = StType::BOOL;
            break;
        default:
            break;
        }
        *out = TypeInfo::make(e.result_type);
        return true;
    }

    bool check_call(StExpr& e, TypeInfo* out)
    {
        const int arity = st_func_arity(e.func);
        if (static_cast<int>(e.args.size()) != arity)
            return fail(st_diag_code::kArgCountMismatch,
                        std::string(st_func_name(e.func)) + " expects " + std::to_string(arity) +
                            " argument(s), got " + std::to_string(e.args.size()),
                        e.line, e.column, e.length);

        std::vector<TypeInfo> ts(e.args.size());
        for (std::size_t i = 0; i < e.args.size(); i++)
            if (!check_expr(*e.args[i], &ts[i])) return false;

        auto require = [&](std::size_t i, StType want) -> bool {
            if (!coerce(*e.args[i], &ts[i], want)) return false;
            if (ts[i].type != want)
                return fail(st_diag_code::kTypeMismatch,
                            std::string(st_func_name(e.func)) + " argument " +
                                std::to_string(i + 1) + " expects " + st_type_name(want) +
                                ", got " + st_type_name(ts[i].type),
                            e.args[i]->line, e.args[i]->column, e.args[i]->length);
            return true;
        };

        switch (e.func) {
        case StFunc::ABS:
            if (ts[0].poly && !coerce(*e.args[0], &ts[0], StType::INT)) return false;
            if (!is_numeric(ts[0].type))
                return fail(st_diag_code::kTypeMismatch, "ABS requires INT or REAL",
                            e.line, e.column, e.length);
            e.result_type = ts[0].type;
            break;

        case StFunc::MIN:
        case StFunc::MAX:
            if (!unify(*e.args[0], &ts[0], *e.args[1], &ts[1])) return false;
            if (ts[0].type != ts[1].type)
                return fail(st_diag_code::kTypeMismatch,
                            std::string(st_func_name(e.func)) +
                                " requires both arguments to have the same type",
                            e.line, e.column, e.length);
            if (!is_numeric(ts[0].type) && ts[0].type != StType::TIME)
                return fail(st_diag_code::kTypeMismatch,
                            std::string(st_func_name(e.func)) + " requires INT, REAL or TIME",
                            e.line, e.column, e.length);
            e.result_type = ts[0].type;
            break;

        case StFunc::LIMIT: {
            /* Kiểu chung của 3 tham số: lấy kiểu cụ thể đầu tiên tìm được rồi
             * ép các tham số đa hình còn lại về đó. */
            StType common = StType::INT;
            for (std::size_t i = 0; i < 3; i++)
                if (!ts[i].poly) { common = ts[i].type; break; }
            for (std::size_t i = 0; i < 3; i++)
                if (!require(i, common)) return false;
            if (!is_numeric(common) && common != StType::TIME)
                return fail(st_diag_code::kTypeMismatch, "LIMIT requires INT, REAL or TIME",
                            e.line, e.column, e.length);
            e.result_type = common;
            break;
        }

        case StFunc::SEL:
            if (!require(0, StType::BOOL)) return false;
            if (!unify(*e.args[1], &ts[1], *e.args[2], &ts[2])) return false;
            if (ts[1].type != ts[2].type)
                return fail(st_diag_code::kTypeMismatch,
                            "SEL requires IN0 and IN1 to have the same type", e.line, e.column,
                            e.length);
            e.result_type = ts[1].type;
            break;

        case StFunc::SQRT:
            if (!require(0, StType::REAL)) return false;
            e.result_type = StType::REAL;
            break;
        case StFunc::INT_TO_REAL:
            if (!require(0, StType::INT)) return false;
            e.result_type = StType::REAL;
            break;
        case StFunc::REAL_TO_INT:
            if (!require(0, StType::REAL)) return false;
            e.result_type = StType::INT;
            break;
        case StFunc::TIME_TO_REAL:
            if (!require(0, StType::TIME)) return false;
            e.result_type = StType::REAL;
            break;
        case StFunc::REAL_TO_TIME:
            if (!require(0, StType::REAL)) return false;
            e.result_type = StType::TIME;
            break;
        }

        *out = TypeInfo::make(e.result_type);
        return true;
    }
};

} // namespace

bool typecheck_st_program(StProgram* prog, StDiagnostic* diag)
{
    StDiagnostic local;
    Checker c(prog, diag ? diag : &local);
    return c.run();
}

} // namespace core
