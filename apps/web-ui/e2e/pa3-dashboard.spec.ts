import { expect, test, type Page } from '@playwright/test'

/**
 * Nghiệm thu PA3 trên trình duyệt thật — PA3-602.
 *
 * `playwright.config.ts` chạy webServer ở `VITE_DDC_MODE=live` +
 * `VITE_AUTH_MODE=mock` và KHÔNG dựng backend. Nghĩa là mọi endpoint trả 502 —
 * đúng fixture cần cho phần lớn khẳng định ở đây: một Landing chỉ ĐÚNG khi nó
 * nói ra là không đọc được, thay vì vẽ một màn hình trông bình thường.
 *
 * Các đường có dữ liệu thật được phủ bằng `page.route()` để nạp một snapshot
 * `/overview` cố định, nên khẳng định về bố cục không phụ thuộc vào bo.
 */

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

const overviewFixture = {
  schemaVersion: 1,
  generatedAt: '2026-08-08T03:00:05Z',
  controller: { deviceName: 'DDC24-TANG-1', location: 'Panel B2', firmware: '1.0', webVersion: 'e2e', ip: '10.0.0.9', mac: 'AA:BB:CC:DD:EE:FF', systemTime: '2026-08-08T10:00:05+07:00', uptimeS: 4200 },
  connected: true,
  lastDataAt: '2026-08-08T03:00:00Z',
  overallState: 'degraded',
  overallReasonCode: 'high_alarm_active',
  alarms: { critical: 0, high: 1, medium: 1, low: 0, info: 0, unacked: 1, total: 2 },
  points: {
    total: 4, good: 3, uncertain: 0, bad: 0, stale: 0, offline: 1, forced: 1,
    groups: [
      { kind: 'UI', total: 3, good: 2, uncertain: 0, bad: 0, stale: 0, offline: 1, forced: 0 },
      { kind: 'AO', total: 1, good: 1, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 1 }
    ]
  },
  health: [
    { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-08T03:00:05Z', link: '/diagnostics' },
    { domain: 'local_io', state: 'degraded', reasonCode: 'stale_points', source: 'plc_shm', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'modbus', state: 'unknown', reasonCode: 'not_configured', source: 'iobus_telemetry', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'network', state: 'good', reasonCode: 'ok', source: 'kernel_interfaces', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'historian', state: 'unknown', reasonCode: 'no_logged_points', source: 'historian_policy', observedAt: '2026-08-08T03:00:05Z' }
  ],
  attention: [
    { id: 'alarm:A1', severity: 'high', category: 'alarm', title: 'Pump-02 communication failure', detail: 'Bus 1 · Slave 12', targetType: 'alarm', targetId: 'A1', observedAt: '2026-08-08T03:00:00Z' }
  ],
  capabilities: { digitalInputs: 0, universalInputs: 16, analogOutputs: 4, digitalOutputs: 4, modbusRtuBuses: 0, bacnetIpEnabled: false },
  degraded: []
}

async function stubOverview(page: Page) {
  await page.route('**/api/v1/overview', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overviewFixture) })
  })
  await page.route('**/api/v1/activity*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, generatedAt: '2026-08-08T03:00:05Z', items: [], nextCursor: null, retained: 0, capacity: 2000 })
    })
  })
}

test.describe('Landing PA3 — desktop 1440×900', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await stubOverview(page)
    await login(page)
  })

  /* Gate G4: trong 10 giây Operator phải trả lời được "có vấn đề gì, ở đâu,
     làm gì tiếp" — nên trạng thái tổng và Attention phải nằm TRÊN nếp gấp. */
  test('trạng thái tổng và mục cần xử lý nằm trong vùng nhìn đầu tiên', async ({ page }) => {
    await navigate(page, '/')
    const header = page.getByRole('heading', { name: 'DDC24-TANG-1' })
    await expect(header).toBeVisible()

    const attention = page.getByRole('heading', { name: /CẦN XỬ LÝ|ATTENTION/ })
    await expect(attention).toBeVisible()
    const box = await attention.boundingBox()
    expect(box, 'Attention phải render').not.toBeNull()
    expect(box!.y, 'Attention phải nằm trên nếp gấp 900px').toBeLessThan(900)
  })

  /* UX-DES §4.2 + PA3-F01/F02: Landing không còn là màn debug. */
  test('Landing không chứa CPU/RAM/service/RS485-2', async ({ page }) => {
    await navigate(page, '/')
    const main = page.locator('main').first()
    await expect(main).not.toContainText('RS485-2')
    await expect(main).not.toContainText('CPU LOAD')
    await expect(main).not.toContainText('IOP / SCAN METRICS')
    await expect(main.getByRole('heading', { name: 'SERVICES' })).toHaveCount(0)
  })

  /* PA3-206/F13: các số đo đó không bị xoá, chúng chuyển sang Diagnostics. */
  test('Diagnostics nhận toàn bộ số đo đã rời khỏi Landing', async ({ page }) => {
    await navigate(page, '/diagnostics')
    const main = page.locator('main').first()
    await expect(main.getByRole('heading', { name: /Chẩn đoán|Diagnostics/ })).toBeVisible()
    await expect(main).toContainText('CPU')
    await expect(main).toContainText('UPTIME')
    // Nhưng vẫn KHÔNG được dựng cổng RS-485 thứ hai không có thật.
    await expect(main).not.toContainText('RS485-2')
  })

  /* PA3-D06: mỗi mục cần xử lý phải dẫn về đúng đối tượng gây ra nó. */
  test('mục cần xử lý drill-down về đúng đối tượng', async ({ page }) => {
    await navigate(page, '/')
    const link = page.getByRole('link', { name: /Xem chi tiết|Investigate/ }).first()
    await expect(link).toHaveAttribute('href', '/alarms?alarm=A1')
  })

  /* §7: base SKU Rev A không có DI riêng — không được có hàng DI. */
  test('Operating Summary không dựng hàng DI', async ({ page }) => {
    await navigate(page, '/')
    const main = page.locator('main').first()
    await expect(main.getByRole('link', { name: 'UI', exact: true })).toBeVisible()
    await expect(main.getByRole('link', { name: 'DI', exact: true })).toHaveCount(0)
  })

  /* Guardrail §10.3: backend nói một schema lạ ⇒ UI fail closed, không đoán. */
  test('fail closed khi thiết bị trả schemaVersion không tương thích', async ({ page }) => {
    await page.route('**/api/v1/overview', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...overviewFixture, schemaVersion: 99 }) })
    })
    await navigate(page, '/')
    await expect(page.getByText(/lệch phiên bản dữ liệu|data versions do not match/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'DDC24-TANG-1' })).toHaveCount(0)
  })
})

test.describe('Landing PA3 — mobile 390×844', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stubOverview(page)
    await login(page)
  })

  /* §20: trên di động ưu tiên Dashboard/Alarm/Monitor, và tuyệt đối không được
     có bẫy cuộn ngang — người dùng cầm điện thoại ngay tại tủ. */
  test('không có cuộn ngang và điều hướng vẫn tới được', async ({ page }) => {
    await navigate(page, '/')
    await expect(page.getByRole('heading', { name: 'DDC24-TANG-1' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'trang không được cuộn ngang').toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: /Mở điều hướng|Open navigation/ }).click()
    await expect(page.getByRole('dialog', { name: /Điều hướng|Navigation/ })).toBeVisible()
  })
})

test.describe('Inputs — live mobile không dựng dữ liệu', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/v1/system/config/io', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ui: [{ ch: 1, tag: 'UI-01', name: 'Kênh không có telemetry', type: '0-10V', unit: 'degC', scale_lo: 0, scale_hi: 100, enabled: true }],
          ao: [],
          do: []
        })
      })
    })
    await page.route('**/api/v1/points', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/virtual-points', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await login(page)
  })

  test('không mượn điểm demo và không cuộn ngang ở 390 px', async ({ page }) => {
    await navigate(page, '/eng/inputs')
    await expect(page.getByRole('heading', { name: 'Live Data' })).toBeVisible()
    await expect(page.getByText('No live data for this channel yet.')).toBeVisible()
    await expect(page.getByText('23.7 C')).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'trang Inputs không được cuộn ngang').toBeLessThanOrEqual(1)
  })
})

/* Vai trò KHÔNG được nghiệm thu ở tầng này: `VITE_AUTH_MODE=mock` cấp cho mọi
 * lần đăng nhập một phiên `role:'admin'` (AuthProvider.tsx), nên một bài test
 * "viewer bị khoá nút" ở đây sẽ xanh mà không chứng minh được gì.
 *
 * Ma trận quyền được chốt ở tầng unit — `RequireRole.test.tsx` (bảng
 * `ROUTE_MIN_ROLE` khớp backend) và `MonitorPage`/`AlarmRow` (nút disable kèm
 * lý do) — cộng với test authorization phía Go (`TestViewerCannotOverride`),
 * nơi role là thật. */

const monitorPointsFixture = [
  { id: 'UI-01', tag: 'UI-01', name: 'Nhiệt độ phòng', kind: 'UI', value: 23.6, unit: '°C', quality: 'good', source: 'local_physical_io', updatedAt: '2026-08-08T03:00:00Z' },
  { id: 'AO-01', tag: 'AO-01', name: 'Van cấp', kind: 'AO', value: 42, unit: '%', quality: 'good', source: 'local_physical_io', updatedAt: '2026-08-08T03:00:00Z', forced: true, overrideExpiresInS: 272 }
]

test.describe('Monitor PA3 — bối cảnh nằm trong URL', () => {
  test.beforeEach(async ({ page }) => {
    await stubOverview(page)
    // Bộ lọc chỉ render khi trang đọc được điểm; không có fixture thì trang
    // đúng ra phải hiện trạng thái lỗi, và bài test này sẽ đo nhầm thứ khác.
    await page.route('**/api/v1/points', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(monitorPointsFixture) })
    })
    await page.route('**/api/v1/virtual-points', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await login(page)
  })

  /* PA3-402: refresh/back phải giữ được bộ lọc, và Attention trên Landing cần
     một đường dẫn có ngữ cảnh để trỏ tới. */
  test('bộ lọc Monitor được ghi vào query string', async ({ page }) => {
    await navigate(page, '/monitor')
    await page.getByLabel(/Lọc theo trạng thái vận hành|Filter by operating state/).selectOption('forced')
    await expect.poll(() => new URL(page.url()).searchParams.get('state')).toBe('forced')

    await page.getByLabel(/Lọc theo chất lượng|Filter by quality/).selectOption('offline')
    await expect.poll(() => new URL(page.url()).searchParams.get('quality')).toBe('offline')
  })
})

/* ── PA3-204 / PA3-406 / PA3-408 (phần giao diện) ─────────────────────────── */

test.describe('Điều hướng và audit PA3', () => {
  test.beforeEach(async ({ page }) => {
    await stubOverview(page)
    await login(page)
  })

  /* PA3-204: command palette phải mở bằng bàn phím và đi tới được — nó là
     đường tắt cho người làm commissioning đi tới lui hàng chục lần một ca. */
  test('command palette mở bằng Ctrl+K và điều hướng được', async ({ page }) => {
    await navigate(page, '/')
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: /Tìm nhanh trang|Quick navigation/ })
    await expect(palette).toBeVisible()

    // Gõ KHÔNG DẤU vẫn phải ra kết quả có dấu.
    await palette.getByRole('textbox').fill('chan doan')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: /Chẩn đoán|Diagnostics/ })).toBeVisible()
  })

  test('Escape đóng command palette', async ({ page }) => {
    await navigate(page, '/')
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: /Tìm nhanh trang|Quick navigation/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /Tìm nhanh trang|Quick navigation/ })).toHaveCount(0)
  })

  /* PA3-204: breadcrumb chỉ hiện với trang có chiều sâu, và phải quay lại được
     một bậc. */
  test('breadcrumb hiện đúng đường đi trên trang có chiều sâu', async ({ page }) => {
    await navigate(page, '/settings/network')
    const crumbs = page.getByRole('navigation', { name: /Đường dẫn|Breadcrumb/ })
    await expect(crumbs).toBeVisible()
    // Ngôn ngữ của phiên e2e phụ thuộc localStorage nên chấp nhận cả hai.
    await expect(crumbs).toContainText(/Mạng|Network/)

    // Trang cấp một không cần breadcrumb — thanh bên đã đủ.
    await navigate(page, '/monitor')
    await expect(page.getByRole('navigation', { name: /Đường dẫn|Breadcrumb/ })).toHaveCount(0)
  })

  /* PA3-202 / WCAG 2.4.1: skip link phải là điểm dừng Tab ĐẦU TIÊN. */
  test('skip link hiện ra khi Tab lần đầu', async ({ page }) => {
    await navigate(page, '/')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: /Bỏ qua điều hướng|Skip navigation/ })
    await expect(skip).toBeFocused()
  })

  /* PA3-406: trang audit đọc được và giữ bộ lọc trong URL. */
  test('trang nhật ký hoạt động lọc theo đối tượng qua URL', async ({ page }) => {
    await page.route('**/api/v1/activity*', async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 1,
          generatedAt: '2026-08-08T03:00:05Z',
          items: [{
            id: 7, time: '2026-08-08T03:00:00Z', kind: 'user', actor: 'op1', role: 'operator',
            action: 'point_override', objectType: 'point', objectId: url.searchParams.get('objectId') ?? 'AO-01',
            outcome: 'accepted', reasonCode: 'core_ttl', detail: 'ttlS=180 remainingS=180'
          }],
          nextCursor: null, retained: 1, capacity: 2000
        })
      })
    })
    await navigate(page, '/activity?objectId=AO-01')
    await expect(page.getByRole('heading', { name: /Nhật ký hoạt động|Activity log/ })).toBeVisible()
    await expect(page.getByLabel(/Lọc theo đối tượng|Filter by object/)).toHaveValue('AO-01')
    await expect(page.getByText('ttlS=180 remainingS=180')).toBeVisible()
  })
})

/* PA3-408 (phần giao diện): đồng hồ đếm ngược phải đến TỪ backend.
 *
 * Phần cưỡng chế TTL được nghiệm thu ở tầng Go (`TestOverrideSurvivesWebAPIRestart`,
 * `TestOverrideExpiryFromCoreClearsWebState`) và trên bo thật; ở đây chỉ chốt
 * một điều mà chỉ trình duyệt chứng minh được: giao diện HIỂN THỊ con số của
 * backend chứ không tự đếm một con số của riêng nó. */
test.describe('Hiển thị đếm ngược override', () => {
  test('Monitor hiện thời gian còn lại do backend cấp', async ({ page }) => {
    await stubOverview(page)
    await page.route('**/api/v1/points', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'AO-01', tag: 'AO-01', name: 'Van cấp', kind: 'AO', value: 42, unit: '%',
          quality: 'good', source: 'core', priority: 'manual', updatedAt: '2026-08-08T03:00:00Z',
          forced: true, overrideExpiresInS: 272
        }])
      })
    })
    await page.route('**/api/v1/virtual-points', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await login(page)
    await navigate(page, '/monitor?point=AO-01')
    // 272 giây = 04:32 — đúng con số backend trả, không phải đồng hồ của FE.
    await expect(page.getByText(/ÉP TAY · 04:32/)).toBeVisible()
  })
})
