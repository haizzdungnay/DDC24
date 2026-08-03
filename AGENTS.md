# Agent Rules

- Every code, config, deployment, or documentation change must update `CHANGELOG.md` in the same work session.
- Add changelog entries under `[Unreleased]` with date, scope, and verification notes when relevant.
- Do not skip the changelog unless the user explicitly says not to update it.
- Keep FE local changes as the source of truth; do not overwrite unrelated local FE work.
- Luôn trả lời bằng tiếng Việt và viết tài liệu (docs, changelog, báo cáo, review) bằng tiếng Việt. Hạn chế tối đa tiếng Anh trong nội dung rule và skill của agent; chỉ giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật/tên riêng không có bản dịch tương đương rõ ràng (ví dụ: BACnet, Modbus, CRC, endian, watchdog, tên biến/hàm/API trong code).

## Kiểm chứng frontend bằng Chrome DevTools MCP

- Tự dùng skill `$inspect-fe-chrome-devtools` và MCP `chrome-devtools` khi công
  việc liên quan review UI/UX, thay đổi giao diện hoặc hành vi React/Vite,
  responsive, accessibility, lỗi tương tác, tích hợp FE–BE, Console/Network,
  hiệu năng hoặc lỗi chỉ xuất hiện lúc chạy trên trình duyệt.
- Sau thay đổi FE có thể ảnh hưởng giao diện hoặc runtime, mở đúng luồng trên
  trình duyệt thật và kiểm tra tối thiểu snapshot/screenshot, Console error và
  Network request thất bại. Với thay đổi layout, kiểm tra cả desktop và mobile.
- Chrome DevTools MCP là bằng chứng bổ sung, không thay cho Vitest, lint, build
  hoặc Playwright E2E. Không bắt buộc dùng cho thay đổi chỉ gồm type/test/docs
  không ảnh hưởng runtime; nếu bỏ qua thì nêu lý do trong bàn giao.
- Không áp dụng workflow trình duyệt cho HMI native LVGL/DRM. Không dùng profile
  Chrome cá nhân, thông tin đăng nhập hoặc dữ liệu nhạy cảm nếu user chưa cho
  phép; không đưa token/cookie/header bí mật vào báo cáo.
- Nếu MCP chưa có trong phiên, kiểm tra `codex mcp get chrome-devtools`, báo rõ
  cần restart Codex và không được claim đã kiểm chứng bằng trình duyệt.

## Quy trình khi user nói "commit" hoặc "merge"

Khi user chỉ nói ngắn gọn **"commit"**, **"merge"**, **"commit đi"**, **"merge đi"** — hiểu là **chạy trọn quy trình dưới đây cho toàn bộ thay đổi hiện có trong cây làm việc**, không hỏi lại từng bước:

1. **Kiểm chứng trước khi commit**, ghi số đo thật (không dẫn lại số cũ):
   - C++: `cmake -S services -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` rồi `ctest --test-dir build/fw` (**bật cả 3 option**, mặc định HMI là OFF nên dễ bỏ sót gate).
   - Go: `go vet ./...` + `go test ./... -count=1` (dùng `-count=1`, kết quả cache che được hồi quy).
   - FE: `npx vitest --run --environment jsdom src` + `npm run lint` + `npm run build`. Lưu ý `npm test` chỉ quét `src/`, **không** chạy `e2e/`.
   - E2E khi có đổi trang mạng: `npx playwright test e2e/network-qa.spec.ts`.
2. **Cập nhật `CHANGELOG.md`** dưới `[Unreleased]`.
3. **Commit tách theo nhóm logic, chi tiết để dễ truy xuất.** Không gom tất cả vào một commit. Mỗi commit: một nhóm mạch lạc (hợp đồng SHM / netcfg / backend Go / frontend / CI / tài liệu), tiêu đề theo Conventional Commits, thân bài **tiếng Việt** nêu rõ **triệu chứng → nguyên nhân gốc → cách sửa**, dẫn mã finding và tài liệu liên quan (`Refs:`).
4. **Push** lên nhánh hiện tại (đang ở nhánh mặc định thì tạo nhánh trước).
5. **Tạo PR** bằng `gh pr create`, mô tả tiếng Việt + bảng số đo kiểm chứng.
6. **Merge PR**, rồi **xoá nhánh remote**.
7. Báo lại kết quả kèm link PR và số đo.

Nếu bước nào hỏng (thường gặp: token `gh`/git hết hạn), **làm hết các bước không bị chặn** rồi nói rõ bước nào còn lại và cần gì để mở khoá.
