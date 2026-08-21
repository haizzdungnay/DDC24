import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  outputDir: './node_modules/.cache/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    // Người dùng thật của MK-DDC-24 chủ yếu ở VN; kể từ khi `I18nProvider`
    // đọc `navigator.language` cho hồ sơ trình duyệt mới (BUG-001 — không còn
    // hard-code 'vi'), locale của Chrome do Playwright dựng phải khớp thực tế
    // thị trường, nếu không mọi assertion tiếng Việt "mặc định" sẽ phụ thuộc
    // locale ngẫu nhiên của máy CI thay vì phản ánh người dùng thật.
    locale: 'vi-VN'
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' }
    },
    // TASK-PROG-506: UX-WEB-PROG-001 §14 UX-T-002 đòi hỏi bằng chứng mobile
    // 390×844 thật, không chỉ desktop. Giới hạn `testMatch` vào spec
    // Programming — các spec e2e khác của dự án không đổi hành vi (không
    // tự nhân đôi số lần chạy của công việc FE không liên quan).
    // `channel: 'chrome'` giữ nguyên Chrome thật cho cả hai project.
    {
      name: 'mobile-chrome',
      testMatch: /programming.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], channel: 'chrome' }
    }
  ],
  webServer: {
    command: 'npm run dev -- --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_DDC_MODE: 'live',
      VITE_AUTH_MODE: 'mock',
      VITE_HISTORIAN_V2_TRENDS: '1',
      // TASK-PROG-500: bốn workspace Programming chỉ hiện sau cờ này; mặc
      // định TẮT ở production, bật riêng cho dev server e2e để có bằng
      // chứng trình duyệt thật (không phải mock) cho toàn bộ P5.
      VITE_PROGRAMMING_REV_A: '1',
      // Tắt file watcher của Vite: xem ghi chú ở `vite.config.ts`.
      VITE_E2E_NO_WATCH: '1'
    }
  }
})
