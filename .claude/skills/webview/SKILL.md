---
name: webview
description: Xem giao diện web-ui thật khi board lab chết hoặc demo mode không mock được API. Dựng Playwright trace từ một test E2E rồi mở trace viewer để xem DOM thật ở mọi bước và mọi khổ màn hình. Dùng khi cần "xem giao diện" Programming/FBD hoặc bất kỳ màn hình nào phụ thuộc API backend.
---

# Xem giao diện web-ui qua Playwright trace

## Khi nào dùng

Người dùng muốn **nhìn tận mắt** một màn hình `apps/web-ui` mà:

- board lab `192.168.120.224:8081` không phản hồi, hoặc
- màn hình đó gọi API mà `src/shared/demo/simulator.ts` không mock (ví dụ toàn bộ `/api/v1/programming/**`).

Trong hai trường hợp trên, `npm run dev` chỉ hiện skeleton + "Core is unreachable". Không có biến môi trường nào cứu được: `VITE_DDC_MODE` chỉ nhận `live` hoặc `demo` (`src/shared/config.ts`), và demo simulator không có handler Programming.

Lối thoát duy nhất là dùng mock `page.route()` có sẵn trong `e2e/*.spec.ts`.

## Nguyên tắc

Mock nằm **trong thân test**, không phải ở `beforeEach`. Vì vậy:

- **KHÔNG dùng `PWDEBUG=1`.** Inspector dừng ở dòng đầu tiên, trước khi `installProgrammingMocks()` chạy → người dùng thấy trang trần "Core is unreachable" và tưởng hỏng.
- **Dùng `--trace on` + headless.** Test chạy hết, trace ghi DOM snapshot ở mọi bước. Người dùng tua tự do, không phải bấm gì.

## Quy trình

Mọi lệnh chạy từ `apps/web-ui`. Trên Windows cần `cd /e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/apps/web-ui &&` ở đầu vì cwd harness là thư mục cha.

### 1. Chọn test làm nguồn giao diện

Tìm test dựng đúng màn hình cần xem:

```bash
grep -nE "^\s+test\(" e2e/programming.spec.ts
```

Test tốt là test đã đi qua `login()` + `navigate()` + thao tác mở màn hình. Ví dụ FBD Editor responsive:
`TC-FBD-RESP-001..003/HEADER-001/STATE-004` (`e2e/programming.spec.ts:1455`) — đi qua 6 mốc 1440/1280/1024/820/768/390.

### 2. Build (một lần, còn dùng lại được)

`npm run build:e2e` **hỏng trên Windows** — script dùng cú pháp env Unix, Playwright spawn qua `cmd.exe` báo `'VITE_DDC_MODE' is not recognized`. Build tay trong Git Bash:

```bash
VITE_DDC_MODE=live VITE_AUTH_MODE=mock VITE_HISTORIAN_V2_TRENDS=1 \
VITE_PROGRAMMING_REV_A=1 VITE_PROGRAMS_WORKSPACE_V2=1 npx vite build
```

Bỏ qua bước này nếu `dist/` còn mới và chưa sửa source.

### 3. Chạy preview nền

```bash
npx vite preview --port 4174 --strictPort > /tmp/e2e-preview.log 2>&1 &
curl -s -o /dev/null -w "HTTP=%{http_code}\n" --max-time 5 http://127.0.0.1:4174/login
```

Phải ra `HTTP=200` mới đi tiếp.

### 4. Config tạm bỏ webServer

`playwright.config.ts` tự build+preview qua `webServer`, sẽ hỏng vì lý do ở bước 2. Tạo `playwright.headed-view.config.ts` (file tạm, xoá sau):

```ts
import base from './playwright.config'

export default {
  ...base,
  webServer: undefined,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174' },
  timeout: 0,
  workers: 1,
  reporter: 'list' as const,
}
```

### 5. Chạy test lấy trace

```bash
npx playwright test e2e/programming.spec.ts \
  --config playwright.headed-view.config.ts \
  --grep "TC-FBD-RESP-001" \
  --trace on --reporter=line > /tmp/pw-trace.log 2>&1; echo "EXIT=$?"
```

Test FAIL vẫn sinh trace — cứ mở xem.

### 6. Mở trace viewer

Trace nằm ở `node_modules/.cache/playwright-results/`, **không phải** `test-results/`:

```bash
T=$(find node_modules/.cache/playwright-results -name "trace.zip" -newermt "-30 minutes" | head -1)
npx playwright show-trace "$T"
```

Chạy nền. Cửa sổ desktop mở ra: cột trái là danh sách bước, click bước nào hiện DOM thật của bước đó — hover/inspect được. Tab **Screenshots** xem nhanh mọi mốc.

Hướng dẫn người dùng bằng bảng "bước test → thứ nhìn thấy", đừng bắt họ tự dò.

### 7. Dọn dẹp

Sau khi người dùng xem xong:

```bash
rm -f playwright.headed-view.config.ts
```

Tắt preview 4174 và mọi dev server đã mở. **Không** giết nhầm tiến trình `node.exe` khác: lấy PID qua `netstat -ano | grep 4174` trước.

## Ràng buộc

- Subagent **không** được chạy lệnh ghi git (`add/commit/push/stash/checkout/restore/reset/clean`) hay `gh`.
- **Không** sửa `e2e/*.spec.ts`, `package.json`, `.env.local`, `playwright.config.ts`. Chỉ file tạm ở bước 4 được sửa thoải mái.
- **Không** làm yếu assertion để test qua.
- Giao việc cho Sonnet/Haiku; Opus chỉ điều phối và xác minh từ file log.

## Bẫy đã gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| "Core is unreachable", "The program list could not be read" | Xem trang chưa có mock | Đừng dùng `PWDEBUG`; xem qua trace |
| `'VITE_DDC_MODE' is not recognized` | `build:e2e` chạy qua `cmd.exe` | Build tay trong Git Bash (bước 2) |
| `Process from config.webServer was not able to start` | Cùng nguyên nhân trên | Config tạm `webServer: undefined` |
| Log dừng ở "Running 1 test using 1 worker" rất lâu | Test resize nhiều mốc, chạy vài phút | Chờ; trace chỉ ghi khi test kết thúc |
| `find test-results -name trace.zip` rỗng | Sai thư mục | Tìm trong `node_modules/.cache/playwright-results` |

## Giới hạn

Trace là ảnh chụp tĩnh có tương tác — click được, xem DOM được, nhưng **không chạy JS mới**. Cần thao tác thật (gõ phím, kéo thả tự do) thì phải viết một test riêng có sẵn mock rồi chạy `--headed`, không dùng skill này.
