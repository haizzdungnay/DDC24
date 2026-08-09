# Manifest candidate P0 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-P0-CANDIDATE-MANIFEST-2026-08-10` |
| Loại | Hồ sơ kiểm soát cấu hình; không phải hồ sơ thứ 23 của baseline |
| Phiên bản | 1.0 |
| Ngày | 2026-08-10 |
| Chủ quản | Document Control |
| Người review | Product, System Architect, Verification Lead và consumer reviewers |
| Trạng thái | **ACTIVE — candidate đã ghim; approval vẫn PENDING** |
| Candidate commit | `e3e9fb26f61b39df8f805916333fc03b51f07f5f` |
| Git tree | `54eb519ec9e18639b0eeb8a4a0c5c3381e9b32de` |
| Nhánh chứa commit | `origin/main` |
| PR nguồn | [PR #113](https://github.com/Mekong-HCM/MK-DDC-24/pull/113) |
| Gói review | [`PROG-P0-GATE-2026-08-10`](PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) |

## 1. Phạm vi và phán quyết

Manifest này ghim **đúng nội dung phải được review** cho `P0-A` và
`PROG-000..006`. Commit là bất biến, đã nằm trên `origin/main`; reviewer phải ghi
đủ hash này trong kết luận. Candidate gồm 22 hồ sơ baseline cùng hai hồ sơ hỗ
trợ ở §3.

Việc ghim candidate chỉ đóng một điều kiện kiểm soát cấu hình. Nó **không**:

- nâng bất kỳ hồ sơ nào từ `M3` lên `M4/M5`;
- thay thế consumer review hoặc chữ ký Product/Architect/Verification;
- đóng `OD-PROG-*`, `ARCH-CONF-PROG-*`, TLS/HW/HIL blocker;
- mở `PLAN_READY`, `IMPLEMENT_READY` hay `RELEASE_READY`.

Baseline gốc `05c1c480418a2256f1010527f9d90fb6ff549b86` vẫn được giữ để
so sánh/rollback. Candidate P0 này thay nó làm **revision đầu vào của vòng review
P0**, không hồi tố thay đổi lịch sử của baseline gốc.

## 2. Manifest 22 hồ sơ baseline

SHA-256 được tính từ byte của file trong chính candidate commit, không từ
working tree hiện hành.

| # | Đường dẫn | SHA-256 | Git blob | Dòng |
|---:|---|---|---|---:|
| 1 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `fa866fdd0a6690c37d8d62560c8a8cb955596ec64cd0c89495a3c11722df9f54` | `b2d5793114213d7fb5d7796a51ed03f96a284f19` | 229 |
| 2 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `34859905f640dead8ffbec68e7ffd601f06675b5c1bc42c82210989fa6871ea3` | `96dfa4a40e2f116b1ba96b342e8657940293b8f9` | 272 |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `f285cfb842f7cbf399012ba85df4afd0dc6a0bd82f525731d8eb99500f39e651` | `99edec0b69fbb2d4531068b37d0749a40ac80df8` | 180 |
| 4 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `99f3e0d215e92bc6bea02c38ffd9959d4a1d20a9279fc5d49c21f0499810209c` | `9f018aa6af32bfa0eaca5d796dff939df37f1e5d` | 407 |
| 5 | `docs/02_design/software/PROGRAMMING_DATA_MODEL.md` | `62abb98e74fcfa47b85940220fb153fd01d451b0784a7e18c6c18e1a4dba603d` | `376b72d8bf6648a2f94994ced0330fa1f9adfb2d` | 516 |
| 6 | `docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md` | `24c12db6bf0054428ad4bf8deb4fa14660adde991658285050bb4b1c21099751` | `ff0da3a91aaeb7ee22f937687185e71c393f79af` | 572 |
| 7 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `7fb15c2fb70a9b86e747343f3c270ea70791cde6bc85ca00aa09a02585fcb384` | `82a64294b15b07a39e7a376de21e5aa8be0a2ac5` | 339 |
| 8 | `docs/02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `d945df62955cfb7a412b1e497fcf1c1c3dd1653aa0f149647897927c8e660f19` | `a37c00066ccfa7d3cf6670b0fae1e4fb60f776e7` | 281 |
| 9 | `docs/02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md` | `1d697ef0f867a2d0363319088df43ebc626603cf80353b19548d540a748bc00a` | `3aa2c8f0c29437301cce696170fd40f3ad365e16` | 322 |
| 10 | `docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `9026d1f97874749683d0dd85037bf3252adcebfa3c9341d95eed05d4dd7b588a` | `ea7421ac8ca3b304cae2ebdcbc8d8451e6ab9229` | 318 |
| 11 | `docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md` | `35d3c5ed2e6be324028f266f1b58e42befa3b4d618682886ccece12b88dcda58` | `9bdab480c79ad6c80cd8bc00ec5f03d5735352b0` | 302 |
| 12 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `b6a98ca5124174319d53ed95f86e2f2755806041968c7a8960c64b95e24f4a60` | `840b46448b573196d7ecdcafb6495de8d839362c` | 1328 |
| 13 | `docs/02_design/software/PROGRAMMING_FE_DESIGN.md` | `0d345168887f30e78c7b6c7fc18fe56ab865b6b5fc70ae477e6700546df1227c` | `ff8ad8aaa0f14ba60db88eabba781d325801c1ac` | 394 |
| 14 | `docs/02_design/software/PROGRAMMING_BE_DESIGN.md` | `bd28570968d75446e509f843d38b8ff86a71529507cddd35f61c0b2ca5faeed7` | `75807ba5833d02444b37ec3254b8728374c4e2e3` | 376 |
| 15 | `docs/02_design/software/PROGRAMMING_FW_SOM_DESIGN.md` | `f45e01f6326f0711014956a943a4b55a9b18485f6412651afbea7727c73efeda` | `6e6a0b8fd8966c7235f2fec416a3c10bd054b305` | 337 |
| 16 | `docs/02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md` | `f8fa75c9a2d96851c62ead9bbc8e274b9eb2a66eaa1e7a9ecdb678afcdbecdf9` | `29cec6f96253e4f9da70015989b01b294eda904b` | 261 |
| 17 | `docs/04_design/hardware/PROGRAMMING_HW_DESIGN.md` | `609a8dad26acb23b2edc644790bc5be318a92b47f4e3cf796b8ba8077b83e316` | `725e6f89a9ba780926d6ef9cf3b13b5b7372dad0` | 254 |
| 18 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `8408f0b01bf8ae089c925f420c53d52557ef09be6bb14e0487def445302e3efc` | `563219226a332f788482e46bad069ced4a54f636` | 303 |
| 19 | `docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md` | `cae54485945629590ca159ea8b24d1018ee364fa8ab66a808861167f915ea808` | `637a5e37ce5005b6e85d46bc91e9241dd9be7ddb` | 331 |
| 20 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `f631828cbb79068722ae66bc365d95d4524363cd02f612e63a3810a3fb620402` | `35d6abf57b3b0b765b02017d5f04e678221c7764` | 171 |
| 21 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `9c2a5939a18869bab794ba79ea51efd64ba99364b35e0340941df0518c53b277` | `9838208406eeea54a86837b93b80bdc035106cef` | 310 |
| 22 | `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `fa6f171d92195fa7d602f08765f47d61477949cce558522ddec6eef635bec50e` | `3a1292a50300f09683a65d30f57884fdfbb22040` | 885 |

## 3. Hồ sơ hỗ trợ ngoài mẫu số 22

| Hồ sơ | SHA-256 tại candidate | Git blob | Dòng | Vai trò |
|---|---|---|---:|---|
| `docs/03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md` | `cae8011f8d228e0c24240fae3dbe15151d0d38d5402c2a4a5c6e52c9c8168679` | `6a7ca1e193cb363775368b5492a18e03fadc0cda` | 492 | Tracker hồ sơ |
| `docs/07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md` | `301201babf14edaa277d38e644989f3a4108bacec09bf8742459454ff8955c48` | `1d9ed2659e7b18c48a38d454a92d44315f569634` | 128 | Gói authority review v1.0 |

Manifest hiện tại được phát hành **sau** candidate để tham chiếu bất biến; nó
không thể tự nằm trong commit mà chính nó ghim. Gói review v1.1 hiện hành chỉ
bổ sung liên kết tới manifest và cập nhật blocker; nội dung cần authority review
đã tồn tại đầy đủ ở bản v1.0 trong candidate.

## 4. Delta so với baseline gốc

Trong mẫu số 22, chỉ bốn file đổi giữa `05c1c48` và candidate:

| Hồ sơ | Thêm | Xóa | Lý do |
|---|---:|---:|---|
| `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | 6 | 5 | Đồng bộ version/trạng thái P0 |
| `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | 5 | 4 | Đồng bộ 17 decision và phạm vi authority |
| `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | 4 | 3 | Sửa phạm vi 32 scenario |
| `docs/03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | 578 | 207 | Duyệt lại SPMP, gate và P0 package |

Plan 54 và gói review là hồ sơ hỗ trợ ngoài mẫu số 22. Các thay đổi khác cùng
commit không thuộc phạm vi review P0 và không được suy thành authority cho
Programming.

## 5. Cách tái kiểm

```bash
git cat-file -e e3e9fb26f61b39df8f805916333fc03b51f07f5f^{commit}
git show -s --format='%H %T %cI %s' e3e9fb26f61b39df8f805916333fc03b51f07f5f
git branch -r --contains e3e9fb26f61b39df8f805916333fc03b51f07f5f
git show e3e9fb26f61b39df8f805916333fc03b51f07f5f:<đường-dẫn> | sha256sum
```

Kết quả phát hành: commit tồn tại; tree khớp metadata; `origin/main` chứa commit;
22/22 SHA-256 và Git blob ở §2 được tính trực tiếp từ commit. Harness tài liệu
phải được chạy lại trên working tree sau mọi thay đổi tracker, nhưng kết quả đó
không thay hash candidate.

## 6. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-10 | Ghim candidate P0 `e3e9fb2`, tree, 22 file baseline, hai hồ sơ hỗ trợ và delta từ baseline gốc; giữ approval/gate ở trạng thái bị chặn |
