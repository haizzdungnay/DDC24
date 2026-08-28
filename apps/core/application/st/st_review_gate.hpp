/**
 * @file  st_review_gate.hpp
 * @brief T59-205 — chặn Check với feature còn nhãn REVIEW_REQUIRED (DDD §9).
 *
 *        Đây là CHÍNH SÁCH SẢN PHẨM ở biên Check, không phải luật ngôn ngữ.
 *        Vì vậy nó KHÔNG nằm trong `typecheck_st_program`: bộ test conformance
 *        của chính PID phải compile và chạy được PID — nếu không thì evidence
 *        Controls/Safety (`VS-PROG-U12`) vốn là thứ mở khoá gate lại không bao
 *        giờ dựng được.
 *
 *        Token phê duyệt đến từ `product_profile_v2.json` và được generator suy
 *        ra từ chính contract; không có payload, header hay checkbox UI nào đặt
 *        được nó.
 */
#ifndef CORE_ST_REVIEW_GATE_HPP
#define CORE_ST_REVIEW_GATE_HPP

#include "st/st_diagnostic.hpp"
#include "st/st_program.hpp"

namespace core {

/* true = chương trình không dùng feature nào đang bị gate.
 * false = *diag mang `ST-PID-001` và trỏ đúng khai báo vi phạm. */
bool st_review_gate_check(const StProgram& program, StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_REVIEW_GATE_HPP */
