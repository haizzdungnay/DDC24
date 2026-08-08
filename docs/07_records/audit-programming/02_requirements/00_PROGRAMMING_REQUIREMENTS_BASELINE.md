# Baseline yêu cầu Programming DDC-24 Rev A

**ID:** REQBASE-PROG-001  
**Phiên bản:** 1.0  
**Trạng thái:** CONTROLLED BASELINE  
**Nguồn:** `PROD-PROG-001` và snapshot `REQUIREMENTS.md`  
**Ngày baseline:** 2026-08-08

## 1. Quy tắc requirement

Các câu dưới đây giữ nguyên nghĩa normative của nguồn. Từ “phải” biểu thị nghĩa
vụ có thể kiểm chứng. Thiết kế, source hiện có hoặc prototype không được làm yếu
requirement. Mọi giá trị chưa chốt tham chiếu Open Decision thay vì đoán.

## 2. Yêu cầu System/Software/Interface/NFR

| ID | Layer | Requirement baseline | Feature |
|---|---|---|---|
| SYS-REQ-PROG-001 | System | Hệ thống phải cung cấp đúng phạm vi Rev A: Project/Program với ST và FBD, ba loại Point và ba cycle time; phải từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC. | FSP-001..005, 009 |
| SYS-REQ-PROG-002 | System | Hệ thống phải duy trì state authority riêng cho Revision, Deployment, Activation, Revision active và Rollback; một state không được suy diễn thành state kế tiếp. | FSP-006 |
| SYS-REQ-PROG-003 | System | Program active phải tiếp tục control local khi Web/engineering client mất kết nối, trong fault policy được phê duyệt. | FSP-005, 008 |
| SWR-REQ-PROG-001 | Software | Layer Programming phải bảo toàn identity và quan hệ Project → Program → Revision, đồng thời giữ Revision dùng cho Deployment bất biến. | FSP-001 |
| SWR-REQ-PROG-002 | Software | Phải validate và thực thi ST theo cùng semantic được phê duyệt; lỗi có vị trí/mã truy nguyên và chặn Deployment. | FSP-003 |
| SWR-REQ-PROG-003 | Software | Phải validate và thực thi FBD theo semantic được phê duyệt; lỗi block/connection/type chặn Deployment. | FSP-004 |
| SWR-REQ-PROG-004 | Software | Chỉ được expose Local Physical I/O, Virtual Point và Modbus RTU Point cho I/O Mapping; loại ngoài allowlist phải bị từ chối. | FSP-002, 009 |
| SWR-REQ-PROG-005 | Software | Phải phân biệt Point/Variable và validate mapping về identity, direction, type, read/write, quality và compatibility trước Revision deployable. | FSP-002 |
| SWR-REQ-PROG-006 | Software | Scheduler chỉ nhận cycle 1 s, 5 s hoặc 30 s; chạy deterministic theo rule approved và quan sát được cycle/overrun/fault. | FSP-005 |
| SWR-REQ-PROG-007 | Software | Tạo/sửa Project hoặc Program phải sinh Revision mới; không thay nội dung Revision đã dùng cho Deployment. | FSP-001, 006 |
| SWR-REQ-PROG-008 | Software | Deployment phải validate trước runtime accept; Activation chỉ ở cyclic boundary; lỗi giữ active Revision trước đó; Rollback trả authority result. | FSP-006 |
| SWR-REQ-PROG-009 | Software | Persistence phải lưu/phục hồi RETAIN theo policy approved và chặn state không tương thích Revision/type. | FSP-007 |
| SWR-REQ-PROG-010 | Software | Online Monitor dùng authority data, biểu diễn timestamp/quality/stale/unavailable đúng và không tự cấp write/force/online change. | FSP-008 |
| SWR-REQ-PROG-011 | Software/Security | Sửa Project, tạo Revision, Deployment, Activation và Rollback phải kiểm quyền và audit actor/action/target Revision/time/result. | FSP-006, 009 |
| SWR-REQ-PROG-012 | Software | Validation/runtime/Point quality/overrun/client-loss phải quan sát được và không tạo uncontrolled output hoặc UI false-success. | FSP-005, 008 |
| IF-REQ-PROG-001 | Interface | I/O Mapping phải biểu diễn Point identity/category, Variable identity, direction, type, unit/range khi áp dụng, quality và access; RTU Point không thể nhầm TCP Point. | FSP-002 |
| IF-REQ-PROG-002 | Interface | Lifecycle/monitor phải trả state Revision/Deployment/Activation/Rollback và monitor data từ authority, có correlation và stable error result. | FSP-006, 008 |
| NFR-REQ-PROG-001 | Non-functional | Client restart/disconnect không được tự dừng Program active; reconnect không blind replay mutation. | FSP-005, 008, 009 |
| NFR-REQ-PROG-002 | Non-functional | Runtime phải đạt budget approved cho cycle 1/5/30 s trên production target và phát hiện/báo overrun; limit cụ thể theo OD-PROG-012. | FSP-005 |

## 3. Coverage và chất lượng

| Kiểm tra | Kết quả |
|---|---:|
| Yêu cầu layer có stable ID | 19/19 |
| Có nguồn Product/Feature | 19/19 |
| Có Verification Requirement | 19/19 qua Traceability Matrix |
| Giá trị TBD được nối Open Decision | Có |
| Bằng chứng production đạt | 0/13 VR; gate RED |

## 4. Requirement không còn authority cho Programming

Các requirement graph legacy hoặc `SYS-REQ-MBRTU-*` không thay thế bộ
`*-REQ-PROG-*`. Chúng chỉ là dependency input khi có trace cụ thể. Với Modbus,
ADR-024 mới hơn quyết định một bus vật lý và capacity ≥256; mọi câu “hai port”
hoặc “64 Point” trong snapshot cũ được ghi tại Conflict Register là superseded.
