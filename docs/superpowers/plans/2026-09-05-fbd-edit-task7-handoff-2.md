# SESSION HANDOFF — FBD EDIT Task 7 continuation + BLK-2 debt resolution

---

## 1. SESSION OBJECTIVE

Tiếp tục phiên FBD EDIT Task 7 đã hoàn thành pha 1-6 (Khảo sát → Lên plan → Check plan → Thực thi → Báo cáo → Check báo cáo). Owner đã chốt quyết định `UD-PROG-017` lựa chọn A về mốc ngân sách bundle R1 125 KiB. Phiên này thực hiện:

1. Ghi quyết định `UD-PROG-017` vào hồ sơ `PROGRAMMING_OPEN_DECISIONS.md` (nâng 1.7 → 1.8, đính chính lịch sử).
2. Sửa spec `2026-08-31-fbd-edit-design.md` gỡ tham chiếu cổng cũ, đóng `BLK-FBD-003`.
3. Sửa 2 plan file ghi disposition đóng cho tham chiếu cũ.
4. Xử lý nợ kỹ thuật BLK-2: tách `FbdCanvas.tsx` (846 dòng) và `commands.ts` (844 dòng) về dưới trần 800 dòng.
5. Cập nhật `CHANGELOG.md` phản ánh toàn bộ thay đổi.

Mục tiêu cuối: Task 7 đạt Definition of Done (8 điều kiện), sẵn sàng commit khi user yêu cầu.

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Yêu cầu chức năng (Task 7 — đã hoàn thành trước phiên này)
- Form sửa node FBD dời từ canvas sang dock Inspector bên phải qua slot `editableFbdSlot`.
- I/O picker cho node `INPUT`/`OUTPUT` tái dùng `InsertPointVariablePanel` với variant `'embedded'`.
- Node canvas hiển thị kiểu/đơn vị port và tóm tắt parameter, cắt ngắn chống tràn khung 168px.
- `fbdIssueTargets` nâng lên `useMemo` tránh tính lại mỗi render.
- Chọn port mở form sửa node cha trong dock.

### Ràng buộc cứng về quyết định ngân sách bundle
Owner chốt **lựa chọn A** (`UD-PROG-017` ngày 2026-09-05):
- R1 125 KiB = **mốc lịch sử** của increment đã đóng.
- **Cổng thi hành duy nhất: R3 165 KiB** (`apps/web-ui/package.json:28` pin `--increment r3`).
- Mốc cảnh báo mềm 145 KiB (quy ước tài liệu, **không** cài vào script).
- **KHÔNG được** hạ chuẩn, sửa `scripts/verify_programming_bundle_budget.py` hay `contracts/programming/pgm02_workspace_v1.json` (ngoài allowlist FE).

### Ràng buộc kỹ thuật Task 7
- `BLK-FBD-001`: **không** tự sinh `variableId`; **không** tạo Mapping/Binding ẩn; `node.parameters` chỉ chứa `variable`.
- Giữ nguyên `ProgrammingHeader.tsx` và `ProgrammingLayout.tsx` — **TUYỆT ĐỐI KHÔNG đụng**.
- Phạm vi FE: chỉ sửa `apps/web-ui/src/features/programming/**`.
- Không sửa `contracts/`, `scripts/`, `apps/web-ui/package.json`, `apps/core/**`, `apps/web-api/**`, `firmware/**`.
- Không nới `FBD_NODE_WIDTH`.
- Không đổi `executionOrder`, thứ tự port, schema FBD v1.

### Ràng buộc nợ kỹ thuật BLK-2
- Trần 800 dòng = quy ước `coding-style` (rule ECC), không có lint gate.
- Tách file phải giữ nguyên **toàn bộ hành vi runtime** và bề mặt export.
- Test không được giảm số lượng; tsc/lint/build phải PASS.

### Git workflow
- **Không push, không tạo PR, không merge** trừ khi user yêu cầu.
- Commit chỉ khi user nói "commit".
- Nghiêm cấm `git add -A`, `git add .`, `git add -p` — chỉ stage file cụ thể theo allowlist.
- Cấm `git reset`, `git checkout --`, `git clean`, hoặc lệnh xoá rộng.
- Conventional Commits, thân bài tiếng Việt, tách commit theo nhóm logic.

### CHANGELOG
- Format Keep a Changelog.
- Entry đã xuất bản = immutable.
- Mọi thay đổi code/config/deployment/docs phải cập nhật `CHANGELOG.md` trong cùng phiên.

### Ngôn ngữ
- Toàn bộ tài liệu, changelog, commit message, PR — tiếng Việt.

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW — Quy trình 7 pha Owner quy định

Task 7 tuân thủ quy trình 7 pha do Owner quy định trong handoff trước:

1. **Khảo sát** — đọc tài liệu, code, xác minh trạng thái.
2. **Lên plan** — lập kế hoạch chi tiết.
3. **Check plan** — user duyệt plan.
4. **Thực thi** — làm theo plan.
5. **Báo cáo** — ghi lại kết quả.
6. **Check báo cáo** — user duyệt báo cáo.
7. **Xuất lại báo cáo** — hoàn thiện tài liệu cuối.

**Phiên trước** đã hoàn thành pha 1-6. **Phiên này** thực hiện:
- Owner chọn lựa chọn A cho `UD-PROG-017` → ghi vào hồ sơ (pha 4 tiếp tục).
- Xử lý BLK-2 (nợ kỹ thuật) → pha 4 tiếp tục.
- Pha 7 "Xuất lại báo cáo" = cập nhật `CHANGELOG.md` phản ánh toàn bộ kết quả.

### SESSION-ESTABLISHED WORKFLOW

**Khi gặp decision point:**
1. Khảo sát đầy đủ (đọc file, đo số thật, tìm precedent).
2. Nêu rõ các lựa chọn A/B/C với hệ quả từng lựa chọn.
3. Nêu khuyến nghị.
4. **Chờ user chốt** — không tự quyết.

**Khi xử lý refactor:**
1. Khảo sát cấu trúc file → giao subagent song song nếu 2+ file độc lập.
2. Lập plan tách: ranh giới, import/export, test không gãy.
3. Giao subagent thực thi với checklist kiểm chứng bắt buộc (tsc, vitest, lint, build, `wc -l`).
4. Kiểm chứng độc lập báo cáo của subagent — **không tin mù quáng**.
5. Chỉ báo xong khi toàn bộ verify PASS.

**Khi user nói "tiếp đi":** tiếp tục đúng item tiếp theo trong plan/DoD đã nêu, không hỏi lại.

**Khi user nói "commit":** chạy trọn quy trình commit đầy đủ (verify → changelog → commit tách nhóm → push → PR → merge → xoá nhánh → báo link), không hỏi từng bước.

### WORKFLOW INVARIANTS

1. **Opus chỉ điều phối + lên plan + kiểm chứng**; mọi execution phải giao subagent.
2. Đọc file trước khi sửa; match style/convention của project.
3. Không refactor ngoài phạm vi task.
4. Mỗi thay đổi phải verify (test/tsc/lint/build) trước khi báo xong.
5. Số đo phải đo lại thật, không dẫn số cũ.
6. Không đảo ngược quyết định user đã chốt.
7. Không lặp lại FAILED ATTEMPTS.
8. Giữ thay đổi FE cục bộ làm nguồn chân lý; không ghi đè công việc FE không liên quan.

---

## 4. CURRENT WORKFLOW POSITION

```
Workflow pha 7:  Khảo sát → Lên plan → Check plan → Thực thi → Báo cáo → Check báo cáo → Xuất lại báo cáo
Completed:       Khảo sát → Lên plan → Check plan → Thực thi (Task 6/7 code + UD-PROG-017 docs + BLK-2 tách file) → Báo cáo → Check báo cáo
Currently:       ★ Hoàn tất pha 7 "Xuất lại báo cáo" (đã cập nhật CHANGELOG dòng 52)
Next:            Chờ user yêu cầu commit
```

**Chi tiết pha Thực thi (đã xong):**
- ✓ Ghi `UD-PROG-017` lựa chọn A vào `PROGRAMMING_OPEN_DECISIONS.md` 1.8 (88 dòng mới).
- ✓ Sửa spec `2026-08-31-fbd-edit-design.md` (6 vị trí) + 2 plan file (7 vị trí).
- ✓ Tách `commands.ts` → `announcements.ts` (73) + `keyboard.ts` (56), còn 721 dòng.
- ✓ Tách `FbdCanvas.tsx` → `useFbdNodeDrag.ts` (148), còn 753 dòng.
- ✓ Sửa `useFbdNodeDrag.ts` wrap `cancelDrag` trong `useCallback` tránh listener chạy lại mỗi render.
- ✓ Cập nhật `CHANGELOG.md` dòng 52 ghi kết quả BLK-2.

**Toàn bộ 8 DoD item đã đạt.**

---

## 5. WORKSPACE / ENVIRONMENT

- **Working directory:** `e:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Project:** MK-DDC-24 (monorepo DDC/IoT Gateway/SCADA)
- **Git:** không phải git repo tại thư mục làm việc; repo thật nằm trong `MK-DDC-24/` con.
- **Branch:** không xác minh (các lệnh git phải `cd MK-DDC-24` trước).
- **Runtime:** Node.js + pnpm, React 18.3.1, TypeScript, Vite/Rolldown.
- **Package manager:** npm (apps/web-ui dùng `npm`).
- **Framework FE:** React 18.3.1, Tailwind v4, Vitest (unit), Playwright (E2E, chưa chạy Task 7).
- **OS:** Windows 11 Home 10.0.26200.
- **Shell:** bash (Git Bash).
- **Quy ước đo gzip:** zlib level 6, 1 KiB = 1024 byte.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED

**Trạng thái code Task 7 (trước BLK-2):**
- `StructuredFbdEditor.tsx`: 823 → 697 dòng (Task 7 trước đó).
- `FbdNodeInspector.tsx`: 320 dòng mới.
- `nodeEditor.ts`: 16 dòng mới.
- Node canvas hiển thị kiểu/đơn vị, cắt ngắn bằng `nodeLabel.ts`.
- Test Task 6/7: 219 file, 2646 test PASS (Task 6 nền: 214 file, 2604 test).

**Trạng thái tài liệu `UD-PROG-017` (phiên này):**
- `PROGRAMMING_OPEN_DECISIONS.md`:
  - Phiên bản 1.7 → 1.8.
  - Dòng 7 status: R1/R2/R3 đều CLOSED (74/74 tasks), 2 quyết định ĐANG MỞ là `UD-PROG-015` và `UD-PROG-016`, `UD-PROG-017` CLOSED 2026-09-05.
  - Mục 1.6 mới (72 dòng): `UD-PROG-017` lựa chọn A, bảng evidence, 4 precedent Plan 59, 3 lựa chọn A/B/C, mốc 145 KiB, điều khoản "Không được suy ra".
  - Bảng §4 Lịch sử: 11 dòng giảm dần (1.8 → 0.1..0.9), bổ sung dòng 1.7, giữ 2 dòng 1.5 với ghi chú.
- `2026-08-31-fbd-edit-design.md`:
  - Dòng 15, 83-85, 109 (NFR cell), 368-372 (blockquote sau §5.4 heading), 845 (`BLK-FBD-003` CLOSED), 896 (gỡ khỏi residual).
  - **Giữ nguyên** dòng 381-382 (§5.4 item 5 criteria spike `@xyflow/react` không thực hiện).
- `2026-08-31-fbd-edit.md`: dòng 52, 137, 181, 241 — ghi disposition, giữ câu gốc.
- `2026-09-03-fbd-edit-patch-report.md`: dòng 41, 73, 102 — cùng pattern.

**Trạng thái BLK-2 (phiên này):**
- `commands.ts`: 844 → 721 dòng.
  - Tách `announcements.ts` (73 dòng): `FbdAnnouncement` interface + `translateFbdAnnouncement` function.
  - Tách `keyboard.ts` (56 dòng): `FbdKeyboardCommand` type, `FBD_KEYBOARD_REGISTRY`, `FBD_HISTORY_LIMIT`, `normalizeFbdShortcut`, `resolveFbdKeyboardCommand`.
  - Re-export đủ 8 symbol để 17 file import không gãy.
- `FbdCanvas.tsx`: 846 → 753 dòng.
  - Tách `useFbdNodeDrag.ts` (148 dòng): `DragState` interface + custom hook `useFbdNodeDrag` với 4 handler (`beginDrag`, `moveDrag`, `endDrag`, `cancelDrag`).
  - `cancelDrag` wrap trong `useCallback` để `useEffect` Escape (dòng 212) không chạy lại mỗi render.
  - Giữ nguyên 4 export: `LIBRARY_DRAG_TYPE`, `buildPaletteNode`, `FbdCanvasProps`, `FbdCanvas`.

**Verify toàn diện sau BLK-2:**
- `npx tsc --noEmit`: exit 0, không có lỗi.
- `npx vitest --run --environment jsdom src`: 219 file, 2646 test PASS.
- `npm run lint`: PASS, `check:ui-strings` OK.
- `npm run build`: PASS (bao gồm `check:programming-contracts` và `check:bundle-budget --increment r3`).
  - Chunk `programming-B3aoz5av.js`: **128.69 KiB gzip** (131.774 byte).
  - Ngân sách R3: 165.00 KiB.
  - Dư địa: **36.31 KiB**.

**Git status:**
- 20 file modified (tất cả trong `apps/web-ui/src/features/programming/**` và `CHANGELOG.md`).
- 18 file untracked (test mới Task 6/7, 3 file tách BLK-2, `.claude/worktrees/`).
- **Không đụng:** `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`.
- **Không đụng:** `contracts/`, `scripts/`, `apps/web-ui/package.json`.

**CHANGELOG.md dòng 52:**
```markdown
- ~~Nợ kỹ thuật còn tồn từ trước Task 7: `fbd/FbdCanvas.tsx` **846 dòng** và `fbd/commands.ts` **844 dòng** vẫn vượt trần 800 dòng; cần tách file ở task sau.~~ → **ĐÃ XỬ LÝ 2026-09-05:** tách `useFbdNodeDrag.ts` (148 dòng) và `announcements.ts` (73 dòng) + `keyboard.ts` (56 dòng); `FbdCanvas.tsx` giảm 846 → **753 dòng**, `commands.ts` giảm 844 → **721 dòng**. Chunk `programming` đo lại **128.69 KiB gzip** (R3 165 KiB ⇒ PASS, dư 36.31 KiB). Test 2646/2646 PASS; tsc, lint, build đều PASS.
```

### UNVERIFIED

- Chunk tăng 0.15 KiB (128.54 → 128.69) có thể do hash thay đổi khi tách file, không phải code thêm.
- Contract `pgm02_workspace_v1.json` SHA-256 không khớp pin `AUTH-PROG-2026-08-24-05` — đã báo trong phiên trước, nằm ngoài phạm vi FE, chưa xử lý.

---

## 7. COMPLETED WORK

### 1. Ghi quyết định `UD-PROG-017` (pha 4 tiếp tục — docs)

**File:** `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md`
**Thay đổi:**
- Nâng phiên bản 1.7 → 1.8 (dòng 6).
- Sửa dòng 7 status: 2 quyết định ĐANG MỞ là `UD-PROG-015`/`UD-PROG-016` (không phải `UD-PROG-014`), `UD-PROG-017` CLOSED.
- Dòng 8: ngày 2026-09-05.
- Dòng 59: thêm dòng `UD-PROG-017` vào bảng §1.
- Dòng 232-303: mục chi tiết 1.6 (`UD-PROG-017`) với bảng thuộc tính, bảng evidence đo gzip, bảng enforcement gate, 4 precedent Plan 59, 3 lựa chọn A/B/C, mốc 145 KiB, điều khoản "Không được suy ra".
- Dòng 397-409: bảng §4 Lịch sử 11 dòng giảm dần, bổ sung dòng 1.7, giữ 2 dòng 1.5 với ghi chú lý do.

**Verify:** đọc lại file, khớp plan.

### 2. Sửa spec gỡ tham chiếu cổng cũ (pha 4 tiếp tục — docs)

**File:** `docs/superpowers/specs/2026-08-31-fbd-edit-design.md`
**Thay đổi:**
- Dòng 15: gate row "R3 165 KiB gzip", R1 mốc lịch sử, 145 KiB mốc mềm.
- Dòng 83-85: NFR bullet retarget R3.
- Dòng 109: NFR cell thêm "**Cập nhật 2026-09-05 (`UD-PROG-017` CLOSED):** cổng thi hành là R3 165 KiB…".
- Dòng 368-372: blockquote note sau heading §5.4, giải thích 125 KiB trong item 5 là criteria spike không thực hiện.
- Dòng 845: `BLK-FBD-003` → CLOSED 2026-09-05.
- Dòng 896: gỡ `BLK-FBD-003` khỏi danh sách residual.

**Verify:** đọc lại file, khớp plan. Dòng 381-382 (§5.4 item 5) giữ nguyên đúng yêu cầu.

### 3. Sửa 2 plan file ghi disposition (pha 4 tiếp tục — docs)

**File:** `docs/superpowers/plans/2026-08-31-fbd-edit.md`
**Thay đổi:** dòng 52, 137, 181, 241 — giữ nguyên câu gốc, append disposition đóng.

**File:** `docs/superpowers/plans/2026-09-03-fbd-edit-patch-report.md`
**Thay đổi:** dòng 41, 73, 102 — cùng pattern.

**Verify:** đọc lại file, khớp plan.

### 4. Tách `commands.ts` (pha 4 tiếp tục — BLK-2)

**Phương pháp:** dời nguyên văn 2 khối độc lập ra file mới, re-export giữ bề mặt API.

**File mới:**
- `apps/web-ui/src/features/programming/fbd/announcements.ts` (73 dòng):
  - Comment BUG-012 + `export interface FbdAnnouncement`.
  - Comment + `export function translateFbdAnnouncement`.
- `apps/web-ui/src/features/programming/fbd/keyboard.ts` (56 dòng):
  - Import JSON registry.
  - `export type FbdKeyboardCommand`, 2 interface nội bộ, 2 export const, `export interface FbdKeyboardEventLike`, 2 export function.

**File sửa:**
- `apps/web-ui/src/features/programming/fbd/commands.ts` (844 → 721 dòng):
  - Xoá 2 khối đã dời.
  - Import `FbdAnnouncement` (dùng trong `FbdEditorState`), `FBD_HISTORY_LIMIT` (dùng trong reducer).
  - Re-export đủ 8 symbol: `translateFbdAnnouncement`, `type FbdAnnouncement`, `normalizeFbdShortcut`, `resolveFbdKeyboardCommand`, `FBD_KEYBOARD_REGISTRY`, `FBD_HISTORY_LIMIT`, `type FbdKeyboardCommand`, `type FbdKeyboardEventLike`.

**Verify:**
- 17 file import từ `./commands` không gãy.
- Test 258 test fbd PASS.
- `wc -l`: 721 < 800.

### 5. Tách `FbdCanvas.tsx` (pha 4 tiếp tục — BLK-2)

**Phương pháp:** dời cụm "kéo di chuyển node" ra custom hook.

**File mới:**
- `apps/web-ui/src/features/programming/fbd/useFbdNodeDrag.ts` (148 dòng):
  - `export interface DragState`.
  - `export function useFbdNodeDrag({ canEdit, viewport, snapEnabled, snapSize, geometry, selection, selectionRevision, networkId, dispatch })`.
  - 4 hàm handler (`beginDrag`, `moveDrag`, `endDrag` là function declaration; `cancelDrag` là `useCallback(() => setDrag(null), [])`).
  - Return `{ drag, beginDrag, moveDrag, endDrag, cancelDrag }`.

**File sửa:**
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` (846 → 753 dòng):
  - Xoá `DragState`, xoá state `drag`, xoá 4 hàm.
  - Gọi hook dòng 163, truyền đủ tham số.
  - `useEffect` Escape dòng 212: deps `[pendingPlacement, onCancelPlacement, cancelDrag]` — `cancelDrag` ổn định nhờ `useCallback`.
  - JSX dòng 689 `tempPositions={drag?.currentPositions ?? null}` và props `beginDrag`/`moveDrag`/`endDrag`/`cancelDrag` giữ nguyên.
  - Giữ nguyên 4 export.

**Lý do wrap `cancelDrag` trong `useCallback`:**
Bản gốc dùng `setDrag` (ổn định) trong deps của `useEffect` Escape → effect chỉ chạy khi `pendingPlacement` đổi. Sau tách, `cancelDrag` là function declaration → tham chiếu mới mỗi render → listener `keydown` gỡ/gắn lại mỗi render (hồi quy). Wrap `useCallback` với deps `[]` (an toàn vì thân chỉ gọi `setDrag(null)`, setter ổn định) → `cancelDrag` ổn định → effect chỉ chạy khi `pendingPlacement`/`onCancelPlacement` đổi → đúng hành vi gốc.

**Verify:**
- `npx tsc --noEmit`: exit 0.
- `npx vitest --run --environment jsdom src`: 2646 test PASS.
- Test `FbdCanvas.interaction.test.tsx` (14 test, gồm kéo node và phím Escape) PASS.
- `wc -l`: 753 < 800.

### 6. Cập nhật CHANGELOG (pha 7 "Xuất lại báo cáo")

**File:** `CHANGELOG.md`
**Thay đổi:** dòng 52 gạch ngang nợ kỹ thuật cũ, ghi kết quả BLK-2 + số đo thật.

**Verify:** đọc lại file.

---

## 8. WORK IN PROGRESS

Không có. Toàn bộ DoD đã hoàn thành.

---

## 9. IMPORTANT DECISIONS

### Quyết định 1: Owner chọn lựa chọn A cho `UD-PROG-017`
**Khi:** 2026-09-05, user nói "lựa chọn A ,".
**Nội dung:** R1 125 KiB là mốc lịch sử; cổng thi hành duy nhất là R3 165 KiB; mốc cảnh báo mềm 145 KiB (quy ước tài liệu, không cài vào script).
**Lý do:** Plan 59 R1/R2/R3 đều ĐÓNG, `package.json:28` pin `--increment r3`, 4 task R3 liên tiếp vượt 125 KiB đều hợp lệ → R1 không phải cổng đang thi hành.
**Alternative loại bỏ:** B (mở task cắt byte đến 2026-09-10, rủi ro cao) và C (sửa script/contract ngoài allowlist FE).
**Nguồn:** Owner.

### Quyết định 2: Phương pháp tách `commands.ts`
**Khi:** phiên này, Opus lập plan.
**Nội dung:** tách 2 khối độc lập (`announcements` 72 dòng, `keyboard` 52 dòng), re-export giữ bề mặt API.
**Lý do:** hai khối không chia sẻ state với reducer core, có ranh giới rõ ràng, 17 file import không gãy nhờ re-export.
**Alternative:** tách validator/wiring (127 dòng) hoặc layout/multi-move (106 dòng) — khả thi nhưng phức tạp hơn, không cần vì 2 khối đơn giản đủ đạt < 800.
**Nguồn:** Opus.

### Quyết định 3: Phương pháp tách `FbdCanvas.tsx`
**Khi:** phiên này, Opus lập plan.
**Nội dung:** tách cụm "kéo di chuyển node" (~100 dòng) ra custom hook `useFbdNodeDrag`.
**Lý do:** cụm này có ranh giới sạch (state `drag` + 4 handler), không đan xen với Pan/Marquee/WireDrag/Placement; các cụm khác bị vướng (Marquee đan xen trong 4 hàm `handleBgPointer*`, Wire có window listener phức tạp).
**Alternative:** tách Viewport (180 dòng) hoặc Wire (140 dòng) — khả thi nhưng phức tạp hơn; chỉ cần 1 cụm đủ đạt < 800.
**Nguồn:** Opus.

### Quyết định 4: Wrap `cancelDrag` trong `useCallback`
**Khi:** phiên này, sau khi subagent tách xong và Opus phát hiện hồi quy.
**Nội dung:** `const cancelDrag = useCallback(() => setDrag(null), [])`.
**Lý do:** bản gốc `useEffect` Escape deps `[pendingPlacement, onCancelPlacement]` vì dùng `setDrag` ổn định; sau tách `cancelDrag` là function declaration → listener chạy lại mỗi render → wrap `useCallback` giữ hành vi gốc.
**Alternative:** để nguyên function declaration → listener chạy lại mỗi render (hồi quy nhẹ, không gây lỗi nhưng không tối ưu); bọc cả 3 hàm còn lại → đổi hành vi memo hoá (không được phép).
**Nguồn:** Opus.

---

## 10. RELEVANT FILES & ARTIFACTS

### Tài liệu governance
- `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` — hồ sơ quyết định, phiên bản 1.8, 410 dòng.
- `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` — spec Task 7, 904 dòng.
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — plan gốc Task 7, 822 dòng.
- `docs/superpowers/plans/2026-09-03-fbd-edit-patch-report.md` — patch report Task 6, 103 dòng.
- `docs/superpowers/plans/2026-09-05-fbd-edit-task7-handoff.md` — handoff phiên trước (đã đọc), 313 dòng.
- `docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md` — Plan 59 (authority precedent), dòng 7 status, dòng 2738-2743 precedent R3.
- `CHANGELOG.md` — changelog toàn dự án, 1029 dòng.

### Code FBD — đã sửa Task 7 trước đó
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` — 697 dòng.
- `apps/web-ui/src/features/programming/fbd/FbdNodeInspector.tsx` — 320 dòng mới.
- `apps/web-ui/src/features/programming/fbd/nodeEditor.ts` — 16 dòng mới.
- `apps/web-ui/src/features/programming/fbd/nodeLabel.ts` — 84 dòng mới.
- `apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx` — đã sửa.
- `apps/web-ui/src/features/programming/design/inspector/ContextInspector.tsx` — đã sửa.

### Code FBD — BLK-2 phiên này
- `apps/web-ui/src/features/programming/fbd/commands.ts` — 721 dòng (từ 844).
- `apps/web-ui/src/features/programming/fbd/announcements.ts` — 73 dòng mới.
- `apps/web-ui/src/features/programming/fbd/keyboard.ts` — 56 dòng mới.
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` — 753 dòng (từ 846).
- `apps/web-ui/src/features/programming/fbd/useFbdNodeDrag.ts` — 148 dòng mới.

### Test FBD
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.interaction.test.tsx` — 14 test (kéo node, pan, zoom, marquee, Escape).
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.placement.test.tsx` — 13 test (HTML5 DnD, click-to-place, ghost).
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.presentation.test.tsx` — 7 test (grid, snap, wire style, minimap).
- `apps/web-ui/src/features/programming/fbd/commands.test.ts` — 30 test.
- `apps/web-ui/src/features/programming/fbd/commands.wiring.test.ts` — 15 test (wire validation).
- 18 file test khác trong `fbd/`, tổng 258 test fbd.

### Package config
- `apps/web-ui/package.json` — dòng 8 `build` script, dòng 28 `check:bundle-budget --increment r3`.

### Contract
- `contracts/programming/pgm02_workspace_v1.json` — §`nfr.frontend` dòng 435-447 định nghĩa R1/R2/R3 (125/145/165 KiB).

### Script
- `scripts/verify_programming_bundle_budget.py` — cổng thi hành bundle, **không được sửa** (ngoài allowlist FE).

### Files không được đụng
- `apps/web-ui/src/features/programming/ProgrammingHeader.tsx` — cấm tuyệt đối.
- `apps/web-ui/src/features/programming/ProgrammingLayout.tsx` — cấm tuyệt đối.

---

## 11. CODE CHANGES

### 1. `commands.ts` — tách 2 khối
- **Xoá:** dòng 85-94 (`FbdAnnouncement`), dòng 759-820 (`translateFbdAnnouncement`), dòng 1/28-57/822-844 (keyboard).
- **Thêm:** import `FbdAnnouncement`, `FBD_HISTORY_LIMIT`; re-export 8 symbol.
- **Lý do:** giảm 844 → 721 dòng.
- **Side effects:** không, 17 file import vẫn hoạt động nhờ re-export.

### 2. `announcements.ts` — file mới
- **Nội dung:** comment BUG-012, `FbdAnnouncement`, `translateFbdAnnouncement`.
- **Lý do:** tách từ `commands.ts`.

### 3. `keyboard.ts` — file mới
- **Nội dung:** import JSON, 5 type/interface/const/function về keyboard.
- **Lý do:** tách từ `commands.ts`.

### 4. `FbdCanvas.tsx` — tách cụm kéo node
- **Xoá:** `interface DragState` (dòng 64-72), state `drag` (139), 4 hàm (452-544).
- **Thêm:** import `useFbdNodeDrag`, gọi hook dòng 163, truyền 9 tham số.
- **Sửa:** `useEffect` Escape dòng 212 deps thêm `cancelDrag`.
- **Lý do:** giảm 846 → 753 dòng.
- **Side effects:** không, JSX và 4 export giữ nguyên.

### 5. `useFbdNodeDrag.ts` — file mới
- **Nội dung:** `DragState`, hook `useFbdNodeDrag` với state `drag` + 4 handler.
- **Chi tiết `cancelDrag`:** `const cancelDrag = useCallback(() => setDrag(null), [])` thay vì `function cancelDrag() { setDrag(null) }` để tham chiếu ổn định.
- **Lý do:** tách từ `FbdCanvas.tsx`; wrap `useCallback` tránh listener Escape chạy lại mỗi render.

### 6. `CHANGELOG.md` dòng 52
- **Sửa:** gạch ngang câu cũ "cần tách file ở task sau", ghi "ĐÃ XỬ LÝ 2026-09-05" + số đo.
- **Lý do:** phản ánh kết quả BLK-2.

---

## 12. COMMANDS RUN

```bash
# Đo dòng sau tách commands.ts
cd apps/web-ui/src/features/programming/fbd && wc -l commands.ts announcements.ts keyboard.ts

# Đo dòng sau tách FbdCanvas.tsx
cd apps/web-ui/src/features/programming/fbd && wc -l FbdCanvas.tsx useFbdNodeDrag.ts

# Kiểm phạm vi không đụng file cấm
cd MK-DDC-24 && git status --short -- apps/web-ui/src/features/programming/ProgrammingHeader.tsx apps/web-ui/src/features/programming/ProgrammingLayout.tsx

# Kiểm không đụng contracts/scripts/package.json
cd MK-DDC-24 && git diff --stat -- contracts/ scripts/ apps/web-ui/package.json

# Verify đầy đủ sau sửa cancelDrag
cd apps/web-ui && npx tsc --noEmit
cd apps/web-ui && npx vitest --run --environment jsdom src
cd apps/web-ui && npm run lint
cd apps/web-ui && npm run build

# Tổng quan thay đổi
cd MK-DDC-24 && git status --short
```

Tất cả subagent chạy verify trong sandbox riêng, báo output thật.

---

## 13. TEST / VALIDATION STATUS

### Test đã chạy — PASS
- **Unit + integration (Vitest):** 219 file, **2646 test PASS** (Task 6 nền: 214 file, 2604 test).
  - `src/features/programming/fbd`: 18 file test, 258 test PASS.
  - Test kéo node (`FbdCanvas.interaction.test.tsx`): 14 test PASS.
  - Test phím Escape (`FbdCanvas.interaction.test.tsx`): trong 14 test, PASS.
- **TypeScript:** `npx tsc --noEmit` exit 0.
- **Lint:** `npm run lint` PASS; `check:ui-strings` OK.
- **Build:** `npm run build` PASS (bao gồm `check:programming-contracts` và `check:bundle-budget --increment r3`).

### Bundle budget — PASS
- Chunk: `programming-B3aoz5av.js`
- Gzip: **128.69 KiB** (131.774 byte, zlib level 6)
- Ngân sách R3: 165.00 KiB
- Dư địa: **36.31 KiB**
- Gate: PASS

### Số đo khác
- `FbdCanvas.tsx`: 753 dòng < 800 ✓
- `commands.ts`: 721 dòng < 800 ✓
- `useFbdNodeDrag.ts`: 148 dòng
- `announcements.ts`: 73 dòng
- `keyboard.ts`: 56 dòng

### Manual validation
- Đọc lại 6 file tài liệu đã sửa, khớp plan.
- Đọc `useFbdNodeDrag.ts`, xác minh `cancelDrag` wrap `useCallback`.
- Đọc `FbdCanvas.tsx` dòng 212 deps, xác minh có `cancelDrag`.

### Chưa chạy
- E2E (Playwright) — Task 11.
- Test thị giác tràn khung — jsdom không dựng layout SVG, chuyển Task 11.

---

## 14. ERRORS / BLOCKERS

Không có blocker hiện tại. Toàn bộ DoD đã đạt.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT

### CB-1: Để listener Escape chạy lại mỗi render
**Khi:** sau khi subagent tách `FbdCanvas.tsx` lần đầu.
**Thử:** để `cancelDrag` là function declaration trong hook, không wrap `useCallback`.
**Kết quả:** `useEffect` Escape deps `[pendingPlacement, onCancelPlacement, cancelDrag]` → `cancelDrag` mới mỗi render → listener `keydown` gỡ/gắn lại mỗi render.
**Vì sao thất bại:** hồi quy nhẹ so với bản gốc (deps chỉ `[pendingPlacement, onCancelPlacement]`).
**Sửa:** wrap `cancelDrag` trong `useCallback(() => setDrag(null), [])` → tham chiếu ổn định.
**DO NOT REPEAT:** không để function declaration không ổn định trong deps của `useEffect` nếu bản gốc dùng setter ổn định.

---

## 16. IMPORTANT CONVERSATION CONTEXT

### Ý định của user về commit
User chưa yêu cầu commit. Khi user nói "commit", cần chạy trọn quy trình:
1. Verify lần cuối (test/tsc/lint/build).
2. Cập nhật `CHANGELOG.md` (đã làm).
3. Commit tách theo nhóm logic:
   - Nhóm 1: `UD-PROG-017` docs (4 file `.md`).
   - Nhóm 2: BLK-2 tách file (5 file code + `CHANGELOG.md`).
4. Stage từng file cụ thể — **không** `git add -A`.
5. Push lên nhánh hiện tại (tạo nhánh trước nếu đang ở default).
6. Tạo PR bằng `gh pr create`, mô tả tiếng Việt.
7. Merge PR.
8. Xoá nhánh remote.
9. Báo link PR + số đo.

### Ý định của user về workflow
User đã quen với quy trình 7 pha. Phiên trước hoàn thành pha 1-6, Owner chốt quyết định, phiên này xử lý quyết định + nợ kỹ thuật + pha 7 "Xuất lại báo cáo". User không muốn subagent tự ý "cải tiến" logic hay đổi workflow.

### Trade-off đã chấp nhận
- Chunk tăng 0.15 KiB (128.54 → 128.69) do hash — chấp nhận vì vẫn dư 36.31 KiB so với R3.
- 4 file khác vượt 800 dòng (`ProgramsTab.tsx` 3091, `DesignWorkspacePage.tsx` 946, `model/types.ts` 972, `api/queries.ts` 972) — không xử lý trong Task 7 vì handoff chỉ nêu 2 file `FbdCanvas`/`commands`; các file khác là scope riêng.

### Điểm user đặc biệt nhấn mạnh
- "Làm hết việc, không chừa lại" — không được báo "còn lại nên làm tiếp"; phải làm trọn hoặc nêu rõ bị chặn thật.
- "Opus chỉ điều phối" — mọi execution phải giao subagent.
- Không tin báo cáo của subagent mù quáng — phải kiểm chứng độc lập.

---

## 17. NEXT ACTIONS

Toàn bộ DoD đã đạt. **Chờ user yêu cầu commit.**

Khi user nói "commit":
1. Chạy verify lần cuối (không cần nếu vừa chạy, nhưng nếu cách xa 30+ phút thì chạy lại):
   - `cd apps/web-ui && npx vitest --run --environment jsdom src`
   - `cd apps/web-ui && npm run lint`
   - `cd apps/web-ui && npm run build`
2. Kiểm tra `CHANGELOG.md` đã cập nhật chưa (đã làm dòng 52).
3. Commit tách 2 nhóm logic:
   - Commit 1: `docs: chốt UD-PROG-017 lựa chọn A, mốc R1 125 KiB là mốc lịch sử`
     - Stage: `PROGRAMMING_OPEN_DECISIONS.md`, `2026-08-31-fbd-edit-design.md`, `2026-08-31-fbd-edit.md`, `2026-09-03-fbd-edit-patch-report.md`.
     - Thân tiếng Việt: triệu chứng (Task 7 vượt R1 3.54 KiB) → nguyên nhân (R1 không phải cổng thi hành, Plan 59 precedent) → cách sửa (Owner chọn A, ghi hồ sơ 1.8, sửa spec/plan) → kiểm chứng (chunk 128.69/165 KiB R3 PASS).
   - Commit 2: `refactor(fbd): tách FbdCanvas 753 dòng và commands 721 dòng, đóng BLK-2`
     - Stage: `FbdCanvas.tsx`, `useFbdNodeDrag.ts`, `commands.ts`, `announcements.ts`, `keyboard.ts`, `CHANGELOG.md`.
     - Thân tiếng Việt: triệu chứng (2 file vượt 800) → cách sửa (tách 3 file mới, re-export, wrap `cancelDrag` useCallback) → kiểm chứng (test 2646 PASS, tsc/lint/build PASS, 753/721 < 800).
4. Push lên nhánh hiện tại (nếu đang ở default thì tạo nhánh `task7-ud-prog-017-blk-2` trước).
5. Tạo PR: `gh pr create --title "Task 7: chốt UD-PROG-017 và đóng BLK-2" --body "<mô tả>"`.
6. Merge PR: `gh pr merge --squash` (hoặc theo quy ước repo).
7. Xoá nhánh remote: `git push origin --delete <branch>`.
8. Báo link PR + số đo bundle.

---

## 18. DEFINITION OF DONE

Task 7 FBD EDIT được coi là xong khi đủ tất cả:

- [x] Owner đã chốt A/B/C và quyết định được ghi vào `PROGRAMMING_OPEN_DECISIONS.md` với số hiệu `UD-PROG-017`.
- [x] Header hồ sơ lên 1.8; bảng §4 Lịch sử đã đính chính hai dòng trùng 1.5 và bổ sung dòng 1.7.
- [x] Spec `2026-08-31-fbd-edit-design.md` không còn tham chiếu tới một cổng đã hết hiệu lực; `BLK-FBD-003` đã đóng hoặc gỡ.
- [x] `CHANGELOG.md` phản ánh đúng trạng thái cuối, không còn ghi "chờ Owner".
- [x] `npm run build` PASS (bao gồm cổng bundle), `npx vitest --run --environment jsdom src` PASS, `npm run lint` PASS.
- [x] `FbdCanvas.tsx` và `commands.ts` dưới 800 dòng.
- [x] Không phá `BLK-FBD-001` (không tự sinh `variableId`, không Mapping ẩn) — test B-T2/B-T3 trong 2646 test PASS.
- [x] `ProgrammingHeader.tsx` và `ProgrammingLayout.tsx` **không bị đụng tới**.

Số đo thật:
- `FbdCanvas.tsx`: 753 dòng (file:dòng verified bằng `wc -l`).
- `commands.ts`: 721 dòng (file:dòng verified bằng `wc -l`).
- Chunk `programming`: 128.69 KiB gzip (output thật từ `npm run build` | `check:bundle-budget`).
- Test: 2646 PASS (output thật từ `npx vitest --run --environment jsdom src`).
- Tsc/lint/build: tất cả exit 0.

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
