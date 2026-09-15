# SESSION HANDOFF — FBD EDIT Tasks 8 & 9 REDO (Planning Complete)

## 1. SESSION OBJECTIVE

Lập kế hoạch triển khai chi tiết (implementation plan) cho việc REDO giao diện Tasks 8 và 9 của FBD EDIT feature để **khớp chính xác** hình tham khảo `PGM-02B_FBD_editor_reference.png`. Tasks 8/9 đã merge vào main (PR #576, #580) nhưng giao diện hiện tại khác biệt đáng kể so với reference design. User yêu cầu rõ ràng: "không được khác hoặc tự suy luận lung tung".

**Kết quả mong muốn:** Plan chi tiết đến mức Opus chỉ cần đọc và triển khai trực tiếp, không cần lập plan lại hay khảo sát thêm.

**Trạng thái:** Plan đã hoàn thành. Phiên tiếp theo sẽ bắt đầu implementation theo plan.

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
- Fable chỉ tổng hợp và phân tích, delegate khảo sát codebase cho Sonnet/Haiku.

### SESSION-ESTABLISHED WORKFLOW
1. Đọc và hiểu reference design → Gap analysis ✅
2. Lập kế hoạch REDO chi tiết ✅
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
Completed:         Analysis (reference image + gap analysis) → Plan (implementation plan chi tiết)
Currently working: —
Next:              REDO Implementation → Test → Verify → Commit/PR
```

Planning phase hoàn thành. Phiên tiếp theo bắt đầu từ REDO Implementation.

## 5. WORKSPACE / ENVIRONMENT

- **Working directory:** `E:\TuanDuong\INTERN\DDC24_project` (parent), repo: `MK-DDC-24/`
- **Branch:** `main` at commit `14872059`, behind origin/main by 9 commits (cần `git pull` trước khi tạo branch mới)
- **Local branch:** `feat/fbd-edit-task8` at `194530c7` (NOT pushed, archived Stage B work)
- **Runtime:** Node.js, npm
- **Build:** Vite 8.2.0
- **Language:** TypeScript 5
- **CSS:** Tailwind CSS v4
- **Test:** Vitest 4.1.10, Playwright 1.61.1
- **OS:** Windows 11, Git Bash
- **Board lab:** 192.168.120.224:8081 — DEAD. Dùng webview skill (Playwright trace) để xem UI.
- **Demo mode:** `VITE_DDC_MODE` chỉ nhận `live` hoặc `demo`. Demo simulator không mock Programming API.
- **Untracked files:** `.claude/skills/webview/`, `apps/web-ui/playwright.headed-view.config.ts`, 2 plan/handoff docs

## 6. CURRENT VERIFIED STATE

### VERIFIED
- Branch `main` tại commit `14872059`, behind origin/main by 9 commits.
- Tasks 8/9 đã merge (PR #576, #580) — code có trên main.
- Reference image đã đọc và phân tích chi tiết bởi 3 Sonnet agents.
- Gap analysis hoàn thành — 6 component areas so sánh.
- Implementation plan hoàn thành — 15 bước chi tiết (Task 8: 7 bước, Task 9: 8 bước).
- Khảo sát codebase hoàn thành:
  - FbdEditorPane.tsx: 253 dòng, flexbox layout, POU tabs nằm ở ProgramsTab.tsx
  - DesignWorkspacePage.tsx: 994 dòng, flexbox với useViewportFillHeight
  - StructuredFbdEditor.tsx: 913 dòng, custom SVG canvas, minimap 176×104px
  - ProgrammingWorkbench.tsx: 583 dòng, bottom panel, default closed 120px
  - DesignWorkbench.tsx: 290 dòng, adapter/wrapper cho ProgrammingWorkbench
  - ProblemsDrawer.tsx: 371 dòng, dual-mode (tray/embedded)

### UNVERIFIED
- Chưa `git pull` để sync với origin/main (9 commits behind).
- Chưa kiểm tra bundle size hiện tại.
- Chưa đọc ProgramsTab.tsx (chứa POU tab bar implementation).
- tsc/lint/vitest chưa chạy trong phiên này (phiên trước pass, trừ 1 known failure ShellNavigation.test.tsx).

## 7. COMPLETED WORK

### Phân tích reference design (VERIFIED)
- 3 Sonnet agents khảo sát song song:
  1. Task 8 files: FbdEditorPane.tsx, DesignWorkspacePage.tsx + tests (11 + 44 test cases)
  2. Task 9 files: DesignWorkbench.tsx, ProgrammingWorkbench.tsx, StructuredFbdEditor.tsx, ProblemsDrawer.tsx
  3. Reference image: PGM-02B_FBD_editor_reference.png (1672×941px) → extracted specs chi tiết

### Gap analysis tổng hợp (VERIFIED)
6 khu vực gap đã xác định với chi tiết cụ thể — xem implementation plan.

### Implementation plan (VERIFIED)
- File: `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md` (580+ dòng)
- Nội dung: 10 sections, 15 implementation steps, dependency graph, risk mitigation, commit strategy, PR template, success criteria checklist (27 items)

### Webview skill (VERIFIED từ phiên trước)
- `.claude/skills/webview/SKILL.md` (132 dòng, untracked)

## 8. WORK IN PROGRESS

Không có work in progress. Planning phase hoàn thành. Phiên tiếp theo bắt đầu implementation.

## 9. IMPORTANT DECISIONS

| Quyết định | Lý do | Ai chốt |
|---|---|---|
| Giao diện phải khớp chính xác reference PNG | User yêu cầu rõ ràng | User |
| Opus chỉ điều phối, không code | Tiết kiệm token Opus | User |
| SVG-first architecture cho FBD canvas | Đã thiết kế từ task trước | User + Agent |
| Feature flag: `isFbdEditEnabled` | Kiểm soát rollout | Plan |
| FBD_MINIMAP_NODE_THRESHOLD = 24 | Task 9 spec | Plan |
| Reuse ProblemsDrawer.tsx | 348 dòng đã có, task 9 spec | Plan |
| Reference design = LIGHT mode (không phải dark) | Khảo sát reference image: canvas #FCFCFC, panels #FFFFFF, text #1E293B, accent #00796B | Sonnet agent phân tích |
| Layout: CSS Grid 4-zone (196px + flex + 342px + 162px bottom) | Khớp reference PNG measurements | Plan |
| Block domain colors: Logic #4A90E2, Control #00897B, Math #7E57C2, Timer #FFA726 | Từ reference image | Sonnet agent phân tích |
| Wire datatype colors: BOOL green, INT blue, REAL orange, TIME purple | Từ reference image | Sonnet agent phân tích |
| Fable chỉ tổng hợp, Sonnet/Haiku khảo sát | Tiết kiệm token Fable | User |

**LƯU Ý QUAN TRỌNG:** Handoff phiên trước (2026-09-08) mô tả reference design là dark mode (canvas #1A1B1E, panels #25262B). Tuy nhiên, Sonnet agent đọc reference image trực tiếp trong phiên này và kết luận design là LIGHT mode (canvas #FCFCFC, panels #FFFFFF, accent #00796B). **Ưu tiên kết quả phân tích trực tiếp của phiên này.** Opus cần verify lại bằng cách đọc reference image trước khi triển khai nếu có nghi ngờ.

## 10. RELEVANT FILES & ARTIFACTS

### Reference
- `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png` — TARGET DESIGN (1672×941px)
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — Master plan (928+ dòng). Task 8: lines 597-648. Task 9: lines 652-697.
- `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md` — Quy chuẩn tài liệu reference design (agent đã reference)

### Implementation Plan (QUAN TRỌNG — đọc trước khi triển khai)
- `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md` — Plan chi tiết 580+ dòng, 15 bước, dependency graph, risk mitigation, commit strategy, PR template

### Handoff phiên trước (THAM KHẢO — một số thông tin đã cũ)
- `docs/superpowers/plans/2026-09-08-fbd-edit-task8-9-redo-handoff.md` — Handoff gốc từ phiên trước

### Code (Task 8)
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx` — 253 dòng, Modify
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` — 994 dòng, Modify
- `apps/web-ui/src/features/programming/design/programs/ProgramsTab.tsx` — CHƯA ĐỌC, chứa POU tab bar, cần đọc trước khi sửa
- `apps/web-ui/src/shared/theme/ThemeProvider.tsx` — Read-only (FOLLOW_WEB)
- Tests: `FbdEditorPane.test.tsx` (11 tests), `DesignWorkspacePage.test.tsx` (44 tests)

### Code (Task 9)
- `apps/web-ui/src/features/programming/design/workbench/DesignWorkbench.tsx` — 290 dòng, Modify
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` — 583 dòng, Modify
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` — 913 dòng, Modify
- `apps/web-ui/src/features/programming/shared/ProblemsDrawer.tsx` — 371 dòng, Reuse (348 dòng)
- Tests: `FbdWorkbench.test.tsx` (tạo mới), `StructuredFbdEditor.test.tsx`

### Components mới cần tạo (theo plan)
- `apps/web-ui/src/features/programming/design/explorer/PouExplorerDock.tsx` — POU Explorer left dock
- `apps/web-ui/src/features/programming/design/dock/LibraryInspectorDock.tsx` — Library + Inspector right dock
- `apps/web-ui/src/features/programming/design/workbench/StatusStrip.tsx` — Bottom status strip

### FORBIDDEN FILES (TUYỆT ĐỐI KHÔNG SỬA)
- `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`
- `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`
- `apps/web-ui/package.json`, `apps/web-ui/.env.local`

### Skills
- `.claude/skills/webview/SKILL.md` — Xem giao diện qua Playwright trace

### Config
- `apps/web-ui/src/shared/config.ts` — DDC_MODE config, feature flags

## 11. CODE CHANGES

Chưa có code changes trong phiên này. Phiên này chỉ lập plan. Tasks 8/9 code hiện tại trên main là kết quả của PR #576, #580 từ phiên trước. REDO sẽ tạo branch mới từ main và sửa lại.

## 12. COMMANDS RUN

```bash
# Phiên hiện tại (planning only)
cd MK-DDC-24 && git status              # Clean, trên main, behind origin by 9 commits
git branch --show-current                # main
git log --oneline -5                     # Confirm commit 14872059
git branch -a | grep task               # Found feat/fbd-edit-task8 local

# Phiên trước (verified)
cd apps/web-ui && npx tsc --noEmit      # Pass
npm run lint                            # Pass
npx vitest --run                        # 1 known failure (ShellNavigation.test.tsx)
```

## 13. TEST / VALIDATION STATUS

| Check | Status | Ghi chú |
|---|---|---|
| tsc | ✅ Pass (phiên trước) | Cần re-verify sau git pull |
| lint | ✅ Pass (phiên trước) | Cần re-verify sau git pull |
| vitest | ⚠️ 1 failure (phiên trước) | `ShellNavigation.test.tsx` — env drift, không phải regression |
| build | CHƯA KIỂM TRA | |
| bundle size | CHƯA KIỂM TRA | Budget R3 = 165.00 KiB |
| UI visual | CHƯA KIỂM TRA | Cần dùng webview skill |
| Implementation plan | ✅ Hoàn thành | 580+ dòng, 15 bước, đầy đủ chi tiết |

## 14. ERRORS / BLOCKERS

| Error | Context | Nguyên nhân | Status |
|---|---|---|---|
| Board lab dead | 192.168.120.224:8081 unreachable | Lab offline | Workaround: webview skill |
| `build:e2e` fails Windows | Unix env-var syntax | `cmd.exe` incompatible | Workaround: build tay trong Git Bash |
| `fatal: not a git repository` | Harness cwd resets | Parent dir is cwd | Workaround: cd trước mỗi lệnh |
| ShellNavigation.test.tsx fail | vitest | Env drift | Known issue, not regression |
| Main behind origin by 9 commits | git status | Chưa pull | Cần `git pull` trước khi tạo branch |
| Reference design light vs dark discrepancy | Handoff cũ nói dark, agent mới nói light | Cần verify | Opus cần đọc image trước triển khai |

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
- **Phiên này (planning):** User yêu cầu Fable 5 lập plan, delegate khảo sát cho Sonnet/Haiku. Fable chỉ tổng hợp, không tự khảo sát codebase.
- **Reference design color discrepancy:** Handoff phiên trước (2026-09-08) mô tả dark mode palette (#1A1B1E, #25262B). Sonnet agent phiên này đọc reference image trực tiếp và kết luận LIGHT mode (#FCFCFC, #FFFFFF, #00796B). Opus cần verify lại trước triển khai.
- Plan đã lưu tại `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md`. Opus chỉ cần đọc file này và triển khai theo.

## 17. NEXT ACTIONS

Tuân thủ workflow: Analysis ✅ → Plan ✅ → **REDO Implementation** → Test → Verify → Commit/PR.

Trước khi implementation, Opus cần:
1. **`git pull origin main`** — sync 9 commits behind.
2. **Verify reference image** — đọc `PGM-02B_FBD_editor_reference.png` để confirm light vs dark mode palette.
3. **Đọc implementation plan** — `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md`.
4. **Tạo branch** — `git checkout -b feat/fbd-edit-task8-9-redo` từ main (sau pull).
5. **Bắt đầu implementation** — theo thứ tự trong plan Section 6 (Execution Order Summary):

```
Task 8 Steps:
2.1 Layout Grid Foundation
2.2 POU Explorer Dock
2.3 POU Tab Bar Re-styling
2.4 Canvas Sub-toolbar Re-styling
2.5 Library & Inspector Dock
2.6 Responsive Behavior
2.7 Task 8 Tests

Mid-point Verification

Task 9 Steps:
3.1 Bottom Workbench Re-styling
3.2 Status Strip
3.3 Block Domain Color Coding
3.4 Wire Datatype Color Coding
3.5 Minimap Resize
3.6 Auto Layout Preview
3.7 ProblemsDrawer Integration
3.8 Task 9 Tests

Final Verification → Commit → Push → PR
```

Mỗi bước: delegate cho Sonnet subagent → verify (tsc + lint + vitest) → webview check → next step.

## 18. DEFINITION OF DONE

- [ ] UI khớp chính xác reference image `PGM-02B_FBD_editor_reference.png`
- [ ] tsc pass
- [ ] lint pass (gồm `check:ui-strings`)
- [ ] vitest pass (trừ known failure ShellNavigation)
- [ ] build pass
- [ ] Bundle size ≤ 165.00 KiB gzip cho `programming-*.js`
- [ ] Responsive hoạt động đúng ở 4 breakpoints (1440+, 1024-1439, 768-1023, <768)
- [ ] Layout 4-zone grid: left 196px + center flex + right 342px + bottom 162px
- [ ] POU Explorer dock persistent với tree groups
- [ ] POU Tab Bar styled theo reference (active white bg + accent top border)
- [ ] Sub-toolbar: 36px, segmented groups, dividers
- [ ] Library & Inspector tabbed dock 342px
- [ ] Bottom panel tabs đầy đủ: Problems, Watch, Trace, Search, Cross Reference
- [ ] Status strip hiển thị node/wire/check/cycle/zoom/cursor
- [ ] Block domain color coding: logic/control/math/timer
- [ ] Wire datatype color coding: BOOL/INT/REAL/TIME/untyped/error
- [ ] Minimap 160×100px, bottom-right, threshold 24
- [ ] Auto Layout preview → Apply/Cancel hoạt động
- [ ] Không phá behavior cũ
- [ ] Commits + PR bằng tiếng Việt có dấu
- [ ] Không sửa forbidden files
- [ ] Không làm yếu test assertions

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
19. **ĐỌC IMPLEMENTATION PLAN TRƯỚC:** File `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md` chứa toàn bộ kế hoạch triển khai chi tiết. Đọc plan này trước khi bắt đầu bất kỳ implementation nào.
20. **VERIFY REFERENCE IMAGE:** Đọc `PGM-02B_FBD_editor_reference.png` để confirm palette (light vs dark). Nếu khác với plan, điều chỉnh colors nhưng giữ nguyên layout/structure.
