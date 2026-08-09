# Feature Spec: Arbitration transparency và bumpless mức 5

| Thuộc tính | Giá trị |
|---|---|
| ID | `FSP-PROG-012` |
| Phiên bản | 0.1 |
| Trạng thái | `IN REVIEW` |
| Nguồn | PC-PROG-002, PC-PROG-009, PC-PROG-011; PR-PROG-004, PR-PROG-009, PR-PROG-011; `PRG-RT-002, PRG-RT-007, PRG-RT-008`, `PRG-COM-005` |
| Kiểm chứng | `VS-PROG-010`, `VS-PROG-014`, `VS-PROG-020`; VR-PROG-003, VR-PROG-008, VR-PROG-010, VR-PROG-012 |
| Quyết định mở | OD-PROG-007, OD-PROG-011, OD-PROG-012, OD-PROG-015 |

## Mục lục

1. Mục tiêu
2. Hành vi bắt buộc
3. Ví dụ chuẩn
4. Tiêu chí chấp nhận
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Mục tiêu

Cho người dùng và Program biết đóng góp mức 5 có hiệu lực hay đang bị giữ, đồng
thời ngăn hold-last/anti-windup dùng nhầm `actual_value` của nguồn ưu tiên khác.

## 2. Hành vi bắt buộc

| ID | Hành vi |
|---|---|
| FSP-PROG-012-B01 | Mỗi output binding phải phơi `program_value`, `actual_value`, `overridden_by`, `effective_priority` từ authority. |
| FSP-PROG-012-B02 | Khi mức 5 thắng nhưng saturate/clamp/rate-limit, PI/PID phải back-calculate trên cùng đường lệnh. |
| FSP-PROG-012-B03 | Khi mức 1–4 thắng arbitration, PI/PID phải freeze integrator và cấm seed/track `actual_value`. |
| FSP-PROG-012-B04 | Activation/Restore phải chụp `previous_program_value`; first commit mức 5 phải bằng nó trong độ phân giải binding. |
| FSP-PROG-012-B05 | Danh sách override active phải có Point/binding/source/actor/requested/actual/priority/TTL và link module Chạy thử. |

## 3. Ví dụ chuẩn

Local manual mức 2 giữ van ở 62% trong khi Program mức 5 là 41%. Activation
Revision mới phải giữ `program_value = 41%`, `actual_value = 62%`, freeze
integrator và không seed 62%. Khi override nhả, transition policy của resolver
quyết định tái nhập; không được gán nhãn bumpless nếu chưa có HIL evidence.

## 4. Tiêu chí chấp nhận

HIL phải phủ mức 5 thắng+saturate, thua từng mức 1–4, activation/restore có PID,
override TTL và read model UI/API; `max_iop_poll_gap <200 ms`, mục tiêu `<=100 ms`.

## 5. Thuật ngữ

Xem [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo từ semantics v2.2 R2-06..R2-08/R2-14. |

Sign-off: Product Owner `PENDING`; Runtime Architect `PENDING`; Controls/Safety `PENDING`; UX Lead `PENDING`; Verification `PENDING`.
