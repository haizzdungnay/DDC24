# Bằng chứng review giao diện DDC-24 ngày 29/09/2026

**ID:** REC-DDC-UI-EVIDENCE-20260929
**Phiên bản:** 1.0
**Trạng thái:** Record — SOURCE/HOST/BROWSER-FIXTURE
**Cập nhật:** 2026-09-29

## 1. Nguồn và cấu hình

- Source bất biến: `265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3` trên `origin/main`, worktree `/tmp/ddc-ui-review-20260929`.
- Node `v24.21.0`; dependency cài bằng `npm ci --no-audit --no-fund`, không đổi package/lockfile.
- Chrome DevTools MCP thực sự chạy: snapshot, screenshot, đánh giá DOM, thao tác phím, Console và Network. Không dùng profile cá nhân.
- Dev server loopback `127.0.0.1:4190`, proxy `127.0.0.1:4191`; cờ `VITE_DDC_MODE=live`, `VITE_AUTH_MODE=mock`, `VITE_PROGRAMMING_REV_A=1`, `VITE_PROGRAMS_WORKSPACE_V2=1`.
- Handler `installProgrammingMocks` và fixture `draftWithFbdProblem` từ `apps/web-ui/e2e/programming.spec.ts` của commit này được nạp trong harness tạm, trước `test.describe`; adapter cung cấp `route.request/fulfill` qua HTTP. Không chạy backend Go/Core hay bo.
- Handler không phục vụ WebSocket thật hoặc mọi API hệ thống. Các route chưa có trả 503. Fixture thư viện cố ý có PID cần review và bản nháp v1; không dùng các giá trị đó để kết luận tính năng PID/metadata ở thiết bị hiện tại.
- Viewport desktop 1440×900; component Mapping ở 1280×750; mobile 390×844 dùng `emulate viewport`, xác nhận `innerWidth=390`. `resize_page(390)` ban đầu bị giới hạn cửa sổ còn 500 px; lượt đó đã loại khỏi bằng chứng mobile cuối.

## 2. Kết quả và hiện vật

| Ca | Thao tác | Quan sát | Kết luận |
|---|---|---|---|
| Layout bình thường | Panel `192/180/256`, mở POU FBD ở 1440×900 | Trang 1440/1440; shell FBD rộng 532, cao 652 px trong lượt live có banner mất WS | Không tràn ngang với bộ gọn; không phải nghiệm thu mọi layout |
| Panel ở max hợp lệ | Lưu `480/320/480` trong `mkddc-pgm02-panel-widths-v1`, reload/login lại, mở cùng POU | Workspace x249, rộng1168; shell FBD x735, rộng320; Inspector x1387→1867; document 1828/1430 | FAIL — UI-F02 |
| Focus modal | Ctrl+K → Shift+Tab → đọc activeElement | Focus tab “Tham chiếu (0)”; `insideDialog=false` trong khi dialog vẫn mở | FAIL — UI-F03 |
| Escape sau focus thoát | Nhấn Esc ở trạng thái trên | `dialogOpenAfterEscape=true` | FAIL — UI-F03; Ctrl+K đóng lại để tiếp tục |
| FBD trên mobile | Emulate390, login lại, mở FBD | Document390/390; nút thêm khối/Input/Output/Constant disabled; cảnh báo chỉ đọc hiện | Đạt phép kiểm quyền sửa bằng control và tràn ngang này; chưa chứng minh mọi đường mutation |
| Mapping trùng mã | Render component gốc với hai hàng cùng pointIdTEMP, deviceIdahu-a/ahu-b | Desktop có hai identity khác; mobile đều `MB_RTU:TEMP` | FAIL — UI-F01; fixture component, không phải hành trình lưu |
| Poll sau unmount | Hook đọc operation VERIFYING; unmount; tiến timer giả1600ms | 2 lần gọi request, assertion mong1 | FAIL — UI-F04; host reproducer |
| Thanh kéo panel | Đọc component/source | Chỉ có onPointerDown, không xử lý phím/giá trị splitter | SOURCE finding UI-F05; phép thử phím riêng NOT RUN |

### Ảnh

- [FBD desktop1440 — dữ liệu fixture](pgm02-fbd-1440.png).
- [Panel max vượt khung1440 — dữ liệu fixture](pgm02-panels-overflow-1440.png).
- [FBD mobile390, đầu trang — dữ liệu fixture](pgm02-mobile-390.png).
- [Mapping mobile390 — component gốc và dữ liệu minh họa](mapping-identity-390.png).
- [Mapping desktop1280 — cùng component và hai hàng đó](mapping-identity-1280.png).

Screenshot component Mapping tập trung nội dung component, không mang theme/shell của toàn ứng dụng. Không đánh giá màu sắc tổng thể từ hai ảnh này. Ảnh FBD không phải xuất từ mockup thiết kế.

### Source và test tái hiện

- [Fixture component Mapping](mapping-reproducer.txt): đặt thành `audit-mapping.tsx` trong thư mục `apps/web-ui` của baseline, dùng HTML chỉ có root/module và meta viewport. Render lại chính component hiện có; không tạo bản sao markup của bảng.
- [Test hook tái hiện](polling-reproducer.txt): đặt thành `src/features/programming/commission/audit-polling.test.tsx` trong worktree riêng rồi chạy Vitest jsdom cho đúng file. Có mock client/auth, chỉ gọi `recheckStatus`, không gọi `submit`.
- [Log test tái hiện](polling-reproducer.log): exit1 mong đợi khi xác nhận lỗi hiện tại. Không ghi là test sản phẩm PASS.

## 3. Các trang và lỗi mạng đã quan sát

Mở Programming Programs/FBD, Mapping, Library, Commission với revision/check mock, Runtime tab Watch và Tổng quan. Đã thấy loading khi lazy editor nạp, trạng thái rỗng bảng chưa gán, mobile chỉ đọc và lỗi Published Signal. Chỉ kiểm read-only/view ở những trang này; không thực hiện xác nhận Commission, restore hay thao tác I/O.

Ở lượt cuối, Chrome Console có 1 dòng `Failed to load resource ...503`. Network có các lỗi 503 của `/api/v1/overview`, `/alarms`, `/system/status`, `/me`, `/health`, `/system/capabilities`, `/me/preferences` và `/programming/runtime/signals`. Đây là giới hạn handler fixture. WebSocket không phục vụ tạo banner mất kết nối; banner không chứng minh lỗi giao tiếp ở bo. [Bản đọc Console](console.txt), [bản đọc Network](network.txt).

API Programming/capabilities, runtime, project, chương trình, catalog và checks dùng để mở các luồng chính đã trả200 từ handler. Không có kết luận “Console/Network sạch toàn ứng dụng”. Mã JS không được đánh giá là lỗi chỉ vì endpoint mock thiếu.

## 4. Các cổng đã chạy

| Lệnh | Kết quả | Log |
|---|---|---|
| `npx vitest --run --environment jsdom` cho 5 file chọn lọc | PASS5/5 file,44/44 test,4,52s | [Vitest](vitest.log) |
| `npm run lint` | PASS exit0 | [Lint](lint.log) |
| `npm run build` sau npm ci | PASS exit0; chunk Programming76,83KiB gzip/165KiB | [Build](build.log) |
| Test hook tái hiện mới | FAIL1/1, request2 thay vì1 | [Reproducer](polling-reproducer.log) |
| `python3 scripts/docs_iso_harness.py --expect` | PASS exit 0; quét 489 file Markdown; 0 link thiếu, 0 lệch metadata; EXPECT khớp | [Log kiểm tài liệu](docs-harness.log) |
| `python3 scripts/candidate_pin_check.py` | PASS 17/17 hồ sơ khớp pin | [Log pin](candidate-pins.log) |
| `git diff --check` | PASS exit 0 | Diff tracked của phiên này và WIP có trước |
| Bộ Vitest/E2E đầy đủ, backend thật, target/HIL và nghiệm thu release | NOT RUN | Review có phạm vi giới hạn |

Năm file Vitest là `ProgramsWorkspace.test.tsx`, `MappingLiveData.test.tsx`, `CheckCommissionPage.test.tsx`, `ShellNavigation.test.tsx`, `WeeklyTab.test.tsx` tại source baseline. Lượt đầu mượn dependency từ checkout local thiếu Node types; đã cài dependency riêng và chạy lại các cổng trên. Không sửa source để làm test tái hiện lỗi xanh. Kiểm tài liệu/pin không chứng minh trạng thái runtime hay đóng finding frontend.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-09-29 | Ghi cấu hình, lớp bằng chứng, phép tái hiện, screenshot và log; không có deploy/target/HIL |
