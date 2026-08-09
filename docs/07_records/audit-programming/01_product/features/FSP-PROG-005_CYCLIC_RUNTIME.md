# Feature Spec: Cyclic runtime 1/5/30 giây

**ID:** FSP-PROG-005
**Phiên bản:** 0.2
**Trạng thái:** IN REVIEW
**Nguồn:** PC-PROG-008; PR-PROG-005, PR-PROG-012
**Kiểm chứng:** VR-PROG-006, VR-PROG-012
**Quyết định mở:** OD-PROG-003, 004, 012, 013, 014

## Mục lục

1. Mục tiêu
2. Hành vi bắt buộc
3. Tiêu chí chấp nhận
4. Ranh giới
5. Thuật ngữ, lịch sử và phê duyệt

## Mục tiêu

Chạy Program theo lựa chọn cycle time Product 1 s, 5 s hoặc 30 s, có quan sát
cycle/overrun/fault và tiếp tục local khi Web/engineering client mất kết nối.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-005-B01 | Rev A có đúng một Task; UI/API/import/runtime chỉ chấp nhận 1000, 5000 hoặc 30000 ms và không expose Add Task. |
| FSP-PROG-005-B02 | Cycle áp dụng được lưu trong Revision và hiển thị từ authority, không suy diễn ở client. |
| FSP-PROG-005-B03 | Runtime thực thi deterministic; base control step phải bounded và độc lập Task period, hoàn tất trước mỗi watchdog kick. |
| FSP-PROG-005-B04 | Mất/restart client không dừng Program active hoặc replay mutation mù khi reconnect. |
| FSP-PROG-005-B05 | Ba overrun liên tiếp chỉ fault/degrade đúng Task; plant safe-state chỉ do SafetyManager condition độc lập đã duyệt. |

## Tiêu chí chấp nhận feature

Đo production target cho cả ba cycle với tải, jitter, WCET và fault injection;
reject mọi cycle khác ở tất cả cửa vào; xác nhận local continuity khi mất Web.

## Ranh giới

Base tick 50 ms của component cũ chỉ là candidate nội bộ. Multi-task và limit
8/16/32 OUT Rev A. Budget, base-step/watchdog và fault policy chờ
OD-PROG-004, OD-PROG-012, OD-PROG-013, OD-PROG-014; xem `CONF-PROG-015`.

## Thuật ngữ, lịch sử và phê duyệt

Thuật ngữ theo [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Feature audit ban đầu. |
| 0.2 | 2026-08-09 | Một Task, base-step độc lập, task-level overrun và watchdog blocker. |

Sign-off: Product Owner `PENDING`; Runtime Architect `PENDING`; Controls/Safety `PENDING`; Verification `PENDING`.
