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
    StFbType        type;
    bool            retained;
    const StProgram* user_type = nullptr;
};

std::string fold_pou_name(const std::string& value)
{
    std::string folded;
    folded.reserve(value.size());
    for (char ch : value)
        folded.push_back(static_cast<char>(
            ch >= 'a' && ch <= 'z' ? ch - ('a' - 'A') : ch));
    return folded;
}

class Checker {
public:
    Checker(StProgram* prog, StDiagnostic* diag,
            const std::vector<StPouSource>* sources = nullptr,
            const StPouRegistryResult* registry = nullptr,
            const std::vector<StPublishedSignalContract>* signals = nullptr,
            std::string program_identity = {})
        : prog_(prog), diag_(diag), program_identity_(std::move(program_identity))
    {
        if (sources != nullptr) {
            for (const StPouSource& source : *sources)
                if (source.pou != nullptr)
                    pou_defs_[fold_pou_name(source.pou->name)] = source.pou;
        }
        if (registry != nullptr) {
            for (const StPouSignature& signature : registry->signatures)
                signatures_[fold_pou_name(signature.name)] = &signature;
        }
        if (signals != nullptr) {
            for (const StPublishedSignalContract& signal : *signals)
                signals_[fold_pou_name(signal.name)] = &signal;
        }
    }

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
    std::unordered_map<std::string, const StProgram*> pou_defs_;
    std::unordered_map<std::string, const StPouSignature*> signatures_;
    std::unordered_map<std::string, const StPublishedSignalContract*> signals_;
    std::string program_identity_;
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
        if (prog_->kind == StPouKind::FUNCTION) {
            /* IEC dùng chính tên FUNCTION làm ô trả về có thể gán. Ô này chỉ
             * tồn tại trong scope lời gọi, không phải state của FUNCTION. */
            vars_[prog_->name] = Symbol{prog_->return_type, StStorage::VAR_LOCAL};
        }
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
            const StProgram* user_type = nullptr;
            if (f.is_user_type) {
                const auto found = pou_defs_.find(fold_pou_name(f.user_type_name));
                if (found == pou_defs_.end())
                    return fail(st_diag_code::kLibraryEntryMissing,
                                "function block type '" + f.user_type_name +
                                    "' has no linked implementation",
                                f.line, f.column, f.length);
                user_type = found->second;
                if (user_type->kind != StPouKind::FUNCTION_BLOCK)
                    return fail(st_diag_code::kPouSignatureInvalid,
                                "'" + f.user_type_name + "' is a " +
                                    st_pou_kind_name(user_type->kind) +
                                    " and cannot be instantiated as a function block",
                                f.line, f.column, f.length);
            }
            fbs_[f.name] = FbSymbol{f.fb_type, f.retained, user_type};
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
        case StStmt::Kind::SIGNAL_PUBLISH: return check_signal_publish(s);
        }
        return true;
    }

    bool check_signal_publish(StStmt& s)
    {
        const auto found = signals_.find(fold_pou_name(s.signal_name));
        if (found == signals_.end())
            return fail(st_diag_code::kSignalConsumerMissing,
                        "Published Signal '" + s.signal_name + "' is not declared",
                        s.signal_line, s.signal_column, s.signal_length);
        const StPublishedSignalContract& signal = *found->second;
        if (signal.producer_program != program_identity_)
            return fail(st_diag_code::kSignalDuplicatePublisher,
                        "Program is not the declared publisher of '" + signal.name + "'",
                        s.signal_line, s.signal_column, s.signal_length);
        TypeInfo value;
        const StType want = signal.type;
        if (!check_expr(*s.signal_value, &value, &want)) return false;
        if (!coerce(*s.signal_value, &value, want)) return false;
        if (value.type != want)
            return fail(st_diag_code::kSignalTypeMismatch,
                        "Published Signal '" + signal.name + "' expects " +
                            st_type_name(want) + ", got " + st_type_name(value.type),
                        s.signal_line, s.signal_column, s.signal_length);
        s.signal_name = signal.name;
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
        const bool direct_signal_read =
            s.assign_expr->kind == StExpr::Kind::SIGNAL_READ;
        if (!check_expr(*s.assign_expr, &got, &want, direct_signal_read)) return false;
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
                const StType want = StType::BOOL;
                if (!check_expr(*b.cond, &t, &want)) return false;
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
        const StProgram* user_fb = it->second.user_type;
        std::unordered_set<std::string> seen;
        for (StFbArg& arg : s.fb_args) {
            int idx = -1;
            StType want = StType::REAL;
            std::string type_name;
            if (user_fb != nullptr) {
                const std::vector<const StVarDecl*> inputs =
                    user_fb->by_storage(StStorage::VAR_INPUT);
                for (std::size_t i = 0; i < inputs.size(); ++i) {
                    if (fold_pou_name(inputs[i]->name) == fold_pou_name(arg.name)) {
                        idx = static_cast<int>(i);
                        want = inputs[i]->type;
                        break;
                    }
                }
                type_name = user_fb->name;
            } else {
                for (int i = 0; i < st_fb_input_count(fb); i++) {
                    const char* n = st_fb_input_name(fb, i);
                    if (n && arg.name == n) { idx = i; break; }
                }
                if (idx >= 0) want = st_fb_input_type(fb, idx);
                type_name = st_fb_type_name(fb);
            }
            if (idx < 0)
                return fail(st_diag_code::kBadFbParam,
                            "'" + arg.name + "' is not an input of " + type_name,
                            arg.line, arg.column, arg.length);
            if (!seen.insert(arg.name).second)
                return fail(st_diag_code::kBadFbParam,
                            "duplicate argument '" + arg.name + "'", arg.line, arg.column,
                            arg.length);

            TypeInfo got;
            if (!check_expr(*arg.value, &got, &want)) return false;
            if (!coerce(*arg.value, &got, want)) return false;
            if (got.type != want)
                return fail(st_diag_code::kTypeMismatch,
                            std::string("argument '") + arg.name + "' of " + type_name +
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
        if (st_type_is_integer(want)) {
            if (e.literal_int_value > st_integer_max(want) ||
                e.literal_int_value < st_integer_min(want))
                return fail(st_diag_code::kIntLiteralOutOfRange,
                            "integer literal " + std::to_string(e.literal_int_value) +
                                " is outside " + st_type_name(want) + " range",
                            e.line, e.column, e.length);
            e.literal = StValue::make_integer(want, static_cast<int32_t>(e.literal_int_value));
        } else if (want == StType::REAL) {
            e.literal = StValue::make_real(static_cast<float>(e.literal_int_value));
        } else {
            /* BOOL/TIME không nhận literal nguyên. Chốt về DINT rồi để caller
             * báo type mismatch với thông điệp đúng ngữ cảnh của nó — báo ở
             * đây sẽ mất thông tin "đang ở tham số nào của hàm nào". */
            e.literal = StValue::make_dint(0);
            e.result_type = StType::DINT;
            e.literal_polymorphic = false;
            t->poly = false;
            t->type = StType::DINT;
            return true;
        }
        e.literal_polymorphic = false;
        e.result_type = want;
        t->poly = false;
        t->type = want;
        return true;
    }

    /* Hai vế của toán tử nhị phân: bên đa hình lấy kiểu của bên cụ thể.
     * Cả hai đa hình → dùng INT nếu cùng nằm trong 16-bit, ngược lại DINT.
     * UINT chỉ được chọn từ ngữ cảnh khai báo hoặc conversion tường minh. */
    bool unify(StExpr& l, TypeInfo* lt, StExpr& r, TypeInfo* rt)
    {
        if (lt->poly && rt->poly) {
            const bool fits_int =
                l.literal_int_value >= st_integer_min(StType::INT) &&
                l.literal_int_value <= st_integer_max(StType::INT) &&
                r.literal_int_value >= st_integer_min(StType::INT) &&
                r.literal_int_value <= st_integer_max(StType::INT);
            const StType chosen = fits_int ? StType::INT : StType::DINT;
            if (!coerce(l, lt, chosen)) return false;
            return coerce(r, rt, chosen);
        }
        if (lt->poly) return coerce(l, lt, rt->type);
        if (rt->poly) return coerce(r, rt, lt->type);
        return true;
    }

    static bool is_numeric(StType t) { return st_type_is_integer(t) || t == StType::REAL; }

    bool check_expr(StExpr& e, TypeInfo* out, const StType* expected = nullptr,
                    bool allow_direct_signal_read = false)
    {
        switch (e.kind) {
        case StExpr::Kind::SIGNAL_READ: {
            /* HOLD_PRIVATE phải để nguyên chính biến đích khi signal stale.
             * Nếu SIGNAL_READ nằm trong biểu thức trung gian (toán tử, IF,
             * tham số hàm/FB...) thì không còn một destination duy nhất để
             * giữ nguyên một cách deterministic. Rev A vì vậy chỉ cho phép
             * cú pháp trực tiếp `variable := SIGNAL_READ(name);`. */
            if (!allow_direct_signal_read)
                return fail(st_diag_code::kSignalReadContext,
                            "SIGNAL_READ must be the complete right-hand side of "
                            "a variable assignment",
                            e.line, e.column, e.length);
            const auto found = signals_.find(fold_pou_name(e.signal_name));
            if (found == signals_.end())
                return fail(st_diag_code::kSignalConsumerMissing,
                            "Published Signal '" + e.signal_name + "' is not declared",
                            e.line, e.column, e.length);
            e.signal_name = found->second->name;
            e.result_type = found->second->type;
            *out = TypeInfo::make(e.result_type);
            return true;
        }
        case StExpr::Kind::USER_CALL: {
            const auto found = signatures_.find(fold_pou_name(e.user_call_name));
            if (found == signatures_.end())
                return fail(st_diag_code::kLibraryEntryMissing,
                            "call to '" + e.user_call_name +
                                "' has no resolved POU signature",
                            e.line, e.column, e.length);
            const StPouSignature& signature = *found->second;
            if (signature.kind != StPouKind::FUNCTION || !signature.has_return_type)
                return fail(st_diag_code::kPouSignatureInvalid,
                            "'" + signature.name +
                                "' is not a FUNCTION usable in an expression",
                            e.line, e.column, e.length);
            if (e.args.size() != signature.input_types.size())
                return fail(st_diag_code::kPouSignatureInvalid,
                            "call to '" + signature.name + "' passes " +
                                std::to_string(e.args.size()) + " argument(s), expected " +
                                std::to_string(signature.input_types.size()),
                            e.line, e.column, e.length);
            for (std::size_t index = 0; index < e.args.size(); ++index) {
                const StType want = signature.input_types[index];
                TypeInfo got;
                if (!check_expr(*e.args[index], &got, &want)) return false;
                if (!coerce(*e.args[index], &got, want)) return false;
                if (got.type != want)
                    return fail(st_diag_code::kPouSignatureInvalid,
                                "argument " + std::to_string(index + 1) + " of '" +
                                    signature.name + "' expects " + st_type_name(want) +
                                    ", got " + st_type_name(got.type),
                                e.args[index]->line, e.args[index]->column,
                                e.args[index]->length);
            }
            e.result_type = signature.return_type;
            *out = TypeInfo::make(signature.return_type);
            return true;
        }

        case StExpr::Kind::LITERAL:
            if (e.literal_polymorphic) {
                *out = TypeInfo::make_poly();
                if (expected && (st_type_is_integer(*expected) || *expected == StType::REAL))
                    return coerce(e, out, *expected);
                return true;
            }
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
            if (it->second.user_type != nullptr) {
                for (const StVarDecl* output :
                     it->second.user_type->by_storage(StStorage::VAR_OUTPUT)) {
                    if (fold_pou_name(e.member_field) == fold_pou_name(output->name)) {
                        e.result_type = output->type;
                        *out = TypeInfo::make(e.result_type);
                        return true;
                    }
                }
                return fail(st_diag_code::kBadFbParam,
                            "'" + e.member_field + "' is not an output of " +
                                it->second.user_type->name,
                            e.line, e.column, e.length);
            }
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
            const StType bool_type = StType::BOOL;
            const StType* operand_expected =
                e.un_op == StUnOp::NOT ? &bool_type : expected;
            if (!check_expr(*e.operand, &t, operand_expected)) return false;
            if (e.un_op == StUnOp::NOT) {
                if (!coerce(*e.operand, &t, StType::BOOL)) return false;
                if (t.type != StType::BOOL)
                    return fail(st_diag_code::kTypeMismatch,
                                std::string("NOT requires BOOL, got ") + st_type_name(t.type),
                                e.line, e.column, e.length);
                e.result_type = StType::BOOL;
            } else {
                if (t.poly && !coerce(*e.operand, &t, StType::INT)) return false;
                if ((!st_type_is_signed_integer(t.type) && t.type != StType::REAL))
                    return fail(st_diag_code::kTypeMismatch,
                                std::string("unary '-' requires a signed integer or REAL, got ") +
                                    st_type_name(t.type),
                                e.line, e.column, e.length);
                e.result_type = t.type;
            }
            *out = TypeInfo::make(e.result_type);
            return true;
        }

        case StExpr::Kind::BINOP: return check_binop(e, out, expected);
        case StExpr::Kind::CALL:  return check_call(e, out, expected);
        }
        return true;
    }

    bool check_binop(StExpr& e, TypeInfo* out, const StType* expected)
    {
        TypeInfo lt, rt;
        const StBinOp op = e.bin_op;
        const bool result_is_operand_type =
            op == StBinOp::ADD || op == StBinOp::SUB || op == StBinOp::MUL ||
            op == StBinOp::DIV || op == StBinOp::MOD;
        const StType* operand_expected = result_is_operand_type ? expected : nullptr;
        if (!check_expr(*e.lhs, &lt, operand_expected)) return false;
        if (!check_expr(*e.rhs, &rt, operand_expected)) return false;

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
            if (!st_type_is_integer(t))
                return fail(st_diag_code::kTypeMismatch,
                            std::string("MOD requires an integer, got ") + st_type_name(t),
                            e.line, e.column, e.length);
            e.result_type = t;
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

    bool check_call(StExpr& e, TypeInfo* out, const StType* expected)
    {
        const int arity = st_func_arity(e.func);
        if (static_cast<int>(e.args.size()) != arity)
            return fail(st_diag_code::kArgCountMismatch,
                        std::string(st_func_name(e.func)) + " expects " + std::to_string(arity) +
                            " argument(s), got " + std::to_string(e.args.size()),
                        e.line, e.column, e.length);

        std::vector<TypeInfo> ts(e.args.size());
        for (std::size_t i = 0; i < e.args.size(); i++) {
            const bool result_typed_arg =
                e.func == StFunc::ABS || e.func == StFunc::MIN || e.func == StFunc::MAX ||
                e.func == StFunc::LIMIT || (e.func == StFunc::SEL && i > 0);
            if (!check_expr(*e.args[i], &ts[i], result_typed_arg ? expected : nullptr))
                return false;
        }

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
            StType common = expected && (is_numeric(*expected) || *expected == StType::TIME)
                                ? *expected
                                : StType::INT;
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

        case StFunc::SCALE:
        case StFunc::DEADBAND:
            /* Cả hai làm việc trên dải analog nên khoá REAL: cho INT đi qua sẽ
             * sinh một phép chia nguyên âm thầm ở giữa công thức quy đổi. */
            for (std::size_t i = 0; i < ts.size(); i++)
                if (!require(i, StType::REAL)) return false;
            e.result_type = StType::REAL;
            break;

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
        case StFunc::INT_TO_DINT:
            if (!require(0, StType::INT)) return false;
            e.result_type = StType::DINT;
            break;
        case StFunc::INT_TO_UINT:
            if (!require(0, StType::INT)) return false;
            e.result_type = StType::UINT;
            break;
        case StFunc::DINT_TO_INT:
            if (!require(0, StType::DINT)) return false;
            e.result_type = StType::INT;
            break;
        case StFunc::DINT_TO_UINT:
            if (!require(0, StType::DINT)) return false;
            e.result_type = StType::UINT;
            break;
        case StFunc::UINT_TO_INT:
            if (!require(0, StType::UINT)) return false;
            e.result_type = StType::INT;
            break;
        case StFunc::UINT_TO_DINT:
            if (!require(0, StType::UINT)) return false;
            e.result_type = StType::DINT;
            break;
        case StFunc::DINT_TO_REAL:
            if (!require(0, StType::DINT)) return false;
            e.result_type = StType::REAL;
            break;
        case StFunc::UINT_TO_REAL:
            if (!require(0, StType::UINT)) return false;
            e.result_type = StType::REAL;
            break;
        case StFunc::REAL_TO_DINT:
            if (!require(0, StType::REAL)) return false;
            e.result_type = StType::DINT;
            break;
        case StFunc::REAL_TO_UINT:
            if (!require(0, StType::REAL)) return false;
            e.result_type = StType::UINT;
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

bool typecheck_st_pou_set(const std::vector<StPouSource>& sources,
                          const StPouRegistryResult& registry,
                          StDiagnostic* diag,
                          const std::vector<StPublishedSignalContract>& signals,
                          const std::string& program_identity)
{
    StDiagnostic local;
    StDiagnostic* target = diag ? diag : &local;
    for (const StPouSource& source : sources) {
        if (source.pou == nullptr) {
            set_diag(target, st_diag_code::kPouSignatureInvalid,
                     "POU rỗng trong tập typecheck", 0, 0, 1);
            return false;
        }
        /* Registry nhận con trỏ const vì nó không sửa AST; semantic chốt kiểu
         * literal/result_type trên chính AST đã parse trước khi lowering. */
        auto* pou = const_cast<StProgram*>(source.pou);
        Checker checker(pou, target, &sources, &registry, &signals,
                        pou->kind == StPouKind::PROGRAM ? program_identity : std::string{});
        if (!checker.run()) return false;
    }
    return true;
}

} // namespace core
