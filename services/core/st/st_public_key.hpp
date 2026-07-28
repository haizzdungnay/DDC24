/**
 * @file  st_public_key.hpp
 * @brief Khoá công khai Ed25519 dùng để verify artifact chương trình
 *        (TYPED_IR_ARTIFACT_SPEC §3.2).
 *
 *        KHOÁ RIÊNG KHÔNG BAO GIỜ NẰM TRÊN THIẾT BỊ. Việc ký thực hiện ở
 *        khâu build/release; runtime chỉ verify.
 *
 *        Khoá dưới đây là KHOÁ TEST, sinh từ seed cố định và cam kết vào
 *        repo có chủ ý để CI ký/verify được mà không cần hạ tầng khoá. Nó
 *        KHÔNG được dùng cho release: build release phải truyền
 *        -DMKDDC_ST_PUBLIC_KEY_HEX=<64 hex> để thay khoá này, và quy trình
 *        release phải kiểm rằng khoá đang nhúng KHÁC khoá test.
 */
#ifndef CORE_ST_PUBLIC_KEY_HPP
#define CORE_ST_PUBLIC_KEY_HPP

#include <cstdint>

namespace core {

/* Trả về 32 byte khoá công khai đang được nhúng trong build này. */
const uint8_t* st_builtin_public_key();

/* true nếu build đang dùng KHOÁ TEST — dùng để cảnh báo lúc khởi động và để
 * gate release chặn được. */
bool st_public_key_is_test_key();

} // namespace core

#endif /* CORE_ST_PUBLIC_KEY_HPP */
