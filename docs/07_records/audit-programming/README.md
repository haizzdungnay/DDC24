# Hồ sơ audit Programming DDC-24 Rev A

**Bộ hồ sơ:** AUD-PROG-001  
**Phiên bản:** 1.0  
**Ngày baseline:** 2026-08-08  
**Trạng thái:** Controlled audit baseline  
**Phạm vi:** Chỉ tổng hợp, phân loại và kiểm soát tài liệu Programming trong thư mục này

## 1. Kết luận đọc nhanh

Bộ hồ sơ đã được sắp theo chuỗi vòng đời tài liệu kiểu ISO/IEC/IEEE 15288 và
29148. Đây là **cấu trúc phù hợp mục đích audit**, không phải tuyên bố tổ chức hoặc
sản phẩm đã được chứng nhận ISO.

- Product Spec Rev A có thẩm quyền: `PROD-PROG-001`, trạng thái nguồn `Active`.
- Chín Feature Spec tách rõ hành vi người dùng/sản phẩm khỏi thiết kế kỹ thuật.
- 12 Product Capability, 14 Product Requirement và 19 yêu cầu layer đã được lập
  baseline tài liệu.
- 13 Verification Requirement đều còn `RED`; bằng chứng production đạt là `0/13`.
- Programming Design chưa được phê duyệt. ST scheduler/IR, graph và Modbus design
  cũ chỉ là input component/legacy, không được dùng để claim Product hoàn tất.
- Mọi mâu thuẫn đã được đưa vào Conflict Register; vấn đề chưa có authority quyết
  định vẫn giữ `OPEN`, không âm thầm chọn một giá trị.

## 2. Cấu trúc và thứ tự đọc

| Thứ tự | Thư mục | Vai trò |
|---:|---|---|
| 00 | [`00_document_control/`](00_document_control/00_DOCUMENT_CONTROL.md) | Kiểm soát tài liệu, đăng ký, thuật ngữ, conflict và quyết định mở |
| 01 | [`01_product/`](01_product/00_PROGRAMMING_PRODUCT_SPEC.md) | Product Spec, Feature Catalog và Feature Spec |
| 02 | [`02_requirements/`](02_requirements/00_PROGRAMMING_REQUIREMENTS_BASELINE.md) | Baseline yêu cầu System/Software/Interface/NFR |
| 03 | [`03_architecture/`](03_architecture/00_PROGRAMMING_SYSTEM_CONTEXT.md) | Bối cảnh và ranh giới kiến trúc |
| 04 | [`04_design/`](04_design/00_PROGRAMMING_DESIGN_STATUS_AND_CONSTRAINTS.md) | Trạng thái thiết kế và đánh giá tài liệu component/legacy |
| 05 | [`05_interfaces/`](05_interfaces/00_PROGRAMMING_INTERFACE_BASELINE.md) | Nghĩa vụ hợp đồng dữ liệu/API; schema chi tiết còn mở |
| 06 | [`06_verification/`](06_verification/00_PROGRAMMING_VERIFICATION_SPEC.md) | 13 yêu cầu kiểm chứng và gate |
| 07 | [`07_traceability/`](07_traceability/00_PROGRAMMING_TRACEABILITY_MATRIX.md) | Truy vết hai chiều Product → Feature → Requirement → Verification |
| 08 | [`08_records/`](08_records/REORGANIZATION_AND_CONFLICT_CLEANUP_REPORT_2026-08-08.md) | Báo cáo audit, inventory và trạng thái implementation tại ngày chụp |
| 09 | [`09_archive/`](09_archive/README.md) | Snapshot nguyên trạng và manifest tái hiện nguồn |

## 3. Thứ bậc thẩm quyền trong bộ audit

Khi hai tài liệu nói khác nhau, áp dụng thứ tự sau:

1. Product Spec đã phê duyệt và ADR `Accepted` có ngày mới hơn;
2. Requirement baseline có truy vết tới Product Spec;
3. tài liệu kiến trúc/thiết kế đã phê duyệt;
4. component spec hoặc proposal;
5. kế hoạch, handoff, review và tài liệu archive;
6. source hiện có chỉ chứng minh As-Built, không tự sửa nghĩa Product.

Feature Spec trong `01_product/features/` là bản phân rã có kiểm soát của Product
Spec, không được mở rộng scope hoặc tự đóng Open Decision.

## 4. Quy tắc trạng thái

| Nhãn | Nghĩa |
|---|---|
| `CONTROLLED BASELINE` | Bản chuẩn dùng để đọc/audit trong thư mục này |
| `ACTIVE SOURCE` | Nguồn gốc ghi Active/Accepted; bản audit không thay thế authority ngoài thư mục |
| `IN REVIEW` | Nội dung đã cấu trúc nhưng còn quyết định hoặc phê duyệt |
| `CANDIDATE` | Có thể tái sử dụng, chưa phải thiết kế Product đã duyệt |
| `LEGACY` | Thuộc graph/component/đường triển khai cũ |
| `ARCHIVED SNAPSHOT` | Giữ nguyên để truy nguyên, không dùng làm baseline hiện hành |
| `RED / NO-GO` | Chưa có đủ bằng chứng production để đóng gate |

## 5. Kiểm soát thay đổi

Mọi sửa đổi tiếp theo phải cập nhật đồng thời Document Register, Conflict/Open
Decision Register nếu bị ảnh hưởng, Traceability Matrix và hai manifest SHA-256.
Không chỉnh trực tiếp `09_archive/raw-source-snapshots/`; khi có nguồn mới phải tạo
snapshot mới có ngày và checksum riêng.
