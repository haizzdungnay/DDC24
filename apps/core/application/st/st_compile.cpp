#include "st/st_compile.hpp"

#include <algorithm>
#include <array>
#include <map>
#include <memory>
#include <unordered_map>

#include <sodium.h>

#include "st/st_artifact.hpp"
#include "st/st_fb_instance_layout.hpp"
#include "st/st_fbd_compile.hpp"
#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_review_gate.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

uint32_t crc32(const uint8_t* data, std::size_t n, uint32_t crc = 0xFFFFFFFFu)
{
    for (std::size_t i = 0; i < n; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++)
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return crc;
}

std::size_t type_size(StType t)
{
    switch (t) {
    case StType::BOOL: return 1;
    case StType::INT:  return 2;
    case StType::UINT: return 2;
    case StType::DINT: return 4;
    case StType::REAL: return 4;
    case StType::TIME: return 8;
    }
    return 8;
}

std::string fold_pou(const std::string& value)
{
    std::string folded;
    folded.reserve(value.size());
    for (char ch : value)
        folded.push_back(static_cast<char>(
            ch >= 'a' && ch <= 'z' ? ch - ('a' - 'A') : ch));
    return folded;
}

void rewrite_function_result_expr(StExpr* expression, const std::string& output_name,
                                  const std::string& function_name)
{
    if (expression == nullptr) return;
    if (expression->kind == StExpr::Kind::VAR && expression->var_name == output_name)
        expression->var_name = function_name;
    rewrite_function_result_expr(expression->lhs.get(), output_name, function_name);
    rewrite_function_result_expr(expression->rhs.get(), output_name, function_name);
    rewrite_function_result_expr(expression->operand.get(), output_name, function_name);
    for (auto& argument : expression->args)
        rewrite_function_result_expr(argument.get(), output_name, function_name);
}

void rewrite_function_result_body(std::vector<StStmt>* body,
                                  const std::string& output_name,
                                  const std::string& function_name)
{
    for (StStmt& statement : *body) {
        if (statement.kind == StStmt::Kind::ASSIGN) {
            if (statement.assign_target == output_name)
                statement.assign_target = function_name;
            rewrite_function_result_expr(statement.assign_expr.get(), output_name,
                                         function_name);
        } else if (statement.kind == StStmt::Kind::IF) {
            for (StIfBranch& branch : statement.branches) {
                rewrite_function_result_expr(branch.cond.get(), output_name, function_name);
                rewrite_function_result_body(&branch.body, output_name, function_name);
            }
        } else if (statement.kind == StStmt::Kind::FB_CALL) {
            for (StFbArg& argument : statement.fb_args)
                rewrite_function_result_expr(argument.value.get(), output_name,
                                             function_name);
        } else {
            rewrite_function_result_expr(statement.signal_value.get(), output_name,
                                         function_name);
        }
    }
}

class Compiler {
public:
    Compiler(const StProgram& prog, StIrModule* out, StDiagnostic* diag,
             const std::vector<StPouSource>* sources = nullptr,
             std::vector<StLinkedPouInfo>* linked_pous = nullptr,
             const StCompileOptions* options = nullptr)
        : prog_(prog), out_(out), diag_(diag), linked_pous_(linked_pous)
    {
        if (sources != nullptr) {
            for (const StPouSource& source : *sources)
                if (source.pou != nullptr)
                    pou_by_name_[fold_pou(source.pou->name)] = source.pou;
            for (const StPouSource& source : *sources)
                if (source.pou != nullptr)
                    pou_sources_[fold_pou(source.pou->name)] = &source;
        }
        if (options != nullptr) {
            program_identity_ = options->program_identity;
            for (const StPublishedSignalContract& signal : options->published_signals)
                signals_[fold_pou(signal.name)] = &signal;
        }
    }

    bool run(const std::string& source)
    {
        out_->program_name = prog_.name;
        /* Layout schema 1 chỉ có 64 bit cho source_hash. Dùng prefix SHA-256
         * deterministic; provenance authority đầy đủ 256 bit nằm ở manifest
         * ngoài artifact và được verifier đối chiếu trước stage. */
        out_->source_hash = compute_source_hash64(source);
        out_->compiler_version = st_ir::kCompilerVersion;
        /* Artifact Rev A phải tất định tuyệt đối: timestamp thuộc metadata DB/
         * audit, không được làm thay đổi executable bytes. Trường layout cũ
         * được giữ và khóa về 0 để không phá schema 1. */
        out_->build_timestamp = 0;

        if (!allocate_slots()) return false;
        if (!emit_body(prog_.body, &root_scope_)) return false;
        if (out_->code.size() + 1 > st_ir::kMaxInstructions)
            return fail(st_diag_code::kPouInstanceLayout,
                        "inline POU expands to " +
                            std::to_string(out_->code.size() + 1) +
                            " instructions, limit is " +
                            std::to_string(st_ir::kMaxInstructions),
                        prog_.line, prog_.column);
        emit(StOp::HALT, 0);
        if (!finalize_constants()) return false;
        build_retain_layout();
        if (linked_pous_ != nullptr)
            std::sort(linked_pous_->begin(), linked_pous_->end(),
                      [](const StLinkedPouInfo& lhs, const StLinkedPouInfo& rhs) {
                          return fold_pou(lhs.name) < fold_pou(rhs.name);
                      });
        return true;
    }

private:
    struct Scope;
    struct FbBinding {
        bool user = false;
        std::size_t builtin_index = 0;
        const StProgram* type_pou = nullptr;
        std::unique_ptr<Scope> scope;
        std::string path;
    };
    struct Scope {
        std::unordered_map<std::string, uint16_t> vars;
        std::unordered_map<std::string, std::unique_ptr<FbBinding>> fbs;
        /* Issue #800 — `VAR CONSTANT`: không có slot ghi được; mọi chỗ đọc
         * dùng thẳng slot hằng của giá trị đã gập. */
        std::unordered_map<std::string, StValue> consts;
    };

    const StProgram& prog_;
    StIrModule*      out_;
    StDiagnostic*    diag_;
    Scope            root_scope_;
    std::map<std::string, const StProgram*> pou_by_name_;
    std::map<std::string, const StPouSource*> pou_sources_;
    std::vector<StLinkedPouInfo>* linked_pous_ = nullptr;
    std::map<std::string, uint32_t> linked_instruction_counts_;
    std::map<std::string, const StPublishedSignalContract*> signals_;
    std::string program_identity_;
    uint16_t next_slot_ = 0;
    /* Slot tạm dùng cho kết quả trung gian của biểu thức. Cấp phát theo kiểu
     * ngăn xếp: tăng khi vào biểu thức con, trả lại khi xong, nên số slot tạm
     * bằng ĐỘ SÂU biểu thức chứ không phải số node — giữ slot_count nhỏ. */
    uint16_t temp_base_ = 0;
    uint16_t temp_top_ = 0;
    uint16_t temp_high_water_ = 0;
    /* Issue #799 — khung của lời gọi FUNCTION người dùng cấp theo NGĂN XẾP,
     * đặt sau vùng tạm. Hai lời gọi không lồng nhau dùng cùng vị trí slot:
     * FUNCTION thuần (`ST-POU-002`) không mang trạng thái qua lời gọi và mọi
     * biến khung được MOV lại mỗi lần gọi. Số slot của vùng này bằng mức nước
     * cao nhất (độ sâu lồng), không bằng tổng số lời gọi như bản inline cũ. */
    uint16_t frame_base_ = 0;
    uint16_t frame_top_ = 0;

    struct ConstKey { StValue v; uint16_t slot; };
    std::vector<ConstKey> consts_;
    static constexpr uint16_t kConstPlaceholderBase = 0xF000u;

    bool fail(const char* code, const std::string& msg, int line, int col)
    {
        diag_->severity = StSeverity::ERROR;
        diag_->code = code;
        diag_->message = msg;
        diag_->line = line;
        diag_->column = col;
        diag_->length = 1;
        return false;
    }

    StValue default_init(StType t)
    {
        switch (t) {
        case StType::BOOL: return StValue::make_bool(false);
        case StType::INT:  return StValue::make_int(0);
        case StType::DINT: return StValue::make_dint(0);
        case StType::UINT: return StValue::make_uint(0);
        case StType::REAL: return StValue::make_real(0.0f);
        case StType::TIME: return StValue::make_time(0);
        }
        return StValue::make_bool(false);
    }

    bool reserve_slots(uint32_t count, uint16_t* base, int line = 0, int column = 0)
    {
        const uint32_t end = static_cast<uint32_t>(next_slot_) + count;
        if (end > st_ir::kMaxVarSlots)
            return fail(st_diag_code::kPouInstanceLayout,
                        "inline POU needs " + std::to_string(end) +
                            " writable slots, limit is " +
                            std::to_string(st_ir::kMaxVarSlots),
                        line, column);
        *base = next_slot_;
        next_slot_ = static_cast<uint16_t>(end);
        return true;
    }

    bool allocate_variable(Scope* scope, const std::string& public_name,
                           const std::string& ir_name, StType type,
                           StStorage storage, int line = 0, int column = 0,
                           const StValue* init = nullptr)
    {
        uint16_t slot = 0;
        if (!reserve_slots(1, &slot, line, column)) return false;
        StIrVariable variable;
        variable.name = ir_name;
        variable.type = type;
        variable.storage = storage;
        variable.slot = slot;
        /* Issue #800 — giá trị khởi tạo khai báo (`x : REAL := 21.5;`) đi vào
         * trường `init` sẵn có của bảng biến: loader đã nạp nó ở cold start,
         * nên không cần đổi định dạng artifact. */
        variable.init = init != nullptr ? *init : default_init(type);
        scope->vars[public_name] = slot;
        out_->variables.push_back(std::move(variable));
        return true;
    }

    /* Khai báo một biến người dùng vào `scope`: hằng vào `consts`, còn lại
     * cấp slot kèm giá trị khởi tạo nếu có (Issue #800). */
    bool declare_var(Scope* scope, const StVarDecl& v, const std::string& ir_name,
                     StStorage storage)
    {
        if (v.constant) {
            scope->consts[v.name] = v.init_value;
            return true;
        }
        return allocate_variable(scope, v.name, ir_name, v.type, storage, v.line, v.column,
                                 v.has_init ? &v.init_value : nullptr);
    }

    /* Một slot trong khung FUNCTION đang mở (Issue #799). Không ghi
     * `StIrVariable`: nhiều lời gọi dùng chung slot này, loader cấm hai biến
     * cùng slot, và giá trị khung không có nghĩa ngoài lời gọi — giống vùng
     * tạm. `next_slot_` theo mức nước cao nhất để `var_slot_count` đúng. */
    bool allocate_frame_slot(Scope* scope, const std::string& public_name,
                             int line, int column)
    {
        const uint32_t end = static_cast<uint32_t>(frame_top_) + 1;
        if (end > st_ir::kMaxVarSlots)
            return fail(st_diag_code::kPouInstanceLayout,
                        "inline POU needs " + std::to_string(end) +
                            " writable slots, limit is " +
                            std::to_string(st_ir::kMaxVarSlots),
                        line, column);
        scope->vars[public_name] = frame_top_;
        frame_top_ = static_cast<uint16_t>(end);
        if (frame_top_ > next_slot_) next_slot_ = frame_top_;
        return true;
    }

    bool lookup_scope_var(const Scope& scope, const std::string& name,
                          uint16_t* slot) const
    {
        if (const auto exact = scope.vars.find(name); exact != scope.vars.end()) {
            *slot = exact->second;
            return true;
        }
        const std::string key = fold_pou(name);
        for (const auto& variable : scope.vars) {
            if (fold_pou(variable.first) != key) continue;
            *slot = variable.second;
            return true;
        }
        return false;
    }

    bool allocate_builtin_fb(const StFbDecl& decl, Scope* scope,
                             const std::string& ir_name, bool inherited_retain)
    {
        auto binding = std::make_unique<FbBinding>();
        binding->path = ir_name;
        binding->builtin_index = out_->fb_instances.size();
        StIrFbInstance instance;
        instance.name = ir_name;
        instance.fb_type = decl.fb_type;
        instance.retained = inherited_retain || decl.retained;
        instance.state_index = static_cast<uint16_t>(out_->fb_instances.size());
        if (!reserve_slots(static_cast<uint32_t>(st_fb_input_count(decl.fb_type)),
                           &instance.input_slot_base, decl.line, decl.column))
            return false;
        if (!reserve_slots(static_cast<uint32_t>(st_fb_output_count(decl.fb_type)),
                           &instance.output_slot_base, decl.line, decl.column))
            return false;
        out_->fb_instances.push_back(std::move(instance));
        scope->fbs[decl.name] = std::move(binding);
        return true;
    }

    bool allocate_user_fb(const StFbDecl& decl, Scope* parent,
                          const std::string& path, bool inherited_retain)
    {
        const auto found = pou_by_name_.find(fold_pou(decl.user_type_name));
        if (found == pou_by_name_.end())
            return fail(st_diag_code::kLibraryEntryMissing,
                        "function block '" + decl.user_type_name +
                            "' has no linked implementation",
                        decl.line, decl.column);
        if (found->second->kind != StPouKind::FUNCTION_BLOCK)
            return fail(st_diag_code::kPouSignatureInvalid,
                        "'" + decl.user_type_name + "' is not a FUNCTION_BLOCK",
                        decl.line, decl.column);

        auto binding = std::make_unique<FbBinding>();
        binding->user = true;
        binding->type_pou = found->second;
        binding->path = path;
        binding->scope = std::make_unique<Scope>();
        const bool retained = inherited_retain || decl.retained;
        for (const StVarDecl& variable : found->second->vars) {
            if (!declare_var(binding->scope.get(), variable, path + "." + variable.name,
                             retained ? StStorage::VAR_RETAIN : StStorage::VAR_LOCAL))
                return false;
        }
        for (const StFbDecl& nested : found->second->fbs) {
            const std::string nested_path = path + "." + nested.name;
            if (nested.is_user_type) {
                if (!allocate_user_fb(nested, binding->scope.get(), nested_path, retained))
                    return false;
            } else if (!allocate_builtin_fb(nested, binding->scope.get(), nested_path,
                                            retained)) {
                return false;
            }
        }
        parent->fbs[decl.name] = std::move(binding);
        return true;
    }

    bool allocate_slots()
    {
        /* Thứ tự cấp slot: biến khai báo -> cổng FB -> slot tạm -> hằng.
         * Thứ tự này cố định để artifact tất định. */
        for (const StVarDecl& v : prog_.vars) {
            if (!declare_var(&root_scope_, v, v.name, v.storage)) return false;
        }

        for (const StFbDecl& f : prog_.fbs) {
            if (f.is_user_type) {
                if (!allocate_user_fb(f, &root_scope_, f.name, false)) return false;
            } else if (!allocate_builtin_fb(f, &root_scope_, f.name, false)) {
                return false;
            }
        }

        /* Dự trữ slot tạm — số lượng bằng độ sâu biểu thức tối đa cho phép,
         * cộng biên cho các hàm 3 toán hạng. */
        temp_base_ = next_slot_;
        temp_top_ = temp_base_;
        uint16_t ignored = 0;
        if (!reserve_slots(st_limits::kMaxExprDepth + 8, &ignored)) return false;
        frame_base_ = next_slot_;
        frame_top_ = frame_base_;
        return true;
    }

    /* ---- Slot tạm ---- */

    uint16_t push_temp() { const uint16_t s = temp_top_++;
                           if (temp_top_ > temp_high_water_) temp_high_water_ = temp_top_;
                           return s; }
    void pop_temp(uint16_t n = 1) { temp_top_ = static_cast<uint16_t>(temp_top_ - n); }

    /* ---- Hằng ---- */

    uint16_t const_slot(const StValue& v)
    {
        for (const ConstKey& c : consts_)
            if (st_value_equal(c.v, v)) return c.slot;
        const uint16_t slot = static_cast<uint16_t>(kConstPlaceholderBase + consts_.size());
        consts_.push_back({v, slot});
        return slot;
    }

    bool finalize_constants()
    {
        out_->var_slot_count = next_slot_;
        for (StInstr& instruction : out_->code) {
            uint16_t* operands[] = {&instruction.a, &instruction.b, &instruction.c};
            for (uint16_t* operand : operands) {
                if (*operand < kConstPlaceholderBase) continue;
                const uint32_t index = *operand - kConstPlaceholderBase;
                if (index >= consts_.size())
                    return fail(st_diag_code::kPouInstanceLayout,
                                "invalid constant placeholder during POU link", 0, 0);
                *operand = static_cast<uint16_t>(out_->var_slot_count + index);
            }
        }
        for (const ConstKey& c : consts_) out_->constants.push_back(c.v);
        out_->slot_count = out_->var_slot_count + static_cast<uint32_t>(consts_.size());
        if (out_->slot_count > st_ir::kMaxSlots)
            return fail(st_diag_code::kTooManyVariables,
                        "slot count " + std::to_string(out_->slot_count) + " exceeds limit " +
                            std::to_string(st_ir::kMaxSlots),
                        0, 0);
        return true;
    }

    void build_retain_layout()
    {
        uint32_t offset = 0;
        /* Schema identity v1: identity ổn định là kind + tên khai báo + type,
         * còn offset/size khóa đúng byte layout. Không dùng slot vì thêm một
         * biến KHÔNG RETAIN trước đó không được làm mất RETAIN tương thích. */
        std::string sig = "MKDDC-RETAIN-LAYOUT:1;";
        for (const StIrVariable& v : out_->variables) {
            if (v.storage != StStorage::VAR_RETAIN) continue;
            StIrRetainEntry e;
            e.slot = v.slot;
            e.type = v.type;
            e.offset = offset;
            const uint32_t size = static_cast<uint32_t>(type_size(v.type));
            offset += size;
            out_->retain_entries.push_back(e);
            sig += "V:";
            sig += v.name;
            sig += ':';
            sig += st_type_name(v.type);
            sig += ':' + std::to_string(e.offset) + ':' + std::to_string(size);
            sig += ';';
        }
        /* Trạng thái FB retained nằm sau biến RETAIN, theo codec không phụ
         * thuộc sizeof/padding của StFbState. */
        for (const StIrFbInstance& f : out_->fb_instances) {
            if (!f.retained) continue;
            const uint32_t fb_offset = offset;
            const uint32_t size = static_cast<uint32_t>(st_fb_retain_state_size(f.fb_type));
            offset += size;
            sig += "F:";
            sig += f.name;
            sig += ':';
            sig += st_fb_type_name(f.fb_type);
            sig += ':' + std::to_string(fb_offset) + ':' + std::to_string(size);
            sig += ';';
        }
        out_->retain_record_size = offset;
        out_->retain_layout_hash =
            ~crc32(reinterpret_cast<const uint8_t*>(sig.data()), sig.size());
    }

    /* ---- Sinh mã ---- */

    uint8_t type_raw(StType t) const { return static_cast<uint8_t>(t); }

    uint32_t emit(StOp op, uint8_t traw, uint16_t dst = 0, uint16_t a = 0, uint16_t b = 0,
                  uint16_t c = 0, uint16_t aux = 0, uint32_t imm = 0)
    {
        StInstr in;
        in.op = op;
        in.type_raw = traw;
        in.type = traw ? static_cast<StType>(traw) : StType::BOOL;
        in.dst = dst; in.a = a; in.b = b; in.c = c; in.aux = aux; in.imm = imm;
        out_->code.push_back(in);
        return static_cast<uint32_t>(out_->code.size() - 1);
    }

    void note_source(uint32_t pc, int line, int col)
    {
        if (line <= 0) return;
        StIrSourceMap m;
        m.pc = pc;
        m.line = static_cast<uint16_t>(line);
        m.column = static_cast<uint16_t>(col);
        out_->source_map.push_back(m);
    }

    bool emit_body(const std::vector<StStmt>& stmts, Scope* scope)
    {
        for (const StStmt& s : stmts)
            if (!emit_stmt(s, scope)) return false;
        return true;
    }

    bool emit_stmt(const StStmt& s, Scope* scope)
    {
        switch (s.kind) {
        case StStmt::Kind::ASSIGN: {
            const auto target = scope->vars.find(s.assign_target);
            if (target == scope->vars.end())
                return fail(st_diag_code::kUnboundVariable,
                            "unbound assignment target during POU link: '" +
                                s.assign_target + "'",
                            s.assign_target_line, s.assign_target_column);
            const uint16_t dst = target->second;

            /* SIG_READ phải ghi thẳng vào biến đích. Với HOLD_PRIVATE,
             * executor có thể bỏ đúng lần ghi này khi stale; lower qua temp
             * rồi MOV sẽ vô tình ghi zero/giá trị cũ của temp vào biến. */
            if (s.assign_expr->kind == StExpr::Kind::SIGNAL_READ) {
                uint16_t ref = 0;
                if (!signal_ref(s.assign_expr->signal_name,
                                s.assign_expr->result_type, true, false, &ref,
                                s.assign_expr->line, s.assign_expr->column))
                    return false;
                const uint32_t pc = emit(StOp::SIGNAL_READ,
                                         type_raw(s.assign_expr->result_type),
                                         dst, 0, 0, 0, ref);
                note_source(pc, s.assign_expr->line, s.assign_expr->column);
                return true;
            }

            const uint16_t src = temp_top_;
            uint16_t result;
            if (!emit_expr(*s.assign_expr, scope, &result)) return false;
            temp_top_ = src;
            const uint32_t pc =
                emit(StOp::MOV, type_raw(s.assign_expr->result_type), dst, result);
            note_source(pc, s.assign_target_line, s.assign_target_column);
            return true;
        }
        case StStmt::Kind::IF: return emit_if(s, scope);
        case StStmt::Kind::FB_CALL: return emit_fb_call(s, scope);
        case StStmt::Kind::SIGNAL_PUBLISH: {
            const uint16_t save = temp_top_;
            uint16_t value = 0;
            if (!emit_expr(*s.signal_value, scope, &value)) return false;
            temp_top_ = save;
            uint16_t ref = 0;
            if (!signal_ref(s.signal_name, s.signal_value->result_type, false, true,
                            &ref, s.signal_line, s.signal_column))
                return false;
            const uint32_t pc = emit(StOp::SIGNAL_PUBLISH,
                                     type_raw(s.signal_value->result_type),
                                     0, value, 0, 0, ref);
            note_source(pc, s.signal_line, s.signal_column);
            return true;
        }
        }
        return true;
    }

    bool emit_if(const StStmt& s, Scope* scope)
    {
        /* Mỗi nhánh: đánh giá điều kiện, JMP_IF_FALSE tới nhánh kế, chạy
         * thân, rồi JMP tới cuối. Mọi nhảy đều TIẾN — bắt buộc theo SPEC §5.3
         * để mọi chương trình chấm dứt trong <= số lệnh. */
        std::vector<uint32_t> end_jumps;
        for (const StIfBranch& b : s.branches) {
            if (!b.cond) {
                if (!emit_body(b.body, scope)) return false;
                continue;
            }
            const uint16_t save = temp_top_;
            uint16_t cond_slot;
            if (!emit_expr(*b.cond, scope, &cond_slot)) return false;
            temp_top_ = save;
            const uint32_t jf = emit(StOp::JMP_IF_FALSE, type_raw(StType::BOOL), 0, cond_slot);
            note_source(jf, b.cond->line, b.cond->column);
            if (!emit_body(b.body, scope)) return false;
            end_jumps.push_back(emit(StOp::JMP, 0));
            out_->code[jf].imm = static_cast<uint32_t>(out_->code.size());
        }
        const uint32_t end = static_cast<uint32_t>(out_->code.size());
        for (uint32_t j : end_jumps) out_->code[j].imm = end;
        return true;
    }

    void note_linked(const StProgram& pou, uint32_t instruction_count)
    {
        const std::string key = fold_pou(pou.name);
        auto found = linked_instruction_counts_.find(key);
        if (found == linked_instruction_counts_.end() || found->second < instruction_count)
            linked_instruction_counts_[key] = instruction_count;
        if (linked_pous_ == nullptr) return;
        for (StLinkedPouInfo& info : *linked_pous_) {
            if (fold_pou(info.name) != key) continue;
            if (info.instruction_count < instruction_count)
                info.instruction_count = instruction_count;
            return;
        }
        StLinkedPouInfo info;
        info.name = pou.name;
        info.kind = pou.kind;
        for (const StVarDecl* input : pou.by_storage(StStorage::VAR_INPUT)) {
            info.input_names.push_back(input->name);
            info.input_types.push_back(input->type);
        }
        for (const StVarDecl* output : pou.by_storage(StStorage::VAR_OUTPUT)) {
            info.output_names.push_back(output->name);
            info.output_types.push_back(output->type);
        }
        info.has_return_type = pou.has_return_type;
        info.return_type = pou.return_type;
        if (const auto source = pou_sources_.find(key); source != pou_sources_.end()) {
            info.from_library = source->second->from_library;
            info.library_entry_id = source->second->library_entry_id;
            info.version = source->second->version;
            info.library_origin = source->second->library_origin;
        }
        info.instruction_count = instruction_count;
        linked_pous_->push_back(std::move(info));
    }

    bool emit_fb_call(const StStmt& s, Scope* caller_scope)
    {
        const auto found = caller_scope->fbs.find(s.fb_instance);
        if (found == caller_scope->fbs.end())
            return fail(st_diag_code::kUnboundVariable,
                        "unbound function block instance during POU link: '" +
                            s.fb_instance + "'",
                        s.fb_line, s.fb_column);
        FbBinding& binding = *found->second;
        if (binding.user) {
            for (const StFbArg& arg : s.fb_args) {
                uint16_t input_slot = 0;
                if (!lookup_scope_var(*binding.scope, arg.name, &input_slot))
                    return fail(st_diag_code::kBadFbParam,
                                "unknown input '" + arg.name + "' of " +
                                    binding.type_pou->name,
                                arg.line, arg.column);
                const uint16_t save = temp_top_;
                uint16_t value = 0;
                if (!emit_expr(*arg.value, caller_scope, &value)) return false;
                temp_top_ = save;
                StType input_type = StType::REAL;
                for (const StVarDecl* decl :
                     binding.type_pou->by_storage(StStorage::VAR_INPUT))
                    if (fold_pou(decl->name) == fold_pou(arg.name)) {
                        input_type = decl->type;
                        break;
                    }
                emit(StOp::MOV, type_raw(input_type), input_slot, value);
            }
            const uint32_t begin = static_cast<uint32_t>(out_->code.size());
            const std::size_t map_begin = out_->source_map.size();
            if (!emit_body(binding.type_pou->body, binding.scope.get())) return false;
            for (std::size_t index = map_begin; index < out_->source_map.size(); ++index) {
                out_->source_map[index].line = static_cast<uint16_t>(s.fb_line);
                out_->source_map[index].column = static_cast<uint16_t>(s.fb_column);
            }
            /* Thân rỗng hoặc chỉ có lệnh không sinh anchor vẫn cần một vị trí
             * cho call site. Chỉ thêm khi thân không tự sinh entry; thêm vô điều
             * kiện sau các entry của thân sẽ làm PC đi lùi/trùng và loader phải
             * từ chối artifact. */
            if (map_begin == out_->source_map.size() && out_->code.size() > begin)
                note_source(begin, s.fb_line, s.fb_column);
            note_linked(*binding.type_pou,
                        static_cast<uint32_t>(out_->code.size()) - begin);
            return true;
        }

        const std::size_t idx = binding.builtin_index;
        const StIrFbInstance& fi = out_->fb_instances[idx];
        /* Nạp từng tham số vào slot vào của instance. Tham số KHÔNG truyền
         * giữ nguyên giá trị lần gọi trước — đúng ngữ nghĩa IEC, và đạt được
         * miễn phí vì slot vào là bộ nhớ bền của instance. */
        for (const StFbArg& arg : s.fb_args) {
            int pi = -1;
            for (int i = 0; i < st_fb_input_count(fi.fb_type); i++) {
                const char* n = st_fb_input_name(fi.fb_type, i);
                if (n && arg.name == n) { pi = i; break; }
            }
            if (pi < 0) continue;   /* semantic đã chặn, phòng thủ */
            const uint16_t save = temp_top_;
            uint16_t v;
            if (!emit_expr(*arg.value, caller_scope, &v)) return false;
            temp_top_ = save;
            emit(StOp::MOV, type_raw(st_fb_input_type(fi.fb_type, pi)),
                 static_cast<uint16_t>(fi.input_slot_base + pi), v);
        }
        const uint32_t pc =
            emit(StOp::FB_CALL, 0, 0, 0, 0, 0, static_cast<uint16_t>(idx));
        note_source(pc, s.fb_line, s.fb_column);
        return true;
    }

    /* Trả về slot chứa kết quả. Có thể là slot biến/hằng (không tốn temp)
     * hoặc slot tạm mới cấp. */
    bool emit_user_function(const StExpr& expression, Scope* caller_scope,
                            uint16_t* out_slot)
    {
        const auto found = pou_by_name_.find(fold_pou(expression.user_call_name));
        if (found == pou_by_name_.end())
            return fail(st_diag_code::kLibraryEntryMissing,
                        "FUNCTION '" + expression.user_call_name +
                            "' has no linked implementation",
                        expression.line, expression.column);
        const StProgram& function = *found->second;
        if (function.kind != StPouKind::FUNCTION)
            return fail(st_diag_code::kPouSignatureInvalid,
                        "'" + function.name + "' is not a FUNCTION",
                        expression.line, expression.column);

        std::vector<uint16_t> arguments;
        arguments.reserve(expression.args.size());
        for (const auto& argument : expression.args) {
            uint16_t slot = 0;
            if (!emit_expr(*argument, caller_scope, &slot)) return false;
            arguments.push_back(slot);
        }

        /* Đẩy khung SAU khi mọi đối số đã được đánh giá vào slot của người
         * gọi: lời gọi lồng trong đối số đã đẩy/trả khung của nó xong. */
        Scope function_scope;
        const uint16_t frame_mark = frame_top_;
        if (!allocate_frame_slot(&function_scope, function.name,
                                 expression.line, expression.column))
            return false;
        const uint16_t return_slot = function_scope.vars.at(function.name);
        emit(StOp::MOV, type_raw(function.return_type), return_slot,
             const_slot(default_init(function.return_type)));

        std::size_t input_index = 0;
        for (const StVarDecl& variable : function.vars) {
            if (variable.constant) {
                function_scope.consts[variable.name] = variable.init_value;
                continue;
            }
            if (!allocate_frame_slot(&function_scope, variable.name,
                                     variable.line, variable.column))
                return false;
            const uint16_t destination = function_scope.vars.at(variable.name);
            if (variable.storage == StStorage::VAR_INPUT) {
                if (input_index >= arguments.size())
                    return fail(st_diag_code::kPouSignatureInvalid,
                                "missing argument while linking '" + function.name + "'",
                                expression.line, expression.column);
                emit(StOp::MOV, type_raw(variable.type), destination,
                     arguments[input_index++]);
            } else {
                emit(StOp::MOV, type_raw(variable.type), destination,
                     const_slot(variable.has_init ? variable.init_value
                                                  : default_init(variable.type)));
            }
        }
        if (input_index != arguments.size())
            return fail(st_diag_code::kPouSignatureInvalid,
                        "too many arguments while linking '" + function.name + "'",
                        expression.line, expression.column);

        const uint32_t begin = static_cast<uint32_t>(out_->code.size());
        const std::size_t map_begin = out_->source_map.size();
        if (!emit_body(function.body, &function_scope)) return false;
        for (std::size_t index = map_begin; index < out_->source_map.size(); ++index) {
            out_->source_map[index].line = static_cast<uint16_t>(expression.line);
            out_->source_map[index].column = static_cast<uint16_t>(expression.column);
        }
        /* Chép kết quả ra slot tạm của NGƯỜI GỌI rồi mới trả khung. Trả thẳng
         * `return_slot` như bản inline cũ sẽ sai ngay khi khung được dùng
         * chung: trong `f(f(x), f(y))`, `f(y)` đẩy khung ở đúng vị trí vừa trả
         * và ghi đè kết quả của `f(x)` trước khi lời gọi ngoài kịp đọc. */
        const uint16_t result = push_temp();
        emit(StOp::MOV, type_raw(function.return_type), result, return_slot);
        note_linked(function, static_cast<uint32_t>(out_->code.size()) - begin);
        frame_top_ = frame_mark;
        *out_slot = result;
        return true;
    }

    bool emit_expr(const StExpr& e, Scope* scope, uint16_t* out_slot)
    {
        switch (e.kind) {
        case StExpr::Kind::SIGNAL_READ: {
            uint16_t ref = 0;
            if (!signal_ref(e.signal_name, e.result_type, true, false, &ref,
                            e.line, e.column))
                return false;
            const uint16_t dst = push_temp();
            const uint32_t pc = emit(StOp::SIGNAL_READ, type_raw(e.result_type),
                                     dst, 0, 0, 0, ref);
            note_source(pc, e.line, e.column);
            *out_slot = dst;
            return true;
        }
        case StExpr::Kind::USER_CALL:
            return emit_user_function(e, scope, out_slot);

        case StExpr::Kind::LITERAL:
            *out_slot = const_slot(e.literal);
            return true;

        case StExpr::Kind::VAR:
            if (const auto found = scope->vars.find(e.var_name); found != scope->vars.end()) {
                *out_slot = found->second;
                return true;
            }
            if (const auto constant = scope->consts.find(e.var_name);
                constant != scope->consts.end()) {
                *out_slot = const_slot(constant->second);
                return true;
            }
            return fail(st_diag_code::kUnboundVariable,
                        "unbound variable during POU link: '" + e.var_name + "'",
                        e.line, e.column);

        case StExpr::Kind::MEMBER: {
            const auto found = scope->fbs.find(e.member_object);
            if (found == scope->fbs.end())
                return fail(st_diag_code::kUnboundVariable,
                            "unbound function block instance during member read: '" +
                                e.member_object + "'",
                            e.line, e.column);
            const FbBinding& binding = *found->second;
            if (binding.user) {
                uint16_t output_slot = 0;
                if (!lookup_scope_var(*binding.scope, e.member_field, &output_slot))
                    return fail(st_diag_code::kBadFbParam,
                                "unknown output '" + e.member_field + "' of " +
                                    binding.type_pou->name,
                                e.line, e.column);
                *out_slot = output_slot;
                return true;
            }
            const StIrFbInstance& fi = out_->fb_instances[binding.builtin_index];
            for (int i = 0; i < st_fb_output_count(fi.fb_type); i++) {
                const char* n = st_fb_output_name(fi.fb_type, i);
                if (n && e.member_field == n) {
                    *out_slot = static_cast<uint16_t>(fi.output_slot_base + i);
                    return true;
                }
            }
            return fail(st_diag_code::kBadFbParam, "unknown FB output", e.line, e.column);
        }

        case StExpr::Kind::UNOP: {
            uint16_t a;
            if (!emit_expr(*e.operand, scope, &a)) return false;
            const uint16_t dst = push_temp();
            const StOp op = (e.un_op == StUnOp::NOT) ? StOp::NOT : StOp::NEG;
            const uint32_t pc = emit(op, type_raw(e.result_type == StType::BOOL
                                                      ? StType::BOOL
                                                      : e.result_type),
                                     dst, a);
            note_source(pc, e.line, e.column);
            *out_slot = dst;
            return true;
        }

        case StExpr::Kind::BINOP: {
            uint16_t a, b;
            if (!emit_expr(*e.lhs, scope, &a)) return false;
            if (!emit_expr(*e.rhs, scope, &b)) return false;
            const uint16_t dst = push_temp();
            /* Issue #800 — TIME × số / TIME ÷ số: semantic đã chuẩn hoá TIME về
             * vế trái; kiểu của lệnh là kiểu của SỐ ở vế phải. */
            if ((e.bin_op == StBinOp::MUL || e.bin_op == StBinOp::DIV) &&
                e.lhs->result_type == StType::TIME) {
                const StOp op = e.bin_op == StBinOp::MUL ? StOp::TMUL : StOp::TDIV;
                const uint32_t pc = emit(op, type_raw(e.rhs->result_type), dst, a, b);
                note_source(pc, e.line, e.column);
                *out_slot = dst;
                return true;
            }
            /* Kiểu của lệnh là kiểu TOÁN HẠNG, không phải kiểu kết quả: so
             * sánh REAL trả BOOL nhưng phải so sánh theo REAL. */
            const uint8_t traw = type_raw(e.lhs->result_type);
            const uint32_t pc = emit(binop_code(e.bin_op), traw, dst, a, b);
            note_source(pc, e.line, e.column);
            *out_slot = dst;
            return true;
        }

        case StExpr::Kind::CALL: return emit_call(e, scope, out_slot);
        }
        return true;
    }

    bool signal_ref(const std::string& name, StType type, bool read, bool publish,
                    uint16_t* out_index, int line, int column)
    {
        const auto contract = signals_.find(fold_pou(name));
        if (contract == signals_.end() || contract->second->type != type)
            return fail(st_diag_code::kSignalTypeMismatch,
                        "signal contract changed between semantic and lowering: '" +
                            name + "'", line, column);
        if (publish && contract->second->producer_program != program_identity_)
            return fail(st_diag_code::kSignalDuplicatePublisher,
                        "Program is not the declared publisher of '" + name + "'",
                        line, column);
        for (std::size_t index = 0; index < out_->signal_refs.size(); ++index) {
            StIrSignalRef& ref = out_->signal_refs[index];
            if (fold_pou(ref.name) != fold_pou(contract->second->name)) continue;
            if (read && !ref.read) {
                ref.read_line = static_cast<uint16_t>(line);
                ref.read_column = static_cast<uint16_t>(column);
            }
            if (publish && !ref.publish) {
                ref.publish_line = static_cast<uint16_t>(line);
                ref.publish_column = static_cast<uint16_t>(column);
            }
            ref.read = ref.read || read;
            ref.publish = ref.publish || publish;
            *out_index = static_cast<uint16_t>(index);
            return true;
        }
        if (out_->signal_refs.size() >= st_profile_generated::kMaxSignals)
            return fail(st_diag_code::kPouInstanceLayout,
                        "signal reference count exceeds product profile", line, column);
        StIrSignalRef ref;
        ref.name = contract->second->name;
        ref.type = type;
        ref.read = read;
        ref.publish = publish;
        if (read) {
            ref.read_line = static_cast<uint16_t>(line);
            ref.read_column = static_cast<uint16_t>(column);
        }
        if (publish) {
            ref.publish_line = static_cast<uint16_t>(line);
            ref.publish_column = static_cast<uint16_t>(column);
        }
        out_->signal_refs.push_back(std::move(ref));
        *out_index = static_cast<uint16_t>(out_->signal_refs.size() - 1);
        return true;
    }

    static StOp binop_code(StBinOp op)
    {
        switch (op) {
        case StBinOp::ADD: return StOp::ADD;
        case StBinOp::SUB: return StOp::SUB;
        case StBinOp::MUL: return StOp::MUL;
        case StBinOp::DIV: return StOp::DIV;
        case StBinOp::MOD: return StOp::MOD;
        case StBinOp::LT:  return StOp::LT;
        case StBinOp::LE:  return StOp::LE;
        case StBinOp::GT:  return StOp::GT;
        case StBinOp::GE:  return StOp::GE;
        case StBinOp::EQ:  return StOp::EQ;
        case StBinOp::NE:  return StOp::NE;
        case StBinOp::AND: return StOp::AND;
        case StBinOp::OR:  return StOp::OR;
        case StBinOp::XOR: return StOp::XOR;
        }
        return StOp::NOP;
    }

    bool emit_call(const StExpr& e, Scope* scope, uint16_t* out_slot)
    {
        std::vector<uint16_t> argv;
        argv.reserve(e.args.size());
        for (const auto& a : e.args) {
            uint16_t s;
            if (!emit_expr(*a, scope, &s)) return false;
            argv.push_back(s);
        }
        const uint16_t dst = push_temp();
        uint32_t pc = 0;
        switch (e.func) {
        case StFunc::ABS:
            pc = emit(StOp::ABS, type_raw(e.result_type), dst, argv[0]); break;
        case StFunc::MIN:
            pc = emit(StOp::MIN, type_raw(e.result_type), dst, argv[0], argv[1]); break;
        case StFunc::MAX:
            pc = emit(StOp::MAX, type_raw(e.result_type), dst, argv[0], argv[1]); break;
        case StFunc::LIMIT:
            pc = emit(StOp::LIMIT, type_raw(e.result_type), dst, argv[0], argv[1], argv[2]); break;
        case StFunc::SEL:
            pc = emit(StOp::SEL, type_raw(e.result_type), dst, argv[0], argv[1], argv[2]); break;
        case StFunc::SQRT:
            pc = emit(StOp::SQRT, type_raw(StType::REAL), dst, argv[0]); break;
        case StFunc::SCALE: {
            /* §7A.6 — KHÔNG có opcode SCALE: một lệnh IR mang tối đa ba toán
             * hạng nguồn còn SCALE cần năm, và nới định dạng artifact để nhét
             * vừa một phép tính tuyến tính là đổi thứ đắt nhất lấy thứ rẻ nhất.
             * OUT = OUT_MIN + (IN - IN_MIN) * (OUT_MAX - OUT_MIN) / (IN_MAX - IN_MIN).
             * Chia cho 0 (IN_MAX == IN_MIN) rơi vào đúng `ST-RT-002` đã có. */
            const uint8_t real = type_raw(StType::REAL);
            const uint16_t span_in = push_temp();
            emit(StOp::SUB, real, span_in, argv[0], argv[1]);
            const uint16_t span_out = push_temp();
            emit(StOp::SUB, real, span_out, argv[4], argv[3]);
            const uint16_t scaled = push_temp();
            emit(StOp::MUL, real, scaled, span_in, span_out);
            const uint16_t divisor = push_temp();
            emit(StOp::SUB, real, divisor, argv[2], argv[1]);
            const uint16_t ratio = push_temp();
            emit(StOp::DIV, real, ratio, scaled, divisor);
            pc = emit(StOp::ADD, real, dst, argv[3], ratio);
            pop_temp(5);
            break;
        }
        case StFunc::DEADBAND: {
            /* OUT = SEL(ABS(IN - REF) > DB, REF, IN). Trong dải trả REF chứ
             * KHÔNG trả giá trị cũ: trả giá trị cũ là hành vi có trạng thái và
             * sẽ biến một hàm thuần thành FB (dùng HYSTERESIS khi cần điều đó). */
            const uint8_t real = type_raw(StType::REAL);
            const uint16_t delta = push_temp();
            emit(StOp::SUB, real, delta, argv[0], argv[2]);
            const uint16_t magnitude = push_temp();
            emit(StOp::ABS, real, magnitude, delta);
            const uint16_t outside = push_temp();
            emit(StOp::GT, real, outside, magnitude, argv[1]);
            pc = emit(StOp::SEL, real, dst, outside, argv[2], argv[0]);
            pop_temp(3);
            break;
        }
        case StFunc::INT_TO_REAL:
            pc = emit(StOp::CVT_I2R, 0, dst, argv[0]); break;
        case StFunc::REAL_TO_INT:
            pc = emit(StOp::CVT_R2I, 0, dst, argv[0]); break;
        case StFunc::TIME_TO_REAL:
            pc = emit(StOp::CVT_T2R, 0, dst, argv[0]); break;
        case StFunc::REAL_TO_TIME:
            pc = emit(StOp::CVT_R2T, 0, dst, argv[0]); break;
        case StFunc::INT_TO_DINT:
            pc = emit(StOp::CVT_I2D, 0, dst, argv[0]); break;
        case StFunc::INT_TO_UINT:
            pc = emit(StOp::CVT_I2U, 0, dst, argv[0]); break;
        case StFunc::DINT_TO_INT:
            pc = emit(StOp::CVT_D2I, 0, dst, argv[0]); break;
        case StFunc::DINT_TO_UINT:
            pc = emit(StOp::CVT_D2U, 0, dst, argv[0]); break;
        case StFunc::UINT_TO_INT:
            pc = emit(StOp::CVT_U2I, 0, dst, argv[0]); break;
        case StFunc::UINT_TO_DINT:
            pc = emit(StOp::CVT_U2D, 0, dst, argv[0]); break;
        case StFunc::DINT_TO_REAL:
            pc = emit(StOp::CVT_D2R, 0, dst, argv[0]); break;
        case StFunc::UINT_TO_REAL:
            pc = emit(StOp::CVT_U2R, 0, dst, argv[0]); break;
        case StFunc::REAL_TO_DINT:
            pc = emit(StOp::CVT_R2D, 0, dst, argv[0]); break;
        case StFunc::REAL_TO_UINT:
            pc = emit(StOp::CVT_R2U, 0, dst, argv[0]); break;
        case StFunc::SHL:
            pc = emit(StOp::SHL, type_raw(StType::UINT), dst, argv[0], argv[1]); break;
        case StFunc::SHR:
            pc = emit(StOp::SHR, type_raw(StType::UINT), dst, argv[0], argv[1]); break;
        }
        note_source(pc, e.line, e.column);
        *out_slot = dst;
        return true;
    }
};

} // namespace

bool compile_st_to_ir(const StProgram& prog, const std::string& source, StIrModule* out,
                      StDiagnostic* diag)
{
    StDiagnostic local;
    *out = StIrModule{};
    Compiler c(prog, out, diag ? diag : &local);
    return c.run(source);
}

bool compile_st_to_ir_linked(const StProgram& program, const std::string& bundle_source,
                             const std::vector<StPouSource>& sources,
                             const StPouRegistryResult& registry, StIrModule* out,
                             std::vector<StLinkedPouInfo>* linked_pous,
                             StDiagnostic* diag, const StCompileOptions& options)
{
    (void)registry; /* AST đã được typecheck bằng chính registry trước lowering. */
    if (program.kind != StPouKind::PROGRAM) {
        StDiagnostic local;
        StDiagnostic* target = diag ? diag : &local;
        target->severity = StSeverity::ERROR;
        target->code = st_diag_code::kPouSignatureInvalid;
        target->message = std::string("linked artifact root must be PROGRAM, got ") +
                          st_pou_kind_name(program.kind);
        target->line = program.line;
        target->column = program.column;
        target->length = program.length;
        return false;
    }
    StDiagnostic local;
    *out = StIrModule{};
    if (linked_pous != nullptr) linked_pous->clear();
    Compiler compiler(program, out, diag ? diag : &local, &sources, linked_pous,
                      &options);
    return compiler.run(bundle_source);
}

bool parse_st_pou_text_source(const StPouTextSource& source, StProgram* out,
                              std::string* canonical_source, StDiagnostic* diag)
{
    return parse_st_pou_text_source(source, out, canonical_source, diag, nullptr);
}

bool parse_st_pou_text_source(const StPouTextSource& source, StProgram* out,
                              std::string* canonical_source, StDiagnostic* diag,
                              StDiagnosticBag* bag)
{
    if (out == nullptr || canonical_source == nullptr) return false;
    StDiagnostic local;
    StDiagnostic* target = diag ? diag : &local;
    if (source.language == StPouTextSource::Language::ST) {
        if (!parse_st_pou(source.source, out, target, bag)) return false;
        *canonical_source = source.source;
        if (!source.pou_name.empty() && source.pou_name != out->name) {
            target->severity = StSeverity::ERROR;
            target->code = st_diag_code::kPouSignatureInvalid;
            target->message = "POU name '" + out->name +
                              "' does not match manifest name '" +
                              source.pou_name + "'";
            target->line = out->line;
            target->column = out->column;
            target->length = out->length;
            return false;
        }
        if (!source.pou_name.empty() && source.declared_kind != out->kind) {
            target->severity = StSeverity::ERROR;
            target->code = st_diag_code::kPouSignatureInvalid;
            target->message = "POU kind does not match manifest for '" + out->name + "'";
            target->line = out->line;
            target->column = out->column;
            target->length = out->length;
            return false;
        }
        return true;
    }

    FbdLowerResult lowered = lower_fbd_source_to_program(source.source);
    if (!lowered.ok) {
        target->severity = StSeverity::ERROR;
        target->code = lowered.issues.empty() ? "FBD-SEM-LOWER-001"
                                               : lowered.issues.front().code;
        target->message = lowered.issues.empty() ? "FBD POU lower failed"
                                                  : lowered.issues.front().path;
        target->line = 0;
        target->column = 0;
        target->length = 1;
        return false;
    }
    *out = std::move(lowered.program);
    *canonical_source = std::move(lowered.canonical_source);
    if (!source.pou_name.empty() && source.pou_name != out->name) {
        target->severity = StSeverity::ERROR;
        target->code = st_diag_code::kPouSignatureInvalid;
        target->message = "FBD graph name '" + out->name +
                          "' does not match manifest name '" + source.pou_name + "'";
        target->line = 0;
        target->column = 0;
        target->length = 1;
        return false;
    }
    out->kind = source.declared_kind;
    if (out->kind == StPouKind::FUNCTION) {
        const std::vector<const StVarDecl*> outputs =
            out->by_storage(StStorage::VAR_OUTPUT);
        if (outputs.size() != 1) {
            target->severity = StSeverity::ERROR;
            target->code = st_diag_code::kPouSignatureInvalid;
            target->message = "FBD FUNCTION '" + out->name +
                              "' must declare exactly one OUTPUT";
            target->line = 0;
            target->column = 0;
            target->length = 1;
            return false;
        }
        const std::string output_name = outputs.front()->name;
        out->has_return_type = true;
        out->return_type = outputs.front()->type;
        out->vars.erase(std::remove_if(out->vars.begin(), out->vars.end(),
                                      [&](const StVarDecl& variable) {
                                          return variable.storage == StStorage::VAR_OUTPUT;
                                      }),
                        out->vars.end());
        rewrite_function_result_body(&out->body, output_name, out->name);
    } else {
        out->has_return_type = false;
    }
    return true;
}

bool compile_st_pou_bundle(const std::vector<StPouTextSource>& text_sources,
                           const std::vector<StLibraryEntry>& library,
                           StPouBundleCompileResult* out, StDiagnostic* diag,
                           const StCompileOptions& options)
{
    return compile_st_pou_bundle(text_sources, library, out, diag, options, nullptr);
}

bool compile_st_pou_bundle(const std::vector<StPouTextSource>& text_sources,
                           const std::vector<StLibraryEntry>& library,
                           StPouBundleCompileResult* out, StDiagnostic* diag,
                           const StCompileOptions& options, StDiagnosticBag* bag)
{
    if (out == nullptr) return false;
    *out = StPouBundleCompileResult{};
    StDiagnostic local;
    StDiagnostic* target = diag ? diag : &local;
    if (text_sources.empty()) {
        target->severity = StSeverity::ERROR;
        target->code = st_diag_code::kPouSignatureInvalid;
        target->message = "POU bundle is empty";
        target->line = 0;
        target->column = 0;
        target->length = 1;
        return false;
    }

    std::vector<std::unique_ptr<StProgram>> owned;
    std::vector<std::string> canonical_sources;
    owned.reserve(text_sources.size());
    std::vector<StPouSource> sources;
    sources.reserve(text_sources.size());
    /* Pha parse chạy hết MỌI POU trước khi dừng: hai POU hỏng độc lập thì
     * người dùng phải thấy cả hai trong một vòng Kiểm tra. Chỉ khi pha này
     * sạch mới đi tiếp — registry/typecheck trên AST thiếu câu lệnh sẽ sinh
     * lỗi giả, đúng thứ tiêu chí chấp nhận của ISS-STED-01 cấm. */
    bool parse_ok = true;
    StDiagnostic first_parse_error;
    for (const StPouTextSource& text_source : text_sources) {
        auto pou = std::make_unique<StProgram>();
        std::string canonical;
        if (!parse_st_pou_text_source(text_source, pou.get(), &canonical, target, bag)) {
            if (bag == nullptr) return false;
            if (parse_ok) { first_parse_error = *target; parse_ok = false; }
            continue;
        }
        if (text_source.from_library && pou->kind == StPouKind::PROGRAM) {
            target->severity = StSeverity::ERROR;
            target->code = st_diag_code::kPouSignatureInvalid;
            target->message = "library-backed POU '" + pou->name +
                              "' cannot be a PROGRAM root";
            target->line = pou->line;
            target->column = pou->column;
            target->length = pou->length;
            return false;
        }
        sources.push_back({pou.get(), text_source.requires_library,
                           text_source.from_library,
                           text_source.library_entry_id, text_source.version,
                           text_source.library_origin});
        owned.push_back(std::move(pou));
        canonical_sources.push_back(std::move(canonical));
    }
    if (!parse_ok) { *target = first_parse_error; return false; }

    if (!st_build_pou_registry(sources, library, &out->registry, target)) {
        if (bag != nullptr) bag->add(*target);
        return false;
    }
    if (!typecheck_st_pou_set(sources, out->registry, target,
                              options.published_signals,
                              options.program_identity, bag)) return false;
    if (options.enforce_review_gate) {
        for (const auto& pou : owned)
            if (!st_review_gate_check(*pou, target)) return false;
    }
    StFbLayoutResult fb_layout;
    if (!st_plan_fb_instance_layout(sources, library, &fb_layout, target)) return false;

    std::vector<std::size_t> canonical_order(text_sources.size());
    for (std::size_t index = 0; index < canonical_order.size(); ++index)
        canonical_order[index] = index;
    std::sort(canonical_order.begin(), canonical_order.end(),
              [&](std::size_t lhs, std::size_t rhs) {
                  return fold_pou(owned[lhs]->name) < fold_pou(owned[rhs]->name);
              });
    std::string bundle_source = "MKDDC-POU-BUNDLE:1\n";
    for (std::size_t index : canonical_order) {
        bundle_source += owned[index]->name + ":" +
                         std::to_string(canonical_sources[index].size()) + "\n";
        bundle_source += canonical_sources[index];
        bundle_source.push_back('\n');
    }

    for (std::size_t index : canonical_order) {
        if (owned[index]->kind != StPouKind::PROGRAM) continue;
        StLinkedProgram linked;
        linked.source_id = text_sources[index].source_id;
        if (!compile_st_to_ir_linked(*owned[index], bundle_source, sources, out->registry,
                                     &linked.module, &linked.linked_pous, target, options))
            return false;
        for (StLinkedPouInfo& info : linked.linked_pous) {
            for (std::size_t dependency = 0; dependency < owned.size(); ++dependency) {
                if (fold_pou(owned[dependency]->name) != fold_pou(info.name)) continue;
                crypto_hash_sha256(info.body_sha256.data(),
                                   reinterpret_cast<const unsigned char*>(
                                       canonical_sources[dependency].data()),
                                   canonical_sources[dependency].size());
                crypto_hash_sha256(info.content_sha256.data(),
                                   reinterpret_cast<const unsigned char*>(
                                       text_sources[dependency].source.data()),
                                   text_sources[dependency].source.size());
                break;
            }
        }
        out->programs.push_back(std::move(linked));
    }
    if (out->programs.empty()) {
        target->severity = StSeverity::ERROR;
        target->code = st_diag_code::kPouSignatureInvalid;
        target->message = "POU bundle has no PROGRAM root";
        target->line = 0;
        target->column = 0;
        target->length = 1;
        return false;
    }
    return true;
}

/* Nhánh chưa phục hồi được (review gate, lowering, registry): chỉ có ĐÚNG MỘT
 * diagnostic, nhưng nó vẫn phải vào túi — không thì CLI thấy túi rỗng và phát
 * ra một mảng rỗng cho một lần Check thất bại. */
static bool add_and_fail(StDiagnosticBag* bag, const StDiagnostic* diag)
{
    if (bag != nullptr && diag != nullptr) bag->add(*diag);
    return false;
}

bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag)
{
    return compile_st_source(source, out, diag, StCompileOptions{});
}

bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag,
                       const StCompileOptions& options)
{
    return compile_st_source(source, out, diag, options, nullptr);
}

bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag,
                       const StCompileOptions& options, StDiagnosticBag* bag)
{
    /* Pha sau chỉ chạy khi pha trước SẠCH. Typecheck trên AST thiếu câu lệnh,
     * hay lowering trên AST chưa chốt kiểu, đều sinh diagnostic không tương
     * ứng lỗi thật của người dùng (ISS-STED-01, tiêu chí "không sinh
     * diagnostic giả"). */
    StProgram prog;
    if (!parse_st_program(source, &prog, diag, bag)) return false;
    if (options.published_signals.empty() && options.program_identity.empty()) {
        if (!typecheck_st_program(&prog, diag, bag)) return false;
        if (options.enforce_review_gate && !st_review_gate_check(prog, diag))
            return add_and_fail(bag, diag);
        if (!compile_st_to_ir(prog, source, out, diag)) return add_and_fail(bag, diag);
        return true;
    }
    std::vector<StPouSource> sources{{&prog, {}}};
    StPouRegistryResult registry;
    if (!st_build_pou_registry(sources, {}, &registry, diag)) return add_and_fail(bag, diag);
    if (!typecheck_st_pou_set(sources, registry, diag, options.published_signals,
                              options.program_identity, bag))
        return false;
    if (options.enforce_review_gate && !st_review_gate_check(prog, diag))
        return add_and_fail(bag, diag);
    if (!compile_st_to_ir_linked(prog, source, sources, registry, out, nullptr,
                                 diag, options))
        return add_and_fail(bag, diag);
    return true;
}

} // namespace core
