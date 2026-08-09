# Đăng ký quyết định mở Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-OD-PROG-001-AUD` |
| Phiên bản | 2.0 |
| Trạng thái | `CONTROLLED / IN REVIEW` |
| Ngày cập nhật | 2026-08-09 |

## Mục lục

1. Register
2. Quy tắc đóng
3. Thuật ngữ
4. Lịch sử
5. Phê duyệt

## 1. Register

`Proposed answer (v2.2)` là input review, không phải quyết định. Trạng thái cột
cuối giữ nguyên từ baseline.

| ID | Quyết định cần có | Owner | Proposed answer (v2.2) | Trạng thái |
|---|---|---|---|---|
| OD-PROG-001 | Ma trận role cho xem/sửa/tạo Revision/Deploy/Activate/Rollback | Product + Security | Chưa đề xuất đóng; Product §22.3 chỉ là permission proposal | OPEN |
| OD-PROG-002 | Type, conversion, overflow, initialization chung ST/FBD/Point/Variable | Product + Runtime | Product §12.1–12.4 đề xuất type subset và ma trận `IEC type × Point kind × direction`; cần authority phê duyệt | OPEN |
| OD-PROG-003 | Capacity Project/Program/Revision/Point/Variable/logic | Product | Product §5.3/§9.2/§26 đề xuất Rev A một Task và acceptance bounds; 8/16/32 OUT Rev A | OPEN; Modbus Point riêng `>=256` theo ADR-024 |
| OD-PROG-004 | Số Program active, cycle theo Program/Task, thứ tự chạy | Product + Runtime | Product §9.2/§14.1–14.2 đề xuất một Task, cycle `1/5/30 s`, deterministic order; base step độc lập Task period | OPEN |
| OD-PROG-005 | Function/function block library, semantics, version | Product + Controls | Product §11 giữ Core Library tối thiểu IN, BACS Library nâng cao OUT | OPEN |
| OD-PROG-006 | FBD authoring, connection rule, exchange format | Product + UX | Product §10.3 và UX §8.6/§15 đề xuất structured typed editor có keyboard path, free-form wiresheet OUT | OPEN |
| OD-PROG-007 | Contract Local/Virtual/RTU Point và I/O Mapping | Product + I/O | Product §12.4/§13 đề xuất discriminated identity và allowlist ba loại | PARTIAL: RTU theo ADR-024; phần chung/Local/Virtual OPEN |
| OD-PROG-008 | RTU FC/endian/poll/timeout/stale/retry/error | Product + Fieldbus | Product §13 chỉ giữ identity/type/quality ceiling; không tự chốt protocol detail | PARTIAL: ADR-024 quyết định mô hình/owner/retry; chi tiết/evidence mở |
| OD-PROG-009 | RETAIN qua warm/cold/power/revision/type và wear | Product + Runtime | Product §18 và §16.7 đề xuất RETAIN IN Rev A, compatibility manifest và explicit reset; cần HIL/policy duyệt | OPEN |
| OD-PROG-010 | Revision retention/compatibility và lifecycle/power loss | Product + System | Chưa có proposed answer đủ để đóng; Product §16 chỉ cho invariant LKG/atomic | OPEN |
| OD-PROG-011 | Monitor refresh/trace/retention/timestamp/quality/write-force | Product + UX | Product §20/§26 và UX §12 đề xuất 1 Hz, stale sau 3 kỳ, trace bounded; vẫn là acceptance proposal | OPEN |
| OD-PROG-012 | WCET/budget/overrun/fault cho `1/5/30 s` | Product + Runtime | Product §14.3/§14.6/§26 đề xuất fault mức Task, resource isolation và watchdog theo base step | OPEN |
| OD-PROG-013 | Migration graph 28-node và node TCP/BACnet ngoài scope | Product + Architecture | Product §14.6 đề xuất `GRAPH_ONLY/PROGRAM_ONLY/DUAL_INVALID`, fail closed, không trộn mức 5 | OPEN |
| OD-PROG-014 | Đồng tồn tại/chuyển config cũ trên thiết bị | Product + Operations | Product §14.6 đề xuất backup/confirmation/rollback plan và từ chối dual-run; chưa khóa migration transaction | OPEN; Modbus atomic config/LKG theo ADR-024 |
| OD-PROG-015 | Product approval và readiness gate | Product + QA | Hai proposal v2.2 còn sign-off PENDING; amendment chưa thay baseline | OPEN |

## 2. Quy tắc đóng

Một mục chỉ được chuyển `CLOSED` khi ADR/biên bản phê duyệt ghi lựa chọn, ngày,
owner, tài liệu bị thay, requirement/verification phải cập nhật và impact tới
Conflict/Trace. Proposal, source hoặc host test không tự đóng quyết định.

## 3. Thuật ngữ

Xem [Data Dictionary](02_TERMS_AND_DATA_DICTIONARY.md).

## 4. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Chuẩn hóa OD-PROG-001..015. |
| 2.0 | 2026-08-09 | Thêm cột proposed answer v2.2 cho 002/003/004/006/009/012/013/014; giữ nguyên trạng thái. |

## 5. Phê duyệt

| Vai trò | Quyết định |
|---|---|
| Product Owner | `PENDING` |
| Software/Runtime Architect | `PENDING` |
| Controls/Safety Reviewer | `PENDING` |
| Verification Lead | `PENDING` |
