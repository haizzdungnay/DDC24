import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'

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
const SOURCE_R1 = `PROGRAM AHU_MAIN
VAR_INPUT
  SupplyTemp : REAL;
END_VAR
VAR_OUTPUT
  Fan : BOOL;
END_VAR
Fan := TRUE;
END_PROGRAM
`
const SOURCE_R2 = SOURCE_R1.replace('Fan := TRUE;', 'Fan := FALSE;')

type JsonObject = Record<string, unknown>

let requestSequence = 0

function nextUUID(prefix = '90000000'): string {
  requestSequence += 1
  return `${prefix}-0000-4000-8000-${String(requestSequence).padStart(12, '0')}`
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
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await request.get(`/api/v1/programming/operations/${operationID}`, { headers: readHeaders(token) })
    const operation = await responseJSON(response, 200)
    if (operation.state === 'SUCCEEDED') return operation
    if (['FAILED', 'ROLLED_BACK'].includes(String(operation.state))) {
      throw new Error(`Operation ${operationID} kết thúc ${String(operation.state)}: ${JSON.stringify(operation)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Operation ${operationID} không kết thúc trong 10 giây`)
}

async function waitForProgramState(
  request: APIRequestContext,
  token: string,
  projectID: string,
  desiredEnabled: boolean,
  runtimeState: 'RUNNING' | 'DISABLED'
): Promise<JsonObject> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request.get(`/api/v1/programming/projects/${projectID}/programs`, { headers: readHeaders(token) })
    const page = await responseJSON(response, 200)
    const item = (page.items as JsonObject[]).find((candidate) => candidate.programId === PROGRAM_ID)
    if (item?.desiredEnabled === desiredEnabled && item.runtimeState === runtimeState) return item
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Program không đạt desired=${desiredEnabled}, runtime=${runtimeState}`)
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
        interface: { inputs: [{ name: 'X', type: 'REAL' }], returnType: 'REAL' },
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

  const signalsResponse = await request.get('/api/v1/programming/runtime/signals', { headers: readHeaders(token) })
  const signals = await responseJSON(signalsResponse, 200)
  expect(signals.producerState).toBe('READY')
  expect(signals.activeRevisionId).toBe(r1.revisionID)
  const signal = (signals.items as JsonObject[]).find((candidate) => candidate.signalId === SIGNAL_ID)
  expect(signal).toMatchObject({
    name: 'SUPPLY_TEMP',
    producerProgramId: PROGRAM_ID,
    valid: false,
    value: null,
    quality: 'BAD',
    freshness: 'UNAVAILABLE',
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

  // Core simulator cố ý không dựng regular process-I/O socket; màn Watch phải
  // hiện offline thay vì bịa Point value. Đây là 503 Programming duy nhất được
  // phép ở lane host này.
  await expect(page.getByText('Monitor đang ngoại tuyến.')).toBeVisible()

  // VS-PROG-U10: API setup ở trên chưa đủ. Ba workspace chỉnh sửa phải tự đọc
  // lại đúng dữ liệu từ backend thật sau điều hướng client-side (giữ JWT thật),
  // không nhận dữ liệu từ state test hay lớp chặn request của trình duyệt.
  await navigation.getByRole('link', { name: 'Chương trình' }).click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/programs$`))
  const pouTree = page.getByRole('navigation', { name: 'Cây POU' })
  await pouTree.getByRole('button', { name: /AHU_MAINST/ }).click()
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
  await expect(page.getByText(/· PUBLISHED$/)).toBeVisible()

  await page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
    .getByRole('link', { name: 'Điểm & Ánh xạ' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${projectID}/mapping$`))
  const mappingRow = page.getByRole('row', { name: /SupplyTemp\s+LOCAL:UI-01\s+READ\s+REAL/ })
  await expect(mappingRow).toBeVisible()

  await page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình trên desktop' })
    .getByRole('link', { name: 'Runtime & Bảo trì' })
    .click()
  await page.getByRole('tab', { name: 'Theo dõi' }).click()
  await expect(page.getByRole('row', { name: /SUPPLY_TEMP/ })).toBeVisible()
  await expect(page.getByText('Monitor đang ngoại tuyến.')).toBeVisible()

  await expect.poll(() => [...new Set(serverFailures)].sort()).toEqual([
    '503 /api/v1/programming/runtime/monitor'
  ])
  expect(failedRequests).toEqual([])
  expect(consoleErrors.length).toBeGreaterThan(0)
  expect([...new Set(consoleErrors)]).toEqual([
    'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
  ])
  console.info(
    `[T59-505] browser evidence: HTTP>=500=${serverFailures.length} ` +
    `(${[...new Set(serverFailures)].join(', ')}); requestfailed=${failedRequests.length}; ` +
    `console.error=${consoleErrors.length} (expected offline monitor only)`
  )
})
