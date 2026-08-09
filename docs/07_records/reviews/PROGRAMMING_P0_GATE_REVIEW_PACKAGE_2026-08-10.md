# Gói review cổng P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-GATE-2026-08-10` |
| Loại | Decision/design/sign-off package; hồ sơ hỗ trợ, không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 1.0 |
| Ngày | 2026-08-10 |
| Phạm vi | `PROG-000..006`, `DOC-G4`, `G0`, `PLAN_READY` |
| Chủ quản | Dev Lead + System Architect |
| Người review | Product, Controls/Safety, Security, Runtime/Ops, FW MCU, HW, QA/Verification, Document Control |
| Người phê duyệt | Product Owner + System Architect + Verification Lead |
| Trạng thái | **READY FOR AUTHORITY REVIEW — `DOC-G4/G0/PLAN_READY` vẫn `BLOCKED`** |
| Kế hoạch chủ quản | [`PLAN-PROG-053`](../../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) §5.1 |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Gói này dùng để làm gì? | Gom toàn bộ đầu vào, kết luận kỹ thuật, decision cần ký và ô sign-off của P0 vào một nơi để các authority review mà không phải tự dò 22 hồ sơ. |
| Đã hoàn tất gì? | Đã review cấu trúc Plan 53, sửa sai số hiện hành, lập ma trận `PROG-000..006`, dẫn đúng thiết kế/decision/test và chạy lại harness tài liệu. |
| Chưa hoàn tất gì? | Chưa có consumer review độc lập, chưa có chữ ký authority, 17 decision vẫn `OPEN`, sáu xung đột kiến trúc còn mở, TLS/HW/BSP/HIL chưa có bằng chứng. |
| Có được implement production chưa? | **Không.** Gói này chỉ đưa P0 tới trạng thái sẵn sàng cho người có thẩm quyền review. `IMPLEMENT_READY` vẫn `BLOCKED`. |
| Làm gì tiếp theo? | Reviewer ghi `ACCEPT`, `REQUEST_CHANGE` hoặc `REJECT` theo §6; owner xử lý comment; Document Control ghim revision/hash mới; Product/Architect/Verification ký đúng baseline. |

## 1. Phán quyết duyệt kế hoạch

**ACCEPTED FOR P0 AUTHORITY REVIEW, NOT APPROVED FOR IMPLEMENTATION.**

Plan 53 v0.8 đủ cấu trúc kế hoạch theo hướng ISO/IEC/IEEE 16326: phạm vi, WBS,
phụ thuộc, lịch tương đối, nguồn lực, RACI, risk, kiểm soát cấu hình, V&V, đóng
dự án và cổng quyền hạn. Bốn lỗi làm sai quyết định đã được sửa:

1. tổng WBS `42` được sửa thành `49` task;
2. exit P6 và VVP self-check `VS-PROG-001..030` được sửa thành `001..032`;
3. `PLAN_READY OPEN` được sửa thành `PLAN_READY BLOCKED`; quyền chuẩn bị kế
   hoạch dưới banner `PLAN-ONLY` không bị hiểu nhầm là gate đã qua.
4. dependency nguyên khối `P1 ← P0` và điều kiện contract vòng tròn được tách
   thành `P0-A` duyệt baseline cùng `P0-B` decision theo lát cắt; P1 tạo contract
   không còn bị đòi machine-readable contract trước khi bắt đầu.

Không có nội dung nào trong gói này thay thế consumer review, decision record,
Test Result target/HIL hoặc chữ ký phê duyệt.

## 2. Baseline và cấu hình được review

| Đầu vào | Revision/trạng thái | Kết luận |
|---|---|---|
| Baseline 22 hồ sơ | commit `05c1c480418a2256f1010527f9d90fb6ff549b86` | Đã ghim, 22/22 file được Git theo dõi; đây là baseline trước vòng sửa P0 ngày 2026-08-10 |
| Candidate P0 | Plan 53 v0.8, Open Decisions v0.6, VVP v0.6, Plan 54 v2.1, Index v1.1 và record này trong working tree | **Chưa được ghim commit/hash**; Document Control phải pin sau khi review thay đổi |
| Mức trưởng thành | 22/22 `M3`; 0/22 `M4`; 0/22 `M5` | Hồ sơ đủ để review, chưa đủ để phê duyệt/implement |
| Bằng chứng sản phẩm | 0/32 Test Result | Không suy ra implementation, HIL hoặc release readiness |

Nếu candidate P0 được sửa tiếp, reviewer phải review lại đúng revision mới. Chữ
ký không ghi revision/commit cụ thể là không hợp lệ.

## 3. Kết quả triển khai `PROG-000..006`

| Task | Gói kỹ thuật đã chuẩn bị | Decision/authority bắt buộc | Trạng thái | Blocker và điều kiện mở |
|---|---|---|---|---|
| `PROG-000` Product | Scope Rev A, capacity/type/FBD/Task/library, bốn workspace/tám journey tại [`PROD-PROG-001`](../../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) §3, §8–§9 và [`PROG-OD-001`](../../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | Product Owner/CTO; `OD-PROG-001..007`, `015..017` theo phạm vi | `IN_REVIEW` | Owner: Product. Ảnh hưởng: chưa khóa contract/profile/scope. Gate: `DOC-G4/G0`. Mở khi Product ghi quyết định/rationale và downstream sync |
| `PROG-001` Architect | Process ownership, base step, cutover, safe-state, deployment/rollback tại [`ARCH-PROG-001`](../../03_architecture/PROGRAMMING_ARCHITECTURE.md) §3, §5–§8, §16 và xung đột §11 | System Architect + Safety; `OD-PROG-004/012/013/014` | `IN_REVIEW` | Owner: Architect. Ảnh hưởng: chưa được nối runtime production. Gate: `G0`. Mở khi sáu `ARCH-CONF-PROG-*` có ADR/decision và consumer chấp nhận |
| `PROG-002` Controls | Priority 5, hold-last, PID/anti-windup, Task/overrun/cutover tại [`DDD-CTRL-PROG-001`](../../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §3–§10 | Controls + Runtime Architect + Safety; `OD-PROG-004/005/012/013` | `IN_REVIEW` | Owner: Controls/Safety. Ảnh hưởng: TTL/envelope và WCET còn `TARGET-PENDING`. Gate: `DOC-G2/G0`. Mở khi khóa policy và ký kế hoạch benchmark target |
| `PROG-003` Product + Security | RBAC, TLS/session, bounded compiler, artifact/bundle integrity, audit và rollback tại [`DDD-SEC-PROG-001`](../../02_design/software/PROGRAMMING_SECURITY_DESIGN.md) §4–§15 | Product + Security + Platform; `OD-PROG-001`, permission matrix và `IntegrityMode` | `BLOCKED` | Owner: Security/Platform. Ảnh hưởng: chưa khóa được security plan; mutation phải OFF cho tới target PASS. Gate: `P0-B/security`. Mở P0 khi enablement/verification plan, permission matrix và provenance được ký; TLS target PASS là gate bật mutation sau implementation |
| `PROG-004` Runtime + Ops | Atomic Commission/Restore, journal, active/LKG, RETAIN, restart/power-loss tại [`DDD-LIFE-PROG-001`](../../02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md) §3–§15 và [`OPS-PROG-001`](../../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) §10–§17 | Product + Runtime Architect + Ops; `OD-PROG-009/010/011/014` | `IN_REVIEW` | Owner: Runtime/Ops. Ảnh hưởng: chưa khóa ma trận recovery/retention/trace. Gate: `DOC-G2/G0`. Mở khi policy được ký và rehearsal plan có owner/fixture |
| `PROG-005` HW + FW | IOP continuity, safe timeout 199/200/201 ms, BSP/pin/test point và HIL procedure tại [`DDD-FWMCU-PROG-001`](../../02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md) §4–§14 và [`DDD-HW-PROG-001`](../../04_design/hardware/PROGRAMMING_HW_DESIGN.md) §4–§13 | FW MCU + HW + Safety + QA; `HW-AUTH-001/002/007/008`; `OD-PROG-008` phần HIL | `BLOCKED` | Owner: HW/FW. Ảnh hưởng: chưa có authority để chốt BSP/test plan; không được claim deadline điện hoặc HIL. Gate: `P0-B/HW`, sau đó `G6`. Mở P0 khi authority và fixture/HIL plan được duyệt; actual BSP/HIL Test Result đóng tại G6 |
| `PROG-006` QA | 60 requirement, 60 trace row, 16 risk, 32 scenario, evidence schema và review record tại [`VVP-PROG-001`](../../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) §3, §9–§11, [`TRACE-PROG-001`](../PROGRAMMING_TRACEABILITY_MATRIX.md) §6–§8 và [`RSK-PROG-001`](../PROGRAMMING_RISK_REGISTER.md) §3–§6 | Verification Lead + Product + Architect + consumer reviewers; `OD-PROG-015` | `BLOCKED` | Owner: QA/Document Control. Ảnh hưởng: không ký G0. Gate: `DOC-G4/G0`. Mở khi consumer review đóng, candidate được pin và sign-off §6 hoàn tất |

Kết luận tiến độ: **đã hoàn tất phần chuẩn bị kỹ thuật 7/7; đạt DoD 0/7** vì
DoD P0 bao gồm quyết định và chữ ký thẩm quyền. Không chuyển task sang `DONE` để
làm đẹp tiến độ.

## 4. Checklist cổng `DOC-G4/G0/PLAN_READY`

| Điều kiện | Kết quả 2026-08-10 | Bằng chứng / thiếu gì |
|---|---|---|
| 22/22 hồ sơ tồn tại và được kiểm soát cấu hình | `PASS` | baseline commit ở §2 |
| Cấu trúc/link/ID/trace invariant sạch | `PASS` | `python3 scripts/docs_iso_harness.py --expect -v` |
| Finding kỹ thuật P0/P1 của vòng duyệt agent đóng | `PASS` | [`PROG-REV-2026-08-09`](PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) §6.3 |
| Candidate sau review được ghim revision/hash | `BLOCKED` | Document Control phải commit/pin candidate; không dùng hash baseline cũ cho nội dung mới |
| Consumer review liên chức năng | `BLOCKED` | 0/22 M4; cần `ACCEPT/REQUEST_CHANGE/REJECT` theo revision |
| Baseline approval `OD-PROG-015` | `BLOCKED` | 17/17 decision tổng thể vẫn `OPEN`; `OD-PROG-015` chưa có record |
| Không còn authority/xung đột kiến trúc | `BLOCKED` | `ARCH-CONF-PROG-001..006` chưa có ADR/decision |
| Sign-off Product/Architect/Verification | `BLOCKED` | bảng §6 còn `PENDING` |
| `PLAN_READY` | **`BLOCKED`** | Chỉ chuyển `PASS` khi toàn bộ điều kiện trực tiếp phía trên đạt |
| `IMPLEMENT_READY[<lát cắt>]` | **`BLOCKED`** | Cần `PLAN_READY PASS`, task card và decision của đúng lát cắt; contract machine-readable chỉ là entry của lát cắt tiêu thụ, không phải entry của P1 tạo contract |
| `RELEASE_READY` | **`BLOCKED`** | 0/32 Test Result, HIL/rehearsal/residual acceptance chưa có |

## 5. Trình tự review không được bỏ bước

1. Document Control phát hành candidate revision/commit và danh sách file đổi.
2. Product review `PROG-000`; Architect/Safety review `PROG-001/002` và xác
   nhận `P0-A`/`P0-B` không tạo blocker nguyên khối.
3. Security/Platform review `PROG-003`; Runtime/Ops review `PROG-004`.
4. FW/HW/Safety/QA review `PROG-005`; Verification review chéo `PROG-006`.
5. Mọi `REQUEST_CHANGE` phải có owner, impact, gate và điều kiện đóng; thay đổi
   contract/safety làm invalid chữ ký downstream liên quan.
6. Chỉ sau khi comment đóng, authority ký đúng revision ở §6 và cập nhật
   `OD-PROG-*` từ `OPEN` sang `DECIDED/CLOSED` theo đúng quy tắc.
7. Document Control cập nhật Plan 53/54, Index, Trace, Risk và CHANGELOG; chạy
   lại harness trước khi đề nghị chuyển gate.

## 6. Biên bản review và sign-off

Không điền thay người có thẩm quyền. Reviewer phải ghi họ tên, ngày, revision,
kết luận và link comment/decision record.

| Vai trò | Phạm vi | Kết luận | Người/ngày | Revision và bằng chứng |
|---|---|---|---|---|
| Product Owner/CTO | `PROG-000`, scope/claim, `OD-PROG-015..017` | `PENDING` | — | — |
| System Architect | `PROG-001`, ownership/cutover/deploy | `PENDING` | — | — |
| Controls + Safety | `PROG-002`, timing/priority/PID/fault | `PENDING` | — | — |
| Security + Platform | `PROG-003`, RBAC/TLS/integrity/audit | `PENDING` | — | — |
| Runtime + Ops | `PROG-004`, RETAIN/LKG/recovery/rehearsal | `PENDING` | — | — |
| FW MCU + HW + Safety | `PROG-005`, BSP/electrical/HIL | `PENDING` | — | — |
| Verification Lead | `PROG-006`, VVP/trace/risk/gate | `PENDING` | — | — |
| Document Control | revision/hash/register/harness | `PENDING` | — | — |

Giá trị hợp lệ cho “Kết luận”: `ACCEPT`, `REQUEST_CHANGE`, `REJECT`. `PENDING`
không phải approval. Chỉ Product Owner + System Architect + Verification Lead
có đủ ba kết luận `ACCEPT` trên cùng candidate đã pin mới được đề nghị đóng
`OD-PROG-015` và chuyển `PLAN_READY` sang `PASS`.

## 7. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Lập gói review P0 `PROG-000..006`; gom evidence/decision/blocker/sign-off; giữ trung thực `DOC-G4/G0/PLAN_READY BLOCKED` |
