# Feature Spec: Online Monitor

**ID:** FSP-PROG-008
**Phiên bản:** 0.2
**Trạng thái:** IN REVIEW
**Nguồn:** PC-PROG-011; PR-PROG-011, PR-PROG-012
**Kiểm chứng:** VR-PROG-010, VR-PROG-012
**Quyết định mở:** OD-PROG-011

## Mục lục

1. Mục tiêu
2. Hành vi bắt buộc
3. Tiêu chí chấp nhận
4. Ranh giới
5. Thuật ngữ, lịch sử và phê duyệt

## Mục tiêu

Cho người dùng quan sát đúng Revision active, Program, Variable và Point từ
runtime authority mà không làm control phụ thuộc vào session Web.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-008-B01 | Mỗi sample có identity, `program_value`, `actual_value`, `overridden_by`, `effective_priority`, quality, source timestamp/freshness và authority khi áp dụng. |
| FSP-PROG-008-B02 | unavailable/stale/bad/unknown hiển thị riêng, không giả thành live hoặc `0`. |
| FSP-PROG-008-B03 | Revision/Program hiển thị phải khớp runtime active, không lấy từ Draft/client cache; core state chỉ `RUNNING/DEGRADED/UNREACHABLE`. |
| FSP-PROG-008-B04 | Disconnect/reconnect monitor không dừng Program và không blind replay mutation. |
| FSP-PROG-008-B05 | Monitor mặc định read-only; không suy ra write/force/online change. |

## Tiêu chí chấp nhận feature

Đối chiếu UI/API với runtime authority trong trạng thái live, stale, unavailable,
fault và Revision switch; đo reconnect và local continuity.

## Ranh giới

Refresh rate, trace depth, retention và policy write/force tách biệt chờ
OD-PROG-011. Online Monitor không bao gồm online change.

## Thuật ngữ, lịch sử và phê duyệt

Thuật ngữ theo [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Feature audit ban đầu. |
| 0.2 | 2026-08-09 | Thêm arbitration read model và core connectivity semantics. |

Sign-off: Product Owner `PENDING`; UX Lead `PENDING`; Verification `PENDING`.
