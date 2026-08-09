# Thiết kế Frontend Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FE-PROG-001` |
| Phiên bản | 0.6 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; chưa có API nên chưa có bằng chứng trình duyệt |
| Ngày | 2026-08-09 |
| Chủ quản | Frontend Lead |
| Người review | UX Lead, Backend Lead, Verification Lead |
| Người phê duyệt | Frontend Lead + System Architect |
| Nguồn | `UX-WEB-PROG-001`, `IFSPEC-PROG-001`, `DM-PROG-001` |
| Requirement | `SWR-REQ-PROG-FE-101..115` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **FE dựng code như thế nào** cho bốn workspace: thư mục feature, mô hình state, query/mutation, xử lý lỗi và chiến lược test. Trong khi [UI/UX Design](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) nói *người dùng thấy gì*, file này nói *React tổ chức ra sao*. |
| 2. Ai phải đọc file này? | FE Lead và lập trình viên FE (chủ quản); UX đối chiếu với hồ sơ UI/UX; BE đọc §4 để biết FE sẽ gọi gì và kỳ vọng lỗi ra sao; QA đọc §10. |
| 3. Hệ thống hiện tại đang có gì? | `app/App.tsx` đã có route `/eng/programming` nhưng đi qua cờ `LEGACY_GRAPH_DEMO_ENABLED`. `features/dashboard/ProgrammingPage.tsx` là demo graph, `ValidatorPage.tsx` chỉ re-export lại trang đó. NavRail cũng ẩn Programming theo cờ legacy. Đã có sẵn `shared/api/client.ts`, `shared/hooks/useWebSocket.ts` và `shared/i18n.tsx` để dùng lại. |
| 4. Thiết kế mới thay đổi điều gì? | Tạo feature mới tại `apps/web-ui/src/features/programming/`. **Không** mở rộng trang demo cũ thành một file khổng lồ, và **không** bật cờ legacy để tuyên bố đã có tính năng. FE dùng client sinh từ OpenAPI thay vì gọi tay. |
| 5. Team phải sửa module/contract nào? | §11 và §12. Đổi route sang `features/programming/ProgrammingRoutes.tsx`; NavRail chuyển sang điều kiện capability + RBAC thay vì cờ graph demo; thêm namespace i18n riêng cho Programming. |
| 6. Điều gì còn bị chặn? | Không có API Programming nào tồn tại nên chưa chạy được integration thật; ràng buộc vai trò chờ `OD-PROG-001`. Mock chỉ được nằm trong test fixture, **không** được import vào bundle production. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §10 và §15: Vitest cho component, Playwright E2E, kiểm accessibility, cộng `VS-PROG-002/024/026/028`. Lưu ý bẫy đã biết của repo: `npm test` **chỉ quét `src/`**, không chạy `e2e/`. Hiện chưa chạy bài nào cho Programming. |

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

FE không sở hữu Draft persistence, change diff, readiness, authorization,
runtime state, Point quality, priority winner hoặc audit truth.

## 2. Cấu trúc feature và module dùng chung

> Cây thư mục và danh sách route **là §0.1**, không lặp lại ở đây. Mục này chỉ
> mô tả các module cắt ngang mà cả bốn workspace dùng chung. Nếu §0.1 và §2 có
> vẻ mâu thuẫn thì §0.1 đúng.

```text
features/programming/
├── ProgrammingRoutes.tsx     xem §0.1 — 4 route + 5 redirect
├── api/{queries,mutations,contracts}.ts   client sinh từ OpenAPI, không viết tay
├── model/{types,selectors,reducer}.ts     state model §3
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

Không claim UI Done khi chỉ render mock hoặc chưa có producer/API contract.

## 11. As-Built và source migration

`apps/web-ui/src/app/App.tsx` hiện route `/eng/programming` qua
`LEGACY_GRAPH_DEMO_ENABLED`; `features/dashboard/ProgrammingPage.tsx` là graph
demo/placeholder, `ValidatorPage.tsx` re-export trang này. Nav cũng ẩn Programming
theo legacy flag. Target không mở rộng monolith đó và không bật legacy flag để
claim feature.

| As-Built | Target action |
|---|---|
| `features/dashboard/ProgrammingPage.tsx` | thay route sang `features/programming/ProgrammingRoutes.tsx`; giữ demo dưới dev-only nếu cần |
| `app/App.tsx`, `shared/components/NavRail.tsx` | capability + RBAC route, không phụ thuộc graph demo flag |
| `shared/api/client.ts` | reuse auth/correlation/error base; thêm generated Programming client |
| `shared/hooks/useWebSocket.ts` | reuse transport; thêm sequence/freshness policy per topic |
| `shared/i18n.tsx` | tách namespace key Programming VI/EN; không hard-code message server |

## 12. Component, hook, type và ownership

```text
features/programming/
├── ProgrammingRoutes.tsx, ProgrammingLayout.tsx
├── api/{client.generated.ts,models.generated.ts,errors.ts,events.ts}
├── context/{ProgrammingContext.tsx,useProgrammingContext.ts}
├── overview/, editor/, fbd/, mapping/, task/
├── check/, commission/, runtime/, retain/, bundles/, audit/
├── state/{draftReducer.ts,operationReducer.ts,selectors.ts,queryKeys.ts}
└── test/{fixtures.ts,handlers.tsx,builders.ts}
```

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

Deploy behind server capability and FE flag default OFF. BE read-only can precede
FE. Rollback route returns unavailable/read-only without clearing Draft/operation;
service worker/cache must not serve incompatible generated types. Browser test
chỉ bắt buộc sau code/UI change, không áp dụng cho phiên docs-only này.

## 16. Page-to-code và data dependency mức triển khai

| Route | Page/container target | Query bắt buộc | Mutation | Empty/error owner |
|---|---|---|---|---|
| `/eng/programming` | `ProgrammingOverviewPage` | capability, projects, active/runtime, attention | không | page giữ active truth khi Draft query lỗi |
| `.../projects/:id/programs` | `ProgramsPage` | Draft document, symbols, diagnostics | save Draft, create Check | editor buffer + Problems |
| `.../mapping` | `MappingPage` | Draft bindings + paged Point catalog | save binding batch | row field + summary |
| `.../task` | `TaskLibraryPage` | task/library/capability | save task/order | exact invalid field |
| `.../commission` | `CommissionPage` | readiness/impact/active/overrides | begin operation | persistent UNKNOWN/reconcile |
| `/eng/programming/runtime` | `ProgrammingRuntimePage` | runtime/trace/revisions/audit | restore/import theo tab | stale/gap/read-only |

Query key luôn chứa controller/project/revision/resource version phù hợp; không
dùng key chỉ `programming`. Mutation thành công invalidate đúng aggregate; event
chỉ update cache khi sequence/resource version hợp lệ, còn lại invalidate/refetch.

| Layer target | Public contract | Không được chứa |
|---|---|---|
| `api/programmingClient.ts` | typed HTTP/event adapter, error normalization | toast/copy/business decision |
| `model/types.ts` | generated DTO + explicit UI discriminated union | `any`, fake default |
| `model/reducers.ts` | editing/check/operation/core/runtime transition | HTTP calls/component state |
| `hooks/useProgramming*.ts` | query/mutation/orchestration | authority validation |
| `components/*` | presentational props/a11y | direct fetch/global mutation |
| `pages/*` | route composition/error boundary | duplicated domain types |

## 17. Blocker, lịch sử và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| OpenAPI/generated types chưa Active | BE + Architect | approve interface/decisions và merge contract tests |
| UX/role/capacity chưa ký | Product + UX | approve `PROG-OD-001`/UX design |
| Feature chưa implement | FE Lead | Plan 53 slices + automated/browser evidence |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Feature/state/query/editor/commission/test baseline |
| 0.2 | 2026-08-09 | Bổ sung As-Built migration, source ownership, algorithms, security, deploy và test M3 |
| 0.3 | 2026-08-09 | Bổ sung route/page/query/mutation/empty-error ownership, query-key và layer contract; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; ghi bẫy `npm test` chỉ quét `src/` |
| 0.5 | 2026-08-09 | Amendment A1: thêm §0.1 cấu trúc thư mục và route cho bốn workspace, ba ràng buộc về tab/Draft/truy vấn dùng chung, và bảng năm chuyển hướng route cũ |
| 0.6 | 2026-08-09 | Đóng finding P1-01: xóa cây thư mục và tám route `/engineering/programming/...` cũ khỏi §2 để chỉ còn **một** kiến trúc route hiệu lực; §2 chuyển thành mô tả module cắt ngang; metadata nhận `FE-101..115` |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| FE + UX + BE + QA | Chờ review | — |
| Frontend Lead + System Architect | **BLOCKED — chưa phê duyệt** | contract/decision và browser evidence |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; lịch sử và bảng ký §17 |
| `DD-02` Mục tiêu/phạm vi | PASS | §0 và §1 ranh giới; nêu rõ FE **không** sở hữu Draft/quyền/runtime truth |
| `DD-03` As-Built | PASS | §11 dẫn `app/App.tsx`, `features/dashboard/ProgrammingPage.tsx`, `ValidatorPage.tsx`, `shared/api/client.ts`, `shared/hooks/useWebSocket.ts`, `shared/i18n.tsx` và cờ `LEGACY_GRAPH_DEMO_ENABLED` |
| `DD-04` Target ownership | PASS | §2 cấu trúc feature; §12 quyền sở hữu component/hook/type |
| `DD-05` Data từng field | PASS | §3 mô hình state; §12 kiểu dữ liệu; hợp đồng field chi tiết ở UI/UX §19 |
| `DD-06` Interface | PASS | §4 query và mutation; đường dẫn chính xác tra ở UI/UX §24 và `IFSPEC-PROG-001` |
| `DD-07` State/algorithm | PASS | §7 state machine Commission; §13 thuật toán mutation và xử lý lỗi |
| `DD-08` UX flow | PASS | §5 editor, §6 mapping, §16 ánh xạ trang ↔ code và phụ thuộc dữ liệu; §8 RBAC/i18n/accessibility |
| `DD-09` Error/safety/security | PASS | §9 phục hồi lỗi; §14 security/performance/accessibility; không optimistic active, không tự replay |
| `DD-10` Repository mapping | PASS | §0.1 cây thư mục bốn workspace; §1, §2, §11, §12 — đường dẫn cụ thể trong `apps/web-ui/src/` |
| `DD-11` Verification | PASS | §10 chiến lược test; §15 acceptance; gắn `VS-PROG-002/024/026/028` |
| `DD-12` Compatibility/deploy/rollback | PASS | §15 deploy và rollback; §0.1 năm chuyển hướng route; chi tiết rollout/cờ/migration ở UI/UX §11.1 và §28 |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: FE Lead, UX, BE, QA. Ảnh hưởng: chưa có API Programming nên **không chạy được integration hay E2E thật**; mock chỉ được ở test fixture, không vào bundle production. Gate: `DOC-G3`. Điều kiện mở: BE phát hành route `/api/v1/programming`, đóng `OD-PROG-001`, rồi chạy Vitest + lint + build + Playwright và kiểm trên trình duyệt thật |

Một `BLOCKED`, đủ bốn trường. Bằng chứng implementation và trình duyệt vẫn
`NOT IMPLEMENTED/NOT TESTED`. Nhắc lại bẫy của repo: `npm test` chỉ quét `src/`,
muốn chạy E2E phải gọi Playwright riêng.
