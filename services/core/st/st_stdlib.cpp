#include "st/st_stdlib.hpp"

namespace core {
namespace {

const std::vector<StStdFunctionSignature>& registry()
{
    static const std::vector<StStdFunctionSignature> r = {
        {"LIMIT", {StType::REAL, StType::REAL, StType::REAL}, StType::REAL},
    };
    return r;
}

} // namespace

const StStdFunctionSignature* find_std_function_signature(const std::string& name)
{
    for (const StStdFunctionSignature& f : registry())
        if (f.name == name) return &f;
    return nullptr;
}

const std::vector<StStdFunctionSignature>& std_function_registry() { return registry(); }

bool eval_std_function(const std::string& name, const std::vector<StValue>& args,
                       StValue* out, std::string* fault)
{
    if (name == "LIMIT") {
        if (args.size() != 3) {
            *fault = "internal_error: LIMIT expects 3 args";
            return false;
        }
        /* LIMIT(MN, IN, MX): REAL — clamp IN vào [MN, MX] (thứ tự chuẩn IEC). */
        const float mn = args[0].real_value;
        const float in = args[1].real_value;
        const float mx = args[2].real_value;
        float result = in;
        if (result < mn) result = mn;
        if (result > mx) result = mx;
        out->type = StType::REAL;
        out->real_value = result;
        out->bool_value = false;
        return true;
    }
    *fault = "internal_error: unknown function '" + name + "' reached runtime evaluator "
             "(should have been rejected at typecheck)";
    return false;
}

} // namespace core
