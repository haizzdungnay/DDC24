import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
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
  // T59-604 — PHỤC VỤ BẢN ĐÃ BUILD, KHÔNG PHẢI DEV SERVER.
  //
  // Chuỗi đỏ ngắt quãng (64/79/79/78+1F/78+1F, rồi 79/78+1F sau lần vá đầu) đều
  // chết ở cùng một chỗ: thao tác đầu tiên chạm một route chưa được biên dịch.
  // Vite dev biên dịch theo yêu cầu, nên lần chạm đầu của MỖI route trả tiền
  // biên dịch bằng ngân sách thời gian của chính test đó — và khi mười worker
  // cùng khởi động thì khoản ấy vượt hạn. Nới timeout chỉ dời ngưỡng vỡ; bỏ hẳn
  // biên dịch-theo-yêu-cầu mới là bỏ nguyên nhân.
  //
  // Cờ `VITE_*` phải nằm ở lệnh BUILD (`build:e2e`), không phải ở env của
  // webServer: `vite preview` chỉ phục vụ tĩnh, không đọc lại biến môi trường.
  webServer: {
    command: 'npm run build:e2e && npx vite preview --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/login',
    reuseExistingServer: false,
    timeout: 300_000
  }
})
