#include "st/st_public_key.hpp"

#include <cstddef>
#include <cstring>

namespace core {
namespace {

/* Khoá TEST — seed cố định, xem st_public_key.hpp. */
const uint8_t kTestPublicKey[32] = {
    0x99, 0x35, 0x46, 0x13, 0xDB, 0x15, 0x91, 0x8A, 0x3B, 0x4F, 0xAC, 0x33,
    0x3B, 0xD2, 0x00, 0xE3, 0x12, 0xF7, 0x06, 0x0E, 0xED, 0x3D, 0x72, 0x0C,
    0xD1, 0x8B, 0xBF, 0x73, 0x3E, 0x3A, 0x8B, 0xD0,
};

#ifdef MKDDC_ST_PUBLIC_KEY_HEX
/* Build release truyền khoá thật qua macro; giải mã một lần lúc khởi động. */
uint8_t g_key[32];
bool    g_decoded = false;

int hex_val(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

bool decode_key()
{
    const char* hex = MKDDC_ST_PUBLIC_KEY_HEX;
    if (std::strlen(hex) != 64) return false;
    for (int i = 0; i < 32; i++) {
        const int hi = hex_val(hex[i * 2]);
        const int lo = hex_val(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        g_key[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}
#endif

} // namespace

const uint8_t* st_builtin_public_key()
{
#ifdef MKDDC_ST_PUBLIC_KEY_HEX
    if (!g_decoded) {
        if (!decode_key()) return kTestPublicKey;   /* macro hỏng -> fallback rõ ràng */
        g_decoded = true;
    }
    return g_key;
#else
    return kTestPublicKey;
#endif
}

void st_public_key_fingerprint(const uint8_t* key, char* out, std::size_t out_size)
{
    static const char kHex[] = "0123456789abcdef";
    if (out == nullptr || out_size == 0) return;
    if (key == nullptr || out_size < 17) { out[0] = '\0'; return; }
    for (int i = 0; i < 8; ++i) {
        out[i * 2] = kHex[(key[i] >> 4) & 0x0F];
        out[i * 2 + 1] = kHex[key[i] & 0x0F];
    }
    out[16] = '\0';
}

bool st_public_key_is_test_key()
{
    return std::memcmp(st_builtin_public_key(), kTestPublicKey, 32) == 0;
}

} // namespace core
