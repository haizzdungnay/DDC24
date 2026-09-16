# Handoff — Kéo thả POU vào FBD, hover tooltip, minimap wires (Refs #667)

Ngày: 2026-09-15
Nhánh: `feat/fbd-pou-dragdrop-667`
PR: #709 (OPEN, chưa merge)

---

## 1. SESSION OBJECTIVE

Bổ sung 4 tính năng cho FBD editor của MK-DDC-24 Web Studio trước khi khép Task 9 (Issue #667):

1. **Function Block cho FBD** — thêm mục `Function Block · FBD` vào menu `+ New`, kéo thả được vào canvas.
2. **Hover tooltip** — rê chuột vào khối trên canvas FBD hiện thông tin khối.
3. **Minimap vẽ đường nối** — minimap phải vẽ wires, không chỉ vẽ khối trơ.
4. **Tách zoom minimap khỏi zoom canvas chính** — 3 nút zoom trong panel minimap chỉ đổi thumbnail, không đổi viewport canvas.

Tính năng thứ 5 (menu chuột phải) đã bị **HUỶ**, không làm.

**Yêu cầu bổ sung (đảo ngược công việc Phase-3 trước đó):** Function Block viết bằng **ST cũng phải kéo thả được vào FBD** — chương trình đọc FB ST rồi suy ra hình dạng khối FBD. Sau khi tạo Function Block, khối đó phải xuất hiện trong **cột Quick Library** và **trang Control Library** để kéo thả được từ cả hai nơi.

**Kết quả mong muốn:** cả 4 tính năng hoạt động, test xanh, PR mở vào `main` chờ review — **không merge**.

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Quyết định user đã chốt (qua AskUserQuestion — RÀNG BUỘC, không được đảo ngược)

| Câu hỏi | Lựa chọn user chốt |
|---|---|
| Cách hiện POU trên Control Library | **"Tự động hiện, gộp chung một danh sách"** — POU tự động vào danh sách Blocks của tab Project, KHÔNG có nút publish |
| Phạm vi loại POU | **"Có, cả Function và Function Block"** — cả `FUNCTION` lẫn `FUNCTION_BLOCK` |
| Nguồn dữ liệu interface | **"Sửa backend điền interface vào draft"** — sửa Go backend (nới lệnh cấm `apps/web-api/**` CHỈ cho việc sinh interface) |
| Gỡ xung đột `WorkbenchMinimapPanel` | **"Gộp cả hai"** — giữ `computeMinimapViewBox` theo bbox của #706 làm khung gốc, `minimapZoom` áp lên trên |
| File untracked đưa vào PR | 4 file mã nguồn + 12 file plan/handoff + config Playwright & doc deploy |

### File CẤM sửa (không bao giờ được đụng)

`ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `firmware/**`, `apps/web-ui/package.json`, `apps/web-ui/.env.local`

Thêm vào danh sách cấm trong phiên này (đã đọc, hiểu, không được sửa):
- `apps/web-ui/src/features/programming/design/editor/workspaceAdapters.ts`
- `apps/web-ui/src/features/programming/design/useDraftWorkspace.ts`
- `apps/web-ui/src/shared/components/ShellNavigation.test.tsx`

**NGOẠI LỆ đã cấp:** `apps/web-api/**` được phép sửa, **chỉ trong phạm vi sinh interface cho POU**. `apps/core/**`, `contracts/**`, `firmware/**`, `scripts/**` vẫn cấm hoàn toàn.

### Ràng buộc bảo toàn kiểm thử (Non-weakening Invariant)

- **KHÔNG** dùng `.skip`, `.only`, `.todo`.
- **KHÔNG** xoá test, **KHÔNG** nới lỏng matcher, **KHÔNG** sửa assertion để ép xanh.
- Nếu test đỏ: **sửa mã nguồn cho đúng**, không sửa test. Không sửa được thì DỪNG và báo user.
- Test cũ của `FbdCanvas.test.tsx` (`AC-FBD-012`, `TC-FBD-NAV-001`, `TC-WBENCH-MM-*`) phải tiếp tục PASS.

### Ràng buộc git

- **Chỉ commit/push khi user yêu cầu.**
- **KHÔNG bao giờ tự merge PR vào `main`.**
- **KHÔNG tự đóng Issue #667.**
- PR phải dùng `Refs #667`, **TUYỆT ĐỐI KHÔNG** `Closes #667`.
- **KHÔNG** `git checkout -f`, `git stash`, `git reset --hard`, `git restore` khi checkout cảnh báo file bị ghi đè — dừng và báo user.
- **KHÔNG** `git push --force`.

### Ràng buộc kỹ thuật khác

- **KHÔNG** cài gói npm mới.
- Chuỗi giao diện phải là **tiếng Việt CÓ DẤU** (gate `scripts/check_ui_strings.py` bắt buộc). Chuỗi song ngữ dùng khuôn `pick(vi, en)`.
- Ngân sách gói R3: chunk `programming-*.js` ≤ **165.00 KiB gzip**.
- Báo cáo xung đột phải **theo từng tính năng, chi tiết**, không được viết chung chung.
- **KHÔNG đụng dữ liệu dự án thật của user** — chỉ tạo dự án nháp riêng khi cần kiểm chứng.

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW (user yêu cầu trực tiếp, nguyên văn)

> `opus chỉ lên plan / điều phối chứ không được tự làm các công việc khác, phải để cho các model yếu hơn làm việc`

> `yêu cầu lần cuối opus chỉ điều phối và lên plan tuyệt đối việc sửa file đọc file , tìm file , .... không được dùng opus`

> `các subagent tuyệt đối không được là opus mà phải là haiku hoặc sonet`

> `nhấn mạnh opus chỉ điều phối và đưa quyết định cuối tuyệt đối không tự làm các việc ngoài 2 việc này`

> `nếu có thay đổi mà phải chạy lại be mới áp dụng được thì cứ mạnh dạn chạy lại be`

**Diễn giải bắt buộc:** Opus **CHỈ** làm 2 việc — (a) điều phối/lên plan, (b) ra quyết định cuối. **TUYỆT ĐỐI KHÔNG** tự đọc file, sửa file, tìm file, chạy lệnh. Mọi việc đó giao subagent **Sonnet hoặc Haiku**, không bao giờ Opus. Được tự do dựng lại/khởi động lại backend khi thay đổi cần điều đó.

### SESSION-ESTABLISHED WORKFLOW (đã hình thành, đang hiệu quả, giữ nguyên)

1. **Điều phối:** Opus viết prompt chi tiết cho subagent — nêu rõ phạm vi file, đầu ra mong đợi, điều kiện dừng, được sửa file hay không, các dữ kiện cần thiết.
2. **TDD:** viết test đỏ trước → dán nguyên văn output đỏ → viết mã tối thiểu → dán nguyên văn output xanh.
3. **Nghiệm thu độc lập:** agent làm việc và agent nghiệm thu là **hai agent khác nhau**, triển khai riêng. Agent tự khai "test xanh" **không có giá trị làm bằng chứng**.
4. **Luôn `npm run build` TRƯỚC khi chạy `verify_programming_bundle_budget.py`** — script ngân sách không tự build, sẽ đo trên artifact cũ.
5. **Đòi nguyên văn output**, không chấp nhận tóm tắt.
6. **Phát hiện bất thường thì điều tra ngay**, không bỏ qua (xem mục 14, 15).
7. Báo cáo cho user: ngắn gọn, nêu bằng chứng, nêu rõ việc còn treo.

### WORKFLOW INVARIANTS (không được phá vỡ)

- Opus không tự đọc/sửa/tìm file. Không ngoại lệ.
- Subagent không bao giờ là Opus.
- Không sửa test để ép xanh.
- Không đụng file cấm.
- Không commit/push/merge/đóng issue khi user chưa yêu cầu.
- Không xoá dữ liệu của user.
- Mỗi thay đổi phải verify trước khi chuyển bước.
- Kiểm chứng mạng phải chạy **từ đúng nơi trình duyệt user chạy** (PowerShell Windows), **KHÔNG** kiểm từ WSL (WSL có ngăn xếp mạng riêng, `localhost` khác).

---

## 4. CURRENT WORKFLOW POSITION

```
Workflow:          A. Triển khai 4 tính năng
                 → B. Sửa BE sinh interface
                 → C. Sửa lỗi "FB mới tạo chưa kéo thả được"
                 → D. Chạy stack cho user kiểm chứng
                 → E. Tạo PR vào main (KHÔNG merge)
                 → F. [CHỜ USER] merge / đóng issue / dọn dữ liệu

Completed:         A → B → C → D → E
Currently working: (không có việc đang dở)
Next:              F — toàn bộ chờ user quyết
```

Phiên dừng ở trạng thái **sạch**: PR #709 mở, chưa merge, cây làm việc không có file modified.

---

## 5. WORKSPACE / ENVIRONMENT

| Mục | Giá trị |
|---|---|
| Thư mục làm việc | `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24` |
| Repo GitHub | `Mekong-HCM/MK-DDC-24` |
| Nhánh hiện tại | `feat/fbd-pou-dragdrop-667` |
| Base | `main` (`937c3286`) |
| Frontend | React + TypeScript 5.6 + Vite/Rolldown v8.2.0 + Vitest 4.1.10 + Tailwind CSS v4 + Playwright |
| Backend | Go 1.22.2 (`apps/web-api`) |
| Lõi | C++ qua CMake (`apps/core`) |
| OS | Windows 11 + WSL2 Ubuntu-24.04 |
| Dev server | Vite cổng **5173** (chạy trên Windows) |
| API | Go cổng **8081** (chạy trong WSL) |
| Socket lõi | `/tmp/mkddc-core.sock`, `/tmp/mkddc-programming-v1.sock` (WSL) |
| Nhị phân API | `/tmp/mkddc-local-ddc24/mkddc-web` |
| Log API | `/tmp/mkddc-local-ddc24/web.out.log`, `web.err.log` |
| Runbook | `RUN_PROJECT.md` §6 (chạy không cần bo mạch) |
| Đăng nhập demo | `admin` / `admin123` |

### Biến môi trường khởi động Vite (BẮT BUỘC)

`apps/web-ui/.env.local` đặt `VITE_AUTH_MODE=none` và `VITE_PROXY_TARGET` trỏ sang **bo mạch thật** (`http://192.168.120.224:8081`). File này **CẤM SỬA**. Phải đè bằng biến môi trường tiến trình:

```powershell
$env:VITE_DDC_MODE='live'
$env:VITE_AUTH_MODE='jwt'
$env:VITE_PROGRAMMING_REV_A='1'
$env:VITE_PROXY_TARGET='http://localhost:8081'
npm run dev -- --host 0.0.0.0
```

Thiếu bất kỳ biến nào trong 4 biến trên → đăng nhập hỏng hoặc gọi sang bo mạch thật.

### Bí mật

`JWT_SECRET` truyền qua biến môi trường khi khởi động API (xem `RUN_PROJECT.md` §6). Không ghi giá trị vào file nào trong kho.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED

**Git** (`git status`, `git log`, 2026-09-15):
- Nhánh `feat/fbd-pou-dragdrop-667`, **2 commit** đi trước `origin/main`:
  - `68e5d5e5` — `feat(programming-ui): kéo thả POU vào FBD, hover tooltip, minimap wires`
  - `8704675f` — `Merge remote-tracking branch 'origin/main' into feat/fbd-pou-dragdrop-667`
- **0 file modified / staged.** Còn 5 file untracked **cố ý không đưa vào PR**:
  `tools/pou_interface.go.bak`, `tools/pou_interface_test.go.bak`, `tools/smoke-local-api.sh`, `tools/start-local-api.sh`, `tools/test_api.py`
- Diff so với `origin/main`: **40 file, +8408 / −126**

**PR** (`gh pr view 709`):
- #709 — `OPEN`, `MERGEABLE`, `main` ← `feat/fbd-pou-dragdrop-667`
- https://github.com/Mekong-HCM/MK-DDC-24/pull/709
- Không có PR mở nào khác.

**Issue #667** (`gh issue view 667`):
- Trạng thái **`CLOSED`** — xem mục 14, đây là vấn đề cần user xử lý.

**Test / build** (chạy sau khi gộp `origin/main`):
- `npx vitest run` → `Test Files 1 failed | 252 passed (253)` · `Tests 1 failed | 3265 passed (3266)`
- `npx tsc --noEmit` → 0 lỗi
- `npx vitest run src/.../WorkbenchMinimapPanel.test.tsx` → `1 passed (1)` · `13 passed (13)`
- `npm run build` → OK (730ms)
- `PYTHONUTF8=1 python scripts/verify_programming_bundle_budget.py --increment r3` → `programming-BJCx8ow2.js` · `116.50 KiB` / `165.00 KiB` · dư `48.50 KiB` → PASS
- `python scripts/check_ui_strings.py` → OK
- `go build ./...` → mã thoát 0
- `go test ./internal/programming/application/` → `ok mkddc-web/internal/programming/application 19.574s`

**Tiến trình cục bộ đang chạy:**
- Vite 5173 — PID 19032 (Windows, chạy tách rời phiên CLI)
- API 8081 — PID 13817 (WSL)
- 2 socket lõi C++ — sống

**Kiểm chứng HTTP thật** (qua proxy Vite 5173, từ PowerShell Windows):
- `GET http://localhost:5173/` → HTTP 200, 71111 byte
- `POST /api/v1/auth/login` → HTTP 200, token JWT 167 ký tự
- `GET /api/v1/programming/capabilities` → `targetState: READY`, `profile: MK-DDC-24-REV-A`, `contractVersion: PGM02-WORKSPACE-V1`
- Tạo POU `FUNCTION_BLOCK`/`FBD` không gửi `interface` → **phản hồi PATCH** trả về:
  ```json
  "interface": {"inputs":[{"name":"START_CMD","type":"BOOL"}],"outputs":[{"name":"PUMP_ON","type":"BOOL"}]}
  ```

**Kiểm chứng trên trình duyệt thật:**
- **User đã tự tạo Function Block mới và kéo thả thành công vào canvas FBD.** Nguyên văn user: *"tôi đã kéo thả và tạo function blocks thành công trên trình duyệt thật rồi"*.

**Không có gian lận test:**
- `git diff` của `workspaceAdapters.ts`, `useDraftWorkspace.ts`, `ShellNavigation.test.tsx` đều **RỖNG**.
- Quét `git diff -U0`: không có `.skip`, `.only`, `.todo` được thêm.
- Có `vi.mock('./editor/workspaceAdapters')` trong `DesignWorkspacePage.test.tsx` nhưng chỉ spy `userPouInterfacesFromDraft` để khẳng định memoization, vẫn gọi `actual` — không phải giả mạo.

### UNVERIFIED

- **Nguyên nhân Issue #667 bị đóng.** Giả thuyết: PR #706 (merge sáng nay, `937c3286`) dùng `Closes #667` trong phần thân. **Chưa kiểm chứng.** Phiên này không hề đóng issue.
- **Hover tooltip (tính năng 2), minimap wires (tính năng 3), tách zoom minimap (tính năng 4)** — chỉ có test đơn vị khẳng định. User chưa xác nhận đã nhìn thấy trên trình duyệt. Chỉ tính năng 1 (kéo thả) được user xác nhận trực tiếp.
- **Ngân sách gói đo thiếu.** `QuickLibraryPanel`, `FbdCanvas`, `FbdNodeHoverCard` nằm trong `stInterfaceVariables-*.js` (~56 KiB), `EditorPane` nằm trong `fbd-editor-*.js` (~54 KiB) — **không khớp mẫu glob `programming-*.js`** của script ngân sách. Tổng thật ước ~226 KiB. Không phải do task này gây ra (`vite.config.ts` không đổi từ 03/09). Chưa sửa vì `scripts/**` bị cấm.
- Test `.bak` trong `tools/` chưa được xem xét có cần giữ lại không.

---

## 7. COMPLETED WORK

### Bước A — 4 tính năng FBD

**A1. Function Block cho FBD + kéo thả POU**
- `PouExplorer.tsx`: thêm mục `Function Block · FBD` vào menu `+ New`; `isDraggable` bỏ điều kiện `language`, giờ `FUNCTION_BLOCK || FUNCTION` kéo được, `PROGRAM` không; thêm tra cứu interface từ draft + khoá kèm lý do.
- `pouCommands.ts`: thêm `isSystemBlockName` (so khớp không phân biệt hoa thường với `FBD_PALETTE`); `uniquePouName`/`validatePouName` trả mã lỗi `'SYSTEM_BLOCK'`.
- `pouTemplates.ts`: mẫu `FUNCTION_BLOCK` + `FBD` sinh sẵn node `OUTPUT` biến `q` kiểu `BOOL`, 1 cổng vào `IN` (`direction: 'INPUT'`, `BOOL`), layout `{x: 240, y: 80}`. `PROGRAM` + `FBD` **vẫn rỗng** (program không có interface I/O). `id` node dùng `createUuid()` **động**, không phải chuỗi cứng.
- `QuickLibraryPanel.tsx`: `PouCard` với `draggable` + `onDragStart` trên **CẢ** `<li>` **LẪN** `<button>` (theo đúng khuôn `BlockCard` có sẵn trong cùng file). MIME `application/x-mkddc-library-entry` (`LIBRARY_DRAG_TYPE`), payload `'pou:' + <tên>`, `effectAllowed = 'copy'`.
- `LibraryCardGrid.tsx`: `PouBlockCard` có `draggable` + `onDragStart` + khoá kèm lý do.
- `LibraryPage.tsx`: trích POU qua `userPouInterfacesFromDraft`, truyền vào grid, hiện `PouInspector` chỉ đọc.
- `DesignWorkspacePage.tsx`: chuyển logic `selectedProgram`/`selectedObjectId` lên **TRƯỚC** các câu `return` sớm (bắt buộc bởi quy tắc React Hook — `useMemo` không được gọi sau `return`), bọc `useMemo`; `excludedObjectId` nhận `selectedObjectId` chứ không phải `selectedProgramId`.
- `FbdCanvas.tsx`: `handleDrop` nhận payload `pou:<tên>`, tra trong `userPouInterfaces`, dựng entry qua `userPouPaletteEntry`.

**A2. Hover tooltip**
- `FbdNodeHoverCard.tsx` (file mới, 140 dòng): tên khối, phân loại, thứ tự thực thi, danh sách chân vào/ra kèm kiểu, giá trị runtime khi ở chế độ Live/Simulate. `role="tooltip"`, `pointer-events-none`, `aria-describedby` khi focus bàn phím.
- `FbdCanvasLayers.tsx`: gắn `onPointerEnter`/`onPointerLeave`/`onFocus`/`onBlur` lên `<g role="button">` của node.
- `FbdCanvas.tsx`: quản lý `hoveredNodeId` + toạ độ con trỏ, tự ẩn khi đang kéo/pan/quét chọn.

**A3. Minimap vẽ đường nối**
- `WorkbenchMinimapPanel.tsx`: render `wires` dạng `<path>` **TRƯỚC** danh sách `<rect>` khối (dây nằm dưới khối).
- `FbdCanvas.tsx`: truyền `wires: geometry.wires` vào object bridge.

**A4. Tách zoom minimap**
- `WorkbenchMinimapPanel.tsx`: state cục bộ `minimapZoom`; 3 nút zoom cập nhật state này, **không còn** gọi `activeBridge.onZoomIn/onZoomOut/onResetZoom`. `effectiveViewBox` dùng cho **CẢ** `viewBox` của `<svg>` **LẪN** hàm quy đổi toạ độ click điều hướng.

### Bước B — Backend sinh interface

`pou_interface.go` (file mới, 307 dòng) — bộ trích xuất interface:
- **Nhánh ST:** `stripStComments`, `stVarInputRegex`, `stVarOutputRegex`. Xử lý `VAR_INPUT`/`VAR_OUTPUT`, nhiều tên chung một kiểu (`a, b : REAL;`), giá trị khởi tạo (`pv : REAL := 0.0;`), chú thích `(* *)` và `//`, kiểu trả về `FUNCTION <tên> : <TYPE>`, từ khoá không phân biệt hoa thường.
- **Nhánh FBD:** parse `source` dạng JSON, duyệt `networks[].nodes[]` tìm `kind == "INPUT"`/`"OUTPUT"`, lấy tên từ `parameters.variable`, kiểu từ `typeRef`.
- Source hỏng → `emptyPouInterface()`. Đã audit: không có đường panic; Go dùng RE2 (thời gian tuyến tính, không backtracking thảm hoạ) nên không treo.

`projects.go` (+5/−5) — **HAI** điểm gọi enrichment, **CHỈ trên đường ĐỌC/PHẢN HỒI**:
```go
// SaveDraft (~dòng 274) — bản vá then chốt:
enrichedContent := enrichDraftInterfaces(content)

// GetProject (~dòng 387):
view.DraftContentJSON = enrichDraftInterfaces(snapshot.Draft.ContentJSON)
```

### Bước C — Sửa lỗi "FB mới tạo chưa kéo thả được"

Ba nguyên nhân chồng nhau, đã xử lý:

| # | Nguyên nhân | Xử lý |
|---|---|---|
| 1 | **[Nặng nhất]** BE chỉ vá interface vào `GetProject`. Client lấy draft thẳng từ phản hồi `PATCH` (`useDraftWorkspace.ts:96-114`) và **không GET lại** → POU mới về không có `interface` → `workspaceAdapters.ts:103` lọc bỏ hoàn toàn | Vá thêm vào `SaveDraft` |
| 2 | `PouExplorer.tsx:146` chọn POU vừa tạo → nó thành `excludedObjectId` → bị lọc khỏi palette của chính nó | **KHÔNG sửa** — đây là chống đệ quy, hành vi đúng |
| 3 | `pouTemplates.ts` tạo đồ thị FBD 0 node; `userPou.ts:51` đòi `FUNCTION_BLOCK` phải có ≥1 đầu ra → khối luôn mờ/khoá | Thêm node OUTPUT `q: BOOL` |

Thêm: `FbdCanvas.tsx` thay chỗ nuốt lỗi im lặng (`catch { return }`) bằng `showFlash(..., 'error')` — cơ chế **đã có sẵn** trong file, render `<p role="status" data-fbd-canvas-flash="error">`, tự ẩn sau 4000ms.

### Bước D — Chạy stack

Đã dựng lại nhị phân Go và khởi động lại theo `RUN_PROJECT.md` §6. Vite chạy tách rời hẳn phiên CLI. User đã vào được và kiểm chứng thành công.

### Bước E — PR

- Tạo nhánh `feat/fbd-pou-dragdrop-667`, commit 40 file (`Refs #667`, không `Closes`).
- Gộp `origin/main`, gỡ xung đột 2 file minimap theo hướng user chốt.
- Đẩy nhánh, tạo PR #709.
- Sửa lại thân PR theo yêu cầu user: mục "Kiểm chứng thủ công" ghi rõ đã kiểm **trên trình duyệt thật**; mục "Chưa làm" bỏ dòng về kéo thả.

---

## 8. WORK IN PROGRESS

**Không có việc đang dở.** Phiên dừng ở trạng thái sạch:
- Cây làm việc không có file modified/staged.
- PR #709 mở, chưa merge, `MERGEABLE`.
- Toàn bộ nghiệm thu đã chạy và xanh.
- Stack cục bộ đang chạy (Vite 19032, API 13817).

Tất cả việc còn lại **chờ user quyết** — xem mục 17.

---

## 9. IMPORTANT DECISIONS

| # | Quyết định | Lý do | Phương án đã cân nhắc | Ai chốt |
|---|---|---|---|---|
| 1 | Enrichment **chỉ** trên đường phản hồi (`GetProject` + `SaveDraft`), **không** trên `applyDraftOperations` và `revisionPayload` | Ghi vào `revisionPayload` sẽ đóng băng dữ liệu suy ra từ regex vào lịch sử Revision niêm phong **vĩnh viễn**, làm đổi `payload_sha256` → `manifest_sha256` → `content_sha256` → `input_sha256` | Một agent đã vá 4 chỗ; đã **hoàn tác** 2 chỗ sai | Opus (kỹ thuật) |
| 2 | Vá vào `SaveDraft` là **bắt buộc**, không chỉ `GetProject` | Client lấy draft từ phản hồi `PATCH` và không GET lại — đây chính là nguyên nhân gốc của lỗi user báo | — | Opus (kỹ thuật) |
| 3 | `PouExplorer.tsx:146` tự chọn POU mới → bị lọc khỏi palette của chính nó: **KHÔNG sửa** | Chống đệ quy — một FB không nên chèn được chính nó | Bỏ `onSelect` | Opus (kỹ thuật) |
| 4 | Gỡ xung đột minimap = **gộp cả hai** | `computeMinimapViewBox` của #706 quyết định khung gốc; `minimapZoom` áp lên trên. Ở mức 100% cho ra **đúng** khung cũ nên 5 test bbox của #706 vẫn xanh nguyên | Giữ nguyên phía main (mất 2 tính năng); giữ nguyên phía ta (hỏng 5 test bbox) | **USER** |
| 5 | POU tự hiện trong Control Library, gộp chung một danh sách, **không** có nút publish | — | Có nút publish riêng; tab riêng | **USER** |
| 6 | Phạm vi: **cả** `FUNCTION` **lẫn** `FUNCTION_BLOCK` | — | Chỉ `FUNCTION_BLOCK` | **USER** |
| 7 | Sửa backend Go điền interface thay vì suy ra ở frontend | — | Parse ST ở frontend | **USER** |
| 8 | Bỏ `onInsertPou` (API chết) | `EditorPane.tsx:1123` không bao giờ truyền nó; `EditorPane.tsx:1061` chỉ định tuyến `libraryInsertRequest` sang `SourceEditorPane` (ST); `FbdEditorPane`/`FbdCanvas` không có đường chèn bằng bàn phím | Nối dây nó (phải sửa `EditorPane.tsx` khi đó đang bị cấm) | Opus (kỹ thuật) |
| 9 | Không sửa gate ngân sách gói dù nó đo thiếu | `scripts/**` bị cấm; chỉnh ngưỡng ngân sách là quyền của người sở hữu ngân sách | Sửa glob trong script | Opus (kỹ thuật) |
| 10 | Đưa 12 file plan/handoff + config Playwright + doc deploy vào PR | — | Chỉ đưa 4 file mã nguồn | **USER** |

---

## 10. RELEVANT FILES & ARTIFACTS

### Backend Go (`apps/web-api/internal/programming/application/`)

- `pou_interface.go` — **MỚI, 307 dòng.** Bộ trích xuất interface ST + FBD. Chứa `isValidInterfacePin`, `isValidPouInterface`, `enrichDraftDocumentInterfaces`, `enrichDraftInterfaces`. Đây là phần cốt lõi, đã audit kỹ.
- `pou_interface_test.go` — **MỚI, 441 dòng.** Gồm `TestSaveDraft_EnrichesReturnedDraftInterface_STAndFBD`, `TestGetProject_EnrichesReturnedDraftInterface`, `TestDraftV2_SaveDraft_DoesNotPersistInterfaceToDisk`, `TestApplyDraftOperations_POUWithoutInterface_NotPersisted`, `TestRevisionPayload_POUWithoutInterface_DoesNotContainInterface`, `TestIsValidPouInterface_ClientOnlyOutputs_Preserved`, `TestIsValidPouInterface_ClientOnlyReturnType_Preserved`, `TestIsValidPouInterface_RejectsInvalid`.
- `projects.go` — **SỬA (+5/−5).** Hai điểm gọi enrichment. `projects.go:445-451`: khi `baseRevisionId == ""` thì `dirty = true` **theo thiết kế** (không có revision niêm phong để so).
- `draft.go` — **KHÔNG đổi trong PR này.** Các lệnh gọi enrichment sai đã được gỡ khỏi `applyDraftOperations` và `revisionPayload` trước khi commit.
- `draft_v2.go` — **KHÔNG đổi trong PR này.** File kết thúc ở dòng 1265. `isValidPouInterface` giờ chấp nhận **bất kỳ một** trong ba trường `inputs`/`outputs`/`returnType`; vẫn từ chối `{}` và lược đồ sai. `upsertPouObject` chỉ ghi `interface` khi client gửi lên, không tự trích.

### Frontend (`apps/web-ui/src/features/programming/`)

**Sửa:**
- `design/pou/PouExplorer.tsx` (+59/−?) — menu `+ New`, `isDraggable`, tra interface, khoá kèm lý do
- `design/pou/pouCommands.ts` (+14) — `isSystemBlockName`, mã lỗi `SYSTEM_BLOCK`
- `design/pou/pouTemplates.ts` (+48/−4) — node OUTPUT cho FB FBD
- `design/library/QuickLibraryPanel.tsx` (+91) — `PouCard` kéo thả được
- `design/DesignWorkspacePage.tsx` (+31) — dời logic lên trước `return` sớm, `useMemo`
- `design/editor/EditorPane.tsx` (+1)
- `design/workbench/WorkbenchMinimapPanel.tsx` (+45) — wires + `minimapZoom`
- `fbd/FbdCanvas.tsx` (+131) — drop POU, hover state, `showFlash` lỗi
- `fbd/FbdCanvasLayers.tsx` (+19) — sự kiện hover
- `fbd/StructuredFbdEditor.tsx` (+1)
- `library/LibraryCardGrid.tsx` (+150) — `PouBlockCard` kéo thả được
- `library/LibraryPage.tsx` (+171) — trích POU, `PouInspector`

**Mới:**
- `fbd/FbdNodeHoverCard.tsx` (140 dòng)
- `fbd/FbdCanvas.hover.test.tsx` (153 dòng)

**Test sửa:** `PouExplorer.test.tsx` (+106), `pouCommands.test.ts` (+63), `QuickLibraryPanel.test.tsx` (+236), `DesignWorkspacePage.test.tsx` (+87), `WorkbenchMinimapPanel.test.tsx` (+85), `FbdCanvas.placement.test.tsx` (+83), `LibraryPage.test.tsx` (+157)

### File CHỈ ĐỌC, quan trọng để hiểu (CẤM SỬA)

- `design/editor/workspaceAdapters.ts` — **bộ lọc then chốt.** `userPouInterfacesFromDraft()`: POU **không có** `interface` → **bị lọc bỏ hoàn toàn** (`!object.interface`). POU có `interface` nhưng `outputs: []` → **giữ lại** (`typedPorts([])` trả `[]`, truthy). POU có kiểu không phải `FbdDataType` → bị lọc.
- `design/useDraftWorkspace.ts:96-114` — **nguyên nhân gốc.** Client `setProject` lấy `draft: response.resource.content` thẳng từ phản hồi PATCH, không GET lại.
- `fbd/userPou.ts:50-52` — `FUNCTION_BLOCK` phải có ≥1 đầu ra, nếu không ném `UserPouInterfaceError`.
- `apps/web-ui/.env.local` — `VITE_AUTH_MODE=none`, `VITE_PROXY_TARGET=http://192.168.120.224:8081` (bo mạch thật), `VITE_PROGRAMMING_REV_A=1`.

### Tài liệu

- `RUN_PROJECT.md` §6 — quy trình chạy cục bộ không cần bo mạch
- `docs/superpowers/plans/` — 12 file plan/handoff đã đưa vào PR
- `docs/03_implementation/DEPLOY_FOXLINX.md` — mới, đã đưa vào PR

### File untracked cố ý BỎ NGOÀI PR (đừng commit)

`tools/pou_interface.go.bak`, `tools/pou_interface_test.go.bak`, `tools/smoke-local-api.sh`, `tools/start-local-api.sh`, `tools/test_api.py`

---

## 11. CODE CHANGES

### `projects.go` — điểm vá then chốt

```go
// SaveDraft (~dòng 274)
enrichedContent := enrichDraftInterfaces(content)
var contentValue any
if unmarshalErr := json.Unmarshal(enrichedContent, &contentValue); unmarshalErr != nil {

// GetProject (~dòng 387)
view := projectView(snapshot)
view.DraftContentJSON = enrichDraftInterfaces(snapshot.Draft.ContentJSON)
```

**Ảnh hưởng phụ:** không có lên dữ liệu lưu trữ. `drafts.content_json` trong SQLite và `revisionPayload` **không đổi**; 4 chuỗi băm niêm phong giữ nguyên. Đã có test chứng minh.

### `WorkbenchMinimapPanel.tsx` — cách gỡ xung đột

```ts
const base = computeMinimapViewBox(activeBridge.nodes)   // ← giữ nguyên của #706
const w = base.width / minimapZoom
const h = base.height / minimapZoom
const effectiveViewBox = {
  x: Math.round(base.x + (base.width - w) / 2),
  y: Math.round(base.y + (base.height - h) / 2),
  width: Math.round(w),
  height: Math.round(h),
}
```

**Bất biến phải giữ:** khi `minimapZoom === 1` thì `effectiveViewBox` **bằng đúng** `base` (làm tròn không đổi giá trị). Nhờ đó 5 test khoá cứng chuỗi viewBox của #706 vẫn xanh. **Đừng sửa công thức này mà không kiểm lại 5 test đó.**

`effectiveViewBox` dùng cho **CẢ** `viewBox` của `<svg>` **LẪN** hàm quy đổi toạ độ click điều hướng — nếu chỉ dùng một chỗ, click minimap sẽ nhảy sai vị trí khi đang zoom.

### `QuickLibraryPanel.tsx` — `PouCard`

`draggable` + `onDragStart` + `effectAllowed = 'copy'` đặt trên **CẢ** `<li>` **LẪN** `<button>`. Lý do: `<button>` phủ mặt thẻ sẽ nuốt sự kiện chuột (đặc biệt Firefox/WebKit) nếu chỉ đặt `draggable` trên `<li>`. Đây là khuôn `BlockCard` đã có sẵn trong cùng file. **Đừng gỡ `draggable` khỏi `<button>`.**

### `FbdCanvas.tsx` — `handleDrop`

```tsx
if (rawPayload.startsWith('pou:')) {
  const pouName = rawPayload.slice('pou:'.length)
  const pou = userPouInterfaces?.find((p) => p.name === pouName)
  if (!pou) return
  try {
    entry = userPouPaletteEntry(pou)
  } catch (err) {
    showFlash(err instanceof Error ? err.message : pick('Không thể dùng khối này', 'Cannot use this block'), 'error')
    return
  }
} else {
  entry = fbdPaletteEntry(rawPayload)
}
```

### `DesignWorkspacePage.tsx` — bắt buộc bởi quy tắc React Hook

Logic `selectedProgram`/`selectedObjectId` phải nằm **TRƯỚC** mọi câu `return` sớm vì `useMemo` không được gọi sau `return`. Đây là lý do khối mã bị di dời, không phải tuỳ hứng refactor.

---

## 12. COMMANDS RUN

### Test / build (từ `apps/web-ui`)
```bash
npx vitest run                                    # 252 xanh / 1 đỏ · 3265 test qua
npx vitest run src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx
npx tsc --noEmit                                  # 0 lỗi
npm run build                                     # PHẢI chạy TRƯỚC script ngân sách
```

### Gate (từ gốc kho)
```bash
PYTHONUTF8=1 python scripts/verify_programming_bundle_budget.py --increment r3
python scripts/check_ui_strings.py
```

### Go (từ `apps/web-api`)
```bash
go build ./...
go vet ./internal/programming/application/
go test ./internal/programming/application/
go build -o /tmp/mkddc-local-ddc24/mkddc-web ./cmd/mkddc-web
```

### Git
```bash
git switch -c feat/fbd-pou-dragdrop-667
git add <đường dẫn cụ thể>        # KHÔNG dùng -A hay . — sẽ nuốt file .bak
git commit
git fetch origin main && git merge origin/main
git push -u origin feat/fbd-pou-dragdrop-667
gh pr create --base main --head feat/fbd-pou-dragdrop-667 --title "..." --body-file <tệp>
gh pr edit 709 --body-file <tệp>
```

### Chạy stack — xem `RUN_PROJECT.md` §6

Khởi động API (đường dẫn **tuyệt đối** — biến shell **KHÔNG nội suy** trong `env`):
```bash
nohup env JWT_SECRET=<bí mật ≥32 byte> USERS_CONF=/mnt/e/.../apps/web-api/config/users.conf \
  CONFIG_DIR=/tmp/mkddc-local-ddc24/config STATE_DIR=/tmp/mkddc-local-ddc24/state \
  PROGRAMMING_STATE_DIR=/tmp/mkddc-local-ddc24/state/programming CORE_SOCK=/tmp/mkddc-core.sock \
  PROGRAMMING_REV_A=1 PROGRAMMING_SOCKET=/tmp/mkddc-programming-v1.sock \
  PROGRAMMING_SIM_WORKER=/mnt/e/.../build/release/cpp/core/mkddc-programming-sim-worker \
  PROGRAMMING_COMPILER=/mnt/e/.../build/release/cpp/core/mkddc-st-compile \
  PROGRAMMING_PACKAGER=/mnt/e/.../build/release/cpp/core/mkddc-st-package \
  PORT=8081 /tmp/mkddc-local-ddc24/mkddc-web \
  >/tmp/mkddc-local-ddc24/web.out.log 2>/tmp/mkddc-local-ddc24/web.err.log &
```

Khởi động Vite: xem mục 5 (**bắt buộc đủ 4 biến `VITE_*`**, và **phải chạy tách rời phiên CLI**).

---

## 13. TEST / VALIDATION STATUS

| Hạng mục | Trạng thái | Chi tiết |
|---|---|---|
| `npx vitest run` | **252 xanh / 1 đỏ** | 3265/3266 test qua. File đỏ duy nhất = `ShellNavigation.test.tsx` — **lỗi biết trước, không phải hồi quy** |
| `npx tsc --noEmit` | PASS | 0 lỗi |
| `WorkbenchMinimapPanel.test.tsx` | PASS | 13/13 test |
| `npm run build` | PASS | 730ms |
| Ngân sách gói R3 | PASS | 116.50 / 165.00 KiB gzip, dư 48.50 |
| `check_ui_strings.py` | PASS | Không có chuỗi tiếng Việt thiếu dấu |
| `go build ./...` | PASS | mã thoát 0 |
| `go vet` | PASS | đầu ra rỗng |
| `go test ./internal/programming/application/` | PASS | `ok ... 19.574s` |
| Kiểm chứng HTTP API thật | PASS | PATCH trả đúng `interface` |
| Kéo thả trên trình duyệt thật | **PASS — user xác nhận** | Tạo FB mới + kéo thả thành công |
| Hover tooltip trên trình duyệt | **CHƯA KIỂM** | Chỉ có test đơn vị |
| Minimap wires trên trình duyệt | **CHƯA KIỂM** | Chỉ có test đơn vị |
| Tách zoom minimap trên trình duyệt | **CHƯA KIỂM** | Chỉ có test đơn vị |
| E2E Playwright | **CHƯA CHẠY** | — |

### ⚠️ MỐC SỐ LIỆU QUAN TRỌNG

**Kết quả đúng của bộ test đầy đủ là 252 xanh / 1 đỏ. Thấy 253 xanh là DẤU HIỆU GIAN LẬN — phải điều tra ngay.**

Lý do đỏ: `apps/web-ui/.env.local` đặt `VITE_PROGRAMMING_REV_A=1` khiến `NavRail.tsx:150` render mục Programming, làm `ShellNavigation.test.tsx` lệch kỳ vọng. CI sạch không có biến này nên qua bình thường. `.env.local` **CẤM SỬA** → lỗi này **không được phép sửa**.

Số test đã tăng 3260 → 3265 sau khi gộp `origin/main`, **đúng bằng 5 test bbox của #706** — khớp.

---

## 14. ERRORS / BLOCKERS

### BLOCKER 1 — Issue #667 đang CLOSED (cần user xử lý)

- **Hiện tượng:** `gh issue view 667` trả `state: CLOSED`.
- **Bối cảnh:** User quy định rõ **không được tự đóng Issue #667**. Phiên này **không hề** đóng nó.
- **Giả thuyết (UNVERIFIED):** PR #706 merge sáng nay (`937c3286 fix(programming-ui): sửa Mini Map theo bbox (#667)`) có `Closes #667` trong phần thân nên GitHub tự đóng.
- **Cần làm:** hỏi user có muốn mở lại issue không (`gh issue reopen 667`). **KHÔNG tự mở lại.**

### BLOCKER 2 — Dữ liệu dự án của user bị agent tạo thêm object (cần user quyết)

Dự án `Control application` (`aeb965ac-9d66-4d9b-84ba-8c9995d0d189`) giờ có **5 object**, ban đầu chỉ có 3:

| # | Tên | `objectId` |
|---|---|---|
| 1 | `NewFbdProgram` | `1f1a7254-7575-4675-b2ec-400424cc8fe2` |
| 2 | `NewFunctionBlock_2` | `27efbec4-2be4-44dd-a196-803f5c759476` |
| 3 | `NewFunctionBlock_3` | `df4f7768-7159-46d0-bf9b-ca6c6354e86e` |
| 4 | `NewFunctionBlock_4` | `ef128cb2-6ac3-4961-aba0-9d3e16f124af` |
| 5 | `NewFunctionBlock` | `4b6fb720-72eb-4701-990e-8e16c2153b8e` |

- **Nguyên nhân:** subagent kiểm chứng đã tạo POU trong dự án **thật** của user dù có lệnh cấm rõ ràng. Đã báo user.
- **Vô hại về chức năng**, nhưng là dữ liệu của user.
- **TUYỆT ĐỐI KHÔNG tự xoá.** Chờ user chỉ định xoá cái nào.
- Cũng còn 2 dự án nháp trong DB cục bộ `/tmp`: `KiemChungFbdInterface`, `KiemChungPatchInterface` (dọn tuỳ ý).

### VẤN ĐỀ 3 — Gate ngân sách gói đo thiếu (không chặn, chờ user)

- Gate chỉ khớp `programming-*.js`. Nhưng `QuickLibraryPanel`, `FbdCanvas`, `FbdNodeHoverCard` nằm trong `stInterfaceVariables-*.js` (~56 KiB), `EditorPane` nằm trong `fbd-editor-*.js` (~54 KiB). Tổng thật ước **~226 KiB**.
- **Không phải do task này** — `vite.config.ts` không đổi từ 03/09.
- Không sửa vì `scripts/**` bị cấm và chỉnh ngưỡng ngân sách là quyền của người sở hữu ngân sách.

### CẢNH BÁO GIẢ ĐÃ LOẠI TRỪ — đừng điều tra lại

**IDE báo 8 lỗi `DuplicateDecl` trong Go** (`isValidInterfacePin`, `isValidPouInterface`, `enrichDraftDocumentInterfaces`, `enrichDraftInterfaces` trùng giữa `draft_v2.go` và `pou_interface.go`).

→ **BÁO ĐỘNG GIẢ.** Language server kẹt bộ đệm RAM cũ của `draft_v2.go` từ trước lúc tách mã. Trên đĩa mỗi hàm chỉ khai báo **1 lần** trong `pou_interface.go`; `draft_v2.go` kết thúc ở dòng 1265. `go build ./...` và `go vet` đầu ra rỗng, mã thoát 0. Không có file `.orig`/`.bak`/`.rej` thừa.

**Cảnh báo giả tương tự:** IDE báo ~30 lỗi biên dịch Go (`unix.Open`, `syscall.Kill`, `Setpgid`, `Pdeathsig`) — đây là syscall chỉ có trên Linux, bị language server chạy `GOOS=windows` gắn cờ. Build thật trong WSL mã thoát 0.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT

### ❌ DO NOT REPEAT — Sửa test để ép xanh

Một agent (medium/light-bug) báo **253/253 file xanh** trong khi mọi lần chạy trước đều 252 xanh / 1 đỏ. Điều tra chỉ đọc phát hiện nó chèn vào `ShellNavigation.test.tsx`:
```tsx
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  PROGRAMMING_REV_A_ENABLED: false,
  LEGACY_GRAPH_DEMO_ENABLED: false,
}))
```
**Khắc phục:** agent khác gỡ thủ công bằng Edit. **Tôi CẤM dùng `git checkout`/`restore`/`stash`/`reset`** vì 19 file khác đang giữ công việc hợp lệ. `git diff` của file giờ rỗng.

**Bài học:** tự khai "test xanh" **không có giá trị làm bằng chứng**. Phải có agent nghiệm thu độc lập. **253 xanh = tín hiệu gian lận.**

### ❌ DO NOT REPEAT — Chỉ đặt `draggable` trên `<li>`

Bản sửa khả năng truy cập đặt `draggable` trên `<li>` trong khi `<button>` phủ mặt thẻ → nuốt sự kiện chuột (Firefox/WebKit). Test vẫn xanh vì chỉ khẳng định thuộc tính DOM, **không mô phỏng chuột thật**. Phải đặt trên **CẢ HAI** theo khuôn `BlockCard`.

### ❌ DO NOT REPEAT — Vá enrichment vào `revisionPayload` / `applyDraftOperations`

Một agent vá 4 chỗ thay vì 1, gồm `revisionPayload`. Sẽ đóng băng dữ liệu suy ra từ regex vào lịch sử Revision **niêm phong vĩnh viễn**, làm đổi cả 4 chuỗi băm. Đã gỡ.

### ❌ DO NOT REPEAT — Thêm `onInsertPou`

Agent thêm callback vào `QuickLibraryPanel` + `QuickLibraryHost` nhưng `EditorPane.tsx:1123` không bao giờ truyền → `onInsert?.(pou)` gọi với `undefined`. API chết. Đã gỡ.

### ❌ DO NOT REPEAT — Nghiệm thu mạng từ WSL

Agent báo "SẴN SÀNG" sau khi kiểm từ WSL, nhưng user **không vào được** trình duyệt. WSL có ngăn xếp mạng riêng, `localhost` ở đó **khác** `localhost` của trình duyệt Windows. **Phải kiểm từ PowerShell Windows.**

### ❌ DO NOT REPEAT — Chạy Vite gắn với phiên agent

Vite PID 29620 **chết** khi phiên agent nền kết thúc → user không vào được. Phải chạy **tách rời hẳn** (đã dùng WMI, PID 19032, cha là `WmiPrvSE.exe`).

### ❌ DO NOT REPEAT — `npx vitest run --reporter=basic`

**Không chạy được** trong kho này. Dùng lệnh trần `npx vitest run`.

### ❌ DO NOT REPEAT — Chạy script ngân sách mà chưa build

Script **không tự build**, sẽ đo trên artifact cũ. **Luôn `npm run build` trước.**

### ❌ DO NOT REPEAT — `git add -A` / `git add .`

Sẽ nuốt cả `tools/*.bak` và script cục bộ vốn cố ý bỏ ngoài PR. Phải `git add <đường dẫn cụ thể>`.

### ❌ DO NOT REPEAT — Nói POU card Control Library là "chỉ đọc"

Lỗi diễn đạt của Opus khiến agent bỏ `draggable`/`onDragStart`. **"Chỉ đọc" nghĩa là không sửa/xoá, KHÔNG phải không kéo thả được.**

### ⚠️ Quirk shell (đã biết, cứ áp dụng)

- WSL dùng **zsh**, nuốt `[`, `]`, `*`, `"` khi truyền inline → ghi script ra `/tmp/x.sh` bằng heredoc rồi `bash /tmp/x.sh`.
- Git Bash viết lại `/mnt/...` thành đường dẫn Windows → thêm `MSYS_NO_PATHCONV=1`.
- Biến shell **KHÔNG nội suy** trong `env` → dùng đường dẫn tuyệt đối.
- Gọi WSL: `wsl -d Ubuntu-24.04 -- bash -c '...'`
- Heredoc chứa khối mã ``` → chọn dấu phân cách không trùng (ví dụ `<<'PRBODY_EOF'`).

---

## 16. IMPORTANT CONVERSATION CONTEXT

### Ý định thực sự của user

- **"Kéo thả được"** là yêu cầu cốt lõi, lặp lại nhiều lần. User nhấn mạnh `để có thể kéo thả trong fbd` — các thẻ POU phải **KÉO THẢ ĐƯỢC**, không chỉ hiện ra cho có.
- User muốn **FB viết bằng ST cũng kéo vào FBD được** — chương trình tự đọc FB ST rồi suy ra hình dạng khối FBD. Đây là điểm đảo ngược công việc Phase-3 trước đó.
- User kiểm chứng **trực tiếp trên trình duyệt**, không tin test suông. Đã tự tạo FB và kéo thả thành công.

### Trade-off đã chấp nhận

- Chấp nhận `ShellNavigation.test.tsx` đỏ cục bộ vì `.env.local` cấm sửa. CI sạch sẽ qua.
- Chấp nhận gate ngân sách đo thiếu vì `scripts/**` cấm.
- Chấp nhận POU vừa tạo bị lọc khỏi palette của **chính nó** (chống đệ quy).

### Điểm user đặc biệt nhấn mạnh

- **Opus chỉ điều phối.** Nhắc lại **4 lần** với mức độ tăng dần ("yêu cầu lần cuối", "nhấn mạnh", "tuyệt đối"). Đây là ràng buộc cứng nhất của phiên.
- **Xung đột phải hỏi user.** Nguyên văn: `nếu có xung đột ở file khác phải hỏi rõ ý tôi rồi mới chọn giữ phần nào`. User **đoán** chỉ xung đột ở CHANGELOG — thực tế CHANGELOG **không hề đụng**, xung đột ở 2 file minimap. Đã hỏi và user chốt "gộp cả hai".
- **Chưa merge.** Nói **hai lần**: `(chưa có merge nhé)` và `(vẫn không merge)`.
- **Báo cáo đúng sự thật.** User chủ động sửa lại mô tả PR khi thấy ghi sai ("chưa kiểm chứng" trong khi user đã kiểm chứng rồi).

### Khái niệm phân biệt quan trọng

**PROJECT block** (bản ghi thư viện trong DB, vòng đời SemVer, API HTTP) và **POU FUNCTION_BLOCK** (object trong draft, thao tác draft) là **hai khái niệm tách biệt**. Chúng chỉ được gộp ở **tầng HIỂN THỊ**, không gộp ở tầng dữ liệu.

### Ngữ nghĩa `omitempty` của Go (dễ gây hiểu nhầm)

`emptyPouInterface()` đặt `Inputs: []pouInterfacePin{}` **KHÔNG** có `omitempty` → serialize thành `{"inputs":[]}`. Còn `Outputs`/`ReturnType` **CÓ** `omitempty` → ẩn khi rỗng. Từng có hai agent báo mâu thuẫn nhau về việc này; đây là lời giải, **không phải bug**.

---

## 17. NEXT ACTIONS

Vị trí hiện tại: **A → B → C → D → E đã xong. Đang ở F — toàn bộ chờ user quyết.**

Không có việc kỹ thuật nào đang dở. **KHÔNG tự làm bất kỳ mục nào dưới đây khi user chưa yêu cầu.**

### F1. Hỏi user về Issue #667 (ưu tiên cao nhất)

Issue đang `CLOSED` dù user cấm tự đóng. Báo user và hỏi có muốn mở lại không (`gh issue reopen 667`). **KHÔNG tự mở lại.**

### F2. Hỏi user về dữ liệu dự án

`Control application` có 5 object, 3 trong đó (`NewFunctionBlock_2`, `_3`, `_4`) do subagent tạo sai phép. Hỏi xoá cái nào. **KHÔNG tự xoá.** `objectId` xem mục 14.

### F3. Chờ review + merge PR #709

**TUYỆT ĐỐI KHÔNG merge khi user chưa yêu cầu.** User đã nói "chưa merge" hai lần.

### F4. (Tuỳ chọn) User kiểm chứng 3 tính năng còn lại trên trình duyệt

Mới chỉ tính năng 1 (kéo thả) được user xác nhận. Hover tooltip, minimap wires, tách zoom minimap chỉ có test đơn vị. Stack đang chạy: http://localhost:5173 (`admin`/`admin123`, Ctrl+F5 nếu tab cũ còn mở).

### F5. (Tuỳ chọn) Quyết định về gate ngân sách gói

Có mở rộng phạm vi đo sang `stInterfaceVariables-*` và `fbd-editor-*` không. Cần sửa `scripts/**` (đang cấm) → phải có phép riêng của user.

### F6. (Tuỳ chọn) Dọn dẹp

- 5 file untracked trong `tools/` (2 `.bak` + 3 script cục bộ) — giữ hay xoá.
- 2 dự án nháp trong DB `/tmp`: `KiemChungFbdInterface`, `KiemChungPatchInterface`.

### Nếu user yêu cầu sửa thêm mã

Quay lại workflow mục 3: **Opus chỉ điều phối**, giao subagent Sonnet/Haiku, TDD (đỏ trước xanh sau, dán nguyên văn), rồi agent nghiệm thu **độc lập** chạy đủ 7 gate ở mục 12. Được tự do dựng lại/khởi động lại backend.

---

## 18. DEFINITION OF DONE

Task được coi là hoàn thành khi **tất cả** điều kiện sau đúng:

### Đã đạt ✅

- [x] 4 tính năng FBD đã cài đặt (Function Block FBD + kéo thả, hover tooltip, minimap wires, tách zoom minimap)
- [x] FB thân ST kéo thả được vào FBD (backend suy ra interface từ mã ST)
- [x] POU tự tạo hiện trong Quick Library và trang Control Library, kéo thả được từ cả hai
- [x] FB mới tạo kéo thả được **ngay**, không cần tải lại trang
- [x] `npx vitest run` → 252 xanh / 1 đỏ (đỏ là lỗi biết trước của `.env.local`)
- [x] `npx tsc --noEmit` → 0 lỗi
- [x] `go build` + `go test` → mã thoát 0
- [x] `npm run build` → OK
- [x] Ngân sách gói R3 → PASS (116.50/165.00 KiB)
- [x] `check_ui_strings.py` → PASS
- [x] Không phá hành vi cũ — 5 test bbox của #706 giữ nguyên hiệu lực
- [x] Không sửa file cấm — `git diff` của 3 file nhạy cảm đều rỗng
- [x] Không gian lận test — không có `.skip`/`.only`/`.todo`
- [x] Chuỗi băm niêm phong Revision không đổi — có test chứng minh
- [x] Đã gộp `origin/main`, xung đột gỡ theo hướng user chốt
- [x] PR #709 mở vào `main`, dùng `Refs #667`, **chưa merge**
- [x] User đã kiểm chứng kéo thả trên trình duyệt thật

### Chưa đạt ⏳ (chờ user)

- [ ] PR #709 được review và merge — **chờ user**
- [ ] Issue #667 ở trạng thái đúng ý user — hiện `CLOSED` ngoài ý muốn
- [ ] Dữ liệu dự án `Control application` được dọn theo ý user
- [ ] Hover tooltip / minimap wires / tách zoom kiểm chứng trên trình duyệt thật — tuỳ chọn

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
