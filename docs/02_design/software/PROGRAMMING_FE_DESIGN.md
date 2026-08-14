# Thiết kế Frontend Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FE-PROG-001` |
| Phiên bản | 1.4 |
| Trạng thái | **M3 AS-BUILT; audit live 1.2 đã corrective/deploy và tái kiểm 1.3, source chưa merge; assurance/release còn chặn** |
| Ngày | 2026-08-13 |
| Chủ quản | Frontend Lead |
| Người review | UX Lead, Backend Lead, Verification Lead |
| Người phê duyệt | Frontend Lead + System Architect |
| Nguồn | `UX-WEB-PROG-001`, `IFSPEC-PROG-001`, `DM-PROG-001` |
| Requirement | `SWR-REQ-PROG-FE-101..115` |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và browser/evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **FE dựng code như thế nào** cho bốn workspace: thư mục feature, mô hình state, query/mutation, xử lý lỗi và chiến lược test. Trong khi [UI/UX Design](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) nói *người dùng thấy gì*, file này nói *React tổ chức ra sao*. |
| 2. Ai phải đọc file này? | FE Lead và lập trình viên FE (chủ quản); UX đối chiếu với hồ sơ UI/UX; BE đọc §4 để biết FE sẽ gọi gì và kỳ vọng lỗi ra sao; QA đọc §10. |
| 3. Hệ thống hiện tại đang có gì? | Bốn workspace `/eng/programming/*` đang chạy tại endpoint HTTP Foxlinx. Audit 1.3 đã sửa UUID/SHA trên insecure context, deep-link, batch save, fail-closed Restore/RETAIN, safe-state attention, Export/Import, i18n/mobile/a11y; Monitor/Trace positive binding còn thiếu. |
| 4. Thiết kế mới thay đổi điều gì? | Context bar dùng Controller ID từ runtime và đủ Project/Draft dirty/Check/Active/Core; ST editor có line/column/find/format/symbol/type/ref/diagnostic; Draft guard theo batch; Commission deep-link; readiness fail-closed; Watch/Trace tiêu thụ read model thật xuyên Core→BE. |
| 5. Team phải sửa module/contract nào? | §11/§12: `layout`, `design`, `commission`, `runtime`, `api/generated/client.ts`, OpenAPI; phía producer liên quan ở BE/Core được mô tả trong `DDD-BE-PROG-001` và `DDD-FWSOM-PROG-001`. |
| 6. Điều gì còn bị chặn? | Source corrective chưa merge; positive Monitor/Trace có binding target, reviewer accessibility độc lập, `S5-F` usability và Test Result/HIL vẫn là assurance gate. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `REV-PROG-FE-UX-2026-08-13` v1.3 và `EV-PROG-P5-510` v1.1: HTTP live Save+hoàn nguyên/Export/invalid Import, safety gates, desktop/mobile và axe 6/6; host FE 64 file/521 test, Programming 10/10 trên profile thiếu `randomUUID/subtle` và Network QA 1/1. Supporting evidence không đổi 0/32 Test Result PASS. |

Điều FE **không** sở hữu, nêu sớm để tránh viết nhầm: Draft persistence, tính
diff, readiness, phân quyền, runtime state, chất lượng Point, bên thắng arbitration
và audit. Tất cả đều là sự thật từ server; FE chỉ hiển thị lại.

## 0.1 Cấu trúc theo bốn workspace (Amendment A1)

Route và thư mục bám đúng IA bốn workspace ở
[UX §3](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) và cây component ở UX §22.
Chờ [`OD-PROG-016`](../../00_governance/PROGRAMMING_OPEN_DECISIONS.md); nếu bị
từ chối thì quay lại năm thư mục route của IA sáu trang.

```text
features/programming/
├── ProgrammingRoutes.tsx          4 route + 5 redirect từ route cũ
├── layout/                        ProgrammingLayout, Header, ContextBar
├── overview/                      PGM-01                     UJ-PROG-01
├── design/                        PGM-02  một workspace, ba tab
│   ├── DesignWorkspacePage.tsx    đọc/ghi ?tab= trong query
│   ├── editor/                    tab Chương trình            UJ-PROG-02
│   ├── mapping/                   tab Điểm & Ánh xạ           UJ-PROG-03
│   ├── task/                      tab Thực thi                UJ-PROG-04
│   └── problems/                  khay dùng chung cho ba tab
├── commission/                    PGM-03  Check + Commission  UJ-PROG-05/06
└── runtime/                       PGM-04  ba tab
    ├── monitor/                   Runtime, Theo dõi           UJ-PROG-07
    └── service/                   Phiên bản & Bảo trì + DangerZone  UJ-PROG-08
```

Ba ràng buộc kỹ thuật do việc gộp IA sinh ra:

1. **Tab là trạng thái URL, không phải route.** `DesignWorkspacePage` đọc
   `?tab=` và ghi lại bằng `replace` để không làm bẩn lịch sử trình duyệt. Tab
   không hợp lệ rơi về `programs`.
2. **Draft nằm ở cấp workspace, không nằm trong tab.** Nội dung đang gõ và ETag
   giữ trong state của `DesignWorkspacePage`; component tab chỉ nhận props. Nhờ
   vậy đổi tab không mất nội dung và không kích hoạt lưu ngoài ý muốn.
3. **Ba tab dùng chung một truy vấn Draft.** Chỉ một `useDraftQuery` cho cả
   workspace; tab Điểm & Ánh xạ thêm `usePointCatalogQuery` riêng vì danh mục
   Point có nhịp làm mới khác.

| Route | Component | Journey |
|---|---|---|
| `/eng/programming` | `OverviewPage` | `UJ-PROG-01` |
| `/eng/programming/projects/:projectId/design` | `DesignWorkspacePage` | `UJ-PROG-02/03/04` |
| `/eng/programming/projects/:projectId/commission` | `CheckCommissionPage` | `UJ-PROG-05/06` |
| `/eng/programming/runtime` | `RuntimeServicePage` | `UJ-PROG-07/08` |

Năm chuyển hướng bắt buộc theo UX §11.1 nằm trong `ProgrammingRoutes.tsx`, dùng
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
> mô tả các module cắt ngang mà cả bốn workspace dùng chung. Nếu §0.1 và §2 có
> vẻ mâu thuẫn thì §0.1 đúng.

```text
features/programming/
├── ProgrammingRoutes.tsx     xem §0.1 — 4 route + 5 redirect
├── api/                      client sinh từ OpenAPI, không viết tay — chi tiết §12
├── fbd/                      As-Built Task 201: model, command reducer, component + test
├── model/                    state model §3 — chi tiết §12
├── layout/                   ProgrammingLayout, Header, ContextBar
├── shared/{StateBadge,ProblemsDrawer,DangerZone}.tsx
└── __tests__/
```

Bốn thư mục workspace (`overview/`, `design/`, `commission/`, `runtime/`) và
cây con của chúng nằm ở §0.1.

| Module dùng chung | Vì sao cắt ngang |
|---|---|
| `api/` | Cả bốn workspace gọi cùng một client sinh từ OpenAPI; không workspace nào tự viết fetch |
| `model/` | `editing`, `check`, `commission`, `core`, `runtime` là một cây state duy nhất (§3), không tách theo workspace |
| `layout/` | Context bar phải bền vững khi chuyển workspace, nên nằm trên `<Outlet/>` |
| `shared/ProblemsDrawer` | Dùng ở cả ba tab của `PGM-02` và ở `PGM-03` |
| `shared/DangerZone` | Chỉ `PGM-04` dùng ở Rev A, nhưng đặt ở `shared/` vì quy tắc “tách thao tác nguy hiểm” áp cho mọi màn hình thêm sau này |

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
- Desktop >=1440 đầy đủ; 1024–1439 panel co; <1024 cho read/light edit và cảnh
  báo khuyến nghị desktop khi authoring FBD.

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
| `features/programming/ProgrammingRoutes.tsx` | 4 route thật (`overview/design/commission/runtime`) + 3 `<Navigate>` redirect route cũ (`programs/mapping/task` → `design?tab=`) qua `LegacyTabRedirect` |
| `features/programming/layout/{ProgrammingLayout,ProgrammingHeader,ProgrammingContextBar}.tsx` | context `useProgrammingRuntimeContext` hợp nhất route/Project/runtime; hiển thị Controller ID, Project, Draft đang sửa + dirty, Check, Active và Core; không dùng hostname trình duyệt làm controller authority |
| `features/programming/overview/OverviewPage.tsx` | `RunningApplicationPanel`, `CoreSafeStatePanel`, `DraftAttentionPanel`, `ProgrammingAttentionList`, `RecentEngineeringTimeline` — PGM-01 |
| `features/programming/design/{DesignWorkspacePage,useDraftWorkspace}.tsx` + `design/editor/ProgramsTab.tsx` + `design/mapping/MappingTab.tsx` + `design/task/ExecutionTab.tsx` | PGM-02 ba tab dùng chung Draft/ETag; tab luôn mount; pending operation hợp nhất thành dirty guard; save/bỏ/ở lại khi rời trang; Check khóa khi dirty; Task đồng bộ server update nếu không có local edit; ST có line/column/find/format/symbol/type/ref và diagnostic range |
| `features/programming/fbd/*` | **As-Built Task 201**, mount thật vào `ProgramsTab` (không còn placeholder); `StructuredFbdEditor.tsx` thêm `sectionRef`+`tabIndex={-1}` để giữ focus bàn phím sau `DELETE_SELECTION` (sửa lỗi thật TASK-PROG-506) |
| `features/programming/commission/{CheckCommissionPage,useCommissionWorkflow}.tsx` | PGM-03: query canonical `revisionId/checkId`; readiness chỉ READY khi Check PASS, impact/override đọc được, Core READY và không safe-state; re-auth và `UNKNOWN_RECONCILING` |
| `features/programming/runtime/{RuntimeServicePage,RuntimeTab,WatchTab,VersionsTab,DangerZone,useRestoreWorkflow}.tsx` | PGM-04: Runtime task metric thật; Watch/Trace; Danger Zone chỉ ở Service; Restore chỉ `READY && !safeState`; RETAIN contract-only luôn khóa; Export source-only; Import hash được trên HTTP; history dùng card mobile/focusable audit region |
| `features/programming/layout/ProgrammingMobileNav.tsx` | Bottom navigation `Tổng quan/Thiết kế/Kiểm tra/Runtime` tại `<md`; project-dependent route bị disabled khi chưa có Project thay vì dựng deep-link giả |
| `shared/crypto.ts` | UUID v4: ưu tiên `randomUUID`, fallback `getRandomValues`; không dùng `Math.random`; SHA-256 thuần JS và base64 theo khối cho bundle tối đa 4 MiB |
| `app/App.tsx`, `shared/i18n.tsx` | Protected return URL giữ pathname/search/hash và chặn open redirect; fresh profile mặc định `vi`, chỉ dùng `en` khi giá trị lưu hợp lệ |
| `features/programming/api/{authClient,queries,mutations,errorCopy}.ts` | `useProgrammingApiClient` (Authorization header thật), `useProgrammingResource` factory + hook theo resource, `programmingErrorCopy` map đủ 19 `PRG-ERR-*` |
| `features/programming/api/generated/client.ts`, `features/programming/model/types.ts` | client operation sinh từ OpenAPI v1.20.0; DTO UI khai báo tường minh cho runtime/monitor/trace và được khóa bằng typecheck/contract drift check |
| `app/App.tsx`, `shared/components/NavRail.tsx`, `shared/config.ts`, `features/auth/roles.ts` | cờ `PROGRAMMING_REV_A_ENABLED`, `ROUTE_MIN_ROLE['/eng/programming']='viewer'` |
| `shared/hooks/useWebSocket.ts` | reuse transport hiện có; Programming P5 **không** dùng WS riêng — Runtime/Watch poll qua REST theo freshness contract |
| `shared/i18n.tsx` | copy Programming VI/EN đi qua `pick()` tại chỗ, không namespace file riêng (khác giả định 0.1..0.8) |

## 12. Component, hook, type và ownership

> Cây thư mục hiệu lực **chỉ có một**: `§0.1` cho bốn workspace và `§2` cho các
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
└── types.ts                DTO/UI union tường minh dùng bởi bốn workspace
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

Deploy theo server capability và cờ FE/BE. Bản Foxlinx của `TASK-PROG-507` đang
bật `ON`; source 508/509 **chưa** được deploy/read-back và không được gắn với
evidence đó. Rollback route trả unavailable/read-only mà không xóa Draft/operation;
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

Bảng dưới đây dùng **đúng bốn route** của `§0.1` và `UX §11`; ba tab của `PGM-02`
và ba tab của `PGM-04` là trạng thái `?tab=` trong cùng một route, không phải
route riêng. Năm đường dẫn cũ (`.../programs`, `.../mapping`, `.../task`,
`/runtime` không tab, `/eng/programming` legacy) chỉ tồn tại dưới dạng chuyển
hướng ở `ProgrammingRoutes.tsx` — chúng **không** có page container riêng.

| Route | Page/container target | Query bắt buộc | Mutation | Empty/error owner |
|---|---|---|---|---|
| `/eng/programming` | `OverviewPage` | capability, projects, active/runtime, attention, `overrides?activeOnly=true` | không | page giữ active truth khi Draft query lỗi |
| `.../projects/:projectId/design?tab=programs` | `DesignWorkspacePage` → tab Chương trình | Draft document, symbols, diagnostics | save Draft, create Check | editor buffer + Problems |
| `.../projects/:projectId/design?tab=mapping` | `DesignWorkspacePage` → tab Điểm & Ánh xạ | Draft bindings + paged Point catalog | save binding batch | row field + summary |
| `.../projects/:projectId/design?tab=execution` | `DesignWorkspacePage` → tab Thực thi | task/library/capability | save task/order | exact invalid field |
| `.../projects/:projectId/commission` | `CheckCommissionPage` | readiness/impact/active/overrides | begin Check, begin operation | persistent UNKNOWN/reconcile |
| `/eng/programming/runtime?tab=runtime\|watch\|service` | `RuntimeServicePage` | runtime/monitor/trace/revisions/audit theo tab | restore/import/reset RETAIN ở tab `service` | stale/gap/read-only |

Ba tab của `PGM-02` dùng **chung một** `useDraftQuery` ở cấp workspace theo ràng
buộc 3 của `§0.1`; chỉ tab Điểm & Ánh xạ thêm `usePointCatalogQuery`. Tab không
hợp lệ rơi về `programs` với `PGM-02` và `runtime` với `PGM-04`.

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

## 17. Blocker, lịch sử và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| `S5-F` usability test cần người dùng thật | UX Lead + Product | `≥5` kỹ thuật viên BMS thật chưa từng dùng sản phẩm + fixture `AHU-01` trên controller lab (Plan 53 §5.9) |
| `VS-PROG-027/029/030` cần soak/power-fault/HIL vật lý | Core + HW + QA | Board/HIL fixture theo Plan 53 P6 |
| Test Result chính thức cho `VS-PROG-020/022/025/026/028/032` | Verification Lead | Target supporting evidence đã có; executor + reviewer độc lập chạy/ký theo VVP §11 |
| Corrective source chưa commit/merge | FE Lead + Dev Lead | commit/PR/merge thật; chạy lại FE gate, candidate pin và docs harness |
| Positive Monitor/Trace target có Variable Binding | FE + BE + Core + QA | fixture read-only an toàn; kiểm row truth và start/get/stop, lưu raw output |
| Accessibility review độc lập | Accessibility Reviewer + QA | Review raw/browser evidence axe 8/8 scan và bundle 508/509; ký Test Result, không suy `T=Y` từ tool run của implementer |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
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

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| FE + UX + BE + Core + QA + Ops | **P5 IN_PROGRESS 8/11; 508/509 HOST/TARGET VERIFIED nhưng chưa merge; 510 EXECUTED/VERIFYING** | `REV-PROG-FE-UX-2026-08-13`; `EV-PROG-P5-510` |
| Frontend Lead + System Architect | **APPROVED FOR IMPLEMENTATION; RELEASE EVIDENCE BLOCKED** | `AUTH-PROG-2026-08-11-03`; Test Result chính thức (executor+reviewer độc lập) và `S5-F` usability người thật chưa có |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §17 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 ranh giới; nêu rõ FE **không** sở hữu Draft/quyền/runtime truth |
| `DD-03` As-Built | PASS | §11 dẫn `ProgrammingRoutes.tsx`, `layout/*`, `overview/OverviewPage.tsx`, `design/*`, `fbd/StructuredFbdEditor.tsx`, `commission/*`, `runtime/*`, `api/*`, `model/types.ts` và cờ `PROGRAMMING_REV_A_ENABLED` — toàn bộ đã tồn tại trong source, không còn "target action" |
| `DD-04` Target ownership | PASS | §2 cấu trúc feature; §12 quyền sở hữu component/hook/type |
| `DD-05` Data từng field | PASS | §3 mô hình state; §12 kiểu dữ liệu; hợp đồng field chi tiết ở UI/UX §19 |
| `DD-06` Interface | PASS | §4 query và mutation; đường dẫn chính xác tra ở UI/UX §24 và `IFSPEC-PROG-001` |
| `DD-07` State/algorithm | PASS | §7 state machine Commission; §13 thuật toán mutation và xử lý lỗi |
| `DD-08` UX flow | PASS | §5 editor, §6 mapping, §16 ánh xạ trang ↔ code và phụ thuộc dữ liệu; §8 RBAC/i18n/accessibility |
| `DD-09` Error/safety/security | PASS | §9 phục hồi lỗi; §14 security/performance/accessibility; không optimistic active, không tự replay |
| `DD-10` Repository mapping | PASS | §0.1 cây thư mục bốn workspace; §1, §2, §11, §12 — đường dẫn cụ thể trong `apps/web-ui/src/` |
| `DD-11` Verification | PASS | §10 chiến lược test; §15 As-Built `FE-T-007/008` (Chrome/Playwright thật desktop+mobile); gắn `VS-PROG-020/022/025/026/028/032` (hỗ trợ một phần, VVP §11.5) |
| `DD-12` Compatibility/deploy/rollback | PASS | §15 deploy và rollback; §0.1 năm chuyển hướng route (nay đã As-Built ở `ProgrammingRoutes.tsx`); chi tiết rollout/cờ/migration ở UI/UX §11.1 và §28 |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation, **BLOCKED cho merge/release** | Owner: FE Lead, UX, BE, Core, QA, Ops. 508/509 đã có host/target supporting evidence nhưng chưa merge. `S5-F`, accessibility review độc lập, positive binding target, HIL/fault/power và Test Result vẫn thiếu. Gate: P5/G6. Điều kiện mở ghi ở §17 và audit record. |

Blocker có đủ owner/ảnh hưởng/gate/điều kiện mở. Corrective source 508/509 đã có
supporting evidence host và Foxlinx thật tại `EV-PROG-P5-510`, nhưng chưa merge
và fixture active không có binding để chạy positive Trace target. Assurance P6,
usability người dùng thật (`S5-F`) và chữ ký Test Result độc lập vẫn tách riêng.
Nhắc lại bẫy của repo: `npm test`
chỉ quét `src/`, muốn chạy E2E phải gọi Playwright riêng
(`npx playwright test e2e/programming.spec.ts`).
