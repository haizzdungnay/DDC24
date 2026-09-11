import { defineConfig, devices } from '@playwright/test'

/* Trình duyệt đo — cùng lý do đã ghi ở `playwright.programming-real.config.ts`
 * và `playwright.board.config.ts`.
 *
 * Config này ghim `channel: 'chrome'`, nên trên runner sạch (và trong container
 * đo của `ISS-PGM03-05`) mọi test đỏ ngay ở `browserType.launch` với
 * "Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome" —
 * trước khi chạm được assertion nào. Một cổng không chạy được là một cổng sẽ bị
 * bỏ qua; lane real-backend đã sửa đúng lỗi này ở #541 và lane mock vẫn còn.
 *
 * Mặc định vì thế là chromium đi kèm Playwright. Ai cần đo trên Chrome thật thì
 * đặt `MKDDC_E2E_CHROME_CHANNEL=chrome` — một quyết định NÓI RA, không phải một
 * ràng buộc ẩn với máy chạy.
 */
const browserChannel = process.env.MKDDC_E2E_CHROME_CHANNEL || undefined

/* Đường dẫn chromium thay thế — giống `playwright.programming-real.config.ts`.
 * Dành cho máy đo có sẵn browser Playwright ở một build khác với build mà
 * `@playwright/test` của repo trông đợi (container CI dùng chung cache browser
 * là ca điển hình: cache có `chromium-1194` trong khi runtime đòi `-1228`).
 * Không đặt biến thì Playwright tự tìm browser của chính nó như cũ.
 */
const chromiumExecutablePath = process.env.MKDDC_E2E_CHROMIUM_PATH || undefined
const launchOptions = chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}

export default defineConfig({
  testDir: './e2e',
  // T59-505/604 — lane real-backend có stack riêng (`playwright.programming-real.config.ts`
  // dựng backend Go + Core simulator thật). Hồ sơ vẫn ghi nó "bị loại khỏi suite
  // mock mặc định", nhưng config này CHƯA hề loại: `npx playwright test` kéo
  // luôn spec đó vào cả hai project và nó đỏ với `ECONNREFUSED 127.0.0.1:8081`
  // — hai test đỏ không liên quan gì tới thay đổi của người đang chạy cổng, và
  // đó là cách nhanh nhất để một cổng bị bỏ qua vì "vốn dĩ nó đỏ sẵn".
  testIgnore: /programming-real\.spec\.ts/,
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
      use: { ...devices['Desktop Chrome'], channel: browserChannel, launchOptions }
    },
    // TASK-PROG-506: UX-WEB-PROG-001 §14 UX-T-002 đòi hỏi bằng chứng mobile
    // 390×844 thật, không chỉ desktop. Giới hạn `testMatch` vào spec
    // Programming — các spec e2e khác của dự án không đổi hành vi (không
    // tự nhân đôi số lần chạy của công việc FE không liên quan).
    // Cả hai project dùng cùng một trình duyệt (xem `browserChannel`).
    {
      name: 'mobile-chrome',
      testMatch: /programming.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], channel: browserChannel, launchOptions }
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
    timeout: 300_000,
    // T59-802: cut-over route Programs v2 chỉ trong lane browser E2E. Lệnh
    // production `npm run build` không nhận biến này nên rollback default vẫn
    // là false; đặt ở preview thì quá muộn vì Vite đã đóng cờ lúc build.
    env: {
      VITE_PROGRAMS_WORKSPACE_V2: '1'
    }
  }
})
