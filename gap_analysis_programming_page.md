# GAP ANALYSIS — Edit Program Page vs Design Mockup

> [!CAUTION]
> **ĐÃ PHÁN QUYẾT 2026-08-27 — KHÔNG DÙNG TÀI LIỆU NÀY ĐỂ LẬP KẾ HOẠCH.**
>
> Tài liệu đối chiếu nhầm cây mã nguồn: mọi đường dẫn trỏ tới
> `C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/…`, tức trang
> **legacy graph demo** đã bị khoá sau cờ `LEGACY_GRAPH_DEMO_ENABLED`, không
> phải workspace PGM-02 đang là hợp đồng thi hành (`apps/web-ui/src/features/programming/`,
> sau cờ `VITE_PROGRAMMING_REV_A` + `VITE_PROGRAMS_WORKSPACE_V2`).
>
> Hệ quả: các con số "62 Critical", "~90% chưa implement", "46–71 tuần" và ba
> phương án A/B/C **bị bác**. Bốn phát hiện hợp lệ đã được tách ra, cấp mã
> `F-PGM02-AUD-001..005` và đưa vào Plan 59 thành `T59-818..822`.
>
> Phán quyết đầy đủ, có bằng chứng từng dòng:
> [`REC-PGM02-AUD-ADJ-001`](docs/07_records/reviews/PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md).
> Giữ file này nguyên trạng bên dưới để truy nguyên.

---


> **Document:** GAP-UI-PROGRAMMING-001  
> **Date:** 2026-08-27  
> **Status:** Draft  
> **Scope:** So sánh trang Programming hiện tại ([ProgrammingPage.tsx](file:///C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/pages/ProgrammingPage.tsx)) với design mockup IEC 61131-3 IDE  
> **Severity scale:** 🔴 Critical (thiếu hoàn toàn) · 🟠 Major (có nhưng sai lệch lớn) · 🟡 Minor (cần chỉnh) · 🟢 OK

---

## 1. Executive Summary

> [!CAUTION]
> **Trang Programming hiện tại và design mockup là hai ứng dụng hoàn toàn khác nhau.**  
> Trang hiện tại là một **JSON text editor** cho `graph.json` với validator.  
> Design mockup yêu cầu một **IEC 61131-3 PLC Programming IDE** hoàn chỉnh (Structured Text editor, POU tree, Quick Library, Inspector, Problems panel, Runtime Watch).  
> Khoảng cách ước tính: **~90% chức năng chưa được implement**.

---

## 2. Tổng quan so sánh Layout

### Design Mockup Layout (12 vùng chính)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ① Top Header Bar (Project selector, Revision, Controller, Actions) │
├────────┬──────┬──────────────────┬─────────────┬─────────────────────┤
│ ②      │ ③    │ ④ Editor Toolbar │             │                     │
│ Left   │ POU  │ ⑤ Tab Bar        │ ⑦ Quick     │ ⑧ Inspector Panel   │
│ Nav    │ Tree │ ⑥ ST Code Editor │   Library   │                     │
│ Side   │      │                  │   Panel     │                     │
│ bar    │      │                  │             │                     │
│        │      ├──────────────────┴─────────────┤                     │
│        │      │ ⑨ Bottom Panel                 │                     │
│        │      │ (Problems / Runtime Watch /     │                     │
│        │      │  Search / Cross Reference)      │                     │
├────────┴──────┴─────────────────────────────────┴─────────────────────┤
│ ⑫ Status Bar (Ln, Col, INS, LF, UTF-8)                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Trang Hiện Tại Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar (Time, Status, User, Language)                                │
├──────────┬───────────────────────────────────────────────────────────┤
│ NavRail  │ Main content area                                         │
│ (generic │ ┌────────────────────────────────────────────────────────┐│
│ sidebar) │ │ h1: "Programming" + StatusBadge                       ││
│          │ │ 3-column grid:                                        ││
│          │ │ [Component Library] [graph.json textarea] [Results]   ││
│          │ └────────────────────────────────────────────────────────┘│
└──────────┴───────────────────────────────────────────────────────────┘
```

---

## 3. Chi tiết GAP theo từng thành phần

### ① Top Header Bar — Programming Context

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| DDC-24 Programming logo/brand | ✅ Logo "DDC-24 Programming" teal color | ❌ Không có — dùng generic NavRail header | 🔴 |
| Project selector dropdown | ✅ "Project: AHU_01 ▾" | ❌ Không có | 🔴 |
| Editing revision info | ✅ "Editing: r17 (Draft)" badge | ❌ Không có | 🔴 |
| Running revision info | ✅ "Running: r15 (Active)" badge | ❌ Không có | 🔴 |
| Controller connection status | ✅ "Controller: DDC-24-01 🟢 ONLINE" | ❌ Chỉ có generic system online badge ở TopBar | 🟠 |
| Help button (?) | ✅ Có | ✅ Có (TopBar) | 🟢 |
| Notification bell with count | ✅ "🔔 5" | ✅ Có (TopBar alarm count) | 🟢 |
| **Save button** (green) | ✅ "💾 Save" prominent green button | ❌ Không có | 🔴 |
| **Check button** (teal) | ✅ "Check" button | ❌ Không có | 🔴 |
| More menu (⋮) | ✅ Có | ❌ Không có | 🟡 |

---

### ② Left Sidebar Navigation

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| Sidebar style | ✅ Dark teal background, programming-specific items | ❌ Generic app NavRail với 3 group (Overview/Settings/Engineering) | 🟠 |
| **Overview** nav item | ✅ Có | ❌ Không có (different nav structure) | 🔴 |
| **Programs** nav item (highlighted) | ✅ Highlighted teal when active | ❌ Chỉ có generic "Programming" link | 🔴 |
| **Points & Mapping** nav item | ✅ Có | ❌ Không có | 🔴 |
| **Control Library** nav item | ✅ Có | ❌ Không có (có Component Library nhưng là panel, không phải nav) | 🔴 |
| **Check & Commission** nav item | ✅ Có | ❌ Có "Commissioning" nhưng layout khác | 🟠 |
| **Runtime & Diagnostics** nav item | ✅ Có | ❌ Không có | 🔴 |
| User avatar + info bottom | ✅ Avatar "admin/Administrator" | ❌ Có user info nhưng ở TopBar, không có avatar | 🟡 |
| **Collapse** button | ✅ Có | ✅ Có | 🟢 |

---

### ③ POU (Program Organization Unit) Tree Panel

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **POU Tree panel** | ✅ Full tree with expandable hierarchy | ❌ **Hoàn toàn không có** | 🔴 |
| "+ New" button | ✅ Có | ❌ Không có | 🔴 |
| 🔍 Search POU filter | ✅ Có | ❌ Không có | 🔴 |
| Filter button (⚙) | ✅ Có | ❌ Không có | 🔴 |
| **Programs section** | ✅ Expandable tree: AHU_Main → Init, Main (●), Alarms, PID_Loop | ❌ Không có | 🔴 |
| **Pump_Logic, Fan_Logic** | ✅ Separate program entries | ❌ Không có | 🔴 |
| **Function Blocks section** | ✅ PID, Ramp, TimerEx | ❌ Không có (có Component Library nhưng flat list, không tree) | 🔴 |
| **Functions section** | ✅ Limit, Scale | ❌ Không có | 🔴 |
| Active POU indicator (●) | ✅ Blue dot on "Main" | ❌ Không có | 🔴 |
| Context menu on items | ✅ Expandable (▸ ▾) | ❌ Không có | 🔴 |

---

### ④ Editor Toolbar

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **Editor toolbar row** | ✅ Undo, Redo, Cut, Copy, Delete, Find/Replace, Zoom +/-, Go-to-line icons | ❌ **Hoàn toàn không có** | 🔴 |
| Language selector dropdown | ✅ "ST ▾" (Structured Text) | ❌ Không có — chỉ có plain textarea | 🔴 |
| Auto mode dropdown | ✅ "Auto ▾" | ❌ Không có | 🔴 |

---

### ⑤ Tab Bar (Multi-POU tabs)

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **Multiple POU tabs** | ✅ "AHU_Main.Main [ST] ✕" + "AHU_Main.PID_Loop [ST] ✕" | ❌ **Hoàn toàn không có** | 🔴 |
| Tab close button (✕) | ✅ Có | ❌ Không có | 🔴 |
| New tab button (+) | ✅ Có | ❌ Không có | 🔴 |
| Active tab highlighting | ✅ Underline active tab | ❌ Không có | 🔴 |

---

### ⑥ Code Editor (IEC 61131-3 Structured Text)

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **ST code editor** | ✅ Full syntax-highlighted Structured Text editor | ❌ **Plain textarea** editing JSON graph.json | 🔴 |
| Line numbers | ✅ Numbered 1–23 | ❌ Không có (plain textarea) | 🔴 |
| Syntax highlighting | ✅ Keywords (PROGRAM, VAR, END_VAR) in colors, types (REAL, BOOL) colored, comments in green | ❌ Không có — raw JSON text | 🔴 |
| IEC 61131-3 language support | ✅ ST (Structured Text) with PID, Timer, Function blocks | ❌ **Không hỗ trợ IEC** — chỉ là JSON validator | 🔴 |
| Variable declarations | ✅ `VAR ... END_VAR` block with typed variables | ❌ JSON nodes/links model instead | 🔴 |
| Function block calls | ✅ `FB_PID_01(SP := ..., PV := ...)` | ❌ Không có | 🔴 |
| Auto-completion | ✅ Implied by IDE design | ❌ Không có | 🔴 |
| Error/warning indicators in gutter | ✅ Implied (line 18 error, line 12 warning) | ❌ Không có | 🔴 |

---

### ⑦ Quick Library Panel

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **Quick Library panel** | ✅ Floating panel bên phải editor với search + category tabs | ❌ Có "Component Library" nhưng layout/UX hoàn toàn khác | 🟠 |
| Search blocks field | ✅ 🔍 "Search blocks..." | ❌ Không có search | 🔴 |
| Category tabs | ✅ All / Common / HVAC / Math / Logic | ❌ Không có tabs — flat list | 🔴 |
| **Visual function block cards** | ✅ Graphical representations: PID controller box với SP/PV/OUT pins, TON/TOF/CTU/R_TRIG/F_TRIG/LIMIT/SCALE với pin diagrams | ❌ Text-only cards với Add button | 🔴 |
| Drag-and-drop from library | ✅ Implied (blocks have visual pin layout) | ❌ Không có — chỉ "Add" button chèn JSON | 🔴 |
| Pin visualization | ✅ Input/Output pins shown graphically (→ IN, OUT →) | ❌ Không có | 🔴 |
| "More blocks..." link | ✅ Có | ❌ Không có | 🔴 |
| "..." menu on each block | ✅ Có | ❌ Không có | 🟡 |

---

### ⑧ Inspector Panel (Right Panel)

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **Inspector panel** | ✅ Right sidebar showing selected POU properties | ❌ **Hoàn toàn không có** | 🔴 |
| Program type header | ✅ "Program" label | ❌ Không có | 🔴 |
| **Name** field | ✅ "Main" editable | ❌ Không có | 🔴 |
| **Language** dropdown | ✅ "ST ▾" | ❌ Không có | 🔴 |
| **Type** dropdown | ✅ "PROGRAM ▾" | ❌ Không có | 🔴 |
| **Access** field | ✅ Có | ❌ Không có | 🔴 |
| **Cycle (in Task)** field | ✅ "Control_Main (1 s)" | ❌ Không có | 🔴 |
| **Description** textarea | ✅ "Main control logic for AHU..." | ❌ Không có | 🔴 |
| **Parameters** collapsible section | ✅ "> Parameters" | ❌ Không có | 🔴 |
| **Attributes** collapsible section | ✅ "> Attributes" | ❌ Không có | 🔴 |
| Pin (📌) icon | ✅ Có | ❌ Không có | 🔴 |

---

### ⑨ Bottom Panel — Problems

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **Problems tab with count** | ✅ "Problems (2)" tab | ❌ Có validation results nhưng layout hoàn toàn khác | 🟠 |
| Table columns | ✅ Severity / Location / Object / Message / Code | ❌ Validation chỉ hiện path + message | 🟠 |
| **Error row** | ✅ "🔴 Error | Line 18, Col 20 | Main | Undeclared identifier 'AI_Unknown' | PRG-E-1001" | ❌ Không theo format này | 🔴 |
| **Warning row** | ✅ "⚠ Warning | Line 12, Col 1 | Main | Implicit conversion REAL to BOOL | PRG-W-2002" | ❌ Có nhưng content khác (JSON validation, không ST) | 🔴 |
| **Runtime Watch (Live)** tab | ✅ Live table: Name/Value/Type/Quality/Timestamp | ❌ **Hoàn toàn không có** | 🔴 |
| Live variable values | ✅ temp_in=23.4, temp_sp=24.0, valve_cmd=42.3, fan_cmd=TRUE | ❌ Không có | 🔴 |
| Live chart/sparkline | ✅ Small chart in Runtime Watch | ❌ Không có | 🔴 |
| **Search** tab | ✅ Có | ❌ Không có | 🔴 |
| **Cross Reference** tab | ✅ Có | ❌ Không có | 🔴 |
| Resizable/dockable panel | ✅ Implied | ❌ Không có | 🔴 |

---

### ⑫ Status Bar

| Element | Design Mockup | Hiện tại | Gap |
|---------|--------------|----------|-----|
| **Status bar** | ✅ "Ln 1, Col 1 | INS | LF | UTF-8" | ❌ **Hoàn toàn không có** | 🔴 |
| Line/Column display | ✅ "Ln 1, Col 1" | ❌ Không có | 🔴 |
| Insert/Overwrite mode | ✅ "INS" | ❌ Không có | 🔴 |
| Line ending indicator | ✅ "LF" | ❌ Không có | 🔴 |
| Encoding indicator | ✅ "UTF-8" | ❌ Không có | 🔴 |
| "No changes" indicator | ✅ "✅ No changes" | ❌ Không có | 🔴 |

---

## 4. Thống kê GAP

| Severity | Count | % |
|----------|-------|---|
| 🔴 Critical (thiếu hoàn toàn) | **62** | 77% |
| 🟠 Major (có nhưng sai lệch lớn) | **7** | 9% |
| 🟡 Minor (cần chỉnh) | **4** | 5% |
| 🟢 OK | **4** | 5% |
| **Tổng items đánh giá** | **77** | — |

---

## 5. Root Cause Analysis

### Tại sao gap lớn đến vậy?

1. **Kiến trúc khác nhau cơ bản:**
   - Design mockup yêu cầu **IEC 61131-3 PLC Programming IDE** — một ứng dụng IDE chuyên dụng với code editor, multi-tab, POU management, inspector, diagnostics
   - Implementation hiện tại là **JSON graph validator** — edit/validate/deploy JSON configuration cho demo graph engine

2. **Routing không khớp:**
   - Design: `/eng/programming/programs?project=...&pou=...&mode=EDIT` (nested route với query params)
   - Code: `/eng/programming` → flat `ProgrammingPage.tsx` (single page, no routing params)

3. **Data model hoàn toàn khác:**
   - Design: POU-based model (Programs, Function Blocks, Functions) theo IEC 61131-3
   - Code: Graph-based model (Nodes, Links, IO Map) theo proprietary JSON schema

4. **Không có code editor engine:**
   - Design yêu cầu code editor như Monaco/CodeMirror với syntax highlighting, line numbers, gutter markers
   - Code chỉ dùng `<textarea>` native

---

## 6. Các Module Cần Phát Triển Mới

> [!IMPORTANT]
> Đây là danh sách các module/component chưa tồn tại trong codebase hiện tại mà cần phát triển mới hoàn toàn để đạt được design mockup.

### Tier 1 — Core Infrastructure (phải có trước)

| # | Module | Mô tả | Estimate |
|---|--------|-------|----------|
| 1 | **IEC 61131-3 Language Model** | Parser/tokenizer cho ST, IL, FBD, LD, SFC | Very Large |
| 2 | **Code Editor Component** | Tích hợp Monaco Editor hoặc CodeMirror cho ST | Large |
| 3 | **Project/POU Data Model** | CRUD operations cho Projects, POUs, Variables | Large |
| 4 | **Backend API — Programming** | REST/WS endpoints cho POU management, compilation, runtime | Very Large |

### Tier 2 — UI Components (sau khi có Tier 1)

| # | Module | Mô tả | Estimate |
|---|--------|-------|----------|
| 5 | **Programming Layout Shell** | Full-page IDE layout thay thế AppShell standard | Medium |
| 6 | **Programming Top Bar** | Project selector, revision, controller, save/check | Medium |
| 7 | **Programming Sidebar** | Dedicated nav cho Programming context | Small |
| 8 | **POU Tree Panel** | Tree view + search + filter cho POUs | Medium |
| 9 | **Editor Tab Bar** | Multi-tab management cho multiple open POUs | Medium |
| 10 | **Quick Library Panel** | Categorized function blocks với visual pin diagrams | Large |
| 11 | **Inspector Panel** | Property editor cho selected POU/variable/block | Medium |
| 12 | **Problems Panel** | Tabbed panel: Problems/Runtime Watch/Search/Cross Ref | Large |
| 13 | **Runtime Watch Panel** | Live variable monitoring với values/quality/timestamp | Large |
| 14 | **Status Bar** | Editor state display (line/col/encoding/changes) | Small |

### Tier 3 — Advanced Features

| # | Module | Mô tả | Estimate |
|---|--------|-------|----------|
| 15 | **ST Syntax Highlighting** | Keyword/type/comment/string coloring rules | Medium |
| 16 | **ST Auto-completion** | Variable/function/FB completion engine | Large |
| 17 | **Compiler/Checker Service** | Real-time validation, error/warning with codes | Very Large |
| 18 | **Revision Management** | Draft/Active revision tracking and switching | Medium |
| 19 | **Drag-and-Drop Library** | DnD from library to editor insertion | Medium |
| 20 | **Cross Reference** | Find all usages of variables/blocks | Medium |

---

## 7. Đánh Giá Effort

> [!WARNING]
> Với mức gap ~90%, đây không phải là task "fix UI" mà là **phát triển một ứng dụng IDE mới hoàn toàn**.

| Category | Effort Estimate |
|----------|----------------|
| Frontend UI/UX (Tier 2) | 8–12 tuần (2 FE developers) |
| Code Editor Integration | 2–3 tuần |
| IEC 61131-3 Language Support | 12–20 tuần (specialized) |
| Backend API & Compiler | 16–24 tuần (2 BE developers) |
| Runtime Watch & Diagnostics | 4–6 tuần |
| Integration & Testing | 4–6 tuần |
| **Tổng ước tính** | **46–71 tuần (~10–16 tháng)** |

---

## 8. Đề Xuất Phương Án Tiếp Cận

### Option A — Incremental (Recommended cho MVP)

Giữ nguyên graph.json approach nhưng nâng UI cho giống IDE mockup:
1. Thay `<textarea>` bằng **Monaco Editor** (có JSON schema validation built-in)
2. Thêm **IDE layout shell** (sidebar + tabs + inspector + bottom panel)
3. Thêm **POU tree** nhưng map sang graph.json nodes
4. Không implement IEC 61131-3 compiler

**Effort: ~6–10 tuần, 2 developers**

### Option B — Full IEC Implementation

Xây dựng IEC 61131-3 IDE hoàn chỉnh theo design mockup:
- Cần IEC language parser, compiler, runtime
- Có thể tích hợp open-source IEC runtime (OpenPLC, CODESYS-like)
- Đầy đủ tính năng theo mockup

**Effort: ~12–16 tháng, 3–4 developers**

### Option C — Hybrid (Phased)

1. **Phase 1** (MVP ~8 tuần): IDE layout + Monaco Editor + JSON graph editing
2. **Phase 2** (~12 tuần): ST language mode + basic compilation + POU tree
3. **Phase 3** (~16 tuần): Runtime Watch + Cross Reference + full IEC

---

## 9. Tham Chiếu Code Hiện Tại

| File | Vai trò | Liên quan |
|------|---------|-----------|
| [ProgrammingPage.tsx](file:///C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/pages/ProgrammingPage.tsx) | Trang programming hiện tại | Cần thay thế hoàn toàn |
| [App.tsx](file:///C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/App.tsx#L62) | Route definition `/eng/programming` | Cần thêm nested routes |
| [AppShell.tsx](file:///C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/components/AppShell.tsx) | Layout shell | Cần layout riêng cho Programming mode |
| [NavRail.tsx](file:///C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/components/NavRail.tsx) | Sidebar navigation | Cần sidebar riêng cho Programming |
| [TopBar.tsx](file:///C:/Users/kimla/Downloads/ddc24-main/ddc24-main/src/frontend/src/components/TopBar.tsx) | Top bar | Cần top bar riêng cho Programming |
