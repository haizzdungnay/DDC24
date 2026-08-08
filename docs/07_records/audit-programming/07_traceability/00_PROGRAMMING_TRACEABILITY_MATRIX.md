# Ma trận truy vết Programming DDC-24 Rev A

**ID:** TRACE-PROG-001-AUD  
**Phiên bản:** 1.0  
**Trạng thái:** CONTROLLED BASELINE  
**Ngày:** 2026-08-08

## 1. Truy vết Product → Feature → Requirement → Verification

| Capability | Product Requirement | Feature Spec | Layer Requirement | Verification | Tài liệu | Production evidence |
|---|---|---|---|---|---|---|
| PC-PROG-001 | PR-PROG-001, 007 | FSP-PROG-001 | SYS-001; SWR-001, 007 | VR-001, 002 | DOCUMENTED | MISSING |
| PC-PROG-006 | PR-PROG-002, 006 | FSP-PROG-003 | SYS-001; SWR-002 | VR-001, 004 | DOCUMENTED | MISSING |
| PC-PROG-007 | PR-PROG-002, 006 | FSP-PROG-004 | SYS-001; SWR-003 | VR-001, 005 | DOCUMENTED | MISSING |
| PC-PROG-003 | PR-PROG-003, 004 | FSP-PROG-002 | SWR-004, 005; IF-001 | VR-003 | DOCUMENTED | MISSING |
| PC-PROG-004 | PR-PROG-003, 004 | FSP-PROG-002 | SWR-004, 005; IF-001 | VR-003 | DOCUMENTED | MISSING |
| PC-PROG-005 | PR-PROG-003, 004 | FSP-PROG-002 | SWR-004, 005; IF-001; RTU dependency | VR-003; RTU dependent VR | DOCUMENTED | MISSING |
| PC-PROG-002 | PR-PROG-004 | FSP-PROG-002 | SWR-005; IF-001 | VR-003 | DOCUMENTED | MISSING |
| PC-PROG-008 | PR-PROG-005 | FSP-PROG-005 | SWR-006; NFR-002 | VR-006 | DOCUMENTED | MISSING |
| PC-PROG-009 | PR-PROG-006..009 | FSP-PROG-006 | SYS-002; SWR-007, 008; IF-002 | VR-007, 008 | DOCUMENTED | MISSING |
| PC-PROG-010 | PR-PROG-010 | FSP-PROG-007 | SWR-009 | VR-009 | DOCUMENTED | MISSING |
| PC-PROG-011 | PR-PROG-011 | FSP-PROG-008 | SWR-010; IF-002 | VR-010 | DOCUMENTED | MISSING |
| PC-PROG-001, 009 | PR-PROG-013 | FSP-PROG-006, 009 | SWR-011 | VR-011 | DOCUMENTED | MISSING |
| PC-PROG-001..011 | PR-PROG-012 | FSP-PROG-005, 008 | SYS-003; SWR-012; NFR-001 | VR-012 | DOCUMENTED | MISSING |
| PC-PROG-012 | PR-PROG-014 | FSP-PROG-009 | SYS-001; SWR-004 | VR-013 | DOCUMENTED | MISSING |

`SYS-001` trong bảng là viết gọn của `SYS-REQ-PROG-001`; tương tự cho
`SWR-*`, `IF-*`, `NFR-*`. ID đầy đủ nằm trong Requirement Baseline.

## 2. Coverage

| Layer | Coverage tài liệu | Evidence production |
|---|---:|---:|
| Product Capability | 12/12 | Chưa đủ claim implemented |
| Product Requirement | 14/14 | Chưa đủ claim implemented |
| Feature Spec | 9/9 có Product/VR link | 0/9 feature đạt production |
| System/Software/Interface/NFR | 19/19 | Chưa đủ claim implemented |
| Verification Requirement | 13/13 mapped | **0/13 PASS** |

## 3. Truy vết conflict/open decision

| Chủ đề | Requirement/Feature bị ảnh hưởng | Decision/conflict |
|---|---|---|
| RBAC/audit | FSP-001, 006, 009; SWR-011 | OD-001; CONF-008 |
| Type/library/FBD | FSP-002..004 | OD-002/005/006; CONF-002/009 |
| Capacity/scheduling/cycle | FSP-001, 005 | OD-003/004/012; CONF-003/010 |
| I/O Mapping/RTU | FSP-002; IF-001 | OD-007/008; CONF-006/007/008 |
| RETAIN/lifecycle | FSP-006/007 | OD-009/010/014; CONF-011 |
| Monitor | FSP-008 | OD-011 |
| Legacy migration | FSP-004/009 | OD-013/014; CONF-002/012 |
| Readiness | Toàn bộ | OD-015; CONF-013 |

## 4. Quy tắc cập nhật

Không được chuyển evidence từ `MISSING` sang `PASS` chỉ bằng link source/test.
Phải dẫn tới record của chính VR, có expected/actual và target metadata; khi
requirement đổi phải chạy impact theo cả hàng và cột liên quan.
