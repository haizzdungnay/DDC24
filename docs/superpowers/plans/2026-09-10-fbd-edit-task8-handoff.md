# SESSION HANDOFF — FBD Editor Task 8: Layout & Controls

## 1. SESSION OBJECTIVE

Triển khai Task 8 (FBD Editor Layout & Controls) cho MK-DDC-24, khớp ảnh tham chiếu `PGM-02B_FBD_editor_reference.png`. Ba phần:

- **Part 1**: POU Explorer cố định 244px — ✅ HOÀN THÀNH, đã commit `1d870e26`
- **Part 2**: Inspector 341px — ✅ HOÀN THÀNH (verify + 3 test mới, chưa commit)
- **Part 3**: Library category tabs — ✅ HOÀN THÀNH (verify + 3 test mới, chưa commit)

Mục tiêu cuối: commit Part 2+3, push, cập nhật PR #600.

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Cấm sửa file
`ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`, `apps/web-ui/package.json`, `apps/web-ui/.env.local`

### Cấm làm yếu assertion
Không delete/comment-out test, không `.skip`/`.only`/`.todo`, không nới matcher.

### Cấm git write từ subagent
add/commit/push/gh/stash/checkout/restore/reset/clean

### Quy tắc git
- Không `git add -A` / `git add .` — stage explicit paths
- Không `git reset --hard`, `git checkout -- <file>`, `git clean -fd`
- CHANGELOG.md thay đổi phải purely additive (0 deleted lines)

### Quy tắc khác
- Tối đa 3 subagent đồng thời
- Commits, PRs, docs, comments, UI strings phải là tiếng Việt có dấu đúng
- **Opus chỉ điều phối và lên plan — delegate ALL code execution and verification to Sonnet/Haiku subagents**

### Kỹ thuật
- React 18 + TypeScript 5 + Vite 8.2.0 + Tailwind CSS v4
- Vitest 4.1.10 (jsdom) + Playwright 1.61.1
- Design tokens: `var(--c-*)` CSS variables (light/dark theme)
- Tailwind static class scanning — grid-template classes phải literal strings
- WCAG 2.5.5 touch-target sizing (44px `min-h-11`) scoped by media query
- Bundle budget R3 = 165.00 KiB gzip cho `programming-*.js`
- `InspectorField<T>` pattern: `{ known: true; value: T } | { known: false }`
- FBD ≥1440px 4-column layout: `min-[1440px]:grid-cols-[244px_minmax(0,1fr)_223px_341px]`

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW
1. Opus phân tích yêu cầu, đọc reference image + code hiện tại
2. Opus lên plan cho từng Part
3. Delegate implementation/verification sang Sonnet/Haiku subagent
4. Subagent viết test trước (TDD), implement, chạy test
5. Opus review kết quả, quyết định commit
6. Commit + push do Opus trực tiếp (không qua subagent)

### SESSION-ESTABLISHED WORKFLOW
- Mỗi Part: verify hiện trạng → xác định gap → delegate TDD subagent → review kết quả
- Subagent prompt phải có: scope chính xác, file paths, expected output, stop condition, edit permission, constraints

### WORKFLOW INVARIANTS
- Opus KHÔNG trực tiếp edit code
- Subagent KHÔNG chạy git commands
- Mỗi thay đổi phải verify bằng test trước khi chuyển Part tiếp theo
- Không refactor ngoài phạm vi task

## 4. CURRENT WORKFLOW POSITION

```
Workflow:          Part 1 → Part 2 → Part 3 → Commit → Push → Update PR
Completed:         Part 1 → Part 2 → Part 3
Currently working: Commit (Part 2 + Part 3 test changes)
Next:              Push → Update PR #600
```

## 5. WORKSPACE / ENVIRONMENT

- Working directory: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- Branch: `feat/fbd-edit-task8-redo`
- Local ahead of origin by 1 commit (`1d870e26` — Part 1)
- Runtime: Node.js, pnpm
- Framework: React 18 + Vite 8.2.0
- Test: Vitest 4.1.10 (jsdom), Playwright 1.61.1
- PR #600 tồn tại trên GitHub

## 6. CURRENT VERIFIED STATE

### VERIFIED
- **Part 1 POU Explorer 244px**: Committed `1d870e26`, pushed trước đó (UNVERIFIED nếu đã push — cần check)
- **Part 2 Inspector 341px**: 
  - Grid FBD ≥1440px = `244px | 1fr | 223px | 341px` ở `ProgramsTab.tsx` dòng 706
  - Cột 4 = `<aside>` chứa `ContextInspector` (dòng 1080-1083)
  - `ContextInspector.tsx` (402 dòng): đầy đủ 5 context types (EMPTY, PROGRAM, VARIABLE, ST_SYMBOL, FBD_BLOCK, FBD_CONNECTION), design tokens
  - `inspectorContext.ts` (522 dòng): full type system + `inspectorContextFor()` + `inspectorHasUsefulContext()`
  - Tests: 48/48 pass (45 cũ + 3 mới) trong `src/features/programming/design/inspector/`
- **Part 3 Library category tabs**:
  - `QuickLibraryPanel.tsx` dòng 205-210: CategoryChip render dynamic categories từ `catalogCategories(entries)`
  - `catalogCategories()` trả unique sorted non-null categories
  - `CategoryChip` component có `aria-pressed`, design tokens
  - "Tất cả" chip luôn đầu tiên, "Xem thêm khối…" link khi có projectId
  - Docked variant mount đúng ở cột 3 (223px) khi FBD ≥1440px
  - Tests: 42/42 pass (39 cũ + 3 mới) trong `src/features/programming/design/library/`

### UNVERIFIED
- Chưa xác nhận commit `1d870e26` đã push lên origin hay chưa (git log origin chỉ thấy tới `2a51b437`)
- Chưa chạy full test suite sau khi thêm 6 test mới

## 7. COMPLETED WORK

### Part 1: POU Explorer 244px (commit `1d870e26`)
- POU Explorer cố định 244px tại ≥1440px
- Badge đếm số POU
- Collapse độc lập
- 15/15 tests pass (`PouExplorer.test.tsx`)
- Committed và (có thể) pushed

### Part 2: Inspector 341px (chưa commit)
- Verify Inspector đã đầy đủ trong code hiện tại
- 3 test mới thêm vào `ContextInspector.test.tsx`:
  - `TC-INSP-341`: render đúng `data-testid="context-inspector"` + `aria-label="Thuộc tính"`
  - `TC-INSP-COLLAPSE`: thu gọn khi thiếu context, hiện `data-testid="inspector-collapsed"`
  - `TC-INSP-FBD-BLOCK`: FBD_BLOCK context hiển thị instance ID (`node-ton-1`), type (`TON`), ports
- 48/48 tests pass

### Part 3: Library category tabs (chưa commit)
- Verify category tabs đã hoạt động đúng trong `QuickLibraryPanel.tsx`
- 3 test mới:
  - `TC-LIB-CATS` trong `libraryCatalog.test.ts`: `catalogCategories` trả unique sorted non-null
  - `TC-LIB-FILTER-CAT` trong `libraryCatalog.test.ts`: `filterCatalog` lọc đúng category
  - `TC-LIB-CHIP-ALL` trong `QuickLibraryPanel.test.tsx`: chip "Tất cả" đầu tiên, `aria-pressed="true"` mặc định
- 42/42 tests pass

## 8. WORK IN PROGRESS

3 file test đã sửa, chưa commit:
- `apps/web-ui/src/features/programming/design/inspector/ContextInspector.test.tsx` (+63 lines)
- `apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.test.tsx` (+40 lines)
- `apps/web-ui/src/features/programming/design/library/libraryCatalog.test.ts` (+33 lines)

Tổng: 3 files, 136 insertions, 0 deletions.

## 9. IMPORTANT DECISIONS

1. **Không gộp Library+Inspector thành tabbed dock**: Plan BƯỚC 5 muốn gộp thành 1 cột 342px, nhưng code hiện tại đã tách thành 2 cột riêng (223px + 341px) hoạt động đúng. Gộp lại = regression (mất khả năng xem cả hai cùng lúc). Quyết định: giữ nguyên 2 cột.

2. **Categories là động, không hardcode**: Plan liệt kê Standard/MK-DDC/Communication/... nhưng thực tế categories đến từ backend qua `catalogCategories(entries)`. Code hiện tại đã xử lý đúng.

3. **Part 2 và Part 3 thực chất đã hoàn thành trong code**: Chỉ cần verify + bổ sung test coverage. Không cần code implementation mới.

## 10. RELEVANT FILES & ARTIFACTS

### Layout & Grid
- `apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx` — 3000+ dòng, grid layout chính, mount QuickLibraryHost + Inspector
- `apps/web-ui/src/features/programming/design/editor/PouTabBar.tsx` — 158 dòng, tab bar POU

### Inspector
- `apps/web-ui/src/features/programming/design/inspector/ContextInspector.tsx` — 402 dòng, 5 context types
- `apps/web-ui/src/features/programming/design/inspector/inspectorContext.ts` — 522 dòng, type system + logic
- `apps/web-ui/src/features/programming/design/inspector/ContextInspector.test.tsx` — test file (MODIFIED)
- `apps/web-ui/src/features/programming/design/inspector/inspectorContext.test.ts` — logic test

### Library
- `apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.tsx` — 577 dòng, panel + category chips
- `apps/web-ui/src/features/programming/design/library/libraryCatalog.ts` — 153 dòng, catalog logic
- `apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.test.tsx` — test file (MODIFIED)
- `apps/web-ui/src/features/programming/design/library/libraryCatalog.test.ts` — test file (MODIFIED)

### Reference
- `right_columns_crop.png` — crop ảnh tham chiếu cột phải
- `tab_bar_crop.png` — crop ảnh tab bar
- `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md` — plan gốc

## 11. CODE CHANGES

Chỉ có test files thay đổi (136 insertions, 0 deletions):

| File | Thay đổi | Lý do |
|------|----------|-------|
| `ContextInspector.test.tsx` | +63 lines (3 test mới) | Verify Inspector render, collapse, FBD_BLOCK context |
| `QuickLibraryPanel.test.tsx` | +40 lines (1 test mới) | Verify category chip "Tất cả" default + toggle |
| `libraryCatalog.test.ts` | +33 lines (2 test mới) | Verify catalogCategories unique/sorted/no-null + filterCatalog |

## 12. COMMANDS RUN

```bash
# Verify Part 2
cd apps/web-ui && npx vitest --run src/features/programming/design/inspector/
# → 2 files, 48/48 pass

# Verify Part 3
cd apps/web-ui && npx vitest --run src/features/programming/design/library/
# → 3 files, 42/42 pass

# Check workspace
git status --short
git diff --stat
```

## 13. TEST / VALIDATION STATUS

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| Inspector (unit + component) | 2 | 48/48 | ✅ PASS |
| Library (catalog + panel + iec) | 3 | 42/42 | ✅ PASS |
| POU Explorer | 1 | 15/15 | ✅ PASS (Part 1) |
| POU Tab Bar | 1 | 8/8 | ✅ PASS (trước đó) |

Full test suite chưa chạy lại sau 6 test mới.

## 14. ERRORS / BLOCKERS

Không có blocker. Lỗi tsc và eslint pre-existing ở FBD feature đang dở dang (`FbdCanvas.tsx`, `FbdCanvasLayers.tsx`, `commands.ts`) — không liên quan tới Task 8.

## 15. FAILED ATTEMPTS — DO NOT REPEAT

1. **DO NOT REPEAT**: Opus trực tiếp edit code → user đã correct: opus chỉ orchestrate.
2. **DO NOT REPEAT**: Workflow agent đọc file từ worktree thay vì main tree → path confusion.
3. **DO NOT REPEAT**: Workflow agent đổi QuickLibraryHost variant sang "popover" → sai, phải giữ "docked" cho FBD ≥1440px.
4. **DO NOT REPEAT**: Gộp Library+Inspector thành tabbed dock → regression, giữ 2 cột riêng.

## 16. IMPORTANT CONVERSATION CONTEXT

- Task 8 là phần layout & controls của FBD editor, focus vào khớp ảnh tham chiếu PGM-02B
- Cả 3 phần (POU Explorer, Inspector, Library tabs) thực chất đã có code hoạt động — công việc chính là verify + bổ sung test coverage
- PR #600 đã tồn tại, cần update sau khi commit+push
- User dùng workflow: Opus orchestrate → Sonnet/Haiku subagent execute
- Commit `1d870e26` đã tạo cho Part 1, local ahead of origin 1 commit

## 17. NEXT ACTIONS

1. **Commit** 3 file test đã sửa (Part 2 + Part 3):
   ```bash
   git add apps/web-ui/src/features/programming/design/inspector/ContextInspector.test.tsx \
           apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.test.tsx \
           apps/web-ui/src/features/programming/design/library/libraryCatalog.test.ts
   git commit -m "test(programming): bổ sung 6 test cho Inspector 341px và Library category tabs"
   ```

2. **Push** branch lên origin:
   ```bash
   git push origin feat/fbd-edit-task8-redo
   ```

3. **Cập nhật PR #600** summary nếu cần.

4. **Chạy full test suite** (tuỳ chọn) để verify không regression:
   ```bash
   cd apps/web-ui && npx vitest --run
   ```

## 18. DEFINITION OF DONE

- [x] Part 1: POU Explorer 244px — committed
- [x] Part 2: Inspector 341px — verified, 48/48 tests pass
- [x] Part 3: Library category tabs — verified, 42/42 tests pass
- [ ] 6 test mới committed
- [ ] Branch pushed lên origin
- [ ] PR #600 updated
- [ ] Full test suite pass (no regression)

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
