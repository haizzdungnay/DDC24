#include "st/st_review_gate.hpp"

#include <string>

#include "st/st_profile_generated.hpp"

namespace core {

bool st_review_gate_check(const StProgram& program, StDiagnostic* diag)
{
    for (const StFbDecl& fb : program.fbs) {
        if (fb.fb_type == StFbType::NONE) continue;
        const char* name = st_fb_type_name(fb.fb_type);
        if (!st_profile_generated::review_gate_blocks(name)) continue;
        if (diag != nullptr) {
            diag->severity = StSeverity::ERROR;
            diag->code = st_diag_code::kPidApprovalMissing;
            diag->message = std::string("function block '") + name +
                            "' requires a Controls/Safety approval token in the product profile "
                            "before it can pass Check";
            diag->line = fb.line;
            diag->column = fb.column;
            diag->length = fb.length;
        }
        return false;
    }
    return true;
}

} // namespace core
