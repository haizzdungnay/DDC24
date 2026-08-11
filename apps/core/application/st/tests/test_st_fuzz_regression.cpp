/**
 * @file test_st_fuzz_regression.cpp
 * @brief Fuzz hồi quy tất định chạy ở mọi CI, bổ sung cho libFuzzer/ASan dài hạn.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"
#include "st/st_limits.hpp"

namespace core {
namespace {

uint32_t next_random(uint32_t* state)
{
    uint32_t value = *state;
    value ^= value << 13u;
    value ^= value >> 17u;
    value ^= value << 5u;
    *state = value;
    return value;
}

void mutate_source(std::string* source, uint32_t* state)
{
    static constexpr char kAlphabet[] =
        "PROGRAM_ENDVARIFTHEN:=;()/*+-0123456789\n\x00\x7F\xC0\xFF";
    const uint32_t operation = next_random(state) % 5u;
    const std::size_t position = source->empty() ? 0u : next_random(state) % source->size();
    switch (operation) {
    case 0:
        if (!source->empty())
            (*source)[position] = kAlphabet[next_random(state) % (sizeof(kAlphabet) - 1u)];
        break;
    case 1:
        if (source->size() < st_limits::kMaxSourceBytes)
            source->insert(position, 1,
                           kAlphabet[next_random(state) % (sizeof(kAlphabet) - 1u)]);
        break;
    case 2:
        if (!source->empty()) source->erase(position, 1);
        break;
    case 3:
        if (!source->empty() && source->size() < st_limits::kMaxSourceBytes) {
            const std::size_t width =
                std::min<std::size_t>(1u + next_random(state) % 16u, source->size() - position);
            const std::string fragment = source->substr(position, width);
            if (source->size() + fragment.size() <= st_limits::kMaxSourceBytes)
                source->insert(position, fragment);
        }
        break;
    default:
        if (!source->empty()) source->resize(position);
        break;
    }
}

} // namespace

TEST(StFuzzRegression, TenThousandDeterministicMutationsFailClosed)
{
    const std::vector<std::string> corpus = {
        "PROGRAM p\nEND_PROGRAM\n",
        "PROGRAM p\nVAR_INPUT a : REAL; END_VAR\nVAR_OUTPUT b : REAL; END_VAR\n"
        "b := LIMIT(0.0, a * 2.0, 100.0);\nEND_PROGRAM\n",
        "PROGRAM p\nVAR t : TON; q : BOOL; END_VAR\n"
        "t(IN := q, PT := T#5s);\nq := t.Q;\nEND_PROGRAM\n",
        "PROGRAM p\nVAR x : REAL; END_VAR\nWHILE TRUE DO x := x + 1.0; END_WHILE;\n"
        "END_PROGRAM\n",
    };

    uint32_t random_state = 0xDDC24200u;
    for (std::size_t case_index = 0; case_index < 10000u; ++case_index) {
        std::string source = corpus[next_random(&random_state) % corpus.size()];
        const uint32_t mutation_count = 1u + next_random(&random_state) % 8u;
        for (uint32_t i = 0; i < mutation_count; ++i) mutate_source(&source, &random_state);

        StIrModule module;
        StDiagnostic diagnostic;
        if (!compile_st_source(source, &module, &diagnostic)) {
            ASSERT_FALSE(diagnostic.code.empty()) << "case=" << case_index;
            ASSERT_FALSE(diagnostic.message.empty()) << "case=" << case_index;
            ASSERT_GE(diagnostic.length, 1) << "case=" << case_index;
            continue;
        }

        std::vector<uint8_t> artifact;
        std::string serialization_error;
        if (!serialize_st_ir(module, &artifact, &serialization_error)) {
            /* Vượt resource của artifact là reject có kiểm soát, không phải crash. */
            ASSERT_FALSE(serialization_error.empty()) << "case=" << case_index;
            continue;
        }
        StLoadedProgram loaded;
        StLoaderOptions options;
        StLoadError load_error;
        ASSERT_TRUE(load_st_artifact(artifact.data(), artifact.size(), options, &loaded,
                                     &load_error))
            << "case=" << case_index << " " << load_error.code << ": " << load_error.message;
    }
}

} // namespace core
