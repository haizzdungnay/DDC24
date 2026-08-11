/**
 * @file  st_artifact.hpp
 * @brief Tiện ích hash và encode artifact Programming Rev A.
 *
 *        Mọi hash công bố ra contract đều là SHA-256 chữ thường 64 ký tự.
 *        Không dùng FNV hoặc timestamp/path host làm provenance. Hash file
 *        artifact và digest integrity trong header là hai giá trị khác nhau;
 *        API đặt tên tường minh để consumer không dùng nhầm.
 */
#ifndef CORE_ST_ARTIFACT_HPP
#define CORE_ST_ARTIFACT_HPP

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "st/st_ir.hpp"

namespace core {

inline constexpr const char* kStCompilerVersion = st_ir::kCompilerVersion;
inline constexpr int kStIrSchemaVersion = st_ir::kSchemaVersion;

/* SHA-256 của source canonical, chữ thường 64 ký tự. Tên cũ được giữ một
 * release để validate CLI/consumer cũ tiếp tục compile. */
std::string compute_artifact_hash(const std::string& source);
std::string compute_source_sha256(std::string_view canonical_source);

/* Prefix 64-bit little-endian của SHA-256 để điền field metadata legacy trong
 * MKDDCIR1 schema 1. Không dùng giá trị rút gọn này làm provenance authority. */
uint64_t compute_source_hash64(std::string_view canonical_source);

/* SHA-256 của đúng byte file, gồm cả digest header/chữ ký nếu có. */
std::string compute_file_sha256(const uint8_t* data, std::size_t size);

/* Digest integrity theo layout MKDDCIR1: vùng [32,128) được coi là zero. */
std::string compute_artifact_integrity_sha256(const uint8_t* data, std::size_t size);

/* Entry point contract Rev A: serialization canonical, không timestamp/path/
 * random, SHA-256 được điền và vùng chữ ký để 0. */
bool EncodeArtifactDeterministic(const StIrModule& module, std::vector<uint8_t>* artifact,
                                 std::string* error);

} // namespace core

#endif /* CORE_ST_ARTIFACT_HPP */
