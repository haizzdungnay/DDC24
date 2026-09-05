# Thiết kế Frontend Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FE-PROG-001` |
| Phiên bản | 1.7 (baseline PGM-02 hiệu lực: 1.5; Target candidate giữ nguyên) |
| Trạng thái | **M3 AS-BUILT baseline + PGM-02 v2.2 TARGET CANDIDATE; Architect exact pin PENDING, code R1/R2/R3 NO-GO** |
| Ngày | 2026-09-06 |
| Chủ quản | Frontend Lead |
| Người review | UX Lead, Backend Lead, Verification Lead |
| Người phê duyệt | Frontend Lead + System Architect |
| Nguồn | `UX-WEB-PROG-001`, `IFSPEC-PROG-001`, `DM-PROG-001`; Candidate `DDD-SW-PGM02-WORKSPACE-001`, `PGM02-WORKSPACE-V1`, `CR-PROG-PGM02-V22-001` |
| Requirement | Baseline `SWR-REQ-PROG-FE-101..118`; Candidate thêm `SWR-REQ-PROG-FE-119` |
| Authority Candidate | Owner mở duy nhất `T59-801`/`PGM02-V22-WP-00`; `PLAN_READY=PENDING`; mọi production code PGM-02 v2.2 `NO-GO` |

> **Phạm vi waiver cũ:** `AUTH-PROG-2026-08-11-03` chỉ áp dụng baseline đã ký,
> không mở quyền code cho PGM-02 v2.2 Candidate. Candidate chỉ được triển khai sau
> khi Product Owner + System Architect pin exact revision/hash và gate increment
> tương ứng chuyển `IMPLEMENT_READY=PASS`.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **FE dựng code như thế nào** cho sáu workspace: thư mục feature, mô hình state, query/mutation, xử lý lỗi và chiến lược test. Trong khi [UI/UX Design](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) nói *người dùng thấy gì*, file này nói *React tổ chức ra sao*. |
| 2. Ai phải đọc file này? | FE Lead và lập trình viên FE (chủ quản); UX đối chiếu với hồ sơ UI/UX; BE đọc §4 để biết FE sẽ gọi gì và kỳ vọng lỗi ra sao; QA đọc §10. |
| 3. Hệ thống hiện tại đang có gì? | Cây làm việc có sáu route canonical: Tổng quan, Chương trình, Điểm & Ánh xạ, Thư viện, Kiểm tra, Runtime. Draft v2 authoring có POU `PROGRAM/FUNCTION/FUNCTION_BLOCK`, Published Signal và Library lifecycle; generated client bám OpenAPI `1.28.0`. Đây chưa phải bản đã deploy/read-back trên Forlinx. |
| 4. Thiết kế mới thay đổi điều gì? | Baseline giữ Published Signal/Library hiện có. Candidate §16.1 thay PGM-02 bằng một shell/Explorer, ST transaction surface, true FBD canvas, Quick Library và ba mode tách truth `EDIT/LIVE/SIMULATE`; `<768` read-only. |
| 5. Team phải sửa module/contract nào? | §16.1: route resolver/shell/mode machine/adapters/Quick Library/canvas/workbench/keyed overlay/simulation UI; chỉ dùng generated OpenAPI typed Draft/reference/diagnostic/LIVE/session contract. |
| 6. Điều gì còn bị chặn? | PGM-02 Candidate chờ Architect exact pin, OpenAPI/producer contracts và task R1/R2/R3; không code từ hồ sơ này. Browser/target/HIL/formal VVP vẫn là evidence riêng sau implementation. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `VS-PROG-U13..U15` và bảng §16.1 tách unit/real-BE browser/producer-chain/target/HIL. Asset hoặc host mock không chứng minh LIVE/Simulation. |

Điều FE **không** sở hữu, nêu sớm để tránh viết nhầm: Draft persistence, tính
diff, readiness, phân quyền, runtime state, chất lượng Point, bên thắng arbitration
và audit. Tất cả đều là sự thật từ server; FE chỉ hiển thị lại.

## 0.1 Cấu trúc theo sáu workspace (Plan 59)

Route và thư mục dưới đây mô tả đúng IA sáu workspace baseline ở
[UX §2–§5](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md). PGM-02 v2.2 Candidate
không được ghi đè As-Built này; overlay route/component mới nằm ở §16.1 và chỉ
thay baseline sau exact-revision pin.

```text
features/programming/
├── ProgrammingRoutes.tsx          6 route canonical + redirect tương thích
├── layout/                        ProgrammingLayout, Header, ContextBar
├── overview/                      PGM-01                     UJ-PROG-01
├── design/                        container chung cho hai route authoring
│   ├── editor/                    PGM-02 Chương trình/POU      UJ-PROG-02/03
│   ├── mapping/                   PGM-03 Điểm/Signal           UJ-PROG-05
│   ├── task/                      tab tương thích cũ
│   └── problems/                  khay dùng chung
├── library/                       PGM-04 Control Library       UJ-PROG-04
├── commission/                    PGM-05 Check + Commission    UJ-PROG-06
└── runtime/                       PGM-06 ba tab
    ├── monitor/                   Runtime, Theo dõi           UJ-PROG-07
    └── service/                   Phiên bản & Bảo trì + DangerZone  UJ-PROG-08
```

Ba ràng buộc kỹ thuật của IA hiện hành:

1. **Programs và Mapping là hai route canonical.** `DesignWorkspacePage` nhận
   prop `route="programs"|"mapping"`; route `/design?tab=` cũ chỉ redirect và
   phải giữ query/hash để deep-link diagnostic không mất ngữ cảnh.
2. **Draft nằm ở cấp workspace, không nằm trong tab.** Nội dung đang gõ và ETag
   giữ trong state của `DesignWorkspacePage`; component tab chỉ nhận props. Nhờ
   vậy đổi tab không mất nội dung và không kích hoạt lưu ngoài ý muốn.
3. **Ba tab dùng chung một truy vấn Draft.** Chỉ một `useDraftQuery` cho cả
   workspace; tab Điểm & Ánh xạ thêm `usePointCatalogQuery` riêng vì danh mục
   Point có nhịp làm mới khác.

| Route | Component | Journey |
|---|---|---|
| `/eng/programming` | `OverviewPage` | `UJ-PROG-01` |
| `/eng/programming/projects/:projectId/programs` | `DesignWorkspacePage route="programs"` | `UJ-PROG-02/03` |
| `/eng/programming/projects/:projectId/mapping` | `DesignWorkspacePage route="mapping"` | `UJ-PROG-05` |
| `/eng/programming/projects/:projectId/library` | `LibraryPage` | `UJ-PROG-04` |
| `/eng/programming/projects/:projectId/commission` | `CheckCommissionPage` | `UJ-PROG-06` |
| `/eng/programming/runtime` | `RuntimeServicePage` | `UJ-PROG-07/08` |

Các chuyển hướng tương thích theo UX §11.1 nằm trong `ProgrammingRoutes.tsx`, dùng
`<Navigate replace>` và giữ nguyên `projectId` cùng query còn lại.

## 1. Vị trí source và ranh giới

Target đặt feature tại `apps/web-ui/src/features/programming/`, dùng AppShell,
RBAC, API client, i18n và state primitives hiện hành. Trang
`features/dashboard/ProgrammingPage.tsx` hiện chỉ là placeholder, không phải
baseline component để mở rộng thành một file lớn.

As-Built `TASK-PROG-201`: `features/programming/fbd/` đã tồn tại với typed model,
validator preview, command reducer và `StructuredFbdEditor`; contract nguồn là
`contracts/programming/fbd_v1.schema.json` và
`fbd_keyboard_commands_v1.json`. Module này chưa được import vào route production,
không gọi API và không có quyền stage/activate Revision.

FE không sở hữu Draft persistence, change diff, readiness, authorization,
runtime state, Point quality, priority winner hoặc audit truth.

## 2. Cấu trúc feature và module dùng chung

> Cây thư mục và danh sách route **là §0.1**, không lặp lại ở đây. Mục này chỉ
> mô tả các module cắt ngang mà cả sáu workspace dùng chung. Nếu §0.1 và §2 có
> vẻ mâu thuẫn thì §0.1 đúng.

```text
features/programming/
├── ProgrammingRoutes.tsx     xem §0.1 — 6 route canonical + redirect
├── api/                      client sinh từ OpenAPI, không viết tay — chi tiết §12
├── fbd/                      As-Built Task 201: model, command reducer, component + test
├── model/                    state model §3 — chi tiết §12
├── layout/                   ProgrammingLayout, Header, ContextBar
├── library/                  Control Library + lifecycle/read-back
├── shared/{StateBadge,ProblemsDrawer,DangerZone}.tsx
└── __tests__/
```

Năm thư mục chứa sáu workspace (`overview/`, `design/`, `library/`,
`commission/`, `runtime/`) và cây con của chúng nằm ở §0.1.

| Module dùng chung | Vì sao cắt ngang |
|---|---|
| `api/` | Cả sáu workspace gọi cùng một client sinh từ OpenAPI; không workspace nào tự viết fetch |
| `model/` | `editing`, POU/signal/library, `check`, `commission`, `core`, `runtime` dùng kiểu tường minh chung (§3), không tự dựng DTO khác contract |
| `layout/` | Context bar phải bền vững khi chuyển workspace, nên nằm trên `<Outlet/>` |
| `shared/ProblemsDrawer` | Dùng ở cả ba tab của `PGM-02` và ở `PGM-05` |
| `shared/DangerZone` | Chỉ `PGM-06` dùng ở Rev A, nhưng đặt ở `shared/` vì quy tắc “tách thao tác nguy hiểm” áp cho mọi màn hình thêm sau này |

## 3. State model

Không tạo một boolean `isRunning`. Store/query projection tối thiểu:

```ts
type ProgrammingViewState = {
  context: { controllerId?: string; projectId?: string };
  editing: {
    draftId?: string; revisionId?: string; baseRevisionId?: string;
    etag?: string; dirty: boolean; save: 'idle'|'saving'|'saved'|'error';
  };
  check: { id?: string; status: 'idle'|'running'|'passed'|'failed'|'timed_out' };
  commission: { operationId?: string; status: OperationState };
  runtime: {
    core: 'RUNNING'|'DEGRADED'|'UNREACHABLE';
    activeRevisionId?: string; state?: RuntimeState; safeState?: SafeState;
  };
  freshness: 'LIVE'|'STALE'|'UNAVAILABLE';
  conflict?: { expected: string; actual: string };
};
```

Server-state dùng query cache theo key controller/project/revision. Editor buffer
có local state nhưng save luôn kèm ETag; browser storage chỉ có draft UI recovery
không authoritative và không được tự Commission.

## 4. Query và mutation

| Hành động | FE behavior |
|---|---|
| Load route | fetch capabilities + project context + runtime độc lập; partial state không che phần còn đọc được |
| Save Draft | mutation batch + If-Match; success cập nhật ETag; 409 mở reload/merge |
| Check | tạo job, subscribe/poll; Problems điều hướng bằng canonical location |
| Commission | refetch readiness/overrides/change manifest ngay trước confirm; POST một lần; theo dõi operation |
| Timeout | state Unknown/Reconcile, query operation/runtime; không replay POST |
| Restore | strong confirmation + same operation pattern |
| Reconnect | invalidate/refetch snapshot; sequence gap không patch từ event thiếu |

## 5. Editor design

### ST

- Adapter editor được lazy-load; source, diagnostics và symbols từ API model.
- Keyboard-first, line/column, go-to, find, format, autocomplete bounded.
- Inline diagnostic chỉ presentation; Check result canonical nằm Problems drawer.
- Toggle `Đang sửa | Theo dõi` là read-only overlay, không online code patch.

### Structured FBD Rev A

- Model là danh sách block/pin/connection có execution order, không phụ thuộc tọa
  độ canvas để quyết định semantics.
- Tree/palette + inspector + ordered workspace; pointer và keyboard dùng cùng command.
- Add/connect/delete/reorder qua command reducer có undo/redo bounded.
- Type compatibility được phản hồi nhanh từ client schema nhưng server Check là authority.
- Không có free-form wiresheet, animated wire, native plug-in hoặc mouse-only flow.

As-Built tại `52dfb57`: `model.ts` khóa graph/network/node/port/wire, type/unit,
UUID/order/capacity; `commands.ts` đọc registry 11 shortcut, giữ history 50,
chặn UUID trùng/sai và mutation khi read-only; `StructuredFbdEditor.tsx` render
ordered network/block/port/wire, toolbar và cùng handler keyboard. Component
chấp nhận Draft chưa hoàn chỉnh và hiển thị issue; chỉ server Check ở task sau
được quyền kết luận Revision hợp lệ.

## 6. Mapping và Point truth

Point picker query theo category/type/direction/writable và hiện producer
timestamp/quality. RTU chọn Bus/Device/Point nhưng binding gửi `{deviceId,pointId}`.
FE không tự tạo ID phẳng, không đổi `UNKNOWN/OFFLINE/STALE` thành zero và không
coerce unit/type để “lưu được”.

Output row luôn có hai trục:

```text
Giá trị Program (mức 5) | Giá trị thực tế | Nguồn đang giữ | Ưu tiên | TTL
```

### 6.1 Published Signal authoring

`PublishedSignalsPanel` chỉ bật cho Draft `schemaVersion=2`. Form dùng stable
`signalId`, tên identifier ASCII 1..64 không trùng/từ khóa, type
`BOOL|INT|DINT|UINT|REAL|TIME`, unit tối đa 32, đúng một producer Program đang
có cấu hình chạy, freshness 1000..90000 ms và một trong ba chính sách UX:
`USE_FALLBACK`, `HOLD_PRIVATE`, `BLOCK_PROGRAM`. Khi gửi API, hai policy sau map
lần lượt thành wire enum `HOLD_LAST` và `WAIT`; enum lạ/`FAIL_CLOSED` không được
âm thầm coerce.

Fallback phải đúng type/range và chỉ bắt buộc/cho phép theo policy. Mutation là
batch Draft có ETag; local validation chỉ hỗ trợ người nhập, BE Check vẫn là
authority cho duplicate publisher, cycle, type và producer existence. Remove
signal phải xác nhận tác động; failure giữ nguyên Draft local và server state.
Mọi read model không có value hợp lệ hiển thị `Không khả dụng`/`Stale` theo
quality; tuyệt đối không dùng `0` làm fallback presentation.

### 6.2 Control Library lifecycle

`LibraryPage` nhóm nhiều revision theo `{scope,entryId}`, chọn DRAFT để sửa hoặc
SemVer cao nhất để hiển thị. SYSTEM là generated/read-only. PROJECT PUBLISHED là
immutable; lần sửa tiếp theo mở DRAFT minor mới ở server. Publish diễn ra cùng
transaction seal Draft, không có nút/API publish giả.

Admin chỉ được chuyển `PUBLISHED → DEPRECATED` bằng
`POST /projects/{projectId}/library/revisions/{libraryRevisionId}/deprecate`
với `If-Match` và `X-Idempotency-Key`. Modal phải nêu revision exact, không áp
dụng cho DRAFT/DEPRECATED/SYSTEM, không optimistic update; success chỉ sau
response receipt và GET read-back xác nhận đúng `libraryRevisionId` ở
`DEPRECATED`. Revision Active/LKG đã pin vẫn load được; lựa chọn mới không được
pin vào deprecated revision.

## 7. Commission UI state machine

```text
LOADING_READINESS → NOT_READY | READY
READY → CONFIRMING → SUBMITTING → APPLYING → VERIFYING
VERIFYING → SUCCEEDED | REJECTED | FAILED | UNKNOWN_RECONCILING
```

- Primary copy: `Kiểm tra`, `Đưa vào vận hành`, `Khôi phục bản trước`.
- Không dùng Build/Deploy/Activate làm action chính.
- Success chỉ sau operation/runtime read-back.
- `UNKNOWN_RECONCILING` giữ modal/page và cho phép `Kiểm tra lại trạng thái`,
  không có nút gửi lại mutation mù.

## 8. RBAC, i18n và accessibility

- Route read mở cho viewer; mutation action disabled cho non-admin với
  `programming.permission.admin`. Backend vẫn là authority.
- Mọi visible copy là i18n key VI/EN; error code map sang message key, không dùng
  raw server message làm default.
- Skip link, một `h1`, landmark, tree/table semantics, focus trap/restore,
  live-region tiết chế cho progress và Problems count.
- State có text+icon; không chỉ màu. FBD keyboard path là release gate.
- Baseline ngoài PGM-02 giữ responsive policy hiện hành. Riêng PGM-02 Candidate:
  `>=1280` full shell, 1024–1279 compact dock, 768–1023 drawer và `<768`
  read-only có **0** mutation control cho ST/FBD/Simulation.

## 9. Error recovery

| Condition | UI |
|---|---|
| 403 | giữ runtime truth, disable mutation, nói thiếu quyền |
| 409 | giữ local buffer, hiển thị base/current và reload/merge |
| 422 | mở Problems, focus object/field/source |
| Core unreachable | runtime stale/unavailable; Draft behavior theo capability; Commission khóa |
| Event gap | refetch REST; không nối sample qua gap |
| Check fail | active panel vẫn hiển thị Revision đang chạy |
| Commission fail | nói rõ active cũ tiếp tục nếu contract xác nhận |

## 10. Test strategy FE

- Unit: reducer/selectors/error mapping/i18n/normalizer.
- Component: editors, mapping, readiness, conflict, permission, Unknown/Stale.
- Vitest integration: query/mutation lifecycle và MSW contract fixtures.
- Playwright: UC-01..13,16,17; keyboard-only FBD; two-client conflict; timeout
  reconcile; desktop/mobile layout.
- Chrome DevTools: snapshot/screenshot, Console error, Network failed request,
  desktop/mobile sau mỗi slice có ảnh hưởng runtime/layout.

`TASK-PROG-201` đã chạy 15 test model/reducer/component, gồm luồng nối hoàn toàn
bằng Arrow/Enter, delete kéo theo wire, undo/redo/history/read-only/identity. Đây
là component evidence, chưa phải browser/E2E workspace. Không claim UI Done khi
chỉ render mock hoặc chưa có producer/API contract.

## 11. As-Built và source migration

**As-Built `TASK-PROG-500..509` (2026-08-13):** `apps/web-ui/src/app/App.tsx`
route `/eng/programming/*` qua `<RequireRole><ProgrammingRoutes/></RequireRole>`
khi `PROGRAMMING_REV_A_ENABLED` (`shared/config.ts`, mặc định OFF production,
bật `1` chỉ cho dev/e2e); `features/dashboard/ProgrammingPage.tsx` (legacy
graph demo) không còn được route tới qua đường Programming — `NavRail.tsx`
cũng chuyển điều kiện hiện mục từ `LEGACY_GRAPH_DEMO_ENABLED` sang
`PROGRAMMING_REV_A_ENABLED`.

| As-Built | Vị trí source |
|---|---|
| `features/programming/ProgrammingRoutes.tsx` | 6 route thật (`overview/programs/mapping/library/commission/runtime`); `/design?tab=` và `/task` là redirect tương thích qua `LegacyDesignRedirect`/`LegacyTabRedirect` |
| `features/programming/layout/{ProgrammingLayout,ProgrammingHeader,ProgrammingContextBar}.tsx` | context `useProgrammingRuntimeContext` hợp nhất route/Project/runtime; hiển thị Controller ID, Project, Draft đang sửa + dirty, Check, Active và Core; không dùng hostname trình duyệt làm controller authority |
| `features/programming/overview/OverviewPage.tsx` | `RunningApplicationPanel`, `CoreSafeStatePanel`, `DraftAttentionPanel`, `ProgrammingAttentionList`, `RecentEngineeringTimeline` — PGM-01 |
| `features/programming/design/{DesignWorkspacePage,useDraftWorkspace}.tsx` + `design/editor/ProgramsTab.tsx` + `design/mapping/MappingTab.tsx` + `design/task/ExecutionTab.tsx` | PGM-02 ba tab dùng chung Draft/ETag; tab luôn mount; pending operation hợp nhất thành dirty guard; save/bỏ/ở lại khi rời trang; Check khóa khi dirty; Task đồng bộ server update nếu không có local edit; ST có line/column/find/format/symbol/type/ref và diagnostic range |
| `features/programming/fbd/*` | **As-Built Task 201**, mount thật vào `ProgramsTab` (không còn placeholder); `StructuredFbdEditor.tsx` thêm `sectionRef`+`tabIndex={-1}` để giữ focus bàn phím sau `DELETE_SELECTION` (sửa lỗi thật TASK-PROG-506) |
| `features/programming/design/mapping/{MappingTab,PublishedSignalsPanel}.tsx`, `model/{draftV2,signals}.ts` | Draft v2 POU/Program/Published Signal authoring; giới hạn field và stale-policy map bám validator BE; invalid/unavailable không thành zero |
| `features/programming/library/LibraryPage.tsx`, `model/library.ts`, `api/mutations.ts` | group revision theo scope/entry, SYSTEM read-only, PROJECT draft/version truth và deprecate `PUBLISHED→DEPRECATED` qua confirm/ETag/idempotency/read-back |
| `features/programming/commission/{CheckCommissionPage,useCommissionWorkflow}.tsx` | PGM-05: query canonical `revisionId/checkId`; readiness chỉ READY khi Check PASS, impact/override đọc được, Core READY và không safe-state; re-auth và `UNKNOWN_RECONCILING` |
| `features/programming/runtime/{RuntimeServicePage,RuntimeTab,WatchTab,VersionsTab,DangerZone,useRestoreWorkflow}.tsx` | PGM-06: Runtime task metric thật; Watch/Trace; Danger Zone chỉ ở Service; Restore chỉ `READY && !safeState`; RETAIN contract-only luôn khóa; Export source-only; Import hash được trên HTTP; history dùng card mobile/focusable audit region |
| `features/programming/layout/ProgrammingMobileNav.tsx` | Bottom navigation `Tổng quan/Thiết kế/Kiểm tra/Runtime` tại `<md`; project-dependent route bị disabled khi chưa có Project thay vì dựng deep-link giả |
| `shared/crypto.ts` | UUID v4: ưu tiên `randomUUID`, fallback `getRandomValues`; không dùng `Math.random`; SHA-256 thuần JS và base64 theo khối cho bundle tối đa 4 MiB |
| `app/App.tsx`, `shared/i18n.tsx` | Protected return URL giữ pathname/search/hash và chặn open redirect; fresh profile mặc định `vi`, chỉ dùng `en` khi giá trị lưu hợp lệ |
| `features/programming/api/{authClient,queries,mutations,errorCopy}.ts` | `useProgrammingApiClient` (Authorization header thật), `useProgrammingResource` factory + hook theo resource, `programmingErrorCopy` map đủ 19 `PRG-ERR-*` |
| `features/programming/api/generated/client.ts`, `features/programming/model/types.ts` | client operation sinh từ OpenAPI v1.28.0, gồm Library deprecate; DTO UI khai báo tường minh cho Draft v2/POU/signal/runtime và được khóa bằng typecheck/contract drift check |
| `app/App.tsx`, `shared/components/NavRail.tsx`, `shared/config.ts`, `features/auth/roles.ts` | cờ `PROGRAMMING_REV_A_ENABLED`, `ROUTE_MIN_ROLE['/eng/programming']='viewer'` |
| `shared/hooks/useWebSocket.ts` | reuse transport hiện có; Programming P5 **không** dùng WS riêng — Runtime/Watch poll qua REST theo freshness contract |
| `shared/i18n.tsx` | copy Programming VI/EN đi qua `pick()` tại chỗ, không namespace file riêng (khác giả định 0.1..0.8) |

## 12. Component, hook, type và ownership

> Cây thư mục baseline hiệu lực **chỉ có một**: `§0.1` cho sáu workspace và `§2` cho các
> module cắt ngang. Mục này **không** lặp lại cây, chỉ mở chi tiết nội dung của
> `api/` và `model/` cùng quyền sở hữu state.

`api/` và `model/` là hai thư mục duy nhất có ràng buộc tên file, vì chúng chứa
mã sinh tự động và ranh giới không được lẫn:

```text
features/programming/api/
├── generated/client.ts     danh mục operation sinh từ OpenAPI — cấm sửa tay
├── authClient.ts           Authorization/correlation/idempotency transport
├── queries.ts              hook resource/polling typed
└── errorCopy.ts            `PRG-ERR-*` sang copy VI/EN

features/programming/model/
├── types.ts                DTO/UI union tường minh dùng bởi sáu workspace
├── draftV2.ts              adapter v1/v2 và canonical Draft v2
├── signals.ts              POU/Signal validation + wire mapping
└── library.ts              group/version/mutability/dependency truth
```

`generated/client.ts` là đầu ra của
`node scripts/generate-programming-client.mjs`; `npm run
check:programming-api` phải fail khi lệch `contracts/openapi/openapi.yaml`.
Không tồn tại `client.generated.ts` hoặc `models.generated.ts` trong As-Built.

| State | Owner | Persistence/lifecycle |
|---|---|---|
| selected controller/project/revision | URL + context | route stable/shareable; validate against query |
| server Project/Draft/Runtime/Operation | query cache | REST authority; invalidated by event/generation |
| unsaved editor buffer | local reducer | per Draft/tab; never overwrites newer server ETag |
| modal/selection/panel | component | ephemeral; reset on project switch |
| operation progress | server query + reducer projection | survives reload; no optimistic terminal |
| monitor samples | bounded ring buffer | drop/gap/stale explicit; never global unbounded store |

Query keys chuẩn: `['programming', controllerId, resource, id, filters]`. Runtime
stale time bằng freshness contract, không cache như config. Mutation callback chỉ
invalidate/refetch keys declared; không `setQueryData` Active khi Commission POST.

## 13. Mutation và error algorithm

```text
saveDraft(buffer, etag):
  freeze canonical operation batch
  send If-Match + idempotency key
  on success replace server snapshot/etag, keep only edits after send
  on 409 preserve local buffer; show base/current/local diff choices
  on network unknown query resource/idempotency result before replay
```

Commission reducer chỉ nhận server states trong lifecycle spec. Invalid backward
transition hoặc missing fields chuyển `UNKNOWN` + refetch, không silently coerce.
Idempotency key tạo một lần khi user confirm, giữ qua retry/reload trong session
storage scoped controller/action; xóa khi authoritative terminal/expiry.

| Public error | UI action |
|---|---|
| `PRG-ERR-CONFLICT/OP` | conflict/reconcile panel, giữ local input |
| `PRG-ERR-MAP/CHECK/SCOPE` | Problems + focus field/node/line |
| `PRG-ERR-ARTIFACT/TARGET` | block Commission, hiển thị target/detail sanitized |
| `PRG-ERR-CUTOVER/RETAIN` | impact remediation/ack flow, không auto-reset |
| `PRG-ERR-UNAVAILABLE` | stale/unknown banner, polling backoff, no blind POST |

## 14. Security, performance và accessibility

- `RequireRole` chỉ là UX guard; BE là authority. Source/diagnostic render text,
  không dangerously set HTML. No token/source in localStorage/log/analytics.
- Large editor/FBD/mapping dùng virtualization nhưng giữ keyboard/screen-reader
  alternative. Parse/highlight local worker không quyết semantic; worker cap/time.
- Monitor ring tối đa capability sample; render throttled ≤10 Hz; reconnect
  exponential bounded và REST snapshot after sequence gap.
- Route-level lazy load Programming, error boundary riêng; failure editor không
  phá runtime/status panel. Unsaved prompt có accessible focus/copy theo UX spec.

## 15. Verification, deploy và rollback

| Test ID | Layer | Expected |
|---|---|---|
| `FE-T-001` | reducer/selectors | all valid/invalid operation transitions deterministic |
| `FE-T-002` | MSW contract | OpenAPI examples parse; unknown enum fails visible |
| `FE-T-003` | two-client ETag | local buffer preserved; no lost update |
| `FE-T-004` | 504/reload/reconnect | operation reconciles; no duplicate POST/optimistic active |
| `FE-T-005` | event gap/stale | REST refetch; samples gap and stale labeled |
| `FE-T-006` | RBAC/revoke/CSRF | mutation disabled/403 handled; no secret logged |
| `FE-T-007` | keyboard/desktop/mobile | UX-T-001..005 PASS |
| `FE-T-008` | build/lint/Vitest/Playwright/browser | all gates + Console/Network evidence |
| `FE-T-009` | POU/Published Signal component | v1 disabled; v2 add/edit/remove; producer/type/range/policy/invalid/unavailable exact |
| `FE-T-010` | Library lifecycle component/contract | SYSTEM immutable; DRAFT/PUBLISHED/DEPRECATED actions; confirm, ETag, idempotency, receipt và read-back |
| `FE-T-011` | browser desktop/mobile Plan 59 | sáu route, focus/modal, Console 0 lỗi và không có Programming Network request thất bại ngoài case cố ý |

Deploy theo server capability và cờ FE/BE. Bản Foxlinx lịch sử của
`TASK-PROG-507` không chứng minh bundle Plan 59 hiện tại; POU/Signal/Library mới
phải được build, ghi exact SHA-256, deploy và read-back lại. Rollback route trả
unavailable/read-only mà không xóa Draft/operation;
service worker/cache must not serve incompatible generated types.

**As-Built deploy `TASK-PROG-507`:** giai đoạn đầu bật cờ trong drop-in `/run`
và state/database riêng để bắt drift mà không chạm runtime. Sau khi cài đủ
compiler/Core, sửa tương thích safe-state legacy và chạy Check/Commission
output-free thành công, bundle FE và env BE production được bật `ON` vĩnh viễn.
Không còn drop-in/fixture tạm; bằng chứng/hash/rollback tại `EV-PROG-P5-507`.

**As-Built `FE-T-007/008` (TASK-PROG-506, 2026-08-13):** `e2e/programming.spec.ts`
chạy Chrome thật (Playwright, không jsdom) trên `desktop-chrome` và
`mobile-chrome` (Pixel 7) — 2/2 PASS mỗi project cho toàn bộ `UJ-PROG-01..08` +
redirect route cũ; FBD dùng đúng phím thật (`Insert/ArrowDown/Enter/Delete/
Control+z`) không click chuột. `network-qa.spec.ts` 1/1 PASS; full e2e suite
60/60 PASS, không hồi quy. Console/Network được kiểm trong suốt hành trình
(không có error/failed request ngoài whitelist 503 contract-only ở bản đó).
Corrective E2E 508/509 xóa kỳ vọng 503 contract-only cho Monitor/Trace, lưu Draft
trước Check và khóa trace create/stop trên desktop/mobile. Chưa có
contrast/axe scan độc lập và chưa xác nhận route HMI vắng mặt trong cùng
phiên — `VS-PROG-028` vẫn chỉ "hỗ trợ một phần" (VVP §11.5), không PASS đầy
đủ.

## 16. Page-to-code và data dependency mức triển khai

Bảng dưới đây dùng **đúng sáu route canonical** của `§0.1`. Programs và Mapping
là hai route đích; `/design?tab=` và `/task` là lối vào cũ được redirect. Ba tab
của Runtime vẫn là trạng thái `?tab=` trong một route.

| Route | Page/container target | Query bắt buộc | Mutation | Empty/error owner |
|---|---|---|---|---|
| `/eng/programming` | `OverviewPage` | capability, projects, active/runtime, attention, `overrides?activeOnly=true` | không | page giữ active truth khi Draft query lỗi |
| `.../projects/:projectId/programs` | `DesignWorkspacePage route="programs"` | Draft v2 objects/program configs, symbols, diagnostics | save POU/task Draft, create Check | editor buffer + Problems |
| `.../projects/:projectId/mapping` | `DesignWorkspacePage route="mapping"` | Draft bindings/signals + paged Point catalog | save binding/signal batch | row/form field + summary |
| `.../projects/:projectId/library` | `LibraryPage` | SYSTEM registry, PROJECT revisions, Draft usage | save/delete Draft entry; deprecate Published revision | immutable/dependency/conflict/read-back panel |
| `.../projects/:projectId/commission` | `CheckCommissionPage` | readiness/impact/active/overrides | begin Check, begin operation | persistent UNKNOWN/reconcile |
| `/eng/programming/runtime?tab=runtime\|watch\|service` | `RuntimeServicePage` | runtime/monitor/trace/revisions/audit theo tab | restore/import/reset RETAIN ở tab `service` | stale/gap/read-only |

Programs và Mapping dùng cùng Draft aggregate/ETag; Mapping thêm Point Catalog.
Redirect cũ giữ project/query/hash; tab Runtime không hợp lệ rơi về `runtime`.

Query key luôn chứa controller/project/revision/resource version phù hợp; không
dùng key chỉ `programming`. Mutation thành công invalidate đúng aggregate; event
chỉ update cache khi sequence/resource version hợp lệ, còn lại invalidate/refetch.

| Layer target | Public contract | Không được chứa |
|---|---|---|
| `api/client.generated.ts` | typed HTTP adapter sinh từ OpenAPI | sửa tay, toast/copy, business decision |
| `api/{queries,mutations}.ts` | hook query/mutation, orchestration | authority validation |
| `api/{errors,events}.ts` | chuẩn hóa `PRG-ERR-*`, envelope/sequence sự kiện | quyết định hiển thị |
| `model/types.ts` | generated DTO + explicit UI discriminated union | `any`, fake default |
| `model/*Reducer.ts` | editing/check/operation/core/runtime transition | HTTP calls/component state |
| `layout/`, `shared/` | presentational props/a11y | direct fetch/global mutation |
| `overview/`, `design/`, `commission/`, `runtime/` | route composition/error boundary | duplicated domain types |

### 16.1 PGM-02 v2.2 Target Candidate — R1/R2/R3

Phần này là overlay Target cho PGM-02; §11 vẫn là As-Built. Không xóa/rewrite
domain FBD hoặc Draft adapters đã đúng. Mọi component Target phải nằm sau
capability/feature flag riêng và fail closed khi producer chưa khớp version.

```text
ProgrammingRoutes
└── /eng/programming/programs?project=&pou=&mode=
    └── ProgramsWorkspaceShell
        ├── ProgrammingContextStrip + ProgrammingProjectContext
        ├── ProgramModeMachine (EDIT | LIVE | SIMULATE)
        ├── PouExplorer                 selection = objectId
        ├── StTransactionSurface | FbdNodeEdgeCanvas
        ├── QuickLibraryPanel | PouInspector
        └── ProgrammingWorkbench
            ├── Problems ├── Watch ├── Trace
            └── Search   └── CrossReference
```

| Slice | State/data authority | FE hành vi bắt buộc | Mutation |
|---|---|---|---|
| R1 EDIT | Saved Draft typed v1/v2 + ETag + `objectId`; Library signature SYSTEM/PROJECT | resolver 0/1/nhiều/invalid Project; một Explorer; insert/refactor/reference/diagnostic exact; read-back sau save | admin qua server; một editor transaction/Undo; analysis/cancel/conflict zero mutation |
| R2 LIVE | immutable Active Revision + tuple `controllerId/activeRevisionId/programId/observationId/snapshotSequence/quality` | tải runtime rồi sealed source; keyed overlay ≤10 Hz; gap/cutover clear+rejoin; missing/stale/offline không thành zero | **không có** cho mọi role |
| R3 SIMULATE | capability + immutable Saved-Draft snapshot + server session/read model | nhãn `SIMULATION — NO REAL OUTPUT`; virtual input/Watch/Trace; RUN/PAUSE/STEP/RESET/SPEED/STOP theo state | server admin-only; viewer/operator/admin chỉ đọc theo object scope |

`objectId` và `programId` là hai identity khác nhau. Query `pou` luôn là
`objectId`; runtime join chỉ dùng mapping được seal trong Active Revision. FE
không so tên, không suy UUID và không overlay khi document/value tuple mismatch.

Quick Library không có danh sách ST/FBD viết tay. `QuickLibraryPanel` normalize
public `ProgrammingLibrarySignature`; chỉ hiện `FUNCTION`/`FUNCTION_BLOCK`.
FUNCTION insert call template. FUNCTION_BLOCK tìm/chọn hoặc tạo instance rồi
insert declaration+invocation. FBD drop/keyboard insert dùng canonical
node/port/wire model và `port.order`; Insert & Connect chỉ tự nối khi đúng một
port compatible, còn ambiguity mở chooser. Cancel/type mismatch/signature
unavailable không đổi document, history hoặc Recent.

| Source Target | Trách nhiệm | Giữ/reuse |
|---|---|---|
| `features/programming/ProgrammingRoutes.tsx` | canonical route, legacy redirect và allowlisted deep-link | auth/layout route guards |
| `features/programming/programs/{ProgramsWorkspaceShell,ProgrammingProjectContext}.tsx` | shell/context/resolver/mode buffers | `useDraftWorkspace`, generated hooks |
| `features/programming/programs/programModeMachine.ts` | transition/capability/dirty guard tách ba mode | discriminated union, không boolean `isRunning` |
| `features/programming/design/PouTree.tsx` → adapter `PouExplorer` | một tree, objectId selection, semantic action | Draft v2 grouping/identity |
| `features/programming/design/editor/*` | ST transaction/diagnostic/reference/overlay adapters | tokenizer/history/find/format hiện có |
| `features/programming/fbd/{model,commands}.ts` | canonical graph/commands/undo/port order | **KEEP/EXTEND**, không rewrite |
| `features/programming/fbd/FbdNodeEdgeCanvas.tsx` | renderer/controller node-edge, keyboard/pan/zoom/snap | validator/reducer hiện có |
| `features/programming/library/QuickLibraryPanel.tsx` | search/category/signature/atomic insert | PGM-04 catalog/query; không fallback registry UI |
| `features/programming/programs/workbench/*` | Problems/Watch/Trace/Search/References | shared panels/adapters, mode-aware source |
| `features/programming/programs/live/*` | sealed document + keyed observation store | generated runtime/monitor/trace client |
| `features/programming/programs/simulation/*` | capability/session/controls/input/observation | generated API only; cấm browser executor |

Budget Target theo `PGM02-WORKSPACE-V1`: Programming chunk gzip R1/R2/R3 lần
lượt `<=125/145/165 KiB`; typing p95 `<=50 ms`; pointer-to-paint p95 `<=32 ms`;
open POU p95 `<=250 ms`; steady JS heap `<=96 MiB`; mỗi mode switch tăng
`<=5 MiB`; FBD `<=256` node/`<=512` edge. Topology và observation store tách
nhau để sample không re-render toàn canvas. Breakpoint/focus/contrast theo
`UX-REQ-027`; `<768` không render Edit/Insert/Save/Check/Simulation controls.

| Verification Candidate | Fixture/expected | Evidence/authority |
|---|---|---|
| `FE-PGM02-R1-01` | 0/1/2 Project, invalid deep-link; 15 Draft op; ST/FBD/library/refactor/diagnostic; exact read-back và zero mutation lỗi | unit/component + real-BE browser; nối `VS-PROG-U13` |
| `FE-PGM02-R2-01` | Active cutover, hash mismatch, sequence gap, stale/offline/missing; old overlay clear trong ≤1 render cycle | producer→IPC→BE→FE + target fault; nối `VS-PROG-U14` |
| `FE-PGM02-R3-01` | role matrix, capability absent/mismatch, deterministic step, quota/expiry/crash và zero physical-output | HTTP/browser + target/HIL signed result; nối `VS-PROG-U15` |
| `FE-PGM02-NFR-01` | 1280×750/1024/768/390, keyboard/axe/reduced motion, chunk/latency/heap/canvas max | browser performance/a11y report theo từng increment |

Rollback từng increment chỉ tắt capability/route consumer tương ứng và giữ
Draft/Revision/Active/LKG. R2 rollback hủy overlay/subscription, không gửi
lifecycle command. R3 rollback reject create, stop/reap session rồi gỡ worker;
session ephemeral không được phục hồi sau reboot.

## 17. Blocker, lịch sử và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| PGM-02 v2.2 exact revision/hash chưa được pin | Product Owner + System Architect + Document Control | Review/reconcile Product/SRS/Architecture/DDD/UX/assets/contracts/Risk/Trace/VVP/Plan59; harness và candidate pin PASS; ký exact Candidate trước khi tạo quyền code |
| R1 typed Draft/signature/reference/refactor/diagnostic contract chưa Active | BE + Compiler + FE Leads | OpenAPI/generated client/error/generator pin; `IMPLEMENT_READY[PGM02-R1]=PASS` |
| R2 producer tuple/lifecycle/Trace coherence chưa có evidence | Core/Runtime + BE + FE + QA | producer→IPC→BE→FE/read-back contract và fault/concurrency tests; `IMPLEMENT_READY[PGM02-R2]=PASS` |
| R3 worker/session/isolation contract chưa Active | Architect + Security + Runtime + BE + FE | isolated worker/RBAC/audit/quota/zero-output plan pin; `IMPLEMENT_READY[PGM02-R3]=PASS` |
| `S5-F` usability test cần người dùng thật | UX Lead + Product | `≥5` kỹ thuật viên BMS thật chưa từng dùng sản phẩm + fixture `AHU-01` trên controller lab (Plan 53 §5.9) |
| `VS-PROG-027/029/030` cần soak/power-fault/HIL vật lý | Core + HW + QA | Board/HIL fixture theo Plan 53 P6 |
| Test Result chính thức cho `VS-PROG-020/022/025/026/028/032` | Verification Lead | Target supporting evidence đã có; executor + reviewer độc lập chạy/ký theo VVP §11 |
| POU/Signal/Library Plan 59 chưa có exact merged/deployed commit | FE Lead + Dev Lead | chạy affected FE gate, merge exact commit, build SHA và deploy/read-back Forlinx MCU FAKE |
| Browser evidence cho bundle Plan 59 chưa chạy | FE + QA | desktop/mobile sáu route; modal deprecate và signal authoring; Console/Network raw evidence |
| Target soak 24 giờ/formal VVP chưa chạy | Runtime + QA + Verification Lead | `TARGET_FAKE_MCU_SOAK` đủ 24 giờ và formal VVP độc lập; CI `SKIPPED_BY_OWNER` không phải PASS |
| Positive Monitor/Trace target có Variable Binding | FE + BE + Core + QA | fixture read-only an toàn; kiểm row truth và start/get/stop, lưu raw output |
| Accessibility review độc lập | Accessibility Reviewer + QA | Review raw/browser evidence axe 8/8 scan và bundle 508/509; ký Test Result, không suy `T=Y` từ tool run của implementer |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.7 | 2026-09-06 | `ISS-PGM03-06`/`#559`: đồng bộ source mapping và ownership theo IA sáu workspace; Check/Commission thuộc PGM-05, Runtime/Bảo trì thuộc PGM-06. Không đổi contract/runtime. |
| 0.1 | 2026-08-09 | Feature/state/query/editor/commission/test baseline |
| 0.2 | 2026-08-09 | Bổ sung As-Built migration, source ownership, algorithms, security, deploy và test M3 |
| 0.3 | 2026-08-09 | Bổ sung route/page/query/mutation/empty-error ownership, query-key và layer contract; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; ghi bẫy `npm test` chỉ quét `src/` |
| 0.5 | 2026-08-09 | Amendment A1: thêm §0.1 cấu trúc thư mục và route cho bốn workspace, ba ràng buộc về tab/Draft/truy vấn dùng chung, và bảng năm chuyển hướng route cũ |
| 0.6 | 2026-08-09 | Đóng finding P1-01: xóa cây thư mục và tám route `/engineering/programming/...` cũ khỏi §2 để chỉ còn **một** kiến trúc route hiệu lực; §2 chuyển thành mô tả module cắt ngang; metadata nhận `FE-101..115` |
| 0.7 | 2026-08-10 | Đóng finding consumer review `F-CR-01` — phần còn sót của P1-01: §12 và §16 vẫn mô tả IA sáu trang. §12 bỏ cây thư mục trùng, chỉ giữ chi tiết `api/`/`model/` và đánh dấu `*.generated.ts` là đầu ra sinh mã; §16 thay sáu dòng route cũ bằng đúng bốn route `PGM-01..04` với tab `?tab=`, và bảng layer đổi sang tên thư mục có thật ở §0.1/§2 |
| 0.8 | 2026-08-11 | Đồng bộ `TASK-PROG-201` tại `52dfb57`: FBD model/validator, registry 11 lệnh, reducer history 50/read-only và component keyboard-first; 15 test PASS. Giữ route/workspace/API/browser ở Task 500..502 và không nâng Test Result release |
| 0.9 | 2026-08-13 | Đồng bộ As-Built `TASK-PROG-500..506` (`e58c745`..`14a9299`): bốn workspace `PGM-01..04` dựng xong nối BE thật, route legacy demo không còn được vào qua Programming, §11/§15/§17 viết lại theo source thật (không còn "target action" dự kiến). Thêm bằng chứng Chrome/Playwright thật desktop+mobile (`EV-PROG-P5-500-506`, VVP §11.5) và hai lỗi ứng dụng thật phát hiện+sửa qua chính E2E (tab unmount mất nội dung đang gõ; FBD mất focus bàn phím sau Delete). `S5-F` usability người thật vẫn BLOCKED, không có đường tắt |
| 1.0 | 2026-08-13 | Đồng bộ `TASK-PROG-507` (`9606906`+`6069de6`+`d9a8e3b`): browser Foxlinx phát hiện và sửa WS Origin 403, Check target profile 400 và conflict giả 409 sau seal. `ProgrammingProject.baseRevisionId` trở thành authority cho save/seal; test khóa request. Chrome desktop/mobile target sạch Console, Revision `201` + Check `202`; trạng thái cuối bundle/BE flag OFF, API 404, không Commission. `EV-PROG-P5-507` là supporting target evidence, không Test Result. |
| 1.1 | 2026-08-13 | Hoàn tất target `TASK-PROG-507` tại `0f1526c`: cài compiler/Core/Web/FE ARM64, bật cờ FE/BE production; hai Check `PASSED`, Commission output-free `SUCCEEDED/COMMITTED`, Core read-back Active/LKG/Task `RUNNING`. Chrome Foxlinx desktop/mobile sạch Console/Network. Supporting target evidence không tự nâng Test Result/HIL. |
| 1.2 | 2026-08-13 | Audit `REV-PROG-FE-UX-2026-08-13` mở corrective slice 508..510 và sửa As-Built: context Controller/Project/Draft dirty/Check/Active/Core; ST tooling + metadata; dirty guard/deep-link; readiness fail-closed; Runtime metric; Watch/Trace thật; Danger Zone đúng tab. Sửa thêm regression Task order stale do ba tab luôn mount. Source 508/509 đang VERIFYING; target bản mới BLOCKED do SSH, nên không kế thừa `EV-PROG-P5-507`. |
| 1.3 | 2026-08-13 | `EV-PROG-P5-510`: FE 62 file/510 test, lint/build và Playwright PASS; thêm `@axe-core/playwright`, quét WCAG A/AA bốn workspace desktop/mobile. Foxlinx corrective có 0 Console error/warn, 0 failed Programming request, axe 8/8 scan 0 violation; rollback/tái deploy PASS. Source chưa merge, positive binding target/usability/reviewer độc lập còn mở. |
| 1.4 | 2026-08-13 | Đóng audit live 1.2 ở mức implementation/supporting evidence: HTTP-safe UUID/SHA, full return URL, live batch Save+hoàn nguyên, READY-only Restore, RETAIN fail-closed contract-only, safe-state detail, Export/Import, mặc định vi, bottom nav/card mobile và sửa hai finding axe. Artifact cuối Foxlinx hash `30ee0743…`; axe live 6/6 sạch. Positive binding/recommission/usability/Test Result vẫn mở. |
| 1.5 | 2026-08-24 | Đồng bộ Plan 59 với IA sáu route, Draft v2 POU/Published Signal và Library `PUBLISHED→DEPRECATED`; khóa invalid/stale/unavailable không thành zero và tách host/browser/Forlinx MCU FAKE/soak/VVP/HIL evidence. |
| 1.6-candidate | 2026-08-24 | Thêm overlay Detailed Design FE PGM-02 v2.2 cho route/shell/identity/Quick Library/ST/FBD/Workbench và ba increment; khóa `<768` read-only, budget/test/source map; Owner mở WP-00, Architect pin và code R1/R2/R3 còn PENDING/NO-GO. |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| FE + UX + BE + Core + QA + Ops | **PLAN 59 IMPLEMENTATION_CLOSE PENDING** | source POU/Signal/Library hiện tại; còn affected FE gates, browser và exact merged commit |
| Frontend Lead + System Architect | **APPROVED FOR IMPLEMENTATION; RELEASE NO-GO** | Forlinx MCU FAKE deploy/soak và formal VVP `NOT_RUN`; HIL `DEFERRED_NO_HARDWARE` |
| Product Owner — PGM-02 v2.2 | **APPROVED CHANGE REQUEST / WP-00 ONLY** | `CR-PROG-PGM02-V22-001`; không thay exact Candidate sign-off |
| System Architect — PGM-02 v2.2 | **PENDING exact revision/hash pin** | mọi production code R1/R2/R3 `NO-GO` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §17 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 ranh giới; nêu rõ FE **không** sở hữu Draft/quyền/runtime truth |
| `DD-03` As-Built | PASS | §11 dẫn sáu route, `PublishedSignalsPanel`, `LibraryPage`, `api/*` và `model/{types,draftV2,signals,library}`; nêu rõ source chưa có target evidence mới |
| `DD-04` Target ownership | PASS | §2/§12 baseline; §16.1 khóa owner/state/source Target Candidate PGM-02 |
| `DD-05` Data từng field | PASS | §3 mô hình state; §12 kiểu dữ liệu; hợp đồng field chi tiết ở UI/UX §19 |
| `DD-06` Interface | PASS | §4 query và mutation; đường dẫn chính xác tra ở UI/UX §24 và `IFSPEC-PROG-001` |
| `DD-07` State/algorithm | PASS | §7 state machine Commission; §13 thuật toán mutation và xử lý lỗi |
| `DD-08` UX flow | PASS | §5 editor, §6 mapping, §16/§16.1 ánh xạ trang ↔ code/flow/mode/asset; §8 RBAC/i18n/accessibility |
| `DD-09` Error/safety/security | PASS | §9 phục hồi lỗi; §14 security/performance/accessibility; không optimistic active, không tự replay |
| `DD-10` Repository mapping | PASS | §0.1 cây thư mục sáu workspace; §1, §2, §11, §12 và §16.1 — đường dẫn cụ thể trong `apps/web-ui/src/` |
| `DD-11` Verification | PASS | §10/§15 baseline và §16.1 tách R1 real-BE, R2 producer chain, R3 target/HIL zero-output và NFR |
| `DD-12` Compatibility/deploy/rollback | PASS | §15 deploy và rollback; §0.1 năm chuyển hướng route (nay đã As-Built ở `ProgrammingRoutes.tsx`); chi tiết rollout/cờ/migration ở UI/UX §11.1 và §28 |
| `DD-13` Trace/risk/decision/sign-off | PASS baseline; **BLOCKED cho PGM-02 implementation và release** | Owner: Product Owner + System Architect; gate `T59-801/PLAN_READY`; mở khi exact Candidate pin + harness PASS. Sau đó mỗi increment cần gate/test riêng; release vẫn cần target/HIL. |

Blocker có đủ owner/ảnh hưởng/gate/điều kiện mở. Evidence lịch sử
`EV-PROG-P5-510` không được tái sử dụng để xác nhận bundle Plan 59 mới. Assurance,
usability người dùng thật (`S5-F`) và chữ ký Test Result độc lập vẫn tách riêng.
Nhắc lại bẫy của repo: `npm test`
chỉ quét `src/`, muốn chạy E2E phải gọi Playwright riêng
(`npx playwright test e2e/programming.spec.ts`).
