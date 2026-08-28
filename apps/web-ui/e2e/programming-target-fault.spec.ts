import { expect, test, type APIResponse, type Page } from '@playwright/test'

type JsonObject = Record<string, unknown>

async function json(response: APIResponse, status: number): Promise<JsonObject> {
  const raw = await response.text()
  expect(response.status(), `${response.url()}\n${raw}`).toBe(status)
  return JSON.parse(raw) as JsonObject
}

/**
 * Đăng nhập lại nếu trang vừa nạp đang hiện form đăng nhập.
 *
 * Phiên của web-app nằm trong bộ nhớ tab: mỗi `page.goto` là một lần nạp lại
 * toàn trang nên token trước đó không còn. Không xử lý việc này thì mọi assert
 * sau điều hướng thứ hai đều đỏ vì đang soi màn hình đăng nhập, chứ không phải
 * vì thứ case đang kiểm.
 */
async function loginIfNeeded(page: Page): Promise<void> {
  const username = page.getByLabel(/Tên đăng nhập|Username/i)
  if (!(await username.isVisible().catch(() => false))) return
  await username.fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await expect(username).toHaveCount(0, { timeout: 20_000 })
}

/**
 * `T59-813` / `TC-PGM02-LIVE-03` — bơm lỗi bằng cách dừng Core thật trên
 * target trước khi chạy case này. Test không tự điều khiển service và tuyệt đối
 * không mock HTTP: operator/Ops sở hữu fault injection và phục hồi ngoài browser.
 */
test('T59-813 target fault: Core offline không biến LIVE thành zero hay mở đường sửa', async ({ page, request }) => {
  test.skip(process.env.PROGRAMMING_TARGET_EXPECT_CORE_OFFLINE !== '1', 'chỉ chạy trong cửa sổ fault injection có kiểm soát')

  const login = await json(await request.post('/api/v1/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  }), 200)
  const token = login.token as string
  const headers = { authorization: `Bearer ${token}` }

  /* Identity phải được pin lúc Core còn online. Sau khi fault đã xảy ra,
   * backend cố ý xóa Active khỏi project view; đi tìm nó lúc này sẽ biến chính
   * hành vi fail-closed cần kiểm thành lỗi của đồ gá. */
  const projectId = process.env.PROGRAMMING_TARGET_PROJECT_ID
  const revisionId = process.env.PROGRAMMING_TARGET_REVISION_ID
  const objectId = process.env.PROGRAMMING_TARGET_POU_ID
  expect(projectId, 'thiếu Project pin từ preflight online').toMatch(/^[0-9a-f-]{36}$/)
  expect(revisionId, 'thiếu Revision pin từ preflight online').toMatch(/^[0-9a-f-]{36}$/)
  expect(objectId, 'thiếu POU pin từ preflight online').toMatch(/^[0-9a-f-]{36}$/)

  const revision = await json(await request.get(`/api/v1/programming/revisions/${revisionId}`, { headers }), 200)
  expect(revision.revisionId).toBe(revisionId)

  const monitor = await request.get('/api/v1/programming/runtime/monitor', { headers })
  const monitorRaw = await monitor.text()
  expect(monitor.status(), monitorRaw).toBe(503)
  expect(monitorRaw).not.toMatch(/"programValue"\s*:\s*0(?:[,.}]|$)/)

  await page.goto(`/eng/programming/programs?project=${projectId}&pou=${objectId}&mode=LIVE`)
  await loginIfNeeded(page)
  await page.waitForURL(/\/eng\/programming\/programs/, { timeout: 20_000 })

  /* Mất Core làm Active identity unavailable. FE phải bỏ cả source đang xem,
   * tuyệt đối không rơi về Draft chỉ vì POU ID còn trên URL. */
  await expect(page.getByLabel(/Mã nguồn đang chạy/)).toHaveCount(0)
  await expect(page.getByText(/Thiết bị chưa Commission gói nào/)).toBeVisible({ timeout: 20_000 })
  /* Không còn Active tuple thì lớp overlay phải bị gỡ hẳn trong cùng render,
   * không giữ thẻ giá trị đời trước dưới nhãn mới. Context strip vẫn nói rõ
   * đây là lỗi kết nối Core, không phải Project rỗng. */
  await expect(page.getByRole('region', { name: /Lớp giá trị runtime ST/ })).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: /Không kết nối được Core/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Hoàn tác/ })).toHaveCount(0)
})

/**
 * `T59-813` / `WP-12-R2` — diễn tập RÚT LUI trên chính controller.
 *
 * Đòn bẩy rollback của PGM-02 là cờ build `VITE_PROGRAMS_WORKSPACE_V2`. Một
 * đòn bẩy chỉ được ghi trong tài liệu thì chưa phải đòn bẩy: case này chạy
 * trong cửa sổ đã triển khai bundle KHÔNG có cờ, và kiểm hai vế mà lúc cần rút
 * lui gấp mới lộ ra — bề mặt R2 phải biến mất hẳn, và dữ liệu Draft/Active của
 * người dùng phải còn nguyên để bản cũ đọc tiếp.
 */
test('T59-813 target rollback: gỡ cờ cut-over thì bề mặt R2 biến mất nhưng dữ liệu còn nguyên', async ({ page, request }) => {
  test.skip(process.env.PROGRAMMING_TARGET_EXPECT_WORKSPACE_V2_OFF !== '1', 'chỉ chạy trong cửa sổ đã triển khai bundle rollback')

  const login = await json(await request.post('/api/v1/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  }), 200)
  const headers = { authorization: `Bearer ${login.token as string}` }

  const projectId = process.env.PROGRAMMING_TARGET_PROJECT_ID
  const revisionId = process.env.PROGRAMMING_TARGET_REVISION_ID
  const objectId = process.env.PROGRAMMING_TARGET_POU_ID
  expect(projectId, 'thiếu Project pin').toMatch(/^[0-9a-f-]{36}$/)
  expect(revisionId, 'thiếu Revision pin').toMatch(/^[0-9a-f-]{36}$/)
  expect(objectId, 'thiếu POU pin').toMatch(/^[0-9a-f-]{36}$/)

  /* Vế "không mất dữ liệu": Draft và Revision đang chạy vẫn đọc được nguyên vẹn
   * qua đúng API mà bản cũ dùng. Rollback FE không được kéo theo migration. */
  const project = await json(await request.get(`/api/v1/programming/projects/${projectId}`, { headers }), 200)
  expect(project.activeRevisionId, 'Active đổi sau khi rollback FE').toBe(revisionId)
  expect(project.draft, 'Draft biến mất sau khi rollback FE').toBeTruthy()
  const revision = await json(await request.get(`/api/v1/programming/revisions/${revisionId}`, { headers }), 200)
  const objects = ((revision.snapshot as JsonObject).objects as JsonObject[]) ?? []
  expect(objects.some((object) => object.objectId === objectId), 'POU pin không còn trong Revision đang chạy').toBe(true)

  /* Vế "bề mặt biến mất": route canonical của R2 không còn mount workspace nào,
   * và tuyệt đối không được để lại một trang LIVE nửa vời. */
  await page.goto(`/eng/programming/programs?project=${projectId}&pou=${objectId}&mode=LIVE`)
  await loginIfNeeded(page)
  await page.waitForURL(/\/eng\/programming(?!\/programs)/, { timeout: 20_000 })
  expect(new URL(page.url()).pathname, 'route canonical R2 vẫn còn sống sau rollback').not.toBe('/eng/programming/programs')
  await expect(page.getByLabel(/Mã nguồn đang chạy/)).toHaveCount(0)

  /* Và lối vào cũ phải mount lại workspace R1 — rút lui mà mất luôn màn hình
   * Chương trình thì không phải rollback, mà là mất tính năng. */
  await page.goto(`/eng/programming/projects/${projectId}/programs`)
  await loginIfNeeded(page)
  await expect(page.getByTestId('route-error-boundary')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Cây POU' })).toBeVisible({ timeout: 20_000 })
})
