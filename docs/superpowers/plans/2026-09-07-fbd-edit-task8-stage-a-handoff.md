# SESSION HANDOFF: FBD EDIT TASK 8 — CÔNG ĐOẠN A (FAILING TESTS) HOÀN TẤT

### 1. SESSION OBJECTIVE

- Tiếp nối chuỗi phiên triển khai tính năng **FBD EDIT** (Function Block Diagram editor) cho `apps/web-ui` thuộc dự án MK-DDC-24 (DDC/IoT Gateway/BMS controller).
- Mục tiêu phiên này:
  1. Chạy webapp để người dùng kiểm tra trực quan giao diện hiện tại.
  2. Lập kế hoạch chi tiết **Task 8** (Issue #574 — Shell, network views, docks và theme cho FBD Editor).
  3. Tạo nhánh `feat/fbd-edit-task8` tách từ `feat/fbd-edit-task6`.
  4. Triển khai **Công đoạn A**: viết failing tests (pha đỏ TDD) phủ 8 kịch bản `TC-FBD-*`.
- Kết quả mong muốn: bộ test đỏ đúng thiết kế, làm hợp đồng giao diện (testid/attribute/text) cho Công đoạn B hiện thực.

---

### 2. USER REQUIREMENTS & HARD CONSTRAINTS

#### Yêu cầu cốt lõi từ người dùng

1. **Phân vai model (BẤT BIẾN, người dùng nhấn mạnh nhiều lần):** Model Opus (`cc/claude-opus-5`) **chỉ điều phối, lập kế hoạch, phản biện/kiểm chứng**. Toàn bộ việc thực thi (đọc code chi tiết, sửa code, chạy lệnh) phải giao cho subagent model rẻ hơn (Sonnet/Haiku). **Tuyệt đối không chạy subagent bằng Opus.**
2. **Quyền hạn Git/PR:** Push và **chỉ tạo PR**; người dùng **tự merge thủ công**. Không tự ý merge, không xoá nhánh sau push.
3. **Tiêu chuẩn gate:** Sửa sạch toàn bộ lỗi cổng trước khi push (không push khi gate còn đỏ).
4. **Thứ tự công việc phiên này:** chạy webapp → lập plan Task 8 → tạo nhánh `feat/fbd-edit-task8` từ `feat/fbd-edit-task6` → triển khai Công đoạn A.

#### Ràng buộc kỹ thuật bất biến (Invariants)

- **Cấm làm yếu assertion:** Nghiêm cấm xoá, comment-out, dùng `.skip`/`.only`/`.todo`, nới lỏng matcher, hoặc thêm mock trả dữ liệu rỗng để ép test pass.
- **Ranh giới file cấm đụng:**
  - `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx` (file dirty của người dùng).
  - `apps/web-ui/src/features/programming/layout/ProgrammingLayout.tsx` (file dirty của người dùng).
  - `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`.
  - `apps/web-ui/package.json` (không thêm dependency ngoài, không kéo `reactflow`/`xyflow`).
- **Responsive phải làm qua composition** tại `DesignWorkspacePage.tsx` và `FbdEditorPane.tsx`, không sửa layout/header dùng chung.
- **Bảo toàn lịch sử CHANGELOG:** mọi thay đổi `CHANGELOG.md` phải **thuần thêm (0 dòng xoá)**.
- **Quy chuẩn ngôn ngữ:** commit message, PR, docs, comment, chuỗi UI phải viết **tiếng Việt có dấu chuẩn xác** (vượt linter `check:ui-strings`).
- **Ngân sách Bundle:** chunk `programming-*.js` phải nằm trong ngân sách R3 = 165.00 KiB gzip.
- **Giới hạn độ dài file:** trần 800 dòng/file theo quy tắc ECC coding-style.

---

### 3. WORKING METHOD / USER-DEFINED WORKFLOW

#### USER-DEFINED WORKFLOW

1. **Lập kế hoạch / Điều phối:** Opus phân tích yêu cầu, chia tách luồng công việc độc lập thành các công đoạn.
2. **Ủy quyền thực thi:** Giao việc cho subagent Sonnet/Haiku với phạm vi file, ràng buộc cấm, tiêu chí dừng và yêu cầu báo cáo cụ thể.
3. **Kiểm chứng độc lập (Adversarial verification):** Không tin báo cáo subagent; luôn tự chạy lại `git diff --numstat`, `git status`, vitest, tsc, lint và đối chiếu số đo.
4. **Sửa tận gốc nguyên nhân:** Khi test fail, truy căn nguyên; từ chối vá tạm/mock né lỗi.
5. **Bảo toàn gate trước khi bàn giao:** 4 cổng (tsc, lint, test, build/bundle) phải xanh trên cây làm việc sạch trước khi push/PR.

#### SESSION-ESTABLISHED WORKFLOW (đã dùng ổn định trong phiên này)

- **Quét pattern cấm sau mỗi subagent:** chạy `grep -nE "\.(skip|only|todo)\(|mockResolvedValue\(\[\]\)|expect\(true\)"` trên file test bị đụng.
- **Kiểm tra ranh giới diff:** `git diff --numstat` để phát hiện subagent ghi ra ngoài phạm vi hoặc xoá dòng ngoài dự kiến; nếu thấy dòng bị xoá phải đọc `git diff -U3 | grep "^-"` xem xoá đúng cái gì.
- **Phân biệt lỗi mới với lỗi có sẵn:** khi thấy test fail, `git stash` phần thay đổi mới rồi chạy lại baseline để xác định lỗi do phiên này gây ra hay đã hỏng sẵn.
- **Phân biệt lỗi môi trường với lỗi mã nguồn:** ca fail liên quan cờ `.env.local` phải kiểm tra lại bằng cách đè biến môi trường (ví dụ `VITE_PROGRAMMING_REV_A=0`).
- **Đè biến môi trường khi chạy dev server thay vì sửa `.env.local` của người dùng.**

#### WORKFLOW INVARIANTS

- Luôn `cd /e/TuanDuong/INTERN/DDC24_project/MK-DDC-24` trước khi chạy lệnh git.
- Không dùng `git add -A` / `git add .`; chỉ stage đích danh đường dẫn.
- Tuyệt đối không dùng lệnh huỷ diệt: `git reset --hard`, `git checkout -- <file>`, `git clean -fd`.
- Subagent **không được** chạy `git add`/`commit`/`push`/`gh`/`stash`/`checkout`; chỉ được đọc trạng thái git.
- Mỗi công đoạn phải verify xong mới chuyển công đoạn kế tiếp.

---

### 4. CURRENT WORKFLOW POSITION

```
Workflow FBD EDIT: Task 0.5 → 1 → 1.5 → 2..5.5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11
Completed:         Task 0.5, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7 (PR #572 OPEN, chờ user merge thủ công)
Currently working: Task 8 (Issue #574) — nhánh feat/fbd-edit-task8

Workflow Task 8:   A → B → C → D → E → F
  A. Viết failing tests (8 kịch bản TC-FBD-*)            ← ĐÃ XONG, đã verify
  B. Responsive layout composition                        ← TIẾP THEO
  C. POU Explorer "+ FBD" + quản lý 8 tab
  D. Selected/All Network views
  E. Preferences & theme selector
  F. Gỡ nút Lưu trùng lặp + chạy 4 gate

Completed:         A
Next:              B → C → D → E → F
```

**Lưu ý:** Công đoạn A đã xong nhưng **chưa commit**. Thay đổi đang nằm ở working tree dưới dạng modified.

---

### 5. WORKSPACE / ENVIRONMENT

- **Root Directory:** `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Frontend App:** `apps/web-ui`
- **Git Branch hiện tại:** `feat/fbd-edit-task8` (tách từ `feat/fbd-edit-task6`, **chưa có upstream**, chưa push)
- **HEAD Commit:** `222fdd5c3297aaac21709fbd7501d1fbda4afba8`
- **Nhánh liên quan:** `feat/fbd-edit-task6` HEAD = `49bdcb14` (có thêm merge commit hợp nhất `origin/main`, đồng bộ với origin: 0/0)
- **PR:** #572 (`feat(programming): FBD Edit task 6–7`) đang OPEN, chưa merge.
- **Issues:** #574 (Task 8), #573 (Task 9) đang OPEN.
- **Toolchain:** Node.js, npm, Vite 8.2.0, TypeScript 5, Tailwind CSS v4, Vitest 4.1.10, Python 3.12 (script lint/bundle).
- **OS:** Windows 11 Home Single Language (x64), shell Git Bash.
- **GitHub CLI:** đã đăng nhập tài khoản `haizzdungnay`.
- **Dev server:** đang chạy nền ở `http://localhost:5174/` với env đè `VITE_DDC_MODE=demo VITE_AUTH_MODE=mock` (dữ liệu mô phỏng).
- **Biến môi trường cục bộ (`apps/web-ui/.env.local`, KHÔNG sửa):** `VITE_DDC_MODE=live`, `VITE_AUTH_MODE=none`, `VITE_PROXY_TARGET=http://192.168.120.224:8081`, `VITE_PROGRAMMING_REV_A=1`, `VITE_HISTORIAN_V2_TRENDS=1`.

---

### 6. CURRENT VERIFIED STATE

#### VERIFIED (tự chạy lệnh, không dẫn lại báo cáo subagent)

- **Nhánh `feat/fbd-edit-task8`** đã tạo từ `feat/fbd-edit-task6`; `a6fe3da0` (HEAD của handoff trước) là ancestor hợp lệ, lịch sử chỉ tiến lên.
- **Diff Công đoạn A:** `git diff --numstat` cho:
  - `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx`: `197 17`
  - `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.test.tsx`: `121 0`
  - Không file source nào bị sửa. Không có commit trái phép.
- **Quét pattern cấm** (`.skip`/`.only`/`.todo`/`mockResolvedValue([])`/`expect(true)`) trên 2 file test: **sạch**.
- **Vitest 2 file Task 8:** `11 failed | 51 passed (62)`. 11 fail đều là test Task 8 cố ý đỏ (pha đỏ TDD).
- **`npx tsc --noEmit`:** exit code 0.
- **`npm run lint`:** exit code 0; `check_ui_strings.py` trả `OK — không có chuỗi giao diện tiếng Việt nào bị viết thiếu dấu`.
- **Vitest toàn bộ `src`:** `3061 passed | 12 failed` trên 243 test file. 12 fail = 11 test Task 8 cố ý đỏ + 1 ca `ShellNavigation`.
- **Ca `ShellNavigation.test.tsx`:** chạy với `VITE_PROGRAMMING_REV_A=0` đạt **18/18 PASS** ⇒ đúng là lỗi cờ `.env.local` cục bộ, không phải hồi quy. CI không có file này nên sẽ xanh.
- **Lỗi tồn đọng `T61-405` đã sửa gốc:** đã chứng minh nó hỏng sẵn trên nhánh trước Công đoạn A (stash thay đổi mới rồi chạy baseline vẫn fail). Sau khi sửa: PASS khi chạy cả file.
- **Assertion `expect(banner).toHaveAttribute('data-status', 'loading')` còn nguyên** tại `DesignWorkspacePage.test.tsx:1318` — không bị xoá/nới lỏng.
- **17 dòng bị xoá** trong `DesignWorkspacePage.test.tsx` đã kiểm tra bằng `git diff -U3`: chỉ là khối dữ liệu mock `TON` được bọc lại trong `setTimeout`, **không phải xoá assertion, không phải rỗng hoá dữ liệu**.
- **Merge commit `49bdcb14`** trên `feat/fbd-edit-task6` (hợp nhất `origin/main`, giải quyết xung đột CHANGELOG theo quy tắc purely additive) an toàn, đồng bộ origin 0/0.

#### UNVERIFIED

- **Chưa chạy `npm run build`** trong phiên này ⇒ chưa có số đo bundle budget R3 mới. Số 149.45 KiB gzip là của phiên trước, **không được dẫn lại như số đo hiện tại**.
- Chưa chạy E2E Playwright (thuộc Task 11).
- Chưa kiểm tra trực quan giao diện ở `localhost:5174` (người dùng chưa phản hồi kết quả xem).

---

### 7. COMPLETED WORK

1. **Chẩn đoán giao diện trống và khởi động lại dev server:**
   - Nguyên nhân: `.env.local` đặt `VITE_DDC_MODE=live` + `VITE_PROXY_TARGET=http://192.168.120.224:8081` ⇒ FE gọi board thật không tồn tại, mọi query rỗng, WebSocket không kết nối. Server cũ ở cổng 5173 cũng đã chết (netstat chỉ còn `SYN_SENT`, không có `LISTENING`).
   - Xử lý: chạy server mới ở cổng 5174 với env đè `VITE_DDC_MODE=demo VITE_AUTH_MODE=mock`, **không sửa file `.env.local`** của người dùng.

2. **Tạo nhánh `feat/fbd-edit-task8`** từ `feat/fbd-edit-task6`.

3. **Lập kế hoạch Task 8** chia 6 công đoạn A–F kèm phân công model (A–D: Sonnet; E–F: Haiku), đọc trước `DesignWorkspacePage.tsx`, `FbdEditorPane.tsx`, `PouExplorer.tsx`, `pouCommands.ts`, plan gốc `2026-08-31-fbd-edit.md` §8 và Issue #574.

4. **Công đoạn A — viết failing tests (subagent Sonnet):** thêm 11 test phủ 8 mã kịch bản vào 2 file test. Đã kiểm chứng độc lập; phát hiện subagent báo sai số fail (báo 11, thực tế 12) và đã truy ra nguyên nhân.

5. **Sửa tận gốc lỗi tồn đọng `T61-405` (subagent Sonnet):**
   - **Hiện tượng:** test `PGM-02 tiếp nhận ý định chèn khối từ Thư viện (T61-405) > hỏi lại trước khi chèn, và chỉ chèn sau một lần bấm tường minh` PASS khi chạy riêng, FAIL khi chạy cả file.
   - **Nguyên nhân gốc:** mock `searchProgrammingLibraries` trả `Promise.resolve()` tức thì. Khi chạy cả file, `ProgramsTab` đã nằm sẵn trong cache `React.lazy` (`DesignWorkspacePage.tsx:10`) nên không còn độ trễ import động; `insertResolution.status` nhảy `loading → ready` trong cùng microtask, khiến assertion đồng bộ ở dòng 1318 bắt hụt trạng thái `loading`.
   - **Xử lý:** bọc mock trong `setTimeout(..., 0)` để mô phỏng đúng độ trễ mạng bất đồng bộ. Giữ nguyên toàn bộ assertion và dữ liệu mock `TON`.

6. **Khôi phục sự cố mất trạng thái giữa phiên** (xem mục 14).

---

### 8. WORK IN PROGRESS

- **Công đoạn A đã hoàn tất và verify xong, nhưng CHƯA COMMIT.** Thay đổi đang ở working tree dạng modified trên nhánh `feat/fbd-edit-task8`:
  - `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx` (+197/-17)
  - `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.test.tsx` (+121/-0)
- **Chưa cập nhật `CHANGELOG.md`** cho Task 8 (quy tắc dự án yêu cầu cập nhật trong cùng phiên khi có thay đổi code).
- Công đoạn B chưa bắt đầu.

---

### 9. IMPORTANT DECISIONS

1. **Tạo nhánh gối đầu `feat/fbd-edit-task8` từ `feat/fbd-edit-task6`** thay vì chờ merge PR #572 — người dùng chốt, để triển khai song song trước khi PR được merge thủ công.
2. **Sửa luôn lỗi `T61-405` dù nó hỏng sẵn từ trước:** theo quy tắc dự án trong `CLAUDE.md` ("phát hiện lỗi trong phạm vi việc đang làm ⇒ sửa trong cùng phiên"), không chỉ ghi vào tài liệu rồi bỏ đó.
3. **Không sửa `.env.local` của người dùng:** đè biến môi trường khi chạy dev server để giữ nguyên cấu hình cục bộ.
4. **Không can thiệp `ShellNavigation.test.tsx`:** đã xác minh fail do cờ môi trường cục bộ, CI sẽ pass.
5. **Giữ nguyên `data-status` assertion khi sửa `T61-405`:** sửa mock cho đúng ngữ nghĩa bất đồng bộ thay vì nới lỏng kiểm thử.

---

### 10. RELEVANT FILES & ARTIFACTS

- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx` — **ĐANG MODIFIED**. Chứa 6 test Task 8 đỏ + fix mock `T61-405`.
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.test.tsx` — **ĐANG MODIFIED**. Chứa 5 test Task 8 đỏ.
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` — mục tiêu sửa Công đoạn B; đã có sẵn hook `useProgrammingMobileReadOnly` (import dòng 33) để tái dùng cho logic `<768px`; `ProgramsTab` lazy-load ở dòng 10.
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx` — mục tiêu sửa Công đoạn B và F; nút "Lưu" cần gỡ nằm khoảng dòng 74–84; nút Kiểm tra/So sánh khoảng dòng 88–100.
- `apps/web-ui/src/features/programming/layout/useProgrammingViewport.ts` — hook viewport có sẵn, tái dùng cho breakpoint.
- `apps/web-ui/src/features/programming/design/pou/PouExplorer.tsx` — mục tiêu Công đoạn C; hàm tạo POU gọi `createPouOperations` ở dòng 126.
- `apps/web-ui/src/features/programming/design/pou/pouCommands.ts` — `createPouOperations` ở dòng 75.
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — plan gốc 14 task; **§8 dòng 597–648** là đặc tả Task 8.
- `docs/superpowers/plans/2026-09-07-fbd-edit-task7-handoff.md` — handoff phiên trước (Task 6–7).
- `CHANGELOG.md` — **chưa cập nhật cho Task 8**.

---

### 11. CODE CHANGES

Toàn bộ nằm ở working tree, **chưa commit**:

1. **`apps/web-ui/src/features/programming/design/editor/FbdEditorPane.test.tsx`** (+121/-0)
   - Thêm describe `FbdEditorPane — Task 8: Shell, Responsive & Toolbar (Issue #574)` với 5 test: `TC-FBD-HEADER-001` (×2), `TC-FBD-RESP-002`, `TC-FBD-STATE-001`, `TC-FBD-STATE-004`.

2. **`apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx`** (+197/-17)
   - Thêm describe `DesignWorkspacePage — Task 8: Shell, Responsive, Docks & Tabs (Issue #574)` với 6 test: `TC-FBD-RESP-001` (×3 breakpoint), `TC-FBD-RESP-003`, `TC-FBD-UX-001`, `TC-FBD-UX-002`.
   - Sửa mock `searchProgrammingLibraries` trong `stubWorkspaceWithLibrary` (khoảng dòng 1273–1295): đổi `Promise.resolve(...)` thành `new Promise(resolve => setTimeout(() => resolve(...), 0))`. Đây là nguyên nhân 17 dòng xoá (khối mock `TON` được bọc lại, dữ liệu giữ nguyên).
   - **Side effect:** sửa này khiến `T61-405` chuyển từ FAIL sang PASS khi chạy cả file. Không ảnh hưởng test khác (toàn suite 3061 pass).

---

### 12. COMMANDS RUN

```bash
# Chạy dev server chế độ demo (KHÔNG sửa .env.local)
cd apps/web-ui && VITE_DDC_MODE=demo VITE_AUTH_MODE=mock npx vite --host 0.0.0.0 --port 5174

# Tạo nhánh Task 8
cd /e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 && git checkout -b feat/fbd-edit-task8

# Kiểm chứng phạm vi diff của subagent
git diff --numstat
git diff -U3 <file> | grep "^-"
grep -nE "\.(skip|only|todo)\(|mockResolvedValue\(\[\]\)|expect\(true\)" <test files>

# Chạy test 2 file Task 8
cd apps/web-ui && npx vitest --run --environment jsdom \
  src/features/programming/design/DesignWorkspacePage.test.tsx \
  src/features/programming/design/editor/FbdEditorPane.test.tsx

# Xác định lỗi có sẵn hay do phiên này (baseline check)
git stash push -q -- <2 test files> && npx vitest --run --environment jsdom <file>; git stash pop -q

# Cổng kỹ thuật
npx tsc --noEmit
npm run lint
npx vitest --run --environment jsdom src
VITE_PROGRAMMING_REV_A=0 npx vitest --run --environment jsdom src/shared/components/ShellNavigation.test.tsx

# Khôi phục sự cố
git stash list
git show 'stash@{0}:<path>' | grep -c "TC-FBD"
git restore --staged .
git reflog -12
```

---

### 13. TEST / VALIDATION STATUS

| Cổng | Kết quả | Ghi chú |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) | Đã chạy lại sau khôi phục |
| `npm run lint` | **PASS** (exit 0) | Gồm `check:ui-strings` |
| Vitest 2 file Task 8 | 51 pass / 11 fail | 11 fail là **pha đỏ TDD cố ý** |
| Vitest toàn bộ `src` | 3061 pass / 12 fail (243 file) | 12 = 11 cố ý đỏ + 1 `ShellNavigation` |
| `ShellNavigation` với `VITE_PROGRAMMING_REV_A=0` | **PASS 18/18** | Lỗi cờ `.env.local`, không phải hồi quy |
| `npm run build` / bundle budget R3 | **CHƯA CHẠY** | Phải đo lại ở Công đoạn F, không dẫn số cũ |
| E2E Playwright | **CHƯA CHẠY** | Thuộc Task 11 |

**11 test đỏ đúng thiết kế — hợp đồng giao diện cho Công đoạn B:**

| Mã kịch bản | Thiếu gì (test đang đòi) |
|---|---|
| `TC-FBD-RESP-001` (×3) | `data-dock-mode` = `dock-4col` (>=1440) / `drawer` (1280) / `overlay` (820) |
| `TC-FBD-RESP-002` | Nút "Chọn vùng" (marquee), có `aria-pressed` |
| `TC-FBD-RESP-003` | Viewport 390px: ẩn control tạo/lưu, hiện banner chặn thao tác |
| `TC-FBD-UX-001` | Nút "+ FBD" trong POU Explorer sinh `language: 'FBD'` |
| `TC-FBD-UX-002` | `pou-tab-bar` + dialog xác nhận khi đóng tab dirty |
| `TC-FBD-HEADER-001` (×2) | Gỡ nút "Lưu" nội bộ khỏi `FbdEditorPane`; nút "Kiểm tra" disable khi dirty |
| `TC-FBD-STATE-001` | `data-testid="fbd-editor-skeleton"`, `data-testid="fbd-canvas-skeleton"` |
| `TC-FBD-STATE-004` | `data-testid="fbd-readonly-banner"` khi `canEdit=false` |

**Hợp đồng testid/attribute/text đầy đủ:**
- testid: `fbd-shell-layout`, `fbd-dock-explorer`, `fbd-dock-canvas`, `fbd-dock-library`, `fbd-dock-inspector`, `fbd-editor-skeleton`, `fbd-canvas-skeleton`, `fbd-readonly-banner`, `pou-tab-bar`
- attribute: `data-breakpoint="xl"`, `data-dock-mode="dock-4col"|"drawer"|"overlay"`; prop `loading?: boolean`
- text: banner `"Màn hình nhỏ — chỉ hỗ trợ xem sơ đồ"`; nút `"Chọn vùng"` với `aria-pressed`

---

### 14. ERRORS / BLOCKERS

**Không có blocker kỹ thuật tồn đọng.** Một sự cố đã xảy ra và đã khắc phục xong, ghi lại để phiên sau cảnh giác:

**Sự cố mất trạng thái giữa phiên (đã khắc phục hoàn toàn, không mất dữ liệu):**
- **Hiện tượng:** Khi bắt đầu viết handoff, `git status` cho thấy HEAD đã nhảy từ `feat/fbd-edit-task8` về `feat/fbd-edit-task6`, có 32 file staged thuộc vùng cấm (`apps/core/**`, `apps/web-api/**`, `contracts/**`), và test Task 8 biến mất khỏi cả nhánh lẫn cây làm việc (`grep -c "TC-FBD"` = 0).
- **Nguyên nhân:** có thao tác git ngoài phiên này (reflog `HEAD@{2}` ghi nhận merge commit `49bdcb14` hợp nhất `origin/main` vào `feat/fbd-edit-task6`, kèm checkout qua lại giữa hai nhánh). Công việc Công đoạn A đã được đẩy vào stash `wip-task8-tests`.
- **Khắc phục:** xác minh stash còn nguyên (`197 17` + `121 0`, 20 mã `TC-FBD`) → `git checkout feat/fbd-edit-task8` → `git restore --staged .` để bỏ staging 32 file không liên quan → xác nhận stash đã tự pop, test Task 8 về đủ trên đĩa.
- **Kết quả xác minh:** merge commit `49bdcb14` an toàn trên `feat/fbd-edit-task6`, đồng bộ origin 0/0, **không mất dữ liệu nào**. Test Task 8 khôi phục đúng số đo cũ (51 pass / 11 fail, tsc exit 0).
- **Bài học cho phiên sau:** Công đoạn A chưa commit ⇒ **rủi ro mất lần nữa**. Nên commit ngay đầu phiên sau trước khi làm Công đoạn B.

---

### 15. FAILED ATTEMPTS — DO NOT REPEAT

- **DO NOT REPEAT:** Thêm mock trả dữ liệu rỗng (ví dụ `api.getPoints.mockResolvedValue([])`) để làm xanh test. Hành vi che giấu bug, đã bị bác bỏ ở phiên trước.
- **DO NOT REPEAT:** Cho phép subagent tự chạy `git commit`, `git push`, `git stash`, `git checkout`, `gh pr create` khi chưa có kiểm duyệt độc lập và phê duyệt của người dùng.
- **DO NOT REPEAT:** Ghi đè file handoff lịch sử bằng handoff của task mới. Mỗi phiên tạo file riêng.
- **DO NOT REPEAT:** Dùng model Opus cho subagent thực thi — vi phạm chỉ đạo của người dùng.
- **DO NOT REPEAT — mới từ phiên này:** Dùng vòng lặp `git stash` + `git checkout` nhiều commit để bisect thủ công. Đã thử trong phiên này để tìm commit làm hỏng `T61-405`; kết quả **mâu thuẫn và không đáng tin** (stash rỗng ở vòng đầu làm lệch pha), suýt gây nhầm lẫn trạng thái. Thay vào đó: chạy test riêng lẻ (`-t "<tên test>"`) so với chạy cả file để phát hiện ô nhiễm trạng thái — cách này cho kết luận đúng ngay.
- **DO NOT REPEAT:** Tạo git worktree để bisect. Đã thử `git worktree add /tmp/bisect-t61`; worktree **thiếu `node_modules`** nên không chạy được vitest, phải gỡ bỏ. Chi phí cài lại không tương xứng.
- **DO NOT REPEAT:** Tin số liệu trong báo cáo subagent mà không tự chạy lại. Trong phiên này subagent báo "11 test fail" nhưng số thật là 12 — ca thứ 12 (`T61-405`) là lỗi có sẵn quan trọng, suýt bị bỏ sót.

---

### 16. IMPORTANT CONVERSATION CONTEXT

- Người dùng nhấn mạnh **hai lần** trong phiên này: *"nguyên tắc là opus chỉ lên plan và điều phối chia việc tuyệt đối không sử dụng opus để làm các việc mà các model yếu hơn như custom sonet và custom haiku có thể làm"*. Đây là ràng buộc chi phí nghiêm ngặt, phải giữ.
- Người dùng yêu cầu rõ: **"push code lên github nhưng chỉ tạo pr thôi còn tôi sẽ merge thủ công"** — không bấm merge PR #572.
- Người dùng phản ánh **"WebSocket lost. Reconnecting; displayed data is stale"** và **"giao diện đã lên nhưng có vẻ be với dữ liệu mô phỏng chưa có chạy"** ⇒ đã chẩn đoán là do `.env.local` trỏ chế độ `live` sang board thật không tồn tại, đã xử lý bằng server demo cổng 5174. Người dùng **chưa xác nhận** đã xem và hài lòng với giao diện.
- Người dùng chốt thứ tự phiên này: *"Tạo feat/fbd-edit-task8 từ feat/fbd-edit-task6 và triển khai công đoạn A luôn"* — đã làm đúng thứ tự này.
- Issue #574 (Task 8) **chưa được đóng**; người dùng có nhắc tới việc đóng issue sau khi hoàn thành Task 8, nhưng Task 8 mới xong Công đoạn A/6 nên **chưa được đóng issue**.
- Tiến độ tổng thể FBD EDIT: 10/14 task xong (0.5, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7); còn Task 8 (đang làm), 9, 10, 11.

---

### 17. NEXT ACTIONS

Tuân thủ nghiêm ngặt USER-DEFINED WORKFLOW (Opus điều phối, subagent Sonnet/Haiku thực thi, Opus kiểm chứng độc lập).

1. **Commit ngay Công đoạn A trước khi làm gì khác** (chống lặp lại sự cố mất trạng thái ở mục 14):
   - Stage đích danh 2 file test (không dùng `git add -A`).
   - Cập nhật `CHANGELOG.md` mục `[Unreleased]` (thuần thêm) ghi nhận: thêm test pha đỏ Task 8 + sửa gốc `T61-405`.
   - Commit tách 2 nhóm: `test(programming): ...` cho test Task 8, `fix(programming): ...` cho `T61-405`. Message tiếng Việt, nêu triệu chứng → nguyên nhân gốc → cách sửa.
2. **Công đoạn B — Responsive layout composition** (giao subagent **Sonnet**):
   - Sửa `DesignWorkspacePage.tsx` và `FbdEditorPane.tsx` qua composition; tái dùng `useProgrammingMobileReadOnly`.
   - Bám đúng hợp đồng testid/attribute/text ở mục 13.
   - **Cấm sửa** `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`.
   - Tiêu chí dừng: các test `TC-FBD-RESP-001/002/003`, `TC-FBD-STATE-001/004` chuyển xanh; tsc + lint sạch; test cũ không vỡ.
3. **Kiểm chứng độc lập Công đoạn B** (Opus tự chạy): `git diff --numstat`, quét pattern cấm, vitest 2 file, `tsc --noEmit`, `npm run lint`. Chỉ khi xanh mới sang C.
4. **Công đoạn C — POU Explorer "+ FBD" + quản lý 8 tab** (Sonnet): phủ `TC-FBD-UX-001`, `TC-FBD-UX-002`.
5. **Công đoạn D — Selected/All Network views** (Sonnet): render `data-fbd-network-id`, chặn dây xuyên network ở tầng validator/reducer.
6. **Công đoạn E — Preferences & theme selector** (Haiku): `fbdPreferences` (LIGHT/DARK/FOLLOW_WEB), lưu localStorage, không đổi canonical JSON.
7. **Công đoạn F — Gỡ nút Lưu trùng lặp + chạy đủ 4 gate** (Haiku): gỡ nút "Lưu" khỏi `FbdEditorPane` (khoảng dòng 74–84), giữ Kiểm tra/So sánh; chạy `tsc`, `lint`, `vitest`, `npm run build` + `check:bundle-budget --increment r3` và **đo lại số bundle thật**.
8. **Sau khi 4 gate xanh:** push nhánh `feat/fbd-edit-task8`, tạo PR bằng `gh pr create` (mô tả tiếng Việt + bảng số đo thật). **KHÔNG merge** — người dùng tự merge.
9. **Đóng Issue #574** chỉ sau khi Task 8 hoàn tất đủ DoD và người dùng xác nhận.

---

### 18. DEFINITION OF DONE

Task 8 được coi là hoàn thành khi:

- [ ] Đủ 8 kịch bản `TC-FBD-*` phủ bằng test Vitest tự động và **tất cả chuyển xanh** (không mock né lỗi, không nới lỏng assertion).
- [ ] Responsive chạy đúng từ 390px đến 1440px+, không tràn ngang.
- [ ] Không sửa `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`.
- [ ] File mới/sửa không vượt 800 dòng.
- [ ] `npx tsc --noEmit` exit 0.
- [ ] `npm run lint` exit 0 (gồm `check:ui-strings`).
- [ ] `npx vitest --run --environment jsdom src` xanh (trừ ca `ShellNavigation` do cờ `.env.local` cục bộ, đã giải trình).
- [ ] `npm run build` + `check:bundle-budget --increment r3` PASS (<= 165.00 KiB gzip) — **phải đo lại thật, không dẫn số phiên trước**.
- [ ] `CHANGELOG.md` cập nhật dưới `[Unreleased]`, thuần thêm (0 dòng xoá).
- [ ] Commit tách nhóm logic, message tiếng Việt chuẩn Conventional Commits.
- [ ] Push nhánh + tạo PR; **không tự merge**.

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
