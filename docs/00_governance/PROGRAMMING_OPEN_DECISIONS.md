# Programming Decision Register

| Thuộc tính | Giá trị |
|---|---|
| ID | `DEC-PROG-REGISTER-001` |
| Phiên bản | 1.3-candidate |
| Trạng thái | **Baseline Active — 12 quyết định unified CLOSED; 2 scoped record OPEN; `T59-801` REVIEW; 16 card downstream Candidate không có execution authority** |
| Ngày | 2026-08-24 |
| Chủ quản | Product + System Architecture |
| Authority | `ADR-050`; `AUTH-PROG-2026-08-20-04`; `CR-PROG-PGM02-V22-001` |

## 0. Kết luận

Mười hai quyết định unified theo ADR-050 vẫn `CLOSED` và tiếp tục làm authority
cho baseline hiện hành. Hai record mới đang `OPEN`: change request PGM-02 v2.2
đã được Owner duyệt để **chỉ mở công việc reconciliation `T59-801`**. Candidate
reconciled đã được tạo và đang REVIEW, còn baseline chờ System Architect
review/pin; `F-P59-GHOST-POU-001` chờ Owner chọn semantics package. Mười sáu
card `T59-802..817` chỉ là output lập kế hoạch Candidate, không mở quyền viết
production code hoặc thay chữ ký Architect.

`ADR-053` đang `Proposed` là hồ sơ quyết định kiến trúc con của
`CR-PROG-PGM02-V22-001`, không phải scoped record thứ ba trong bảng này. Nó chỉ
được đổi thành `Accepted` khi System Architect ký đúng exact revision/hash.

Các review Compiler/Core/BE/FE/Controls/Security/QA của baseline ADR-050 tiếp tục
được thực hiện như hậu kiểm trong từng task. Riêng phạm vi PGM-02 v2.2 phải qua
`T59-801` và scoped gate ở `PROG-DRM-001` trước khi promote bất kỳ card
downstream nào thành task được phép chạy.

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

### 1.1 `CR-PROG-PGM02-V22-001` — Owner disposition, Architect pending

| Thuộc tính | Giá trị |
|---|---|
| Nguồn đề xuất | [`REC-PGM02-ST-FBD-REDESIGN-REVIEW-001`](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM02_ST_FBD_REDESIGN_IMPLEMENTATION_REVIEW.md) và [`PLAN-PGM02-ST-FBD-REDESIGN-PROPOSAL-001`](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM02_ST_FBD_IMPLEMENTATION_PLAN.md) |
| Owner disposition | **APPROVED — Product Owner/CTO, 2026-08-24** |
| System Architect disposition | **PENDING** — review/pin exact revision và hash của baseline reconciled sau `T59-801`; record phê duyệt phải ghi candidate Git commit SHA bao trùm cả contract/schema/ADR/handoff/SVG, không ký thay tại đây |
| Phạm vi được mở | Chỉ `T59-801` / `PGM02-V22-WP-00`: inventory, reconcile và lập controlled baseline/task downstream |
| Candidate output để review | Formal `DDD-SW-PGM02-WORKSPACE-001`; `PGM02-WORKSPACE-V1`; `ADR-053` Proposed; 89 requirement/47 scenario; 17-file Markdown pin set; contract/schema/handoff/SVG được khóa bằng candidate Git commit SHA khi duyệt; `T59-802..817` Candidate |
| Phạm vi chưa được mở | Mọi production code, contract runtime đã Active, route cutover và việc promote/chạy task R1/R2/R3 downstream |

Owner đã chốt ba đầu vào sản phẩm sau:

1. **Mở `PGM02-V22-WP-00`.** Team được đối chiếu và đề xuất revision đồng bộ
   Product/SRS/Architecture/DDD/UX/asset/contract/Risk/Trace/VVP/Plan59. Đây là
   quyền lập baseline, không phải `AUTH-*` và không phải approval baseline cuối.
2. **Thứ tự increment:** `R1 EDIT → R2 LIVE → R3 SIMULATE`. Mỗi increment có
   gate/capability state riêng; hoàn tất R1/R2 không được hiển thị hoặc tuyên bố
   R3 đã có.
3. **Simulation v1 admin-only cho mutation.** `viewer`/`operator`/`admin` được
   đọc session và snapshot theo object scope; chỉ `admin` được create/run/pause/
   step/reset/stop/set-input. Enforcement nằm server-side, có audit và negative
   RBAC test; FE permission chỉ là affordance, không phải authority.

Scoped gate hiện hành:

| Gate | Trạng thái | Điều kiện mở tiếp |
|---|---|---|
| `CHANGE_REQUEST[PGM02-V22]` | **OWNER_APPROVED / ARCHITECT_PENDING** | System Architect review output `T59-801` |
| `PGM02-V22-WP-00` | **REVIEW qua `T59-801`** | Candidate/harness/pin evidence + Owner/System Architect exact pin gồm candidate Git commit SHA; không code production |
| `PLAN_READY[PGM02-V22]` | **PENDING** | không còn conflict authority; 17-file manifest, candidate Git commit SHA và task downstream được Owner + Architect pin |
| `IMPLEMENT_READY[PGM02-R1|R2|R3]` | **NO-GO** | đúng lát cắt có requirement/design/contract máy đọc được và approval theo governance |
| `RELEASE_READY` | **NO-GO** | VVP/Test Result/risk/target/HIL/release authority hiện hành |

Canonical ID của work package là `PGM02-V22-WP-00..13`. Tên ngắn `WP-00..13`
trong hai proposal chỉ là alias nội bộ, không trùng hoặc supersede WP lịch sử của
Plan56.

### 1.2 `F-P59-GHOST-POU-001` — quyết định Owner còn mở

| Thuộc tính | Giá trị |
|---|---|
| Câu hỏi | POU kind `PROGRAM` không có entry trong `programs[]` phải làm Check fail-closed, hay được giữ ở Draft nhưng loại khỏi package/runtime? |
| Trạng thái | **OPEN — OWNER DECISION PENDING** |
| Owner | Product Owner/CTO; System Architect và Compiler/BE/Core review impact |
| Ảnh hưởng | Semantics Draft→Check→package của `T59-301/302/305`; hiện packager tự đặt chu kỳ 1000 ms nên không được coi là hành vi đã duyệt |
| Gate | `IMPLEMENTATION_CLOSE`; không chặn `T59-801`, nhưng chặn tuyên bố current closure sạch |
| Điều kiện mở | Owner chọn một phương án; đồng bộ SRS/DDD/contract/compiler-packager/test rồi chạy affected gate |

Ba approval trong `CR-PROG-PGM02-V22-001` không đóng và không ngầm chọn phương án
cho finding này.

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
| 1.3-candidate | 2026-08-24 | Làm rõ exact pin hai lớp: manifest ghim 17 hồ sơ Markdown authority; record Owner + Architect phải ghi candidate Git commit SHA để khóa contract/schema/ADR/handoff/SVG. Pin check 17/17 một mình không mở `PLAN_READY` hoặc code. |
| 1.2-candidate | 2026-08-24 | Ghi output `T59-801`: formal DDD/contract/ADR-053/89 requirement/47 scenario/17-file Candidate pin và 16 card `T59-802..817`; chuyển WP-00 sang REVIEW, giữ Architect exact pin và mọi execution R1/R2/R3 NO-GO. |
| 1.1 | 2026-08-24 | Ghi `CR-PROG-PGM02-V22-001`: Owner mở duy nhất `T59-801`, khóa thứ tự R1 EDIT → R2 LIVE → R3 SIMULATE và Simulation v1 admin-only; System Architect/baseline pin giữ PENDING, code downstream NO-GO. Đăng ký riêng `F-P59-GHOST-POU-001` OPEN thay cho tuyên bố sai 0 Open Decision. |
| 0.1..0.9 | 2026-08-03..11 | Decision package `OD-PROG-001..017` cho baseline cũ; phục hồi qua Git. |
| 1.0 | 2026-08-20 | `ADR-050` supersede phạm vi xung đột; đóng 12 quyết định unified; 0 Open Decision/implementation blocker. |
