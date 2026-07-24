#include "st_artifact.hpp"

#include <cstdio>

namespace core {

std::string compute_artifact_hash(const std::string& source)
{
    uint64_t hash = 0xcbf29ce484222325ull;   /* FNV offset basis */
    for (unsigned char c : source) {
        hash ^= c;
        hash *= 0x100000001b3ull;             /* FNV prime */
    }
    char buf[17];
    std::snprintf(buf, sizeof(buf), "%016llX", static_cast<unsigned long long>(hash));
    return std::string(buf);
}

} // namespace core
