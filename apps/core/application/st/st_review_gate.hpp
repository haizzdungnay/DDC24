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
 *        được nó. `PID` mang token từ 2026-09-28 (Issue #802,
 *        `EV-PROG-PID-APPROVAL-20260928`); cơ chế cổng vẫn giữ cho feature
 *        REVIEW_REQUIRED về sau.
 */
#ifndef CORE_ST_REVIEW_GATE_HPP
#define CORE_ST_REVIEW_GATE_HPP

#include <string_view>

#include "st/st_diagnostic.hpp"
#include "st/st_program.hpp"

namespace core {

/* Bảng quyết định "feature này có đang bị chặn Check không". Production luôn là
 * `st_profile_generated::review_gate_blocks` — bảng sinh từ profile. Con trỏ
 * hàm (không phải `std::function`) để đường Check không cấp phát.
 *
 * Issue #802: sau khi `PID` được ký token, bảng production không còn chặn
 * feature nào. Test CƠ CHẾ cổng vì thế truyền bảng giả qua overload dưới đây
 * (hoặc `StCompileOptions::review_gate_blocks`), thay vì dựa vào việc profile
 * tình cờ còn một feature chưa duyệt. */
using StReviewGateBlocks = bool (*)(std::string_view feature_id);

/* true = chương trình không dùng feature nào đang bị gate.
 * false = *diag mang `ST-PID-001` và trỏ đúng khai báo vi phạm.
 * Dùng bảng sinh từ profile. */
bool st_review_gate_check(const StProgram& program, StDiagnostic* diag);

/* Như trên nhưng với bảng `blocks` chỉ định; `nullptr` = bảng sinh từ profile. */
bool st_review_gate_check(const StProgram& program, StDiagnostic* diag,
                          StReviewGateBlocks blocks);

} // namespace core

#endif /* CORE_ST_REVIEW_GATE_HPP */
