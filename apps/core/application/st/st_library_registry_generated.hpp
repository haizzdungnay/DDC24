// GENERATED bởi scripts/generate_programming_library_registry.py; không sửa tay.
#ifndef CORE_ST_LIBRARY_REGISTRY_GENERATED_HPP
#define CORE_ST_LIBRARY_REGISTRY_GENERATED_HPP

#include <array>
#include <cstddef>
#include <string_view>

namespace core::st_library_registry_generated {

inline constexpr std::string_view kRegistrySha256 = "55c152d6a1456faf130a05a68788c9e15be918be359d9e642c8c215068540885";
inline constexpr std::string_view kLibraryVersion = "rev-a.1";

/* Entry compiler nhận diện qua binop/unop trong st_fbd_compile.cpp. */
inline constexpr std::array<std::string_view, 15> kOperators = {
    "AND",
    "OR",
    "XOR",
    "NOT",
    "EQ",
    "NE",
    "LT",
    "LE",
    "GT",
    "GE",
    "ADD",
    "SUB",
    "MUL",
    "DIV",
    "MOD",
};

/* Entry compiler nhận diện qua kFuncs[] (st_func_from_name). */
inline constexpr std::array<std::string_view, 20> kFuncTable = {
    "SEL",
    "ABS",
    "MIN",
    "MAX",
    "LIMIT",
    "SQRT",
    "INT_TO_REAL",
    "REAL_TO_INT",
    "TIME_TO_REAL",
    "REAL_TO_TIME",
    "INT_TO_DINT",
    "INT_TO_UINT",
    "DINT_TO_INT",
    "DINT_TO_UINT",
    "UINT_TO_INT",
    "UINT_TO_DINT",
    "DINT_TO_REAL",
    "UINT_TO_REAL",
    "REAL_TO_DINT",
    "REAL_TO_UINT",
};

/* Entry compiler nhận diện qua st_fb_type_from_name. */
inline constexpr std::array<std::string_view, 5> kFbTypes = {
    "TON",
    "TOF",
    "R_TRIG",
    "F_TRIG",
    "PID",
};

/* Allowlist FBD theo node kind. */
inline constexpr std::array<std::string_view, 21> kPureFunctions = {
    "AND",
    "OR",
    "XOR",
    "NOT",
    "SEL",
    "EQ",
    "NE",
    "LT",
    "LE",
    "GT",
    "GE",
    "ADD",
    "SUB",
    "MUL",
    "DIV",
    "MOD",
    "ABS",
    "MIN",
    "MAX",
    "LIMIT",
    "SQRT",
};
inline constexpr std::array<std::string_view, 14> kExplicitConversions = {
    "INT_TO_REAL",
    "REAL_TO_INT",
    "TIME_TO_REAL",
    "REAL_TO_TIME",
    "INT_TO_DINT",
    "INT_TO_UINT",
    "DINT_TO_INT",
    "DINT_TO_UINT",
    "UINT_TO_INT",
    "UINT_TO_DINT",
    "DINT_TO_REAL",
    "UINT_TO_REAL",
    "REAL_TO_DINT",
    "REAL_TO_UINT",
};

/* Entry chưa được Controls/Safety duyệt; Commission phải chặn nếu thiếu token. */
inline constexpr std::array<std::string_view, 1> kReviewRequired = {
    "PID",
};

} // namespace core::st_library_registry_generated

#endif // CORE_ST_LIBRARY_REGISTRY_GENERATED_HPP
