// T63-108 — trình duyệt THẬT có tự gửi If-None-Match và nhận 304 không?
// Không dùng context.route (Playwright tắt HTTP cache khi có route) ⇒ mọi request
// đi thẳng tới mkddc-web. Mở trang Cảnh báo (poll /alarms mỗi 2 s) 40 s, rồi đếm
// status theo route từ phía trình duyệt (CDP) và từ log server.
// Dùng: node measure_304.mjs <baseURL> <serverLog> <out.json> [seconds]
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Credential chỉ lấy từ môi trường (không ghi mật khẩu vào repo):
// MKDDC_WEB_USER (mặc định admin), MKDDC_WEB_PASSWORD (bắt buộc).
const WEB_USER = process.env.MKDDC_WEB_USER || 'admin'
const WEB_PASSWORD = process.env.MKDDC_WEB_PASSWORD
if (!WEB_PASSWORD) { console.error('thiếu MKDDC_WEB_PASSWORD'); process.exit(2) }


const require = createRequire('/home/user/MK-DDC-24/apps/web-ui/package.json')
const { chromium } = require('playwright')
const [baseURL, serverLog, outPath, secondsArg] = process.argv.slice(2)
const SECONDS = Number(secondsArg || 40)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
const seen = []
const reqHeaders = new Map()
cdp.on('Network.requestWillBeSentExtraInfo', (e) => { reqHeaders.set(e.requestId, e.headers) })
cdp.on('Network.responseReceivedExtraInfo', (e) => {
  const h = reqHeaders.get(e.requestId) || {}
  seen.push({ id: e.requestId, wireStatus: e.statusCode, inm: Object.keys(h).some((k) => k.toLowerCase() === 'if-none-match') })
})
const urls = new Map()
cdp.on('Network.requestWillBeSent', (e) => { urls.set(e.requestId, e.request.url) })
const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/Tên đăng nhập|Username/i).fill(WEB_USER)
await page.getByLabel(/^Mật khẩu$|^Password$/i).fill(WEB_PASSWORD)
await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
// Điều hướng phía client (bấm chuông): tải lại cả trang sẽ mất phiên trong bộ nhớ.
await page.locator('a[href="/alarms"]').first().click()
await page.waitForURL((url) => url.pathname === '/alarms', { timeout: 30_000 })
await page.waitForTimeout(3000)
const logBefore = readFileSync(serverLog, 'utf8').split('\n').length
const mark = seen.length
await page.waitForTimeout(SECONDS * 1000)
// Bảng cảnh báo vẫn hiện đúng dữ liệu sau các lượt 304 (thân lấy từ cache của trình duyệt).
const alarmRowVisible = await page.getByText('Nhiệt độ gió cấp cao').first().isVisible().catch(() => false)
await browser.close()

const window = seen.slice(mark).map((s) => ({ ...s, path: new URL(urls.get(s.id) || 'http://x/').pathname }))
const byRoute = {}
for (const s of window) {
  if (!s.path.startsWith('/api/')) continue
  const key = `${s.path} ${s.wireStatus}${s.inm ? ' (If-None-Match)' : ''}`
  byRoute[key] = (byRoute[key] || 0) + 1
}
const serverLines = readFileSync(serverLog, 'utf8').split('\n').slice(logBefore - 1)
const serverByRoute = {}
for (const line of serverLines) {
  const m = line.match(/method=GET path=(\S+) status=(\d+)/)
  if (!m) continue
  if (!['/api/v1/alarms', '/api/v1/me'].includes(m[1])) continue
  const key = `${m[1]} ${m[2]}`
  serverByRoute[key] = (serverByRoute[key] || 0) + 1
}
const summary = { baseURL, seconds: SECONDS, browserWire: byRoute, server: serverByRoute, alarmRowVisible, consoleErrors }
writeFileSync(outPath, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
