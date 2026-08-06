import { expect, test, type Page } from '@playwright/test'

const pointIds = ['UI-01', 'AO-01', 'DO-01', 'VP1'] as const

const points = [
  point('UI-01', 'UI', 'Room temperature', 22.4, 'C'),
  point('AO-01', 'AO', 'Supply fan command', 65, '%'),
  point('DO-01', 'DO', 'Enable relay', true),
  point('VP1', 'virtual', 'Calculated enable', true)
]

const virtualPoints = [{
  id: 'VP1',
  tag: 'calculated_enable',
  label: 'Calculated enable',
  signalType: 'boolean',
  enabled: true,
  writable: false,
  logEnabled: true,
  logIntervalMs: 15_000,
  value: true,
  updatedAt: '2026-07-22T04:30:00.000Z'
}]

test('routes every preset to cache and Custom to database for UI/AO/DO/VP', async ({ page }) => {
  const requests = await openTrends(page)

  await expect.poll(() => requests.some((url) => url.searchParams.get('source') === 'cache')).toBe(true)
  await expect(page.getByRole('alert')).toContainText('History is partial')
  await expect(page.getByRole('alert')).toContainText('1 history gaps reported')

  const addTrend = page.getByRole('button', { name: 'Add trend' })
  await addTrend.click()
  const dialog = page.getByRole('dialog', { name: 'Add trend' })
  await expect(dialog.getByPlaceholder('Search by ID or name...')).toBeFocused()
  for (const name of ['UI-01', 'AO-01', 'DO-01', 'calculated_enable']) {
    await dialog.getByRole('checkbox', { name: new RegExp(name) }).check()
  }

  let requestCount = requests.length
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expectNewHistory(page, requests, requestCount, (url) => hasAllPoints(url) && url.searchParams.get('source') === 'cache')

  const historyTable = page.getByRole('table', { name: 'Historical trend data' })
  for (const heading of ['UI-01 - Room temperature', 'AO-01 - Supply fan command', 'DO-01 - Enable relay', 'calculated_enable']) {
    await expect(historyTable.getByText(heading, { exact: true }).first()).toBeVisible()
  }
  await expect(historyTable.getByText(/GOOD.*cache/).first()).toBeVisible()
  await expect(historyTable.getByText(/GOOD.*live/).first()).toBeVisible()
  const firstLiveTime = await historyTable.locator('tbody tr').last().locator('th').textContent()
  await expect.poll(async () => historyTable.locator('tbody tr').last().locator('th').textContent(), { timeout: 4_000 }).not.toBe(firstLiveTime)

  for (const label of ['1 hour', '6 hours', '24 hours']) {
    requestCount = requests.length
    await page.getByRole('button', { name: label, exact: true }).click()
    await expectNewHistory(page, requests, requestCount, (url) => hasAllPoints(url) && url.searchParams.get('source') === 'cache')
  }

  /* Nhãn đã đổi từ "From (UTC)" sang "From (local time <TZ>)" ở b67580c
   * ("bộ chọn khoảng Trends dùng đúng giờ địa phương như nhãn đã hứa") nhưng spec
   * này không được cập nhật theo, nên nó đỏ âm thầm từ đó: `npm test` chỉ quét
   * `src/`, KHÔNG chạy `e2e/`. Khớp bằng regex để không phụ thuộc múi giờ của máy
   * chạy test — hằng "Asia/Saigon" sẽ hỏng ngay trên runner CI đặt UTC. */
  await page.getByLabel(/^From \(local time/).fill('2026-07-21T00:00')
  await page.getByLabel(/^To \(local time/).fill('2026-07-21T01:00')
  requestCount = requests.length
  await page.getByRole('button', { name: 'Apply custom' }).click()
  await expectNewHistory(page, requests, requestCount, (url) => hasAllPoints(url) && url.searchParams.get('source') === 'database')
  await expect(page.getByRole('status').filter({ hasText: 'History complete' })).toBeVisible()
  await expect(historyTable.getByText(/GOOD.*hot/).first()).toBeVisible()
  await expect(historyTable.getByText(/GOOD.*live/)).toHaveCount(0)

  requestCount = requests.length
  await page.getByRole('button', { name: 'Auto', exact: true }).click()
  await expectNewHistory(page, requests, requestCount, (url) => url.searchParams.get('source') === 'cache')
})

test('keeps the picker keyboard-contained, restores focus, and fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openTrends(page)

  const addTrend = page.getByRole('button', { name: 'Add trend' })
  await addTrend.click()
  const dialog = page.getByRole('dialog', { name: 'Add trend' })
  await expect(dialog.getByPlaceholder('Search by ID or name...')).toBeFocused()

  const apply = dialog.getByRole('button', { name: 'Apply' })
  await apply.focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(apply).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(addTrend).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

async function openTrends(page: Page): Promise<URL[]> {
  const requests: URL[] = []
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/points') return json(route, points)
    if (url.pathname === '/api/v1/virtual-points') return json(route, virtualPoints)
    if (url.pathname === '/api/v1/history') {
      requests.push(url)
      return json(route, historyResponse(url))
    }
    return json(route, [])
  })

  await page.goto('/login')
  await page.getByLabel('Username', { exact: true }).fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('e2e')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const trendsLink = page.getByRole('link', { name: 'Trends' })
  if (await trendsLink.isVisible()) await trendsLink.click()
  else await page.getByRole('button', { name: 'Expand trends' }).click()
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible()
  return requests
}

async function expectNewHistory(page: Page, requests: URL[], fromIndex: number, predicate: (url: URL) => boolean) {
  await expect.poll(() => requests.slice(fromIndex).some(predicate), { timeout: 5_000 }).toBe(true)
}

function hasAllPoints(url: URL): boolean {
  const requested = new Set((url.searchParams.get('point') ?? '').split(','))
  return pointIds.every((pointId) => requested.has(pointId))
}

function historyResponse(url: URL) {
  const from = url.searchParams.get('from') ?? '2026-07-22T04:00:00.000Z'
  const to = url.searchParams.get('to') ?? '2026-07-22T04:30:00.000Z'
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  const source = url.searchParams.get('source') === 'database' ? 'database' : 'cache'
  const tier = source === 'database' ? 'hot' : 'cache'
  const requested = (url.searchParams.get('point') ?? '').split(',').filter(Boolean)
  const sampleTimes = [fromMs + 15_000, fromMs + 30_000]
  const baseValues: Record<string, number[]> = {
    'UI-01': [22.1, 22.4],
    'AO-01': [60, 65],
    'DO-01': [0, 1],
    VP1: [0, 1]
  }
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    complete: source === 'database',
    tiersUsed: [tier],
    series: requested.map((pointId) => ({
      pointId,
      generation: 1,
      effectiveResolution: '15s',
      samples: sampleTimes.map((timeMs, index) => {
        const value = baseValues[pointId]?.[index] ?? index
        return {
          time: new Date(timeMs).toISOString(),
          value,
          min: value,
          max: value,
          sum: value,
          count: 1,
          quality: 'GOOD',
          source: 'runtime',
          tier,
          generation: 1
        }
      })
    })),
    gaps: source === 'cache' && requested.includes('UI-01') ? [{
      pointId: 'UI-01',
      generation: 1,
      fromUtc: new Date(fromMs + 45_000).toISOString(),
      toUtc: new Date(fromMs + 60_000).toISOString(),
      reason: 'snapshot_read_failed'
    }] : []
  }
}

function point(id: string, kind: string, name: string, value: number | boolean, unit?: string) {
  return {
    id,
    tag: id.toLowerCase(),
    name,
    kind,
    value,
    ...(unit ? { unit } : {}),
    quality: 'good',
    source: 'runtime',
    updatedAt: '2026-07-22T04:30:00.000Z'
  }
}

function json(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}
