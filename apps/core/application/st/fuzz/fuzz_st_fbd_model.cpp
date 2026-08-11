#include <cstddef>
#include <cstdint>
#include <string_view>

#include "st/st_fbd_compile.hpp"
#include "st/st_fbd_model.hpp"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, std::size_t size)
{
    // FBD source là hostile input từ BE/FE; fuzz chỉ chạy validator non-RT và
    // không bao giờ stage/activate artifact hay chạm process image.
    const auto source = std::string_view(reinterpret_cast<const char*>(data), size);
    const auto result = core::validate_and_canonicalize_fbd(source);
    if (result.ok && (result.canonical_json.empty() || !result.issues.empty())) {
        __builtin_trap();
    }
    if (!result.ok && (!result.canonical_json.empty() || result.issues.empty())) {
        __builtin_trap();
    }
    if (result.ok) {
        // Valid schema tiếp tục đi qua Task 202 lowerer/typecheck/common IR.
        // Graph dùng library chưa hỗ trợ được phép reject có issue ổn định,
        // nhưng mọi input đều phải kết thúc có kiểm soát và không crash.
        const auto compiled = core::compile_fbd_source(result.canonical_json);
        if (!compiled.ok && compiled.issues.empty()) __builtin_trap();
    }
    return 0;
}
