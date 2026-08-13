# Manifest candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CANDIDATE-MANIFEST-2026-08-10` |
| Loại | Hồ sơ kiểm soát cấu hình; không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 3.35 |
| Ngày | 2026-08-13 |
| Chủ quản | Document Control |
| Người review | Product, System Architect, Verification Lead và consumer reviewers |
| Trạng thái | **ACTIVE — candidate v2.25 `IMPLEMENTATION IN PROGRESS`; P1 6/6, P2 8/8, P3 3/8 SOURCE/DOD DONE; G3 IN PROGRESS; `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS`** |
| Định danh candidate | **22 SHA-256 ở §2** — xem §1.1 về lý do hash là authority, không phải commit |
| Candidate commit | source authority `f080056` (`TASK-PROG-302`); PR/merge commit ghi bổ sung sau khi merge — xem §4.2 |
| PR nguồn | Chờ tạo/merge PR cho nhánh `feat/programming-process-image-20260811`; ghi bổ sung sau khi merge |
| Candidate trước | v2.24 tại commit `d4fd15d` — **SUPERSEDED bởi TASK-PROG-302**, xem §4.2 |
| Gói review | [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) |
| Biên bản consumer review | [`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) |
| Record phê duyệt nền v2.8 | `AUTH-PROG-2026-08-11-03` tại gói review §6.2 — tiếp tục áp dụng; v2.25 không đổi requirement/design decision |

## 1. Phạm vi và phán quyết

Manifest này ghim **đúng nội dung phải được review** cho `P0-A` và
`PROG-000..006`. Candidate gồm 22 hồ sơ baseline cùng bảy hồ sơ hỗ trợ ở §3.

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
| Commit chứa nội dung candidate | `d4fd15da4b369b027296bcf9460ecdc9fbe0997c`; source commit `a831a0d42c0e945f9a59c36e461ada0e12962c89` |
| Git tree | `fe321c3434bfeee33ca22a346cf4fd6add5c5468`; source tree `9ff19be31d95e687f5358ceabb52c7c2a16fb502` |
| Nhánh phát hành | `feat/programming-base-step-20260811` — remote đã xóa sau merge PR #157 |

Reviewer phải ghi **đủ 22 hash ở §2 hoặc commit ở bảng trên** trong kết luận, và
chạy `scripts/candidate_pin_check.py` trước khi bắt đầu đọc.

Việc ghim candidate xác định đúng baseline được duyệt. Nó **không**:

- nâng bất kỳ hồ sơ nào từ `M3` lên `M4/M5`;
- giả chữ ký consumer/Verification hoặc Test Result;
- biến source/target/HIL chưa chạy thành PASS;
- tự mở `RELEASE_READY`.

`AUTH-PROG-2026-08-11-03` đã mở `PLAN_READY` và mọi `IMPLEMENT_READY[*]`; việc
ghim hash bảo đảm team đọc đúng candidate v2.25: baseline đã phê duyệt cộng
trạng thái triển khai thật của `TASK-PROG-100..302`.

Baseline gốc `05c1c480418a2256f1010527f9d90fb6ff549b86` vẫn được giữ để so
sánh/rollback. Chuỗi candidate của vòng P0 là
`05c1c48` → `e3e9fb2` → **candidate hiện hành ở §2**.

## 2. Manifest 22 hồ sơ baseline

SHA-256 tính trên byte của file. Cột “Đổi” đánh dấu delta tích lũy so với nền
candidate v2.7; delta trực tiếp so với v2.23 được liệt kê ở §4.

| # | Đường dẫn | SHA-256 | Git blob | Dòng | Đổi |
|---:|---|---|---|---:|:---:|
| 1 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `98bbe206f3c5c3847c4a9667ad6cf936a6b153300cc9c8cbbae937e2acc070c1` | `3b5000b3889761bf5ab8d0e7baa09e599d08952a` | 251 | ✱ |
| 2 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `b8c46672b09f7a45005108bee3fdbed644a5012b809f9b3e8fe09c057581b0da` | `6d9d75dc24dc4d8bb0e2d03edb443635b3e34394` | 272 | ✱ |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `204f2ef77f66e1c1088959c592018006bb3e1b828a34f1031c151fe638e27929` | `d060739a398b9efe50ed40283e936a5df9a8f9d4` | 254 | ✱ |
| 4 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `86d967fae1339dbc6c38f30c6489f38337f37ab34c6a48dd01d43ba370e2809c` | `20867d82fa8f1c8e53d679d954ba9c446ee4bb0c` | 416 | ✱ |
| 5 | `docs/02_design/software/PROGRAMMING_DATA_MODEL.md` | `72c4a33bbc27a3963fd407d3bce6ac8c12d1cf1e89f85ef8a5b761b246b3948e` | `60b1e8749f79a6e22cba522b7a1b98ead62aedb2` | 578 | ✱ |
| 6 | `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | `47ea0ecd9320de7c24de47db8b6e5eae341cb40e4da5c385184b7d40601eec61` | `7e47906948a36f9bb5dbb0aa77c2270b060c0fa9` | 618 | ✱ |
| 7 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `0ad0619410e162bd066963ecfc2eae6ce745e46547eba112e67f116fa52aea16` | `eb38fcee8104029cb8a0302ce4fd03fc858a01c7` | 361 | ✱ |
| 8 | `docs/02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `c43f8757df50e0b121df19df18ccea3b3c26cd25c78a30d2576ad939605409d7` | `5dcfbda5aea849642f86dac33cb3f4e76c6846de` | 310 | ✱ |
| 9 | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` | `1291e42e466ad1bd41e38d8568ad4c5f270afbf179494d9fc773335db7b28052` | `c2f9e1bc0f464b3e30d0a90ed9da1d6f60a56891` | 334 | ✱ |
| 10 | `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `58a3613fb111f9592c210b379d1ba0718ccde42324ed3cabbc931df5319816b1` | `620f100b89ae5c08f26dca6654b343686a5c72b9` | 322 | ✱ |
| 11 | `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | `9d2cc63843439bab6e30378e0b2579c5fb15f17547b2134849217e0c2f2cb02c` | `cc9013e80dbc4fcb60decd10566988d0f4d8ca80` | 333 | ✱ |
| 12 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `b31bdeadaf3008bc8f5ab34b8a310f10326e972a0926ff9883489de8dedde568` | `8930ca4580ecff586495cacea0134943c0367021` | 1361 | ✱ |
| 13 | `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | `2eafc4ed3b14b5da9acbfbe6ef590418f30b9054c791c6571972afb83f5255b7` | `a6e1f01bf0a42564b78ea08b8162e504708b7708` | 445 | ✱ |
| 14 | `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | `149077ee02595795f4488b19ab310bc1a641678fefef0a8dcf68f8ec22beb97f` | `51d979d69bc41bb194ca8a06cc79ca60fa6981a4` | 468 | ✱ |
| 15 | `docs/02_design/software/PROGRAMMING_FW_SOM_DESIGN.md` | `ea835f9b5289751aedb404ef58a5a3a7ed6206026e5f0829d7f80755b3e68fcb` | `4fef8761e54fccbe48b82ff649d10de731ea2ae9` | 356 | ✱ |
| 16 | `docs/02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md` | `8be8f4f116a46dea1c298de1a13e2e130827bcb2047355c2d136ad81b5206b74` | `2a067b969e8011d985977eba046ec6d044e0f901` | 265 | ✱ |
| 17 | `docs/04_design/hardware/PROGRAMMING_HW_DESIGN.md` | `b6c313f3c01830b9ec70abdd1ab1666d7aa640f1ee2486548a4a1ae1204399c6` | `43f7d5765ce3464f43e6e3b242114d1445403bb1` | 258 | ✱ |
| 18 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `28a2ce4c1c3a097ceb81699797c7067f4e57eb9b58e089d49f0877138957cc80` | `e2fa03df3b29da77333c2ef318aa827f5ee13f71` | 353 | ✱ |
| 19 | `docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md` | `ac7fed9c3134f32f16f28dee7d9b3f60585ef62df749d0148fc15770ba8fc6ba` | `6a09f28979d99ebfc07e8183a1ad01085a7e4488` | 335 | ✱ |
| 20 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `566d6bf39078c949894f7c1c07e519b05ba09f8fcedb615abd95a37f0958d65e` | `446f0c8e25bc27d6aa5517b918310ad10d31be3a` | 327 | ✱ |
| 21 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `082bf4c19d715dcf167b7bcc7f59c7d6d43cc934ebbece2d9d9d4e5f2a05123f` | `11be789c2362edd99e77021443461362853c1ac6` | 347 | ✱ |
| 22 | `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `2afaff165ce149723308dc922a8286045ab8d9535aea4a94465def445d7c4761` | `2dcb8b8b57905c0973e01d08b774f8df5e341fa3` | 1165 | ✱ |

So với candidate v2.7, **22/22 hồ sơ đã đổi** để tạo nền v2.8 được phê duyệt.
Candidate v2.25 hiện tại đổi dòng 22 so với v2.24 để ghi `TASK-PROG-302`
DONE và progress P3 3/8; dấu `✱` tiếp tục biểu thị delta
tích lũy so với v2.7.

## 3. Hồ sơ hỗ trợ ngoài mẫu số 22

| Hồ sơ | Phiên bản tại lần ghim này | Vai trò |
|---|---|---|
| `docs/03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md` | v3.34 | Tracker hồ sơ và đồng bộ tiến độ code/provenance |
| `docs/07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md` | v2.0 | Gói phê duyệt toàn bộ |
| `docs/07_records/reviews/PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md` | v1.6 | Biên bản consumer review + waiver |
| `docs/07_records/reviews/PROGRAMMING_G1_IMPLEMENTATION_REVIEW_2026-08-11.md` | 2026-08-11 | Review source/evidence `TASK-PROG-100..105` |
| `docs/07_records/reviews/PROGRAMMING_G1_CONTRACT_REVIEW_20260811.md` | 2026-08-11 | Biên bản GO G1, manifest join, deploy/rollback và sign-off implementation |
| `docs/07_records/reviews/PROGRAMMING_G2_IMPLEMENTATION_REVIEW_2026-08-11.md` | 2026-08-11 | Review source/evidence `TASK-PROG-200..207`, P2 8/8 source/DoD và bàn giao Task 300 |
| `docs/07_records/reviews/PROGRAMMING_G3_IMPLEMENTATION_REVIEW_2026-08-11.md` | 2026-08-11 | Review source/evidence `TASK-PROG-300/301`, P3 2/8 source/DoD và bàn giao Task 302 |

Bảy hồ sơ này ghi **phiên bản hoặc ngày**, không ghi SHA-256. Lý do giống §1.1: chúng thay đổi
trong cùng vòng cập nhật với manifest, nên một hash ghi ở đây sẽ sai ngay khi commit
được tạo. Chúng nằm **ngoài** mẫu số 22, nên sửa chúng không làm lệch candidate và
không cần phát hành manifest mới.

Sáu ADR `ADR-026..031` cũng nằm ngoài mẫu số 22 vì chúng là **quyết định**, không
phải hồ sơ baseline. Cả sáu đã `Accepted` theo `AUTH-PROG-2026-08-11-03`.

## 4. Lịch sử delta

### 4.1 v2.24 so với v2.23

Candidate v2.24 thay đổi **8/22** hồ sơ để phản ánh `TASK-PROG-301`, không đổi
requirement hoặc decision đã phê duyệt:

- `PROG-DOCSET-001` v3.2, `ARCH-PROG-001` v0.8,
  `DDD-CTRL-PROG-001` v0.4 và `DDD-FWSOM-PROG-001` v0.6 ghi As-Built profile
  Rev A/base-step/watchdog tại `a831a0d`; sửa mâu thuẫn 50 ms theo ADR-027.
- `VVP-PROG-001` v1.2 đăng ký `EV-PROG-G3-301` là evidence host hỗ trợ
  VS-009/015, không tạo Test Result.
- `PLAN-PROG-053` v0.33: P3 `2/8`, tổng `23/49`, tiếp theo `TASK-PROG-302`.
- `TRACE-PROG-001` v3.13 bổ sung source partial CORE-102/108 và NFR-103,
  nhưng giữ tổng `2/60 I=Y` và mọi `T/P/R=N`.
- `RSK-PROG-001` v1.7 ghi treatment partial RSK-002 nhưng 16/16 Open và
  residual giữ nguyên do chưa có bootstrap/Forlinx/HIL/Test Result.
- Source Task 301 được khóa tại `a831a0d`; targeted 74/74, CTest 936/936, Go,
  FE 494/494 và contract G1 7/7 PASS, flag OFF và 0 Commission.
- 14/22 hồ sơ còn lại byte-identical với v2.23. Approval
  `AUTH-PROG-2026-08-11-03` tiếp tục hiệu lực; Verification vẫn độc lập cho
  Test Result PASS và release.
- Source/evidence nằm ngoài mẫu số 22 tại
  `PROG-G3-IMPLEMENTATION-REVIEW-2026-08-11` và `EV-PROG-G3-301`.

Các hồ sơ hỗ trợ, Decision Log, sáu ADR và asset SVG nằm ngoài mẫu số 22 nhưng
được đồng bộ trong cùng thay đổi để không còn chỉ báo gate mâu thuẫn.

### 4.2 v2.25 so với v2.24

Candidate v2.25 thay đổi **1/22** hồ sơ — phạm vi hẹp hơn v2.24 có chủ đích:

- `PLAN-PROG-053` v0.34 (hồ sơ #22): P3 `3/8`, tổng `24/49`, ghi
  `TASK-PROG-302 DONE` tại `f080056` và next `TASK-PROG-303`.
- Source Task 302 khóa tại `f080056`: process image preflight-toàn-batch
  input/output, `StPointKind::EXT` + ba category LOCAL/VP/MB_RTU theo
  `OD-PROG-007`, `PointWriter::can_write` bắt buộc EXT trong
  `ext_count`/`writable`; targeted 68/68, CTest 949/949, Go vet/test, FE
  494/494 PASS. Kèm sửa một bug không liên quan runtime (`84b3776`): test Go
  idempotency time-bomb TTL do đồng hồ Store/service lệch nhau — xem
  CHANGELOG mục Fixed 2026-08-13.
- **21/22 hồ sơ còn lại (#1–21) byte-identical với v2.24** — chưa cập nhật
  As-Built narrative của `PROG-DOCSET-001`, `ARCH-PROG-001`,
  `DDD-CTRL-PROG-001`, `DDD-FWSOM-PROG-001`, `VVP-PROG-001`, `RSK-PROG-001`
  và `TRACE-PROG-001` cho riêng nội dung `TASK-PROG-302` (process
  image/binding bridge). Nội dung As-Built hiện tại của 7 hồ sơ đó vẫn ĐÚNG
  về mặt sự kiện (mô tả state tại `TASK-PROG-301`), chỉ chưa PHẢN ÁNH đủ
  chi tiết Task 302 — không phải hồ sơ sai, mà là hồ sơ chưa đuổi kịp
  source mới nhất. Cần một lượt cập nhật As-Built riêng trước khi các hồ sơ
  đó được dùng làm căn cứ ký cho `TASK-PROG-302`.
- `AUTH-PROG-2026-08-11-03` tiếp tục hiệu lực; v2.25 không đổi
  requirement/design decision.
- Source/evidence Task 302 nằm ngoài mẫu số 22, chưa có file evidence
  `EV-PROG-G3-302` riêng (khác với 300/301) — ghi trong CHANGELOG và Plan 53
  §12 thay vì hồ sơ G3 review độc lập cho tới khi lượt As-Built đầy đủ chạy.

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
| 3.23 | 2026-08-11 | Phát hành candidate v2.19 sau `TASK-PROG-204`: cập nhật hash/blob Design Index v2.7, Data v0.6, Interface v1.0, BE v0.8, Risk v1.2, Trace v3.8 và Plan 53 v0.28; 15/22 hồ sơ còn lại giữ nguyên. P2 5/8, next TASK-PROG-205; hai record BLOCKED, 0/32 PASS; commit/tree/PR chờ ghi bổ sung sau merge |
| 3.24 | 2026-08-11 | Ghi bổ sung PR #147, merge commit `27a06e1` và tree `4e4e4d24` chứa candidate v2.19. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.25 | 2026-08-11 | Phát hành candidate v2.20 sau `TASK-PROG-205`: cập nhật hash/blob Design Index v2.8, Data v0.7, Interface v1.1, BE v0.9, Risk v1.3, Trace v3.9 và Plan 53 v0.29; 15/22 hồ sơ còn lại giữ nguyên. P2 6/8, next TASK-PROG-206; hai record BLOCKED, 0/32 PASS; commit/tree/PR chờ ghi bổ sung sau merge |
| 3.26 | 2026-08-11 | Ghi bổ sung PR #149, merge commit `3c8b4c3` và tree `aa7e13a9` chứa candidate v2.20. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi; candidate pin tiếp tục 22/22 PASS |
| 3.27 | 2026-08-11 | Phát hành candidate v2.21 sau `TASK-PROG-206`: cập nhật hash/blob Design Index v2.9, Data v0.8, Interface v1.2, BE v1.0, Risk v1.4, Trace v3.10 và Plan 53 v0.30; 15/22 hồ sơ còn lại giữ nguyên. P2 7/8, tiếp theo TASK-PROG-207; hai record BLOCKED, 0/32 PASS; commit/tree/PR chờ ghi bổ sung sau merge |
| 3.28 | 2026-08-11 | Ghi bổ sung PR #151, merge commit `6893c87` và tree `8f1801ac` chứa candidate v2.21; remote feature branch đã xóa. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi, candidate pin tiếp tục 22/22 PASS. GitHub Actions không khởi chạy do billing/spending-limit của tài khoản; gate local đầy đủ được ghi tại PR |
| 3.29 | 2026-08-11 | Phát hành candidate v2.22 sau `TASK-PROG-207`: cập nhật hash/blob Index v3.0, Data v0.9, Interface v1.3, Security v0.5, BE v1.1, VVP v1.0, Risk v1.5, Trace v3.11 và Plan 53 v0.31; 13/22 hồ sơ còn lại giữ nguyên. P2 8/8 source/DoD, next TASK-PROG-300; 0/32 PASS; commit/tree/PR chờ ghi sau merge |
| 3.30 | 2026-08-11 | Ghi bổ sung PR #153, merge commit `352fe10` và tree `923cb1e3` chứa candidate v2.22; remote feature branch đã xóa. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi, candidate pin tiếp tục 22/22 PASS. GitHub Actions không chạy step nào do billing/spending-limit; gate local đầy đủ được ghi tại PR |
| 3.31 | 2026-08-11 | Phát hành candidate v2.23 sau `TASK-PROG-300`: cập nhật hash/blob Index v3.1, Artifact v0.8, FW-SOM v0.5, VVP v1.1, Risk v1.6, Trace v3.12 và Plan v0.32; 15/22 hồ sơ còn lại giữ nguyên. P3 1/8, next TASK-PROG-301; 0/32 PASS; commit/tree/PR chờ ghi sau merge |
| 3.32 | 2026-08-11 | Ghi bổ sung PR #155, merge commit `424367a` và tree `7b81f79` chứa candidate v2.23; remote feature branch đã xóa. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi, candidate pin tiếp tục 22/22 PASS. GitHub Actions không chạy step nào do billing/spending-limit; gate local đầy đủ được ghi trong PR |
| 3.33 | 2026-08-11 | Phát hành candidate v2.24 sau `TASK-PROG-301`: cập nhật hash/blob Index v3.2, Architecture v0.8, Control v0.4, FW-SOM v0.6, VVP v1.2, Risk v1.7, Trace v3.13 và Plan v0.33; 14/22 hồ sơ còn lại giữ nguyên. P3 2/8, next TASK-PROG-302; 0/32 PASS; commit/tree/PR chờ ghi sau merge |
| 3.34 | 2026-08-11 | Ghi bổ sung PR #157, merge commit `d4fd15d` và tree `fe321c3` chứa candidate v2.24; remote feature branch đã xóa. Chỉ manifest/hồ sơ hỗ trợ ngoài mẫu số 22 đổi, candidate pin tiếp tục 22/22 PASS. GitHub Actions không chạy step nào do billing/spending-limit; gate local đầy đủ được ghi trong PR |
| 3.35 | 2026-08-13 | Phát hành candidate v2.25 sau `TASK-PROG-302`: cập nhật hash/blob Plan v0.34 (hồ sơ #22 duy nhất); 21/22 hồ sơ còn lại giữ nguyên — phạm vi hẹp hơn thường lệ, CHƯA cập nhật As-Built narrative của Index/Architecture/Control/FW-SOM/VVP/Risk/Trace cho riêng Task 302 (xem §4.2). P3 3/8, next TASK-PROG-303; 0/32 PASS; commit/PR chờ ghi sau merge |
