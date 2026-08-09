# Feature Spec: Project, Program và Revision

**ID:** FSP-PROG-001
**Phiên bản:** 0.2
**Trạng thái:** IN REVIEW
**Nguồn:** PC-PROG-001; PR-PROG-001, PR-PROG-007
**Kiểm chứng:** VR-PROG-002
**Quyết định mở:** OD-PROG-001, 003, 004, 010

## Mục lục

1. Mục tiêu và actor
2. Hành vi bắt buộc
3. Tiêu chí chấp nhận
4. Ngoài phạm vi thiết kế
5. Thuật ngữ, lịch sử và phê duyệt

## Mục tiêu và actor

Người dùng có quyền có thể tạo, mở, sửa và lưu Project chứa một hoặc nhiều
Program; mọi bản dùng cho Deployment được đóng thành Revision bất biến và truy
nguyên được. Actor cụ thể chờ ma trận RBAC được phê duyệt.

## Hành vi bắt buộc

| ID | Hành vi sản phẩm |
|---|---|
| FSP-PROG-001-B01 | Giữ stable identity và quan hệ Project → Program → Revision qua save/open; export/import phải tuân FSP-PROG-010. |
| FSP-PROG-001-B02 | Sửa Project/Program sau khi đã tạo Revision phải sinh Revision mới. |
| FSP-PROG-001-B03 | Revision dùng cho Deployment phải bất biến, có actor/time và liên kết tới đúng Project/Program. |
| FSP-PROG-001-B04 | Capacity vượt giới hạn đã phê duyệt phải bị từ chối rõ, không cắt bớt dữ liệu im lặng. |
| FSP-PROG-001-B05 | Xóa/đổi tên không được tạo reference mồ côi hoặc làm mất lịch sử truy nguyên. |

## Tiêu chí chấp nhận feature

Round-trip Project nhiều Program không mất dữ liệu; hai Revision có identity và
nội dung phân biệt; Revision đã deploy không sửa tại chỗ; hành động trái quyền
bị từ chối và audit. Giá trị capacity chưa được chốt trong Feature Spec này.

## Ngoài phạm vi thiết kế

Schema file/database, số Project/Program tối đa, retention Revision và format
exchange phải được quyết định trong Design/OD; source component cũ không phải
authority cho các giá trị đó.

## Thuật ngữ, lịch sử và phê duyệt

Thuật ngữ theo [DICT-PROG-001](../../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Feature audit ban đầu. |
| 0.2 | 2026-08-09 | Tách bundle sang FSP-PROG-010 và đồng bộ amendment v2.2. |

Sign-off: Product Owner `PENDING`; Architecture `PENDING`; Verification `PENDING`.
