import { test, type ConsoleMessage, type Page, type Request } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Soi lỗi giao diện TỪNG TRANG trên board thật.
 *
 * Khác `board-ux.spec.ts` (khẳng định vài hành vi cụ thể), spec này là một bộ
 * **thu thập bằng chứng**: nó đi qua mọi route, ghi lại console error, exception
 * chưa bắt, request hỏng, và những gì thật sự render ra — rồi xuất một file JSON
 * để dựng báo cáo. Nó KHÔNG fail khi tìm thấy lỗi; mục đích là liệt kê đủ, không
 * phải dừng ở lỗi đầu tiên.
 *
 * Chạy hai chế độ điều hướng cho mỗi trang, vì hai chế độ hỏng theo hai kiểu:
 *
 *  - `deeplink`  — gõ thẳng URL / F5, đúng thứ người dùng làm khi gửi link cho
 *    nhau. Phiên chỉ nằm trong React state nên đây phải rơi về `/login`.
 *  - `in-app`    — điều hướng bằng history.pushState sau khi đã đăng nhập, tức
 *    luồng bình thường của SPA.
 */

const BASE = process.env.BOARD_URL || 'http://127.0.0.1:18081'
const ADMIN_USER = process.env.BOARD_ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.BOARD_ADMIN_PASS || 'admin123'
const OUT = process.env.AUDIT_OUT || '/tmp/board-page-audit.json'

interface PageFinding {
  route: string
  label: string
  mode: 'deeplink' | 'in-app'
  finalUrl: string
  headings: string[]
  visibleTextLength: number
  bodyEmpty: boolean
  alerts: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  pageErrors: string[]
  failedRequests: string[]
  httpErrors: string[]
}

const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'Dashboard' },
  { path: '/monitor', label: 'Giám sát' },
  { path: '/trends', label: 'Trends' },
  { path: '/alarms', label: 'Cảnh báo' },
  { path: '/eng/modbus-rtu', label: 'Modbus RTU · Tổng quan' },
  { path: '/eng/modbus-rtu/overview', label: 'Modbus RTU · Tổng quan (alias)' },
  { path: '/eng/modbus-rtu/devices', label: 'Modbus RTU · Thiết bị' },
  { path: '/eng/modbus-rtu/points', label: 'Modbus RTU · Points' },
  { path: '/eng/modbus-rtu/mapping', label: 'Modbus RTU · Mapping' },
  { path: '/eng/modbus-rtu/diagnostics', label: 'Modbus RTU · Diagnostics' },
  { path: '/eng/inputs', label: 'Ngõ vào' },
  { path: '/eng/outputs', label: 'Ngõ ra' },
  { path: '/eng/virtual-points', label: 'Điểm ảo' },
  { path: '/eng/scheduler', label: 'Lịch vận hành' },
  { path: '/eng/alarm-settings', label: 'Cấu hình cảnh báo' },
  { path: '/eng/commissioning', label: 'Commissioning' },
  { path: '/eng/user-parameters', label: 'Tham số người dùng' },
  { path: '/eng/diagram', label: 'Sơ đồ' },
  { path: '/eng/aux', label: 'Chức năng phụ' },
  { path: '/settings/users', label: 'Người dùng' },
  { path: '/settings/network', label: 'Mạng' },
  { path: '/settings/system', label: 'Hệ thống' },
  { path: '/settings/historian', label: 'Historian' }
]

const findings: PageFinding[] = []

/** Gắn bộ thu thập vào page; trả về hàm lấy dữ liệu đã gom và reset. */
function attachCollectors(page: Page) {
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const httpErrors: string[] = []

  const onConsole = (msg: ConsoleMessage) => {
    const text = msg.text()
    if (msg.type() === 'error') consoleErrors.push(text)
    else if (msg.type() === 'warning') consoleWarnings.push(text)
  }
  const onPageError = (err: Error) => pageErrors.push(`${err.name}: ${err.message}`)
  const onRequestFailed = (req: Request) =>
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`)
  const onResponse = (res: { status: () => number; url: () => string; request: () => Request }) => {
    const status = res.status()
    // 401 ở /auth/me là bình thường trước khi đăng nhập; chỉ ghi lỗi thật.
    if (status >= 400 && !(status === 401 && res.url().includes('/auth/'))) {
      httpErrors.push(`${status} ${res.request().method()} ${res.url()}`)
    }
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('requestfailed', onRequestFailed)
  page.on('response', onResponse)

  return {
    drain() {
      const snapshot = {
        consoleErrors: [...consoleErrors],
        consoleWarnings: [...consoleWarnings],
        pageErrors: [...pageErrors],
        failedRequests: [...failedRequests],
        httpErrors: [...httpErrors]
      }
      consoleErrors.length = 0
      consoleWarnings.length = 0
      pageErrors.length = 0
      failedRequests.length = 0
      httpErrors.length = 0
      return snapshot
    },
    detach() {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      page.off('requestfailed', onRequestFailed)
      page.off('response', onResponse)
    }
  }
}

async function inspect(page: Page, route: string, label: string,
                      mode: 'deeplink' | 'in-app',
                      drained: ReturnType<ReturnType<typeof attachCollectors>['drain']>) {
  const headings = await page.locator('h1, h2').allInnerTexts().catch(() => [] as string[])
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const alerts = await page.getByRole('alert').allInnerTexts().catch(() => [] as string[])

  findings.push({
    route,
    label,
    mode,
    finalUrl: new URL(page.url()).pathname,
    headings: headings.map((h) => h.trim()).filter(Boolean).slice(0, 6),
    visibleTextLength: bodyText.trim().length,
    bodyEmpty: bodyText.trim().length < 40,
    alerts: alerts.map((a) => a.trim().slice(0, 200)),
    ...drained
  })
}

test.describe.configure({ mode: 'serial' })

test('audit: mở thẳng URL (deeplink) từng trang', async ({ page }) => {
  test.setTimeout(300_000)
  const collectors = attachCollectors(page)

  for (const { path, label } of ROUTES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.waitForTimeout(1200)
    await inspect(page, path, label, 'deeplink', collectors.drain())
  }
  collectors.detach()
})

test('audit: điều hướng trong ứng dụng sau khi đăng nhập', async ({ page }) => {
  test.setTimeout(420_000)
  const collectors = attachCollectors(page)

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/Tên đăng nhập|Username/i).fill(ADMIN_USER)
  await page.getByLabel(/^Mật khẩu$|^Password$/i).first().fill(ADMIN_PASS)
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  collectors.drain() // bỏ nhiễu của bước đăng nhập

  for (const { path, label } of ROUTES) {
    await page.evaluate((target) => {
      window.history.pushState({}, '', target)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
    /* KHÔNG dùng `networkidle`: ứng dụng tự làm mới 5 s một lần và giữ WebSocket
     * giám sát, nên mạng không bao giờ "idle" và mỗi trang sẽ chờ tới hết
     * timeout. Chờ một khoảng cố định đủ để React commit và fetch đầu tiên xong. */
    await page.waitForTimeout(2500)
    await inspect(page, path, label, 'in-app', collectors.drain())
    await page.screenshot({
      path: join('/tmp/board-audit-shots', `${path.replace(/\//g, '_') || '_root'}.png`),
      fullPage: false
    }).catch(() => undefined)
  }
  collectors.detach()
})

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(findings, null, 2), 'utf8')
  console.log(`\n[audit] đã ghi ${findings.length} bản ghi vào ${OUT}`)
})
