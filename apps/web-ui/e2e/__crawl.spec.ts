import { test, expect, type Page } from '@playwright/test'

const ROUTES = [
  '/', '/monitor', '/alarms', '/alarms/history', '/trends', '/me', '/help',
  '/settings/display', '/settings/users', '/settings/network', '/settings/time', '/settings/device',
  '/eng/scheduler', '/eng/commissioning', '/eng/programming', '/eng/inputs', '/eng/outputs',
  '/eng/virtual-points',
  '/eng/modbus-rtu', '/eng/modbus-rtu/overview', '/eng/modbus-rtu/devices',
  '/eng/modbus-rtu/points', '/eng/modbus-rtu/diagnostics',
  '/eng/user-parameters', '/eng/diagram', '/eng/aux', '/eng/alarm-settings'
]

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
}

test.setTimeout(600000)
test('crawl all routes', async ({ page }) => {
  const report: string[] = []
  const bucket: { type: string; text: string }[] = []

  page.on('pageerror', (e) => bucket.push({ type: 'PAGEERROR', text: e.message }))
  page.on('console', (m) => {
    if (m.type() === 'error') bucket.push({ type: 'CONSOLE-ERROR', text: m.text() })
  })

  await login(page)

  for (const route of ROUTES) {
    bucket.length = 0
    await page.evaluate((r) => {
      window.history.pushState({}, '', r)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, route)
    await page.waitForTimeout(1500)
    const h1 = await page.locator('h1').allInnerTexts().catch(() => [])
    const h2 = await page.locator('h2').allInnerTexts().catch(() => [])
    const main = (await page.locator('main').first().innerText().catch(() => '')).trim()
    report.push(`\n===== ${route}  (h1 x${h1.length})`)
    report.push(`  h1: ${JSON.stringify(h1)}`)
    report.push(`  h2: ${JSON.stringify(h2.slice(0, 4))}`)
    report.push(`  main[0..120]: ${JSON.stringify(main.replace(/\s+/g, ' ').slice(0, 120))}`)
    const seen = new Set<string>()
    for (const b of bucket) {
      const key = b.type + b.text.slice(0, 120)
      if (seen.has(key)) continue
      seen.add(key)
      report.push(`  [${b.type}] ${b.text.slice(0, 200)}`)
    }
  }
  console.log(report.join('\n'))
  expect(true).toBe(true)
})
