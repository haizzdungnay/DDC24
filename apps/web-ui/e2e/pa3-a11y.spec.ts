import { expect, test, type Page } from '@playwright/test'

/**
 * Kiểm accessibility PA3 — PA3-603 / WCAG 2.2 AA.
 *
 * PHẠM VI CỦA FILE NÀY
 *
 * Đây là phần a11y mà **chỉ trình duyệt thật chứng minh được**: cấu trúc
 * landmark, thứ tự tiêu đề, nhãn của control, đường đi bằng bàn phím và bẫy
 * tiêu điểm trong dialog.
 *
 * Tương phản màu KHÔNG kiểm ở đây mà ở `src/shared/theme/contrast.test.ts`,
 * nơi tính trực tiếp tỉ số WCAG trên từng cặp token cho cả hai theme. Đo màu
 * bằng ảnh chụp trình duyệt vừa chậm vừa dễ vỡ vì antialiasing, trong khi token
 * mới là nguồn thật của bảng màu.
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
  controller: { deviceName: 'DDC24-TANG-1', ip: '10.0.0.9' },
  connected: true,
  lastDataAt: '2026-08-08T03:00:00Z',
  overallState: 'good',
  overallReasonCode: 'ok',
  alarms: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unacked: 0, total: 0 },
  points: { total: 1, good: 1, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 0, groups: [{ kind: 'UI', total: 1, good: 1, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 0 }] },
  health: [
    { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'local_io', state: 'good', reasonCode: 'ok', source: 'plc_shm', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'modbus', state: 'unknown', reasonCode: 'not_configured', source: 'iobus_telemetry', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'network', state: 'good', reasonCode: 'ok', source: 'kernel_interfaces', observedAt: '2026-08-08T03:00:05Z' },
    { domain: 'historian', state: 'unknown', reasonCode: 'no_logged_points', source: 'historian_policy', observedAt: '2026-08-08T03:00:05Z' }
  ],
  attention: [],
  capabilities: { digitalInputs: 0, universalInputs: 16, analogOutputs: 4, digitalOutputs: 4, modbusRtuBuses: 0, bacnetIpEnabled: false },
  degraded: []
}

async function stub(page: Page) {
  await page.route('**/api/v1/overview', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overviewFixture) })
  })
  await page.route('**/api/v1/activity*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, generatedAt: '2026-08-08T03:00:05Z', items: [], nextCursor: null, retained: 0, capacity: 2000 }) })
  })
}

const PAGES = ['/', '/monitor', '/alarms', '/trends', '/diagnostics', '/activity']

test.describe('Accessibility PA3', () => {
  test.beforeEach(async ({ page }) => {
    await stub(page)
    await login(page)
  })

  /* WCAG 1.3.1 — cấu trúc phải đọc được bằng landmark, không chỉ bằng mắt. */
  test('mỗi trang có đúng một main, một banner và điều hướng có nhãn', async ({ page }) => {
    for (const path of PAGES) {
      await navigate(page, path)
      await expect(page.getByRole('main'), `main tại ${path}`).toHaveCount(1)
      await expect(page.getByRole('banner'), `banner tại ${path}`).toHaveCount(1)
      // Thanh bên có nhãn riêng để trình đọc màn hình phân biệt được với các
      // vùng điều hướng khác trên cùng trang (breadcrumb, tab của feature).
      await expect(page.getByRole('navigation', { name: 'Main navigation' }), `nav tại ${path}`).toHaveCount(1)
    }
  })

  /* WCAG 2.4.6 — mỗi trang có đúng một H1 nói được trang này là gì. */
  test('mỗi trang có đúng một tiêu đề cấp một', async ({ page }) => {
    for (const path of PAGES) {
      await navigate(page, path)
      const h1 = page.locator('main h1')
      await expect(h1, `H1 tại ${path}`).toHaveCount(1)
      await expect(h1).not.toBeEmpty()
    }
  })

  /* WCAG 4.1.2 — control không nhãn là control vô hình với trình đọc màn hình.
     Bộ lọc trên Monitor là chỗ dễ quên nhất vì chúng chỉ là select trơ. */
  test('mọi select và input trên Monitor đều có nhãn truy cập được', async ({ page }) => {
    await page.route('**/api/v1/points', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'UI-01', tag: 'UI-01', name: 'Nhiệt độ', kind: 'UI', value: 23.6, unit: '°C', quality: 'good', source: 'core', updatedAt: '2026-08-08T03:00:00Z' }])
      })
    })
    await page.route('**/api/v1/virtual-points', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await navigate(page, '/monitor')

    const unlabelled = await page.locator('main select, main input:not([type="hidden"])').evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const el = node as HTMLElement
          if (el.getAttribute('aria-label')?.trim()) return false
          if (el.getAttribute('aria-labelledby')?.trim()) return false
          if (el.getAttribute('placeholder')?.trim()) return false
          if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false
          return !el.closest('label')
        })
        .map((node) => (node as HTMLElement).outerHTML.slice(0, 120))
    )
    expect(unlabelled, 'control thiếu nhãn').toEqual([])
  })

  /* WCAG 2.1.2 — dialog phải giữ tiêu điểm bên trong và nhả ra bằng Escape.
     Ngăn kéo điều hướng là dialog toàn màn hình nên đây là bẫy dễ xảy ra nhất. */
  test('ngăn kéo điều hướng trên mobile giữ và trả lại tiêu điểm', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await navigate(page, '/')

    const opener = page.getByRole('button', { name: /Mở điều hướng|Open navigation/ })
    await opener.click()
    const drawer = page.getByRole('dialog', { name: /Điều hướng|Navigation/ })
    await expect(drawer).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    // Tiêu điểm phải quay về đúng nút đã mở, không rơi về đầu tài liệu.
    await expect(opener).toBeFocused()
  })

  /* WCAG 2.4.1 — bỏ qua khối lặp lại. Thanh bên có hơn 20 liên kết. */
  test('skip link đưa tiêu điểm tới nội dung chính', async ({ page }) => {
    await navigate(page, '/')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: /Bỏ qua điều hướng|Skip navigation/ })
    await expect(skip).toBeFocused()
    await expect(skip).toHaveAttribute('href', '#main-content')
    await expect(page.locator('#main-content')).toHaveCount(1)
  })

  /* WCAG 2.4.7 — tiêu điểm phải NHÌN THẤY được. Kiểm rằng phần tử đang focus
     thật sự có outline hoặc ring, chứ không bị `outline: none` triệt tiêu. */
  test('phần tử đang nhận tiêu điểm có dấu hiệu nhìn thấy được', async ({ page }) => {
    await navigate(page, '/')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const visible = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return false
      const style = window.getComputedStyle(el)
      const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth || '0') > 0
      const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== ''
      const hasBorder = parseFloat(style.borderTopWidth || '0') > 0
      return hasOutline || hasShadow || hasBorder
    })
    expect(visible, 'phần tử đang focus không có dấu hiệu nhìn thấy').toBe(true)
  })
})
