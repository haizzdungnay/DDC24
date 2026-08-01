import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Kiểm UI/UX trên BOARD THẬT — plan 45 §8.3.
 *
 * Plan yêu cầu `WEB-UX-004`, `WEB-UX-005` và `WEB-UX-009` phải được kiểm "trong
 * trình duyệt trên board, không chỉ jsdom". Lý do không phải hình thức: test
 * jsdom chạy với `apiClient` bị mock, nên chúng chứng minh component xử lý ĐÚNG
 * dữ liệu mà test tự đưa vào — không chứng minh được rằng bundle đã cắt xuống
 * board nói chuyện đúng với `mkddc-web` thật, rằng JWT thật mang đúng role, hay
 * rằng backend thật chặn đúng.
 *
 * Ở đây `baseURL` trỏ thẳng vào `mkddc-web` trên Orange Pi 5B qua SSH tunnel.
 * Không mock gì cả.
 */

const ADMIN_USER = process.env.BOARD_ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.BOARD_ADMIN_PASS || ''
const VIEWER_USER = 'e2e-ux-viewer'
const VIEWER_PASS = 'e2e-ux-viewer-pass-1'

let adminToken = ''

async function apiLogin(request: APIRequestContext, username: string, password: string): Promise<string> {
  const response = await request.post('/api/v1/auth/login', { data: { username, password } })
  expect(response.ok(), `đăng nhập ${username} thất bại: ${response.status()}`).toBeTruthy()
  return (await response.json()).token as string
}

/**
 * Điều hướng TRONG ứng dụng bằng cách bấm menu, không dùng `page.goto`.
 *
 * Lý do không phải phong cách: `AuthProvider` giữ phiên trong state React và
 * KHÔNG lưu token vào localStorage/sessionStorage, nên mọi lần tải lại trang đầy
 * đủ đều mất phiên và bị đẩy về `/login`. `page.goto` chính là một lần tải lại
 * đầy đủ. Bấm menu mới là thứ người dùng thật làm, và mới kiểm đúng gate quyền.
 */
async function navigateTo(page: Page, linkName: RegExp) {
  await page.getByRole('link', { name: linkName }).first().click()
}

/** Đăng nhập qua GIAO DIỆN, không nhét token vào storage — đó mới là thứ cần kiểm. */
async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/Tên đăng nhập|Username/).fill(username)
  await page.getByLabel(/Mật khẩu|Password/).first().fill(password)
  await page.getByRole('button', { name: /Đăng nhập|Sign In/ }).click()
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 })
}

test.beforeAll(async ({ playwright }) => {
  expect(ADMIN_PASS, 'cần BOARD_ADMIN_PASS').not.toBe('')
  const request = await playwright.request.newContext({ baseURL: process.env.BOARD_URL })
  adminToken = await apiLogin(request, ADMIN_USER, ADMIN_PASS)
  // Tài khoản viewer tạm, xoá ở afterAll. Không đụng tài khoản có sẵn của board.
  await request.post('/api/v1/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { username: VIEWER_USER, role: 'viewer', password: VIEWER_PASS }
  })
  await request.dispose()
})

test.afterAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: process.env.BOARD_URL })
  await request.delete(`/api/v1/users/${VIEWER_USER}`, { headers: { Authorization: `Bearer ${adminToken}` } })
  await request.dispose()
})

/* ── WEB-UX-009: đăng nhập nhiều vai trò, trên board thật ─────────────────── */
test('WEB-UX-009 — cả admin lẫn viewer đăng nhập được, JWT mang đúng vai trò', async ({ page, request }) => {
  await signIn(page, ADMIN_USER, ADMIN_PASS)
  await expect(page.getByRole('heading', { name: /Bảng điều khiển|Dashboard/ })).toBeVisible()
  await page.screenshot({ path: 'board-evidence/01-admin-dashboard.png', fullPage: true })

  // Trước plan 45, ô username là `readOnly value="admin"` nên tài khoản này
  // không thể đăng nhập qua Web dù backend đã có đủ vai trò.
  const viewerToken = await apiLogin(request, VIEWER_USER, VIEWER_PASS)
  const me = await request.get('/api/v1/me', { headers: { Authorization: `Bearer ${viewerToken}` } })
  expect((await me.json()).role).toBe('viewer')
})

/* ── WEB-UX-005: gate quyền trên board thật ───────────────────────────────── */
test('WEB-UX-005 — viewer bị chặn bằng lời giải thích, không bị đá về trang chủ', async ({ page }) => {
  // Mở thẳng deep link khi chưa đăng nhập: `ProtectedShell` đẩy về `/login` kèm
  // `state.from`, và `safeReturnPath` phải đưa trở lại đúng đường dẫn đó sau khi
  // đăng nhập. Đi lối này kiểm luôn cả deep link lẫn gate quyền.
  await page.goto('/settings/users', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel(/Tên đăng nhập|Username/).fill(VIEWER_USER)
  await page.getByLabel(/Mật khẩu|Password/).first().fill(VIEWER_PASS)
  await page.getByRole('button', { name: /Đăng nhập|Sign In/ }).click()

  // Điểm mấu chốt: URL PHẢI giữ nguyên. `RequireAdmin` cũ dùng
  // `<Navigate to="/" replace />` nên người dùng bị đá về Dashboard không kèm
  // lý do, và sẽ bấm lại vì tưởng mình lỡ tay.
  await expect(page).toHaveURL(/\/settings\/users$/, { timeout: 20_000 })
  await expect(page.getByText(/Không đủ quyền|Insufficient permission/)).toBeVisible()
  await expect(page.getByText(/ADMIN/)).toBeVisible()
  await page.screenshot({ path: 'board-evidence/02-viewer-forbidden.png', fullPage: true })

  // Menu không bày ra những đích mà vai trò này không vào được.
  for (const label of [/^Người dùng$|^Users$/, /^Thiết bị$|^Device$/]) {
    await expect(page.getByRole('link', { name: label })).toHaveCount(0)
  }
  // Nhưng vẫn giữ toàn bộ màn hình theo dõi chỉ-đọc.
  await expect(page.getByRole('link', { name: /Giám sát|Monitoring/ })).toBeVisible()
})

/* ── WEB-UX-004: ghi ra AO/DO thật, có xác nhận ───────────────────────────── */
test('WEB-UX-004 — không ghi khi chưa xác nhận; ghi thật khi đã xác nhận', async ({ page }) => {
  await signIn(page, ADMIN_USER, ADMIN_PASS)
  await navigateTo(page, /Chạy thử|Commissioning/)
  await expect(page.getByRole('heading', { name: /Chạy thử|Commissioning/ })).toBeVisible()

  const input = page.getByLabel(/Giá trị ghi cho AO-01|Value to write for AO-01/)
  await expect(input).toBeVisible({ timeout: 20_000 })

  // (a) Không nhập giá trị → KHÔNG có hộp thoại, không có lệnh ghi.
  await page.getByRole('button', { name: /Chạy thử AO-01|Test AO-01/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // (b) Nhập giá trị → hộp thoại nêu ĐÍCH DANH point, giá trị và hậu quả vật lý.
  await input.fill('37')
  await page.getByRole('button', { name: /Chạy thử AO-01|Test AO-01/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('AO-01')
  await expect(dialog).toContainText('37%')
  await expect(dialog).toContainText(/van|damper|biến tần|valve|drive/i)
  await page.screenshot({ path: 'board-evidence/03-commissioning-confirm.png', fullPage: true })

  // (c) Huỷ → tuyệt đối không có lệnh ghi nào đi ra.
  const writesAfterCancel: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/commissioning/')) writesAfterCancel.push(r.url())
  })
  await page.getByRole('button', { name: /Huỷ|Cancel/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForTimeout(1500)
  expect(writesAfterCancel, 'bấm Huỷ mà vẫn có lệnh ghi đi ra').toEqual([])

  // (d) Xác nhận → lệnh ghi THẬT đi ra board (fake MCU, không có I/O vật lý).
  await input.fill('37')
  await page.getByRole('button', { name: /Chạy thử AO-01|Test AO-01/ }).click()
  const [commissionRequest] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/commissioning/points/AO-01/test'), { timeout: 20_000 }),
    page.getByRole('button', { name: /Ghi giá trị|Write value/ }).click()
  ])
  expect(commissionRequest.postDataJSON()).toMatchObject({ value: 37 })
  await page.screenshot({ path: 'board-evidence/04-commissioning-written.png', fullPage: true })
})

/* ── WEB-UX-001: định danh thật, ô không có nguồn hiện dấu gạch ───────────── */
test('WEB-UX-001 — Dashboard hiện MAC thật và `—` cho ô chưa cấu hình', async ({ page, request }) => {
  await signIn(page, ADMIN_USER, ADMIN_PASS)
  const status = await (await request.get('/api/v1/system/status', {
    headers: { Authorization: `Bearer ${adminToken}` }
  })).json()

  await expect(page.getByText(String(status.device_mac))).toBeVisible({ timeout: 20_000 })
  // `device.conf` trên board chưa có `location`/`description` → API bỏ hẳn field
  // → UI phải hiện `—`, không được bịa.
  expect(status.location ?? null, 'board đã cấu hình location, test này cần chọn ô khác').toBeNull()
  await expect(page.getByText('—').first()).toBeVisible()
  await expect(page.getByText('00:0D:18:24:AC:01')).toHaveCount(0)
  await expect(page.getByText('23/05/2025 14:32:18')).toHaveCount(0)
})

/* ── WEB-UX-012: theme tối, nhớ lựa chọn ──────────────────────────────────── */
test('WEB-UX-012 — đổi theme và giữ lựa chọn sau khi tải lại', async ({ page }) => {
  await signIn(page, ADMIN_USER, ADMIN_PASS)
  const before = await page.evaluate(() => document.documentElement.dataset.theme)

  await page.getByRole('button', { name: /giao diện tối|giao diện sáng|dark theme|light theme/i }).click()
  const after = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(after).not.toBe(before)
  await page.screenshot({ path: `board-evidence/05-theme-${after}.png`, fullPage: true })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(after)
  // Token phải thật sự được ghi lên :root, không chỉ đổi thuộc tính data-theme.
  const bg = await page.evaluate(() => document.documentElement.style.getPropertyValue('--c-bg'))
  expect(bg).toMatch(/^#[0-9A-Fa-f]{6}$/)
})

/* ── WEB-UX-010: điều hướng dưới 1024px ───────────────────────────────────── */
test('WEB-UX-010 — dưới 1024px có ngăn kéo điều hướng, đóng bằng Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, ADMIN_USER, ADMIN_PASS)

  // Trước plan 45, `NavRail` là `hidden … lg:flex` và không có gì thay thế:
  // mở web trên điện thoại là mất sạch điều hướng.
  const hamburger = page.getByRole('button', { name: /Mở điều hướng|Open navigation/ })
  await expect(hamburger).toBeVisible()
  await hamburger.click()

  const drawer = page.getByRole('dialog', { name: /Điều hướng|Navigation/ })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('link', { name: /Giám sát|Monitoring/ })).toBeVisible()
  await page.screenshot({ path: 'board-evidence/06-mobile-drawer.png', fullPage: true })

  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

/* ── WEB-UX-011: trang Người dùng dựng từ tài khoản THẬT ──────────────────── */
test('WEB-UX-011 — danh sách người dùng là tài khoản thật của board', async ({ page }) => {
  await signIn(page, ADMIN_USER, ADMIN_PASS)
  await navigateTo(page, /^Người dùng$|^Users$/)
  await expect(page).toHaveURL(/\/settings\/users$/)

  await expect(page.getByLabel(new RegExp(`Vai trò của ${VIEWER_USER}|Role for ${VIEWER_USER}`))).toHaveValue('viewer')
  // Tên trong `getDemoUsers()` cũ — bản trước dựng bảng từ đó KỂ CẢ ở bản live,
  // nên board thật khoe 5 tài khoản không tồn tại.
  for (const fake of ['operator2', 'maintenance', 'Operator One']) {
    await expect(page.getByText(fake, { exact: true })).toHaveCount(0)
  }
  await page.screenshot({ path: 'board-evidence/07-users.png', fullPage: true })
})

/* ── Quan sát: phiên KHÔNG sống sót qua một lần tải lại trang ─────────────── */
test('phiên đăng nhập không sống sót qua reload — ghi nhận hành vi thật', async ({ page }) => {
  await signIn(page, ADMIN_USER, ADMIN_PASS)
  await expect(page.getByRole('heading', { name: /Bảng điều khiển|Dashboard/ })).toBeVisible()

  await page.reload({ waitUntil: 'domcontentloaded' })

  // `AuthProvider` giữ phiên trong state React và không ghi token vào
  // localStorage/sessionStorage. Đây là lựa chọn an ninh hợp lý — token không
  // nằm lại trên đĩa của một HMI dùng chung — nhưng cái giá là mọi lần F5, mọi
  // deep link mở ở tab mới, đều bắt đăng nhập lại.
  //
  // Test này KHÔNG khẳng định đúng hay sai; nó chốt hành vi hiện tại để nếu ai
  // đó đổi sang lưu token thì phải đổi test và giải trình lý do.
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 })
})
