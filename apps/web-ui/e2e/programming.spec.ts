import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * TASK-PROG-506 — nghiệm thu trình duyệt thật cho bốn workspace Programming
 * (`playwright.config.ts` bật `VITE_PROGRAMMING_REV_A=1` chỉ cho dev server
 * e2e). Không có backend Go/Core thật trong CI này (đúng thực tế của phiên
 * làm việc — không có `codex mcp`/board thật), nên toàn bộ `/api/v1/programming/**`
 * được mock bằng `page.route()` theo ĐÚNG shape response mà
 * `apps/web-api/internal/programming` trả thật (đối chiếu trực tiếp với các
 * struct Go và test Go đã chạy PASS trong cùng phiên) — không phải dữ liệu
 * tự bịa. Đây là bằng chứng hành vi FE trên Chrome thật; nó KHÔNG thay thế
 * Test Result target/HIL (VS-PROG-030 vẫn NOT RUN).
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTIVE_REVISION_ID = '22222222-2222-4222-8222-222222222222'

interface MockProgram {
  programId: string
  name: string
  kind: 'PROGRAM'
  language: 'ST' | 'FBD'
  document: unknown
  executionOrder: number
  functionalTags: string[]
}

function initialDraft() {
  return {
    schemaVersion: 1,
    project: { projectId: PROJECT_ID, name: 'AHU-01', functionalTags: [] },
    programs: [] as MockProgram[],
    variables: [] as unknown[],
    bindings: [] as unknown[],
    task: { taskId: '33333333-3333-4333-8333-333333333333', periodMs: 1000, programOrder: [] as string[] },
    library: { profile: 'CORE_REVA', version: '1' }
  }
}

interface MockState {
  etagGeneration: number
  draft: ReturnType<typeof initialDraft>
  checkState: 'PASSED' | 'FAILED'
  commissionCount: number
  restoreCount: number
  retainResetCount: number
  traceCount: number
  traceRunning: boolean
  runtimeProducerState?: string
  runtimeRequestFails?: boolean
  monitorOffline?: boolean
}

function draftETag(state: MockState): string {
  return `"33333333-3333-4333-8333-333333333333:${state.etagGeneration}"`
}

async function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function installProgrammingMocks(page: Page, state: MockState) {
  // `RealtimeProvider` (App.tsx) mount vô điều kiện ở gốc app — kể cả ở
  // /login — và mở `ws://.../api/v1/ws/monitor` thật (useWebSocket.ts). Không
  // có backend Go thật trong e2e này nên bắt tay WS thật sẽ thất bại và log
  // console error lặp lại theo backoff, không liên quan gì tới Programming
  // P5. Mock route WS này thay vì lọc lỗi console — closer với hành vi thật
  // (kết nối "mở" được) và giữ assertion không-có-console-error-lạ có ý
  // nghĩa cho các lỗi P5 thật.
  let closeMonitorSocket: (() => Promise<void>) | undefined
  await page.routeWebSocket('**/api/v1/ws/monitor', (ws) => {
    ws.onMessage(() => undefined)
    closeMonitorSocket = () => ws.close({ code: 1001, reason: 'viewport reconnect test' })
    if (state.monitorOffline) void ws.close({ code: 1012, reason: 'simulated reconnect' })
  })
  await page.route('**/api/v1/programming/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1\/programming/, '')
    const method = request.method()
    const correlationId = request.headers()['x-correlation-id'] ?? 'e2e-correlation-0001'

    if (method === 'GET' && path === '/capabilities') {
      return json(route, {
        schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY',
        languages: ['ST', 'FBD'], types: ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'], taskPeriodsMs: [1000, 5000, 30000],
        limits: { projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512, statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256 }
      })
    }
    if (method === 'GET' && path === '/runtime') {
      if (state.runtimeRequestFails) {
        return json(route, { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true } }, 503)
      }
      return json(route, {
        schemaVersion: '1.0', controllerId: 'foxlinx-lab', producerState: state.runtimeProducerState ?? 'READY', activeRevisionId: ACTIVE_REVISION_ID, lkgRevisionId: ACTIVE_REVISION_ID,
        taskState: 'RUNNING', safeState: false, safeStateNoControllerOnly: false, observedAt: new Date().toISOString(),
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 120, missedReleaseCount: 0, lastExecNs: 120000, maxExecNs: 310000, overrunCount: 1, consecutiveOverruns: 0 }
      })
    }
    if (method === 'GET' && path === '/projects') {
      return json(route, { items: [{ projectId: PROJECT_ID, name: 'AHU-01', etag: draftETag(state), activeRevisionId: ACTIVE_REVISION_ID, draftRevisionId: state.draft.project.projectId, updatedAt: new Date().toISOString(), latestCheck: { checkId: 'check-latest', revisionId: ACTIVE_REVISION_ID, state: state.checkState, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() } }] })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
      return json(route, { projectId: PROJECT_ID, name: 'AHU-01', etag: draftETag(state), activeRevisionId: ACTIVE_REVISION_ID, draftRevisionId: state.draft.project.projectId, updatedAt: new Date().toISOString(), draft: state.draft })
    }
    if (method === 'GET' && path === `/revisions/${ACTIVE_REVISION_ID}`) {
      return json(route, {
        revisionId: ACTIVE_REVISION_ID, projectId: PROJECT_ID, state: 'ACTIVE', contentHash: 'sha256:active-e2e', createdAt: new Date().toISOString(),
        snapshot: { objects: [{ kind: 'PROGRAM', objectId: 'program-e2e-0001', sha256: 'sha256:program-e2e-0001', payload: { name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST' } }] }
      })
    }
    if (method === 'PATCH' && path === `/projects/${PROJECT_ID}/draft`) {
      const body = request.postDataJSON() as { operations: Array<{ op: string; [key: string]: unknown }> }
      // Mô phỏng đúng biên HTTP: response được giải mã thành object mới, không
      // mutate object React đang giữ. Nếu dùng chung reference, useMemo của UI
      // không thấy `document.programs` đổi và cờ dirty bị kẹt chỉ trong mock.
      const nextDraft = structuredClone(state.draft)
      for (const operation of body.operations) {
        if (operation.op === 'setFunctionalTags') nextDraft.project.functionalTags = operation.tags as string[]
        if (operation.op === 'upsertProgram') {
          const incoming = operation.program as MockProgram
          const index = nextDraft.programs.findIndex((program) => program.programId === incoming.programId)
          if (index >= 0) nextDraft.programs[index] = incoming
          else nextDraft.programs.push(incoming)
        }
        if (operation.op === 'replaceProgramSource') {
          const target = nextDraft.programs.find((program) => program.programId === operation.programId)
          if (target) target.document = operation.source
        }
        if (operation.op === 'setTask') nextDraft.task = operation.task as typeof nextDraft.task
        if (operation.op === 'upsertVariable') nextDraft.variables.push(operation.variable)
        if (operation.op === 'upsertBinding') nextDraft.bindings.push(operation.binding)
      }
      state.draft = nextDraft
      state.etagGeneration += 1
      return json(route, { resource: { projectId: PROJECT_ID, draftRevisionId: state.draft.project.projectId, content: state.draft }, etag: draftETag(state), auditId: 'audit-mock-0001', correlationId })
    }
    if (method === 'POST' && path === `/projects/${PROJECT_ID}/draft/revisions`) {
      return json(route, { resource: { projectId: PROJECT_ID, revisionId: 'revision-mock-0001' }, etag: draftETag(state), auditId: 'audit-mock-0002', correlationId }, 201)
    }
    if (method === 'POST' && path === '/revisions/revision-mock-0001/checks') {
      return json(
        route,
        { checkId: 'check-mock-0001', statusUrl: '/api/v1/programming/checks/check-mock-0001', state: 'RUNNING', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId },
        202
      )
    }
    if (method === 'GET' && path === '/checks/check-mock-0001') {
      return json(route, {
        checkId: 'check-mock-0001', revisionId: 'revision-mock-0001', state: state.checkState,
        diagnostics: state.checkState === 'FAILED' ? [{ code: 'PRG-ERR-CHECK-001', severity: 'ERROR', messageKey: 'programming.check.error', location: {} }] : [],
        createdAt: new Date().toISOString(), attemptCount: 1
      })
    }
    if (method === 'GET' && path === `/revisions/${ACTIVE_REVISION_ID}/changes/revision-mock-0001`) {
      return json(route, {
        fromRevisionId: ACTIVE_REVISION_ID, toRevisionId: 'revision-mock-0001',
        changes: [{ objectId: 'program-e2e-0001', kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' }],
        impact: {
          impactRef: 'impact-e2e-0001',
          retain: { status: 'NONE', items: [] },
          activeOverrides: { status: 'NONE', items: [] },
          cutover: { status: 'PRESENT', items: ['GRAPH_ONLY→PROGRAM_ONLY'] },
          outputMappingChanges: { status: 'NONE', items: [] }
        }
      })
    }
    if (method === 'GET' && path === `/revisions/none/changes/${ACTIVE_REVISION_ID}`) {
      return json(route, {
        fromRevisionId: 'none', toRevisionId: ACTIVE_REVISION_ID,
        changes: [{ objectId: 'SupplySetpoint', kind: 'VARIABLE', changeType: 'ADDED', category: 'RETAIN' }],
        impact: {
          impactRef: 'impact-retain-e2e-0001',
          retain: { status: 'PRESENT', items: ['SupplySetpoint', 'FanRuntimeHours'] },
          activeOverrides: { status: 'NONE', items: [] },
          cutover: { status: 'NONE', items: [] },
          outputMappingChanges: { status: 'NONE', items: [] }
        }
      })
    }
    if (method === 'GET' && path === '/overrides') {
      return json(route, { items: [] })
    }
    if (method === 'GET' && path === '/audit') {
      return json(route, { items: [{ auditId: 'audit-e2e-0001', sequence: 1, actorId: 'admin', role: 'admin', action: 'draft.updated', targetType: 'project', targetId: PROJECT_ID, occurredAt: new Date().toISOString(), resultCode: 'OK', correlationId }] })
    }
    if (method === 'GET' && path === '/operations') {
      return json(route, { items: [{ operationId: 'operation-history-e2e', kind: 'COMMISSION', state: 'SUCCEEDED', requestedRevisionId: ACTIVE_REVISION_ID, updatedAt: new Date().toISOString() }] })
    }
    if (method === 'GET' && path === '/point-catalog') {
      return json(route, {
        items: [
          { category: 'LOCAL', pointId: 'AO-01', name: 'AO-01', dataType: 'REAL', unit: 'V', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: 4.2, observedAt: new Date().toISOString() },
          { category: 'LOCAL', pointId: 'UI-01', name: 'UI-01', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 21.5, observedAt: new Date().toISOString() }
        ]
      })
    }
    if (method === 'GET' && path === '/runtime/monitor') {
      return json(route, {
        schemaVersion: '1.0', activeRevisionId: ACTIVE_REVISION_ID, safeState: false,
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 120, missedReleaseCount: 0, lastExecNs: 120000, maxExecNs: 310000, overrunCount: 1, consecutiveOverruns: 0 },
        items: [{
          variableId: '55555555-5555-4555-8555-555555555555', variableName: 'SupplySetpoint', programId: state.draft.programs[0]?.programId ?? '44444444-4444-4444-8444-444444444444',
          point: { category: 'LOCAL', pointId: 'AO-01' }, direction: 'WRITE', dataType: 'REAL', unit: 'V',
          programValue: 4.1, actualValue: 6.2, overriddenBy: 'manual', effectivePriority: 2,
          overrideActor: 'operator-e2e', overrideRemainingS: 272, quality: 'GOOD', observedAt: new Date().toISOString(), freshness: 'LIVE'
        }]
      })
    }
    if (method === 'POST' && path === '/runtime/traces') {
      state.traceCount += 1
      state.traceRunning = true
      return json(route, { traceId: '99999999-9999-4999-8999-999999999999', statusUrl: '/api/v1/programming/runtime/traces/99999999-9999-4999-8999-999999999999', state: 'RUNNING', requestHash: 'a'.repeat(64), acceptedAt: new Date().toISOString(), correlationId }, 202)
    }
    if (method === 'GET' && path === '/runtime/traces/99999999-9999-4999-8999-999999999999') {
      return json(route, {
        traceId: '99999999-9999-4999-8999-999999999999', state: state.traceRunning ? 'RUNNING' : 'STOPPED',
        variableIds: ['55555555-5555-4555-8555-555555555555'], durationMs: 60000, samplePeriodMs: 1000,
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), stopReason: state.traceRunning ? null : 'USER_STOPPED', droppedSamples: 0,
        samples: [{ sequence: 1, observedAt: new Date().toISOString(), values: [{ variableId: '55555555-5555-4555-8555-555555555555', programValue: 4.1, actualValue: 6.2, overriddenBy: 'manual', effectivePriority: 2, quality: 'GOOD', freshness: 'LIVE' }] }]
      })
    }
    if (method === 'DELETE' && path === '/runtime/traces/99999999-9999-4999-8999-999999999999') {
      state.traceRunning = false
      return route.fulfill({ status: 204, body: '' })
    }
    if (method === 'POST' && path === '/operations/commission') {
      state.commissionCount += 1
      return json(route, { operationId: 'operation-commission-e2e', statusUrl: '', state: 'QUEUED', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId }, 202)
    }
    if (method === 'GET' && path === '/operations/operation-commission-e2e') {
      return json(route, { operationId: 'operation-commission-e2e', state: 'SUCCEEDED', step: 'done', requestedRevisionId: 'revision-mock-0001', previousActiveRevisionId: ACTIVE_REVISION_ID, actualActiveRevisionId: 'revision-mock-0001', keepsRunningRevision: false, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    }
    if (method === 'POST' && path === '/operations/restore') {
      state.restoreCount += 1
      return json(route, { operationId: 'operation-restore-e2e', statusUrl: '', state: 'QUEUED', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId }, 202)
    }
    if (method === 'GET' && path === '/operations/operation-restore-e2e') {
      return json(route, { operationId: 'operation-restore-e2e', state: 'SUCCEEDED', step: 'done', requestedRevisionId: ACTIVE_REVISION_ID, previousActiveRevisionId: ACTIVE_REVISION_ID, actualActiveRevisionId: ACTIVE_REVISION_ID, keepsRunningRevision: false, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    }
    if (method === 'POST' && path === '/retain/reset') {
      state.retainResetCount += 1
      return json(route, { operationId: 'operation-retain-reset-e2e', statusUrl: '', state: 'QUEUED', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId }, 202)
    }
    if (method === 'GET' && path === '/operations/operation-retain-reset-e2e') {
      return json(route, { operationId: 'operation-retain-reset-e2e', kind: 'RESET_RETAIN', state: 'SUCCEEDED', step: 'done', requestedRevisionId: ACTIVE_REVISION_ID, previousActiveRevisionId: ACTIVE_REVISION_ID, actualActiveRevisionId: null, keepsRunningRevision: true, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    }
    if (method === 'POST' && path === '/bundles/export') {
      return json(route, { schemaVersion: '1.0', bundleSha256: 'a'.repeat(64), byteSize: 4, revisionIds: [ACTIVE_REVISION_ID], selectedRevisionId: ACTIVE_REVISION_ID, bundleBase64: 'UEsDBA==', auditId: 'audit-export-e2e', correlationId })
    }
    if (method === 'POST' && path === '/bundles/import') {
      const body = request.postDataJSON() as { expectedSha256?: string; bundleBase64?: string }
      expect(body.expectedSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(body.bundleBase64).toBe('UEsDBA==')
      return json(route, { resource: { projectId: 'project-imported-e2e', draftRevisionId: 'draft-imported-e2e' }, etag: '"draft-imported-e2e:1"', auditId: 'audit-import-e2e', correlationId }, 201)
    }
    if (method === 'POST' && path === '/auth/login') {
      return json(route, { token: 'e2e-token', role: 'admin' })
    }
    // Mọi route chưa dùng còn lại (runtime/monitor, runtime/traces GET theo
    // id lạ...) — 503 thật, đúng hành vi backend hiện tại; KHÔNG được coi là
    // request thất bại ngoài dự kiến (spec dưới lọc rõ các path này).
    await json(route, { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true, keepsRunningRevision: true, correlationId } }, 503)
  })
  return async () => {
    await closeMonitorSocket?.()
  }
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

/**
 * `VITE_AUTH_MODE=mock` giữ phiên trong React state, không cookie/localStorage
 * (xem `AuthProvider.tsx`) — `page.goto()` sau khi đăng nhập làm tải lại toàn
 * bộ trang và MẤT phiên, bật lại `/login`. Điều hướng client-side như
 * `pa3-dashboard.spec.ts` để giữ phiên qua các bước còn lại của journey.
 */
async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

test.describe('Programming P5 — bốn workspace, tám journey (TASK-PROG-506)', () => {
  test.beforeEach(async ({ page }) => {
    // Mô phỏng chính xác secure-context=false của endpoint HTTP trên board:
    // randomUUID/subtle không tồn tại, nhưng getRandomValues vẫn có. Toàn bộ
    // journey mutation phải tiếp tục chạy và fresh profile phải mặc định vi.
    await page.addInitScript(() => {
      Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: undefined })
      Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: undefined })
      window.localStorage.removeItem('mkddc-lang')
    })
  })

  test('F-PROG-LIVE-002: login giữ pathname, query và hash của deep link', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await page.goto('/eng/programming/runtime?tab=service#danger-zone')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
    await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin')
    await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
    await expect(page).toHaveURL(/\/eng\/programming\/runtime\?tab=service#danger-zone$/)
    await expect(page.getByRole('tab', { name: /Phiên bản & Bảo trì/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('VS-PROG-032: ba route cũ chuyển hướng đúng đích và giữ projectId', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)

    for (const [from, expectedTab] of [
      [`/eng/programming/projects/${PROJECT_ID}/programs`, 'programs'],
      [`/eng/programming/projects/${PROJECT_ID}/mapping`, 'mapping'],
      [`/eng/programming/projects/${PROJECT_ID}/task`, 'execution']
    ] as const) {
      await navigate(page, from)
      await page.waitForURL((url) => url.pathname === `/eng/programming/projects/${PROJECT_ID}/design`, { timeout: 10_000 })
      expect(new URL(page.url()).searchParams.get('tab')).toBe(expectedTab)
    }
  })

  test('FE-PROG-01: context responsive giữ truth và route Project lạ fail-closed', async ({ page }, testInfo) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    state.draft.programs.push({ programId: 'program-e2e-0001', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'X := 1;', executionOrder: 0, functionalTags: [] })
    state.draft.task.programOrder = ['program-e2e-0001']
    await installProgrammingMocks(page, state)
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/programming/') && request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`)
    })

    await login(page)
    await navigate(page, '/eng/programming')
    const context = page.getByRole('region', { name: 'Ngữ cảnh Lập trình' })
    await expect(context).toBeVisible()

    const viewport = page.viewportSize()
    if ((viewport?.width ?? 1280) < 1024) {
      await expect(context.getByText(new RegExp(`Sửa .* Active ${ACTIVE_REVISION_ID.slice(0, 8)}`))).toBeVisible()
      await expect(context.getByText('Sẵn sàng', { exact: true })).toBeVisible()
      const trigger = page.getByRole('button', { name: 'Mở chi tiết ngữ cảnh Lập trình' })
      await trigger.click()
      const drawer = page.getByRole('dialog', { name: 'Ngữ cảnh Lập trình' })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByText('foxlinx-lab')).toBeVisible()
      await expect(drawer.getByText('BẢN ĐANG ACTIVE')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('context-mobile-drawer.png'), fullPage: true })
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      await expect(trigger).toBeFocused()
    } else {
      await expect(context.getByText('foxlinx-lab')).toBeVisible()
      await expect(context.getByText(ACTIVE_REVISION_ID)).toBeVisible()
      await expect(context.getByText('Core sẵn sàng')).toBeVisible()
      await expect(context.getByText('BẢN ĐANG ACTIVE')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('context-desktop.png'), fullPage: true })
    }

    await navigate(page, `/eng/programming/projects/${PROJECT_ID}/design`)
    const designLive = (viewport?.width ?? 1280) < 1024
      ? page.getByRole('dialog', { name: /Thuộc tính|Inspector/ })
      : page.getByRole('complementary', { name: /Thuộc tính|Inspector/ })
    if ((viewport?.width ?? 1280) < 1024) await page.getByRole('button', { name: /Thuộc tính|Inspector/ }).click()
    await expect(designLive.getByText('LIVE', { exact: true })).toBeVisible()
    await expect(page.getByText('ĐANG CHẠY', { exact: false })).toBeVisible()
    await expect(page.getByText('BẢN NHÁP KHÔNG PHẢI BẢN ĐANG CHẠY.')).toHaveCount(0)

    const unknownProjectId = 'project-khong-ton-tai'
    await navigate(page, `/eng/programming/projects/${unknownProjectId}/design`)
    await expect(page.getByText('Project không tồn tại.')).toBeVisible()
    await expect(page.getByText(new RegExp(unknownProjectId)).filter({ visible: true }).first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/eng/programming/projects/${unknownProjectId}/design$`))
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toHaveCount(0)
    expect(writes, 'Route Project lạ không được tạo mutation request').toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('invalid-project-fail-closed.png'), fullPage: true })
  })

  test('FE-PROG-01: state lạ và snapshot lỗi không được hiển thị như runtime live', async ({ page }) => {
    const state: MockState = {
      etagGeneration: 1,
      draft: initialDraft(),
      checkState: 'PASSED',
      commissionCount: 0,
      restoreCount: 0,
      retainResetCount: 0,
      traceCount: 0,
      traceRunning: false,
      runtimeProducerState: 'FUTURE_STATE'
    }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming/runtime')

    const context = page.getByRole('region', { name: 'Ngữ cảnh Lập trình' })
    const viewport = page.viewportSize()
    if ((viewport?.width ?? 1280) < 1024) {
      await expect(context.getByText('UNKNOWN', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Mở chi tiết ngữ cảnh Lập trình' }).click()
      await expect(page.getByRole('dialog', { name: 'Ngữ cảnh Lập trình' }).getByText(/Core trả trạng thái thiếu hoặc không được hỗ trợ/)).toBeVisible()
      await page.keyboard.press('Escape')
    } else {
      await expect(context.getByText(/Core trả trạng thái thiếu hoặc không được hỗ trợ/)).toBeVisible()
    }
    await expect(page.getByText('Core sẵn sàng')).toHaveCount(0)
    await expect(page.getByText('RUNNING', { exact: true })).toHaveCount(0)

    state.runtimeProducerState = 'READY'
    state.runtimeRequestFails = true
    await page.getByRole('button', { name: 'Làm mới' }).click()
    await expect(context.getByText('STALE', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 })
    if ((viewport?.width ?? 1280) < 1024) {
      await page.getByRole('button', { name: 'Mở chi tiết ngữ cảnh Lập trình' }).click()
      const drawer = page.getByRole('dialog', { name: 'Ngữ cảnh Lập trình' })
      await expect(drawer.getByText(/snapshot cuối, không phải dữ liệu live/i)).toBeVisible()
      await expect(drawer.getByText(/Tuổi snapshot/)).toBeVisible()
      await page.keyboard.press('Escape')
    } else {
      await expect(context.getByText(/snapshot cuối, không phải dữ liệu live/i)).toBeVisible()
      await expect(context.getByText(/Tuổi snapshot/)).toBeVisible()
    }
    await expect(page.getByText('Core sẵn sàng')).toHaveCount(0)
  })

  test('FE-PROG-01: context không che reconnect banner tại năm viewport', async ({ page }, testInfo) => {
    const state: MockState = {
      etagGeneration: 1,
      draft: initialDraft(),
      checkState: 'PASSED',
      commissionCount: 0,
      restoreCount: 0,
      retainResetCount: 0,
      traceCount: 0,
      traceRunning: false,
      monitorOffline: true
    }
    await installProgrammingMocks(page, state)
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('requestfailed', (request) => failedRequests.push(request.url()))
    await login(page)
    await navigate(page, '/eng/programming')

    for (const viewport of [
      { width: 1536, height: 1024 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(viewport)
      const banner = page.locator('[data-app-reconnect-banner]')
      const context = page.getByRole('region', { name: 'Ngữ cảnh Lập trình' })
      await expect(page.getByRole('heading', { name: 'Lập trình điều khiển' })).toBeVisible()
      await expect(banner).toBeVisible()
      await expect(context).toBeVisible()
      const geometry = await page.evaluate(() => {
        const bannerElement = document.querySelector<HTMLElement>('[data-app-reconnect-banner]')!
        const contextElement = document.querySelector<HTMLElement>('[aria-label="Ngữ cảnh Lập trình"]')!
        const bannerBox = bannerElement.getBoundingClientRect()
        const contextBox = contextElement.getBoundingClientRect()
        return {
          bannerBottom: bannerBox.bottom,
          contextTop: contextBox.top,
          overflow: document.documentElement.scrollWidth > window.innerWidth
        }
      })
      expect(geometry.contextTop, `${viewport.width}px: context phải nằm dưới reconnect banner`).toBeGreaterThanOrEqual(geometry.bannerBottom - 1)
      expect(geometry.overflow, `${viewport.width}px: không được tràn ngang cấp trang`).toBe(false)

      if ([1536, 1024, 390].includes(viewport.width)) {
        await page.screenshot({ path: testInfo.outputPath(`overview-${viewport.width}x${viewport.height}.png`), fullPage: true })
      }
      if (viewport.width === 390) {
        const trigger = page.getByRole('button', { name: 'Mở chi tiết ngữ cảnh Lập trình' })
        await trigger.click()
        const drawer = page.getByRole('dialog', { name: 'Ngữ cảnh Lập trình' })
        await expect(drawer).toBeVisible()
        await expect(drawer.getByRole('button', { name: 'Đóng ngữ cảnh Lập trình' })).toBeFocused()
        await page.screenshot({ path: testInfo.outputPath('overview-390x844-context-drawer.png'), fullPage: true })
        await page.keyboard.press('Escape')
        await expect(drawer).toBeHidden()
        await expect(trigger).toBeFocused()
      }
    }

    const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes('503') && !text.includes('Failed to load resource'))
    expect(unexpectedConsoleErrors, `Console error ngoài proxy shell đã biết: ${unexpectedConsoleErrors.join(' | ')}`).toEqual([])
    const unexpectedProgrammingFailures = failedRequests.filter((url) => url.includes('/api/v1/programming/'))
    expect(unexpectedProgrammingFailures, `Programming request thất bại: ${unexpectedProgrammingFailures.join(' | ')}`).toEqual([])
  })

  test('UJ-PROG-01..08: Tổng quan → Thiết kế (ST+FBD+ánh xạ+thực thi) → Kiểm tra → Đưa vào vận hành → Runtime → Khôi phục', async ({ page }, testInfo) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)

    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    const failedRequests: string[] = []
    page.on('requestfailed', (request) => failedRequests.push(request.url()))

    await login(page)

    // UJ-PROG-01 — Tổng quan
    await navigate(page, '/eng/programming')
    await expect(page.getByRole('heading', { name: 'Lập trình điều khiển' })).toBeVisible()
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
    expect(await page.evaluate(() => typeof crypto.subtle)).toBe('undefined')
    await expect(page.getByText(ACTIVE_REVISION_ID).filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByText('Kiểm tra gần nhất đạt — sẵn sàng Đưa vào vận hành.')).toBeVisible()
    await expect(page.getByText('Đang chỉnh sửa — chưa Kiểm tra lần nào cho bản này.')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

    // UJ-PROG-02 — mở workspace Thiết kế qua Project trong Draft panel
    await page.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }).click()
    await page.waitForURL((url) => url.pathname === `/eng/programming/projects/${PROJECT_ID}/design`)
    const designWidth = page.viewportSize()?.width ?? 1280
    // Theo plan: Explorer thành cột từ 1024 px, Inspector thành cột từ 1280 px.
    const explorerDrawer = designWidth < 1024
    const inspectorDrawer = designWidth < 1280
    // 1024/768 dùng Problems sheet như asset responsive; chỉ workstation
    // desktop >=1280 mới giữ khay resize cố định dưới editor.
    const mobileProblems = designWidth < 1280
    const explorerTrigger = page.getByRole('button', { name: /^(Cây|Explorer)$/ })
    if (explorerDrawer) {
      await explorerTrigger.click()
      const explorer = page.getByRole('dialog', { name: 'Cây ứng dụng' })
      await expect(explorer.getByText('Chưa có chương trình. Bấm + để tạo.')).toBeVisible()
      await explorer.getByTitle('Thêm chương trình ST').focus()
    } else {
      await expect(page.getByText('Chưa có chương trình. Bấm + để tạo.')).toBeVisible()
      await page.getByTitle('Thêm chương trình ST').focus()
    }

    // Thêm chương trình ST bằng bàn phím hoàn toàn (Tab tới nút, Enter kích hoạt).
    await page.keyboard.press('Enter')
    if (explorerDrawer) {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Cây ứng dụng' })).toBeHidden()
      await expect(explorerTrigger).toBeFocused()
    }
    await expect(page.getByRole('heading', { name: 'Chương trình mới' }).first()).toBeVisible()
    const sourceBox = page.getByLabel(/Mã nguồn ST/)
    await sourceBox.fill('AO1 := UI1 * 2.0;')
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('02-design-st.png'), fullPage: true })
    if (inspectorDrawer) {
      const inspectorTrigger = page.getByRole('button', { name: /^(Thuộc tính|Inspector)$/ })
      await inspectorTrigger.click()
      await expect(page.getByRole('dialog', { name: 'Thuộc tính' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(inspectorTrigger).toBeFocused()

      if (mobileProblems) {
        const problemsTrigger = page.getByRole('button', { name: /^(Mở khay|Open tray)$/ })
        await problemsTrigger.click()
        await expect(page.getByRole('dialog', { name: 'Danh sách lỗi' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(problemsTrigger).toBeFocused()
      }
    }

    // Đổi tab không mất nội dung đang gõ: gõ dở rồi chuyển tab và quay lại
    await sourceBox.fill('AO1 := UI1 * 2.0; (* dở dang *)')
    await page.getByRole('tab', { name: /Điểm & Ánh xạ/ }).click()
    await expect(page.getByRole('tab', { name: /Chương trình/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click()
    await expect(sourceBox).toHaveValue('AO1 := UI1 * 2.0; (* dở dang *)')
    await expect(page.getByText(/Draft có thay đổi chưa lưu/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toBeDisabled()
    await sourceBox.press('Control+s')
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)

    // UJ-PROG-02 (FBD) — thêm chương trình FBD, mount StructuredFbdEditor thật
    if (explorerDrawer) {
      await explorerTrigger.click()
      await page.getByRole('dialog', { name: 'Cây ứng dụng' }).getByTitle('Thêm chương trình FBD').click()
      await page.keyboard.press('Escape')
      await expect(explorerTrigger).toBeFocused()
    } else {
      await page.getByTitle('Thêm chương trình FBD').click()
    }
    const fbdToolbar = page.getByRole('toolbar', { name: 'Lệnh FBD' })
    await expect(fbdToolbar).toBeVisible()

    // TASK-PROG-506 / DDD-FE-PROG-001 §0.1: FBD phải "hoàn tất bằng bàn
    // phím". Chuỗi dưới chỉ dùng `page.keyboard` (Insert/Arrow/Enter/
    // Delete/Ctrl+Z) — KHÔNG click chuột — để thêm 2 block, nối wire, xóa,
    // hoàn tác. `.focus()` chỉ đặt điểm bắt đầu (tương đương Tab tới một nút
    // trong toolbar), không thay cho thao tác nghiệp vụ nào bên dưới.
    await fbdToolbar.getByRole('button').first().focus()
    await page.keyboard.press('Insert') // ADD_BLOCK — block AND #1 (network_1 có sẵn từ emptyFbdDocument)
    await expect(page.getByText('1/256 block')).toBeVisible()
    await page.keyboard.press('Insert') // ADD_BLOCK — block AND #2
    await expect(page.getByText('2/256 block')).toBeVisible()
    await page.keyboard.press('ArrowDown') // chọn port #1.IN1
    await page.keyboard.press('ArrowDown') // chọn port #1.IN2
    await page.keyboard.press('ArrowDown') // chọn port #1.OUT — nguồn nối
    await page.keyboard.press('Enter') // bắt đầu nối từ #1.OUT
    await page.keyboard.press('ArrowDown') // chọn port #2.IN1 — đích nối
    await page.keyboard.press('Enter') // hoàn tất nối #1.OUT → #2.IN1
    await expect(page.getByText('1/512 wire')).toBeVisible()
    await page.keyboard.press('Delete') // xóa vùng chọn (port đích) — kéo theo wire vừa nối
    await expect(page.getByText('0/512 wire')).toBeVisible()
    await page.keyboard.press('Control+z') // hoàn tác — wire khôi phục
    await expect(page.getByText('1/512 wire')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('03-design-fbd.png'), fullPage: true })
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()

    // UJ-PROG-03 — Điểm & Ánh xạ
    await page.getByRole('tab', { name: /Điểm & Ánh xạ/ }).click()
    await expect(page.getByRole('heading', { name: 'Biến chương trình' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Điểm khả dụng' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ánh xạ đã gán' })).toBeVisible()
    await expect(page.getByText(/Phase 1A chỉ đọc/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Gợi ý \(Phase 1A\)/ })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('04-design-mapping.png'), fullPage: true })

    // UJ-PROG-04 — Thực thi
    await page.getByRole('tab', { name: 'Thực thi' }).click()
    await expect(page.getByText('Control_Main')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('05-design-execution.png'), fullPage: true })

    // UJ-PROG-05 — Kiểm tra (D-01: PGM-02 chỉ lưu rồi điều hướng, PGM-03 sở
    // hữu toàn bộ seal/run/poll/result — không còn seal/Check inline ở đây).
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click()
    await page.waitForURL((url) => url.pathname === `/eng/programming/projects/${PROJECT_ID}/commission`)
    await expect(page.getByText('Chưa có Kiểm tra nào.')).toBeVisible()
    await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click()
    await expect(page.getByText('PASSED', { exact: true })).toBeVisible({ timeout: 10_000 })
    const candidateRevisionId = new URL(page.url()).searchParams.get('revisionId')
    if (!candidateRevisionId) throw new Error('Thiếu revisionId trong URL Commission sau khi Check PASS')
    await page.screenshot({ path: testInfo.outputPath('06-commission.png'), fullPage: true })

    // UJ-PROG-06 — Đưa vào vận hành

    await page.getByRole('button', { name: 'Đưa vào vận hành…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const checkboxes = dialog.getByRole('checkbox')
    for (const checkbox of await checkboxes.all()) await checkbox.check()
    await dialog.getByLabel(/Xác thực lại/).fill('admin')
    await dialog.getByRole('button', { name: new RegExp(`^Xác nhận ${candidateRevisionId.slice(0, 8)}$`) }).click()
    await expect(page.getByText(/Đưa vào vận hành thành công/)).toBeVisible({ timeout: 10_000 })
    expect(state.commissionCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('07-commission-succeeded.png'), fullPage: true })

    // UJ-PROG-07 — Runtime & Theo dõi
    await navigate(page, '/eng/programming/runtime')
    await expect(page.getByText('Runtime hiện tại')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('08-runtime.png'), fullPage: true })
    await page.getByRole('tab', { name: 'Theo dõi' }).click()
    await expect(page.locator('td:visible, dd:visible').filter({ hasText: /^4,1 V$/ })).toBeVisible()
    await expect(page.locator('td:visible, dd:visible').filter({ hasText: /^6,2 V$/ })).toBeVisible()
    await expect(page.locator('td:visible, dd:visible').filter({ hasText: /^manual · operator-e2e$/ })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Trace SupplySetpoint' }).check()
    await page.getByRole('button', { name: 'Bắt đầu trace' }).click()
    await expect(page.getByRole('button', { name: 'Dừng trace' })).toBeVisible()
    await page.getByRole('button', { name: 'Dừng trace' }).click()
    await expect(page.getByText(/USER_STOPPED/)).toBeVisible()
    expect(state.traceCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('09-watch-trace.png'), fullPage: true })

    // UJ-PROG-08 — Khôi phục (DangerZone)
    await page.getByRole('tab', { name: /Phiên bản & Bảo trì/ }).click()
    await expect(page.getByText('Vùng thao tác nguy hiểm')).toBeVisible()
    await page.getByRole('button', { name: 'Xuất gói .zip' }).click()
    await expect(page.getByText(/Đã xuất 4 byte/)).toBeVisible()
    await expect(page.getByText('CONTRACT_UNAVAILABLE')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Đặt lại RETAIN' })).toBeDisabled()
    await expect(page.getByText('SupplySetpoint')).toBeVisible()
    expect(state.retainResetCount).toBe(0)
    await page.locator('#programming-bundle-import-input').setInputFiles({ name: 'replacement.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04') })
    await expect(page.getByText(/Nhập gói thành công/)).toBeVisible()
    await page.getByRole('button', { name: /Khôi phục bản trước…/ }).click()
    const restoreDialog = page.getByRole('dialog')
    await restoreDialog.getByLabel('Lý do khôi phục').fill('Kiểm chứng E2E TASK-PROG-506')
    await restoreDialog.getByLabel(/Xác thực lại/).fill('admin')
    await restoreDialog.getByRole('button', { name: 'Khôi phục' }).click()
    await expect(page.getByText(/Khôi phục thành công/)).toBeVisible({ timeout: 10_000 })
    expect(state.restoreCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('10-restore-succeeded.png'), fullPage: true })
    // Modal Khôi phục KHÔNG tự đóng sau khi thành công; đóng thủ công để tiếp
    // tục kiểm tra trạng thái chỉ đọc của Service.
    await restoreDialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('11-retain-contract-unavailable.png'), fullPage: true })

    // Console/Network — không có lỗi ngoài các 503 chủ động đã được UI xử lý
    // và một GET trace đang poll bị hủy đúng lúc DELETE dừng trace hoàn tất.
    const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes('503') && !text.includes('Failed to load resource'))
    expect(unexpectedConsoleErrors, `Console error ngoài dự kiến: ${unexpectedConsoleErrors.join(' | ')}`).toEqual([])
    const unexpectedProgrammingFailures = failedRequests.filter((url) =>
      url.includes('/api/v1/programming/') &&
      !url.endsWith('/runtime/traces/99999999-9999-4999-8999-999999999999')
    )
    expect(unexpectedProgrammingFailures, `Programming request thất bại ngoài poll trace bị hủy khi dừng: ${unexpectedProgrammingFailures.join(' | ')}`).toEqual([])
  })

  test('VS-PROG-028: bốn workspace không có vi phạm WCAG A/AA tự động phát hiện được', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    state.draft.programs.push({
      programId: '44444444-4444-4444-8444-444444444444',
      name: 'Điều khiển AHU',
      kind: 'PROGRAM',
      language: 'ST',
      document: 'AO1 := UI1 * 2.0;',
      executionOrder: 0,
      functionalTags: ['AHU']
    })
    state.draft.task.programOrder = [state.draft.programs[0].programId]
    await installProgrammingMocks(page, state)
    await login(page)

    const screens = [
      {
        path: '/eng/programming',
        shell: page.getByRole('heading', { name: 'Lập trình điều khiển' }),
        ready: page.getByRole('heading', { name: 'Lập trình điều khiển' })
      },
      {
        path: `/eng/programming/projects/${PROJECT_ID}/design`,
        shell: page.getByRole('tab', { name: 'Chương trình' }),
        ready: page.getByLabel(/Mã nguồn ST/)
      },
      {
        path: `/eng/programming/projects/${PROJECT_ID}/design?tab=mapping`,
        shell: page.getByRole('tab', { name: /Điểm & Ánh xạ/ }),
        ready: page.getByRole('heading', { name: 'Biến chương trình' })
      },
      {
        path: `/eng/programming/projects/${PROJECT_ID}/commission?revisionId=revision-mock-0001&checkId=check-mock-0001`,
        shell: page.getByRole('heading', { name: 'Kiểm tra & Đưa vào vận hành' }),
        ready: page.getByText('PASSED')
      },
      {
        path: '/eng/programming/runtime?tab=watch',
        shell: page.getByRole('heading', { name: 'Runtime & Bảo trì' }),
        ready: page.locator('strong:visible').filter({ hasText: /^SupplySetpoint$/ })
      }
    ]

    for (const screen of screens) {
      await navigate(page, screen.path)
      await expect(screen.shell.first()).toBeVisible({ timeout: 15_000 })
      if (screen.path.endsWith('/design')) {
        // Chờ draft/editor sẵn sàng trước khi mở drawer; tránh race giữa route
        // guard và nút Explorer ở viewport compact.
        await expect(screen.ready.first()).toBeVisible()
        const explorerDrawer = (page.viewportSize()?.width ?? 1280) < 1024
        if (explorerDrawer) {
          const explorerTrigger = page.getByRole('button', { name: /^(Cây|Explorer)$/ })
          await explorerTrigger.click()
          await page.getByRole('dialog', { name: 'Cây ứng dụng' }).getByRole('treeitem', { name: 'Điều khiển AHU PROGRAM · ST' }).click()
          await expect(page.getByRole('dialog', { name: 'Cây ứng dụng' })).toBeHidden()
          await expect(screen.ready.first()).toBeFocused()
        } else {
          await page.getByRole('treeitem', { name: 'Điều khiển AHU PROGRAM · ST' }).click()
        }
      }
      // Route Programming tải query bất đồng bộ và hai project Chrome chạy
      // song song; chờ đúng readiness của từng màn thay vì phụ thuộc budget
      // assertion mặc định 5 giây (dễ timeout giả khi máy đang build/test).
      await expect(screen.ready.first()).toBeVisible({ timeout: 15_000 })
      const result = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(result.violations, `Vi phạm a11y tại ${screen.path}`).toEqual([])
    }
  })

  test('F-PROG-LIVE-008: mobile có điều hướng bốn workspace và lịch sử không bị cắt', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming/runtime?tab=service')

    const nav = page.getByRole('navigation', { name: 'Điều hướng workspace Lập trình' })
    await expect(nav).toBeVisible()
    for (const label of ['Tổng quan', 'Thiết kế', 'Kiểm tra', 'Runtime']) await expect(nav.getByText(label, { exact: true })).toBeVisible()
    await expect(page.getByText('COMMISSION').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('mobile-service-history.png'), fullPage: true })
  })
})
