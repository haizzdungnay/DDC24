# Baseline yêu cầu Programming DDC-24 Rev A

| Thuộc tính | Giá trị |
|---|---|
| ID | `REQBASE-PROG-001` |
| Phiên bản | 2.0 controlled copy |
| Trạng thái | `CONTROLLED BASELINE / ACTIVE` |
| Nguồn authority | `PROD-PROG-001` và `docs/02_requirements/REQUIREMENTS.md` |
| Ngày baseline | 2026-08-08 |
| Amendment relation | `PRG-*`/`UX-REQ-*` v2.2 chỉ `PROPOSED`, không thay baseline |

## Mục lục

1. Quy tắc requirement
2. Baseline System/Software/Interface/NFR
3. Quan hệ amendment v2.2
4. Coverage và evidence
5. Thuật ngữ
6. Lịch sử
7. Phê duyệt

## 1. Quy tắc requirement

Các câu dưới đây giữ nghĩa normative của authority. Từ “phải” biểu thị nghĩa vụ
có thể kiểm chứng. Thiết kế/source/prototype không được làm yếu requirement.
Giá trị chưa chốt phải trỏ Open Decision. Cột evidence giữ `MISSING/RED`; trace
tài liệu không được đổi thành PASS.

## 2. Baseline System/Software/Interface/NFR

| ID | Requirement baseline | Feature | Verification | Evidence |
|---|---|---|---|---|
| SYS-REQ-PROG-001 | Hệ thống phải cung cấp đúng Project/Program ST/FBD, ba loại Point và cycle 1/5/30 s; phải từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC. | FSP-PROG-001..005,009 | VR-PROG-001, VR-PROG-013 | MISSING / RED |
| SYS-REQ-PROG-002 | Hệ thống phải duy trì authority state riêng cho Revision, Deployment, Activation, Active Revision và Rollback; không suy diễn state kế tiếp. | FSP-PROG-006 | VR-PROG-007, VR-PROG-008 | MISSING / RED |
| SYS-REQ-PROG-003 | Program active phải tiếp tục control local khi Web/engineering client mất kết nối trong fault policy đã phê duyệt. | FSP-PROG-005, FSP-PROG-008 | VR-PROG-012 | MISSING / RED |
| SWR-REQ-PROG-001 | Layer Programming phải bảo toàn identity Project→Program→Revision và giữ Revision dùng cho Deployment bất biến. | FSP-PROG-001 | VR-PROG-002 | MISSING / RED |
| SWR-REQ-PROG-002 | Phải validate/thực thi ST theo cùng semantic; lỗi có vị trí/mã truy nguyên và chặn Deployment. | FSP-PROG-003 | VR-PROG-004 | MISSING / RED |
| SWR-REQ-PROG-003 | Phải validate/thực thi FBD theo semantic đã phê duyệt; lỗi block/connection/type chặn Deployment. | FSP-PROG-004 | VR-PROG-005 | MISSING / RED |
| SWR-REQ-PROG-004 | Chỉ được expose Local Physical I/O, Virtual Point, Modbus RTU Point cho I/O Mapping; loại ngoài allowlist phải bị từ chối. | FSP-PROG-002, FSP-PROG-009 | VR-PROG-003, VR-PROG-013 | MISSING / RED |
| SWR-REQ-PROG-005 | Phải phân biệt Point/Variable và validate identity, direction, type, read/write, quality, compatibility trước Revision deployable. | FSP-PROG-002 | VR-PROG-003 | MISSING / RED |
| SWR-REQ-PROG-006 | Scheduler chỉ nhận cycle 1/5/30 s; chạy deterministic theo rule approved và quan sát được cycle/overrun/fault. | FSP-PROG-005 | VR-PROG-006 | MISSING / RED |
| SWR-REQ-PROG-007 | Tạo/sửa Project/Program phải sinh Revision mới; không thay nội dung Revision đã dùng cho Deployment. | FSP-PROG-001, FSP-PROG-006 | VR-PROG-002, VR-PROG-007 | MISSING / RED |
| SWR-REQ-PROG-008 | Deployment phải validate trước runtime accept; Activation tại cyclic boundary; lỗi giữ Active cũ; Rollback trả authority result. | FSP-PROG-006 | VR-PROG-007, VR-PROG-008 | MISSING / RED |
| SWR-REQ-PROG-009 | Persistence phải lưu/phục hồi RETAIN theo policy approved và chặn state không tương thích Revision/type. | FSP-PROG-007 | VR-PROG-009 | MISSING / RED |
| SWR-REQ-PROG-010 | Online Monitor dùng authority data, đúng timestamp/quality/stale/unavailable và không tự cấp write/force/online change. | FSP-PROG-008 | VR-PROG-010 | MISSING / RED |
| SWR-REQ-PROG-011 | Lifecycle mutation phải kiểm quyền và audit actor/action/target Revision/time/result. | FSP-PROG-006, FSP-PROG-009 | VR-PROG-011 | MISSING / RED |
| SWR-REQ-PROG-012 | Validation/runtime/Point quality/overrun/client-loss phải quan sát được, không tạo uncontrolled output hoặc UI false-success. | FSP-PROG-005, FSP-PROG-008 | VR-PROG-012 | MISSING / RED |
| IF-REQ-PROG-001 | I/O Mapping phải biểu diễn Point identity/category, Variable identity, direction, type, unit/range, quality, access; RTU không thể nhầm TCP. | FSP-PROG-002 | VR-PROG-003 | MISSING / RED |
| IF-REQ-PROG-002 | Lifecycle/monitor phải trả authority state, correlation và stable error result. | FSP-PROG-006, FSP-PROG-008 | VR-PROG-007, VR-PROG-008, VR-PROG-010 | MISSING / RED |
| NFR-REQ-PROG-001 | Client restart/disconnect không được tự dừng Program active; reconnect không blind replay mutation. | FSP-PROG-005, FSP-PROG-008, FSP-PROG-009 | VR-PROG-012 | MISSING / RED |
| NFR-REQ-PROG-002 | Runtime phải đạt budget approved cho cycle 1/5/30 s trên production target và phát hiện/báo overrun; limit theo OD-PROG-012. | FSP-PROG-005 | VR-PROG-006 | MISSING / RED |

## 3. Quan hệ amendment v2.2

41 `PRG-*` và 24 `UX-REQ-*` nằm riêng tại
[01_PROPOSED_REQUIREMENTS_V22.md](01_PROPOSED_REQUIREMENTS_V22.md). Các requirement
đề xuất làm mạnh/mở rộng baseline — Core Library, structured FBD, một Task,
bundle, arbitration, cutover, base-step/watchdog và UX contract — được đăng ký
tại `CONF-PROG-016`; không sửa lén các hàng Active ở trên.

## 4. Coverage và evidence

| Kiểm tra | Kết quả |
|---|---:|
| Baseline requirement có stable ID | 19/19 |
| Baseline requirement có VR | 19/19 |
| Production evidence PASS | **0/13 VR** |
| Release gate | `RED / NO-GO` |

## 5. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Chuẩn hóa 19 requirement layer. |
| 2.0 | 2026-08-09 | Giữ nguyên nghĩa Active; thêm VR/evidence và tách amendment proposal. |

## 7. Phê duyệt

| Vai trò | Quyết định |
|---|---|
| Product Owner | `PENDING` cho amendment; baseline vẫn Active |
| Software/Runtime Architect | `PENDING` |
| Verification Lead | `PENDING` |
