#include "st/st_artifact.hpp"

#include <array>
#include <iomanip>
#include <sstream>

#include <sodium.h>

namespace core {
namespace {

std::string hex_sha256(const uint8_t digest[crypto_hash_sha256_BYTES])
{
    std::ostringstream text;
    text << std::hex << std::setfill('0');
    for (std::size_t index = 0; index < crypto_hash_sha256_BYTES; ++index) {
        text << std::setw(2) << static_cast<unsigned>(digest[index]);
    }
    return text.str();
}

} // namespace

std::string compute_artifact_hash(const std::string& source)
{
    return compute_source_sha256(source);
}

std::string compute_source_sha256(std::string_view canonical_source)
{
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(),
                       reinterpret_cast<const unsigned char*>(canonical_source.data()),
                       static_cast<unsigned long long>(canonical_source.size()));
    return hex_sha256(digest.data());
}

uint64_t compute_source_hash64(std::string_view canonical_source)
{
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(),
                       reinterpret_cast<const unsigned char*>(canonical_source.data()),
                       static_cast<unsigned long long>(canonical_source.size()));
    uint64_t prefix = 0;
    for (std::size_t index = 0; index < sizeof(prefix); ++index)
        prefix |= static_cast<uint64_t>(digest[index]) << (index * 8u);
    return prefix;
}

std::string compute_file_sha256(const uint8_t* data, std::size_t size)
{
    if (!data && size != 0) return {};
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    crypto_hash_sha256(digest.data(), data, static_cast<unsigned long long>(size));
    return hex_sha256(digest.data());
}

std::string compute_artifact_integrity_sha256(const uint8_t* data, std::size_t size)
{
    std::array<uint8_t, crypto_hash_sha256_BYTES> digest{};
    if (!compute_artifact_sha256(data, size, digest.data())) return {};
    return hex_sha256(digest.data());
}

} // namespace core
