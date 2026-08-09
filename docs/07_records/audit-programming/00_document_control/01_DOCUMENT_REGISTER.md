# Đăng ký tài liệu bộ thiết kế Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `DOCREG-PROG-001` |
| Phiên bản | 2.0 |
| Trạng thái | `CONTROLLED / IN REVIEW` |
| Ngày cập nhật | 2026-08-09 |

## Mục lục

1. Amendment input
2. Controlled documents
3. Record/archive
4. Quy tắc đăng ký
5. Thuật ngữ
6. Lịch sử và phê duyệt

## 1. Amendment input

| ID | Tài liệu | Phiên bản | Trạng thái | Chủ quản |
|---|---|---|---|---|
| DDC24-PRG-PRODUCT-SPEC-001 | `docs/CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md` | v2.2 + R3 correction | IN REVIEW; không Product authority | Product Owner |
| DDC24-PRG-UX-DESIGN-001 | `docs/CHUONG_YEU_CAU/PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md` | v2.2 + R3 correction | IN REVIEW; không Design baseline | UX Lead |

Hai file trên là **nguồn thiết kế duy nhất** cho amendment. Record phản biện và
authority ngoài bộ chỉ dùng để kiểm quyền/conflict, không tạo design mới.

## 2. Controlled documents

| ID/tập ID | File | Loại | Chủ quản | Trạng thái |
|---|---|---|---|---|
| AUD-PROG-001 | [README](../README.md) | Set index | Product + Architecture | CONTROLLED / IN REVIEW |
| DOCCTRL-PROG-001 | [00_DOCUMENT_CONTROL](00_DOCUMENT_CONTROL.md) | Document control | Product + Architecture | CONTROLLED |
| DOCREG-PROG-001 | [01_DOCUMENT_REGISTER](01_DOCUMENT_REGISTER.md) | Register | Document Control | CONTROLLED |
| DICT-PROG-001 | [02_TERMS_AND_DATA_DICTIONARY](02_TERMS_AND_DATA_DICTIONARY.md) | Dictionary | Product + Architecture + UX | IN REVIEW |
| CONFREG-PROG-001 | [03_CONFLICT_REGISTER](03_CONFLICT_REGISTER.md) | Conflict register | Architecture | CONTROLLED / OPEN ITEMS |
| PROG-OD-PROG-001-AUD | [04_OPEN_DECISION_REGISTER](04_OPEN_DECISION_REGISTER.md) | Open decision register | Product + Architecture | IN REVIEW |
| PROD-PROG-001 | [00_PROGRAMMING_PRODUCT_SPEC](../01_product/00_PROGRAMMING_PRODUCT_SPEC.md) | Controlled copy + overlay | Product | Active mirror + proposal |
| FCAT-PROG-001 | [01_FEATURE_CATALOG](../01_product/01_FEATURE_CATALOG.md) | Feature catalog | Product | IN REVIEW |
| FSP-PROG-001 | [Project/Program/Revision](../01_product/features/FSP-PROG-001_PROJECT_PROGRAM_REVISION.md) | Feature Spec | Product | IN REVIEW |
| FSP-PROG-002 | [Point/Variable/Mapping](../01_product/features/FSP-PROG-002_POINT_VARIABLE_IO_MAPPING.md) | Feature Spec | Product + I/O | IN REVIEW |
| FSP-PROG-003 | [Structured Text](../01_product/features/FSP-PROG-003_STRUCTURED_TEXT.md) | Feature Spec | Product + Runtime | IN REVIEW |
| FSP-PROG-004 | [Structured FBD](../01_product/features/FSP-PROG-004_FUNCTION_BLOCK_DIAGRAM.md) | Feature Spec | Product + UX + Runtime | IN REVIEW |
| FSP-PROG-005 | [Cyclic Runtime](../01_product/features/FSP-PROG-005_CYCLIC_RUNTIME.md) | Feature Spec | Runtime | IN REVIEW |
| FSP-PROG-006 | [Lifecycle](../01_product/features/FSP-PROG-006_DEPLOY_ACTIVATE_ROLLBACK.md) | Feature Spec | Product + Runtime | IN REVIEW |
| FSP-PROG-007 | [RETAIN](../01_product/features/FSP-PROG-007_RETAIN.md) | Feature Spec | Runtime | IN REVIEW |
| FSP-PROG-008 | [Online Monitor](../01_product/features/FSP-PROG-008_ONLINE_MONITOR.md) | Feature Spec | Product + UX | IN REVIEW |
| FSP-PROG-009 | [Access/Audit/Scope](../01_product/features/FSP-PROG-009_ACCESS_AUDIT_SCOPE_GUARD.md) | Feature Spec | Product + Security | IN REVIEW |
| FSP-PROG-010 | [Replacement Bundle](../01_product/features/FSP-PROG-010_REPLACEMENT_BUNDLE.md) | Feature Spec | Product + Security | IN REVIEW |
| FSP-PROG-011 | [Graph/Programming Cutover](../01_product/features/FSP-PROG-011_GRAPH_PROGRAMMING_CUTOVER.md) | Feature Spec | Architecture + Operations | IN REVIEW |
| FSP-PROG-012 | [Arbitration Transparency](../01_product/features/FSP-PROG-012_ARBITRATION_TRANSPARENCY.md) | Feature Spec | Controls + Runtime + UX | IN REVIEW |
| REQBASE-PROG-001 | [Requirements Baseline](../02_requirements/00_PROGRAMMING_REQUIREMENTS_BASELINE.md) | Active controlled copy | Product + System | ACTIVE |
| 41 PRG + 24 UX-REQ | [Proposed Requirements v2.2](../02_requirements/01_PROPOSED_REQUIREMENTS_V22.md) | Amendment requirements | Product + UX | PROPOSED |
| ARCH-PROG-001 | [System Context](../03_architecture/00_PROGRAMMING_SYSTEM_CONTEXT.md) | Architecture context | Architecture | IN REVIEW |
| ARCH-PROG-002 | [Runtime Architecture](../03_architecture/01_PROGRAMMING_RUNTIME_ARCHITECTURE.md) | Candidate normative design | Runtime Architecture | PROPOSED |
| DES-PROG-STATUS-001 | [Design Status](../04_design/00_PROGRAMMING_DESIGN_STATUS_AND_CONSTRAINTS.md) | Status/constraint | Architecture | NOT APPROVED |
| DES-PROG-ASSESS-001 | [Component Assessment](../04_design/01_COMPONENT_SPEC_ASSESSMENT.md) | Assessment | Runtime Architecture | IN REVIEW |
| DES-PROG-002 | [Control Semantics](../04_design/02_CONTROL_SEMANTICS.md) | Candidate normative design | Controls + Runtime | PROPOSED |
| IFSPEC-PROG-001 | [Interface Baseline](../05_interfaces/00_PROGRAMMING_INTERFACE_BASELINE.md) | Data meaning/authority | Interface Owner | IN REVIEW |
| IFSPEC-PROG-001 Appendix Error | [Error Code Catalog](../05_interfaces/01_ERROR_CODE_CATALOG.md) | Error namespace | Interface Owner | IN REVIEW |
| VER-PROG-001 | [Verification Spec](../06_verification/00_PROGRAMMING_VERIFICATION_SPEC.md) | VR authority | Verification | ACTIVE / RESULTS RED |
| VS-PROG-001..030 | [Verification Scenarios](../06_verification/01_VERIFICATION_SCENARIOS.md) | Scenario catalog duy nhất | Verification | RESULTS RED |
| TRACE-PROG-001 | [Traceability Matrix](../07_traceability/00_PROGRAMMING_TRACEABILITY_MATRIX.md) | Trace | Verification + Product | IN REVIEW |

## 3. Record và archive

| ID/file | File | Quy tắc |
|---|---|---|
| AUDIT-PROGRAMMING-IMPL-2026-08-08 | [Implementation Status](../08_records/IMPLEMENTATION_STATUS_REVIEW_2026-08-08.md) | Giữ nguyên historical record |
| LEGACY_DESIGN_ASSESSMENT | [Legacy Design Assessment](../08_records/LEGACY_DESIGN_ASSESSMENT_2026-08-08.md) | Giữ nguyên historical record |
| AUDIT-PROGRAMMING-CRITIQUE-2026-08-09 | [Phản biện v2](../08_records/PHAN_BIEN_PROGRAMMING_SPEC_UX_V2_2026-08-09.md) | Giữ nguyên review record |
| REC-PROG-REORG-001 | [Reorganization Report](../08_records/REORGANIZATION_AND_CONFLICT_CLEANUP_REPORT_2026-08-08.md) | Giữ nguyên historical record |
| REQUIREMENTS_INVENTORY | [Requirements Inventory](../08_records/REQUIREMENTS_INVENTORY_2026-08-08.md) | Giữ nguyên historical record |
| REC-PROG-REFACTOR-002 | [Refactor to Design Set](../08_records/REFACTOR_TO_DESIGN_SET_2026-08-09.md) | Record phiên chuyển đổi |
| SOURCE-MANIFEST | [SOURCE_MANIFEST.sha256](SOURCE_MANIFEST.sha256) | Bất biến; verify 33 raw snapshot payload |
| DOCUMENT-MANIFEST | [DOCUMENT_MANIFEST.sha256](DOCUMENT_MANIFEST.sha256) | Tạo lại sau change, không self-hash |
| 09_archive | `../09_archive/` | Bất biến; không sửa/xóa/sắp xếp lại |

Thực đo trong phiên: `raw-source-snapshots/` có **33 file payload**, không phải
34 như giả định trong prompt; toàn `09_archive/` có 35 file kể cả index/metadata.
Sai lệch được ghi record, không sửa archive để ép số.

## 4. Quy tắc đăng ký

File mới/sửa phải được đăng ký cùng owner/status, manifest và changelog. Không
được dùng cùng ID cho requirement và error. ID deprecated không tái sử dụng.

## 5. Thuật ngữ

Xem [DICT-PROG-001](02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Register audit baseline. |
| 2.0 | 2026-08-09 | Đăng ký amendment inputs và mọi file living design mới/sửa. |

Sign-off: Document Control `PENDING`; Product `PENDING`; Architecture `PENDING`; Verification `PENDING`.
