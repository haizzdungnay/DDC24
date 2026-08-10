# Gói review cổng P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-GATE-2026-08-10` |
| Loại | Decision/design/sign-off package; hồ sơ hỗ trợ, không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 1.5 |
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
| Đã hoàn tất gì? | Review cấu trúc Plan 53; ma trận `PROG-000..006`; harness; **ghim candidate hiện hành bằng 22 SHA-256**; host branch/build/toolchain; kho Test Result; **vòng consumer review kỹ thuật với `9/9` finding `F-CR-01..09` đã đóng**; **phần kỹ thuật của 6 xung đột kiến trúc đóng bằng `ADR-026..031`**. |
| Chưa hoàn tất gì? | **Chữ ký người thật** cho mọi vai trò; 17 decision còn `OPEN`; 6 ADR còn `Proposed`; CI bị billing, target bị SSH auth, TLS/HW/BSP/HIL chưa có authority/evidence. |
| Có được implement production chưa? | **Không.** Gói này chỉ đưa P0 tới trạng thái sẵn sàng cho người có thẩm quyền review. `IMPLEMENT_READY` vẫn `BLOCKED`. |
| Làm gì tiếp theo? | Reviewer checkout/đọc đúng candidate trong manifest, ghi `ACCEPT`, `REQUEST_CHANGE` hoặc `REJECT` theo §6; owner xử lý comment; Product/Architect/Verification ký đúng revision. |

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
| Chuỗi candidate P0 | `05c1c48` → `e3e9fb2` (SUPERSEDED) → **candidate hiện hành** | Định danh là 22 SHA-256 ở manifest §2, không phải commit — xem manifest §1.1. Reviewer chạy `python3 scripts/candidate_pin_check.py` trước khi đọc |
| Candidate P0 **hiện hành** | Định danh bằng **22 SHA-256** ở [`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) §2 (v2.2); commit chứa nội dung ghi ở §1.1 của manifest | Reviewer chạy `python3 scripts/candidate_pin_check.py` (`22/22` PASS) rồi ghi hash hoặc commit đó trong kết luận |
| Candidate P0 **cũ** | `e3e9fb26f61b39df8f805916333fc03b51f07f5f` | **`SUPERSEDED`** — 10/22 hồ sơ đã đổi qua hai vòng R1/R2. **Không** ký lên revision này |
| Mức trưởng thành | 22/22 `M3`; 0/22 `M4`; 0/22 `M5` | Hồ sơ đủ để review, chưa đủ để phê duyệt/implement |
| Bằng chứng sản phẩm | 0/32 Test Result | Không suy ra implementation, HIL hoặc release readiness |

Nếu nội dung candidate P0 cần sửa, phải phát hành candidate/hash mới và review
lại phần chịu ảnh hưởng. Gói v1.1 hiện hành là record theo dõi việc ghim; nội
dung authority review v1.0 nằm trong chính candidate. Chữ ký không ghi
revision/commit cụ thể là không hợp lệ.

## 3. Kết quả triển khai `PROG-000..006`

| Task | Gói kỹ thuật đã chuẩn bị | Decision/authority bắt buộc | Trạng thái | Blocker và điều kiện mở |
|---|---|---|---|---|
| `PROG-000` Product | Scope Rev A, capacity/type/FBD/Task/library, bốn workspace/tám journey tại [`PROD-PROG-001`](../../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) §3, §8–§9 và [`PROG-OD-001`](../../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | Product Owner/CTO; `OD-PROG-001..007`, `015..017` theo phạm vi | `IN_REVIEW` | Owner: Product. Ảnh hưởng: chưa khóa contract/profile/scope. Gate: `DOC-G4/G0`. Mở khi Product ghi quyết định/rationale và downstream sync |
| `PROG-001` Architect | Process ownership, base step, cutover, safe-state, deployment/rollback tại [`ARCH-PROG-001`](../../03_architecture/PROGRAMMING_ARCHITECTURE.md) §3, §5–§8, §16 và xung đột §11 | System Architect + Safety; `OD-PROG-004/012/013/014` | `IN_REVIEW` | Owner: Architect. Ảnh hưởng: chưa được nối runtime production. Gate: `G0`. Mở khi sáu `ARCH-CONF-PROG-*` có ADR/decision và consumer chấp nhận |
| `PROG-002` Controls | Priority 5, hold-last, PID/anti-windup, Task/overrun/cutover tại [`DDD-CTRL-PROG-001`](../../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §3–§10 | Controls + Runtime Architect + Safety; `OD-PROG-004/005/012/013` | `IN_REVIEW` | Owner: Controls/Safety. Ảnh hưởng: TTL/envelope và WCET còn `TARGET-PENDING`. Gate: `DOC-G2/G0`. Mở khi khóa policy và ký kế hoạch benchmark target |
| `PROG-003` Product + Security | RBAC, TLS/session, bounded compiler, artifact/bundle integrity, audit và rollback tại [`DDD-SEC-PROG-001`](../../02_design/software/PROGRAMMING_SECURITY_DESIGN.md) §4–§15 | Product + Security + Platform; `OD-PROG-001`, permission matrix và `IntegrityMode` | `BLOCKED` | Owner: Security/Platform. Ảnh hưởng: chưa khóa được security plan; mutation phải OFF cho tới target PASS. Gate: `P0-B/security`. Mở P0 khi enablement/verification plan, permission matrix và provenance được ký; TLS target PASS là gate bật mutation sau implementation |
| `PROG-004` Runtime + Ops | Atomic Commission/Restore, journal, active/LKG, RETAIN, restart/power-loss tại [`DDD-LIFE-PROG-001`](../../02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md) §3–§15 và [`OPS-PROG-001`](../../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) §10–§17 | Product + Runtime Architect + Ops; `OD-PROG-009/010/011/014` | `IN_REVIEW` | Owner: Runtime/Ops. Ảnh hưởng: chưa khóa ma trận recovery/retention/trace. Gate: `DOC-G2/G0`. Mở khi policy được ký và rehearsal plan có owner/fixture |
| `PROG-005` HW + FW | IOP continuity, safe timeout 199/200/201 ms, BSP/pin/test point và HIL procedure tại [`DDD-FWMCU-PROG-001`](../../02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md) §4–§14 và [`DDD-HW-PROG-001`](../../04_design/hardware/PROGRAMMING_HW_DESIGN.md) §4–§13 | FW MCU + HW + Safety + QA; `HW-AUTH-001/002/007/008`; `OD-PROG-008` phần HIL | `BLOCKED` | Owner: HW/FW. Ảnh hưởng: chưa có authority để chốt BSP/test plan; không được claim deadline điện hoặc HIL. Gate: `P0-B/HW`, sau đó `G6`. Mở P0 khi authority và fixture/HIL plan được duyệt; actual BSP/HIL Test Result đóng tại G6 |
| `PROG-006` QA | 60 requirement, 60 trace row, 16 risk, 32 scenario, manifest candidate, readiness record và kho Test Result tại [`VVP-PROG-001`](../../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) §3, §9–§11, [`TRACE-PROG-001`](../PROGRAMMING_TRACEABILITY_MATRIX.md) §6–§8, [`RSK-PROG-001`](../PROGRAMMING_RISK_REGISTER.md) §3–§6, [`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md), [`PROG-P0-ENV-2026-08-10`](PROGRAMMING_P0_ENVIRONMENT_READINESS_2026-08-10.md) và [`PROG-TR-REPO-001`](../test-results/programming/README.md) | Verification Lead + Product + Architect + consumer reviewers; `OD-PROG-015` | `BLOCKED` | Owner: QA/Document Control. Candidate/host/evidence repo đã sẵn; CI/target/HIL, consumer review và sign-off còn thiếu. Gate: `DOC-G4/G0` |

Kết luận tiến độ: **đã hoàn tất phần chuẩn bị kỹ thuật 7/7; đạt DoD 0/7** vì
DoD P0 bao gồm quyết định và chữ ký thẩm quyền. Không chuyển task sang `DONE` để
làm đẹp tiến độ.

## 4. Checklist cổng `DOC-G4/G0/PLAN_READY`

| Điều kiện | Kết quả 2026-08-10 | Bằng chứng / thiếu gì |
|---|---|---|
| 22/22 hồ sơ tồn tại và được kiểm soát cấu hình | `PASS` | baseline commit ở §2 |
| Cấu trúc/link/ID/trace invariant sạch | `PASS` | `python3 scripts/docs_iso_harness.py --expect -v` |
| Finding kỹ thuật P0/P1 của vòng duyệt agent đóng | `PASS` | [`PROG-REV-2026-08-09`](PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) §6.3 |
| Candidate sau review được ghim revision/hash | `PASS` | [`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) v2.3: 22/22 SHA-256, kiểm bằng `scripts/candidate_pin_check.py`. 10/22 hồ sơ đổi so với `e3e9fb2` qua hai vòng R1/R2; 12/22 giữ nguyên hash và không phải đọc lại |
| Branch/build/toolchain host và evidence repository | `PASS phần chuẩn bị` | [`PROG-P0-ENV-2026-08-10`](PROGRAMMING_P0_ENVIRONMENT_READINESS_2026-08-10.md): host gate PASS; [`PROG-TR-REPO-001`](../test-results/programming/README.md) sẵn, 0/32 Test Result |
| GitHub CI/security runner | `BLOCKED` | Owner: Organization Admin. Ảnh hưởng: không có server evidence. Gate: assurance/release. Mở khi sửa billing và rerun exact commit có step thật |
| Target SOM/HIL lab | `BLOCKED` | Owner: Ops + HW/Safety/QA. Ảnh hưởng: không có target/HIL evidence. Gate: G3–G6. Mở khi SSH auth hoạt động và `HW-AUTH-*`/fixture/calibration được duyệt |
| Consumer review liên chức năng | `BLOCKED` | **Vòng kỹ thuật đã chạy** tại [`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md): 22 hồ sơ theo cặp producer→consumer, 9 finding `F-CR-01..09` đã đóng. Vẫn `0/22 M4` vì `DOC-GOV-001` §3 đòi reviewer là **người thật**; cần `ACCEPT/REQUEST_CHANGE/REJECT` theo revision |
| Baseline approval `OD-PROG-015` | `BLOCKED` | 17/17 decision tổng thể vẫn `OPEN`; `OD-PROG-015` chưa có record |
| Không còn authority/xung đột kiến trúc | `BLOCKED` | 6/6 xung đột nay có ADR chủ quản `ADR-026..031` ở trạng thái `Proposed` (`ARCH-PROG-001` §11). `Proposed` chưa phải `Accepted`: cần chữ ký System Architect, Safety, Security và Verification trên từng ADR |
| Sign-off Product/Architect/Verification | `BLOCKED` | bảng §6 còn `PENDING` |
| `PLAN_READY` | **`BLOCKED`** | Chỉ chuyển `PASS` khi toàn bộ điều kiện trực tiếp phía trên đạt |
| `IMPLEMENT_READY[<lát cắt>]` | **`BLOCKED`** | Cần `PLAN_READY PASS`, task card và decision của đúng lát cắt; contract machine-readable chỉ là entry của lát cắt tiêu thụ, không phải entry của P1 tạo contract |
| `RELEASE_READY` | **`BLOCKED`** | 0/32 Test Result, HIL/rehearsal/residual acceptance chưa có |

## 5. Trình tự review không được bỏ bước

1. Reviewer chạy `python3 scripts/candidate_pin_check.py` và chỉ đọc tiếp khi
   kết quả là `PASS 22/22`; `FAIL` nghĩa là hồ sơ đã trôi khỏi candidate — dừng và
   yêu cầu Document Control phát hành manifest mới. **Không** checkout `e3e9fb2`:
   revision đó đã `SUPERSEDED`.
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

Không điền thay người có thẩm quyền. Reviewer phải ghi **đủ năm trường**: họ tên
và vai trò; kết luận `ACCEPT`/`REQUEST_CHANGE`/`REJECT`; ngày; revision hoặc hash
đã đọc; finding còn lại nếu có.

**Revision phải ghi** là candidate hiện hành ở
[`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md)
§1.1/§2 — **không phải** `e3e9fb2`. Chữ ký ghi `e3e9fb2` là **không hợp lệ** vì
10/22 hồ sơ đã đổi sau revision đó.

Trước khi ký, mỗi vai trò chạy `python3 scripts/candidate_pin_check.py` và chỉ ký
khi kết quả `PASS 22/22`.

| Vai trò | Phạm vi | Kết luận | Người/ngày | Revision đã đọc + finding còn lại |
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

### 6.1 Bốn hành động authority còn lại để mở `PLAN_READY`

Đây là danh sách **đầy đủ** việc còn thiếu. Không việc nào trong số này agent hay
team làm thay được; mỗi việc cần một người có thẩm quyền ghi tên và ngày.

| # | Hành động | Ai làm | “Xong” trông như thế nào | Trạng thái |
|---:|---|---|---|---|
| 1 | Xác nhận lựa chọn `${STATE_DIR}/programming/staging/` cho `F-CR-02` | System Architect | Ghi `ACCEPT` ở §6 kèm câu xác nhận gốc staging; hoặc `REQUEST_CHANGE` kèm gốc thay thế và yêu cầu đổi đồng thời `IFSPEC` §12, `DDD-BE-PROG-001` §14, `DDD-SEC-PROG-001` §7 và `platform/packaging` | **PENDING** |
| 2 | Chuyển `ADR-026..031` sang `Accepted` hoặc ghi `REQUEST_CHANGE` | System Architect + Safety + Security + Verification, theo bảng chữ ký trong từng ADR | Trường `Status` của từng file ADR đổi khỏi `Proposed`, và `ARCH-PROG-001` §11 cập nhật trạng thái tương ứng | **PENDING** — `0/6` |
| 3 | Ký và đóng `OD-PROG-015` | Product Owner + QA | Trạng thái trong `PROG-OD-001` chuyển `OPEN → DECIDED → CLOSED` kèm decision record đủ trường theo mục “Nội dung bắt buộc của decision record” | **PENDING** |
| 4 | Ký `PLAN_READY` | Product + Architect + Verification | Ba `ACCEPT` ở §6 trên **cùng** candidate hiện hành, sau khi việc 1–3 xong; rồi cập nhật `PLAN-PROG-053` §4.2 và §9.2 | **PENDING** |

Thứ tự bắt buộc: việc 1 và 2 trước, vì chúng có thể đổi nội dung hồ sơ; nếu nội
dung đổi thì phải phát hành candidate/hash mới và thu lại chữ ký của phần chịu
ảnh hưởng. Việc 3 trước việc 4.

Tám chữ ký consumer ở
[`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md)
§5.2 là điều kiện song song, không thay thế bốn việc trên.

## 7. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Lập gói review P0 `PROG-000..006`; gom evidence/decision/blocker/sign-off; giữ trung thực `DOC-G4/G0/PLAN_READY BLOCKED` |
| 1.1 | 2026-08-10 | Ghim candidate `e3e9fb2` bằng manifest 22 hồ sơ + hai hồ sơ hỗ trợ; chuyển riêng điều kiện pin sang PASS; giữ 0/7 DoD và mọi gate quyền hạn BLOCKED vì review/chữ ký còn thiếu |
| 1.2 | 2026-08-10 | Đo môi trường P0: host branch/build/toolchain + evidence repo PASS phần chuẩn bị; tách CI billing, target SSH auth và HIL authority/fixture thành blocker; giữ P0 0/7 DoD và gate quyền hạn BLOCKED |
| 1.3 | 2026-08-10 | Ghi nhận vòng consumer review kỹ thuật `PROG-P0-CONSUMER-REVIEW-2026-08-10` (9 finding `F-CR-01..09` đã đóng) và sáu ADR `ADR-026..031` cho `ARCH-CONF-PROG-001..006`; chuyển điều kiện ghim candidate sang `HẾT HIỆU LỰC` vì 7/22 hồ sơ đã đổi; giữ `0/22 M4`, P0 `0/7` DoD và mọi cổng quyền hạn `BLOCKED` |
| 1.4 | 2026-08-10 | Ghim lại candidate bằng 22 SHA-256 (manifest v2.1) thay vì theo commit, vì ghim theo commit luôn bị chính commit đồng bộ tracker làm lệch. Điều kiện kiểm soát cấu hình trở lại `PASS` với 9/22 hồ sơ đổi và 13/22 giữ hash. Mọi điều kiện còn lại — chữ ký, `OD-PROG-015`, ADR `Accepted`, CI/target/HIL — giữ `BLOCKED`; P0 vẫn `0/7` DoD và `0/22 M4` |
| 1.5 | 2026-08-10 | Đóng `F-CR-10`: §2 và §5 còn chỉ reviewer checkout `e3e9fb2` — revision đã `SUPERSEDED` — nên chữ ký thu được sẽ đặt lên nội dung sai. Chuyển sang định danh 22 SHA-256, thêm dòng candidate cũ, bắt buộc chạy `candidate_pin_check.py` trước khi đọc và trước khi ký; §6 nêu đủ năm trường bắt buộc của một chữ ký hợp lệ |
