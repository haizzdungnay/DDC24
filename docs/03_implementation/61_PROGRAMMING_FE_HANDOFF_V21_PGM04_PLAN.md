# Plan 61 — Triển khai PGM-04 Control Library theo FE Handoff

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-FE-PGM-061` |
| Phiên bản | 0.2 |
| Trạng thái | **ĐÓNG — WP-00…WP-05 `DONE`. `RELEASE_READY` KHÔNG đổi (vẫn `NO-GO`)** |
| Ngày | 2026-08-28 |
| Chủ quản | FE Lead + Web API Lead + System Architect |
| Người review | Product Owner, Controls/Safety, QA, consumer PGM-02 |
| Người phê duyệt | Product Owner/CTO + System Architect |
| Baseline As-Built | `main@eecc2f89844a`; các thay đổi code chưa commit đang có trong worktree tại thời điểm lập plan là công việc đồng thời của người dùng, không thuộc baseline và không được plan này ghi đè |
| Authority sản phẩm | [`PROD-PROG-001`](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md), [`SRS-PROG-001`](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md), [`UX-WEB-PROG-001`](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md), [`DDD-SW-PROG-UNIFIED-001`](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) |
| Đầu vào Target Candidate | [PGM-04 FE Handoff](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-04_LIBRARY_FE_HANDOFF.md) và [ảnh PGM-04](../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-04_library.png) |
| Quan hệ Plan59 | **Bổ sung, không thay thế.** Plan59 sở hữu lifecycle/contract/runtime/evidence/release; Plan61 sở hữu delta UI, metadata trình bày, Used-In và handoff PGM-04 |
| Quan hệ Plan60 | Kế thừa shell Programming đã triển khai; không làm lại PGM-01 hoặc mở lại các quyết định shell đã đóng |
| Phạm vi | FE PGM-04, contract/API cần để render trung thực, generator SYSTEM Library có điều kiện, kiểm chứng browser và deploy Web trên SoM |

---

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Plan này dùng để làm gì? | Đưa PGM-04 từ list/detail/form dài hiện tại tới card grid + inspector + drawer như ảnh, nhưng giữ đúng SYSTEM/PROJECT, version, RBAC, PID gate và zero-mutation. |
| Ai phải đọc? | Product/Architect để đóng authority; FE/BE/Core để chia source; QA/Ops để khóa evidence và rollback. |
| Source đang có gì? | Domain/store/API Control Library đã có; FE đã có search/detail/version/mutation nhưng bố cục chưa đạt handoff và thiếu metadata/usage authoritative. |
| Thay đổi chính? | Mở contract metadata/usage khi cần, tách `LibraryPage`, tạo card grid/inspector/drawer, nối Preview/Used-In/Insert với PGM-02. |
| Layer nào không đổi? | STM32 firmware, IOP, physical I/O, SHM và HMI native. |
| Đang bị chặn gì? | Ảnh PGM-04 chưa là visual authority, `User Library` không có domain/API, semantics Used-In chưa khóa, và asset bật Insert cho PID đang `REVIEW_REQUIRED`. |
| Bằng chứng đóng plan là gì? | Contract sync + Go/FE test + E2E real-backend + Chrome desktop/mobile + target browser/read-back; không suy các bằng chứng này thành HIL hay release PASS. |

### 0.1 Kết luận kiến trúc

1. **Đây chủ yếu là refactor FE**, không phải viết lại Control Library.
2. **BE phải đổi additive** nếu muốn render đúng description, tag, parameter
   documentation, usage count/list và version change summary; FE không được
   hardcode các trường này.
3. **Core/SoM chỉ đổi generator/registry có điều kiện** khi metadata SYSTEM được
   đưa vào canonical registry. Không đổi scheduling, graph execution hay control
   path.
4. **Firmware MCU không có task.** Giao diện thư viện không đọc/ghi điện vật lý.
5. Chỉ WP-00 được `READY`. Mọi task production code là `ORDERED` tới khi Target
   Candidate PGM-04 được pin và contract của lát cắt tương ứng machine-readable.

### 0.2 Trạng thái task

| Trạng thái | Ý nghĩa |
|---|---|
| `READY` | Đủ quyền và dependency để bắt đầu. |
| `ORDERED` | Nội dung đã xác định nhưng chưa được phép chạy vì predecessor/gate. |
| `BLOCKED` | Cần quyết định hoặc input ngoài lane; có owner và điều kiện mở. |
| `DONE` | Source + test + docs + evidence của đúng task đã kiểm lại. |

---

## 1. Authority, phạm vi và quyết định đầu vào

### 1.1 Authority hiện hành

| Nội dung | Authority hiện hành | Hệ quả cho Plan61 |
|---|---|---|
| Route PGM-04 | `UX-WEB-PROG-001` và source dùng `/eng/programming/projects/:projectId/library` | Giữ route project-scoped; route global trong handoff không được đổi thành canonical ngầm. |
| Scope library | Product/SRS/OpenAPI chỉ có `SYSTEM` và `PROJECT` | `Core Library → SYSTEM`, `Project Library → PROJECT`; không tạo `USER`. |
| Visual PGM-04 | Asset SVG Active hiện là list/detail; UX Active nói asset PGM-04 cũ không normative | PNG handoff chỉ là Target Candidate tới khi WP-00 pin revision mới. |
| Mutation | OpenAPI/current RBAC cho `engineer` và `admin`; server là authority | FE dùng capability `program.edit`, không dùng ngưỡng `admin` viết tay. |
| Publish | PROJECT library publish cùng transaction Seal Revision | Wizard chỉ Save Draft; không tạo nút/API Publish độc lập. |
| PID | SYSTEM PID là `REVIEW_REQUIRED` cho tới khi token hợp lệ | Preview được phép; Insert/Check production bị khóa và phải nêu lý do. |
| Mobile | Asset Active mobile là read/search/detail | `<768 px` có 0 control mutation. |

### 1.2 Quyết định Plan61

| Mã | Quyết định | Trạng thái/authority |
|---|---|---|
| `D61-01` | Giữ route canonical project-scoped; generic route nếu cần chỉ là redirect có chủ đích và giữ query/hash. | **LOCKED** bởi UX Active + source. |
| `D61-02` | Chỉ có SYSTEM/PROJECT. Tab User không render và không có task BE/store. | **LOCKED** bởi Product/SRS/OpenAPI. |
| `D61-03` | Read: viewer/operator/engineer/admin. Mutation: capability `program.edit` (`engineer/admin`). | **LOCKED** bởi contract/server hiện hành; handoff cũ phải được reconcile ở WP-00. |
| `D61-04` | PID/feature `REVIEW_REQUIRED` luôn có badge; Insert disabled; không có checkbox bypass. | **LOCKED** bởi `T59-205`. |
| `D61-05` | Save PROJECT entry chỉ tạo/cập nhật Library Draft; publish chỉ khi Seal Revision. | **LOCKED** bởi domain/store Plan59. |
| `D61-06` | Dùng card grid + inspector + drawer của PNG làm visual Target mới, nhưng phải có desktop/mobile/full-state asset cùng revision. | **BLOCKED** — Product + Architect pin ở `T61-004`. |
| `D61-07` | Metadata thiếu render `—/Không khả dụng`; retained stale render có nhãn; không biến thành zero/empty. | **LOCKED** bởi fail-closed baseline. |
| `D61-08` | Used-In là read model typed từ server; FE không suy toàn bộ lịch sử chỉ từ Draft hiện tại. | **BLOCKED** — Product + BE owner khóa semantics ở `T61-005`. |
| `D61-09` | Metadata trình bày có hash/revision riêng; sửa mô tả không đổi `contentSha256` của semantics thực thi. | **PROPOSED** — Architect + Compiler owner khóa ở `T61-005`. |

### 1.3 Trong và ngoài phạm vi

**Trong phạm vi**

- Visual parity PGM-04 desktop/tablet/mobile với Target Candidate đã pin.
- Category/type/search/filter, card signature, description, source, version và
  usage authoritative.
- Inspector Details/Parameters/Used-In/Versions.
- Create/Edit drawer cho PROJECT; SYSTEM immutable.
- Preview/Open, deep-link và Insert có target context rõ.
- Pagination cursor, URL state, keyboard, i18n, light/dark và full state matrix.
- Contract/API/generator/migration additive cần thiết để render trung thực.

**Ngoài phạm vi**

- `USER` scope/library.
- Thay compiler semantics, thêm Function/FB mới hoặc duyệt PID Controls/Safety.
- Commission, runtime scheduling, SHM/IPC, IOP, MCU firmware và physical I/O.
- HMI native LVGL/DRM.
- Chuyển global design system sang light theme chỉ để khớp một ảnh.
- Tuyên bố target/HIL/release PASS.

---

## 2. As-Built tại `main@eecc2f89844a`

### 2.1 Source và khoảng trống

| Thành phần | Source/symbol hiện có | As-Built | Gap so với Target |
|---|---|---|---|
| Route | `ProgrammingRoutes.tsx::PROGRAMMING_WORKSPACE_PATHS.library` | `projects/:projectId/library` | Handoff ghi route global; không đổi canonical. |
| Page/controller | `library/LibraryPage.tsx::LibraryPage` | Hơn 1.000 dòng, vừa query/mutation vừa render | Phải tách controller, grid, inspector, drawer, dialog. |
| Bộ lọc | `LibraryFilters` | `q/scope/kind`, gọi lại server | Thiếu tab presentation, category/status/tag, URL state và clear-all. |
| Catalog | `LibraryList` | List dọc, một item mỗi hàng | Thiếu card grid, signature/description/usage/favorite. |
| Detail | `LibraryDetail` | Một khối dài trong document flow | Thiếu sticky inspector, tabs, detail-error độc lập. |
| Usage | `model/library.ts::libraryUsagesByEntryId` | Chỉ suy dependencies từ Draft đang đọc; sealed `library_usages` chưa có HTTP projection | Không đủ cho `Used in N Programs` và deep-link lịch sử. |
| Authoring | form cuối `LibraryPage.tsx` | Form hiện thường trực; có ETag/idempotency/read-back | Phải chuyển thành drawer/wizard, giữ nguyên mutation safety. |
| RBAC FE | `LibraryPage.tsx::canAdmin` | Khóa engineer dù server cho `program.edit` | Chuyển sang `roleCan(role, 'program.edit')`. |
| Query | `api/queries.ts::useProgrammingLibrary` | `limit=100`, không đi theo `nextCursor` | Catalog >100 item bị thiếu âm thầm. |
| Type FE | `model/types.ts::ProgrammingLibraryEntry` | SYSTEM/PROJECT, signature, version/state, hash, dependency/layout | Thiếu description/tags/port docs/usage/change summary. |
| Quick Library | `design/library/QuickLibraryPanel.tsx` và `libraryCatalog.ts` | Có card/signature/favorite/recent/insert guard | Cần trích presentation model/card/insertion adapter dùng chung. |
| OpenAPI | `contracts/openapi/openapi.yaml` | Search cursor + create/delete/deprecate; `engineer/admin` mutation | Thiếu metadata filter và usage/detail projection. |
| BE domain/store | `domain/library.go`, `store/library.go` | SYSTEM virtual read-only; PROJECT Draft→Published→Deprecated; DAG/hash/reference guard | Không cần rewrite; chỉ mở read model/migration additive nếu contract chốt. |
| Registry | `pou_library_registry_v1.json` + generator | 40 entry, category/label/signature/feature state sinh C++/Go/TS | Thiếu description/port docs/compatibility presentation. |
| FW MCU | `fw/` | Không tham gia Control Library UI | Không có gap thuộc Plan61. |

### 2.2 Kiểm tra runtime hỗ trợ lập plan

| Kiểm tra | Kết quả | Ranh giới bằng chứng |
|---|---|---|
| Focused Vitest: LibraryPage + catalog + Quick Library | **3 file / 30 test PASS** | Host component evidence, không phải target/release. |
| FE → Go backend thật + Core simulator | Trang PGM-04 mở được, request liên quan `200` | Real backend mức HOST; Core simulator không phải board/HIL. |
| Browser desktop 1680×941 | List/detail/form hiện đúng As-Built; inspector cuộn mất khỏi viewport; chưa có grid/tabs | Bằng chứng UX host. |
| Browser mobile 390×844 | Có chồng/cắt Context Strip và vẫn lộ mutation | Bằng chứng responsive host. |
| Console/Network | 0 Console error/warning; không có failed request ngoài fault chủ động | Không chứng minh acceptance Target mới. |
| Chrome DevTools MCP | Không khởi động vì môi trường thiếu X server; dùng Playwright headless thay thế | Không claim DevTools PASS. |

---

## 3. Thiết kế mục tiêu và ownership

### 3.1 Cây component

```text
ProgrammingLayout                         [giữ shell dùng chung]
├── ProgrammingFeatureRail
├── ProgrammingContextStrip
└── LibraryPage                           [route/controller + URL state]
    ├── LibraryWorkspaceHeader
    │   ├── LibraryScopeTabs              [SYSTEM | PROJECT]
    │   └── CreateBlockButton             [program.edit + desktop/tablet]
    ├── LibraryToolbar
    │   ├── CategoryFilter
    │   ├── KindFilter
    │   ├── SearchInput
    │   └── AdvancedFilterDrawer
    ├── LibraryCardGrid
    │   └── LibraryBlockCard              [shared presentation model]
    ├── LibraryInspector
    │   ├── DetailsTab
    │   ├── ParametersTab
    │   ├── UsedInTab
    │   └── VersionsTab
    ├── LibraryAuthoringDrawer
    ├── LibraryDeleteDeprecateDialog
    └── TargetPouChooser                  [standalone Insert]
```

### 3.2 Ownership và failure boundary

| State/policy | Owner | Consumer | Failure behavior |
|---|---|---|---|
| Library revision/lifecycle/hash/DAG | Go domain/store | API, compiler/package, FE | Server từ chối; FE không optimistic publish/version. |
| SYSTEM registry/signature/feature state | Canonical registry + generator | Core/compiler/Go/TS | Generator/profile mismatch fail closed; FE hiện unavailable. |
| Project/Draft/Active context | Go API/Core authority | Context Strip, PGM-02/04/05 | Stale/offline tách riêng; không fallback Project khác. |
| Filter/selection/inspector tab | URL + FE local state | PGM-04 | Reload/back giữ context; invalid key được bỏ có cảnh báo, không mutate. |
| Favorite/recent | User preference local hiện có | PGM-02/04 | Hỏng storage chỉ mất preference, không ảnh hưởng catalog/domain. |
| Permission | Server capability; FE affordance | FE actions | Direct request vẫn 401/403; FE không nâng quyền. |
| Insert transaction | PGM-02 editor command/insertion adapter | ST/FBD Draft | Cancel/mismatch/error = zero mutation; thành công = đúng một Undo transaction. |
| Control/runtime/safety | Core, ngoài PGM-04 | PGM-05/06 | Web/PGM-04 mất không dừng Program đang chạy. |

### 3.3 Bố cục responsive

| Viewport | Target |
|---|---|
| `>=1440 px` | Rail 220 px, Context Strip 36–40 px, card grid 3 cột, inspector dock 280–320 px; toolbar/inspector sticky theo vùng cuộn. |
| `1280..1439 px` | Grid 2–3 cột theo min card width 280 px; inspector 280 px; không horizontal overflow. |
| `1024..1279 px` | Grid 2 cột; inspector mở drawer; action chính vẫn keyboard reachable. |
| `768..1023 px` | Grid/list 1–2 cột; filters/drawer compact; mutation chỉ khi design pin cho tablet. |
| `<768 px` | Một cột, search/filter/detail read-only; 0 Create/Edit/Delete/Deprecate/Insert. |

### 3.4 State machine FE

```text
IDLE → LOADING → READY
          ├── EMPTY_FILTERED
          ├── EMPTY_PROJECT
          ├── ERROR_EMPTY
          └── PERMISSION

READY → REFRESHING → READY
  ├── OFFLINE_RETAINED
  ├── STALE_RETAINED
  └── PAGE_ERROR_RETAINED

AUTHORING_CLOSED → EDITING → VALIDATING → SAVING → READBACK → SUCCEEDED
                                      ├── FIELD_ERROR → EDITING
                                      ├── CONFLICT → COMPARE_OR_RELOAD
                                      ├── UNKNOWN → RECONCILING
                                      └── FAILED → EDITING

BROWSE → TARGET_REQUIRED → COMPATIBILITY_CHECK → CONFIRM → INSERTING → INSERTED
              └──────────────── cancel/mismatch/denied ───────────────→ 0 mutation
```

---

## 4. Delta dữ liệu và contract

### 4.1 Field presentation mới đề xuất

Các field dưới đây chỉ trở thành contract production sau `T61-005`. Chúng là
đầu vào cho OpenAPI/registry/store, không phải type React viết tay.

| Field | Type/limit | Required/default | Unknown semantics | Owner/validation |
|---|---|---|---|---|
| `descriptionVi` | string, 0..512 ký tự | optional, không default | vắng = chưa có metadata, FE hiện `—` | Registry/PROJECT request; trim biên, giữ nội dung bên trong. |
| `descriptionEn` | string, 0..512 ký tự | optional | như trên | Như `descriptionVi`. |
| `tags` | string[], tối đa 16, mỗi tag 1..32 | optional, mặc định `[]` chỉ khi server xác nhận | field vắng = contract cũ/unavailable; khác mảng rỗng | Server normalize case/NFC và từ chối trùng. |
| `signature.ports[].descriptionVi/En` | string, 0..256 | optional | vắng = không có tài liệu | Registry/PROJECT interface validator. |
| `signature.ports[].required` | boolean | optional | vắng = unknown, không suy `true/false` | Server/generator. |
| `signature.ports[].defaultValue` | typed JSON scalar | optional | vắng = không có default authoritative | Validate theo `dataType`; không parse chuỗi ở FE. |
| `compatibilityState` | `COMPATIBLE\|REVIEW_REQUIRED\|DEPRECATED\|UNSUPPORTED\|UNKNOWN` | required sau cutover | `UNKNOWN` fail-closed cho Insert | Server suy từ feature/version/profile, FE chỉ render. |
| `replacementEntryId` | string/null | optional | null = không có guidance | Cùng scope hoặc rule cross-scope được DDD cho phép. |
| `versionChangeSummary` | localized text/null | optional | null = chưa cung cấp | Gắn immutable với library revision. |
| `presentationSha256` | 64 hex lowercase | required khi presentation contract có mặt | field vắng = backend/catalog cũ | Hash canonical của description/tags/port docs/guidance; không gồm source/interface executable. |
| `catalogRevision` | uint64 hoặc opaque revision string | required sau cutover | field vắng = unavailable | Tăng khi catalog presentation đổi; dùng cache/ETag, không thay library semantic version. |

Không đưa usage list vào mỗi card payload. List dùng summary nhẹ; inspector tải
trễ endpoint Used-In có cursor để không làm `GET /libraries` phình không giới hạn.

`contentSha256` tiếp tục chỉ đại diện source/interface/dependency và semantics
thực thi. Sửa documentation của PROJECT entry vẫn phải mở Library Draft/revision
mới để giữ audit và immutability, nhưng nếu executable content không đổi thì
`contentSha256` giữ nguyên; `presentationSha256/catalogRevision` đổi. Với SYSTEM,
generator phải sinh presentation cho Go/TS từ registry canonical mà không buộc
C++ runtime mang string UI nếu consumer không cần.

### 4.2 Used-In read model cần khóa

Contract đề xuất:

```text
GET /programming/libraries/{libraryRevisionId}/entries/{entryId}/usages
    ?projectId=<uuid>&cursor=<opaque>&limit=1..100&state=DRAFT|SEALED|ALL
```

| Field response | Semantics |
|---|---|
| `items[].revisionId` | Revision/Draft snapshot authoritative chứa reference. |
| `items[].objectId` | POU identity canonical để deep-link PGM-02. |
| `items[].objectName` | Tên hiển thị tại snapshot; không dùng làm identity. |
| `items[].objectKind` | `PROGRAM\|FUNCTION\|FUNCTION_BLOCK`. |
| `items[].programObjectId/name` | Chỉ có khi usage quy được về Program; null không được tính thành một Program giả. |
| `items[].usageKind` | `DEPENDENCY\|CALL\|INSTANCE`. |
| `items[].state` | `DRAFT\|SEALED`. |
| `nextCursor` | Opaque; filter tuple phải được khóa vào cursor. |
| `summary.pouCount/programCount` | Đếm distinct identity; nếu backend không chứng minh được thì summary mang `available=false`, không trả 0. |

`D61-08` chỉ đóng khi Product + BE owner chốt: phạm vi Project, Draft/Active/
history nào được tính, cách SYSTEM usage được projection, và retention/version.

### 4.3 Search/filter contract

- Giữ `q`, `scope`, `kind`, `cursor`, `limit` hiện có.
- Additive: `category`, `featureState`, `tag`, `libraryState`.
- `q` sau cutover tìm name/category/description/port name/type/tag ở server.
- Cursor phải khóa toàn bộ filter tuple; dùng cursor với filter khác trả `400`.
- Budget đề xuất: P95 `<300 ms` cho 1.000 entry trên SoM, limit tối đa 100;
  response payload `<512 KiB`.
- Chuỗi query tối đa 64 ký tự, trim hai đầu, normalize Unicode; input hostile
  không được làm regex backtracking hoặc SQL wildcard escape sai.

### 4.4 Error contract và UI behavior

| HTTP/error | State giữ/đổi | UI/recovery | Side effect |
|---|---|---|---|
| `400/422` validation | Giữ form và draft client | Field message + stable code | 0 mutation. |
| `401` | Xóa affordance mutation, giữ return URL | Login rồi quay đúng route/query/selected | 0 mutation. |
| `403` | Giữ list/detail đọc được nếu endpoint đọc cho phép | Permission panel; không retry mutation | 0 mutation. |
| `404` selected entry/target | Bỏ selection invalid, giữ filter/list | Thông báo item đã mất; chọn item khác | 0 mutation. |
| `409` ETag/version/dependency | Giữ input local | Compare/reload; cấm overwrite im lặng | 0 hoặc mutation server đã xác nhận rõ. |
| `413` source/payload | Giữ form | Nêu limit định lượng | 0 mutation. |
| `503`/offline lần đầu | `ERROR_EMPTY`, không `EMPTY` | Retry thủ công | 0 mutation. |
| `503` sau snapshot tốt | `OFFLINE_RETAINED` | Giữ snapshot + nhãn stale/offline; khóa Insert/mutation | 0 mutation. |
| timeout mutation | `UNKNOWN/RECONCILING` | Poll/read-back bằng operation/ETag; không auto-replay | Không được suy thành success/fail. |
| PID review gate | Giữ selection | Badge + lý do + link evidence nếu có; Insert disabled | 0 mutation. |

---

## 5. Ánh xạ repository

### 5.1 FE — giữ, refactor và tạo mới

| Hành động | File/module | Nội dung |
|---|---|---|
| KEEP | `ProgrammingRoutes.tsx`, `ProgrammingLayout.tsx`, `ProgrammingContextStrip.tsx`, `ProgrammingFeatureRail.tsx` | Giữ route/project context/fail-closed shell; chỉ chỉnh metadata/layout có regression đủ sáu workspace. |
| KEEP | `api/mutations.ts`, `model/library.ts` | Giữ ETag/idempotency/read-back và version permissions. |
| KEEP/EXTRACT | `design/library/QuickLibraryPanel.tsx`, `libraryCatalog.ts`, `libraryPreferences.ts` | Tách shared presentation model/card/favorite/insertion adapter; không tạo catalog thứ hai. |
| REFACTOR | `library/LibraryPage.tsx` | Chỉ còn orchestration/query/URL/selection/mutation state. |
| NEW | `library/components/LibraryScopeTabs.tsx`, `LibraryToolbar.tsx`, `LibraryCardGrid.tsx`, `LibraryBlockCard.tsx` | Workspace card grid. |
| NEW | `library/components/LibraryInspector.tsx` và bốn tab | Inspector dock/drawer, lazy detail/usage. |
| NEW | `library/components/LibraryAuthoringDrawer.tsx` | Wizard PROJECT Library. |
| NEW | `library/components/TargetPouChooser.tsx` | Handoff standalone Insert. |
| NEW | `library/libraryViewModel.ts`, `libraryUrlState.ts`, `libraryPagination.ts` | Hàm thuần, test độc lập. |
| UPDATE | `api/queries.ts`, `model/types.ts`, generated client | Cursor, metadata, usages; không viết tay type có thể sinh. |

### 5.2 BE/contract/Core-SoM

| Hành động | File/module | Nội dung |
|---|---|---|
| UPDATE | `contracts/openapi/openapi.yaml` | Schema/query/usage operation/x-rbac; additive version bump. |
| UPDATE | `application/library.go` | Search tuple, usage read model, compatibility projection. |
| UPDATE | `transport/http/library.go` và route definition | Parse/validate/error/RBAC/audit read. |
| UPDATE | `store/library.go` | Query usage/cursor; PROJECT metadata persistence nếu contract chốt. |
| CONDITIONAL | migration mới sau `0013` | Chỉ additive columns/table/index; preflight + restart/rollback test. |
| CONDITIONAL | `pou_library_registry_v1.json`, schema, generator và generated C++/Go/TS | Metadata SYSTEM authoritative; bump library version/hash theo G1. |
| NO CHANGE | scheduler/Core runtime/IPC/SHM/IOP | Không thuộc UI library. |
| NO CHANGE | `fw/` | Không có firmware task. |

### 5.3 Dependency bị cấm

- Không hardcode block catalog/description/usage trong React fixture production.
- Không tạo `USER` scope trong enum FE trước server/domain/store.
- Không để PGM-04 ghi thẳng Draft source/FBD graph; phải qua command/insertion
  adapter của PGM-02.
- Không bypass PID review bằng checkbox, local-storage hoặc query flag.
- Không biến retained cache thành live truth.
- Không sửa global theme token để khớp duy nhất PGM-04 nếu chưa qua design-system
  review.

---

## 6. Bảng nhiệm vụ

### WP-00 — Authority và Detailed Design

| Mã | P | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---:|
| `T61-001` | P0 | Reconcile route/scope/RBAC/publish/PID giữa handoff, UX Active, Product/SRS/OpenAPI; ghi finding và disposition. | — | `DONE` | 1 nd |
| `T61-002` | P0 | Tạo visual spec render được cho desktop/mobile và loading/empty/error/offline/permission/PID/authoring/target chooser; khóa token/breakpoint/focus. | `T61-001` | `DONE` | 2 nd |
| `T61-003` | P0 | Cập nhật DDD/UI-UX/component mapping/field→API→state→action→RBAC→test và rollback; không dùng Plan61 thay DDD authority. | `T61-001/002` | `DONE` | 1,5 nd |
| `T61-004` | P0 | Product + Architect review, exact-pin revision/hash và mở `PLAN_READY/IMPLEMENT_READY[PGM04]`. | `T61-003` | `DONE` | 0,5 nd |
| `T61-005` | P0 | Khóa contract metadata/search/Used-In/compatibility và semantics count. | `T61-001` | `DONE` | 1 nd |

**Exit WP-00:** không còn authority conflict; visual/contract revision được pin;
mọi blocker còn lại có owner/impact/gate/unlock; `PLAN_READY=PASS` và chỉ lát cắt
có contract machine-readable mới được `IMPLEMENT_READY=GO`.

### WP-01 — Contract, BE và registry có điều kiện

| Mã | P | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---:|
| `T61-101` | P0 | OpenAPI additive cho metadata/filter/compatibility/usage; stable errors và cursor tuple. | `T61-004/005` | `DONE` (đo lại `2026-09-04`, `ISS-PGM04-01`) | 1,5 nd |
| `T61-102` | P0 | Mở registry schema/generator cho metadata SYSTEM; tách executable `contentSha256` khỏi `presentationSha256/catalogRevision`; versionHistory/hash mutation test. | `T61-101` | `DONE` (đo lại `2026-09-04`, `ISS-PGM04-02`) | 1,5 nd |
| `T61-103` | P0 | Migration/store PROJECT metadata additive, backup/preflight/restart; không rewrite revision immutable. | `T61-101` | `DONE` (đo lại `2026-09-04`, `ISS-PGM04-03`) | 1,5 nd |
| `T61-104` | P0 | Used-In application/store projection cho Draft + sealed scope đã chốt, cursor và summary available/unavailable. | `T61-101` | `DONE` (đo lại `2026-09-04`, `ISS-PGM04-04`) | 2 nd |
| `T61-105` | P0 | HTTP route/validation/RBAC/audit/error mapping; read route cho bốn role, mutation giữ `program.edit`. | `T61-103/104` | `DONE` | 1 nd |
| `T61-106` | P1 | Sinh lại client TS/registry C++/Go/TS, contract-sync và G1 re-pin cùng change-set. | `T61-102/105` | `DONE` | 0,5 nd |
| `T61-107` | P0 | Go/generator tests: hostile input, >100 cursor, filter mismatch, SYSTEM immutable, usage restart, migration fail-closed. | `T61-102..106` | `DONE` | 1 nd |

**Đính chính `T61-101` (`ISS-PGM04-01`, đo `2026-09-04`).** Trạng thái `DONE` ghi ở
bảng trên đã KHÔNG khớp source: tại `main@18ca29d`, OpenAPI chỉ mở `category`,
`description`, `presentationSha256` — `tags` và read model `compatibility` chưa
tồn tại ở bất kỳ lớp nào, và Used-In không có `nextCursor` dù đã trả
`truncated: true`. Lát `2026-09-04` thi hành phần còn thiếu và sửa hai lỗi đo
được trong cùng phạm vi:

- `upper()` của SQLite chỉ gấp ASCII, nên mệnh đề `q` phủ `description` KHÔNG
  BAO GIỜ khớp một mô tả tiếng Việt khi từ khoá mang dấu — trên một sản phẩm
  mà mọi mô tả đều viết bằng tiếng Việt, đó là một ô tìm kiếm im lặng bỏ sót gần
  hết kết quả nó hứa phủ. Sửa bằng hàm SQL `mkddc_upper` dùng chính
  `strings.ToUpper` của Go, để nhánh SQL và nhánh trong bộ nhớ gấp chữ theo cùng
  một luật.
- Route `GET /programming/library-usages` quy MỌI lỗi về `400`, nên store hỏng
  cũng trả "request không hợp lệ". Lớp application nay trả sentinel
  (`ErrInvalidRequest`/`ErrInvalidCursor`) và lớp HTTP phân biệt được 400 với 503.

Bằng chứng là số đo cục bộ (`HOST`), không phải CI: repo chưa cấp runner (#414).

**Đính chính `T61-102` (`ISS-PGM04-02`, đo `2026-09-04`).** Thân issue ghi registry
"đã có `category`, `description` và `presentationSha256`". Đo lại tại
`main@1f2cbb3`: registry chỉ có `category`; `description` và `presentationSha256`
**chưa tồn tại** ở lớp SYSTEM, và `tags` cũng chưa. Lát `2026-09-04` mở cả ba và
sửa một lỗi nằm đúng trong phạm vi:

- `render_go` băm **toàn bộ** entry vào `ContentSHA256Hex`, nên `labelVi`,
  `labelEn` và `category` — ba thứ thuần trình bày — nằm trong danh tính THỰC
  THI. Chính comment của hàm ấy đã tự nhận "hash này ghim signature/port/
  category/dispatch, KHÔNG phải hash executable", nhưng tên trường nó gán vào là
  `ContentSHA256Hex` và hợp đồng public gọi trường đó là danh tính thực thi —
  hai câu ấy không thể cùng đúng. Hệ quả: sửa một dấu tiếng Việt trong nhãn là
  đổi hash mà artifact và pin Revision đang dựa vào, tức đúng thứ `D61-09` sinh
  ra để chặn.

Bump `rev-a.3 → rev-a.4` kéo theo bốn thứ pin phải sinh lại **cùng change-set**:
product profile (+ schema `const`), golden build manifest ST/FBD (`buildKeySha256`
phụ thuộc `profile.sha256`), golden package `package_v2_ahu.mkpkg` (sinh bằng
chính `mkddc-st-package-golden`), và ba chốt SHA (`pgm02`, `g1`, `openapi`).

**Đính chính `T61-104` (`ISS-PGM04-04`, đo `2026-09-04`).** Phạm vi Draft của
Used-In trước lát này luôn trả `SEALED_ONLY` — tức "chưa đo được" — và DDD ghi
nguồn draft là "(FE, Project đang mở)", một nguồn KHÔNG authoritative. Nay server
tự đo từ `objects[].dependencies` của tài liệu Draft: cùng mảng mà đường Seal
chuyển thành bản ghi `library_usages`, nên đó là dữ liệu của máy chủ chứ không
phải cache của giao diện. `availability` lên `COMPLETE` cho entry PROJECT.

**Entry SYSTEM vẫn `UNAVAILABLE`, và đó là câu trả lời đúng chứ không phải việc
chưa làm.** Cả hai nguồn usage của sản phẩm đều không thấy chúng:
`library_usages` cố ý không giữ (migration `0007`), còn `objects[].dependencies`
chỉ chứa entry PROJECT — `recordLibraryUsagesTx` đòi mọi dependency phải có hàng
trong `library_entries` của PROJECT library revision. Một POU gọi `TON` dùng
khối SYSTEM ấy qua SOURCE ST/FBD, không qua khai báo. Đo được nó đòi phân tích
cây cú pháp, việc của compiler chứ không phải của store. **Cần gì để mở:** một
đường trích dependency SYSTEM từ AST của compiler, hoặc ghi chúng vào một bảng
usage riêng lúc Seal.

Ghi thêm một bẫy tiêm lỗi: phép tiêm phải nhắm đúng CƠ CHẾ bảo vệ. Vòng đầu tiêm
vào map khử trùng `objectId` nhưng vẫn xanh, vì thứ chặn "một POU khai cùng entry
hai lần" là câu `break` chứ không phải map ấy. Hai lớp bảo vệ khác nhau cần hai
phép đo khác nhau; gộp lại thì một lớp có thể chết mà không ai biết.

**Đính chính `T61-103` (`ISS-PGM04-03`, đo `2026-09-04`).** Cột và đường ghi đã
có từ `T61-101`, nhưng bằng chứng thì chưa: không test nào đo round-trip qua
restart, cũng không test nào migrate từ một DB schema CŨ có dữ liệu thật. Lát này
bổ sung cả hai và sửa hai lỗi phát hiện trong lúc đo:

- `presentationSha256` được đọc THẲNG từ cột. Công thức băm đã đổi một lần
  (`T61-101` thêm `tags` vào payload), nên mọi hàng ghi trước đó mang một hash mà
  không phép tính nào hiện tại tái tạo được — đo được, không phải suy đoán. Hash
  ấy tồn tại đúng để client biết "phần trình bày có đổi không", nên sau nâng cấp
  binary client sẽ thấy mọi entry cũ "đã đổi" dù không ai sửa gì, rồi thôi tin
  vào nó. Đường đọc nay TÍNH LẠI từ ba trường vừa đọc; cột giữ làm bản ghi.
- `updateLibraryEntryTx` bỏ sót bốn cột trình bày, còn `publishProjectLibraryTx`
  dựng entry canonical không mang metadata. Hai nửa của cùng một cái bẫy: nửa
  này che nửa kia, nên chưa mất dữ liệu — nhưng thêm bốn cột vào câu UPDATE
  (việc hoàn toàn hợp lý) sẽ xoá sạch mô tả và thẻ lúc publish. Sửa cả hai vế
  cùng lúc; một mình vế nào cũng là nửa vời.

Kinh nghiệm tiêm lỗi: vòng đầu có hai phép XANH, và cả hai là lỗi của TEST chứ
không phải bằng chứng test đủ. Một ca xanh vì test so `before` với `after` — khi
cột không hề được ghi thì cả hai lần đọc đều rỗng và "giống nhau". Test round-trip
phải khẳng định GIÁ TRỊ TUYỆT ĐỐI đã ghi, không chỉ khẳng định hai lần đọc bằng nhau.

**Cổng C++ đã mở lại từ lát này.** `ctest` ở `#503` ghi `NOT_RUN` vì container
không có cache `FetchContent`. Cách mở: clone bốn nguồn (`nlohmann/json v3.11.3`,
`googletest v1.14.0`, `bacnet-stack 1.3.8`, `lvgl v9.1.0`) qua giao thức git —
proxy chặn tarball HTTP nhưng **không** chặn git — rồi trỏ
`FETCHCONTENT_SOURCE_DIR_*` vào, và cài `libsodium-dev`/`libdrm-dev` (cần
`apt-get update` trước vì chỉ mục có bản `libdrm` đã bị gỡ khỏi mirror). Số đo:
**1393/1393**.

**Đính chính `T61-202` (`ISS-PGM04-05`, đo `2026-09-04`).** Trạng thái `DONE` đã
ghi cho task này là đúng một nửa: `useProgrammingLibraryPaged` có thật và
`LibraryPage` của PGM-04 dùng nó. Nhưng có **ba** đường đọc `GET /libraries`, và
hai đường còn lại xin đúng một trang `limit: 100` rồi bỏ `nextCursor`:

- `useProgrammingLibrary` — Quick Library của PGM-02 (`QuickLibraryHost`).
- `useLazyProgrammingLibraryCatalog` — chữ ký khối cho Inspector/hover
  (`ProgramsTab`).

Cái giá không phải là mã trùng, mà là mã **phân kỳ**: bản của Quick Library chưa
từng có `loadMore`, nên mọi lần sửa phân trang ở PGM-04 đều không chạm tới
PGM-02, và không ai nhận ra vì cả hai màn hình vẫn hiện một danh sách trông đầy
đủ. Với người dùng, khối thứ 101 trở đi **không tồn tại** — và bề mặt không có
câu nào phân biệt "thư viện chỉ có ngần này" với "mới đọc tới đây".

Nay cả hai là **vỏ** của cùng engine, qua tuỳ chọn `enabled` cho nạp trễ:

- Quick Library nhận thẳng trạng thái phân trang, có nút "Tải thêm khối (đã tải
  N)"; trang sau lỗi thì danh sách đã tải **giữ nguyên** và nút đổi thành "Thử
  lại trang này"; khi còn trang chưa tải, câu rỗng nói "không khớp mục nào
  **trong phần đã tải** — còn khối chưa tải" thay vì mời người dùng bỏ cuộc.
- Vỏ nạp trễ của Inspector rút cạn các trang còn lại: tra cứu chữ ký cần danh
  sách ĐẦY ĐỦ chứ không phải một danh sách cuộn được, vì Inspector không có nút
  "tải thêm" — một trang thiếu ở đó hiện thành "không xác định được chữ ký" cho
  một khối mà thư viện có công bố. Một trang hỏng thì DỪNG với phần đã đọc, chứ
  không gõ cửa máy chủ vô hạn trong một `useEffect`.
- Panel không còn đòi `status === 'ready'` mới vẽ: engine cố công giữ danh sách
  khi một lần đọc hỏng, mà điều kiện vẽ cũ lại vứt đúng danh sách ấy.

Hai bẫy tiêm lỗi mới, cùng họ "phép tiêm không chạy trông y hệt test không bắt
được":

1. **Neo của phép tiêm phải DUY NHẤT.** Phép tiêm `if (!enabled) {` vá nhầm
   `useProgrammingRuntimeMonitor` (cùng chuỗi, đứng trước trong tệp) nên báo
   XANH trong khi mã đích chưa hề bị sửa.
2. **Khẳng định "chưa gọi máy chủ" phải chạy SAU khi xả microtask.** Request nằm
   sau một `Promise.resolve().then(...)`; một khẳng định đồng bộ ngay sau render
   xanh kể cả với bản bỏ qua `enabled` hoàn toàn.

Và một bẫy của vitest đáng ghi: `beforeEach(() => client.request.mockReset())`
viết dạng biểu thức **trả về chính mock**, mà vitest coi giá trị hàm trả về từ
`beforeEach` là hàm dọn dẹp — nên nó gọi thêm `client.request()` sau mỗi test.
Với một mock đang `reject`, lần gọi thừa ấy thành unhandled rejection và test đỏ
ở một chỗ không liên quan gì tới thứ nó đang đo.

**Đính chính `T61-203` (`ISS-PGM04-06`, đo `2026-09-04`).** `libraryPresentation.ts`
có thật và PGM-04 dùng nó. Nhưng Quick Library chưa từng dùng: nó có một mô hình
THỨ HAI (`design/library/libraryCatalog.ts`) với ngữ nghĩa riêng, và hai mô hình
bất đồng ở đúng bốn chỗ đắt nhất — cả bốn đều đo được, không phải suy đoán:

| Trường | PGM-04 | Quick Library (bản cũ) | Hậu quả |
|---|---|---|---|
| `category` | `entry.category` (trường công khai `T61-101`) | `signature.category`, thiếu thì `'other'` | cùng khối, hai nhóm; lọc theo nhóm không tìm thấy nó ở một trong hai màn |
| chữ ký | chỉ `entry.signature`; vắng thì NÓI RA | vắng thì tự parse `entry.interface` | hai câu trả lời về việc nối dây vào chân nào, không có cách phân xử |
| `DEPRECATED` | chặn chèn | không biết tới | khối đã ngừng sử dụng vẫn chèn được từ bề mặt chèn nhanh |
| định danh | gom theo `scope/entryId`, chọn version hiện hành | `Map` khoá `entryId` trần trên danh sách chưa gom | Yêu thích trỏ vào một revision tuỳ ý, có thể là bản đã `DEPRECATED` |

Hàng cuối là hàng khó thấy nhất. `GET /libraries` trả **mọi** library revision
của Project (DRAFT + PUBLISHED + DEPRECATED), nên `new Map(entries.map(e =>
[e.entryId, e]))` giữ lại hàng GẶP SAU CÙNG. Sau một lần publish kế tiếp, ngôi
sao của người dùng trỏ vào bản cũ — và Quick Library còn hiện cùng một khối
nhiều lần, mỗi lần một version, không nói rõ cái nào đang dùng.

Nay chỉ còn một mô hình. `CatalogEntry` là bí danh của `LibraryPresentation`
(giữ tên vì bảy mô-đun khác đang cầm kiểu này), `catalogEntriesOf` gom bằng
`groupLibraryEntries` — đúng luật chọn version của PGM-04 — và thang bậc
"chưa dùng được" (`libraryUsability`) là một, thứ tự `REVIEW_REQUIRED` →
`DEPRECATED` → `SIGNATURE_UNAVAILABLE` là hợp đồng.

Hai thay đổi hành vi có chủ ý, ghi ra để không ai đọc nhầm thành hồi quy:

1. **FE không còn parse `interface` thô.** Đường lùi ấy sinh ra cho một chu kỳ
   nâng cấp; giữ nó ở đúng một consumer là giữ nguyên chỗ hai bề mặt bất đồng.
2. **Thiếu chữ ký nay CHẶN Insert ở cả hai** (trước: Quick Library chặn, PGM-04
   không). Bên chặn là bên đúng — không có chữ ký thì không dựng nổi một lời gọi
   đủ tham số, và thứ chèn ra sẽ không biên dịch.

Yêu thích/Gần đây khoá bằng `libraryEntryKey` = `scope/entryId`: **có** `scope`
vì `entryId` của SYSTEM là tên khối còn của PROJECT là UUID, và "chúng không thể
trùng" đúng cho tới ngày nó không còn đúng; **không** có `libraryVersion` vì
khoá theo version nghĩa là mỗi lần Seal Revision là một lần người dùng mất sạch
Yêu thích. Khoá đời cũ (`entryId` trần) vẫn phân giải được — nâng cấp không được
bắt người ta gắn sao lại từ đầu. Phép vô hiệu hoá là ngầm và đúng: khoá không
phân giải được thì không vẽ ra gì.

**Exit WP-01:** OpenAPI ↔ route Go ↔ client TS exact; metadata/usage không còn
fixture-only; old FE vẫn đọc được response additive; không có task MCU.

### WP-02 — Nền tảng FE dùng chung

| Mã | P | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---:|
| `T61-201` | P0 | Thay `canAdmin` bằng `roleCan(role, 'program.edit')`; thêm matrix viewer/operator/engineer/admin. | `T61-004` | `DONE` | 0,5 nd |
| `T61-202` | P0 | Cursor pagination/infinite loading cho PGM-04 và lazy Quick Library; retry lỗi từng page, dedupe identity/version. | `T61-101` | `DONE` (đo lại `2026-09-04`, `ISS-PGM04-05`) | 1 nd |
| `T61-203` | P0 | Trích `LibraryPresentationModel` + shared card/signature/favorite/recent từ catalog dùng chung. | `T61-004` | `DONE` (đo lại `2026-09-04`, `ISS-PGM04-06`) | 1,5 nd |
| `T61-204` | P1 | URL state typed cho tab/filter/query/selected/inspector/returnTo; back/forward/reload giữ context. | `T61-004` | `DONE` | 1 nd |
| `T61-205` | P0 | Metadata route/header và integration shell; không hồi quy PGM-01..06 hoặc tạo rail thứ hai. | `T61-002/004` | `DONE` | 1,5 nd |
| `T61-206` | P0 | Reducer/state model loading/empty/error/permission/stale/offline/pagination/detail error tách bạch. | `T61-101` | `DONE` | 1 nd |

### WP-03 — Workspace card grid và inspector

| Mã | P | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---:|
| `T61-301` | P0 | Tách `LibraryPage` thành controller và component tree §3.1; giữ mutation logic đã test. | `T61-201..206` | `DONE` | 1 nd |
| `T61-302` | P0 | SYSTEM/PROJECT tabs + toolbar Category/Type/Search/Filter/Clear; server-side filter. | `T61-301` | `DONE` | 1,5 nd |
| `T61-303` | P0 | Dense card grid: icon/kind/category/name/version/signature/description/source/usage/feature/deprecated/favorite. | `T61-203/301` | `DONE` | 2 nd |
| `T61-304` | P0 | Inspector dock/drawer với Details/Parameters/Used-In/Versions; detail error không phá list; sticky trong đúng scroll container. | `T61-301/303` | `DONE` | 2 nd |
| `T61-305` | P0 | Responsive theo §3.3; mobile read-only; không overflow; skeleton khớp hình học. | `T61-302..304` | `DONE` | 2 nd |
| `T61-306` | P0 | Keyboard/a11y: roving focus grid, Enter mở, Esc/return-focus drawer, landmark/tab/aria-live. | `T61-303..305` | `DONE` | 1,5 nd |
| `T61-307` | P1 | Semantic token light/dark cục bộ, target chạm 44×44, focus 2 px, contrast theo UX Active. | `T61-002/305` | `DONE` | 1 nd |

### WP-04 — Authoring, Used-In và Insert

| Mã | P | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---:|
| `T61-401` | P0 | PROJECT Create/Edit drawer: Metadata → Interface → Implementation → Check → Review/Save; field validation và focus. | `T61-301`, `T61-106` | `DONE` | 2,5 nd |
| `T61-402` | P0 | Giữ ETag/idempotency/read-back; PUBLISHED edit tạo Draft minor; timeout reconcile; không có Publish giả. | `T61-401` | `DONE` | 1 nd |
| `T61-403` | P0 | Used-In lazy page + deep-link exact PGM-02 bằng `objectId`, giữ filter/returnTo và dirty guard. | `T61-104/304` | `DONE` | 1,5 nd |
| `T61-404` | P1 | Preview/Open read-only cho entry và source/interface authoritative; unsupported metadata hiện rõ. | `T61-304` | `DONE` | 1 nd |
| `T61-405` | P0 | Standalone Insert mở `TargetPouChooser`, kiểm Project/mode/language/type/selection rồi gọi shared insertion adapter. | `T61-203/403` | `DONE` | 2 nd |
| `T61-406` | P0 | Zero-mutation guards: cancel/no-target/type mismatch/permission/offline/stale/REVIEW_REQUIRED; một success = một Undo. | `T61-405` | `DONE` | 1 nd |

### WP-05 — Verification, deploy và closeout

| Mã | P | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---:|
| `T61-501` | P0 | Unit/component tests cho view model, pagination, URL state, card/inspector/drawer/RBAC/full state. | WP-02..04 | `DONE` | 2 nd |
| `T61-502` | P0 | Contract/Go/generator/registry parity và migration/restart tests. | WP-01 | `DONE` | 1 nd |
| `T61-503` | P0 | Playwright mock route: desktop/mobile/keyboard/permission/offline/zero mutation. | `T61-501` | `DONE` | 1 nd |
| `T61-504` | P0 | Real-backend E2E Project Library create/edit/seal/version/usage/deep-link/insert guard; anti-mock guard. | `T61-502/503` | `DONE` | 1,5 nd |
| `T61-505` | P0 | Chrome DevTools desktop/tablet/mobile: screenshot, Console, Network, a11y, scroll/sticky và responsive. | `T61-504` | `DONE` | 0,5 nd |
| `T61-506` | P1 | Deploy Web/BE lên Forlinx, read-back version/hash/service/browser; rollback rehearsal. | `T61-504/505` | `DONE` | 1 nd |
| `T61-507` | P0 | Cập nhật Plan59/trace/risk/CHANGELOG và record evidence thật; không tự tạo Test Result PASS. | `T61-506` | `DONE` | 0,5 nd |

**Tổng 38 task, khoảng 49 người-ngày.** Đây là ước lượng planning, không phải
cam kết lịch. Nếu Product bỏ metadata/Used-In/full visual parity, phải change-
control lại AC và task; không được âm thầm giảm DoD để gọi plan hoàn tất.

---

## 7. Dependency, mốc và RACI

### 7.1 Đường găng

```text
T61-001 → T61-002/003 → T61-004/005
                           │
                           ├→ WP-01 contract/BE/registry → T61-106
                           └→ WP-02 FE foundation ────────┐
                                                         ↓
                         WP-03 workspace → WP-04 flows → WP-05 gates
```

| Mốc | Entry | Exit |
|---|---|---|
| `M61-0 Authority` | Plan61 0.1 | Candidate pin + contract decision + `PLAN_READY=PASS`. |
| `M61-1 Contract` | `IMPLEMENT_READY[contract]=GO` | OpenAPI/Go/client/generator sync; migration/rollback test. |
| `M61-2 Visual` | Contract client available | Card grid/inspector/responsive/full states component PASS. |
| `M61-3 Workflow` | Visual + usage endpoint | Authoring/deep-link/Insert/zero-mutation E2E PASS. |
| `M61-4 Target` | Host gates PASS | Forlinx deploy/read-back/rollback evidence; release vẫn độc lập. |

### 7.2 RACI và file ownership

| Lane | Responsible | Accountable | File sở hữu chính |
|---|---|---|---|
| Authority/docs | System Architect + UX | Product Owner/CTO | UX/DDD/decision/Plan61; integrator sở hữu index/changelog. |
| Contract/BE | Web API Lead | System Architect | OpenAPI, application/store/transport/migration. |
| Registry/Core-SoM | Core/Compiler Lead | System Architect | Registry/schema/generator/generated outputs; không chạm runtime path ngoài generator. |
| FE nền tảng | FE Lead A | FE Lead | query/type/shared catalog/URL state/shell. |
| FE PGM-04 | FE Lead B | FE Lead | library controller/components/styles/tests. |
| QA/E2E/target | QA + Ops | Verification Lead | test specs/evidence/deploy/rollback. |
| Shared integration | Integrator | Dev Lead | `CHANGELOG.md`, generated pin, contract join, Plan59/trace updates. |

Mỗi lane không được reset/revert/reformat file của lane khác. OpenAPI/generated
client/CHANGELOG là điểm merge tập trung; rebase phải reconcile thay đổi RBAC
đồng thời thay vì chép đè.

---

## 8. Ma trận acceptance và verification

| Scenario | Requirement/AC | Fixture và bước chính | Kỳ vọng định lượng | Evidence/authority |
|---|---|---|---|---|
| `VS-PGM04-61-001` | `AC-PGM04-01`, FE-116 | Catalog SYSTEM+PROJECT có signature đủ/thiếu | 100% card có signature thật hoặc `Không khả dụng`; 0 fabricated port | Vitest + API fixture; FE/BE reviewer. |
| `VS-PGM04-61-002` | `AC-PGM04-02` | Entry có Draft + sealed usages | Count/list khớp distinct identity; 100% row deep-link đúng `objectId` | Go integration + Playwright real. |
| `VS-PGM04-61-003` | `AC-PGM04-03` | Mở trang rồi Create/Edit | 0 authoring form khi drawer đóng; Esc/cancel trả focus và 0 mutation | Component + E2E. |
| `VS-PGM04-61-004` | `AC-PGM04-04`, SYS-110 | engineer thử sửa SYSTEM qua UI và API | UI disabled; API 403/immutable error; DB/ETag/audit mutation count 0 | Go security/store + E2E. |
| `VS-PGM04-61-005` | `AC-PGM04-05` | Program pin version cũ, có version mới incompatible | 0 silent repin; Draft/impact hiện explicit; Active giữ nguyên | Integration + Commission impact. |
| `VS-PGM04-61-006` | `AC-PGM04-06` | Standalone Insert không target/cancel/mismatch | Mỗi case 0 mutation, 0 Undo entry; success đúng 1 mutation + 1 Undo | Vitest + Playwright. |
| `VS-PGM04-61-007` | Pagination | 125 entry, limit 25 | Hiện đủ 125 identity đúng một lần; 5 page; filter đổi vô hiệu cursor cũ | Go + FE test. |
| `VS-PGM04-61-008` | RBAC | 4 role × read/mutation/direct route | Cả 4 đọc; viewer/operator mutation 403; engineer/admin theo capability | Matrix server + E2E. |
| `VS-PGM04-61-009` | PID gate, UX-009 | PID `REVIEW_REQUIRED` | Badge+reason hiện; Insert disabled; không có bypass control; 0 mutation | FE/contract/compiler test. |
| `VS-PGM04-61-010` | States, UX-020 | 503 first load, retained stale, detail 404, page error | Không case nào render thành empty/0; list còn dùng khi detail/page sau lỗi | Component + fault E2E. |
| `VS-PGM04-61-011` | Responsive/a11y | 390/768/1024/1280/1440/1680, light/dark | 0 overflow; `<768` có 0 mutation; text contrast ≥4,5:1; component ≥3:1; focus 2 px | Chrome DevTools + axe + screenshots. |
| `VS-PGM04-61-012` | Visual target | Scroll grid dài, mở inspector/drawer | Inspector/toolbar còn thấy đúng spec; 0 overlap; 0 Console error; 0 failed request ngoài fault inject | Chrome DevTools. |
| `VS-PGM04-61-013` | BE-113 | timeout/conflict/replay idempotency | Không auto-replay; cùng key+cùng hash một side effect; khác hash 409; read-back authoritative | Go integration + real E2E. |
| `VS-PGM04-61-014` | Deploy/rollback | Upgrade BE additive → FE → rollback FE/BE | Old FE vẫn chạy với BE mới; rollback không mất PROJECT Draft/version/usage | Forlinx raw log/hash + reviewer. |

`VS-PROG-U03` trong VVP vẫn là scenario release authority cho Control Library.
Các scenario Plan61 chỉ là specification hỗ trợ; không tự nâng `U03` thành PASS.

### 8.1 Lệnh gate dự kiến

Chỉ ghi PASS sau khi chạy lại trên commit implementation:

```bash
(cd apps/web-api && go vet ./... && go test ./... -count=1)
(cd apps/web-ui && npx vitest --run --environment jsdom src)
(cd apps/web-ui && npm run lint && npm run build)
(cd apps/web-ui && npx playwright test e2e/programming.spec.ts)
(cd apps/web-ui && npx playwright test e2e/programming-real.spec.ts)
python3 scripts/generate_programming_library_registry.py --check
python3 scripts/docs_iso_harness.py --expect
```

Nếu generator/registry chạm C++/SoM, chạy thêm full C++ gate với Modbus, BACnet
và HMI ON theo `AGENTS.md`. Không chạy firmware MCU vì Plan61 không sửa `fw/`.

---

## 9. Compatibility, deploy và rollback

### 9.1 Thứ tự deploy

1. Backup database/config và lưu hash artifact/source/contract.
2. Deploy migration + BE/OpenAPI additive; chạy preflight/read-back bằng old FE.
3. Nếu registry đổi: deploy package Core/BE cùng library version/profile tương
   thích; không activate revision pin version chưa có trên target.
4. Deploy FE mới và kiểm login/direct route/list/detail/mutation denial.
5. Chạy smoke real-backend, Console/Network, desktop/mobile.
6. Chỉ sau read-back mới đóng task deploy.

### 9.2 Partial deployment

| Trạng thái | Hành vi bắt buộc |
|---|---|
| BE mới + FE cũ | Response additive, old FE vẫn parse; không bắt field mới required trước cutover. |
| FE mới + BE cũ | Capability/field/endpoint thiếu → unavailable, khóa usage/Insert; không fabricate. |
| Registry mới + Core/package cũ | Version/profile mismatch fail closed; không Commission. |
| FE mất/restart | Program Active tiếp tục ở Core; preference có thể mất, Draft/library store không đổi. |

### 9.3 Rollback

- Trigger: login/direct route hỏng, catalog không đầy đủ, mutation sai role,
  silent version repin, data migration mismatch, Console loop hoặc E2E real fail.
- Rollback FE trước về artifact trước deploy; BE additive có thể giữ nếu old FE
  tương thích.
- Chỉ rollback BE/schema sau backup và migration rehearsal. Không drop column/
  table chứa metadata/usage trong hot rollback; forward-fix hoặc binary rollback
  đọc schema additive.
- Không giảm SYSTEM library version nếu đã có sealed Revision pin version mới;
  giữ cả package cũ/mới và restore theo manifest/LKG authority.
- Dữ liệu phải giữ: Project/Draft ETag, library revision/entry/source/interface,
  usage snapshot, audit/idempotency receipt, favorites/recent nếu còn hợp lệ.

---

## 10. Rủi ro và blocker

| Mã | Rủi ro/blocker | Mức | Owner | Ảnh hưởng/gate | Điều kiện mở/giảm thiểu |
|---|---|---|---|---|---|
| `R61-01` | PNG không phải visual authority Active | P0 | Product + Architect | Chặn `PLAN_READY` | Pin desktop/mobile/full-state asset + DDD revision. |
| `R61-02` | `USER` scope trong handoff nhưng không có Product/API/store | P0 | Product | Chặn nếu UI còn tab User | Plan61 loại User; muốn thêm phải mở Product/ADR/contract/plan riêng. |
| `R61-03` | Asset bật Insert PID review-required | P0 | Controls/Safety + UX | Chặn visual pin | Sửa asset: badge/reason/disabled Insert; test zero mutation. |
| `R61-04` | Used-In semantics chưa khóa, đặc biệt SYSTEM/history | P0 | Product + BE | Chặn contract/AC-02 | Đóng `D61-08` và OpenAPI typed. |
| `R61-05` | FE hardcode metadata để giống ảnh | Cao | FE Lead | Data truth | Contract-first; missing render unavailable; review fixture boundary. |
| `R61-06` | Catalog >100 bị cắt | Cao | FE/BE | Search completeness | Cursor E2E 125-entry và page error retained. |
| `R61-07` | Refactor shell làm hồi quy PGM-01..06 | Cao | FE Lead | Route/UX regression | Giữ shared tests + E2E đủ sáu route; không đổi rail riêng PGM-04. |
| `R61-08` | RBAC handoff cũ khác bốn-role contract | Cao | Product/Security/FE | Permission gate | Capability matrix server-generated; reconcile docs ở WP-00. |
| `R61-09` | Registry metadata bump làm lệch compiler/package | Cao | Core/Compiler | Commission fail closed | Generator parity/versionHistory/G1 pin và deploy ordering. |
| `R61-10` | Inspector sticky sai scroll container | Trung bình | FE | Visual parity | Chrome scroll/hit-test tại 1280/1440/1680. |
| `R61-11` | Theme light cục bộ làm giảm contrast/dark mode | Trung bình | UX/FE | A11y | Semantic tokens + automated/manual contrast. |
| `R61-12` | Gọi host browser evidence là target/HIL | P0 governance | QA/Release | `RELEASE_READY` | Gắn scope evidence; target/HIL/Test Result vẫn độc lập. |
| `R61-13` | Handoff manifest tự lệch package `v2.2`/field `2.3` và có asset path thiếu | P0 docs | Document Control | Chặn `PLAN_READY`/exact pin | Sửa manifest/path, hash lại asset và docs harness PASS. |

---

## 11. Definition of Done và gate

### 11.1 Definition of Done PGM-04

- [x] `T61-001..507` đã `DONE`.
- [x] Target visual desktop/mobile/full states được pin (`SPEC-PGM04-VISUAL-001`);
      không còn xung đột route/scope/RBAC/PID/publish (`REC-PGM04-AUTHORITY-001`).
- [x] OpenAPI/Go/client/registry exact-sync — `verify_programming_g1_contracts.py`,
      `verify_programming_pgm02_contract.py`, `generate_programming_library_registry.py --check`
      đều PASS sau re-pin `1.31.0 → 1.32.0`. Migration test xanh.
      **Rollback test: `NOT_RUN` — xem dòng cuối.**
- [x] Không có catalog presentation thứ hai: nhãn nhóm và tập giá trị `category`
      đều đọc từ `PROGRAMMING_LIBRARY_CATEGORY_ORDER` của registry; chữ ký đọc
      `signature` của server và **không** parse `interface` ở FE.
- [x] `AC-PGM04-01..06` có evidence: xem [`EV-PGM04-WP0304-CLOSEOUT-001`](../07_records/reviews/PGM04_WP03_WP04_CLOSEOUT_2026-08-29.md).
      `VS-PGM04-61-001..013` có evidence; **`VS-PGM04-61-014` một nửa** — nhánh
      upgrade đã đo trên bo, nhánh rollback `NOT_RUN`.
- [x] Matrix bốn vai được test ở UI (`libraryEntryPermissions`, `LibraryPage.test.tsx`)
      và ở direct API (`security_matrix_test.go`).
- [x] Desktop/mobile/keyboard/a11y/Console/Network đạt ngưỡng §8: axe
      serious/critical = 0 ở cả `desktop-chrome` và `mobile-chrome`;
      `expectNoBrowserFailures` = 0 console.error / 0 request lỗi; số đo bố cục
      không tràn ngang ở 1440/1280/1024/768/390 px. Light/dark do
      `contrast.test.ts` canh trên chính token đang dùng.
- [~] Deploy/read-back Forlinx có artifact hash và raw log
      ([hồ sơ](../07_records/test-evidence/fw-som/2026-08-29-foxlinx-pgm04-library-deploy.md));
      **rollback rehearsal `NOT_RUN`**.
- [x] Trace/risk/docs/CHANGELOG cập nhật cùng change-set.
- [x] Phần chưa chạy được ghi `NOT_RUN`, không nâng release gate.

**`NOT_RUN` — diễn tập rollback trên bo.** Bản sao lưu đã có sẵn trên thiết bị
(`/opt/mkddc-web/mkddc-web.bak-pgm04-20260829T085228Z` và
`dist.bak-pgm04-20260829T085228Z`) và các bước đã ghi trong hồ sơ deploy §1,
nhưng phép diễn tập chưa được thực hiện: lệnh khôi phục bị cơ chế phê duyệt của
môi trường thi hành từ chối. Cần một lần chạy có phê duyệt để đóng nốt
`VS-PGM04-61-014`. Không suy diễn tập chưa chạy thành PASS.

### 11.2 Trạng thái ba cổng tại phiên bản 0.2

| Gate | Verdict | Lý do |
|---|---|---|
| `PLAN_READY[PGM04-V21]` | **PASS** | Đóng ở [`AUTH-PROG-2026-08-29-PGM04-002`](../07_records/reviews/AUTH-PROG-2026-08-29-PGM04-002.md); visual/contract đã exact-pin. |
| `IMPLEMENT_READY[PGM04]` | **GO** | `-002` mở WP-01/WP-02; [`-003`](../07_records/reviews/AUTH-PROG-2026-08-29-PGM04-003.md) mở WP-03/WP-04/WP-05. |
| `RELEASE_READY` | **NO-GO** | KHÔNG đổi. Do Plan59/VVP/risk/release authority quyết; Plan61 không có quyền nâng, và việc đóng Plan61 không phải một phép nâng. |

WP-00 là planning/change-control nên được phép bắt đầu trong trạng thái trên.
Không task production code nào được promote `READY` chỉ vì file plan tồn tại.

### 11.3 Sign-off

| Vai trò | Trạng thái phiên bản 0.1 | Điều kiện ký |
|---|---|---|
| Product Owner/CTO | `PENDING` | Chốt visual Target, Used-In semantics và loại/không loại User scope. |
| System Architect | `PENDING` | Đóng route/ownership/contract/hash/deploy/rollback và exact pin. |
| FE Lead | `PENDING` | Review component tree, responsive, a11y, task/ước lượng và file ownership. |
| Web API Lead | `PENDING` | Review schema/search/usage/migration/error/RBAC. |
| Controls/Safety | `PENDING` | Xác nhận PID visual/Insert fail-closed; không phải approval PID production. |
| Verification Lead | `PENDING` | Review scenario, fixture, expected, evidence và independence. |

Không trạng thái `PENDING` nào được diễn giải thành waiver hoặc approval. Nếu có
record uỷ quyền implementation mới, phải dẫn exact scope/revision/hash và vẫn giữ
Test Result/release authority độc lập.

---

## 12. Tự kiểm `DD-01..DD-13` và mức trưởng thành

Plan61 là **Implementation Plan**, không thay thế Detailed Design. Bảng dưới đây
đảm bảo plan không che lỗ hổng DDD và chỉ ra đúng predecessor phải đóng.

| Mã | Kết quả | Bằng chứng/lý do |
|---|---|---|
| `DD-01` Metadata | PASS cho plan | Metadata đầu file + revision history. |
| `DD-02` Mục tiêu/phạm vi | PASS cho plan | §0–§1. |
| `DD-03` As-Built | PASS cho plan | §2 source + runtime evidence scoped. |
| `DD-04` Target ownership | PASS cho plan | §3 component/ownership/failure boundary. |
| `DD-05` Data từng field | BLOCKED | §4.1 là proposal; owner Product+BE, chặn WP-01, mở khi `T61-005` ký. |
| `DD-06` Interface | BLOCKED | Used-In/search contract chưa machine-readable; owner BE+Architect, chặn WP-01. |
| `DD-07` State/algorithm/timing | PASS cho plan | §3.4 + budget §4.3; chi tiết transaction giữ ở DDD/domain hiện hành. |
| `DD-08` UX flow | BLOCKED | Component/responsive đã có nhưng visual full-state chưa render/pin; owner UX, chặn `PLAN_READY`. |
| `DD-09` Error/safety/security | PASS cho plan | §4.4, PID/RBAC/zero-mutation và rủi ro. |
| `DD-10` Repository mapping | PASS cho plan | §5. |
| `DD-11` Verification | PASS cho plan | §8 fixture/expected/target/authority. |
| `DD-12` Deploy/rollback | PASS cho plan | §9. |
| `DD-13` Trace/risk/sign-off | BLOCKED | §10–§11; Product/Architect chưa pin/sign; chặn `PLAN_READY`. |

Maturity hiện hành: **M2 — DRAFT CONTENT**. Chỉ chuyển M3 khi bốn ô BLOCKED
được đóng trong authority/DDD, link/harness sạch và self-check được đo lại.

---

## 13. Revision history

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-28 | Tạo Plan61 từ audit handoff, source và runtime PGM-04; khóa SYSTEM/PROJECT, project-scoped route, capability RBAC, PID gate, publish-on-Seal; lập 38 task FE/BE/registry/QA và giữ MCU/HIL/release ngoài phạm vi. |
