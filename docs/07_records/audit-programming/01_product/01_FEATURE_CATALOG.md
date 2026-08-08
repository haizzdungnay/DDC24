# Danh mục Feature Programming DDC-24 Rev A

**ID:** FCAT-PROG-001  
**Phiên bản:** 1.0  
**Trạng thái:** IN REVIEW  
**Nguồn cấp trên:** [PROD-PROG-001](00_PROGRAMMING_PRODUCT_SPEC.md)

## 1. Danh mục

| Feature Spec | Tên feature | Product Capability | Product Requirement | VR chính | Trạng thái |
|---|---|---|---|---|---|
| [FSP-PROG-001](features/FSP-PROG-001_PROJECT_PROGRAM_REVISION.md) | Project, Program và Revision | PC-001 | PR-001, PR-007 | VR-002 | In Review |
| [FSP-PROG-002](features/FSP-PROG-002_POINT_VARIABLE_IO_MAPPING.md) | Point, Variable và I/O Mapping | PC-002..005 | PR-003, PR-004 | VR-003 | In Review |
| [FSP-PROG-003](features/FSP-PROG-003_STRUCTURED_TEXT.md) | Structured Text | PC-006 | PR-002, PR-006 | VR-004 | In Review |
| [FSP-PROG-004](features/FSP-PROG-004_FUNCTION_BLOCK_DIAGRAM.md) | Function Block Diagram | PC-007 | PR-002, PR-006 | VR-005 | In Review |
| [FSP-PROG-005](features/FSP-PROG-005_CYCLIC_RUNTIME.md) | Cyclic runtime 1/5/30 giây | PC-008 | PR-005, PR-012 | VR-006, VR-012 | In Review |
| [FSP-PROG-006](features/FSP-PROG-006_DEPLOY_ACTIVATE_ROLLBACK.md) | Deployment, Activation và Rollback | PC-009 | PR-006..009, PR-013 | VR-007, VR-008, VR-011 | In Review |
| [FSP-PROG-007](features/FSP-PROG-007_RETAIN.md) | RETAIN và phục hồi | PC-010 | PR-010 | VR-009 | In Review |
| [FSP-PROG-008](features/FSP-PROG-008_ONLINE_MONITOR.md) | Online Monitor | PC-011 | PR-011, PR-012 | VR-010, VR-012 | In Review |
| [FSP-PROG-009](features/FSP-PROG-009_ACCESS_AUDIT_SCOPE_GUARD.md) | Phân quyền, audit và bảo vệ scope | PC-012; xuyên suốt | PR-013, PR-014 | VR-011, VR-013 | In Review |

## 2. Coverage

| Đối tượng Product | Coverage feature |
|---|---:|
| Product Capability | 12/12 |
| Product Requirement | 14/14 |
| Feature có Verification Requirement | 9/9 |
| Feature có bằng chứng production đạt | 0/9 |

Feature coverage đầy đủ chỉ chứng minh Product đã được phân rã thành đơn vị quản
lý được. Nó không chứng minh design, implementation hoặc release đã hoàn tất.

## 3. Ranh giới chung

Tất cả feature chỉ chấp nhận ST/FBD, Local Physical I/O/Virtual Point/Modbus RTU
Point và cycle 1/5/30 giây. LD, SFC, Modbus TCP Point, BACnet/IP Point, motion,
safety PLC và online change nằm ngoài scope Rev A.
