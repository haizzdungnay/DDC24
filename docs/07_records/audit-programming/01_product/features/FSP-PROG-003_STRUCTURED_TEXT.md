# Feature Spec: Structured Text

**ID:** FSP-PROG-003  
**Phiên bản:** 0.1  
**Trạng thái:** IN REVIEW  
**Nguồn:** PC-PROG-006; PR-PROG-002, PR-PROG-006  
**Kiểm chứng:** VR-PROG-004  
**Quyết định mở:** OD-PROG-002, 003, 005

## Mục tiêu

Cho phép tạo, validate và chạy Program ST theo cùng một semantic đã phê duyệt từ
authoring tới runtime production.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-003-B01 | Authoring và import chỉ chấp nhận ST subset Rev A được phê duyệt. |
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
chờ OD-PROG-002/005; ST component spec cũ chỉ là candidate input.
