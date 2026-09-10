# Báo cáo review tính năng Programming và bộ tài liệu thiết kế

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PROG-FEATURE-REVIEW-001` |
| Phiên bản | 1.0 |
| Trạng thái | **Record — cổng `layout` đã xanh lại sau 5 lỗi được sửa trong phiên; Inspector còn nợ thiết kế; `RELEASE_READY` giữ `NO-GO`** |
| Ngày | 2026-09-10 |
| Mốc mã nguồn | `main@14538e81cbe92bfa143456f709ec1c0e9c0e2352` |
| Phạm vi | Toàn tính năng Programming: FE `apps/web-ui`, BE `apps/web-api`, Core `apps/core`, contracts, cổng kiểm và bộ hồ sơ thiết kế |
| Ngoài phạm vi | Target/FakeMCU deploy, HIL vật lý, soak 24 h, verdict release |
| Kết luận | Ba tầng code lành mạnh và có cổng hợp đồng tốt, nhưng `main` đang **đỏ cổng `layout` của chính nó** với 4 lỗi xếp tầng che nhau; đã sửa hết trong phiên. Khoảng cách sản phẩm thật nằm ở Program Property/Inspector (`d.md` G-12..G-21), không nằm ở compiler/runtime |

> Đây là record của một lần rà soát, không phải Product/Design authority. Nó
> không tự đóng requirement, risk hay release gate.

---

## 0. Kết luận điều hành

Ba câu trả lời ngắn cho ba câu hỏi được đặt ra:

1. **Tình trạng src code:** lõi Programming (ST/FBD compiler, packager, scheduler,
   runtime coordinator, RETAIN, artifact signing, RBAC, simulation worker) đã
   **implement thật và có test thật**. `ctest` 1481/1481, Go 21/21 package,
   FE 245 file/3113 test — đo lại trong phiên này, không dẫn số cũ.
2. **Gap/finding/error:** 5 lỗi thật đã tìm ra và **sửa trong phiên** (§3). Toàn
   bộ đều là lỗi *cổng kiểm và hợp đồng*, không phải lỗi logic điều khiển — và
   chúng che nhau đúng theo cơ chế `set -e` mà repo đã tự cảnh báo trước đây.
3. **Implement sai thiết kế:** một chỗ sai rõ ràng và đã sửa (UI nói backend
   không hỗ trợ `FUNCTION`/`FUNCTION_BLOCK` trong khi backend hỗ trợ đầy đủ).
   Phần còn lại là *chưa implement đủ*, không phải implement sai — tập trung ở
   Inspector (§4).

Điểm đáng lo nhất không phải một finding riêng lẻ mà là **cơ chế**: CI được Owner
waive vì ngân sách, nên cổng chỉ chạy khi có người chạy tay. Trong khoảng đó ba
commit hợp lệ đã đổi contract mà không re-pin, và một lỗi rule cũ chặn ngay đầu
gate khiến cả bốn lỗi phía sau không bao giờ lộ ra. `F-P59-OPENAPI-PIN-001` từng
được sửa ở increment R2 rồi **tái diễn** đúng như vậy.

---

## 1. Mức kiểm chứng của phiên này

Mọi số dưới đây đo lại trên cây làm việc phiên này, không dẫn lại số tài liệu cũ.

| Cổng | Lệnh | Kết quả |
|---|---|---|
| C++ configure | `cmake --fresh -S . -B build/core -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=OFF -DMKDDC_ENABLE_HMI=ON` | exit **0** |
| C++ build | `cmake --build build/core --parallel 3` | exit **0** |
| C++ test | `ctest --test-dir build/core --output-on-failure -j2` | **1481/1481 PASS**, 0 fail |
| Go vet | `go vet ./...` | exit **0** |
| Go test | `go test ./... -count=1` | exit **0**; 21 package `ok`; 8/8 package `internal/programming/*` `ok` |
| FE typecheck | `tsc --noEmit` | exit **0** |
| FE lint | `npm run lint` (eslint `--max-warnings=0` + `check:ui-strings`) | exit **0** |
| FE test | `npx vitest --run --environment jsdom src` | **245 file / 3113 test PASS** — chạy lại **sau** khi sửa, exit 0 (số giữ nguyên vì 2 test khóa hành vi sai được thay bằng 2 test khóa hành vi đúng); riêng `DesignWorkspacePage.test.tsx` **45/45 PASS** |
| FE build | `npm run build` (gồm 5 cổng contract + bundle budget) | exit **0**; chunk `programming` gzip **151.09 KiB / ngân sách 165.00 KiB**, dư **13.91 KiB** |
| Layout gate | `scripts/verify-project.sh --component layout` | **trước: exit 1** (4 lỗi xếp tầng) → **sau: exit 0**, 0 dòng `FAIL` |

### 1.0.1 Chạy lại sau khi hợp nhất `origin/main@00c761ac`

`main` dịch tới `00c761ac` (#605 — `--sandbox-probe` dò đúng đường dẫn sản phẩm)
trong lúc phiên đang chạy, làm PR #616 `mergeable_state=dirty`. Đã merge `main`
vào nhánh (xung đột **duy nhất** ở `CHANGELOG.md`, giải purely additive — `git
diff origin/main -- CHANGELOG.md` cho **0 dòng xóa** thật) và **chạy lại toàn bộ
cổng trên head đã merge**:

| Cổng | Kết quả trên head đã merge |
|---|---|
| `--component layout` | exit **0**, 0 dòng `FAIL` |
| `docs_iso_harness.py --expect` | **PASS** |
| C++ build + `ctest` | exit 0 + **1481/1481 PASS**, 0 fail |
| `go vet` + `go test -count=1` | exit 0 + exit 0, 21 package `ok` |
| `tsc` / `lint` / `vitest` / `build` | exit 0 / exit 0 / **245 file, 3113 test PASS** / exit 0 (151.09 KiB) |

Đáng ghi: #605 độc lập xác nhận đúng hai số của phiên này — `ctest` **1481/1481**
và `MKDDC_ENABLE_BACNET=ON` **NOT_RUN vì egress policy trả HTTP 403** cho tarball
`bacnet-stack-1.3.8`. Hai phiên khác nhau, cùng kết luận, nên §1.1 không phải là
đặc thù môi trường của riêng phiên này.

### 1.1 Nhánh bị chặn — nói rõ, không claim

| Hạng mục | Trạng thái | Bị chặn bởi | Cần gì để mở |
|---|---|---|---|
| Profile C++ có BACnet (`-DMKDDC_ENABLE_BACNET=ON`) | **NOT RUN** | Network policy của môi trường trả **HTTP 403** cho `https://github.com/.../bacnet-stack-1.3.8.tar.gz`; `FetchContent` không populate được nên configure fail | Mirror nội bộ cho tarball bacnet-stack, hoặc allowlist `github.com`/`codeload.github.com`, hoặc vendor dependency |
| E2E Playwright / `e2e-real` | **NOT RUN** | Ngoài phạm vi phiên review; cần stack thật | Chạy `--component e2e` / `e2e-real` |
| Target Foxlinx, FakeMCU, HIL, soak 24 h | **NOT RUN / không claim** | Cần thiết bị và người | Giữ nguyên theo Plan 59 |

`googletest`, `libmodbus`, `libsodium`, `libdrm`, `jsonschema` thiếu ban đầu
nhưng **giải quyết được** qua `apt-get` + `pip` trong phiên; chỉ bacnet-stack là
bị chặn thật vì nó tải từ GitHub.

> Ghi chú phương pháp: `ctest` trên một build dir configure lỗi trả **exit 0**
> kèm `No tests were found!!!`. Đây đúng là cái bẫy số đo giả mà `CLAUDE.md`
> cảnh báo; phải đọc exit code của **cả** configure và build, và phải kiểm số
> test khác 0, mới được coi là có bằng chứng.

---

## 2. Hiện trạng src code theo tầng

### 2.1 Khối lượng thật

| Tầng | Đường dẫn | Quy mô | Test |
|---|---|---|---|
| FE Programming | `apps/web-ui/src/features/programming` | 306 file, ~45.1 k dòng TS/TSX (không tính test) | trong 245 file/3113 test toàn FE |
| BE Programming | `apps/web-api/internal/programming` | 52.1 k dòng Go, trong đó **22.4 k dòng test** | 503 hàm `func Test*`; 8 package |
| Core ST/Programming | `apps/core/application/st`, `apps/core/application/programming` | ~28.1 k dòng C++ (không tính test) | trong 1481 test `ctest` |
| Contracts | `contracts/programming` | 40 file (schema + golden + pin) | 19 script `scripts/verify_*`/`generate_*` |
| Tài liệu | `docs/**` | 206/436 file `.md` có nhắc Programming; riêng file tên `*PROGRAM*`: 33.9 k dòng | — |

Tỷ lệ test/code ở BE Go (**22.4 k test / 29.7 k production**) là điểm mạnh thật
sự, không phải hình thức: 8/8 package có test và chúng chạy xanh.

### 2.2 Những gì đã thật sự chạy được

Đối chiếu trực tiếp source, các capability sau **đã có** (không phải placeholder):

- **ST + FBD compile**: `st_parser.cpp`, `st_compile.cpp`, `st_semantic.cpp`,
  `st_fbd_compile.cpp` — FBD được lower về **đúng cùng một** ST AST, gồm cả
  `USER_CALL` tới FUNCTION người dùng và `FB_CALL`.
- **User POU (FUNCTION/FUNCTION_BLOCK) end-to-end**: `attachLocalPOUSources()`
  (`checks.go`) thu **cả** `revision.POUObjects` kind khác PROGRAM **và** PROJECT
  library entry vào `LinkedPOUs` kèm source; `compilerInputs()` đếm chúng vào
  `MaxUserPou` (256). `PouExplorer` đã cho tạo Program·ST, Program·FBD,
  Function·ST, Function Block·ST.
- **Artifact trust**: profile `integrityMode=SIGNATURE_REQUIRED`; `runner.go`
  fail-closed khi thiếu `PROGRAMMING_SIGNING_KEY`, kiểm chữ ký **hai chiều** và
  tách *chính sách* (`SIGNATURE_REQUIRED`) khỏi *thuộc tính artifact* (`SIGNED`).
- **RETAIN reset** (WP-12): Core + Go + FE đủ ba tầng.
- **Registry sinh mã một nguồn**: `generate_programming_library_registry.py`
  sinh C++ (`st_library_registry_generated.hpp`), Go
  (`library_registry_generated.go`) và TS (`library_registry.ts`) từ **một**
  `pou_library_registry_v1.json`, có `--check` trong gate.
- **Simulation worker cách ly**, **RBAC**, **capability sync**, **Published
  Signal provenance**, **operation polling**, **LKG/rollback**.

### 2.3 Tài liệu nói ÍT hơn code — nợ ngược chiều

Hai chỗ hồ sơ đang **hạ thấp** hiện trạng, dễ dẫn tới lập kế hoạch làm lại việc
đã xong:

| Hồ sơ | Nói gì | Thực tế trong code |
|---|---|---|
| `PROGRAMMING_IMPLEMENTATION_TRACKER.md` WP-13 | `DESIGN` / `NOT_STARTED`; "`runner.go` hard-code từ chối mọi thứ khác `HASH_ONLY`" | Đã implement: profile `SIGNATURE_REQUIRED`, verify hai chiều (`T59-607`) |
| Cùng file, DoD mục 3 + Document Gate #7 | "chưa có cơ chế sinh mã tự động giữ đồng bộ với C++" | Đã có generator 3 ngôn ngữ + `--check` trong `run_layout` |

File này đã tự đánh dấu `Superseded 2026-08-20`, nhưng vì nó vẫn nằm trong
`docs/03_implementation/` và vẫn được index, nó vẫn bị đọc như hiện trạng.

---

## 3. Error đã tìm ra và **đã sửa** trong phiên

Năm lỗi dưới đây là lỗi thật, có bằng chứng exit code trước/sau.

### `F-REV-001` — Rule boundary Go chặn cổng `layout`, che 3 lỗi phía sau — **Cao**

`tools/restructure/verify_repository.py` ghim cứng entrypoint Go duy nhất là
`cmd/mkddc-web`. Nhưng repo có binary thứ hai hợp lệ,
`apps/web-api/cmd/mkddc-programming-e2e-seed`, do
`scripts/run_programming_real_e2e_stack.sh` gọi. Vì vậy:

```
LỖI: vi phạm dependency boundary:
- apps/web-api/cmd/mkddc-programming-e2e-seed/main.go: package main nằm ngoài cmd/mkddc-web
```

`verify-project.sh` chạy `set -e`, nên **mọi cổng hợp đồng phía sau không bao giờ
chạy** — chính xác chế độ hỏng mà `tests/integration/test_programming_error_catalog.py`
đã ghi lại từ lần trước ("Lỗi này KHÔNG ai thấy vì `verify_repository.py` fail
trước nó trong `run_layout`").

Bất biến thật là "entrypoint chỉ sống dưới `cmd/<tên binary>/`", không phải "chỉ
được có một binary tên `mkddc-web`". Đã nới rule theo đúng bất biến đó và giữ
nguyên khả năng bắt lỗi: `package main` ngoài `cmd/` vẫn bị từ chối (đã kiểm
bằng negative test tạm: exit 1, đúng thông báo), `cmd/foo.go` đặt trực tiếp cũng
bị từ chối. `test_repository_dependency_guard.py` 9/9 PASS.

### `F-REV-002` — Pin `g1_contract_join_v1.json` lệch trên 2 contract — **Cao**

Guard báo 6 dòng `FAIL`. Nguyên nhân: pin cập nhật lần cuối ở `9597e4d`, nhưng
sau đó **ba commit hợp lệ** đổi contract mà không re-pin:

| Contract | Pin cũ | Thực tế | Thay đổi |
|---|---|---|---|
| `openapi.yaml` | `56eb241a…`, v1.37.0, 43 operation | `e966fb6f…`, **v1.40.0**, **45 operation** | `496559a`, `f2524bb`, `acff5be` thêm `getProgrammingSignalDependencies` + `previewProgrammingBinding`; **0 operation bị xóa** |
| `error_catalog_v1.json` | `d4c25c22…`, v1.10.0, manifest `b8eb9899…` | `555c2887…`, **v1.11.0**, manifest `6266d456…` | `acff5be` thêm arg `detailCode` vào `allowedArgs` của 4 public error; số mã **không đổi** (38/158) |

Đã đối chiếu diff trước khi re-pin: cả hai đều **thuần additive**, không có
breaking change ẩn — nên re-pin là phục hồi bất biến, không phải nới cổng. Đã
ghi lý do vào field `generatedBy` của chính pin.

### `F-REV-003` — Pin `pgm02_workspace_v1.json` lệch `openapiSha256` — **Trung bình**

Cùng gốc với `F-REV-002` (mang cùng hash cũ `56eb241a…`). Đã cập nhật
`pins.openapiSha256`.

### `F-REV-004` — Ảnh chụp `catalogVersion` trong test không đi cùng commit — **Trung bình**

`test_programming_error_catalog.py` assert `catalogVersion == "1.10.0"` trong khi
catalog đã là `1.11.0` (do `acff5be`). Số mã không đổi nên chỉ version lệch. Đây
là **lần thứ hai** đúng chế độ hỏng mà khối chú thích trong chính file đó cảnh
báo, và lần này lại bị `F-REV-001` che. Đã cập nhật ảnh chụp kèm ghi chú truy
nguyên.

### `F-REV-005` — UI nói sai về capability backend (`PPI-001`) — **Cao**

`EditorPane.tsx` (form thuộc tính POU) ẩn `FUNCTION`/`FUNCTION_BLOCK` khỏi
dropdown *Loại* và hiện cảnh báo:

> "Loại này chưa được Kiểm tra hỗ trợ biên dịch — đổi về PROGRAM trước khi Kiểm tra."

Câu này **sai** kể từ khi user POU hạ cánh (§2.2): backend biên dịch cả ba kind,
và `PouExplorer` — nằm ngay cạnh, trong cùng workspace — đã cho người dùng tạo
Function/Function Block. Hai đường tạo POU trong cùng một tính năng nói hai
capability model trái ngược nhau, và bản sai lại là bản khuyên người dùng
**đổi kind về PROGRAM**, tức phá chính POU của họ.

Cách sửa đã chọn, và lý do không mở dropdown cho sửa tự do: kind là **identity
lúc tạo**. Mỗi kind ra đời với header source riêng (`pouSourceTemplate()`), còn
BE chỉ kiểm kind thuộc tập `pouKinds` mà **không** kiểm header khớp kind — nên
đổi kind mà không viết lại source sẽ đỏ ở tầng parser với lỗi không nói gì về
nguyên nhân. Vì vậy:

- hiện **đủ ba** kind trong dropdown (không nói dối về capability);
- để ở dạng **chỉ đọc**, kèm help text chỉ tới đường tạo POU đúng;
- bỏ hẳn cảnh báo sai.

Help text đặt **ngoài** `<label>` và nối bằng `aria-describedby`: nhét vào trong
label làm accessible name của `<select>` dính cả câu giải thích — đúng cái bẫy mà
bản cũ phải lách bằng regex `/^Loại/`, và là nguyên nhân một test WP-11 đỏ khi
sửa lần đầu. Hai test WP-02 cũ **khóa hành vi sai** nên đã viết lại thành hai
test `PPI-001` khóa hành vi đúng. `DesignWorkspacePage.test.tsx` 45/45 PASS.

---

## 4. Gap còn lại — chưa implement đủ, cần quyết định thiết kế

### 4.1 Đối chiếu `d.md` G-01..G-21

Record `REC-PGM02-PROP-INS-001` (2026-09-09) đã phán quyết G-12..G-21. Phiên này
bổ sung phần **chưa được phán quyết** là G-01..G-11:

| Nhóm | ID | Trạng thái | Bằng chứng |
|---|---|---|---|
| Shell/layout | G-01, G-03 | **ĐẠT** | `layout/GlobalContextBar.tsx`, `ProgrammingContextStrip.tsx`, `ContextDetailsPopover.tsx` |
| Navigation | G-02 | **ĐẠT** | `ProgrammingFeatureRail.tsx` + `shellDestinations.ts`; tab legacy chuyển hướng qua `LegacyTabRedirect.tsx` |
| Mode | G-04 | **ĐẠT** | `shared/programsMode.ts` — state machine `EDIT`/`LIVE`/`SIMULATE` kèm `available`/`reason`, `SIMULATE` đọc `workspaceModes` từ server chứ không đoán |
| Alert compact | G-05 | **ĐẠT** | banner Draft đã là notification compact trong `EditorPane` |
| POU Explorer | G-06, G-07, G-08 | **ĐẠT** | `design/pou/PouExplorer.tsx` — 3 nhóm Programs/Function Blocks/Functions, menu `+ New` theo kind × language, action theo `…` menu |
| Toolbar | G-09, G-10 | **ĐẠT** | `role="group"` cho Undo/Redo, Insert, Search…; `Save`/`Check` là action chính, `Format` phụ |
| Quick Library | G-11 | **ĐẠT** | `design/library/QuickLibraryPanel.tsx` nằm **trước** Inspector trong grid, collapse + resize được |
| Inspector | G-12..G-21 | **0/10 đạt đủ** (7 một phần/khung, 3 chưa đạt) | theo `REC-PGM02-PROP-INS-001` §4, đã kiểm lại còn đúng ở `14538e8` |

Nói cách khác: **vỏ workspace đã xong; ruột Inspector chưa.** Đây là kết luận
khác với ấn tượng "Programming còn dở dang" — phần dở dang đã khu trú lại rất rõ.

### 4.2 Finding Inspector đã kiểm lại độc lập

Xác nhận còn đúng trên `14538e8`, kèm số đo cụ thể hơn record gốc:

| ID | Mức | Xác nhận trực tiếp trong source |
|---|---|---|
| `PPI-002` | **Cao** | `draftV2.ts:151` dựng `task.taskId` = `library.projectLibraryRevisionId ?? draft.project.projectId` — **một identity của library/project đóng vai Task ID**, không phải `programs[].taskId` mà BE thật sự lưu (`draft_v2.go:1245`). Đồng thời `EditorPane.tsx:1173` đọc `document.task.name`, mà adapter v2 **không bao giờ** sinh field đó (`ProgrammingTaskConfig.name` là optional, chỉ `taskId`/`periodMs`/`programOrder` được set) ⇒ Task luôn `không xác định được` về mặt cấu trúc |
| `PPI-005` | **Cao** | `EditorPane.tsx:1197` `enabled: null` cứng, kèm chú thích "chưa được nối vào tab này" — trong khi `client.ts:80` đã có `desiredEnabled: boolean \| null` và `ContextDetailsPopover.tsx:218` đã dùng được |
| `PPI-007` | **Trung bình** | `InterfaceSection.tsx:44` `min-w-[34rem]` = **544 px**; `ProgramsWorkspace.tsx` Inspector `DEFAULT=240 px`, `MAX=420 px` ⇒ cuộn ngang là **tất yếu** ở mọi cấu hình |
| `PPI-010` | **Trung bình** | `ProgramsWorkspace.tsx:110` bật grid **4 cột từ `lg` (1024 px)**: 208+6+320+6+196+6+240 = 982 px, editor bị ép về đúng sàn 320 px; handoff yêu cầu right dock **chung** ở 1280–1439 px |
| `PPI-003`, `PPI-004`, `PPI-006`, `PPI-008`, `PPI-009`, `PPI-011` | Cao→Thấp | giữ nguyên phán quyết record gốc |

### 4.3 Gap mới phát hiện trong phiên này

| ID | Mức | Finding | Ghi chú |
|---|---|---|---|
| `F-REV-006` | **Trung bình** | FBD chỉ được tạo cho `PROGRAM`. `PouExplorer.tsx:199-202` có Program·ST, Program·FBD, Function·ST, Function Block·ST — **không có** Function·FBD / Function Block·FBD, dù Plan 59 §0 hứa "`PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK` bằng ST/FBD" | Chưa xác định đây là giới hạn compiler có chủ đích hay thiếu đường FE. Cần Product/Compiler chốt trước khi hứa trong hồ sơ |
| `F-REV-007` | **Trung bình** | `EditorPane.tsx` **3355 dòng** — file lớn nhất tính năng, đồng thời sở hữu Property form, toolbar, ST editor, FBD host và context builder. `ProgramsTab.tsx` chỉ còn là facade re-export | Chính file này là nơi cả `PPI-001`, `PPI-002`, `PPI-003`, `PPI-005` cùng sống. Tách file là điều kiện thực tế để đại tu Inspector an toàn |
| `F-REV-008` | **Trung bình** | Ngân sách bundle chỉ còn **13.91 KiB** (151.09/165.00 KiB gzip) | Đại tu Inspector (6 cột interface, drawer, view-model mới) gần như chắc chắn vượt. Cần nâng ngân sách có phê duyệt **hoặc** code-split Inspector **trước** khi bắt đầu |
| `F-REV-009` | **Cao (quản trị)** | Cổng chỉ chạy khi có người chạy tay (CI waive vì ngân sách), nên `F-P59-OPENAPI-PIN-001` đã **tái diễn** sau khi được sửa ở R2 | Không phải lỗi code. Nhưng nếu không có cơ chế, `F-REV-002/003/004` sẽ tái diễn lần ba |

---

## 5. Plan next action

Xếp theo thứ tự thi hành, không theo mong muốn.

### 5.1 Ngay (đã làm trong phiên này)

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Sửa `F-REV-001` rule boundary Go | **DONE** — layout gate chạy hết |
| 2 | Re-pin `F-REV-002`/`F-REV-003` sau khi đối chiếu diff | **DONE** — 10/10 contract G1 khớp |
| 3 | Cập nhật ảnh chụp `F-REV-004` | **DONE** — 9/9 test PASS |
| 4 | Sửa `F-REV-005` UI nói sai capability + viết lại 2 test khóa sai | **DONE** — 45/45 PASS |
| 5 | Chạy lại toàn bộ cổng chạy được | **DONE** — §1 |

### 5.2 Kế tiếp — chặn việc tái diễn (không cần quyết định thiết kế)

| # | Việc | Lý do | Acceptance đo được |
|---|---|---|---|
| 6 | Bỏ `set -e` che lỗi trong `run_layout`: chạy **hết** các cổng rồi mới tổng hợp exit code | Đây là nguyên nhân **cấu trúc** khiến 4 lỗi che nhau hai lần | Cố ý làm hỏng 2 cổng ⇒ log phải hiện **cả hai**, không phải một |
| 7 | Cổng "pin ↔ contract" chạy được **không cần** toolchain C++/Node | Cho phép chạy rẻ, thường xuyên, kể cả khi không có CI | `python3 scripts/verify_programming_g1_contracts.py` + `pgm02` chạy độc lập trong <5 s |
| 8 | Pre-commit/pre-push hook gọi nhóm cổng ở #7 | Bù cho việc CI bị waive | Commit đổi `openapi.yaml` mà không re-pin ⇒ bị chặn tại máy dev |
| 9 | Mirror nội bộ tarball `bacnet-stack` (và `googletest`) | Mở lại profile C++ đầy đủ; hiện 403 vì tải từ GitHub | `--component cpp --profile full` configure exit 0 trong môi trường không có GitHub |
| 10 | Đóng nợ ngược chiều §2.3: đánh dấu rõ WP-13 và Gate #7 đã DONE trong Tracker, hoặc archive file | Tránh lập kế hoạch làm lại việc đã xong | Tracker không còn dòng nào mô tả sai hiện trạng code |

### 5.3 Đại tu Inspector — cần quyết định thiết kế trước khi code

Không nên bắt đầu code khi 4 câu hỏi dưới chưa có chủ. Đề xuất theo
`REC-PGM02-PROP-INS-001` §6.3, cần Product/Architecture ký:

| # | Câu hỏi phải chốt | Đề xuất |
|---|---|---|
| 11 | `Namespace` có thuộc Rev A không? | **Loại khỏi Rev A** tới khi có use case + schema + uniqueness + migration. Không giữ placeholder vĩnh viễn |
| 12 | `Access` là RBAC hay ghi chú? | Đổi nhãn thành **"Ghi chú truy cập"**; RBAC thật do server/capability quyết |
| 13 | `Language` đổi được không? | **Immutable** sau khi POU có source; muốn đổi phải qua conversion workflow có preview + rollback (G-21) |
| 14 | `Initial`/`Retain` ai là authority? | **Compiler/source** là authority; form phát edit command nguyên tử lên declaration rồi Check xác nhận. **Không** duy trì metadata song song |

Sau khi 11-14 có chủ, thi hành theo thứ tự phụ thuộc:

| # | Việc | Phụ thuộc | Acceptance đo được |
|---|---|---|---|
| 15 | Tách `EditorPane.tsx` (3355 dòng) theo trách nhiệm | — | Không file nào >800 dòng; test hiện có không đổi hành vi |
| 16 | Dựng `ProgramPropertyVM` với `PropertyField<T>` 4 trạng thái (`known`/`unavailable`/`not-applicable`/`error`) | 11-14, 15 | Mỗi field có `source`; test phân biệt được "chưa đọc được" vs "không áp dụng" |
| 17 | Nối Task identity thật (`PPI-002`) | 16 | `programs[].taskId` chiếu theo từng Program; **bỏ** việc dựng taskId từ `projectLibraryRevisionId`; không biến ID thành display name |
| 18 | Nối Enable intent vs read-back (`PPI-005`) | 16 | `desiredEnabled` và `enabled`+`source`/`observedAt` hiện tách bạch; không suy cái này từ cái kia |
| 19 | Gộp một `General` duy nhất (`PPI-003`) | 15, 16 | Không còn field nào render hai lần trong Inspector |
| 20 | Interface editor 6 cột ra drawer/workbench riêng (`PPI-004`, `PPI-007`) | 16, **F-REV-008** | Dock hẹp chỉ hiện nhóm + số lượng + 2–3 cột; bảng đầy đủ ở bề mặt rộng; **không** cuộn ngang trong dock |
| 21 | Sửa breakpoint 1280–1439 về right dock chung (`PPI-010`) | 15 | Test responsive ở 1024/1280/1440/1920 khớp handoff §4 |
| 22 | ARIA/keyboard cho tab Attributes (`PPI-011`) | 19 | `tab`/`tabpanel` liên kết đúng, arrow-key + focus management, axe không lỗi A/AA |

### 5.4 Giữ nguyên hàng đợi evidence (không đổi trong phiên này)

`TARGET_FAKE_MCU_SOAK` `NOT_RUN`, `VS-PROG-U15` PASS một phần (thiếu phép đo
AO/DO/relay bằng thiết bị), `RELEASE_READY` **`NO-GO`**. Phiên này không tạo và
không tiêu thụ evidence target/HIL.

---

## 6. Truy nguyên thay đổi của phiên

| File | Thay đổi | Finding |
|---|---|---|
| `tools/restructure/verify_repository.py` | Rule entrypoint Go: `cmd/mkddc-web` → `cmd/<binary>` | `F-REV-001` |
| `contracts/programming/g1_contract_join_v1.json` | Re-pin openapi (sha/version/45 op) + errors (sha/manifest/version) | `F-REV-002` |
| `contracts/programming/pgm02_workspace_v1.json` | Re-pin `pins.openapiSha256` | `F-REV-003` |
| `tests/integration/test_programming_error_catalog.py` | Ảnh chụp `catalogVersion` 1.10.0 → 1.11.0 | `F-REV-004` |
| `apps/web-ui/src/features/programming/design/editor/EditorPane.tsx` | Bỏ cảnh báo sai; kind chỉ đọc, đủ 3 option; help text ngoài `<label>` + `aria-describedby` | `F-REV-005` |
| `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx` | Thay 2 test WP-02 khóa hành vi sai bằng 2 test `PPI-001` khóa hành vi đúng | `F-REV-005` |

Không có file Go hoặc C++ production nào bị sửa trong phiên này.
