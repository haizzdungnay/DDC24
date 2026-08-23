# Plan 60 — Triển khai FE theo FE Handoff v2.1: shell dùng chung + PGM-01 Overview

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-FE-PGM-060` |
| Phiên bản | 1.1 |
| Trạng thái | **PLAN_READY — 7/7 quyết định đã chốt 2026-08-23; sẵn sàng thi hành** |
| Ngày | 2026-08-23 |
| Chủ quản | Dev Lead (FE) + System Architect + Product Owner |
| Authority đầu vào | `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/README_FE_HANDOFF.md`, `PGM-01_OVERVIEW_FE_HANDOFF.md`, `assets/PGM-01_overview.png` |
| Quan hệ với Plan 59 | **Bổ sung, không thay thế.** Plan 59 sở hữu contract/runtime/lifecycle; Plan này sở hữu delta UI của handoff v2.1 |
| Baseline source | `aa08ac5` (= `main`, đo lại 2026-08-23 tại Batch 0). Baseline cũ `a35f578` (nhánh `feat/t59-201-control-library-domain`) **đã lạc hậu**; nhánh thi hành Plan 60 là `feat/plan60-pgm01` tách từ `main` |
| Phạm vi | Shell dùng chung (README §3) + **PGM-01 Overview trọn vẹn**. PGM-02..06 **ngoài phạm vi** (chỉ thừa hưởng shell) |
| Prompt thi hành | [`PROMPT-PLAN60-CTIO-MULTIAGENT`](PROMPT_PLAN60_CTIO_MULTIAGENT_EXECUTION.md) v1.0 — đội 5 lane, ma trận sở hữu file, lịch 5 batch |

---

## 0. Mục tiêu và cách đọc

Gói handoff v2.1 là **đầu vào thiết kế mới**, không phải bản mô tả cái đang có.
Plan này đưa FE từ hiện trạng (`T59-503` DONE: sáu route + thanh context ngang)
tới đúng hợp đồng shell của README v2.1 và tới **PGM-01 Overview đầy đủ sáu khối**
mà `PGM-01_OVERVIEW_FE_HANDOFF.md` mô tả.

Cách đọc: §2 là đối chiếu trung thực As-Built ↔ handoff; §3 là **các lỗ hổng dữ
liệu backend** khiến một phần mockup hiện KHÔNG thể render trung thực; §4 là
quyết định phải chốt khi duyệt plan; §6 là bảng nhiệm vụ thi hành; §8 là ma trận
truy nguyên `AC-PGM01-01..06`.

### 0.1 Nguyên tắc không thương lượng (kế thừa README §5 và Plan 59 §1.2)

1. **FE không chế dữ liệu.** Thiếu số liệu ⇒ `—` / `Chưa rõ`, tuyệt đối không `0`.
2. **Server là authority.** Không cập nhật lạc quan cho Active/Commission.
3. **Timeout = `UNKNOWN`/`RECONCILING`**, không suy thành thành công.
4. Draft / Check / Commission / Active / Running là **năm sự thật tách bạch**.
5. **Ảnh trong `/assets` là tham chiếu bố cục, không phải chuẩn pixel** (README §5.10) —
   xem §4 về các con số trong ảnh mâu thuẫn với profile thật.
6. Màu không bao giờ là tín hiệu duy nhất.
7. Mỗi route đúng một `<h1>`.

### 0.2 Trạng thái task

| Trạng thái | Ý nghĩa |
|---|---|
| `READY` | Đủ quyết định để bắt đầu ngay |
| `ORDERED` | Đã thiết kế; tự chuyển `READY` khi dependency `DONE` |
| `DONE` | Code + test + docs + số đo đã kiểm lại |

---

## 1. Baseline As-Built (đọc từ code, không chép tài liệu)

| Thành phần | Đường dẫn | Hiện trạng |
|---|---|---|
| Route sáu workspace | `apps/web-ui/src/features/programming/ProgrammingRoutes.tsx` | Đủ sáu route canonical, có redirect legacy |
| Shell layout | `layout/ProgrammingLayout.tsx` | Header + nav ngang + context bar + `<Outlet/>`, xếp dọc |
| Nav | `layout/ProgrammingDesktopNav.tsx` | **Tab ngang**, không phải rail dọc 220 px |
| Thanh context | `layout/ProgrammingContextBar.tsx` | 6 ô `<dl>` trong panel cao ~76 px, **không sticky**, **hiện thẳng revision UUID** |
| Overview | `overview/OverviewPage.tsx` | 5 panel: Running application / Core & safe state / Draft attention / Attention list / Recent audit |
| Read-model dùng chung | `api/queries.ts` | `capabilities`, `runtime`, `projects`, `programIntents`, `revisionChanges`, `audit`, `monitor`, `signals` |
| Bảng dùng chung | `shared/components/DataTable.tsx` | Có sẵn, hỗ trợ loading/error/empty |
| Rail toàn cục | `shared/components/NavRail.tsx` | Rail 4 nhóm của toàn app (`ADR-032`), có hợp đồng test route↔menu |

**Baseline đo lại tại `aa08ac5` (Batch 0, 2026-08-23, mức HOST)** — đo trên bản
xuất sạch của `aa08ac5`, không lẫn thay đổi chưa commit của phiên khác:

| Cổng | Lệnh | Số đo | Exit |
|---|---|---|---|
| C++ | `cmake --fresh` → `cmake --build` → `ctest` | **1227/1227 pass** | configure `0` / build `0` / ctest `0` |
| Go | `go vet ./...` + `go test ./... -count=1` | 19 package `ok`, 0 fail | `0` / `0` |
| FE unit | `npx vitest --run --environment jsdom src` | **124 file / 1161 test pass** | `0` |
| FE lint | `npm run lint` | pass (kèm `check_ui_strings.py`) | `0` |
| FE build | `npm run build` | pass, 995 ms | `0` |
| E2E mock | `npx playwright test e2e/programming.spec.ts` | **10/10 pass** | `0` |
| Contract | `npm run check:programming-api` | 31 operation đồng bộ | `0` |
| Cổng dự án | `scripts/verify-project.sh --component layout` | PASS toàn bộ | `0` |
| Tài liệu | `python3 scripts/docs_iso_harness.py --expect` | PASS, khớp ngưỡng | `0` |

Số cũ của Plan 59 §3.6 (`124 file / 1161 test`, E2E mock `61/61`) **không được dẫn
lại làm bằng chứng**; bảng trên là số đo của chính Plan 60. Con số E2E `61/61` là
của **toàn bộ** thư mục `e2e/`; cổng mà Plan 60 dùng (`e2e/programming.spec.ts`)
là **10** case.

---

## 2. Đối chiếu As-Built ↔ Handoff v2.1

### 2.1 Shell dùng chung (README §3)

| Yêu cầu handoff | Hiện trạng | Delta |
|---|---|---|
| Feature Rail 220 px bên trái | Tab ngang dưới header | **Phải làm lại bố cục** — xem D-01 |
| Context Strip cao **36–40 px, sticky** | Panel ~76 px, cuộn theo trang | **Phải thu gọn + sticky** |
| Context Strip hiện: tên controller, Draft rev + dirty/check, Active rev + runtime, Core, số Program đang chạy | Có đủ 6 dữ kiện nhưng dàn 6 ô | Bố cục lại thành 1 hàng |
| **Raw ID ẩn mặc định**, lộ qua popover `Details` + `Copy` | **Hiện thẳng `revisionId` UUID** ở 2 ô | **Vi phạm `AC-PGM01-01`** |
| Vùng làm việc + Inspector 280–320 px + bottom panel | Chỉ có `<Outlet/>` | Ngoài phạm vi PGM-01 (thuộc PGM-02) — chừa khe cắm |
| Bộ trạng thái ngữ nghĩa `good\|warning\|fault\|unknown\|stale\|disabled\|reconciling` | `StatusBadge` dùng tập khác (`online/off/on/fault/stale/unknown/degraded/…`) | **Phải ánh xạ + bổ sung `reconciling`, `disabled`** |

### 2.2 PGM-01 Overview

| Khối handoff §1 | Hiện có | Delta |
|---|---|---|
| `SystemHealthHero` | Rải ở `CoreSafeStatePanel` (không có hero) | **Mới** |
| `DraftActiveCompareCard` | Không có; Draft và Active nằm ở hai panel rời | **Mới** — kèm số thay đổi + `Compare` |
| `NeedsAttentionCard` | `ProgrammingAttentionList` — chỉ 3 mã, mọi mục deep-link **cùng một** đích `/runtime` | **Sửa**: sắp theo severity, deep-link đúng trang chủ quản |
| `ProgramsSummaryTable` | **Không có** | **Mới** — 6 cột, xem §3 |
| `QuickActions` | Nút rải trong từng panel | **Mới** — hàng full-width, độ ưu tiên thị giác thấp |
| Đúng **một** CTA chính theo bảng 5 trạng thái | `DraftPrimaryAction` chỉ 4 nhánh, và `RunningApplicationPanel` có nút thứ hai ⇒ **hai nút primary cùng lúc** | **Vi phạm `AC-PGM01-05`** |
| Không hiện UUID mặc định | `RunningApplicationPanel` in `activeRevisionId` dạng `font-mono` | **Vi phạm `AC-PGM01-01`** |
| `<768 px`: card xếp chồng, bảng thành card, bottom-nav tối đa 4 đích | Mobile nav hiện **6 đích** (`ProgrammingMobileNav`) | **Sửa** còn 4: Overview / Runtime / Check / More |
| Skeleton khớp hình học card/bảng | `StateBlock state="loading"` chung chung | **Sửa** |
| `Draft == Active` ⇒ thu gọn thành “Không có thay đổi chờ vận hành” | Không có nhánh này | **Mới** |

---

## 3. Lỗ hổng dữ liệu backend — phần chặn thật của mockup

Đây là phần quan trọng nhất của plan. `ProgramsSummaryTable` theo handoff cần
`Program | Language | Cycle | Runtime State | Last Exec | Health`. Đọc code thật:

| Cột | Nguồn hiện có | Kết luận |
|---|---|---|
| **Program** (tên) | `GET /revisions/{activeRevisionId}` trả `snapshot.objects[]` gồm `kind='PROGRAM'` + `payload` (`application/projects.go:415-426`) | **ĐÃ CÓ** — chỉ cần nối FE, không phải lỗ hổng BE |
| **Language** | Như trên | **ĐÃ CÓ** |
| **Cycle khai báo** | Program set của Draft/Revision v2 mang `periodMs` theo từng Program (`application/draft_v2.go:120,376,794`, `T59-402`) | **ĐÃ CÓ** |
| **Cycle Time đo được** (mock ghi `5.6 ms`) | Core đo `last_exec_ns` theo từng Program (`st_scheduler.cpp:829-830`) | **Chưa có đường xuất** |
| **Runtime State** | `GET /projects/{id}/programs` → `runtimeState` | **Không phải giá trị sống.** Người ghi duy nhất là đường mutation intent (`application/runtime_intent.go:178`); không có bất kỳ vòng đối soát nào. Mở Overview sau khi Core đổi trạng thái vẫn thấy giá trị đóng băng từ lần Enable/Disable gần nhất |
| **Last Exec** | Core có `last_exec_ns`/`max_exec_ns` **theo từng Program** (`st_scheduler.hpp:180-181`); HTTP chỉ có `TaskMetricsView` mức **Task** (`application/monitor.go:46-56`) | **Chưa lộ ra HTTP** |
| **Health** | Không tồn tại ở bất kỳ tầng nào | **Chưa có** — phải định nghĩa và tính ở server (D-04) |
| Nhãn `Draft v14` / `Active v12` | Bảng `revisions` có cột `sequence` (`store/commands.go:317`) nhưng `GET /revisions/{id}` chỉ trả `revisionId/projectId/state/contentHash/createdAt/snapshot` | **Chưa lộ ra HTTP** |
| Số thay đổi (`12 Thay đổi`) | **Có** — `GET /revisions/{from}/changes/{to}` (`useProgrammingRevisionChanges`) | Dùng được ngay, `from='none'` khi chưa có Active |

### 3.1 Phân loại đúng mức độ

| Nhóm | Nội dung | Khối lượng |
|---|---|---|
| **A — Đã có, chỉ cần nối FE** | Tên/`language`/chu kỳ khai báo của Program đang chạy (`GET /revisions/{activeRevisionId}`), số thay đổi, chẩn đoán Check, sức khoẻ Core/safe-state/Task | 0 việc BE |
| **B — Dữ liệu có trong DB, chưa lộ qua API** | `dirty` (so `drafts.content_sha256` với `content_hash` của base revision, `migrations/0001_programming_v1.sql:37-46`), `revisions.sequence` cho nhãn `#14` | BE nhỏ, không đụng Core |
| **C — Core đã TÍNH nhưng KHÔNG CÓ ĐƯỜNG XUẤT** | Trạng thái sống theo Program, `last_exec_ns`, `max_exec_ns`, `missed_release_count` | Phải mở đường IPC/snapshot |
| **D — Chưa tồn tại ở bất kỳ tầng nào** | `health` (định nghĩa + phép tính) | Thiết kế mới, nhỏ, dựa trên nhóm C |

**Hệ quả:** nhóm C là điểm chặn thật, và nó **không phải thiếu tính năng ở Core** —
scheduler đã đo đủ; thứ thiếu là một đường truyền. Nhóm D phụ thuộc nhóm C. Vì vậy
Plan 60 mở **Pha P0** trước Pha FE, nhưng phạm vi P0 hẹp hơn tưởng: mở đường + tính
`health`, không phải cài lại phép đo.

---

## 4. Quyết định — ĐÃ CHỐT

Bảy quyết định dưới đây **đã chốt** ngày 2026-08-23 sau khi đọc lại code Core/BE.
Mỗi dòng ghi cả phương án bị loại và lý do loại, để lần sau muốn đảo phải biết
mình đang đảo cái gì.

| Mã | Chốt | Lý do | Phương án bị loại |
|---|---|---|---|
| **D-01** | **Focus mode**: trong `/eng/programming`, rail Programming 220 px **thay** rail toàn cục; bắt buộc có mục `← Thoát Lập trình` ở đầu rail | Mockup vẽ đúng như vậy — rail mang logo sản phẩm và **không** có nav toàn cục nào khác. Ngân sách ngang là lý do quyết định: `NavRail` toàn cục rộng `232 px` (`NavRail.tsx:209-211`); để hai rail thì ở 1280 px chỉ còn 828 px cho workspace, và PGM-02 (cây POU 220 + editor + inspector 280) sẽ chỉ còn ~328 px cho editor — không dùng được. Focus mode giữ 1060 px | (b) hai rail + thu gọn rail toàn cục còn 68 px: được 992 px nhưng thừa một lớp điều hướng mockup không có; (c) giữ tab ngang: tốn 0 px nhưng trái thiết kế |
| **D-02** | Bỏ cột `Task`. Sáu cột: `Program \| Language \| Cycle \| State \| Last Exec \| Health` | Tài liệu §2 là bản quy phạm, ảnh chỉ là tham chiếu bố cục (README §5.10). Quan trọng hơn: từ `T59-402` mỗi Program tự release theo chu kỳ riêng, **Task không còn là đơn vị chạy** — hiện cột Task ở Overview là dạy người dùng một mô hình đã lỗi thời | Giữ cột Task theo ảnh |
| **D-03** | Không chép số trong ảnh; mọi chu kỳ render từ dữ liệu thật | Profile Rev A cho `taskPeriodsMs = [1000, 5000, 30000]` (`application/runtime.go:136`); `10 ms`/`100 ms` trong ảnh không tồn tại trong sản phẩm | Sửa profile cho khớp ảnh — là quyết định sản phẩm, ngoài Plan này |
| **D-04** | `health` do server tính, **nullable**, bốn giá trị khi có. Công thức ở §4.2 | Server là authority; FE tự tính là vi phạm README §5.4. Để `null` cho Program không chạy trung thực hơn là bịa thêm một giá trị enum | Enum 4 giá trị không cho `null` ⇒ Program `DISABLED` buộc phải mang một nhãn sức khoẻ vô nghĩa |
| **D-05** | Lộ `revisions.sequence`; nhãn `Draft #14` / `Active #12`; UUID chỉ nằm trong popover `Details` | Cột đã có sẵn từ `0001_programming_v1.sql`, không cần migration. Thoả `AC-PGM01-01` mà vẫn cho người dùng một định danh đọc được | Hiện UUID rút gọn — vẫn thoả AC nhưng khó đọc và dễ nhầm giữa hai revision cùng tiền tố |
| **D-06** | Dùng `useI18n().pick`, một ngôn ngữ tại một thời điểm | In song ngữ cứng sẽ phá `check_ui_strings.py` và làm rò tiếng Việt ở chế độ EN — đã có tiền lệ `BUG-018` | In song ngữ như ảnh |
| **D-07** | Ánh xạ theo §4.1. **`STARTING`/`STOPPING`/`WAITING` không bao giờ sinh ra từ chuyển tiếp**, chỉ `WAITING` được dùng cho trạng thái nghỉ | Đọc code: `start()`/`stop()`/`disable()` đổi trạng thái **đồng bộ, tức thì** (`st_scheduler.cpp:575,593,615`) — không có pha trung gian nào. BE đã ghi rõ điều này: *"Giữ STARTING/STOPPING sau OK sẽ làm UI kẹt vĩnh viễn ở một chuyển tiếp không hề tồn tại"* (`runtime_intent.go:199-201`) | Bản nháp đầu của Plan này ánh xạ `ACTIVE → STARTING` — **đã loại**, vì mâu thuẫn thẳng với quyết định trên |

### 4.1 D-07 — bảng ánh xạ trạng thái (chốt)

| `StProgramState` (Core) | Ý nghĩa thật trong Core | → Hợp đồng | Gợi ý `health` |
|---|---|---|---|
| `RUNNING` | Đang chạy chu kỳ | `RUNNING` | tính theo §4.2 |
| `STOPPED` | Đã nạp, **được phép chạy**, chưa start. `enable()` đáp xuống đây chứ không phải `RUNNING` (`st_scheduler.cpp:606`) | `WAITING` | `null` |
| `ACTIVE` | Gói vừa activate, **chưa chạy tick nào** (`committed_since_activation=false`), `start()` chấp nhận | `WAITING` | `null` |
| `ROLLED_BACK` | Gói rollback đã activate, `start()` chấp nhận | `WAITING` | `DEGRADED` |
| `DISABLED` | Bị tắt có chủ đích | `DISABLED` | `null` |
| `FAULTED` | Lỗi khi chạy | `FAULTED` | `FAULT` |
| `REJECTED` | Activate thất bại **và không có gói cũ để giữ** (`st_scheduler.cpp:705`); `start()` từ chối | `FAULTED` | `FAULT` |
| `EMPTY`, `STAGED`, `VALIDATED`, `READY` | Pha vòng đời **trước vận hành** | `UNKNOWN` | `UNKNOWN` |
| giá trị ngoài bảng | — | `UNKNOWN` | `UNKNOWN` |

`ROLLED_BACK` **không** ánh xạ thành `FAULTED`: `start()` chấp nhận nó, nên nó là
trạng thái nghỉ, không phải trạng thái lỗi. Việc "đã có rollback" được nói bằng
`health = DEGRADED`, đúng chỗ của nó. Đây là lý do `runtimeState` và `health` phải
là **hai trường**: một trả lời *đang làm gì*, một trả lời *có gì bất thường không*.

### 4.2 D-04 — công thức `health` (chốt)

Xét theo thứ tự, dừng ở điều kiện khớp đầu tiên:

| # | Điều kiện | `health` |
|---|---|---|
| 1 | `runtimeStateSource != CORE_LIVE` (Core im, hoặc trường `programs` vắng) | `UNKNOWN` |
| 2 | `runtimeState == FAULTED` | `FAULT` |
| 3 | `runtimeState ∈ {DISABLED, WAITING, UNKNOWN}` | `null` (FE hiện `—`) |
| 4 | `consecutiveMissedRelease > 0` | `DEGRADED` |
| 5 | `maxExecNs > 0.8 × periodMs` | `DEGRADED` |
| 6 | Core state là `ROLLED_BACK` | `DEGRADED` |
| 7 | còn lại (`RUNNING`, không dấu hiệu nào) | `HEALTHY` |

**ĐÍNH CHÍNH THỨ TỰ (2026-08-23, khi thi hành `T60-014`).** Điều 6
(`ROLLED_BACK ⇒ DEGRADED`) phải được xét **NGAY TRƯỚC** điều 3, không phải sau.
`ROLLED_BACK` ánh xạ thành `WAITING` theo §4.1, nên với thứ tự viết ban đầu điều
3 (`WAITING ⇒ null`) luôn khớp trước và **điều 6 không bao giờ chạy tới được** —
trái với chính bảng §4.1 và phần lời D-07 (*"việc đã có rollback được nói bằng
`health = DEGRADED`, đúng chỗ của nó"*). Thứ tự đúng: **1 → 2 → 6 → 3 → 4 → 5 →
7**. Không điều nào khác đổi vị trí. Đây là sửa lỗi soạn thảo để D-04 **thi hành
được**, không phải đảo quyết định: cả hai chỗ khác của cùng quyết định đều đòi
`DEGRADED`, chỉ riêng bảng §4.2 xếp sai chỗ làm điều khoản đó thành chữ chết.

**Điều 5 có một điều kiện tiên quyết chưa ghi:** bỏ qua khi `periodMs = 0`. Core
phát `period_ms = 0` khi không phân giải được chu kỳ hiệu lực; so với ngưỡng
`0,8 × 0` sẽ dán `DEGRADED` cho mọi Program từng chạy dù chỉ một nano-giây. Cài
đặt so bằng số nguyên (`periodMs × 800_000` ns) để không phụ thuộc làm tròn dấu
phẩy động ở đúng cạnh ngưỡng.

**Không dùng `missedReleaseCount` tuyệt đối** cho điều kiện 4: nó là bộ đếm tích luỹ
từ lúc start, nên một lần lỡ nhịp cách đây một giờ sẽ ghim Program ở `DEGRADED` vĩnh
viễn. Vì vậy `T60-001/002` thêm `consecutive_missed_release` — đặt cùng chỗ đang cộng
`missed_release_count` (`st_scheduler.cpp:105-118`), reset về 0 mỗi lần release đúng
hạn. Đây là **phép đo mới duy nhất** của Plan này, và nó rẻ vì dùng lại đúng khuôn
`consecutive` mà task monitor đã có.

---

---

## 5. Kiến trúc FE đích

```text
ProgrammingLayout
├── ProgrammingFeatureRail       220px, dọc, 6 đích + Project Settings   [T60-101]
└── column
    ├── ProgrammingContextStrip  36–40px, sticky, + DetailsPopover       [T60-102]
    └── <Outlet/>
        └── OverviewPage                                                 [T60-201..208]
            ├── SystemHealthHero
            ├── DraftActiveCompareCard ── CompareDrawer
            ├── NeedsAttentionCard
            ├── ProgramsSummaryTable
            └── QuickActions
```

File mới dự kiến:

```text
features/programming/
├── layout/ProgrammingFeatureRail.tsx        (+ .test.tsx)
├── layout/ProgrammingContextStrip.tsx       (+ .test.tsx)   ← thay ProgrammingContextBar
├── layout/ContextDetailsPopover.tsx         (+ .test.tsx)
├── overview/activeProgramSet.ts             (+ .test.ts)    ← T60-017: đọc Active Revision
├── overview/overviewViewModel.ts            (+ .test.ts)    ← hàm thuần, không React
├── overview/resolvePrimaryCta.ts            (+ .test.ts)    ← hàm thuần, bảng 5 trạng thái
├── overview/SystemHealthHero.tsx            (+ .test.tsx)
├── overview/DraftActiveCompareCard.tsx      (+ .test.tsx)
├── overview/NeedsAttentionCard.tsx          (+ .test.tsx)
├── overview/ProgramsSummaryTable.tsx        (+ .test.tsx)
├── overview/QuickActions.tsx                (+ .test.tsx)
└── shared/semanticState.ts                  (+ .test.ts)    ← 7 trạng thái ngữ nghĩa
```

---

## 6. Bảng nhiệm vụ

### 6.1 File dùng chung — chỉ CTIO sửa

`CHANGELOG.md`, Plan 60 (file này), `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md`
và **`contracts/programming/g1_contract_join_v1.json`**. Lane trả về khối văn bản
đề xuất; CTIO dán vào và commit.

File thứ tư được thêm ở Batch 0 vì nó là **điểm va chạm đã biết**: pin `openapi`
(do `T60-016` bump `1.26.0 → 1.27.0`) và pin `ipc` nằm **cùng một file**, và pin
`ipc` đang được một phiên khác sửa song song. Re-pin phải đi cùng PR với thay đổi
contract sinh ra nó (bài học `TASK-PROG-G1-CONTRACT-REPIN-001`), nên việc này bị
tập trung về CTIO thay vì để hai bên cùng ghi.

### P0-A — FW SOM (Core C++): mở đường xuất trạng thái theo Program

Toàn bộ phép đo **đã có sẵn và đã chạy** trong scheduler. Bốn task dưới đây chỉ
mở đường truyền, **không cài lại phép đo nào**.

Kênh chọn: **`point_snapshot`** (`web_ipc`, JSON), không phải `STATUS` (CBOR). Lý do:
`point_snapshot` vốn là kênh "trạng thái quan sát" và đã mang `task`, `safeState`,
giá trị Point; nó publish mỗi scan cycle nên đúng nhịp với metrics đổi mỗi chu kỳ;
JSON có tên trường nên thêm trường là **tương thích ngược**, không phải bump
`PROGRAM_IPC_PROTOCOL_MINOR` (đang là `3`) như đường CBOR positional.

| Mã | Ưu tiên | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---|
| `T60-001` | P0 | Thêm `RuntimeProgramSnapshot` vào `apps/core/domain/graph/runtime_point_snapshot.hpp` và mảng **kích thước cố định** `std::array<RuntimeProgramSnapshot, st_sched_limits::kMaxProgramsTotal>` (**=32**) — **đính chính Batch 0:** bản 1.1 ghi `kMaxProgramsPerTask` (=16), nhưng `programs[]` là danh sách **toàn hệ thống** (mọi Task), nên trần đúng là `kMaxProgramsTotal`; Rev A cũng cho `kMaxProgramsTotal = 32` (`st_profile_generated.hpp:34`). Dùng trần per-task 16 sẽ **cắt mất một nửa** cấu hình 32 Program hợp lệ — đúng thứ task này cấm + `program_count` vào `RuntimePointSnapshot`. Trường: `instance_id[65]`, `state[12]`, `enabled`, `period_ms`, `last_exec_ns`, `max_exec_ns`, `missed_release_count`, **`consecutive_missed_release`** (mới, cho D-04 §4.2), **`last_run_mono_ns`** (mới), `lane`. **Lưu ý đọc nhầm rất dễ xảy ra:** `last_exec_ns` của Core là **THỜI LƯỢNG** một lần chạy (`wall_clock_() - program_start`, `st_scheduler.cpp:829`), **không phải mốc thời gian**. Cột `Last Exec` của thiết kế là mốc thời gian ⇒ bắt buộc có `last_run_mono_ns` riêng. **Không dùng heap** — struct này nằm trên đường realtime, giữ đúng khuôn `std::array` như `rows`/`task` hiện có. | — | `DONE` | 0,5 nd |
| `T60-002` | P0 | Điền mảng ở `apps/core/application/runtime/scan_loop.cpp` (~dòng 262). **Sửa luôn khuyết tật đang có:** khối hiện tại lấy `d_.st_sched->tasks().front()` và báo cáo nó như thể là *Task duy nhất* — sai từ khi `T59-402/403` cho Program chu kỳ riêng và lane riêng. Duyệt đủ Program của mọi Task; `program_count` cắt ở **32** (`kMaxProgramsTotal`, xem đính chính ở `T60-001`) và **đánh dấu bị cắt**, không im lặng bỏ bớt. Đặt `last_run_mono_ns` tại đúng chỗ đang tính `last_exec_ns` (`st_scheduler.cpp:829`) và `consecutive_missed_release` tại chỗ đang cộng `missed_release_count` (`st_scheduler.cpp:105-118`), reset về 0 khi release đúng hạn. | `T60-001` | `DONE` | 1,5 nd |
| `T60-003` | P0 | Serialize `"programs":[…]` trong `runtime_point_snapshot.cpp` (cạnh khối `"task"`, ~dòng 213-230), giữ `noexcept` + bounded. Ngân sách: payload hiện ~5 KiB (24 row + task) trên trần `KX_POINT_SNAPSHOT_MAX_PAYLOAD` = **64 KiB**; **32** Program thêm ~8 KiB (≈250 B/Program ở trường hợp xấu nhất: `instanceId` 64 ký tự + 6 số) ⇒ ~13 KiB, còn xa trần. Tràn vẫn đi đúng nhánh fail-closed sẵn có (`serialize` trả `false` ⇒ `snapshot_ = {}`), **không cắt cụt JSON**. | `T60-001` | `DONE` | 0,5 nd |
| `T60-004` | P0 | Test Core: đủ **32** Program (chạm trần `kMaxProgramsTotal`); nhiều Task nhiều chu kỳ; Program `DISABLED`; scheduler rỗng ⇒ `programs: []` (không phải thiếu khoá); ép `set_snapshot_payload_limit_for_test` để chứng minh nhánh tràn fail-closed; round-trip serialize→parse; `consecutive_missed_release` **reset về 0** sau một chu kỳ đúng hạn (chống hồi quy công thức §4.2 điều 4). | `T60-002`, `T60-003` | `DONE` | 1 nd |

### P0-B — BE (Go web-api): nối read-back sống và tính `health`

| Mã | Ưu tiên | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---|
| `T60-011` | P0 | Decode `programs[]`: thêm field vào `webIPCResponse` (`internal/app/core_client.go:108-131`) và `RuntimePointSnapshot` (`internal/app/dto.go:272-283`). Vắng khoá ⇒ `nil`, **khác** mảng rỗng: Core cũ chưa có trường này phải ra `UNAVAILABLE`, không phải "không có Program nào". | `T60-003` | `DONE` | 0,5 nd |
| `T60-012` | P0 | `MonitorTruthSnapshot.Programs` + ánh xạ ở `internal/app/programming_pointcatalog.go:45-80` (cùng chỗ đang dựng `Task`). Giữ nguyên đường coalescing `point_snapshot` hiện có — Core chỉ phát **một** snapshot mỗi scan cycle. | `T60-011` | `DONE` | 0,5 nd |
| `T60-013` | P0 | `GET /projects/{id}/programs` ghép **intent bền vững** (store) + **read-back sống** (snapshot). Thêm `runtimeStateSource ∈ {CORE_LIVE, LAST_KNOWN, UNAVAILABLE}`, `observedAt`, `lastExecNs`, `maxExecNs`, `missedReleaseCount`, `periodMs`. **Không ghi đè bảng intent**; Core im ⇒ `UNKNOWN` + `UNAVAILABLE`, tuyệt đối không trả giá trị cũ như thể đang sống. Ánh xạ trạng thái theo D-07. | `T60-012` | `DONE` | 1,5 nd |
| `T60-014` | P0 | `health` do server tính theo D-04, kèm test biên: 0 lỡ nhịp; có lỡ nhịp; overrun liên tiếp; Core im; Program `DISABLED` (không phải `FAULT`). | `T60-013` | `DONE` | 1 nd |
| `T60-015` | P1 | Hai giá trị dẫn xuất đã có dữ liệu trong DB (nhóm B §3.1): cờ `dirty` = `drafts.content_sha256` ≠ `content_hash` của base revision; và `revisions.sequence` lộ ra `GET /revisions/{id}` + `draftSequence`/`activeSequence` ở item `GET /projects`. **Không cần migration** — cả hai cột đã tồn tại từ `0001_programming_v1.sql`. | — | `DONE` | 0,5 nd |
| `T60-016` | P0 | OpenAPI `1.26.0 → 1.27.0` + `scripts/generate-programming-client.mjs` + type FE + `contract_sync_test.go`. Không viết tay type đã sinh được. | `T60-013..015` | `DONE` | 1 nd |

### P0-C — Nối FE tới dữ liệu đã có sẵn

| Mã | Ưu tiên | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---|
| `T60-017` | P0 | **Không cần BE mới** (nhóm A §3.1): adapter FE đọc `GET /revisions/{activeRevisionId}` → `snapshot.objects[kind='PROGRAM']` lấy tên/`language`/`periodMs` khai báo của Program **đang chạy**. Thiếu Active ⇒ danh sách rỗng có lý do, **không mượn Draft**. | — | `DONE` | 0,5 nd |

### P1 — Shell dùng chung (README §3)

| Mã | Ưu tiên | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---|
| `T60-101` | P0 | `ProgrammingFeatureRail` 220 px dọc theo **focus mode** (D-01): trong `/eng/programming` rail này **thay** `NavRail` toàn cục. Bắt buộc mục `← Thoát Lập trình` ở đầu rail — không được để người dùng mắc kẹt trong workspace. 6 đích + `Project Settings`; tablet thu icon-only; `<768 px` ẩn hoàn toàn (nhường bottom nav). `NAV_GROUPS` **không đổi** nên hợp đồng route↔menu (`ADR-032`) không bị động tới — đây là chặn *render*, không phải xoá mục. Đích phụ thuộc Project vẫn vô hiệu hoá khi chưa có `projectId` (giữ hành vi `T59-503`). | — | `DONE` | 2 nd |
| `T60-102` | P0 | `ProgrammingContextStrip`: một hàng, cao 36–40 px, `position: sticky`, 5 dữ kiện bắt buộc + nút `Details`. **Bỏ mọi UUID khỏi mặt trước.** Giữ nguyên toàn bộ luật fail-closed đã có ở `ProgrammingContextBar` (không suy intent thành `RUNNING`; `UNKNOWN`/`stale`/`offline` tường minh) — đây là **đổi bố cục, không đổi ngữ nghĩa**. | — | `DONE` | 2 nd |
| `T60-103` | P1 | `ContextDetailsPopover`: revision ID thô, `contentHash`, `observedAt`, `controllerId`, mỗi dòng có nút `Copy`; mở/đóng bằng bàn phím, `Esc` đóng, trả focus. | `T60-102` | `DONE` | 1 nd |
| `T60-104` | P1 | `shared/semanticState.ts`: 7 trạng thái ngữ nghĩa của README §3, ánh xạ sang `StatusBadge` hiện hữu, bổ sung `reconciling`/`disabled`; mỗi trạng thái **bắt buộc có icon + chữ**, không chỉ màu. | — | `DONE` | 1 nd |

### P2 — PGM-01 Overview

| Mã | Ưu tiên | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---|
| `T60-201` | P0 | `overviewViewModel.ts` + `resolvePrimaryCta.ts` — **hàm thuần, có test riêng**, hiện thực đúng bảng 5 trạng thái của handoff §3 (`Draft dirty → Continue Editing`; `Check failed → Fix Check Errors`; `Draft checked & khác Active → Review Changes`; `Ready → Commission`; `Không có thay đổi → Open Runtime`). CTA chỉ suy từ trạng thái server tường minh. | `T60-016` | `ORDERED` | 1,5 nd |
| `T60-202` | P0 | `SystemHealthHero`: kết nối Core, trạng thái runtime, safe-state, mốc cập nhật authority gần nhất. Giữ nguyên phân biệt `safeStateNoControllerOnly` (cảnh báo nhẹ) ↔ safe-state do lỗi thật (nghiêm trọng) — đã có ở `OverviewPage` hiện hành, **không được làm mất khi viết lại**. | `T60-104` | `ORDERED` | 1,5 nd |
| `T60-203` | P0 | `DraftActiveCompareCard`: Draft rev + dirty/checked/failed \| Active rev + Running/Stopped/Fault \| số thay đổi **chỉ khi** server trả; nút `Compare` mở drawer. `Draft == Active` ⇒ thu gọn thành “Không có thay đổi chờ vận hành”. | `T60-201`, `T60-015` | `ORDERED` | 2 nd |
| `T60-204` | P0 | `NeedsAttentionCard`: sắp `fault → warning → info`; mỗi mục `severity + thông điệp người-đọc-được + thực thể + deep-link ĐÚNG trang chủ quản` (Programs/Mapping/Commission/Runtime), thay cho đích cứng `/runtime` hiện tại. Có “Xem tất cả (n)”. | `T60-201` | `ORDERED` | 1,5 nd |
| `T60-205` | P0 | `ProgramsSummaryTable` 6 cột theo D-02; hàng bấm được → PGM-02 kèm POU đã chọn; **không cột CPU/core**; thiếu số liệu ⇒ `—` kèm lý do (`Chưa đọc được từ Core`), tuyệt đối không `0`; `runtimeStateSource=LAST_KNOWN` phải có nhãn “giá trị cũ”. | `T60-016`, `T60-017`, `T60-104` | `ORDERED` | 2 nd |
| `T60-206` | P1 | `QuickActions` full-width, độ ưu tiên thị giác thấp (không nút nào là primary — primary chỉ có một, nằm ở `T60-201`); RBAC: viewer/operator thấy nhưng bị vô hiệu hoá kèm giải thích. | `T60-201` | `ORDERED` | 1 nd |
| `T60-207` | P0 | Ma trận trạng thái đủ 6 nhánh của handoff §6: skeleton **khớp hình học** card/bảng; chưa có Project/Program; Core offline (banner dính, vẫn cho sửa, **khoá Commission**); runtime không đọc được ⇒ `Unknown` (không `0`, không `Stopped`); `Draft==Active`; permission denied giữ nguyên phần đọc. | `T60-202..206` | `ORDERED` | 2 nd |
| `T60-208` | P1 | Responsive `<768 px`: card xếp chồng; bảng → thẻ gọn; **bottom nav rút còn 4 đích** Overview/Runtime/Check/More; không nội dung tràn ngang; không chuỗi UUID nằm ngang. | `T60-205` | `ORDERED` | 1,5 nd |

### P3 — Kiểm chứng

| Mã | Ưu tiên | Nội dung | Phụ thuộc | Trạng thái | Ước lượng |
|---|---|---|---|---|---|
| `T60-301` | P0 | Test component/hàm thuần: CTA resolver phủ **cả 5 hàng** bảng §3 + biên; view model; bảng Programs thiếu dữ liệu; popover Details; rail; context strip. | P1+P2 | `ORDERED` | 2 nd |
| `T60-302` | P0 | E2E mock bổ sung vào `e2e/programming.spec.ts`: Draft≠Active, Core offline, deep-link từ mục cần chú ý, đúng-một-primary-CTA, không lộ UUID. | `T60-301` | `ORDERED` | 1,5 nd |
| `T60-303` | P1 | E2E real-backend (`e2e/programming-real.spec.ts`): Overview đọc đúng bảng Programs từ Core thật sau Commission + Enable. | `T60-302`, `T60-013` | `ORDERED` | 1,5 nd |
| `T60-304` | P0 | Bàn phím đi hết mọi hành động kỹ thuật; tương phản sáng/tối; đo tại **1280×750** (nội dung chính không bị đẩy dưới màn hình đầu) và **390 px**; ma trận RBAC viewer/operator/admin. | `T60-301` | `ORDERED` | 1,5 nd |

**Tổng: 27 task · ~34,5 người-ngày** (P0-A 3,5 nd · P0-B 5 nd · P0-C 0,5 nd · P1 6 nd · P2 13 nd · P3 6,5 nd).

---

## 7. Thứ tự thi hành

```text
FW SOM   T60-001 → T60-002 → T60-003 → T60-004
                              │
BE       T60-011 → T60-012 → T60-013 ─┬→ T60-014 ─┐
                                      └→ T60-015 ─┴→ T60-016 ─┐
FE nối   T60-017 ───────────────────────────────────────────  │
                                                              ↓
Shell    T60-102 → T60-103                          T60-201 ─┬→ T60-203
         T60-104 ─────────────────────→ T60-202              ├→ T60-204
         T60-101 (sau D-01)                                  ├→ T60-205 → T60-208
                                                             └→ T60-206
                                        → T60-207 → T60-301 ─┬→ T60-302 → T60-303
                                                             └→ T60-304
```

**Đường găng là `T60-001 → …→ T60-016 → T60-205`** (SOM mở đường → BE ghép →
bảng Programs). `T60-102`/`T60-104`/`T60-017` **không phụ thuộc P0-A** nên khởi
động song song ngay khi plan được duyệt; `T60-101` chỉ chờ D-01.

Ba mốc bàn giao giữa hai lane: `T60-003` (JSON `programs[]` có thật) mở khoá
`T60-011`; `T60-013` (endpoint trả read-back sống) mở khoá `T60-205`; `T60-016`
(type đã sinh) mở khoá `T60-201`.

---

## 8. Ma trận truy nguyên tiêu chí nghiệm thu

| AC | Nội dung | Task chủ quản | Bằng chứng |
|---|---|---|---|
| `AC-PGM01-01` | Không lộ UUID ở mặt trước | `T60-102`, `T60-103`, `T60-205` | **ĐÓNG CẢ HAI CHIỀU (2026-08-24, `c9539ef`):** `ProgrammingContextStrip.test.tsx` khẳng định DOM mặc định **không** khớp regex UUID ở bốn nhánh trạng thái → mở `Details` → panel chứa đủ ba UUID + `controllerId` → `Esc` → UUID **biến mất khỏi DOM** (không nằm ẩn). Kèm `ContextDetailsPopover.test.tsx`. Còn chờ `T60-205` cho bảng Programs |
| `AC-PGM01-02` | Draft và Active cùng hiện khi khác nhau | `T60-203` | Component test 2 nhánh (khác / bằng nhau) |
| `AC-PGM01-03` | Mục cần chú ý deep-link tới đúng trang chủ quản | `T60-204` | Test điều hướng theo từng mã (không dùng đích cứng) + E2E |
| `AC-PGM01-04` | Không render thiếu-dữ-liệu thành số `0` | `T60-205`, `T60-207` | Test bảng với `undefined`/`UNAVAILABLE` ⇒ `—` |
| `AC-PGM01-05` | Đúng một CTA chính | `T60-201`, `T60-206` | Test đếm phần tử primary = 1 trên **cả 5** trạng thái + E2E |
| `AC-PGM01-06` | viewer/operator không mutate được qua UI lẫn phím tắt | `T60-206`, `T60-304` | Ma trận RBAC 3 vai × các hành động |

---

## 9. Kiểm chứng bắt buộc trước khi đóng task

Chạy đúng lệnh dưới đây và **ghi số đo thật**, không dẫn lại số cũ.

| Phạm vi | Lệnh |
|---|---|
| C++ (P0-A `T60-001..004`) | `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` → `cmake --build build/fw --parallel` → `ctest --test-dir build/fw --output-on-failure` (đọc exit code của **cả** configure lẫn build) |
| Go (P0-B `T60-011..016`) | `go vet ./...` và `go test ./... -count=1` |
| FE | `npx vitest --run --environment jsdom src`, `npm run lint`, `npm run build` |
| E2E | `npx playwright test e2e/programming.spec.ts` (và `e2e/programming-real.spec.ts` cho `T60-303`) |
| Cổng dự án | `scripts/verify-project.sh --component layout` |
| Tài liệu | `python3 scripts/docs_iso_harness.py --expect` |

**Bẫy đã dính trước đây, phải tránh:**

- `npm test` chỉ quét `src/`, **không** chạy `e2e/`.
- Build phát hành phải dùng `npm run build:release` (cờ Programming là build-time).
- Task chạy nền: “exit code 0” có thể là của `tail`, không phải của gate — đọc exit code thật.

---

## 10. Rủi ro

| Mã | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| `R60-01` | Làm FE trước, BE sau ⇒ bảng Programs rỗng 4/6 cột hoặc phải bịa | Cao | P0 chặn P2; `T60-205` fail-closed bằng `—` ngay từ đầu |
| `R60-02` | Viết lại `OverviewPage` làm mất các luật đã sửa qua bug thật (`BUG-016`, `BUG-018`, `safeStateNoControllerOnly`, `WP-01` 4 nhánh Check) | Cao | Giữ nguyên **toàn bộ** test hiện có của `OverviewPage.test.tsx`; chỉ đổi selector khi bố cục đổi, **không xoá case** |
| `R60-03` | Focus mode làm người dùng mất lối ra khỏi Programming | Trung bình | D-01 bắt buộc mục `← Thoát Lập trình`; `NAV_GROUPS` không đổi nên `ADR-032` và hợp đồng route↔menu không bị động; E2E `T60-302` phải có case thoát workspace |
| `R60-04` | Sao chép số trong ảnh (10 ms/100 ms) trái profile Rev A | Trung bình | D-03; test khẳng định chu kỳ render từ dữ liệu, không hằng số |
| `R60-05` | Context strip 36–40 px không đủ chỗ cho 5 dữ kiện ở 1280 px | Trung bình | Ưu tiên rút gọn theo thứ tự: Core → Active → Draft; phần bị cắt vào `Details` |
| `R60-06` | Trùng lấn với Plan 59 W6/W7 đang mở | Thấp | Plan 60 không chạm packaging/provenance/release gate; `RELEASE_READY` vẫn do Plan 59 quyết |

---

## 11. Definition of Done (theo README §6)

PGM-01 chỉ `DONE` khi **đủ tất cả**:

- [ ] Test đơn vị FE xanh, có số đo ghi lại.
- [ ] E2E mức route xanh.
- [ ] Bàn phím đi hết mọi hành động kỹ thuật.
- [ ] Kiểm tại 1280×750 và 390 px.
- [ ] Tương phản sáng/tối đạt.
- [ ] Đủ trạng thái error / empty / offline / permission.
- [ ] Ma trận quyền đã test cho cả ba vai.
- [ ] Không hồi quy ngữ nghĩa Draft/Active.
- [ ] `AC-PGM01-01..06` có bằng chứng theo §8.
- [ ] `CHANGELOG.md` đã cập nhật trong cùng phiên.

---

## 12. Ngoài phạm vi Plan này

PGM-02 (Programs), PGM-03 (Mapping), PGM-04 (Library), PGM-05 (Commission),
PGM-06 (Runtime) theo handoff v2.1 **không** thuộc Plan 60. Chúng thừa hưởng
`T60-101..104` và sẽ cần plan riêng — riêng PGM-02 có khối lượng lớn nhất
(canvas FBD node-edge thật, Inspector, bottom panel 4 tab, Cross Reference),
không nên gộp vào đây.

Packaging, provenance, target/HIL và quyết định `RELEASE_READY` vẫn thuộc
Plan 59 W6/W7.

---

## 13. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.3 | 2026-08-23 | **Batch 1 (CTIO + 3 lane)** — 13/27 task `DONE`: `T60-001..004` (Core), `T60-011..015` (BE Go), `T60-017`, `T60-101/102/104` (FE shell). **Mốc M1 và M2 đều ĐẠT** bằng chứng cứ: dump `point_snapshot` thật 2 Program khác chu kỳ; hai response thật của `GET .../programs` ở `CORE_LIVE` và `UNAVAILABLE`. **Một đính chính quy phạm ở §4.2** (xem ngay dưới bảng công thức): điều 6 `ROLLED_BACK ⇒ DEGRADED` phải xét **trước** điều 3, vì `ROLLED_BACK` ánh xạ thành `WAITING` (§4.1) nên với thứ tự cũ điều 6 là **chữ chết** — mâu thuẫn với chính §4.1 và phần lời D-07. Thứ tự đúng: 1 → 2 → 6 → 3 → 4 → 5 → 7. Bổ sung điều kiện tiên quyết chưa ghi cho điều 5: bỏ qua khi `periodMs = 0`. **Hai lỗi ngoài dự kiến đã sửa cùng phiên:** `STARTING`/`STOPPING` rò ra hợp đồng qua đường `LAST_KNOWN` (CHECK constraint của store vẫn cho phép, một dòng DB cũ làm UI kẹt vĩnh viễn ở chuyển tiếp không tồn tại); và Context Strip đặt `sticky top-0` trùng tầng TopBar nên trượt xuống dưới và mất tác dụng khi cuộn. **Đổi hợp đồng:** `desiredEnabled` thành nullable — Program chạy trong Core mà Project chưa từng ghi intent ra `null`, không phải `false`. Số đo hợp nhất (HOST, CTIO tự chạy lại): ctest **1243/1243**; go vet/test exit 0, 18 package `ok`; vitest **126 file / 1228 test**, 1227 pass; lint/build/`verify-project.sh --component layout` exit 0. |
| 1.2 | 2026-08-23 | **Batch 0 (CTIO)** — dựng nhánh `feat/plan60-pgm01` từ `main` và **đo lại baseline thật** tại `aa08ac5` (§1): 1227/1227 ctest, 124 file/1161 test FE, 10/10 E2E mock, cổng layout + docs PASS. Re-pin `Baseline source` `a35f578` → `aa08ac5`. **Một đính chính kỹ thuật trong bảng §6:** `T60-001..004` ghi trần mảng `programs[]` là `st_sched_limits::kMaxProgramsPerTask` (=16) — sai, vì `programs[]` là danh sách **toàn hệ thống** chứ không phải một Task; trần đúng là `kMaxProgramsTotal` (**=32**, và Rev A cũng 32). Giữ nguyên 16 sẽ cắt mất một nửa cấu hình 32 Program hợp lệ, đúng thứ `T60-002` cấm. Ngân sách payload cập nhật theo: ~13 KiB / trần 64 KiB. Xác nhận mọi số dòng §1/§2/§3 trích dẫn còn đúng tại `aa08ac5`. Bổ sung `contracts/programming/g1_contract_join_v1.json` vào nhóm file **chỉ CTIO sửa** (§6.1). |
| 1.1 | 2026-08-23 | **Chốt 7/7 quyết định** sau khi đọc lại Core/BE. Hai phát hiện làm đổi quyết định so với bản nháp: (1) `start()`/`stop()`/`disable()` của Core là **đồng bộ tức thì** và BE đã ghi rõ `STARTING`/`STOPPING` là chuyển tiếp không tồn tại (`runtime_intent.go:199-201`) ⇒ loại ánh xạ `ACTIVE → STARTING` của bản nháp; (2) `last_exec_ns` là **thời lượng**, không phải mốc thời gian ⇒ cột `Last Exec` cần thêm `last_run_mono_ns`. D-01 chốt **focus mode** vì ngân sách ngang: hai rail chỉ còn 828 px ở 1280 px, không đủ cho PGM-02. Thêm `consecutive_missed_release` (phép đo mới duy nhất) cho công thức `health` §4.2. Trạng thái plan: PLAN_READY; 27 task ≈ 34,5 người-ngày. |
| 1.0 | 2026-08-23 | Lập plan từ gói FE Handoff v2.1 (README + PGM-01 + mockup `PGM-01_overview.png`), đối chiếu As-Built tại `a35f578`; ghi nhận 6 lỗ hổng dữ liệu backend chặn bảng Programs; 22 task / 3 pha / ~31 người-ngày; 6 quyết định chờ chốt. |
