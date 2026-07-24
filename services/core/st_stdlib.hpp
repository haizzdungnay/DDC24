/**
 * @file  st_stdlib.hpp
 * @brief FW SOM IEC programming foundation: standard function/operator
 *        library tối thiểu cho ST subset.
 *
 *        Operators (cú pháp ngôn ngữ, IEC 61131-3 "common elements" — KHÔNG
 *        phải function-call, xem st_parser.cpp): boolean AND/OR/NOT, so
 *        sánh GT/GE/LT/LE/EQ/NE. Implemented + tested (st_semantic.cpp,
 *        st_runtime.cpp, tests/test_st_runtime.cpp).
 *
 *        Callable standard function (registry dưới đây, cú pháp NAME(args)):
 *          - LIMIT(MN, IN, MX): REAL — clamp IN vào [MN, MX]. Implemented.
 *
 *        CHƯA implement (không được coi là supported cho tới khi có trong
 *        registry() + test):
 *          - SEL (function chọn nhánh) — không implement, LIMIT đã đủ theo
 *            yêu cầu "SEL hoặc LIMIT".
 *          - TON (timer on-delay, function BLOCK có state) — cần FUNCTION_BLOCK
 *            instance declaration + dot-member access (`Timer1.Q`) + kiểu
 *            TIME/literal `T#..` — các phần này CHƯA có trong grammar tối
 *            thiểu hiện tại (st_program.hpp/st_parser.cpp chỉ có VAR_INPUT/
 *            VAR_OUTPUT phẳng, không có FB instance). Cố tình KHÔNG cắm tạm
 *            một bản TON thiếu state đúng — rủi ro timer sai trong control
 *            logic cao hơn lợi ích của việc "có cho đủ checklist".
 */
#ifndef CORE_ST_STDLIB_HPP
#define CORE_ST_STDLIB_HPP

#include <string>
#include <vector>

#include "st_program.hpp"

namespace core {

/* Bump khi đổi signature/thêm/bớt function — BE/FE dùng số này để biết
 * danh sách symbol/function có thể đã đổi. */
constexpr int kStStdLibraryVersion = 1;

struct StStdFunctionSignature {
    std::string          name;
    std::vector<StType>  arg_types;
    StType                return_type = StType::REAL;
};

/* nullptr nếu "name" không có trong registry (unknown_function). */
const StStdFunctionSignature* find_std_function_signature(const std::string& name);

/* Toàn bộ registry hiện tại — dùng cho symbol/CLI output (item 2). */
const std::vector<StStdFunctionSignature>& std_function_registry();

/* Evaluate — CHỈ gọi sau khi semantic check đã xác nhận đúng tên/số
 * lượng/kiểu tham số. true = *out có kết quả; false = lỗi (chỉ xảy ra nếu
 * gọi sai hợp đồng — defensive, *fault mô tả). */
bool eval_std_function(const std::string& name, const std::vector<StValue>& args,
                       StValue* out, std::string* fault);

} // namespace core

#endif /* CORE_ST_STDLIB_HPP */
