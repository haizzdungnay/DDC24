import { expect, test, type Page } from '@playwright/test'
import { login } from './helpers/session'

/**
 * Chốt bằng trình duyệt thật những gì review FE 2026-08-05 đã tìm ra và sửa —
 * `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md`.
 *
 * Vì sao phải là E2E chứ không phải jsdom: cả ba nhóm khẳng định dưới đây từng
 * lọt qua một suite unit 306/306 xanh. Test unit render component THẲNG, không đi
 * qua router và không đi qua `ModbusRtuLayout`, nên H1 lặp và ba tab trùng nội
 * dung là vô hình với chúng.
 *
 * `playwright.config.ts` chạy webServer ở `VITE_DDC_MODE=live` + `VITE_AUTH_MODE=mock`
 * và KHÔNG dựng backend, nên mọi endpoint trả 502. Đó chính là fixture cần cho
 * nhóm FE-DATA: một trang chỉ "đúng" khi nó nói ra là không đọc được.
 */

/* Điều hướng phía client. KHÔNG dùng `page.goto`: phiên đăng nhập chỉ nằm trong
 * React state (lựa chọn an ninh có chủ ý, record 2026-08-01 §4ter.2), nên mọi lần
 * tải lại trang đều rơi về `/login`. */
async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

const MODBUS_TABS = [
  { path: '/eng/modbus-rtu', tab: 'Tổng quan', heading: 'Modbus RTU · Tổng quan' },
  { path: '/eng/modbus-rtu/overview', tab: 'Tổng quan', heading: 'Modbus RTU · Tổng quan' },
  { path: '/eng/modbus-rtu/devices', tab: 'Thiết bị', heading: 'Modbus RTU · Quản lý Thiết bị (Devices)' },
  { path: '/eng/modbus-rtu/points', tab: 'Points', heading: 'Modbus RTU · Quản lý Point' },
  { path: '/eng/modbus-rtu/diagnostics', tab: 'Diagnostics', heading: 'Modbus RTU · Diagnostics' }
]

/* Mỗi trang đọc dữ liệu phải NÓI RA là không đọc được, chứ không im lặng hiện
 * bảng rỗng hay — tệ hơn — số đo bịa (FE-DATA-01/02). */
/* Mỗi mục khai CẢ HAI ngôn ngữ và so bằng regex.
 *
 * Vì sao không seed `mkddc-lang`: spec này cố ý pha hai thứ tiếng — phần Modbus
 * bám chuỗi tiếng Việt thật của trang (`Lọc theo trạng thái`, `Bỏ lọc`), còn
 * phần FE-DATA trước đây bám tiếng Anh. Ghim một ngôn ngữ ở `beforeEach` sẽ làm
 * đổ nửa còn lại. Khớp hai chiều cũng bền hơn: đổi `locale` trong
 * `playwright.config.ts` sau này không làm cả bộ đỏ.
 *
 * Nguyên nhân gốc của đợt hỏng này: từ khi config khai `locale: 'vi-VN'` (theo
 * BUG-001 — `I18nProvider` đọc `navigator.language` thay vì hard-code 'vi'),
 * giao diện render tiếng Việt trong khi bảng dưới đây chỉ có tiếng Anh. Không
 * cổng CI nào chạy bộ này nên nó đỏ âm thầm — đúng kịch bản `F-07`. */
const ERROR_STATE_PAGES = [
  /* PA3: Landing nay đọc read model `/overview` chứ không tự ghép ba endpoint,
     nên thông điệp lỗi cũng đổi theo nguồn thật của nó. */
  { path: '/', title: /Không đọc được tổng quan hệ thống|System overview unavailable/ },
  { path: '/monitor', title: /Không tải được điểm I\/O|Could not load I\/O points/ },
  { path: '/alarms', title: /Không tải được cảnh báo|Could not load alarms/ },
  { path: '/settings/users', title: /Không tải được danh sách người dùng|Could not load users/ },
  { path: '/settings/network', title: /Không tải được cấu hình mạng|Could not load network settings/ },
  { path: '/settings/time', title: /Không tải được cấu hình thời gian|Could not load time settings/ },
  { path: '/settings/device', title: /Không tải được cấu hình thiết bị|Could not load device configuration/ },
  { path: '/eng/commissioning', title: /Không tải được danh sách output|Could not load outputs/ },
  { path: '/eng/inputs', title: /Không tải được cấu hình ngõ vào|Could not load input configuration/ },
  { path: '/eng/outputs', title: /Không tải được cấu hình ngõ ra|Could not load output configuration/ },
  { path: '/eng/virtual-points', title: /Không tải được danh sách Virtual Point|Could not load virtual points/ },
  /* Các trang Scheduler v3.1 ship chuỗi tiếng Việt viết thẳng, không qua i18n
     (xem `SchedulerGridPage.tsx`), nên khẳng định tiếng Anh ở đây chưa bao giờ
     đúng — bài test này vàng giả từ lúc viết. Bám vào chuỗi THẬT của trang. */
  { path: '/eng/scheduler', title: /Không tải được danh sách lịch/ },
  { path: '/eng/alarm-settings', title: /Không tải được cấu hình cảnh báo|Could not load alarm settings/ }
]

const ALL_ROUTES = [
  '/', '/monitor', '/alarms', '/alarms/history', '/trends', '/me', '/help',
  '/settings/display', '/settings/users', '/settings/network', '/settings/time', '/settings/device',
  '/eng/scheduler', '/eng/commissioning', '/eng/programming', '/eng/inputs', '/eng/outputs',
  '/eng/virtual-points', ...MODBUS_TABS.map((entry) => entry.path),
  '/eng/user-parameters', '/eng/diagram', '/eng/aux', '/eng/alarm-settings',
  '/diagnostics'
]

test.describe('Sức khoẻ trang FE (review 2026-08-05)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /* FE-MB-02: `ModbusRtuLayout` và `ModbusRtuPage` từng cùng render `<h1>`, nên
   * ba tab con hiện hai tiêu đề chồng nhau. */
  test('mỗi tab Modbus RTU chỉ có đúng một H1', async ({ page }) => {
    for (const { path } of MODBUS_TABS) {
      await navigate(page, path)
      await expect(page.locator('h1'), `H1 tại ${path}`).toHaveCount(1)
      await expect(page.locator('h1')).toHaveText('Modbus RTU Management')
    }
  })

  /* FE-MB-01: ba route `devices`/`points`/`diagnostics` từng cùng trỏ về
   * `ModbusRtuPage`, nên bấm tab thì giao diện đứng yên. */
  test('mỗi tab Modbus RTU render nội dung riêng và tự đánh dấu đang mở', async ({ page }) => {
    for (const { path, tab, heading } of MODBUS_TABS) {
      await navigate(page, path)
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
      /* Phải bám vào đúng thanh tab của feature: `NavRail` cũng gắn
       * `aria-current` cho mục menu đang mở, và `getByRole(..., { current })`
       * không phải tuỳ chọn Playwright hiểu được. */
      const current = page.locator('nav[aria-label="Modbus RTU Sections"] a[aria-current="page"]')
      await expect(current, `tab active tại ${path}`).toHaveCount(1)
      await expect(current).toHaveText(tab)
    }
  })

  /* FE-MB-04: KPI card "Offline" ở Overview deep link kèm `?status=OFFLINE`;
   * trang đích cũ không đọc `location.search` nên bộ lọc không có tác dụng. */
  test('deep link ?status= tới tab Thiết bị được trang đích nhận', async ({ page }) => {
    await navigate(page, '/eng/modbus-rtu/devices?status=OFFLINE')
    /* Chuỗi cũ 'Đang lọc: OFFLINE' không còn tồn tại trong source sau lần dựng
       lại trang theo MBR-B301; bài test giữ nguyên nên nó fail dù tính năng vẫn
       chạy. Điều CẦN chứng minh vẫn là điều FE-MB-04 nói: trang đích đọc
       `location.search`, áp bộ lọc, và bày ra cách bỏ lọc. */
    await expect(page.getByLabel('Lọc theo trạng thái')).toHaveValue('OFFLINE')
    await expect(page.getByRole('button', { name: 'Bỏ lọc' })).toBeVisible()
  })

  /* FE-DATA-01/02: nặng nhất là `/monitor` — nó từng khẳng định
   * "0 điểm / 0% FAULT / 100% NORMAL" trong khi mọi endpoint trả 502. */
  test('trang đọc dữ liệu báo lỗi khi authority không trả lời', async ({ page }) => {
    for (const { path, title } of ERROR_STATE_PAGES) {
      await navigate(page, path)
      await expect(page.getByText(title), `trạng thái lỗi tại ${path}`).toBeVisible()
      await expect(page.getByRole('button', { name: /retry|thử lại/i }).first()).toBeVisible()
    }
  })

  /* FE-DIAG-01: `/eng/diagram` không có guard lỗi nên nó vẫn vẽ sơ đồ khi
   * authority chết — và trước bản sửa, sơ đồ đó lấp chỗ trống bằng số của
   * simulator ("29 I/O | 5 Modbus | 2 WARN", BACnet 192.168.1.100). */
  test('/eng/diagram không mượn số của simulator khi authority không trả point', async ({ page }) => {
    await navigate(page, '/eng/diagram')
    const diagram = page.getByRole('img', { name: /front-panel I\/O diagram/i })
    await expect(diagram).toContainText('0 I/O')
    await expect(diagram).toContainText('— Modbus')
    await expect(diagram).toContainText('— WARN | — FAULT')
    await expect(diagram).not.toContainText('192.168.1.100')
    await expect(page.getByText(/chưa trả điểm I\/O nào|returned no I\/O points/i)).toBeVisible()
  })

  test('/monitor không khẳng định 100% bình thường khi không đọc được điểm nào', async ({ page }) => {
    await navigate(page, '/monitor')
    const main = page.locator('main').first()
    await expect(main).not.toContainText('100%')
    await expect(main).not.toContainText('Normal UI/AO points')
  })

  /* Lưới an toàn cuối: không route nào được ném lỗi JS chưa bắt. */
  test('không route nào phát sinh lỗi JavaScript chưa bắt', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(`${error.message}`))

    for (const path of ALL_ROUTES) {
      await navigate(page, path)
    }
    expect(pageErrors, 'pageerror trên toàn bộ route').toEqual([])
  })
})
