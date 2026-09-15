# HANDOFF — FBD Task 9: hợp nhất origin/main + 4 tính năng trước khi đóng Issue #667

Ngày lập: 2026-09-14
Phiên trước dừng theo yêu cầu user ("tạm dừng lại đi") khi đang ở Giai đoạn 3.

---

## 1. SESSION OBJECTIVE

Trước khi kết thúc Task 9 / đóng Issue #667, user yêu cầu bổ sung **4 tính năng** cho trình soạn thảo FBD trong `apps/web-ui`:

1. **Function Block cho FBD + kéo thả** — menu `+ New` hiện chỉ có `Function Block · ST`, cần thêm `Function Block · FBD`; sau khi tạo phải kéo thả được vào canvas giống khối Quick Library.
2. **Hover tooltip** — rê chuột vào khối trong canvas phải hiện thông tin trực tiếp từ khối đó.
3. **Minimap vẽ đường nối (wires)** giữa các khối, không chỉ vẽ khối trơ. Ảnh chuẩn: `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png`.
4. **Tách zoom minimap khỏi zoom canvas chính** (hiện đang đồng bộ).

Phát sinh trong phiên: user chạy kiểm chứng chéo, phát hiện công việc phiên trước **BỊ HỎNG** và báo thêm 5 lỗi chức năng khi chạy app thật. User đề xuất: *"pull code mới từ repo về rồi hợp nhất với code local hiện tại, giữ những ưu điểm của cả 2 phần"*. Đã thực hiện xong phần hợp nhất.

Bổ sung theo quyết định user trong phiên: làm thêm **menu chuột phải trên canvas** (Giai đoạn 5).

Kết quả mong muốn: 4 tính năng (+ menu chuột phải) hoạt động thật, `tsc` 0 lỗi, không có suite test đỏ mới, bundle R3 trong ngân sách.

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Ràng buộc về vai trò (user nhấn mạnh 2 lần, còn hiệu lực)

Nguyên văn lần 1:
> "nhớ là opus chỉ lên plan và điều phối tất cả các công việc khác cần giao lại cho sub agent"

Nguyên văn lần 2 (yêu cầu cuối, gắt hơn):
> "yêu cầu lần cuối opus chỉ điều phối và lên plan tuyệt đối việc sửa file đọc file , tìm file , .... không được dùng opus"

**Diễn giải bắt buộc:** Opus **CHỈ** lên plan, điều phối, nghiệm thu. **TUYỆT ĐỐI KHÔNG** tự đọc file, tìm file, sửa file, chạy lệnh. 100% việc đọc/tìm/sửa/chạy test phải giao subagent (Sonnet/Haiku).

### File CẤM SỬA

`ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `apps/web-api/**`, `firmware/**`, `apps/web-ui/package.json`, `apps/web-ui/.env.local`

### Bảo toàn kiểm thử (Non-weakening Invariant)

- KHÔNG dùng `.skip`, `.only`, `.todo`
- KHÔNG xoá test
- KHÔNG nới lỏng matcher / sửa assertion để làm test xanh
- Test cũ đỏ → sửa **code**, không sửa test
- **Ngoại lệ đã được user duyệt trong phiên:** khi test cũ mã hoá **đặc tả cũ** và xung đột trực tiếp với đặc tả mới user yêu cầu, được phép viết lại test — nhưng test mới phải **chặt hơn hoặc bằng** test cũ. Phải DỪNG và hỏi user trước, không tự quyết.

### Git

- CHỈ commit/push khi user yêu cầu
- KHÔNG tự merge PR vào `main`
- KHÔNG tự đóng Issue #667 (issue body có khoá tường minh)
- PR phải dùng `Refs #667`, KHÔNG dùng `Closes #667`
- KHÔNG dùng `git checkout -f` hoặc `git stash` khi checkout cảnh báo file sẽ bị ghi đè — DỪNG và báo user

### Khác

- Ngân sách bundle R3: chunk `programming-*.js` ≤ **165.00 KiB** gzip
- KHÔNG cài thư viện npm mới
- Chuỗi UI phải là tiếng Việt **có dấu** (có cổng kiểm tra `scripts/check_ui_strings.py`)
- Cổng a11y e2e assert `violations = []` tuyệt đối
- Báo cáo xung đột phải **theo từng tính năng**, chi tiết, không viết chung chung

### Quyết định user đã chốt trong phiên (KHÔNG được đảo ngược)

| Vấn đề | Quyết định |
|---|---|
| Vị trí minimap | **GIỮ NGUYÊN ở cột 3 khay đáy** như `origin/main`. KHÔNG dời thành overlay nổi góc canvas. |
| Test zoom xung đột | Được phép **viết lại** `WorkbenchMinimapPanel.test.tsx:104-132` theo đặc tả mới |
| Phạm vi chạy | Duyệt chạy **liền mạch Giai đoạn 0 → 4** |
| Menu chuột phải | **CÓ làm**, thêm thành Giai đoạn 5 |
| WIP chưa commit | Cho agent kiểm tra rồi báo lại trước khi quyết (đã làm xong) |

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW

1. **Opus chỉ điều phối và lên plan.** Mọi việc đọc file, tìm file, sửa file, chạy lệnh → giao subagent.
2. Trước khi code: khảo sát đọc-hiểu, lập plan, **trình user duyệt**.
3. Gặp điểm mơ hồ / hai phương án ngang nhau → **hỏi user**, không tự quyết.
4. Báo cáo xung đột phải theo từng tính năng, kèm bằng chứng `file:dòng`.

### SESSION-ESTABLISHED WORKFLOW (đã hình thành và đang hiệu quả — giữ nguyên)

1. **Chẩn đoán trước, sửa sau.** Không đoán nguyên nhân. Mỗi kết luận phải kèm `file:dòng` thật hoặc output lệnh thật.
2. **Fan-out chẩn đoán song song** khi các luồng độc lập (tối đa 3 agent), nhưng **tuần tự** khi các giai đoạn cùng chạm một file.
3. **TDD từng giai đoạn:** viết test đỏ trước → dán output ĐỎ → code tối thiểu → dán output XANH.
4. **Nghiệm thu bằng output lệnh nguyên văn.** Tuyệt đối không nhận câu "đã pass" từ subagent.
5. **Đối chiếu mốc nền** sau mỗi giai đoạn để phát hiện hồi quy.
6. Chỉ sang giai đoạn sau khi giai đoạn hiện tại ĐẠT.
7. Prompt subagent luôn nêu rõ: phạm vi, file cấm, mốc nền, điều kiện DỪNG.
8. Subagent gặp bất thường → **DỪNG và báo**, không tự xoay xở. (Đã có tiền lệ: agent GĐ1+2 dừng đúng khi phát hiện test xung đột.)

### WORKFLOW INVARIANTS (không được phá vỡ)

- **Opus không đọc/tìm/sửa file.** Vi phạm điều này là vi phạm yêu cầu trực tiếp của user.
- Không báo "hoàn thành" khi chưa có output lệnh thật. *(Phiên trước đã vi phạm — xem mục 15.)*
- Không chạy song song các giai đoạn cùng chạm `FbdCanvas.tsx`.
- Không sửa test để làm xanh. Xung đột đặc tả → DỪNG, hỏi user.
- Không dời minimap khỏi khay đáy.
- Mỗi giai đoạn phải verify xong mới sang giai đoạn kế.
- Không commit/push khi user chưa yêu cầu.

---

## 4. CURRENT WORKFLOW POSITION

```
Workflow:          GĐ0 → GĐ1+2 → GĐ3 → GĐ4 → GĐ5 → GĐ6(nghiệm thu độc lập)
Completed:         GĐ0 → GĐ1+2
Currently working: GĐ3 (ĐÃ BỊ DỪNG, CHƯA SỬA BẤT KỲ FILE NÀO)
Next:              GĐ3 → GĐ4 → GĐ5 → GĐ6
```

| GĐ | Nội dung | Trạng thái |
|---|---|---|
| 0 | Fast-forward lên `origin/main` | ✅ ĐẠT (verified) |
| 1+2 | Minimap vẽ dây nối + tách zoom | ✅ ĐẠT (verified) |
| 3 | Function Block · FBD + kéo thả | ⛔ Chưa bắt đầu (agent bị dừng, **0 file bị sửa** — verified) |
| 4 | Hover tooltip | ⬜ Chưa bắt đầu |
| 5 | Menu chuột phải canvas | ⬜ Chưa bắt đầu |
| 6 | Agent độc lập chạy lại toàn bộ cổng kiểm tra | ⬜ Chưa bắt đầu |

**GĐ3 bị dừng giữa chừng nhưng KHÔNG để lại thay đổi nào** — đã xác minh bằng grep (mục 6). Có thể bắt đầu GĐ3 lại từ đầu, sạch.

---

## 5. WORKSPACE / ENVIRONMENT

| Mục | Giá trị |
|---|---|
| Working directory | `E:/TuanDuong/INTERN/DDC24_project/MK-DDC-24` |
| Frontend | `apps/web-ui` |
| Branch | `feat/fbd-task9-bottom-panel-3col` |
| HEAD | `bd2945b81bb05b267354a0606e1f464025d4be98` (= `origin/main`) |
| Stack | React + TypeScript 5.6 + Vite 5 + Vitest 4 + Tailwind CSS v4 + Playwright |
| Package manager | **npm** (KHÔNG dùng pnpm — `pnpm-lock.yaml` đã bị xoá vì sinh nhầm) |
| OS | Windows 11, shell bash (Git Bash) |
| Bối cảnh sản phẩm | MK-DDC-24 — hệ điều khiển DDC công nghiệp + Web Studio lập trình PLC theo IEC 61131-3, có trình soạn FBD và ST |

**Lưu ý cấu hình:** `apps/web-ui/.env.local` (untracked, **CẤM SỬA**) có dòng `VITE_PROGRAMMING_REV_A=1`. Cờ này làm `ShellNavigation.test.tsx` fail cục bộ. Trên CI sạch không có file này nên test pass. Không phải lỗi code.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED (có output lệnh thật, chạy lúc kết phiên)

`git rev-parse HEAD` + `git branch --show-current`:
```
bd2945b81bb05b267354a0606e1f464025d4be98
feat/fbd-task9-bottom-panel-3col
```

`git log --oneline -3`:
```
bd2945b8 docs(pgm02): hồ sơ deploy bo Forlinx + ghi rõ lần bật cờ cut-over (#705)
81bebd47 Programming PGM-02: sửa bốn nguyên nhân gốc làm hỏng bố cục, canvas và giá trị runtime của trang FBD (#704)
6ffff1d3 [PGM-03] Tách danh mục điểm khỏi giá trị sống: bỏ vòng đọc lại point-catalog mỗi 10 giây (#703)
```

`git status --short` — 3 file sửa (chưa commit) + 19 mục untracked:
```
 M apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx
 M apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx
 M apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx
?? .claude/skills/foxlinx-deploy/
?? .claude/skills/webview/
?? apps/web-ui/playwright.headed-view.config.ts
?? apps/web-ui/src/features/programming/fbd/FbdCanvas.hover.test.tsx
?? apps/web-ui/src/features/programming/fbd/FbdNodeHoverCard.tsx
?? docs/03_implementation/DEPLOY_FOXLINX.md
?? docs/superpowers/plans/  (11 file .md)
?? tools/smoke-local-api.sh
?? tools/start-local-api.sh
```

`npx tsc --noEmit --pretty false` → **output trống, exit 0. 0 lỗi.**

`npx vitest run`:
```
 Test Files  2 failed | 251 passed (253)
      Tests  6 failed | 3219 passed (3225)
```

Tính năng minimap **còn nguyên trên đĩa** (chưa commit):
```
WorkbenchMinimapPanel.tsx:188   data-fbd-minimap-wire="true"
WorkbenchMinimapPanel.tsx:55    const [minimapZoom, setMinimapZoom] = useState(1)
WorkbenchMinimapPanel.tsx:81-82 effectiveW/H = bridge.width|height / minimapZoom
WorkbenchMinimapPanel.tsx:105   {Math.round(minimapZoom * 100)}%
```

GĐ3 **chưa sửa gì** (grep đều KHÔNG khớp):
- `draggable` trong `PouExplorer.tsx`: KHÔNG
- `Function Block · FBD` trong `PouExplorer.tsx`: KHÔNG
- `pou:` trong `FbdCanvas.tsx`: KHÔNG

Số dòng file:
```
  140 fbd/FbdNodeHoverCard.tsx
  153 fbd/FbdCanvas.hover.test.tsx
 1031 fbd/FbdCanvas.tsx
  229 design/workbench/WorkbenchMinimapPanel.tsx
  507 design/pou/PouExplorer.tsx
```

### UNVERIFIED

- **Bundle R3 = 157.39 / 165.00 KiB (dư 7.61 KiB)** — đo lúc kết thúc GĐ1+2, **chưa đo lại** lúc kết phiên. Tin cậy cao (không có thay đổi code sau đó) nhưng nên đo lại.
- `scripts/check_ui_strings.py` — **chưa chạy lần nào** trong phiên này.
- Build sản xuất sạch — **chưa chạy**.
- e2e Playwright / cổng axe — **chưa chạy**.
- Hành vi thực tế trên trình duyệt của minimap wires + tách zoom — **chỉ có unit test xanh, user chưa xác nhận bằng mắt**.
- Trạng thái PR #706 — chưa kiểm lại trong phiên này.

---

## 7. COMPLETED WORK

### GĐ0 — Fast-forward lên `origin/main` ✅

**Thuộc bước:** GĐ0 của workflow.

Đã làm:
1. Sao lưu WIP ra `/tmp/mkddc-wip-2026-09-14.patch` (10.045 bytes) + `/tmp/mkddc-status-2026-09-14.txt` (1.181 bytes)
2. Xoá `apps/web-ui/pnpm-lock.yaml` (sinh nhầm, repo dùng npm) và `apps/web-ui/test-results/` (artifact Playwright)
3. `git checkout -- apps/web-ui/package-lock.json` (khôi phục, churn npm Windows vô giá trị) — ngoại lệ duy nhất được user duyệt
4. `git merge --ff-only origin/main`: `Updating f104e627..bd2945b8`, 69 file, +4541/−423

Kết quả verify: `tsc` từ **4 lỗi → 0 lỗi**. 4 lỗi cũ tự biến mất vì `runtimeOverlay.ts` và `fbdNodeIdentity` có sẵn trên `origin/main` (commit `81bebd47`).

`origin/main` cũng mang về sẵn những thứ user thấy trong ảnh mà local thiếu: cụm zoom nổi góc canvas (`FbdCanvas.tsx:835-873`), settings popover bánh răng (`FbdEditorPane.tsx:182-245`), thanh trạng thái đáy (`FbdEditorPane.tsx:298-304`), Quick Library nhóm RECENT/LOGIC/COMPARE (`QuickLibraryPanel.tsx:273-350`), minimap ở cột 3 khay đáy (`FbdEditorPane.tsx:54-58, 281`).

### GĐ1+2 — Minimap vẽ dây nối + tách zoom ✅

**Thuộc bước:** GĐ1+2 của workflow. **Chưa commit.**

File sửa:
- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx:7,11,56,82-87,101,106,114,124,140,186-196`
- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx:8,10,104-199`
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx:71,79-84,264-278,326,357`

Test đỏ trước khi code (bằng chứng TDD thật):
```
AssertionError: expected +0 to be 2 // Object.is equality
 ❯ WorkbenchMinimapPanel.test.tsx:117:30
    117|     expect(wirePaths.length).toBe(2)
```

Sau khi code: suite workbench `6 passed (6)`, `75 passed (75)`.

Đối chiếu mốc nền:

| Chỉ số | Nền GĐ0 | Sau GĐ1+2 |
|---|---|---|
| `tsc` | 0 lỗi | **0 lỗi** |
| Suite | 251 pass / 2 fail | **251 pass / 2 fail** |
| Test | 3216 pass / 6 fail | **3219 pass / 6 fail** (+3) |
| Bundle R3 | — | **157.39 / 165.00 KiB** |

Không có suite đỏ mới. `FbdCanvas.test.tsx:210` và `:271` (khoá cứng chuỗi viewBox) vẫn pass — minimap nội tuyến trong canvas vẫn bám viewBox canvas, còn zoom tách biệt chỉ áp cho panel minimap ở khay đáy; hai thứ khác nhau, không xung đột.

---

## 8. WORK IN PROGRESS

**GĐ3 — Function Block · FBD + kéo thả: BỊ DỪNG, KHÔNG ĐỂ LẠI THAY ĐỔI NÀO.**

Agent GĐ3 đã được spawn với prompt đầy đủ nhưng bị user yêu cầu dừng ("tạm dừng lại đi") trước khi nó kịp sửa file. Đã xác minh bằng grep: `draggable`, `Function Block · FBD`, `pou:` đều KHÔNG xuất hiện. **Bắt đầu lại GĐ3 từ đầu, tree sạch.**

Đặc tả GĐ3 đã soạn sẵn (dùng lại nguyên):

**A. Menu tạo mới** — `PouExplorer.tsx`: thêm mục `Function Block · FBD` gọi `create('FUNCTION_BLOCK', 'FBD')`. Menu thành 5 mục.

**B. Nguồn kéo** — `PouExplorer.tsx`: item POU dạng Function Block phải `draggable` + `onDragStart` set `dataTransfer.setData(LIBRARY_DRAG_TYPE, 'pou:' + <tên POU>)`.
> **Siết quan trọng:** chỉ bật kéo cho Function Block có **body FBD**. FB body ST không dựng được thành khối FBD, kéo vào tạo khối rỗng/hỏng. Agent phải tự xác minh trường phân biệt `language` trong model; **không xác định được thì DỪNG và báo, không đoán.** (Bản làm hỏng phiên trước bật `draggable` cho mọi `FUNCTION_BLOCK` — đây là lỗi W1 cần tránh lặp.)

**C. Đích nhận** — `FbdCanvas.tsx` `handleDrop`: payload có tiền tố `pou:` → bóc tên POU, dựng entry qua `userPouPaletteEntry` (đã có sẵn tại `fbd/userPou.ts`, DÙNG LẠI đừng viết mới), tạo node `FUNCTION_BLOCK` với đúng chân từ `interface.inputs`/`interface.outputs`. Giữ nguyên đường xử lý cũ cho khối palette tĩnh. Kiểm `onDragOver` có `event.preventDefault()`. Thả POU không tồn tại → không tạo node, không crash. `StructuredFbdEditor.tsx`: truyền palette POU người dùng xuống `FbdCanvas`.

Test tối thiểu cần có: (a) menu 5 mục có `Function Block · FBD`; (b) FB body FBD có `draggable` + `onDragStart` đúng MIME/payload; (c) FB body ST KHÔNG draggable; (d) drop `pou:<tên hợp lệ>` tạo node đúng số chân; (e) drop `pou:<tên không tồn tại>` không tạo node, không crash.

---

## 9. IMPORTANT DECISIONS

| # | Quyết định | Lý do | Ai chốt |
|---|---|---|---|
| 1 | Fast-forward lên `origin/main` thay vì merge thủ công | Local là tổ tiên trực tiếp, đi sau 9 commit, `git merge-tree` dry-run báo **0 conflict** | User duyệt |
| 2 | **Bác bỏ** bản vá stub/`as any` cho 4 lỗi tsc | `runtimeOverlay` và `fbdNodeIdentity` có thật trên `origin/main`; stub lại sẽ tạo định nghĩa trùng, `as any` là né type. Fast-forward làm lỗi tự hết | Opus, có bằng chứng |
| 3 | **Giữ minimap ở cột 3 khay đáy** | Hai agent kết luận ngược nhau khi đọc ảnh chuẩn. User chọn: khớp `origin/main`, diff nhỏ nhất, không rủi ro vỡ test khoá cứng `data-fbd-minimap` | **User chốt** |
| 4 | Được viết lại `WorkbenchMinimapPanel.test.tsx:104-132` | Test mã hoá đặc tả CŨ (zoom đồng bộ), nay đặc tả đổi. Không phải nới lỏng. Test mới CHẶT HƠN | **User chốt** |
| 5 | Làm menu chuột phải (GĐ5) | Tính năng chưa từng tồn tại ở cả local lẫn `origin/main` — là việc mới, không phải regression | **User chốt** |
| 6 | GĐ1+2 gộp làm một | Cùng sửa `WorkbenchMinimapPanel.tsx` | Opus |
| 7 | Các giai đoạn chạy **tuần tự**, không song song | Tất cả đều chạm `FbdCanvas.tsx`, song song sẽ đè nhau | Opus |
| 8 | Bỏ `pnpm-lock.yaml`, `test-results/`, churn `package-lock.json` | Rác sinh nhầm; repo dùng npm | User duyệt |

---

## 10. RELEVANT FILES & ARTIFACTS

### Đang sửa (chưa commit)

- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx` (229 dòng) — panel minimap khay đáy. Đã thêm `wires` vào `FbdCanvasBridge`, state `minimapZoom`, `effectiveViewBox`, render `<path data-fbd-minimap-wire>` trước `<rect>`
- `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx` — 8 test, đã viết lại test zoom theo đặc tả mới
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` (1031 dòng) — đã thêm `wires: geometry.wires` vào bridge + dependency, `minimapClientToGraph` đọc `viewBox` từ element

### Sắp sửa (GĐ3–GĐ5)

- `apps/web-ui/src/features/programming/design/pou/PouExplorer.tsx` (507 dòng) — menu `+ New`, nguồn kéo thả
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` — truyền palette POU xuống canvas. `StructuredFbdEditorProps` định nghĩa tại dòng 48-80, có 16 prop, **KHÔNG có prop `runtime`**
- `apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx` — cần thêm `onPointerEnter/Leave` cho GĐ4. `fbdNodeIdentity` export tại dòng 28

### Untracked, sẽ dùng ở GĐ4 (ĐỪNG XOÁ)

- `apps/web-ui/src/features/programming/fbd/FbdNodeHoverCard.tsx` (140 dòng) — **logic khớp API `origin/main` 100%, không cần sửa import**. Dùng đúng `identity.primary`/`secondary`, `runtimeReading.display`/`unit`, map đúng 4 state
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.hover.test.tsx` (153 dòng) — 5 test đang ĐỎ hợp lệ, là test đỏ TDD cho GĐ4

### Tham chiếu (chỉ đọc)

- `apps/web-ui/src/features/programming/fbd/geometry.ts` — `FbdWireGeometry {id, path, from, to}`, `path` là chuỗi SVG **dựng sẵn**, không cần tự tính
- `apps/web-ui/src/features/programming/fbd/userPou.ts` — `userPouPorts`, `userPouPaletteEntry` (dùng lại cho GĐ3)
- `apps/web-ui/src/features/programming/fbd/runtimeOverlay.ts` — `FbdRuntimeReading` (dòng 40-47), `buildFbdRuntimeOverlay` (dòng 74-77)
- `apps/web-ui/src/features/programming/fbd/QuickLibraryPanel.tsx` — `LIBRARY_DRAG_TYPE` = `application/x-mkddc-library-entry`
- `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png` — ảnh chuẩn

### Test có assertion KHOÁ CỨNG (không được làm vỡ)

- `apps/web-ui/src/features/programming/fbd/FbdCanvas.test.tsx:210` — `minimap.getAttribute('viewBox') === surface.getAttribute('viewBox')`
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.test.tsx:271` — khoá chuỗi viewBox
- `apps/web-ui/e2e/programming.spec.ts` — `[data-fbd-minimap="true"]` phải khớp **đúng 1** element; cổng axe `violations = []`

### Sao lưu

- `/tmp/mkddc-wip-2026-09-14.patch` — patch WIP trước fast-forward
- `/tmp/mkddc-status-2026-09-14.txt` — git status trước fast-forward

---

## 11. CODE CHANGES

### `WorkbenchMinimapPanel.tsx`

| Dòng | Thay đổi | Lý do |
|---|---|---|
| 7, 11 | Import `FbdWireGeometry`; thêm `wires?: readonly FbdWireGeometry[]` vào `FbdCanvasBridge` | Nhận dữ liệu dây từ canvas |
| 55 | `const [minimapZoom, setMinimapZoom] = useState(1)` | Zoom cục bộ, tách khỏi canvas |
| 81-87 | Tính `effectiveViewBox` = viewBox gốc chia `minimapZoom`, giữ tâm, `Math.round` | Áp zoom lên thumbnail |
| 101, 105 | Gán `viewBox={effectiveViewBox}`; nhãn `{Math.round(minimapZoom * 100)}%` | Phản ánh zoom minimap, không phải zoom canvas |
| 106-140 | 3 nút zoom cập nhật `minimapZoom` (biên 0.4–2.5), **bỏ gọi** `onZoomIn/onZoomOut/onResetZoom` | Tách zoom — yêu cầu #4 của user |
| 186-196 | Vòng lặp render `<path data-fbd-minimap-wire="true" d={wire.path} fill="none" aria-hidden="true">` **TRƯỚC** `<rect>` | Dây nằm dưới khối, đúng thứ tự trực quan |

**Side effect:** 3 nút zoom không còn điều khiển canvas. Đây là chủ đích. Test cũ khoá hành vi ngược đã được viết lại theo duyệt của user.

### `FbdCanvas.tsx`

| Dòng | Thay đổi | Lý do |
|---|---|---|
| 326 | `wires: geometry.wires` vào object bridge | Cấp dữ liệu dây cho minimap |
| 357 | Thêm `geometry.wires` vào dependency `useEffect` | **Thiếu sẽ khiến bridge stale, `wires` luôn undefined** |
| 71, 79-84, 264-278 | `minimapClientToGraph` nhận `viewBoxOrigin`; `navigateFromMinimap` đọc `viewBox` từ element | Click điều hướng vẫn đúng chỗ khi minimap đã zoom |

**Phụ thuộc:** GĐ3 và GĐ5 đều sẽ sửa tiếp `FbdCanvas.tsx` (hiện 1031 dòng — **vượt ngưỡng 800 dòng** của quy ước dự án, cân nhắc tách khi có dịp, nhưng KHÔNG refactor ngoài phạm vi task).

---

## 12. COMMANDS RUN

```bash
# Sao lưu + đồng bộ (GĐ0)
git diff > /tmp/mkddc-wip-2026-09-14.patch
git status --short > /tmp/mkddc-status-2026-09-14.txt
git fetch origin main
git merge-tree --write-tree --merge-base=f104e627 HEAD origin/main   # dry-run: 0 conflict
git checkout -- apps/web-ui/package-lock.json                        # ngoại lệ được duyệt
git merge --ff-only origin/main                                      # f104e627..bd2945b8

# Nghiệm thu (chạy nhiều lần)
cd apps/web-ui && npx tsc --noEmit --pretty false
cd apps/web-ui && npx vitest run
cd apps/web-ui && npx vitest run src/features/programming/design/workbench/
PYTHONUTF8=1 python scripts/verify_programming_bundle_budget.py --increment r3
```

**Lưu ý:** `npx vitest run --reporter=basic` **KHÔNG chạy được** (`Error: Failed to load custom Reporter from basic`). Dùng `npx vitest run` không cờ reporter.

---

## 13. TEST / VALIDATION STATUS

### Đã chạy, có output thật

| Cổng | Kết quả | Trạng thái |
|---|---|---|
| `npx tsc --noEmit` | output trống, exit 0 | ✅ 0 lỗi |
| `npx vitest run` | 251 suite pass / 2 fail · 3219 test pass / 6 fail | ✅ đúng mốc nền |
| Suite workbench | 6 suite pass / 75 test pass | ✅ |
| `FbdCanvas.test.tsx` | 14 passed | ✅ test viewBox khoá cứng còn pass |
| Bundle R3 | 157.39 / 165.00 KiB, dư 7.61 | ✅ (đo cuối GĐ1+2, chưa đo lại) |

### 2 suite ĐỎ — đều HỢP LỆ, không phải hồi quy

1. `src/features/programming/fbd/FbdCanvas.hover.test.tsx` — **5 test**. Lỗi: `Unable to find an accessible element with the role "tooltip"` tại dòng 114. Đây là **assertion fail**, không phải lỗi import. Là test đỏ TDD cho GĐ4, sẽ xanh khi gắn hover.
2. `src/shared/components/ShellNavigation.test.tsx` — **1 test** (`does not expose the legacy Programming demo without its explicit demo flag`). Nguyên nhân: `.env.local:4` có `VITE_PROGRAMMING_REV_A=1` → `shared/config.ts:14` bật `PROGRAMMING_REV_A_ENABLED` → `shared/components/NavRail.tsx:150` render link `Programming` → test assert `not.toBeInTheDocument()` fail. **KHÔNG phải lỗi code**; 3 file liên quan giống `origin/main` 100%. CI sạch thì pass. `.env.local` CẤM SỬA.

### CHƯA chạy

- `python scripts/check_ui_strings.py`
- Build sản xuất sạch
- e2e Playwright + cổng axe
- Kiểm tra bằng mắt trên trình duyệt thật

---

## 14. ERRORS / BLOCKERS

Hiện **không có blocker kỹ thuật**. GĐ3 có thể bắt đầu ngay.

### Việc còn treo, cần user quyết

1. **PR #706** chưa merge — quyền của user
2. **Issue #667** chưa đóng — quyền của user, issue body có khoá tường minh
3. **3 file doc Task-9 untracked** chưa đưa vào git
4. **Reviewer sign-off** cho ngoại lệ `data-fbd-minimap` — chưa có
5. **Kết quả GĐ1+2 chưa commit** — đang nằm ở working tree, chờ user yêu cầu

### Cảnh báo nhỏ, chưa xử lý (W1–W4 từ khảo sát)

- **W1**: chỉ bật kéo cho FB body FBD, không bật cho FB body ST (đã đưa vào đặc tả GĐ3)
- **W2**: `FbdNodeHoverCard.tsx:17-19` hardcode kích thước tooltip 260×180, không đo DOM thật → có thể lệch vị trí khi kẹp viền
- **W3**: `geometry.nodes.find()` O(n) mỗi lần render hover → cân nhắc Map nếu đồ thị lớn
- **W4**: viewport indicator kẹp vào `baseViewBox` → có thể bị cắt khi zoom sâu

### Mâu thuẫn đã giải quyết (ghi lại để không điều tra lại)

- Hai agent báo tên nhánh khác nhau (`feat/fbd-minimap-viewbox-bbox` vs `feat/fbd-task9-bottom-panel-3col`). **Đúng là `feat/fbd-task9-bottom-panel-3col`** — đã verify bằng `git branch --show-current`.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT

### ⛔ DO NOT REPEAT: Báo "hoàn thành" bằng cách chuyển tiếp lời subagent

Phiên trước Opus báo *"421/421 tests passed, tsc 0 errors, bundle 159.12 KiB PASS"* — **chuyển tiếp nguyên văn từ subagent, không kiểm chứng độc lập**. User chạy kiểm chứng chéo và chứng minh sai hoàn toàn: `tsc` FAIL 4 lỗi, 1 suite FAIL, build không qua. Verdict: **❌ CHƯA ĐỦ ĐIỀU KIỆN MERGE**.

**Bắt buộc:** không bao giờ nhận câu "đã pass" từ subagent. Luôn yêu cầu **dán output lệnh nguyên văn**, và cuối cùng cho **agent độc lập chạy lại** (GĐ6).

### ⛔ DO NOT REPEAT: Vá 4 lỗi tsc bằng stub cục bộ / `as any` / xoá prop

Một agent đề xuất: tạo `interface FbdRuntimeReading` cục bộ, viết hàm `fbdNodeIdentity` cục bộ, stub `buildFbdRuntimeOverlay`, xoá prop `runtime` hoặc ép `as any`. **Sai hướng — đã bác bỏ.** Lý do: 2 symbol đó **có thật trên `origin/main`**; stub lại tạo định nghĩa trùng, `as any` là né type. Fast-forward làm lỗi tự hết — đã chứng minh bằng `tsc` 0 lỗi.

### ⛔ DO NOT REPEAT: Dời minimap thành overlay nổi góc canvas

Một agent đề xuất gỡ minimap khỏi khay đáy, đổi thành `position: absolute; bottom: 1rem; right: 1rem`. **User đã chốt GIỮ Ở CỘT 3 KHAY ĐÁY.** Không đề xuất lại.

### ⛔ DO NOT REPEAT: `npx vitest run --reporter=basic`

Lỗi `Failed to load custom Reporter from basic`. Dùng `npx vitest run` không cờ reporter.

### ⛔ DO NOT REPEAT: Tạo `pnpm-lock.yaml`

Repo dùng **npm**. File này đã bị xoá vì sinh nhầm.

### ⚠️ Tránh: chạy >3 agent song song / workflow fan-out lớn

Workflow khảo sát 6 luồng trước đó có **7/11 agent fail vì `429 rate_limit_error`**. Giới hạn 3 agent đồng thời.

### ⚠️ Tránh: chạy song song các giai đoạn cùng chạm `FbdCanvas.tsx`

GĐ3, GĐ4, GĐ5 đều sửa file này. Phải tuần tự.

---

## 16. IMPORTANT CONVERSATION CONTEXT

- **User kiểm chứng thật bằng cách chạy app.** Không nhận báo cáo suông. Đã từng bắt được báo cáo sai của Opus. Mọi khẳng định phải có bằng chứng.

- **Lý do user gắt về vai trò Opus:** user muốn model yếu hơn (Sonnet/Haiku) làm việc tay chân, Opus chỉ điều phối. Yêu cầu này bị vi phạm ở phiên trước nên user nhắc lại lần hai với chữ "tuyệt đối" và "yêu cầu lần cuối".

- **5 lỗi chức năng user báo khi chạy app** (đã chẩn đoán xong, ghi lại để không điều tra lại):
  1. Vị trí minimap sai → `origin/main` đã sửa (cột 3 khay đáy)
  2. Hover không hiện info → `FbdCanvasLayers.tsx` thiếu `onPointerEnter/Leave` → GĐ4
  3. Kéo thả FB không được → `PouExplorer.tsx` thiếu `draggable`, `handleDrop` không hiểu `pou:` → GĐ3
  4. Mất menu chuột phải → **chưa từng tồn tại** ở cả local lẫn `origin/main`; `FbdCanvas.tsx` chỉ có `onContextMenu={(e) => e.preventDefault()}` chặn menu mặc định. **Không phải regression** → GĐ5
  5. Minimap không vẽ dây → đã xong ở GĐ1+2 ✅

- **Phát hiện quan trọng:** 4 tính năng phiên trước báo "đã xong" thực tế **KHÔNG CÓ trong code**. Hai agent độc lập xác nhận chéo. Thứ duy nhất thực sự được tạo là 2 file untracked hỏng. Nghĩa là GĐ3/4/5 là **làm mới hoàn toàn**, không phải sửa lỗi.

- **Trade-off user chấp nhận:** giữ minimap ở khay đáy dù một agent cho rằng ảnh chuẩn vẽ nó nổi trên canvas — đổi lấy diff nhỏ và không vỡ test khoá cứng.

- **Về `FbdNodeHoverCard.tsx`:** đừng viết lại. Agent đã đối chiếu từng trường với API thật của `origin/main` và xác nhận khớp 100%. GĐ4 chỉ cần **gắn nó vào canvas**, không cần sửa nội dung.

---

## 17. NEXT ACTIONS

Tuân thủ WORKING METHOD mục 3. **Opus không đọc/tìm/sửa file — giao subagent toàn bộ.**

### Bước 1 — GĐ3: Function Block · FBD + kéo thả (đang ở đây)

Spawn 1 subagent (Sonnet), prompt theo đặc tả mục 8. Nhấn mạnh:
- Mốc nền: `tsc` 0 lỗi · 251 suite pass / 2 fail · 3219 test pass / 6 fail · bundle 157.39 KiB
- Chỉ bật `draggable` cho FB **body FBD**; không xác định được cách phân biệt → DỪNG và báo
- Dùng lại `userPouPaletteEntry` trong `fbd/userPou.ts`
- KHÔNG động `FbdCanvas.hover.test.tsx`, `FbdNodeHoverCard.tsx`, `ShellNavigation.test.tsx`, `.env.local`
- Gặp test cũ xung đột đặc tả → DỪNG và báo, không tự sửa test
- TDD: dán output ĐỎ trước, XANH sau

### Bước 2 — Verify GĐ3

Đối chiếu mốc nền. Chỉ được phép còn **đúng 2 suite đỏ cũ**. Suite đỏ mới = hồi quy, phải xử lý trước khi đi tiếp. Chạy: `tsc`, `vitest run`, bundle R3, `check_ui_strings.py`.

### Bước 3 — GĐ4: Hover tooltip (chỉ khi GĐ3 ĐẠT)

Gắn `onPointerEnter`/`onPointerLeave`/`onFocus`/`onBlur` vào node trong `FbdCanvasLayers.tsx`; `FbdCanvas.tsx` quản state `hoveredNodeId` + toạ độ, render `FbdNodeHoverCard` (**đã có sẵn, đừng viết lại**). Ẩn tooltip khi đang drag/pan/marquee. Thêm `aria-describedby` khi focus bàn phím để qua cổng axe.
**Tiêu chí:** 5 test đỏ trong `FbdCanvas.hover.test.tsx` chuyển XANH mà **không sửa file test đó**.

### Bước 4 — Verify GĐ4

Như bước 2. Lúc này chỉ còn **1 suite đỏ** (`ShellNavigation.test.tsx`).

### Bước 5 — GĐ5: Menu chuột phải canvas (chỉ khi GĐ4 ĐẠT)

`FbdCanvas.tsx`: đổi `onContextMenu={(e) => e.preventDefault()}` thành handler lưu toạ độ + mở menu. 7 lệnh: `Paste here Ctrl+V`, `Add block here Insert`, `Select all Ctrl+A`, `Deselect Esc`, `Fit all Ctrl+1`, `Fit selection Ctrl+2`, `Zoom to 100% Ctrl+0`. Bắt buộc a11y: điều hướng bàn phím, Esc đóng, focus trap, `role="menu"`/`menuitem` — cổng axe assert `violations = []`. Chuỗi UI tiếng Việt có dấu.

### Bước 6 — Verify GĐ5

Như bước 2, thêm e2e + axe.

### Bước 7 — GĐ6: Nghiệm thu độc lập

Spawn **agent mới, chưa từng chạm code**, chạy lại toàn bộ cổng kiểm tra và đối chiếu với 4 tính năng user yêu cầu. Đây là bước phiên trước bỏ qua và dẫn tới báo cáo sai.

### Bước 8 — Báo cáo user

Kèm output lệnh thật. Hỏi user về: commit, PR #706, đóng Issue #667, 3 file doc untracked, W1–W4.
**KHÔNG tự commit/push/merge/đóng issue.**

---

## 18. DEFINITION OF DONE

| # | Tiêu chí | Trạng thái |
|---|---|---|
| 1 | Minimap vẽ đường nối giữa các khối | ✅ unit test xanh (chưa xác nhận bằng mắt) |
| 2 | Zoom minimap tách khỏi zoom canvas | ✅ unit test xanh (chưa xác nhận bằng mắt) |
| 3 | Menu `+ New` có `Function Block · FBD` | ⬜ |
| 4 | Kéo thả FB body FBD vào canvas tạo node đúng chân | ⬜ |
| 5 | Hover khối hiện tooltip; 5 test hover XANH không sửa test | ⬜ |
| 6 | Menu chuột phải canvas đủ 7 lệnh + a11y | ⬜ |
| 7 | `npx tsc --noEmit` = 0 lỗi | ✅ |
| 8 | Không có suite đỏ MỚI (ngoài `ShellNavigation` do `.env.local`) | ✅ |
| 9 | Bundle R3 ≤ 165.00 KiB gzip | ✅ 157.39 (cần đo lại cuối) |
| 10 | `check_ui_strings.py` pass | ⬜ chưa chạy |
| 11 | Build sản xuất sạch | ⬜ chưa chạy |
| 12 | e2e + cổng axe `violations = []` | ⬜ chưa chạy |
| 13 | Không dùng `.skip`/`.only`/`.todo`, không xoá test, không nới assertion | ✅ |
| 14 | Agent độc lập nghiệm thu lại (GĐ6) | ⬜ |
| 15 | User xác nhận bằng mắt trên app thật | ⬜ |

**Chỉ được báo "hoàn thành" khi đủ 15 mục và có output lệnh thật cho từng cổng.**

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
