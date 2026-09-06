import { defineConfig, devices } from '@playwright/test'

/**
 * T59-505 — lane host/LOCAL có backend Go, compiler/packager và Core simulator
 * production thật. Cấu hình này cố ý tách khỏi `playwright.config.ts`: spec
 * không dùng `page.route`, không auth mock và không được tái sử dụng một server
 * ngẫu nhiên đang chạy trên máy phát triển.
 *
 * `ISS-STED-20` dùng cùng stack REAL-BACKEND cho phép đo CLI -> Go -> FE. Giữ
 * spec Gate369 trong `testMatch`: truyền tên file trên CLI vẫn bị Playwright
 * giao với `testMatch`, nên bỏ nó khỏi đây sẽ cho "No tests found" thay vì chạy
 * phép đo mà stage-c tuyên bố là release evidence.
 */
/* Trình duyệt đo — `ISS-STED-20` chặng (c).
 *
 * Bản trước ghim `channel: 'chrome'`, tức phép đo release-evidence chỉ chạy
 * được trên máy có Google Chrome cài sẵn ở `/opt/google/chrome/chrome`. Trên
 * runner CI sạch và trong container đo, lệnh đỏ ngay ở `browserType.launch`
 * trước khi chạm được assertion nào — một cổng không chạy được là một cổng sẽ
 * bị bỏ qua, đúng chế độ hỏng mà #369 sinh ra để chặn.
 *
 * Mặc định vì thế là **chromium đi kèm Playwright**, theo đúng lý do đã ghi ở
 * `playwright.board.config.ts`: "để không phụ thuộc Chrome cài sẵn của máy
 * chạy". Ai cần đo trên Chrome thật thì đặt `MKDDC_E2E_CHROME_CHANNEL=chrome`
 * — lựa chọn đó nay là một quyết định NÓI RA, không phải một ràng buộc ẩn.
 */
const browserChannel = process.env.MKDDC_E2E_CHROME_CHANNEL || undefined

/* Đường dẫn chromium thay thế — dành cho máy đo có sẵn browser Playwright ở
 * một build khác với build mà `@playwright/test` của repo trông đợi (container
 * CI dùng chung cache browser là ca điển hình). Không đặt biến thì Playwright
 * tự tìm browser của chính nó như cũ; đây là đường thoát cho môi trường, KHÔNG
 * phải thay đổi cách đo. Người ký đọc được nó vì `gate369-stage-c.sh` in ra.
 */
const chromiumExecutablePath = process.env.MKDDC_E2E_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './e2e',
  testMatch: /(?:programming-real|gate369-cli-go-fe-real)\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: './node_modules/.cache/playwright-programming-real-results',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    locale: 'vi-VN'
  },
  projects: [
    {
      name: 'programming-real-desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: browserChannel,
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}
      }
    }
  ],
  webServer: [
    {
      command: '../../scripts/run_programming_real_e2e_stack.sh',
      url: 'http://127.0.0.1:4181/api/v1/health',
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        PROGRAMMING_REAL_BACKEND_PORT: '4181',
        PROGRAMMING_REAL_SEED_LEGACY_V1: '1'
      }
    },
    {
      command: 'npm run dev -- --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_DDC_MODE: 'live',
        VITE_AUTH_MODE: 'jwt',
        VITE_PROGRAMMING_REV_A: '1',
        // T59-802: chỉ lane host E2E dùng route tree mới; production default
        // vẫn false cho tới khi authority cut-over riêng.
        VITE_PROGRAMS_WORKSPACE_V2: '1',
        VITE_E2E_NO_WATCH: '1',
        VITE_PROXY_TARGET: 'http://127.0.0.1:4181'
      }
    }
  ]
})
