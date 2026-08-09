# Feature Spec: Deployment, Activation và Rollback

**ID:** FSP-PROG-006
**Phiên bản:** 0.2
**Trạng thái:** IN REVIEW
**Nguồn:** PC-PROG-009; PR-PROG-006..009, PR-PROG-013
**Kiểm chứng:** VR-PROG-007, VR-PROG-008, VR-PROG-011
**Quyết định mở:** OD-PROG-001, 009, 010, 012, 013, 014

## Mục lục

1. Mục tiêu
2. State model
3. Hành vi bắt buộc
4. Tiêu chí chấp nhận
5. Ranh giới
6. Thuật ngữ, lịch sử và phê duyệt

## Mục tiêu

Cung cấp lifecycle có trạng thái authority riêng, atomic tại cyclic boundary,
không làm mất Revision active tốt khi deployment/activation lỗi.

## State model tối thiểu

```text
Draft → Validated Revision → Deployed/Accepted → Active
             ↘ Rejected          ↘ Activation failed: giữ Active cũ
Active → Rollback requested → known-compatible Revision Active
```

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-006-B01 | Validate, Revision, Deployment, Activation và Rollback là trạng thái/hành động khác nhau. |
| FSP-PROG-006-B02 | Mỗi mutation có actor, target Revision, correlation, authority result và audit. |
| FSP-PROG-006-B03 | UI chỉ báo thành công khi authority sở hữu state xác nhận. |
| FSP-PROG-006-B04 | Activation chỉ đổi Revision tại control boundary; reject/corrupt/timeout giữ active cũ, hold-last đóng góp mức 5 và không làm IOP poll gap đạt 200 ms. |
| FSP-PROG-006-B05 | Rollback chỉ tới Revision tương thích đã biết và trả kết quả authority. |

## Tiêu chí chấp nhận feature

Positive/negative cho validate/deploy/activate/rollback, timeout, duplicate,
restart và power loss; identity nhất quán FE–BE–runtime; không có trạng thái active
mơ hồ hoặc false-success.

## Ranh giới

Retention, compatibility, transaction/power-loss và migration config chờ
OD-PROG-010, OD-PROG-014; tên endpoint/process không được chốt ở Feature Spec.

Cutover graph/Programming thuộc FSP-PROG-011; arbitration/bumpless chi tiết
thuộc FSP-PROG-012 và Control Semantics, không lặp ở đây.

## Thuật ngữ, lịch sử và phê duyệt

Thuật ngữ theo [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Feature audit ban đầu. |
| 0.2 | 2026-08-09 | Đồng bộ Check/Đưa vào vận hành, hold-last mức 5 và IOP bound. |

Sign-off: Product Owner `PENDING`; Runtime Architect `PENDING`; Controls/Safety `PENDING`; Verification `PENDING`.
