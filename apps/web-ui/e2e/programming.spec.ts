import { expect, test, type Page, type Route } from '@playwright/test'

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
  await page.routeWebSocket('**/api/v1/ws/monitor', (ws) => {
    ws.onMessage(() => undefined)
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
      return json(route, {
        schemaVersion: '1.0', producerState: 'READY', activeRevisionId: ACTIVE_REVISION_ID, lkgRevisionId: ACTIVE_REVISION_ID,
        taskState: 'RUNNING', safeState: false, observedAt: new Date().toISOString()
      })
    }
    if (method === 'GET' && path === '/projects') {
      return json(route, { items: [{ projectId: PROJECT_ID, name: 'AHU-01', etag: draftETag(state), activeRevisionId: ACTIVE_REVISION_ID, draftRevisionId: state.draft.project.projectId, updatedAt: new Date().toISOString() }] })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
      return json(route, { projectId: PROJECT_ID, name: 'AHU-01', etag: draftETag(state), activeRevisionId: ACTIVE_REVISION_ID, draftRevisionId: state.draft.project.projectId, updatedAt: new Date().toISOString(), draft: state.draft })
    }
    if (method === 'PATCH' && path === `/projects/${PROJECT_ID}/draft`) {
      const body = request.postDataJSON() as { operations: Array<{ op: string; [key: string]: unknown }> }
      for (const operation of body.operations) {
        if (operation.op === 'upsertProgram') state.draft.programs.push(operation.program as MockProgram)
        if (operation.op === 'replaceProgramSource') {
          const target = state.draft.programs.find((program) => program.programId === operation.programId)
          if (target) target.document = operation.source
        }
        if (operation.op === 'setTask') state.draft.task = operation.task as typeof state.draft.task
        if (operation.op === 'upsertVariable') state.draft.variables.push(operation.variable)
        if (operation.op === 'upsertBinding') state.draft.bindings.push(operation.binding)
      }
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
    if (method === 'GET' && path === '/overrides') {
      return json(route, { items: [] })
    }
    if (method === 'GET' && path === '/audit') {
      return json(route, { items: [{ auditId: 'audit-e2e-0001', sequence: 1, actorId: 'admin', role: 'admin', action: 'draft.updated', targetType: 'project', targetId: PROJECT_ID, occurredAt: new Date().toISOString(), resultCode: 'OK', correlationId }] })
    }
    if (method === 'GET' && path === '/operations') {
      return json(route, { items: [] })
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
      return json(route, { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true, keepsRunningRevision: true, correlationId } }, 503)
    }
    if (method === 'POST' && path === '/operations/commission') {
      state.commissionCount += 1
      return json(route, { operationId: 'operation-commission-e2e', statusUrl: '', state: 'REQUESTED', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId }, 202)
    }
    if (method === 'GET' && path === '/operations/operation-commission-e2e') {
      return json(route, { operationId: 'operation-commission-e2e', state: 'SUCCEEDED', step: 'done', requestedRevisionId: 'revision-mock-0001', previousActiveRevisionId: ACTIVE_REVISION_ID, actualActiveRevisionId: 'revision-mock-0001', keepsRunningRevision: false, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    }
    if (method === 'POST' && path === '/operations/restore') {
      state.restoreCount += 1
      return json(route, { operationId: 'operation-restore-e2e', statusUrl: '', state: 'REQUESTED', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId }, 202)
    }
    if (method === 'GET' && path === '/operations/operation-restore-e2e') {
      return json(route, { operationId: 'operation-restore-e2e', state: 'SUCCEEDED', step: 'done', requestedRevisionId: ACTIVE_REVISION_ID, previousActiveRevisionId: ACTIVE_REVISION_ID, actualActiveRevisionId: ACTIVE_REVISION_ID, keepsRunningRevision: false, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    }
    if (method === 'POST' && path === '/auth/login') {
      return json(route, { token: 'e2e-token', role: 'admin' })
    }
    // Mọi route contract-only còn lại (traces, retain/reset...) — 503 thật,
    // đúng hành vi backend hiện tại; KHÔNG được coi là request thất bại
    // ngoài dự kiến (spec dưới lọc rõ các path này).
    await json(route, { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true, keepsRunningRevision: true, correlationId } }, 503)
  })
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
    // Mặc định trình duyệt mới là 'en' (chưa có `mkddc-lang` trong
    // localStorage) — khoá 'vi' để khớp copy tiếng Việt dùng trong toàn spec
    // và đúng quy ước "trả lời/hiển thị bằng tiếng Việt" của dự án.
    await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
  })

  test('VS-PROG-032: ba route cũ chuyển hướng đúng đích và giữ projectId', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0 }
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

  test('UJ-PROG-01..08: Tổng quan → Thiết kế (ST+FBD+ánh xạ+thực thi) → Kiểm tra → Đưa vào vận hành → Runtime → Khôi phục', async ({ page }, testInfo) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0 }
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
    await expect(page.getByText(ACTIVE_REVISION_ID).first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

    // UJ-PROG-02 — mở workspace Thiết kế qua Project trong Draft panel
    await page.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }).click()
    await page.waitForURL((url) => url.pathname === `/eng/programming/projects/${PROJECT_ID}/design`)
    await expect(page.getByText('Chưa có chương trình. Bấm + để tạo.')).toBeVisible()

    // Thêm chương trình ST bằng bàn phím hoàn toàn (Tab tới nút, Enter kích hoạt)
    await page.getByTitle('Thêm chương trình ST').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Chương trình mới' })).toBeVisible()
    const sourceBox = page.getByLabel(/Mã nguồn ST/)
    await sourceBox.fill('AO1 := UI1 * 2.0;')
    await page.getByRole('button', { name: 'Lưu' }).click()
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('02-design-st.png'), fullPage: true })

    // Đổi tab không mất nội dung đang gõ: gõ dở rồi chuyển tab và quay lại
    await sourceBox.fill('AO1 := UI1 * 2.0; (* dở dang *)')
    await page.getByRole('tab', { name: /Điểm & Ánh xạ/ }).click()
    await expect(page.getByRole('tab', { name: /Chương trình/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click()
    await expect(sourceBox).toHaveValue('AO1 := UI1 * 2.0; (* dở dang *)')

    // UJ-PROG-02 (FBD) — thêm chương trình FBD, mount StructuredFbdEditor thật
    await page.getByTitle('Thêm chương trình FBD').click()
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

    // UJ-PROG-03 — Điểm & Ánh xạ
    await page.getByRole('tab', { name: /Điểm & Ánh xạ/ }).click()
    await expect(page.getByText('Chưa có ánh xạ nào.')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('04-design-mapping.png'), fullPage: true })

    // UJ-PROG-04 — Thực thi
    await page.getByRole('tab', { name: 'Thực thi' }).click()
    await expect(page.getByText('Control_Main')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('05-design-execution.png'), fullPage: true })

    // UJ-PROG-05 — Kiểm tra
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click()
    await page.getByRole('button', { name: 'Kiểm tra' }).click()
    await expect(page.getByText('Kiểm tra đạt. Bản đang chạy không đổi.')).toBeVisible({ timeout: 10_000 })

    // UJ-PROG-06 — Đưa vào vận hành
    await page.getByRole('button', { name: 'Mở Kiểm tra & Đưa vào vận hành' }).click()
    await page.waitForURL((url) => url.pathname === `/eng/programming/projects/${PROJECT_ID}/commission`)
    await expect(page.getByText('PASSED')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('06-commission.png'), fullPage: true })

    await page.getByRole('button', { name: 'Đưa vào vận hành…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const checkboxes = dialog.getByRole('checkbox')
    for (const checkbox of await checkboxes.all()) await checkbox.check()
    await dialog.getByLabel(/Xác thực lại/).fill('admin')
    await dialog.getByRole('button', { name: 'Gửi lệnh' }).click()
    await expect(page.getByText(/Đưa vào vận hành thành công/)).toBeVisible({ timeout: 10_000 })
    expect(state.commissionCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('07-commission-succeeded.png'), fullPage: true })

    // UJ-PROG-07 — Runtime & Theo dõi
    await navigate(page, '/eng/programming/runtime')
    await expect(page.getByText('Đang vận hành / LKG')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('08-runtime.png'), fullPage: true })
    await page.getByRole('tab', { name: 'Theo dõi' }).click()
    await expect(page.getByText('Chưa sẵn sàng').first()).toBeVisible()

    // UJ-PROG-08 — Khôi phục (DangerZone)
    await page.getByRole('tab', { name: /Phiên bản & Bảo trì/ }).click()
    await expect(page.getByText('Vùng thao tác nguy hiểm')).toBeVisible()
    await page.getByRole('button', { name: /Khôi phục bản trước…/ }).click()
    const restoreDialog = page.getByRole('dialog')
    await restoreDialog.getByLabel('Lý do khôi phục').fill('Kiểm chứng E2E TASK-PROG-506')
    await restoreDialog.getByLabel(/Xác thực lại/).fill('admin')
    await restoreDialog.getByRole('button', { name: 'Khôi phục' }).click()
    await expect(page.getByText(/Khôi phục thành công/)).toBeVisible({ timeout: 10_000 })
    expect(state.restoreCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('09-restore-succeeded.png'), fullPage: true })

    // Console/Network — không có lỗi ngoài các 503 chủ động (contract-only:
    // monitor/traces/retain-reset) đã được UI xử lý như trạng thái hợp lệ.
    const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes('503') && !text.includes('Failed to load resource'))
    expect(unexpectedConsoleErrors, `Console error ngoài dự kiến: ${unexpectedConsoleErrors.join(' | ')}`).toEqual([])
  })
})
