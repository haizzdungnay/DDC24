# Phán quyết gap analysis của auditor — PGM-02 Programming Workspace

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PGM02-AUD-ADJ-001` |
| Phiên bản | 1.1 |
| Trạng thái | **Adjudicated v1.1 — 4 finding hợp lệ chuyển thành task; phần bác bỏ status bar ĐÃ ĐẢO NGƯỢC ngày 2026-08-27 sau khi chủ sở hữu cấp ba ảnh render (xem §8)** |
| Ngày | 2026-08-27 |
| Chủ quản | System Architect + Dev Lead (FE) |
| Đầu vào được phán quyết | `gap_analysis_programming_page.md` (`GAP-UI-PROGRAMMING-001`, Draft 2026-08-27) |
| Hợp đồng đối chiếu | [`KX-DDC24-FE-HANDOFF-PGM02-002` v2.2](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md) + [`PGM-02A`](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md) + [`PGM-02B`](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md) |
| Thiết kế đối chiếu | [`DDD-SW-PGM02-WORKSPACE-001`](../../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md) |
| Plan đối chiếu | [`PLAN-PROG-059`](../../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) + [`PLAN-PGM02-ST-FBD-REDESIGN-PROPOSAL-001`](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM02_ST_FBD_IMPLEMENTATION_PLAN.md) |
| Mốc mã nguồn đối chiếu | `ed6fb21` (`main`, 2026-08-27) |
| Evidence class | Source inspection trực tiếp; **không** phải Test Result, target/HIL hoặc release evidence |

---

## 0. Kết luận một đoạn

Tài liệu của auditor **không dùng được nguyên trạng để lập kế hoạch**: nó đối
chiếu một cây mã nguồn khác (`src/frontend/src/pages/ProgrammingPage.tsx` trong
bản tải `ddc24-main` trên Windows), tức trang **legacy graph demo** đã bị khoá
sau cờ, chứ không phải workspace PGM-02 đang là hợp đồng thi hành. Vì vậy các
con số cốt lõi của tài liệu — 62 finding Critical, "~90% chức năng chưa được
implement", "46–71 tuần / 10–16 tháng" — đều sai tiền đề và bị **bác**.

Nhưng auditor **chạm đúng bốn chỗ có thật**, và đó là những chỗ plan hiện hành
thực sự thiếu chủ sở hữu. Bốn finding đó được ghi nhận, có mã, và được đưa vào
Plan 59 làm task thực thi trong cùng phiên này. Chúng không phải "thiếu 90%
chức năng"; chúng là **scope mồ côi** — hợp đồng đã duyệt có, thiết kế/plan
không chuyển tiếp, nên không task nào nhận.

Mức độ nghiêm trọng cao nhất không nằm ở giao diện mà ở quản trị: `WP-09` được
đánh `DONE (R2)` trong khi một phần scope có tên trong chính thân WP đó chưa hề
được giao (`F-PGM02-AUD-002`).

---

## 1. Vì sao tài liệu của auditor sai baseline

### 1.1 Bằng chứng đường dẫn

Tài liệu trỏ tới `C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/`
cho cả năm file tham chiếu (`ProgrammingPage.tsx`, `App.tsx`, `AppShell.tsx`,
`NavRail.tsx`, `TopBar.tsx`). Layout `src/frontend/` **không tồn tại** trong repo
MK-DDC-24: FE sống ở `apps/web-ui/src/` từ `PLAN-ARCH-RESTRUCT-002`.

### 1.2 Trang bị audit là trang đã bị khai tử có chủ đích

Trang duy nhất tên `ProgrammingPage.tsx` trong repo là
`apps/web-ui/src/features/dashboard/ProgrammingPage.tsx` — đúng mô tả của
auditor (textarea `graph.json` + validator + Component Library dạng danh sách
phẳng). Chính file đó **tự khai** ngay dòng đầu vùng render:

> "Legacy graph demo — chỉ mô phỏng cục bộ, không validate hoặc deploy tới thiết bị."

và chỉ được gắn route khi cờ `LEGACY_GRAPH_DEMO_ENABLED` bật
(`apps/web-ui/src/app/App.tsx:213`). Workspace thật nằm sau hai cờ khác:
`VITE_PROGRAMMING_REV_A` → `ProgrammingRoutes`, rồi
`VITE_PROGRAMS_WORKSPACE_V2` → `ProgramsWorkspaceRoute`
(`apps/web-ui/src/shared/config.ts:9,14,25`).

Nghĩa là auditor đã dựng bản build **không bật cờ**, thấy trang demo, và kết
luận về sản phẩm. Đây là lỗi phương pháp, không phải phát hiện về sản phẩm.

### 1.3 Đối chiếu thật của các hạng mục auditor gọi là "Hoàn toàn không có"

| Vùng auditor đánh 🔴 "hoàn toàn không có" | Hiện trạng thật tại `ed6fb21` |
|---|---|
| ③ POU Tree Panel | `design/pou/PouExplorer.tsx` + test — một cây POU duy nhất, group Programs/Functions/Function Blocks, search/filter (`AC-PGM02-001` là bất biến kiến trúc của `T59-803`) |
| ⑥ ST editor có số dòng, tô cú pháp | `design/editor/ProgramsTab.tsx:1050-1060` gutter số dòng + tô dòng hiện tại; `design/editor/stEditorSupport.ts` tokenizer/bracket match/auto-indent/completion |
| ⑥ Auto-completion, đi tới khai báo, tìm tham chiếu | `stEditorSupport.ts`, `stReferenceIndex.ts`, `StCrossReferencePanel.tsx` (F12/Ctrl+Click) |
| ⑥ Chỉ báo lỗi/cảnh báo ở gutter | Diagnostic underline + click-to-jump, giao ở `T59-805` |
| ⑦ Quick Library có search + phân nhóm | `design/library/QuickLibraryPanel.tsx` — catalog dùng chung với PGM-04, Recent/Favorites, parity BE↔registry (`T59-804`) |
| ⑨ Problems / Search / Cross Reference / Runtime Watch | `design/workbench/ProgrammingWorkbench.tsx:135-141` — 5 tab (Vấn đề/Tìm kiếm/Tham chiếu/Watch/Trace), panel resize được có `role="separator"` đủ `aria-valuenow` |
| ⑨ Live variable values | `design/editor/StRuntimeValueOverlay.tsx` + `LiveProgramView.tsx`/`LiveFbdView.tsx`, giao ở `T59-811` |
| "Không có code editor engine" | Đúng là không dùng Monaco/CodeMirror — nhưng đó là **quyết định đã ký** `UD-PROG-013`, đo bằng số thật (bộ CodeMirror tối thiểu 110,07 KiB gzip so với ngân sách chunk 125 KiB), không phải thiếu sót |
| "Data model hoàn toàn khác / routing không khớp" | Route canonical hiện hành **là** `/eng/programming/programs?project=…&pou=…&mode=…` (`shared/programsRoute.ts`), đúng thứ auditor bảo là chưa có |

### 1.4 Mockup mà auditor dùng không phải hợp đồng đã duyệt

Auditor đối chiếu với một "IEC 61131-3 IDE mockup" tổng quát. Hợp đồng đã được
Product Owner/CTO + System Architect duyệt và pin exact commit
`413a043` bằng `AUTH-PROG-2026-08-24-05` là **handoff v2.2** (`PGM-02`,
`PGM-02A`, `PGM-02B`) cộng `DDD-SW-PGM02-WORKSPACE-001`. Mọi hạng mục có trong
mockup nhưng không có trong hợp đồng đó (rõ nhất: status bar `Ln/Col/INS/LF/UTF-8`)
**không phải gap**; muốn đưa vào phải mở change request.

### 1.5 Hệ quả với các con số của tài liệu

- "62 Critical / 77%" — bác. Đếm trên trang sai.
- "~90% chức năng chưa được implement" — bác. R1 EDIT và R2 LIVE đã đóng ở lớp
  HOST, R2 có thêm lane target-browser trên Foxlinx (`EV-PGM02-R2-CLOSEOUT-001`).
- "46–71 tuần (~10–16 tháng)" và ba phương án A/B/C — bác. Cả ba đều đề xuất làm
  lại thứ đã có (Option A: "thay textarea bằng Monaco + thêm IDE layout shell +
  thêm POU tree" — cả ba đã tồn tại hoặc đã bị bác bằng `UD-PROG-013`).

---

## 2. Bốn finding hợp lệ — scope mồ côi trong plan hiện hành

Cách đọc: mỗi finding nêu **hợp đồng nói gì** → **thiết kế/plan nói gì** →
**code có gì** → **task nhận việc**.

### `F-PGM02-AUD-001` — Inspector context-sensitive không có chủ sở hữu (Major)

**Hợp đồng.** Handoff cha §1 xếp Inspector vào shell dùng chung: "They share the
same Program shell, POU Explorer, revision context, operating modes, diagnostics,
Quick Library, **Inspector** and bottom workbench". §9 quy định năm ngữ cảnh:

| Ngữ cảnh | Trường bắt buộc |
|---|---|
| Program | `Name · Language · Cycle · Enable · Description · Advanced Execution` |
| Variable | `Name · Type · Scope · Mapping · Live/Sim value · References` |
| ST symbol/call | `Definition · Type · Signature · Documentation · References` |
| FBD block | `Instance · Type · Parameters · Retained · I/O · Live/Sim values` |
| Connection | `Source · Destination · Type · Quality/value` |

§9 còn cấm thẳng: *"Inspector SHALL NOT permanently consume 300 px for two
fields; collapse when no useful context."*

**Thiết kế.** `grep -i inspector` trên `PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md`
trả về **0 kết quả**. Cây component Target §7.2 có `RightDock` gồm
`QuickLibraryPanel`/`ReferencesPanel`/`WatchPanel`/`SimulationControls` — không
có Inspector. Bảng ánh xạ vùng UI §7.3 cũng không có dòng Inspector.

**Plan.** Không `PGM02-V22-WP-*` nào nêu Inspector ⇒ không task nào nhận.

**Code.** `design/editor/ProgramsTab.tsx:421` có `<aside aria-label="Thuộc tính">`
render `ProgramInspector` với **đúng hai trường**: `Tên` và `Loại`
(`ProgramsTab.tsx:1516-1558`). Tức hiện trạng rơi trúng cái mà §9 cấm. Bốn ngữ
cảnh còn lại (Variable / ST symbol / FBD block / Connection) chưa có. Trường
`Language`/`Cycle`/`Enable` có tồn tại nhưng ở nơi khác (`design/task/ExecutionTab.tsx`),
chưa được gom về Inspector theo hợp đồng.

**Nhận việc.** `T59-818` (R3 song song, không chặn `T59-814`).

---

### `F-PGM02-AUD-002` — `WP-09` mang cờ `DONE (R2)` trong khi scope Compare chưa giao (Critical — quản trị)

Đây là finding nặng nhất và là thứ auditor nói đúng bản chất dù sai chi tiết.

**Plan nói gì.** Thân `WP-09` trong `PGM02_ST_FBD_IMPLEMENTATION_PLAN.md` sở hữu
tường minh:

- Objective: *"…đồng thời sở hữu Compare Draft↔Active có typed source/topology diff"*;
- Scope: *"Compare authority: dirty Draft phải Save; seal current saved Draft…
  rồi compare immutable Draft Revision với immutable Active"*;
- BE work: *"extend schema với deterministic `stHunks[]` và `fbdChanges[]`,
  bounded payload/truncation/cursor"*;
- FE work: *"Compare drawer luôn hiện Draft Revision/Active Revision IDs; click
  hunk/node jump vào đúng read-only side"*;
- Acceptance: *"Compare sau Save/seal nêu đúng IDs và deterministic diff…"*;
- Tests: *"Compare golden tests: ST add/delete/replace hunks; FBD node/port/wire…"*.

**Trạng thái được ghi.** Bảng §0 ghi `WP-09 | T59-810 | DONE (R2) 2026-08-26`,
bằng chứng "Dấu producer (generation/freshness) + Trace pin neo tuple Active".
Plan 59 §3 dòng 2761 ghi `PGM02-V22-WP-09 → T59-810 DONE R2 (HOST/LOCAL)`, không
ghi phần dư.

**Vấn đề.** Scope của `T59-810` trong Plan 59 là *"Producer→Core IPC→BE contract
cho Active document/value tuple, generation/sequence/freshness và Trace pin"* —
**không có Compare**. Nên `T59-810 DONE` không đủ để kết luận `WP-09 DONE`.

**Đo trên code.** `grep -rn "stHunks\|fbdChanges" contracts/ apps/web-api/ apps/web-ui/src`
trả về **0 kết quả**. Không có Compare drawer trong workspace
(`DraftActiveCompareCard.tsx` chỉ là thẻ tóm tắt ở PGM-01 Overview, không phải
typed diff có anchor). `GetRevisionChanges` (`application/changes.go:50`) chưa
được mở rộng. Golden tests Compare chưa tồn tại.

**Hệ quả.** Một increment được tuyên đóng trên một WP còn nợ scope. Đây đúng loại
lỗi mà `Plan 59 §0.1` đặt trạng thái `PARTIAL` để chặn.

**Nhận việc.** `WP-09` hạ về `DONE (R2, một phần)`; phần Compare tách thành
`T59-819`. Handoff `PGM-02A §3/§6` liệt `Compare` là nút toolbar và luồng
`Draft↔Active`/`Draft↔LKG`, nên finding này cũng đóng một nửa của
`F-PGM02-AUD-004`.

---

### `F-PGM02-AUD-003` — phần dư của `WP-04` hứa "mở lại từ R2" nhưng R2 đã đóng mà không giao (Major)

**Hợp đồng.** `PGM-02A §4` liệt `hover symbol/type/signature` trong danh sách
**Required** của ST editor, cạnh `type-aware completion when compiler metadata
supports it`.

**Quyết định đã ký.** `UD-PROG-013` (2026-08-26) giữ bề mặt editor hiện tại cho
R1 và ghi rõ hai mục ra ngoài phạm vi R1: **hover chuột** và **chỉ mục ký hiệu
do compiler sinh** (bullet BE của `WP-04`), kèm câu "mở lại từ R2"
(`PGM02_ST_FBD_IMPLEMENTATION_PLAN.md` §0 dòng `WP-04`; Plan 59 dòng 2863;
`GATE-PROG-ST-EDITOR-DEP-001` §146).

**Điều đã xảy ra.** R2 gồm `T59-810..813`, tất cả `DONE`, increment R2 tuyên
ĐÓNG 2026-08-27. Không scope task nào trong bốn task đó chứa hover hoặc chỉ mục
ký hiệu do compiler sinh. Không task R3 nào (`T59-814..817`) nhận. Lời hứa "mở
lại từ R2" vì vậy hết hạn mà không có ai thực hiện, và không có bản ghi hoãn
tiếp.

**Nhận việc.** `T59-820`, kèm yêu cầu ghi lại quyết định: hoặc giao ở R3, hoặc
Owner ký hoãn tường minh có thời hạn — không để trạng thái trôi.

---

### `F-PGM02-AUD-004` — thanh công cụ editor và tab đa POU không được chuyển tiếp vào thiết kế (Major)

**Hợp đồng.** `PGM-02A §2` và `PGM-02B §2` vẽ vùng editor là
`tabs + editor toolbar`. `PGM-02A §3` liệt nút theo mode:

- EDIT: `Save | Undo | Redo | Find | Format | Check | Compare | SIMULATE | LIVE | More`
- SIMULATE: `Pause/Run | Step | Reset | Speed | Stop Simulation | Watch | Trace`
- LIVE: `LIVE Active r15 | Pause Refresh | Watch | Trace | Return to Draft`

`PGM-02A §11` còn đặt tên component `STEditorToolbar`.

**Thiết kế.** `grep -i "toolbar\|tab"` trên DDD PGM-02 trả về **0 kết quả** cho
cả hai khái niệm. Cây component §7.2 đi thẳng từ `StWorkspace` xuống
`SourceEditor`/`DiagnosticGutter`.

**Code.** Thanh công cụ ST **có tồn tại** (`ProgramsTab.tsx:904-985`, ghi chú
`FE-ST-009`) với `Tìm · Hoàn tác · Làm lại · Chèn Point/Variable · Thư viện ·
Định dạng · Lưu`. So với §3 còn thiếu trên thanh: **Check**, **Compare**, **More**.
`SIMULATE`/`LIVE` đã có nhưng ở `ProgramsModeSwitcher` — đây là chuyển chỗ hợp
lý và nên được **ghi nhận là quyết định**, không để lệch âm thầm. Thanh công cụ
riêng cho mode SIMULATE và LIVE chưa có. Tab đa POU chưa có ở bất kỳ đâu.

**Phân loại.** Phần "thiếu nút Check/Compare/More + toolbar SIMULATE/LIVE" là
**gap thi hành** ⇒ `T59-821`. Phần "tab đa POU" là **quyết định sản phẩm chưa
được đặt ra** (một POU mỗi lần so với nhiều tab) ⇒ mở `UD-PROG-014` cho Owner,
vì nó đổi cả state model FE lẫn dirty-guard giữa các POU.

---

## 3. Finding phụ về truy nguyên — `F-PGM02-AUD-005` (Minor, nhưng làm audit không kiểm chứng được)

Đo trên toàn repo (`docs/` + `apps/web-ui/src` + `apps/web-ui/e2e`):

| Nhóm AC | Tham chiếu ngoài chính file handoff |
|---|---|
| `AC-PGM02-001` … `AC-PGM02-007`, `AC-PGM02-009`, `AC-PGM02-010` | **0** |
| `AC-PGM02-008` | 1 |
| `AC-ST-008`, `AC-ST-009`, `AC-ST-011` | **0** |
| `AC-ST-001..005`, `AC-ST-010`, `AC-FBD-001..007/012` | 4–12 |

Phải nói cho đúng: **đây không phải "chưa có test"**. Kiểm chứng trực tiếp cho
thấy phần lớn đã có test thật, chỉ là không mang định danh AC:

- `AC-ST-011` (viewer/operator không sửa được bằng bàn phím/dán) — có test tại
  `SourceEditor.test.tsx:413-425` (`fireEvent.paste`), nhưng chú thích ghi
  `T59-805 AC` chứ không ghi `AC-ST-011`.
- `AC-ST-009` (dữ liệu live cũ phải phân biệt được bằng thị giác) — có test tại
  `StRuntimeValueOverlay.test.tsx:46`, nhãn chữ `STALE · STALE · Dữ liệu đã cũ`.
- `AC-PGM02-002` (editor/canvas không phải cuộn trang ở 1280×750) — phép đo
  1280×750 **có** nhưng chỉ chạy cho PGM-01 Overview
  (`e2e/programming.spec.ts:920`, `T60-304`), **chưa** chạy cho workspace PGM-02.

Vấn đề vì vậy là: người kiểm chứng độc lập không thể đi từ AC của hợp đồng tới
bằng chứng mà không phải suy luận bằng văn xuôi. Đúng một trong hai mục đó
(`AC-PGM02-002`) hoá ra là gap thật khi soi kỹ — chứng minh chi phí của việc mất
truy nguyên.

**Nhận việc.** `T59-822`: bảng truy nguyên `AC → task → file test` cho đủ 33 AC
của handoff v2.2, và bổ sung phép đo 1280×750 cho chính workspace PGM-02.

---

## 4. Bác bỏ tường minh — `F-PGM02-AUD-006` (No action)

| Hạng mục auditor nêu | Phán quyết | Lý do |
|---|---|---|
| ⑫ Status bar `Ln/Col/INS/LF/UTF-8`, "No changes" | ~~Bác~~ → **CHẤP NHẬN** (đảo ngược cùng ngày, §8) | Lý do bác ban đầu: không có trong handoff v2.2 hay DDD. Ba ảnh render chủ sở hữu cấp lúc 15:54 cùng ngày đều có status bar ⇒ vào phạm vi, do `PGM02-V22-WP-15`/`T59-821` sở hữu. |
| ① Logo "DDC-24 Programming", Project selector dropdown, badge `r17 Draft`/`r15 Active` | **Bác một phần** | Thông tin này đã có ở `ProgrammingContextStrip` + `ContextDetailsPopover` theo đúng DDD §7.3; hình thức khác mockup không phải gap. |
| ② Sidebar riêng cho Programming | **Bác** | `ProgrammingFeatureRail` + `ProgrammingMobileNav` đã có; sáu mục `PGM-01..06` là `UD-PROG-008` đã CLOSED. |
| ⑦ Function block dạng thẻ đồ hoạ có sơ đồ chân, kéo-thả từ thư viện | **Bác** | Handoff §5.1 quy định thẻ mang **signature chữ** (`PID — FB — SP REAL, PV REAL → OUT REAL`), có chủ đích. Kéo-thả không có trong hợp đồng. |
| Đề xuất tích hợp Monaco/CodeMirror | **Bác** | `UD-PROG-013` đã đóng bằng số đo bundle. |
| Đề xuất "tích hợp OpenPLC/CODESYS-like runtime" | **Bác** | Compiler + runtime ST/FBD đã có và đang chạy trên target; không có cơ sở thay thế. |

---

## 5. Bảng chuyển finding → task

| Finding | Mức | Task nhận | Increment | Chặn increment nào? |
|---|---|---|---|---|
| `F-PGM02-AUD-001` Inspector 5 ngữ cảnh | Major | `T59-818` | R3 (song song) | Không chặn `T59-814` |
| `F-PGM02-AUD-002` Compare Draft↔Active | Critical (quản trị) | `T59-819` | R3 | Chặn tuyên `WP-09` đóng |
| `F-PGM02-AUD-003` hover + chỉ mục ký hiệu compiler sinh | Major | `T59-820` | R3 | Không |
| `F-PGM02-AUD-004a` toolbar Check/Compare/More + toolbar SIMULATE/LIVE | Major | `T59-821` | R3 | Không |
| `F-PGM02-AUD-004b` tab đa POU | Decision | `UD-PROG-014` | — | Chặn `T59-821` phần tab |
| `F-PGM02-AUD-005` truy nguyên AC + đo 1280×750 cho PGM-02 | Minor | `T59-822` | R3 | Chặn closeout R3 |
| `F-PGM02-AUD-006` status bar và các mục mockup-only | No action | — | — | — |

Không finding nào trong bốn finding hợp lệ mở lại R1 hay R2: R1/R2 đóng đúng
phạm vi đã tuyên của chúng. Riêng `WP-09` bị hạ trạng thái vì nó bắc qua R2/R3.

---

## 6. Việc đã làm trong cùng phiên này

1. `PGM02_ST_FBD_IMPLEMENTATION_PLAN.md` — `WP-09` hạ `DONE (R2)` →
   `DONE (R2, một phần)`; thêm `WP-14` Inspector, `WP-15` toolbar/tabs; ghi phần
   dư `WP-04`.
2. `59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md` — thêm `T59-818..822` vào
   bảng nhiệm vụ master; cập nhật dòng trạng thái và bảng disposition WP.
3. `PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md` — §7.2 thêm
   `ContextInspector` và `EditorToolbar` vào cây component; §7.3 thêm hai dòng
   ánh xạ vùng UI; §1.4 ghi status bar ngoài phạm vi; revision 0.4. **Dòng §1.4
   này đã bị đảo ngược cùng ngày ở DDD 0.5 — xem §8.**
4. `PROGRAMMING_OPEN_DECISIONS.md` — mở `UD-PROG-014` (tab đa POU) và ghi phần
   dư `UD-PROG-013` cần disposition.
5. `CHANGELOG.md` — entry dưới `[Unreleased]`.

## 7. Việc chưa làm và vì sao

- **Không sửa code trong phiên này.** Bốn finding đều nằm trong R3, mà R3 mở
  bằng `T59-814` `READY` theo thứ tự dependency `R1 → R2 → R3` mà
  `AUTH-PROG-2026-08-24-05` khoá. Viết code cho `T59-818..822` trước khi
  scheduler chọn task là vi phạm chính cổng đó.
- **`UD-PROG-014` cần Owner quyết**, không tự chốt: tab đa POU đổi state model
  FE và luật dirty-guard giữa các POU, tức chạm `DD-07` của DDD.
- **`RELEASE_READY` vẫn `NO-GO`** và không finding nào ở đây đổi điều đó.

---

## 8. Đảo ngược một phần §4 — ghi nhận 2026-08-27, cùng ngày

Sau khi hồ sơ này phát hành, chủ sở hữu cấp ba ảnh render PGM-02 và ra chỉ thị
thi hành. Ba ảnh đã đăng ký vào `handoff_manifest.json` **2.3**:
`assets/PGM-02A_ST_editor_reference.png`,
`assets/PGM-02B_FBD_editor_reference.png`,
`assets/PGM-02_ST_FBD_annotated_reference.png`.

### 8.1 Cái tôi kết luận sai, và vì sao

§4 bác status bar với lý do "không có trong handoff v2.2". Lý do đó **đúng với
bằng chứng lúc đó**: gói handoff dạng văn bản không nhắc status bar ở bất kỳ
mục nào. Nhưng nó **sai về kết luận**, vì tôi coi phần văn bản của gói handoff là
toàn bộ hợp đồng, trong khi visual reference cũng là hợp đồng — và bản visual
đầy đủ chỉ xuất hiện sau đó.

Cả hai ảnh đều có status bar: ST hiện `Ln 1, Col 1 · INS · LF · UTF-8 ·
No changes`; FBD hiện `Ready · Ln 1, Col 1 (100%) · FBD · Online`.

**Disposition:** status bar **trong phạm vi**, do `PGM02-V22-WP-15` / `T59-821`
sở hữu. `DDD-SW-PGM02-WORKSPACE-001` 0.5 §1.4 đã gạch bỏ dòng "ngoài phạm vi",
§7.2 thêm `WorkspaceStatusBar`, §7.3 thêm dòng ánh xạ, §10.2 thêm
`TC-PGM02-SB-01`.

### 8.2 Cái ba ảnh xác nhận là đúng

| Finding | Ảnh xác nhận |
|---|---|
| `F-PGM02-AUD-001` Inspector | Cả hai ảnh có panel Inspector đầy đủ; ST ngữ cảnh `Program`, FBD ngữ cảnh `Block Instance` |
| `F-PGM02-AUD-004a` toolbar | Cả hai ảnh có hàng công cụ riêng dưới tab bar |
| `F-PGM02-AUD-004b` tab đa POU | Cả hai ảnh có tab bar; ảnh FBD hiện tab bắc qua **hai ngôn ngữ** ⇒ `UD-PROG-014` chốt phương án **B** |
| `F-PGM02-AUD-002` Compare | Ảnh không vẽ Compare drawer, nhưng không mâu thuẫn: đây là drawer mở theo yêu cầu, và scope đã có tên trong `WP-09` |

### 8.3 Cái ba ảnh KHÔNG chứng minh — và team không được làm theo

Ảnh là tham chiếu **bố cục và phạm vi**, không phải nguồn dữ liệu. Đo trực tiếp
tại `7e6a330` cho thấy ảnh chứa ba nhóm nội dung không có thật:

1. **Quick Library FBD** hiện category `HVAC` và block `P`, `PI`, `PID_AutoTune`,
   `Ramp`. Registry `pou_library_registry_v1.json` (`libraryVersion: rev-a.3`)
   **không có** category `HVAC` và **không có** bốn block đó; `categoryOrder`
   thật là `interface · constants · logic · compare · math · conversion · timer ·
   counter · trigger · control`.
2. **PID** là ví dụ trung tâm của cả hai ảnh, nhưng registry ghi
   `featureState: REVIEW_REQUIRED` và `product_profile_v2.schema.json` quy định
   Check **chặn** mọi Program dùng nó tới khi có approval token Controls/Safety
   (`UD-PROG-010`).
3. **Ba trường Inspector** `Access`, `Description`, tên Task `Control_Main` không
   có nguồn trong Draft v2 (`draft_v2.go:349-377` chỉ có `programId`/`objectId`/
   `periodMs`) ⇒ `UD-PROG-015` mở, đang chờ Owner.

Ba nhóm này được viết thành luật cứng trong
[`PROMPT-PGM02-EDITOR-CHROME`](../../03_implementation/PROMPT_PGM02_EDITOR_CHROME_EXECUTION.md)
§2, vì rủi ro thực tế ở đây không phải team làm thiếu, mà là team làm cho **giống
ảnh** rồi vô tình bịa nội dung thư viện và làm mềm một cổng an toàn.

### 8.4 Hệ quả với bảng §5

`F-PGM02-AUD-004b` không còn là "Decision chờ Owner": `UD-PROG-014` **CLOSED**,
phương án B. `T59-821` mở rộng thành **editor chrome** (toolbar + tab + status
bar + Code Map) và chuyển `READY (một phần)` → `READY`. Phát sinh một quyết định
mới đang mở: `UD-PROG-015`, chặn đúng ba trường của `T59-818`, không chặn phần
còn lại.

## 9. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-08-27 | Thêm §8: đảo ngược phần bác bỏ status bar sau khi chủ sở hữu cấp ba ảnh render; ghi ba nhóm nội dung trong ảnh không có nguồn dữ liệu; cập nhật hệ quả với `UD-PROG-014`/`UD-PROG-015` và `T59-821` |
| 1.0 | 2026-08-27 | Phán quyết gốc: bác phần sai baseline, chuyển 4 finding hợp lệ + 1 finding truy nguyên thành `T59-818..822` |
