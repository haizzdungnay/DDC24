import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PROGRAMMING_TARGET_BASE_URL
if (!baseURL) {
  throw new Error('Thiếu PROGRAMMING_TARGET_BASE_URL; không được ngầm chạy target lane vào localhost.')
}

/**
 * `T59-813` — lane browser đọc trực tiếp bundle + Web API + Core trên target.
 *
 * Không khai `webServer`: mọi request phải đi tới controller được chỉ định rõ.
 * Spec production thật dùng chung với lane host, nhưng closeout R2 chỉ chọn các
 * case T59-810/811; các case tạo/Commission fixture thuộc lane host riêng.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: [/programming-real\.spec\.ts/, /programming-target-fault\.spec\.ts/],
  /* `testMatch` chọn FILE, không chọn CASE. `programming-real.spec.ts` còn chứa
   * các case R1 tự tạo Project và Commission gói mới; chạy nguyên file lên
   * controller sẽ đổi chính Active đang điều khiển tủ để lấy bằng chứng về
   * Active — vừa sai phạm vi closeout R2, vừa là mutation không ai yêu cầu.
   * Lane target vì vậy khoá cứng tập case ở đây, không dựa vào người chạy nhớ
   * gõ `--grep`. */
  grep: /T59-810|T59-811|T59-813/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: './node_modules/.cache/playwright-programming-target-results',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    locale: 'vi-VN',
  },
  projects: [
    {
      name: 'programming-target-desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
})
