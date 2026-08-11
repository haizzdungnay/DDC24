# Manifest candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CANDIDATE-MANIFEST-2026-08-10` |
| Loại | Hồ sơ kiểm soát cấu hình; không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 3.3 |
| Ngày | 2026-08-11 |
| Chủ quản | Document Control |
| Người review | Product, System Architect, Verification Lead và consumer reviewers |
| Trạng thái | **ACTIVE — candidate v2.9 `IMPLEMENTATION IN PROGRESS`; P1 1/6; `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS`** |
| Định danh candidate | **22 SHA-256 ở §2** — xem §1.1 về lý do hash là authority, không phải commit |
| Candidate commit | `PENDING MERGE TASK-PROG-100` — **22 hash ở §2 là định danh hiện hành**; commit chỉ được ghi bổ sung sau merge |
| PR nguồn | Không thuộc định danh candidate; tra từ commit ở §1.1 hoặc CHANGELOG |
| Candidate trước | v2.8 tại commit `b068b7d` — **SUPERSEDED bởi cập nhật trace/progress TASK-PROG-100**, xem §4 |
| Gói review | [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) |
| Biên bản consumer review | [`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) |
| Record phê duyệt nền v2.8 | `AUTH-PROG-2026-08-11-03` tại gói review §6.2 — tiếp tục áp dụng; v2.9 không đổi requirement/design decision |

## 1. Phạm vi và phán quyết

Manifest này ghim **đúng nội dung phải được review** cho `P0-A` và
`PROG-000..006`. Candidate gồm 22 hồ sơ baseline cùng ba hồ sơ hỗ trợ ở §3.

### 1.1 Vì sao hash là định danh, không phải commit

Bản v1.0 ghim commit `e3e9fb2` rồi các commit sau đó sửa `PLAN-PROG-053` — một hồ
sơ **nằm trong mẫu số 22** — mà không phát hành manifest mới. Reviewer đọc cây làm
việc sẽ đọc nội dung khác với revision ghi trong manifest, và không có gì báo cho
họ biết. Lỗi này lặp lại ngay trong lần ghim v2.0: commit `7523863` bị chính commit
đồng bộ tracker đi kèm làm lệch.

Nguyên nhân là bất biến của quy trình, không phải sơ suất một lần: manifest phải
được cập nhật **cùng** vòng sửa hồ sơ, mà bản thân việc cập nhật đó lại sinh ra
commit mới. Không commit đơn lẻ nào vừa chứa manifest vừa là commit mà manifest
ghim.

Cách xử lý:

1. **22 SHA-256 ở §2 là định danh candidate.** Chúng bất biến và kiểm lại được từ
   bất kỳ commit nào.
2. **Commit chỉ là nơi nội dung đó xuất hiện lần đầu**, ghi bổ sung ở bảng dưới
   sau khi merge. Việc ghi bổ sung chỉ sửa manifest — một hồ sơ **ngoài** mẫu số
   22 — nên không làm lệch chính nó.
3. **Drift được kiểm bằng máy**, không bằng kỷ luật: `scripts/candidate_pin_check.py`
   so hash ở §2 với cây làm việc và fail nếu lệch (§5).

| Thuộc tính | Giá trị |
|---|---|
| Commit chứa nội dung candidate | `PENDING MERGE TASK-PROG-100` |
| Git tree | `PENDING MERGE TASK-PROG-100` |
| Nhánh phát hành | `feat/programming-contract-foundation-20260811` |

Reviewer phải ghi **đủ 22 hash ở §2 hoặc commit ở bảng trên** trong kết luận, và
chạy `scripts/candidate_pin_check.py` trước khi bắt đầu đọc.

Việc ghim candidate xác định đúng baseline được duyệt. Nó **không**:

- nâng bất kỳ hồ sơ nào từ `M3` lên `M4/M5`;
- giả chữ ký consumer/Verification hoặc Test Result;
- biến source/target/HIL chưa chạy thành PASS;
- tự mở `RELEASE_READY`.

`AUTH-PROG-2026-08-11-03` đã mở `PLAN_READY` và mọi `IMPLEMENT_READY[*]`; việc
ghim hash bảo đảm team đọc đúng candidate v2.9: baseline v2.8 đã phê duyệt cộng
trạng thái triển khai thật của `TASK-PROG-100`.

Baseline gốc `05c1c480418a2256f1010527f9d90fb6ff549b86` vẫn được giữ để so
sánh/rollback. Chuỗi candidate của vòng P0 là
`05c1c48` → `e3e9fb2` → **candidate hiện hành ở §2**.

## 2. Manifest 22 hồ sơ baseline

SHA-256 tính trên byte của file. Cột “Đổi” đánh dấu hồ sơ khác so với candidate
trước `e3e9fb2`.

| # | Đường dẫn | SHA-256 | Git blob | Dòng | Đổi |
|---:|---|---|---|---:|:---:|
| 1 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `8abc648fde69e62c1394247483914965b6a45411e6c96843a2c7220385eb42f7` | `87766cf20663dd91434f5e3e84885acaa029138b` | 237 | ✱ |
| 2 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `b8c46672b09f7a45005108bee3fdbed644a5012b809f9b3e8fe09c057581b0da` | `6d9d75dc24dc4d8bb0e2d03edb443635b3e34394` | 272 | ✱ |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `204f2ef77f66e1c1088959c592018006bb3e1b828a34f1031c151fe638e27929` | `d060739a398b9efe50ed40283e936a5df9a8f9d4` | 254 | ✱ |
| 4 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `02fe3a541c95b0c9d0d39869f7b97078ddb4fb23d70d23b9bdb395d9400a3a30` | `44180dd9107b528a35b57f800b5e97d750a4b9b2` | 415 | ✱ |
| 5 | `docs/02_design/software/PROGRAMMING_DATA_MODEL.md` | `4dfe7245e276682a3f764c629222669fcbc107daad457ae94670c818774d76d3` | `9e096e622528a9c3267e9457e33beb0ab26bd98a` | 520 | ✱ |
| 6 | `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | `3790a3586731ec5492cc87430f6a29c2ab0c01ce9b501b183e7ab80b14ba3b59` | `e8e863af90fc9a1d380681f45ce5dd3fde41a97f` | 589 | ✱ |
| 7 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `7f7bb5b1e7ecea62c495fc605eed11dac1886420fc8496848a44d8797ee8c5d0` | `a34a65a513264474260911dcccd87b87e69d68d9` | 343 | ✱ |
| 8 | `docs/02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `e67d4341648a7606a786a9a0f25582b4575f30102dfc737e04227a0e50c2a097` | `3ad8de95dfc8959c85863789f102fe97eefdc074` | 285 | ✱ |
| 9 | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` | `028bf0c90cc4f37c3445735d9723a98d5f3de918650dfb5897e81b4cd1bc655b` | `51a6ff3429ac68e8f0890d53643564b4221520ea` | 326 | ✱ |
| 10 | `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `58a3613fb111f9592c210b379d1ba0718ccde42324ed3cabbc931df5319816b1` | `620f100b89ae5c08f26dca6654b343686a5c72b9` | 322 | ✱ |
| 11 | `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | `7dacf762fe9732d87f3f41e140b76c0a1a7fd4c29c34717b1c03a6deb6a26b50` | `fdb25a91ee6cae30c49295cb49277bbc6c65e481` | 309 | ✱ |
| 12 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `b31bdeadaf3008bc8f5ab34b8a310f10326e972a0926ff9883489de8dedde568` | `8930ca4580ecff586495cacea0134943c0367021` | 1361 | ✱ |
| 13 | `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | `519b84764d5339f1f07819a5a8982fd7eb85c590c6c7b38a544821547313a345` | `4400fd4f160dce0aa19b17748da3cc459698da01` | 425 | ✱ |
| 14 | `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | `0ccaad01843fb258fccca94a6c4325edc5d6b43815ff6ac64d8cc657b45da3b6` | `174d734ab4188ab480fddd555d2bb9b22a323d0e` | 391 | ✱ |
| 15 | `docs/02_design/software/PROGRAMMING_FW_SOM_DESIGN.md` | `a1c66a11f3bb2cbc6933ecc18d1fca641462a9c4c2a2c951e3f3c372ef3caaff` | `461a6f0c472a2d7eafda687e1cae4e17d3972bce` | 341 | ✱ |
| 16 | `docs/02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md` | `8be8f4f116a46dea1c298de1a13e2e130827bcb2047355c2d136ad81b5206b74` | `2a067b969e8011d985977eba046ec6d044e0f901` | 265 | ✱ |
| 17 | `docs/04_design/hardware/PROGRAMMING_HW_DESIGN.md` | `b6c313f3c01830b9ec70abdd1ab1666d7aa640f1ee2486548a4a1ae1204399c6` | `43f7d5765ce3464f43e6e3b242114d1445403bb1` | 258 | ✱ |
| 18 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `14c424c07a8cff5665fcbf83b87427d2100d9d028b34a8c513a58766e5f8070b` | `be3fdc70ef02d9cc5fab484eccdecd8fa6c44331` | 306 | ✱ |
| 19 | `docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md` | `ac7fed9c3134f32f16f28dee7d9b3f60585ef62df749d0148fc15770ba8fc6ba` | `6a09f28979d99ebfc07e8183a1ad01085a7e4488` | 335 | ✱ |
| 20 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `41081f6c520ce2037730d42cc54134e817a75657b29ddd067941fd5a797454df` | `81fa1767d42be469771adb045b9ada722862abd4` | 175 | ✱ |
| 21 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `4fff5bd7b60a3d671d6ad01d0320cb3a53b6340b6619886a95d6bd745db27049` | `ce827756f7de23b6f578796723bc7f94e1696b83` | 332 | ✱ |
| 22 | `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `bea361b4fed881e8b1d1d80183c559647973478ebd77cd5805fe8e25acd1d07e` | `9d0825583ba3aa570994e8a9f235dfc200e84bf9` | 1139 | ✱ |

So với candidate v2.7, **22/22 hồ sơ đã đổi** để tạo nền v2.8 được phê duyệt.
Candidate v2.9 hiện tại chỉ đổi dòng 21–22 so với v2.8 để ghi trace/progress
`TASK-PROG-100`; dấu `✱` tiếp tục biểu thị delta tích lũy so với v2.7.

## 3. Hồ sơ hỗ trợ ngoài mẫu số 22

| Hồ sơ | Phiên bản tại lần ghim này | Vai trò |
|---|---|---|
| `docs/03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md` | v3.3 | Tracker hồ sơ và đồng bộ tiến độ code |
| `docs/07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md` | v2.0 | Gói phê duyệt toàn bộ |
| `docs/07_records/reviews/PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md` | v1.6 | Biên bản consumer review + waiver |

Ba hồ sơ này ghi **phiên bản**, không ghi SHA-256. Lý do giống §1.1: chúng thay đổi
trong cùng vòng cập nhật với manifest, nên một hash ghi ở đây sẽ sai ngay khi commit
được tạo. Chúng nằm **ngoài** mẫu số 22, nên sửa chúng không làm lệch candidate và
không cần phát hành manifest mới.

Sáu ADR `ADR-026..031` cũng nằm ngoài mẫu số 22 vì chúng là **quyết định**, không
phải hồ sơ baseline. Cả sáu đã `Accepted` theo `AUTH-PROG-2026-08-11-03`.

## 4. Delta so với candidate v2.8

Candidate v2.9 thay đổi **2/22** hồ sơ, không đổi requirement hoặc thiết kế:

- `PLAN-PROG-053` lên v0.18: `TASK-PROG-100 DONE`, P1 `IN_PROGRESS 1/6`, dẫn
  source commit và bằng chứng regression thật.
- `TRACE-PROG-001` lên v2.8: nâng riêng `BE-110 I=Y`; `FE-110`, `NFR-106` và
  mọi `T/P/R` giữ `N` vì phần còn lại/Test Result chưa có.
- Source output được khóa qua `9917e3b`, `81080f8`, `efbed2d`; commit cuối thêm
  golden impact payload được Go và TypeScript cùng đọc.
- 20/22 hồ sơ còn lại byte-identical với v2.8. Approval
  `AUTH-PROG-2026-08-11-03` tiếp tục hiệu lực; không thêm chữ ký hoặc Test Result.
- OpenAPI/Go/TypeScript là source output của task, không nằm trong mẫu số 22;
  evidence hỗ trợ tại `PROG-G1-IMPLEMENTATION-REVIEW-2026-08-11`.

Các hồ sơ hỗ trợ, Decision Log, sáu ADR và asset SVG nằm ngoài mẫu số 22 nhưng
được đồng bộ trong cùng thay đổi để không còn chỉ báo gate mâu thuẫn.

## 5. Cách tái kiểm

**Bước bắt buộc trước khi đọc để review:**

```bash
python3 scripts/candidate_pin_check.py
```

Script tính lại SHA-256 của 22 hồ sơ trong cây làm việc và so với bảng §2. `PASS`
nghĩa là nội dung bạn sắp đọc **đúng** là candidate. `FAIL` nghĩa là có hồ sơ đã
đổi sau khi ghim — dừng lại và yêu cầu Document Control phát hành manifest mới,
không review tiếp.

Kiểm thủ công từng file, hoặc kiểm tại một commit bất kỳ:

```bash
sha256sum docs/03_architecture/PROGRAMMING_ARCHITECTURE.md
git show <commit>:<đường-dẫn> | sha256sum
git diff --numstat e3e9fb26f61b39df8f805916333fc03b51f07f5f HEAD -- <đường-dẫn>
```

Kết quả phát hành: 22/22 SHA-256 và Git blob ở §2 khớp cây làm việc tại thời điểm
phát hành (`candidate_pin_check.py` `PASS`). Harness tài liệu phải được chạy lại
sau mọi thay đổi tracker, nhưng kết quả đó không thay hash candidate.

## 6. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Ghim candidate P0 `e3e9fb2`, tree, 22 file baseline, hai hồ sơ hỗ trợ và delta từ baseline gốc; giữ approval/gate ở trạng thái bị chặn |
| 2.0 | 2026-08-10 | Ghim candidate mới sau khi đóng `F-CR-01..09`; `e3e9fb2` chuyển `SUPERSEDED`. Sửa số đếm sai trong biên bản consumer review: **9/22** hồ sơ đổi chứ không phải 7 — `PROGRAMMING_DESIGN_INDEX.md` và `53_PROGRAMMING_IMPLEMENTATION_PLAN.md` cũng thuộc mẫu số 22 và đã đổi. Thêm hồ sơ hỗ trợ thứ ba là biên bản consumer review; giữ mọi cổng quyền hạn `BLOCKED` |
| 2.1 | 2026-08-10 | Sửa lỗi quy trình phát hiện khi tự kiểm bản 2.0: ghim theo commit luôn bị chính commit đồng bộ tracker làm lệch, vì `PLAN-PROG-053` nằm trong mẫu số 22. Chuyển định danh candidate sang **22 SHA-256 ở §2**, commit chỉ ghi bổ sung sau merge; thêm §1.1 giải thích và `scripts/candidate_pin_check.py` để bắt drift bằng máy thay vì bằng kỷ luật |
| 2.2 | 2026-08-10 | Ghi bổ sung commit `e278aaa` và tree `2dadad30` — nơi nội dung candidate xuất hiện trên `origin/main`. Bước này chỉ sửa manifest, hồ sơ **ngoài** mẫu số 22, nên `candidate_pin_check.py` vẫn PASS 22/22; đây đúng là hành vi mà §1.1 thiết kế |
| 2.3 | 2026-08-10 | Cập nhật hash của `PLAN-PROG-053` (v0.14) và `PROG-DOCSET-001` (v1.6) sau vòng A2 sửa phát biểu trạng thái cũ. Đây đúng là quy trình mà §1.1 yêu cầu: hồ sơ trong mẫu số 22 đổi ⇒ manifest cập nhật **cùng phiên** ⇒ `candidate_pin_check.py` chạy lại tới khi `22/22` PASS |
| 2.4 | 2026-08-10 | Ghi bổ sung commit `bbd7d2d` và tree `bb0acb60` cho vòng A2. `candidate_pin_check.py` vẫn PASS `22/22` sau khi ghi, vì bước này chỉ sửa manifest — hồ sơ ngoài mẫu số 22 |
| 2.5 | 2026-08-10 | Phát hành candidate sau `AUTH-PROG-2026-08-10-01`: tính lại 22 SHA-256/Git blob; 8/22 hồ sơ đổi so với v2.4, 11/22 đổi tích lũy so với `e3e9fb2`. Ghi Product + Architect `ACCEPT`, giữ consumer/Verification/discipline PENDING và mọi implementation/release gate BLOCKED |
| 2.6 | 2026-08-10 | Ghi bổ sung commit `ac059a1` và tree `5e47316e` chứa nội dung candidate v2.5. Chỉ manifest ngoài mẫu số 22 đổi; `candidate_pin_check.py` tiếp tục PASS 22/22 |
| 2.7 | 2026-08-10 | Phát hành candidate sau rà gate trước P1: chỉ `PLAN-PROG-053` đổi để sửa §6.5/§10 còn gọi `e3e9fb2` là candidate hiện hành và đồng bộ trạng thái xác nhận delta. Không đổi requirement/contract/thiết kế; Product/Architect v2.5 cần xác nhận delta trên v2.7; mọi gate giữ `BLOCKED` |
| 2.8 | 2026-08-10 | Ghi bổ sung commit `a236200` và tree `8296338d` chứa nội dung candidate v2.7. Chỉ manifest và hồ sơ hỗ trợ ngoài mẫu số 22 đổi; `candidate_pin_check.py` tiếp tục PASS 22/22 |
| 2.9 | 2026-08-11 | Đồng bộ phiên bản hồ sơ hỗ trợ sau khi sửa biên bản consumer sang candidate v2.7 và cập nhật Roadmap. Không đổi bất kỳ SHA-256 nào trong mẫu số 22; candidate/commit và mọi gate giữ nguyên |
| 3.0 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-02`: Product Owner/CTO + System Architect `ACCEPT` candidate v2.7 sau khi pin `22/22` và review delta v2.5→v2.7. Không đổi bất kỳ hash nào trong mẫu số 22; consumer/Verification/discipline approval và các gate còn lại giữ trạng thái thực tế |
| 3.1 | 2026-08-11 | Phát hành candidate v2.8 theo `AUTH-PROG-2026-08-11-03`: 22/22 hồ sơ đồng bộ approval/waiver; `17 DECIDED/0 OPEN/0 CLOSED`; 6/6 ADR `Accepted`; `PLAN_READY` và mọi `IMPLEMENT_READY[*]` PASS; Product + Architect `ACCEPT ALL`; consumer/discipline/Verification/Document Control `WAIVED FOR IMPLEMENTATION` |
| 3.2 | 2026-08-11 | Ghi bổ sung commit `b068b7d` và tree `6ab6ac10` chứa candidate v2.8. Chỉ manifest và hồ sơ hỗ trợ ngoài mẫu số 22 đổi; 22 SHA-256 không đổi |
| 3.3 | 2026-08-11 | Phát hành candidate v2.9 sau `TASK-PROG-100`: cập nhật hash/blob của Trace v2.8 và Plan 53 v0.18; 20/22 hồ sơ còn lại giữ nguyên. Chưa ghi commit/tree cho tới khi PR merge; 22 SHA-256 là authority hiện hành |
