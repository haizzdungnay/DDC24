import { defineConfig, devices } from '@playwright/test'

/**
 * Cấu hình Playwright chạy với BOARD THẬT — plan 45 §8.3.
 *
 * Khác `playwright.config.ts` ở hai điểm cốt lõi:
 *
 * 1. **Không có `webServer`.** Cấu hình mặc định tự dựng một dev server ở host
 *    và test chạy với `VITE_AUTH_MODE=mock` — tức là kiểm bundle của host, với
 *    xác thực giả. Cái đó không nói được gì về bản đã cắt xuống board. Ở đây
 *    `baseURL` trỏ vào chính `mkddc-web` trên Orange Pi 5B qua SSH tunnel, phục
 *    vụ đúng `dist/` đã deploy, với JWT thật và RBAC thật.
 * 2. **Dùng chromium đi kèm Playwright**, không `channel: 'chrome'`, để không
 *    phụ thuộc Chrome cài sẵn của máy chạy.
 *
 * Chạy:
 *   ssh -f -N -L 18081:127.0.0.1:8081 SOM-DDC-24
 *   BOARD_URL=http://127.0.0.1:18081 BOARD_ADMIN_PASS=… \
 *     npx playwright test --config playwright.board.config.ts
 */
export default defineConfig({
  testDir: './e2e-board',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  outputDir: './node_modules/.cache/playwright-board-results',
  timeout: 60_000,
  use: {
    baseURL: process.env.BOARD_URL || 'http://127.0.0.1:18081',
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'off',
    ignoreHTTPSErrors: true
  },
  projects: [
    { name: 'board-chromium', use: { ...devices['Desktop Chrome'], channel: undefined } }
  ]
})
