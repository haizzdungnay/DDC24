import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { PROGRAMMING_LIBRARY_ENTRIES } from '../src/features/programming/api/generated/library_registry'
import { catalogEntries, catalogParity } from '../src/features/programming/design/library/libraryCatalog'

/**
 * T59-505 — nghiệm thu host/LOCAL qua đúng HTTP, compiler/packager và
 * Programming IPC production. Spec này tuyệt đối không chặn request hay mock;
 * backend và Core simulator được khởi động bởi cấu hình Playwright riêng.
 * Simulator không có process I/O vật lý, vì vậy monitor Point trả 503 là trạng
 * thái fail-closed dự kiến, không phải bằng chứng target/HIL.
 */

const PROGRAM_ID = '81111111-1111-4111-8111-111111111111'
const SIGNAL_ID = '82222222-2222-4222-8222-222222222222'
const VARIABLE_ID = '83333333-3333-4333-8333-333333333333'
const FAN_VARIABLE_ID = '83333333-3333-4333-8333-333333333334'
const BINDING_ID = '84444444-4444-4444-8444-444444444444'
const LIBRARY_ENTRY_ID = '85555555-5555-4555-8555-555555555555'
const LIBRARY_INTERFACE = { inputs: [{ name: 'X', type: 'REAL' }], returnType: 'REAL' }
const SOURCE_R1 = `PROGRAM AHU_MAIN
VAR_INPUT
  SupplyTemp : REAL;
END_VAR
VAR_OUTPUT
  Fan : BOOL;
END_VAR
SIGNAL_PUBLISH(SUPPLY_TEMP, SupplyTemp);
Fan := TRUE;
END_PROGRAM
`
const SOURCE_R2 = SOURCE_R1.replace('Fan := TRUE;', 'Fan := FALSE;')

type JsonObject = Record<string, unknown>

let requestSequence = 0

/**
 * Muối theo TỪNG LẦN CHẠY, không chỉ theo từng request.
 *
 * Bộ đếm thuần sinh ra đúng cùng một tập `x-idempotency-key` ở mọi lần chạy.
 * Lane host dựng store mới mỗi lần nên không thấy gì. Lane target thì store của
 * controller sống lâu hơn phiên test: lần chạy thứ hai gửi lại đúng key cũ,
 * backend trả về **bản ghi của lần trước** — đúng hợp đồng idempotency — nên
 * mutation không thật sự chạy còn assert lại đọc trạng thái cũ.
 *
 * Đã làm `T59-810` đỏ giả trên bo Foxlinx: phiên Trace "vừa tạo" mang pin cũ
 * hơn snapshot đọc ngay trước đó 611 s, vì đó là phiên của lần chạy trước. Cùng
 * cơ chế này có thể cho xanh giả ở chiều ngược lại, nên phải chặn từ đồ gá.
 */
const RUN_SALT = crypto.randomUUID().replace(/-/g, '').slice(0, 6)

function nextUUID(prefix = '90000000'): string {
  requestSequence += 1
  return `${prefix}-0000-4000-8000-${RUN_SALT}${String(requestSequence).padStart(6, '0')}`
}

async function responseJSON(response: APIResponse, expectedStatus: number): Promise<JsonObject> {
  const text = await response.text()
  expect(response.status(), `${response.url()}\n${text}`).toBe(expectedStatus)
  return JSON.parse(text) as JsonObject
}

function mutationHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-correlation-id': nextUUID('91000000'),
    'x-idempotency-key': nextUUID('92000000'),
    ...extra
  }
}

function readHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-correlation-id': nextUUID('93000000')
  }
}


/**
 * Mở một route của workspace trên lane real-backend.
 *
 * Lane này phục vụ bằng **vite dev server**, tức mỗi module được biên dịch theo
 * yêu cầu ở lần chạm đầu. Khi nhiều test cùng nạp trang, một lần transform hụt
 * làm trình duyệt nhận `Failed to fetch dynamically imported module` và React
 * dựng `RouteErrorBoundary` — trang trắng, mọi locator sau đó treo tới hết
 * timeout. Đã gặp hai lần, cả hai đều ở đúng chỗ này và không liên quan gì tới
 * thứ test đang kiểm.
 *
 * Nạp lại MỘT lần là đủ (lần thứ hai trúng cache của vite). Nếu vẫn hỏng thì đó
 * là lỗi thật và test phải đỏ — nên hàm này không thử vô hạn.
 */
async function openWorkspaceRoute(page: Page, url: string): Promise<void> {
  await page.goto(url)
  const boundary = page.getByTestId('route-error-boundary')
  const rootChild = page.locator('#root > *').first()
  const mounted = await rootChild.waitFor({ state: 'attached', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (!mounted || await boundary.isVisible().catch(() => false)) {
    await page.reload()
  }
  await expect(boundary, 'route vẫn hỏng sau một lần nạp lại').toHaveCount(0)
  await expect(rootChild, 'ứng dụng vẫn chưa mount sau một lần nạp lại').toBeAttached()
}

async function loginAPI(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    data: { username: 'admin', password: 'admin123' }
  })
  const body = await responseJSON(response, 200)
  expect(body.role).toBe('admin')
  expect(body.mustChangePassword).toBe(false)
  expect(body.token).toEqual(expect.any(String))
  return body.token as string
}

async function waitForCheck(request: APIRequestContext, token: string, checkID: string): Promise<JsonObject> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await request.get(`/api/v1/programming/checks/${checkID}`, { headers: readHeaders(token) })
    const check = await responseJSON(response, 200)
    if (check.state === 'PASSED') return check
    if (['FAILED', 'TIMED_OUT'].includes(String(check.state))) {
      throw new Error(`Check ${checkID} kết thúc ${String(check.state)}: ${JSON.stringify(check)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Check ${checkID} không kết thúc trong 6 giây`)
}

async function waitForOperation(request: APIRequestContext, token: string, operationID: string): Promise<JsonObject> {
  let observed: JsonObject | undefined
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await request.get(`/api/v1/programming/operations/${operationID}`, { headers: readHeaders(token) })
    const operation = await responseJSON(response, 200)
    observed = operation
    if (operation.state === 'SUCCEEDED') return operation
    if (['FAILED', 'ROLLED_BACK'].includes(String(operation.state))) {
      throw new Error(`Operation ${operationID} kết thúc ${String(operation.state)}: ${JSON.stringify(operation)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const runtimeResponse = await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) })
  throw new Error(`Operation ${operationID} không kết thúc trong 10 giây; ` +
    `operation=${JSON.stringify(observed)}; runtime[${runtimeResponse.status()}]=${await runtimeResponse.text()}`)
}

async function waitForProgramState(
  request: APIRequestContext,
  token: string,
  projectID: string,
  desiredEnabled: boolean,
  runtimeState: 'RUNNING' | 'DISABLED'
): Promise<JsonObject> {
  let observed: JsonObject | undefined
  let observedPage: JsonObject | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request.get(`/api/v1/programming/projects/${projectID}/programs`, { headers: readHeaders(token) })
    const page = await responseJSON(response, 200)
    observedPage = page
    const item = (page.items as JsonObject[]).find((candidate) => candidate.programId === PROGRAM_ID)
    observed = item
    if (item?.desiredEnabled === desiredEnabled && item.runtimeState === runtimeState) return item
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const runtimeResponse = await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) })
  const signalResponse = await request.get('/api/v1/programming/runtime/signals', { headers: readHeaders(token) })
  const monitorResponse = await request.get('/api/v1/programming/runtime/monitor', { headers: readHeaders(token) })
  throw new Error(`Program không đạt desired=${desiredEnabled}, runtime=${runtimeState}; ` +
    `programs=${JSON.stringify(observedPage)}; item=${JSON.stringify(observed)}; ` +
    `runtime[${runtimeResponse.status()}]=${await runtimeResponse.text()}; ` +
    `signals[${signalResponse.status()}]=${await signalResponse.text()}; ` +
    `monitor[${monitorResponse.status()}]=${await monitorResponse.text()}`)
}

async function waitForRuntimeSignal(
  request: APIRequestContext,
  token: string,
  predicate: (signal: JsonObject) => boolean
): Promise<{ page: JsonObject; signal: JsonObject }> {
  let observedPage: JsonObject | undefined
  let observedSignal: JsonObject | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request.get('/api/v1/programming/runtime/signals', { headers: readHeaders(token) })
    const page = await responseJSON(response, 200)
    const signal = (page.items as JsonObject[]).find((candidate) => candidate.signalId === SIGNAL_ID)
    observedPage = page
    observedSignal = signal
    if (signal && predicate(signal)) return { page, signal }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Published Signal không đạt trạng thái chờ đợi; page=${JSON.stringify(observedPage)}; signal=${JSON.stringify(observedSignal)}`)
}

async function assertMobileSurface(page: Page, label: string): Promise<void> {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }))
  expect(width.document, `${label}: document tràn ngang`).toBeLessThanOrEqual(width.viewport + 1)
  expect(width.body, `${label}: body tràn ngang`).toBeLessThanOrEqual(width.viewport + 1)

  const axe = await new AxeBuilder({ page }).analyze()
  const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  expect(severe, `${label}: axe serious/critical`).toEqual([])
  console.info(`[T59-505] mobile ${label}: viewport=${width.viewport}, document=${width.document}, body=${width.body}, axe severe=0`)
}

async function sealAndCheck(
  request: APIRequestContext,
  token: string,
  projectID: string,
  baseRevisionID: string,
  etag: string,
  label: string
): Promise<{ revisionID: string; checkID: string; etag: string }> {
  const sealedResponse = await request.post(`/api/v1/programming/projects/${projectID}/draft/revisions`, {
    headers: mutationHeaders(token, { 'if-match': etag }),
    data: { schemaVersion: '1.0', baseRevisionId: baseRevisionID, label, comment: `T59-505 ${label}` }
  })
  const sealed = await responseJSON(sealedResponse, 201)
  const resource = sealed.resource as JsonObject
  const revisionID = resource.revisionId as string
  expect(revisionID).toMatch(/^[0-9a-f-]{36}$/)

  const acceptedResponse = await request.post(`/api/v1/programming/revisions/${revisionID}/checks`, {
    headers: mutationHeaders(token),
    data: { schemaVersion: '1.0', targetProfile: 'MK-DDC-24-REV-A' }
  })
  const accepted = await responseJSON(acceptedResponse, 202)
  const checkID = accepted.checkId as string
  const checked = await waitForCheck(request, token, checkID)
  expect(checked.revisionId).toBe(revisionID)
  expect(checked.diagnostics).toEqual([])
  expect((checked.artifact as JsonObject).sha256).toMatch(/^[a-f0-9]{64}$/)
  return { revisionID, checkID, etag: sealed.etag as string }
}

async function commission(
  request: APIRequestContext,
  token: string,
  fromRevisionID: string,
  revisionID: string,
  checkID: string,
  expectedPresent: string[] = [],
  expectedActiveFromRevisionID: string = fromRevisionID
): Promise<JsonObject> {
  const changesResponse = await request.get(
    `/api/v1/programming/revisions/${fromRevisionID}/changes/${revisionID}`,
    { headers: readHeaders(token) }
  )
  const changes = await responseJSON(changesResponse, 200)
  const impact = changes.impact as JsonObject
  console.info('[T59-811] changes keys=', Object.keys(changes), 'impact keys=', Object.keys(impact ?? {}))
  const keys = [
    'retain',
    'activeOverrides',
    'cutover',
    'outputMappingChanges',
    'publishedSignals',
    'controlLibrary',
    'programSet',
    'enableIntent'
  ]
  const acknowledgements = keys.filter((key) => {
    const group = impact[key] as JsonObject
    expect(group.status, `impact.${key} không được UNKNOWN/UNAVAILABLE`).not.toBe('UNAVAILABLE')
    expect(['NONE', 'PRESENT']).toContain(group.status)
    return group.status === 'PRESENT'
  })
  for (const key of expectedPresent) expect(acknowledgements).toContain(key)

  const expectedActiveRevisionId = expectedActiveFromRevisionID === 'none'
    ? null
    : expectedActiveFromRevisionID
  const acceptedResponse = await request.post('/api/v1/programming/operations/commission', {
    headers: mutationHeaders(token),
    data: {
      schemaVersion: '1.0',
      revisionId: revisionID,
      expectedActiveRevisionId,
      checkId: checkID,
      impactRef: impact.impactRef,
      acknowledgements,
      cutover: { requested: 'PROGRAM_ONLY' }
    }
  })
  const accepted = await responseJSON(acceptedResponse, 202)
  const operation = await waitForOperation(request, token, accepted.operationId as string)
  expect(operation.requestedRevisionId).toBe(revisionID)
  expect(operation.actualActiveRevisionId).toBe(revisionID)
  expect(operation.keepsRunningRevision).toEqual(expect.any(Boolean))
  return operation
}

test('ISS-PGM03-07: Draft v1 LOCAL+MB_RTU migrate qua HTTP, reload giữ đủ Binding và Check không bỏ qua', async ({ page, request }) => {
  test.setTimeout(120_000)
  const token = await loginAPI(request)
  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(token) }), 200)
  const seeded = (projects.items as JsonObject[]).find((item) => item.name === 'ISS-PGM03-07 legacy migration')
  expect(seeded, 'stack real-backend chưa seed fixture Draft v1').toBeTruthy()
  const projectID = seeded!.projectId as string

  const before = await responseJSON(
    await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) }), 200)
  expect((before.draft as JsonObject).schemaVersion).toBe(1)
  const draftID = before.draftRevisionId as string
  const saved = await responseJSON(await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': before.etag as string }),
    data: {
      schemaVersion: '1.0', baseRevisionId: before.baseRevisionId,
      operations: [{ op: 'setFunctionalTags', tags: ['e2e-migrated'] }]
    }
  }), 200)
  const migrated = (saved.resource as JsonObject).content as JsonObject
  expect(migrated.schemaVersion).toBe(2)
  expect(migrated.bindings).toEqual([
    expect.objectContaining({
      bindingId: '70666666-6666-4666-8666-666666666666',
      variableId: '70555555-5555-4555-8555-555555555555',
      programId: '70444444-4444-4444-8444-444444444444', variable: 'SupplyTemp',
      point: { category: 'LOCAL', pointId: 'UI-01' },
      direction: 'READ', dataType: 'REAL', unit: 'V', writable: false, qualityPolicy: 'REQUIRE_GOOD'
    }),
    expect.objectContaining({
      bindingId: '70666666-6666-4666-8666-666666666667',
      variableId: '70555555-5555-4555-8555-555555555556',
      programId: '70444444-4444-4444-8444-444444444444', variable: 'PumpReady',
      point: { category: 'MB_RTU', deviceId: 'bus-1-slave-4', pointId: 'PUMP_CMD' },
      direction: 'READ', dataType: 'BOOL', writable: false, qualityPolicy: 'REQUIRE_GOOD'
    })
  ])

  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('requestfailed', (failed) => failedRequests.push(new URL(failed.url()).pathname))
  await openWorkspaceRoute(page, `/eng/programming/projects/${projectID}/mapping`)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  const localRow = page.getByRole('row', { name: /SupplyTemp\s+LOCAL:UI-01\s+INPUT\s+·\s+REAL/ })
  const modbusRow = page.getByRole('row', { name: /PumpReady\s+MB_RTU:bus-1-slave-4:PUMP_CMD\s+INPUT\s+·\s+BOOL/ })
  await expect(localRow).toBeVisible()
  await expect(modbusRow).toBeVisible()
  await expect(page.getByText('2 binding', { exact: true })).toBeVisible()
  await page.reload()
  // JWT của AuthProvider chỉ sống trong memory theo chủ ý; reload toàn tài
  // liệu vì thế phải đăng nhập lại. Sau login mở lại đúng deep-link để phép
  // đo vẫn là GET Draft mới từ backend, không phải state React còn giữ.
  const loginAfterReload = page.getByLabel(/Tên đăng nhập|Username/i)
  if (await loginAfterReload.isVisible().catch(() => false)) {
    await loginAfterReload.fill('admin')
    await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
    await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  }
  await page.evaluate((path) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, `/eng/programming/projects/${projectID}/mapping`)
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  await expect(localRow).toBeVisible()
  await expect(modbusRow).toBeVisible()
  await expect(page.getByText('2 binding', { exact: true })).toBeVisible()
  // Reload có thể hủy request của document cũ trong lúc context điều hướng.
  // Bắt đầu ngân sách Console/Network ở snapshot production-preview đã ổn
  // định; lỗi sau mốc này vẫn làm test đỏ và không bị lọc theo chuỗi.
  consoleErrors.length = 0
  failedRequests.length = 0

  const readBack = await responseJSON(
    await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) }), 200)
  expect((readBack.draft as JsonObject).bindings).toEqual(migrated.bindings)
  // Lane HOST này không dựng slave Modbus nên Check phải fail-closed cho đúng
  // PUMP_CMD. Việc diagnostic còn mang chính identity MB_RTU chứng minh Check
  // đã đọc Binding sau migration, không âm thầm làm rơi rồi PASS giả.
  const sealedResponse = await request.post(`/api/v1/programming/projects/${projectID}/draft/revisions`, {
    headers: mutationHeaders(token, { 'if-match': saved.etag as string }),
    data: { schemaVersion: '1.0', baseRevisionId: draftID, label: 'ISS-PGM03-07 migrated', comment: 'GATE562-A' }
  })
  const sealed = await responseJSON(sealedResponse, 201)
  const revisionID = (sealed.resource as JsonObject).revisionId as string
  const accepted = await responseJSON(await request.post(`/api/v1/programming/revisions/${revisionID}/checks`, {
    headers: mutationHeaders(token),
    data: { schemaVersion: '1.0', targetProfile: 'MK-DDC-24-REV-A' }
  }), 202)
  let checked: JsonObject | undefined
  for (let attempt = 0; attempt < 120; attempt += 1) {
    checked = await responseJSON(await request.get(`/api/v1/programming/checks/${accepted.checkId as string}`, {
      headers: readHeaders(token)
    }), 200)
    if (['FAILED', 'PASSED', 'TIMED_OUT'].includes(String(checked.state))) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(checked?.state).toBe('FAILED')
  const diagnostics = JSON.stringify(checked?.diagnostics)
  expect(diagnostics).toContain('PIO-SLOT-003')
  expect(diagnostics).toContain('PUMP_CMD')
  expect(diagnostics).toContain('PumpReady')
  expect(consoleErrors).toEqual([])
  expect(failedRequests).toEqual([])
})

test('ISS-PGM03-08: UI rút cạn Catalog 504 mục qua đúng hai request và chọn được mục thứ 501', async ({ page, request }) => {
  test.setTimeout(120_000)
  const token = await loginAPI(request)
  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(token) }), 200)
  const seeded = (projects.items as JsonObject[]).find((item) => item.name === 'ISS-PGM03-07 legacy migration')
  expect(seeded, 'stack real-backend chưa seed Project dùng cho Mapping').toBeTruthy()
  const projectID = seeded!.projectId as string

  // Cho phép chạy riêng test này: nếu case #562 chưa chạy trước thì nâng fixture
  // v1 bằng đúng public API; không sửa thẳng SQLite hoặc dựng Project giả.
  const projectResponse = await responseJSON(
    await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) }), 200)
  if ((projectResponse.draft as JsonObject).schemaVersion === 1) {
    await responseJSON(await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
      headers: mutationHeaders(token, { 'if-match': projectResponse.etag as string }),
      data: {
        schemaVersion: '1.0',
        baseRevisionId: projectResponse.baseRevisionId,
        operations: [{ op: 'setFunctionalTags', tags: ['e2e-pagination'] }]
      }
    }), 200)
  }

  const catalogResponses: Array<{ url: string; body: JsonObject }> = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  const serverErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('requestfailed', (failed) => failedRequests.push(new URL(failed.url()).pathname))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${url.pathname}`)
    if (url.pathname !== '/api/v1/programming/point-catalog' || response.status() !== 200) return
    void response.json().then((body: JsonObject) => {
      catalogResponses.push({ url: response.url(), body })
    })
  })

  await openWorkspaceRoute(page, `/eng/programming/projects/${projectID}/mapping`)
  const usernameField = page.getByLabel(/Tên đăng nhập|Username/i)
  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill('admin')
    await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
    await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  }
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  await expect(page.getByText('Catalog 504 · đã đủ', { exact: true })).toBeVisible()
  await expect.poll(() => catalogResponses.length, {
    message: 'UI phải đọc đúng hai trang trước khi công bố complete'
  }).toBe(2)

  const first = catalogResponses.find((entry) => !new URL(entry.url).searchParams.has('cursor'))
  const second = catalogResponses.find((entry) => new URL(entry.url).searchParams.has('cursor'))
  expect(first, 'thiếu request trang đầu không mang cursor').toBeTruthy()
  expect(second, 'thiếu request trang sau').toBeTruthy()
  const firstURL = new URL(first!.url)
  const secondURL = new URL(second!.url)
  expect(firstURL.searchParams.get('limit')).toBe('500')
  expect(firstURL.searchParams.has('cursor')).toBe(false)
  expect(secondURL.searchParams.get('limit')).toBe('500')
  expect(secondURL.searchParams.get('cursor')).toBe(first!.body.nextCursor)

  const firstItems = first!.body.items as JsonObject[]
  const secondItems = second!.body.items as JsonObject[]
  expect(firstItems).toHaveLength(500)
  expect(secondItems).toHaveLength(4)
  expect(second!.body.nextCursor ?? null).toBeNull()
  const allItems = [...firstItems, ...secondItems]
  const keys = new Set(allItems.map((item) =>
    `${String(item.category)}\u0000${String(item.deviceId ?? '')}\u0000${String(item.pointId)}`))
  expect(keys.size).toBe(504)

  // `secondItems[0]` nằm đúng vị trí 501 của snapshot đã sắp xếp phía server.
  // Tìm và chọn nó trên UI chứng minh consumer không chỉ đếm đủ rồi bỏ dữ liệu
  // trang sau; title của chip là verdict compatibility mà server phát.
  const latePointID = String(secondItems[0].pointId)
  await page.getByRole('searchbox', { name: /Tìm biến hoặc Point|Search variable or Point/i }).fill(latePointID)
  const latePoint = page.getByTestId('mapping-point-list').getByRole('button', {
    name: new RegExp(`\\b${latePointID}\\b`)
  })
  await expect(latePoint).toBeVisible()
  await latePoint.click()
  await expect(latePoint).toHaveAttribute('aria-pressed', 'true')
  await expect(latePoint.locator('[title]').first()).toHaveAttribute('title', /AV\/BV\/MSV/)

  expect(consoleErrors).toEqual([])
  expect(failedRequests).toEqual([])
  expect(serverErrors).toEqual([])
})

test('T59-505/ISS-PGM-RBAC-01: engineer chạy lifecycle thật, Mapping và Trace theo capability', async ({ page, request }) => {
  test.setTimeout(180_000)
  const adminToken = await loginAPI(request)
  const engineerName = `pgmeng${Date.now().toString(36)}`
  const engineerPassword = 'Engineer#2026'
  const engineerCreated = await request.post('/api/v1/users', {
    headers: mutationHeaders(adminToken),
    data: { username: engineerName, role: 'engineer', password: engineerPassword }
  })
  expect(engineerCreated.status(), await engineerCreated.text()).toBe(201)
  const engineerLogin = await responseJSON(await request.post('/api/v1/auth/login', {
    data: { username: engineerName, password: engineerPassword }
  }), 200)
  expect(engineerLogin.role).toBe('engineer')
  const token = engineerLogin.token as string

  try {

  const createdResponse = await request.post('/api/v1/programming/projects', {
    headers: mutationHeaders(token),
    data: { schemaVersion: '1.0', name: 'AHU T59-505 real', description: 'Playwright real-backend host/LOCAL' }
  })
  const created = await responseJSON(createdResponse, 201)
  const createdResource = created.resource as JsonObject
  const projectID = createdResource.projectId as string
  const draftID = createdResource.draftRevisionId as string

  const libraryMutationResponse = await request.post(
    `/api/v1/programming/projects/${projectID}/library/entries`,
    {
      headers: mutationHeaders(token, { 'if-match': created.etag as string }),
      data: {
        schemaVersion: '1.0',
        entryId: LIBRARY_ENTRY_ID,
        kind: 'FUNCTION',
        name: 'SCALE_LIN',
        language: 'ST',
        source: 'FUNCTION SCALE_LIN : REAL\nVAR_INPUT X : REAL; END_VAR\nSCALE_LIN := X;\nEND_FUNCTION\n',
        interface: LIBRARY_INTERFACE,
        dependencies: [],
        /* `T61-401` — metadata TRÌNH BÀY trên backend THẬT.
           Cột `category`/`description` đã có từ migration `0014`, nhưng cho tới
           lát này không caller nào tới được chúng: command và request HTTP
           không có trường. Một cột không ai ghi được là một cột không tồn tại,
           và hệ quả đọc được trên màn hình là mọi khối PROJECT hiện
           "— chưa phân loại" vĩnh viễn. Mô tả để tiếng Việt có dấu vì trần đo
           theo KÝ TỰ, không theo byte. */
        category: 'math',
        description: 'Bộ chuyển đổi tuyến tính của dự án'
      }
    }
  )
  const libraryMutation = await responseJSON(libraryMutationResponse, 200)
  expect(libraryMutation.etag).not.toBe(created.etag)

  const libraryReadbackResponse = await request.get(
    `/api/v1/programming/libraries?projectId=${projectID}&scope=PROJECT&q=SCALE`,
    { headers: readHeaders(token) }
  )
  const libraryReadback = await responseJSON(libraryReadbackResponse, 200)
  expect(libraryReadback.items).toEqual([
    expect.objectContaining({
      scope: 'PROJECT',
      entryId: LIBRARY_ENTRY_ID,
      kind: 'FUNCTION',
      name: 'SCALE_LIN',
      language: 'ST',
      libraryState: 'DRAFT',
      category: 'math',
      description: 'Bộ chuyển đổi tuyến tính của dự án'
    })
  ])
  /* `D61-09` — băm trình bày TÁCH khỏi danh tính thực thi. Nếu `contentSha256`
     đổi theo mô tả thì mọi artifact và pin đã ký thành lỗi thời sau một lần sửa
     chính tả, và hậu quả thật không phải "phải build lại" mà là người ta sẽ
     thôi không sửa tài liệu nữa. */
  const libraryEntry = (libraryReadback.items as JsonObject[])[0]
  expect(libraryEntry.presentationSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(libraryEntry.presentationSha256).not.toBe(libraryEntry.contentSha256)

  /* Lọc theo `category` phải khớp khối PROJECT vừa gắn nhãn: ghi được mà lọc
     không thấy thì vẫn là chưa dùng được. */
  const byCategory = await responseJSON(
    await request.get(`/api/v1/programming/libraries?projectId=${projectID}&scope=PROJECT&category=math`,
      { headers: readHeaders(token) }),
    200
  )
  expect((byCategory.items as JsonObject[]).map((item) => item.entryId)).toContain(LIBRARY_ENTRY_ID)

  /* `T59-804` — parity catalog GIỮA HAI BỀ MẶT trên backend thật. PGM-02 Quick
     Library và PGM-04 Control Library cùng đọc `GET /libraries`; registry sinh
     sẵn ở FE (palette FBD) phải khai đúng tập SYSTEM đó. Lệch nghĩa là một bên
     đang chào block mà bên kia không có — đúng lớp lỗi từng xảy ra khi palette
     chào SCALE/DEADBAND/CTU/PI mà compiler không hề hỗ trợ. */
  const systemCatalogResponse = await request.get(
    '/api/v1/programming/libraries?scope=SYSTEM&limit=100',
    { headers: readHeaders(token) }
  )
  const systemCatalog = await responseJSON(systemCatalogResponse, 200)
  const parity = catalogParity(
    catalogEntries(systemCatalog as never),
    PROGRAMMING_LIBRARY_ENTRIES.map((entry) => entry.id)
  )
  expect(parity.onlyInBackend, 'block chỉ có ở backend').toEqual([])
  expect(parity.onlyInGenerated, 'block chỉ có ở registry sinh sẵn').toEqual([])
  expect(parity.matched).toBe(PROGRAMMING_LIBRARY_ENTRIES.length)

  const savedR1Response = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': libraryMutation.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [
        {
          op: 'upsertProgram',
          program: { programId: PROGRAM_ID, name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: SOURCE_R1 }
        },
        {
          op: 'upsertSignal',
          signal: {
            signalId: SIGNAL_ID,
            name: 'SUPPLY_TEMP',
            type: 'REAL',
            unit: '°C',
            publisherProgramId: PROGRAM_ID,
            freshnessMs: 5000,
            stalePolicy: 'HOLD_LAST'
          }
        },
        {
          op: 'upsertVariable',
          variable: {
            variableId: VARIABLE_ID,
            programId: PROGRAM_ID,
            name: 'SupplyTemp',
            type: 'REAL',
            class: 'INPUT',
            initialValue: null,
            retain: false
          }
        },
        {
          op: 'upsertVariable',
          variable: {
            variableId: FAN_VARIABLE_ID,
            programId: PROGRAM_ID,
            name: 'Fan',
            type: 'BOOL',
            class: 'OUTPUT',
            initialValue: false,
            retain: false
          }
        },
        {
          op: 'upsertBinding',
          binding: {
            bindingId: BINDING_ID,
            variableId: VARIABLE_ID,
            point: { category: 'LOCAL', pointId: 'UI-01' },
            direction: 'READ',
            dataType: 'REAL',
            unit: 'V',
            writable: false,
            qualityPolicy: 'REQUIRE_GOOD'
          }
        }
      ]
    }
  })
  const savedR1 = await responseJSON(savedR1Response, 200)

  // ISS-PGM03-01: preview và cửa PATCH phải dùng cùng authority. Candidate
  // hợp lệ được server xác nhận trên đúng ETag/base Revision; client bỏ qua
  // preview rồi gửi type giả vẫn bị chặn và Draft không đổi một byte logic.
  const validBinding = {
    bindingId: BINDING_ID,
    variableId: VARIABLE_ID,
    point: { category: 'LOCAL', pointId: 'UI-01' },
    direction: 'READ',
    dataType: 'REAL',
    unit: 'V',
    writable: false,
    qualityPolicy: 'REQUIRE_GOOD'
  }
  const previewResponse = await request.post(
    `/api/v1/programming/projects/${projectID}/draft/bindings/preview`,
    {
      headers: { ...readHeaders(token), 'if-match': savedR1.etag as string },
      data: { schemaVersion: '1.0', baseRevisionId: draftID, binding: validBinding }
    }
  )
  const preview = await responseJSON(previewResponse, 200)
  expect(preview).toMatchObject({ schemaVersion: '1.0', verdict: 'ALLOW', issues: [],
    projectId: projectID, draftRevisionId: draftID, baseRevisionId: draftID, etag: savedR1.etag })
  expect(previewResponse.headers().etag).toBe(savedR1.etag)

  const rejectedBindingResponse = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': savedR1.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [{ op: 'upsertBinding', binding: { ...validBinding, dataType: 'BOOL' } }]
    }
  })
  const rejectedBinding = await responseJSON(rejectedBindingResponse, 422)
  expect(rejectedBinding.error).toMatchObject({
    code: 'PRG-ERR-MAP-004',
    field: 'binding.dataType',
    args: { detailCode: 'PGM-MAP-TYPE-001', expected: 'REAL', actual: 'BOOL' }
  })

  const projectReadbackResponse = await request.get(`/api/v1/programming/projects/${projectID}`, {
    headers: readHeaders(token)
  })
  const projectReadback = await responseJSON(projectReadbackResponse, 200)
  expect(projectReadback.etag).toBe(savedR1.etag)
  const draft = projectReadback.draft as JsonObject
  const draftProgram = (draft.objects as JsonObject[]).find((candidate) => candidate.objectId === PROGRAM_ID)
  expect((draftProgram?.locals as JsonObject[])).toContainEqual(expect.objectContaining({
    variableId: VARIABLE_ID,
    name: 'SupplyTemp',
    type: 'REAL',
    class: 'INPUT'
  }))
  expect(draft.bindings).toContainEqual(expect.objectContaining({
    bindingId: BINDING_ID,
    variableId: VARIABLE_ID,
    point: { category: 'LOCAL', pointId: 'UI-01' },
    direction: 'READ'
  }))

  const r1 = await sealAndCheck(request, token, projectID, draftID, savedR1.etag as string, 'R1')
  const publishedLibraryResponse = await request.get(
    `/api/v1/programming/libraries?projectId=${projectID}&scope=PROJECT&q=SCALE`,
    { headers: readHeaders(token) }
  )
  const publishedLibrary = await responseJSON(publishedLibraryResponse, 200)
  expect(publishedLibrary.items).toEqual([
    expect.objectContaining({
      scope: 'PROJECT',
      entryId: LIBRARY_ENTRY_ID,
      kind: 'FUNCTION',
      name: 'SCALE_LIN',
      libraryState: 'PUBLISHED'
    })
  ])
  const publishedLibraryRevisionId = (publishedLibrary.items as JsonObject[])[0].libraryRevisionId as string
  expect(publishedLibraryRevisionId).toMatch(/^[0-9a-f-]{36}$/)
  await commission(request, token, 'none', r1.revisionID, r1.checkID, ['publishedSignals', 'programSet', 'controlLibrary'])

  const enableResponse = await request.put(
    `/api/v1/programming/projects/${projectID}/programs/${PROGRAM_ID}/runtime-intent`,
    {
      headers: mutationHeaders(token),
      data: { schemaVersion: '1.0', desiredEnabled: true }
    }
  )
  const enabled = await responseJSON(enableResponse, 200)
  expect((enabled.resource as JsonObject).desiredEnabled).toBe(true)
  await waitForProgramState(request, token, projectID, true, 'RUNNING')

  const { page: signals, signal } = await waitForRuntimeSignal(
    request,
    token,
    (candidate) => candidate.valid === true && candidate.value === 21.5 && candidate.freshness === 'FRESH'
  )
  expect(signals.producerState).toBe('READY')
  expect(signals.activeRevisionId).toBe(r1.revisionID)
  expect(signal).toMatchObject({
    name: 'SUPPLY_TEMP',
    producerProgramId: PROGRAM_ID,
    valid: true,
    value: 21.5,
    quality: 'GOOD',
    freshness: 'FRESH',
    definitionState: 'MATCHED'
  })

  const disableResponse = await request.put(
    `/api/v1/programming/projects/${projectID}/programs/${PROGRAM_ID}/runtime-intent`,
    {
      headers: mutationHeaders(token),
      data: { schemaVersion: '1.0', desiredEnabled: false }
    }
  )
  const disabled = await responseJSON(disableResponse, 200)
  expect((disabled.resource as JsonObject).desiredEnabled).toBe(false)
  await waitForProgramState(request, token, projectID, false, 'DISABLED')

  const savedR2Response = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': r1.etag }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: r1.revisionID,
      operations: [
        {
          op: 'upsertProgram',
          program: { programId: PROGRAM_ID, name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: SOURCE_R2 }
        }
      ]
    }
  })
  const savedR2 = await responseJSON(savedR2Response, 200)
  const r2 = await sealAndCheck(request, token, projectID, r1.revisionID, savedR2.etag as string, 'R2')
  await commission(request, token, r1.revisionID, r2.revisionID, r2.checkID)

  const restoreAcceptedResponse = await request.post('/api/v1/programming/operations/restore', {
    headers: mutationHeaders(token),
    data: {
      schemaVersion: '1.0',
      revisionId: r1.revisionID,
      expectedActiveRevisionId: r2.revisionID,
      reason: 'T59-505 khôi phục R1 đã kiểm chứng sau khi đưa R2 vào vận hành'
    }
  })
  const restoreAccepted = await responseJSON(restoreAcceptedResponse, 202)
  const restored = await waitForOperation(request, token, restoreAccepted.operationId as string)
  expect(restored.requestedRevisionId).toBe(r1.revisionID)
  expect(restored.previousActiveRevisionId).toBe(r2.revisionID)
  expect(restored.actualActiveRevisionId).toBe(r1.revisionID)

  const runtimeResponse = await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) })
  const runtime = await responseJSON(runtimeResponse, 200)
  expect(runtime.activeRevisionId).toBe(r1.revisionID)

  const serverFailures: string[] = []
  const failedRequests: string[] = []
  const consoleErrors: string[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (response.status() >= 500) {
      serverFailures.push(`${response.status()} ${url.pathname}`)
    }
  })
  page.on('requestfailed', (requestFailed) => {
    const errorText = requestFailed.failure()?.errorText ?? 'unknown'
    // Hai lần reload bên dưới chủ ý hủy các poll của document cũ. Chỉ bỏ đúng
    // ERR_ABORTED đó; mọi lỗi mạng khác vẫn làm gate đỏ với cả path và lý do.
    if (errorText.includes('ERR_ABORTED')) return
    failedRequests.push(`${new URL(requestFailed.url()).pathname}: ${errorText}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  // Deep link buộc UI dùng chính JWT thật; AuthProvider phải quay lại nguyên
  // route sau login, không được dựa vào token của APIRequestContext phía trên.
  await page.goto('/eng/programming/runtime?tab=watch')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel(/Tên đăng nhập|Username/i).fill(engineerName)
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill(engineerPassword)
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await expect(page).toHaveURL(/\/eng\/programming\/runtime\?tab=watch$/)

  const navigation = page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
  await expect(navigation).toBeVisible()
  for (const label of ['Tổng quan', 'Chương trình', 'Điểm & Ánh xạ', 'Thư viện điều khiển', 'Kiểm tra & Vận hành', 'Runtime & Bảo trì']) {
    await expect(navigation.getByText(label, { exact: true })).toBeVisible()
  }

  const signalRow = page.getByRole('row', { name: /SUPPLY_TEMP/ })
  await expect(signalRow).toBeVisible()
  const signalValueCell = signalRow.getByRole('cell').nth(1)
  await expect(signalValueCell.getByLabel('Không có dữ liệu')).toHaveText('—')
  await expect(signalRow.getByText('INVALID', { exact: true })).toBeVisible()
  await expect(signalRow.getByText('BAD', { exact: true })).toBeVisible()
  await expect(signalRow.getByText('UNAVAILABLE', { exact: true })).toBeVisible()
  await expect(signalRow.getByText('MATCHED', { exact: true })).toBeVisible()
  await expect(signalValueCell).not.toContainText('0')

  // Trước 2026-08-24 chỗ này chờ "Monitor đang ngoại tuyến." vì lỗi đọc SHM vật
  // lý nuốt luôn snapshot Core. Hai lỗi thật nấp sau kỳ vọng đó: (1) BE vứt
  // `snapshot.Points` do Core phát khi PLC SHM chưa attach, (2) Monitor chỉ tra
  // biến ở Revision object `VARIABLE` kiểu v1, trong khi Draft v2 seal biến vào
  // `locals` của POU — nên `items` rỗng với MỌI Revision thật. Màn Theo dõi
  // phải hiện đúng biến đã ánh xạ kèm giá trị Core đang phát; hạ kỳ vọng xuống
  // "offline" hay "chưa có biến ánh xạ" chính là giấu cả hai lỗi đó.
  const watchRow = page.getByRole('row', { name: /SupplyTemp/ })
  await expect(watchRow).toBeVisible()
  await expect(watchRow).toContainText('UI-01')
  await expect(watchRow).toContainText('21.5')
  await expect(watchRow).toContainText('GOOD')
  // Binding là READ: cột đề xuất đầu ra mức 5 KHÔNG được bịa ra một số.
  await expect(watchRow).toContainText('Không áp dụng')

  // ISS-PGM-RBAC-01: Trace là `program.edit`, vì vậy engineer phải thấy và
  // chạy được action thật. Khóa cả request POST/DELETE để tránh xanh giả chỉ
  // vì nút hiện trong DOM nhưng backend vẫn từ chối.
  await watchRow.getByRole('checkbox', { name: 'Trace SupplyTemp' }).check()
  const traceAcceptedResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/programming/runtime/traces')
  await page.getByRole('button', { name: 'Bắt đầu trace' }).click()
  const traceAccepted = await traceAcceptedResponse
  expect(traceAccepted.status(), await traceAccepted.text()).toBe(202)
  expect(traceAccepted.request().postDataJSON()).toMatchObject({
    schemaVersion: '1.0', variableIds: [VARIABLE_ID]
  })
  const stopTrace = page.getByRole('button', { name: 'Dừng trace' })
  await expect(stopTrace).toBeVisible()
  const traceStoppedResponse = page.waitForResponse((response) =>
    response.request().method() === 'DELETE' && /\/api\/v1\/programming\/runtime\/traces\/[0-9a-f-]+$/.test(new URL(response.url()).pathname))
  await stopTrace.click()
  const traceStopped = await traceStoppedResponse
  expect(traceStopped.status()).toBe(204)

  // VS-PROG-U10: API setup ở trên chưa đủ. Ba workspace chỉnh sửa phải tự đọc
  // lại đúng dữ liệu từ backend thật sau điều hướng client-side (giữ JWT thật),
  // không nhận dữ liệu từ state test hay lớp chặn request của trình duyệt.
  await navigation.getByRole('link', { name: 'Chương trình' }).click()
  // `T59-802`: lane này build với cut-over PGM-02 BẬT, nên đích của rail là route
  // query canonical. Khẳng định giữ nguyên phần có giá trị: đúng Project trên URL
  // (không mượn Project khác) và chế độ EDIT tường minh.
  await expect(page).toHaveURL(new RegExp(`/eng/programming/programs\\?project=${projectID}&mode=EDIT$`))
  // `T59-803`: DOM chỉ còn ĐÚNG MỘT cây POU, và nút mở POU có nhãn tường minh
  // vì ba nút thao tác bên cạnh cũng mang tên POU.
  const pouTree = page.getByRole('navigation', { name: 'Cây POU' })
  await expect(page.getByRole('navigation', { name: 'Cây ứng dụng' })).toHaveCount(0)
  await pouTree.getByRole('button', { name: 'Mở AHU_MAIN' }).click()
  await expect(page.getByLabel('Mã nguồn ST của AHU_MAIN')).toHaveValue(SOURCE_R2)

  // Hồi quy bắt trên Chrome DevTools: ST+ từng serialize cả view model
  // (`executionOrder`/`functionalTags`) và dùng tên có khoảng trắng, khiến
  // decoder strict của Draft v2 trả 400. Bước này phải ghi bằng chính UI,
  // kiểm payload trên wire và đọc lại từ backend thật — setup API không thay
  // được acceptance của đường mutation trình duyệt.
  const uiDraftMutationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'PATCH' &&
      url.pathname === `/api/v1/programming/projects/${projectID}/draft`
  })
  await page.getByTitle(/Thêm chương trình ST|Add ST program/i).click()
  const uiDraftMutation = await uiDraftMutationResponse
  expect(uiDraftMutation.status(), await uiDraftMutation.text()).toBe(200)
  const uiMutationBody = uiDraftMutation.request().postDataJSON() as JsonObject
  const uiMutationOperations = uiMutationBody.operations as JsonObject[]
  const uiUpsert = uiMutationOperations.find((operation) => operation.op === 'upsertProgram') as JsonObject
  expect(uiUpsert.program).toEqual({
    programId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    name: 'NewProgram',
    kind: 'PROGRAM',
    language: 'ST',
    document: 'PROGRAM NewProgram\nEND_PROGRAM\n'
  })
  expect(uiMutationOperations).toContainEqual(expect.objectContaining({ op: 'setTask' }))
  await expect(page.getByRole('heading', { name: 'NewProgram' })).toBeVisible()

  const uiReadbackResponse = await request.get(`/api/v1/programming/projects/${projectID}`, {
    headers: readHeaders(token)
  })
  const uiReadback = await responseJSON(uiReadbackResponse, 200)
  const uiReadbackDraft = uiReadback.draft as JsonObject
  expect(uiReadbackDraft.objects).toContainEqual(expect.objectContaining({
    objectId: (uiUpsert.program as JsonObject).programId,
    name: 'NewProgram',
    kind: 'PROGRAM',
    language: 'ST',
    source: 'PROGRAM NewProgram\nEND_PROGRAM\n'
  }))

  await page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
    .getByRole('link', { name: 'Thư viện điều khiển' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/library$`))
  /* Tên khả truy cập của thẻ khối theo THỨ TỰ ĐỌC mà `SPEC-PGM04-VISUAL-001` §2
     khoá: tên → kind → phạm vi. Phạm vi hiện bằng tiếng người ("Dự án"/"Hệ
     thống"), KHÔNG bằng mã thô — và cố ý không dùng chữ "Core" vì sản phẩm đã
     có `mkddc-core`.

     Khẳng định này từng ghim `PROJECT FUNCTION` và đã lạc hậu từ `T61-204`
     (`d970aaa`) mà không ai thấy: lane real-backend nằm ngoài suite mock mặc
     định nên nó không chạy trong cùng vòng với thay đổi làm nó đỏ. Đó là lý do
     một khẳng định lạc hậu sống được qua nhiều PR. */
  const projectLibraryEntry = page.getByRole('list', { name: 'Danh sách khối Thư viện điều khiển' })
    .getByRole('button', { name: /SCALE_LIN\s+FUNCTION\s+Dự án/ })
  await expect(projectLibraryEntry).toBeVisible()
  await projectLibraryEntry.click()
  /* Phải soi trong đúng khay khối đang chọn: lưới thẻ bên trái hiện
     "rev-a.1 · PUBLISHED" cho cả 41 khối SYSTEM, nên một locator toàn trang
     khớp 42 phần tử và fail ở strict mode — nó cũng sẽ xanh ngay cả khi entry
     PROJECT không hề được chọn, tức là một khẳng định không kiểm gì cả.

     Khay này từng mang tiêu đề "Chi tiết", TRÙNG với tên khay đầu tiên trong
     dải bốn tab ngay bên dưới nó — cùng một chữ chỉ hai thứ khác nhau ở hai
     cấp lồng nhau. `T61-304` đổi tiêu đề khung thành "Khối đang chọn" và để
     chữ "Chi tiết" cho đúng một nơi: cái tab. */
  const libraryDetail = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Khối đang chọn', level: 2 }) })
  await expect(libraryDetail.getByText(/· PUBLISHED$/)).toBeVisible()

  // F-P59-UI-001: authoring Library phải đi qua mutation + read-back thật.
  // Entry đã publish mở Draft version mới; payload edit phải GIỮ interface
  // canonical mà GET /libraries trả về — thay nó bằng `{inputs:[]}` làm mất
  // contract POU khỏi content hash dù người dùng chỉ sửa source.
  await page.getByRole('button', { name: 'Sửa — tạo phiên bản mới' }).click()
  const libraryWizard = page.getByRole('dialog', { name: 'Sửa khối PROJECT' })
  await libraryWizard.getByRole('button', { name: 'Tiếp' }).click()
  await expect(libraryWizard.getByRole('heading', { name: 'Giao diện' })).toBeFocused()
  await libraryWizard.getByRole('button', { name: 'Tiếp' }).click()
  await expect(libraryWizard.getByRole('heading', { name: 'Hiện thực' })).toBeFocused()
  const editedLibrarySource =
    'FUNCTION SCALE_LIN : REAL\nVAR_INPUT X : REAL; END_VAR\nSCALE_LIN := X + 1.0;\nEND_FUNCTION\n'
  await libraryWizard.getByLabel('Mã nguồn ST').fill(editedLibrarySource)
  await libraryWizard.getByRole('button', { name: 'Tiếp' }).click()
  await expect(libraryWizard.getByRole('heading', { name: 'Kiểm tra' })).toBeFocused()
  await libraryWizard.getByRole('button', { name: 'Chạy kiểm tra trên máy chủ' }).click()
  await expect(libraryWizard.getByTestId('library-wizard-check-result')).toBeVisible()
  await libraryWizard.getByRole('button', { name: 'Tiếp' }).click()
  await expect(libraryWizard.getByRole('heading', { name: 'Xem lại và lưu' })).toBeFocused()
  const uiLibraryMutationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' &&
      url.pathname === `/api/v1/programming/projects/${projectID}/library/entries`
  })
  await libraryWizard.getByRole('button', { name: 'Lưu vào bản nháp thư viện' }).click()
  const uiLibraryMutation = await uiLibraryMutationResponse
  expect(uiLibraryMutation.status(), await uiLibraryMutation.text()).toBe(200)
  const uiLibraryMutationResult = await uiLibraryMutation.json() as JsonObject
  const uiLibraryBody = uiLibraryMutation.request().postDataJSON() as JsonObject
  expect(uiLibraryBody).toMatchObject({
    entryId: LIBRARY_ENTRY_ID,
    name: 'SCALE_LIN',
    source: editedLibrarySource,
    interface: LIBRARY_INTERFACE
  })
  await expect(page.getByText(/Máy chủ đã trả lại khối/)).toContainText('SCALE_LIN · 1.1.0 · DRAFT')

  const uiLibraryReadbackResponse = await request.get(
    `/api/v1/programming/libraries?projectId=${projectID}&scope=PROJECT&q=SCALE_LIN&limit=100`,
    { headers: readHeaders(token) }
  )
  const uiLibraryReadback = await responseJSON(uiLibraryReadbackResponse, 200)
  expect(uiLibraryReadback.items).toContainEqual(expect.objectContaining({
    entryId: LIBRARY_ENTRY_ID,
    libraryState: 'DRAFT',
    interface: LIBRARY_INTERFACE
  }))

  // Vòng đời Library: Publish vẫn chỉ đi cùng Seal Revision. UI chỉ mở đúng
  // chuyển tiếp một chiều PUBLISHED -> DEPRECATED, cảnh báo phạm vi toàn
  // revision, gửi concurrency headers và chỉ xác nhận sau GET read-back.
  /* Lịch sử phiên bản nằm ở khay "Phiên bản" của Inspector (`T61-204`), và khay
     không được chọn thì `display:none` — nên phải MỞ nó trước. Trước lát này
     khẳng định dưới đây đi thẳng vào nút mà không mở khay, và nó chỉ sống được
     vì lane real-backend nằm ngoài suite mock mặc định. */
  await page.getByRole('tab', { name: 'Phiên bản' }).click()
  const deprecateAction = page.getByRole('button', { name: 'Ngừng sử dụng phiên bản 1.0.0' })
  await expect(deprecateAction).toBeVisible()
  await deprecateAction.click()
  const deprecateDialog = page.getByRole('dialog', { name: 'Ngừng sử dụng phiên bản thư viện?' })
  await expect(deprecateDialog).toContainText('Toàn bộ phiên bản PROJECT Library này sẽ chuyển sang DEPRECATED')
  await expect(deprecateDialog).toContainText(publishedLibraryRevisionId)
  const uiDeprecateResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' &&
      url.pathname === `/api/v1/programming/projects/${projectID}/library/revisions/${publishedLibraryRevisionId}/deprecate`
  })
  await deprecateDialog.getByRole('button', { name: 'Ngừng sử dụng', exact: true }).click()
  const uiDeprecate = await uiDeprecateResponse
  expect(uiDeprecate.status(), await uiDeprecate.text()).toBe(200)
  expect(uiDeprecate.request().postDataJSON()).toEqual({ schemaVersion: '1.0' })
  expect(uiDeprecate.request().headers()['if-match']).toBe(uiLibraryMutationResult.etag)
  expect(uiDeprecate.request().headers()['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  const uiDeprecateResult = await uiDeprecate.json() as JsonObject
  expect(uiDeprecateResult.resource).toMatchObject({
    projectId: projectID,
    libraryRevisionId: publishedLibraryRevisionId,
    libraryVersion: '1.0.0',
    libraryState: 'DEPRECATED'
  })
  await expect(page.getByRole('status').filter({ hasText: 'Máy chủ xác nhận phiên bản thư viện' }))
    .toContainText('1.0.0 · DEPRECATED')

  const uiDeprecateReadbackResponse = await request.get(
    `/api/v1/programming/libraries?projectId=${projectID}&scope=PROJECT&q=SCALE_LIN&limit=100`,
    { headers: readHeaders(token) }
  )
  const uiDeprecateReadback = await responseJSON(uiDeprecateReadbackResponse, 200)
  expect(uiDeprecateReadback.items).toContainEqual(expect.objectContaining({
    entryId: LIBRARY_ENTRY_ID,
    libraryRevisionId: publishedLibraryRevisionId,
    libraryVersion: '1.0.0',
    libraryState: 'DEPRECATED'
  }))
  expect(uiDeprecateReadback.items).toContainEqual(expect.objectContaining({
    entryId: LIBRARY_ENTRY_ID,
    libraryVersion: '1.1.0',
    libraryState: 'DRAFT'
  }))
  await expect(page.getByRole('button', { name: /Ngừng sử dụng phiên bản/ })).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
    .getByRole('link', { name: 'Điểm & Ánh xạ' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  /* Cột "Hướng/kiểu" của bảng Ánh xạ đã gán nói hướng của BIẾN
     (`INPUT`/`OUTPUT`, lấy từ `VAR_INPUT`/`VAR_OUTPUT`), không nói hướng của
     binding (`READ`/`WRITE`). Mẫu cũ bám vào `READ` nên case này đã đỏ từ lúc
     bảng chuyển sang từ vựng của biến — và vì lane real-backend không chạy
     trong mỗi lượt, không ai thấy. Bám đúng bề mặt hiện tại. */
  const mappingRow = page.getByRole('row', { name: /SupplyTemp\s+LOCAL:UI-01\s+INPUT\s+·\s+REAL/ })
  await expect(mappingRow).toBeVisible()

  // ISS-PGM03-02: engineer gán output chưa map vào Point canonical, qua preview
  // server-authoritative, rồi reload để chứng minh Draft read-back bền vững.
  await expect(page.getByText('Catalog 504 · đã đủ', { exact: true })).toBeVisible()
  const fanVariable = page.getByTestId('mapping-variable-list').getByRole('button', { name: /AHU_MAIN · Fan · Chưa map/ })
  await fanVariable.click()
  const do01Point = page.getByTestId('mapping-point-list').getByRole('button', { name: /\bDO-01\b/ })
  await do01Point.click()
  const mappingPreviewResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/v1/programming/projects/${projectID}/draft/bindings/preview`)
  await page.getByRole('button', { name: 'Ánh xạ AHU_MAIN · Fan' }).click()
  const mappingPreview = await mappingPreviewResponse
  expect(mappingPreview.status(), await mappingPreview.text()).toBe(200)
  const previewBody = mappingPreview.request().postDataJSON() as JsonObject
  expect(previewBody).toMatchObject({
    schemaVersion: '1.0',
    binding: {
      bindingId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      variableId: FAN_VARIABLE_ID,
      point: { category: 'LOCAL', pointId: 'DO-01' },
      direction: 'WRITE', dataType: 'BOOL', writable: true
    }
  })
  expect(JSON.stringify(previewBody)).not.toContain('extIndex')
  const changeDialog = page.getByRole('dialog', { name: 'Xem trước ánh xạ' })
  await expect(changeDialog.getByText('ALLOW', { exact: true })).toBeVisible()
  const mappingChangeResponse = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' &&
    new URL(response.url()).pathname === `/api/v1/programming/projects/${projectID}/draft`)
  await changeDialog.getByRole('button', { name: 'Ghi vào Draft' }).click()
  const mappingChange = await mappingChangeResponse
  expect(mappingChange.status(), await mappingChange.text()).toBe(200)
  await expect(changeDialog.getByText('Read-back xác nhận Draft đã đổi.')).toBeVisible()
  await changeDialog.getByRole('button', { name: 'Đóng' }).click()
  await expect(page.getByRole('row', { name: /Fan\s+LOCAL:DO-01\s+OUTPUT\s+·\s+BOOL/ })).toBeVisible()
  await expect(page.getByText('2 binding', { exact: true })).toBeVisible()

  await page.reload()
  await page.getByLabel(/Tên đăng nhập|Username/i).fill(engineerName)
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill(engineerPassword)
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  const assignedFanRow = page.getByRole('row', { name: /Fan\s+LOCAL:DO-01\s+OUTPUT\s+·\s+BOOL/ })
  await expect(assignedFanRow).toBeVisible()

  // Remove chỉ hoàn tất khi response server và read-back trên UI đều mất
  // binding; reload lần hai khóa việc component tự xóa optimistic.
  await assignedFanRow.getByRole('button', { name: 'Gỡ', exact: true }).click()
  const removeDialog = page.getByRole('dialog', { name: 'Xác nhận gỡ ánh xạ' })
  const mappingRemoveResponse = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' &&
    new URL(response.url()).pathname === `/api/v1/programming/projects/${projectID}/draft`)
  await removeDialog.getByRole('button', { name: 'Gỡ ánh xạ' }).click()
  const mappingRemove = await mappingRemoveResponse
  expect(mappingRemove.status(), await mappingRemove.text()).toBe(200)
  await expect(removeDialog.getByText('Read-back xác nhận Draft đã đổi.')).toBeVisible()
  await removeDialog.getByRole('button', { name: 'Đóng' }).click()
  await expect(page.getByText('1 binding', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByLabel(/Tên đăng nhập|Username/i).fill(engineerName)
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill(engineerPassword)
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  await expect(page.getByText('1 binding', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /SupplyTemp\s+LOCAL:UI-01\s+INPUT\s+·\s+REAL/ })).toBeVisible()

  // F-P59-UI-001: Published Signal được tạo bằng UI, không phải chỉ seed API.
  // Assert cả payload trên dây và Draft server trả lại để khoá mapping tên
  // policy UI (`USE_FALLBACK`) cùng fallback số, không chấp nhận optimistic UI.
  await page.getByRole('button', { name: 'Khai Published Signal' }).click()
  const uiSignalForm = page.getByRole('form', { name: 'Biểu mẫu Published Signal' })
  await uiSignalForm.getByLabel('Tên signal').fill('RETURN_AIR_TEMP')
  await uiSignalForm.getByLabel('Đơn vị').fill('degC')
  await uiSignalForm.getByLabel('Program publish (duy nhất)').selectOption((uiUpsert.program as JsonObject).programId as string)
  await uiSignalForm.getByLabel('Hạn tươi (ms)').fill('5000')
  await uiSignalForm.getByLabel('Chính sách khi quá hạn').selectOption('USE_FALLBACK')
  await uiSignalForm.getByLabel('Giá trị dự phòng').fill('21.5')
  const uiSignalMutationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'PATCH' &&
      url.pathname === `/api/v1/programming/projects/${projectID}/draft`
  })
  await uiSignalForm.getByRole('button', { name: 'Lưu Published Signal' }).click()
  const uiSignalMutation = await uiSignalMutationResponse
  expect(uiSignalMutation.status(), await uiSignalMutation.text()).toBe(200)
  const uiSignalBody = uiSignalMutation.request().postDataJSON() as JsonObject
  const uiSignalOperation = (uiSignalBody.operations as JsonObject[])
    .find((operation) => operation.op === 'upsertSignal') as JsonObject
  expect(uiSignalOperation.signal).toMatchObject({
    name: 'RETURN_AIR_TEMP',
    type: 'REAL',
    publisherProgramId: (uiUpsert.program as JsonObject).programId,
    freshnessMs: 5000,
    stalePolicy: 'USE_FALLBACK',
    fallbackValue: 21.5
  })
  await expect(page.getByText(/Máy chủ đã trả lại signal/)).toContainText(
    'RETURN_AIR_TEMP · REAL · 5000 ms · USE_FALLBACK'
  )
  await expect(page.getByRole('row', { name: /RETURN_AIR_TEMP/ })).toBeVisible()

  const uiSignalReadbackResponse = await request.get(`/api/v1/programming/projects/${projectID}`, {
    headers: readHeaders(token)
  })
  const uiSignalReadback = await responseJSON(uiSignalReadbackResponse, 200)
  expect((uiSignalReadback.draft as JsonObject).signals).toContainEqual(expect.objectContaining({
    signalId: (uiSignalOperation.signal as JsonObject).signalId,
    name: 'RETURN_AIR_TEMP',
    publisherProgramId: (uiUpsert.program as JsonObject).programId,
    stalePolicy: 'USE_FALLBACK',
    fallbackValue: 21.5
  }))

  await page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
    .getByRole('link', { name: 'Runtime & Bảo trì' })
    .click()
  await page.getByRole('tab', { name: 'Theo dõi' }).click()
  await expect(page.getByRole('row', { name: /SUPPLY_TEMP/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /SupplyTemp/ })).toContainText('UI-01')

  // Trước 2026-08-24 lane này CHẤP NHẬN đúng một `503 /runtime/monitor` và đúng
  // một console error, vì BE để lỗi đọc PLC SHM nuốt cả snapshot Core. Sau khi
  // Monitor đọc snapshot Core (và tra biến theo `locals` của Draft v2), không
  // còn 5xx nào hợp lệ ở lane host: giữ lại ngoại lệ cũ nghĩa là để một lỗi
  // server thật đi qua cổng mà không ai nhận ra.
  await expect.poll(() => [...new Set(serverFailures)].sort()).toEqual([])
  expect(failedRequests).toEqual([])
  expect([...new Set(consoleErrors)]).toEqual([])

  // Cùng phiên Chrome thật chuyển về viewport mobile để khoá responsive của
  // hai bề mặt authoring vừa mutation. Kiểm cả điều hướng More, tràn ngang và
  // lỗi a11y nghiêm trọng; đây không phải một phép đo bằng jsdom.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(navigation).toBeHidden()
  const mobileNavigation = page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình' })
  await expect(mobileNavigation).toBeVisible()

  await mobileNavigation.getByRole('button', { name: 'Thêm đích Lập trình' }).click()
  await page.getByTestId('programming-mobile-more').getByRole('link', { name: 'Thư viện điều khiển' }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/library$`))
  await expect(page.getByRole('list', { name: 'Danh sách khối Thư viện điều khiển' })
    .getByRole('button', { name: /SCALE_LIN\s+FUNCTION\s+Dự án/ })).toBeVisible()
  await assertMobileSurface(page, 'Library')

  await mobileNavigation.getByRole('button', { name: 'Thêm đích Lập trình' }).click()
  await page.getByTestId('programming-mobile-more').getByRole('link', { name: 'Điểm & Ánh xạ' }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  await expect(page.getByRole('row', { name: /RETURN_AIR_TEMP/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Ánh xạ|Đổi ánh xạ) / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Đổi|Gỡ|Gỡ ánh xạ)$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Khai Published Signal' })).toHaveCount(0)
  await assertMobileSurface(page, 'Mapping + Published Signal')

  console.info(
    `[T59-505] browser evidence: HTTP>=500=${serverFailures.length} ` +
    `(${[...new Set(serverFailures)].join(', ')}); requestfailed=${failedRequests.length}; ` +
    `console.error=${consoleErrors.length} (expected 0)`
  )
  } finally {
    const removed = await request.delete(`/api/v1/users/${engineerName}`, {
      headers: mutationHeaders(adminToken)
    })
    expect([200, 204], `không dọn được engineer tạm ${engineerName}`).toContain(removed.status())
  }
})

test('ISS-PGM-RBAC-01: viewer và operator thấy Mapping read-only nhưng có zero mutation', async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000)
  const adminToken = await loginAPI(request)
  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(adminToken) }), 200)
  const seeded = (projects.items as JsonObject[]).find((item) => item.name === 'ISS-PGM03-07 legacy migration')
  expect(seeded, 'stack real-backend chưa seed Project dùng cho phép đo RBAC Mapping').toBeTruthy()
  const projectID = seeded!.projectId as string
  const suffix = Date.now().toString(36)
  const password = 'ReadOnly#2026'
  const accounts = [
    { username: `pgmview${suffix}`, role: 'viewer' },
    { username: `pgmop${suffix}`, role: 'operator' },
  ] as const
  const created: string[] = []

  try {
    for (const account of accounts) {
      const response = await request.post('/api/v1/users', {
        headers: mutationHeaders(adminToken),
        data: { username: account.username, role: account.role, password }
      })
      expect(response.status(), await response.text()).toBe(201)
      created.push(account.username)

      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, locale: 'vi-VN' })
      try {
        const rolePage = await context.newPage()
        await openWorkspaceRoute(rolePage, `/eng/programming/projects/${projectID}/mapping`)
        await rolePage.getByLabel(/Tên đăng nhập|Username/i).fill(account.username)
        await rolePage.getByLabel(/^Mật khẩu$|^Password$/i).fill(password)
        await rolePage.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
        await expect(rolePage).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
        await expect(rolePage.getByText('READ-ONLY', { exact: true })).toBeVisible()
        await expect(rolePage.getByText(/binding$/).first()).toBeVisible()
        await expect(rolePage.getByRole('button', { name: /^(Ánh xạ|Đổi ánh xạ) / })).toHaveCount(0)
        await expect(rolePage.getByRole('button', { name: /^(Đổi|Gỡ|Gỡ ánh xạ)$/ })).toHaveCount(0)
        await expect(rolePage.getByRole('button', { name: 'Khai Published Signal' })).toHaveCount(0)
      } finally {
        await context.close()
      }
    }
  } finally {
    for (const username of created) {
      const removed = await request.delete(`/api/v1/users/${username}`, { headers: mutationHeaders(adminToken) })
      expect([200, 204], `không dọn được tài khoản tạm ${username}`).toContain(removed.status())
    }
  }
})

/**
 * `T59-807` / `PGM02-V22-WP-06-R1` — acceptance của task đòi E2E **real-backend**
 * cho bốn lớp lỗi: ETag cũ, refactor hỏng, quyền, và mất mạng. "Không mock
 * authority" nghĩa là không chế câu trả lời của backend; cắt mạng ở tầng trình
 * duyệt (`context.setOffline`) là **bơm lỗi thật**, không phải chế câu trả lời.
 *
 * Điều bộ test này thật sự khoá là **zero mutation**: mỗi lần từ chối phải để
 * lại Draft y nguyên. Một thao tác bị chặn nhưng vẫn kịp ghi một nửa là lớp lỗi
 * tệ nhất của lane này — người dùng thấy lỗi, tưởng không có gì xảy ra, và mang
 * theo một Draft đã lệch.
 */
test('T59-807: R1 fail-closed trên backend thật — ETag cũ, refactor hỏng, quyền, mất mạng', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const token = await loginAPI(request)

  const createdResponse = await request.post('/api/v1/programming/projects', {
    headers: mutationHeaders(token),
    data: { schemaVersion: '1.0', name: 'AHU T59-807 faults', description: 'Playwright real-backend fault matrix' }
  })
  const created = await responseJSON(createdResponse, 201)
  const createdResource = created.resource as JsonObject
  const projectID = createdResource.projectId as string
  const draftID = createdResource.draftRevisionId as string

  const seededResponse = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': created.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [{
        op: 'upsertProgram',
        program: { programId: PROGRAM_ID, name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: SOURCE_R1 }
      }]
    }
  })
  const seeded = await responseJSON(seededResponse, 200)
  const seededEtag = seeded.etag as string
  expect(seededEtag).not.toBe(created.etag)

  async function readDraftSource(): Promise<string> {
    const response = await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) })
    const project = await responseJSON(response, 200)
    /* `GET /projects/{id}` trả thẳng `ProgrammingProject`, không bọc `resource`
     * như các endpoint mutation — đọc nhầm lớp bọc là cách nhanh nhất để một
     * phép so "Draft không đổi" trở thành so `undefined` với `undefined` và
     * luôn xanh. */
    const draft = (project.draft ?? (project.resource as JsonObject | undefined)?.draft) as JsonObject | undefined
    expect(draft, 'không đọc được Draft để đối chiếu zero-mutation').toBeTruthy()
    return JSON.stringify(draft)
  }
  const baselineDraft = await readDraftSource()

  // ── 1. ETag cũ ────────────────────────────────────────────────────────────
  // Hai phiên cùng sửa một Draft. Phiên thứ hai gửi `if-match` của bản TRƯỚC
  // khi phiên thứ nhất ghi. Backend phải từ chối; ghi đè im lặng ở đây là mất
  // trắng công của phiên thứ nhất.
  const staleResponse = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': created.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [{
        op: 'upsertProgram',
        program: { programId: PROGRAM_ID, name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: SOURCE_R2 }
      }]
    }
  })
  expect([409, 412], `ETag cũ phải bị từ chối, nhận ${staleResponse.status()}`).toContain(staleResponse.status())
  expect(await readDraftSource(), 'ETag cũ bị từ chối nhưng Draft vẫn đổi').toBe(baselineDraft)

  // ── 2. Refactor hỏng phải là ZERO MUTATION ────────────────────────────────
  // Một lô thao tác trong đó thao tác SAU không hợp lệ. Nếu backend áp thao tác
  // đầu rồi mới hỏng ở thao tác sau thì Draft mang một nửa thay đổi — và người
  // dùng chỉ thấy "lỗi", không thấy nửa đã ghi.
  const faultyBatchResponse = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': seededEtag }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [
        {
          op: 'upsertProgram',
          program: { programId: PROGRAM_ID, name: 'AHU_RENAMED', kind: 'PROGRAM', language: 'ST', document: SOURCE_R2 }
        },
        { op: 'upsertProgram', program: { programId: 'not-a-uuid', name: '1_INVALID', kind: 'PROGRAM', language: 'ST', document: SOURCE_R1 } }
      ]
    }
  })
  expect(faultyBatchResponse.status(), 'lô thao tác có op hỏng phải bị từ chối').toBeGreaterThanOrEqual(400)
  expect(await readDraftSource(), 'lô hỏng bị từ chối nhưng Draft vẫn mang thay đổi của op đầu').toBe(baselineDraft)

  // ── 3. Quyền ──────────────────────────────────────────────────────────────
  // Viewer THẬT do backend cấp, không phải cờ giả ở FE.
  const viewerName = `viewer${Date.now().toString(36)}`
  const viewerCreated = await request.post('/api/v1/users', {
    headers: mutationHeaders(token),
    data: { username: viewerName, role: 'viewer', password: 'viewer123' }
  })
  expect(viewerCreated.status(), await viewerCreated.text()).toBe(201)

  const viewerLogin = await request.post('/api/v1/auth/login', { data: { username: viewerName, password: 'viewer123' } })
  const viewerBody = await responseJSON(viewerLogin, 200)
  expect(viewerBody.role).toBe('viewer')
  const viewerToken = viewerBody.token as string

  const viewerMutation = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(viewerToken, { 'if-match': seededEtag }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [{
        op: 'upsertProgram',
        program: { programId: PROGRAM_ID, name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: SOURCE_R2 }
      }]
    }
  })
  expect(viewerMutation.status(), 'viewer không được sửa Draft').toBe(403)
  expect(await readDraftSource(), 'viewer bị chặn nhưng Draft vẫn đổi').toBe(baselineDraft)

  // Viewer vẫn ĐỌC được — chặn ghi không có nghĩa là làm mù.
  const viewerRead = await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(viewerToken) })
  expect(viewerRead.status()).toBe(200)

  // ── 4. Mất mạng giữa lúc gõ ───────────────────────────────────────────────
  const workspaceUrl = `/eng/programming/programs?project=${projectID}&pou=${PROGRAM_ID}&mode=EDIT`
  await openWorkspaceRoute(page, workspaceUrl)
  /* Có phiên hay chưa là chuyện của context, không phải điều test này khẳng
     định — nên đăng nhập KHI được hỏi thay vì bắt buộc phải thấy màn login. */
  const usernameField = page.getByLabel(/Tên đăng nhập|Username/i)
  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill('admin')
    await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
    await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
    await page.waitForURL(/\/eng\/programming\/programs/, { timeout: 15_000 })
  }

  const source = page.getByLabel(/Mã nguồn ST/)
  if (!(await source.isVisible().catch(() => false))) {
    // POU chưa được chọn từ URL thì chọn bằng chính cây POU, không đi cửa sau.
    await page.getByRole('button', { name: /AHU_MAIN/ }).first().click()
  }
  await expect(source).toBeVisible({ timeout: 15_000 })
  const edited = `${SOURCE_R1.replace('Fan := TRUE;', 'Fan := FALSE; (* T59-807 offline *)')}`
  await source.fill(edited)

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()
  // Lưu hỏng phải NÓI ra, và buffer đang gõ phải còn nguyên: mất mạng không
  // phải lý do để nuốt công của người dùng.
  await expect(page.getByText('Lưu thất bại — thử lại.')).toBeVisible({ timeout: 15_000 })
  await expect(source).toHaveValue(edited)

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByText('Đã lưu.')).toBeVisible({ timeout: 15_000 })

  // Read-back qua API: thứ backend thật đang giữ đúng bằng thứ người dùng gõ.
  const afterSave = await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) })
  const afterSaveBody = await responseJSON(afterSave, 200)
  expect(JSON.stringify(afterSaveBody), 'Draft sau khi lưu lại phải mang đúng nội dung đã gõ').toContain('T59-807 offline')
})

/**
 * `T59-810` — tuple Active đi hết producer→IPC→BE và về tới client, trên backend
 * THẬT.
 *
 * Điều case này khoá không phải "có trường mới trong JSON" mà là **quan hệ**
 * giữa ba thứ vốn được sinh ở ba nơi khác nhau: snapshot monitor, phiên Trace, và
 * Revision đang active. Nếu ba thứ đó không nói cùng một tuple thì đồ thị runtime
 * có thể vẽ giá trị của chương trình này lên topology của chương trình kia — đúng
 * thứ `AC-ST-007`/`AC-FBD-010` tồn tại để cấm.
 */
test('T59-810: dấu producer và Trace pin nói cùng một tuple trên backend thật', async ({ request }) => {
  test.setTimeout(120_000)
  const token = await loginAPI(request)

  const monitorResponse = await request.get('/api/v1/programming/runtime/monitor', { headers: readHeaders(token) })
  const monitor = await responseJSON(monitorResponse, 200)

  // 1. Dấu producer PHẢI có mặt, và phải là CHUỖI thập phân.
  const producer = monitor.producer as { capturedMonotonicNs?: unknown } | undefined
  expect(producer, 'snapshot monitor thiếu dấu producer').toBeTruthy()
  expect(typeof producer!.capturedMonotonicNs, 'dấu phải là chuỗi, không phải number').toBe('string')
  expect(String(producer!.capturedMonotonicNs)).toMatch(/^[0-9]{1,20}$/)

  // 2. Mốc không được đi lùi giữa hai lần đọc liên tiếp của cùng một Core.
  const secondResponse = await request.get('/api/v1/programming/runtime/monitor', { headers: readHeaders(token) })
  const second = await responseJSON(secondResponse, 200)
  const first = BigInt(String((monitor.producer as Record<string, string>).capturedMonotonicNs))
  const later = BigInt(String((second.producer as Record<string, string>).capturedMonotonicNs))
  expect(later >= first, `mốc monotonic đi lùi giữa hai lần đọc: ${first} → ${later}`).toBe(true)

  // 3. Phiên Trace phải NEO vào đúng tuple của snapshot đã dùng để xác thực nó.
  const monitorItems = (second.items as JsonObject[]) ?? []
  test.skip(monitorItems.length === 0, 'chưa có biến nào ánh xạ ở Revision active — Trace pin không kiểm được ở đây')

  const variableID = monitorItems[0].variableId as string
  const acceptedResponse = await request.post('/api/v1/programming/runtime/traces', {
    headers: mutationHeaders(token),
    data: { schemaVersion: '1.0', variableIds: [variableID], durationMs: 1000, samplePeriodMs: 100 }
  })
  const accepted = await responseJSON(acceptedResponse, 202)

  const traceResponse = await request.get(`/api/v1/programming/runtime/traces/${accepted.traceId as string}`, { headers: readHeaders(token) })
  const trace = await responseJSON(traceResponse, 200)
  const pin = trace.pin as { revisionId: string | null; producer: Record<string, string> } | undefined
  expect(pin, 'phiên Trace không mang pin').toBeTruthy()
  expect(pin!.revisionId, 'Trace phải neo vào đúng Revision active').toBe(second.activeRevisionId)
  expect(String(pin!.producer.capturedMonotonicNs)).toMatch(/^[0-9]{1,20}$/)

  // Mốc neo phải nằm trong mạch đang chạy: không nhỏ hơn mốc đọc được trước khi
  // tạo phiên, vì phiên được neo bằng chính snapshot dùng để xác thực biến.
  expect(BigInt(String(pin!.producer.capturedMonotonicNs)) >= first, 'mốc neo cũ hơn mốc trước khi tạo phiên').toBe(true)
})

/**
 * `T59-811` — LIVE trên backend THẬT.
 *
 * Điều case này khoá là thứ **không nhìn thấy bằng mắt**: Draft và Active hiện
 * ra trong cùng một cửa sổ, cùng tên POU, cùng thứ tiếng ST. Một người vận hành
 * đọc nhầm Draft thành thứ đang điều khiển tủ không có dấu hiệu bên ngoài nào để
 * nghi ngờ.
 *
 * Test KHÔNG tự Commission: lane real-backend dùng chung một Core cho cả file,
 * nên commission thêm một Revision ở đây làm hỏng giả định của test khác và
 * chính nó phụ thuộc thứ tự chạy. Thay vào đó nó đọc trạng thái THẬT của
 * controller, rồi đối chiếu ba nguồn độc lập: nguồn LIVE trên màn hình, thân
 * Revision đang chạy đọc qua API, và Draft hiện tại của cùng Project.
 */
test('T59-811: LIVE hiện nguồn Active, không phải Draft, và chỉ đọc với mọi vai', async ({ page, request }) => {
  test.setTimeout(180_000)
  const token = await loginAPI(request)

  const runtime = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  const activeRevisionID = runtime.activeRevisionId as string | null
  test.skip(!activeRevisionID, 'controller chưa Commission gói nào — LIVE không có gì để đối chiếu')

  // Project nào đang sở hữu Revision đang chạy.
  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(token) }), 200)
  const owner = (projects.items as JsonObject[]).find((item) => item.activeRevisionId === activeRevisionID)
  expect(owner, `không Project nào khai Revision đang chạy ${activeRevisionID}`).toBeTruthy()
  const projectID = owner!.projectId as string

  // Thân Revision ĐANG CHẠY, đọc qua API — nguồn đối chiếu độc lập với UI.
  const revision = await responseJSON(
    await request.get(`/api/v1/programming/revisions/${activeRevisionID}`, { headers: readHeaders(token) }), 200)
  const snapshot = revision.snapshot as JsonObject
  const objects = (snapshot.objects as JsonObject[]) ?? []
  const pou = objects.find((object) => {
    const payload = object.payload as JsonObject | undefined
    return object.kind === 'PROGRAM' && typeof payload?.source === 'string'
  })
  test.skip(!pou, 'Revision đang chạy không khai POU nào có thân đọc được')
  const objectID = pou!.objectId as string
  const activeSource = ((pou!.payload as JsonObject).source as string)

  // Mở LIVE trong trình duyệt.
  const liveUrl = `/eng/programming/programs?project=${projectID}&pou=${objectID}&mode=LIVE`
  await openWorkspaceRoute(page, liveUrl)
  const usernameField = page.getByLabel(/Tên đăng nhập|Username/i)
  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill('admin')
    await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
    await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
    await page.waitForURL(/\/eng\/programming\/programs/, { timeout: 15_000 })
  }

  const liveSource = page.getByLabel(/Mã nguồn đang chạy/)
  await expect(liveSource).toBeVisible({ timeout: 20_000 })
  // Bằng đúng thân Revision đang chạy — không phải "trông giống", mà BẰNG.
  expect(await liveSource.inputValue()).toBe(activeSource)

  // Và nếu Draft đã đi tiếp, LIVE tuyệt đối không được hiện bản đó.
  const project = await responseJSON(
    await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) }), 200)
  const draftText = JSON.stringify(project.draft ?? {})
  if (!draftText.includes(JSON.stringify(activeSource))) {
    // Draft khác Active: chính là trường hợp nguy hiểm mà case này tồn tại để chặn.
    expect(await liveSource.inputValue()).toBe(activeSource)
  }

  // Chỉ đọc là thuộc tính của CHẾ ĐỘ: phiên này đang là admin.
  await expect(liveSource).toHaveAttribute('readonly', '')
  await expect(page.getByText('Chỉ đọc với mọi vai')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)

  // Khay workbench phải khai đúng chế độ đang xem.
  await expect(page.getByText(/^LIVE · /)).toBeVisible()

  // Revision đang chạy phải hiện ra để người đọc biết mình đang xem gói nào.
  await expect(page.getByText(activeRevisionID!)).toBeVisible()
})

/**
 * `T59-811` — "mọi role read-only" ở LIVE, kiểm bằng phiên VIEWER THẬT.
 *
 * Phần trước đã chứng minh admin không sửa được ở LIVE. Nhưng câu AC là "mọi
 * role", và vế còn lại của nó không phải "viewer cũng không sửa được" — điều đó
 * hiển nhiên. Vế đáng kiểm là **viewer vẫn ĐỌC được**: chặn ghi mà làm mù luôn
 * thì người trực ca không xem được thứ đang chạy trên tủ họ đang đứng cạnh.
 *
 * Dùng một browser context RIÊNG thay vì đăng xuất rồi đăng nhập lại trên cùng
 * trang: đổi phiên tại chỗ để lại state của phiên cũ (token trong bộ nhớ, hook
 * đang bay) và làm test đỏ vì lý do không liên quan gì tới thứ đang kiểm.
 */
test('T59-811: viewer thật vẫn ĐỌC được LIVE, và không có đường sửa nào', async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000)
  const token = await loginAPI(request)

  const runtime = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  const activeRevisionID = runtime.activeRevisionId as string | null
  test.skip(!activeRevisionID, 'controller chưa Commission gói nào')

  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(token) }), 200)
  const owner = (projects.items as JsonObject[]).find((item) => item.activeRevisionId === activeRevisionID)
  expect(owner, 'không Project nào khai Revision đang chạy').toBeTruthy()
  const projectID = owner!.projectId as string

  const revision = await responseJSON(
    await request.get(`/api/v1/programming/revisions/${activeRevisionID}`, { headers: readHeaders(token) }), 200)
  const objects = ((revision.snapshot as JsonObject).objects as JsonObject[]) ?? []
  const pou = objects.find((object) => {
    const payload = object.payload as JsonObject | undefined
    return object.kind === 'PROGRAM' && typeof payload?.source === 'string'
  })
  test.skip(!pou, 'Revision đang chạy không khai POU nào có thân đọc được')
  const objectID = pou!.objectId as string
  const activeSource = (pou!.payload as JsonObject).source as string

  // Viewer THẬT do backend cấp, không phải một cờ giả ở FE.
  const viewerName = `live${Date.now().toString(36)}`
  const viewerCreated = await request.post('/api/v1/users', {
    headers: mutationHeaders(token),
    data: { username: viewerName, role: 'viewer', password: 'viewer123' }
  })
  expect(viewerCreated.status(), await viewerCreated.text()).toBe(201)

  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
  try {
    const viewerPage = await context.newPage()
    await openWorkspaceRoute(viewerPage, `/eng/programming/programs?project=${projectID}&pou=${objectID}&mode=LIVE`)
    await viewerPage.getByLabel(/Tên đăng nhập|Username/i).fill(viewerName)
    await viewerPage.getByLabel(/^Mật khẩu$|^Password$/i).fill('viewer123')
    await viewerPage.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
    await viewerPage.waitForURL(/\/eng\/programming\/programs/, { timeout: 20_000 })

    const source = viewerPage.getByLabel(/Mã nguồn đang chạy/)
    await expect(source).toBeVisible({ timeout: 20_000 })
    // Vế đáng kiểm: viewer ĐỌC ĐƯỢC, và đọc đúng bản đang chạy.
    expect(await source.inputValue()).toBe(activeSource)
    await expect(source).toHaveAttribute('readonly', '')
    await expect(viewerPage.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)
    await expect(viewerPage.getByRole('button', { name: /Hoàn tác/ })).toHaveCount(0)
  } finally {
    await context.close()
    /* Lane target chạy trên controller thật dùng chung: một tài khoản viewer bỏ
     * lại sau mỗi lần đo là quyền truy cập thừa, không phải rác vô hại. Xoá ở
     * đây thay vì ở cuối test để nó vẫn chạy khi assert phía trên đỏ. */
    const removed = await request.delete(`/api/v1/users/${viewerName}`, { headers: mutationHeaders(token) })
    expect([200, 204], `không dọn được viewer tạm ${viewerName}`).toContain(removed.status())
  }
})

/**
 * `T59-815` / `PGM02-V22-WP-08` — SIMULATE trên backend THẬT, worker thật.
 *
 * Điều case này khoá không phải "API trả 200" mà là ba câu mà chỉ một hệ thống
 * đang chạy mới trả lời được:
 *
 *  1. `RUN` có thật sự chạy không. Trước `T59-815`, `RUN` chỉ đổi một chuỗi
 *     trạng thái trong DB: đồng hồ ảo đứng yên trong khi màn hình ghi "đang
 *     chạy". Đây là chỗ duy nhất phát hiện được kiểu nói dối đó.
 *  2. `STEP_CYCLE` có tiến ĐÚNG một base tick không, hay tiến theo thời gian
 *     treo tường.
 *  3. Vai không đủ quyền có bị chặn ở SERVER không, chứ không chỉ bị ẩn nút.
 */
test('T59-815: phiên mô phỏng chạy thật, dừng thật và chặn vai không đủ quyền', async ({ request }) => {
  test.setTimeout(180_000)
  const token = await loginAPI(request)

  const capabilities = await responseJSON(
    await request.get('/api/v1/programming/capabilities', { headers: readHeaders(token) }), 200)
  const modes = capabilities.workspaceModes as JsonObject | undefined
  const simulation = modes?.simulation as JsonObject | undefined
  test.skip(simulation?.supported !== true, 'stack chưa bật worker mô phỏng')
  expect(simulation!.mutationRoles).toEqual(['admin'])

  // Một Project mới, một Program ST, rồi seal + Check. Worker chỉ nhận artifact
  // bất biến do chính pipeline Check sinh ra, nên bước Check là bắt buộc.
  const created = await responseJSON(await request.post('/api/v1/programming/projects', {
    headers: mutationHeaders(token),
    data: { schemaVersion: '1.0', name: 'AHU T59-815 sim', description: 'Playwright simulation' }
  }), 201)
  const projectID = (created.resource as JsonObject).projectId as string
  const draftID = (created.resource as JsonObject).draftRevisionId as string

  const saved = await responseJSON(await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(token, { 'if-match': created.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [{
        op: 'upsertProgram',
        program: {
          programId: PROGRAM_ID, name: 'AHU_SIM', kind: 'PROGRAM', language: 'ST',
          document: 'PROGRAM AHU_SIM\nVAR_INPUT Setpoint : REAL; END_VAR\nVAR_OUTPUT Doubled : REAL; END_VAR\n  Doubled := Setpoint * 2.0;\nEND_PROGRAM\n'
        }
      }]
    }
  }), 200)

  const sealed = await sealAndCheck(request, token, projectID, draftID, saved.etag as string, 'SIM')
  const revision = await responseJSON(
    await request.get(`/api/v1/programming/revisions/${sealed.revisionID}`, { headers: readHeaders(token) }), 200)
  const contentHash = revision.contentHash as string
  expect(contentHash).toMatch(/^[a-f0-9]{64}$/)

  // Hash không khớp ⇒ SAVE_REQUIRED và KHÔNG có phiên nào được tạo. Đây là chốt
  // phân biệt "mô phỏng bản tôi vừa lưu" với "mô phỏng thứ gì đó".
  const mismatch = await request.post('/api/v1/programming/simulation/sessions', {
    headers: mutationHeaders(token),
    data: {
      schemaVersion: '1.0', controllerId: 'host-programming-real-e2e', projectId: projectID,
      sourceDraftRevisionId: sealed.revisionID, sourceContentSha256: 'f'.repeat(64)
    }
  })
  const mismatchBody = await mismatch.text()
  expect(mismatch.status(), mismatchBody).toBe(409)
  expect(mismatchBody).toContain('PRG-SIM-SAVE-REQUIRED')

  const session = await responseJSON(await request.post('/api/v1/programming/simulation/sessions', {
    headers: mutationHeaders(token),
    data: {
      schemaVersion: '1.0', controllerId: 'host-programming-real-e2e', projectId: projectID,
      sourceDraftRevisionId: sealed.revisionID, sourceContentSha256: contentHash
    }
  }), 201)
  const sessionID = session.sessionId as string
  expect(session.state).toBe('PAUSED')
  expect(session.baseTickMs).toBeGreaterThan(0)
  /* Allowlist đến TỪ artifact đã seal: chỉ `VAR_INPUT`, không có biến đầu ra.
   *
   * `observationId` mang `programId` chứ không mang TÊN POU — runtime instance
   * dùng identity ổn định, còn tên là thứ người dùng đổi được. Ràng buộc test
   * vào tên sẽ đỏ mỗi lần ai đó đổi nhãn. */
  const setpointId = `${PROGRAM_ID}.Setpoint`
  const doubledId = `${PROGRAM_ID}.Doubled`
  const inputs = (session.simulationInputs as JsonObject[]) ?? []
  expect(inputs.map((item) => item.observationId)).toContain(setpointId)
  expect(inputs.map((item) => item.observationId)).not.toContain(doubledId)

  async function readSession(): Promise<JsonObject> {
    return responseJSON(await request.get(`/api/v1/programming/simulation/sessions/${sessionID}`,
      { headers: readHeaders(token) }), 200)
  }
  async function act(action: string, etag: string, speed?: number): Promise<JsonObject> {
    const data: JsonObject = { schemaVersion: '1.0', action }
    if (speed !== undefined) data.speed = speed
    return responseJSON(await request.post(`/api/v1/programming/simulation/sessions/${sessionID}/actions`, {
      headers: mutationHeaders(token, { 'if-match': etag }), data
    }), 200)
  }

  // Ghi một virtual input rồi STEP: đầu ra phải dùng đúng giá trị vừa ghi.
  const afterInput = await responseJSON(await request.put(
    `/api/v1/programming/simulation/sessions/${sessionID}/inputs/${setpointId}`, {
      headers: mutationHeaders(token, { 'if-match': session.etag as string }),
      data: { schemaVersion: '1.0', dataType: 'REAL', value: 4.5 }
    }), 200)

  const stepped = await act('STEP_CYCLE', afterInput.etag as string)
  const baseTick = session.baseTickMs as number
  expect(stepped.state).toBe('PAUSED')
  // ĐÚNG một base tick, không phải một khoảng thời gian treo tường.
  expect(Number(stepped.virtualTimeMs)).toBe(baseTick)

  const observations = await responseJSON(
    await request.get(`/api/v1/programming/simulation/sessions/${sessionID}/observations`,
      { headers: readHeaders(token) }), 200)
  const doubled = ((observations.observations as JsonObject[]) ?? [])
    .find((item) => item.observationId === doubledId)
  expect(doubled, 'thiếu observation của biến đầu ra').toBeTruthy()
  expect(doubled!.value).toBe(9)

  // Ghi vào biến ĐẦU RA phải bị từ chối, và phiên vẫn sống.
  const deniedInput = await request.put(
    `/api/v1/programming/simulation/sessions/${sessionID}/inputs/${doubledId}`, {
      headers: mutationHeaders(token, { 'if-match': stepped.etag as string }),
      data: { schemaVersion: '1.0', dataType: 'REAL', value: 1 }
    })
  const deniedBody = await deniedInput.text()
  expect(deniedInput.status(), deniedBody).toBe(422)
  expect(deniedBody).toContain('PRG-SIM-INPUT-NOT-ALLOWED')
  expect((await readSession()).state).toBe('PAUSED')

  // RUN phải THẬT SỰ chạy: đồng hồ ảo tiến mà không cần lệnh nào thêm.
  const running = await act('RUN', stepped.etag as string)
  expect(running.state).toBe('RUNNING')
  const startedAt = Number(running.virtualTimeMs)
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const advanced = await readSession()
  expect(advanced.state).toBe('RUNNING')
  expect(Number(advanced.virtualTimeMs),
    'RUN không tiến đồng hồ ảo — nút Chạy đang nói dối').toBeGreaterThan(startedAt)

  // PAUSE phải dừng THẬT: sau khi dừng, đồng hồ ảo đứng yên.
  const paused = await act('PAUSE', advanced.etag as string)
  expect(paused.state).toBe('PAUSED')
  const pausedAt = Number((await readSession()).virtualTimeMs)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  expect(Number((await readSession()).virtualTimeMs),
    'đồng hồ ảo vẫn tiến sau khi PAUSE').toBe(pausedAt)

  // RESET đưa về t=0 và tăng resetEpoch để client bỏ mẫu của epoch cũ.
  const reset = await act('RESET', (await readSession()).etag as string)
  expect(Number(reset.virtualTimeMs)).toBe(0)
  expect(Number(reset.resetEpoch)).toBeGreaterThan(Number(session.resetEpoch))

  // Vai không đủ quyền bị chặn ở SERVER, không chỉ bị ẩn nút.
  const viewerName = `sim${Date.now().toString(36)}`
  const viewerCreated = await request.post('/api/v1/users', {
    headers: mutationHeaders(token),
    data: { username: viewerName, role: 'viewer', password: 'viewer123' }
  })
  expect(viewerCreated.status(), await viewerCreated.text()).toBe(201)
  try {
    const viewerLogin = await responseJSON(await request.post('/api/v1/auth/login', {
      data: { username: viewerName, password: 'viewer123' }
    }), 200)
    const viewerToken = viewerLogin.token as string

    // Đọc được…
    const viewerRead = await request.get(`/api/v1/programming/simulation/sessions/${sessionID}`,
      { headers: readHeaders(viewerToken) })
    expect(viewerRead.status()).toBe(200)

    // …nhưng không điều khiển được, và cũng không mở được phiên mới.
    const viewerAction = await request.post(`/api/v1/programming/simulation/sessions/${sessionID}/actions`, {
      headers: mutationHeaders(viewerToken, { 'if-match': reset.etag as string }),
      data: { schemaVersion: '1.0', action: 'RUN' }
    })
    expect(viewerAction.status(), await viewerAction.text()).toBe(403)
    const viewerCreate = await request.post('/api/v1/programming/simulation/sessions', {
      headers: mutationHeaders(viewerToken),
      data: {
        schemaVersion: '1.0', controllerId: 'host-programming-real-e2e', projectId: projectID,
        sourceDraftRevisionId: sealed.revisionID, sourceContentSha256: contentHash
      }
    })
    expect(viewerCreate.status(), await viewerCreate.text()).toBe(403)
    // Phiên vẫn nguyên trạng sau hai lần bị từ chối.
    expect((await readSession()).state).toBe('PAUSED')
  } finally {
    const removed = await request.delete(`/api/v1/users/${viewerName}`, { headers: mutationHeaders(token) })
    expect([200, 204]).toContain(removed.status())
  }

  // STOP là terminal và idempotent.
  const stopped = await responseJSON(await request.delete(
    `/api/v1/programming/simulation/sessions/${sessionID}`,
    { headers: mutationHeaders(token, { 'if-match': (await readSession()).etag as string }) }), 200)
  expect(stopped.state).toBe('STOPPED')
  const stoppedAgain = await request.delete(`/api/v1/programming/simulation/sessions/${sessionID}`,
    { headers: mutationHeaders(token, { 'if-match': stopped.etag as string }) })
  expect(stoppedAgain.status()).toBe(200)
})

/**
 * `T60-303` — Overview đọc bảng Programs từ Core THẬT sau Commission + Enable.
 *
 * Vì sao cần một case real-backend riêng khi `T60-302` đã phủ bằng mock: bảng
 * này là chỗ ba nguồn gặp nhau — intent bền vững trong store, read-back sống từ
 * Core, và tên/ngôn ngữ/chu kỳ khai trong Revision đang chạy. Mock cho cả ba
 * cùng lúc và luôn khớp nhau; trên hệ thật chúng đến từ ba đường khác nhau và
 * có thể nói khác nhau. Đúng lớp lỗi mà `runtimeStateSource` tồn tại để lộ ra.
 *
 * Case này KHÔNG tự Commission thêm Revision: file này đã cảnh báo rằng làm thế
 * phá giả định của các case khác. Nó Enable trên chính gói đang chạy, đọc, rồi
 * TRẢ LẠI intent ban đầu — một case đọc trạng thái không được để lại trạng thái.
 */
test('T60-303: Overview dựng bảng Programs từ read-back Core thật sau Commission + Enable', async ({ page, request }) => {
  test.setTimeout(180_000)
  const token = await loginAPI(request)

  const runtime = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  const activeRevisionID = runtime.activeRevisionId as string | null
  test.skip(!activeRevisionID, 'controller chưa Commission gói nào — bảng Programs không có gì để đối chiếu')

  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(token) }), 200)
  const owner = (projects.items as JsonObject[]).find((item) => item.activeRevisionId === activeRevisionID)
  expect(owner, `không Project nào khai Revision đang chạy ${activeRevisionID}`).toBeTruthy()
  const projectID = owner!.projectId as string

  /* Nguồn đối chiếu ĐỘC LẬP với giao diện: cùng endpoint mà trang đọc, nhưng
     gọi thẳng. Nếu chỉ so giao diện với chính nó thì một adapter hỏng vẫn xanh. */
  const programsPage = await responseJSON(
    await request.get(`/api/v1/programming/projects/${projectID}/programs`, { headers: readHeaders(token) }), 200)
  const rows = (programsPage.items as JsonObject[]) ?? []
  test.skip(rows.length === 0, 'gói đang chạy không khai Program nào')

  const target = rows[0]
  const targetProgramID = target.programId as string
  const originalIntent = target.desiredEnabled === true

  // Enable — nửa "Enable" của tiêu đề task. Idempotent nếu nó đã bật.
  const enableResponse = await request.put(
    `/api/v1/programming/projects/${projectID}/programs/${targetProgramID}/runtime-intent`,
    { headers: mutationHeaders(token), data: { schemaVersion: '1.0', desiredEnabled: true } })
  await responseJSON(enableResponse, 200)

  try {
    await openWorkspaceRoute(page, `/eng/programming?project=${projectID}`)
    const usernameField = page.getByLabel(/Tên đăng nhập|Username/i)
    if (await usernameField.isVisible().catch(() => false)) {
      await usernameField.fill('admin')
      await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
      await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
      await page.waitForURL(/\/eng\/programming/, { timeout: 15_000 })
    }

    const table = page.getByRole('table')
    await expect(table).toBeVisible({ timeout: 30_000 })

    /* Số DÒNG phải khớp read-back, không nhiều không ít. Thiếu một dòng nghĩa
       là một Program đang chạy mà người vận hành không thấy; thừa một dòng
       nghĩa là màn hình khai một Program không tồn tại trong gói đang chạy. */
    const bodyRows = table.locator('tbody tr')
    await expect(bodyRows).toHaveCount(rows.length)

    /* Và mỗi tên Program của read-back phải xuất hiện đúng như read-back nói.
       Tên đến từ Revision đang chạy chứ không từ Draft — đó là lý do cột này
       tồn tại ở dạng tên chứ không phải UUID. */
    const revision = await responseJSON(
      await request.get(`/api/v1/programming/revisions/${activeRevisionID}`, { headers: readHeaders(token) }), 200)
    const objects = ((revision.snapshot as JsonObject).objects as JsonObject[]) ?? []
    const namesInRevision = new Set(objects
      .filter((object) => object.kind === 'PROGRAM')
      .map((object) => ((object.payload as JsonObject | undefined)?.name as string | undefined) ?? '')
      .filter((name) => name.length > 0))
    const shownNames = (await bodyRows.locator('td').first().allInnerTexts()).join('\n')
    for (const name of namesInRevision) {
      expect(shownNames, `bảng thiếu Program "${name}" của gói đang chạy`).toContain(name)
    }

    /* `AC-PGM01-01` — không UUID ở mặt trước. Kiểm bằng chính ID thật đang có
       trong hệ, không bằng một biểu thức đoán hình dạng UUID. */
    await expect(table).not.toContainText(targetProgramID)
    await expect(table).not.toContainText(activeRevisionID!)

    /* `AC-PGM01-04` — không bịa `0`. Một ô Chu kỳ hoặc Chạy gần nhất chưa đo
       được phải là `—` KÈM lý do; ô có số thì số đó phải khác rỗng. */
    const cycleTexts = await bodyRows.locator('td').nth(2).allInnerTexts()
    for (const text of cycleTexts) {
      expect(text.trim().length, 'ô Chu kỳ rỗng — thiếu cả số lẫn lý do').toBeGreaterThan(0)
    }
  } finally {
    // Trả intent về đúng như lúc bắt đầu: một case đọc không được đổi cấu hình.
    await request.put(
      `/api/v1/programming/projects/${projectID}/programs/${targetProgramID}/runtime-intent`,
      { headers: mutationHeaders(token), data: { schemaVersion: '1.0', desiredEnabled: originalIntent } })
  }
})

/**
 * `T59-817` / `VS-PROG-U15` — phiên mô phỏng trên chính thiết bị, và bằng chứng
 * **zero output**.
 *
 * Khác `T59-815` (lane host, tự dựng Project rồi Check): case này chạy được
 * trên lane TARGET vì nó không tạo gì cả. Nó mở phiên trên đúng Revision đang
 * điều khiển tủ, chạy vài nhịp, rồi dừng — và trước/sau mỗi bước đọc lại trạng
 * thái điều khiển thật.
 *
 * Ranh giới của bằng chứng, nói thẳng: đây là quan sát ở lớp PHẦN MỀM — bảng
 * điểm của chính Core, Active/LKG, và bộ đếm Task. Nó KHÔNG phải phép đo bằng
 * thiết bị trên đầu cực AO/DO/relay. Phần đo vật lý ấy cần người và đồng hồ đo,
 * và `VS-PROG-U15` chưa được đóng cho tới khi có nó.
 */
test('T59-817: phiên mô phỏng trên thiết bị không đổi Active/LKG và không động tới ngõ ra', async ({ request }) => {
  test.setTimeout(180_000)
  const token = await loginAPI(request)

  const capabilities = await responseJSON(
    await request.get('/api/v1/programming/capabilities', { headers: readHeaders(token) }), 200)
  const simulation = (capabilities.workspaceModes as JsonObject | undefined)?.simulation as JsonObject | undefined
  test.skip(simulation?.supported !== true, 'thiết bị chưa cài worker mô phỏng')
  /* Danh sách vai này do server DẪN XUẤT từ ma trận quyền (`T59-816`). Kiểm nó
     ở đây là kiểm phép dẫn xuất đó trên chính thiết bị, không phải trên host. */
  expect(simulation!.mutationRoles).toEqual(['admin'])

  const runtimeBefore = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  const activeRevisionID = runtimeBefore.activeRevisionId as string | null
  test.skip(!activeRevisionID, 'thiết bị chưa Commission gói nào')
  const controllerID = runtimeBefore.controllerId as string

  const projects = await responseJSON(
    await request.get('/api/v1/programming/projects?limit=100', { headers: readHeaders(token) }), 200)
  const owner = (projects.items as JsonObject[]).find((item) => item.activeRevisionId === activeRevisionID)
  expect(owner, 'không Project nào khai Revision đang chạy').toBeTruthy()
  const projectID = owner!.projectId as string
  const latestCheck = owner!.latestCheck as JsonObject | undefined
  test.skip(latestCheck?.state !== 'PASSED' || latestCheck?.revisionId !== activeRevisionID,
    'Revision đang chạy không có Check ĐẠT — không có artifact bất biến để mô phỏng')

  const revision = await responseJSON(
    await request.get(`/api/v1/programming/revisions/${activeRevisionID}`, { headers: readHeaders(token) }), 200)
  const contentHash = revision.contentHash as string

  /* Ảnh chụp TRƯỚC của mọi thứ mô phỏng không được chạm. Ngõ ra đọc từ bảng
     điểm của Core: đó là thứ Core tin rằng nó đang xuất ra. */
  const outputsBefore = await responseJSON(
    await request.get('/api/v1/points', { headers: readHeaders(token) }), 200) as unknown as JsonObject[]
  const outputSnapshot = (items: JsonObject[]) => JSON.stringify(items
    .filter((item) => /^(AO|DO|RLY)/.test(String(item.id ?? '')))
    .map((item) => [item.id, item.value, item.quality, item.overriddenBy ?? null])
    .sort())
  const before = outputSnapshot(outputsBefore as unknown as JsonObject[])
  expect(before, 'thiết bị không khai ngõ ra nào — phép so zero-output vô nghĩa').not.toBe('[]')

  const session = await responseJSON(await request.post('/api/v1/programming/simulation/sessions', {
    headers: mutationHeaders(token),
    data: {
      schemaVersion: '1.0', controllerId: controllerID, projectId: projectID,
      sourceDraftRevisionId: activeRevisionID, sourceContentSha256: contentHash
    }
  }), 201)
  const sessionID = session.sessionId as string
  expect(session.state).toBe('PAUSED')
  expect(session.workerVersion).toBeTruthy()

  let etag = session.etag as string
  try {
    for (let tick = 1; tick <= 3; tick += 1) {
      const stepped = await responseJSON(await request.post(
        `/api/v1/programming/simulation/sessions/${sessionID}/actions`,
        { headers: mutationHeaders(token, { 'if-match': etag }),
          data: { schemaVersion: '1.0', action: 'STEP_CYCLE' } }), 200)
      etag = stepped.etag as string
      // Đồng hồ ẢO tiến đúng một base tick mỗi nhịp; đồng hồ thật không liên quan.
      expect(stepped.virtualTimeMs).toBe(String(tick * 1000))
      expect(stepped.observationSequence).toBe(String(tick))
    }

    const frame = await responseJSON(await request.get(
      `/api/v1/programming/simulation/sessions/${sessionID}/observations`,
      { headers: readHeaders(token) }), 200)
    expect((frame.observations as unknown[]).length).toBeGreaterThan(0)

    // Trong lúc phiên đang chạy: Active/LKG và ngõ ra phải đứng yên.
    const runtimeDuring = await responseJSON(
      await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
    expect(runtimeDuring.activeRevisionId).toBe(activeRevisionID)
    expect(runtimeDuring.lkgRevisionId).toBe(runtimeBefore.lkgRevisionId)
    const outputsDuring = await responseJSON(
      await request.get('/api/v1/points', { headers: readHeaders(token) }), 200) as unknown as JsonObject[]
    expect(outputSnapshot(outputsDuring), 'ngõ ra đổi trong lúc mô phỏng').toBe(before)
  } finally {
    await request.delete(`/api/v1/programming/simulation/sessions/${sessionID}`,
      { headers: mutationHeaders(token, { 'if-match': etag }) })
  }

  /* Slot quota phải được nhả sau khi dừng. Đây là phép kiểm rò tiến trình mà
     một client HTTP làm được: nếu worker cũ còn sống, phiên thứ hai nhận
     `PRG-SIM-QUOTA` chứ không mở được. */
  const second = await request.post('/api/v1/programming/simulation/sessions', {
    headers: mutationHeaders(token),
    data: {
      schemaVersion: '1.0', controllerId: controllerID, projectId: projectID,
      sourceDraftRevisionId: activeRevisionID, sourceContentSha256: contentHash
    }
  })
  const secondBody = await second.text()
  expect(second.status(), secondBody).toBe(201)
  const secondSession = JSON.parse(secondBody) as JsonObject
  await request.delete(`/api/v1/programming/simulation/sessions/${secondSession.sessionId as string}`,
    { headers: mutationHeaders(token, { 'if-match': secondSession.etag as string }) })

  const runtimeAfter = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  expect(runtimeAfter.activeRevisionId).toBe(activeRevisionID)
  const outputsAfter = await responseJSON(
    await request.get('/api/v1/points', { headers: readHeaders(token) }), 200) as unknown as JsonObject[]
  expect(outputSnapshot(outputsAfter), 'ngõ ra đổi sau phiên mô phỏng').toBe(before)
})

/**
 * `T59-817` / `VS-PROG-U15` — bốn mutation mô phỏng, ba vai không đủ quyền, đo
 * trên chính thiết bị.
 *
 * `VS-PROG-U15` đòi "viewer/operator mutations 403". Case này thêm `engineer`
 * vào phép đo, và đó là vai QUAN TRỌNG nhất trong ba: nó có `program.edit`, nên
 * trước `T59-816` nó đi qua được lớp uỷ quyền ngoài rồi mới bị lớp trong từ
 * chối. Hai lớp nói hai điều khác nhau về cùng một ranh giới là trạng thái tệ
 * nhất, vì bảng route — thứ người ta đọc để biết ai bị chặn — khi ấy nói sai.
 */
test('T59-817: viewer/operator/engineer đều không mở được phiên mô phỏng trên thiết bị', async ({ request, playwright }) => {
  test.setTimeout(180_000)
  const token = await loginAPI(request)

  const capabilities = await responseJSON(
    await request.get('/api/v1/programming/capabilities', { headers: readHeaders(token) }), 200)
  const simulation = (capabilities.workspaceModes as JsonObject | undefined)?.simulation as JsonObject | undefined
  test.skip(simulation?.supported !== true, 'thiết bị chưa cài worker mô phỏng')

  const runtime = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  const controllerID = runtime.controllerId as string

  const suffix = Date.now().toString(36)
  const accounts = [
    { role: 'viewer', username: `simv${suffix}` },
    { role: 'operator', username: `simo${suffix}` },
    { role: 'engineer', username: `sime${suffix}` },
  ]
  const password = 'SimProbe#2026'
  const created: string[] = []

  try {
    for (const account of accounts) {
      const response = await request.post('/api/v1/users', {
        headers: mutationHeaders(token),
        data: { username: account.username, role: account.role, password }
      })
      expect(response.status(), await response.text()).toBe(201)
      created.push(account.username)
    }

    for (const account of accounts) {
      const context = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL })
      try {
        const login = await responseJSON(await context.post('/api/v1/auth/login', {
          data: { username: account.username, password }
        }), 200)
        const roleToken = login.token as string

        /* Bốn mutation của họ Simulation. Đếm ở đây thay vì viết tay từng dòng:
           thêm một route mới mà quên bảo vệ sẽ không tự lọt qua case này —
           nhưng nó cũng không tự bị bắt, nên `security_matrix_test.go` mới là
           phép đếm đầy đủ. Case này là phép đo TRÊN THIẾT BỊ cho cùng ranh giới. */
        const attempts: { method: string; path: string; data?: JsonObject }[] = [
          { method: 'post', path: '/api/v1/programming/simulation/sessions',
            data: { schemaVersion: '1.0', controllerId: controllerID, projectId: PROGRAM_ID,
              sourceDraftRevisionId: PROGRAM_ID, sourceContentSha256: 'a'.repeat(64) } },
          { method: 'delete', path: `/api/v1/programming/simulation/sessions/${PROGRAM_ID}` },
          { method: 'post', path: `/api/v1/programming/simulation/sessions/${PROGRAM_ID}/actions`,
            data: { schemaVersion: '1.0', action: 'RUN' } },
          { method: 'put', path: `/api/v1/programming/simulation/sessions/${PROGRAM_ID}/inputs/X`,
            data: { schemaVersion: '1.0', dataType: 'REAL', value: 1 } },
        ]

        for (const attempt of attempts) {
          const headers = {
            authorization: `Bearer ${roleToken}`,
            'content-type': 'application/json',
            'x-idempotency-key': nextUUID('92000000'),
            'x-correlation-id': `t59817-rbac-${suffix}`,
            'if-match': '"1"',
          }
          const response = attempt.method === 'delete'
            ? await context.delete(attempt.path, { headers })
            : attempt.method === 'put'
              ? await context.put(attempt.path, { headers, data: attempt.data })
              : await context.post(attempt.path, { headers, data: attempt.data })
          const body = await response.text()
          expect(response.status(),
            `${account.role} ${attempt.method.toUpperCase()} ${attempt.path}: ${body}`).toBe(403)
          /* 403 phải tới TRƯỚC khi chạm store: nếu handler đã chạy rồi mới từ
             chối, một vai không đủ quyền vẫn biết được phiên nào tồn tại. */
          expect(body, `${account.role}: envelope lộ chi tiết phiên`).not.toContain('sessionId')
        }
      } finally {
        await context.dispose()
      }
    }
  } finally {
    /* Tài khoản bỏ lại trên một controller dùng chung là quyền truy cập thừa,
       không phải rác vô hại. Dọn trong `finally` để nó vẫn chạy khi assert đỏ. */
    for (const username of created) {
      const removed = await request.delete(`/api/v1/users/${username}`, { headers: mutationHeaders(token) })
      expect([200, 204], `không dọn được tài khoản tạm ${username}`).toContain(removed.status())
    }
  }
})

/* ==================================================================== *
 * `T61-504` / `ISS-PGM04-17` — vòng đời PGM-04 trên BACKEND THẬT.       *
 *                                                                      *
 * Lane `T59-505` trước lát này đã phủ create/edit/seal/version/         *
 * deprecate, nhưng **không gọi `/programming/library-usages` lần nào**, *
 * không đọc `compatibility`, và không đi đường Chèn. Ba thứ ấy là ba    *
 * read model mà `T61-101`/`T61-104`/`T61-406` dựng lên, và cho tới đây  *
 * chúng chỉ từng chạy trên fixture của FE — tức chưa ai biết máy chủ    *
 * thật trả gì.                                                         *
 * ==================================================================== */

const PGM04_ENTRY_ID = '86666666-6666-4666-8666-666666666666'
const PGM04_OBJECT_ID = '87777777-7777-4777-8777-777777777777'

/**
 * `interface` mang CẢ HAI hình dạng, và đó là chủ ý.
 *
 * Compiler đọc `inputs`/`returnType`; lớp HTTP phân giải chữ ký hiển thị từ
 * `dispatch`/`category`/`ports` (`parseLibrarySignature`). Gửi thiếu vế thứ hai
 * thì entry PROJECT về tới FE **không có** `signature`, và cả màn hình rơi vào
 * `SIGNATURE_UNAVAILABLE` — lúc ấy mọi khẳng định về đường Chèn đo một khối
 * không chèn được, tức đo nhầm thứ.
 */
const PGM04_INTERFACE = {
  inputs: [{ name: 'X', type: 'REAL' }],
  returnType: 'REAL',
  dispatch: 'FUNC_TABLE',
  polymorphic: false,
  typedPortNames: [],
  category: 'math',
  labelVi: 'Tỉ lệ tuyến tính',
  labelEn: 'Linear scale',
  allowedTypes: ['REAL'],
  defaultType: 'REAL',
  ports: [
    { name: 'X', direction: 'INPUT', dataType: 'REAL' },
    { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
  ]
}

const PGM04_ENTRY_SOURCE = `FUNCTION SCALE_PGM04 : REAL
VAR_INPUT
  X : REAL;
END_VAR
SCALE_PGM04 := X * 2.0;
END_FUNCTION
`

const PGM04_OBJECT_SOURCE = `PROGRAM AHU_SCALE
VAR
  Y : REAL;
END_VAR
Y := SCALE_PGM04(1.0);
END_PROGRAM
`

/**
 * Mọi hàng PROJECT của entry, ĐÚNG như `GET /libraries` trả về.
 *
 * Route này trả **mọi library revision** của Project (DRAFT + PUBLISHED +
 * DEPRECATED), nên sau một lần lên version sẽ có hai hàng cùng `entryId`. Gộp
 * chúng là việc của lớp trình bày (`groupLibraryEntries`); ở đây phải nhìn thấy
 * nguyên trạng, nếu không một khẳng định "đúng một hàng" sẽ đỏ vì lý do sai.
 */
async function readProjectEntries(
  request: APIRequestContext, token: string, projectID: string
): Promise<JsonObject[]> {
  const page = await responseJSON(
    await request.get(
      `/api/v1/programming/libraries?projectId=${projectID}&scope=PROJECT&q=SCALE_PGM04`,
      { headers: readHeaders(token) }
    ),
    200
  )
  const items = page.items as JsonObject[]
  expect(items.length, `thư viện PROJECT không có entry nào: ${JSON.stringify(page)}`).toBeGreaterThan(0)
  return items
}

/** Lấy đúng MỘT hàng — dùng khi entry mới chỉ có một version. */
async function readProjectEntry(
  request: APIRequestContext, token: string, projectID: string
): Promise<JsonObject> {
  const items = await readProjectEntries(request, token, projectID)
  expect(items, 'entry PROJECT có nhiều hơn một version ở bước này').toHaveLength(1)
  return items[0]
}

test('T61-504: PGM-04 trên backend thật — thẻ, Used-In, ba trạng thái tương thích, guard Chèn và 0 mutation', async ({ page, request }) => {
  test.setTimeout(180_000)
  const startedAt = Date.now()
  const token = await loginAPI(request)

  const created = await responseJSON(
    await request.post('/api/v1/programming/projects', {
      headers: mutationHeaders(token),
      data: { schemaVersion: '1.0', name: 'AHU T61-504 real', description: 'PGM-04 lifecycle real-backend' }
    }),
    201
  )
  const projectID = (created.resource as JsonObject).projectId as string
  const draftID = (created.resource as JsonObject).draftRevisionId as string

  /* ---- 1) Tạo entry PROJECT kèm metadata VÀ THẺ ---------------------- */
  const upsert = await responseJSON(
    await request.post(`/api/v1/programming/projects/${projectID}/library/entries`, {
      headers: mutationHeaders(token, { 'if-match': created.etag as string }),
      data: {
        schemaVersion: '1.0', entryId: PGM04_ENTRY_ID, kind: 'FUNCTION', name: 'SCALE_PGM04',
        language: 'ST', source: PGM04_ENTRY_SOURCE, interface: PGM04_INTERFACE, dependencies: [],
        category: 'math', description: 'Khối tỉ lệ của dự án',
        /* Cố ý gửi bẩn: hoa/thường lẫn lộn, khoảng trắng thừa, trùng lặp, sai
           thứ tự. Máy chủ CHUẨN HOÁ (`NormalizeLibraryTags`), nên kết quả đọc
           lại là bằng chứng phép chuẩn hoá ấy CHẠY THẬT — một fixture FE trả
           đúng mảng vừa gửi sẽ không phân biệt được. */
        tags: ['AHU', '  Tỉ   Lệ  ', 'ahu']
      }
    }),
    200
  )
  expect(upsert.etag).not.toBe(created.etag)

  const draftEntry = await readProjectEntry(request, token, projectID)
  expect(draftEntry.tags, 'máy chủ không chuẩn hoá thẻ').toEqual(['ahu', 'tỉ lệ'])
  expect(draftEntry.category).toBe('math')
  expect(draftEntry.libraryState).toBe('DRAFT')
  /* Chữ ký PHẢI phân giải được, nếu không mọi khẳng định về đường Chèn phía
     dưới đang đo một khối bị chặn vì lý do khác. */
  expect(draftEntry.signature, 'chữ ký không phân giải được từ `interface`').toBeTruthy()

  /* ---- 2) Tương thích: UNKNOWN khi chưa Commission gì --------------- */
  /* `openapi.yaml` ghi `UNKNOWN` là giá trị MẶC ĐỊNH, không phải lỗi: chưa có
     Revision vận hành nào thì không có gì để so, và nói "tương thích" lúc ấy là
     một khẳng định không có cơ sở. */
  expect(draftEntry.compatibility).toEqual({
    state: 'UNKNOWN',
    requiredVersion: null,
    availableVersion: null,
    reason: expect.stringContaining('Chưa có Revision vận hành nào pin')
  })

  /* ---- 3) POU dùng entry, seal, check, commission -------------------- */
  const savedDraft = await responseJSON(
    await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
      headers: mutationHeaders(token, { 'if-match': upsert.etag as string }),
      data: {
        schemaVersion: '1.0', baseRevisionId: draftID,
        operations: [
          {
            op: 'upsertObject',
            object: {
              objectId: PGM04_OBJECT_ID, kind: 'PROGRAM', name: 'AHU_SCALE', language: 'ST',
              source: PGM04_OBJECT_SOURCE,
              /* CHÍNH mảng này là nguồn của `library_usages`: đường Seal đổi nó
                 thành bản ghi usage. Không khai thì Used-In rỗng và cả case
                 dưới đo một bảng trống. */
              dependencies: [PGM04_ENTRY_ID]
            }
          },
          { op: 'upsertProgram', program: { programId: PGM04_OBJECT_ID, objectId: PGM04_OBJECT_ID, periodMs: 1000 } }
        ]
      }
    }),
    200
  )

  const sealed = await sealAndCheck(request, token, projectID, draftID, savedDraft.etag as string, 'T61-504 R1')

  const publishedEntry = await readProjectEntry(request, token, projectID)
  expect(publishedEntry.libraryState, 'Seal phải publish library DRAFT cùng transaction').toBe('PUBLISHED')
  const libraryRevisionID = publishedEntry.libraryRevisionId as string
  const publishedVersion = publishedEntry.libraryVersion as string

  /* Hai nhóm ảnh hưởng do chính Revision này tạo ra phải CÓ MẶT:
     `programSet` (thêm chương trình) và `controlLibrary` (pin thư viện mới).
     `cutover` phụ thuộc producer mode toàn cục trước test: nếu một case trước đã
     chuyển sang PROGRAM_ONLY thì nhóm này đúng là NONE. Project này không công
     bố Signal nào nên `publishedSignals` cũng vắng. Đọc current Active ngay
     trước Commission để CAS không phụ thuộc test này chạy riêng hay sau T59-505;
     backend sẽ chiếu diff khác Project về đúng ngữ nghĩa thay mới toàn bộ. */
  const runtimeBeforeCommission = await responseJSON(
    await request.get('/api/v1/programming/runtime', { headers: readHeaders(token) }), 200)
  const fromRevisionID = (runtimeBeforeCommission.activeRevisionId as string | null) ?? 'none'
  await commission(request, token, 'none', sealed.revisionID, sealed.checkID,
    ['programSet', 'controlLibrary'], fromRevisionID)

  /* ---- 4) Used-In đọc từ store THẬT --------------------------------- */
  /* `isActive` suy từ `commission_records.result='SUCCEEDED'` — một bản ghi được
     ghi trên đường Commission, KHÔNG cùng lúc với phản hồi của operation. Đọc
     một phát rồi khẳng định là đua với chính đường ghi ấy, nên chờ có điều
     kiện. Ngưỡng hữu hạn: nếu nó không bao giờ thành `true` thì đó là lỗi thật
     và test phải đỏ, không được nới thành "đọc sao cũng được". */
  let usage: JsonObject = {}
  await expect.poll(async () => {
    usage = await responseJSON(
      await request.get(
        `/api/v1/programming/library-usages?libraryRevisionId=${libraryRevisionID}`
        + `&entryId=${PGM04_ENTRY_ID}&scope=PROJECT`,
        { headers: readHeaders(token) }
      ),
      200
    )
    const items = (usage.sealed as JsonObject).items as JsonObject[]
    return items.length === 1 && items[0].isActive === true
  }, {
    message: 'Used-In không đánh dấu Revision vừa Commission là bản đang chạy',
    timeout: 20_000
  }).toBe(true)
  /* `availability` là trường quyết định của read model này: `UNAVAILABLE` nghĩa
     là CHƯA ĐO ĐƯỢC, và một bề mặt in `0` cho nó là cách một khối bị gỡ trong
     khi nó đang điều khiển tủ. Ở đây máy chủ đo được, nên phải nói ra. */
  expect(usage.availability).not.toBe('UNAVAILABLE')
  const sealedUsage = usage.sealed as JsonObject
  expect(sealedUsage.count, `Used-In không thấy POU vừa seal: ${JSON.stringify(usage)}`).toBe(1)
  expect(sealedUsage.truncated).toBe(false)
  expect(sealedUsage.items).toEqual([
    expect.objectContaining({
      projectId: projectID,
      revisionId: sealed.revisionID,
      objectId: PGM04_OBJECT_ID,
      requiredVersion: publishedVersion,
      usageKind: 'CALL',
      isActive: true
    })
  ])

  /* ---- 5) Tương thích: COMPATIBLE khi pin == PUBLISHED mới nhất ------ */
  const compatibleEntry = await readProjectEntry(request, token, projectID)
  expect(compatibleEntry.compatibility).toEqual({
    state: 'COMPATIBLE',
    requiredVersion: publishedVersion,
    availableVersion: publishedVersion,
    reason: null
  })

  /* ---- 6) Tương thích: REQUIRES_MIGRATION sau khi publish version mới */
  /* Sửa entry sinh version DRAFT mới; Seal kế tiếp publish nó. KHÔNG Commission
     bản mới, nên Revision đang vận hành vẫn pin version cũ — đúng tình huống mà
     `REQUIRES_MIGRATION` mô tả. */
  const editEtag = (await responseJSON(
    await request.get(`/api/v1/programming/projects/${projectID}`, { headers: readHeaders(token) }), 200
  )).etag as string
  const upsertV2 = await responseJSON(
    await request.post(`/api/v1/programming/projects/${projectID}/library/entries`, {
      headers: mutationHeaders(token, { 'if-match': editEtag }),
      data: {
        schemaVersion: '1.0', entryId: PGM04_ENTRY_ID, kind: 'FUNCTION', name: 'SCALE_PGM04',
        language: 'ST', source: PGM04_ENTRY_SOURCE.replace('X * 2.0', 'X * 3.0'),
        interface: PGM04_INTERFACE, dependencies: [],
        category: 'math', description: 'Khối tỉ lệ của dự án (bản 2)', tags: ['ahu', 'tỉ lệ']
      }
    }),
    200
  )
  const savedDraftV2 = await responseJSON(
    await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
      headers: mutationHeaders(token, { 'if-match': upsertV2.etag as string }),
      data: {
        schemaVersion: '1.0', baseRevisionId: sealed.revisionID,
        operations: [
          {
            op: 'upsertObject',
            object: {
              objectId: PGM04_OBJECT_ID, kind: 'PROGRAM', name: 'AHU_SCALE', language: 'ST',
              source: PGM04_OBJECT_SOURCE.replace('1.0', '2.0'),
              dependencies: [PGM04_ENTRY_ID]
            }
          }
        ]
      }
    }),
    200
  )
  await sealAndCheck(request, token, projectID, sealed.revisionID, savedDraftV2.etag as string, 'T61-504 R2')

  /* Nay có HAI hàng cùng `entryId` (1.0.0 đang chạy và bản mới vừa publish).
     `compatibility` là thuộc tính của ENTRY chứ không của từng hàng, nên cả hai
     phải nói cùng một câu — kiểm điều đó luôn, vì hai hàng bất đồng về mức
     tương thích là đúng thứ làm người đọc không biết tin hàng nào. */
  const migratingRows = await readProjectEntries(request, token, projectID)
  expect(migratingRows.length, 'lên version không sinh hàng thứ hai').toBe(2)
  const migratingEntry = migratingRows.find((row) => row.libraryVersion !== publishedVersion)!
  expect(migratingEntry, `không thấy version mới ngoài ${publishedVersion}`).toBeTruthy()
  expect(migratingRows.map((row) => (row.compatibility as JsonObject).state))
    .toEqual(['REQUIRES_MIGRATION', 'REQUIRES_MIGRATION'])
  const migratingCompatibility = migratingEntry.compatibility as JsonObject
  expect(migratingCompatibility.state,
    `tương thích không chuyển sang REQUIRES_MIGRATION: ${JSON.stringify(migratingCompatibility)}`)
    .toBe('REQUIRES_MIGRATION')
  expect(migratingCompatibility.requiredVersion).toBe(publishedVersion)
  expect(migratingCompatibility.availableVersion).not.toBe(publishedVersion)
  /* Lý do phải nói ra CẢ HAI version: "cần migrate" mà không nói từ đâu sang
     đâu là một câu người vận hành không hành động được. */
  expect(String(migratingCompatibility.reason)).toContain(String(migratingCompatibility.requiredVersion))
  expect(String(migratingCompatibility.reason)).toContain(String(migratingCompatibility.availableVersion))

  /* ---- 7) Giao diện: đọc thật, và KHÔNG ghi gì ----------------------- */
  const serverFailures: string[] = []
  const failedRequests: string[] = []
  const consoleErrors: string[] = []
  const programmingWrites: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 500) {
      serverFailures.push(`${response.status()} ${new URL(response.url()).pathname}`)
    }
  })
  page.on('requestfailed', (failed) => failedRequests.push(new URL(failed.url()).pathname))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (outgoing) => {
    const url = new URL(outgoing.url())
    if (!url.pathname.startsWith('/api/v1/programming')) return
    if (outgoing.method() === 'GET') return
    programmingWrites.push(`${outgoing.method()} ${url.pathname}`)
  })

  await page.goto(`/eng/programming/projects/${projectID}/library?scope=PROJECT`)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectID}/library`))

  /* ANTI-MOCK, vế dữ liệu: khối hiện trên màn hình mang `projectId` do máy chủ
     sinh trong CHÍNH lần chạy này. Một route bị chặn không thể biết trước giá
     trị ấy, nên khẳng định này không thể xanh trên dữ liệu dựng sẵn. */
  const card = page.getByTestId('library-block-card').filter({ hasText: 'SCALE_PGM04' })
  await expect(card).toHaveCount(1)
  await card.click()

  /* Used-In trên giao diện, lấy từ cùng read model vừa kiểm qua API. */
  await page.getByRole('tab', { name: 'Nơi sử dụng' }).click()
  const usagePanel = page.getByRole('region', { name: 'Nơi sử dụng' })
  await expect(usagePanel.getByText('1 nơi dùng')).toBeVisible()
  /* Khay này có HAI mục cho cùng một POU, và đó là đúng: một mục ĐÃ NIÊM PHONG
     (mang tên Project ở đầu, vì nó có thể thuộc Project khác) và một mục trong
     BẢN NHÁP đang mở. Gộp hai mục ấy lại sẽ giấu mất khác biệt "đang chạy" với
     "mới sửa, chưa Seal" — đúng khác biệt người vận hành cần trước khi sửa một
     khối. Nên phải hỏi ĐÍCH DANH từng mục. */
  const sealedLink = usagePanel.getByRole('link', { name: `AHU T61-504 real › AHU_SCALE` })
  const draftLink = usagePanel.getByRole('link', { name: 'AHU_SCALE', exact: true })
  await expect(sealedLink).toBeVisible()
  await expect(draftLink).toBeVisible()
  /* Deep-link phải mang ĐÚNG `objectId`, không phải "POU đầu tiên": một liên
     kết trỏ gần đúng đưa người vận hành tới một chương trình khác. */
  await expect(sealedLink).toHaveAttribute('href', new RegExp(PGM04_OBJECT_ID))
  await expect(draftLink).toHaveAttribute('href', new RegExp(PGM04_OBJECT_ID))

  /* `T61-406` — guard Chèn trên DỮ LIỆU THẬT: gói đang vận hành pin version cũ,
     nên Chèn phải bị khoá và nói ra đúng version cần migrate. Đây là lần đầu
     luật ấy được đo trên trạng thái do máy chủ tính, không phải fixture. */
  await page.getByRole('tab', { name: 'Chi tiết' }).click()
  const insert = page.getByRole('button', { name: /Chèn vào POU/ })
  await expect(insert).toBeDisabled()
  await expect(page.getByTestId('library-insert-reason'))
    .toHaveAttribute('data-block', 'REQUIRES_MIGRATION')
  await expect(page.getByTestId('library-insert-reason')).toContainText(publishedVersion)

  /* ZERO MUTATION: cả phiên duyệt PGM-04 ở trên không phát một lệnh ghi nào. */
  expect(programmingWrites, 'PGM-04 phát lệnh ghi trên đường chỉ đọc').toEqual([])
  expect([...new Set(serverFailures)].sort(), 'HTTP 5xx trên lane real').toEqual([])
  expect([...new Set(failedRequests)].sort(), 'request thất bại trên lane real').toEqual([])
  expect(consoleErrors, 'console.error trên lane real').toEqual([])

  /* Bằng chứng phải ĐỌC ĐƯỢC trong bản ghi lần chạy: lớp evidence, cấu hình và
     thời lượng. Một dòng "PASS" không nói nó pass trên cái gì là một dòng không
     dùng được để ký. */
  console.log(
    `[T61-504] evidence=HOST/REAL-BACKEND project=${projectID} libraryRevision=${libraryRevisionID}`
    + ` pinned=${publishedVersion} available=${String(migratingCompatibility.availableVersion)}`
    + ` duration=${Date.now() - startedAt}ms`
  )
})

/**
 * Bỏ chú thích, giữ lại phần MÃ.
 *
 * Chỉ bỏ khối `/* … *\/` và những dòng mà ký tự đầu tiên (sau thụt lề) là `//`
 * hay `*`. Cố ý KHÔNG bỏ `//` ở giữa dòng: một `'http://…'` hay một regex
 * `/\/login$/` sẽ làm phép bỏ ấy nuốt nốt phần còn lại của dòng, và một lời gọi
 * nằm sau đó sẽ biến mất khỏi tầm quét — tức cổng tự nới chính nó.
 */
function codeOnly(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return withoutBlocks
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

/*
`T61-504` / `ISS-PGM04-17` — "fail test nếu route PGM-04 bị intercept/mocked".

Lane này là lane BACKEND THẬT: giá trị duy nhất của nó là mọi phản hồi đến từ Go
+ Core simulator production. Một `page.route(...)` lọt vào đây không làm test đỏ
— nó làm test **xanh vì lý do sai**, và không có dấu hiệu nào trên bản ghi lần
chạy để người ký nhận ra. Một dòng chú thích "spec này tuyệt đối không mock"
không phải một cổng; nó là một lời hứa.

Case này đọc THẲNG tệp spec và cấm mọi API chặn request của Playwright. Nó bổ
sung — không thay thế — vế dữ liệu ở case trên: khối hiện trên màn hình mang
`projectId` do máy chủ sinh trong chính lần chạy ấy, thứ một route dựng sẵn
không thể biết trước.
*/
test('T61-504: lane real-backend không được chặn request ở bất kỳ đâu', async ({}, testInfo) => {
  const specPath = fileURLToPath(new URL('./programming-real.spec.ts', import.meta.url))
  const source = codeOnly(readFileSync(specPath, 'utf8'))
  /* Ghép chuỗi lúc chạy chứ không viết nguyên văn, và quét trên phần MÃ đã bỏ
     chú thích.
  
     Bản đầu viết thẳng `'page' + '.route('` vào mảng và quét cả tệp, nên chính
     case này làm mình đỏ — hai lần: một vì mảng, một vì đoạn chú thích nói về
     nó. Bài học không phải "viết khéo hơn": phép quét phải nói về **lời gọi**,
     không về sự có mặt của một dãy ký tự. Một chú thích nhắc tên API không chặn
     request nào cả. */
  const call = '('
  const forbidden = [
    `page.route${call}`, `page.routeFromHAR${call}`,
    `page.routeWebSocket${call}`, `context.route${call}`
  ]
  const found = forbidden.filter((api) => source.includes(api))
  expect(found, 'lane real-backend có API chặn request — bằng chứng không còn là bằng chứng').toEqual([])

  /* Và neo chống-tautology: danh sách trên phải nói về những API CÓ THẬT. Nếu
     một ngày ai đó gõ sai tên hàm thì `found` vẫn rỗng và case này xanh mà
     không cấm gì. `playwright.config.ts` của lane MOCK dùng đúng những API ấy,
     nên nó là vế đối chứng sẵn có. */
  const mockSpec = codeOnly(
    readFileSync(fileURLToPath(new URL('./programming.spec.ts', import.meta.url)), 'utf8')
  )
  expect(forbidden.some((api) => mockSpec.includes(api)),
    'không API nào trong danh sách cấm còn tồn tại — danh sách đã lỗi thời').toBe(true)

  await testInfo.attach('t61-504-anti-mock', {
    body: `evidence=HOST/REAL-BACKEND\nforbiddenApis=${forbidden.join(',')}\nfound=${found.join(',') || '(none)'}`,
    contentType: 'text/plain'
  })
})
