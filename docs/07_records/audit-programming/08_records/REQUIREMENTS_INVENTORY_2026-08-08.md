# Bảng trích yêu cầu Programming DDC-24 Rev A

**Ngày trích:** 2026-08-08

**Mục đích:** gom các bảng yêu cầu liên quan Programming vào một điểm đọc cho audit.

**Phân loại:** RECORD — bảng trích lịch sử, không thay Requirement Baseline mới.

**Lưu ý:** authority vẫn là tài liệu gốc trong repository. Bản sao nguyên văn tại
`../09_archive/raw-source-snapshots/docs/` tái hiện đúng baseline ngày audit.

## 1. Baseline và phạm vi đóng

Nguồn: `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` §3, ADR-023.

| Trong phạm vi Rev A | Ngoài phạm vi Rev A |
|---|---|
| Local Physical I/O | Modbus TCP Point |
| Virtual Point | BACnet/IP Point |
| Modbus RTU Point | Ladder Diagram (LD) |
| Structured Text (ST) | Sequential Function Chart (SFC) |
| Function Block Diagram (FBD) | Motion, safety PLC, online change |
| Cycle time chỉ 1 s, 5 s hoặc 30 s | Claim IEC compliant/conformant/certified |

Ranh giới này là negative scope bắt buộc: UI/API/import/runtime phải từ chối năng lực
ngoài phạm vi, không chỉ ẩn khỏi menu.

## 2. Product Capability — 12/12 đã định nghĩa

Nguồn: `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` §4.

| ID | Capability |
|---|---|
| PC-PROG-001 | Quản lý Project và Program có truy nguyên. |
| PC-PROG-002 | Phân biệt Point, Variable và quản lý I/O Mapping. |
| PC-PROG-003 | Dùng Local Physical I/O trong Program. |
| PC-PROG-004 | Dùng Virtual Point trong Program. |
| PC-PROG-005 | Dùng Modbus RTU Point trong Program. |
| PC-PROG-006 | Tạo, xác thực và chạy Program ST. |
| PC-PROG-007 | Tạo, xác thực và chạy Program FBD. |
| PC-PROG-008 | Chạy Program cyclic với lựa chọn cycle time 1 s, 5 s hoặc 30 s. |
| PC-PROG-009 | Quản lý Revision, Deployment, Activation và Rollback. |
| PC-PROG-010 | Bảo toàn Variable được đánh dấu RETAIN theo chính sách đã phê duyệt. |
| PC-PROG-011 | Quan sát Program, Variable và Point qua Online Monitor. |
| PC-PROG-012 | Giữ đúng ranh giới Programming Rev A và từ chối capability ngoài phạm vi. |

## 3. Product Requirement — 14/14 đã định nghĩa

Nguồn: `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` §5.

| ID | Yêu cầu |
|---|---|
| PR-PROG-001 | Cho phép người có quyền tạo, mở, sửa, lưu Project chứa một hoặc nhiều Program mà không mất quan hệ truy nguyên. |
| PR-PROG-002 | Hỗ trợ Program ST và Program FBD như hai ngôn ngữ Rev A; trả lỗi xác thực rõ trước Deployment. |
| PR-PROG-003 | Chỉ cung cấp ba loại Point cho I/O Mapping: Local Physical I/O, Virtual Point và Modbus RTU Point. |
| PR-PROG-004 | Phân biệt Point với Variable; xác thực direction, type, quyền đọc/ghi và quality tại I/O Mapping. |
| PR-PROG-005 | Chỉ cung cấp cycle time 1 s, 5 s hoặc 30 s và hiển thị lựa chọn đang áp dụng. |
| PR-PROG-006 | Revision lỗi syntax, semantic, I/O Mapping hoặc validation bắt buộc không được Deployment/Activation. |
| PR-PROG-007 | Revision dùng cho Deployment phải bất biến và truy nguyên tới Project, Program, actor tạo Revision. |
| PR-PROG-008 | Deployment có trạng thái authority; không báo thành công trước khi runtime chấp nhận đúng artifact. |
| PR-PROG-009 | Activation tại cyclic boundary kiểm soát; lỗi giữ Revision đang chạy; Rollback về Revision tương thích đã biết. |
| PR-PROG-010 | Phục hồi Variable RETAIN theo policy restart được duyệt; non-RETAIN không mặc nhiên dùng dữ liệu cũ. |
| PR-PROG-011 | Online Monitor hiển thị authority data gồm active Revision, trạng thái Program, Variable, Point cùng nguồn/độ mới; stale/unavailable không giả thành live. |
| PR-PROG-012 | Program active tiếp tục chạy local khi Web/engineering client mất kết nối; lỗi presentation không tự dừng control path. |
| PR-PROG-013 | Sửa Project, tạo Revision, Deployment, Activation, Rollback phải có RBAC và audit. |
| PR-PROG-014 | Từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC trong Rev A; không gắn nhãn đã hỗ trợ. |

## 4. System/Software/Interface/NFR — 19/19 đã định nghĩa

Nguồn: `docs/02_requirements/REQUIREMENTS.md` §Programming Rev A.

| ID | Layer | Yêu cầu rút gọn không làm mất nghĩa chuẩn |
|---|---|---|
| SYS-REQ-PROG-001 | System | Cung cấp đúng ST/FBD, ba Point category, ba cycle time; từ chối toàn bộ negative scope. |
| SYS-REQ-PROG-002 | System | Có authority state riêng cho Revision, Deployment, Activation, active Revision và Rollback; không suy diễn trạng thái kế tiếp. |
| SYS-REQ-PROG-003 | System | Program active tiếp tục control local khi Web/engineering client mất kết nối trong fault policy được duyệt. |
| SWR-REQ-PROG-001 | Software | Bảo toàn Project → Program → Revision và giữ Revision deploy bất biến. |
| SWR-REQ-PROG-002 | Software | Xác thực/thực thi ST theo cùng semantic; diagnostic có mã/vị trí; lỗi chặn Deployment. |
| SWR-REQ-PROG-003 | Software | Xác thực/thực thi FBD theo cùng semantic; lỗi block/connection/type chặn Deployment. |
| SWR-REQ-PROG-004 | Software | Chỉ expose Local Physical I/O, Virtual Point, Modbus RTU Point cho I/O Mapping; reject loại khác. |
| SWR-REQ-PROG-005 | Software | Phân biệt Point/Variable; validate identity, direction, type, read/write, quality, compatibility trước Revision deployable. |
| SWR-REQ-PROG-006 | Software | Scheduler chỉ nhận 1 s/5 s/30 s, deterministic và quan sát được cycle/overrun/fault. |
| SWR-REQ-PROG-007 | Software | Sửa Project/Program sinh Revision mới; không sửa nội dung Revision đã Deployment. |
| SWR-REQ-PROG-008 | Software | Validate-before-deploy; Activation tại cyclic boundary; lỗi giữ active Revision; Rollback trả authority result. |
| SWR-REQ-PROG-009 | Software | Lưu/phục hồi RETAIN theo policy; chặn dữ liệu không tương thích Revision/type. |
| SWR-REQ-PROG-010 | Software | Online Monitor dùng authority data, đúng timestamp/quality/stale/unavailable; không tự cấp write/force/online change. |
| SWR-REQ-PROG-011 | Software/Security | Lifecycle mutation kiểm quyền và audit actor/action/Revision/time/result. |
| SWR-REQ-PROG-012 | Software | Validation/runtime/quality/overrun/client-loss quan sát được; không uncontrolled output hoặc UI false-success. |
| IF-REQ-PROG-001 | Interface | I/O Mapping biểu diễn Point category/identity, Variable identity, direction, type, unit/range, quality, access; RTU không nhầm TCP. |
| IF-REQ-PROG-002 | Interface | Lifecycle/monitor trả authority state, correlation và stable error result. |
| NFR-REQ-PROG-001 | Non-functional | Client restart/disconnect không dừng Program active; reconnect không blind replay mutation. |
| NFR-REQ-PROG-002 | Non-functional | Đáp ứng budget target cho 1 s/5 s/30 s, phát hiện/báo overrun; limit cụ thể theo OD-PROG-012. |

## 5. Verification Requirement — 13/13 đang RED

Nguồn: `docs/05_verification/VERIFICATION.md` §Programming Rev A.

| ID | Phải chứng minh | Trạng thái tại baseline |
|---|---|---|
| VR-PROG-001 | Scope Product/Requirement và UI/API chỉ lộ đúng capability. | RED — docs pass, production chưa có |
| VR-PROG-002 | Project/Program/Revision, capacity, immutable identity/actor, round-trip. | RED |
| VR-PROG-003 | I/O Mapping positive/negative cho ba Point category trên production path. | RED |
| VR-PROG-004 | ST end-to-end Revision → runtime production target → output/monitor golden scenario. | RED |
| VR-PROG-005 | FBD end-to-end cùng production target/semantic, lỗi và golden scenario. | RED |
| VR-PROG-006 | Đo target 1 s/5 s/30 s, jitter/WCET/overrun/fault; reject cycle khác. | RED |
| VR-PROG-007 | Revision/Deployment identity, validate-before-deploy, authority ACK/reject/timeout, không false-success. | RED |
| VR-PROG-008 | Activation cyclic boundary; reject/corrupt/timeout/power-loss giữ Revision cũ; Rollback đúng. | RED |
| VR-PROG-009 | RETAIN qua restart/power/type/Revision/corrupt; non-RETAIN không nhận dữ liệu cũ. | RED |
| VR-PROG-010 | Online Monitor khớp runtime về Revision/Program/Variable/Point/timestamp/quality; client loss không ảnh hưởng control. | RED |
| VR-PROG-011 | RBAC/audit positive/negative và bypass/replay/idempotency/timeout. | RED |
| VR-PROG-012 | Local continuity và fault behavior, không uncontrolled output/blind replay/false-success. | RED |
| VR-PROG-013 | UI/API/import/runtime từ chối LD, SFC, TCP Point, BACnet Point, motion, safety PLC. | RED |

Kết luận release gate từ authority: **Programming production release gate — RED / NO-GO**.
Host unit test parser/runtime chỉ là supporting evidence, không thay thế VR-PROG-004..012.

## 6. Open Decision — 15/15 chưa đóng

Nguồn: `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md`.

| ID | Chủ đề chặn thiết kế | Trạng thái |
|---|---|---|
| OD-PROG-001 | Ma trận role cho Project/Revision/Deployment/Activation/Rollback. | OPEN |
| OD-PROG-002 | Data type, conversion, overflow và initialization chính thức cho ST/FBD/Point/Variable. | OPEN |
| OD-PROG-003 | Capacity Project, Program, Revision, Point, Variable, kích thước logic. | OPEN |
| OD-PROG-004 | Số Program active, cycle theo Program/task, thứ tự nhiều Program. | OPEN |
| OD-PROG-005 | Thư viện function/function block, semantic dùng chung và versioning. | OPEN |
| OD-PROG-006 | FBD authoring UX, connection rule và Project/Program exchange format. | OPEN |
| OD-PROG-007 | Thuộc tính Local/Virtual/RTU Point và I/O Mapping contract. | OPEN — có proposal RTU |
| OD-PROG-008 | Modbus RTU function/endian/poll/timeout/stale/retry/device error. | OPEN — có proposal RTU |
| OD-PROG-009 | RETAIN cho warm/cold/power/revision/type và wear policy. | OPEN |
| OD-PROG-010 | Revision retention/compatibility/quyền và transaction deploy/activate/rollback/power-loss. | OPEN |
| OD-PROG-011 | Online Monitor refresh/trace/retention/timestamp/quality/write-force policy. | OPEN |
| OD-PROG-012 | WCET/budget/overrun và fault behavior cho ba cycle. | OPEN |
| OD-PROG-013 | Migration graph 28-node legacy và node TCP/BACnet ngoài scope. | OPEN |
| OD-PROG-014 | Đồng tồn tại/chuyển đổi config cũ trên thiết bị đã triển khai. | OPEN |
| OD-PROG-015 | Product approval và điều kiện đóng readiness gate. | OPEN |

## 7. Traceability coverage của tài liệu

Nguồn: `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md`.

| Layer | Coverage tài liệu | Bằng chứng production |
|---|---:|---:|
| Product Capability | 12/12 | Chưa đủ để claim capability implemented |
| Product Requirement | 14/14 | Chưa đủ để claim capability implemented |
| System/Software/Interface/NFR | 19/19 | Chưa đủ để claim capability implemented |
| Verification Requirement | 13/13 đã map | **0/13 đạt** |

Điều này phân biệt hai khái niệm: **requirement coverage đã đầy đủ**, nhưng
**implementation/verification coverage production vẫn bằng 0**.
