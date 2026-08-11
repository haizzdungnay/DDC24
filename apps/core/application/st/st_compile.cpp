#include "st/st_compile.hpp"

#include <unordered_map>

#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

uint64_t fnv1a64(const std::string& s)
{
    uint64_t h = 0xcbf29ce484222325ull;
    for (unsigned char c : s) { h ^= c; h *= 0x100000001b3ull; }
    return h;
}

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

class Compiler {
public:
    Compiler(const StProgram& prog, StIrModule* out, StDiagnostic* diag)
        : prog_(prog), out_(out), diag_(diag) {}

    bool run(const std::string& source)
    {
        out_->program_name = prog_.name;
        out_->source_hash = fnv1a64(source);
        out_->compiler_version = st_ir::kCompilerVersion;
        /* Artifact Rev A phải tất định tuyệt đối: timestamp thuộc metadata DB/
         * audit, không được làm thay đổi executable bytes. Trường layout cũ
         * được giữ và khóa về 0 để không phá schema 1. */
        out_->build_timestamp = 0;

        if (!allocate_slots()) return false;
        if (!emit_body(prog_.body)) return false;
        emit(StOp::HALT, 0);
        if (!finalize_constants()) return false;
        build_retain_layout();
        return true;
    }

private:
    const StProgram& prog_;
    StIrModule*      out_;
    StDiagnostic*    diag_;

    std::unordered_map<std::string, uint16_t> var_slot_;
    std::unordered_map<std::string, std::size_t> fb_index_;
    uint16_t next_slot_ = 0;
    /* Slot tạm dùng cho kết quả trung gian của biểu thức. Cấp phát theo kiểu
     * ngăn xếp: tăng khi vào biểu thức con, trả lại khi xong, nên số slot tạm
     * bằng ĐỘ SÂU biểu thức chứ không phải số node — giữ slot_count nhỏ. */
    uint16_t temp_base_ = 0;
    uint16_t temp_top_ = 0;
    uint16_t temp_high_water_ = 0;

    struct ConstKey { StValue v; uint16_t slot; };
    std::vector<ConstKey> consts_;

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

    bool allocate_slots()
    {
        /* Thứ tự cấp slot: biến khai báo -> cổng FB -> slot tạm -> hằng.
         * Thứ tự này cố định để artifact tất định. */
        for (const StVarDecl& v : prog_.vars) {
            StIrVariable iv;
            iv.name = v.name;
            iv.type = v.type;
            iv.storage = v.storage;
            iv.slot = next_slot_++;
            iv.init = default_init(v.type);
            var_slot_[v.name] = iv.slot;
            out_->variables.push_back(std::move(iv));
        }

        for (const StFbDecl& f : prog_.fbs) {
            StIrFbInstance fi;
            fi.name = f.name;
            fi.fb_type = f.fb_type;
            fi.retained = f.retained;
            fi.state_index = static_cast<uint16_t>(out_->fb_instances.size());
            fi.input_slot_base = next_slot_;
            next_slot_ = static_cast<uint16_t>(next_slot_ + st_fb_input_count(f.fb_type));
            fi.output_slot_base = next_slot_;
            next_slot_ = static_cast<uint16_t>(next_slot_ + st_fb_output_count(f.fb_type));
            fb_index_[f.name] = out_->fb_instances.size();
            out_->fb_instances.push_back(std::move(fi));
        }

        /* Dự trữ slot tạm — số lượng bằng độ sâu biểu thức tối đa cho phép,
         * cộng biên cho các hàm 3 toán hạng. */
        temp_base_ = next_slot_;
        temp_top_ = temp_base_;
        next_slot_ = static_cast<uint16_t>(next_slot_ + st_limits::kMaxExprDepth + 8);

        if (next_slot_ > st_ir::kMaxVarSlots)
            return fail(st_diag_code::kTooManyVariables,
                        "program needs " + std::to_string(next_slot_) +
                            " writable slots, limit is " + std::to_string(st_ir::kMaxVarSlots),
                        0, 0);
        out_->var_slot_count = next_slot_;
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
        const uint16_t slot = static_cast<uint16_t>(out_->var_slot_count + consts_.size());
        consts_.push_back({v, slot});
        return slot;
    }

    bool finalize_constants()
    {
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
        std::string sig;
        for (const StIrVariable& v : out_->variables) {
            if (v.storage != StStorage::VAR_RETAIN) continue;
            StIrRetainEntry e;
            e.slot = v.slot;
            e.type = v.type;
            e.offset = offset;
            offset += static_cast<uint32_t>(type_size(v.type));
            out_->retain_entries.push_back(e);
            sig += v.name;
            sig += ':';
            sig += st_type_name(v.type);
            sig += ';';
        }
        /* Trạng thái FB retained cũng nằm trong bản ghi retain. */
        for (const StIrFbInstance& f : out_->fb_instances) {
            if (!f.retained) continue;
            sig += f.name;
            sig += ':';
            sig += st_fb_type_name(f.fb_type);
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

    bool emit_body(const std::vector<StStmt>& stmts)
    {
        for (const StStmt& s : stmts)
            if (!emit_stmt(s)) return false;
        return true;
    }

    bool emit_stmt(const StStmt& s)
    {
        switch (s.kind) {
        case StStmt::Kind::ASSIGN: {
            const uint16_t src = temp_top_;
            uint16_t result;
            if (!emit_expr(*s.assign_expr, &result)) return false;
            temp_top_ = src;
            const uint16_t dst = var_slot_.at(s.assign_target);
            const uint32_t pc =
                emit(StOp::MOV, type_raw(s.assign_expr->result_type), dst, result);
            note_source(pc, s.assign_target_line, s.assign_target_column);
            return true;
        }
        case StStmt::Kind::IF: return emit_if(s);
        case StStmt::Kind::FB_CALL: return emit_fb_call(s);
        }
        return true;
    }

    bool emit_if(const StStmt& s)
    {
        /* Mỗi nhánh: đánh giá điều kiện, JMP_IF_FALSE tới nhánh kế, chạy
         * thân, rồi JMP tới cuối. Mọi nhảy đều TIẾN — bắt buộc theo SPEC §5.3
         * để mọi chương trình chấm dứt trong <= số lệnh. */
        std::vector<uint32_t> end_jumps;
        for (const StIfBranch& b : s.branches) {
            if (!b.cond) {
                if (!emit_body(b.body)) return false;
                continue;
            }
            const uint16_t save = temp_top_;
            uint16_t cond_slot;
            if (!emit_expr(*b.cond, &cond_slot)) return false;
            temp_top_ = save;
            const uint32_t jf = emit(StOp::JMP_IF_FALSE, type_raw(StType::BOOL), 0, cond_slot);
            note_source(jf, b.cond->line, b.cond->column);
            if (!emit_body(b.body)) return false;
            end_jumps.push_back(emit(StOp::JMP, 0));
            out_->code[jf].imm = static_cast<uint32_t>(out_->code.size());
        }
        const uint32_t end = static_cast<uint32_t>(out_->code.size());
        for (uint32_t j : end_jumps) out_->code[j].imm = end;
        return true;
    }

    bool emit_fb_call(const StStmt& s)
    {
        const std::size_t idx = fb_index_.at(s.fb_instance);
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
            if (!emit_expr(*arg.value, &v)) return false;
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
    bool emit_expr(const StExpr& e, uint16_t* out_slot)
    {
        switch (e.kind) {
        case StExpr::Kind::LITERAL:
            *out_slot = const_slot(e.literal);
            return true;

        case StExpr::Kind::VAR:
            *out_slot = var_slot_.at(e.var_name);
            return true;

        case StExpr::Kind::MEMBER: {
            const StIrFbInstance& fi = out_->fb_instances[fb_index_.at(e.member_object)];
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
            if (!emit_expr(*e.operand, &a)) return false;
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
            if (!emit_expr(*e.lhs, &a)) return false;
            if (!emit_expr(*e.rhs, &b)) return false;
            const uint16_t dst = push_temp();
            /* Kiểu của lệnh là kiểu TOÁN HẠNG, không phải kiểu kết quả: so
             * sánh REAL trả BOOL nhưng phải so sánh theo REAL. */
            const uint8_t traw = type_raw(e.lhs->result_type);
            const uint32_t pc = emit(binop_code(e.bin_op), traw, dst, a, b);
            note_source(pc, e.line, e.column);
            *out_slot = dst;
            return true;
        }

        case StExpr::Kind::CALL: return emit_call(e, out_slot);
        }
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

    bool emit_call(const StExpr& e, uint16_t* out_slot)
    {
        std::vector<uint16_t> argv;
        argv.reserve(e.args.size());
        for (const auto& a : e.args) {
            uint16_t s;
            if (!emit_expr(*a, &s)) return false;
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

bool compile_st_source(const std::string& source, StIrModule* out, StDiagnostic* diag)
{
    StProgram prog;
    if (!parse_st_program(source, &prog, diag)) return false;
    if (!typecheck_st_program(&prog, diag)) return false;
    return compile_st_to_ir(prog, source, out, diag);
}

} // namespace core
