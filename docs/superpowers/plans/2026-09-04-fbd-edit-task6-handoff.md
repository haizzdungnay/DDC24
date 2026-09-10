# SESSION HANDOFF: FBD EDIT TASK 6 COMPLETED & LOCAL STACK RUNNING

### 1. SESSION OBJECTIVE
Triển khai tính năng **FBD EDIT** (trình soạn thảo sơ đồ khối Function Block Diagram) cho `apps/web-ui` thuộc dự án MK-DDC-24 theo đặc tả kỹ thuật v0.3 ([docs/superpowers/specs/2026-08-31-fbd-edit-design.md](../../../docs/superpowers/specs/2026-08-31-fbd-edit-design.md)) và kế hoạch 11 task ([docs/superpowers/plans/2026-08-31-fbd-edit.md](../../../docs/superpowers/plans/2026-08-31-fbd-edit.md)).
Trong phiên này, đã hoàn thành trọn vẹn **Task 6: Quick Library placement và typed wiring**, đồng thời giữ vững chuỗi chạy cục bộ no-board (simulator C++ + Web API Go + Web UI React/Vite) để người dùng nghiệm thu trực quan trên trình duyệt trước khi tiếp tục Task 7.

### 2. USER REQUIREMENTS & HARD CONSTRAINTS
- **Ngôn ngữ:** Luôn giao tiếp và viết toàn bộ tài liệu (docs, plans, changelog, báo cáo, commit message, PR) bằng tiếng Việt.
- **Tài liệu và nhật ký:** Mọi thay đổi code/config/tài liệu bắt buộc cập nhật [CHANGELOG.md](../../../CHANGELOG.md) dưới mục `[Unreleased]` trong cùng phiên làm việc kèm ngày, phạm vi và số đo verification thật.
- **Bảo toàn workspace & phạm vi:**
  - Giữ thay đổi FE cục bộ làm nguồn chân lý, không ghi đè công việc FE không liên quan.
  - Cấm can thiệp hoặc sửa đổi code ngoài thư mục `apps/web-ui/src/features/programming/**` (không đụng `apps/core/**`, `apps/web-api/**`, `firmware/**`, `contracts/**`, `scripts/**`).
  - Nghiêm cấm dùng `git add -A`, `git add .`, `git add -p`; chỉ stage file cụ thể theo allowlist rõ ràng.
- **An toàn kỹ thuật & fail-closed:**
  - Khối PID ở trạng thái `REVIEW_REQUIRED` bị khóa kéo-thả (`draggable={false}`), nút chèn disabled, và reducer reject với mã `block-review-required`.
  - Giữ vững ngân sách bundle gzip client cho chunk `programming`: R1 (125 KiB) và R3 (165 KiB).
  - Không phá vỡ hợp đồng trợ năng A11y (ví dụ thẻ `<h1>` sr-only trong `ProgrammingHeader.tsx`).
  - Không làm hồi quy bộ test suite của `web-ui`.

### 3. WORKING METHOD / USER-DEFINED WORKFLOW
**USER-DEFINED WORKFLOW (Quy trình 7 pha bắt buộc):**
`Khảo sát → Lên plan → Check plan → Thực thi → Báo cáo → Check báo cáo → Xuất lại báo cáo`

**SESSION-ESTABLISHED WORKFLOW:**
1. **Khảo sát:** Đọc code hiện hữu, xác định boundary, type contract, các điểm xung đột cử chỉ/state.
2. **Lên plan:** Lập danh sách file, cấu trúc interface, các action reducer và các kịch bản test tương ứng.
3. **Check plan:** Đối chiếu plan với spec v0.3 và các ràng buộc bundle/a11y/fail-closed.
4. **Thực thi:** Viết test kiểm thử trước hoặc song song (TDD), thực hiện thay đổi tối thiểu, bảo đảm immutability, phân luồng multiagent độc lập theo file allowlist (Luồng A: Reducer/Palette, Luồng B: Canvas/Layers/DnD, Luồng C: LibraryPanel/Catalog).
5. **Kiểm chứng đa tầng:**
   - Chạy Vitest cho feature: `npx vitest --run --environment jsdom src/features/programming/...`
   - Chạy full unit tests: `npm test`
   - Chạy lint: `npm run lint`
   - Chạy typecheck: `npm run typecheck`
   - Kiểm tra bundle gate: `npm run check:bundle-budget`
6. **Báo cáo & Cập nhật CHANGELOG:** Ghi nhận chi tiết thay đổi vào [CHANGELOG.md](../../../CHANGELOG.md) dưới mục `[Unreleased]`.
7. **Quy trình Git/PR:**
   - Commit tách nhóm logic, commit message Conventional Commits bằng tiếng Việt nêu rõ: `triệu chứng → nguyên nhân gốc → cách sửa`.
   - Push lên remote branch, tạo PR bằng `gh pr create` kèm bảng số đo kiểm chứng, merge PR và dọn dẹp branch remote.

**WORKFLOW INVARIANTS:**
- Luôn đọc file liên quan trước khi sửa; không sửa nhiều module cùng lúc nếu chưa cần.
- Không phá vỡ dynamic import splitting của Vite/Rollup (không import tĩnh chéo từ `ProgramsTab.tsx`).
- Mỗi thay đổi phải verify bằng lệnh thực tế, không giả định kết quả.

### 4. CURRENT WORKFLOW POSITION
```
Workflow FBD EDIT:
[Task 0.5 - 5.6] (Nền tảng, Canvas, Reducer, Layout, Split chunk)
  → [Task 6] (Quick Library placement & typed wiring) [HOÀN THÀNH]
  → [Task 7] (I/O picker & Inspector) [TIẾP THEO]
  → [Task 8 - 11] (Shell, Diagnostics, Boundaries, E2E & Gate)

Completed:         Task 0.5, 1, 2, 3, 4, 5, 5.5, 5.6, Task 6
Currently working: Sẵn sàng commit/merge Task 6 hoặc chuyển tiếp Task 7
Next:              Commit/merge nhánh feat/fbd-edit-task6 và bắt đầu Task 7 (I/O picker, Inspector và node presentation)
```

### 5. WORKSPACE / ENVIRONMENT
- **Root directory:** `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Git branch:** `feat/fbd-edit-task6`
- **OS:** Windows 11 Home Single Language 10.0.26200
- **Linux Subsystem:** WSL2 `Ubuntu-24.04`
- **Node/Frontend:** Node.js, Vite v8.2.0, React 18.3.1, Tailwind CSS v4
- **Dịch vụ đang chạy phục vụ nghiệm thu trực tiếp:**
  1. **Simulator C++:** `tools/run_noboard_demo.sh start` trong WSL.
  2. **Web API Go:** `/tmp/mkddc-local-ddc24/mkddc-web` trong WSL nghe cổng `8081`.
  3. **Web UI Vite:** Chạy trên host Windows cổng `5173` (`VITE_DDC_MODE=live`, `VITE_AUTH_MODE=jwt`, `VITE_PROGRAMMING_REV_A=1`, `VITE_FBD_EDIT=1`, `VITE_PROXY_TARGET=http://localhost:8081`).

### 6. CURRENT VERIFIED STATE
**VERIFIED:**
- Web UI cổng `5173`: Vite server đang phục vụ tại `http://localhost:5173/eng/programming`, proxy sang backend `:8081`.
- Web API cổng `8081`: Endpoint `GET /api/v1/health` trả về `core=ok`, `iobus=ok`, `plc_shm=ok`, `web=ok`.
- Unit Tests: 214 test files / 2604 tests PASS 100% (`npm test`).
- Linter: `npm run lint` PASS (0 warning, 0 error, kiểm tra chuỗi tiếng Việt đạt chuẩn).
- TypeScript: `npm run typecheck` PASS (0 type error).
- Bundle Budget: `npm run check:bundle-budget` PASS (Chunk `programming` gzip 122.45 KiB, ngân sách 165 KiB / 125 KiB, dư địa 42.55 KiB).
- [CHANGELOG.md](../../../CHANGELOG.md): Đã ghi nhận mục `[Unreleased]` cho Task 6.

**UNVERIFIED:**
- Trải nghiệm trực tiếp của người dùng sau khi thử kéo thả / nối dây trên trình duyệt.

### 7. COMPLETED WORK
- **Task 6: Quick Library placement và typed wiring:**
  1. [commands.ts](../../../apps/web-ui/src/features/programming/fbd/commands.ts): Mở rộng `ADD_NODE` hỗ trợ `position?: FbdPoint` tuỳ chọn (snap toạ độ, cập nhật layout trong cùng 1 transaction/undo entry). Bổ sung action `ADD_WIRE` nhận `{ networkId, wire }`. Tách validator thuần `validateFbdWireCandidate` độc lập dùng chung cho cả chuột, touch và bàn phím.
  2. [palette.ts](../../../apps/web-ui/src/features/programming/fbd/palette.ts) & [userPou.ts](../../../apps/web-ui/src/features/programming/fbd/userPou.ts): Bổ sung trường `featureState` vào `FbdPaletteEntry` truyền từ registry. Reducer `ADD_NODE` từ chối dứt khoát các khối `featureState !== 'AVAILABLE'` với mã `block-review-required`.
  3. [QuickLibraryPanel.tsx](../../../apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.tsx): Khối PID (`REVIEW_REQUIRED`) bị khóa kéo thả (`draggable={false}`), nút chèn disabled. Bổ sung nút "Thử lại" kích hoạt `refresh` khi gặp sự cố đọc catalog.
  4. [FbdCanvasLayers.tsx](../../../apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx): Thêm `FbdGhostLayer` (hiển thị khối mờ khi kéo thả / click-to-place) và `FbdWirePreviewLayer` (đường nét đứt xem trước dây nối). Nâng cấp `FbdNodesLayer` cô lập sự kiện port SVG (`stopPropagation`).
  5. [FbdCanvas.tsx](../../../apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx): Tích hợp HTML5 Drag & Drop với MIME type `application/x-mkddc-library-entry`, click-to-place có ghost bám chuột, điều khiển kéo dây pointer chuột / cảm ứng, Ctrl click-click, Escape / cancel dọn dẹp state tạm.
  6. [StructuredFbdEditor.tsx](../../../apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx): Nối click-to-place từ QuickLibrary sang Canvas qua `pendingPlacement`.
  7. Test suites: Tạo mới `commands.wiring.test.ts` (14 tests), `FbdCanvas.placement.test.tsx` (13 tests); mở rộng `QuickLibraryPanel.test.tsx` và `StructuredFbdEditor.test.tsx`.

### 8. WORK IN PROGRESS
- Hoàn thành toàn bộ code và test cho Task 6.
- Chuẩn bị:
  - Nếu người dùng yêu cầu commit/merge: Thực hiện quy trình commit, push, PR, merge nhánh `feat/fbd-edit-task6`.
  - Tiếp tục sang **Task 7: I/O picker, Inspector và node presentation** theo kế hoạch 11 task.

### 9. IMPORTANT DECISIONS
- **MIME Type DnD:** Sử dụng `application/x-mkddc-library-entry` độc quyền để ngăn ngừa `<textarea>` tự động chèn chuỗi và không làm rối pipeline Undo.
- **Fail-closed PID:** Khối PID ở trạng thái `REVIEW_REQUIRED` bị chặn ở 3 tầng: giao diện thư viện (nút disabled), HTML5 draggable (`draggable={false}`), và Reducer (`block-review-required`).
- **Transaction nguyên tử cho ADD_NODE có toạ độ:** Layout node được gán trong cùng lượt `commit()` của `ADD_NODE`, đảm bảo đúng 1 snapshot lịch sử Undo/Redo cho thao tác kéo-thả.
- **Validator dây nối duy nhất:** Bàn phím (`connect`), chuột/touch (`ADD_WIRE`), và candidate check đều gọi chung `validateFbdWireCandidate`.
- **Cô lập sự kiện Port:** Pointer event trên port SVG gọi `stopPropagation()` để không bị nuốt bởi gesture kéo node hoặc pan canvas.

### 10. RELEVANT FILES & ARTIFACTS
- [commands.ts](../../../apps/web-ui/src/features/programming/fbd/commands.ts): Reducer FBD, action `ADD_NODE` (kèm position), `ADD_WIRE`, `validateFbdWireCandidate`.
- [palette.ts](../../../apps/web-ui/src/features/programming/fbd/palette.ts): Palette definition, mang theo `featureState`.
- [FbdCanvas.tsx](../../../apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx): SVG Canvas chính, HTML5 DnD, click-to-place, pointer wire controller.
- [FbdCanvasLayers.tsx](../../../apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx): SVG layers (Grid, Wires, Nodes, Marquee, Ghost, WirePreview).
- [StructuredFbdEditor.tsx](../../../apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx): Editor shell điều phối toolbar, canvas và Quick Library.
- [QuickLibraryPanel.tsx](../../../apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.tsx): Quick Library panel, khóa PID, nút Thử lại.
- [commands.wiring.test.ts](../../../apps/web-ui/src/features/programming/fbd/commands.wiring.test.ts): Test suite cho wiring validator và reducer.
- [FbdCanvas.placement.test.tsx](../../../apps/web-ui/src/features/programming/fbd/FbdCanvas.placement.test.tsx): Test suite cho canvas placement và wire gestures.
- [CHANGELOG.md](../../../CHANGELOG.md): Nhật ký thay đổi dự án.

### 11. CODE CHANGES
- Các file sửa đổi và tạo mới đã được liệt kê chi tiết trong git status:
  - `commands.ts`, `palette.ts`, `userPou.ts`, `QuickLibraryPanel.tsx`, `FbdCanvas.tsx`, `FbdCanvasLayers.tsx`, `StructuredFbdEditor.tsx`.
  - Tests: `commands.wiring.test.ts`, `FbdCanvas.placement.test.tsx`, `QuickLibraryPanel.test.tsx`, `StructuredFbdEditor.test.tsx`.
  - Tài liệu: [CHANGELOG.md](../../../CHANGELOG.md), [docs/superpowers/plans/2026-09-03-fbd-edit-task6-plan.md](../../../docs/superpowers/plans/2026-09-03-fbd-edit-task6-plan.md).

### 12. COMMANDS RUN
```bash
# Chạy Vitest cho feature
cd apps/web-ui && npx vitest --run --environment jsdom src/features/programming/fbd src/features/programming/design/library

# Chạy full test suite
cd apps/web-ui && npm test

# Lint & typecheck
cd apps/web-ui && npm run lint
cd apps/web-ui && npm run typecheck

# Bundle budget
cd apps/web-ui && npm run check:bundle-budget
```

### 13. TEST / VALIDATION STATUS
- **Unit Tests:** 214 test files / 2604 tests PASS 100% (`npm test`).
- **Linter:** `npm run lint` PASS (0 warning, 0 error).
- **TypeScript:** `npm run typecheck` PASS (0 error).
- **Bundle Budget:** Chunk `programming` 122.45 KiB gzip (PASS cả R1 125 KiB và R3 165 KiB).

### 14. ERRORS / BLOCKERS
- Không có blocker kỹ thuật. Hệ thống đang hoạt động ổn định và xanh toàn diện.

### 15. FAILED ATTEMPTS — DO NOT REPEAT
- **DO NOT REPEAT:** Thêm tham số không dùng vào `FbdCanvas` dẫn đến lỗi ESLint `@typescript-eslint/no-unused-vars`.
- **DO NOT REPEAT:** Dispatch 2 action riêng biệt (`ADD_NODE` rồi `SET_NODE_POSITION`) khi kéo thả khối; bắt buộc truyền `position` ngay trong `ADD_NODE` để chỉ sinh 1 lịch sử undo.
- **DO NOT REPEAT:** Quên `stopPropagation()` trên port pointer event khiến gesture kéo dây bị node-drag nuốt chửng.

### 16. IMPORTANT CONVERSATION CONTEXT
- Người dùng yêu cầu chạy app web song song để kiểm nghiệm các thay đổi trực quan trên trình duyệt.
- Cả 3 tầng stack cục bộ (simulator + web-api + web-ui) đang chạy nền sẵn sàng tại `http://localhost:5173/eng/programming`.

### 17. NEXT ACTIONS
1. Nếu người dùng yêu cầu **commit / merge**:
   - Chạy quy trình git: stage các file allowlist của Task 6.
   - Commit với message tiếng Việt chuẩn (`feat(programming-ui): them keo tha quick library va typed wiring fbd`).
   - Push lên nhánh `feat/fbd-edit-task6`, tạo PR, merge vào `main` và xóa remote branch.
2. Bước vào **Task 7: I/O picker, Inspector và node presentation**:
   - Khảo sát [inspectorContext.ts](../../../apps/web-ui/src/features/programming/design/inspector/inspectorContext.ts) và [ContextInspector.tsx](../../../apps/web-ui/src/features/programming/design/inspector/ContextInspector.tsx).
   - Lập plan chi tiết theo quy trình 7 pha để tích hợp Inspector FBD và I/O picker.

### 18. DEFINITION OF DONE
- Thư viện Quick Library hỗ trợ kéo thả native HTML5 DnD và click-to-place Ghost preview.
- Nối dây trực quan bằng kéo thả, tap-tap, Ctrl click-click và phím Enter bàn phím hoạt động chuẩn xác với validator kiểu dữ liệu duy nhất.
- Khối PID bị khóa an toàn fail-closed.
- 100% tests pass, lint sạch, typecheck không lỗi, bundle budget đạt chuẩn, changelog cập nhật đầy đủ.

```markdown
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
```
