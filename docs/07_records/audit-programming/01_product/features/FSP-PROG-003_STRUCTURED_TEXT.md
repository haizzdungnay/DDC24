# Feature Spec: Structured Text

**ID:** FSP-PROG-003
**Phiên bản:** 0.2
**Trạng thái:** IN REVIEW
**Nguồn:** PC-PROG-006; PR-PROG-002, PR-PROG-006
**Kiểm chứng:** VR-PROG-004
**Quyết định mở:** OD-PROG-002, 003, 005

## Mục lục

1. Mục tiêu
2. Hành vi bắt buộc
3. Tiêu chí chấp nhận
4. Ranh giới
5. Thuật ngữ, lịch sử và phê duyệt

## Mục tiêu

Cho phép tạo, validate và chạy Program ST theo cùng một semantic đã phê duyệt từ
authoring tới runtime production.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-003-B01 | Authoring và import chỉ chấp nhận ST subset Rev A và User FUNCTION_BLOCK cục bộ Project đã được phê duyệt; package/global/binary FB phải bị từ chối. |
| FSP-PROG-003-B02 | Diagnostic syntax/semantic/type có mã, vị trí và quan hệ tới source; lỗi chặn Deployment. |
| FSP-PROG-003-B03 | Artifact chạy phải truy nguyên về đúng Revision và semantic dùng lúc validate. |
| FSP-PROG-003-B04 | Runtime không parse/chạy source chưa validate hoặc artifact sai identity/integrity/compatibility. |
| FSP-PROG-003-B05 | Không gắn nhãn IEC compliant/conformant/certified khi chưa có đánh giá được duyệt. |

## Tiêu chí chấp nhận feature

Một golden Program ST đi end-to-end từ Project/Revision qua production runtime,
I/O Mapping và Online Monitor; các lỗi syntax/semantic/type cho kết quả ổn định.
Host parser/unit test chỉ là supporting evidence.

## Ranh giới

Type, conversion, overflow, initialization và function/function-block library
chờ OD-PROG-002, OD-PROG-005; ST component spec cũ chỉ là candidate input.

## Thuật ngữ, lịch sử và phê duyệt

Thuật ngữ theo [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Feature audit ban đầu. |
| 0.2 | 2026-08-09 | Chốt scope đề xuất User FB cục bộ và negative import. |

Sign-off: Product Owner `PENDING`; Runtime Architect `PENDING`; Verification `PENDING`.
