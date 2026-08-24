# Rà soát kiến trúc và kế hoạch triển khai lại PGM-02 ST/FBD

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PGM02-ST-FBD-REDESIGN-REVIEW-001` |
| Phiên bản | 1.3 |
| Trạng thái | **Supporting record — Owner approved change request; `T59-801`/`PGM02-V22-WP-00` REVIEW; Architect exact pin PENDING** |
| Ngày rà soát | 2026-08-24 |
| Phạm vi | PGM-02 Programs, ST Editor, FBD Editor, Quick Library, EDIT/SIMULATE/LIVE |
| Mốc mã nguồn | `3d2db5d88912bf927475e8f1ef8ca70a9df4afc4` (`main`) |
| Người rà soát | Agent Leader — đối chiếu FE, BE, Core/runtime và browser host |
| Người duyệt | Product Owner/CTO — đã duyệt hướng thay đổi; System Architect — `PENDING` review/pin baseline |
| Tài liệu triển khai kèm theo | [PGM02_ST_FBD_IMPLEMENTATION_PLAN.md](PGM02_ST_FBD_IMPLEMENTATION_PLAN.md) |
| Change request chủ quản | [`CR-PROG-PGM02-V22-001`](../../../00_governance/PROGRAMMING_OPEN_DECISIONS.md) |
| Task thực thi duy nhất đang mở | [`T59-801`](../../../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) — reconciliation only |
| Quyền thực thi | Plan59 vẫn là tracker duy nhất; `T59-801` đang `REVIEW` gói Candidate đã tạo, chưa mở task downstream hay code production |
| Gate hiện hành | Owner disposition: **APPROVED**; Architect baseline review/pin: **PENDING**; `T59-801`: **REVIEW**; R1/R2/R3 code: **NO-GO**; `RELEASE_READY`: **NO-GO** |

> Phân loại bằng chứng: kết quả browser/build/test trong hồ sơ này là **HOST**.
> Không có bằng chứng board/HIL/physical I/O/timing/power-loss mới và không được
> dùng hồ sơ này để tuyên bố target hay release PASS.

Tên `WP-00..WP-13` trong supporting record này là alias đọc ngắn. Khi đưa vào
hồ sơ kiểm soát, trace, risk, task hay evidence phải dùng namespace canonical
`PGM02-V22-WP-00..PGM02-V22-WP-13`; alias không tự tạo execution authority.

## 1. Executive Summary

### 1.1 Kết luận kiến trúc — 12 dòng

1. Giữ một path sản phẩm `/eng/programming/programs`; `?project=<uuid>` mang context legacy/multi-project, route có `projectId` chỉ redirect tương thích.
2. Dùng một `ProgramsWorkspaceShell` và đúng một `PouExplorer` đọc Draft/Revision v2.
3. Tách tuyệt đối `DraftDocument`, `ActiveRevisionDocument` và từng nguồn runtime value.
4. EDIT chỉ ghi Draft; Save, Check, Commission và Running tiếp tục là các chuyển trạng thái riêng.
5. Giữ pipeline Draft/ETag/read-back; không viết lại store hay mutation contract chỉ để tiện FE.
6. Giữ FBD canonical model, typed ports, port `order`, validator và command history; chỉ mở rộng geometry/commands.
7. Redesign renderer FBD thành node–edge canvas; canonical FBD document vẫn là domain authority.
8. Redesign bề mặt ST theo transaction editor; compiler/check vẫn là semantic authority.
9. Quick Library dùng cùng catalog SYSTEM/PROJECT với Control Library; Recent/Favorites chỉ là preference/view.
10. LIVE tải sealed Active source trước, khóa read-only, rồi mới join runtime snapshot cùng revision/artifact/snapshot ID.
11. SIMULATE dùng worker sandbox riêng, saved Draft snapshot và virtual point image; không nối production output path.
12. EDIT/LIVE và SIMULATE là các lane độc lập; thiếu simulation không chặn redesign nhưng nút phải capability-gated.

### 1.2 Quyết định theo vùng

| Area | Current | Target | Decision |
|---|---|---|---|
| Route và Programming shell | `/eng/programming/projects/:projectId/programs`; Programs nằm trong workspace 3 tab | Một primary route và shell PGM-02 riêng | **REFACTOR** |
| POU Tree | Hai cây cùng xuất hiện, dùng hai identity path | Một cây PROGRAM/FUNCTION/FUNCTION_BLOCK | **REFACTOR** |
| Draft/save | GET/PATCH, ETag, `If-Match`, batch atomic, conflict/read-back | Giữ nguyên semantics | **KEEP** |
| ST editor engine | `textarea` + `pre` overlay; có tokenizer/history/find/format | Editor transaction, diagnostics/hover/completion/ref chuẩn | **REDESIGN surface; KEEP/ADAPT utilities** |
| FBD model/commands | Canonical networks/nodes/ports/wires, typed connect, bounded undo | Thêm layout/multiselect/atomic insert-connect | **KEEP/EXTEND** |
| FBD renderer | Grid thẻ; wire là nút text ID | Canvas node–edge có pan/zoom/grid/snap/minimap | **REDESIGN** |
| Quick Library | Chưa có; palette FBD là `<select>` | Dock dùng catalog chung với PGM-04 | **NEW** |
| Bottom Workbench | Watch/Trace ở PGM-06; Problems ở PGM-05 | Problems/Watch/Trace/Search/Cross Reference dùng chung | **NEW/REFACTOR** |
| LIVE | Active values hiện có thể đứng cạnh Draft source | Active sealed source/topology, read-only, coherent join | **REFACTOR + P0 Core/BE** |
| SIMULATE | Không có product runtime/session/capability | Saved Draft sandbox, virtual I/O, run/pause/step/reset/speed | **NEW — BLOCKED BY BE/FW-SOM** |
| Responsive | Mobile vẫn có thao tác sửa; desktop là grid cố định | ≥1280 full, 1024–1279 compact, <1024 drawer, <768 read-only | **REDESIGN** |
| Runtime value performance | Chưa có FBD overlay layer/benchmark | Topology tách keyed value store, render throttled | **NEW/PERFORMANCE GATE** |

### 1.3 Kết luận trạng thái

- **Có thể giữ và phát triển:** Draft/ETag/save, generated API base, FBD domain và
  reducer, registry sinh tự động, mapping type rules, trình bày `invalid/stale/
  unavailable` không thành số 0.
- **Chưa được claim:** workspace v2.2, true FBD canvas, Quick Library, semantic
  cross-reference, coherent LIVE, arbitrary Watch, production Simulation.
- **P0 phải đóng trước LIVE/Trace:** join runtime–revision khi Commission,
  data race của Core trace, truth semantics của Commission/Trace.
- **Không big-bang rewrite:** dựng shell/adapters quanh domain hiện có, chuyển ST
  và FBD theo vertical slice, xóa legacy chỉ sau parity gate.

### 1.4 Classification tổng hợp

| Classification | Thành phần |
|---|---|
| **KEEP** | Draft/ETag/`If-Match`/atomic save/read-back; immutable Revision; FBD canonical model/validator/reducer/port `order`; generated registry; compiler typed IR chung ST/FBD; null/quality/stale presentation; theme/focus utilities |
| **REFACTOR** | Route compatibility, Programming context/shell, một POU Explorer, identity adapters, Inspector, Mapping interface adapter, shared Library/Watch/Trace panels, Active document/value join |
| **REDESIGN** | ST presentation surface, FBD renderer/controller thành true canvas, right dock/workbench responsive layout |
| **NEW** | Mode state machine, Quick Library + insertion transactions, Bottom Workbench, semantic reference index, FBD geometry/runtime layer, simulation capability/session/worker/virtual images |
| **BLOCKED BY BE** | Capability contract; public SYSTEM signature/category/ports; exact cross-reference/diagnostics; typed Draft↔Active ST/FBD diff; coherent runtime identity; Trace/Commission truth fixes; simulation session/API/quota/audit |
| **BLOCKED BY FW-SOM** | Trace concurrency/revision pin; internal symbol/FBD port observation identity; missing target block compiler/runtime support; isolated artifact executor, virtual point/process image và virtual clock |

## 2. Current Architecture

### 2.1 Luồng hiện tại

```text
Browser / React
  ProgrammingRoutes
    -> DesignWorkspacePage (Programs + Mapping + Execution cùng mount)
       -> PouTree(raw Draft v2 objects)             [cây 1]
       -> ProgramsTab(compat document.programs)     [cây 2]
          -> SourceEditor(textarea/pre)
          -> StructuredFbdEditor(card list)
          -> Inspector
       -> runtimeOverlayByProgramId(Draft programs + Active monitor)
              |
              v
generated client -> mkddc-web REST
  Project/Draft/Revision/Check/Library/Runtime/Monitor/Trace
  SQLite + compiler worker sandbox
              |
              v
Programming IPC -> mkddc-core
  Active/LKG lifecycle -> ST/FBD typed IR executor -> scheduler
  Point snapshot / signal bus / candidate registry / trace ring
              |
              v
resolver -> iobus -> STM32 -> physical output
```

### 2.2 Ownership thực tế

| Dữ liệu | Writer authority | Reader hiện tại | Đánh giá |
|---|---|---|---|
| Draft/POU/library project | `mkddc-web` transaction | FE/compiler | **KEEP** |
| Immutable Revision/source/topology | `mkddc-web` | FE/Core/Ops | Có API đọc; FE PGM-02 chưa dùng cho LIVE |
| Active/LKG và lifecycle | Core | BE/FE | Authority đúng nhưng join monitor chưa coherent trong transition |
| Runtime variables/points | Core snapshot + point authority | BE monitor/FE | Bound-variable only; thiếu arbitrary local/FB port |
| FBD topology | Draft/Revision FBD JSON | FE/compiler | Canonical tốt; chưa có geometry/layout |
| Trace ring | Core | BE/FE | Có nhưng concurrency/revision semantics chưa an toàn |
| Simulation session | Không có | Không có | **MISSING** |

### 2.3 Ma trận 21 capability BE hiện hành

Ma trận này chỉ đánh giá backend, không dùng thiếu hụt FE để hạ status BE. Tổng:
`5 IMPLEMENTED`, `12 PARTIAL`, `4 MISSING`, `0 UNKNOWN`. Các path rút gọn
`application/`, `domain/`, `compiler/`, `transport/` và `store/` trong bảng đều
nằm dưới `apps/web-api/internal/programming/`.

| # | BE capability | State | File/path + symbol/type | Endpoint hiện có | OpenAPI schema | Giới hạn chính |
|---:|---|---|---|---|---|---|
| 1 | Program CRUD | **PARTIAL** | `apps/web-api/internal/programming/application/draft_v2.go` — `applyDraftOperationV2`, `upsertProgramCompat`, `removeCollectionItem`; `application/programs.go` — `RuntimeService.ListPrograms`, `ProgramsPageView` | `GET /api/v1/programming/projects/{projectId}`; `PATCH .../{projectId}/draft`; `GET .../{projectId}/programs` | `ProgrammingProject`, `ProgrammingDraftMutationRequest`, `ProgrammingMutationResponse`, `ProgrammingProgramsPage` | CRUD definition nằm trong generic Draft operation; `/programs` là runtime intent/read-back, chưa là typed Program resource/detail CRUD |
| 2 | POU | **PARTIAL** | `application/draft_v2.go` — `pouObjectPayload`, `upsertPouObject`, `removePouObject`, `renamePouObject`, `duplicatePouObject` | `GET /api/v1/programming/projects/{projectId}`; `PATCH .../{projectId}/draft` | `ProgrammingProject`, `ProgrammingDraftMutationRequest`, `ProgrammingResource` | Có PROGRAM/FUNCTION/FUNCTION_BLOCK, ST/FBD, interface/locals/dependencies; chưa typed POU list/detail/reference API/schema riêng |
| 3 | Draft | **IMPLEMENTED** | `application/projects.go` — `ProjectView`, `CreateProject`, `GetProject`, `SaveDraft`; `application/draft.go` — `applyDraftOperations`, `DraftOperationError` | `POST/GET /api/v1/programming/projects...`; `PATCH .../{projectId}/draft` | `ProgrammingCreateProjectRequest`, `ProgrammingProject`, `ProgrammingDraftMutationRequest`, `ProgrammingMutationResponse` | ETag/`If-Match`, idempotency, all-or-nothing validation/read-back có thật |
| 4 | Revision | **IMPLEMENTED** | `application/projects.go` — `SealRevision`, `GetRevision`, `RevisionView`; `store/migrations/0001_programming_v1.sql` — immutable triggers | `POST .../projects/{projectId}/draft/revisions`; `GET .../revisions/{revisionId}` | `ProgrammingCreateRevisionRequest`, `ProgrammingMutationResponse`, `ProgrammingRevision` | Immutable snapshot/object/hash và retrieval có thật |
| 5 | Active Revision | **IMPLEMENTED** | `application/runtime.go` — `RuntimeService.GetRuntime`, `RuntimeView`; `application/projects.go` — `resolveActiveRevision`, `applyRevisionLabels` | `GET /api/v1/programming/runtime`; `GET .../projects/{projectId}` | `ProgrammingRuntime`, `ProgrammingProject` | Active ID lấy từ Core STATUS; chưa đồng nghĩa monitor join đã coherent trong transition |
| 6 | Check | **IMPLEMENTED** | `application/checks.go` — `CheckService.RequestCheck`, `ProcessNext`, `GetCheck`, `CheckView`; `compiler/runner.go` — `ProcessRunner.Compile`, `Result` | `POST .../revisions/{revisionId}/checks`; `GET .../checks/{checkId}` | `ProgrammingCheckRequest`, `ProgrammingCheckAccepted`, `ProgrammingCheck`, `ProgrammingArtifact` | Queue/worker compile ST/FBD + artifact/polling có thật; không phải target proof |
| 7 | Diagnostics | **PARTIAL** | `compiler/runner.go` — `Diagnostic{SourceID,Line,Column,Length}`; `application/checks.go` — `DiagnosticView`, `compilerDiagnostic` | `GET /api/v1/programming/checks/{checkId}` | `ProgrammingCheck`, `ProgrammingDiagnostic` | ST location có; FBD chưa typed `nodeId/portId/edgeId`, location còn generic resource |
| 8 | Library metadata | **PARTIAL** | `domain/library.go` — `LibraryEntry`, `LibraryEntryDefinition`; `application/library.go` — `LibraryEntryView`, `SearchLibraries`, `libraryEntryView`; `transport/http/library.go` — `libraryEntryResponse` | `GET /api/v1/programming/libraries` | `ProgrammingLibraryEntry`, `ProgrammingLibraryPage` | Public projection chưa xuất SYSTEM category/label/dispatch/typed ports nằm trong canonical signature |
| 9 | Function/FB signature | **PARTIAL** | `domain/library.go` — `SignatureJSON`, `InterfaceJSON`; `application/library.go` — `LibraryEntryView.InterfaceJSON`; `transport/http/library.go` — `toLibraryEntryResponse` | `GET /api/v1/programming/libraries` | `ProgrammingLibraryEntry.interface` | PROJECT interface tới client; SYSTEM `SignatureJSON` không được project ra public schema |
| 10 | References | **MISSING** | `compiler/runner.go` — `cliResponse.Symbols` được decode nhưng `Result` không giữ; không store/service/reference type | — | — | Không persist symbol/reference index và không find-references API |
| 11 | Mapping | **PARTIAL** | `application/draft_v2.go` — `upsertBindingCompat`, `upsertBindingV2`; `application/pointcatalog.go` — `PointCatalogEntry`, `ListPointCatalog`; `application/checks.go` — `IoMapEntry` | `PATCH .../projects/{projectId}/draft`; `GET /api/v1/programming/point-catalog` | `ProgrammingDraftMutationRequest`, `ProgrammingResourcePage` | Có Binding/Point Catalog/Check validation; chưa typed Mapping resource/preview API |
| 12 | Runtime values | **PARTIAL** | `application/monitor.go` — `MonitorSnapshotProvider`, `GetMonitor`, `MonitorSampleView`; `application/runtime.go` — `GetSignals`; `application/programs.go` — `ListPrograms` | `GET .../runtime/monitor`; `GET .../runtime/signals`; `GET .../projects/{projectId}/programs` | `ProgrammingMonitorPage`, `ProgrammingRuntimeSignalPage`, `ProgrammingProgramsPage` | Point-bound values/signals/metrics có null+quality; thiếu local/internal POU values và coherent revision tuple |
| 13 | Watch | **PARTIAL** | `application/monitor.go` — `GetMonitor`, `MonitorPageView`; `application/trace.go` chỉ nhận variable IDs có trong Monitor | surrogate `GET /api/v1/programming/runtime/monitor`; không `/watch` | `ProgrammingMonitorPage`; không Watch schema | Chưa watch session/list/add/remove/persist/revision pin/arbitrary symbol |
| 14 | Trace | **PARTIAL** | `application/trace.go` — `TraceRequest`, `TraceView`, `CreateTrace`, `GetTrace`, `StopTrace`, `runtimeTraceStore` | `POST /api/v1/programming/runtime/traces`; `GET/DELETE .../traces/{traceId}` | `ProgrammingTraceRequest`, `ProgrammingTraceAccepted`, `ProgrammingTrace`, `ProgrammingTraceSample`, `ProgrammingTraceValue` | Session RAM, Monitor-only variables; fallback poll; bỏ Core timestamp và gán Actual=Program candidate |
| 15 | Simulation | **MISSING** | Không symbol/service Programming simulation trong `apps/web-api/internal/programming` | — | — | Route simulate của domain khác không phải ST/FBD sandbox |
| 16 | Simulation session | **MISSING** | Không session state/service/store/handler Programming simulation | — | — | Không prepare/run/pause/step/reset/stop/TTL/ownership/audit |
| 17 | Virtual inputs | **MISSING** | Không Programming virtual-input allowlist/type/service; VP hiện là production Point path | — | — | Không set/read sandbox input, deny/audit semantics hay session image |
| 18 | Active source retrieval | **IMPLEMENTED** | `application/runtime.go` — `GetRuntime`; `application/projects.go` — `GetRevision` immutable manifest/objects | composite `GET /runtime` → `GET /revisions/{activeRevisionId}` | `ProgrammingRuntime`, `ProgrammingRevision` | Composite đủ lấy sealed Active source; FE chưa dùng và monitor identity vẫn partial |
| 19 | Compare | **PARTIAL** | `application/changes.go` — `GetRevisionChanges`, `RevisionChangesView`, `compareRevisionObjects`, `enabledProgramsTouched` | `GET /api/v1/programming/revisions/{from}/changes/{to}` | `ProgrammingRevisionChanges`, `ProgrammingRevisionChange`, `ProgrammingImpact` | Revision↔Revision object/hash/category only; chưa Draft↔Active/ST hunks/FBD diff; có nhánh nuốt runtime-intent store error |
| 20 | Commission state | **PARTIAL** | `application/operations.go` — `Commission`, `Restore`, `GetOperation`, `ProcessNext`, `reconcile`, `OperationView`; migrations `0001`, `0005` | `POST .../operations/commission`; `POST .../restore`; `GET .../operations[/{operationId}]` | `ProgrammingCommissionRequest`, `ProgrammingRestoreRequest`, `ProgrammingOperationAccepted`, `ProgrammingOperation` | Durable coordinator có; UNKNOWN nil bị view thành `keepsRunning=true`, schema có `ROLLED_BACK` nhưng service không emit đúng |
| 21 | Capabilities | **PARTIAL** | `application/runtime.go` — `CapabilitiesView`, `CapabilitiesLimits`, `GetCapabilities`; `domain/profile_generated.go` — `MaxTasks=3`, `AllowedPeriodMs` | `GET /api/v1/programming/capabilities` | `ProgrammingCapabilities` | Có profile/language/type/period/limits; hard-code `tasks=1`, thiếu simulation/watch/trace/active-source feature negotiation |

### 2.4 Đo browser/source đang chạy ngày 2026-08-24

| Check | Kết quả HOST mới |
|---|---|
| Stack | Build `mkddc-programming-core-sim`, compiler/package tools và chạy `mkddc-web` + Vite local |
| Core targeted tests | Rebuild rồi chạy 119 test thuộc 10 suite lifecycle/atomicity/IPC/Trace/FBD/artifact/integration: **119/119 PASS** |
| BE/source gates | Programming Go packages, generated-client 33 operations, registry 40 entries/3 languages, profile 3/3, G1 10/10 và FBD/IPC/error-catalog gates: **PASS** |
| FE unit/build | Không chạy lại toàn bộ trong review này; không dùng số đếm tĩnh làm PASS |
| Auth/API | JWT login `200`; tạo Project `201`; GET Project/Programs/Monitor/Capabilities `200`; Draft PATCH `200` |
| Console/Network | Phiên đo sạch có `0` console error; các request Programming quan sát đều `2xx` |
| Viewport | Đã đo đủ 1920×1080, 1440×900, 1280×800, 1024×768 và 390×844 |
| Quan sát chung | Hai cây POU đồng thời; ST là textarea overlay; FBD là thẻ + wire ID; 390 px vẫn có Add/Delete/Save/Edit |
| Capability body | Chỉ profile/language/type/limits; không có simulation/step/virtual-time/trace feature flags |
| Monitor body | `activeRevisionId:null`, `items:[]` khi chưa Commission; không bịa số 0 |
| Giới hạn bằng chứng | Host simulator tự khai không phải target/HIL và không có physical I/O authority |

Ma trận responsive As-Is lấy từ đúng route có một ST và một FBD trong Draft:

| Viewport | Quan sát định lượng/hành vi | Kết luận As-Is |
|---|---|---|
| 1920×1080 | Không overflow ngang; inner tree `280 px`, FBD editor `1022 px`, Inspector `308 px`; outer POU tree vẫn chiếm thêm một hàng | Dùng được nhưng hierarchy trùng |
| 1440×900 | Hai cây, editor và Inspector cùng hiện; không có Quick Library/workbench | Chưa đạt target bốn vùng |
| 1280×800 | Không overflow ngang nhưng FBD editor chỉ còn `382 px`; inner tree `280 px`, Inspector `308 px`; outer POU tree nằm hàng riêng và trang phải cuộn dọc | Không đạt target right dock/compact canvas |
| 1024×768 | Hai POU projection và thao tác edit vẫn đồng thời hiện, mật độ cao | Cần drawer/collapsible |
| 390×844 | Nội dung xếp dọc; admin vẫn thấy thao tác tạo/xóa/lưu/sửa ST/FBD | Vi phạm target `<768 = READ ONLY` |

Audit trail có thể chạy lại:

```bash
PROGRAMMING_REAL_BUILD_DIR=/home/chuong/Desktop/DDC-PROJECT/build/programming-real-review \
PROGRAMMING_REAL_BACKEND_PORT=4181 ./scripts/run_programming_real_e2e_stack.sh

cd apps/web-ui
VITE_DDC_MODE=live VITE_AUTH_MODE=jwt VITE_PROGRAMMING_REV_A=1 \
VITE_E2E_NO_WATCH=1 VITE_PROXY_TARGET=http://127.0.0.1:4181 \
npm run dev -- --port 4175 --strictPort

bash /home/chuong/.codex/skills/playwright/scripts/playwright_cli.sh \
  -s=pgm02-clean open http://127.0.0.1:4175/eng/programming/projects/<id>/programs
# Sau JWT login: resize 1920 1080; resize 1280 800; snapshot;
# run-code đo boundingBox; console error; requests; response-body.
```

Tool versions: Node `v24.18.1`, npm `11.16.0`, Playwright `1.61.1`, Vite
`8.2.0`. Raw browser snapshot/log của lượt đo bổ sung được giữ ngoài worktree tại
`/tmp/pgm02-browser-evidence.mhQ1Gp/playwright-cli`; bảng trên là record có kiểm
soát. Không đưa credential/JWT/cookie vào hồ sơ. Capability response đo được:
`languages=[ST,FBD]`, `taskPeriodsMs=[1000,5000,30000]`, `limits.tasks=1`; Monitor
response là `activeRevisionId=null`, `task=null`, `items=[]`.

Core test audit trail tại HEAD đã ghim:

```bash
cmake --build build/fw --parallel --target core_tests
build/fw/core/core_tests \
  --gtest_filter='ProgrammingStageAtomicity.*:ProgrammingRuntimeCoordinator.*:ProgrammingPackageLifecycle.*:ProgrammingPackageV2Stage.*:ProgramIpcServer.*:StValueTrace.*:StFbdCompile.*:StFbdUserPou.*:StArtifactManifest.*:StIntegration.*' \
  --gtest_brief=1
```

Kết quả `119/119 PASS` trong `2585 ms`; CMake `3.28.3`, GCC/G++ `13.3.0`,
GNU Make `4.3`, build `Release` với Modbus/BACnet/HMI đều `ON`. Đây vẫn chỉ là
HOST gate, không phải sanitizer/target/HIL.

Chrome DevTools MCP được cấu hình nhưng browser headful không khởi động vì phiên
không có X server. Luồng thay thế dùng Playwright headless với stack local cô lập;
vì vậy không claim đã kiểm bằng Chrome DevTools.

### 2.5 Source set đã đối chiếu

- Target: `README_FE_HANDOFF.md`, `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md`,
  `PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md`,
  `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md` và visual kết hợp hiện hữu.
- Target bị thiếu: `PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md` và ba asset
  riêng mà các file trên dẫn chiếu; không tự suy diễn nội dung file thiếu.
- Authority hiện hành: Programming Product Spec v3.0, SRS, Programming
  Architecture, Unified Product Detailed Design, Programming Interface Spec,
  Programming FE Design và `UX-WEB-PROG-001`.
- Không tìm thấy hồ sơ tên `BUSINESS_CORE_SPEC`; runtime ownership được đối
  chiếu từ Architecture/Unified DDD và source Core hiện hành.
- Source: `apps/web-ui/src/features/programming/`,
  `apps/web-api/internal/programming/`, `apps/core/application/{programming,st,runtime}/`,
  OpenAPI/IPC/profile/library registry và test liên quan.

## 3. As-Is Screens / Components

### 3.1 Bố cục thực tế

```text
ProgrammingLayout / ContextStrip
  DesignWorkspacePage
    [Programs | Points & Mapping | Execution] [Check]
    +-- PouTree: Programs / Functions / Function Blocks       <- projection 1
    +-- ProgramsTab
        +-- Application tree: Programs only                   <- projection 2
        +-- ST SourceEditor hoặc FBD StructuredFbdEditor
        +-- Inspector
```

Visual target duy nhất hiện hữu trong package là
[ảnh ST/FBD kết hợp](<../assets/ChatGPT Image 09_56_53 24 thg 8, 2026.png>).
Ba tên asset mà các handoff v2.2 dẫn chiếu không tồn tại.

### 3.2 Component ownership và disposition

| Component/source | As-Is | Vấn đề | Disposition |
|---|---|---|---|
| `ProgrammingRoutes.tsx` | Route có `projectId` | Khác route target | Alias/redirect tương thích; primary route mới |
| `DesignWorkspacePage.tsx:124-195` | Draft adapter + monitor poll | Ghép hai context ở page Draft | Tách Programs page/mode store |
| `DesignWorkspacePage.tsx:280-305` | Outer POU tree + ProgramsTab | Hai cây; diagnostics rỗng | Giữ một explorer, nối workbench |
| `PouTree.tsx` | Đọc raw `objects[]`, đủ ba kind | CRUD/rename/search chưa đủ | Nâng thành `PouExplorer` authority |
| `ProgramsTab.tsx:344-510` | Grid `280/1fr/308`, inner tree | Trùng cây, mobile stack, Programs-only | Phân rã và loại inner tree sau parity |
| `SourceEditor` | Gutter, highlight, history, completion, find/format | Không semantic model; overlay dạng list | Thay surface, giữ/adapt pure utilities |
| `StructuredFbdEditor.tsx:646-726` | Network article + node card list | Không canvas/geometry/wire | Renderer/controller mới |
| `fbd/model.ts` | Canonical typed model/validator | Thiếu presentation layout | Extend schema versioned |
| `fbd/commands.ts` | Domain reducer + history | Move là execution order, chưa spatial | Thêm geometry/multiselect/atomic command |
| `fbd/palette.ts` | Generated SYSTEM registry + Project POU | UI select, metadata chưa đồng nhất PGM-04 | Shared catalog adapter |
| `StRuntimeValueOverlay.tsx` | Giữ null/quality/stale đúng | Được mount dưới Draft editor | Giữ presenter; đổi nguồn và mode gate |
| `RuntimeServicePage/WatchTab` | Watch/Trace ở PGM-06 | Không dùng chung workbench | Extract reusable panels/hooks |

### 3.3 Responsive As-Is

- `ProgramsTab` chỉ đổi từ 2 sang 3 cột ở `md/lg`; editor cao cố định.
- 1024 px vẫn giữ rail + hai POU projections và editor; mật độ thông tin cao.
- 390 px xếp toàn bộ nội dung dọc nhưng vẫn cho admin thêm/xóa/sửa ST/FBD.
- Context strip ẩn một số Draft/Active fields theo breakpoint, trái invariant
  “Draft và Active luôn hiện” của handoff mới.

### 3.4 Trả lời 15 câu hỏi source FE bắt buộc

| # | Câu trả lời | Bằng chứng source |
|---:|---|---|
| 1 | Có **hai** POU tree cùng lúc: outer raw POU tree và inner Application tree Programs-only. | `DesignWorkspacePage.tsx:280-305`; `ProgramsTab.tsx:359-436` |
| 2 | Authority là Draft v2 `objects[]`; `document.programs` chỉ là compatibility projection đổi `objectId` thành `programId`. | `model/types.ts:262-271`; `model/draftV2.ts:15-40` |
| 3 | ST editor là `SourceEditor` nội bộ trong `ProgramsTab`, controlled bởi buffer Draft. | `ProgramsTab.tsx:1002-1095,1220-1240` |
| 4 | Không dùng Monaco/CodeMirror; bề mặt là custom `<textarea>` + gutter + `<pre>` highlight overlay. | `ProgramsTab.tsx:1002-1095`; `apps/web-ui/package.json:26-33` |
| 5 | Có syntax/edit utility riêng trong `stEditorSupport.ts`, nhưng là tokenizer/presentation one-pass, không phải AST/compiler semantic layer. | `stEditorSupport.ts:63-191,235-364` |
| 6 | Component hỗ trợ diagnostic `line/column/length` và jump range; page PGM-02 hiện truyền `EMPTY_DIAGNOSTICS`, nên capability end-to-end chưa hoạt động. | `ProgramsTab.tsx:589-600,1039-1077`; `DesignWorkspacePage.tsx:29-31,292-304` |
| 7 | Chưa có semantic symbol/reference infrastructure; hiện chỉ regex declaration và đếm text occurrence. | `ProgramsTab.tsx:1474-1492`; compiler symbols bị bỏ tại `compiler/runner.go:142-162` |
| 8 | FBD render network thành `<article>`, node thành card trong list/grid và wire thành button text ID; chưa là node-edge canvas. | `StructuredFbdEditor.tsx:646-726` |
| 9 | `model.ts` và `commands.ts` đủ mạnh để giữ: canonical network/node/typed port/wire, validation, port `order`, bounded history; chỉ thiếu geometry/multiselect transaction. | `fbd/model.ts:7-74,219-359`; `fbd/commands.ts:73-133,212-245,266-425` |
| 10 | Undo/redo nằm trong **domain reducer/history**, không nằm ở renderer. | `fbd/commands.ts:73-133,266-425` |
| 11 | Program Inspector đọc selected compatibility `ProgrammingProgram` + local `metadataDrafts`; FBD NodeInspector đọc `state.selection`, canonical node trong reducer document và palette metadata rồi dispatch domain command. Port/wire hiện có selection nhưng chưa có inspector riêng. | `ProgramsTab.tsx:159,215,496,1408-1470`; `StructuredFbdEditor.tsx:126-307,665,694-704` |
| 12 | SYSTEM catalog nằm ở registry JSON sinh C++/Go/TS rồi vào `fbd/palette.ts`; PROJECT catalog đọc qua `/programming/libraries`. | `contracts/programming/pou_library_registry_v1.json`; `api/generated/library_registry.ts`; `fbd/palette.ts:9-80`; `api/queries.ts:381-401` |
| 13 | Có thể reuse metadata qua một shared adapter, nhưng API SYSTEM hiện thiếu public signature/category/ports; không được để FE tự hard-code bù. | `domain/library.go:120-123`; `application/library.go:378-393`; `openapi.yaml:3467-3500` |
| 14 | Live data hiện poll Monitor, adapter nhóm theo `programId` của Draft rồi truyền overlay vào `ProgramsTab`; đây chính là đường có nguy cơ Draft/Active conflation. | `api/queries.ts:319-367`; `DesignWorkspacePage.tsx:193-196,292-304`; `workspaceAdapters.ts:141-177` |
| 15 | Mapping đã có Binding/point catalog và type-direction checks, nhưng còn parse source ST/FBD để đoán interface dù `objects[].interface` đã tồn tại; phải refactor adapter, không tạo mapping ngầm khi insert. | `MappingTab.tsx:16-45`; `workspaceAdapters.ts:83-117`; `InsertPointVariablePanel.tsx:16-23` |

## 4. Gap Analysis

| ID | Severity | Gap và kịch bản hỏng | Evidence source | Owner thực thi | Gate đóng |
|---|---|---|---|---|---|
| `GAP-PGM02-001` | **BLOCKER** | Active monitor được nhóm theo Programs của Draft và render ngay dưới ST Draft; Draft≠Active vẫn có thể hiện giá trị Active cạnh source khác revision | `DesignWorkspacePage.tsx:193-196,292-304`; `workspaceAdapters.ts:141-177`; `ProgramsTab.tsx:459-477` | FE + BE | LIVE revision-lock tests |
| `GAP-PGM02-002` | **HIGH** | Hai cây POU đọc raw `objectId` và compat `programId`; selection có thể chọn POU mà editor không tìm thấy | `DesignWorkspacePage.tsx:280-305`; `ProgramsTab.tsx:153-156,359-436`; `draftV2.ts:15-40` | FE | one-tree/identity tests |
| `GAP-PGM02-003` | **BLOCKER** | Không có simulation capability, immutable snapshot, session, virtual input image hay executor sản phẩm | `transport/http/router.go:31-74`; `application/runtime.go:125-141`; `programming_core_sim_main.cpp:1-8,170-180,226-249` | BE + FW-SOM | zero-output simulation gate |
| `GAP-PGM02-004` | **HIGH** | FBD renderer là card list; không node-edge canvas, geometry, pan/zoom, visible wires, minimap | `StructuredFbdEditor.tsx:646-726`; `fbd/model.ts:7-74` | FE | FBD canvas AC |
| `GAP-PGM02-005` | **HIGH** | Quick Library chưa tồn tại; SYSTEM signature/category/ports không có trong public API | `fbd/palette.ts:9-80`; `domain/library.go:120-123`; `application/library.go:378-393`; `openapi.yaml:3467-3500` | FE + BE | catalog parity gate |
| `GAP-PGM02-006` | **HIGH** | Registry thiếu PI, TP, CTU, CTD, SCALE, Deadband/Hysteresis; PID còn `REVIEW_REQUIRED` | `fbd/model.ts:96-112`; `api/generated/library_registry.ts:1-90`; `pou_library_registry_v1.json` | Compiler/library | registry/compiler parity |
| `GAP-PGM02-007` | **HIGH** | PGM-02 diagnostics là `EMPTY_DIAGNOSTICS`; symbols/reference chỉ regex/text-count | `DesignWorkspacePage.tsx:29-31,292-304`; `ProgramsTab.tsx:586-600,1474-1492`; `compiler/runner.go:142-162` | FE + BE/compiler | exact ST/FBD location tests |
| `GAP-PGM02-008` | **HIGH** | Không có Bottom Workbench dùng chung; Watch/Trace/Problems nằm rải ở PGM-05/06 | `CheckCommissionPage.tsx:241-255`; `RuntimeServicePage.tsx:80-85`; `WatchTab.tsx:201-237` | FE | workbench UC tests |
| `GAP-PGM02-009` | **HIGH** | Không có state machine EDIT/SIMULATE/LIVE hay typed capability gate | `DesignWorkspacePage.tsx:57-69`; `model/types.ts:54-72`; `application/runtime.go:125-141` | FE + BE | mode transition tests |
| `GAP-PGM02-010` | **BLOCKER** | Khi safe-boundary đã chạy candidate mới nhưng Active ID chưa COMMITTED, BE có thể ghép source Active cũ với point snapshot mới | `programming_runtime_coordinator.cpp:1508-1523`; `application/monitor.go:19-43,140-160,233-284`; `programming_pointcatalog.go:45-61` | BE + Core | concurrent Commission/Monitor test |
| `GAP-PGM02-011` | **BLOCKER** | Core trace IPC start/read/stop và scan cùng truy cập ring/state không guard; trace không pin revision | `bootstrap/main.cpp:469-480`; `scan_loop.cpp:227-231`; `st_value_trace.hpp:132-150`; `program_ipc_server.cpp:934-987` | Core | TSAN + revision-change tests |
| `GAP-PGM02-012` | **HIGH** | Trace bỏ timestamp Core, fallback polling không khai source, gán `ActualValue=ProgramValue`, idempotency in-memory | `application/trace.go:135-148,241-257,288-394,515-538` | BE + Core | trace truth/restart tests |
| `GAP-PGM02-013` | **HIGH** | Commission UNKNOWN có thể báo `keepsRunning=true` khi chưa read-back; impact lookup có nhánh nuốt lỗi/fail-open và objectId/programId mismatch | `application/operations.go:806-808,844-859`; `application/changes.go:137-165`; `application/draft_v2.go:349-377` | BE | fault/reconcile/identity tests |
| `GAP-PGM02-014` | **MEDIUM** | Mapping còn parse source để đoán interface dù Draft v2 đã có `objects[].interface` | `MappingTab.tsx:16-45`; `workspaceAdapters.ts:83-117` | FE | adapter parity tests |
| `GAP-PGM02-015` | **HIGH** | Không có keyed runtime layer/benchmark 256 block, 512 wire; mỗi sample có nguy cơ render toàn canvas | `StructuredFbdEditor.tsx:646-728`; `ProgramsTab.tsx:344-346`; `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md:237-245` | FE | performance budget gate |
| `GAP-PGM02-016` | **HIGH** | <768 vẫn edit; 1024–1279 không có compact/drawer contract; focus/keyboard có nguy cơ hồi quy khi đổi canvas | `ProgramsTab.tsx:153-156,344-346`; `ProgrammingContextStrip.tsx:212-221`; browser HOST 390×844 | FE | responsive/a11y matrix |
| `GAP-PGM02-017` | **BLOCKER** | Thiếu `PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md`; ba asset link hỏng; manifest trỏ file v2.1 đã xóa; route/mobile/FBD target xung đột authority Active | `handoff_manifest.json:10-13`; PGM-02/ST/FBD handoff `:7/:6/:6`; `PROGRAMMING_UI_UX_DESIGN.md:44-51,220-230`; `FBD_EDITOR_DESIGN.md:5-14,191-197` | Product/Architecture/UX | WP-00 authority reconciliation |

## 5. UI/UX/UC Review

### 5.1 ST Editor

| Hành vi | Current | Target decision | Acceptance chính |
|---|---|---|---|
| Open/select POU | Program-only compat list; outer tree thấy Function/FB | Một explorer, selection bằng `objectId`, runtime ID là field riêng | Mọi POU kind mở đúng editor/inspector |
| Source editing | Controlled textarea + syntax layer | Transaction editor; đề xuất CodeMirror 6 presentation | Gõ/paste/IME/history không mất buffer |
| Syntax/highlight/indent | Có pure utilities | Giữ/adapt làm extension ban đầu | Behavioral tests hiện tại tiếp tục PASS |
| Completion | Prefix + label; không signature/type | Catalog + compiler metadata, call template | Function/FB insertion đúng signature |
| FB instance | Chưa có atomic create+invoke | Một transaction: declaration + invocation | Một Undo hoàn nguyên cả hai |
| Diagnostics | Renderer/jump có, nhưng input rỗng | Problems dùng Check/semantic result có location | Jump line/column/length chính xác |
| Search/reference | Text search + regex symbols | Search local; Cross Reference compiler-derived | Read/write/call sites, không dùng regex làm authority |
| Runtime values | Panel list ngay dưới Draft | Decoration/Watch theo mode/revision | Không ghi runtime value vào source text |
| LIVE | Không mode; Draft vẫn là source | Sealed Active source read-only | Paste/keyboard/mutation đều bị chặn |
| SIMULATE | Không có | Saved Draft snapshot + sandbox overlay | Banner `NO REAL OUTPUT`; capability-gated |

Quyết định kỹ thuật: thay bề mặt editor theo vertical slice, không xóa các hàm
tokenize/format/indent/history tests trước khi adapter đạt parity. Compiler/Check
là semantic authority; editor không tự kết luận code hợp lệ.

### 5.2 FBD Editor

| Hành vi | Current | Target decision | Acceptance chính |
|---|---|---|---|
| Domain | Canonical network/node/port/wire + validator | Giữ; thêm `layout` versioned | Compiler semantics không phụ thuộc tọa độ |
| Port ordering | `order` canonical, connect typed/fan-in | Giữ bất biến | Save/load không đổi port order |
| Canvas | Grid card | Viewport node–edge controlled | Pan/zoom/grid/snap/fit/minimap |
| Move/select | Đổi execution order, single selection | Spatial move, box/multi-select; execution order riêng | Undo một gesture = một transaction |
| Connect | Keyboard typed connect tốt | Visible wire + drag/keyboard, cùng domain command | Invalid wire bị chặn và giải thích |
| Palette | Select + Add | Quick Library search/drag/click | Selected-port filter; ambiguous không auto-connect |
| Inspector | Node inline card | Dock node/port/wire/network | Selection đổi đúng panel, keyboard reachable |
| Diagnostics | Draft issue count | Marker block/port/wire + Problems jump | Exact UUID/location |
| Runtime | Không overlay | Separate node/port/wire value layer | Topology state không đổi theo sample |
| LIVE/SIMULATE | Không mode | Active topology hoặc sim snapshot tương ứng | Không phủ Active lên Draft graph |

Renderer mới chỉ là projection/controller. Mọi mutation phải dispatch vào FBD
domain reducer; không cho thư viện canvas trở thành model thứ hai. Đề xuất dùng
`@xyflow/react` như presentation adapter, với entry gate license/bundle/256–512
benchmark; nếu gate thất bại thì thay adapter SVG, không đổi domain/contract.

### 5.3 Use-case coverage

| UC/User job | Current và click/context | Target/kết luận | Acceptance bắt buộc |
|---|---|---|---|
| `UC-01 CREATE / OPEN PROGRAM` | Vào Programs rồi gặp outer POU tree và inner Application tree; cùng POU có hai identity/projection. Tạo ST/FBD là một click trong inner tree nhưng user phải hiểu cây nào điều khiển editor. | Một route, một Explorer; chọn một POU là mở đúng ST/FBD và Inspector. **REFACTOR** | Từ Programs tới editor tối đa một thao tác chọn với POU hiện có; tạo mới không quá ba thao tác có chủ ý; không có selection mồ côi. |
| `UC-02 ST PROGRAMMING` | Gõ/highlight/indent/find/format/undo/save có; completion chỉ label; không shared Quick Library, FB create transaction, go-to-definition hay semantic references; diagnostics đầu vào rỗng; Check ở PGM-05. | Giữ Draft/save và utilities; redesign surface + compiler/catalog integrations. **REDESIGN/NEW** | Write→completion/insert FB→diagnostic jump→save→check không mất buffer; create instance + invoke là một Undo. |
| `UC-03 FBD PROGRAMMING` | Palette `<select>`→Add; block là card, wire là ID text; typed keyboard connect/config/undo có; không drag canvas, zoom/pan, minimap, exact FBD diagnostic hay runtime layer. | Giữ canonical model/reducer; redesign renderer/controller. **KEEP domain / REDESIGN surface** | Search/place/connect/configure/diagnose/undo hoạt động bằng mouse và keyboard; pan/zoom không đổi execution order; overlay không re-render topology. |
| `UC-04 QUICK LIBRARY` | ST không có; FBD palette có 40 SYSTEM entry nhưng không search/category/Recent/Favorites và public signature chưa đủ. User tìm “timer” hoặc “PID” chưa có một kết quả thống nhất với PGM-04. | Shared catalog service; search/category/signature/statefulness/source library; capability warning. **NEW + BLOCKED BY BE cho metadata** | “timer” trả TON/TOF và TP chỉ khi supported; “PID” hiện signature, description, FB state và source; ambiguous port không auto-connect. |
| `UC-05 SIMULATION` | Không capability, session, virtual input image, run/pause/step/clock hay zero-output boundary; host core sim không phải product Simulation. | Saved Draft snapshot→Check→isolated worker→virtual inputs→Run/Watch/Trace/Pause/Step→Draft. **BLOCKED BY BE/FW-SOM** | Luôn có `SIMULATION` + `NO REAL OUTPUT`; dirty/stale Draft bị chặn; read-back thật, deterministic và zero physical output đúng evidence class. |
| `UC-06 LIVE` | Monitor bound values poll được nhưng đang nhóm theo Programs Draft; không có mode và có thể đặt Active values cạnh Draft source. | Tải sealed Active source/topology, read-only, rồi join coherent runtime tuple. **P0 REFACTOR + BE/Core** | Open→LIVE→Active→Watch/Trace→Draft; mọi mutation bị chặn; mismatch hiện `RECONCILING/UNAVAILABLE`, không overlay. |
| `UC-07 ERROR REVIEW` | Problems ở PGM-05 có ST deep-link/range; PGM-02 nhận diagnostics rỗng; FBD compile failure chưa có exact block/wire UUID. | Shared Problems workbench + compiler-derived ST/FBD locations. **NEW/REFRACTOR + BE/Core** | Một click diagnostic nhảy đúng ST range hoặc FBD network/node/port/wire; stale result không jump sang document khác. |
| `UC-08 DRAFT vs ACTIVE` | Context strip có Draft/Active nhưng ẩn field ở breakpoint; editor không khóa document/value revision; Compare hiện chỉ Revision↔Revision object diff. | Draft `r17` và Running `r15` luôn visible; Compare Draft snapshot↔Active typed diff; không giấu trong modal. **REFACTOR + BE** | Dirty local diff có nhãn “chưa lưu/không dùng cho Commission”; authoritative compare dùng immutable saved Draft snapshot; ST line hunks và FBD node/wire changes truy xuất được. |

## 6. Quick Library Review

### 6.1 Source of truth

```text
contracts/programming/pou_library_registry_v1.json
      | generator
      +-- C++ compiler dispatch
      +-- Go SYSTEM registry / public Library API
      +-- TypeScript generated registry
                         \
PROJECT Library API ------> LibraryCatalogService (shared PGM-02 + PGM-04)
                              +-- Quick Library view
                              +-- Control Library view
                              +-- typed insertion adapters ST/FBD

/me/preferences -> Recent/Favorites IDs only (không chứa signature bản sao)
```

- SYSTEM signature/ports/category/warnings phải được public từ canonical registry;
  không copy danh sách sang ST/FBD/PGM-04.
- PROJECT POU lấy từ BE, version/signature theo Library authority.
- `Recent` cập nhật chỉ sau insertion thành công; `Favorites` lưu catalog ID/version,
  không lưu bản sao block definition.
- Có thể dùng generated TS registry cho SYSTEM trong lane đầu vì nó cùng generator;
  khi public API đủ metadata, PGM-02 và PGM-04 chuyển qua một shared adapter.

### 6.2 Coverage block hiện tại

| Nhóm | Có | Thiếu/không sẵn sàng |
|---|---|---|
| Logic/Compare/Math | AND/OR/XOR/NOT, compare, MIN/MAX/LIMIT, arithmetic | Deadband/Hysteresis |
| Timer/Edge | TON, TOF, R_TRIG, F_TRIG | TP |
| Counter | — | CTU, CTD |
| Control/HVAC | PID (`REVIEW_REQUIRED`) | PI, SCALE |
| Conversion | Nhiều INT/DINT/UINT/REAL/TIME conversion | Cần category/copy thân thiện |
| Project | POU interface có thể dựng palette | Cần version/signature/error public thống nhất |

### 6.3 Insertion architecture và Undo

| Context | Command nguyên tử |
|---|---|
| ST FUNCTION | `INSERT_CALL_TEMPLATE(catalogId, signature, range)` |
| ST FUNCTION_BLOCK, instance có sẵn | `INSERT_FB_INVOCATION(instanceId, range)` |
| ST FUNCTION_BLOCK, tạo mới | `CREATE_INSTANCE_AND_INSERT_CALL(declarationRange, callRange)` — một Undo |
| FBD click/drag | `ADD_NODE(catalogId, position, networkId)` |
| FBD selected port, one compatible | `ADD_NODE_AND_CONNECT(...)` — một domain transaction |
| FBD ambiguous | Mở lựa chọn port; không auto-connect |

Mọi command kiểm catalog version/signature trước khi commit. Metadata drift phải
trả diagnostic/copy rõ ràng và giữ nguyên document.

## 7. EDIT / SIMULATE / LIVE Review

### 7.1 State machine target

```text
                 capability supported + saved Draft snapshot
       +------------------------------------------------------+
       |                                                      v
EDIT(Draft/write) --open Active--> LIVE(Active/read-only)  SIMULATE(snapshot/sandbox)
       ^                         |          |                  |
       +---- Return to Draft ----+          +---- Stop --------+

Mọi mode mang: documentRevisionId, valueRevisionId, artifactHash,
snapshotId/sessionId, lifecycleState, freshness và capability state.
```

| Mode | Source/topology | Values | Mutation | Current capability |
|---|---|---|---|---|
| EDIT | Draft + local unsaved buffer | Không Active overlay | Admin only | PARTIAL hiện hữu |
| SIMULATE | Immutable saved Draft snapshot | Simulation session only | Virtual inputs/session actions | MISSING |
| LIVE | Immutable Active Revision | Controller snapshot cùng identity | Read-only mọi role | PARTIAL/P0 |

### 7.2 Join rule bắt buộc cho LIVE

```text
runtime = GET /programming/runtime
active  = GET /programming/revisions/{runtime.activeRevisionId}
values  = GET/SUBSCRIBE runtime snapshot

render overlay only when:
  runtime.lifecycleState == COMMITTED
  && active.revisionId == values.runtimeRevisionId
  && active.artifactHash == values.artifactHash
  && values.snapshotId is monotonic/coherent
otherwise:
  state = RECONCILING | UNAVAILABLE
  overlay = none
```

Không fallback sang Draft. Không giữ giá trị snapshot trước như giá trị hiện
hành. `valid=false`, stale, offline, transition hoặc thiếu field đều hiển thị
`—` kèm quality/state, không thành `0`.

### 7.3 Kiến trúc Simulation đề xuất

Simulation không chạy trong Active scheduler và không dùng global Virtual Point
production. Kiến trúc phù hợp quy tắc “không thêm daemon”:

```text
FE -> Simulation REST/session (mkddc-web)
       -> atomically snapshot saved Draft + compile artifact
       -> spawn bounded mkddc-programming-sim-worker (ephemeral sandbox)
            production artifact loader/executor
            private scheduler + virtual clock
            private Point/Signal/RETAIN images
            no SHM/device/ProgrammingCutover/OutputWriter permission
       <- coherent simulation snapshot/trace
```

Worker dùng lại production loader/executor, nhưng process isolation và OS
permissions chứng minh không thể chạm physical output. `Run/Pause/Step/Reset`
chỉ điều khiển virtual clock; `1×/10×/60×` không thay đổi thứ tự cycle.

### 7.4 Step, multi-task và virtual time

`STEP_CYCLE` được khóa là **một scheduler base tick**, không phải “chạy một
Program tùy chọn”. Với profile hiện công bố `[1000,5000,30000] ms`, base tick là
GCD `1000 ms`:

1. PREPARE/RESET đặt virtual monotonic time `t=0`, next-release của mọi task là
   `0`, và giữ session ở `PAUSED`.
2. Một Step chụp virtual-input image đúng một lần tại boundary `t`, release mọi
   task có `nextRelease==t`, theo cùng stable scheduler order của production,
   rồi commit một sandbox output batch sau toàn bộ task due.
3. Task timer nhận đúng configured task-period delta ở mỗi lần task đó được
   release; task 5 s không được tiến timer trong bốn base tick mà nó không chạy.
4. Sau batch, virtual time tăng đúng một base tick và session lại `PAUSED`; các
   task cùng due ở 30 s chạy theo stable order, không phụ thuộc tốc độ máy host.
5. `RUN 1×/10×/60×` chỉ đổi wall-clock pacing; release order, virtual timestamp
   và kết quả phải byte-equivalent. Không cung cấp `STEP_PROGRAM` ở v1.

Nếu task period không tạo được base tick bounded hoặc runtime production chưa
cung cấp stable release-order descriptor, PREPARE phải trả `UNSUPPORTED_PROFILE`;
không tự suy diễn. WP-00 ghim descriptor/initial-timer golden vector, WP-07 mới
được implement acceptance này.

### 7.5 RBAC, approved virtual inputs và audit

Baseline đề xuất theo Programming RBAC hiện hành: `viewer/operator` đọc source,
session state và snapshot; chỉ `admin` được create/run/pause/step/reset/stop và
set virtual input. Việc mở simulation controls cho `operator` là quyết định
Product/Safety tại §15, không phải FE tự mở nút.

Approved virtual input không phải chuỗi Point ID tùy ý. Compiler/Check của saved
Draft snapshot phải sinh manifest `simulationInputs[]` có stable observation ID,
POU/interface/type/unit/range và lý do eligibility. V1 chỉ nhận `VAR_INPUT` hoặc
binding direction `READ` đã đánh dấu `simulationWritable=true`; loại `OUTPUT`,
`IN_OUT`, RETAIN/internal state, command/override và mọi production Point writer.
BE đối chiếu input ID với manifest của đúng session/artifact trước khi gửi worker.

| Case | HTTP/stable result | Side effect/audit |
|---|---|---|
| Role không đủ | `403 PRG-SIM-FORBIDDEN` | Không gọi worker; audit denial có actor/session/action |
| ID ngoài allowlist/type/range sai | `422 PRG-SIM-INPUT-NOT-ALLOWED` | Virtual image không đổi; audit denial có input ID, không log secret/value nhạy cảm |
| Session/snapshot/artifact mismatch | `409 PRG-SIM-STALE-SESSION` | Không đổi state; yêu cầu refresh/recreate |
| Hợp lệ + idempotency key | `200/202` rồi read-back sequence mới | Audit accepted; retry cùng key không apply hai lần |

Mọi giá trị chỉ ghi vào private session image; tên “Virtual Point” production
không được tái sử dụng làm đường write simulation.

## 8. FE Impact

### 8.1 KEEP

- `design/useDraftWorkspace.ts`: ETag/If-Match/save/conflict/read-back.
- `fbd/model.ts`, `fbd/commands.ts`: canonical document, validation, typed connect,
  bounded history; mở rộng nhưng không rewrite.
- `fbd/palette.ts` và generated registry: giữ đường generator authority.
- `StRuntimeValueOverlay.tsx`: giữ fail-closed presentation; không giữ cách mount.
- Runtime/library query hooks, theme tokens, focus/reduced-motion utilities.

### 8.2 REFACTOR

| File/module hiện có | Thay đổi |
|---|---|
| `ProgrammingRoutes.tsx` | Primary route không project ID; legacy route redirect có context |
| `ProgrammingLayout.tsx`, `ProgrammingContextStrip.tsx` | Luôn hiện Draft/Active/mode/connection theo compact rules |
| `DesignWorkspacePage.tsx` | Tách PGM-02 khỏi shell Programs/Mapping/Execution legacy |
| `PouTree.tsx` | Thành một `PouExplorer`, raw object authority, CRUD/search/filter |
| `ProgramsTab.tsx` | Phân rã buffer/toolbar/editor/inspector; xóa inner tree sau parity |
| `draftV2.ts`, `workspaceAdapters.ts` | Typed `objectId`↔`programId`, Draft/Active adapters riêng |
| `MappingTab.tsx` | Dùng `objects[].interface`, không parse source làm authority |
| `LibraryPage.tsx`, `WatchTab.tsx` | Dùng shared catalog/workbench components |

### 8.3 CREATE

```text
features/programming/programs/
  ProgramsPage.tsx
  ProgramsWorkspaceShell.tsx
  mode/programModeMachine.ts
  pou/PouExplorer.tsx
  library/{LibraryCatalogService,QuickLibrary,stInsertion,fbdInsertion}.ts(x)
  st/{StEditor,stExtensions,stDecorations}.ts(x)
  fbd/{FbdCanvas,FbdViewport,FbdNode,FbdWire,FbdRuntimeLayer}.tsx
  inspector/EngineeringInspector.tsx
  workbench/{BottomWorkbench,Problems,Watch,Trace,Search,CrossReference}.tsx
```

### 8.4 DELETE sau migration gate

- Inner “Application tree” trong `ProgramsTab`.
- Draft editor runtime overlay không qua mode/revision lock.
- Legacy Programs tab mounted ẩn bên trong `DesignWorkspacePage`.
- Danh sách/palette hard-code nào trùng canonical catalog; không xóa FBD domain.

## 9. BE Impact

### 9.1 Tái sử dụng API hiện có

- `GET/PATCH Project/Draft`, `POST Revision`, `GET Revision`.
- `GET Revision changes` cho compare nền.
- `GET Libraries` và `/me/preferences` cho shared catalog/preferences.
- `GET Runtime`, `GET Monitor`, Trace routes sau khi đóng truth defects.

### 9.2 Contract/API cần bổ sung hoặc sửa

| Area | Contract cần |
|---|---|
| Capabilities | Sinh từ product profile + runtime negotiation; flags `st/fbd/onlineMonitor/trace/crossReference/simulation/step/virtualTime`, tri-state supported/unavailable |
| Runtime coherence | `runtimeRevisionId`, `activeRevisionId`, `lifecycleState`, `artifactHash`, `snapshotId` trên status/monitor/trace |
| Library | Public category/description/signature/ports/types/warning/dispatch/version cho SYSTEM và PROJECT |
| Diagnostics/reference | Compiler-derived symbol index; ST location và FBD network/node/port/wire IDs; cross-reference endpoint |
| Watch | Observation targets không giới hạn Binding; khai rõ target kind và availability |
| Trace | Persistent/restart-safe idempotency; source/timestamp domain; actual/program value tách; exact stop reason |
| Simulation | Session create/read/action/virtual-input/stop/snapshot/trace; immutable snapshot ID, artifact hash, quota, expiry, audit |
| Compare | Dirty Draft phải Save; seal bằng Revision API hiện có, compare immutable Draft Revision↔Active; extend typed ST hunks + FBD network/node/port/wire diff, bounded/cursor |

### 9.3 Defect hiện hữu phải đóng trong plan

1. `operations.go`: UNKNOWN chưa read-back bị trình bày như revision cũ vẫn chạy.
2. `changes.go`: lỗi runtime intents có thể bị nuốt thành `NONE`; objectId và
   runtime programId bị so trực tiếp.
3. Trace fallback/timestamp/actual/idempotency/finish reason chưa trung thực.
4. Capabilities hard-code `tasks=1` trong khi generated profile authority là 3.
5. OpenAPI có 33 routes nhưng generator chỉ materialize một phần schema; sync
   operation không đồng nghĩa typed schema parity.

## 10. FW-SOM Impact

### 10.1 Ma trận capability runtime/FW-SOM

Legend dependency: `A` FE-only; `B` FE+BE; `C` BE+FW-SOM; `D` FW-SOM
prerequisite. Các bề mặt shell/Quick Library presentation thuộc A và Draft/
library/Compare thuộc B; capability runtime dưới đây chủ yếu là C/D, không được
hạ thành FE-only. Path C++ rút gọn nằm dưới `apps/core/application/{st,runtime,
programming}/`; path Go rút gọn nằm dưới
`apps/web-api/internal/programming/application/`.

| # | Runtime capability | State | File/symbol evidence | Boundary | Gap/gate |
|---:|---|---|---|:---:|---|
| 1 | Compiled/validated Program artifact | **IMPLEMENTED** | `apps/core/application/st/st_runtime.hpp:33-75` (`StRuntime::prepare`/artifact-only); `st_runtime.cpp:23-76`; artifact manifest/loader | D | Giữ deterministic loader/verify; target trust evidence vẫn riêng |
| 2 | ST execution | **IMPLEMENTED** | `st_runtime.cpp:78-152` (`execute_cycle`, state rollback); typed IR runtime | D | Không tạo VM simulation thứ hai |
| 3 | FBD execution | **IMPLEMENTED** | `st_fbd_compile.hpp:3-7`; `st_fbd_compile.cpp:730-815` (`compile_fbd`, ST/FBD executable IR equivalence) | D | Giữ cùng IR; target block coverage còn capability-gated |
| 4 | Runtime instance | **IMPLEMENTED** | `apps/core/application/st/st_scheduler.hpp:182-235` (`StProgramInstance`: state/enable/period/WCET/missed release/lane); `apps/core/domain/graph/runtime_point_snapshot.hpp:72-112` (`RuntimeProgramSnapshot`); `st_runtime_snapshot.cpp:68` projection | C | BE/API chưa xuất đủ diagnostic/identity |
| 5 | Active revision | **IMPLEMENTED** | `programming_runtime_coordinator.cpp:1461-1523` (checkpoint/`COMMITTED`/Active+LKG publish); Core STATUS | C | Candidate-running transition cần runtimeRevision riêng |
| 6 | Input snapshot | **IMPLEMENTED** | `st_process_image.cpp:195-268` (batch snapshot/preflight; BAD/missing fail, không zero) | D | API chưa trình bày full coherent input snapshot |
| 7 | Output candidates | **IMPLEMENTED** | `st_process_image.cpp:347-404` (batch preflight/commit/candidate registry) | D | API chưa xuất đầy đủ owner/withdraw reason |
| 8 | Online value read-back | **PARTIAL** | `program_ipc_server.cpp` status/point snapshot; `apps/web-api/internal/programming/application/monitor.go:140-285` (`Monitor`) | C | Bound point only; thiếu observation ID/revision/artifact/snapshot coherent |
| 9 | Watch | **PARTIAL** | `monitor.go:164-284` dựng item từ Active Binding; `apps/web-ui/src/features/programming/runtime/WatchTab.tsx` lọc monitor | C | Không arbitrary local/symbol/FB port session |
| 10 | Trace | **PARTIAL** | `st_value_trace.hpp:40-55,132-150`; `st_value_trace.cpp:49-69,98-144`; `program_ipc_server.cpp:934-987`; BE `trace.go:135-394` | C | P0 data race, không pin revision, timestamp/source/actual/fallback sai |
| 11 | Check/compiler diagnostics | **PARTIAL** | Core fault PC/line tại `st_scheduler.hpp:256-258`; FBD source map `st_artifact_manifest.cpp:100-139`; failure loses UUID tại `st_compile_main.cpp:562-568` | C | Cần ST exact range và FBD network/node/port/wire qua API |
| 12 | Atomic activation | **IMPLEMENTED** | `programming_runtime_coordinator.cpp:853-983,998-1042,1217-1317,1360-1389,1461-1505` (`PREPARED`, intent, safe-boundary handoff, first-cycle barrier, commit) | D | Host tests PASS; target/power-loss evidence vẫn riêng |
| 13 | Rollback/LKG | **IMPLEMENTED** | cùng coordinator lifecycle/checkpoint/journal; full-package rollback tại `:1360-1505` | D | Không được suy release PASS từ host |
| 14 | Product simulation runtime | **MISSING** | Không session/executor product; `programming_core_sim_main.cpp:1-8,170-180,226-249` tự khai host-only/read-only | D | WP-07 isolated worker prerequisite |
| 15 | Isolated virtual point image | **MISSING** | `st_io_map.cpp:163-169` chỉ có Virtual Point production đi vào PointTable thật | D | Phải có private point/process/signal/RETAIN images; cấm reuse VP production |
| 16 | Step cycle | **MISSING** | Không Core/worker command hoặc REST schema; router chỉ mount routes hiện hữu tại `transport/http/router.go:31-74` | D | Semantic multi-task §7.4 phải được ghim trước implement |
| 17 | Pause/Run session | **MISSING** | Không simulation state machine/action/session store/worker protocol | D | WP-07 contract + runtime |
| 18 | Virtual time acceleration | **MISSING** | Không virtual clock/speed factor contract hay executor | D | `1×/10×/60×` phải deterministic và không đổi release order |
| 19 | Runtime capability discovery | **PARTIAL** | Core `program_ipc_server.cpp:428-432` có profile/frame/queue/task periods; BE `application/runtime.go:125-141` hard-code ST/FBD/limits, không gọi Core capability | C | Additive negotiated flags + source/freshness; `tasks=1` đang lệch profile max 3 |

### 10.2 KEEP

- Artifact-only ST runtime, loader verify và typed IR chung ST/FBD.
- Cycle rollback state, bounded process-image snapshot, batch output commit.
- Shadow stage + safe-boundary handoff + Active/LKG journal/checkpoint.
- FBD source map thành công có network/node/port identity.

### 10.3 P0 runtime correction

- `StValueTrace`: Start/Stop qua mailbox, áp tại safe boundary; scan là single
  writer; IPC đọc published snapshot bằng bounded seqlock/double buffer.
- Pin revision/artifact khi trace start; activation dừng với
  `REVISION_CHANGED` hoặc mở segment mới có identity.
- Mọi monitor/trace snapshot xuất coherent runtime revision/artifact/snapshot ID.
- Xuất fault PC/source location; giữ FBD UUID cho failure/diagnostic.

### 10.4 Simulation prerequisite

- Tạo simulation worker/executor dùng production loader và typed IR nhưng private
  scheduler/process image/signal bus/RETAIN/virtual clock.
- Không link/mount production `ProgrammingCutover`, candidate registry,
  priority resolver, output writer, IOP/SHM/device path.
- Commands bounded: prepare/run/pause/step/reset/set-speed/set-input/read/trace/stop.
- Quota resource/WCET/memory/session; deterministic replay theo snapshot + input
  sequence; worker crash chỉ làm session FAILED, không ảnh hưởng Active Core.
- Bổ sung registry/compiler support cho các block target trước khi capability
  tương ứng trả supported.

## 11. Dependency Map

```text
WP-00 Authority/baseline
  +--> WP-01 Shared Shell --> WP-02 One POU Explorer
  |          |                     |
  |          +--> WP-06 Workbench  +--> WP-04 ST ------+
  |                                +--> WP-05 FBD -----+--> WP-10 Performance
  +--> WP-03 Quick Library ----------------------------+       |
  |                                                             +--> WP-11 Responsive
  +--> WP-09 LIVE coherence + typed Compare (BE/Core P0) -------+
  |
  +--> WP-07 Simulation infra (BE/FW-SOM, chạy song song EDIT/LIVE)
             +--> WP-08 Simulation UI

WP-04/05/06/08/09/10/11 --> WP-12 Full E2E/V&V --> WP-13 Docs closeout
```

Chuỗi safety của Simulation:

```text
Simulation UI
  -> capability + session API
  -> immutable saved Draft snapshot/artifact
  -> sandbox session manager
  -> runtime artifact executor
  -> private virtual point/process image
  -X-> production output authority
```

WP-04 và WP-05 làm song song sau shell/explorer/catalog contracts. WP-07 chạy
song song với EDIT/LIVE; chỉ WP-08 bị chặn bởi runtime. Thiếu Simulation không
được dùng để giữ WP-01..06 hoặc phần LIVE đã coherent.

## 12. Implementation Plan

Chi tiết execution-ready nằm trong
[PGM02_ST_FBD_IMPLEMENTATION_PLAN.md](PGM02_ST_FBD_IMPLEMENTATION_PLAN.md).
Bảng sau giữ đủ trường bắt buộc ở mức review:

| WP | Objective/scope | Files affected | FE | BE | FW-SOM | Dependency | Acceptance/tests | Risk | Complexity |
|---|---|---|---|---|---|---|---|---|---|
| WP-00 | Reconcile authority, broken assets/manifest, baseline/gates | Product/SRS/DDD/UX/handoff/Plan59/contracts | Inventory/routes/breakpoints | Capability/schema inventory | Runtime/trace inventory | None | Hash pin, doc harness, no unresolved P0 authority | Scope drift | **M** |
| WP-01 | Shared Programs shell + mode-neutral layout | routes/layout/new programs shell | Primary route, context, docks slots | None except typed reads | None | WP-00 | Route/deep-link/dirty-buffer tests | Navigation regression | **L** |
| WP-02 | One POU Explorer and identity model | PouTree/ProgramsTab/adapters | CRUD/search/select three POU kinds | Verify typed mutations | Verify compiler POU support | WP-01 | Exactly one tree; object/runtime IDs distinct | Data migration | **L** |
| WP-03 | Shared Quick Library foundation | registry/library/page/preferences/new service | Catalog/search/recent/favorite/insertion adapters | Public signatures/metadata | Missing block support | WP-00; UI after WP-01 | Registry parity; one Undo insertion | Source divergence | **XL** |
| WP-04 | ST workspace redesign | SourceEditor/new st modules | Transaction editor, semantic decorations, FB insertion | Symbols/refs/diagnostics | Exact source map | WP-01/02/03 | Existing edit tests + new AC-ST | Editor/IME regression | **XL** |
| WP-05 | True FBD canvas | FBD model/commands/renderer/new canvas | Geometry, node/wire, inspector, minimap, keyboard | FBD diagnostic metadata | Port/node observation IDs | WP-01/02/03 | 256/512 canvas, typed connect, parity compile | Domain/render conflation | **XL** |
| WP-06 | Bottom Workbench | ProblemsDrawer/PGM05/06/new panels | Problems/Watch/Trace/Search/XRef | Reusable queries, refs/watch | Trace/diagnostic identity | WP-01; data from 04/05/09 | Tabs preserve mode/source; jump exact | Duplicate polling | **L** |
| WP-07 | Isolated Simulation infrastructure | OpenAPI/BE session/store/worker/Core libs | Capability client only | Session/quota/audit/idempotency | Sandbox executor/virtual images/clock | WP-00 | Deterministic + zero physical output; fault tests | Safety/resource | **XL** |
| WP-08 | Simulation UI | mode store/dock/workbench/ST/FBD layers | Run/pause/step/reset/speed/input/overlay | Session adapters | Snapshot/trace read-back | WP-01/04/05/06/07 | `NO REAL OUTPUT`, stale snapshot blocked | Fake success | **XL** |
| WP-09 | Coherent LIVE + typed Draft↔Active Compare | mode/adapters/monitor/trace/changes/operations/Core trace | Active read-only, overlay gate, Compare drawer/jump | P0 truth/coherence/trace + typed diff | P0 trace mailbox/revision pin | WP-00/01/02; overlays with 04/05 | Commission join + TSAN + ST/FBD diff golden | Control truth | **XL** |
| WP-10 | Performance | FBD layers/value store/benchmarks | Topology/value separation/throttle | Snapshot batching/backpressure | Bounded sample/read | WP-05/08/09 | Budgets at 256/512; no full canvas rerender/sample | Browser/CPU load | **L** |
| WP-11 | Responsive/a11y | shell/ST/FBD/docks/styles | Breakpoint/drawer/mobile read-only/focus | Permission authority unchanged | None | WP-01/04/05/06 | 1920/1440/1280/1024/390 + keyboard/contrast | Interaction regression | **L** |
| WP-12 | Full E2E/V&V | unit/integration/e2e/TSAN/target evidence | All UC/state/RBAC | Contract/fault/restart | Lifecycle/sim/no-output/target | WP-03..11 | All gates measured; no evidence-class mixing | Flaky/fake fixtures | **XL** |
| WP-13 | Docs closeout | authority/trace/risk/VVP/Plan59/changelog | As-built map | Contract/version docs | Runtime/safety docs | WP-12 | Harness/link/hash/diff checks; Owner/QA sign-off | Stale docs | **M** |

## 13. Migration Strategy

1. **Baseline trước:** khóa hành vi Draft/save/FBD domain và thêm regression cho
   Draft≠Active trước khi đổi shell.
2. **Strangler shell:** primary route mới mount shell mới; adapter gọi domain/API
   hiện có. Legacy parameterized deep link redirect sang `?project=<uuid>`;
   zero/one/multi project resolve deterministic, query là reload authority và
   không tạo route sản phẩm thứ hai.
3. **Một cây trước editor:** chọn `objectId` làm POU document identity; runtime
   `programId` chỉ dùng khi join runtime. Xóa cây cũ sau parity.
4. **Catalog trước insertion:** shared service hoạt động với PGM-04 rồi mới nối
   ST/FBD; không hard-code trong editor.
5. **ST/FBD song song:** thay presentation theo POU; save document format giữ
   tương thích. FBD domain/reducer tiếp tục là authority.
6. **LIVE chỉ sau P0:** có thể dựng read-only Active view trước, nhưng không bật
   overlay/Trace cho đến coherence + TSAN gate.
7. **SIMULATE capability-gated:** UI slot/state có thể merge khi feature trả
   unsupported; không có value giả hay host simulator đổi tên.
8. **Xóa legacy cuối:** chỉ sau unit/E2E/browser parity và rollback path. Feature
   flag cho shell mới; rollback chỉ đổi route/surface, không migrate mất Draft.

Không đổi API chỉ vì FE muốn dễ code. Mọi additive contract có compatibility
test; breaking change cần version/migration riêng.

## 14. Risk Register

| Risk | Cause/event/impact | S/L | Control | Owner | Verification/residual |
|---|---|---|---|---|---|
| `R-PGM02-01` FBD regression | Renderer mới bypass reducer/port order -> compile khác | 5/3 | Controlled adapter; golden JSON/IR; no shadow model | FE+Compiler | ST/FBD IR equivalence; residual 2 |
| `R-PGM02-02` Draft/Active confusion | Overlay join bằng Program ID nhưng khác Revision | 5/4 | Document/value identity tuple; fail-closed transition | FE+BE+Core | Commission concurrent Watch; residual 1 |
| `R-PGM02-03` Simulation chạm output thật | Reuse production VP/output path | 5/3 | Process sandbox, no device/SHM/output components | Runtime+Security | Negative permission + target observation; residual 1 |
| `R-PGM02-04` Simulation/runtime mismatch | VM thứ hai hoặc virtual clock khác production | 4/3 | Same artifact loader/executor; deterministic replay corpus | Compiler+Runtime | ST/FBD golden replay; residual 2 |
| `R-PGM02-05` Trace corrupt/race | IPC và scan cùng state/ring | 5/3 | Safe-boundary mailbox + single writer + published snapshot | Core | TSAN/activation stress; residual 1 |
| `R-PGM02-06` Performance | Mỗi sample render 256 node/512 wire | 4/4 | Keyed store/layer/throttle/backpressure | FE+BE | Profiler budgets; residual 2 |
| `R-PGM02-07` Library divergence | ST/FBD/PGM-04 copy metadata | 4/3 | Generator parity + shared catalog service | BE+FE | Hash/count/signature gate; residual 1 |
| `R-PGM02-08` API churn | UI-driven breaking schemas | 3/3 | Additive versioned contract/generated client/negative tests | BE | OpenAPI diff/compat tests; residual 1 |
| `R-PGM02-09` E2E false green | Fake monitor/sim hides source/mismatch | 5/3 | Real-backend lane + fault injection + evidence labels | QA | No fallback allowance; residual 2 |
| `R-PGM02-10` Keyboard/a11y regression | Canvas replaces native controls | 4/3 | Roving focus/keyboard parity/reduced motion/screen reader copy | FE/UX | axe + manual keyboard matrix; residual 2 |
| `R-PGM02-11` Mobile mutation | RBAC-only canEdit ignores viewport policy | 3/4 | Server authority + FE mode policy/read-only banner | FE | 390 px mutation-negative tests; residual 1 |
| `R-PGM02-12` Authority drift | v2.2 target conflicts Active docs/manifest | 4/4 | WP-00 approval/re-pin/one tracker | Owner+Architect | Docs harness/hash pin; residual 1 |

S/L dùng thang 1–5; residual chỉ được hạ sau evidence tương ứng, không hạ bằng
kế hoạch này.

## 15. Hồ sơ quyết định của Owner

Ngày 2026-08-24, Product Owner/CTO chấp thuận trực tiếp cả ba đề xuất dưới đây và
yêu cầu team tiến hành triển khai. Quyết định này mở WP-00; nó không giả chữ ký
System Architect và không thay bước review/pin baseline reconciled tại
`G-PGM02-00`:

1. **Chấp thuận target/change request v2.2 để mở WP-00 reconciliation.** Đây chỉ
   là quyền lập baseline; sau WP-00, Owner + Architect phải review/pin hash của
   Product/SRS/DDD/UX/asset/manifest/Plan59 đã đồng bộ rồi mới cho phép code.
2. **Phê duyệt packaging theo ba release increment có gate độc lập:**
   `R1 EDIT workspace` → `R2 coherent LIVE` → `R3 isolated SIMULATE`.
   Việc R1/R2 hoàn tất không được làm UI giả rằng R3 đã có; release site thật
   vẫn phụ thuộc V&V/target/HIL tương ứng.
3. **Chốt quyền điều khiển Simulation v1.** Viewer/operator chỉ đọc session/
   snapshot; admin mới create/run/pause/step/reset/stop/set input. BE phải cưỡng
   chế RBAC/object-scope/audit ở server và có negative tests; FE không tự mở quyền.

Các điểm **không cần Owner quyết**: chọn một cây POU, dùng same catalog,
giữ FBD domain/reducer, coherent revision join, trace mailbox, process sandbox,
compiler-generated virtual-input allowlist, multi-task Step semantics,
CodeMirror/canvas adapter spike, keying/throttling và test strategy.

Authority chuẩn của quyết định này là `CR-PROG-PGM02-V22-001`; task duy nhất được
mở là `T59-801`/`PGM02-V22-WP-00`. Record này không thay chữ ký Architect và
không cấp quyền triển khai R1/R2/R3.

**OWNER APPROVED — T59-801 REVIEW; ARCHITECT EXACT BASELINE PIN PENDING**

### Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.3 | 2026-08-24 | Đồng bộ output WP-00: gói Candidate đã được tạo và `T59-801` chuyển `REVIEW`; Architect exact pin cùng toàn bộ quyền code downstream vẫn `PENDING/NO-GO` |
| 1.2 | 2026-08-24 | Nối record vào `CR-PROG-PGM02-V22-001` và `T59-801`, chuẩn hóa namespace `PGM02-V22-WP-*`, tách rõ Owner approved khỏi Architect `PENDING`; chỉ mở reconciliation, không mở code R1/R2/R3 |
| 1.1 | 2026-08-24 | Ghi nhận Owner chấp thuận target/change request, ba increment `R1 EDIT → R2 LIVE → R3 SIMULATE` và Simulation v1 admin-only; mở WP-00 nhưng chưa pin baseline reconciled hoặc mở release gate |
| 1.0 | 2026-08-24 | Rà source FE/BE/Core/runtime và browser host đủ 5 viewport; lập ma trận 15 câu FE, 21 BE, 19 runtime, UC-01..08, classification, 17 gap, dependency, 14 WP, migration/risk/3 Owner decisions; không triển khai code |
