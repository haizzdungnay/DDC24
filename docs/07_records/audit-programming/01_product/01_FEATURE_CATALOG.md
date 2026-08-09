# Danh mục Feature Programming DDC-24 Rev A

| Thuộc tính | Giá trị |
|---|---|
| ID | `FCAT-PROG-001` |
| Phiên bản | 2.0 |
| Trạng thái | `IN REVIEW` |
| Nguồn cấp trên | `PROD-PROG-001` + amendment v2.2 |

## Mục lục

1. Danh mục
2. Ranh giới Rev A
3. Coverage
4. Thuật ngữ
5. Lịch sử
6. Phê duyệt

## 1. Danh mục

| Feature Spec | Tên feature | PC/PR authority | Proposal/VS chính | Trạng thái |
|---|---|---|---|---|
| [FSP-PROG-001](features/FSP-PROG-001_PROJECT_PROGRAM_REVISION.md) | Project, Program, Revision | PC-PROG-001; PR-PROG-001, PR-PROG-007 | PRG-BACS-001, PRG-BACS-002; VS-PROG-001 | In Review |
| [FSP-PROG-002](features/FSP-PROG-002_POINT_VARIABLE_IO_MAPPING.md) | Point, Variable, I/O Mapping | PC-PROG-002, PC-PROG-003, PC-PROG-004, PC-PROG-005; PR-PROG-003, PR-PROG-004 | PRG-PT-001, PRG-PT-002, PRG-PT-003, PRG-PT-004; VS-PROG-017, VS-PROG-018 | In Review |
| [FSP-PROG-003](features/FSP-PROG-003_STRUCTURED_TEXT.md) | Structured Text | PC-PROG-006; PR-PROG-002, PR-PROG-006 | PRG-IEC-001, PRG-IEC-002, PRG-IEC-004; VS-PROG-005, VS-PROG-006, VS-PROG-007 | In Review |
| [FSP-PROG-004](features/FSP-PROG-004_FUNCTION_BLOCK_DIAGRAM.md) | Structured FBD | PC-PROG-007; PR-PROG-002, PR-PROG-006 | PRG-IEC-001, PRG-IEC-005; VS-PROG-005, VS-PROG-006, VS-PROG-028 | In Review |
| [FSP-PROG-005](features/FSP-PROG-005_CYCLIC_RUNTIME.md) | Một Task, cycle 1/5/30 s | PC-PROG-008; PR-PROG-005, PR-PROG-012 | PRG-IEC-003, PRG-RT-001, PRG-RT-005, PRG-RT-006, PRG-RT-010; VS-PROG-009, VS-PROG-012, VS-PROG-013, VS-PROG-016 | In Review |
| [FSP-PROG-006](features/FSP-PROG-006_DEPLOY_ACTIVATE_ROLLBACK.md) | Check/Đưa vào vận hành/Khôi phục | PC-PROG-009; PR-PROG-006, PR-PROG-007, PR-PROG-008, PR-PROG-009,013 | PRG-RT-003, PRG-RT-004, PRG-COM-001, PRG-COM-002, PRG-COM-003, PRG-COM-004; VS-PROG-011, VS-PROG-019 | In Review |
| [FSP-PROG-007](features/FSP-PROG-007_RETAIN.md) | RETAIN và phục hồi | PC-PROG-010; PR-PROG-010 | PRG-COM-002, PRG-COM-004; VS-PROG-029 | In Review |
| [FSP-PROG-008](features/FSP-PROG-008_ONLINE_MONITOR.md) | Online Monitor | PC-PROG-011; PR-PROG-011, PR-PROG-012 | PRG-UX-002, PRG-UX-003, PRG-UX-006; VS-PROG-026, VS-PROG-027 | In Review |
| [FSP-PROG-009](features/FSP-PROG-009_ACCESS_AUDIT_SCOPE_GUARD.md) | RBAC, audit, scope guard | PC-PROG-012; PR-PROG-013, PR-PROG-014 | PRG-SEC-001, PRG-SEC-002, PRG-SEC-003, PRG-SEC-004, PRG-SEC-005; VS-PROG-022, VS-PROG-023, VS-PROG-024 | In Review |
| [FSP-PROG-010](features/FSP-PROG-010_REPLACEMENT_BUNDLE.md) | Bundle source-only thay controller | PC-PROG-001, PC-PROG-009, PC-PROG-012; PR-PROG-001, PR-PROG-007, PR-PROG-009, PR-PROG-014 | PRG-COM-006; VS-PROG-021, VS-PROG-023 | In Review |
| [FSP-PROG-011](features/FSP-PROG-011_GRAPH_PROGRAMMING_CUTOVER.md) | Cutover graph ↔ Programming | PC-PROG-008, PC-PROG-009, PC-PROG-012; PR-PROG-009, PR-PROG-012, PR-PROG-014 | PRG-RT-009; VS-PROG-015 | In Review |
| [FSP-PROG-012](features/FSP-PROG-012_ARBITRATION_TRANSPARENCY.md) | Arbitration transparency/bumpless | PC-PROG-002, PC-PROG-009, PC-PROG-011; PR-PROG-004, PR-PROG-009, PR-PROG-011 | PRG-RT-002, PRG-RT-007, PRG-RT-008, PRG-COM-005; VS-PROG-010, VS-PROG-014, VS-PROG-020 | In Review |

## 2. Ranh giới Rev A

- FBD Rev A là structured typed editor; free-form wiresheet/canvas OUT.
- Core Control Library tối thiểu IN; BACS Library nâng cao OUT.
- RETAIN và integrity hash IN; trusted-origin signature OUT.
- Rev A có một Task; multi-task và limit 8/16/32 OUT.
- Bundle import/export IN nhưng source-only, build lại target, không auto-activate.
- Full functional/as-built panel/PDF OUT; basic Revision metadata IN.

## 3. Coverage

| Đối tượng | Coverage tài liệu | Evidence production |
|---|---:|---:|
| Product Capability authority | 12/12 | Chưa đủ claim implemented |
| Product Requirement authority | 14/14 | Chưa đủ claim implemented |
| Feature Spec | 12/12 có PC/PR + VS | 0/12 feature đạt production |
| Verification Requirement | 13/13 có scenario liên quan | **0/13 PASS** |

## 4. Thuật ngữ

Xem [Data Dictionary](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 5. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | 9 Feature Spec audit baseline. |
| 2.0 | 2026-08-09 | Đồng bộ Rev A v2.2 và thêm FSP-PROG-010, FSP-PROG-011, FSP-PROG-012 cho bundle, cutover, arbitration. |

## 6. Phê duyệt

| Vai trò | Quyết định |
|---|---|
| Product Owner | `PENDING` |
| Software/Runtime Architect | `PENDING` |
| Controls/Safety Reviewer | `PENDING` |
| Verification Lead | `PENDING` |
