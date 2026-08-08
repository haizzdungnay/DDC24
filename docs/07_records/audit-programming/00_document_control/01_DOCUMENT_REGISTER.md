# Đăng ký tài liệu Programming

**ID:** DOCREG-PROG-001  
**Phiên bản:** 1.0  
**Ngày:** 2026-08-08  
**Trạng thái:** CONTROLLED BASELINE

## 1. Bộ tài liệu chuẩn

| ID | Tài liệu | Loại | Trạng thái audit | Authority/ghi chú |
|---|---|---|---|---|
| DOCCTRL-PROG-001 | `00_document_control/00_DOCUMENT_CONTROL.md` | Control | Controlled | Quy tắc bộ audit |
| DOCREG-PROG-001 | `00_document_control/01_DOCUMENT_REGISTER.md` | Register | Controlled | File này |
| TERM-PROG-001 | `00_document_control/02_TERMS_AND_DATA_DICTIONARY.md` | Data dictionary | Controlled | Thuật ngữ chuẩn hóa |
| CONFREG-PROG-001 | `00_document_control/03_CONFLICT_REGISTER.md` | Conflict register | Controlled | Không xóa conflict lịch sử |
| PROG-OD-001-AUD | `00_document_control/04_OPEN_DECISION_REGISTER.md` | Decision register | In Review | 15 quyết định còn mở/được làm rõ |
| MANIFEST-SRC-PROG-001 | `00_document_control/SOURCE_MANIFEST.sha256` | Integrity record | Generated | 33 raw snapshot |
| MANIFEST-DOC-PROG-001 | `00_document_control/DOCUMENT_MANIFEST.sha256` | Integrity record | Generated | Bộ tài liệu chuẩn, không tự hash manifest |
| PROD-PROG-001 | `01_product/00_PROGRAMMING_PRODUCT_SPEC.md` | Product Spec | Controlled copy / Active source | Bản sao kiểm soát từ nguồn Active |
| FCAT-PROG-001 | `01_product/01_FEATURE_CATALOG.md` | Feature catalog | In Review | Phân rã Product thành 9 feature |
| FSP-PROG-001..009 | `01_product/features/` | Feature Spec | In Review | Không thay thế phê duyệt thiết kế |
| REQBASE-PROG-001 | `02_requirements/00_PROGRAMMING_REQUIREMENTS_BASELINE.md` | Requirement | Controlled | 19/19 yêu cầu layer documented |
| ARCH-PROG-001 | `03_architecture/00_PROGRAMMING_SYSTEM_CONTEXT.md` | Architecture | In Review | Boundary constraint; allocation chi tiết còn mở |
| DES-PROG-STATUS-001 | `04_design/00_PROGRAMMING_DESIGN_STATUS_AND_CONSTRAINTS.md` | Design control | In Review / NO-GO | Không claim design hoàn tất |
| DES-PROG-ASSESS-001 | `04_design/01_COMPONENT_SPEC_ASSESSMENT.md` | Assessment | Record | Phân loại component/legacy |
| IFSPEC-PROG-001 | `05_interfaces/00_PROGRAMMING_INTERFACE_BASELINE.md` | Interface requirement | In Review | Schema/API chi tiết chưa phê duyệt |
| VER-PROG-001 | `06_verification/00_PROGRAMMING_VERIFICATION_SPEC.md` | Verification | Active requirement / RED result | 13/13 VR mapped; 0/13 đạt |
| TRACE-PROG-001-AUD | `07_traceability/00_PROGRAMMING_TRACEABILITY_MATRIX.md` | Traceability | Controlled | Truy vết Product/Feature/Req/VR |
| REC-PROG-REORG-001 | `08_records/REORGANIZATION_AND_CONFLICT_CLEANUP_REPORT_2026-08-08.md` | Audit record | Final | Báo cáo lần sắp xếp này |

## 2. Hồ sơ hỗ trợ

| Hồ sơ | Vai trò | Không được dùng để |
|---|---|---|
| `08_records/REQUIREMENTS_INVENTORY_2026-08-08.md` | Bảng trích yêu cầu tại ngày audit | Thay thế requirement authority |
| `08_records/LEGACY_DESIGN_ASSESSMENT_2026-08-08.md` | Bảng trích thiết kế/component | Claim Programming Design approved |
| `08_records/IMPLEMENTATION_STATUS_REVIEW_2026-08-08.md` | Ảnh chụp FE/BE/FW SOM | Claim release readiness sau ngày audit |
| `09_archive/raw-source-snapshots/` | Nguồn nguyên trạng | Làm baseline khi có bản chuẩn mới hơn |

## 3. Quy tắc đường dẫn

Đường dẫn trong bảng là tương đối từ gốc `audit-programming/`. Khi đổi tên hoặc
di chuyển file, phải cập nhật register, liên kết Markdown, traceability và
manifest trong cùng thay đổi.
