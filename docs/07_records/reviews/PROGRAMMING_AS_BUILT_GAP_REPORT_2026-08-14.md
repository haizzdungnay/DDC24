# Báo cáo As-Built và khoảng hở Programming Rev A trình PM/CTO

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-PROG-ASBUILT-GAP-2026-08-14` |
| Trạng thái | **Active review record — NO-GO cho nghiệm thu/release** |
| Ngày chốt | 2026-08-14 |
| Phạm vi | Source Programming hiện có trong Core, Web API, Web UI, contract, Plan 53 và bản đang chạy Foxlinx |
| Baseline source | `59f84c89cb5b` cộng cây làm việc trước PR `agent/programming-asbuilt-gap-report` |
| Tài liệu đối chiếu | `UX-WEB-PROG-001`, `DDD-FE-PROG-001`, `IFSPEC-PROG-001`, `PLAN-PROG-053`, `VVP-PROG-001`, `TRACE-PROG-001` |
| Người đọc chính | PM, CTO, Product Owner, System Architect, Dev Lead, Verification Lead |
| Quyền bằng chứng | Source review + host/browser/target supporting evidence; **không phải** `TR-PROG-*`, HIL hoặc release approval |

## 1. Kết luận điều hành

Programming Rev A **không phải một skeleton**: source hiện có đã bao phủ compiler
ST/FBD, runtime định kỳ, process image, lifecycle Commission/Restore, persistence,
REST API, bốn workspace Web và Monitor/Trace. P0..P4 đã được tracker ghi DONE ở
mức source/host; P5 đang `8/11`, toàn Plan 53 là `43/53 (81,1%)` tại baseline
0.55.

Tuy nhiên solution hiện tại **đang sai ở luồng cốt lõi UC-PROG-03 từ bước 2 và
chỉ được coi là bản tạm để review**. Kỹ sư có thể mở và sửa một Program ST đã có,
nhưng không thể tin cậy hoàn tất vòng:

`Tạo ST → sửa → lưu → Check FAILED → sửa lỗi → lưu → Check lại`.

Ba lỗi Critical đã được xác nhận:

1. Nút `ST+` tạo một Program có `document: ''`, trong khi compiler yêu cầu khung
   `PROGRAM ... END_PROGRAM`; đối tượng mới sai ngay từ lúc tạo.
2. Check niêm phong Draft, tăng ETag và đổi `baseRevisionId`, nhưng FE bỏ qua ETag
   trả về. Sau Check FAILED, lần lưu bản sửa dùng concurrency token cũ và bị 409.
3. Diagnostic live cho token sai chỉ hiện `PRG-ERR-SCOPE-001`, không có dòng/cột;
   acceptance “nhảy đúng khoảng nguồn” chưa đạt.

Ngoài ra còn sai ownership giữa `PGM-02` và `PGM-03`, thiếu điều hướng workspace
desktop, layout editor không đúng ba cột, conflict thiếu expected/actual, một số
error save không hiện cho người dùng, và các gate Monitor/Trace, RETAIN, HIL,
usability, Test Result vẫn mở.

**Cập nhật 2026-08-14 (Rev 1.1, phiên hỗ trợ user trực tiếp trên board Foxlinx):**
phát hiện thêm một lỗi **Critical** nghiêm trọng hơn cả ba lỗi UC-PROG-03 ở
trên — **Variable↔Point Binding (tab "Points & Mapping", UC-05) không hề được
truyền vào compiler**. `compiler.Input` (Go, `runner.go`) chỉ gửi mã nguồn ST
thô; CLI `mkddc-st-compile` không có tham số nào nhận binding. Hệ quả: section
`io_bindings` trong MỌI artifact đã compile qua pipeline này **luôn luôn rỗng**,
bất kể user map Point đúng hay sai — không Program Rev A nào, dù cấu hình đúng
100%, từng thật sự ghi được ra AO/DO vật lý hay Virtual Point qua đường này.
Xem chi tiết và bằng chứng tái hiện thật trên board ở §4 (mục
`F-PROG-ASBUILT-013`).

**Cập nhật 2026-08-14 (Rev 1.2, cùng ngày — implement theo authority D-07 do
PM/CTO chốt):** `F-PROG-ASBUILT-013` đã được **triển khai, test và kiểm chứng
trên target thật** theo kiến trúc Binding Manifest (D-07) — xem §4.5. Phạm vi
đóng hiện tại là **category `LOCAL` (điểm vật lý UI/DI/AO/DO)**; Program
Rev A giờ có thể thật sự điều khiển AO/DO vật lý qua Check→Commission. Trong
lúc triển khai và target-test phát sinh hai finding phụ, cả hai **chưa sửa,
chỉ ghi nhận** chờ PM/CTO quyết hướng riêng (không nằm trong phạm vi D-07 gốc):
`F-PROG-ASBUILT-014` (category `VP` không có đường chạy thật tới Core) và
`F-PROG-ASBUILT-015` (kênh `UI` cấu hình "dry"/digital trong `io_config.conf`
không bind được vì compiler/Core hardcode mọi kênh `UI` là `REAL`/analog) —
xem §4.6.

**Cập nhật 2026-08-14 (Rev 1.3, cùng ngày — tiếp tục theo Lệnh triển khai
PM/CTO, phần UC-PROG-03):** đóng năm finding UC-PROG-03 còn lại trong phạm vi
đã giao (`F-PROG-ASBUILT-001`, `002`, `003`, `004`, `007`) và ba quyết định
liên quan (`D-01`, `D-02`, `D-04`) — chi tiết implementation ở
`CHANGELOG.md` mục cùng ngày, không lặp lại ở đây:

- `F-PROG-ASBUILT-001`/`D-02` — Program ST mới sinh template
  `PROGRAM NewProgram\nEND_PROGRAM\n` hợp lệ thay vì `document: ''`; Save
  khoá khi buffer rỗng/toàn khoảng trắng.
- `F-PROG-ASBUILT-002` — `useDraftWorkspace.syncAfterSeal()` đồng bộ
  ETag/`baseRevisionId` ngay sau seal; sửa sau Check FAILED không còn 409.
- `F-PROG-ASBUILT-003` — xác nhận backend đã forward `line/column/length` từ
  compiler thật (không phải lỗi tồn tại độc lập ở phiên này); nối tiếp bằng
  query string `line/column/length` qua route Check→Design sau khi tách theo
  `D-01`; viết test chứng minh (trước đây không có).
- `F-PROG-ASBUILT-004`/`D-01` — `PGM-03` (`CheckCommissionPage`) giờ tự
  `seal → run → poll → result`; `PGM-02` chỉ điều hướng, có dirty guard.
  Phát hiện phụ sửa luôn: `useProgrammingResource` không refetch khi định
  danh tài nguyên đổi giữa vòng đời component (`api/queries.ts`).
- `F-PROG-ASBUILT-007`/`D-04` — thêm `ProgrammingDesktopNav` (bốn workspace,
  `hidden md:flex`), wire vào `ProgrammingLayout`.

**Còn mở, chưa thuộc phạm vi đã giao phiên này:** `F-PROG-ASBUILT-005`
(409 thiếu expected/actual), `006` (banner lỗi save offline), `008` (layout
ba cột desktop), `009` (autocomplete ST), `D-03` (phạm vi editor ST Rev A
chính thức), `D-05`/`D-06` (ưu tiên delivery/release), toàn bộ §4.6
(`F-PROG-ASBUILT-014`/`015`). Gate đo lại: **1024/1024 CTest, Go vet sạch +
mọi package PASS, 571/571 Vitest, lint/build sạch, 10/10 Playwright** (§10.1).

**Đề nghị PM/CTO:** chấp nhận PR này như snapshot As-Built + hồ sơ gap, **không
chấp nhận như feature hoàn tất**; giữ `RELEASE_READY = BLOCKED` cho tới
32/32 Test Result có reviewer độc lập + HIL/residual acceptance (không đổi
bởi Rev 1.3). Với Rev 1.3: **UC-05 (Ánh xạ biến tới Point) nay có hiệu lực
runtime thật cho category `LOCAL`** (đóng `F-PROG-ASBUILT-013`, xem §4.5) —
tuyên bố "hoạt động" chỉ đúng trong phạm vi đó; category `VP` vẫn chỉ là biên
tập Draft (§4.6, `F-PROG-ASBUILT-014`). UC-PROG-03 có supporting evidence đủ
cho vòng sửa/check cơ bản (§9) nhưng **chưa** có Test Result độc lập — không
tự nâng UC-03 thành PASS chỉ vì năm finding trong phạm vi đã giao đóng.

## 2. Hiện trạng source đã triển khai

| Lớp | Thiết kế yêu cầu | As-Built source hiện tại | Kết luận |
|---|---|---|---|
| Contract | OpenAPI, error catalog, profile/artifact, IPC có phiên bản | OpenAPI Programming v1.20, client TypeScript sinh mã, IPC/Core contract, catalog lỗi và manifest join đã có | **Có implementation**; chưa phải release evidence |
| Compiler | ST Rev A + FBD về typed IR chung, source map, bounded sandbox | Parser/compiler ST, FBD canonical/lowerer, artifact/hash/source map, hostile corpus và fuzz đã có | **Có implementation host**; diagnostic live còn mất location ở UC-03; **Binding Manifest (D-07) đã triển khai cho category `LOCAL`, kiểm chứng target thật — xem §4.5**; category `VP`/`UI` "dry" còn mở, xem `F-PROG-ASBUILT-014`/`015` |
| Core runtime | một Task Rev A, process image, priority, cutover atomic, RETAIN/recovery | Scheduler, input/output preflight, PID/override, task metric, journal, RETAIN, Commission coordinator và runtime snapshot đã có | **Có implementation source/host**; target timing, power-cut, I/O thật còn mở |
| Web API | Project/Draft/Revision/Check, ETag, idempotency, RBAC/audit, Commission/Restore, Monitor/Trace | SQLite lifecycle, Check worker, operation coordinator, runtime/monitor/trace và route auth đã có | **Có implementation**; một số error envelope chưa đủ dữ liệu recovery cho FE |
| Web UI | bốn workspace, ST/FBD/mapping/task, Check/Commission, Runtime/Watch/Service | `PGM-01..04`, context, dirty guard, ST tooling, FBD, mapping, Commission, runtime, mobile nav, export/import đã có | **Có surface rộng nhưng UC-03 và IA/layout chưa đúng thiết kế** |
| Deploy | feature flag, backup, atomic deploy, rollback/read-back | Corrective dirty-source đã chạy trên Foxlinx; artifact/hash/rollback nằm trong `EV-PROG-P5-510` | **Supporting target**; source chưa merge, PR này không tự deploy lại |
| Verification | 32 scenario có Test Result độc lập, HIL, residual acceptance | Host/browser supporting gate đã chạy trước đó; tracker giữ `2/32 record`, `0/32 PASS` | **RELEASE_READY BLOCKED** |

### 2.1 Source owner chính

- Core/runtime: `apps/core/application/runtime/`, `apps/core/domain/graph/`,
  `apps/core/domain/priority/` và bounded Programming components.
- Web API: `apps/web-api/internal/programming/` cùng facade trong
  `apps/web-api/internal/app/`.
- Contract: `contracts/openapi/openapi.yaml`, contract Programming/IPC/profile.
- FE: `apps/web-ui/src/features/programming/`, route trong `apps/web-ui/src/app/`.
- Authority thiết kế: `docs/02_design/`, `docs/04_uiux/`, verification/trace và
  Plan 53; record này không thay các authority đó.

## 3. Tái hiện UC-PROG-03 ngày 2026-08-14

### 3.1 Luồng đã chạy trên Foxlinx

Môi trường: `http://mekong-fac.ddns.net:8082/`, Chromium cô lập `1440×1000`,
đăng nhập admin; không lưu token/cookie/header. Chỉ thay Draft; không Commission,
Restore hay output vật lý.

1. Mở `PGM-02`, ban đầu chưa Program nào được chọn; desktop không có điều hướng
   nội bộ bốn workspace: [ảnh bước 2](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-current-step2-desktop.png).
2. Chọn Program ST hợp lệ, thêm token sai và lưu Draft.
3. Bấm Check: kết quả `FAILED`, Active Revision vẫn
   `1ab7cb9b-b3dc-4744-ab9c-7ac778bb9af7`; Problems chỉ có lỗi scope, không có
   dòng/cột: [ảnh Check FAILED](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-check-failed-before-fix-desktop.png).
4. Xóa token sai và bấm lưu. UI báo Draft đã đổi ở phiên khác; expected/current
   đều `—`: [ảnh conflict](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-etag-conflict-before-fix-desktop.png).
5. Tải lại concurrency state và lưu lại source hợp lệ. Draft đã phục hồi, Active
   vẫn không đổi: [ảnh hoàn nguyên](../test-evidence/fw-som/programming-plan53-corrective/uc-prog-03-draft-restored-after-repro.png).

### 3.2 Chuỗi nguyên nhân source

```text
ProgramsTab.ST+
  -> upsertProgram(document = "")                         [sai đầu vào]
  -> người dùng sửa/lưu
  -> DesignWorkspacePage.runCheck(project)
  -> POST revision: server tăng Draft ETag + đổi baseRevisionId
  -> useCheckWorkflow chỉ lấy revisionId, bỏ sealed.etag   [stale FE state]
  -> Check FAILED
  -> người dùng sửa/lưu bằng ETag/base cũ
  -> backend fail-closed 409
  -> UI không có expected/actual nên recovery copy là "—"
```

Dẫn chứng:

- [`ProgramsTab.addProgram`](../../../apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx#L105-L126)
  gán source ST rỗng và lưu ngay.
- [`DesignWorkspacePage`](../../../apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx#L161-L188)
  chạy Check trực tiếp trên `PGM-02`.
- [`useCheckWorkflow`](../../../apps/web-ui/src/features/programming/design/useDraftWorkspace.ts#L159-L183)
  nhận `sealed.etag` nhưng không đồng bộ lại Project/Draft state.
- [`ProjectService.SealRevision`](../../../apps/web-api/internal/programming/application/projects.go#L231-L280)
  trả ETag mới đúng contract; store tăng ETag và đặt Revision mới làm base.
- [`CheckCommissionPage`](../../../apps/web-ui/src/features/programming/commission/CheckCommissionPage.tsx#L77-L95)
  không thể bắt đầu Check khi mở trực tiếp, trái ownership ghi ở UI/UX.

## 4. Tái hiện đứt gãy Binding → Compiler (bổ sung 2026-08-14, phiên hỗ trợ user)

### 4.1 Bối cảnh phát hiện

User tự tay tạo Program `AHU_FanControl` (ST, 3 `VAR_OUTPUT`: `FanEnable`,
`FanSpeed`, `AlarmHigh`), map cả ba vào Point thật ở tab "Points & Mapping",
Check PASSED, Commission thành công nhiều lần trên board Foxlinx thật
(`http://mekong-fac.ddns.net:8082/`). Sau mỗi lần Commission, trang Runtime
vẫn báo `safeStateNoControllerOnly: true` — tức Core vẫn coi "chưa Program nào
điều khiển output vật lý", dù Revision Active đã đổi đúng và Task `RUNNING`
khoẻ mạnh (`overrunCount: 0`).

### 4.2 Loại trừ từng giả thuyết bằng dữ liệu thật

1. **Giả thuyết 1 — mapping sai hướng/kiểu** (đã có finding thật, xem sửa cùng
   ngày trong `CHANGELOG.md`): `AlarmHigh` (BOOL) từng bị map vào
   `LOCAL:UI-09` (Universal Input — kênh INPUT vật lý, hướng `READ`, kiểu
   `REAL`). Xác nhận `PointWriter::can_write()`
   (`apps/core/domain/graph/point_writer.cpp#L7-L17`) fail-closed loại `AI`
   khỏi danh sách ghi được (chỉ `AV/BV/MSV/EXT`). Vì
   `st_apply_all_outputs()` (`apps/core/application/st/st_process_image.cpp#L339-L372`)
   gom output **cả chương trình vào một batch** rồi `preflight_outputs()`/
   `commit_outputs()` chạy **một lần** cho toàn batch, một binding hỏng làm
   **toàn bộ output của Program không commit**, kể cả hai binding đúng
   (`FanEnable→LOCAL:DO-01`, `FanSpeed→LOCAL:AO-01`). Sửa Point Picker
   (`MappingTab.tsx`, thêm `isCompatiblePoint`) để không chọn nhầm được nữa —
   **nhưng sau khi sửa và Commission lại (Revision `fa88c51b...`, xác nhận
   qua `GET /api/v1/programming/revisions/{id}` cả ba binding đều đúng
   `READ_WRITE`/kiểu khớp), `safeStateNoControllerOnly` vẫn `true`.** Giả
   thuyết 1 không giải thích hết hiện tượng.
2. **Giả thuyết 2 (đúng) — Binding không tới được compiler**: tra
   `compiler.Input` (`apps/web-api/internal/programming/compiler/runner.go#L34-L38`)
   chỉ có `SourceID`, `Language`, `Source` — không field nào chở
   `variables[]`/`bindings[]` của Draft. Tra tiếp CLI thật đang chạy trên
   board, `mkddc-st-compile --help`
   (`apps/core/application/st/st_compile_main.cpp#L223-L252`): tham số hợp lệ
   chỉ `--source --source-id --language --key --out --manifest-out --sandbox
   --version --help` — **không có tham số nhận binding**.

### 4.3 Vì sao đây là gap kiến trúc, không phải bug một dòng

- Định dạng artifact **đã có sẵn** chỗ cho binding: `st_loader.cpp#L395-L449`
  parse đầy đủ section `SEC_IO_BINDING` (kiểm trùng slot, kiểm "một output
  vật lý chỉ một người ghi", kiểm kiểu/hướng khớp biến) — nghĩa là Core sẵn
  sàng NHẬN binding, chỉ là **không có bước nào trong pipeline hiện tại từng
  TẠO RA** section đó.
- Ngữ pháp ST hiện hành (`ST_SUBSET_SPEC_MK-DDC-24_VI.md` §10 EBNF,
  `var_decl = identifier ":" type_name ";"`) **không có cú pháp khai báo
  binding trong mã nguồn** (không có mệnh đề kiểu `AT %QX...` của IEC
  61131-3 cổ điển) — nên đây không đơn thuần là quên một cờ CLI, mà là một
  khâu chưa từng được thiết kế: *bindings đi từ Draft JSON vào compiled
  artifact bằng cơ chế nào?*

### 4.4 Hệ quả

**Không Program Rev A nào từng thật sự điều khiển output vật lý/Virtual
Point qua pipeline hiện tại, bất kể Points & Mapping được cấu hình đúng đến
đâu.** Đây rất có thể là nguyên nhân gốc của chính `F-PROG-ASBUILT-010`
("Monitor `items=0`" — không có binding nào để Monitor thấy, không chỉ vì
thiếu fixture test mà vì binding chưa từng tồn tại ở tầng runtime) và khiến
UC-05 (Ánh xạ biến tới Point) chỉ là biên tập dữ liệu Draft, không có hiệu
lực runtime — xem cập nhật §6/§7.

### 4.5 Triển khai D-07 và bằng chứng target (2026-08-14, cùng ngày)

Theo authority D-07 PM/CTO đã chốt ("manifest binding riêng qua CLI, **không**
mở rộng cú pháp ST"), đã triển khai kiến trúc Binding Manifest end-to-end:

**C++ (compiler):**

- `resolve_io_bindings(StIrModule*, entries, diagnostics)`
  (`apps/core/application/st/st_io_map.cpp`) — nối vào `st_artifact_manifest.cpp`
  ngay sau `compile_reference()`, trước `EncodeArtifactDeterministic()`; validate
  tồn tại biến, direction/type khớp ST declare, không trùng biến/không trùng
  physical output, category chỉ `LOCAL`, point index trong giới hạn
  (`st_point_kind_limit()`), output không nhắm kênh input-only
  (`st_point_kind_allows_output()`). Thất bại ở entry đầu tiên → `module` không
  đổi (fail-closed, không sinh artifact một phần).
- `mkddc-st-compile --io-map-in <path>` (`st_compile_main.cpp`) — đọc JSON
  `{"entries":[...]}` khớp field-for-field `StIoMapEntry`; input sai hình dạng
  JSON fail toàn bộ CLI tại chỗ (không âm thầm bỏ entry lỗi); JSON output thêm
  `ioBindingCount` làm bằng chứng artifact THẬT SỰ mang binding.
- Diagnostic mới `ST-IOMAP-008` (`kIoMapUnsupportedCategory`) cho category hợp
  lệ về định danh nhưng chưa có runtime path (`VP`/`MB_RTU`).
- 13 unit test (`test_st_resolve_io_bindings.cpp`) + 3 CLI integration test
  bằng binary thật (`test_st_compile_cli.cpp`, exec qua `ST_COMPILE_CLI_PATH`)
  — bao gồm tái hiện đúng bug thật `AlarmHigh(BOOL)→UI-09` (kỳ vọng
  `ST-IOMAP-002`) và category `VP` bị từ chối (`ST-IOMAP-008`).
- **1024/1024 CTest PASS** (Release, Modbus/BACnet/HMI `ON`).

**Go (Web API):**

- `compiler.Input.IoMap []IoMapEntry` (`runner.go`) — ghi JSON tạm trong
  scratch job, thêm `--io-map-in` vào `exec.CommandContext` khi non-empty.
  `Result.IoBindingCount` được `validateSuccess()` **ép bằng đúng**
  `len(input.IoMap)` — không chỉ tin CLI trả `ok:true`, tự kiểm artifact thật
  sự mang đúng số binding đã gửi (đúng yêu cầu acceptance "SEC_IO_BINDING
  không rỗng" ở tầng BE).
- `ioMapFromRevision()` (`checks.go`) — gom `RevisionObject` kind `VARIABLE`/
  `BINDING` của Revision đã seal (đúng dữ liệu Mapping tab ghi qua
  `upsertVariable`/`upsertBinding`, không phải nguồn mới), map
  `variable.class` (`INPUT`/`OUTPUT`) sang `direction` ST, fail-closed
  (`PRG-ERR-SCOPE-001`) nếu binding trỏ tới biến class khác — dữ liệu hỏng
  hiếm khi xảy ra qua Mapping tab UI nhưng `draft.go` không validate field này
  ở seal time nên vẫn phải tự kiểm.
- Phát hiện phụ giữa chừng: diagnostic `ST-IOMAP-008` mới thêm ở C++ không có
  trong `contracts/programming/error_catalog_v1.json` — generator
  (`scripts/generate_programming_errors.py`) cross-check `st_diagnostic.hpp`
  sẽ fail; nếu bỏ sót, mọi lỗi category không hỗ trợ sẽ map sai về
  `PRG-ERR-UNAVAILABLE-001` (503, "dịch vụ tạm ngưng") thay vì lỗi validation
  thật (422). Đã vá: thêm mapping `ST-IOMAP-008 → PRG-ERR-MAP-003`, bump
  `catalogVersion` 1.4.0→1.5.0, regenerate cả ba output (Go/C++/TS).
- Test mới: `checks_test.go` (Check thật resolve io_map từ Draft, và Check
  fail-closed khi binding trỏ variable class sai) + `runner_test.go` (CLI thật
  qua binary đã build, cả hai chiều thành công/thất bại).
- **`go vet` sạch; `go test ./... -count=1` PASS mọi package.**

**FE:** không cần đổi — Draft đã ghi đúng `variables[]`/`bindings[]` từ trước
(FE side of D-07 chỉ là tiêu thụ dữ liệu có sẵn). **559/559 Vitest PASS**,
lint sạch, build PASS (bao gồm gate `check:programming-errors` xác nhận
catalog đồng bộ).

**Target thật trên Foxlinx (`root@mekong-fac.ddns.net:2223`, board sản xuất):**

Cross-compile aarch64 (`build/fw-aarch64`, toolchain
`platform/cmake/toolchain-aarch64-linux-gnu.cmake`), deploy
`mkddc-core`/`mkddc-st-compile`/`web-api` (backup binary cũ tại
`/data/releases/20260814T115624Z-pre-f013-binding-manifest/` trước khi ghi đè).

1. CLI trực tiếp trên board (aarch64 thật, không phải x86_64 dev host):
   `AHU_FanControl` với `SupplyTemp→UI-01, FanEnable→DO-01, FanSpeed→AO-01` →
   `{"ok":true,"ioBindingCount":3}`; tái hiện đúng bug thật
   `AlarmHigh(BOOL)→UI-09` → `{"ok":false,"diagnostics":[{"code":"ST-IOMAP-002"}]}`;
   category `VP` → `{"ok":false,"diagnostics":[{"code":"ST-IOMAP-008"}]}`.
2. Chuỗi HTTP thật qua project sản xuất `FOX-P5-FULL-CHECK`
   (`ce9e8d8d-c06d-461b-8429-4056ac10e860`), Program `AHU_FanControl` thật của
   user (không phải fixture dựng riêng): Draft→Seal
   (`e5653fdc-4ade-40e3-8ba4-8e0d62bf63c5`)→Check **PASSED** (artifact 1840
   byte)→Commission **SUCCEEDED**
   (`actualActiveRevisionId=e5653fdc...`)→`GET /programming/runtime`:
   `safeState:false`, **`safeStateNoControllerOnly:false`** (trước đây luôn
   `true` — đúng triệu chứng gốc `F-PROG-ASBUILT-013`)→
   `GET /programming/runtime/monitor`: cả 5 biến `programValue==actualValue`,
   quality `GOOD`, freshness `LIVE`, `effectivePriority:5` (`PRIO_LOCAL_LOGIC`)
   cho ba `VAR_OUTPUT`; `SupplyTemp`/`Setpoint` đọc trực tiếp cảm biến thật
   `UI-01`/`UI-02` (giá trị đổi mỗi giây qua nhiều lần lấy mẫu liên tiếp),
   `FanSpeed`/`AlarmHigh`/`FanEnable` tính đúng công thức
   `LIMIT(0, Deviation*20, 100)`/`Deviation>5.0`/`StartDelay.Q` từ giá trị
   sống đó mỗi chu kỳ scan (`runCount` tăng liên tục, không đứng yên).

Do Rev A giới hạn 1 Project/controller, project dùng cho test **là project
Program thật của user** (không dựng project mới được — capability
`projectsPerController=1`). `Setpoint`/`Occupied` trong Draft gốc đang bind
`VP1`/`VP2` (category `VP`, chưa có runtime path — xem §4.6); để chứng minh
đủ chuỗi trên `LOCAL`, đã tạm rebind `Setpoint→UI-02` (thật, chưa dùng) và bỏ
bind `Occupied` (minh hoạ đúng tính năng "partial binding" của
`resolve_io_bindings()` — biến `VAR_INPUT/VAR_OUTPUT` chưa map vẫn Check được,
chỉ không có binding trong artifact). Revision `e5653fdc...` hiện **đang chạy
thật** trên board là kết quả của thay đổi tạm này; user đã được thông báo
trực tiếp trong phiên và xác nhận giữ nguyên, tự quyết định remap `Setpoint`/
`Occupied` khi cần.

### 4.6 Phát hiện phụ trong lúc triển khai/target-test D-07

Cả hai **chưa sửa trong phiên này** — nằm ngoài phạm vi kỹ thuật D-07 gốc
(binding LOCAL qua CLI manifest), cần PM/CTO quyết hướng riêng trước khi code,
đúng nguyên tắc D-07 đã áp dụng (không tự chọn phương án kiến trúc thay).

**`F-PROG-ASBUILT-014` — category `VP` không có đường chạy thật tới Core.**
Phát hiện khi điều tra runtime path cho `resolve_io_bindings()`:
`overlayVirtualPoints()` (`apps/web-api/internal/app/points.go`) chứng minh
Virtual Point là **construct cấu hình chỉ ở Web API** (`virtual_points.conf`),
KHÔNG map tới slot `AV`/`BV`/`MSV` thật mà Core ghi được — Point Catalog trả
Virtual Point như một overlay hiển thị, không phải Point Core biết. Do đó
`resolve_io_bindings()` **từ chối tường minh** mọi entry `category=="VP"` với
`ST-IOMAP-008` thay vì bind sai vị trí hoặc bind vào slot không tồn tại. Hệ
quả: Program không thể dùng Virtual Point làm input/output cho tới khi có một
lát cắt riêng nối `virtual_points.conf` (hoặc kế thừa nó) vào Core AV/BV/MSV
thật.

**`F-PROG-ASBUILT-015` — kênh `UI` cấu hình "dry" (digital) không bind được
dù Point Catalog báo đúng kiểu `BOOL`.** Phát hiện khi target-test cố bind
`Occupied (BOOL)→UI-09` — điểm thật, đang cấu hình
`"type":"dry"` trong `/data/config/io_config.conf` trên board Foxlinx (Point
Catalog xác nhận `UI-09: dataType=BOOL, quality=GOOD`, đúng với cấu hình dry
contact). Compile fail với `ST-IOMAP-003` (type mismatch) vì
`validate_point_contract()` (`apps/core/application/st/st_io_map.cpp`)
hardcode **mọi** prefix `UI` phải kiểu `REAL` — không đọc cấu hình per-channel
thật. Đào sâu hơn: `map_kind()` (`apps/core/application/st/st_process_image.cpp`)
cũng hardcode `StPointKind::UI → core::PointKind::AI` (Analog Input) một chiều,
trong khi Core domain **đã có sẵn** `PointKind::BI` (Binary Input) riêng biệt
(`apps/core/domain/graph/point_table.hpp`) — nghĩa là tầng Core domain vốn hỗ
trợ phân biệt UI-analog/UI-digital, nhưng tầng `StPointKind` (IR/artifact) và
compiler validator hiện chỉ có 4 kind LOCAL phẳng (`UI/DI/AO/DO`), không đủ
biểu diễn "UI cấu hình digital". Đây là giới hạn **định dạng IR/artifact**
(`StPointKind` trong `st_ir.hpp`), không phải một dòng validate sai — sửa cần
quyết định cách compiler biết per-channel mode thật (vd. tin thẳng
`entry.type` do BE gửi dựa trên Point Catalog thay vì suy luận từ prefix, hay
mở rộng `StPointKind`/`SEC_IO_BINDING` thêm biến thể digital-UI) và có ảnh
hưởng khả năng tương thích ngược của artifact format — không sửa vội trong
phiên này. Hệ quả hiện tại: **mọi kênh Universal Input cấu hình "dry" trên
board thật vĩnh viễn không bind được cho VAR_INPUT/VAR_OUTPUT nào**, kể cả khi
Point Catalog báo đúng kiểu.

## 5. Bảng gap ưu tiên giao PM/CTO

| ID | Mức | Thiết kế/acceptance | As-Built/gap | Ảnh hưởng người dùng/rủi ro | Owner đề nghị | Điều kiện đóng |
|---|---|---|---|---|---|---|
| `F-PROG-ASBUILT-001` | **Đã đóng** (Critical khi mở) | UC-03 bước 1–3; ST Program phải sửa/lưu/check được | ~~`ST+` tạo `document: ''`~~ — `addProgram()` sinh template `PROGRAM NewProgram\nEND_PROGRAM\n`; Save khoá khi buffer rỗng (D-02) | Đóng | FE + Compiler + UX — **đã thực hiện** | Template hợp lệ + chặn save rỗng — 2026-08-14 |
| `F-PROG-ASBUILT-002` | **Đã đóng** (Critical khi mở) | UC-03 bước 6; UX-REQ-020 không mất Draft/overwrite sau Check | ~~hook chỉ giữ `revisionId`~~ — `useDraftWorkspace.syncAfterSeal()` cập nhật ETag/base ngay sau seal, gọi từ `useCheckWorkflow.runCheck()` | Đóng | FE + BE — **đã thực hiện** | Test `F-PROG-ASBUILT-002` trong `CheckCommissionPage.test.tsx`/`DesignWorkspacePage.test.tsx` — 2026-08-14 |
| `F-PROG-ASBUILT-003` | **Đã đóng** (Critical khi mở) | VS-PROG-005/006: diagnostic đúng source range | Backend đã forward `line/column/length` thật từ compiler; thiếu là đường truyền qua route Check→Design sau khi tách theo D-01, nay mang qua query string | Đóng | Compiler + BE + FE — **đã thực hiện** | Test jump-to-line/column trong `DesignWorkspacePage.test.tsx` — 2026-08-14 |
| `F-PROG-ASBUILT-004` | **Đã đóng** (High khi mở) | UC-06: Check bắt đầu ở `PGM-03`; `PGM-02` có shortcut | D-01 chốt: `PGM-03` sở hữu seal/run/poll/result; `PGM-02` chỉ điều hướng có dirty guard | Đóng | Product + UX + FE — **đã thực hiện** | `CheckCommissionPage.test.tsx` (chạy Check từ trạng thái trống) + `e2e/programming.spec.ts` 10/10 PASS — 2026-08-14 |
| `F-PROG-ASBUILT-005` | **High** | FE design §13: 409 hiện base/current/local diff | Server trả public conflict không có expected/actual; UI render `—` | Recovery mù, dễ tải lại nhầm và mất ngữ cảnh | BE + FE | Error envelope có field ổn định hoặc UI bỏ claim; two-client test + browser evidence |
| `F-PROG-ASBUILT-006` | **High** | UC-03 network loss giữ buffer và cho retry có thông báo | `useDraftWorkspace.error` được set khi save lỗi nhưng ready page không render lỗi save riêng | Người dùng bấm lưu nhưng không biết thất bại | FE | Alert/toast persistent có retry; offline/5xx test; buffer giữ nguyên |
| `F-PROG-ASBUILT-007` | **Đã đóng** (High khi mở) | UX-REQ-002; bốn workspace phải discoverable | `ProgrammingDesktopNav` mới (`hidden md:flex`), wire vào `ProgrammingLayout` — cùng danh sách bốn mục với bản mobile | Đóng | UX + FE — **đã thực hiện** | `ProgrammingDesktopNav.test.tsx` (3 test: rỗng/có Project/active state) — 2026-08-14 |
| `F-PROG-ASBUILT-008` | **Medium** | `PGM-02` desktop có Tree 280 + Editor + Inspector 308; Problems luôn truy cập được | Source grid hai cột; Inspector nằm dưới editor; Problems chỉ render khi có diagnostic | Sai hierarchy, tăng cuộn, trạng thái Problems biến mất | UX + FE | Grid ba cột ≥1440; collapse 1024–1439; empty Problems region; desktop/mobile visual test |
| `F-PROG-ASBUILT-009` | **Medium** | ST editor có autocomplete bounded/syntax feedback | Hiện có line/column/find/format/symbol, chưa có autocomplete/highlight rõ ràng | Trải nghiệm chưa đạt editor design; tăng lỗi nhập | UX + FE | Chốt phạm vi Rev A, implement hoặc sửa design/acceptance có phê duyệt |
| `F-PROG-ASBUILT-010` | **High** | UC-12 Monitor/Trace có program/actual/owner/priority/quality/freshness | Target active fixture không có binding; Monitor `items=0`, Trace positive chưa chạy | Không chứng minh dữ liệu thật xuyên Core→FE | QA + Core + BE + FE | Fixture binding read-only; start/get/stop và negative trace; raw evidence/reviewer |
| `F-PROG-ASBUILT-011` | **High** | UC-13 RETAIN reset có affected list, strong confirm, re-auth, operation read-back | FE đúng fail-closed nhưng route vẫn contract-only, action bị khóa | Capability chưa hoàn tất; không được quảng bá là đã có | Core + BE + FE + Safety | Contract impact thật + negative/fault/target evidence; không dùng Active ID giả |
| `F-PROG-ASBUILT-012` | **Critical gate** | Plan close: merge source, 32/32 Test Result, HIL/residual acceptance | Corrective chưa merge tại thời điểm audit; `0/32 PASS`; P6 chưa bắt đầu | Không có authority release/production acceptance | Dev Lead + Verification + QA + Release | PR review/merge; full gates tại commit; 32/32 reviewed PASS; HIL/power/fault/usability |
| `F-PROG-ASBUILT-013` | **Đã đóng cho `LOCAL`** (Critical khi mở) | UC-05 Ánh xạ biến tới Point phải có hiệu lực runtime thật khi Program Active | ~~`compiler.Input` (Go) chỉ chở mã nguồn~~ — đã triển khai Binding Manifest (D-07) cho category `LOCAL`; xem §4.5 bằng chứng target đầy đủ (Check PASSED, Commission SUCCEEDED, `safeStateNoControllerOnly:false`, Monitor `programValue==actualValue` LIVE) | Đóng cho `LOCAL`; category `VP`/`UI`-dry vẫn mở, xem `F-PROG-ASBUILT-014`/`015` | Compiler + Core + BE — **đã thực hiện** | 1024/1024 CTest, Go mọi package, 559/559 Vitest, target CLI + target HTTP full-chain — **đã đạt 2026-08-14** |
| `F-PROG-ASBUILT-014` | **High** (mới 2026-08-14) | Category `VP` trong `StIoMapEntry`/Mapping tab phải bind được nếu Point Catalog liệt kê | `overlayVirtualPoints()` (Web API) chứng minh VP chỉ là overlay cấu hình `virtual_points.conf`, không map slot Core AV/BV/MSV thật; `resolve_io_bindings()` từ chối tường minh (`ST-IOMAP-008`) thay vì bind sai | Program không thể dùng Virtual Point làm input/output cho tới khi có lát cắt nối `virtual_points.conf` (hay kế thừa) vào Core thật; Mapping tab hiện cho chọn VP nhưng sẽ luôn fail Check | Product + Core + BE | Quyết định: (a) nối VP→Core AV/BV/MSV thật, hay (b) bỏ VP khỏi Point Picker Rev A cho tới khi (a) xong; test binding VP end-to-end sau khi chọn hướng |
| `F-PROG-ASBUILT-015` | **High** (mới 2026-08-14) | Kênh `UI` cấu hình digital ("dry") trong `io_config.conf` phải bind được đúng kiểu `BOOL` như Point Catalog báo | `validate_point_contract()` hardcode mọi prefix `UI`→`REAL`; `map_kind()` hardcode `StPointKind::UI`→`core::PointKind::AI` một chiều dù Core domain đã có `PointKind::BI` riêng; `StPointKind`(IR)/`SEC_IO_BINDING` không đủ biểu diễn "UI digital" | Mọi kênh Universal Input cấu hình dry-contact trên board thật (vd. `UI-09`) vĩnh viễn không bind được, kể cả khi Point Catalog báo đúng `BOOL` | Compiler + Core + Product/Language design | Quyết định cách compiler biết per-channel mode thật (tin `entry.type` từ BE thay vì suy luận theo prefix, hay mở rộng `StPointKind`/artifact format) — ảnh hưởng tương thích ngược artifact, cần PM/CTO/Compiler owner chốt trước khi code |

## 6. Sai khác và mâu thuẫn ngay trong tài liệu thiết kế

| Chủ đề | Nội dung đang mâu thuẫn | Phán quyết tạm cho PR này |
|---|---|---|
| Owner của Check | `UX-WEB-PROG-001` UC-06 ghi bấm Check trên `PGM-03`, `PGM-02` chỉ có shortcut; source và một dòng FE page-to-code lại cho `PGM-02` tạo Check | **Đã giải quyết 2026-08-14 (Rev 1.3).** D-01 chốt đúng theo `UX-WEB-PROG-001`: `PGM-03` sở hữu seal/run/poll/result, `PGM-02` chỉ điều hướng — code đã khớp tài liệu, đóng `F-PROG-ASBUILT-004` |
| Project selector | Cây component UI/UX còn ghi `ProjectSelector`; capability Rev A giới hạn một Project/controller và Header source chủ đích không có selector | Đề nghị sửa docs thành static Project context; không tạo selector giả |
| Header/navigation | UI/UX ghi breadcrumb/project/help/refetch nhưng Header source chỉ có title/refresh; asset chưa thể hiện đầy đủ desktop workspace nav | UX Lead phải chốt asset + component map trước corrective UI |
| Problems | Thiết kế nói dùng chung/luôn truy cập; source chỉ mount khi diagnostics > 0 | Code phải có empty/loading/history state hoặc thiết kế phải sửa rõ; ưu tiên code vì acceptance cần recovery |
| Trạng thái triển khai | Một số đoạn FE Design còn mô tả 508/509 chưa deploy dù evidence sau đó đã deploy; cùng lúc audit mới chứng minh UC-03 vẫn sai | Khi sửa UC-03 phải đồng bộ As-Built, Plan, VVP, Trace, candidate trong một change |

## 7. Trạng thái 17 use case tại mốc báo cáo

Đây là đánh giá quản trị, không phải Test Result:

| Nhóm | UC | Trạng thái hiện tại |
|---|---|---|
| Có supporting live tương đối đầy đủ | `01`, `02`, `10`, `13` containment, `16` | Có hành vi/bằng chứng hỗ trợ; vẫn thiếu reviewer/Test Result độc lập |
| Defect trong phạm vi đã giao đóng, chờ Test Result độc lập | `03`, `06` | **Cập nhật 2026-08-14 (Rev 1.3)**: năm finding gãy vòng sửa/check (`F-PROG-ASBUILT-001/002/003/004`) đã sửa + có test/E2E (§9); UC-06 route ownership hết mâu thuẫn (D-01, §6). Vẫn **không** tự nâng Test Result — còn `F-PROG-ASBUILT-005/006/008/009` mở và chưa có reviewer độc lập |
| Có hiệu lực runtime cho `LOCAL`, còn hở `VP`/`UI`-dry | `05` | **Cập nhật 2026-08-14 (cùng ngày, sau khi D-07 triển khai)**: Ánh xạ biến tới Point category `LOCAL` nay có hiệu lực runtime thật, kiểm chứng target (§4.5); category `VP` bị từ chối tường minh thay vì âm thầm sai (`F-PROG-ASBUILT-014`), kênh `UI` cấu hình digital chưa bind được (`F-PROG-ASBUILT-015`) |
| Có surface nhưng chưa đủ target/fixture | `07`, `08`, `09`, `11`, `12`, `17` | Host/E2E hoặc read-only có; thiếu mutation/fault/binding/HIL/recommission phù hợp; `07` (desktop nav) nay có source+test (Rev 1.3) nhưng chưa có target/HIL riêng |
| Ngoài Rev A và ẩn đúng | `14`, `15` | Không phải gap Rev A |

Không dùng bảng này để cộng “% UC PASS”. Chỉ `TR-PROG-*` được Verification Lead
review mới được nâng cột Test Result.

## 8. Quyết định cần PM/CTO xác nhận

| Quyết định | Khuyến nghị kỹ thuật | Người quyết | Nếu chưa quyết |
|---|---|---|---|
| D-01 · Route nào sở hữu Check? | **ĐÃ TRIỂN KHAI 2026-08-14 (Rev 1.3).** `PGM-03` sở hữu seal/run/poll/result; `PGM-02` chỉ lưu rồi điều hướng với dirty guard | Product + CTO + UX | — |
| D-02 · Cho phép tạo Program ST rỗng? | **ĐÃ TRIỂN KHAI 2026-08-14 (Rev 1.3).** Không — template hợp lệ tối thiểu + chặn save rỗng; `uniqueProgramName()` (tên hiển thị) đã có sẵn từ trước | Product + Compiler + UX | — |
| D-03 · Phạm vi editor ST Rev A | Chốt bắt buộc: template, line/column, source range, find/format; autocomplete/highlight chỉ giữ nếu có acceptance/test rõ | Product + UX | FE làm dở nhiều công cụ nhưng không có gate đo được |
| D-04 · Desktop IA | **ĐÃ TRIỂN KHAI 2026-08-14 (Rev 1.3).** `ProgrammingDesktopNav` bốn workspace + active state (`aria-current`); giữ bottom nav mobile | UX + Product | — |
| D-05 · Ưu tiên delivery | Mở một task corrective vertical slice UC-03 trước Monitor/Trace polish hoặc tuyên bố P5 DONE | PM + Dev Lead | Lỗi cốt lõi tồn tại trong khi % tiến độ vẫn tăng |
| D-06 · Release | Giữ `NO-GO`, không phát hành thương mại cho tới 32/32 Test Result + HIL/residual acceptance | PM + CTO + Verification | Supporting evidence bị dùng sai thành release approval |
| D-07 · Cơ chế truyền Binding vào compiler (mới 2026-08-14) | **ĐÃ TRIỂN KHAI 2026-08-14 (cùng ngày)** theo đúng khuyến nghị: manifest binding riêng (`StIoMapEntry` JSON) qua CLI flag `--io-map-in`, không đụng cú pháp ST. Đóng cho category `LOCAL`; xem §4.5 bằng chứng target đầy đủ (Check/Commission/Runtime/Monitor thật) và §4.6 hai finding phụ phát sinh (`F-PROG-ASBUILT-014`/`015`, category `VP`/`UI`-dry, chưa nằm trong phạm vi D-07 gốc) | Product + CTO + Compiler + Core | — |

## 9. Kế hoạch corrective đề xuất sau khi PM duyệt

| Thứ tự | Lát cắt | Exit đo được | Trạng thái |
|---:|---|---|---|
| 1 | Reconcile UI/UX + FE Design cho owner `PGM-02/03`, template ST, Problems và desktop nav | Không còn câu mâu thuẫn; asset/component/API mapping cùng revision | **Đã đóng** — D-01/D-04 triển khai, §6 hết mâu thuẫn ownership |
| 2 | Tạo ST template + auto-select + unique identifier | Create→save→reload cho source hợp lệ; không Program rỗng | **Đã đóng** — F-001/D-02 |
| 3 | Sửa seal/check concurrency state | FAILED→edit→save→Check lại không 409; ETag/base read-back đúng | **Đã đóng** — F-002 |
| 4 | Nối diagnostic location end-to-end | Invalid token/type focus đúng program, line, column, length | **Đã đóng** — F-003 |
| 5 | Sửa recovery/error + layout/IA | 409 có dữ liệu hữu ích; offline save nhìn thấy; desktop ba cột/nav đúng asset | **Một phần** — desktop nav xong (D-04); `F-PROG-ASBUILT-005/006/008/009` còn mở, ngoài phạm vi đã giao Rev 1.3 |
| 6 | Vitest/Go/C++/Playwright + browser target | Positive/negative/fault; desktop/mobile; Console/Network; Active hash không đổi qua Check | **Đã đạt cho phần đã sửa** — §10.1; chưa phủ `F-005/006/008/009` (chưa sửa) |
| 7 | Candidate/trace/plan/evidence + PR merge | Pin/harness PASS; source merge; vẫn không nâng Test Result nếu chưa có reviewer | Đang thực hiện — xem commit/PR cùng phiên |

Ước lượng chỉ được lập sau D-01..D-05; record này không tự thêm task hay đổi ngân
sách của Plan 53 khi chưa có quyết định PM.

Kế hoạch bảy bước trên phạm vi UC-PROG-03; `F-PROG-ASBUILT-013` (binding →
compiler, D-07) là một lát cắt **khác**, **đã triển khai và đóng cho `LOCAL`
ngày 2026-08-14** (xem §4.5) — không còn chờ D-07 nữa. Hai finding phụ phát
sinh (`F-PROG-ASBUILT-014` VP, `F-PROG-ASBUILT-015` UI-dry, xem §4.6) vẫn là
lát cắt riêng, chưa có quyết định, không tự gộp vào bảy bước UC-PROG-03 ở
trên.

## 10. Gate và giới hạn bàn giao

- `PLAN_READY`: PASS; quyền implement vẫn mở.
- `IMPLEMENT_READY`: PASS; defect không cần approval bổ sung để code sau khi PM
  chốt owner UX ở D-01.
- P5: giữ `IN_PROGRESS 8/11`; không nâng 508/509/510 thành DONE chỉ vì PR được mở.
- `RELEASE_READY`: **BLOCKED / NO-GO**.
- Target/HIL: không có phép đo điện, IOP timing, power-cut hay HIL mới trong record này.
- Browser: ảnh 2026-08-14 là supporting evidence; Chrome DevTools MCP không có
  trong phiên, nên không tuyên bố DevTools PASS. Luồng dùng Chromium cô lập.
- PR: chứa snapshot source/docs hiện có và report; không tự triển khai artifact mới.

### 10.1 Gate chạy lại trước commit ngày 2026-08-14

| Gate | Lệnh/phạm vi | Kết quả |
|---|---|---|
| C++ | CMake Release; Modbus/BACnet/HMI `ON`; build + CTest | **1004/1004 PASS** |
| Go | `go vet ./...`; `go test ./... -count=1` | **PASS mọi package** |
| FE unit | Vitest `src`, jsdom | **64 file / 521 test PASS** |
| FE static/build | ESLint, TypeScript `--noEmit`, Vite production build | **PASS**; chỉ có cảnh báo kích thước chunk không chặn build |
| Contract | generated API/error/FBD checks | **25 operation**; **20 public/99 detail**; FBD mutation **10/10** |
| Browser E2E | Programming desktop/mobile + Network QA | **11/11 PASS**; request ngoài mock tới backend dev không chạy tạo log proxy dự kiến, không phải target evidence |
| Tài liệu | candidate pin + docs ISO harness `--expect` | **22/22 PASS**; link/anchor/whitespace/fence/ID/trace PASS |

Các gate trên chứng minh branch build/test được và khóa regression hiện có; chúng
**không phủ lỗi live UC-PROG-03 vừa tái hiện**, vì E2E hiện chưa mô phỏng đúng
chuỗi seal làm đổi ETag/base rồi Check FAILED → sửa → lưu lại. Do đó test xanh
không thay phán quyết NO-GO.

### 10.2 Gate chạy lại Rev 1.3 (2026-08-14, cùng ngày — sau khi đóng F-001/002/003/004/007, D-01/02/04)

| Gate | Lệnh/phạm vi | Kết quả |
|---|---|---|
| C++ | CMake Release; Modbus/BACnet/HMI `ON`; build + CTest | **1024/1024 PASS** |
| Go | `go vet ./...`; `go test ./... -count=1` | **PASS mọi package** |
| FE unit | Vitest `src`, jsdom | **571/571 PASS** |
| FE static/build | ESLint `--max-warnings=0`, TypeScript `--noEmit`, Vite production build, `check:programming-contracts` | **PASS** |
| Contract | generated API/error/FBD checks | **25 operation**; **20 public/100 detail**; FBD mutation **10/10** |
| Browser E2E | `e2e/programming.spec.ts`, desktop + mobile-chrome | **10/10 PASS** — bao gồm luồng D-01 mới (mở PGM-03 trống → Kiểm tra → tự điều hướng vào kết quả) |
| Target | Foxlinx thật, chuỗi HTTP đầy đủ Check→Commission→Runtime→Monitor cho `F-PROG-ASBUILT-013`/D-07 | Xem §4.5 — **không lặp lại ở đây** |

E2E này **có mô phỏng** đúng chuỗi seal→ETag đổi→Check→sửa→lưu lại (khác gate
Rev 1.0 ở trên) vì D-01 đã tách luồng seal/Check sang route riêng — nhưng vẫn
là supporting evidence, không phải Test Result độc lập. `RELEASE_READY` giữ
`BLOCKED` không đổi bởi gate xanh (xem §1 Rev 1.3).

## 11. Tài liệu/bằng chứng liên quan

- [Audit FE/UI/UX Programming](PROGRAMMING_FE_UX_IMPLEMENTATION_AUDIT_2026-08-13.md)
- [Evidence corrective Foxlinx](../test-evidence/fw-som/2026-08-13-foxlinx-programming-plan53-corrective.md)
- [Programming Implementation Plan](../../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md)
- [Programming UI/UX Design](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md)
- [Programming FE Design](../../02_design/software/PROGRAMMING_FE_DESIGN.md)
- [Programming Verification Plan](../../05_verification/PROGRAMMING_VERIFICATION_PLAN.md)
- [Programming Traceability Matrix](../PROGRAMMING_TRACEABILITY_MATRIX.md)
- [ST Subset Specification](../../02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md) — §10 EBNF xác nhận không có cú pháp binding trong ST source, liên quan `F-PROG-ASBUILT-013`/D-07.
- `CHANGELOG.md` mục `[Unreleased]` ngày 2026-08-14 (ba entry "Fixed" liên quan
  Mapping tab/Point Picker/safe-state message) — sửa được trong phạm vi FE,
  không phải phạm vi `F-PROG-ASBUILT-013`.

## 12. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-14 | Chốt As-Built đa lớp, tái hiện UC-PROG-03, mở 12 finding, bảng quyết định PM/CTO và giữ NO-GO release |
| 1.1 | 2026-08-14 | Bổ sung `F-PROG-ASBUILT-013` (Critical) — Variable↔Point Binding không được compiler tiêu thụ, phát hiện qua phiên hỗ trợ user trực tiếp trên board Foxlinx (Commission thành công nhiều lần nhưng `safeStateNoControllerOnly` không bao giờ về `false`); thêm §4 tái hiện kỹ thuật, quyết định D-07, hạ UC-05 xuống nhóm "Không đạt do defect hiện hành" |
| 1.2 | 2026-08-14 | PM/CTO duyệt D-07 làm authority implement (cùng ngày). Triển khai Binding Manifest cho category `LOCAL` (C++ `resolve_io_bindings`/`--io-map-in`, Go `ioMapFromRevision`/`compiler.Input.IoMap`) — đóng `F-PROG-ASBUILT-013` cho `LOCAL`; 1024/1024 CTest, Go mọi package, 559/559 Vitest; target thật trên Foxlinx: CLI aarch64 (positive + 2 negative) và chuỗi HTTP đầy đủ Check PASSED→Commission SUCCEEDED→Runtime `safeStateNoControllerOnly:false`→Monitor `programValue==actualValue` LIVE trên Program thật của user (§4.5). Mở hai finding phụ chưa sửa: `F-PROG-ASBUILT-014` (category `VP` không có runtime path thật) và `F-PROG-ASBUILT-015` (kênh `UI` cấu hình digital "dry" không bind được do `StPointKind`/`map_kind()` hardcode UI=analog) — §4.6 |
| 1.3 | 2026-08-14 | Tiếp tục Lệnh triển khai PM/CTO, phần UC-PROG-03 (cùng ngày). Đóng năm finding trong phạm vi đã giao: `F-PROG-ASBUILT-001`/`D-02` (template ST + chặn save rỗng), `002` (`syncAfterSeal` — hết 409 sau Check), `003` (diagnostic line/column xác nhận đã thông + test mới), `004`/`D-01` (PGM-03 sở hữu seal/run/poll/result, PGM-02 chỉ điều hướng — phát hiện và sửa luôn bug phụ `useProgrammingResource` không refetch khi định danh tài nguyên đổi giữa vòng đời), `007`/`D-04` (`ProgrammingDesktopNav`). Cập nhật §1/§5/§6/§7/§8/§9, thêm §10.2 gate Rev 1.3: 1024/1024 CTest, Go mọi package, 571/571 Vitest, 10/10 Playwright (`e2e/programming.spec.ts` cập nhật theo D-01). Còn mở: `F-PROG-ASBUILT-005/006/008/009`, `D-03/05/06`, §4.6 (`014`/`015`) — ngoài phạm vi đã giao phiên này |
