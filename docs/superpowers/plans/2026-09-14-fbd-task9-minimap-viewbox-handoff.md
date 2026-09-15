# SESSION HANDOFF — Task 9 FBD: Fix viewBox Mini Map, Đồng Bộ Main, Thẩm Định Điều Kiện Đóng Issue #667

## 1. SESSION OBJECTIVE

- **Dự án**: MK-DDC-24 (Hệ thống điều khiển DDC công nghiệp & Web Studio lập trình PLC). Thư mục frontend: `apps/web-ui`.
- **Task gốc**: Task 9 — Issue #667 (`T9-FBD-PANEL-3COL`) — Panel Đáy 3 Cột + Mini Map cho FBD Editor.
  + T9-01: Grid khay làm việc 2 cột → 3 cột, lưu `{open, height}` vào `localStorage` key `mkddc:programming-workbench:v1`, mở sẵn desktop ≥ 1440px.
  + T9-02: Di dời Mini Map từ góc canvas (`FbdCanvas.tsx`) vào Cột 3 panel đáy (`WorkbenchMinimapPanel.tsx`), 3 nút zoom (`-`, `+`, `Vừa khung`) + nhãn tỷ lệ %.
  + T9-03: Rút gọn khay đáy còn đúng 4 tab (`Vấn đề`, `Tìm kiếm`, `Tham chiếu`, `Watch`), bỏ tab `Trace`.
- **Phiên này (2026-09-14) đã làm 5 việc theo yêu cầu tuần tự của user**:
  1. Sửa 2 E2E fail trong `programming-workspace-height.spec.ts` theo phương án user chốt.
  2. Lấy code mới nhất từ `origin/main` về local, kiểm tra xung đột và **báo cáo chi tiết theo từng tính năng** (user cấm báo cáo chung chung).
  3. Tạo nhánh mới từ `origin/main`, chỉ giữ lại fix viewBox Mini Map.
  4. Đo lại bundle budget + kiểm thị giác trên đúng nền `origin/main` mới.
  5. Commit + push + mở PR #706.
- **Việc cuối cùng đã hoàn tất**: Trả lời câu hỏi *"đã đủ điều kiện đóng task 9 hay chưa?"* → **Phán quyết: CHƯA ĐỦ**, kèm 4 lý do có bằng chứng.
- **Kết quả mong muốn tiếp theo**: User review + merge PR #706, sau đó quyết định đóng Issue #667.

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### 2.1 Nguyên tắc phân vai Opus vs Subagent (BẮT BUỘC, giữ nguyên hiệu lực)

Nguyên văn user: *"ghi nhớ rằng opus chỉ lên plan / điều phối chứ không được tự làm các công việc khác, phải để cho các model yếu hơn làm việc"*

- Opus **CHỈ** giữ vai trò: kiến trúc, lập kế hoạch, điều phối quy trình, xác minh kết quả subagent.
- **100%** công việc đọc hiểu sâu code, đo đạc ảnh, viết test, chỉnh sửa code, chạy lệnh kiểm thử **PHẢI** giao subagent Sonnet / Haiku.
- Nghiêm cấm Opus tự chạy `git`, tự đọc code bằng Read/Grep để phân tích, tự sửa file.

### 2.2 Danh sách file CẤM SỬA

- `ProgrammingHeader.tsx`
- `ProgrammingLayout.tsx`
- `contracts/**`
- `scripts/**`
- `apps/core/**`
- `apps/web-api/**`
- `firmware/**`
- `apps/web-ui/package.json`
- `apps/web-ui/.env.local`

### 2.3 Quy tắc bảo toàn kiểm thử (Non-weakening Invariant)

- Tuyệt đối không dùng `.skip`, `.only`, `.todo`.
- Không xoá test, không nới lỏng matcher, không sửa assertion để test xanh.
- 100% test case hiện có của `FbdCanvas.test.tsx` (`AC-FBD-012`, `TC-FBD-NAV-001`) phải tiếp tục xanh mà không bị sửa assertion.

### 2.4 Quy tắc Git & PR

- Chỉ commit hoặc push **khi user yêu cầu**.
- Khi ở nhánh mặc định (`main`), bắt buộc tạo branch riêng trước khi commit.
- **Tuyệt đối không tự merge PR vào `main`.**
- **Tuyệt đối không tự đóng Issue #667.** Thân issue #667 có ghi khoá tường minh: *"Issue này không được tự đóng. Phải hỏi rõ ý kiến người giao việc trước khi close."*
- Giải quyết triệt để conflict trước khi mở PR, đặc biệt `CHANGELOG.md`.
- PR dùng `Refs #667`, **KHÔNG** dùng `Closes #667` (tránh GitHub tự đóng issue khi merge).

### 2.5 Yêu cầu báo cáo xung đột (user nhấn mạnh đặc biệt)

Nguyên văn: *"lấy code mới nhất từ nhánh main về local rồi kiểm tra xung đột (nễu có xung đột ở đâu thì phải báo cho tôi chi tiết để biết giữ cái gì) (không có được báo cáo chung chung là khác phần nào mà phải chi tiết tính năng)"*

→ Báo cáo xung đột phải nêu **từng tính năng cụ thể**, không được viết "khác ở file X". Phải nói rõ phần nào làm gì, bản nào đúng hơn, giữ cái nào.

### 2.6 Tiêu chuẩn Frontend & CSS

- Tailwind CSS v4: ưu tiên literal class tĩnh, cấm nối chuỗi class động. **Lưu ý**: main đã phải chuyển sang inline style JS cho grid 3 cột do lỗi cascade v4 (xem mục 9.4).
- Chuỗi giao diện tiếng Việt: có dấu đúng chuẩn, vượt `scripts/check_ui_strings.py`.
- Ngân sách Bundle R3: chunk `programming-*.js` ≤ 165.00 KiB gzip (`scripts/verify_programming_bundle_budget.py --increment r3`).
- WAI-ARIA: đầy đủ `role="tablist"`, `role="tab"`, `role="tabpanel"`, `role="group"`, `aria-selected`, `aria-controls`, `aria-keyshortcuts`.

### 2.7 Các quyết định user đã chốt trong phiên này (qua AskUserQuestion)

| Câu hỏi | Lựa chọn của user |
|---|---|
| Cách sửa E2E Fail 2 | "Đo từ trạng thái khay Mửe (Khuyến nghị)" — mở khay đáy trước khi đo `before`, GIỮ NGUYÊN ngưỡng `>= 2` |
| Phạm vi sửa | "Sửa cả 2 fail trong Task 9 (Khuyến nghị)" |
| Phạm vi giữ lại sau khi sync main | "Chỉ giữ fix viewBox Mini Map (Khuyến nghị)" |
| Cách đồng bộ main | "Tạo nhánh mới từ origin/main (Khuyến nghị)" |
| Trước khi commit | "Đo lại cả hai rồi commit (Khuyến nghị)" — đo lại bundle + kiểm thị giác trên nền main mới |
| Kết phiên | "Commit + push + mở PR (Khuyến nghị)" |

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW

1. **Kiểm tra và tuân thủ vai trò**: Opus lập workflow và điều phối; Sonnet/Haiku thực thi 100% công việc tay chân.
2. **TDD (Test-Driven Development)**:
   - Viết test failing trước (Red phase).
   - Viết mã nguồn tối thiểu để test pass (Green phase).
   - Kiểm chứng toàn bộ suite regression và static check.
3. **Review độc lập**: Subagent reviewer chạy `git diff`, kiểm file cấm, kiểm assertion không bị làm yếu, kiểm Tailwind class.
4. **Rebase & Chống xung đột**: Luôn `git fetch origin main` và xử lý conflict `CHANGELOG.md` tại nhánh local trước khi mở PR.
5. **Chờ phê duyệt**: Không tự merge PR, không tự đóng issue, hỏi ý kiến user rõ ràng.

### SESSION-ESTABLISHED WORKFLOW (hình thành và dùng ổn định trong phiên này)

1. **Mọi thao tác git/đọc code/chạy lệnh đều giao subagent Sonnet qua tool `Agent`**, kèm prompt có 4 khối bắt buộc: NHIỆM VỤ / VIỆC CẦN LÀM / CẤM (liệt kê tường minh từng lệnh cấm) / ĐẦU RA (giới hạn số từ).
2. **Agent phân tích = read-only tuyệt đối**: prompt phải liệt kê rõ cấm `git checkout`, `git switch`, `git stash`, `git reset`, `git merge`, `git rebase`, `git pull`, `git clean`, `gh pr merge`, `gh issue close`, `gh pr close`.
3. **Mọi kết luận phải có bằng chứng `file:dòng` hoặc output lệnh thật.** Không chấp nhận suy đoán.
4. **Khi nghi ngờ kết luận của chính mình → giao subagent kiểm chứng độc lập lần 2**, so hai bản. Đã dùng 2 lần trong phiên, cả 2 lần đều khớp nguyên vẹn.
5. **Trước mỗi lần đo bundle: bắt buộc `rm -rf build/web-ui/dist` + build lại + xác minh hash artifact MỚI khác hash cũ.** Script chỉ đọc artifact có sẵn, không tự build.
6. **Trước khi checkout nhánh mới: sao lưu 2 file patch dự phòng** vào `/tmp/`.

### WORKFLOW INVARIANTS (không được phá vỡ)

- Không sửa file khi chưa đọc file.
- Không tự ý mở rộng phạm vi ra ngoài T9-01, T9-02, T9-03.
- Bọc toàn bộ tương tác `localStorage` trong `try/catch`.
- `showInlineMinimap` trên `FbdCanvas` mặc định `true` để giữ tương thích ngược với 5 unit test cũ.
- Khi `git checkout -b` báo file sẽ bị ghi đè: **DỪNG, báo user, không tự dùng `-f` hay `git stash`.**
- Mỗi thay đổi phải verify trước khi chuyển bước tiếp theo.
- Không tự đảo ngược quyết định user đã chốt.

---

## 4. CURRENT WORKFLOW POSITION

```
Workflow Task 9:
[1. Khảo sát & Đo ảnh PGM-02B] → [2. T9-01] → [3. T9-02] → [4. T9-03] → [5. Sync main & Commit]
  → [6. Tạo PR] → [7. QA & Merge vào main] → [8. Đóng Issue #667]

Completed:         [1] [2] [3] [4] [5] [6]
                   + Vòng bổ sung phiên 2026-09-14: sửa E2E → sync main lần 2 → tạo nhánh sạch
                     → đo lại bằng chứng → commit 0e5ed12a → push → mở PR #706
                   + Thẩm định điều kiện đóng issue (2 lần kiểm chứng độc lập, kết quả khớp)
Currently working: [7] QA — PR #706 đang OPEN, chờ user review & merge
Next:              [7] User merge PR #706 → commit docs untracked → duyệt ngoại lệ T9-02
                   → chạy lại suite trên main → [8] User quyết định đóng Issue #667
```

**Đang ở đâu trong bước [7]**: Đã mở PR #706 và đã hoàn tất thẩm định điều kiện đóng. Phần còn lại của bước [7] **thuộc quyền user** (merge PR) — agent không được tự làm.

---

## 5. WORKSPACE / ENVIRONMENT

- **Primary working directory của session**: `e:\TuanDuong\INTERN\DDC24_project`
- **Repo gốc**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Repository GitHub**: `Mekong-HCM/MK-DDC-24`
- **Branch hiện tại**: `feat/fbd-minimap-viewbox-bbox` (tracking `origin/feat/fbd-minimap-viewbox-bbox`)
- **HEAD**: `0e5ed12ac04a39d8e738f3174293708ed1062431`
- **Base**: `bd2945b8` = đỉnh `origin/main` hiện tại
- **Nhánh đi trước main**: đúng 1 commit (`0e5ed12a`)
- **Các nhánh liên quan còn tồn tại**:
  + `feat/fbd-minimap-viewbox-bbox` (local + remote) — nhánh hiện tại
  + `feat/fbd-task9-bottom-panel-3col` (local + remote) — nhánh cũ Task 9, PR #683 đã merged, **giữ nguyên không xoá**
- **Toolchain**: Node.js, npm/pnpm, Vite 5, Vitest 4, TypeScript 5.6, Python 3, Playwright
- **OS**: Windows 11 Home Single Language 10.0.26200 (win32), shell Git Bash
- **Không có secret nào cần ghi trong handoff này.**

---

## 6. CURRENT VERIFIED STATE

### VERIFIED

**Git & PR:**
- Branch `feat/fbd-minimap-viewbox-bbox`, HEAD `0e5ed12a`, đi trước `origin/main` đúng 1 commit.
- Commit `0e5ed12a`: 3 file, **+292 / −24**:
  + `CHANGELOG.md` (+1)
  + `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx` (+158)
  + `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx` (+157 / −24)
- **PR #706**: OPEN, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, `reviewDecision: ""` (chưa ai duyệt). URL: https://github.com/Mekong-HCM/MK-DDC-24/pull/706. Base `main`, head `feat/fbd-minimap-viewbox-bbox`. Dùng `Refs #667`.
- **PR #706 là PR duy nhất đang mở** trên repo.
- **PR #683**: MERGED lúc `2026-09-12T16:38:38Z`.
- **Issue #667**: OPEN, labels `enhancement`, `priority:medium`, `programming-ui`, `state:ready`, `role:implementer`.
- Không file untracked nào bị lọt vào commit `0e5ed12a`.
- 2 file patch dự phòng còn nguyên: `/tmp/mkddc-minimap-keep.patch` (18,573 bytes), `/tmp/mkddc-uncommitted-backup.patch` (22,908 bytes).

**Đo kiểm trên đúng nền `bd2945b8`:**
- Vitest `features/programming/design/workbench/`: **77/77 PASS**
- `tsc --noEmit`: **exit 0**
- `python scripts/check_ui_strings.py`: **PASS**
- Bundle Budget R3: **157.57 / 165.00 KiB gzip**, dư 7.43 KiB — **PASS** (hash artifact `2Qr24GMN`, đã xác minh là artifact build MỚI)
- Kiểm thị giác Mini Map: **ĐẠT** — khối FBD chiếm 86.12% chiều ngang / 63.16% chiều dọc khung thumbnail; viewBox thực tế `-25 -25 706 266`
- Reviewer độc lập kết luận diff test **SẠCH** (10/10 checklist, không có assertion bị làm yếu)

**Thẩm định trên `origin/main` (`bd2945b8`) — đã kiểm chứng 2 lần độc lập, kết quả khớp nguyên vẹn:**

| Tiêu chí | Trạng thái trên main | Bằng chứng |
|---|---|---|
| T9-01 Grid 3 cột ≥1440px | **ĐẠT MỘT PHẦN** | `ProgrammingWorkbench.tsx:430-435` — inline style JS thay Tailwind class. Hành vi đúng. |
| T9-01 đủ 3 `data-testid` cột | ĐẠT | `ProgrammingWorkbench.tsx:437, 492, 515` |
| T9-01 `localStorage {open,height}` | ĐẠT | `ProgrammingWorkbench.tsx:106, 128, 283` |
| T9-01 đóng → reload → vẫn đóng | ĐẠT | `ProgrammingWorkbench.tsx:130` (`validOpen`) |
| T9-01 mặc định mở ≥1440px | ĐẠT | `ProgrammingWorkbench.tsx:117-124` (`isDesktop`, mở sẵn 173px) |
| T9-02 Mini Map Cột 3 | ĐẠT | `ProgrammingWorkbench.tsx:514-518` |
| T9-02 3 nút zoom + % | ĐẠT | `WorkbenchMinimapPanel.tsx:86-118` |
| T9-02 click điều hướng canvas | ĐẠT | `WorkbenchMinimapPanel.tsx:135-156` |
| **T9-02 `grep data-fbd-minimap` = 0** | **KHÔNG ĐẠT** | `FbdCanvas.tsx:959` — còn markup inline. Tổng **7** kết quả trên `apps/web-ui/src`, riêng `FbdCanvas.tsx` là **1**. |
| T9-03 `TabId` 4 giá trị | ĐẠT | `ProgrammingWorkbench.tsx:137` |
| T9-03 4 tab, bỏ Trace | ĐẠT | `ProgrammingWorkbench.tsx:298-305` |
| T9-03 E2E `.toBe(4)` | ĐẠT | `apps/web-ui/e2e/programming.spec.ts:1831` |

**Lỗi thumbnail Mini Map trên `origin/main`: CHƯA FIX.**
- Lệnh: `git show origin/main:apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx | grep -n "computeMinimapViewBox\|MINIMAP_PADDING_RATIO"`
- Kết quả: **0 dòng**.
- `origin/main` dòng 131 vẫn dùng `viewBox="0 0 ${bridge.width} ${bridge.height}"`. Canvas cao tối thiểu 1600px ép cụm khối co về ~8% → hiển thị thành ô đen/rỗng.

**Docs untracked:**
- `docs/superpowers/plans/`: **19 file thật, chỉ 9 file được git track → 10 file untracked**, trong đó có 3 file hồ sơ Task 9:
  + `2026-09-11-fbd-task9-issue.md` (file acceptance criteria gốc)
  + `2026-09-11-fbd-edit-task9-replan.md`
  + `2026-09-12-fbd-task9-panel-3col-handoff.md`

### UNVERIFIED

- **Chưa chạy được test cô lập trực tiếp trên `origin/main`.** Lý do: working tree đang ở `feat/fbd-minimap-viewbox-bbox`, quy tắc cấm agent `git checkout` để bảo vệ file chưa commit. Sẽ chạy được sau khi PR #706 merge.
- **Chưa có phê duyệt bằng văn bản của reviewer** cho ngoại lệ `data-fbd-minimap` ≠ 0.
- **Chưa kiểm thị giác Mini Map trên `main` sau merge** — chỉ mới kiểm trên nhánh `feat/fbd-minimap-viewbox-bbox`.

---

## 7. COMPLETED WORK

### 7.1 Sửa 2 E2E fail (bước [5] — SAU ĐÓ ĐÃ BỎ, xem mục 9.2)

- File: `apps/web-ui/e2e/programming-workspace-height.spec.ts`
- **Fail 1** (dòng 100): selector toàn cục `document.querySelector('[role="tabpanel"]')` bắt nhầm `<div role="tabpanel">` của `AttributesSection.tsx:63`. **Lỗi của TEST, không phải lỗi code** — khay đáy thực tế đã đóng đúng ở 1280×800. Lỗi này vốn đã đỏ sẵn trên `main` từ trước nhánh Task 9.
- **Fail 2** (dòng 144): `614/333 = 1.84×` < ngưỡng `>= 2`. Hệ quả của việc khay đóng mặc định làm editor `before` tăng 254px → 333px; trần `after` là 614px (viewport 800 − chrome ~186) nên 2× bất khả thi.
- Fix đã làm: thêm `data-testid="programming-workbench-tabpanel"` + `addInitScript` set localStorage mở sẵn khay + fallback click "Mở rộng khay" + `expect(...).toBeVisible()` chặn. Kết quả **8/8 PASS**.
- **Đã bỏ** vì main tự sửa cùng bug bằng cách khác.

### 7.2 Đồng bộ `origin/main` và báo cáo xung đột chi tiết theo tính năng (bước [5])

- `git fetch origin main` → phát hiện nhánh cũ lạc hậu **72 commit**.
- Dùng `git merge-tree --write-tree` dry-run (không ghi working tree) để dò conflict.
- Báo cáo chi tiết từng tính năng cho user, không báo chung chung.
- Phát hiện **xung đột ngữ nghĩa ngầm** ở `LiveFbdView.performance.test.tsx` — git không sinh conflict marker nhưng test vẫn fail.

### 7.3 Tạo nhánh sạch từ `origin/main`, chỉ giữ fix viewBox (bước [5])

- Sao lưu 2 patch dự phòng vào `/tmp/` trước khi thao tác.
- `git checkout -b feat/fbd-minimap-viewbox-bbox` từ `bd2945b8`.
- Bỏ 4 file thuộc danh sách BỎ bằng `git checkout --` (không dùng `-f`, không dùng `stash`).
- Viết lại 1 dòng `CHANGELOG.md` trên nền main mới.

### 7.4 Đo lại bằng chứng trên nền `bd2945b8` (bước [5])

- `rm -rf build/web-ui/dist` + build lại + xác minh hash artifact mới (`2Qr24GMN`).
- Bundle: **157.57 / 165.00 KiB** PASS (lệch **+2.32 KiB** so với số cũ 155.25 — số cũ đo trên artifact lỗi thời).
- Kiểm thị giác chụp lại trên `bd2945b8`: **giống hệt** nền cũ (86.12% / 63.16%, viewBox `-25 -25 706 266`). Hợp lý vì document fixture giữ nguyên toạ độ và `computeMinimapViewBox` là hàm tất định trên bbox.

### 7.5 Commit + push + mở PR (bước [6])

- Commit `0e5ed12a`, push lên `origin/feat/fbd-minimap-viewbox-bbox`.
- Mở PR #706 vào `main`, dùng `Refs #667`.
- Ghi điểm lệch tiêu chí T9-02 vào mô tả PR.

### 7.6 Thẩm định điều kiện đóng Issue #667 (bước [7])

- Giao subagent Sonnet read-only kiểm chứng toàn bộ tiêu chí trên `origin/main`.
- **Chạy kiểm chứng 2 lần độc lập**, hai bản kết quả **khớp nguyên vẹn** (mọi con số, mọi `file:dòng`).
- Phán quyết: **CHƯA ĐỦ ĐIỀU KIỆN ĐÓNG**, kèm 4 lý do có bằng chứng (xem mục 14).

---

## 8. WORK IN PROGRESS

**Không có công việc code nào đang dở.** Working tree sạch về phía các file thuộc phạm vi Task 9.

Trạng thái treo duy nhất: **PR #706 đang OPEN chờ user review + merge**. Đây là hành động thuộc quyền user, agent không được tự làm.

17 file untracked trong `git status --short` (xem mục 10) — **không thuộc phạm vi Task 9**, chưa được user yêu cầu commit. Riêng 3 file hồ sơ Task 9 trong `docs/superpowers/plans/` là khoảng trống bằng chứng đã báo user, chờ user cho phép commit.

---

## 9. IMPORTANT DECISIONS

### 9.1 Chỉ giữ fix viewBox Mini Map, bỏ 3 thay đổi còn lại (USER CHỐT)

- **Lý do**: Nhánh cũ lạc hậu 72 commit khiến 2/3 thay đổi trùng với việc `main` đã tự làm bằng cách khác (và tốt hơn).
- **Bỏ**: fix E2E spec (main tự sửa bằng `[id^="workbench-panel-"]`), `LiveFbdView.tsx` (fix của tôi là regression), `ProgrammingWorkbench.tsx` (main dùng hook JS tốt hơn), `LiveFbdView.performance.test.tsx`.
- **Giữ**: `WorkbenchMinimapPanel.tsx` + test — giá trị độc nhất, main có **0 commit** đụng file này (đã kiểm bằng `git log --oneline origin/main -- <file>`, chỉ thấy `45248380` là commit tạo file).

### 9.2 Tạo nhánh mới từ `origin/main` thay vì rebase (USER CHỐT)

- **Lý do**: rebase 72 commit với 4 file xung đột rủi ro cao. Nhánh mới sạch, diff tối thiểu, dễ review.
- **Alternative đã loại**: `git rebase origin/main`, `git merge origin/main`.

### 9.3 Prop `showInlineMinimap` trên `FbdCanvas` giữ mặc định `true`

- **Lý do**: giúp 5 unit test cũ trong `FbdCanvas.test.tsx` chạy độc lập và xanh 100% mà không bị sửa assertion.
- **Hệ quả**: `grep data-fbd-minimap` ≠ 0 → lệch tiêu chí T9-02. Đã ghi vào mô tả PR #706, **cần reviewer duyệt ngoại lệ**.

### 9.4 Main chuyển Tailwind v4 class → inline style JS cho grid 3 cột (quyết định của main, không phải của phiên này)

- Commit `81bebd47` (PR #704). Main bỏ `min-[1440px]:grid-cols-[minmax(0,1fr)_375px_458px]`, chuyển sang inline style `gridTemplateColumns: 'minmax(0,1fr) 375px 458px'` qua hook `useWorkbenchOwnsMinimap()`.
- **Lý do của main**: lỗi cascade Tailwind v4 ghi đè.
- **Lệch** so với ràng buộc 2.6 trong handoff cũ, nhưng **hành vi đúng**. Đã báo user, user chưa yêu cầu sửa.

### 9.5 Công thức viewBox bám bounding box (giá trị cốt lõi của PR #706)

```
minX = min(node.x), minY = min(node.y)
maxX = max(node.x + node.width), maxY = max(node.y + node.height)
rawW = max(MINIMAP_MIN_DIMENSION, maxX - minX)
rawH = max(MINIMAP_MIN_DIMENSION, maxY - minY)
padding = max(MINIMAP_MIN_PADDING, round(max(rawW, rawH) * MINIMAP_PADDING_RATIO))
viewBox = { x: minX - padding, y: minY - padding, w: rawW + 2*padding, h: rawH + 2*padding }
```

Xác minh số học khớp thực tế: bbox node `x=24, y=24, w=608, h=168` → `padding = max(24, round(608*0.08)) = 49` → viewBox `-25 -25 706 266`. Đúng (`24−49 = −25`, `608+2*49 = 706`).

Clamp viewport indicator quy chiếu theo viewBox bbox MỚI (không dùng `bridge.width/height`):
```ts
const indicatorW = Math.min(viewBox.width, Math.max(10, vpW))
const indicatorH = Math.min(viewBox.height, Math.max(10, vpH))
const indicatorX = Math.max(viewBox.x, Math.min(viewBox.x + viewBox.width - indicatorW, vpX))
const indicatorY = Math.max(viewBox.y, Math.min(viewBox.y + viewBox.height - indicatorH, vpY))
```

### 9.6 PR dùng `Refs #667` thay vì `Closes #667`

- **Lý do**: tránh GitHub tự đóng Issue #667 khi merge PR, vi phạm ràng buộc user và khoá tường minh trong thân issue.

---

## 10. RELEVANT FILES & ARTIFACTS

### File đã commit trong `0e5ed12a`

- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx` — **Giá trị độc nhất của PR #706.** Chứa `MINIMAP_MIN_DIMENSION` (dòng 23), `MINIMAP_PADDING_RATIO` (dòng 24), `MINIMAP_MIN_PADDING` (dòng 25), `computeMinimapViewBox` (dòng 34), `minimapClientToGraphCoordinates` (dòng 64).
- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx` — Thêm 5 test: hộp bao chuẩn, hộp bao suy biến, điều hướng khi click, kẹp khung khi thu nhỏ xa, hồi quy viewport nhỏ hơn viewBox. 5 test cũ giữ nguyên, 0 assertion bị sửa.
- `CHANGELOG.md` — Thêm 1 dòng dưới mục `### Added — Task 9`, ngay dưới dòng T9-03.

### File trên `main` liên quan (KHÔNG sửa trong phiên này)

- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` — Grid 3 cột, 4 tab, localStorage, mount Cột 3. Dòng tham chiếu: `106`, `117-124`, `128`, `130`, `137`, `283`, `298-305`, `430-435`, `437`, `492`, `514-518`, `515`.
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx:959` — Còn markup `data-fbd-minimap` inline sau prop `showInlineMinimap`. **Điểm lệch T9-02.**
- `apps/web-ui/src/features/programming/design/LiveFbdView.tsx` — Main dùng `showInlineMinimap={!workbenchOwnsMinimap}` (commit `81bebd47`, PR #704). **Đúng hơn bản local cũ.**
- `apps/web-ui/src/features/programming/design/inspector/sections/AttributesSection.tsx:63` — `<div role="tabpanel">` bị selector E2E toàn cục bắt nhầm. **CẤM SỬA** (cần cho a11y).
- `apps/web-ui/e2e/programming-workspace-height.spec.ts` — Main (`2d22f3a7`) đã tự sửa bằng `[id^="workbench-panel-"]` và đổi test toàn màn hình sang đo tuyệt đối `geometry.viewport - after <= FULLSCREEN_CHROME_BUDGET_PX` (220px) kèm `after > before`.
- `apps/web-ui/e2e/programming.spec.ts:1831` — `expect(count, ...).toBe(4)`.

### Artifact dự phòng

- `/tmp/mkddc-minimap-keep.patch` (18,573 bytes) — đã xác minh chứa `computeMinimapViewBox` + `MINIMAP_PADDING_RATIO`.
- `/tmp/mkddc-uncommitted-backup.patch` (22,908 bytes) — toàn bộ thay đổi chưa commit trước khi sync main.

### Docs UNTRACKED trong `docs/superpowers/plans/` (10 file, liên quan Task 9 có 3)

- `2026-09-11-fbd-task9-issue.md` — **File acceptance criteria gốc Task 9. Người clone repo không đọc được.**
- `2026-09-11-fbd-edit-task9-replan.md`
- `2026-09-12-fbd-task9-panel-3col-handoff.md`
- (7 file khác: `2026-09-08-fbd-edit-task8-9-redo-handoff.md`, `2026-09-09-fbd-edit-task8-9-implementation-plan.md`, `2026-09-09-fbd-edit-task8-9-plan-handoff.md`, `2026-09-10-fbd-edit-task8-handoff-2.md`, `2026-09-10-fbd-edit-task8-handoff.md`, `2026-09-10-fbd-quick-library-handoff.md`, `2026-09-11-fbd-wiring-foxlinx-deploy-handoff.md`)

### Untracked khác ngoài phạm vi Task 9 (KHÔNG commit nếu user không yêu cầu)

`.claude/skills/foxlinx-deploy/`, `.claude/skills/webview/`, `apps/web-ui/playwright.headed-view.config.ts`, `apps/web-ui/pnpm-lock.yaml`, `apps/web-ui/test-results/`, `docs/03_implementation/DEPLOY_FOXLINX.md`, `tools/smoke-local-api.sh`, `tools/start-local-api.sh`

### Link

- PR #706: https://github.com/Mekong-HCM/MK-DDC-24/pull/706
- Ảnh thiết kế gốc: `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png`

---

## 11. CODE CHANGES

### `WorkbenchMinimapPanel.tsx` (+157 / −24)

- **Thêm hằng số**: `MINIMAP_MIN_DIMENSION` (23), `MINIMAP_PADDING_RATIO` (24), `MINIMAP_MIN_PADDING` (25).
- **Thêm hàm `computeMinimapViewBox`** (34): dựng viewBox theo hộp bao các node FBD + padding tỷ lệ, thay vì `viewBox="0 0 ${bridge.width} ${bridge.height}"`.
- **Thêm hàm `minimapClientToGraphCoordinates`** (64): quy đổi toạ độ chuột → toạ độ đồ thị theo viewBox mới.
- **Sửa clamp viewport indicator**: quy chiếu theo viewBox bbox MỚI thay vì `bridge.width/height`.
- **Lý do**: canvas cao tối thiểu 1600px ép cụm khối co về ~8% khung thumbnail → hiển thị ô đen/rỗng.
- **Side effect**: mọi phép quy đổi toạ độ click/drag phải dùng `minimapClientToGraphCoordinates`, không được dùng công thức cũ.
- **Phụ thuộc**: `bridge.nodes` phải có `{x, y, width, height}`. POU ST không có → giữ nguyên placeholder "Bản đồ thu nhỏ chỉ khả dụng cho sơ đồ khối FBD".

### `WorkbenchMinimapPanel.test.tsx` (+158)

- Thêm 5 test mới, giữ nguyên 5 test cũ, **0 assertion bị sửa**.

### `CHANGELOG.md` (+1)

```
- Mini Map Cột 3 dựng viewBox theo hộp bao các khối FBD kèm lề, thay cho toàn bộ khung canvas, để khối hiển thị rõ trong khay đáy dẹt.
```

---

## 12. COMMANDS RUN

```bash
# Đồng bộ main (an toàn — fetch không đụng working tree)
git fetch origin main
git merge-tree --write-tree <base> <ours> <theirs>   # dry-run dò conflict

# Sao lưu trước khi checkout
git diff > /tmp/mkddc-uncommitted-backup.patch
git diff -- apps/web-ui/src/features/programming/design/workbench/ > /tmp/mkddc-minimap-keep.patch

# Tạo nhánh sạch
git checkout -- <4 file thuộc danh sách BỎ>
git checkout -b feat/fbd-minimap-viewbox-bbox

# Kiểm chứng
cd apps/web-ui && npx vitest --run src/features/programming/design/workbench/
cd apps/web-ui && npx tsc --noEmit
python scripts/check_ui_strings.py

# Bundle — BẮT BUỘC xoá artifact cũ trước
rm -rf build/web-ui/dist
cd apps/web-ui && npm run build
PYTHONUTF8=1 python scripts/verify_programming_bundle_budget.py --increment r3

# Commit & PR
git commit -m "fix(programming-ui): Mini Map dựng viewBox theo hộp bao khối FBD thay vì toàn canvas"
git push -u origin feat/fbd-minimap-viewbox-bbox
gh pr create --base main --head feat/fbd-minimap-viewbox-bbox   # dùng "Refs #667"

# Thẩm định (read-only)
git show origin/main:apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx | grep -n "computeMinimapViewBox\|MINIMAP_PADDING_RATIO"
git grep "data-fbd-minimap" origin/main -- apps/web-ui/src | wc -l
gh pr view 706 --json state,mergeable,mergeStateStatus,reviewDecision
gh issue view 667 --json state,title,labels
```

---

## 13. TEST / VALIDATION STATUS

Đo trên nhánh `feat/fbd-minimap-viewbox-bbox`, nền `bd2945b8`:

| Hạng mục | Kết quả |
|---|---|
| Vitest `design/workbench/` | **PASS 77/77** |
| `tsc --noEmit` | **PASS** (exit 0) |
| `check_ui_strings.py` | **PASS** |
| Bundle Budget R3 | **PASS** — 157.57 / 165.00 KiB, dư 7.43 KiB, hash `2Qr24GMN` |
| Kiểm thị giác Mini Map | **ĐẠT** — 86.12% ngang / 63.16% dọc, viewBox `-25 -25 706 266` |
| Review diff độc lập | **SẠCH** — 10/10 checklist |

**CHƯA CHẠY / CHƯA VERIFY:**
- E2E `programming-workspace-height.spec.ts` trên nhánh mới — chưa chạy (thay đổi E2E đã bỏ, main tự sửa).
- `npm run check:programming-contracts` trên nhánh mới — chưa chạy lại trong phiên này.
- Test cô lập trực tiếp trên `origin/main` — **BỎ QUA** do quy tắc cấm `git checkout` trong agent.
- Kiểm thị giác trên `main` sau merge — chưa làm được vì #706 chưa merge.

---

## 14. ERRORS / BLOCKERS

### BLOCKER 1 — Lỗi thumbnail Mini Map vẫn tồn tại trên `main` (chặn chính)

- **Hiện tượng**: Mini Map Cột 3 hiển thị ô đen/rỗng.
- **Nguyên nhân đã xác định**: `origin/main` dòng 131 của `WorkbenchMinimapPanel.tsx` vẫn dùng `viewBox="0 0 ${bridge.width} ${bridge.height}"`. Canvas cao ≥1600px ép cụm khối co về ~8%.
- **Bằng chứng**: `git show origin/main:.../WorkbenchMinimapPanel.tsx | grep -n "computeMinimapViewBox\|MINIMAP_PADDING_RATIO"` → **0 dòng**.
- **Fix**: nằm trong PR #706, **đang OPEN chưa merge**.
- **Cần user**: review + merge PR #706.

### BLOCKER 2 — Tiêu chí T9-02 `grep data-fbd-minimap = 0` KHÔNG ĐẠT

- **Con số thật trên main**: **7** tổng trên `apps/web-ui/src`, riêng `FbdCanvas.tsx` là **1** (dòng 959).
- **Nguyên nhân**: giữ có chủ đích để 5 test cũ của `FbdCanvas.test.tsx` không gãy (quyết định 9.3).
- **Cần**: reviewer chấp thuận ngoại lệ **bằng văn bản trên issue #667**. Không phải quyết định của agent.

### BLOCKER 3 — Tài liệu nghiệm thu chưa vào git

- 3 file hồ sơ Task 9 trong `docs/superpowers/plans/` đang untracked.
- **Hệ quả**: người clone repo về không đọc được tiêu chí nghiệm thu.
- **Cần user**: cho phép commit.

### ĐIỂM LỆCH (không chặn) — T9-01 dùng inline style thay Tailwind class

- `ProgrammingWorkbench.tsx:430-435` dùng inline style JS thay `min-[1440px]:grid-cols-[...]`.
- **Hành vi đúng** — 3 cột hiện ở ≥1440px. Chỉ lệch cách làm, do lỗi cascade Tailwind v4.
- Đã báo user, user chưa yêu cầu sửa.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT

- **DO NOT REPEAT**: Opus tự chạy `git`, tự đọc code phân tích, tự sửa code. **Bắt buộc 100% giao subagent Sonnet/Haiku.**
- **DO NOT REPEAT**: Hardcode `showInlineMinimap={false}` trong `LiveFbdView.tsx`. **Đó là regression** — làm mất minimap ở màn <1440px (khi khay đáy không mount Cột 3). Main dùng `showInlineMinimap={!workbenchOwnsMinimap}` mới đúng.
- **DO NOT REPEAT**: Chạy `verify_programming_bundle_budget.py` mà không xoá `build/web-ui/dist` và build lại. **Đã mắc 3 lần**, cho 3 con số sai liên tiếp (154.78 → 155.24 → 155.25), số đúng là **157.57**. Script CHỈ đọc artifact có sẵn, KHÔNG tự build.
- **DO NOT REPEAT**: Dùng `git checkout -f` hoặc `git stash` khi `git checkout -b` báo file sẽ bị ghi đè. **Phải dừng, báo user.**
- **DO NOT REPEAT**: Canvas tự dò ngữ cảnh để ẩn inline minimap mà không có prop tường minh (gây xanh giả, làm yếu test).
- **DO NOT REPEAT**: Tự chạy `gh pr merge` hoặc merge vào `main`.
- **DO NOT REPEAT**: Tự đóng Issue #667. Thân issue có khoá tường minh cấm việc này.
- **DO NOT REPEAT**: Dùng `Closes #667` trong mô tả PR — sẽ tự đóng issue khi merge.
- **DO NOT REPEAT**: Để nhánh lạc hậu quá lâu. Nhánh cũ lạc hậu **72 commit** khiến 2/3 thay đổi trùng với việc main đã tự làm. **Bài học: `git fetch origin main` sớm và thường xuyên.**

### Đính chính phát ngôn sai của phiên trước (đã xác minh lại, KHÔNG lặp lại kết luận sai này)

- Từng kết luận *"T9-01 — KHÔNG ĐẠT — E2E fail thật"* và *"workbenchOpen sai ở màn <1440px là lỗi code trên main"*. → **SAI.** Code luôn đúng, chỉ phép đo trong test sai (selector toàn cục bắt nhầm `AttributesSection`).
- Từng nghi ngờ đoạn fallback `if (await expandBtn.isVisible()) { await expandBtn.click() }` gây xanh giả. → Reviewer độc lập kết luận **KHÔNG phải xanh giả**: sau click có `expect(...).toBeVisible()` chặn ở dòng 131; kể cả lọt qua thì ratio đo từ khay đóng cũng không đạt `>= 2`. Hai lớp chặn.

---

## 16. IMPORTANT CONVERSATION CONTEXT

- **User nhấn mạnh đặc biệt về báo cáo xung đột**: cấm báo cáo chung chung kiểu "khác ở file X", phải nêu **chi tiết từng tính năng** — phần nào làm gì, bản nào đúng hơn, giữ cái nào. Phiên sau giữ nguyên chuẩn báo cáo này.
- **User giữ quyền quyết định cuối** với 2 việc: merge PR và đóng issue. Agent tuyệt đối không chạm.
- **Trade-off đã chấp nhận**: giữ `data-fbd-minimap` trong `FbdCanvas.tsx` (lệch tiêu chí T9-02) để đổi lấy việc 5 test cũ không bị sửa assertion. Ưu tiên Non-weakening Invariant cao hơn tiêu chí grep.
- **Trade-off đã chấp nhận**: bỏ công sức sửa 2 E2E fail (đã làm xong, 8/8 pass) vì main tự sửa bằng cách khác tốt hơn. User chốt "chỉ giữ fix viewBox".
- **Lý do chạy kiểm chứng 2 lần**: phiên trước agent từng kết luận sai một lần về T9-01. Để tránh lặp lại, mọi phán quyết nghiệm thu đều được kiểm chứng độc lập lần 2 và đối chiếu. Cả 2 lần trong phiên này đều khớp nguyên vẹn.
- **Phong cách báo cáo user đang dùng**: ngắn gọn, thẳng vào vấn đề, mọi khẳng định kèm bằng chứng `file:dòng` hoặc output lệnh, dùng markdown link cho file path.

---

## 17. NEXT ACTIONS

Vị trí hiện tại: **bước [7] QA & Merge**, PR #706 OPEN chờ user.

1. **[7.1] User review và MERGE PR #706** — *thuộc quyền user, agent KHÔNG tự làm*. Đây là điều kiện tiên quyết: chừng nào #706 chưa merge, lỗi thumbnail Mini Map đen vẫn tồn tại trên `main`, tức T9-02 chưa thoả trên nhánh chính.
2. **[7.2] Commit 3 file hồ sơ Task 9 vào git** — chờ user cho phép. Khi được phép: giao subagent Sonnet commit `docs/superpowers/plans/2026-09-11-fbd-task9-issue.md`, `2026-09-11-fbd-edit-task9-replan.md`, `2026-09-12-fbd-task9-panel-3col-handoff.md`. **Chỉ 3 file này**, không kéo theo 14 file untracked khác ngoài phạm vi.
3. **[7.3] Reviewer duyệt ngoại lệ T9-02** — ghi chấp thuận bằng văn bản lên Issue #667 việc giữ `data-fbd-minimap` trong `FbdCanvas.tsx:959` để bảo toàn 5 test cũ. *Thuộc quyền reviewer/user.*
4. **[7.4] Sau khi #706 merge: chạy lại kiểm chứng trên `main`** — giao subagent Sonnet chạy `vitest` + `tsc --noEmit` + `check_ui_strings.py` + `verify_programming_bundle_budget.py` (nhớ `rm -rf build/web-ui/dist` trước) + kiểm thị giác Mini Map. Chỉ khi toàn bộ xanh mới chuyển bước [8].
5. **[8] User quyết định đóng Issue #667** — *thuộc quyền user*. Agent chỉ được hỏi, không được tự `gh issue close`.

**Nếu user yêu cầu việc khác ngoài 5 mục trên**: vẫn giữ nguyên phân vai Opus điều phối / subagent thực thi, và giữ nguyên chuẩn báo cáo chi tiết theo tính năng.

---

## 18. DEFINITION OF DONE

### Đã đạt

- [x] T9-01: Grid 3 cột, nhớ localStorage, mở sẵn desktop ≥1440px (hành vi đúng; lệch cách làm — inline style thay Tailwind class)
- [x] T9-02: Mini Map ở Cột 3, 3 nút zoom + tỷ lệ %, click điều hướng canvas
- [x] T9-03: Khay đáy đúng 4 tab, bỏ tab Trace, E2E assert `.toBe(4)`
- [x] Unit test liên quan pass (77/77 workbench trên nhánh #706)
- [x] TypeScript clean, UI strings clean, bundle budget R3 pass (157.57 / 165.00 KiB)
- [x] CHANGELOG.md cập nhật mục Task 9
- [x] PR #683 merged
- [x] PR #706 mở, mergeable CLEAN, không conflict
- [x] Kiểm thị giác Mini Map ĐẠT trên nhánh #706

### Chưa đạt — điều kiện để đóng Issue #667

- [ ] **PR #706 được merge vào `main`** (lỗi thumbnail Mini Map hết trên nhánh chính)
- [ ] **Tiêu chí T9-02 `grep data-fbd-minimap = 0`**: hiện là **7**. Cần reviewer duyệt ngoại lệ bằng văn bản trên issue.
- [ ] **3 file hồ sơ nghiệm thu Task 9 được git track**
- [ ] **Chạy lại toàn bộ suite trên `main` sau merge, xác nhận xanh**
- [ ] **User xác nhận nghiệm thu và đồng ý đóng Issue #667**

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
