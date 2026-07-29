import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

const apiOrigin = process.env.RBAC_E2E_API_ORIGIN ?? 'http://127.0.0.1:4175'
const fixturePassword = 'RbacTest123!'

type Role = 'viewer' | 'operator' | 'engineer' | 'admin'

async function loginAs(page: Page, role: Role, entryPath = '/login'): Promise<string> {
  await page.addInitScript(() => localStorage.setItem('mkddc-lang', 'en'))
  await page.goto(entryPath)
  await page.getByLabel('Username').fill(role)
  await page.getByLabel('Password').fill(fixturePassword)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url() === `${apiOrigin}/api/v1/auth/login` && candidate.request().method() === 'POST'),
    page.locator('button[type="submit"]').click()
  ])
  expect(response.status()).toBe(200)
  const body = await response.json() as { token: string; role: Role }
  expect(body.role).toBe(role)
  expect(body.token).toBeTruthy()
  await page.waitForURL((url) => url.pathname === '/')
  return body.token
}

async function apiCall(request: APIRequestContext, token: string, method: string, path: string, data?: unknown): Promise<APIResponse> {
  return request.fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    ...(data === undefined ? {} : { data })
  })
}

function expectAuthorized(response: APIResponse) {
  expect([401, 403], `unexpected authorization denial: ${response.status()}`).not.toContain(response.status())
}

async function navigateDirectlyWithinSession(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState(null, '', nextPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

test.describe.serial('live four-account RBAC', () => {
  test('rejects missing and invalid sessions with 401', async ({ request }) => {
    expect((await apiCall(request, '', 'GET', '/me')).status()).toBe(401)
    expect((await apiCall(request, 'invalid.jwt', 'GET', '/me')).status()).toBe(401)
  })

  test('viewer is read-only and direct Users URL emits no hidden Users query', async ({ page, request }) => {
    const requestedPaths: string[] = []
    page.on('request', (item) => requestedPaths.push(new URL(item.url()).pathname))
    const token = await loginAs(page, 'viewer', '/settings/users')

    await expect(page.locator('a[href="/settings/users"]')).toHaveCount(0)
    await expect(page.locator('a[href="/settings/network"]')).toHaveCount(0)
    expect(requestedPaths).not.toContain('/api/v1/users')

    expect((await apiCall(request, token, 'GET', '/system/status')).status()).toBe(200)
    expect((await apiCall(request, token, 'PUT', '/points/rbac-missing', { value: 1 })).status()).toBe(403)
    expect((await apiCall(request, token, 'POST', '/graph/validate', {})).status()).toBe(403)
    expect((await apiCall(request, token, 'PUT', '/network', {})).status()).toBe(403)
  })

  test('operator can operate and edit programs but cannot change settings or activate', async ({ page, request }) => {
    const requestedPaths: string[] = []
    page.on('request', (item) => requestedPaths.push(new URL(item.url()).pathname))
    const token = await loginAs(page, 'operator')

    await expect(page.locator('a[href="/eng/commissioning"]')).toHaveCount(1)
    await expect(page.locator('a[href="/settings/network"]')).toHaveCount(0)
    await navigateDirectlyWithinSession(page, '/settings/network')
    await page.waitForURL((url) => url.pathname === '/')
    expect(requestedPaths).not.toContain('/api/v1/network/transaction')

    expectAuthorized(await apiCall(request, token, 'PUT', '/points/rbac-missing', { value: 1 }))
    expect((await apiCall(request, token, 'POST', '/graph/validate', {})).status()).toBe(501)
    expect((await apiCall(request, token, 'POST', '/graph/deploy', {})).status()).toBe(403)
    expect((await apiCall(request, token, 'PUT', '/schedules', [])).status()).toBe(403)
  })

  test('engineer can access settings and activation but not Users or database policy', async ({ page, request }) => {
    const requestedPaths: string[] = []
    page.on('request', (item) => requestedPaths.push(new URL(item.url()).pathname))
    const token = await loginAs(page, 'engineer')

    await expect(page.locator('a[href="/settings/network"]')).toHaveCount(1)
    await expect(page.locator('a[href="/settings/users"]')).toHaveCount(0)
    await navigateDirectlyWithinSession(page, '/settings/network')
    await page.waitForURL((url) => url.pathname === '/settings/network')
    await expect.poll(() => requestedPaths.includes('/api/v1/network/transaction')).toBe(true)
    await navigateDirectlyWithinSession(page, '/settings/users')
    await page.waitForURL((url) => url.pathname === '/')
    expect(requestedPaths).not.toContain('/api/v1/users')

    expect((await apiCall(request, token, 'GET', '/system/config')).status()).toBe(200)
    expect((await apiCall(request, token, 'POST', '/graph/deploy', {})).status()).toBe(501)
    expect((await apiCall(request, token, 'GET', '/users')).status()).toBe(403)
    expect((await apiCall(request, token, 'PUT', '/trends/config', {})).status()).toBe(403)
    expectAuthorized(await apiCall(request, token, 'PUT', '/schedules', []))
  })

  test('admin manages Users, owns database mutation, and role changes stale old JWTs', async ({ page, request }) => {
    const adminToken = await loginAs(page, 'admin')
    await navigateDirectlyWithinSession(page, '/settings/users')
    await page.waitForURL((url) => url.pathname === '/settings/users')
    await expect(page.getByText('engineer', { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Add user' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add user' })
    await dialog.getByRole('textbox', { name: 'Username' }).fill('e2e-temp')
    await dialog.getByRole('combobox', { name: 'Role' }).selectOption('viewer')
    await dialog.getByLabel('New password').fill('TempPass123!')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('e2e-temp', { exact: true })).toBeVisible({ timeout: 20_000 })

    const tempLogin = await request.post(`${apiOrigin}/api/v1/auth/login`, {
      data: { username: 'e2e-temp', password: 'TempPass123!' }
    })
    expect(tempLogin.status()).toBe(200)
    const oldToken = (await tempLogin.json() as { token: string }).token

    expect((await apiCall(request, adminToken, 'PUT', '/users/e2e-temp', { role: 'operator' })).status()).toBe(200)
    expect((await apiCall(request, oldToken, 'GET', '/me')).status()).toBe(401)
    const relogin = await request.post(`${apiOrigin}/api/v1/auth/login`, {
      data: { username: 'e2e-temp', password: 'TempPass123!' }
    })
    expect(relogin.status()).toBe(200)
    expect((await relogin.json() as { role: Role }).role).toBe('operator')

    expectAuthorized(await apiCall(request, adminToken, 'PUT', '/trends/config', {}))
    expect((await apiCall(request, adminToken, 'DELETE', '/users/e2e-temp')).status()).toBe(204)
  })
})
