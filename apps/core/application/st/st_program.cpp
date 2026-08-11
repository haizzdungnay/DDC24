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
    return StFbType::NONE;
}

const char* st_fb_type_name(StFbType t)
{
    switch (t) {
    case StFbType::TON:    return "TON";
    case StFbType::TOF:    return "TOF";
    case StFbType::R_TRIG: return "R_TRIG";
    case StFbType::F_TRIG: return "F_TRIG";
    case StFbType::NONE:   break;
    }
    return "?";
}

int st_fb_input_count(StFbType t)  { return fb_spec(t).n_in; }
int st_fb_output_count(StFbType t) { return fb_spec(t).n_out; }

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
