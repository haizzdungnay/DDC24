# Đăng ký quyết định mở Programming đã chuẩn hóa

**ID:** PROG-OD-001-AUD  
**Phiên bản:** 1.0  
**Ngày chuẩn hóa:** 2026-08-08  
**Nguồn:** snapshot `PROGRAMMING_OPEN_DECISIONS.md` ngày 2026-08-03 và ADR-024 ngày 2026-08-05  
**Trạng thái:** IN REVIEW

| ID | Quyết định cần có | Owner | Ảnh hưởng | Trạng thái chuẩn hóa |
|---|---|---|---|---|
| OD-PROG-001 | Ma trận role cho xem/sửa/tạo Revision/Deploy/Activate/Rollback | Product + Security | RBAC, audit, VR-011 | OPEN; Modbus giữ viewer/operator/admin theo ADR-024 |
| OD-PROG-002 | Type, conversion, overflow, initialization dùng chung ST/FBD/Point/Variable | Product + Runtime | Compiler, mapping, monitor | OPEN |
| OD-PROG-003 | Capacity Project/Program/Revision/Point/Variable/logic | Product | Sizing, storage, performance | OPEN; Modbus Point riêng ≥256 theo ADR-024 |
| OD-PROG-004 | Số Program active, cycle theo Program/task, thứ tự chạy | Product + Runtime | Scheduler semantics | OPEN |
| OD-PROG-005 | Function/function block library, semantics và version | Product + Controls | ST/FBD validation/runtime | OPEN |
| OD-PROG-006 | FBD authoring, connection rule, exchange format | Product + UX | FE, persistence, compiler | OPEN |
| OD-PROG-007 | Contract thuộc tính Local/Virtual/RTU Point và I/O Mapping | Product + I/O | Schema/API/runtime | PARTIAL: phần RTU theo ADR-024; phần chung/Local/Virtual OPEN |
| OD-PROG-008 | RTU FC/endian/poll/timeout/stale/retry/error | Product + Fieldbus | RTU contract/HIL | PARTIAL: ADR-024 quyết định mô hình/owner/retry; chi tiết đồng bộ/evidence còn mở |
| OD-PROG-009 | RETAIN qua warm/cold/power/revision/type và wear | Product + Runtime | Persistence/recovery | OPEN |
| OD-PROG-010 | Revision retention/compatibility và transaction lifecycle/power loss | Product + System | Deploy/activate/rollback | OPEN |
| OD-PROG-011 | Monitor refresh/trace/retention/timestamp/quality/write-force separation | Product + UX | API/UI/observability | OPEN |
| OD-PROG-012 | WCET/budget/overrun/fault cho 1/5/30 s | Product + Runtime | Performance/safety behavior | OPEN |
| OD-PROG-013 | Migration graph 28-node và node TCP/BACnet ngoài scope | Product + Architecture | Compatibility/import | OPEN |
| OD-PROG-014 | Đồng tồn tại/chuyển đổi config cũ trên thiết bị | Product + Operations | Upgrade/rollback | OPEN; Modbus atomic config/LKG theo ADR-024 |
| OD-PROG-015 | Product approval và tiêu chí readiness gate | Product + QA | Quyền bắt đầu/đóng Design | OPEN |

## Quy tắc đóng

Một mục chỉ được chuyển `CLOSED` khi có ADR/biên bản phê duyệt nêu rõ lựa chọn,
ngày hiệu lực, owner, tài liệu bị thay thế và requirement/verification cần cập
nhật. Prototype, source code hoặc test host không tự đóng Open Decision.
