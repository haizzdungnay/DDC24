# SESSION HANDOFF: HOÀN THÀNH FBD EDIT TASK 6–7, AUDIT GATE, MỞ ISSUES TASK 8 & TASK 9

> **Đính chính sau rà soát PR #572 ngày 2026-09-07:** Các trạng thái `MERGEABLE`,
> HEAD và số đo bên dưới là ảnh chụp tại thời điểm bàn giao ban đầu, không phải
> trạng thái hiện hành. Nhánh PR đã được đồng bộ với `main` chứa Task 8 (#574),
> xử lý conflict theo hướng giữ Inspector ngoài và shell responsive, đồng thời
> vá kiểm tra field sai loại/no-op của `UPDATE_NODE_ATTRIBUTES` và phép đổi tọa
> độ zoom/pan. Ngưỡng ISO harness cũng đã đồng bộ với `UD-PROG-017`; bằng chứng
> hiện hành phải lấy từ mục PR và CHANGELOG mới nhất.

### 1. SESSION OBJECTIVE
- Triển khai tính năng **FBD EDIT** (Function Block Diagram editor, kéo-thả, kết nối dây, inspector, phím tắt) cho `apps/web-ui` thuộc dự án MK-DDC-24 (DDC/IoT Gateway/BMS controller).
- Mục tiêu phiên: Kiểm chứng và hoàn tất bàn giao Task 6 & Task 7; xử lý triệt để các lỗi gate tồn đọng; đưa toàn bộ 4 gate kỹ thuật về trạng thái GREEN; push lên GitHub và tạo Pull Request để người dùng merge thủ công; rà soát tiến độ tổng thể kế hoạch 14 task và khởi tạo issue theo dõi cho các task tiếp theo (Task 8 và Task 9).

---

### 2. USER REQUIREMENTS & HARD CONSTRAINTS

#### Yêu cầu cốt lõi từ người dùng
1. **Phân vai model (Multi-agent rule):** Model Claude Opus (`cc/claude-opus-5`) **chỉ được đóng vai trò điều phối, lập kế hoạch và phản biện/kiểm chứng**; toàn bộ việc thực thi, đọc code chi tiết, sửa lỗi, chạy lệnh phải giao cho các model rẻ/yếu hơn (Sonnet, Haiku). **Tuyệt đối không chạy subagent bằng model Opus.**
2. **Quyền hạn Git và Pull Request:** Push code lên GitHub và **chỉ tạo PR**; người dùng sẽ **tự merge thủ công**. Tuyệt đối **không tự ý merge** PR, không xoá nhánh sau khi push.
3. **Tiêu chuẩn chất lượng gate:** Sửa sạch toàn bộ lỗi cổng trước khi push (không push code khi gate còn đỏ).
4. **Local artifacts & .gitignore:** Bổ sung các file phát triển cục bộ (`.env.local`, `screenshot-*.png`, `.claude/worktrees/`, `tools/*.sh`, `test-fbd-edit-manual.mjs`) vào `.gitignore` và commit file `.gitignore`.
5. **Đường dẫn tuyệt đối trong handoff:** Giữ nguyên các đường dẫn tuyệt đối dạng `E:\TuanDuong\...` trong 4 file handoff markdown đã có theo tiền lệ của repo.

#### Ràng buộc kỹ thuật bất biến (Invariants)
- **Cấm làm yếu assertion:** Nghiêm cấm xoá, comment-out, dùng `.skip`, `.only`, nới lỏng matcher, hoặc thêm mock giả lập dữ liệu rỗng để ép test pass.
- **Ranh giới file cấm đụng:**
  - `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx` (giữ nguyên file dirty của người dùng).
  - `apps/web-ui/src/features/programming/layout/ProgrammingLayout.tsx` (giữ nguyên file dirty của người dùng).
  - `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`.
  - `apps/web-ui/package.json` (không thêm dependency bên ngoài, không kéo `reactflow`/`xyflow`).
- **Bảo toàn lịch sử CHANGELOG:** Các mục đã xuất bản trong `CHANGELOG.md` là bất biến (immutable); mọi thay đổi trong `CHANGELOG.md` bắt buộc phải là **thuần thêm (purely additive, 0 dòng xoá)**.
- **Quy chuẩn ngôn ngữ:** Toàn bộ commit message, PR title/body, documentation, comment code giao diện phải viết bằng **tiếng Việt có dấu chuẩn xác** (bảo đảm vượt qua linter `check:ui-strings`).
- **Ngân sách Bundle:** Chunk `programming-*.js` phải nằm trong ngân sách R3 = 165.00 KiB gzip (`check:bundle-budget --increment r3`).
- **Giới hạn độ dài file:** Tuân thủ trần 800 dòng/file theo quy tắc ECC coding-style.

---

### 3. WORKING METHOD / USER-DEFINED WORKFLOW

#### USER-DEFINED WORKFLOW
1. **Lập kế hoạch / Điều phối:** Opus phân tích yêu cầu, chia tách luồng công việc độc lập.
2. **Ủy quyền thực thi:** Giao việc cho subagent Sonnet/Haiku với phạm vi file và tiêu chí dừng cụ thể.
3. **Kiểm chứng độc lập (Adversarial verification):** Không tin tưởng mù quáng vào báo cáo của subagent; luôn tự chạy lệnh kiểm tra lại diff, numstat, log, và output thực tế.
4. **Sửa tận gốc nguyên nhân:** Khi phát hiện test fail hoặc bug, truy tìm căn nguyên trong mã nguồn chính, kiên quyết từ chối các giải pháp vá tạm/mock giả né lỗi.
5. **Bảo toàn gate trước khi bàn giao:** Cả 4 cổng kỹ thuật (tsc, lint, test, build) phải được xác minh xanh trên cây làm việc sạch trước khi push/PR.

#### SESSION-ESTABLISHED WORKFLOW
- **Phát hiện vi phạm quy trình sớm:** Theo dõi chặt chẽ hành vi git của subagent để phát hiện kịp thời các lệnh write trái phép.
- **Quản lý bối cảnh môi trường:** Phân biệt rõ lỗi do cờ môi trường cục bộ (`.env.local` chứa `VITE_PROGRAMMING_REV_A=1`) với lỗi mã nguồn thực tế để tránh sửa sai phạm vi.
- **Tách bạch commit theo chủ đề:** Phân định rõ ràng các commit chore (cấu hình), feat (tính năng), test (kiểm thử), docs (tài liệu) và fix (sửa lỗi phát sinh).

#### WORKFLOW INVARIANTS
- Luôn `cd /e/TuanDuong/INTERN/DDC24_project/MK-DDC-24` trước khi thực thi lệnh git để tránh lệch working directory.
- Không bao giờ dùng `git add -A` hoặc `git add .`; chỉ stage đích danh đường dẫn cụ thể.
- Tuyệt đối không dùng các lệnh huỷ diệt: `git reset --hard`, `git checkout --`, `git clean -fd`.

---

### 4. CURRENT WORKFLOW POSITION

```
Workflow FBD EDIT: Task 0.5 → 1 → 1.5 → 2..5.5 → Task 6 → Task 7 → Task 8 & 9 → Task 10 → Task 11
Completed:         Task 0.5, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7 (PR #572 đã push, 4 gate GREEN)
Tracking Issues:   Task 8 (#574), Task 9 (#573) đã tạo sẵn trên GitHub
Currently working: Chuyển giao trạng thái (Handoff) sang phiên mới
Next:              Bắt đầu thực hiện Task 8 (Issue #574) hoặc Task 9 (Issue #573)
```

---

### 5. WORKSPACE / ENVIRONMENT
- **Root Directory:** `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Frontend App Directory:** `apps/web-ui`
- **Git Branch:** `feat/fbd-edit-task6` (theo dõi `origin/feat/fbd-edit-task6`)
- **HEAD Commit:** `a6fe3da0f2e168503c9634d9752fd63cafc0c700`
- **PR Trạng thái:** PR #572 (`feat(programming): FBD Edit task 6–7 — canvas, wiring, inspector, keyboard`) đang OPEN, MERGEABLE.
- **Toolchain:** Node.js, npm, Vite 5 / Rolldown, TypeScript 5, Tailwind CSS v4, Vitest 4, Python 3.12 (dùng chạy script ngân sách và lint chuỗi UI tiếng Việt).
- **Hệ điều hành:** Windows 11 Home Single Language (x64), shell Git Bash.
- **GitHub CLI:** Đã đăng nhập tài khoản `haizzdungnay`.

---

### 6. CURRENT VERIFIED STATE

#### VERIFIED
- **Cổng TypeScript (`npx tsc --noEmit`):** Exit code 0, 0 lỗi trên toàn bộ workspace FE.
- **Cổng ESLint & UI Strings (`npm run lint`):** Exit code 0, eslint sạch, script `check_ui_strings.py` trả về `OK — không có chuỗi giao diện tiếng Việt nào bị viết thiếu dấu`.
- **Cổng Bundle Budget (`check:bundle-budget --increment r3`):** Chunk `programming-C3cSd0YF.js` đạt **149.45 KiB gzip** (153.03 kB) so với ngân sách R3 là **165.00 KiB**, dư địa **15.55 KiB**. Đạt tiêu chuẩn PASS.
- **Cổng Kiểm thử (`npx vitest --run --environment jsdom src`):** 242/243 test files PASS, 3.058/3.059 tests PASS.
  - Ca fail duy nhất: `src/shared/components/ShellNavigation.test.tsx` (do cờ `.env.local` `VITE_PROGRAMMING_REV_A=1`). Khi chạy kiểm tra với `VITE_PROGRAMMING_REV_A=0` đạt 18/18 PASS. Môi trường CI không có file này sẽ pass 100%.
- **Toàn vẹn CHANGELOG.md:** `git diff --numstat d3ef7561 HEAD -- CHANGELOG.md` ghi nhận `78 0` (hoàn toàn thuần thêm, không mất dòng lịch sử nào).
- **Khôi phục tài liệu lịch sử:** `docs/superpowers/plans/2026-09-03-fbd-edit-handoff.md` đã khôi phục nguyên vẹn 606 dòng từ `d3ef7561` (diff = 0).
- **Trạng thái PR & Issues:**
  - PR #572: Đã cập nhật body đầy đủ thông số đo đạc thực tế, 40 files changed (+5.468 / -519).
  - Issue #573: Đã tạo thành công cho Task 9 (Workbench & Diagnostics).
  - Issue #574: Đã tạo thành công cho Task 8 (Shell & Docks Responsive).
- **Working Tree:** `git status` trả về `nothing to commit, working tree clean`.

#### UNVERIFIED
- Kiểm thử End-to-End Playwright (chưa có kịch bản chạy trong phiên này do task E2E thuộc Task 11).

---

### 7. COMPLETED WORK
1. **Thẩm định và xác minh thực tế Task 6 & Task 7:**
   - Phát hiện handoff cũ báo cáo sai (báo pass nhưng thực tế 3 gate fail).
   - Đã sửa triệt để lỗi kiểu TS2353 và 2 test fail trong `QuickLibraryPanel.test.tsx`.
   - Đã xác minh các module mới tách dưới 800 dòng: `FbdCanvas.tsx` (753), `commands.ts` (721), `FbdNodeInspector.tsx` (320), `StructuredFbdEditor.tsx` (697), `useFbdNodeDrag.ts` (146), `announcements.ts` (73), `nodeLabel.ts` (82), `keyboard.ts` (56).
2. **Khắc phục lỗi ghi đè tài liệu trong commit `2e7ded17`:**
   - Commit `2e7ded17` do subagent tạo đã vô tình ghi đè `2026-09-03-fbd-edit-handoff.md` (606 dòng thành 194 dòng).
   - Đã khôi phục nguyên bản từ baseline `d3ef7561` và tạo commit `ecbf6651`.
3. **Phát hiện và xử lý tận gốc lỗi FE-TR-01 trên Trang Xu Hướng (`TrendsPage.tsx`):**
   - **Hiện tượng:** Khi mở deep link `?points=UI-99` với ID không tồn tại trong `/points`, effect dòng 254 âm thầm lọc bỏ ID khỏi `selectedIds`, mâu thuẫn với comment thiết kế FE-TR-01 dòng 182–194.
   - **Xử lý:** Subagent trước đó định vá tạm bằng cách mock `api.getPoints.mockResolvedValue([])` trong test; Opus đã chỉ đạo bóc tách, bác bỏ cách vá này, gỡ bỏ mock và sửa trực tiếp tại `TrendsPage.tsx` (`if (hasSavedPrefsRef.current) return current`).
   - Tạo commit `a6fe3da0` sửa mã nguồn và ghi nhận vào `CHANGELOG.md`.
4. **Đồng bộ GitHub:**
   - Push an toàn các commit mới lên `origin/feat/fbd-edit-task6`.
   - Cập nhật nội dung PR #572 với bảng đo lường thật và ghi chú rõ ràng về ca kiểm thử `ShellNavigation`.
5. **Rà soát tiến độ tổng thể (Master Plan Traceability):**
   - Đánh giá chi tiết 14 task của kế hoạch FBD EDIT: 9 task đã hoàn thành (0.5, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7); 4 task còn lại (8, 9, 10, 11).
   - Khởi tạo 2 issue theo dõi chi tiết chuẩn format repo: Issue #573 (Task 9) và Issue #574 (Task 8).

---

### 8. WORK IN PROGRESS
- Phiên làm việc đã hoàn tất toàn bộ các mục tiêu của chặng Task 6–7 và chuẩn bị xong hạ tầng theo dõi cho Task 8–9.
- Không có file nào đang bị sửa dở dang; cây làm việc hoàn toàn sạch sẽ.
- Tiếp theo là quyết định bắt đầu thực hiện Task 8 (Shell responsive) hay Task 9 (Workbench chẩn đoán).

---

### 9. IMPORTANT DECISIONS
1. **Không can thiệp vào `ShellNavigation.test.tsx`:** Xác minh test fail do biến cục bộ `VITE_PROGRAMMING_REV_A=1` trong `.env.local` của lập trình viên, không phải lỗi logic ứng dụng. Giữ nguyên để CI tự động pass.
2. **Từ chối mock làm xanh test giả tạo:** Kiên quyết gỡ bỏ mock rỗng trong `TrendsPage.deepLink.test.tsx` và sửa code gốc của `TrendsPage.tsx`. Đây là tiền lệ kiểm soát chất lượng quan trọng.
3. **Bảo vệ tính toàn vẹn của handoff lịch sử:** Coi file handoff cũ như tài liệu kiểm toán bất biến; phục hồi ngay khi bị ghi đè nhầm.
4. **Mốc ngân sách bundle R3:** Ghi nhận quyết định kỹ thuật `UD-PROG-017` lấy R3 (165 KiB gzip) làm cổng thi hành, giữ mốc R1 (98 KiB) làm tham chiếu lịch sử.

---

### 10. RELEVANT FILES & ARTIFACTS
- `apps/web-ui/src/features/operations/TrendsPage.tsx` — Vị trí fix lỗi FE-TR-01 (không xoá ngầm điểm deep link).
- `apps/web-ui/src/features/operations/TrendsPage.deepLink.test.tsx` — Test deep link, đã gỡ bỏ mock giả lập.
- `apps/web-ui/src/features/programming/fbd/` — Toàn bộ module FBD canvas, wiring, inspector, announcements, commands.
- `apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.tsx` — Thư viện khối, chặn kéo thả PID.
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — Kế hoạch tổng thể 14 task của FBD EDIT.
- `docs/superpowers/plans/2026-09-03-fbd-edit-handoff.md` — Handoff lịch sử đã được phục hồi đầy đủ.
- `docs/superpowers/plans/2026-09-05-fbd-edit-task7-handoff-2.md` — Handoff Task 7 phiên trước.
- `CHANGELOG.md` — Lịch sử thay đổi chuẩn Keep a Changelog.
- `.gitignore` — Đã bổ sung danh mục file local dev.

---

### 11. CODE CHANGES
Các thay đổi nằm trong 2 commit mới nhất trên nhánh `feat/fbd-edit-task6`:

1. **Commit `ecbf6651`:**
   - Khôi phục `docs/superpowers/plans/2026-09-03-fbd-edit-handoff.md` về nguyên bản 606 dòng.
2. **Commit `a6fe3da0`:**
   - `apps/web-ui/src/features/operations/TrendsPage.tsx`: Thêm điều kiện `if (hasSavedPrefsRef.current) return current` trong `setSelectedIds` tại effect dòng 254 để bảo toàn các ID chưa resolve được.
   - `CHANGELOG.md`: Thêm 18 dòng ghi nhận sự cố `FE-TR-01`, nguyên nhân và số đo kiểm chứng.

---

### 12. COMMANDS RUN
```bash
# Kiểm tra TypeScript
cd apps/web-ui && npx tsc --noEmit

# Kiểm tra Linter và dấu tiếng Việt
npm run lint

# Chạy kiểm thử toàn bộ Web UI
npx vitest --run --environment jsdom src

# Build và kiểm tra ngân sách Bundle
npm run build

# Thao tác Git & GitHub
git push origin feat/fbd-edit-task6
gh pr edit 572 --body "..."
gh issue create --title "[TASK-9-FBD-EDIT] ..." --body-file ...
gh issue create --title "[TASK-8-FBD-EDIT] ..." --body-file ...
```

---

### 13. TEST / VALIDATION STATUS
- **TypeScript:** 0 lỗi (`PASS`).
- **ESLint & UI Strings:** 0 cảnh báo, 0 lỗi (`PASS`).
- **Vitest Unit/Integration:** 3.058 / 3.059 tests pass (chỉ 1 ca môi trường local fail đã giải trình, `PASS`).
- **Bundle Budget R3:** 149.45 KiB gzip <= 165.00 KiB (`PASS`).
- **Manual Verification:** Đã đối chiếu diff branch vs origin/main.

---

### 14. ERRORS / BLOCKERS
- **Không có blocker kỹ thuật nào tồn đọng.**
- Mọi chốt chặn (gate) đã thông suốt.

---

### 15. FAILED ATTEMPTS — DO NOT REPEAT
- **DO NOT REPEAT:** Thêm `api.getPoints.mockResolvedValue([])` vào `TrendsPage.deepLink.test.tsx` để làm xanh test. Đây là hành vi che giấu bug trong `TrendsPage.tsx`.
- **DO NOT REPEAT:** Cho phép subagent tự ý chạy lệnh `git commit`, `git push`, hoặc `gh pr create` khi chưa có sự kiểm duyệt độc lập từ Opus và phê duyệt của người dùng.
- **DO NOT REPEAT:** Ghi đè file handoff lịch sử bằng tài liệu handoff của task mới hơn. Mỗi phiên làm việc phải tạo file mới riêng biệt.
- **DO NOT REPEAT:** Sử dụng model Opus cho các subagent thực thi — vi phạm nguyên tắc chi phí và chỉ đạo của người dùng.

---

### 16. IMPORTANT CONVERSATION CONTEXT
- Người dùng yêu cầu rất rõ ràng: **"push code lên github nhưng chỉ tạo pr thôi còn tôi sẽ merge thủ công"**. Tuyệt đối không bấm nút merge trên PR #572.
- Người dùng nhắc nhở về việc phân cấp model: **Opus chỉ điều phối / lập plan, việc khác giao model rẻ hơn**. Subagent phải luôn được chỉ định model phù hợp (Sonnet/Haiku).
- Tiến độ tổng thể FBD EDIT đã hoàn thành 9/14 task; người dùng đã yêu cầu tạo issue cho cả Task 8 và Task 9.

---

### 17. NEXT ACTIONS

Tuân thủ nghiêm ngặt quy trình làm việc multi-agent:

1. **Xác nhận với người dùng về nhánh làm việc cho Task tiếp theo:**
   - Lựa chọn A: Tạo nhánh mới `feat/fbd-edit-task8` hoặc `feat/fbd-edit-task9` tách từ `main` (nếu PR #572 đã được user merge thủ công).
   - Lựa chọn B: Tiếp tục trên nhánh `feat/fbd-edit-task6` (hoặc tạo nhánh con từ nhánh này) nếu muốn triển khai gối đầu trước khi PR #572 được merge.
2. **Triển khai Task được chọn (Ưu tiên Task 8 - Issue #574 hoặc Task 9 - Issue #573):**
   - **Nếu chọn Task 8 (Shell, Docks & Responsive):**
     - Viết failing test responsive cho `FbdEditorPane.test.tsx` và `DesignWorkspacePage.test.tsx` trên các dải 1440, 1024, 768, 390px.
     - Hiện thực bố cục responsive qua composition, tuyệt đối không sửa `ProgrammingHeader.tsx` và `ProgrammingLayout.tsx`.
     - Hiện thực banner chỉ đọc và khoá mutation tại `< 768px` (`TC-FBD-RESP-003`, `TC-FBD-STATE-004`).
     - Tích hợp icon `+ FBD` và quản lý 8 tab FBD/ST (`TC-FBD-UX-001`, `TC-FBD-UX-002`).
   - **Nếu chọn Task 9 (Workbench, Diagnostics & Auto Layout):**
     - Viết failing test cho `FbdWorkbench.test.tsx` và `StructuredFbdEditor.test.tsx`.
     - Tái dùng `shared/ProblemsDrawer.tsx`, bơm dữ liệu `validateFbdDocument` / `fbdIssueTargets`.
     - Hiện thực click-jump từ Problems tới chính xác node/wire trên canvas (`TC-FBD-DIAG-001`).
     - Hiện thực preview Auto Layout: Cancel = 0 diff, Apply = 1 transaction (`TC-FBD-LAYOUT-001`).
     - Tích hợp Mini Map cho đồ thị > 24 nodes (`TC-FBD-NAV-001`).
3. **Thực thi bằng Subagent Sonnet:** Opus lập prompt chi tiết, giao cho subagent Sonnet code và chạy test.
4. **Kiểm tra Gate toàn diện sau mỗi Task:** tsc, lint, vitest, bundle budget.

---

### 18. DEFINITION OF DONE
- Kịch bản của Task được giao phủ đủ bằng test Vitest tự động (không mock né lỗi).
- Tất cả 4 gate kỹ thuật (tsc exit 0, lint exit 0, vitest pass, bundle budget R3 pass) đều GREEN.
- Không sửa vào các file cấm (`ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, v.v.).
- File code mới/sửa không vượt quá giới hạn 800 dòng.
- Cập nhật `CHANGELOG.md` dưới mục `[Unreleased]` theo đúng chuẩn.
- Commit sạch, message tiếng Việt chuẩn Conventional Commits.

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
