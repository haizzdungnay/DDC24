# Manifest candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CANDIDATE-MANIFEST-2026-08-10` |
| Loại | Hồ sơ kiểm soát cấu hình; không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 3.22 |
| Ngày | 2026-08-11 |
| Chủ quản | Document Control |
| Người review | Product, System Architect, Verification Lead và consumer reviewers |
| Trạng thái | **ACTIVE — candidate v2.18 `IMPLEMENTATION IN PROGRESS`; P1 6/6 DONE; P2 4/8; G2 IN_PROGRESS; `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS`** |
| Định danh candidate | **22 SHA-256 ở §2** — xem §1.1 về lý do hash là authority, không phải commit |
| Candidate commit | `2899d02` — ghi đầy đủ ở §1.1; **22 hash ở §2 là định danh hiện hành** |
| PR nguồn | [PR #145](https://github.com/Mekong-HCM/MK-DDC-24/pull/145) — merged |
| Candidate trước | v2.17 tại commit `7d424bc` — **SUPERSEDED bởi TASK-PROG-203**, xem §4 |
| Gói review | [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) |
| Biên bản consumer review | [`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) |
| Record phê duyệt nền v2.8 | `AUTH-PROG-2026-08-11-03` tại gói review §6.2 — tiếp tục áp dụng; v2.18 không đổi requirement/design decision |

## 1. Phạm vi và phán quyết

Manifest này ghim **đúng nội dung phải được review** cho `P0-A` và
`PROG-000..006`. Candidate gồm 22 hồ sơ baseline cùng sáu hồ sơ hỗ trợ ở §3.

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
| Commit chứa nội dung candidate | `2899d021f26f43f4f29e8924612239ce3e76e810` |
| Git tree | `cdef0e7777b5cc68df245d77fc4f0f3e2dbb23da` |
| Nhánh phát hành | `feat/programming-artifact-provenance-20260811` — remote đã xóa sau merge |

Reviewer phải ghi **đủ 22 hash ở §2 hoặc commit ở bảng trên** trong kết luận, và
chạy `scripts/candidate_pin_check.py` trước khi bắt đầu đọc.

Việc ghim candidate xác định đúng baseline được duyệt. Nó **không**:

- nâng bất kỳ hồ sơ nào từ `M3` lên `M4/M5`;
- giả chữ ký consumer/Verification hoặc Test Result;
- biến source/target/HIL chưa chạy thành PASS;
- tự mở `RELEASE_READY`.

`AUTH-PROG-2026-08-11-03` đã mở `PLAN_READY` và mọi `IMPLEMENT_READY[*]`; việc
ghim hash bảo đảm team đọc đúng candidate v2.18: baseline đã phê duyệt cộng
trạng thái triển khai thật của `TASK-PROG-100..203`.

Baseline gốc `05c1c480418a2256f1010527f9d90fb6ff549b86` vẫn được giữ để so
sánh/rollback. Chuỗi candidate của vòng P0 là
`05c1c48` → `e3e9fb2` → **candidate hiện hành ở §2**.

## 2. Manifest 22 hồ sơ baseline

SHA-256 tính trên byte của file. Cột “Đổi” đánh dấu hồ sơ khác so với candidate
trước `e3e9fb2`.

| # | Đường dẫn | SHA-256 | Git blob | Dòng | Đổi |
|---:|---|---|---|---:|:---:|
| 1 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `b9865cb5e4438aa30a9bd9430c1cfd5d3457f3b3e54887f5b13468ea812499cd` | `5321860e0aab449f9bcf3d07874f80036ee67a07` | 245 | ✱ |
| 2 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `b8c46672b09f7a45005108bee3fdbed644a5012b809f9b3e8fe09c057581b0da` | `6d9d75dc24dc4d8bb0e2d03edb443635b3e34394` | 272 | ✱ |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `204f2ef77f66e1c1088959c592018006bb3e1b828a34f1031c151fe638e27929` | `d060739a398b9efe50ed40283e936a5df9a8f9d4` | 254 | ✱ |
| 4 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `02fe3a541c95b0c9d0d39869f7b97078ddb4fb23d70d23b9bdb395d9400a3a30` | `44180dd9107b528a35b57f800b5e97d750a4b9b2` | 415 | ✱ |
| 5 | `docs/02_design/software/PROGRAMMING_DATA_MODEL.md` | `3411ffc75670c4118ea972f250b33c37c2bf434e45ab76ba2b4073c57c18602d` | `1deac588afe75babc92481cd20e6607b6e5d524d` | 521 | ✱ |
| 6 | `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | `25962ee98183e8ecd0598dd41f0ad6ab172145898931ecd91f823cd4e73ba698` | `6e8f9758a162f0386ed8e81b8854c7d234ea76bb` | 601 | ✱ |
| 7 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `0ad0619410e162bd066963ecfc2eae6ce745e46547eba112e67f116fa52aea16` | `eb38fcee8104029cb8a0302ce4fd03fc858a01c7` | 361 | ✱ |
| 8 | `docs/02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `8d866d1f267ee51f0b4a5d5999487ac38e5ff6b12173c31bc5a64ce3a5ef2f95` | `66a213b1ab04223d05d08bc13a7ce2bf8fc76b84` | 305 | ✱ |
| 9 | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` | `028bf0c90cc4f37c3445735d9723a98d5f3de918650dfb5897e81b4cd1bc655b` | `51a6ff3429ac68e8f0890d53643564b4221520ea` | 326 | ✱ |
| 10 | `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `58a3613fb111f9592c210b379d1ba0718ccde42324ed3cabbc931df5319816b1` | `620f100b89ae5c08f26dca6654b343686a5c72b9` | 322 | ✱ |
| 11 | `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | `7dacf762fe9732d87f3f41e140b76c0a1a7fd4c29c34717b1c03a6deb6a26b50` | `fdb25a91ee6cae30c49295cb49277bbc6c65e481` | 309 | ✱ |
| 12 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `b31bdeadaf3008bc8f5ab34b8a310f10326e972a0926ff9883489de8dedde568` | `8930ca4580ecff586495cacea0134943c0367021` | 1361 | ✱ |
| 13 | `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | `2eafc4ed3b14b5da9acbfbe6ef590418f30b9054c791c6571972afb83f5255b7` | `a6e1f01bf0a42564b78ea08b8162e504708b7708` | 445 | ✱ |
| 14 | `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | `3cfdb8b05eb852eeee461105971fafc4e3db2d582025db139ff683d173586235` | `1f2e88bab04f03caf274af3bd0793b7205f1b400` | 394 | ✱ |
| 15 | `docs/02_design/software/PROGRAMMING_FW_SOM_DESIGN.md` | `a1c66a11f3bb2cbc6933ecc18d1fca641462a9c4c2a2c951e3f3c372ef3caaff` | `461a6f0c472a2d7eafda687e1cae4e17d3972bce` | 341 | ✱ |
| 16 | `docs/02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md` | `8be8f4f116a46dea1c298de1a13e2e130827bcb2047355c2d136ad81b5206b74` | `2a067b969e8011d985977eba046ec6d044e0f901` | 265 | ✱ |
| 17 | `docs/04_design/hardware/PROGRAMMING_HW_DESIGN.md` | `b6c313f3c01830b9ec70abdd1ab1666d7aa640f1ee2486548a4a1ae1204399c6` | `43f7d5765ce3464f43e6e3b242114d1445403bb1` | 258 | ✱ |
| 18 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `814cbc0b40a1a55206161fc5c11c6b3d6e0879e75bf5f5af852eb00192e9e0f5` | `1284c065ef845db8cd0bf4240aa9c083a06ed4c8` | 309 | ✱ |
| 19 | `docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md` | `ac7fed9c3134f32f16f28dee7d9b3f60585ef62df749d0148fc15770ba8fc6ba` | `6a09f28979d99ebfc07e8183a1ad01085a7e4488` | 335 | ✱ |
| 20 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `ebd64211ec94503c8784ab8f8053f77224ca23f8ad87f2af9460cadf9c582fbd` | `239d1ca8b732d12629028fb6c7da66ff085fd711` | 247 | ✱ |
| 21 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `cff054031858416bc148684bb7c87f0baa0a2410c1fcd7d4d793f9490d2494cd` | `8249d7153dc40b6c4aa41e0899c78a36341344b4` | 341 | ✱ |
| 22 | `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `cc17b2202eb1e894bc5193f058118d2bf672c6031a3f69b3ca57a0f3f2900fea` | `92116b3d63ba8037652a43273f680b742e94c0a3` | 1157 | ✱ |

So với candidate v2.7, **22/22 hồ sơ đã đổi** để tạo nền v2.8 được phê duyệt.
Candidate v2.18 hiện tại đổi dòng 1, 7–8, 20–22 so với v2.17 để ghi
`TASK-PROG-203`, artifact/manifest/source map ST/FBD và trace/risk/progress P2; dấu `✱` tiếp tục biểu thị delta
tích lũy so với v2.7.

## 3. Hồ sơ hỗ trợ ngoài mẫu số 22

| Hồ sơ | Phiên bản tại lần ghim này | Vai trò |
|---|---|---|
| `docs/03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md` | v3.21 | Tracker hồ sơ và đồng bộ tiến độ code |
| `docs/07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md` | v2.0 | Gói phê duyệt toàn bộ |
| `docs/07_records/reviews/PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md` | v1.6 | Biên bản consumer review + waiver |
| `docs/07_records/reviews/PROGRAMMING_G1_IMPLEMENTATION_REVIEW_2026-08-11.md` | 2026-08-11 | Review source/evidence `TASK-PROG-100..105` |
| `docs/07_records/reviews/PROGRAMMING_G1_CONTRACT_REVIEW_20260811.md` | 2026-08-11 | Biên bản GO G1, manifest join, deploy/rollback và sign-off implementation |
| `docs/07_records/reviews/PROGRAMMING_G2_IMPLEMENTATION_REVIEW_2026-08-11.md` | 2026-08-11 | Review source/evidence `TASK-PROG-200..203`, P2 4/8 và bàn giao Task 204 |

Sáu hồ sơ này ghi **phiên bản hoặc ngày**, không ghi SHA-256. Lý do giống §1.1: chúng thay đổi
trong cùng vòng cập nhật với manifest, nên một hash ghi ở đây sẽ sai ngay khi commit
được tạo. Chúng nằm **ngoài** mẫu số 22, nên sửa chúng không làm lệch candidate và
không cần phát hành manifest mới.

Sáu ADR `ADR-026..031` cũng nằm ngoài mẫu số 22 vì chúng là **quyết định**, không
phải hồ sơ baseline. Cả sáu đã `Accepted` theo `AUTH-PROG-2026-08-11-03`.

## 4. Delta so với candidate v2.17

Candidate v2.18 thay đổi **6/22** hồ sơ để phản ánh `TASK-PROG-203`, không đổi
requirement hoặc decision đã phê duyệt:

- `PROG-DOCSET-001` v2.6, `DDD-LANG-PROG-001` và `IFSPEC-ART-PROG-001`
  v0.7 ghi As-Built SHA-256/build manifest/source map ST/FBD tại `2c2bfb4`.
- `PLAN-PROG-053` v0.27: P2 `4/8`, tổng `17/49`, tiếp theo `TASK-PROG-204`.
- `TRACE-PROG-001` v3.7 bổ sung source Task 203 cho `SYS-101/CORE-101/NFR-101`,
  nhưng giữ tổng `2/60 I=Y` và mọi `T/P/R=N`.
- `RSK-PROG-001` v1.1 ghi treatment partial RSK-006 với manifest/hash/source-map
  fail-closed, nhưng 16/16 Open và residual giữ nguyên.
- Source Task 203 được khóa tại `2c2bfb4`; targeted 35/35, mutation 7/7,
  CTest 927/927 và Go/FE regression
  PASS, flag OFF và 0 Commission.
- 16/22 hồ sơ còn lại byte-identical với v2.17. Approval
  `AUTH-PROG-2026-08-11-03` tiếp tục hiệu lực; Verification vẫn độc lập cho
  Test Result PASS và release.
- Source/contract/evidence nằm ngoài mẫu số 22 tại
  `PROG-G2-IMPLEMENTATION-REVIEW-2026-08-11` và `EV-PROG-G2-203`.

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
| 3.4 | 2026-08-11 | Ghi bổ sung PR #127, merge commit `7109bae` và tree `55176626` chứa candidate v2.9. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.5 | 2026-08-11 | Phát hành candidate v2.10 sau `TASK-PROG-101`: cập nhật hash/blob của Trace v2.9 và Plan 53 v0.19; 20/22 hồ sơ còn lại giữ nguyên. Commit/tree/PR chờ ghi bổ sung sau merge; 22 SHA-256 là authority hiện hành |
| 3.6 | 2026-08-11 | Ghi bổ sung PR #129, merge commit `adcefed` và tree `89f0ee5a` chứa candidate v2.10. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.7 | 2026-08-11 | Phát hành candidate v2.11 sau `TASK-PROG-102`: cập nhật hash/blob của Design Index v1.9, Artifact Spec v0.4, Trace v3.0 và Plan 53 v0.20; 18/22 hồ sơ còn lại giữ nguyên. Commit/tree/PR chờ ghi bổ sung sau merge; 22 SHA-256 là authority hiện hành |
| 3.8 | 2026-08-11 | Ghi bổ sung PR #131, merge commit `16d3e40` và tree `a0add512` chứa candidate v2.11. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.9 | 2026-08-11 | Phát hành candidate v2.12 sau `TASK-PROG-103`: cập nhật hash/blob của Design Index v2.0, Interface v0.9, Artifact v0.5, Trace v3.1 và Plan 53 v0.21; 17/22 hồ sơ còn lại giữ nguyên. Commit/tree/PR chờ ghi bổ sung sau merge; 22 SHA-256 là authority hiện hành |
| 3.10 | 2026-08-11 | Ghi bổ sung PR #133, merge commit `1c74b9f` và tree `db5e225f` chứa candidate v2.12. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.11 | 2026-08-11 | Phát hành candidate v2.13 sau `TASK-PROG-104`: cập nhật hash/blob Design Index v2.1, Data v0.5, BE v0.7, Risk v0.6, Trace v3.2 và Plan 53 v0.22; 16/22 hồ sơ còn lại giữ nguyên. Commit/tree/PR chờ ghi bổ sung sau merge; 22 SHA-256 là authority hiện hành |
| 3.12 | 2026-08-11 | Ghi bổ sung PR #135, merge commit `1f651b7` và tree `94326834` chứa candidate v2.13. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.13 | 2026-08-11 | Phát hành candidate v2.14 sau `TASK-PROG-105`: cập nhật hash/blob Design Index v2.2, VVP v0.9, Risk v0.7, Trace v3.3 và Plan 53 v0.23; 17/22 hồ sơ còn lại giữ nguyên. P1 6/6 DONE, G1 GO; hai record BLOCKED, 0/32 PASS; commit/tree/PR chờ ghi bổ sung sau merge |
| 3.14 | 2026-08-11 | Ghi bổ sung PR #137, merge commit `e6ab04b` và tree `9a022f96` chứa candidate v2.14. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.15 | 2026-08-11 | Phát hành candidate v2.15 sau `TASK-PROG-200`: cập nhật hash/blob Design Index v2.3, Language v0.4, Artifact v0.6, Risk v0.8, Trace v3.4 và Plan 53 v0.24; 16/22 hồ sơ còn lại giữ nguyên. P2 1/8, next TASK-PROG-201; 0/32 PASS; commit/tree/PR chờ ghi bổ sung sau merge |
| 3.16 | 2026-08-11 | Ghi bổ sung PR #139, merge commit `288aa37` và tree `8d4fb50a` chứa candidate v2.15. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.17 | 2026-08-11 | Phát hành candidate v2.16 sau `TASK-PROG-201`: cập nhật hash/blob Design Index v2.4, Language v0.5, FE v0.8, Risk v0.9, Trace v3.5 và Plan 53 v0.25; 16/22 hồ sơ còn lại giữ nguyên. P2 2/8, tiếp theo TASK-PROG-202; 0/32 PASS; commit/tree/PR chờ ghi bổ sung sau merge |
| 3.18 | 2026-08-11 | Ghi bổ sung PR #141, merge commit `207cd90` và tree `b85bdb2c` chứa candidate v2.16. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.19 | 2026-08-11 | Phát hành candidate v2.17 sau `TASK-PROG-202`: cập nhật hash/blob của Design Index v2.5, Language v0.6, Risk v1.0, Trace v3.6 và Plan 53 v0.26; 17/22 hồ sơ còn lại giữ nguyên. Commit/tree/PR chờ ghi bổ sung sau merge; 22 SHA-256 là authority hiện hành |
| 3.20 | 2026-08-11 | Ghi bổ sung PR #143, merge commit `7d424bc` và tree `aeb27c61` chứa candidate v2.17. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.21 | 2026-08-11 | Phát hành candidate v2.18 sau `TASK-PROG-203`: cập nhật hash/blob của Design Index v2.6, Language/Artifact v0.7, Risk v1.1, Trace v3.7 và Plan 53 v0.27; 16/22 hồ sơ còn lại giữ nguyên. Commit/tree/PR chờ ghi bổ sung sau merge; 22 SHA-256 là authority hiện hành |
| 3.22 | 2026-08-11 | Ghi bổ sung PR #145, merge commit `2899d02` và tree `cdef0e77` chứa candidate v2.18. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
