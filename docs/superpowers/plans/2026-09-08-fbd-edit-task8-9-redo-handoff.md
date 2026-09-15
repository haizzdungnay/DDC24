# SESSION HANDOFF — FBD EDIT Tasks 8 & 9 REDO

## 1. SESSION OBJECTIVE

Làm lại (REDO) giao diện Tasks 8 và 9 của FBD EDIT feature để **khớp chính xác** hình tham khảo `PGM-02B_FBD_editor_reference.png`. Tasks 8/9 đã được merge vào main (PR #576, #580) nhưng giao diện hiện tại khác biệt đáng kể so với reference design. User yêu cầu rõ ràng: "không được khác hoặc tự suy luận lung tung".

**Kết quả mong muốn:** UI FBD Editor trông giống hệt reference image ở mọi chi tiết: layout 4 zone, màu sắc, typography, spacing, component structure.

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Bắt buộc
- Opus chỉ điều phối, lên kế hoạch, xác minh. MỌI code execution giao cho Sonnet/Haiku subagent.
- Push branch + tạo PR; user merge thủ công. Không auto-merge, không xóa branch sau push.
- Commits, PRs, docs, comments, UI strings phải là tiếng Việt có dấu đúng (pass `check:ui-strings` linter).
- Bundle budget R3 = 165.00 KiB gzip cho `programming-*.js`.
- Giao diện **PHẢI KHỚP CHÍNH XÁC** với `PGM-02B_FBD_editor_reference.png`.

### Cấm
- **Cấm sửa file:** `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`, `apps/web-ui/package.json`, `apps/web-ui/.env.local`.
- **Cấm làm yếu assertion:** không delete/comment-out test, không `.skip`/`.only`/`.todo`, không nới matcher, không empty-return mock, không render element trống/ẩn để pass `getByTestId`.
- **Cấm git write từ subagent:** add/commit/push/gh/stash/checkout/restore/reset/clean.
- Không `git add -A` / `git add .` — stage explicit paths.
- Không `git reset --hard`, `git checkout -- <file>`, `git clean -fd`.
- CHANGELOG.md thay đổi phải purely additive (0 deleted lines).

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW
- Opus điều phối, Sonnet/Haiku subagent thực thi.
- Tối đa 3 subagent đồng thời.
- Subagent không chạy git write command.
- Đọc reference image trước, phân tích gap, lập kế hoạch chi tiết, rồi mới code.

### SESSION-ESTABLISHED WORKFLOW
1. Đọc và hiểu reference design → Gap analysis
2. Lập kế hoạch REDO chi tiết
3. Viết test failing (TDD)
4. Implement từng phần theo plan
5. Chạy test + lint + tsc sau mỗi phần
6. Verify UI qua Playwright trace (webview skill)
7. Commit + push + PR khi hoàn thành

### WORKFLOW INVARIANTS
- Luôn đọc file liên quan trước khi sửa.
- Không sửa nhiều module cùng lúc khi chưa cần.
- Không refactor ngoài phạm vi task.
- Mỗi thay đổi phải verify trước khi tiếp tục.
- Không tự thay đổi kiến trúc đã thống nhất.
- Giải quyết từng bước theo thứ tự.

## 4. CURRENT WORKFLOW POSITION

```
Workflow:          Analysis → Plan → REDO Implementation → Test → Verify → Commit/PR
Completed:         Analysis (reference image + gap analysis)
Currently working: Plan (handoff document)
Next:              REDO Implementation → Test → Verify → Commit/PR
```

## 5. WORKSPACE / ENVIRONMENT

- **Working directory:** `E:\TuanDuong\INTERN\DDC24_project` (parent), repo: `MK-DDC-24/`
- **Branch:** `main` at commit `14872059` (synced with origin/main)
- **Local branch:** `feat/fbd-edit-task8` at `194530c7` (NOT pushed, archived Stage B work)
- **Runtime:** Node.js, npm
- **Build:** Vite 8.2.0
- **Language:** TypeScript 5
- **CSS:** Tailwind CSS v4
- **Test:** Vitest 4.1.10, Playwright 1.61.1
- **OS:** Windows 11, Git Bash
- **Board lab:** 192.168.120.224:8081 — DEAD. Dùng webview skill (Playwright trace) để xem UI.
- **Demo mode:** `VITE_DDC_MODE` chỉ nhận `live` hoặc `demo`. Demo simulator không mock Programming API.
- **Untracked files:** `.claude/skills/webview/`, `apps/web-ui/playwright.headed-view.config.ts`

## 6. CURRENT VERIFIED STATE

### VERIFIED
- Branch `main` tại commit `14872059`, up to date với origin/main.
- Tasks 8/9 đã merge (PR #576, #580) — code có trên main.
- `tsc` pass ✅
- `lint` pass ✅
- `vitest` có 1 test failure đã biết trong `ShellNavigation.test.tsx` — env drift, không phải regression.
- Reference image đã đọc và phân tích chi tiết.
- Gap analysis hoàn thành — 6 component areas so sánh.

### UNVERIFIED
- Chưa kiểm tra chính xác từng file source code cụ thể cho từng gap item.
- Chưa xác nhận bundle size hiện tại.

## 7. COMPLETED WORK

### Phân tích reference design (VERIFIED)
- Đọc `PGM-02B_FBD_editor_reference.png` (1672×941px, 8-bit RGB)
- Layout: Dark mode IDE, 4 zone
- Colors: Canvas #1A1B1E, Panels #25262B, Block #2C2E33, Header #1F2024, Border #373A40, Text #F8F9FA, Accent #228BE6, Success #40C057, Warning #FD7E14, Error #FA5252, Info #15AABF
- Typography: Inter/Segoe UI (UI), JetBrains Mono (code). Title 14px/600, Dock header 12px/600 uppercase, Body 12px/400, Port labels 11px/500, Datatype 10px/500 mono
- Spacing: Large 16px, Small 8px, Micro 4px

### Gap analysis (VERIFIED)
6 khu vực so sánh đã hoàn thành — chi tiết xem mục 8.

### Tạo webview skill (VERIFIED)
- `.claude/skills/webview/SKILL.md` (132 dòng, untracked)
- Skill cho xem UI qua Playwright trace khi board lab chết.

## 8. WORK IN PROGRESS

**REDO Plan cho Tasks 8/9.** Dưới đây là gap analysis chi tiết + plan sửa:

### GAP 1: Overall Shell & Layout
**Hiện tại:** Không có fixed 4-zone IDE grid. Dùng CSS tokens chung, panel widths fluid, thiếu dual header 48px+36px.
**Cần làm:**
- Tạo IDE layout grid cố định: Top header (48px+36px), Left POU Explorer (~260px/15%), Center Canvas (~980px/55%), Right Library+Inspector (~380px/20-25%), Bottom Diagnostics (~180px).
- Áp dụng palette IDE chuyên dụng: #1A1B1E (canvas), #25262B (panels), #373A40 (borders), #F8F9FA (text), #228BE6 (accent).
- **Files:** `DesignWorkspacePage.tsx`, `FbdEditorPane.tsx`

### GAP 2: POU Tab Bar
**Hiện tại:** Web tab list chuẩn, icon `+` chung.
**Cần làm:**
- Styling IDE tab (active/inactive states, close button, dark panel).
- Đổi "+" thành "Thêm chương trình FBD" action rõ ràng.
- **Files:** `FbdEditorPane.tsx`

### GAP 3: POU Explorer (Left Dock)
**Hiện tại:** Thiếu "Global Variables" và "I-O Mapping" tree groups. Không có dedicated 260px left dock. Thiếu dark styling.
**Cần làm:**
- Thêm tree groups: Programs, Function Blocks, Functions, Global Variables, I-O Mapping.
- Persistent 260px left dock.
- Dark panel styling (#25262B, #373A40 borders, 12px uppercase headers).
- **Files:** `DesignWorkspacePage.tsx`, có thể thêm component mới cho POU Explorer.

### GAP 4: Canvas & Sub-Toolbar
**Hiện tại:** Thiếu Zoom In/Out/100%/Fit buttons, Scan Cycle label, Auto Route button, alignment tools. Blocks không có domain color coding. Wires không color-code by datatype. Minimap bị suppress khi nodes < 24.
**Cần làm:**
- Thêm sub-toolbar đầy đủ: Undo/Redo, Zoom controls (In/Out/100%/Fit), Grid/Snap toggles, Align tools (Left/Center/Right/Top/Middle/Bottom), Auto Route, Scan Cycle display.
- Domain color coding cho block headers: Logic green #2F9E44, Control orange #E8590C, Math blue #1971C2, Timer purple #7950F2.
- Datatype colored wires.
- Di chuyển palette/library vào right panel thay vì overlay trên canvas.
- Minimap 140×90px, chỉ hiện khi nodes ≥ FBD_MINIMAP_NODE_THRESHOLD (24).
- **Files:** `FbdEditorPane.tsx`, `StructuredFbdEditor.tsx`

### GAP 5: Quick Library & Inspector (Right Dock)
**Hiện tại:** Library là overlay/toggle drawer. Flat category chips. Thiếu FB/FUN badges, execution order editor, port invert toggle, inline port defaults.
**Cần làm:**
- Tabbed container 380px: Library tab + Inspector tab.
- Library: Accordion tree categories thay vì flat chips. FB/FUN badges.
- Inspector: Block info, Parameters table, Ports config. Execution order editor, port invert toggle, inline port defaults.
- **Files:** `FbdEditorPane.tsx`, component mới cho Library/Inspector panels.

### GAP 6: Workbench & Diagnostics (Bottom Panel)
**Hiện tại:** Thiếu "Mini Map" tab. Default 120px collapsed (reference ~180px). Status counts không ở unified bottom strip. Trace tab có nhưng không trong reference.
**Cần làm:**
- Bottom panel tabs đầy đủ: Problems, Runtime Watch, Search, Cross Reference, Mini Map.
- Default mở 180px (không collapsed).
- Reuse `ProblemsDrawer.tsx` (348 dòng).
- Status strip: node/wire/network count, dirty/read-only, canonical validity.
- Auto Layout: preview → Apply/Cancel via SET_LAYOUT_BATCH.
- **Files:** `DesignWorkbench.tsx`, `ProgrammingWorkbench.tsx`, `FbdEditorPane.tsx`, `StructuredFbdEditor.tsx`

### Responsive breakpoints (Task 8 spec)
- ≥1440: Full 4-zone
- 1024-1439: Explorer + Canvas, right docks drawer
- 768-1023: Tablet canvas + drawers + nút "Chọn vùng"
- <768: Read-only banner, tắt mutation controls

## 9. IMPORTANT DECISIONS

| Quyết định | Lý do | Ai chốt |
|---|---|---|
| Giao diện phải khớp chính xác reference PNG | User yêu cầu rõ ràng | User |
| Opus chỉ điều phối, không code | Tiết kiệm token Opus | User |
| SVG-first architecture cho FBD canvas | Đã thiết kế từ task trước | User + Agent |
| Feature flag: `isFbdEditEnabled` | Kiểm soát rollout | Plan |
| FBD_MINIMAP_NODE_THRESHOLD = 24 | Task 9 spec | Plan |
| Reuse ProblemsDrawer.tsx | 348 dòng đã có, task 9 spec | Plan |

## 10. RELEVANT FILES & ARTIFACTS

### Reference
- `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png` — TARGET DESIGN (1672×941px)
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — Master plan (928+ dòng). Task 8: lines 597-648. Task 9: lines 652-697. TC-FBD matrix: lines 900-928.

### Code (Task 8)
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx` — Modify
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` — Modify
- `apps/web-ui/src/shared/theme/ThemeProvider.tsx` — Read-only (FOLLOW_WEB)
- Tests: `FbdEditorPane.test.tsx`, `DesignWorkspacePage.test.tsx`

### Code (Task 9)
- `apps/web-ui/src/features/programming/design/workbench/DesignWorkbench.tsx` — Modify
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` — Modify
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` — Modify
- Reference: `apps/web-ui/src/features/programming/shared/ProblemsDrawer.tsx` — Reuse (348 dòng)
- Tests: `FbdWorkbench.test.tsx` (tạo mới), `StructuredFbdEditor.test.tsx`

### FORBIDDEN FILES (TUYỆT ĐỐI KHÔNG SỬA)
- `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`
- `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`
- `apps/web-ui/package.json`, `apps/web-ui/.env.local`

### Skills
- `.claude/skills/webview/SKILL.md` — Xem giao diện qua Playwright trace

### Config
- `apps/web-ui/src/shared/config.ts` — DDC_MODE config, feature flags

## 11. CODE CHANGES

Chưa có code changes trong phiên này. Tasks 8/9 code hiện tại trên main là kết quả của PR #576, #580 từ phiên trước. REDO sẽ tạo branch mới từ main và sửa lại.

## 12. COMMANDS RUN

```bash
git status                          # Clean, trên main, 2 untracked files
git log --oneline -5                # Confirm commit 14872059
git branch -a | grep task           # Found feat/fbd-edit-task8 local
cd apps/web-ui && npx tsc --noEmit  # Pass
npm run lint                        # Pass
npx vitest --run                    # 1 known failure (ShellNavigation.test.tsx)
```

## 13. TEST / VALIDATION STATUS

| Check | Status | Ghi chú |
|---|---|---|
| tsc | ✅ Pass | |
| lint | ✅ Pass | |
| vitest | ⚠️ 1 failure | `ShellNavigation.test.tsx` — env drift, không phải regression |
| build | CHƯA KIỂM TRA | |
| bundle size | CHƯA KIỂM TRA | Budget R3 = 165.00 KiB |
| UI visual | CHƯA KIỂM TRA | Cần dùng webview skill |

## 14. ERRORS / BLOCKERS

| Error | Context | Nguyên nhân | Status |
|---|---|---|---|
| Board lab dead | 192.168.120.224:8081 unreachable | Lab offline | Workaround: webview skill |
| `build:e2e` fails Windows | Unix env-var syntax | `cmd.exe` incompatible | Workaround: build tay trong Git Bash |
| `fatal: not a git repository` | Harness cwd resets | Parent dir is cwd | Workaround: cd trước mỗi lệnh |
| ShellNavigation.test.tsx fail | vitest | Env drift | Known issue, not regression |

## 15. FAILED ATTEMPTS — DO NOT REPEAT

| Attempt | Kết quả | Lý do thất bại | DO NOT REPEAT? |
|---|---|---|---|
| Dùng `PWDEBUG=1` để xem UI | Trang trắng "Core is unreachable" | Mock chạy trong test body, không phải beforeEach | **DO NOT REPEAT** |
| `npm run build:e2e` trên Windows | `'VITE_DDC_MODE' is not recognized` | Script dùng Unix env syntax | **DO NOT REPEAT** — build tay bằng Git Bash |
| Đọc `.output` file của local agent | File rỗng | JSONL transcript symlink, không phải output | **DO NOT REPEAT** — dùng task-notification |

## 16. IMPORTANT CONVERSATION CONTEXT

- User nhấn mạnh rất rõ: **giao diện PHẢI GIỐNG HỆT hình tham khảo**, "không được khác hoặc tự suy luận lung tung".
- User đã nhắc nhở khi agent bắt đầu code trong lúc chỉ được đọc: "chỉ đọc thôi mà không code". Phải tôn trọng phạm vi yêu cầu.
- Tasks 8/9 code hiện tại trên main đã complete nhưng UI SAI so với reference. Đây là lý do REDO.
- Khi pull code từ GitHub, user chọn "Lấy main, bỏ code local".
- User yêu cầu tạo webview skill để tái sử dụng quy trình xem UI.

## 17. NEXT ACTIONS

Tuân thủ workflow: Analysis → Plan → REDO Implementation → Test → Verify → Commit/PR.

1. **Tạo branch mới** từ main cho REDO (ví dụ `feat/fbd-edit-task8-9-redo`).
2. **Đọc các file source code** liên quan (FbdEditorPane.tsx, DesignWorkspacePage.tsx, DesignWorkbench.tsx, ProgrammingWorkbench.tsx, StructuredFbdEditor.tsx) để hiểu implementation hiện tại.
3. **Lập implementation plan chi tiết** dựa trên 6 gap areas ở mục 8, chia thành các bước nhỏ.
4. **TDD:** Viết test failing cho từng gap area.
5. **Implement từng gap** theo thứ tự:
   - Gap 1: Shell & Layout (4-zone grid + IDE palette)
   - Gap 2: POU Tab Bar
   - Gap 3: POU Explorer (left dock)
   - Gap 4: Canvas & Sub-toolbar
   - Gap 5: Quick Library & Inspector (right dock)
   - Gap 6: Workbench & Diagnostics (bottom panel)
6. **Sau mỗi gap:** chạy tsc + lint + vitest, verify qua webview skill.
7. **Kiểm tra bundle size** so với budget R3 (165.00 KiB).
8. **Commit + push + tạo PR** khi tất cả gaps đã sửa và pass.

## 18. DEFINITION OF DONE

- [ ] UI khớp chính xác reference image `PGM-02B_FBD_editor_reference.png`
- [ ] tsc pass
- [ ] lint pass (gồm `check:ui-strings`)
- [ ] vitest pass (trừ known failure ShellNavigation)
- [ ] build pass
- [ ] Bundle size ≤ 165.00 KiB gzip cho `programming-*.js`
- [ ] Responsive hoạt động đúng ở 4 breakpoints (1440+, 1024-1439, 768-1023, <768)
- [ ] Bottom panel tabs đầy đủ: Problems, Runtime Watch, Search, Cross Reference, Mini Map
- [ ] Status strip hiển thị node/wire/network count, dirty/read-only, canonical validity
- [ ] Auto Layout preview → Apply/Cancel hoạt động
- [ ] Không phá behavior cũ
- [ ] Commits + PR bằng tiếng Việt có dấu
- [ ] Không sửa forbidden files

---

# INSTRUCTION FOR NEXT CLAUDE CODE SESSION

Coi đây là **continuation của cùng một phiên làm việc**, không phải task mới.

1. Đọc toàn bộ handoff trước khi hành động.
2. Kiểm tra workspace, git status và các artifact/file được reference để xác minh trạng thái thực tế.
3. Nếu handoff và filesystem khác nhau, ưu tiên trạng thái thực tế của filesystem/code/git nhưng phải xác định nguyên nhân khác biệt trước khi thay đổi.
4. Không bắt đầu phân tích lại project từ đầu nếu thông tin đã có trong handoff.
5. Không yêu cầu user giải thích lại những yêu cầu đã ghi trong handoff.
6. Giữ nguyên phương thức làm việc của phiên trước.
7. Tuân thủ chính xác USER-DEFINED WORKFLOW và WORKFLOW INVARIANTS.
8. Nếu user đã yêu cầu thứ tự `A → B → C` thì tiếp tục theo `A → B → C`. Không tự ý đổi thứ tự, skip bước, gộp bước, thay workflow khác, hoặc làm trước những bước chưa đến lượt — trừ khi có lý do kỹ thuật bắt buộc hoặc user đưa yêu cầu mới.
9. Kiểm tra mục CURRENT WORKFLOW POSITION để xác định đang đứng ở bước nào và tiếp tục từ đúng vị trí đó.
10. Không thực hiện lại những bước đã hoàn thành và verify trừ khi có bằng chứng cho thấy chúng sai.
11. Không refactor hoặc redesign những phần đã hoàn thành nếu không liên quan trực tiếp đến task hiện tại.
12. Không đảo ngược quyết định đã được user chốt.
13. Không lặp lại các phương án trong FAILED ATTEMPTS — DO NOT REPEAT.
14. Tiếp tục trực tiếp từ NEXT ACTIONS.
15. Sau mỗi bước quan trọng, thực hiện đúng validation procedure đã quy định trước khi chuyển sang bước tiếp theo.
16. Nếu workflow yêu cầu hoàn thành và xác minh từng bước trước khi tiếp tục, phải tuân thủ nguyên tắc đó.
17. Giữ nguyên cách báo cáo tiến độ, cách tổ chức công việc và cách tương tác với user nếu user đã quy định trong phiên trước.
18. Chỉ thay đổi workflow khi user trực tiếp yêu cầu, hoặc workflow hiện tại về mặt kỹ thuật không thể tiếp tục. Trường hợp thứ hai phải nêu rõ vấn đề trước khi áp dụng phương án thay thế.
