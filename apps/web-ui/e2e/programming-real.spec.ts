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
  if (await boundary.isVisible().catch(() => false)) {
    await page.reload()
  }
  await expect(boundary, 'route vẫn hỏng sau một lần nạp lại').toHaveCount(0)
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
  expectedPresent: string[] = []
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

  const expectedActiveRevisionId = fromRevisionID === 'none' ? null : fromRevisionID
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

test('T59-505: lifecycle thật đến Restore và UI fail-closed không biến invalid thành 0', async ({ page, request }) => {
  test.setTimeout(120_000)
  const token = await loginAPI(request)

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
        dependencies: []
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
      libraryState: 'DRAFT'
    })
  ])

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
          op: 'upsertBinding',
          binding: {
            bindingId: BINDING_ID,
            variableId: VARIABLE_ID,
            point: { category: 'LOCAL', pointId: 'UI-01' },
            direction: 'READ',
            dataType: 'REAL',
            writable: false,
            qualityPolicy: 'REQUIRE_GOOD'
          }
        }
      ]
    }
  })
  const savedR1 = await responseJSON(savedR1Response, 200)

  const projectReadbackResponse = await request.get(`/api/v1/programming/projects/${projectID}`, {
    headers: readHeaders(token)
  })
  const projectReadback = await responseJSON(projectReadbackResponse, 200)
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
  page.on('requestfailed', (requestFailed) => failedRequests.push(new URL(requestFailed.url()).pathname))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  // Deep link buộc UI dùng chính JWT thật; AuthProvider phải quay lại nguyên
  // route sau login, không được dựa vào token của APIRequestContext phía trên.
  await page.goto('/eng/programming/runtime?tab=watch')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin123')
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
  const projectLibraryEntry = page.getByRole('list', { name: 'Danh sách khối Thư viện điều khiển' })
    .getByRole('button', { name: /SCALE_LIN\s+PROJECT\s+FUNCTION/ })
  await expect(projectLibraryEntry).toBeVisible()
  await projectLibraryEntry.click()
  // Phải soi trong đúng panel "Chi tiết": danh sách bên trái hiện
  // "rev-a.1 · PUBLISHED" cho cả 41 khối SYSTEM, nên một locator toàn trang
  // khớp 42 phần tử và fail ở strict mode — nó cũng sẽ xanh ngay cả khi entry
  // PROJECT không hề được chọn, tức là một khẳng định không kiểm gì cả.
  const libraryDetail = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Chi tiết', level: 2 }) })
  await expect(libraryDetail.getByText(/· PUBLISHED$/)).toBeVisible()

  // F-P59-UI-001: authoring Library phải đi qua mutation + read-back thật.
  // Entry đã publish mở Draft version mới; payload edit phải GIỮ interface
  // canonical mà GET /libraries trả về — thay nó bằng `{inputs:[]}` làm mất
  // contract POU khỏi content hash dù người dùng chỉ sửa source.
  await page.getByRole('button', { name: 'Sửa — tạo phiên bản mới' }).click()
  const editedLibrarySource =
    'FUNCTION SCALE_LIN : REAL\nVAR_INPUT X : REAL; END_VAR\nSCALE_LIN := X + 1.0;\nEND_FUNCTION\n'
  await page.getByLabel('Mã nguồn ST').fill(editedLibrarySource)
  const uiLibraryMutationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' &&
      url.pathname === `/api/v1/programming/projects/${projectID}/library/entries`
  })
  await page.getByRole('button', { name: 'Lưu vào bản nháp thư viện' }).click()
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
    .getByRole('button', { name: /SCALE_LIN\s+PROJECT\s+FUNCTION/ })).toBeVisible()
  await assertMobileSurface(page, 'Library')

  await mobileNavigation.getByRole('button', { name: 'Thêm đích Lập trình' }).click()
  await page.getByTestId('programming-mobile-more').getByRole('link', { name: 'Điểm & Ánh xạ' }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  await expect(page.getByRole('row', { name: /RETURN_AIR_TEMP/ })).toBeVisible()
  await assertMobileSurface(page, 'Mapping + Published Signal')

  console.info(
    `[T59-505] browser evidence: HTTP>=500=${serverFailures.length} ` +
    `(${[...new Set(serverFailures)].join(', ')}); requestfailed=${failedRequests.length}; ` +
    `console.error=${consoleErrors.length} (expected 0)`
  )
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
