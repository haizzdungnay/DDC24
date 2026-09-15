# SESSION HANDOFF — Task 9: Panel Đáy 3 Cột và Tích Hợp Mini Map FBD Editor

## 1. SESSION OBJECTIVE
- **Dự án**: MK-DDC-24 (Hệ thống điều khiển DDC công nghiệp & Web Studio lập trình PLC).
- **Mục tiêu**: Triển khai hoàn chỉnh Task 9 (Issue `T9-FBD-PANEL-3COL`) — xây dựng panel đáy 3 cột (`Problems` | `Runtime Watch` | `Mini Map`) cho FBD Editor theo ảnh thiết kế chuẩn `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png`.
- **Cụ thể gồm 3 subtask**:
  + **T9-01**: Chuyển grid khay làm việc từ 2 cột sang 3 cột, lưu trạng thái mở/đóng và chiều cao vào `localStorage` (`mkddc:programming-workbench:v1`), mở sẵn trên màn hình desktop ($\ge$ 1440px).
  + **T9-02**: Di dời Mini Map từ góc dưới canvas (`FbdCanvas.tsx`) vào Cột 3 của panel đáy (`WorkbenchMinimapPanel.tsx`), giải phóng không gian vẽ trên canvas, tích hợp 3 nút điều khiển zoom (`-`, `+`, `Vừa khung`) và tỷ lệ %.
  + **T9-03**: Đồng bộ danh sách tab panel đáy khớp với thiết kế PGM-02B: rút gọn còn 4 tab (`Vấn đề`, `Tìm kiếm`, `Tham chiếu`, `Watch`), loại bỏ tab `Trace` không khả dụng.
- **Yêu cầu kết phiên**: Commit thay đổi, rebase sạch sẽ với `origin/main` không để xảy ra xung đột (đặc biệt là `CHANGELOG.md`), đẩy branch và mở PR vào `main`. **Tuyệt đối không tự merge vào `main` và chưa đóng issue**.

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS
1. **Nguyên tắc phân vai Opus vs Subagent (BẮT BUỘC)**:
   - Opus CHỈ giữ vai trò kiến trúc, lập kế hoạch, điều phối quy trình và xác minh.
   - 100% công việc đọc hiểu sâu, đo đạc ảnh, viết test, chỉnh sửa code và chạy lệnh kiểm thử PHẢI do subagent Sonnet / Haiku thực hiện.
   - Nghiêm cấm Opus tự ý làm thay công việc của subagent.
2. **Danh sách file cấm sửa**:
   - `ProgrammingHeader.tsx`
   - `ProgrammingLayout.tsx`
   - `contracts/**`
   - `scripts/**`
   - `apps/core/**`
   - `apps/web-api/**`
   - `firmware/**`
   - `apps/web-ui/package.json`
   - `apps/web-ui/.env.local`
3. **Quy tắc bảo toàn kiểm thử (Non-weakening Invariant)**:
   - Tuyệt đối không làm yếu assertion test: không dùng `.skip`, `.only`, `.todo`.
   - Không xoá test, không nới lỏng matcher.
   - 100% test case hiện có của `FbdCanvas.test.tsx` (`AC-FBD-012`, `TC-FBD-NAV-001`) phải tiếp tục xanh mà không bị sửa đổi assertion.
4. **Quy tắc Git & PR**:
   - Chỉ commit hoặc push khi user yêu cầu.
   - Khi ở nhánh mặc định (`main`), bắt buộc tạo branch riêng trước khi commit.
   - Tuyệt đối không tự ý merge PR vào `main`.
   - Không tự đóng issue (`T9-FBD-PANEL-3COL`), phải hỏi và xin phép user trước khi đóng.
   - Đảm bảo giải quyết triệt để conflict trước khi tạo PR, đặc biệt là `CHANGELOG.md`.
5. **Tiêu chuẩn Frontend & CSS**:
   - Tailwind CSS v4: Dùng literal class tĩnh (`min-[1440px]:grid-cols-[minmax(0,1fr)_375px_458px]`), cấm nối chuỗi class động.
   - Chuỗi giao diện tiếng Việt: Có dấu đúng chuẩn, vượt qua `scripts/check_ui_strings.py`.
   - Ngân sách Bundle R3: Chunk `programming-*.js` $\le$ 165.00 KiB gzip (`scripts/verify_programming_bundle_budget.py`).
   - WAI-ARIA: Tuân thủ đầy đủ `role="tablist"`, `role="tab"`, `role="tabpanel"`, `role="group"`, `aria-selected`, `aria-controls`, `aria-keyshortcuts`.

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW
1. **Kiểm tra và tuân thủ vai trò**: Opus lập workflow và điều phối; Sonnet/Haiku thực thi.
2. **TDD (Test-Driven Development)**:
   - Viết test failing trước (Red phase).
   - Viết mã nguồn tối thiểu để test pass (Green phase).
   - Kiểm chứng toàn bộ suite regression và static check.
3. **Review độc lập**: Subagent reviewer chạy `git diff` kiểm tra file cấm, kiểm tra assertion, kiểm tra Tailwind class.
4. **Rebase & Chống xung đột**: Luôn `git fetch origin main` và xử lý conflict `CHANGELOG.md` tại nhánh local trước khi mở PR.
5. **Chờ phê duyệt**: Không tự merge PR, không tự đóng issue, hỏi ý kiến user rõ ràng.

### SESSION-ESTABLISHED WORKFLOW
- Sử dụng công cụ `Workflow` để điều phối multi-phase pipeline (`TDD Test` $\to$ `Thực thi` $\to$ `Kiểm chứng` $\to$ `Review`), gắn `model: 'sonnet'` cho 100% các agent.
- Giám sát tiến độ qua `TaskOutput(block: true)` kết hợp đọc log journal `subagents/workflows/*/journal.jsonl`.
- Chạy đồng thời 5 cổng kiểm tra chất lượng trước khi bàn giao: Vitest $\to$ tsc $\to$ check_ui_strings $\to$ check:programming-contracts $\to$ verify bundle budget.

### WORKFLOW INVARIANTS
- Không sửa file khi chưa đọc file.
- Không tự ý mở rộng phạm vi ra ngoài 3 subtask T9-01, T9-02, T9-03.
- Bọc toàn bộ tương tác localStorage trong `try/catch` an toàn.
- Đảm bảo `showInlineMinimap` trên `FbdCanvas` mặc định là `true` để giữ nguyên tương thích ngược với unit test cũ.

---

## 4. CURRENT WORKFLOW POSITION
```
Workflow:
[1. Khảo sát & Đo ảnh PGM-02B] → [2. Triển khai T9-01] → [3. Triển khai T9-02] → [4. Triển khai T9-03] → [5. Sync main & Commit] → [6. Tạo PR] → [7. QA & Merge vào main] → [8. Đóng Issue]

Completed:         [1], [2], [3], [4], [5], [6]
Currently working: [7] Awaiting QA review & User decision
Next:              [7] QA Verification → [8] Merge PR & Close Issue
```

---

## 5. WORKSPACE / ENVIRONMENT
- **Thư mục làm việc chính**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24` (thư mục frontend: `apps/web-ui`).
- **Repository**: `Mekong-HCM/MK-DDC-24`.
- **Branch hiện tại**: `feat/fbd-task9-bottom-panel-3col` (tracking `origin/feat/fbd-task9-bottom-panel-3col`).
- **Base branch**: `main` (commit đầu nhánh `2470da11`).
- **Pull Request đang mở**: PR #683 (`https://github.com/Mekong-HCM/MK-DDC-24/pull/683`), trạng thái `OPEN`, mergeable `MERGEABLE` / `CLEAN`.
- **Toolchain**: Node.js, pnpm/npm, Vite 5, Vitest 4, TypeScript 5.6, Python 3.
- **Hệ điều hành**: Windows 11 (win32), Git Bash shell.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED
- **PR #683**: Đã tạo thành công vào `main`, không có xung đột (mergeStateStatus: `CLEAN`).
- **Commit `45248380`**: Đã tạo và push lên remote `origin/feat/fbd-task9-bottom-panel-3col`.
- **T9-01**: Grid 3 cột `min-[1440px]:grid-cols-[minmax(0,1fr)_375px_458px]`, lưu localStorage key `mkddc:programming-workbench:v1` với `{open, height}`, mở sẵn khi $\ge$ 1440px.
- **T9-02**: Component `WorkbenchMinimapPanel.tsx` đã dựng ở Cột 3 với đầy đủ tiêu đề "Mini Map", 3 nút zoom (`-`, `+`, `Vừa khung`), nhãn tỷ lệ zoom, SVG thumbnail, viewport indicator xanh ngọc, click/drag điều hướng. `FbdCanvas` ẩn inline minimap trong editor thật qua `showInlineMinimap={false}`.
- **T9-03**: Dải tab workbench còn đúng 4 tab (`Vấn đề`, `Tìm kiếm`, `Tham chiếu`, `Watch`), tab `Trace` đã bị xoá khỏi `TabId`, mảng `tabs` và markup.
- **Unit Tests**:
  + `ProgrammingWorkbench.test.tsx`: 30/30 tests passed.
  + `WorkbenchMinimapPanel.test.tsx`: 5/5 tests passed.
  + Toàn bộ `features/programming/design/workbench/`: 72/72 tests passed (6 files).
  + Toàn bộ `features/programming/fbd/`: 270/270 tests passed (18 files).
- **TypeScript**: `tsc --noEmit` exit 0, không có lỗi type.
- **Linter tiếng Việt**: `python scripts/check_ui_strings.py` PASS.
- **Hợp đồng lập trình**: `npm run check:programming-contracts` PASS (5/5 contract đồng bộ).
- **Bundle Budget R3**: `verify_programming_bundle_budget.py` đo được `154.78 KiB` / trần `165.00 KiB` (dư địa `10.22 KiB`).
- **CHANGELOG.md**: Đã cập nhật mục Task 9 dưới `[Unreleased]`, không còn conflict markers.

### UNVERIFIED
- Hiển thị trực quan của thumbnail trên màn hình thật: Ảnh chụp màn hình của user cho thấy khung Mini Map ở đáy hiển thị thanh điều khiển `[-] 100% [+] [Fit]` nhưng thumbnail khối FBD bên trong SVG có thể bị nhỏ hoặc mờ do tỷ lệ viewBox `2400x1600` co về khung `~458x130`. Cần kiểm tra thị giác độc lập trên trình duyệt.

---

## 7. COMPLETED WORK
1. **Subtask T9-01**:
   - File: `ProgrammingWorkbench.tsx`, `ProgrammingWorkbench.test.tsx`, `programming-workspace-height.spec.ts`.
   - Đổi grid 2 cột sang 3 cột: Cột 1 `minmax(0,1fr)`, Cột 2 `375px`, Cột 3 `458px`.
   - Đọc/ghi trạng thái `{ open, height }` vào `localStorage` key `mkddc:programming-workbench:v1`.
   - Hòa giải conflict E2E height spec dòng 100 bằng điều kiện viewport `expectedOpen = width >= 1440`.
2. **Subtask T9-02**:
   - File: `WorkbenchMinimapPanel.tsx`, `WorkbenchMinimapPanel.test.tsx`, `FbdCanvas.tsx`, `StructuredFbdEditor.tsx`, `FbdEditorPane.tsx`, `DesignWorkbench.tsx`, `DesignWorkspacePage.tsx`.
   - Tách context bridge `FbdCanvasBridgeContext` và `FbdCanvasSetBridgeContext` để tránh render loop.
   - `FbdCanvas` đẩy state toạ độ, nodes, zoom/pan lên bridge.
   - `WorkbenchMinimapPanel` mount vào Cột 3, hiển thị SVG thumbnail, khung viewport, 3 nút zoom.
   - Ẩn inline minimap ở góc canvas trong `FbdEditorPane.tsx` bằng `showInlineMinimap={false}`.
   - POU ST hiển thị placeholder: "Bản đồ thu nhỏ chỉ khả dụng cho sơ đồ khối FBD".
3. **Subtask T9-03**:
   - File: `ProgrammingWorkbench.tsx`, `ProgrammingWorkbench.test.tsx`, `e2e/programming.spec.ts`.
   - Bỏ `'trace'` khỏi `TabId` và mảng `tabs`.
   - Cập nhật E2E assert dòng 1712: `expect(count, 'workbench phải có đủ bốn khay').toBe(4)`.
   - Thêm test assert tab `Trace` không còn xuất hiện.
4. **Đồng bộ branch & Mở PR**:
   - Rebase với `origin/main` (commit `2470da11`).
   - Xử lý conflict `CHANGELOG.md` sạch sẽ.
   - Commit `45248380` và mở PR #683 vào `main`.

---

## 8. WORK IN PROGRESS
- PR #683 đang ở trạng thái `OPEN` chờ user hoặc team lead review.
- Issue `T9-FBD-PANEL-3COL` đang giữ nguyên trạng thái `OPEN`.

---

## 9. IMPORTANT DECISIONS
1. **Prop `showInlineMinimap` trên `FbdCanvas` (Mặc định `true`)**:
   - *Lý do*: Giúp toàn bộ 5 unit test cũ trong `FbdCanvas.test.tsx` tiếp tục chạy độc lập và xanh 100% mà không bị sửa hay làm yếu assertion. Ứng dụng thật (`FbdEditorPane`) chủ động truyền `false` khi đã mount Mini Map ở Cột 3.
2. **Tách riêng 2 React Context cho Bridge**:
   - *Lý do*: Nếu gộp state `bridge` và setter `setBridge` vào 1 Context, mỗi lần canvas cuộn sẽ trigger setter làm Provider re-render toàn bộ cây con, gây giật lag hoặc loop. Tách 2 context giúp canvas chỉ lắng nghe setter mà không bị re-render ngược.
3. **Placeholder khi mở POU ST**:
   - *Lý do*: ST Editor không có toạ độ đồ thị node/wire FBD. Hiển thị thông báo "Bản đồ thu nhỏ chỉ khả dụng cho sơ đồ khối FBD" thay vì để trống hoặc crash.
4. **Loại bỏ tab Trace**:
   - *Lý do*: Theo đúng ảnh tham chiếu PGM-02B và quyết định của user, tab Trace không khả dụng trong scope FBD Editor này. Khay đáy còn đúng 4 tab nghiệp vụ.

---

## 10. RELEVANT FILES & ARTIFACTS
- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx` — Component mới Cột 3 Mini Map kèm bridge context.
- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx` — Unit test cho component Mini Map mới.
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` — Grid 3 cột, 4 tab, tích hợp localStorage và Cột 3.
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` — Unit test cho khay làm việc 3 cột và 4 tab.
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` — Canvas FBD, đẩy bridge snapshot và prop `showInlineMinimap`.
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx` — Truyền `showInlineMinimap={false}` để ẩn minimap góc canvas.
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` — Mount `FbdCanvasBridgeProvider` bọc ProgramsTab và DesignWorkbench.
- `apps/web-ui/e2e/programming-workspace-height.spec.ts` — E2E test ngân sách chiều cao dọc (đã sửa assert theo viewport).
- `apps/web-ui/e2e/programming.spec.ts` — E2E test dải 4 tab của workbench.
- `CHANGELOG.md` — Ghi nhận thay đổi Task 9 dưới mục `[Unreleased]`.
- `docs/superpowers/plans/2026-09-11-fbd-task9-issue.md` — Mô tả Issue Task 9 gốc (trạng thái OPEN).
- `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png` — Ảnh thiết kế tham chiếu gốc.
- PR Link: `https://github.com/Mekong-HCM/MK-DDC-24/pull/683`.

---

## 11. CODE CHANGES
- **`WorkbenchMinimapPanel.tsx`**: Tạo mới component quản lý Mini Map, xuất `FbdCanvasBridgeProvider`, `useFbdCanvasBridge`, `useSetFbdCanvasBridge`, render SVG thumbnail, nút zoom `[-] 100% [+] [Fit]`, xử lý chuột/bàn phím điều hướng.
- **`ProgrammingWorkbench.tsx`**: Sửa grid class sang 3 cột literal; bổ sung đọc/ghi `localStorage` key `mkddc:programming-workbench:v1`; mount `WorkbenchMinimapPanel` vào `workbench-minimap-column`; bỏ `trace` khỏi `TabId` và mảng `tabs`.
- **`FbdCanvas.tsx`**: Nhận `showInlineMinimap?: boolean` (mặc định `true`); bổ sung `useEffect` đồng bộ `geometry.nodes`, `viewport`, `zoom` và sự kiện cuộn sang `setBridge`.
- **`FbdEditorPane.tsx`**: Đặt `showInlineMinimap={false}` khi nhúng `StructuredFbdEditor`.
- **`DesignWorkspacePage.tsx`**: Bọc `FbdCanvasBridgeProvider` quanh vùng soạn thảo và khay đáy.
- **`e2e/programming-workspace-height.spec.ts`**: Cập nhật kiểm tra `workbenchOpen` dựa theo `viewportSize().width >= 1440`.
- **`e2e/programming.spec.ts`**: Cập nhật kỳ vọng số lượng tab khay đáy từ 5 thành 4.

---

## 12. COMMANDS RUN
```bash
# Unit test workbench & fbd
cd apps/web-ui && npx vitest --run src/features/programming/design/workbench/
cd apps/web-ui && npx vitest --run src/features/programming/fbd/

# Type check
cd apps/web-ui && npx tsc --noEmit

# Vietnamese UI strings check
python scripts/check_ui_strings.py

# Programming contracts check
cd apps/web-ui && npm run check:programming-contracts

# Bundle budget verification
PYTHONUTF8=1 python scripts/verify_programming_bundle_budget.py --increment r3

# Git fetch & rebase main
git fetch origin main
git pull origin main
git checkout -b feat/fbd-task9-bottom-panel-3col

# Git push & PR
git push -u origin feat/fbd-task9-bottom-panel-3col
gh pr create --base main --head feat/fbd-task9-bottom-panel-3col ...
```

---

## 13. TEST / VALIDATION STATUS
- **Vitest**: PASS 100% (72/72 workbench tests, 270/270 fbd tests).
- **TypeScript**: PASS (0 errors).
- **UI Strings**: PASS (100% chuỗi tiếng Việt có dấu hợp lệ).
- **Contracts**: PASS (5/5 contracts đồng bộ).
- **Bundle Budget**: PASS (154.78 KiB / 165.00 KiB, dư 10.22 KiB).
- **Git State**: Clean working tree, PR mergeable `CLEAN`.

---

## 14. ERRORS / BLOCKERS
- Không có lỗi biên dịch hay test failure nào còn tồn tại.
- Điểm lưu ý: Cần người dùng review trực quan hiển thị thumbnail FBD trong panel Mini Map trên màn hình thật để xác nhận độ tương phản và tỷ lệ hiển thị.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT
- **DO NOT REPEAT**: Opus tự ý chạy script đọc ảnh, đọc code hoặc sửa code. Bắt buộc 100% phải giao cho subagent Sonnet/Haiku.
- **DO NOT REPEAT**: Canvas tự dò tìm ngữ cảnh để ẩn inline minimap mà không có prop tường minh (gây xanh giả và làm yếu test). Bắt buộc dùng prop `showInlineMinimap` với giá trị mặc định `true`.
- **DO NOT REPEAT**: Tự ý chạy `gh pr merge` hoặc merge vào `main`. User đã quy định rõ không tự merge.
- **DO NOT REPEAT**: Tự ý đóng issue `T9-FBD-PANEL-3COL`. Phải đợi user nghiệm thu và đồng ý đóng.

---

## 16. IMPORTANT CONVERSATION CONTEXT
- User chỉ đạo trực tiếp: *"chưa đóng issue , commit và tạo pr vào main ( đảm bảo đến lúc nào không bị conflic mới tạo pr nhất là changelog) (không tự merge vào main)"*.
- User đã nhận được prompt kiểm chứng độc lập ở lượt trước. Phiên tiếp theo sẵn sàng hỗ trợ user thực hiện kiểm chứng hoặc điều chỉnh nhỏ theo phản hồi review PR.

---

## 17. NEXT ACTIONS
1. **Theo dõi phản hồi Review PR #683**:
   - Nếu user hoặc reviewer yêu cầu chỉnh sửa hiển thị (ví dụ: tăng độ tương phản của thumbnail FBD hoặc viền viewport trong `WorkbenchMinimapPanel.tsx`):
     + Dùng Sonnet subagent để điều chỉnh styling SVG (stroke, fill).
     + Chạy lại Vitest và bundle budget để đảm bảo không hồi quy.
     + Push commit bổ sung lên branch `feat/fbd-task9-bottom-panel-3col`.
2. **Nếu user yêu cầu chạy kiểm chứng độc lập**:
   - Sử dụng prompt kiểm chứng độc lập đã cung cấp ở lượt trước để chạy bộ thẩm định.
3. **Khi PR #683 được duyệt và merge**:
   - Hỏi ý kiến user để cập nhật trạng thái issue `T9-FBD-PANEL-3COL` thành `CLOSED`.

---

## 18. DEFINITION OF DONE
- [x] T9-01 hoàn thành: Grid 3 cột, nhớ localStorage, mở sẵn desktop $\ge$ 1440px.
- [x] T9-02 hoàn thành: Mini Map di dời vào Cột 3, có điều khiển zoom, giải phóng canvas.
- [x] T9-03 hoàn thành: Tab list còn 4 tab, bỏ tab Trace, E2E assert `.toBe(4)`.
- [x] 100% unit tests liên quan pass (`ProgrammingWorkbench.test.tsx`, `WorkbenchMinimapPanel.test.tsx`, `FbdCanvas.test.tsx`).
- [x] TypeScript clean, UI strings clean, programming contracts pass, bundle budget R3 pass.
- [x] CHANGELOG.md cập nhật mục Task 9 dưới `[Unreleased]`.
- [x] Tạo PR vào `main` không conflict (#683).
- [ ] PR #683 được merge vào `main`.
- [ ] User xác nhận nghiệm thu và đồng ý đóng issue `T9-FBD-PANEL-3COL`.

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
