# Gói review cổng P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-GATE-2026-08-10` |
| Loại | Decision/design/sign-off package; hồ sơ hỗ trợ, không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 2.0 |
| Ngày | 2026-08-11 |
| Phạm vi | `PROG-000..006`, `DOC-G4`, `G0`, `PLAN_READY` |
| Chủ quản | Dev Lead + System Architect |
| Người review | Product, Controls/Safety, Security, Runtime/Ops, FW MCU, HW, QA/Verification, Document Control |
| Người phê duyệt | Product Owner + System Architect + Verification Lead |
| Trạng thái | **APPROVED FOR IMPLEMENTATION — `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS` theo `AUTH-PROG-2026-08-11-03`** |
| Kế hoạch chủ quản | [`PLAN-PROG-053`](../../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) §5.1 |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Gói này dùng để làm gì? | Gom toàn bộ đầu vào, kết luận kỹ thuật, decision cần ký và ô sign-off của P0 vào một nơi để các authority review mà không phải tự dò 22 hồ sơ. |
| Đã hoàn tất gì? | Review cấu trúc Plan 53; ma trận `PROG-000..006`; harness; **ghim candidate hiện hành bằng 22 SHA-256**; host branch/build/toolchain; kho Test Result; **vòng consumer review kỹ thuật với `9/9` finding `F-CR-01..09` đã đóng**; **phần kỹ thuật của 6 xung đột kiến trúc đóng bằng `ADR-026..031`**. |
| Chưa hoàn tất gì? | Không còn việc approval nào trước implementation. Chữ ký consumer/QA/Verification/Safety/Security/Runtime/Ops/I/O/UX/Controls được `WAIVED FOR IMPLEMENTATION`; CI/CD/target/HIL không phải entry condition. |
| Có được implement production chưa? | **Có.** Team được tạo nhánh, viết/merge code production, đổi contract và bật feature flag ở lab ngay. |
| Làm gì tiếp theo? | Bắt đầu `TASK-PROG-100/101/102/104` theo Plan 53. Review còn thiếu thực hiện hậu kiểm trong task; test/evidence được thu theo DoD. |

## 1. Phán quyết duyệt kế hoạch

**ACCEPTED WITHOUT ADDITIONAL APPROVAL CONDITIONS — APPROVED FOR IMPLEMENTATION.**

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

`AUTH-PROG-2026-08-11-03` thay thế điều kiện approval còn thiếu ở cổng bắt đầu
implementation. Nó không giả chữ ký/Test Result và không biến evidence chưa chạy
thành PASS.

## 2. Baseline và cấu hình được review

| Đầu vào | Revision/trạng thái | Kết luận |
|---|---|---|
| Baseline 22 hồ sơ | commit `05c1c480418a2256f1010527f9d90fb6ff549b86` | Đã ghim, 22/22 file được Git theo dõi; đây là baseline trước vòng sửa P0 ngày 2026-08-10 |
| Chuỗi candidate P0 | `05c1c48` → `e3e9fb2` (SUPERSEDED) → **candidate hiện hành** | Định danh là 22 SHA-256 ở manifest §2, không phải commit — xem manifest §1.1. Reviewer chạy `python3 scripts/candidate_pin_check.py` trước khi đọc |
| Candidate P0 **hiện hành** | Candidate v2.8, định danh bằng **22 SHA-256** ở [`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) §2 | `AUTH-PROG-2026-08-11-03`; team dùng revision này để implement |
| Candidate P0 **cũ** | `e3e9fb26f61b39df8f805916333fc03b51f07f5f` | **`SUPERSEDED`** — 11/22 hồ sơ đã đổi qua ba vòng R1/R2/R3. **Không** ký lên revision này |
| Mức trưởng thành | 22/22 `M3`; 0/22 `M4`; 0/22 `M5` | M4/M5 `WAIVED FOR IMPLEMENTATION`; không còn chặn code |
| Bằng chứng sản phẩm | 0/32 Test Result | Không suy ra implementation, HIL hoặc release readiness |

Nếu nội dung candidate P0 cần sửa, phải phát hành candidate/hash mới và review
lại phần chịu ảnh hưởng. Gói v1.1 hiện hành là record theo dõi việc ghim; nội
dung authority review v1.0 nằm trong chính candidate. Chữ ký không ghi
revision/commit cụ thể là không hợp lệ.

## 3. Kết quả triển khai `PROG-000..006`

| Task | Gói kỹ thuật | Quyết định/authority | Trạng thái P0 | Bàn giao implementation |
|---|---|---|---|---|
| `PROG-000` Product | Scope/profile/workspace/journey | `OD-PROG-001..007`, `015..017` `DECIDED` | `DONE` | P1 dùng baseline v2.8 |
| `PROG-001` Architect | Ownership/base-step/cutover/safe-state | `ADR-026..031` `Accepted` | `DONE` | Core/BE triển khai theo Architecture |
| `PROG-002` Controls | Priority/PID/hold-last/overrun | Decision liên quan `DECIDED` | `DONE` | Controls review hậu kiểm |
| `PROG-003` Product + Security | RBAC/TLS/integrity/audit | `OD-PROG-001` và integrity `DECIDED` | `DONE` | TLS/security test nằm trong task, không chặn start |
| `PROG-004` Runtime + Ops | Commission/Restore/RETAIN/LKG | `OD-PROG-009/010/011/014` `DECIDED` | `DONE` | Rehearsal/evidence thu theo P4–P6 |
| `PROG-005` HW + FW | IOP/BSP/test point/HIL procedure | HW/HIL approval `WAIVED FOR IMPLEMENTATION` | `DONE` cho P0 | BSP/fixture/HIL là deliverable P6 |
| `PROG-006` QA | 60 requirement, 32 scenario, trace/risk/evidence schema | Verification/Document Control `WAIVED FOR IMPLEMENTATION` | `DONE` | QA tạo Test Result theo DoD |

Kết luận tiến độ: **P0 đạt 7/7 DoD cho entry implementation**; P1 được bắt đầu
ngay. Không có approval blocker còn lại.

## 4. Checklist cổng `DOC-G4/G0/PLAN_READY`

| Điều kiện | Kết quả 2026-08-11 | Bằng chứng / ghi chú |
|---|---|---|
| 22/22 hồ sơ tồn tại và được kiểm soát cấu hình | `PASS` | baseline commit ở §2 |
| Cấu trúc/link/ID/trace invariant sạch | `PASS` | `python3 scripts/docs_iso_harness.py --expect -v` |
| Finding kỹ thuật P0/P1 của vòng duyệt agent đóng | `PASS` | [`PROG-REV-2026-08-09`](PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) §6.3 |
| Candidate sau authority record được ghim revision/hash | `PASS` sau refresh manifest | Candidate v2.8: 22/22 SHA-256, kiểm bằng `scripts/candidate_pin_check.py` |
| Branch/build/toolchain host và evidence repository | `PASS phần chuẩn bị` | [`PROG-P0-ENV-2026-08-10`](PROGRAMMING_P0_ENVIRONMENT_READINESS_2026-08-10.md): host gate PASS; [`PROG-TR-REPO-001`](../test-results/programming/README.md) sẵn, 0/32 Test Result |
| GitHub CI/security runner | `DEFERRED — NOT AN ENTRY CONDITION` | Không dùng làm điều kiện cho `PLAN_READY` hoặc `IMPLEMENT_READY[*]` |
| Target SOM/HIL lab | `DEFERRED — NOT AN ENTRY CONDITION` | Dùng cho target/HIL evidence sau khi có code; không chặn implementation |
| Consumer review liên chức năng | `WAIVED FOR IMPLEMENTATION` | Vòng kỹ thuật đã chạy, 9/9 finding đóng; 8 chữ ký không còn là entry condition |
| Baseline approval `OD-PROG-015` | `PASS` | `DECIDED` theo `AUTH-PROG-2026-08-11-03`; toàn register `17 DECIDED`, `0 OPEN`, `0 CLOSED` |
| Không còn authority/xung đột kiến trúc | `PASS` | 6/6 ADR `ADR-026..031` `Accepted` |
| Sign-off Product/Architect/Verification | `PASS FOR IMPLEMENTATION` | Product + Architect `ACCEPT ALL`; Verification `WAIVED FOR IMPLEMENTATION` |
| `PLAN_READY` | **`PASS`** | `AUTH-PROG-2026-08-11-03` |
| `IMPLEMENT_READY[<lát cắt>]` | **`PASS` cho mọi lát cắt** | Không còn approval condition; bắt đầu P1 ngay |
| `RELEASE_READY` | **`BLOCKED`** | 0/32 Test Result, HIL/rehearsal/residual acceptance chưa có |

## 5. Trình tự review hậu kiểm trong implementation

Các bước dưới đây không phải điều kiện để bắt đầu/tiếp tục code; chúng được thực
hiện trong task để giữ trace và chất lượng.

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
6. Comment phát hiện trong implementation phải được xử lý theo severity; toàn bộ
   `OD-PROG-*` hiện đã `DECIDED`.
7. Document Control cập nhật Plan 53/54, Index, Trace, Risk và CHANGELOG; chạy
   lại harness trước khi đề nghị chuyển gate.

## 6. Biên bản review và sign-off

Không tự điền thay người không ủy quyền. Reviewer phải ghi **đủ năm trường**: họ tên
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
| Product Owner/CTO | `PROG-000`, scope/claim, `OD-PROG-015..017` | **ACCEPT ALL candidate v2.8** | **Phạm Đình Chương / 2026-08-11** | `AUTH-PROG-2026-08-11-03`; không có approval condition còn lại |
| System Architect | `PROG-001`, ownership/cutover/deploy | **ACCEPT ALL candidate v2.8** | **Phạm Đình Chương / 2026-08-11** | `AUTH-PROG-2026-08-11-03`; 6/6 ADR `Accepted` |
| Controls + Safety | `PROG-002`, timing/priority/PID/fault | **WAIVED FOR IMPLEMENTATION** | — | Review hậu kiểm; không giả chữ ký |
| Security + Platform | `PROG-003`, RBAC/TLS/integrity/audit | **WAIVED FOR IMPLEMENTATION** | — | Review hậu kiểm; không giả chữ ký |
| Runtime + Ops | `PROG-004`, RETAIN/LKG/recovery/rehearsal | **WAIVED FOR IMPLEMENTATION** | — | Review hậu kiểm; không giả chữ ký |
| FW MCU + HW + Safety | `PROG-005`, BSP/electrical/HIL | **WAIVED FOR IMPLEMENTATION** | — | Review/HIL theo task; không giả chữ ký |
| Verification Lead | `PROG-006`, VVP/trace/risk/gate | **WAIVED FOR IMPLEMENTATION** | — | Test Result giữ authority độc lập; không chặn code |
| Document Control | revision/hash/register/harness | **WAIVED FOR IMPLEMENTATION** | — | Kiểm máy vẫn chạy; không chặn code |

`WAIVED FOR IMPLEMENTATION` không phải chữ ký của vai trò đó; đây là quyết định
không dùng chữ ký còn thiếu làm điều kiện mở code. `PLAN_READY` đã `PASS`.

### 6.1 Record lịch sử `AUTH-PROG-2026-08-11-02` — `SUPERSEDED`

- **Người ủy quyền:** Phạm Đình Chương.
- **Vai trò:** Product Owner/CTO + System Architect.
- **Cách ghi nhận:** người dùng yêu cầu Codex review và cập nhật `APPROVE` thay
  mặt mình. Codex ghi biên bản ủy quyền điện tử; không giả chữ ký viết tay, chứng
  thư số hoặc chữ ký của consumer/Verification/Document Control.
- **Revision đã review:** candidate v2.7, 22 SHA-256 tại manifest §2, commit đầy
  đủ `a23620026c6c6a44625d149361b9949b31e93f90`.
- **Kiểm cấu hình:** `python3 scripts/candidate_pin_check.py` trả `PASS 22/22`
  trước khi review.
- **Delta đã review:** `git diff ac059a1..a236200` trên 22 hồ sơ chỉ đổi
  `PLAN-PROG-053` (`15` dòng thêm, `13` dòng xóa) để sửa chỉ báo candidate và
  trạng thái; không đổi requirement, contract, data model, thuật toán, safety
  behavior hoặc target design.
- **Kết luận:** Product Owner/CTO + System Architect `ACCEPT` candidate v2.7;
  xác nhận delta so với v2.5 chỉ sửa chỉ báo cấu hình/trạng thái và không phát
  sinh finding mới.
- **Chỉ đạo CI/CD:** `DEFERRED` khỏi entry của `PLAN_READY` và
  `IMPLEMENT_READY[contract]`; vẫn phải có evidence thật trước assurance/release,
  không được suy thành CI PASS.
- **Ảnh hưởng tại thời điểm ghi:** chỉ đóng blocker xác nhận delta v2.7. Trạng
  thái này đã được `AUTH-PROG-2026-08-11-03` thay thế toàn bộ ở §6.2.

### 6.2 Record `AUTH-PROG-2026-08-11-03` — phê duyệt toàn bộ

- **Người ủy quyền:** Phạm Đình Chương.
- **Vai trò:** Product Owner/CTO + System Architect.
- **Chỉ đạo được ghi nhận:** review và duyệt hết, không kèm điều kiện approval
  hoặc chữ ký bổ sung để team có thể implement.
- **Candidate:** v2.8, 22 hồ sơ baseline được ghim trong manifest hiện hành.
- **Quyết định:** `OD-PROG-001..017 = DECIDED`; `ADR-026..031 = Accepted`.
- **Cổng:** `PLAN_READY = PASS`; mọi `IMPLEMENT_READY[*] = PASS`.
- **Miễn điều kiện:** 8 consumer, discipline, Verification và Document Control
  được ghi `WAIVED FOR IMPLEMENTATION`; CI/CD, target và HIL không phải entry
  condition.
- **Quyền thực thi:** team được tạo nhánh, viết/merge code production, đổi
  contract và bật feature flag trong lab theo task card.
- **Tính trung thực:** không tạo tên/chữ ký/Test Result giả. Evidence chưa chạy
  vẫn ghi `MISSING/NOT_RUN`; việc đó không đóng lại quyền implementation.

Không còn hành động authority nào phải hoàn tất trước khi bắt đầu P1.

## 7. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Lập gói review P0 `PROG-000..006`; gom evidence/decision/blocker/sign-off; giữ trung thực `DOC-G4/G0/PLAN_READY BLOCKED` |
| 1.1 | 2026-08-10 | Ghim candidate `e3e9fb2` bằng manifest 22 hồ sơ + hai hồ sơ hỗ trợ; chuyển riêng điều kiện pin sang PASS; giữ 0/7 DoD và mọi gate quyền hạn BLOCKED vì review/chữ ký còn thiếu |
| 1.2 | 2026-08-10 | Đo môi trường P0: host branch/build/toolchain + evidence repo PASS phần chuẩn bị; tách CI billing, target SSH auth và HIL authority/fixture thành blocker; giữ P0 0/7 DoD và gate quyền hạn BLOCKED |
| 1.3 | 2026-08-10 | Ghi nhận vòng consumer review kỹ thuật `PROG-P0-CONSUMER-REVIEW-2026-08-10` (9 finding `F-CR-01..09` đã đóng) và sáu ADR `ADR-026..031` cho `ARCH-CONF-PROG-001..006`; chuyển điều kiện ghim candidate sang `HẾT HIỆU LỰC` vì 7/22 hồ sơ đã đổi; giữ `0/22 M4`, P0 `0/7` DoD và mọi cổng quyền hạn `BLOCKED` |
| 1.4 | 2026-08-10 | Ghim lại candidate bằng 22 SHA-256 (manifest v2.1) thay vì theo commit, vì ghim theo commit luôn bị chính commit đồng bộ tracker làm lệch. Điều kiện kiểm soát cấu hình trở lại `PASS` với 9/22 hồ sơ đổi và 13/22 giữ hash. Mọi điều kiện còn lại — chữ ký, `OD-PROG-015`, ADR `Accepted`, CI/target/HIL — giữ `BLOCKED`; P0 vẫn `0/7` DoD và `0/22 M4` |
| 1.5 | 2026-08-10 | Đóng `F-CR-10`: §2 và §5 còn chỉ reviewer checkout `e3e9fb2` — revision đã `SUPERSEDED` — nên chữ ký thu được sẽ đặt lên nội dung sai. Chuyển sang định danh 22 SHA-256, thêm dòng candidate cũ, bắt buộc chạy `candidate_pin_check.py` trước khi đọc và trước khi ký; §6 nêu đủ năm trường bắt buộc của một chữ ký hợp lệ |
| 1.6 | 2026-08-10 | Ghi ủy quyền điện tử `AUTH-PROG-2026-08-10-01` của Phạm Đình Chương với vai trò Product Owner/CTO + System Architect: Product/Architect `ACCEPT`, xác nhận gốc staging, Architect `ACCEPT` 6/6 ADR. Giữ `PLAN_READY BLOCKED` vì Verification/consumer/discipline sign-off, 14 OD và 6 ADR final còn mở |
| 1.7 | 2026-08-10 | Rà gate trước P1: phát hành candidate v2.7 vì `PLAN-PROG-053` còn hai chỉ báo trỏ candidate đã `SUPERSEDED`; không đổi requirement/contract/thiết kế. Bảo toàn chữ ký v2.5 như lịch sử nhưng yêu cầu Product/Architect xác nhận delta trên v2.7; giữ mọi gate `BLOCKED` |
| 1.8 | 2026-08-10 | Ghi bổ sung commit `a236200`/tree `8296338d` chứa candidate v2.7; không đổi 22 hash, phán quyết hay trạng thái gate |
| 1.9 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-02`: Product Owner/CTO + System Architect Phạm Đình Chương `ACCEPT` candidate v2.7 sau khi `22/22` hash khớp và delta v2.5→v2.7 được xác nhận chỉ đổi chỉ báo. Chuyển CI/CD thành `DEFERRED` khỏi entry của lát cắt contract; giữ `0/8` consumer, `0/22 M4/M5`, Verification/discipline PENDING và `PLAN_READY BLOCKED` |
| 2.0 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-03`: `ACCEPT ALL` candidate v2.8 không kèm approval condition; 17/17 decision `DECIDED`; 6/6 ADR `Accepted`; `PLAN_READY` và mọi `IMPLEMENT_READY[*]` `PASS`; consumer/discipline/Verification/Document Control `WAIVED FOR IMPLEMENTATION`; CI/target/HIL không phải entry blocker; P0 7/7 DONE và P1 READY TO START |
