// T63-108 — đếm GET theo route khi mở 1 tab Dashboard + đo tuổi giá trị đang hiển thị.
// Hai chế độ:
//   poll : host không Core ⇒ kênh sống không có điểm; /points trả giả (giá trị = 1000 + lượt).
//   ws   : giả lập bo có Core: WebSocket /api/v1/ws/monitor bị chặn bằng routeWebSocket và
//          đẩy khung điểm mỗi 200 ms (giá trị = 2000 + n, updatedAt = now), đúng nhịp
//          monitorUpdateInterval của ws.go. /points vẫn trả giả như chế độ poll.
// Mọi request khác đi tới mkddc-web thật (overview, alarms, activity, me, system/status).
// Tuổi giá trị: ô ghim UI-01 ở "Không gian của tôi" được lấy mẫu mỗi 50 ms trong trang;
// tuổi = thời điểm lấy mẫu − thời điểm giá trị đó được phát (route /points hoặc khung WS).
//   board: KHÔNG giả gì (chạy với bo thật): không route ⇒ cache HTTP của trình duyệt bật, 304
//          đếm được; tuổi giá trị đọc từ nhãn tuổi của ô ghim (`Ns`, theo updatedAt của
//          producer — cần đồng hồ máy đo và bo cùng NTP). Điểm ghim: env PIN_POINT (mặc định UI-01).
// Dùng: node measure_polling2.mjs <baseURL> <label> <out.json> <windowS> <hiddenS> <poll|ws|board>
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Credential chỉ lấy từ môi trường (không ghi mật khẩu vào repo):
// MKDDC_WEB_USER (mặc định admin), MKDDC_WEB_PASSWORD (bắt buộc).
const WEB_USER = process.env.MKDDC_WEB_USER || 'admin'
const WEB_PASSWORD = process.env.MKDDC_WEB_PASSWORD
if (!WEB_PASSWORD) { console.error('thiếu MKDDC_WEB_PASSWORD'); process.exit(2) }


const require = createRequire('/home/user/MK-DDC-24/apps/web-ui/package.json')
const { chromium } = require('playwright')
const [baseURL, label, outPath, windowArg, hiddenArg, modeArg] = process.argv.slice(2)
const WINDOW_S = Number(windowArg || 60)
const HIDDEN_S = Number(hiddenArg || 0)
const MODE = modeArg || 'poll'

// Tên thiết bị quyết định khoá ghim của MyWorkspace: hỏi server trước.
const login = await fetch(`${baseURL}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: WEB_USER, password: WEB_PASSWORD }) })
const { token } = await login.json()
const ov = await (await fetch(`${baseURL}/api/v1/overview`, { headers: { Authorization: `Bearer ${token}` } })).json()
const deviceName = (ov.controller?.deviceName ?? '').trim()
const pinKey = `mkddc:v1:workspace:${deviceName || 'unknown'}:admin`
const PIN = process.env.PIN_POINT || 'UI-01'

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
await context.addInitScript(([key, pin]) => {
  try {
    window.localStorage.setItem('mkddc:v1:landing-trend-points', JSON.stringify([pin]))
    window.localStorage.setItem(key, JSON.stringify([pin]))
  } catch { /* ignore */ }
}, [pinKey, PIN])

const emitted = new Map() // value → epoch ms khi phát
function pointRecord(value) {
  return { id: 'UI-01', channel: 1, tag: 'UI-01', name: 'UI_01', kind: 'UI', value, unit: '', quality: 'good', source: 'io', updatedAt: new Date().toISOString() }
}
let tick = 0
if (MODE !== 'board') await context.route(/\/api\/v1\/points(\?.*)?$/, async (route) => {
  tick += 1
  const value = 1000 + tick
  emitted.set(value, Date.now())
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([pointRecord(value)]) })
})

let wsFrames = 0
if (MODE === 'ws') {
  await context.routeWebSocket(/\/api\/v1\/ws\/monitor/, (ws) => {
    let n = 0
    const timer = setInterval(() => {
      n += 1
      const value = 2000 + n
      emitted.set(value, Date.now())
      wsFrames += 1
      try { ws.send(JSON.stringify({ op: 'update', ts: new Date().toISOString(), points: [pointRecord(value)] })) } catch { clearInterval(timer) }
    }, 200)
    ws.onClose(() => clearInterval(timer))
  })
}

const page = await context.newPage()
const consoleErrors = []
const failed = []
const events = []
let phase = 'setup'
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`${phase}: ${msg.text()}`) })
page.on('requestfailed', (req) => { if (req.url().includes('/api/')) failed.push(`${phase}: ${req.method()} ${req.url()} ${req.failure()?.errorText}`) })
page.on('response', (resp) => {
  const req = resp.request()
  const url = new URL(req.url())
  if (!url.pathname.startsWith('/api/')) return
  events.push({ phase, t: Date.now(), method: req.method(), route: url.pathname, status: resp.status(), inm: Boolean(req.headers()['if-none-match']) })
})
let wsOpened = 0
page.on('websocket', () => { wsOpened += 1 })

await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/Tên đăng nhập|Username/i).fill(WEB_USER)
await page.getByLabel(/^Mật khẩu$|^Password$/i).fill(WEB_PASSWORD)
await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
// Bo thật có thể chưa có mẫu xu hướng ngay; chỉ cần shell + Landing đã dựng.
if (MODE === 'board') await page.getByTestId('app-top-bar').waitFor({ state: 'visible', timeout: 60_000 })
else await page.locator('.recharts-surface').first().waitFor({ state: 'visible', timeout: 60_000 })
await page.waitForTimeout(5000)

// Bộ lấy mẫu ô ghim: giá trị hiển thị + thời điểm.
await page.evaluate((pin) => {
  window.__samples = []
  const tile = () => document.querySelector(`a[href="/monitor?point=${encodeURIComponent(pin)}"]`)
  window.__sampler = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    const link = tile()
    const value = link?.querySelector('.text-2xl')?.textContent ?? null
    const ageText = link?.querySelector('.mono.mt-2.text-\\[11px\\]')?.textContent ?? null
    window.__samples.push([Date.now(), value, ageText])
  }, 50)
}, PIN)

phase = 'visible'
const start = Date.now()
await page.waitForTimeout(WINDOW_S * 1000)
const end = Date.now()
const samples = await page.evaluate(() => { clearInterval(window.__sampler); return window.__samples })

let hidden = null
if (HIDDEN_S > 0) {
  phase = 'hidden'
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hStart = Date.now()
  await page.waitForTimeout(HIDDEN_S * 1000)
  const hEnd = Date.now()
  const hEvents = events.filter((e) => e.phase === 'hidden' && e.t >= hStart + 500 && e.t <= hEnd && e.method === 'GET')
  hidden = { seconds: HIDDEN_S, gets: hEvents.length, getsPerS: +(hEvents.length / ((hEnd - hStart - 500) / 1000)).toFixed(3), byRoute: countBy(hEvents) }
  phase = 'visible-again'
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1500)
}
await browser.close()

function countBy(list) {
  const out = {}
  for (const e of list) {
    const key = `${e.method} ${e.route} ${e.status}`
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
function percentile(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
const ages = []
let unparsed = 0
const boardAgesS = []
for (const [, , ageText] of samples) {
  const m = ageText ? ageText.match(/·\s*(\d+)s\s*$/) : null
  if (m) boardAgesS.push(Number(m[1]))
}
boardAgesS.sort((a, b) => a - b)
for (const [t, text] of samples) {
  const value = text ? Number.parseFloat(text) : Number.NaN
  const at = emitted.get(value)
  if (!Number.isFinite(value) || at === undefined) { unparsed += 1; continue }
  ages.push(t - at)
}
ages.sort((a, b) => a - b)
const win = events.filter((e) => e.phase === 'visible' && e.t >= start && e.t <= end)
const gets = win.filter((e) => e.method === 'GET')
const durS = (end - start) / 1000
const summary = {
  label, mode: MODE, baseURL, windowS: durS,
  gets: gets.length, getsPerS: +(gets.length / durS).toFixed(3),
  byRoute: countBy(win),
  status304: gets.filter((e) => e.status === 304).length,
  conditionalRequests: gets.filter((e) => e.inm).length,
  displayedValueAgeMs: { samples: ages.length, unparsed, p50: percentile(ages, 0.5), p95: percentile(ages, 0.95), max: ages.length ? ages[ages.length - 1] : null },
  tileAgeLabelS: { samples: boardAgesS.length, p50: percentile(boardAgesS, 0.5), p95: percentile(boardAgesS, 0.95), max: boardAgesS.length ? boardAgesS[boardAgesS.length - 1] : null },
  wsOpened, wsFrames,
  hidden,
  afterVisibleAgain: countBy(events.filter((e) => e.phase === 'visible-again')),
  consoleErrors, failed
}
writeFileSync(outPath, JSON.stringify(summary, null, 2))
console.log(`${label} [${MODE}]: ${summary.gets} GET / ${durS.toFixed(1)} s = ${summary.getsPerS} GET/s; 304=${summary.status304}; ` +
  `age p50/p95/max ${summary.displayedValueAgeMs.p50}/${summary.displayedValueAgeMs.p95}/${summary.displayedValueAgeMs.max} ms (n=${ages.length}, unparsed=${unparsed}); ` +
  `ws ${wsOpened}/${wsFrames}; hidden ${hidden ? hidden.getsPerS + ' GET/s' : '-'}; console errors ${consoleErrors.length}; failed ${failed.length}`)
console.log(JSON.stringify(summary.byRoute))
if (hidden) console.log('hidden:', JSON.stringify(hidden.byRoute), 'visible-again:', JSON.stringify(summary.afterVisibleAgain))
