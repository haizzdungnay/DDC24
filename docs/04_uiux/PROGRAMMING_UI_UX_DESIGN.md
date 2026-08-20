# Thiết kế UI/UX Product Programming thống nhất

| Thuộc tính | Giá trị |
|---|---|
| ID | `UX-WEB-PROG-001` |
| Phiên bản | 2.0 |
| Trạng thái | **Active — IMPLEMENT_READY** |
| Ngày | 2026-08-20 |
| Chủ quản | UX Lead + Frontend Lead |
| Người phê duyệt | Product Owner/CTO + System Architect theo `AUTH-PROG-2026-08-20-04` |
| Nguồn | Product v3.0; ADR-050; `SRS-PROG-001`; `DDD-SW-PROG-UNIFIED-001` |
| As-Built migration | Bốn workspace hiện hữu; không phải Product Target |

## 0. Kết luận thiết kế

Programming có sáu workspace. Người dùng tạo và chỉnh ba loại POU trong cùng cây:

- `PROGRAM`: ứng dụng chạy độc lập; có cycle, Enable/Disable, Point Mapping,
  Published Signal, output, RETAIN và runtime state.
- `FUNCTION`: phép tính thuần, không state/RETAIN/cycle/mapping/output; gọi từ
  Program hoặc Function Block.
- `FUNCTION_BLOCK`: mẫu logic có state; chỉ instance bên trong Program sở hữu
  state/RETAIN; bản định nghĩa không có cycle hay Enable riêng.

Không còn UX decision blocker. Asset trong §4 là normative; dữ liệu trong asset
là minh họa, không phải evidence runtime. Browser/a11y/usability/target vẫn là
acceptance/release evidence, không phải điều kiện để bắt đầu code.

## 1. Persona, quyền và nguyên tắc

| Persona | Việc chính | Quyền server |
|---|---|---|
| Operator | Xem runtime, signal, Point, fault; Enable/Disable khi policy cho phép | `viewer`/`operator` |
| Controls Engineer | Tạo POU, library, mapping, Check | `admin` cho mutation |
| Commissioning Engineer | Impact, Commission, read-back, Restore | `admin` + re-auth khi policy yêu cầu |
| Service Technician | Trace, RETAIN reset, backup/restore | read; `admin` cho mutation nguy hiểm |

UI không tự suy quyền. Response `403`, readiness, Active/LKG, output owner,
priority, quality và runtime state từ server/Core là authority. Mất Web không
dừng Program đang chạy.

## 2. Information architecture

| ID | Route | Mục tiêu | Hành động chính |
|---|---|---|---|
| `PGM-01` | `/eng/programming` | Tổng quan controller, Draft, Active, Core, attention | Tiếp tục công việc ưu tiên |
| `PGM-02` | `/eng/programming/projects/:id/programs` | Cây Program/Function/FB và editor ST/FBD | Tạo POU, Lưu Draft |
| `PGM-03` | `/eng/programming/projects/:id/mapping` | Variable, Point, output owner, Published Signal | Lưu mapping/signal |
| `PGM-04` | `/eng/programming/projects/:id/library` | SYSTEM/PROJECT Control Library, version, usage | Tạo/sửa library entry |
| `PGM-05` | `/eng/programming/projects/:id/commission` | Check, impact, Commission, reconcile, rollback | Kiểm tra / Đưa vào vận hành |
| `PGM-06` | `/eng/programming/runtime` | Enable intent, runtime state, monitor, trace, LKG/RETAIN/audit | Enable/Disable/Chẩn đoán |

Route bốn-workspace cũ redirect giữ `projectId`, tab, Draft id, ETag và phần nội
dung chưa lưu. Không hiện internal Task order như dependency sản phẩm.

### 2.1 Tám journey

| Journey | Kết quả người dùng |
|---|---|
| `UJ-PROG-01` | Mở Tổng quan và biết Draft/Active/Core có gì cần chú ý. |
| `UJ-PROG-02` | Tạo/chỉnh `PROGRAM` bằng ST hoặc FBD. |
| `UJ-PROG-03` | Tạo/chỉnh `FUNCTION`/`FUNCTION_BLOCK`, gọi và tạo instance. |
| `UJ-PROG-04` | Dùng Control Library có version và xem nơi sử dụng. |
| `UJ-PROG-05` | Bind Point, khai Published Signal, xử lý conflict/output owner. |
| `UJ-PROG-06` | Check, đọc diagnostic/impact, Commission và reconcile. |
| `UJ-PROG-07` | Enable/Disable Program và xác nhận read-back runtime. |
| `UJ-PROG-08` | Monitor/trace, RETAIN reset, Restore LKG và audit. |

## 3. Bố cục và hành vi từng workspace

### 3.1 PGM-01 — Tổng quan

Desktop dùng AppShell + sidebar sáu mục; vùng chính gồm controller health,
Editing Revision, Active Package, Program states và attention list. Mobile dùng
bottom navigation, card một cột và không ẩn trạng thái `UNKNOWN/STALE/OFFLINE`.
Primary action dẫn tới đúng workspace và giữ Project context.

### 3.2 PGM-02 — POU và editor

Desktop ba cột: POU tree 280 px, editor co giãn, Inspector 320 px. Tree nhóm
`PROGRAMS`, `FUNCTIONS`, `FUNCTION BLOCKS`; hỗ trợ search/filter, rename,
duplicate, delete và dependency badge. Inspector theo kind:

| Field/action | PROGRAM | FUNCTION | FUNCTION_BLOCK |
|---|:---:|:---:|:---:|
| Name/language/source | ✓ | ✓ | ✓ |
| Cycle/budget | ✓ | — | — |
| Enable intent | chỉ PGM-06 | — | — |
| Point Mapping | ✓ | — | — |
| Published Signal | ✓ | đọc/gọi | đọc/gọi |
| Parameters/return | interface variables | ✓ | pins/instance interface |
| RETAIN | Program variable/FB instance | cấm | instance policy |

ST editor có line/diagnostic, durable undo/redo, find/replace, autocomplete từ
registry, runtime overlay chỉ đọc và stale/quality badge. FBD có palette từ
registry, keyboard connect/disconnect, typed pin, Inspector, bounded history và
Problems drawer. Chuyển ST↔FBD không được giả equivalence khi chưa có converter.

### 3.3 PGM-03 — Mapping và Published Signal

Ba vùng: variable/signal consumer, catalog/filter, binding/owner inspector. UI
lọc type/direction/writable nhưng compiler/server vẫn validate. Hai output cùng
Point hiện conflict ngay, nêu Program đang giữ owner và chặn Save/Check. Signal
hiện publisher duy nhất, type/unit, freshness, fallback và consumer list. Không
đổi Published Signal thành Point hoặc ghi cross-Program trực tiếp.

### 3.4 PGM-04 — Control Library

Sidebar chọn `SYSTEM`/`PROJECT`; list search theo tên/kind/tag/version/status;
detail có signature, dependency, usage và version history. `SYSTEM` read-only.
`PROJECT` cho tạo Function/FB, publish version mới, deprecate khi không còn usage.
Không xóa version đang được Revision tham chiếu. PID luôn có badge
`REVIEW_REQUIRED` đến khi approval token từ server hợp lệ.

### 3.5 PGM-05 — Check và Commission

State machine hiển thị `DRAFT → CHECKING → READY → STAGING → ACTIVATING →
VERIFYING → SUCCEEDED | FAILED | UNKNOWN_RECONCILING`. Diagnostic theo POU/
location; impact phân nhóm Program, library, signal, output, RETAIN và enable
intent. Commission chỉ mở khi Check của đúng Revision PASS, acknowledgement hiện
hành và server readiness PASS. Timeout không hiện thành công; UI poll read-back.
Restore LKG là action riêng, có re-auth/reason/impact và authoritative read-back.

### 3.6 PGM-06 — Runtime và bảo trì

Mỗi Program hiển thị riêng:

```text
Enable intent | Runtime state | Active revision | period/budget
last/max execution | overrun/fault | signal freshness
candidate value | actual value | owner/priority | Point quality
```

Enable/Disable là mutation idempotent. `Enabled` không được render thành
`RUNNING`; STARTING/WAITING/FAULTED/UNKNOWN giữ nguyên. Disable yêu cầu impact,
rút candidate tại safe boundary và read-back. Monitor tách program/signal/
candidate/actual. Trace dùng Core ring buffer. Vùng Danger Zone chứa RETAIN reset,
Restore/import/replacement; không trộn vào tab đọc bình thường.

## 4. Asset trực quan normative

| Workspace | Desktop | Mobile/ghi chú |
|---|---|---|
| PGM-01 | [Tổng quan desktop](assets/programming/PGM-01_LANDING_PAGE_DESKTOP.svg) | [Tổng quan mobile](assets/programming/PGM-01_LANDING_PAGE_MOBILE.svg) |
| PGM-02 | [POU/editor desktop](assets/programming/PGM-02_PROGRAMS_POU_DESKTOP.svg) | [POU mobile](assets/programming/PGM-02_PROGRAMS_POU_MOBILE.svg) |
| PGM-03 | [Mapping/signal desktop](assets/programming/PGM-03_MAPPING_SIGNALS_DESKTOP.svg) | Mobile read/operate-light theo token §8 |
| PGM-04 | [Library desktop](assets/programming/PGM-04_CONTROL_LIBRARY_DESKTOP.svg) | [Library mobile](assets/programming/PGM-04_CONTROL_LIBRARY_MOBILE.svg) |
| PGM-05 | [Check/Commission desktop](assets/programming/PGM-05_CHECK_COMMISSION_DESKTOP.svg) | Modal action dùng cùng safety pattern |
| PGM-06 | [Runtime desktop](assets/programming/PGM-06_RUNTIME_SERVICE_DESKTOP.svg) | RETAIN modal theo [state set](assets/programming/PGM-04_RETAIN_RESET_DIALOG.svg) |

Asset tên PGM-02/03/04 cũ còn trong Git là migration reference, không normative.

## 5. Component tree và mapping

```text
ProgrammingRoutes
└── ProgrammingLayout
    ├── ProgrammingContextBar
    ├── ProgrammingDesktopNav / ProgrammingMobileNav
    └── route outlet
        ├── OverviewPage
        ├── PouWorkspacePage
        │   ├── PouTree ├── StEditor/FbdEditor └── PouInspector
        ├── MappingSignalsPage
        ├── ControlLibraryPage
        ├── CheckCommissionPage
        └── RuntimeServicePage
            ├── ProgramRuntimeList ├── MonitorTable ├── TracePanel
            └── ServiceDangerZone
```

| Vùng | Data/API | State | RBAC/action |
|---|---|---|---|
| Context bar | project/draft/active/runtime | loading/stale/offline | read all |
| POU tree/editor | Draft POU + ETag | clean/dirty/saving/conflict/error | admin save |
| Mapping/signal | catalog/binding/signal | valid/conflict/missing/stale | admin save |
| Library | entries/version/usage | empty/deprecated/review-required | admin project mutation |
| Check/Commission | checks/operation/impact | state machine §3.5 | admin + idempotency/re-auth |
| Runtime | status/monitor/trace/overrides | starting/running/fault/unknown | read; policy mutation |
| Danger Zone | retain/restore/import | ready/in-flight/unknown/fail | admin + reason/confirm |

## 6. Mười bảy use case

| Use case | Workspace | Acceptance chính |
|---|---|---|
| `UC-PROG-01` Tạo Project | PGM-01 | Project + Draft đầu tiên, audit, redirect PGM-02. |
| `UC-PROG-02` Tạo Program ST | PGM-02 | Kind PROGRAM, Disabled mặc định, save/reload byte đúng. |
| `UC-PROG-03` Tạo Program FBD | PGM-02 | Node typed, keyboard, canonical reload. |
| `UC-PROG-04` Tạo Function | PGM-02 | Purity fields, parameter/return, cấm cycle/mapping. |
| `UC-PROG-05` Tạo Function Block | PGM-02 | Pin/state model, instance isolation. |
| `UC-PROG-06` Dùng Library | PGM-04 | Resolve version/dependency/usage deterministic. |
| `UC-PROG-07` Bind Point | PGM-03 | Type/direction/writable/owner conflict đúng. |
| `UC-PROG-08` Published Signal | PGM-03 | One publisher, typed freshness/fallback. |
| `UC-PROG-09` Check package | PGM-05 | Aggregate diagnostic; không đổi Active. |
| `UC-PROG-10` Commission | PGM-05 | Impact/ack, atomic package, read-back. |
| `UC-PROG-11` Enable Program | PGM-06 | Intent/read-back tách runtime state. |
| `UC-PROG-12` Disable Program | PGM-06 | Withdraw candidate safe-boundary, audit. |
| `UC-PROG-13` Monitor | PGM-06 | LOCAL/VP/MB_RTU, signal/candidate/actual/quality. |
| `UC-PROG-14` Trace | PGM-06 | Core ring buffer, bounded, freshness đúng. |
| `UC-PROG-15` Reset RETAIN | PGM-06 | Impact/re-auth/no-half-reset/read-back. |
| `UC-PROG-16` Restore LKG | PGM-05/06 | Atomic restore, first-output verification. |
| `UC-PROG-17` Import/export/replacement | PGM-06 | Source-only, migration/rollback/audit. |

## 7. Trạng thái, lỗi và copy

| State | VI | Hành vi |
|---|---|---|
| Loading | `Đang tải dữ liệu Programming…` | skeleton, không giữ nút mutation cũ |
| Empty | `Chưa có chương trình` | primary create theo quyền |
| Permission | `Bạn không có quyền thực hiện thao tác này` | giữ read-only context |
| Stale | `Dữ liệu đã cũ` | timestamp + refresh, không tô như live |
| Offline | `Không kết nối được Core` | Active last-known ghi rõ timestamp; mutation khóa |
| Unknown | `Chưa xác định kết quả — đang đối soát` | không retry mutation tự động |
| Conflict | `Bản nháp đã thay đổi ở phiên khác` | compare/reload; không overwrite im lặng |
| Failed | dùng stable error catalog | diagnostic + correlationId + recovery |

Confirm không dùng checkbox chung. Mỗi action nguy hiểm nêu object, Active/LKG,
output/RETAIN impact, hành vi khi mất kết nối, rollback và yêu cầu reason/re-auth.

## 8. Responsive, token và accessibility

- Desktop `>=1280 px`; tablet `768..1279`; mobile `<768`.
- Mobile authoring cho phép sửa ngắn; FBD complex mở chế độ read/inspect và dẫn
  người dùng sang tablet/desktop, không làm mất Draft.
- Spacing 4/8/12/16/24; target chạm tối thiểu 44×44 px; focus ring 2 px.
- Text contrast `>=4.5:1`, large/UI component `>=3:1`; màu không là tín hiệu duy nhất.
- Landmark/header/nav/main/aside đúng; tab/tree/grid có keyboard contract;
  diagnostic dùng `aria-live=polite`, lỗi mutation `assertive`.
- `Ctrl+S`, `Ctrl+F`, undo/redo không chặn shortcut trình duyệt ngoài editor;
  IME tiếng Việt và screen reader phải giữ selection/focus.

## 9. Yêu cầu UX canonical

| ID | Yêu cầu |
|---|---|
| `UX-REQ-001` | Sáu workspace đúng route §2 và legacy redirect giữ context. |
| `UX-REQ-002` | POU tree phân biệt Program/Function/FB bằng text+icon. |
| `UX-REQ-003` | Inspector chỉ hiện field có nghĩa cho kind. |
| `UX-REQ-004` | ST/FBD editor giữ Draft, diagnostic và durable undo/redo. |
| `UX-REQ-005` | Runtime overlay không giả stale/unknown thành live. |
| `UX-REQ-006` | Mapping cảnh báo duplicate physical output trước Check. |
| `UX-REQ-007` | Published Signal hiện publisher/type/freshness/fallback/consumer. |
| `UX-REQ-008` | SYSTEM library read-only; PROJECT library versioned. |
| `UX-REQ-009` | PID hiển thị REVIEW_REQUIRED và không cho bypass token. |
| `UX-REQ-010` | Check diagnostic gắn POU/location và không đổi Active. |
| `UX-REQ-011` | Impact/ack dùng response server hiện hành. |
| `UX-REQ-012` | Commission/Restore chỉ thành công sau read-back authority. |
| `UX-REQ-013` | Unknown operation reconcile, không auto-replay mutation. |
| `UX-REQ-014` | Enable intent tách runtime state. |
| `UX-REQ-015` | Disable hiện candidate/output impact và safe-boundary result. |
| `UX-REQ-016` | Monitor tách program/signal/candidate/actual/priority/quality. |
| `UX-REQ-017` | Trace phản ánh Core ring buffer và bounded retention. |
| `UX-REQ-018` | RETAIN reset có impact/re-auth/reason/no-half-reset. |
| `UX-REQ-019` | Role/readiness fail-closed ở direct route và deep-link. |
| `UX-REQ-020` | Loading/empty/error/permission/stale/offline/unknown đầy đủ. |
| `UX-REQ-021` | Desktop/mobile navigation và focus không làm mất nội dung. |
| `UX-REQ-022` | A11y/contrast/keyboard theo §8. |
| `UX-REQ-023` | VI mặc định; stable technical identifiers giữ nguyên. |
| `UX-REQ-024` | HMI local không author/Check/Commission/trace/RETAIN/Restore. |

## 10. Verification và source mapping

| Scope | Source target | Test/evidence |
|---|---|---|
| Routes/shell/context | `apps/web-ui/src/features/programming/ProgrammingRoutes.tsx` | route/redirect/deep-link desktop/mobile |
| POU/editor | `.../editor/ProgramsTab.tsx`, `.../fbd/` | unit + Playwright + `VS-PROG-U01/U02/U10` |
| Mapping/signal | `.../editor/MappingTab.tsx` | conflict/signal/3 Point category, `U06/U09` |
| Library | `.../library/` | loading/error/RBAC/version/usage, `U03` |
| Check/Commission | `.../commission/` | state/fault/reconcile/rollback, `U08` |
| Runtime/service | `.../runtime/` | enable/fault/monitor/trace/retain, `U07/U09/U11` |

Chrome DevTools review sau thay đổi FE phải kiểm desktop/mobile screenshot,
Console error và Network failure; nó bổ sung chứ không thay Vitest/lint/build/
Playwright/target Test Result.

## 11. Compatibility, rollout và rollback

1. Ship route mới sau OpenAPI/BE read model; legacy redirect cùng release.
2. Feature flag không được làm FE hiện menu trong khi BE route vắng.
3. Draft migration giữ ETag và không Commission tự động.
4. Rollback bundle FE/BE theo compatibility window; Core Active/LKG không đổi.
5. Telemetry đo redirect error, save conflict, operation unknown, stale/offline,
   enable failure và a11y regression; không thu source/secret.

## 12. Lịch sử và sign-off

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1..1.1 | 2026-08-09..13 | Thiết kế/bằng chứng cho IA bốn workspace; superseded về Product Target. |
| 2.0 | 2026-08-20 | Viết lại authority sáu workspace; POU/Library/Signal/Enable lifecycle, visual mapping, 17 UC, 24 UX requirement và acceptance; loại toàn bộ contradiction phạm vi cũ khỏi nội dung Active. |

| Vai trò | Disposition |
|---|---|
| Product Owner/CTO + System Architect | **ACCEPT — `AUTH-PROG-2026-08-20-04`** |
| UX/FE/BE/QA/a11y | Review trong task Plan59; finding thuộc scope sửa trước merge, không chặn entry implementation |
| Release authority | Chờ `VS-PROG-U*`, target/HIL/usability/provenance theo Plan59 W7 |
