# SESSION HANDOFF — FBD Quick Library & Workspace Controls

## 1. SESSION OBJECTIVE
- **Dự án**: MK-DDC-24 Web UI (trình soạn thảo lập trình PLC/DDC theo chuẩn IEC 61131-3, PGM-02B).
- **Mục tiêu phiên**:
  1. Xóa/ẩn dòng `NewFbdProgram` toolbar trùng lặp ở `FbdEditorPane.tsx` trong khi bảo toàn accessibility (`<h3 className="sr-only">`). (ĐÃ HOÀN THÀNH)
  2. Bổ sung nút bấm tròn thu gọn / mở rộng theo phương ngang cho 2 bảng biên (POU Explorer cột trái và Inspector cột phải) thành handle 44px, mở rộng canvas ở giữa vào không gian thu hồi. (ĐÃ HOÀN THÀNH)
  3. **Yêu cầu hiện tại của user**: *"không thấy phần quick library đâu , kiểm tra lại đi"* và *"em kiểm tra phần lập trình fbd ấy phần st không bị lỗi"* — Khắc phục triệt để việc khay **Quick Library** bị biến mất/không thấy trong workspace FBD, đảm bảo Quick Library hiển thị rõ ràng, hoạt động chuẩn xác theo thiết kế PGM-02B (ST đã hoạt động bình thường, không sửa ST).

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS
- **Tập trung vào FBD**: Chỉ điều tra và xử lý FBD editor. ST editor đang chạy tốt, không gây regression hoặc thay đổi ST.
- **Quy định bảo toàn hợp đồng và cấm sửa file**:
  - Cấm sửa: `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`, `apps/web-ui/package.json`, `apps/web-ui/.env.local`.
  - Giữ `<h1 className="sr-only">` trong `ProgrammingHeader.tsx` (contract N-08).
  - Không render đồng thời nút 'Lưu bản nháp' ở cả `ProgrammingHeader` và `DesignWorkspacePage` (E2E `HEADER-001`).
- **Cấm làm yếu assertion trong unit test**:
  - Không delete/comment-out test, không `.skip`/`.only`/`.todo`, không nới lỏng matcher.
  - Phải tuân thủ test layout `TC-FBD-RESP-001` trong `FbdEditorPane.test.tsx`: `expect(grid).toHaveClass('min-[1440px]:grid-cols-[minmax(0,1fr)_18rem]')`.
  - Phải tuân thủ selector `[data-fbd-dock="library"]` trong E2E `e2e/programming.spec.ts`.
- **Quy tắc Git**:
  - Không `git add -A` / `git add .` — stage explicit paths.
  - Không `git reset --hard`, `git clean -fd`.
  - Thay đổi `CHANGELOG.md` phải purely additive.
  - Cấm git write từ subagent: add/commit/push/gh/stash/checkout/restore/reset/clean đều do Opus trực tiếp điều phối.
- **Quy chuẩn hiển thị & ngôn ngữ**:
  - Toàn bộ tài liệu, commit, PR, UI text phải dùng tiếng Việt có dấu chuẩn xác.
  - Thiết kế tokens: dùng CSS variables `var(--c-*)`.

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW
1. **Phân tích hiện trạng & tìm nguyên nhân gốc**: Khảo sát code hiện tại giữa ST (hoạt động) và FBD (bị ẩn Quick Library), đối chiếu với handoff spec PGM-02B.
2. **Xác định giải pháp tối thiểu (Lazy Senior Dev / KISS / YAGNI)**: Không đập đi xây lại layout; giải quyết đúng điểm nghẽn gây ẩn Quick Library.
3. **Thực hiện sửa đổi có kiểm soát**: Sửa đúng file quản lý trạng thái hiển thị của dock (`StructuredFbdEditor.tsx`, `FbdEditorPane.tsx`, `ProgramsTab.tsx`).
4. **Chạy test xác minh**: Chạy unit test của `FbdEditorPane.test.tsx` và `StructuredFbdEditor.test.tsx`.
5. **Báo cáo kết quả rõ ràng**: Báo cáo nguyên nhân và trạng thái khắc phục.

### SESSION-ESTABLISHED WORKFLOW
- Kiểm tra Vitest từ thư mục con `apps/web-ui` với môi trường `jsdom`:
  `cd "E:/TuanDuong/INTERN/DDC24_project/MK-DDC-24/apps/web-ui" && npx vitest run src/features/programming/design/editor/FbdEditorPane.test.tsx`
- Giữ nguyên cấu trúc dock nội bộ `[data-fbd-dock="library"]` trong `StructuredFbdEditor.tsx` vì `TC-FBD-RESP-001` và `e2e/programming.spec.ts` ràng buộc chặt chẽ vào class `min-[1440px]:grid-cols-[minmax(0,1fr)_18rem]` của container này.

### WORKFLOW INVARIANTS
- Không đổi class grid của `StructuredFbdEditor` làm fail `TC-FBD-RESP-001`.
- Không xoá thuộc tính `data-fbd-dock="library"` làm fail `e2e/programming.spec.ts`.
- Không phá vỡ ST editor.

---

## 4. CURRENT WORKFLOW POSITION
```
Workflow:          Phân tích nguyên nhân FBD Quick Library → Thiết kế fix → Thực hiện code fix → Chạy unit test xác minh → Review & Hoàn thành
Completed:         Phân tích nguyên nhân FBD Quick Library
Currently working: Thiết kế fix & Chuẩn bị thực hiện sửa code
Next:              Sửa code (StructuredFbdEditor.tsx / FbdEditorPane.tsx / ProgramsTab.tsx) → Chạy Vitest → Báo cáo hoàn thành
```

---

## 5. WORKSPACE / ENVIRONMENT
- **Root Directory**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Web UI Directory**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24\apps\web-ui`
- **Git Branch**: `feat/fbd-edit-task8-redo`
- **OS**: Windows 11 Home (win32 10.0.26200), Bash tool running Git Bash.
- **Node / Test Framework**: Node.js, pnpm, Vitest 4.1.11 (jsdom), Playwright 1.61.1.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED
1. **Trạng thái ST Editor**:
   - `ProgramsTab.tsx` dòng 1134–1168: Render `QuickLibraryHost` trong cột phải khi `libraryDockOpen === true`, và có nút rõ ràng `Mở Thư viện nhanh` khi đang đóng. ST hoạt động độc lập, không dùng `localStorage` của FBD preferences.
2. **Trạng thái FBD Editor & Nguyên nhân gốc Quick Library không hiển thị**:
   - **Nguyên nhân 1 (Auto-close ghi đè localStorage)**: Trong `StructuredFbdEditor.tsx` dòng 902–903:
     ```tsx
     onInsert={(entry) => {
       ...
       setPendingPlacement({ entryId: paletteEntry.id })
       setLibraryDockOpen(false)
       onLibraryOpenChange?.(false)
       return true
     }}
     ```
     Khi người dùng chèn một khối hoặc bấm đóng, `onLibraryOpenChange?.(false)` gọi `updatePreferences({ dock: { ...preferences.dock, library: false } })` trong `FbdEditorPane.tsx`. Giá trị này được lưu bền vững vào `localStorage` (`mkddc:fbd-preferences:v1:...`). Lần mở tiếp theo, `libraryDefaultOpen` nhận `false` nên khay hoàn toàn biến mất.
   - **Nguyên nhân 2 (Cột Quick Library ngoài ở ProgramsTab bị comment)**: Trong `ProgramsTab.tsx` dòng 1077 có khối Quick Library cột 3 cho FBD nhưng bị tắt bằng `{false && ...}` vì trùng lặp với dock nội bộ của `StructuredFbdEditor`.
   - **Nguyên nhân 3 (Nút mở lại Thư viện khó thấy)**: Khi dock đã bị đóng vào `localStorage: false`, nút mở lại chỉ là một nút chữ "Thư viện" nhỏ trên toolbar của canvas FBD (`StructuredFbdEditor.tsx:664`) hoặc checkbox "Khay Thư viện" ở status bar dưới cùng (`FbdEditorPane.tsx:314`). Người dùng không nhìn thấy nút này nên tưởng tính năng bị mất hoàn toàn.
3. **Kết quả test hiện tại**:
   - `FbdEditorPane.test.tsx`: 12/12 test PASS.
   - `StructuredFbdEditor.test.tsx`: 15/15 test PASS.

### UNVERIFIED
- Trạng thái `localStorage` thực tế trong trình duyệt của người dùng (nhiều khả năng đang lưu `dock.library = false`).

---

## 7. COMPLETED WORK
1. **Ẩn toolbar `NewFbdProgram` dư thừa**:
   - File: `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx`
   - Đã bọc toolbar phụ dòng 161 bằng `{false && ...}`, giữ `<h3 className="sr-only">{program.name}</h3>` cho WCAG a11y.
2. **Thêm nút tròn đóng/mở 2 cột biên**:
   - File: `apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx`
   - Đã thêm `FBD_SLOT_GRID_CLASS` và nút tròn `rounded-full` với `ChevronLeft`/`ChevronRight` cho cả cột trái (POU Explorer) và cột phải (Inspector).
   - Canvas ở giữa tự động nở rộng chiếm trọn không gian thu hồi.

---

## 8. WORK IN PROGRESS
- **Nhiệm vụ**: Khắc phục dứt điểm việc không thấy Quick Library trong FBD editor.
- **Tiến độ**: Đã phân tích toàn bộ luồng hiển thị của Quick Library trong FBD vs ST. Đã xác định 2 vị trí cần điều chỉnh:
  1. Trong `StructuredFbdEditor.tsx`: Không auto-close khay thư viện khi ở desktop (`>= 1440px`) khi insert khối, hoặc đồng bộ lại trạng thái mở mặc định.
  2. Nút bấm mở Thư viện: Đảm bảo nút "Thư viện" trên toolbar FBD nổi bật rõ ràng, có tooltip và visual cue khi đang đóng, hoặc tại desktop `>=1440px` luôn mở theo mặc định PGM-02B.
  3. Trong `FbdEditorPane.tsx`: Đảm bảo `libraryDefaultOpen` ưu tiên `wideDesktop` mở nếu chưa có setting tường minh, và nút/checkbox "Khay Thư viện" dễ truy cập.

---

## 9. IMPORTANT DECISIONS
1. **Không mở lại cột ngoài ở `ProgramsTab.tsx`**: `TC-FBD-RESP-001` và `e2e/programming.spec.ts` đều kiểm tra dock bên trong `StructuredFbdEditor` (`data-fbd-dock="library"` và class `min-[1440px]:grid-cols-[minmax(0,1fr)_18rem]`). Mở lại cột ngoài ở `ProgramsTab.tsx` sẽ tạo 2 khay Quick Library cùng lúc và làm vỡ grid layout của FBD.
2. **Khay Quick Library bên trong `StructuredFbdEditor` là đích chính thức**:
   - Đảm bảo `data-fbd-dock="library"` luôn hiển thị khi ở desktop `>=1440px`.
   - Ngăn chặn việc tự động đóng và ghi `dock.library: false` vào `localStorage` khi insert khối ở chế độ desktop. Ở desktop, khay thư viện là docked persistent panel (theo PGM-02B), không phải mobile drawer tự đóng.

---

## 10. RELEVANT FILES & ARTIFACTS
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`: Nơi mount `<aside data-fbd-dock="library">` và nút toolbar toggle "Thư viện".
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx`: Quản lý `preferences.dock.library` và truyền `libraryDefaultOpen` vào `StructuredFbdEditor`.
- `apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx`: Quản lý layout grid 3/4 cột tổng thể và ST QuickLibraryHost.
- `apps/web-ui/src/features/programming/fbd/fbdPreferences.ts`: Cấu trúc lưu trữ preference FBD trong `localStorage`.
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.test.tsx`: Test ràng buộc layout `TC-FBD-RESP-001`.
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx`: Test chức năng của Structured FBD editor.
- `apps/web-ui/e2e/programming.spec.ts`: E2E test kiểm tra `[data-fbd-dock="library"]`.

---

## 11. CODE CHANGES (Current uncommitted working tree)
- `ProgramsTab.tsx`: Thêm `FBD_SLOT_GRID_CLASS`, nút đóng mở tròn cho POU Explorer và Inspector, bọc Quick Library ngoài bằng `{false && ...}`.
- `FbdEditorPane.tsx`: Ẩn toolbar `NewFbdProgram` bằng `{false && ...}`, giữ heading sr-only.
- `DesignWorkspacePage.tsx`, `FbdCanvas.tsx`, `ProgrammingContextStrip.tsx`, v.v.: Các chỉnh sửa chiều cao và styling từ các commit/turn trước.

---

## 12. COMMANDS RUN
```bash
# Run unit tests cho FBD Editor Pane
cd "E:/TuanDuong/INTERN/DDC24_project/MK-DDC-24/apps/web-ui" && npx vitest run src/features/programming/design/editor/FbdEditorPane.test.tsx

# Run unit tests cho Structured FBD Editor
cd "E:/TuanDuong/INTERN/DDC24_project/MK-DDC-24/apps/web-ui" && npx vitest run src/features/programming/fbd/StructuredFbdEditor.test.tsx
```

---

## 13. TEST / VALIDATION STATUS
- `src/features/programming/design/editor/FbdEditorPane.test.tsx`: 12/12 PASS.
- `src/features/programming/fbd/StructuredFbdEditor.test.tsx`: 15/15 PASS.
- E2E tests: Đã verify selector `[data-fbd-dock="library"]` là contract chuẩn của hệ thống.

---

## 14. ERRORS / BLOCKERS
- Không có lỗi biên dịch hay syntax error.
- Vấn đề duy nhất là trải nghiệm người dùng: Quick Library trong FBD bị ẩn khi preference `dock.library` rơi vào `false` (do cơ chế auto-close khi chèn khối), khiến người dùng tưởng mất khay thư viện.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT
- **DO NOT REPEAT**: Không mở đồng thời `<QuickLibraryHost>` ở `ProgramsTab.tsx` (dòng 1077) và `<QuickLibraryHost>` ở `StructuredFbdEditor.tsx` (dòng 888). Việc này sinh ra 2 panel Thư viện cạnh nhau và phá vỡ cấu trúc test `TC-FBD-RESP-001`.
- **DO NOT REPEAT**: Không chạy `vitest` từ thư mục gốc `MK-DDC-24` mà không chỉ định config `apps/web-ui` (sẽ lỗi thiếu jsdom window). Phải `cd apps/web-ui` trước khi chạy Vitest.

---

## 16. IMPORTANT CONVERSATION CONTEXT
- User khẳng định: *"em kiểm tra phần lập trình fbd ấy phần st không bị lỗi"* — User chỉ bị mất Quick Library khi chuyển sang tab FBD, còn tab ST vẫn thấy Quick Library bình thường.
- Trước đó user hỏi: *"không thấy phần quick library đâu , kiểm tra lại đi"* khi đang test giao diện FBD.
- Theo thiết kế PGM-02B tại màn hình desktop (>=1440px), FBD phải có 4 khu vực rõ ràng: POU Explorer | Canvas | Quick Library | Inspector.

---

## 17. NEXT ACTIONS (Thứ tự thực hiện chính xác)

1. **Sửa `StructuredFbdEditor.tsx`**:
   - Trong `onInsert` của `<QuickLibraryHost>` (dòng 901–904): Chỉ gọi `setLibraryDockOpen(false)` và `onLibraryOpenChange?.(false)` khi viewport là màn hình nhỏ (drawer overlay mode, tức `window.innerWidth < 1440`). Khi ở desktop (`>= 1440px`), giữ khay thư viện mở liên tục để người dùng có thể chèn nhiều khối liên tiếp theo đúng luồng làm việc của PGM-02B.
   - Nút "Thư viện" trên toolbar (dòng 664–676): Đổi style thành nổi bật hơn hoặc có visual indicator (ví dụ variant `secondary` thay vì `ghost`, thêm icon hoặc nhãn rõ ràng) để khi đóng người dùng dễ dàng bấm mở lại ngay trên thanh công cụ FBD.
2. **Sửa `FbdEditorPane.tsx`**:
   - Kiểm tra prop `libraryDefaultOpen`: Đảm bảo khi `wideDesktop` là true thì mặc định khay luôn mở trừ khi người dùng chủ động tắt qua toggle.
3. **Chạy kiểm tra lại toàn bộ unit tests**:
   - Chạy `npx vitest run src/features/programming/design/editor/FbdEditorPane.test.tsx`
   - Chạy `npx vitest run src/features/programming/fbd/StructuredFbdEditor.test.tsx`
4. **Báo cáo cho người dùng**: Giải thích rõ ràng nguyên nhân và xác nhận Quick Library đã hiển thị thường trực trên FBD.

---

## 18. DEFINITION OF DONE
- Quick Library hiển thị rõ ràng trên workspace FBD ở khổ desktop (`>=1440px`).
- Việc chèn khối trên desktop không làm tắt ngấm khay thư viện vào `localStorage`.
- Nút mở/đóng thư viện trên toolbar FBD dễ bấm, dễ nhìn, hoạt động đồng bộ.
- Cả `FbdEditorPane.test.tsx` và `StructuredFbdEditor.test.tsx` đều PASS 100%.
- Không ảnh hưởng đến ST editor hay bất kỳ luồng POU nào khác.

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
