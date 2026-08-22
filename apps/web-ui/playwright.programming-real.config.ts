import { defineConfig, devices } from '@playwright/test'

/**
 * T59-505 — lane host/LOCAL có backend Go, compiler/packager và Core simulator
 * production thật. Cấu hình này cố ý tách khỏi `playwright.config.ts`: spec
 * không dùng `page.route`, không auth mock và không được tái sử dụng một server
 * ngẫu nhiên đang chạy trên máy phát triển.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /programming-real\.spec\.ts/,
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
      use: { ...devices['Desktop Chrome'], channel: 'chrome' }
    }
  ],
  webServer: [
    {
      command: '../../scripts/run_programming_real_e2e_stack.sh',
      url: 'http://127.0.0.1:4181/api/v1/health',
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        PROGRAMMING_REAL_BACKEND_PORT: '4181'
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
        VITE_E2E_NO_WATCH: '1',
        VITE_PROXY_TARGET: 'http://127.0.0.1:4181'
      }
    }
  ]
})
