/**
 * @file  st_artifact.hpp
 * @brief FW SOM IEC programming foundation: artifact metadata cho validate
 *        gateway (item 2) — compiler_version/ir_schema_version cố định theo
 *        build, artifact_hash tính từ source text.
 *
 *        `compute_artifact_hash` dùng FNV-1a 64-bit — hash NỘI DUNG để định
 *        danh/so sánh 2 lần build cùng input có ra cùng hash không (SWR-REQ-
 *        IEC-005 "deterministic build"), KHÔNG PHẢI hash mật mã học (không
 *        dùng cho chữ ký/integrity chống giả mạo — nếu sau này cần, đổi sang
 *        SHA-256 thật, đây là placeholder minh bạch, không tự nhận là bảo mật).
 */
#ifndef CORE_ST_ARTIFACT_HPP
#define CORE_ST_ARTIFACT_HPP

#include <cstdint>
#include <string>

namespace core {

constexpr const char* kStCompilerVersion = "fwsom-st-0.2.0";
constexpr int kStIrSchemaVersion = 1;

/* FNV-1a 64-bit, in hoa hex 16 ký tự cố định (vd "3F2A9C1B7E4D5061"). */
std::string compute_artifact_hash(const std::string& source);

} // namespace core

#endif /* CORE_ST_ARTIFACT_HPP */
