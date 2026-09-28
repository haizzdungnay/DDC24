// Số trên chuông TopBar ở trình duyệt thật (không route).
import { createRequire } from 'node:module'
// Credential chỉ lấy từ môi trường (không ghi mật khẩu vào repo):
// MKDDC_WEB_USER (mặc định admin), MKDDC_WEB_PASSWORD (bắt buộc).
const WEB_USER = process.env.MKDDC_WEB_USER || 'admin'
const WEB_PASSWORD = process.env.MKDDC_WEB_PASSWORD
if (!WEB_PASSWORD) { console.error('thiếu MKDDC_WEB_PASSWORD'); process.exit(2) }

const require = createRequire('/home/user/MK-DDC-24/apps/web-ui/package.json')
const { chromium } = require('playwright')
const [baseURL, label] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
let alarmsGets = 0
page.on('response', (r) => { if (new URL(r.url()).pathname === '/api/v1/alarms') alarmsGets += 1 })
await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/Tên đăng nhập|Username/i).fill(WEB_USER)
await page.getByLabel(/^Mật khẩu$|^Password$/i).fill(WEB_PASSWORD)
await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
await page.getByTestId('app-top-bar').waitFor()
await page.waitForTimeout(4000)
const bell = (await page.getByTestId('app-top-bar').locator('a[href="/alarms"]').innerText()).trim()
console.log(JSON.stringify({ label, bellBadge: bell, alarmsGetsIn4s: alarmsGets }))
await browser.close()
