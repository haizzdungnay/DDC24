# Programming Decision Register

| Thuộc tính | Giá trị |
|---|---|
| ID | `DEC-PROG-REGISTER-001` |
| Phiên bản | 1.0 |
| Trạng thái | **Active — 0 OPEN / 0 implementation blocker** |
| Ngày | 2026-08-20 |
| Chủ quản | Product + System Architecture |
| Authority | `ADR-050`; `AUTH-PROG-2026-08-20-04` |

## 0. Kết luận

Không còn quyết định sản phẩm hay thiết kế nào chặn implementation Programming.
Owner đã ủy quyền chốt toàn bộ target còn thiếu trong yêu cầu ngày 2026-08-20.
Các review Compiler/Core/BE/FE/Controls/Security/QA được thực hiện như hậu kiểm
trong từng task và finding phải sửa trước DoD task; không chuyển task về
`BLOCKED` chỉ vì thiếu chữ ký discipline.

Việc chưa có target/HIL/physical I/O/soak không phải Open Decision và không chặn
viết code; đó là **evidence bắt buộc để mở `RELEASE_READY`**.

## 1. Decision package hiện hành

| ID | Quyết định | Trạng thái | Authority |
|---|---|---|---|
| `UD-PROG-001` | Một Product Programming, không chia Rev A/Rev B. | CLOSED | ADR-050.1 |
| `UD-PROG-002` | Multi-Program: 32/Revision, tối đa 16 Enabled, period 1/5/30 s. | CLOSED | ADR-050.3 |
| `UD-PROG-003` | PROGRAM/FUNCTION/FUNCTION_BLOCK và rule state/I/O/lifecycle. | CLOSED | ADR-050.2/4 |
| `UD-PROG-004` | SYSTEM/PROJECT Control Library versioned, DAG acyclic. | CLOSED | ADR-050.2/4 |
| `UD-PROG-005` | Published Signal là typed runtime primitive, committed snapshot, không Point type mới. | CLOSED | ADR-050.5 |
| `UD-PROG-006` | Single output owner; Disable rút candidate tại safe boundary. | CLOSED | ADR-050.6 |
| `UD-PROG-007` | Independent scheduling/fault isolation; multicore giữ cùng semantics. | CLOSED | ADR-050.7 |
| `UD-PROG-008` | Sáu workspace `PGM-01..06`. | CLOSED | ADR-050.8 |
| `UD-PROG-009` | Core trace ring buffer; không action ma. | CLOSED | ADR-050.9 |
| `UD-PROG-010` | PID chỉ quảng bá ready sau Controls/Safety evidence. | CLOSED | ADR-050.9 |
| `UD-PROG-011` | Artifact/store/API/IPC versioned; dual-reader v1/v2 trong migration. | CLOSED | ADR-050 hệ quả |
| `UD-PROG-012` | Implementation review được waive khỏi entry; release evidence không waive. | CLOSED | ADR-050.10 |

Chi tiết field, API, state, algorithm, timing, error, source mapping, migration và
test nằm tại
[`DDD-SW-PROG-UNIFIED-001`](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md).
Không mở lại một dòng ở bảng này bằng comment code; thay đổi target phải có ADR
mới hoặc revision ADR-050 do Product Owner phê duyệt.

## 2. Quyết định lịch sử bị supersede

`OD-PROG-001..017` và `AUTH-PROG-2026-08-11-03` vẫn có giá trị truy nguyên trong
Git, nhưng mọi phần sau đây không còn authority: một Task/một Program, bốn
workspace, thư viện/Enable/Published Signal để Roadmap sau, `HASH_ONLY` như đích
release hoặc chia scope theo Rev. Các phần không xung đột—RBAC server-side,
atomic Commission/LKG, RETAIN integrity, graph/program exclusivity, bounded
resource, audit và target/HIL truthfulness—được giữ trong Product v3.0/DDD mới.

## 3. Trách nhiệm hậu kiểm

| Reviewer | Phạm vi | Thời điểm | Tác động |
|---|---|---|---|
| Compiler/Controls | Function/FB/library/PID semantics | Trong task Wave 1–2 | Finding sửa trong task; PID label không ready khi evidence thiếu. |
| Runtime/Safety | scheduler/signal/output/disable/LKG | Trong task Wave 3–5 | Finding safety P0 chặn merge task liên quan, không chặn task độc lập. |
| Security | RBAC/artifact/library supply chain/audit | Trong mỗi contract task | Negative test bắt buộc. |
| Verification/Ops | fixture/evidence/deploy/rollback | Wave 6–7 | Chặn release nếu evidence thiếu; không giả verdict. |

## 4. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1..0.9 | 2026-08-03..11 | Decision package `OD-PROG-001..017` cho baseline cũ; phục hồi qua Git. |
| 1.0 | 2026-08-20 | `ADR-050` supersede phạm vi xung đột; đóng 12 quyết định unified; 0 Open Decision/implementation blocker. |
