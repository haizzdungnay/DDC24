# Manifest candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CANDIDATE-MANIFEST-2026-08-10` |
| Loại | Hồ sơ kiểm soát cấu hình; không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 2.8 |
| Ngày | 2026-08-10 |
| Chủ quản | Document Control |
| Người review | Product, System Architect, Verification Lead và consumer reviewers |
| Trạng thái | **ACTIVE — candidate v2.7 đã ghim; Product/Architect cần xác nhận delta trạng thái; consumer/Verification/discipline approval PENDING** |
| Định danh candidate | **22 SHA-256 ở §2** — xem §1.1 về lý do hash là authority, không phải commit |
| Candidate commit | `a236200` — ghi đầy đủ ở §1.1; **22 hash ở §2 là định danh hiện hành** |
| PR nguồn | Không thuộc định danh candidate; tra từ commit ở §1.1 hoặc CHANGELOG |
| Candidate trước | v2.5 tại commit `ac059a1` — **SUPERSEDED bởi đợt sửa chỉ báo cấu hình/trạng thái**; không đổi requirement/contract/thiết kế, xem §4 |
| Gói review | [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) |
| Biên bản consumer review | [`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) |

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
| Commit chứa nội dung candidate | `a23620026c6c6a44625d149361b9949b31e93f90` |
| Git tree | `8296338dd2f320ac533daec2057441052aee3470` |
| Nhánh phát hành | `docs/programming-plan-only-gate-audit` |

Reviewer phải ghi **đủ 22 hash ở §2 hoặc commit ở bảng trên** trong kết luận, và
chạy `scripts/candidate_pin_check.py` trước khi bắt đầu đọc.

Việc ghim candidate chỉ đóng một điều kiện kiểm soát cấu hình. Nó **không**:

- nâng bất kỳ hồ sơ nào từ `M3` lên `M4/M5`;
- thay thế consumer review hoặc chữ ký Product/Architect/Verification;
- đóng `OD-PROG-*`, `ARCH-CONF-PROG-*`, TLS/HW/HIL blocker;
- mở `PLAN_READY`, `IMPLEMENT_READY` hay `RELEASE_READY`.

Baseline gốc `05c1c480418a2256f1010527f9d90fb6ff549b86` vẫn được giữ để so
sánh/rollback. Chuỗi candidate của vòng P0 là
`05c1c48` → `e3e9fb2` → **candidate hiện hành ở §2**.

## 2. Manifest 22 hồ sơ baseline

SHA-256 tính trên byte của file. Cột “Đổi” đánh dấu hồ sơ khác so với candidate
trước `e3e9fb2`.

| # | Đường dẫn | SHA-256 | Git blob | Dòng | Đổi |
|---:|---|---|---|---:|:---:|
| 1 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `27d2de3dd6df4394b5a9d9f15c706161c6a3e631288d300486e1f2e8cf0d3de5` | `b5692c4493142e37112b3516bf7a6e66f02a28ad` | 235 | ✱ |
| 2 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `34859905f640dead8ffbec68e7ffd601f06675b5c1bc42c82210989fa6871ea3` | `96dfa4a40e2f116b1ba96b342e8657940293b8f9` | 272 | |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `37a311fc2210b212261a246412ef2b27c8ec8e0bdcf3af97d781175b897935c2` | `8aa85fa8c308e189dc11d47da724fa8caff84983` | 234 | ✱ |
| 4 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `636b554afecbff851fd46f504713824114fafdaa45625f4f103b0eb0f365bf70` | `2758d2a7d3b6d3322f23d1853fb2ad5b457a46a3` | 415 | ✱ |
| 5 | `docs/02_design/software/PROGRAMMING_DATA_MODEL.md` | `62abb98e74fcfa47b85940220fb153fd01d451b0784a7e18c6c18e1a4dba603d` | `376b72d8bf6648a2f94994ced0330fa1f9adfb2d` | 516 | |
| 6 | `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | `871f0abfd6359b918fcaa8e6ccb31feb3d7b5d8c333d157cdf0e6148b372c3e9` | `8fcc8fc4fcfc3b71aa162da61e117692eb01863b` | 587 | ✱ |
| 7 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `7fb15c2fb70a9b86e747343f3c270ea70791cde6bc85ca00aa09a02585fcb384` | `82a64294b15b07a39e7a376de21e5aa8be0a2ac5` | 339 | |
| 8 | `docs/02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `d945df62955cfb7a412b1e497fcf1c1c3dd1653aa0f149647897927c8e660f19` | `a37c00066ccfa7d3cf6670b0fae1e4fb60f776e7` | 281 | |
| 9 | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` | `1d697ef0f867a2d0363319088df43ebc626603cf80353b19548d540a748bc00a` | `3aa2c8f0c29437301cce696170fd40f3ad365e16` | 322 | |
| 10 | `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `9026d1f97874749683d0dd85037bf3252adcebfa3c9341d95eed05d4dd7b588a` | `ea7421ac8ca3b304cae2ebdcbc8d8451e6ab9229` | 318 | |
| 11 | `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | `6d263c63dc815271a74e041fa5a72af6107738c7b6213dc9793926e1058d1ce8` | `78ecbdb6734def2b7555e1513905c7589014eafb` | 305 | ✱ |
| 12 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `46498254d3466c6ee5a3dba74cb8aeb72ee013a8fd0977abe534806ba5823333` | `4a511d259749c091cb7d864af02d159d24f9da9c` | 1357 | ✱ |
| 13 | `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | `1d2509f35125ede78c5d83ce6923ed7693b425ab7e2e910383e717d6776a9bb8` | `b7bb7937601ecce60252d624c45ac788b65a434b` | 421 | ✱ |
| 14 | `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | `c9b8eb3abb0a10bc9b735861b3271b24d350895a7228f66cd09f9b682149a548` | `81f7c11446a9663ca2e027636d05cb0f2d06eb11` | 387 | ✱ |
| 15 | `docs/02_design/software/PROGRAMMING_FW_SOM_DESIGN.md` | `f45e01f6326f0711014956a943a4b55a9b18485f6412651afbea7727c73efeda` | `6e6a0b8fd8966c7235f2fec416a3c10bd054b305` | 337 | |
| 16 | `docs/02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md` | `f8fa75c9a2d96851c62ead9bbc8e274b9eb2a66eaa1e7a9ecdb678afcdbecdf9` | `29cec6f96253e4f9da70015989b01b294eda904b` | 261 | |
| 17 | `docs/04_design/hardware/PROGRAMMING_HW_DESIGN.md` | `609a8dad26acb23b2edc644790bc5be318a92b47f4e3cf796b8ba8077b83e316` | `725e6f89a9ba780926d6ef9cf3b13b5b7372dad0` | 254 | |
| 18 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `30ffc6be137bde3d8a15242d293f38fdfe01426506b0ad5554c69e72f7e7ea3e` | `6f76b332c3e4ac35fa9b0c57c0ce317085b6d2a5` | 305 | ✱ |
| 19 | `docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md` | `cae54485945629590ca159ea8b24d1018ee364fa8ab66a808861167f915ea808` | `637a5e37ce5005b6e85d46bc91e9241dd9be7ddb` | 331 | |
| 20 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `f631828cbb79068722ae66bc365d95d4524363cd02f612e63a3810a3fb620402` | `35d6abf57b3b0b765b02017d5f04e678221c7764` | 171 | |
| 21 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `0d294a83284ba4f2322515f04c2bd387d9731d4f15326b320b50415e09414dd7` | `0f5d02e2ece2b9f334eefb293b05028c66e6f6cd` | 329 | ✱ |
| 22 | `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `5caf7097eb6ac2d69f82b5d6e0a9701f227806ae999f5b20ad0eac61190c6478` | `d417a487a3337fbfd7efa6bfd051ed1794e3cf9c` | 1141 | ✱ |

**11/22 hồ sơ đổi, 11/22 giữ nguyên hash** so với `e3e9fb2`. So với candidate
v2.5, đợt rà gate chỉ đổi **1/22** hồ sơ (`PLAN-PROG-053`) để sửa chỉ báo
candidate/trạng thái; không đổi requirement, contract hoặc thiết kế kỹ thuật.
Reviewer đọc lại hồ sơ đánh dấu `✱`; manifest §4 nêu lý do từng vòng.

## 3. Hồ sơ hỗ trợ ngoài mẫu số 22

| Hồ sơ | Phiên bản tại lần ghim này | Vai trò |
|---|---|---|
| `docs/03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md` | v2.8 | Tracker hồ sơ |
| `docs/07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md` | v1.8 | Gói authority review |
| `docs/07_records/reviews/PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md` | v1.3 | Biên bản consumer review |

Ba hồ sơ này ghi **phiên bản**, không ghi SHA-256. Lý do giống §1.1: chúng thay đổi
trong cùng vòng cập nhật với manifest, nên một hash ghi ở đây sẽ sai ngay khi commit
được tạo. Chúng nằm **ngoài** mẫu số 22, nên sửa chúng không làm lệch candidate và
không cần phát hành manifest mới.

Sáu ADR `ADR-026..031` cũng nằm ngoài mẫu số 22 vì chúng là **quyết định**, không
phải hồ sơ baseline. System Architect đã `ACCEPT` 6/6; chúng vẫn `Proposed` chờ
đồng phê duyệt/evidence trước khi chuyển `Accepted`.

## 4. Delta so với candidate trước `e3e9fb2`

Đây là delta **tích lũy** qua bốn vòng: **R1** đóng `F-CR-01..09`, **R2/A2** sửa
phát biểu trạng thái cũ (`F-CR-10`), **R3/AUTH** ghi
`AUTH-PROG-2026-08-10-01`, và **R4/GATE-AUDIT** sửa chỉ báo candidate/trạng thái
trước P1. Tổng **11/22** hồ sơ đổi so với `e3e9fb2`; riêng R4 đổi 1/22 và không
đổi requirement, contract hoặc thiết kế kỹ thuật.

| Hồ sơ | Vòng | Lý do đổi |
|---|:---:|---|
| `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | R1 | `F-CR-01` — bỏ IA sáu trang còn sót ở §12/§16 |
| `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | R1 + R3 | `F-CR-04`; R3 ghi Product `ACCEPT` IA và gate slice UI |
| `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | R1 + R3 | `F-CR-03/07/08`; R3 đồng bộ `3 DECIDED/14 OPEN` mà không đổi I/T/P/R |
| `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | R1 + R3 | `F-CR-02`; R3 ghi Product/Architect `ACCEPT` và giữ contract chưa Active |
| `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | R1 + R3 | `F-CR-06`; R3 ghi Architect `ACCEPT` 6/6 ADR, vẫn chờ đồng phê duyệt/evidence |
| `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | R1 | `F-CR-02`, `F-CR-05` — staging và tên gói `transport` |
| `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | R1 | `F-CR-02` — nêu tên gốc locator |
| `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | R1 + R2 + R3 | đồng bộ revision downstream; ghi Product/Architect `ACCEPT` và trạng thái decision |
| `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | R1 + R2 + R3 + R4 | đồng bộ gate/candidate; R4 loại hai tham chiếu hiện hành còn trỏ candidate đã `SUPERSEDED`, giữ implementation blocked |
| `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | R2 + R3 | ghi authority record; `3 DECIDED`, `14 OPEN`, `0 CLOSED` |
| `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | R3 | ghi Product `ACCEPT`; giữ Verification PENDING và 0/32 Test Result |

Thay đổi khác trong cùng dải commit — `scripts/trace_bidirectional_check.py`,
`scripts/docs_iso_harness.py`, `CHANGELOG.md`, sáu ADR và asset SVG — **không**
thuộc mẫu số 22 và không được suy thành authority cho Programming.

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
