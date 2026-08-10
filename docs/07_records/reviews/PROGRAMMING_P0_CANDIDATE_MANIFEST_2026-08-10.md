# Manifest candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CANDIDATE-MANIFEST-2026-08-10` |
| Loại | Hồ sơ kiểm soát cấu hình; không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 2.2 |
| Ngày | 2026-08-10 |
| Chủ quản | Document Control |
| Người review | Product, System Architect, Verification Lead và consumer reviewers |
| Trạng thái | **ACTIVE — nội dung candidate đã ghim bằng hash ở §2; approval vẫn PENDING** |
| Định danh candidate | **22 SHA-256 ở §2** — xem §1.1 về lý do hash là authority, không phải commit |
| Candidate commit | `e278aaa` — ghi đầy đủ ở §1.1; **hash ở §2 mới là định danh** |
| PR nguồn | [PR #118](https://github.com/Mekong-HCM/MK-DDC-24/pull/118) |
| Candidate trước | `e3e9fb26f61b39df8f805916333fc03b51f07f5f` — **SUPERSEDED**, xem §4 |
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
| Commit chứa nội dung candidate | `e278aaaf520f14ab5a9a04b2b7cf7fcd43e33e47` |
| Git tree | `2dadad303ac22d64b63d84c6b3c16c27f83a1edb` |
| Nhánh | `origin/main` |

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
| 1 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `bb74a3b061ffe04d491e47b971011cb700b1a3269bc3b506decb4208d3433cfb` | `5c17dfb7f806e60fe441ad3a1f82803d639511b2` | 233 | ✱ |
| 2 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `34859905f640dead8ffbec68e7ffd601f06675b5c1bc42c82210989fa6871ea3` | `96dfa4a40e2f116b1ba96b342e8657940293b8f9` | 272 | |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `f285cfb842f7cbf399012ba85df4afd0dc6a0bd82f525731d8eb99500f39e651` | `99edec0b69fbb2d4531068b37d0749a40ac80df8` | 180 | |
| 4 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `7c53890aeb535e3c023bdf960c0e8b8e583e542c2e253421972a2783311a19a1` | `9411d701b013f55f9cd4a67a8489b0599abe7d29` | 412 | ✱ |
| 5 | `docs/02_design/software/PROGRAMMING_DATA_MODEL.md` | `62abb98e74fcfa47b85940220fb153fd01d451b0784a7e18c6c18e1a4dba603d` | `376b72d8bf6648a2f94994ced0330fa1f9adfb2d` | 516 | |
| 6 | `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | `8c1be23ba7b056798ba7130c4390db7de35b8fcb0fe69e45b93dd957561bfdb4` | `3753490517522c60dc68c800ccde549daeca12a7` | 586 | ✱ |
| 7 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `7fb15c2fb70a9b86e747343f3c270ea70791cde6bc85ca00aa09a02585fcb384` | `82a64294b15b07a39e7a376de21e5aa8be0a2ac5` | 339 | |
| 8 | `docs/02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `d945df62955cfb7a412b1e497fcf1c1c3dd1653aa0f149647897927c8e660f19` | `a37c00066ccfa7d3cf6670b0fae1e4fb60f776e7` | 281 | |
| 9 | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` | `1d697ef0f867a2d0363319088df43ebc626603cf80353b19548d540a748bc00a` | `3aa2c8f0c29437301cce696170fd40f3ad365e16` | 322 | |
| 10 | `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `9026d1f97874749683d0dd85037bf3252adcebfa3c9341d95eed05d4dd7b588a` | `ea7421ac8ca3b304cae2ebdcbc8d8451e6ab9229` | 318 | |
| 11 | `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | `6d263c63dc815271a74e041fa5a72af6107738c7b6213dc9793926e1058d1ce8` | `78ecbdb6734def2b7555e1513905c7589014eafb` | 305 | ✱ |
| 12 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `c36e43bc3b65dc7c29b42db842450c3ac988daf197601b394c12d0bdb63e16e5` | `7fd8d37333fd3376b3497feefb9618b7919ad3d6` | 1356 | ✱ |
| 13 | `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | `1d2509f35125ede78c5d83ce6923ed7693b425ab7e2e910383e717d6776a9bb8` | `b7bb7937601ecce60252d624c45ac788b65a434b` | 421 | ✱ |
| 14 | `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | `c9b8eb3abb0a10bc9b735861b3271b24d350895a7228f66cd09f9b682149a548` | `81f7c11446a9663ca2e027636d05cb0f2d06eb11` | 387 | ✱ |
| 15 | `docs/02_design/software/PROGRAMMING_FW_SOM_DESIGN.md` | `f45e01f6326f0711014956a943a4b55a9b18485f6412651afbea7727c73efeda` | `6e6a0b8fd8966c7235f2fec416a3c10bd054b305` | 337 | |
| 16 | `docs/02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md` | `f8fa75c9a2d96851c62ead9bbc8e274b9eb2a66eaa1e7a9ecdb678afcdbecdf9` | `29cec6f96253e4f9da70015989b01b294eda904b` | 261 | |
| 17 | `docs/04_design/hardware/PROGRAMMING_HW_DESIGN.md` | `609a8dad26acb23b2edc644790bc5be318a92b47f4e3cf796b8ba8077b83e316` | `725e6f89a9ba780926d6ef9cf3b13b5b7372dad0` | 254 | |
| 18 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `8408f0b01bf8ae089c925f420c53d52557ef09be6bb14e0487def445302e3efc` | `563219226a332f788482e46bad069ced4a54f636` | 303 | |
| 19 | `docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md` | `cae54485945629590ca159ea8b24d1018ee364fa8ab66a808861167f915ea808` | `637a5e37ce5005b6e85d46bc91e9241dd9be7ddb` | 331 | |
| 20 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `f631828cbb79068722ae66bc365d95d4524363cd02f612e63a3810a3fb620402` | `35d6abf57b3b0b765b02017d5f04e678221c7764` | 171 | |
| 21 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `52d6b8ee3041cb461ee04952c346f61ee4cbc43bb73368877f7616a2a3987e67` | `1d4daa032cfcb624599900f1f028b9c3fb27da3a` | 328 | ✱ |
| 22 | `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `9886004e3feb2629e0865a2c1ac81faceee41784d94286e62a902d50164c10ab` | `5253045944c5c1a850d20b7e041a4b600862db21` | 1125 | ✱ |

**9/22 hồ sơ đổi, 13/22 giữ nguyên hash.** Reviewer đã đọc `e3e9fb2` chỉ cần đọc
lại chín hồ sơ đánh dấu `✱`.

## 3. Hồ sơ hỗ trợ ngoài mẫu số 22

| Hồ sơ | Phiên bản tại lần ghim này | Vai trò |
|---|---|---|
| `docs/03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md` | v2.4 | Tracker hồ sơ |
| `docs/07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md` | v1.4 | Gói authority review |
| `docs/07_records/reviews/PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md` | v1.1 | Biên bản consumer review |

Ba hồ sơ này ghi **phiên bản**, không ghi SHA-256. Lý do giống §1.1: chúng thay đổi
trong cùng vòng cập nhật với manifest, nên một hash ghi ở đây sẽ sai ngay khi commit
được tạo. Chúng nằm **ngoài** mẫu số 22, nên sửa chúng không làm lệch candidate và
không cần phát hành manifest mới.

Sáu ADR `ADR-026..031` cũng nằm ngoài mẫu số 22 vì chúng là **quyết định**, không
phải hồ sơ baseline; chúng được ký riêng trên từng file và hiện đều ở `Proposed`.

## 4. Delta so với candidate trước `e3e9fb2`

Chín hồ sơ đổi, tất cả đều do đóng finding của
[`PROG-P0-CONSUMER-REVIEW-2026-08-10`](PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md):

| Hồ sơ | Thêm | Xóa | Finding đóng |
|---|---:|---:|---|
| `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | 50 | 23 | `F-CR-01` — bỏ IA sáu trang còn sót ở §12/§16 |
| `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | 31 | 3 | `F-CR-04` — thêm §16.4.1 và asset `RetainResetDialog` |
| `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | 26 | 8 | `F-CR-03/07/08` — truy vết hai chiều, số đếm, số mục |
| `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | 16 | 2 | `F-CR-02` — gốc staging và bảng ba thư mục |
| `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | 16 | 11 | `F-CR-06` — §11 gắn `ADR-026..031` |
| `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | 14 | 3 | `F-CR-02`, `F-CR-05` — staging và tên gói `transport` |
| `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | 7 | 3 | đồng bộ revision downstream |
| `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | 6 | 3 | `F-CR-02` — nêu tên gốc locator |
| `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | 292 | 53 | đồng bộ §5.5, §9.2 và lịch sử |

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
