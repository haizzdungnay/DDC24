#include "st/st_program.hpp"

#include <cmath>
#include <cstring>

namespace core {

const char* st_type_name(StType t)
{
    switch (t) {
    case StType::BOOL: return "BOOL";
    case StType::DINT: return "DINT";
    case StType::INT:  return "INT";
    case StType::UINT: return "UINT";
    case StType::REAL: return "REAL";
    case StType::TIME: return "TIME";
    }
    return "?";
}

bool st_type_is_integer(StType t)
{
    return t == StType::INT || t == StType::DINT || t == StType::UINT;
}

bool st_type_is_signed_integer(StType t)
{
    return t == StType::INT || t == StType::DINT;
}

int64_t st_integer_min(StType t)
{
    switch (t) {
    case StType::INT: return INT16_MIN;
    case StType::DINT: return INT32_MIN;
    case StType::UINT: return 0;
    default: return 0;
    }
}

int64_t st_integer_max(StType t)
{
    switch (t) {
    case StType::INT: return INT16_MAX;
    case StType::DINT: return INT32_MAX;
    case StType::UINT: return UINT16_MAX;
    default: return 0;
    }
}

bool st_value_equal(const StValue& a, const StValue& b)
{
    if (a.type != b.type) return false;
    switch (a.type) {
    case StType::BOOL: return a.b == b.b;
    case StType::DINT:
    case StType::INT:  return a.i == b.i;
    case StType::UINT: return a.i == b.i;
    /* So sánh bit cho REAL: dùng cho gộp hằng số trong constant pool, nơi ta
     * cần "cùng biểu diễn" chứ không phải "bằng nhau về số học". +0.0 và -0.0
     * là hai hằng khác nhau ở đây, và điều đó đúng ý đồ. */
    case StType::REAL: return std::memcmp(&a.r, &b.r, sizeof(float)) == 0;
    case StType::TIME: return a.t == b.t;
    }
    return false;
}

/* ---- Function Block ---- */

namespace {

struct FbPort { const char* name; StType type; };

/* Bố trí cổng theo TYPED_IR_ARTIFACT_SPEC §4.5. Compiler và loader đều đọc
 * từ đây — không ai được hard-code lại thứ tự. */
const FbPort kTonIn[]  = {{"IN", StType::BOOL}, {"PT", StType::TIME}};
const FbPort kTonOut[] = {{"Q", StType::BOOL},  {"ET", StType::TIME}};
const FbPort kTrigIn[]  = {{"CLK", StType::BOOL}};
const FbPort kTrigOut[] = {{"Q", StType::BOOL}};
/* PID vòng đơn (TASK-PROG-303, DDD-CTRL-PROG-001 §7). ACTUAL là read-back
 * của output thực sự đang được áp (qua Point Table AO/DO đã publish priority
 * 5, hoặc override cao hơn) — chương trình phải wire binding riêng, FB không
 * tự đọc PriorityResolver để giữ nguyên bất biến "process image chỉ nạp một
 * lần đầu cycle". Dùng để phát hiện override và freeze integrator. */
const FbPort kPidIn[] = {
    {"SP", StType::REAL}, {"PV", StType::REAL},
    {"KP", StType::REAL}, {"KI", StType::REAL}, {"KD", StType::REAL},
    {"OUT_MIN", StType::REAL}, {"OUT_MAX", StType::REAL},
    {"ACTUAL", StType::REAL},
};
const FbPort kPidOut[] = {{"OUT", StType::REAL}, {"TRACKING", StType::BOOL}};
/* `TP`/`CTU`/`CTD` — DDD-CTRL-PROG-001 §7A.1. `TP` dùng chung hình dạng cổng
 * với `TON` nhưng KHÔNG dùng chung state (nó cần thêm sườn của IN), nên bảng
 * riêng để không ai đọc nhầm thành "y hệt TON". */
const FbPort kTpIn[]  = {{"IN", StType::BOOL}, {"PT", StType::TIME}};
const FbPort kTpOut[] = {{"Q", StType::BOOL},  {"ET", StType::TIME}};
const FbPort kCtuIn[]  = {{"CU", StType::BOOL}, {"RESET", StType::BOOL}, {"PV", StType::INT}};
const FbPort kCtdIn[]  = {{"CD", StType::BOOL}, {"LOAD", StType::BOOL}, {"PV", StType::INT}};
const FbPort kCtOut[]  = {{"Q", StType::BOOL},  {"CV", StType::INT}};
/* HYSTERESIS (§7A.7) — so sánh CÓ NHỚ: trong dải giữa LOW..HIGH thì giữ nguyên
 * chu kỳ trước, nên nó là FB chứ không phải hàm thuần. */
const FbPort kHystIn[]  = {{"IN", StType::REAL}, {"HIGH", StType::REAL}, {"LOW", StType::REAL}};
const FbPort kHystOut[] = {{"Q", StType::BOOL}};

struct FbSpec {
    const FbPort* in;  int n_in;
    const FbPort* out; int n_out;
};

FbSpec fb_spec(StFbType t)
{
    switch (t) {
    case StFbType::TON:
    case StFbType::TOF:
        return {kTonIn, 2, kTonOut, 2};
    case StFbType::R_TRIG:
    case StFbType::F_TRIG:
        return {kTrigIn, 1, kTrigOut, 1};
    case StFbType::PID:
        return {kPidIn, 8, kPidOut, 2};
    case StFbType::TP:
        return {kTpIn, 2, kTpOut, 2};
    case StFbType::CTU:
        return {kCtuIn, 3, kCtOut, 2};
    case StFbType::CTD:
        return {kCtdIn, 3, kCtOut, 2};
    case StFbType::HYSTERESIS:
        return {kHystIn, 3, kHystOut, 1};
    case StFbType::NONE:
        break;
    }
    return {nullptr, 0, nullptr, 0};
}

} // namespace

StFbType st_fb_type_from_name(const std::string& name)
{
    if (name == "TON") return StFbType::TON;
    if (name == "TOF") return StFbType::TOF;
    if (name == "R_TRIG") return StFbType::R_TRIG;
    if (name == "F_TRIG") return StFbType::F_TRIG;
    if (name == "PID") return StFbType::PID;
    if (name == "TP") return StFbType::TP;
    if (name == "CTU") return StFbType::CTU;
    if (name == "CTD") return StFbType::CTD;
    if (name == "HYSTERESIS") return StFbType::HYSTERESIS;
    return StFbType::NONE;
}

const char* st_fb_type_name(StFbType t)
{
    switch (t) {
    case StFbType::TON:    return "TON";
    case StFbType::TOF:    return "TOF";
    case StFbType::R_TRIG: return "R_TRIG";
    case StFbType::F_TRIG: return "F_TRIG";
    case StFbType::PID:    return "PID";
    case StFbType::TP:     return "TP";
    case StFbType::CTU:    return "CTU";
    case StFbType::CTD:    return "CTD";
    case StFbType::HYSTERESIS: return "HYSTERESIS";
    case StFbType::NONE:   break;
    }
    return "?";
}

int st_fb_input_count(StFbType t)  { return fb_spec(t).n_in; }
int st_fb_output_count(StFbType t) { return fb_spec(t).n_out; }

std::size_t st_fb_retain_state_size(StFbType t)
{
    switch (t) {
    case StFbType::TON:
    case StFbType::TOF:
        /* timing:u8 + elapsed_ns:i64 + q:u8 */
        return 10;
    case StFbType::R_TRIG:
    case StFbType::F_TRIG:
        return 1; /* prev_clk:u8 */
    case StFbType::PID:
        /* integral/prev_pv/prev_output:f32 + pid_first:u8.
         * pid_prev_call_ns là mốc monotonic của process nên phải rebase khi
         * restore, không được ghi raw qua restart. */
        return 13;
    case StFbType::TP:
        /* pulsing:u8 + elapsed_ns:i64 + q:u8 + prev_in:u8 (§7A.1). `TP` cần
         * thêm sườn của IN so với TON: nó phải phân biệt "IN vừa lên" với "IN
         * đang giữ TRUE", nếu không mỗi cycle sẽ là một xung mới. */
        return 11;
    case StFbType::CTU:
    case StFbType::CTD:
        return 3; /* prev_clk:u8 + cv:i16 */
    case StFbType::HYSTERESIS:
        return 1; /* q:u8 — trạng thái duy nhất là "đang bật hay chưa" */
    case StFbType::NONE:
        return 0;
    }
    return 0;
}

const char* st_fb_input_name(StFbType t, int idx)
{
    const FbSpec s = fb_spec(t);
    return (idx >= 0 && idx < s.n_in) ? s.in[idx].name : nullptr;
}

StType st_fb_input_type(StFbType t, int idx)
{
    const FbSpec s = fb_spec(t);
    return (idx >= 0 && idx < s.n_in) ? s.in[idx].type : StType::BOOL;
}

const char* st_fb_output_name(StFbType t, int idx)
{
    const FbSpec s = fb_spec(t);
    return (idx >= 0 && idx < s.n_out) ? s.out[idx].name : nullptr;
}

StType st_fb_output_type(StFbType t, int idx)
{
    const FbSpec s = fb_spec(t);
    return (idx >= 0 && idx < s.n_out) ? s.out[idx].type : StType::BOOL;
}

/* ---- T59-101: loại POU ---- */

const char* st_pou_kind_name(StPouKind kind)
{
    switch (kind) {
    case StPouKind::PROGRAM:        return "PROGRAM";
    case StPouKind::FUNCTION:       return "FUNCTION";
    case StPouKind::FUNCTION_BLOCK: return "FUNCTION_BLOCK";
    }
    return "?";
}

bool st_pou_kind_from_keyword(const std::string& upper, StPouKind* out)
{
    if (upper == "PROGRAM")             { *out = StPouKind::PROGRAM;        return true; }
    if (upper == "FUNCTION")            { *out = StPouKind::FUNCTION;       return true; }
    if (upper == "FUNCTION_BLOCK")      { *out = StPouKind::FUNCTION_BLOCK; return true; }
    return false;
}

/* ---- Hàm chuẩn ---- */

namespace {
struct FuncSpec { const char* name; StFunc f; int arity; };
const FuncSpec kFuncs[] = {
    {"ABS",          StFunc::ABS,          1},
    {"MIN",          StFunc::MIN,          2},
    {"MAX",          StFunc::MAX,          2},
    {"LIMIT",        StFunc::LIMIT,        3},
    {"SEL",          StFunc::SEL,          3},
    {"SQRT",         StFunc::SQRT,         1},
    {"SCALE",        StFunc::SCALE,        5},
    {"DEADBAND",     StFunc::DEADBAND,     3},
    {"INT_TO_REAL",  StFunc::INT_TO_REAL,  1},
    {"REAL_TO_INT",  StFunc::REAL_TO_INT,  1},
    {"TIME_TO_REAL", StFunc::TIME_TO_REAL, 1},
    {"REAL_TO_TIME", StFunc::REAL_TO_TIME, 1},
    {"INT_TO_DINT",  StFunc::INT_TO_DINT,  1},
    {"INT_TO_UINT",  StFunc::INT_TO_UINT,  1},
    {"DINT_TO_INT",  StFunc::DINT_TO_INT,  1},
    {"DINT_TO_UINT", StFunc::DINT_TO_UINT, 1},
    {"UINT_TO_INT",  StFunc::UINT_TO_INT,  1},
    {"UINT_TO_DINT", StFunc::UINT_TO_DINT, 1},
    {"DINT_TO_REAL", StFunc::DINT_TO_REAL, 1},
    {"UINT_TO_REAL", StFunc::UINT_TO_REAL, 1},
    {"REAL_TO_DINT", StFunc::REAL_TO_DINT, 1},
    {"REAL_TO_UINT", StFunc::REAL_TO_UINT, 1},
};
} // namespace

bool st_func_from_name(const std::string& name, StFunc* out)
{
    for (const FuncSpec& s : kFuncs) {
        if (name == s.name) { *out = s.f; return true; }
    }
    return false;
}

const char* st_func_name(StFunc f)
{
    for (const FuncSpec& s : kFuncs)
        if (s.f == f) return s.name;
    return "?";
}

int st_func_arity(StFunc f)
{
    for (const FuncSpec& s : kFuncs)
        if (s.f == f) return s.arity;
    return 0;
}

/* ---- StProgram ---- */

std::vector<const StVarDecl*> StProgram::by_storage(StStorage s) const
{
    std::vector<const StVarDecl*> out;
    for (const StVarDecl& v : vars)
        if (v.storage == s) out.push_back(&v);
    return out;
}

} // namespace core
