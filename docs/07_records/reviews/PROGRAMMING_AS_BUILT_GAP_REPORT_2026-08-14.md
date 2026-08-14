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

**Đề nghị PM/CTO:** chấp nhận PR này như snapshot As-Built + hồ sơ gap, **không
chấp nhận như feature hoàn tất**; ưu tiên một vertical slice UC-PROG-03 trước mọi
tuyên bố P5 DONE; giữ `RELEASE_READY = BLOCKED`. Với bổ sung 2026-08-14: **không
tuyên bố UC-05 (Ánh xạ biến tới Point) là tính năng hoạt động** cho tới khi
`F-PROG-ASBUILT-013` đóng — hiện tab Mapping chỉ là biên tập dữ liệu Draft,
không kết nối runtime thật.

## 2. Hiện trạng source đã triển khai

| Lớp | Thiết kế yêu cầu | As-Built source hiện tại | Kết luận |
|---|---|---|---|
| Contract | OpenAPI, error catalog, profile/artifact, IPC có phiên bản | OpenAPI Programming v1.20, client TypeScript sinh mã, IPC/Core contract, catalog lỗi và manifest join đã có | **Có implementation**; chưa phải release evidence |
| Compiler | ST Rev A + FBD về typed IR chung, source map, bounded sandbox | Parser/compiler ST, FBD canonical/lowerer, artifact/hash/source map, hostile corpus và fuzz đã có | **Có implementation host**; diagnostic live còn mất location ở UC-03; **Variable↔Point Binding không được truyền vào compiler — `io_bindings` luôn rỗng, xem `F-PROG-ASBUILT-013` §4** |
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

## 5. Bảng gap ưu tiên giao PM/CTO

| ID | Mức | Thiết kế/acceptance | As-Built/gap | Ảnh hưởng người dùng/rủi ro | Owner đề nghị | Điều kiện đóng |
|---|---|---|---|---|---|---|
| `F-PROG-ASBUILT-001` | **Critical** | UC-03 bước 1–3; ST Program phải sửa/lưu/check được | `ST+` tạo `document: ''`, không sinh template `PROGRAM/END_PROGRAM`; tên mặc định lặp | Program mới sai từ khi tạo; kỹ sư gặp lỗi không có hướng dẫn | FE + Compiler + UX | Template ST hợp lệ/unique; test create→reload→Check; source map đúng |
| `F-PROG-ASBUILT-002` | **Critical** | UC-03 bước 6; UX-REQ-020 không mất Draft/overwrite sau Check | Seal tăng ETag/base nhưng hook chỉ giữ `revisionId`; sửa sau Check FAILED bị 409 | Vòng sửa–kiểm tra bị gãy; người dùng phải reload thủ công | FE + BE | Đồng bộ canonical Project sau seal hoặc chuyển Check sang route reload state; test FAILED→edit→save→recheck |
| `F-PROG-ASBUILT-003` | **Critical** | VS-PROG-005/006: diagnostic đúng source range | Live chỉ hiện `PRG-ERR-SCOPE-001`, không dòng/cột cho token sai dòng 8 | Không biết sửa ở đâu; UC-03 không đạt | Compiler + BE + FE | Stable diagnostic có `programId/line/column/length`; Problems focus editor; target test |
| `F-PROG-ASBUILT-004` | **High** | UC-06: Check bắt đầu ở `PGM-03`; `PGM-02` có shortcut | Source chạy Check ở `PGM-02`; `PGM-03` không có ID chỉ hiện empty và yêu cầu Check đã PASS | Mental model/route ownership vòng tròn, deep-link không tự đủ | Product + UX + FE | CTO/Product chốt một owner; docs và code thống nhất; reload/poll/UNKNOWN test |
| `F-PROG-ASBUILT-005` | **High** | FE design §13: 409 hiện base/current/local diff | Server trả public conflict không có expected/actual; UI render `—` | Recovery mù, dễ tải lại nhầm và mất ngữ cảnh | BE + FE | Error envelope có field ổn định hoặc UI bỏ claim; two-client test + browser evidence |
| `F-PROG-ASBUILT-006` | **High** | UC-03 network loss giữ buffer và cho retry có thông báo | `useDraftWorkspace.error` được set khi save lỗi nhưng ready page không render lỗi save riêng | Người dùng bấm lưu nhưng không biết thất bại | FE | Alert/toast persistent có retry; offline/5xx test; buffer giữ nguyên |
| `F-PROG-ASBUILT-007` | **High** | UX-REQ-002; bốn workspace phải discoverable | Chỉ mobile có bottom nav; desktop chỉ thấy global “Lập trình”, không có Overview/Design/Check/Runtime nav/breadcrumb | Người dùng desktop phụ thuộc nút ngữ cảnh; khó quay lại Check/Runtime | UX + FE | Desktop workspace nav + active state + keyboard; asset/source cùng revision |
| `F-PROG-ASBUILT-008` | **Medium** | `PGM-02` desktop có Tree 280 + Editor + Inspector 308; Problems luôn truy cập được | Source grid hai cột; Inspector nằm dưới editor; Problems chỉ render khi có diagnostic | Sai hierarchy, tăng cuộn, trạng thái Problems biến mất | UX + FE | Grid ba cột ≥1440; collapse 1024–1439; empty Problems region; desktop/mobile visual test |
| `F-PROG-ASBUILT-009` | **Medium** | ST editor có autocomplete bounded/syntax feedback | Hiện có line/column/find/format/symbol, chưa có autocomplete/highlight rõ ràng | Trải nghiệm chưa đạt editor design; tăng lỗi nhập | UX + FE | Chốt phạm vi Rev A, implement hoặc sửa design/acceptance có phê duyệt |
| `F-PROG-ASBUILT-010` | **High** | UC-12 Monitor/Trace có program/actual/owner/priority/quality/freshness | Target active fixture không có binding; Monitor `items=0`, Trace positive chưa chạy | Không chứng minh dữ liệu thật xuyên Core→FE | QA + Core + BE + FE | Fixture binding read-only; start/get/stop và negative trace; raw evidence/reviewer |
| `F-PROG-ASBUILT-011` | **High** | UC-13 RETAIN reset có affected list, strong confirm, re-auth, operation read-back | FE đúng fail-closed nhưng route vẫn contract-only, action bị khóa | Capability chưa hoàn tất; không được quảng bá là đã có | Core + BE + FE + Safety | Contract impact thật + negative/fault/target evidence; không dùng Active ID giả |
| `F-PROG-ASBUILT-012` | **Critical gate** | Plan close: merge source, 32/32 Test Result, HIL/residual acceptance | Corrective chưa merge tại thời điểm audit; `0/32 PASS`; P6 chưa bắt đầu | Không có authority release/production acceptance | Dev Lead + Verification + QA + Release | PR review/merge; full gates tại commit; 32/32 reviewed PASS; HIL/power/fault/usability |
| `F-PROG-ASBUILT-013` | **Critical** | UC-05 Ánh xạ biến tới Point phải có hiệu lực runtime thật khi Program Active | `compiler.Input` (Go) chỉ chở mã nguồn; CLI `mkddc-st-compile` không có tham số nhận binding; `io_bindings` trong MỌI artifact compile qua pipeline này luôn rỗng — xem §4 | **Không Program Rev A nào từng điều khiển được AO/DO/VP thật**, bất kể Mapping cấu hình đúng; safe-state T7 (no_controller) không thể tự thoát qua Commission cho bất kỳ Program nào; rất có thể là nguyên nhân gốc của `F-PROG-ASBUILT-010` | Compiler + Core + Product/Language design | Chốt cơ chế truyền binding (mở rộng cú pháp ST kiểu `AT` **hoặc** manifest binding riêng qua CLI/IPC mới); nối end-to-end tới `SEC_IO_BINDING`; test chứng minh `resolver->set_ao/set_do` thật sự được gọi cho Program có Binding hợp lệ; target/board evidence Commission xong `safeStateNoControllerOnly=false` |

## 6. Sai khác và mâu thuẫn ngay trong tài liệu thiết kế

| Chủ đề | Nội dung đang mâu thuẫn | Phán quyết tạm cho PR này |
|---|---|---|
| Owner của Check | `UX-WEB-PROG-001` UC-06 ghi bấm Check trên `PGM-03`, `PGM-02` chỉ có shortcut; source và một dòng FE page-to-code lại cho `PGM-02` tạo Check | **Chưa tự chọn thay PM/Product.** Mở `F-PROG-ASBUILT-004`; không sửa code theo một nửa tài liệu |
| Project selector | Cây component UI/UX còn ghi `ProjectSelector`; capability Rev A giới hạn một Project/controller và Header source chủ đích không có selector | Đề nghị sửa docs thành static Project context; không tạo selector giả |
| Header/navigation | UI/UX ghi breadcrumb/project/help/refetch nhưng Header source chỉ có title/refresh; asset chưa thể hiện đầy đủ desktop workspace nav | UX Lead phải chốt asset + component map trước corrective UI |
| Problems | Thiết kế nói dùng chung/luôn truy cập; source chỉ mount khi diagnostics > 0 | Code phải có empty/loading/history state hoặc thiết kế phải sửa rõ; ưu tiên code vì acceptance cần recovery |
| Trạng thái triển khai | Một số đoạn FE Design còn mô tả 508/509 chưa deploy dù evidence sau đó đã deploy; cùng lúc audit mới chứng minh UC-03 vẫn sai | Khi sửa UC-03 phải đồng bộ As-Built, Plan, VVP, Trace, candidate trong một change |

## 7. Trạng thái 17 use case tại mốc báo cáo

Đây là đánh giá quản trị, không phải Test Result:

| Nhóm | UC | Trạng thái hiện tại |
|---|---|---|
| Có supporting live tương đối đầy đủ | `01`, `02`, `10`, `13` containment, `16` | Có hành vi/bằng chứng hỗ trợ; vẫn thiếu reviewer/Test Result độc lập |
| **Không đạt do defect hiện hành** | `03`, `05`, `06` | UC-03 gãy vòng sửa/check; UC-06 sai route ownership và phụ thuộc UC-03; **UC-05 mới hạ nhóm 2026-08-14**: Ánh xạ biến tới Point chỉ có hiệu lực trên Draft, không có hiệu lực runtime (`F-PROG-ASBUILT-013`) |
| Có surface nhưng chưa đủ target/fixture | `04`, `07`, `08`, `09`, `11`, `12`, `17` | Host/E2E hoặc read-only có; thiếu mutation/fault/binding/HIL/recommission phù hợp |
| Ngoài Rev A và ẩn đúng | `14`, `15` | Không phải gap Rev A |

Không dùng bảng này để cộng “% UC PASS”. Chỉ `TR-PROG-*` được Verification Lead
review mới được nâng cột Test Result.

## 8. Quyết định cần PM/CTO xác nhận

| Quyết định | Khuyến nghị kỹ thuật | Người quyết | Nếu chưa quyết |
|---|---|---|---|
| D-01 · Route nào sở hữu Check? | `PGM-03` sở hữu seal/run/poll/result; `PGM-02` chỉ lưu rồi điều hướng với dirty guard | Product + CTO + UX | Code/docs tiếp tục drift; deep-link khó đúng |
| D-02 · Cho phép tạo Program ST rỗng? | **Không.** Sinh template hợp lệ tối thiểu và tên identifier unique; empty state phải có action rõ | Product + Compiler + UX | Mọi Program mới khởi đầu ở trạng thái lỗi |
| D-03 · Phạm vi editor ST Rev A | Chốt bắt buộc: template, line/column, source range, find/format; autocomplete/highlight chỉ giữ nếu có acceptance/test rõ | Product + UX | FE làm dở nhiều công cụ nhưng không có gate đo được |
| D-04 · Desktop IA | Bổ sung nav bốn workspace + active state; giữ bottom nav mobile | UX + Product | Bốn workspace tồn tại về route nhưng không discoverable |
| D-05 · Ưu tiên delivery | Mở một task corrective vertical slice UC-03 trước Monitor/Trace polish hoặc tuyên bố P5 DONE | PM + Dev Lead | Lỗi cốt lõi tồn tại trong khi % tiến độ vẫn tăng |
| D-06 · Release | Giữ `NO-GO`, không phát hành thương mại cho tới 32/32 Test Result + HIL/residual acceptance | PM + CTO + Verification | Supporting evidence bị dùng sai thành release approval |
| D-07 · Cơ chế truyền Binding vào compiler (mới 2026-08-14) | Khuyến nghị kỹ thuật: **manifest binding riêng** (JSON, danh sách `slot/pointKind/pointIndex/direction/type` theo `variableId`) truyền qua CLI compiler bằng flag mới (vd. `--bindings-in`) hoặc kênh IPC riêng — **không** mở rộng cú pháp ST bằng mệnh đề `AT`, vì Rev A cố tình tách "logic" (ST) khỏi "vật lý" (Mapping tab) theo đúng tinh thần UC-05/thiết kế hiện có; đây là khuyến nghị kỹ thuật, phương án cuối do PM/CTO/Compiler owner chốt | Product + CTO + Compiler + Core | UC-05 tiếp tục là tính năng "chỉ có giao diện", không Program nào điều khiển được I/O thật; mọi Commission đều mắc kẹt ở `safeStateNoControllerOnly=true` |

## 9. Kế hoạch corrective đề xuất sau khi PM duyệt

| Thứ tự | Lát cắt | Exit đo được |
|---:|---|---|
| 1 | Reconcile UI/UX + FE Design cho owner `PGM-02/03`, template ST, Problems và desktop nav | Không còn câu mâu thuẫn; asset/component/API mapping cùng revision |
| 2 | Tạo ST template + auto-select + unique identifier | Create→save→reload cho source hợp lệ; không Program rỗng |
| 3 | Sửa seal/check concurrency state | FAILED→edit→save→Check lại không 409; ETag/base read-back đúng |
| 4 | Nối diagnostic location end-to-end | Invalid token/type focus đúng program, line, column, length |
| 5 | Sửa recovery/error + layout/IA | 409 có dữ liệu hữu ích; offline save nhìn thấy; desktop ba cột/nav đúng asset |
| 6 | Vitest/Go/C++/Playwright + browser target | Positive/negative/fault; desktop/mobile; Console/Network; Active hash không đổi qua Check |
| 7 | Candidate/trace/plan/evidence + PR merge | Pin/harness PASS; source merge; vẫn không nâng Test Result nếu chưa có reviewer |

Ước lượng chỉ được lập sau D-01..D-05; record này không tự thêm task hay đổi ngân
sách của Plan 53 khi chưa có quyết định PM.

Kế hoạch bảy bước trên phạm vi UC-PROG-03; `F-PROG-ASBUILT-013` (binding →
compiler, D-07) là một lát cắt **khác**, chưa đưa vào bảy bước này vì còn chờ
chọn cơ chế ở D-07 — record này không tự giả định phương án rồi lập task.

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
