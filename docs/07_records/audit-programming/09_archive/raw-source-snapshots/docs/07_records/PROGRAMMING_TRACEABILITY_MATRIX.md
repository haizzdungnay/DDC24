# Programming Traceability Matrix — DDC-24 Rev A

**ID:** TRACE-PROG-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03 (bổ sung dependency design/gate Modbus RTU Point)
**Phạm vi:** Product Capability → Product Requirement → System Requirement → Verification Requirement

## Quy tắc đọc

Ma trận này chứng minh chuỗi truy xuất tài liệu, không chứng minh implementation
hoặc test pass. `DOCUMENTED` nghĩa là chuỗi ID đã được định nghĩa. Tất cả evidence
Programming production hiện vẫn `MISSING/RED` theo `VERIFICATION.md`.

| Product Capability | Product Requirement | System Requirement | Verification Requirement | Trạng thái chuỗi | Trạng thái evidence production |
|---|---|---|---|---|---|
| PC-PROG-001 | PR-PROG-001 | SYS-REQ-PROG-001; SWR-REQ-PROG-001 | VR-PROG-001; VR-PROG-002 | DOCUMENTED | MISSING |
| PC-PROG-006 | PR-PROG-002; PR-PROG-006 | SYS-REQ-PROG-001; SWR-REQ-PROG-002 | VR-PROG-001; VR-PROG-004 | DOCUMENTED | MISSING |
| PC-PROG-007 | PR-PROG-002; PR-PROG-006 | SYS-REQ-PROG-001; SWR-REQ-PROG-003 | VR-PROG-001; VR-PROG-005 | DOCUMENTED | MISSING |
| PC-PROG-003 | PR-PROG-003; PR-PROG-004 | SWR-REQ-PROG-004; SWR-REQ-PROG-005; IF-REQ-PROG-001 | VR-PROG-003 | DOCUMENTED | MISSING |
| PC-PROG-004 | PR-PROG-003; PR-PROG-004 | SWR-REQ-PROG-004; SWR-REQ-PROG-005; IF-REQ-PROG-001 | VR-PROG-003 | DOCUMENTED | MISSING |
| PC-PROG-005 | PR-PROG-003; PR-PROG-004 | SWR-REQ-PROG-004; SWR-REQ-PROG-005; IF-REQ-PROG-001; SYS-REQ-MBRTU-001; SWR-REQ-MBRTU-001..009; IF-REQ-MBRTU-001..004; SEC-REQ-MBRTU-001; NFR-REQ-MBRTU-001..003 | VR-PROG-003; VR-MBRTU-001..012 | DOCUMENTED; design dependency In Review | MISSING |
| PC-PROG-002 | PR-PROG-004 | SWR-REQ-PROG-005; IF-REQ-PROG-001 | VR-PROG-003 | DOCUMENTED | MISSING |
| PC-PROG-008 | PR-PROG-005 | SWR-REQ-PROG-006; NFR-REQ-PROG-002 | VR-PROG-006 | DOCUMENTED | MISSING |
| PC-PROG-009 | PR-PROG-006; PR-PROG-007; PR-PROG-008; PR-PROG-009 | SYS-REQ-PROG-002; SWR-REQ-PROG-007; SWR-REQ-PROG-008; IF-REQ-PROG-002 | VR-PROG-007; VR-PROG-008 | DOCUMENTED | MISSING |
| PC-PROG-010 | PR-PROG-010 | SWR-REQ-PROG-009 | VR-PROG-009 | DOCUMENTED | MISSING |
| PC-PROG-011 | PR-PROG-011 | SWR-REQ-PROG-010; IF-REQ-PROG-002 | VR-PROG-010 | DOCUMENTED | MISSING |
| PC-PROG-001; PC-PROG-009 | PR-PROG-013 | SWR-REQ-PROG-011 | VR-PROG-011 | DOCUMENTED | MISSING |
| PC-PROG-001..011 | PR-PROG-012 | SYS-REQ-PROG-003; SWR-REQ-PROG-012; NFR-REQ-PROG-001 | VR-PROG-012 | DOCUMENTED | MISSING |
| PC-PROG-012 | PR-PROG-014 | SYS-REQ-PROG-001; SWR-REQ-PROG-004 | VR-PROG-013 | DOCUMENTED | MISSING |

## Coverage

- Product Capability: 12/12 có ánh xạ.
- Product Requirement: 14/14 có ánh xạ.
- System/Software/Interface/NFR Requirement Programming: 19/19 có Verification Requirement.
- Verification Requirement: 13/13 có ít nhất một upstream requirement.
- Dependency Modbus RTU Point: 18/18 requirement có ánh xạ tới
  `VR-MBRTU-001..012`; design `DDD-SW-MBRTU-POINT-001` đang `In Review`, mọi
  real-hardware gate vẫn RED.
- Bằng chứng runtime production/target: 0/13 gate được đóng trong nhiệm vụ tài
  liệu này.

Host unit test của ST, parser, typed artifact hoặc cyclic component không được
dùng để đổi cột evidence production sang `PASS`. Chỉ evidence chạy đúng
production path trên target, kèm identity artifact/Revision, command, log và
acceptance result, mới đủ điều kiện đóng gate tương ứng.
