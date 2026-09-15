# ISSUE — Task 9: Panel Dưới 3 Cột cho FBD Editor

## Metadata
- **Issue ID**: T9-FBD-PANEL-3COL
- **Created**: 2026-09-11
- **Status**: OPEN
- **Assignee**: Khi đóng phải hỏi rõ ý kiến user, không tự đóng
- **Parent Task**: [2026-08-31-fbd-edit.md](./2026-08-31-fbd-edit.md) Step 9
- **Related**: [2026-09-10-fbd-edit-task8-handoff.md](./2026-09-10-fbd-edit-task8-handoff.md), [2026-09-10-fbd-edit-task8-handoff-2.md](./2026-09-10-fbd-edit-task8-handoff-2.md)

## Summary
Bổ sung panel dưới 3 cột (Problems | Runtime Watch | Mini Map) cho FBD Editor theo ảnh tham chiếu `PGM-02B_FBD_editor_reference.png`, mở sẵn ~162px ở desktop, nhớ trạng thái qua localStorage.

## Context
Ảnh tham chiếu `PGM-02B_FBD_editor_reference.png` cho thấy bố cục FBD Editor gồm:
- Trên: POU Explorer (244px) | Canvas | Quick Library (223px) | Inspector (341px)
- Dưới: Panel 3 cột đo được x=196..839 (Problems ~643px) | x=839..1214 (Runtime Watch ~375px) | x=1214..1672 (Mini Map ~458px)

Phiên 09/10 đã làm Task 8 (layout trên) và thu gọn chrome về 1 hàng. Hiện tại panel dưới (`ProgrammingWorkbench`) đã có 5 tab và mở sẵn 173px nhưng chỉ 2 cột (cột Mini Map "cố ý hoãn" vì chờ `FbdCanvas` công bố viewport).

Workflow đa tác tử 2026-09-11 gặp rate limit 429 sau 6/16 agents. Ba agents thành công (autolayout, workbench, status-strip) cho thấy:
- Auto layout (preview + Apply/Cancel) đã xong từ trước, test xanh
- Workbench đã mở sẵn 173px grid 2 cột, cột 3 chờ viewport
- Dải status đáy chưa tồn tại (grep `StatusStrip` = 0 kết quả)

User đã chọn qua AskUserQuestion:
1. Panel mở sẵn 3 cột ở desktop ≥1440px (theo ảnh PGM-02B)
2. Bỏ dải status đáy (không làm)
3. Bỏ 3 hạng mục: màu khối theo nhóm, màu dây theo kiểu, xem trước auto layout (đã xong rồi)

## Tasks

### T9-01: Panel Dưới 3 Cột + Nhớ Trạng Thái
**Mô tả**: Đổi grid `ProgrammingWorkbench.tsx:344` từ 2 cột sang 3 cột, tỉ lệ tham chiếu ~643px / ~375px / ~458px. Lưu trạng thái mở/đóng và chiều cao vào localStorage (`mkddc:programming-workbench:v1`), mặc định mở sẵn ~162-173px khi ≥1440px.

**Files**:
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` (629 dòng)
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` (386 dòng)

**Acceptance**:
- Grid class: `min-[1440px]:grid-cols-[minmax(0,1fr)_375px_458px]` hoặc tương đương 3 cột
- `data-testid="workbench-problems-column"`, `"workbench-watch-column"`, `"workbench-minimap-column"` đều hiển thị ở ≥1440px
- Mặc định `open: true`, `height: 162` (hoặc 173 theo số đo hiện tại) khi viewport ≥1440px
- Trạng thái được lưu localStorage key `mkddc:programming-workbench:v1`, structure `{open: boolean, height: number}`
- Reload trang giữ nguyên trạng thái đã lưu

**Tests**:
- Mở rộng test hiện tại `:173-185` để kiểm tra 3 cột render
- Test localStorage: thay đổi trạng thái → reload → kiểm tra trạng thái khôi phục
- Test collapse: đóng panel → `role="tabpanel"` không tồn tại

### T9-02: Chuyển Mini Map Từ Canvas Vào Cột 3
**Mô tả**: Mini Map hiện nằm ở góc dưới phải canvas (`FbdCanvas.tsx:788-818`). Di chuyển logic và component vào cột 3 của panel dưới, giải phóng góc canvas cho vùng vẽ.

**Blocked by**: T9-01 (cần cột 3 đã dựng)

**Files**:
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` (886 dòng): xóa minimap góc dưới phải
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx`: mount minimap vào cột 3
- Có thể cần component mới `WorkbenchMinimapPanel.tsx` hoặc tái sử dụng logic từ `FbdCanvas`

**Acceptance**:
- `FbdCanvas` không còn render minimap ở góc dưới phải (grep `data-fbd-minimap` trong canvas = 0 kết quả)
- Cột 3 của workbench (`data-testid="workbench-minimap-column"`) chứa thumbnail đồ thị, điều khiển zoom, title "Mini Map"
- Click vào minimap điều hướng canvas (TC-FBD-NAV-001 từ master plan `2026-08-31-fbd-edit.md:907`)
- Minimap hiển thị THƯỜNG TRỰC (không cần bấm tab), đúng theo ảnh tham chiếu PGM-02B

**Tests**:
- Unit test: cột minimap hiển thị mà không cần bấm tab (sao chép pattern `:308-318` "cột Runtime Watch hiện THƯỜNG TRỰC")
- E2E (tuỳ chọn): TC-FBD-NAV-001 trên đồ thị > 24 node, click minimap → canvas viewport di chuyển

### T9-03: Danh Sách Tab Còn 4
**Mô tả**: Ảnh tham chiếu PGM-02B có 4 tab: `Problems (1)` | `Runtime Watch (Live)` | `Search` | `Cross Reference`. Code hiện tại có 5 tab (thêm `Trace` không khả dụng). Loại bỏ tab `Trace`, giữ lại 4 tab khớp ảnh.

**Files**:
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx:101` (type TabId), `:241-255` (mảng tabs)
- E2E `apps/web-ui/e2e/programming.spec.ts:1712` (`expect(count, 'workbench phải có đủ năm khay').toBe(5)`)

**Acceptance**:
- `type TabId = 'problems' | 'search' | 'references' | 'watch'` (bỏ `'trace'`)
- Mảng `tabs` có đúng 4 phần tử, nhãn tiếng Việt: `Vấn đề` / `Tìm kiếm` / `Tham chiếu` / `Watch (Trực tiếp)` hoặc `Watch (Mô phỏng)`
- E2E `:1712` cập nhật thành `.toBe(4)`

**Tests**:
- Cập nhật assert E2E `.toBe(4)`
- Kiểm tra `queryByRole('tab', {name: /Trace/})` trả `null`
- Nhãn chính xác: `getByRole('tab', {name: /Vấn đề/})`, `/Tìm kiếm/`, `/Tham chiếu/`, `/Watch \(Trực tiếp\)/`

## Verification Criteria (Đo được)
- [ ] `git grep "grid-cols-\[minmax" apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` trả về dòng chứa 3 cột
- [ ] `npx vitest --run src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` pass 100%
- [ ] `localStorage.getItem('mkddc:programming-workbench:v1')` trả về JSON object có `{open, height}` sau khi thay đổi trạng thái
- [ ] `document.querySelectorAll('[data-testid^="workbench-"][data-testid$="-column"]').length === 3` ở viewport ≥1440px
- [ ] `git grep "data-fbd-minimap" apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` trả về 0 kết quả (minimap đã di chuyển)
- [ ] `document.querySelectorAll('[role="tab"]').length === 4` trong workbench
- [ ] `npx playwright test e2e/programming.spec.ts` pass (sau khi sửa assert `.toBe(4)`)

## Definition of Done
- [ ] Cả 3 task T9-01, T9-02, T9-03 đã hoàn thành và verify
- [ ] Toàn bộ unit tests liên quan pass (`ProgrammingWorkbench.test.tsx`, `FbdWorkbench.test.tsx`, `DesignWorkbench.test.tsx`)
- [ ] E2E `programming.spec.ts` pass với assert cập nhật `.toBe(4)`
- [ ] Không có regression: ST editor, POU Explorer, Inspector, Quick Library vẫn hoạt động bình thường
- [ ] CHANGELOG.md cập nhật dưới `[Unreleased]`
- [ ] **Hỏi user trước khi đóng issue** — KHÔNG tự đóng

## Constraints
- Cấm sửa: `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`, `package.json`, `.env.local`
- Không làm yếu assertion test: không `.skip`/`.only`/`.todo`, không xóa test, không nới lỏng matcher
- Subagent không chạy git write: add/commit/push/gh/stash/checkout/restore/reset/clean do Opus điều phối
- Không sửa các file layout/header đã cấm theo handoff 09/10
- Giữ semantic HTML và accessibility: mọi interactive element có label ARIA, mọi tab có `role="tab"` + `aria-selected`

## References
- Ảnh tham chiếu: `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png`
- Plan gốc: `docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md` (1673 dòng, một phần lỗi thời)
- Master plan: `docs/superpowers/plans/2026-08-31-fbd-edit.md` Step 9
- Handoff 09/10: Task 8 layout & controls, chrome consolidation
- Workflow journal: `C:\Users\PC\.claude\projects\e--TuanDuong-INTERN-DDC24-project\b1327d5c-6385-4419-9c61-7903cd373c44\subagents\workflows\wf_5128bd22-cbc\journal.jsonl` (6 agents, 3 thành công)

## Notes
- Quyết định user: panel mở sẵn 3 cột (theo ảnh PGM-02B), bỏ dải status đáy, bỏ 3 hạng mục dư (màu khối/dây, xem trước tự sắp xếp)
- Mini Map là PANEL trong workbench, không phải TAB — luôn hiển thị cạnh Problems và Runtime Watch
- Conflict E2E đã phát hiện: `programming-workspace-height.spec.ts:100` bắt khay đóng sẵn, nhưng `ProgrammingWorkbench.test.tsx:182` bắt mở sẵn 173px. Cần hòa giải bằng cách mở sẵn có điều kiện theo viewport (≥1440px mở, <1440px đóng) và cập nhật cả hai bộ test
- Số đo ảnh tham chiếu: Problems x=196..839 (643px), Runtime Watch x=839..1214 (375px), Mini Map x=1214..1672 (458px)
