#include <cstddef>
#include <cstdint>
#include <string_view>

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
    return 0;
}
