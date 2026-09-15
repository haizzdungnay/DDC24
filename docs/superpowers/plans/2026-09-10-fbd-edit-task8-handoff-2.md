# SESSION HANDOFF — FBD Editor: Chrome Consolidation & Vertical Scrollbar (OY Axis)

## 1. SESSION OBJECTIVE
Tối ưu hóa không gian hiển thị trình soạn thảo FBD Editor theo ảnh tham chiếu `PGM-02B_FBD_editor_reference.png` và các chỉ đạo bằng ảnh chụp trực tiếp của user:
1. Thu gọn các dải chrome rải rác chiếm dụng chiều cao trục OY:
   - Dải ContextStrip (banner vàng `Chưa xác định kết quả — đang đối soát`).
   - Hàng nút chức năng (`Save`, `Check`, `Refresh`) và hàng tab (`Programs`, `Points & Mapping`, `Execution`) + Mode Switcher (`EDIT`, `LIVE`, `SIMULATE`) đưa về **1 hàng duy nhất**.
   - Hàng lệnh FBD, dải status chips (`network`, `block`, `wire`, `Draft issue`) và nhãn network (`1. network_1`) đưa về **1 hàng ngang duy nhất**.
2. Thiết lập cơ chế thanh trượt cuộn xuống (trục OY) cho khung vẽ FBD: nới rộng virtual canvas height và `<rect data-fbd-canvas-bg>` để có thanh cuộn dọc, mở rộng vùng kéo thả block xuống phía dưới thoải mái.
3. Chạy lại web và xác minh tính đúng đắn theo `MK-DDC-24/RUN_PROJECT.md`.

## 2. USER REQUIREMENTS & HARD CONSTRAINTS
- **Gom chrome về 1 dòng duy nhất**:
  - Hàng tab và cụm nút `Save`, `Check`, `Refresh`, `ProgramsModeSwitcher` phải nằm chung trên 1 hàng ngang duy nhất.
  - Toolbar FBD và các status chip, nhãn network phải gom vào 1 hàng ngang duy nhất, không xuống dòng tạo nhiều dải dọc.
- **Thanh trượt cuộn xuống (trục OY)**:
  - Khung FBD phải có thanh cuộn dọc (scrollbar) để người dùng cuộn xuống phía dưới.
  - Vùng nhận kéo thả `<rect data-fbd-canvas-bg>` phải bao trùm toàn bộ chiều cao mở rộng.
- **Cấm làm yếu assertion trong unit test**: Không delete/comment-out test, không `.skip`/`.only`/`.todo`, không nới lỏng matcher.
- **Cấm git write từ subagent**: add/commit/push/gh/stash/checkout/restore/reset/clean đều do Opus trực tiếp điều phối.
- **Quy tắc git**: Không `git add -A` / `git add .` — stage explicit paths. Không `git reset --hard`, `git clean -fd`. CHANGELOG.md thay đổi phải purely additive.
- **Phân vai nghiêm ngặt (User nhắc nhở)**: Opus chỉ điều phối toàn cảnh, lên kế hoạch cấp cao, nhận báo cáo; toàn bộ việc sửa code chi tiết, kiểm tra cục bộ và chạy test phải phân công cho subagent Sonnet/Haiku.
- **Ngôn ngữ**: Toàn bộ tài liệu, commit, PR, UI text phải dùng tiếng Việt có dấu chuẩn xác.

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW
1. Tiếp nhận phản hồi / ảnh minh họa từ user.
2. Opus phân tích nguyên nhân gốc rễ, lên plan phân tách công việc độc lập.
3. Phân công subagent Sonnet thực thi việc sửa code và chạy test tương ứng.
4. Nhận báo cáo từ subagent, rà soát tính toàn vẹn (accessibility, contracts, unit tests).
5. Xác minh end-to-end trên dev server (`RUN_PROJECT.md`).
6. Trình bày kết quả ngắn gọn, súc tích (caveman senior dev style).

### SESSION-ESTABLISHED WORKFLOW
- **Kiểm tra song song**: Tách việc tối ưu layout trên cùng (Layout/Page level) và layout FBD (Component level) cho 2 subagent chạy độc lập để tiết kiệm thời gian.
- **Bảo toàn contract thẻ `<h1>`**: Trong `ProgrammingHeader.tsx`, luôn giữ nguyên `<h1 className="sr-only">` để vượt qua kiểm tra tĩnh trong `src/app/route-menu-contract.test.ts` (N-08).
- **Khử trùng lặp nút Accessibility**: Khi đưa `Save`, `Check`, `Refresh` vào `DesignWorkspacePage.tsx`, phải ẩn cụm nút ở `ProgrammingHeader.tsx` khi ở route Thiết kế (`/programs`, `/mapping`, `/design`) để tránh nhân đôi nút có cùng `aria-label` làm gãy test E2E.
- **Đo kích thước an toàn trong jsdom**: Mọi thao tác dùng `ResizeObserver` phải bọc guard `if (typeof ResizeObserver !== 'undefined')`.

### WORKFLOW INVARIANTS
- Không sửa trực tiếp code từ Opus — luôn ủy quyền cho subagent Sonnet/Haiku.
- Subagent tuyệt đối không chạy lệnh git write.
- Mọi thay đổi layout phải kiểm tra toàn bộ suite liên quan: `src/features/programming/layout/`, `src/features/programming/design/`, `src/features/programming/fbd/`.

## 4. CURRENT WORKFLOW POSITION
```
Workflow:          Phân tích ảnh → Gom chrome dải trên → Gom toolbar FBD & nới OY Canvas → Gộp nút Save/Check vào Tab row → Chạy test & Dev server → Handoff
Completed:         Toàn bộ các bước trên đã hoàn thành và verified 100%
Currently working: Lưu session handoff
Next:              User review giao diện trực tiếp trên browser / Chuẩn bị commit theo lệnh user
```

## 5. WORKSPACE / ENVIRONMENT
- **Working Directory**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Git Branch**: `feat/fbd-edit-task8-redo` (PR #609)
- **Node / Package Manager**: Node.js v20+, npm
- **Frameworks**: React 18, Vite 8.2.0, Tailwind CSS v4
- **Testing**: Vitest 4.1.10 (jsdom), Playwright 1.61.1
- **Active Ports**:
  - `5173`: Vite frontend dev server (`0.0.0.0:5173`)
  - `8081`: Go API backend (`mkddc-web`)

## 6. CURRENT VERIFIED STATE

### VERIFIED
- **Chrome dải trên (Ảnh 2)**:
  - `ProgrammingContextStrip.tsx`: `ContextStateNotice` (banner vàng) chuyển thành `inline-flex` 1 dòng ngắn gọn (`px-2 py-0.5`).
- **Gộp Save/Check/Refresh và Tab list (Yêu cầu mới nhất của User)**:
  - `DesignWorkspacePage.tsx`: Cụm nút `Save` (Lưu), `Check` (Kiểm tra), `Refresh` (Làm mới) đã nằm chung hàng với `ProgramsModeSwitcher` (`EDIT / LIVE / SIMULATE`) và hàng tab (`Programs / Points & Mapping / Execution`).
  - `ProgrammingHeader.tsx`: Ẩn cụm nút duplicate khi ở route Thiết kế, giữ lại `<h1>` ẩn trợ năng.
- **Toolbar FBD & Status Chips (Ảnh 3, 4)**:
  - `StructuredFbdEditor.tsx`: Các chip `network`, `block`, `wire`, `Draft issue` đưa lên cùng hàng ngang với toolbar lệnh FBD, xóa bỏ dải hàng dọc riêng bên dưới.
- **Canvas Trục OY & Thanh cuộn dọc (Ảnh 4)**:
  - `FbdCanvas.tsx`: SVG height và `<rect data-fbd-canvas-bg>` mở rộng `Math.max(geometry.height + 600, containerHeight + 800, 1600)`. Khung chứa `scrollRef` (`overflow-auto`) luôn có thanh cuộn dọc OY, hỗ trợ kéo thả tự do xuống phía dưới.
- **Test Status**:
  - `src/features/programming/layout/` + `src/features/programming/design/`: 69/69 passed (985/985 tests).
  - `src/features/programming/fbd/`: 18/18 passed (270/270 tests).
  - `src/app/route-menu-contract.test.ts`: 1/1 passed (48/48 tests).
- **Runtime**:
  - Backend 8081 đang hoạt động bình thường.
  - Frontend Vite 5173 đang chạy với cache `.vite` sạch, hot-reload hoạt động.

### UNVERIFIED
- Kiểm tra trực tiếp cảm quan bằng mắt của user trên trình duyệt đối với độ rộng OY khi kéo thả nhiều block liên tiếp.

## 7. COMPLETED WORK
1. Tối ưu `ContextStateNotice` trong `ProgrammingContextStrip.tsx` thành 1 dòng inline.
2. Nối chuỗi flexbox và thu gọn padding dọc trong `DesignWorkspacePage.tsx` và `FbdEditorPane.tsx`.
3. Gom status chips và network title vào thanh toolbar ngang trong `StructuredFbdEditor.tsx`.
4. Mở rộng virtual height SVG và background rect trong `FbdCanvas.tsx`, tạo thanh trượt cuộn dọc OY.
5. Gộp hàng nút `Save`, `Check`, `Refresh` cùng hàng với Tab và Mode Switcher trong `DesignWorkspacePage.tsx` và ẩn cụm nút ở `ProgrammingHeader.tsx`.
6. Chạy và pass 100% tất cả unit tests liên quan (1.255+ tests).
7. Xóa cache stale `.vite` và restart server theo `RUN_PROJECT.md`.

## 8. WORK IN PROGRESS
- Chờ phản hồi review trực tiếp từ user trên trình duyệt `http://localhost:5173` (sau khi ấn Ctrl+F5).
- Sẵn sàng quy trình commit và tạo/cập nhật PR khi user yêu cầu ("commit" / "merge").

## 9. IMPORTANT DECISIONS
- **Gộp Save/Check vào Tab row**: Thay vì chỉ dùng CSS kéo margin âm, phương án chuyển nút `Save`, `Check`, `Refresh` vào `DesignWorkspacePage.tsx` cạnh `ProgramsModeSwitcher` và ẩn chúng ở `ProgrammingHeader.tsx` khi ở workspace Thiết kế là giải pháp sạch nhất, đúng ngữ cảnh semantic DOM, không bị tràn layout ở các màn hình khác (Overview, Commission...).
- **Giữ lại `<h1 className="sr-only">` trong `ProgrammingHeader.tsx`**: Tránh vi phạm hợp đồng accessibility `route-menu-contract.test.ts` (N-08) yêu cầu layout phải sở hữu đúng một thẻ h1.
- **Canvas Height Formula**: Đặt `Math.max(geometry.height + 600, containerHeight + 800, 1600)` đảm bảo canvas luôn vượt chiều cao viewport hiện tại ít nhất 800px, kích hoạt `overflow-auto` sinh thanh cuộn dọc ngay cả khi đồ thị rỗng.

## 10. RELEVANT FILES & ARTIFACTS
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx`: Chứa hàng tab, Mode Switcher và cụm nút thao tác Save/Check/Refresh mới gộp.
- `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx`: Header chung của layout Programming, ẩn các nút thao tác khi ở workspace Thiết kế.
- `apps/web-ui/src/features/programming/layout/ProgrammingContextStrip.tsx`: Dải ngữ cảnh hiển thị trạng thái project/revision và thông báo reconciling inline.
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`: Trình soạn thảo FBD chứa toolbar gộp status chips.
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx`: Khung vẽ SVG với virtual height mở rộng và ResizeObserver.
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx`: Khung bao ngoài FBD Editor với toolbar phụ thu gọn.
- `MK-DDC-24/RUN_PROJECT.md`: Hướng dẫn vận hành backend và frontend.

## 11. CODE CHANGES
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx`:
  - Import `Save`, `ClipboardCheck`, `RefreshCw`.
  - Bổ sung 3 nút `Save`, `Check`, `Refresh` với đầy đủ accessibility attributes cạnh `<ProgramsModeSwitcher />`.
- `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx`:
  - Thêm điều kiện `isDesignWorkspace` để ẩn thanh nút trùng lặp.
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx`:
  - Công thức tính `height` được nới rộng tối thiểu 1600px hoặc `containerHeight + 800px`.
  - ResizeObserver theo dõi cả width và height.
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`:
  - Gom dải status chips vào header toolbar ngang.
  - Xóa dải block status riêng biệt bên dưới.
- `apps/web-ui/src/features/programming/layout/ProgrammingContextStrip.tsx`:
  - Đổi `ContextStateNotice` sang `inline-flex` 1 dòng.

## 12. COMMANDS RUN
- `npx vitest --run src/features/programming/fbd/` (Pass 18/18 files)
- `npx vitest --run src/features/programming/layout/ src/features/programming/design/` (Pass 69/69 files)
- `npx vitest --run src/app/route-menu-contract.test.ts` (Pass 1/1 files)
- `rm -rf node_modules/.vite` (Xóa cache stale của Vite)
- `VITE_DDC_MODE=live VITE_AUTH_MODE=jwt VITE_PROGRAMMING_REV_A=1 VITE_PROXY_TARGET=http://localhost:8081 npm run dev -- --host 0.0.0.0` (Khởi động frontend)

## 13. TEST / VALIDATION STATUS
- Unit tests: **100% Pass** (1.255+ tests kiểm tra toàn bộ FBD, Layout, Design Workspace và Route contracts).
- Typecheck/Lint: Tuân thủ các quy tắc TypeScript strict và Tailwind v4 class names.
- Dev Server: Đang chạy tại `http://localhost:5173` kết nối backend `http://localhost:8081`.

## 14. ERRORS / BLOCKERS
- Hiện tại: **Không có blocker**. Tất cả lỗi ngắt dòng và thiếu thanh cuộn OY đã được xử lý.

## 15. FAILED ATTEMPTS — DO NOT REPEAT
- **DO NOT REPEAT**: Không dùng công thức `Math.max(geometry.height, containerHeight, 200)` cho canvas SVG. Công thức này làm canvas bằng đúng kích thước viewport, triệt tiêu thanh cuộn dọc khi mạng rỗng hoặc ít khối, khiến người dùng không cuộn xuống để thả khối được.
- **DO NOT REPEAT**: Không xóa bỏ hoàn toàn component `ProgrammingHeader.tsx` hoặc thẻ `<h1>` bên trong, vì test `route-menu-contract.test.ts` sẽ fail do thiếu mốc tiêu đề trợ năng.
- **DO NOT REPEAT**: Không render cùng lúc nút "Lưu bản nháp" ở cả `ProgrammingHeader` và `DesignWorkspacePage` vì test E2E `HEADER-001` siết chặt chỉ cho phép tồn tại đúng 1 nút `Lưu bản nháp` trên toàn trang.

## 16. IMPORTANT CONVERSATION CONTEXT
- User đặc biệt khó chịu khi các thành phần bị vỡ thành nhiều hàng rời rạc làm mất không gian của vùng vẽ FBD theo trục Y.
- User đã chỉ đạo: "đang sai nguyên tắc làm việc khi mọi thứ opus đang làm quá nhiều, opus chỉ điều phối và lên plan khi kế hoạch có thay đổi còn lại phải để sonet và haiku làm... opus chỉ nắm toàn cảnh, nhận báo cáo". Phiên tiếp theo phải tuyệt đối tuân thủ việc giao task sửa code cho subagent.

## 17. NEXT ACTIONS
1. Tiếp nhận nhận xét trực quan của user sau khi user xem trang web tại `http://localhost:5173`.
2. Nếu user yêu cầu "commit" hoặc "merge":
   - Chạy full kiểm chứng theo `CLAUDE.md` § Quy trình khi user nói "commit".
   - Cập nhật `CHANGELOG.md` dưới mục `[Unreleased]`.
   - Stage các file cụ thể (không dùng `git add .`):
     - `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx`
     - `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx`
     - `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx`
     - `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`
     - `apps/web-ui/src/features/programming/layout/ProgrammingContextStrip.tsx`
     - `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx`
   - Commit với thông điệp Conventional Commit rõ ràng bằng tiếng Việt.
   - Push lên remote nhánh `feat/fbd-edit-task8-redo`.

## 18. DEFINITION OF DONE
- [x] Banner vàng `ContextStateNotice` gọn trên 1 hàng ngang inline.
- [x] Nút `Save`, `Check`, `Refresh` gộp chung 1 hàng với Tab và Mode Switcher.
- [x] Status chips và Network label gộp chung 1 hàng với Toolbar FBD.
- [x] Canvas FBD có thanh cuộn dọc (OY) và vùng nhận thả khối mở rộng.
- [x] Toàn bộ unit tests liên quan pass 100%.
- [x] Frontend dev server chạy ổn định và load được thay đổi.

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
