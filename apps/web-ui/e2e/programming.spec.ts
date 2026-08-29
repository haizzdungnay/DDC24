import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { login } from './helpers/session'

/**
 * TASK-PROG-506/T59-503 — nghiệm thu trình duyệt thật cho sáu workspace Programming
 * (`playwright.config.ts` bật `VITE_PROGRAMMING_REV_A=1` chỉ cho dev server
 * e2e). Không có backend Go/Core thật trong CI này (đúng thực tế của phiên
 * làm việc — không có `codex mcp`/board thật), nên toàn bộ `/api/v1/programming/**`
 * được mock bằng `page.route()` theo ĐÚNG shape response mà
 * `apps/web-api/internal/programming` trả thật (đối chiếu trực tiếp với các
 * struct Go và test Go đã chạy PASS trong cùng phiên) — không phải dữ liệu
 * tự bịa. Đây là bằng chứng hành vi FE trên Chrome thật; nó KHÔNG thay thế
 * Test Result target/HIL (VS-PROG-030 vẫn NOT RUN).
 */

const CANONICAL_PROGRAMS_PATH = '/eng/programming/programs'
const AUTHORING_MIN_WIDTH_PX = 768
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTIVE_REVISION_ID = '22222222-2222-4222-8222-222222222222'
const POU_OBJECT_ID = '44444444-4444-4444-8444-444444444444'
const PROGRAM_ID = '66666666-6666-4666-8666-666666666666'
/* `T59-816` — bản đã niêm phong mà phiên mô phỏng chạy, và ID phiên. Cố ý KHÁC
   `ACTIVE_REVISION_ID`: một phiên mô phỏng chạy được trên bản chưa hề điều
   khiển tủ, và mọi nhãn nguồn phải nói đúng bản nào. */
const SIM_REVISION_ID = '77777777-7777-4777-8777-777777777777'
const SIM_SESSION_ID = '88888888-8888-4888-8888-888888888888'

interface MockProgram {
  objectId?: string
  programId: string
  name: string
  kind: 'PROGRAM'
  language: 'ST' | 'FBD'
  document: unknown
  executionOrder?: number
  functionalTags?: string[]
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
  /** `T59-812`: bộ đếm chỉ dùng để chứng minh subscription LIVE đã cleanup. */
  monitorRequests?: number
  /**
   * `T59-816`: phiên mô phỏng do thiết bị công bố.
   *
   * `undefined` = thiết bị KHÔNG công bố khả năng mô phỏng (mặc định của mọi
   * case cũ). Bật lên chỉ ở lane SIMULATE để phần còn lại của bộ e2e vẫn kiểm
   * đúng đường "chưa hỗ trợ".
   */
  simulation?: {
    supported: boolean
    session: null | { state: string; sequence: number; virtualTimeMs: number; tick: number }
    /** Đếm mọi lần chạm vào đường điều khiển THẬT — phải đứng yên suốt phiên. */
    controlPathWrites: number
  }
}

interface BrowserFailures {
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: string[]
  serverFailures: string[]
}

/**
 * Lane này CHỈ dựng backend giả cho `/api/v1/programming/**`. Vỏ ứng dụng vẫn
 * gọi `/api/v1/health|me|alarms|overview|system/status` và chúng trả 502/503 vì
 * không có backend Go thật ở đây — hiện vật của lane, không phải finding của
 * PGM-02. Lọc theo ĐÍCH của request thay vì bỏ hẳn assertion: mọi lỗi thuộc bề
 * mặt Programming (và mọi lỗi JS, vốn không kèm URL API) vẫn phải rỗng.
 */
function isProgrammingSurface(rawUrl: string | undefined): boolean {
  if (!rawUrl) return true
  let path: string
  try {
    path = new URL(rawUrl, 'http://127.0.0.1:4174').pathname
  } catch {
    return true
  }
  if (!path.startsWith('/api/v1/')) return true
  return path.startsWith('/api/v1/programming')
}

function observeBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    serverFailures: []
  }
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const url = message.location()?.url
    if (!isProgrammingSurface(url)) return
    // Ghi kèm đích: một dòng "Failed to load resource" trần không nói được lỗi
    // thuộc endpoint nào, và đó là thứ biến evidence thành câu đố khi đỏ.
    failures.consoleErrors.push(url ? `${message.text()} @ ${url}` : message.text())
  })
  page.on('pageerror', (error) => failures.pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (!isProgrammingSurface(request.url())) return
    failures.requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? 'unknown'}`)
  })
  page.on('response', (response) => {
    if (response.status() < 500) return
    if (!isProgrammingSurface(response.url())) return
    failures.serverFailures.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`)
  })
  return failures
}

function expectNoBrowserFailures(failures: BrowserFailures, label: string): void {
  expect(failures.consoleErrors, `${label}: console.error`).toEqual([])
  expect(failures.pageErrors, `${label}: pageerror`).toEqual([])
  expect(failures.requestFailures, `${label}: requestfailed`).toEqual([])
  expect(failures.serverFailures, `${label}: HTTP 5xx`).toEqual([])
}

function draftWithProgram() {
  const draft = initialDraft()
  draft.programs.push({
    objectId: POU_OBJECT_ID,
    programId: PROGRAM_ID,
    name: 'Điều khiển AHU',
    kind: 'PROGRAM',
    language: 'ST',
    document: 'PROGRAM AHU_MAIN\nEND_PROGRAM\n',
    executionOrder: 0,
    functionalTags: ['AHU']
  })
  draft.task.programOrder = [PROGRAM_ID]
  return draft
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
        ...(state.simulation?.supported
          ? {
              workspaceModes: {
                simulation: {
                  supported: true, workerVersion: 'sim-worker-e2e-1',
                  /* `T59-816`: danh sách vai này do SERVER công bố và FE chỉ
                     đọc. Mock phải nói đúng ranh giới `ADR-053` (admin-only),
                     nếu không lane e2e sẽ xác nhận một bề mặt rộng hơn bề mặt
                     thật. */
                  mutationRoles: ['admin'],
                  limits: {
                    maxConcurrentSessionsPerController: 1, idleTtlSeconds: 900, hardTtlSeconds: 3600,
                    maxRssMiB: 128, maxCpuPercentOneCore: 50, maxActionsPerSecond: 10,
                    maxTraceSamples: 1024, maxVirtualInputs: 64, workerCommandTimeoutMs: 2000,
                  },
                },
              },
            }
          : {}),
        languages: ['ST', 'FBD'], types: ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'], taskPeriodsMs: [1000, 5000, 30000],
        limits: { projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512, statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256 }
      })
    }
    if (method === 'GET' && path === '/runtime') {
      return json(route, {
        schemaVersion: '1.0', controllerId: 'foxlinx-lab', producerState: 'READY', activeRevisionId: ACTIVE_REVISION_ID, lkgRevisionId: ACTIVE_REVISION_ID,
        taskState: 'RUNNING', safeState: false, observedAt: new Date().toISOString(),
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 120, missedReleaseCount: 0, lastExecNs: 120000, maxExecNs: 310000, overrunCount: 1, consecutiveOverruns: 0 }
      })
    }
    if (method === 'GET' && path === '/libraries') {
      /* `T59-804`: shape đúng như `GET /programming/libraries` thật — chữ ký đi
         trong `interface`, `featureState` nói thẳng mục nào chờ review. */
      return json(route, {
        items: [
          {
            scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
            entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT', featureState: 'AVAILABLE',
            contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
            interface: JSON.stringify({
              category: 'math', labelVi: 'Giới hạn (LIMIT)', labelEn: 'Limit', allowedTypes: ['REAL'],
              ports: [
                { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
                { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
                { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
                { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
              ]
            })
          },
          {
            scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
            entryId: 'PID', kind: 'FUNCTION_BLOCK', name: 'PID', featureState: 'REVIEW_REQUIRED',
            contentSha256: 'b'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 64,
            interface: JSON.stringify({
              category: 'control', labelVi: 'PID', labelEn: 'PID', allowedTypes: [],
              ports: [
                { name: 'PV', direction: 'INPUT', dataType: 'REAL' },
                { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
              ]
            })
          }
        ]
      })
    }
    if (method === 'GET' && path === '/projects') {
      return json(route, { items: [{ projectId: PROJECT_ID, name: 'AHU-01', etag: draftETag(state), activeRevisionId: ACTIVE_REVISION_ID, draftRevisionId: state.draft.project.projectId, updatedAt: new Date().toISOString() }] })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
      return json(route, { projectId: PROJECT_ID, name: 'AHU-01', etag: draftETag(state), activeRevisionId: ACTIVE_REVISION_ID, draftRevisionId: state.draft.project.projectId, updatedAt: new Date().toISOString(), draft: state.draft,
        /* `T59-816`: phiên mô phỏng chỉ mở được trên Revision đã Check ĐẠT.
           Không có `latestCheck`, bề mặt phải nói "chưa có bản đã kiểm" chứ
           không được tự chọn Draft. */
        ...(state.simulation?.supported
          ? { latestCheck: { checkId: 'check-sim-0001', revisionId: SIM_REVISION_ID, state: 'PASSED' } }
          : {}) })
    }

    /* `T59-816` — họ route Simulation R3.
       Mock này cố ý KHÔNG mô phỏng ngữ nghĩa ST: nó trả một chuỗi khung tất
       định. Thứ lane e2e kiểm là bề mặt (đọc-lại, nhãn nguồn, a11y, và việc
       KHÔNG có mutation nào rơi vào đường điều khiển thật), còn ngữ nghĩa
       worker đã có cổng riêng chạy binary thật. */
    if (path.startsWith('/simulation/sessions')) {
      const simulation = state.simulation
      if (!simulation?.supported) return json(route, { code: 'PRG-SIM-UNSUPPORTED-001' }, 409)

      const view = () => {
        const session = simulation.session
        if (session === null) return null
        return {
          sessionId: SIM_SESSION_ID, controllerId: 'foxlinx-lab', projectId: PROJECT_ID,
          sourceDraftRevisionId: SIM_REVISION_ID, sourceContentSha256: 'b'.repeat(64),
          state: session.state, sessionSequence: String(session.sequence),
          etag: `"${SIM_SESSION_ID}:${session.sequence}"`,
          baseTickMs: 1000, virtualTimeMs: String(session.virtualTimeMs), speed: 1,
          observationSequence: String(session.tick), resetEpoch: '0',
          createdAt: '2026-08-28T00:00:00Z', lastActivityAt: '2026-08-28T00:00:00Z',
          idleExpiresAt: '2026-08-28T00:15:00Z', hardExpiresAt: '2026-08-28T01:00:00Z',
          failureCode: null, workerVersion: 'sim-worker-e2e-1',
          simulationInputs: [{
            observationId: 'AHU.Setpoint', programId: PROGRAM_ID, variable: 'Setpoint',
            sourceKind: 'VAR_INPUT', dataType: 'REAL', unit: '°C', min: 10, max: 30,
            simulationWritable: true,
          }],
        }
      }

      if (method === 'POST' && path === '/simulation/sessions') {
        simulation.session = { state: 'PAUSED', sequence: 1, virtualTimeMs: 0, tick: 0 }
        return json(route, view(), 201)
      }
      if (method === 'GET' && path.endsWith('/observations')) {
        const session = simulation.session
        return json(route, {
          virtualTimeMs: session?.virtualTimeMs ?? 0,
          snapshotSequence: session?.tick ?? 0,
          resetEpoch: 0,
          observations: session === null || session.tick === 0 ? [] : [
            { observationId: 'AHU.Setpoint', programId: PROGRAM_ID, variable: 'Setpoint',
              kind: 'INPUT', dataType: 'REAL', quality: 'GOOD', value: 22.5 },
            { observationId: 'AHU.FanCommand', programId: PROGRAM_ID, variable: 'FanCommand',
              kind: 'OUTPUT', dataType: 'BOOL', quality: 'GOOD', value: true },
            /* Một ô CHƯA tính được. Nó phải hiện `—`, không bao giờ `0`. */
            { observationId: 'AHU.HeatDemand', programId: PROGRAM_ID, variable: 'HeatDemand',
              kind: 'OUTPUT', dataType: 'REAL', quality: 'UNAVAILABLE', value: null },
          ],
        })
      }
      if (method === 'POST' && path.endsWith('/actions')) {
        const session = simulation.session
        if (session === null) return json(route, { code: 'PRG-ERR-NOTFOUND-001' }, 404)
        const body = request.postDataJSON() as { action?: string }
        session.sequence += 1
        if (body.action === 'STEP_CYCLE') {
          session.tick += 1
          session.virtualTimeMs += 1000
          session.state = 'PAUSED'
        }
        if (body.action === 'RUN') session.state = 'RUNNING'
        if (body.action === 'PAUSE') session.state = 'PAUSED'
        return json(route, view())
      }
      if (method === 'PUT' && path.includes('/inputs/')) {
        const session = simulation.session
        if (session === null) return json(route, { code: 'PRG-ERR-NOTFOUND-001' }, 404)
        session.sequence += 1
        return json(route, view())
      }
      if (method === 'DELETE') {
        if (simulation.session !== null) {
          simulation.session.state = 'STOPPED'
          simulation.session.sequence += 1
        }
        const stopped = view()
        simulation.session = null
        return json(route, stopped)
      }
      if (method === 'GET') {
        const current = view()
        if (current === null) return json(route, { code: 'PRG-ERR-NOTFOUND-001' }, 404)
        return json(route, current)
      }
    }

    /* Bản đã niêm phong mà PHIÊN chạy — cố ý KHÁC cả Draft lẫn Active, để
       chứng minh được workbench đang đọc đúng tài liệu nào. */
    if (method === 'GET' && path === `/revisions/${SIM_REVISION_ID}`) {
      return json(route, {
        revisionId: SIM_REVISION_ID, sequence: 2, contentHash: 'b'.repeat(64),
        snapshot: {
          objects: [{
            objectId: POU_OBJECT_ID, kind: 'PROGRAM',
            payload: {
              objectId: POU_OBJECT_ID, kind: 'PROGRAM', name: 'Điều khiển AHU', language: 'ST',
              source: 'PROGRAM AHU_DA_NIEM_PHONG\nEND_PROGRAM\n',
              programConfig: { programId: PROGRAM_ID, periodMs: 1000 },
            },
          }],
        },
      })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/programs`) {
      return json(route, {
        schemaVersion: '1.0',
        projectId: PROJECT_ID,
        runtimeStateSource: 'CORE_LIVE',
        observedAt: new Date().toISOString(),
        programsTruncated: false,
        items: state.draft.programs.map((program) => ({
          programId: program.programId,
          desiredEnabled: true,
          generation: 1,
          updatedBy: 'admin',
          updatedAtUtcMs: 1,
          runtimeState: 'RUNNING',
          runtimeStateSource: 'CORE_LIVE',
          coreState: 'RUNNING',
          enabled: true,
          observedAt: new Date().toISOString(),
          periodMs: state.draft.task.periodMs,
          lastExecNs: 120000,
          maxExecNs: 310000,
          missedReleaseCount: 0,
          consecutiveMissedRelease: 0,
          lastRunAtUtc: new Date().toISOString(),
          lastRunAgeMs: 100,
          lane: 0,
          health: 'HEALTHY'
        }))
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
        /* `T59-803` — bốn thao tác POU typed của Draft v2. Mock phản chiếu đúng
           ngữ nghĩa backend: `upsertObject` KHÔNG tạo cấu hình chạy,
           `removeProgram` chỉ gỡ cấu hình, `removeObject` mới xoá POU. */
        if (operation.op === 'upsertObject') {
          const incoming = operation.object as { objectId: string; kind: MockProgram['kind']; name: string; language: MockProgram['language']; source: string }
          const index = nextDraft.programs.findIndex((program) => (program.objectId ?? program.programId) === incoming.objectId)
          const created: MockProgram = {
            objectId: incoming.objectId, programId: incoming.objectId, name: incoming.name,
            kind: incoming.kind, language: incoming.language, document: incoming.source,
            executionOrder: nextDraft.programs.length, functionalTags: []
          }
          if (index >= 0) nextDraft.programs[index] = created
          else nextDraft.programs.push(created)
        }
        if (operation.op === 'renameObject') {
          const target = nextDraft.programs.find((program) => (program.objectId ?? program.programId) === operation.objectId)
          if (target) target.name = operation.name as string
        }
        if (operation.op === 'duplicateObject') {
          const source = nextDraft.programs.find((program) => (program.objectId ?? program.programId) === operation.objectId)
          if (source) {
            nextDraft.programs.push({
              ...structuredClone(source),
              objectId: operation.newObjectId as string,
              programId: operation.newObjectId as string,
              name: operation.name as string
            })
          }
        }
        if (operation.op === 'removeObject') {
          nextDraft.programs = nextDraft.programs.filter((program) => (program.objectId ?? program.programId) !== operation.objectId)
        }
        if (operation.op === 'removeProgram') {
          nextDraft.task.programOrder = nextDraft.task.programOrder.filter((programId) => programId !== operation.programId)
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
    /* `T59-811` — LIVE đọc thân Revision đang chạy. Trước lát này chế độ LIVE
       bị chặn ở resolver nên không route nào cần stub; nay nó mount thật, và
       thiếu stub thì backend giả trả 503 và test bắt được console.error. */
    if (method === 'GET' && path === `/revisions/${ACTIVE_REVISION_ID}`) {
      return json(route, {
        revisionId: ACTIVE_REVISION_ID,
        sequence: 1,
        contentHash: 'a'.repeat(64),
        snapshot: {
          objects: [{
            objectId: POU_OBJECT_ID,
            kind: 'PROGRAM',
            payload: {
              objectId: POU_OBJECT_ID, kind: 'PROGRAM', name: 'Điều khiển AHU', language: 'ST',
              source: 'PROGRAM AHU_ACTIVE\nEND_PROGRAM\n',
              programConfig: { programId: PROGRAM_ID, periodMs: 1000 }
            }
          }]
        }
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
          outputMappingChanges: { status: 'NONE', items: [] },

          // T59-502: bốn nhóm impact của mô hình đa Program. Thiếu nhóm nào

          // thì trang fail-closed — "không thấy" không phải "không có".

          publishedSignals: { status: 'NONE', items: [] },

          controlLibrary: { status: 'NONE', items: [] },

          programSet: { status: 'NONE', items: [] },

          enableIntent: { status: 'NONE', items: [] }
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
          outputMappingChanges: { status: 'NONE', items: [] },

          // T59-502: bốn nhóm impact của mô hình đa Program. Thiếu nhóm nào

          // thì trang fail-closed — "không thấy" không phải "không có".

          publishedSignals: { status: 'NONE', items: [] },

          controlLibrary: { status: 'NONE', items: [] },

          programSet: { status: 'NONE', items: [] },

          enableIntent: { status: 'NONE', items: [] }
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
      state.monitorRequests = (state.monitorRequests ?? 0) + 1
      return json(route, {
        schemaVersion: '1.0', activeRevisionId: ACTIVE_REVISION_ID, safeState: false,
        producer: { capturedMonotonicNs: String(1_000 + state.monitorRequests) },
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
    if (method === 'POST' && path === '/retain/reset') {
      state.retainResetCount += 1
      return json(route, { operationId: 'operation-retain-reset-e2e', statusUrl: '', state: 'REQUESTED', requestHash: 'hash', acceptedAt: new Date().toISOString(), correlationId }, 202)
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

test.describe('Programming — sáu workspace, tám journey (T59-503)', () => {
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

  test('VS-PROG-032: lối vào cũ chuyển hướng đúng đích IA sáu trang và giữ projectId', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)

    // T59-306 ĐẢO CHIỀU: `programs`/`mapping` là ROUTE THẬT của IA sáu trang,
    // `/design` là lối vào cũ. T59-802 đẩy thêm một bậc: với cut-over PGM-02
    // BẬT (lane này build `VITE_PROGRAMS_WORKSPACE_V2=1`), mọi lối vào của
    // Chương trình đổ về MỘT route query canonical, còn `/mapping` không đổi.
    for (const [from, expectedPath, expectedTab] of [
      [`/eng/programming/projects/${PROJECT_ID}/programs`, CANONICAL_PROGRAMS_PATH, null],
      [`/eng/programming/projects/${PROJECT_ID}/mapping`, `/eng/programming/projects/${PROJECT_ID}/mapping`, null],
      [`/eng/programming/projects/${PROJECT_ID}/design`, CANONICAL_PROGRAMS_PATH, null],
      // `?tab=mapping` phải rẽ TRƯỚC khi chạm cut-over: đích của nó là workspace
      // Ánh xạ, không phải Chương trình.
      [`/eng/programming/projects/${PROJECT_ID}/design?tab=mapping`, `/eng/programming/projects/${PROJECT_ID}/mapping`, null],
      // `execution` là TAB CON, không phải trang IA — nó chỉ có địa chỉ dưới
      // dạng `?tab=execution`, và phải sống sót qua HAI chặng redirect.
      [`/eng/programming/projects/${PROJECT_ID}/task`, CANONICAL_PROGRAMS_PATH, 'execution']
    ] as const) {
      await navigate(page, from)
      await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 10_000 })
      expect(new URL(page.url()).searchParams.get('tab')).toBe(expectedTab)
      if (expectedPath === CANONICAL_PROGRAMS_PATH) {
        // Canonical không được đánh mất Project: rơi `project` là mở lại
        // resolver và người dùng phải chọn lại Project vừa đứng trong đó.
        expect(new URL(page.url()).searchParams.get('project')).toBe(PROJECT_ID)
        expect(new URL(page.url()).searchParams.get('mode')).toBe('EDIT')
      }
    }
  })

  test('UJ-PROG-01..08: Tổng quan → Thiết kế (ST+FBD+ánh xạ+thực thi) → Kiểm tra → Đưa vào vận hành → Runtime → Khôi phục', async ({ page }, testInfo) => {
    // T59-802/DDD §7.5: dưới 768 px PGM-02 là READ-ONLY. Journey này soạn
    // thảo, nên chạy nó ở lane mobile sẽ là đòi hỏi đúng thứ thiết kế vừa cấm.
    // Bằng chứng mobile nằm ở case read-only riêng phía dưới, không bị bỏ trống.
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX,
      'PGM-02 khóa read-only dưới 768 px; journey soạn thảo có lane desktop'
    )
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
    // T60-102/T60-103 ĐẢO CHIỀU khẳng định này: trước Plan 60, Tổng quan in
    // thẳng `activeRevisionId` dạng UUID ra mặt trước. `AC-PGM01-01` cấm điều
    // đó — UUID chỉ còn nằm trong popover `Chi tiết`. Giữ nguyên khẳng định
    // "người dùng vẫn đọc lại được ID thô khi cần", chỉ đổi CHỖ đọc.
    await expect(page.getByText(ACTIVE_REVISION_ID)).toHaveCount(0)
    await page.getByRole('button', { name: /Chi tiết|Details/ }).first().click()
    await expect(page.getByText(ACTIVE_REVISION_ID).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(ACTIVE_REVISION_ID)).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

    // UJ-PROG-02 — mở workspace Thiết kế qua Project trong Draft panel
    //
    // Chờ ĐÍCH CUỐI (`programs`), không chờ lối vào cũ `design`. IA của W5 đổi
    // `design` thành redirect sang `programs` (xem bảng redirect ở test phía
    // trên), nên chờ `design` là chờ một trạng thái TRUNG GIAN của redirect:
    // máy chậm thì Playwright kịp nhìn thấy và test xanh, máy nhanh thì redirect
    // xong trước và test treo tới hết giờ. Đó chính là nguồn "flake" của cổng
    // e2e — không phải hạ tầng, mà là một assertion đua với redirect.
    await page.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }).click()
    await page.waitForURL((url) => url.pathname === CANONICAL_PROGRAMS_PATH)
    await expect(page.getByText('Chưa có chương trình. Bấm + để tạo.')).toBeVisible()

    // Thêm chương trình ST bằng bàn phím hoàn toàn (Tab tới nút, Enter kích hoạt)
    await page.getByTitle('Thêm chương trình ST').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'NewProgram' })).toBeVisible()
    const sourceBox = page.getByLabel(/Mã nguồn ST/)
    await sourceBox.fill('AO1 := UI1 * 2.0;')
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('02-design-st.png'), fullPage: true })

    // Đổi tab không mất nội dung đang gõ: gõ dở rồi chuyển tab và quay lại
    await sourceBox.fill('AO1 := UI1 * 2.0; (* dở dang *)')
    await page.getByRole('tab', { name: /Điểm & Ánh xạ/ }).click()
    await expect(page.getByRole('tab', { name: /Chương trình/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click()
    await expect(sourceBox).toHaveValue('AO1 := UI1 * 2.0; (* dở dang *)')
    await expect(page.getByText(/Draft có thay đổi chưa lưu/)).toBeVisible()
    /* `DEV-PROG-009` đưa `Kiểm tra` lên header nữa, nên có HAI nút cho cùng
       hành động — đúng ý đồ ("giữ ở toolbar, nơi chính là header"). Tên truy
       cập khác nhau (`Kiểm tra` vs `Kiểm tra gói`) nên phép chọn phải nói rõ
       nó nhắm nút nào; cả hai đều phải bị khoá khi Draft còn bẩn. */
    await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Kiểm tra gói', exact: true })).toBeDisabled()
    await sourceBox.press('Control+s')
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)

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
    // `T59-806` — canvas node–edge mới phải qua chính bộ quét a11y của dự án.
    // Bộ quét cũ chỉ chạy trên workspace mặc định (chương trình ST), nên trước
    // lát này CHƯA lần nào FBD editor bị soi thật.
    const fbdAxe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(fbdAxe.violations, 'Vi phạm a11y trên canvas FBD').toEqual([])

    await page.screenshot({ path: testInfo.outputPath('03-design-fbd.png'), fullPage: true })
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()

    // UJ-PROG-03 — Điểm & Ánh xạ
    await page.getByRole('tab', { name: /Điểm & Ánh xạ/ }).click()
    /* `PR #311` dựng lại tab Điểm & Ánh xạ (`MappingWorkbench`); câu trạng thái
       rỗng nay nói rõ nó nói về DRAFT, không phải về thiết bị — "Chưa có ánh xạ
       nào" một mình có thể bị đọc thành "thiết bị không có điểm nào". */
    await expect(page.getByText('Chưa có ánh xạ nào trong Draft.')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('04-design-mapping.png'), fullPage: true })

    // UJ-PROG-04 — Thực thi
    await page.getByRole('tab', { name: 'Thực thi' }).click()
    await expect(page.getByText('Control_Main')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('05-design-execution.png'), fullPage: true })

    // UJ-PROG-05 — Kiểm tra (D-01: PGM-02 chỉ lưu rồi điều hướng, PGM-03 sở
    // hữu toàn bộ seal/run/poll/result — không còn seal/Check inline ở đây).
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click()
    /* Hai nút cùng hành động (`DEV-PROG-009`), tên truy cập khác nhau. Case này
       đi bằng nút của thanh công cụ — đúng đường người dùng vừa gõ xong sẽ bấm. */
    await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click()
    await page.waitForURL((url) => url.pathname === `/eng/programming/projects/${PROJECT_ID}/commission`)
    await expect(page.getByText('Chưa có Kiểm tra nào.')).toBeVisible()
    await page.getByRole('button', { name: 'Kiểm tra' }).click()
    await expect(page.getByText('PASSED')).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: testInfo.outputPath('06-commission.png'), fullPage: true })

    // UJ-PROG-06 — Đưa vào vận hành

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
    await expect(page.getByText('4.1 V')).toBeVisible()
    await expect(page.getByText('6.2 V')).toBeVisible()
    await expect(page.getByText('manual · operator-e2e')).toBeVisible()
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
    await expect(page.getByRole('button', { name: /Đặt lại RETAIN…/ })).toBeEnabled()
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
    // Modal Khôi phục KHÔNG tự đóng sau khi thành công (giữ nguyên kết quả cho
    // người dùng đọc) — đóng thủ công trước khi mở dialog RETAIN reset kế tiếp.
    await restoreDialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // WP-12 (RETAIN Reset) — danh sách biến RETAIN thật (dùng lại GET
    // /revisions/none/changes/{active}), tick xác nhận, re-auth, đọc ngược SUCCEEDED.
    await page.getByRole('button', { name: /Đặt lại RETAIN…/ }).click()
    const retainDialog = page.getByRole('dialog')
    await expect(retainDialog.getByText('SupplySetpoint')).toBeVisible()
    await expect(retainDialog.getByText('FanRuntimeHours')).toBeVisible()
    await retainDialog.getByRole('checkbox').check()
    await retainDialog.getByLabel('Lý do đặt lại RETAIN').fill('Kiểm chứng E2E TASK-PROG-506')
    await retainDialog.getByLabel(/Xác thực lại/).fill('admin')
    await retainDialog.getByRole('button', { name: 'Đặt lại RETAIN' }).click()
    await expect(page.getByText(/Đặt lại RETAIN thành công/)).toBeVisible({ timeout: 10_000 })
    expect(state.retainResetCount).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('11-retain-reset-succeeded.png'), fullPage: true })

    // Console/Network — không có lỗi ngoài các 503 chủ động (runtime/monitor
    // GET, runtime/traces theo id lạ...) đã được UI xử lý như trạng thái hợp lệ.
    const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes('503') && !text.includes('Failed to load resource'))
    expect(unexpectedConsoleErrors, `Console error ngoài dự kiến: ${unexpectedConsoleErrors.join(' | ')}`).toEqual([])
  })

  test('VS-PROG-028: sáu workspace không có vi phạm WCAG A/AA tự động phát hiện được', async ({ page }) => {
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
      { path: '/eng/programming', ready: page.getByRole('heading', { name: 'Lập trình điều khiển' }) },
      { path: `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`, ready: page.getByRole('button', { name: /Điều khiển AHU/ }) },
      {
        path: `/eng/programming/projects/${PROJECT_ID}/commission?revisionId=revision-mock-0001&checkId=check-mock-0001`,
        ready: page.getByText('PASSED')
      },
      { path: '/eng/programming/runtime?tab=watch', ready: page.getByText('SupplySetpoint') }
    ]

    for (const screen of screens) {
      await navigate(page, screen.path)
      await expect(screen.ready.first()).toBeVisible()
      const result = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(result.violations, `Vi phạm a11y tại ${screen.path}`).toEqual([])
    }
  })

  test('F-PROG-LIVE-008: mobile có điều hướng sáu workspace và lịch sử không bị cắt', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming/runtime?tab=service')

    const nav = page.getByRole('navigation', { name: 'Điều hướng sáu workspace Lập trình' })
    await expect(nav).toBeVisible()
    // T60-208 rút bottom nav còn BỐN đích (handoff §7); ba bề mặt soạn thảo
    // chuyển vào ngăn `Thêm`. Khẳng định giữ nguyên: trên màn hẹp vẫn tới được
    // ĐỦ SÁU workspace — chỉ đổi chỗ đứng của ba đích.
    for (const label of ['Tổng quan', 'Kiểm tra', 'Runtime']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible()
    }
    await nav.getByRole('button', { name: /Thêm đích Lập trình|More Programming destinations/ }).click()
    const more = page.getByTestId('programming-mobile-more')
    // Ngăn `Thêm` dùng nhãn ĐẦY ĐỦ (không phải nhãn rút gọn của thanh nav):
    // ở đây có chỗ cho tên truy cập được, và tên đầy đủ mới nói rõ đích đến.
    for (const label of ['Chương trình', 'Điểm & Ánh xạ', 'Thư viện điều khiển']) {
      await expect(more.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('COMMISSION').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('mobile-service-history.png'), fullPage: true })
  })
})

/* ==================================================================== *
 * `T60-302` — PGM-01 Overview: bốn khẳng định của Plan 60 §6            *
 * ==================================================================== */

test.describe('PGM-01 Overview — hợp đồng hiển thị (T60-302)', () => {
  test('AC-PGM01-05: đúng MỘT hành động chính trên toàn trang', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming')

    // Chờ trang dựng xong trước khi đếm: lúc còn skeleton thì CTA chưa quyết,
    // và đếm sớm sẽ ra 0 mà tưởng là vi phạm hợp đồng.
    await expect(page.getByTestId('system-health-hero')).toBeVisible()

    // Một trang có hai nút "chính" là một trang không có nút chính nào: người
    // dùng phải tự đoán cái nào mới là việc nên làm tiếp. Đếm CẢ ba biến thể —
    // `primary-cta` (đã quyết) và `primary-cta-undecided` (thiếu dữ kiện, cố ý
    // không đoán) loại trừ nhau, nên tổng phải đúng 1.
    const decided = await page.getByTestId('primary-cta').count()
    const undecided = await page.getByTestId('primary-cta-undecided').count()
    expect(decided + undecided).toBe(1)

    // QuickActions cố ý KHÔNG chứa hành động chính — nó là khối ưu tiên thị
    // giác thấp; nếu một lối tắt ở đó cũng nổi bật thì `AC-PGM01-05` vỡ mà
    // không ai thấy.
    const quick = page.getByTestId('quick-actions')
    await expect(quick).toBeVisible()
    await expect(quick.getByTestId('primary-cta')).toHaveCount(0)
    await expect(quick.getByTestId('primary-cta-undecided')).toHaveCount(0)
  })

  test('AC-PGM01-01: mặt trước Tổng quan không có chuỗi UUID nào', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming')
    await expect(page.getByTestId('system-health-hero')).toBeVisible()

    // Quét CẢ TRANG bằng regex UUID thay vì kiểm từng chuỗi đã biết: một
    // revision id mới lọt ra ở khối khác sẽ không bị bắt nếu chỉ kiểm danh
    // sách cứng.
    const uuidCount = await page.evaluate(() => {
      const text = document.body.innerText
      return (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).length
    })
    expect(uuidCount).toBe(0)
  })

  test('deep-link từ mục cần chú ý đi ĐÚNG trang chủ quản, không dồn hết về Runtime', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming')

    await expect(page.getByTestId('system-health-hero')).toBeVisible()
    // Thẻ không có `data-testid` riêng; định vị bằng chính tiêu đề người dùng
    // đọc được, để test không phụ thuộc một hook nội bộ có thể bị đổi.
    const attention = page.locator('section', { has: page.getByText(/Việc cần chú ý|Attention required/) }).first()
    const links = attention.getByRole('link')
    const total = await links.count()
    if (total === 0) {
      // Không có mục nào thì không có gì để kiểm — nhưng phải nói ra, chứ
      // không lặng lẽ pass như thể đã kiểm.
      test.info().annotations.push({ type: 'ghi chú', description: 'Không có mục cần chú ý trong kịch bản mock này' })
      return
    }
    const targets = new Set<string>()
    for (let i = 0; i < total; i += 1) {
      const href = await links.nth(i).getAttribute('href')
      if (href) targets.add(new URL(href, 'http://x').pathname)
    }
    // Khuyết tật trước Plan 60: MỌI mục đều trỏ `/eng/programming/runtime`.
    const allRuntime = [...targets].every((path) => path.endsWith('/runtime'))
    expect(allRuntime && targets.size > 1).toBe(false)
  })

  test('Core im: banner nói rõ, vẫn cho sửa, và KHOÁ Đưa vào vận hành', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    // Core im SAU khi mock đã cài: chỉ chặn đúng đường runtime, giữ nguyên các
    // đường khác để phân biệt "Core im" với "backend chết".
    await page.route('**/api/v1/programming/runtime', (route) => route.abort())
    await login(page)
    await navigate(page, '/eng/programming')

    const quick = page.getByTestId('quick-actions')
    await expect(quick).toBeVisible()

    // Commission bị khoá vì không đọc được Core — không được đoán là READY.
    const commission = quick.locator('[data-quick-action="commission"]')
    await expect(commission).toHaveAttribute('aria-disabled', 'true')
    await expect(commission).toHaveAttribute('data-blocked-by', /CORE_/)

    // Nhưng SỬA thì vẫn mở: Core im không phải lý do cấm người ta soạn thảo.
    await expect(quick.locator('[data-quick-action="edit"]')).not.toHaveAttribute('aria-disabled', 'true')
  })
})

/* ==================================================================== *
 * `T60-304` — bàn phím, RBAC và ĐO THẬT ở hai khổ màn hình             *
 * ==================================================================== */

test.describe('PGM-01 Overview — a11y, RBAC và số đo khổ màn hình (T60-304)', () => {
  test('1280×750: nội dung chính KHÔNG bị đẩy xuống dưới màn hình đầu', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Phép đo này thuộc khổ desktop')
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    // 1280×750 là khổ ngặt nhất trong Plan 60 §6: laptop 1280 với thanh trình
    // duyệt ăn mất chiều cao. Đây là ĐO THẬT, không phải khẳng định bằng lời.
    await page.setViewportSize({ width: 1280, height: 750 })
    await login(page)
    await navigate(page, '/eng/programming')
    await expect(page.getByTestId('system-health-hero')).toBeVisible()

    const fold = 750
    for (const id of ['system-health-hero', 'primary-cta', 'primary-cta-undecided']) {
      const locator = page.getByTestId(id)
      if (await locator.count() === 0) continue
      const box = await locator.first().boundingBox()
      expect(box, `${id} phải có hộp bao`).not.toBeNull()
      // Mép TRÊN phải nằm trong màn hình đầu: người dùng phải thấy hệ có khoẻ
      // không và việc nên làm tiếp là gì mà không cần cuộn.
      expect(box!.y, `${id} bị đẩy xuống dưới màn hình đầu (y=${box!.y})`).toBeLessThan(fold)
    }

    // Không trang nào được tràn ngang ở khổ này.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `trang tràn ngang ${overflow}px`).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath('overview-1280x750.png'), fullPage: false })
  })

  test('390 px: không tràn ngang và không chuỗi UUID nằm ngang', async ({ page }, testInfo) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    await navigate(page, '/eng/programming')
    await expect(page.getByTestId('system-health-hero')).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `trang tràn ngang ${overflow}px ở 390`).toBeLessThanOrEqual(0)

    // `AC-PGM01-01` ở khổ hẹp: một UUID 36 ký tự nằm ngang là thứ chắc chắn đẩy
    // trang tràn, nên đây vừa là kiểm hợp đồng vừa là kiểm bố cục.
    const uuidCount = await page.evaluate(() => {
      const text = document.body.innerText
      return (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).length
    })
    expect(uuidCount).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('overview-390.png'), fullPage: true })
  })

  test('bàn phím đi hết: mở Chi tiết, đóng bằng Esc và tiêu điểm trở về đúng nút', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, '/eng/programming')

    const detailsButton = page.getByRole('button', { name: /Chi tiết|Details/ }).first()
    await detailsButton.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Trả tiêu điểm là phần hay bị bỏ sót nhất: không trả thì người dùng bàn
    // phím bị ném về đầu tài liệu và phải Tab lại từ đầu.
    await expect(detailsButton).toBeFocused()
  })

  /* MA TRẬN RBAC KHÔNG KIỂM ĐƯỢC Ở TẦNG NÀY.
   *
   * Mock đăng nhập của spec này trả `role: 'admin'` cứng (dòng ~269), nên không
   * có đường nào đăng nhập viewer/operator mà không sửa một mock dùng chung cho
   * mọi case khác. Dựng một case "viewer" trên phiên admin sẽ là một case GIẢ:
   * nó xanh mà không chứng minh gì.
   *
   * Ma trận RBAC đầy đủ nằm ở mức component:
   * `overview/QuickActions.test.tsx` — ba vai × bốn lối tắt × bốn tình trạng
   * Core, gồm cả khẳng định nút bị chặn vẫn NHẬN TIÊU ĐIỂM (dùng
   * `aria-disabled`, không dùng thuộc tính `disabled`) và `aria-describedby`
   * trỏ tới đúng câu lý do. `OverviewPage.test.tsx` case `§6-6 viewer` phủ
   * nhánh "giữ nguyên phần đọc" ở mức trang.
   * Mức evidence cho RBAC vì vậy là HOST/component, KHÔNG phải E2E. */
})

/* ==================================================================== *
 * `T59-802` — PGM-02 v2: vỏ chung, route canonical và mobile read-only  *
 *                                                                      *
 * Lane này build với `VITE_PROGRAMS_WORKSPACE_V2=1`, nên đây là bằng    *
 * chứng hành vi của nhánh CUT-OVER trên Chrome thật. Mặc định sản phẩm  *
 * vẫn là cờ TẮT (`npm run build`), và điều đó được khẳng định ở tầng    *
 * unit (`shared/config.test.ts`) chứ không giả lập ở đây.               *
 * ==================================================================== */

const UNKNOWN_PROJECT_ID = '99999999-9999-4999-8999-999999999999'

/** Mọi mutation của Programming đều đi qua đây; GET không phải mutation. */
function observeProgrammingWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/programming')) return
    if (request.method() === 'GET') return
    writes.push(`${request.method()} ${url.pathname}`)
  })
  return writes
}

test.describe('PGM-02 v2 — vỏ, route canonical và mobile read-only (T59-802)', () => {
  test('resolver phân giải Project tường minh và KHÔNG mượn Project khác', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)

    // Đúng một Project và thiếu query: canonicalize bằng `replace`.
    await navigate(page, CANONICAL_PROGRAMS_PATH)
    await page.waitForURL((url) => url.searchParams.get('project') === PROJECT_ID, { timeout: 10_000 })
    expect(new URL(page.url()).searchParams.get('mode')).toBe('EDIT')

    // Project không tồn tại: dừng ở trạng thái not-found, KHÔNG mở Project đầu
    // tiên. Đây là nhánh mà một fallback "cho tiện" sẽ mở nhầm ứng dụng điều
    // khiển của controller khác mà người dùng không hề biết.
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${UNKNOWN_PROJECT_ID}&mode=EDIT`)
    await expect(page.getByText(/Không tìm thấy Project|The project was not found/)).toBeVisible()
    expect(new URL(page.url()).searchParams.get('project')).toBe(UNKNOWN_PROJECT_ID)
    await expect(page.getByRole('button', { name: /Điều khiển AHU/ })).toHaveCount(0)

    // `mode` lạ: báo lỗi, không âm thầm hạ về EDIT.
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=NOPE`)
    await expect(page.getByText(/Chế độ workspace không hợp lệ|workspace mode is invalid/)).toBeVisible()
    expect(new URL(page.url()).searchParams.get('mode')).toBe('NOPE')

    /* `T59-815` mở SIMULATE ở R3. Resolver KHÔNG còn tự chặn chế độ này — câu
       trả lời "thiết bị có mô phỏng được không" thuộc capability của server.
       Điều KHÔNG đổi: mock không công bố capability nên bề mặt phải nói ra và
       tuyệt đối không rơi về Draft. */
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=SIMULATE`)
    await expect(page.getByText(/chưa công bố khả năng Mô phỏng|does not advertise the Simulation capability/)).toBeVisible()
    await expect(page.getByLabel(/Mã nguồn ST của/)).toHaveCount(0)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=LIVE`)
    await expect(page.getByText(/LIVE chưa khả dụng|LIVE is unavailable/)).toHaveCount(0)

    expectNoBrowserFailures(failures, 'resolver canonical')
  })

  test('deep-link theo objectId mở đúng POU và giữ nguyên query chẩn đoán', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT&line=1&column=1&length=7`)
    await expect(page.getByRole('heading', { name: 'Điều khiển AHU' })).toBeVisible()
    const url = new URL(page.url())
    // Identity chọn POU là `objectId`; `programId` runtime KHÔNG được thay thế
    // nó trên URL, nếu không hai định danh sẽ lẫn ngay ở lối vào đầu tiên.
    expect(url.searchParams.get('pou')).toBe(POU_OBJECT_ID)
    expect(url.searchParams.get('pou')).not.toBe(PROGRAM_ID)
    expect(url.searchParams.get('line')).toBe('1')
    expect(url.searchParams.get('length')).toBe('7')

    expectNoBrowserFailures(failures, 'deep-link objectId')
  })

  test('AC-PGM02-010: dưới 768 px: workspace chỉ đọc và không phát sinh request ghi nào', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    const writes = observeProgrammingWrites(page)
    await login(page)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)
    await expect(page.getByTestId('programming-mobile-read-only')).toBeVisible()

    // Chỉ-đọc phải là POLICY RUNTIME, không phải CSS: `readonly` thật trên
    // textarea, và gõ vào không đổi được nội dung.
    const source = page.getByLabel(/Mã nguồn ST/)
    await expect(source).toHaveAttribute('readonly', '')
    const before = await source.inputValue()
    await source.click()
    await page.keyboard.type('AO1 := 1.0;')
    expect(await source.inputValue()).toBe(before)

    // Không nút lưu/tạo/xóa nào được mở trên màn hẹp.
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)
    await expect(page.getByTitle('Thêm chương trình ST')).toHaveCount(0)

    expect(writes, 'màn hẹp không được gửi mutation nào').toEqual([])
    expectNoBrowserFailures(failures, 'mobile read-only')
  })

  test('AC-PGM02-002: 1280×750 — trình soạn thảo PGM-02 thấy được mà KHÔNG cuộn trang', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Phép đo này thuộc khổ desktop')
    /* `T59-822` — trước lát này phép đo 1280×750 CHỈ chạy cho PGM-01 Tổng quan.
     * `AC-PGM02-002` nói về chính khổ giấy của workspace PGM-02, nơi ba cột
     * (cây POU 280 px + trình soạn thảo + Inspector 308 px) cộng thanh tab,
     * toolbar và thanh trạng thái cùng tranh chiều cao. Suy từ kết quả của một
     * trang khác không phải là đo. */
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await page.setViewportSize({ width: 1280, height: 750 })
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)

    await page.getByRole('button', { name: /^Mở / }).first().click()
    const editor = page.getByLabel(/Mã nguồn ST/)
    await expect(editor).toBeVisible()

    const fold = 750
    const box = await editor.boundingBox()
    expect(box, 'trình soạn thảo phải có hộp bao').not.toBeNull()
    /* Câu của AC là *"main editor/canvas visible without page scroll"*, nên chủ
     * ngữ là TRÌNH SOẠN THẢO: cả khung của nó phải nằm trong màn hình đầu.
     *
     * Cố ý KHÔNG đòi `scrollHeight <= innerHeight` cho cả tài liệu: trang còn
     * Inspector và khay workbench nằm dưới một cách chính đáng, và bắt cả trang
     * gói gọn trong 750 px là một ràng buộc CHẶT HƠN điều AC nói. Test phải
     * khoá đúng câu của hợp đồng, không khoá một câu nghiêm hơn do mình nghĩ ra
     * — một test như thế sẽ đỏ vì lý do không ai đồng ý và rồi bị tắt đi. */
    expect(box!.y, `mép trên trình soạn thảo bị đẩy khỏi màn hình đầu (y=${box!.y})`).toBeGreaterThanOrEqual(0)
    expect(box!.y, `mép trên trình soạn thảo bị đẩy xuống dưới màn hình đầu (y=${box!.y})`).toBeLessThan(fold)
    expect(
      box!.y + box!.height,
      `mép dưới trình soạn thảo vượt màn hình đầu (${Math.round(box!.y + box!.height)}px > ${fold}px) — phải cuộn trang mới thấy hết chỗ gõ`,
    ).toBeLessThanOrEqual(fold)

    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflowX, `trang tràn ngang ${overflowX}px`).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath('pgm02-1280x750.png'), fullPage: false })
  })

  test('DEV-PROG-001: workbench thấy và bấm được mà KHÔNG cuộn trang', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Phép đo này thuộc khổ desktop')
    /* Triệu chứng người dùng báo: dải tab của workbench (Vấn đề / Tìm kiếm /
     * Tham chiếu / Watch / Trace) "bị sidebar che".
     *
     * Đo trên bo thật (Chrome, 1280×800, POU 128 dòng): rail nằm `x=21..241`,
     * workbench bắt đầu `x=257` — KHÔNG chồng lấn. Thứ sai là chiều cao: tài
     * liệu cao 2861 px và dải tab rơi xuống `y=2675`, tức phải cuộn ~1900 px
     * mới tới. Rail thì `sticky` nên suốt lúc cuộn nó vẫn đứng cạnh vùng trống.
     *
     * Test này khoá cả hai vế, vì sửa một vế mà bỏ vế kia thì triệu chứng cũ
     * quay lại dưới một hình dạng khác:
     *   1. dải tab nằm TRỌN trong màn hình đầu;
     *   2. mỗi tab hit-test trúng CHÍNH NÓ (không phần tử nào phủ lên). */
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await page.setViewportSize({ width: 1280, height: 800 })
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)
    await page.getByRole('button', { name: /^Mở / }).first().click()
    await expect(page.getByLabel(/Mã nguồn ST/)).toBeVisible()

    const tablist = page.getByRole('tablist', { name: 'Khay bàn làm việc' })
    await expect(tablist).toBeVisible()
    const box = await tablist.boundingBox()
    expect(box, 'dải tab workbench phải có hộp bao').not.toBeNull()
    expect(box!.y, `dải tab workbench bị đẩy xuống dưới màn hình đầu (y=${Math.round(box!.y)})`).toBeLessThan(800)
    expect(
      box!.y + box!.height,
      `mép dưới dải tab vượt màn hình đầu (${Math.round(box!.y + box!.height)}px > 800px)`,
    ).toBeLessThanOrEqual(800)

    const tabs = tablist.getByRole('tab')
    const count = await tabs.count()
    expect(count, 'workbench phải có đủ năm khay').toBe(5)
    for (let index = 0; index < count; index += 1) {
      const tab = tabs.nth(index)
      const name = (await tab.textContent())?.trim() ?? ''
      const rect = await tab.boundingBox()
      expect(rect, `tab "${name}" phải có hộp bao`).not.toBeNull()
      const hit = await page.evaluate(
        ([x, y]) => {
          const top = document.elementFromPoint(x, y)
          const tabElement = top?.closest('[role="tab"]')
          return tabElement ? (tabElement.textContent ?? '').trim() : `KHÔNG PHẢI TAB: ${top?.tagName ?? 'none'}`
        },
        [rect!.x + rect!.width / 2, rect!.y + rect!.height / 2],
      )
      expect(hit, `tab "${name}" bị phần tử khác phủ lên`).toBe(name)
    }

    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflowX, `trang tràn ngang ${overflowX}px`).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath('dev-prog-001-workbench.png'), fullPage: false })
  })

  test('AC-PGM02-001: MỘT cây POU: ba kind, deep-link theo objectId và reload giữ đúng POU', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX,
      'tạo/xóa POU là mutation; màn hẹp read-only có case riêng'
    )
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)

    // `T59-803`: đúng MỘT navigation POU trong DOM. Trước lát này có hai cây
    // đọc hai nguồn khác nhau, nên hai bề mặt có thể nói khác nhau về cùng một
    // Project và người dùng bàn phím phải đi qua cả hai.
    await expect(page.getByRole('navigation', { name: 'Cây POU' })).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Cây ứng dụng' })).toHaveCount(0)

    // Ba kind cùng có mặt, và FUNCTION/FUNCTION_BLOCK KHÔNG có chu kỳ.
    await page.getByTitle('Thêm FUNCTION', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mở NewFunction', exact: true })).toBeVisible()
    await page.getByTitle('Thêm FUNCTION_BLOCK').click()
    await expect(page.getByRole('button', { name: 'Mở NewFunctionBlock' })).toBeVisible()
    await page.getByRole('button', { name: 'Mở NewFunction', exact: true }).click()
    /* `DEV-PROG-011` — câu này TỪNG nằm trong khay "Thuộc tính POU" của thanh
       bên; nó đã về `ContextInspector` ở cột phải cùng bốn trường còn lại. Giữ
       hai khay thuộc tính ở hai cột là hai chỗ có thể nói khác nhau về cùng một
       POU. Khẳng định không đổi: FUNCTION không có lịch chạy và giao diện phải
       NÓI RA điều đó, không để một ô chu kỳ xám gợi ý rằng bật được ở đâu đó. */
    await expect(page.getByTestId('context-inspector')).toContainText('Chạy khi được gọi')

    // Lọc chỉ đổi thứ được vẽ, không đổi POU đang chọn.
    await page.getByLabel('Tìm POU').fill('NewFunctionBlock')
    await expect(page.getByRole('button', { name: 'Mở NewFunction', exact: true })).toHaveCount(0)
    await page.getByLabel('Tìm POU').fill('')

    // Deep-link dùng objectId của POU, không dùng identity runtime.
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)
    await expect(page.getByRole('heading', { name: 'Điều khiển AHU' })).toBeVisible()
    /* Reload trong lane này rơi về màn đăng nhập (phiên chưa persist — đó là
       một finding riêng, không phải của lát này). Sau khi đăng nhập lại,
       deep-link phải mở đúng POU cũ: đó mới là điều `T59-803` khẳng định. */
    await page.reload()
    await login(page)
    await expect(page.getByRole('heading', { name: 'Điều khiển AHU' })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('pou')).toBe(POU_OBJECT_ID)

    expectNoBrowserFailures(failures, 'một cây POU')
  })

  test('AC-PGM02-004 / AC-FBD-002: Thư viện nhanh dùng CHUNG catalog và nói thật về mục chưa dùng được', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX,
      'chèn khối là mutation; màn hẹp read-only có case riêng'
    )
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    const libraryRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/programming/libraries')) libraryRequests.push(url.pathname)
    })
    await login(page)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)
    await expect(page.getByLabel(/Mã nguồn ST/)).toBeVisible()
    // Mở tab Chương trình KHÔNG được tạo traffic catalog; panel mới là thứ fetch.
    expect(libraryRequests, 'catalog phải LAZY').toEqual([])

    /* `DEV-PROG-002` — Thư viện nhanh nay là panel CẮM ở cột phải
       (`role="region"`), không còn là hộp thoại nổi phủ lên mã nguồn; và nút
       trên thanh công cụ có tên chính xác là `Thư viện` (nút "Mở Thư viện
       nhanh" ở cột phải là lối mở thứ hai khi panel đang thu gọn). */
    await page.getByRole('button', { name: 'Thư viện', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Thư viện nhanh' })
    await expect(panel).toBeVisible()
    await expect.poll(() => libraryRequests.length).toBeGreaterThan(0)

    // Mục chờ review hiện ra kèm lý do và KHÔNG bấm được — giấu nó đi sẽ biến
    // "chưa hỗ trợ" thành "không tồn tại".
    await expect(panel.getByRole('button', { name: 'Chèn PID' })).toBeDisabled()
    await expect(panel.getByText('Chờ review sản phẩm')).toBeVisible()

    // Chèn một FUNCTION: đúng lời gọi của catalog, và là MỘT bước hoàn tác.
    const source = page.getByLabel(/Mã nguồn ST/)
    const before = await source.inputValue()
    await panel.getByRole('button', { name: 'Chèn LIMIT' }).click()
    await expect(source).toHaveValue(/OUT := LIMIT\(MN, IN, MX\);/)
    await source.press('Control+z')
    await expect(source).toHaveValue(before)

    expectNoBrowserFailures(failures, 'thư viện nhanh')
  })

  test('bàn phím đi hết vỏ mới: Tab tới cây POU và Enter chọn đúng POU', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX,
      'case bàn phím soạn thảo chỉ có nghĩa ở lane desktop'
    )
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)
    const pou = page.getByRole('button', { name: 'Mở Điều khiển AHU' })
    await pou.focus()
    await expect(pou).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel(/Mã nguồn ST/)).toBeVisible()
    // Chọn POU bằng bàn phím không được đổi địa chỉ đang đứng.
    const url = new URL(page.url())
    expect(url.pathname).toBe(CANONICAL_PROGRAMS_PATH)
    expect(url.searchParams.get('project')).toBe(PROJECT_ID)

    expectNoBrowserFailures(failures, 'bàn phím vỏ v2')
  })
})

/**
 * `T59-808` / `PGM02-V22-WP-10-R1` + `WP-11-R1` — hardening EDIT.
 *
 * Acceptance đòi "no horizontal overflow, focus/contrast/keyboard". Ba thứ đó
 * đều có **số đã pin** trong `pgm02_workspace_v1.json` §`nfr` — nhưng trước lát
 * này không phép kiểm nào đọc chúng, nên chúng là số trang trí.
 */
test.describe('PGM-02 hardening EDIT (T59-808)', () => {
  /** Khổ màn đã pin ở `nfr.viewport`; mỗi khổ là một hợp đồng khác nhau. */
  const VIEWPORTS = [
    { label: 'full shell', width: 1280, height: 900 },
    { label: 'compact dock', width: 1024, height: 800 },
    { label: 'drawer', width: 768, height: 800 },
    { label: 'mobile read-only', width: 390, height: 844 },
  ]

  for (const viewport of VIEWPORTS) {
    test(`không tràn ngang ở ${viewport.label} (${viewport.width}px)`, async ({ page }) => {
      const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await installProgrammingMocks(page, state)
      await login(page)
      await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)
      await expect(page.getByRole('button', { name: 'Mở Điều khiển AHU' })).toBeVisible()

      const width = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
      /* Tràn ngang trên tủ điều khiển không chỉ xấu: nó đẩy nút thao tác ra
         ngoài vùng chạm, và người vận hành không có chuột để cuộn ngang. */
      expect(width.document, `${viewport.label}: document tràn ngang`).toBeLessThanOrEqual(width.viewport + 1)
      expect(width.body, `${viewport.label}: body tràn ngang`).toBeLessThanOrEqual(width.viewport + 1)
    })
  }

  test('focus ring dày ít nhất 2 px đúng như hợp đồng pin', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX, 'khổ hẹp là read-only, có case riêng')
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)

    const target = page.getByRole('button', { name: 'EDIT', exact: true })
    await expect(target).toBeVisible()
    await target.focus()
    const outlineWidth = await target.evaluate((element) => {
      const style = window.getComputedStyle(element)
      // Trình duyệt trả `px`; `outline-width` là thứ người dùng bàn phím thấy.
      return Number.parseFloat(style.outlineWidth || '0')
    })
    expect(outlineWidth, 'focusRingMinPx = 2 trong nfr.accessibility').toBeGreaterThanOrEqual(2)
  })

  test('AC-PGM02-008: bộ chuyển chế độ đi hết bằng bàn phím và nói rõ vì sao SIMULATE chưa có', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX, 'khổ hẹp là read-only, có case riêng')
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)

    /* `T59-815`: lý do SIMULATE chưa dùng được nay là lý do của THIẾT BỊ
       (capability server không công bố), không phải lý do của lịch dự án. */
    const simulate = page.getByRole('button', { name: 'SIMULATE', exact: true })
    await expect(simulate).toBeVisible()
    await simulate.focus()
    await page.keyboard.press('Enter')
    /* Không tự hạ cấp: URL phải GIỮ NGUYÊN `mode=EDIT`, và lý do phải nói ra. */
    await expect(page.getByText(/chưa công bố khả năng Mô phỏng/)).toBeVisible()
    expect(new URL(page.url()).searchParams.get('mode')).toBe('EDIT')
  })

  test('workbench đi tới được bằng bàn phím và mỗi tab khai nguồn', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX, 'khổ hẹp là read-only, có case riêng')
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)

    const watchTab = page.getByRole('tab', { name: 'Watch' })
    await expect(watchTab).toBeVisible()
    await watchTab.focus()
    await page.keyboard.press('Enter')
    // Tab chưa có capability phải GIẢI THÍCH, không hiện danh sách rỗng.
    await expect(page.getByText(/cần nguồn giá trị runtime/)).toBeVisible()

    const handle = page.getByRole('separator', { name: /Kéo để đổi chiều cao/ })
    const before = await handle.getAttribute('aria-valuenow')
    await handle.focus()
    await page.keyboard.press('ArrowUp')
    expect(await handle.getAttribute('aria-valuenow')).not.toBe(before)
  })
})

/**
 * `T59-811` — LIVE trong trình duyệt.
 *
 * Điều case này khoá là thứ không nhìn thấy bằng mắt: Draft và Active hiện ra
 * trong cùng một cửa sổ. Fixture cố ý cho hai bản khác NỘI DUNG, rồi khẳng định
 * LIVE hiện đúng bản đang chạy.
 */
test.describe('PGM-02 LIVE (T59-811)', () => {
  test('AC-PGM02-006 / AC-ST-008: LIVE hiện nguồn Active, chỉ đọc, và Watch đọc cùng snapshot', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX,
      'khổ hẹp là read-only theo cách riêng; LIVE có case desktop'
    )
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=LIVE`)

    const liveSource = page.getByLabel(/Mã nguồn đang chạy/)
    await expect(liveSource).toBeVisible()
    // Nguồn của gói ĐANG CHẠY, không phải Draft.
    await expect(liveSource).toHaveValue(/PROGRAM AHU_ACTIVE/)
    await expect(liveSource).toHaveAttribute('readonly', '')

    // Chỉ đọc là thuộc tính của CHẾ ĐỘ: phiên này vẫn là admin.
    await expect(page.getByText('Chỉ đọc với mọi vai')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)

    // Khay workbench khai đúng chế độ, và Watch nay có nguồn.
    await expect(page.getByText(/^LIVE · /)).toBeVisible()
    await page.getByRole('tab', { name: /Watch/ }).click()
    await expect(page.getByText(/Watch cần nguồn giá trị runtime/)).toHaveCount(0)

    // Trace vẫn thuộc về đúng một nơi, kể cả ở LIVE.
    await page.getByRole('tab', { name: 'Trace' }).click()
    await expect(page.getByText(/phiên có quota và vòng đời riêng/)).toBeVisible()

    expectNoBrowserFailures(failures, 'LIVE')
  })

  test('AC-PGM02-003: đổi EDIT → LIVE khi Draft bẩn phải hỏi trước', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX,
      'khổ hẹp không sửa được nên không có Draft bẩn'
    )
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)

    const source = page.getByLabel(/Mã nguồn ST/)
    await expect(source).toBeVisible()
    await source.fill('PROGRAM P\nX := 1; (* chưa lưu *)\nEND_PROGRAM\n')

    await page.getByRole('button', { name: 'LIVE', exact: true }).click()
    // Buffer đang gõ KHÔNG đi theo khi đổi nguồn tài liệu, nên phải hỏi.
    await expect(page.getByText(/Đổi chế độ sẽ đổi nguồn tài liệu/)).toBeVisible()
    expect(new URL(page.url()).searchParams.get('mode')).toBe('EDIT')

    await page.getByRole('button', { name: 'Ở lại' }).click()
    await expect(source).toHaveValue(/chưa lưu/)
  })
})

/**
 * `T59-812` — hardening LIVE: ngân sách/vòng đời subscription, responsive,
 * accessibility và khóa mutation ở TOÀN workspace.
 */
test.describe('PGM-02 hardening LIVE (T59-812)', () => {
  const VIEWPORTS = [
    { label: 'full shell', width: 1280, height: 900 },
    { label: 'compact dock', width: 1024, height: 800 },
    { label: 'drawer', width: 768, height: 800 },
    { label: 'mobile read-only', width: 390, height: 844 },
  ]

  for (const viewport of VIEWPORTS) {
    test(`LIVE không tràn ngang và không lộ mutation ở ${viewport.label} (${viewport.width}px)`, async ({ page }) => {
      const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await installProgrammingMocks(page, state)
      const failures = observeBrowserFailures(page)
      await login(page)
      await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=LIVE`)

      const source = page.getByLabel(/Mã nguồn đang chạy/)
      await expect(source).toBeVisible()
      await expect(source).toHaveAttribute('readonly', '')
      await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toHaveCount(0)
      await expect(page.getByTitle('Thêm chương trình ST')).toHaveCount(0)
      await expect(page.getByTitle('Thêm chương trình FBD')).toHaveCount(0)

      const width = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
      expect(width.document, `${viewport.label}: document tràn ngang`).toBeLessThanOrEqual(width.viewport + 1)
      expect(width.body, `${viewport.label}: body tràn ngang`).toBeLessThanOrEqual(width.viewport + 1)

      const axe = await new AxeBuilder({ page }).analyze()
      const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
      expect(severe, `${viewport.label}: axe serious/critical`).toEqual([])
      expectNoBrowserFailures(failures, `LIVE ${viewport.label}`)
    })
  }

  test('rời LIVE hủy monitor subscription; EDIT không tiếp tục poll ngầm', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < AUTHORING_MIN_WIDTH_PX, 'đo vòng đời một lần ở lane desktop')
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false, monitorRequests: 0 }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=LIVE`)
    await expect(page.getByLabel(/Mã nguồn đang chạy/)).toBeVisible()
    await expect.poll(() => state.monitorRequests ?? 0).toBeGreaterThanOrEqual(2)

    await page.getByRole('button', { name: 'EDIT', exact: true }).click()
    await expect(page.getByLabel(/Mã nguồn ST/)).toBeVisible()
    const afterUnsubscribe = state.monitorRequests ?? 0
    await page.waitForTimeout(2_200)
    expect(state.monitorRequests).toBe(afterUnsubscribe)
  })
})

/**
 * `T59-816` / `PGM02-V22-WP-06-R3` + `WP-11-R3` — hardening SIMULATE.
 *
 * Lane này chạy trên một thiết bị CÓ công bố khả năng mô phỏng. Đó là điểm khác
 * duy nhất so với các case cũ, và nó mở ra đúng phần bề mặt mà `T59-815` giao
 * nhưng chưa có ai đi hết bằng một trình duyệt thật: mở phiên, chạy một nhịp,
 * đọc giá trị, rồi dừng.
 *
 * Ba câu hỏi bộ này trả lời, và cả ba đều là câu hỏi an toàn chứ không phải
 * thẩm mỹ:
 *
 * 1. Màn hình có nói rõ số đang hiện đến từ MÔ PHỎNG không? Giá trị mô phỏng và
 *    giá trị của tủ trông giống hệt nhau.
 * 2. Một ô chưa tính được có hiện `—` thay vì `0` không?
 * 3. Suốt cả phiên, có mutation nào rơi vào đường điều khiển thật không?
 */
test.describe('PGM-02 hardening SIMULATE (T59-816)', () => {
  function simulationState(): MockState {
    return {
      etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED',
      commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false,
      simulation: { supported: true, session: null, controlPathWrites: 0 },
    }
  }

  test('phiên mô phỏng đi hết vòng và KHÔNG chạm đường điều khiển thật', async ({ page }) => {
    const state = simulationState()
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)

    /* Đếm mọi request có thể đổi gói đang chạy. Đếm ở lớp mạng chứ không tin
       vào giao diện: một nút bị ẩn vẫn không chứng minh được rằng không có
       đường nào khác gọi tới. */
    const controlPathCalls: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      const method = request.method()
      if (method === 'GET') return
      if (!url.pathname.startsWith('/api/v1/programming')) return
      if (url.pathname.includes('/simulation/')) return
      controlPathCalls.push(`${method} ${url.pathname}`)
    })

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=SIMULATE`)

    await page.getByRole('button', { name: /Mở phiên mô phỏng|Start simulation session/ }).click()

    /* Nguồn hiện trên màn hình phải là bản đã NIÊM PHONG của phiên, không phải
       Draft đang gõ và cũng không phải bản đang chạy trên tủ. */
    const sealed = page.getByLabel(/Mã nguồn đang mô phỏng|Simulated source/)
    await expect(sealed).toHaveValue(/AHU_DA_NIEM_PHONG/)

    await page.getByRole('button', { name: /^(Một nhịp|Step)$/ }).click()

    /* Khay Watch của workbench dùng chung phải khai nguồn là MÔ PHỎNG. */
    const watchTab = page.getByRole('tab', { name: /Watch \((Mô phỏng|Simulation)\)/ })
    await expect(watchTab).toBeVisible()
    await watchTab.click()
    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText('22.5')).toBeVisible()
    // `UNAVAILABLE` phải hiện `—`. Vẽ nó thành 0 tạo một cú rơi thẳng đứng
    // trông hệt như thiết bị vừa tắt.
    await expect(panel.getByText('—').first()).toBeVisible()

    await page.getByRole('button', { name: /Dừng phiên|Stop session/ }).click()

    expect(controlPathCalls, 'phiên mô phỏng đã chạm đường điều khiển thật').toEqual([])
    expect(state.commissionCount).toBe(0)
    expect(state.restoreCount).toBe(0)
    expect(state.retainResetCount).toBe(0)
    expectNoBrowserFailures(failures, 'phiên SIMULATE')
  })

  test('bề mặt SIMULATE không có vi phạm axe nghiêm trọng', async ({ page }) => {
    const state = simulationState()
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=SIMULATE`)
    await page.getByRole('button', { name: /Mở phiên mô phỏng|Start simulation session/ }).click()
    await expect(page.getByLabel(/Mã nguồn đang mô phỏng|Simulated source/)).toBeVisible()

    const axe = await new AxeBuilder({ page }).analyze()
    const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(severe, 'SIMULATE: axe serious/critical').toEqual([])
  })
})

/* ==================================================================== *
 * `T61-503` — PGM-04 Thư viện điều khiển: lane mock của Plan 61 WP-02   *
 * ==================================================================== */

/**
 * Vì sao lane này tách khỏi các describe phía trên.
 *
 * PGM-04 là màn duy nhất đọc `GET /programming/library-usages`, và câu trả lời
 * của route đó có đúng một giá trị KHÔNG được phép biến thành con số:
 * `availability: "UNAVAILABLE"`. Backend giả dùng chung ở đầu tệp cố ý không
 * trả route này (nó rơi vào 503 mặc định), nên trước lát này chưa lần nào bề
 * mặt Used-In bị soi bằng trình duyệt thật.
 *
 * Hai route dưới đăng ký SAU `installProgrammingMocks`; Playwright ưu tiên
 * handler đăng ký sau, nên chúng đè lên backend giả dùng chung mà không sửa
 * nó — mọi case cũ vẫn nhận đúng payload cũ.
 */

const LIBRARY_PATH = `/eng/programming/projects/${PROJECT_ID}/library`

/* Định danh revision của SYSTEM Library là một CHUỖI CÓ DẤU HAI CHẤM, không
   phải UUID (`application/library.go`). Giữ đúng hình dạng đó trong mock vì nó
   là thứ đi qua query string — một mock dùng UUID sẽ bỏ lọt lỗi encoding. */
const SYSTEM_LIBRARY_REVISION_ID = `PROGRAMMING-POU-LIBRARY-REGISTRY-V1:rev-a.3:${'c'.repeat(64)}`
const PROJECT_LIBRARY_REVISION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Shape đúng như `libraryEntryResponse` của `transport/http/library.go`. */
interface MockLibraryEntry {
  scope: 'SYSTEM' | 'PROJECT'
  libraryRevisionId: string
  libraryVersion: string
  libraryState: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'
  entryId: string
  kind: 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'
  name: string
  featureState: 'AVAILABLE' | 'REVIEW_REQUIRED'
  category: string
  description: string
  contentSha256: string
  dependencies: never[]
  stateLayoutKnown: boolean
  stateSizeBytes: number
}

/* Bốn khối vì lane cần bốn vai khác nhau: một khối SYSTEM bình thường, khối
   SYSTEM đang chờ review (`PID` — đúng mục `approved:false` của profile), một
   khối SYSTEM thuộc nhóm `timer` để phép lọc có cái để thu hẹp, và một khối
   PROJECT — nguồn DUY NHẤT mà `library_usages` đo được. `description` khác
   nhau từng khối vì đó là chuỗi chỉ xuất hiện ở khay Chi tiết, nên nó nói
   được "chi tiết đang mở đúng khối nào" mà không cần bám class. */
const LIBRARY_CATALOG: MockLibraryEntry[] = [
  {
    scope: 'SYSTEM', libraryRevisionId: SYSTEM_LIBRARY_REVISION_ID, libraryVersion: 'rev-a.3',
    libraryState: 'PUBLISHED', entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT',
    featureState: 'AVAILABLE', category: 'math', description: 'Kẹp giá trị vào khoảng cho phép',
    contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0
  },
  {
    scope: 'SYSTEM', libraryRevisionId: SYSTEM_LIBRARY_REVISION_ID, libraryVersion: 'rev-a.3',
    libraryState: 'PUBLISHED', entryId: 'PID', kind: 'FUNCTION_BLOCK', name: 'PID',
    featureState: 'REVIEW_REQUIRED', category: 'control', description: 'Vòng điều khiển tỉ lệ tích phân vi phân',
    contentSha256: 'b'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 64
  },
  {
    scope: 'SYSTEM', libraryRevisionId: SYSTEM_LIBRARY_REVISION_ID, libraryVersion: 'rev-a.3',
    libraryState: 'PUBLISHED', entryId: 'TON', kind: 'FUNCTION_BLOCK', name: 'TON',
    featureState: 'AVAILABLE', category: 'timer', description: 'Bộ định thời trễ bật',
    contentSha256: 'd'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 16
  },
  {
    scope: 'PROJECT', libraryRevisionId: PROJECT_LIBRARY_REVISION_ID, libraryVersion: '1.2',
    libraryState: 'PUBLISHED', entryId: 'AHU_STAGE', kind: 'FUNCTION_BLOCK', name: 'AHU_STAGE',
    featureState: 'AVAILABLE', category: 'control', description: 'Khối phân cấp giai đoạn AHU của dự án',
    contentSha256: 'e'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 32
  }
]

/* Used-In ĐÃ NIÊM PHONG của khối PROJECT. Hai mục, một đang chạy — đủ để phân
   biệt "server đo được và ra 2" với "server chưa đo được". */
const PROJECT_USAGE_ITEMS = [
  {
    projectId: PROJECT_ID, projectName: 'AHU-01', revisionId: ACTIVE_REVISION_ID,
    objectId: POU_OBJECT_ID, objectName: 'Điều khiển AHU', requiredVersion: '1.2',
    usageKind: 'INSTANCE', isActive: true
  },
  {
    projectId: PROJECT_ID, projectName: 'AHU-01', revisionId: SIM_REVISION_ID,
    objectId: '12121212-1212-4121-8121-121212121212', objectName: 'Giai đoạn sưởi',
    requiredVersion: '1.1', usageKind: 'CALL', isActive: false
  }
]

interface LibraryLane {
  /** Query string của mọi lần gọi `/libraries` — bằng chứng lọc chạy Ở SERVER. */
  libraryQueries: string[]
  /** Bật 503 cho `/libraries`; tắt giữa chừng để nút Thử lại tự chứng minh nó gọi lại thật. */
  failLibraries: boolean
}

function libraryLane(): LibraryLane {
  return { libraryQueries: [], failLibraries: false }
}

async function installLibraryLaneRoutes(page: Page, lane: LibraryLane) {
  await page.route(
    (url) => url.pathname === '/api/v1/programming/libraries',
    async (route) => {
      const url = new URL(route.request().url())
      lane.libraryQueries.push(url.search)
      if (lane.failLibraries) {
        return json(
          route,
          { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true, keepsRunningRevision: true, correlationId: 'e2e-correlation-pgm04' } },
          503
        )
      }
      /* Lọc Ở ĐÂY chứ không ở client: `GET /libraries` có phân trang
         (`limit=100`), nên một bộ lọc chạy trên trang đã tải sẽ đúng với bốn
         khối của mock và sai với thư viện thật. Mock phải ép FE đi đúng đường
         mà backend thật đòi. */
      const scope = url.searchParams.get('scope')
      const kind = url.searchParams.get('kind')
      const category = url.searchParams.get('category')
      const q = url.searchParams.get('q')?.toLowerCase() ?? ''
      const items = LIBRARY_CATALOG.filter((entry) => {
        if (scope && entry.scope !== scope) return false
        if (kind && entry.kind !== kind) return false
        if (category && entry.category !== category) return false
        if (q && !`${entry.name} ${entry.description}`.toLowerCase().includes(q)) return false
        return true
      })
      return json(route, { items, nextCursor: null })
    }
  )

  await page.route(
    (url) => url.pathname === '/api/v1/programming/library-usages',
    async (route) => {
      const url = new URL(route.request().url())
      const empty = { count: 0, truncated: false, items: [] as typeof PROJECT_USAGE_ITEMS }
      if (url.searchParams.get('scope') === 'SYSTEM') {
        /* Đúng `LibraryService.Usage`: entry SYSTEM phân giải nơi dùng từ
           registry chứ không nằm trong bảng `library_usages`. Payload vẫn mang
           `sealed.count = 0` — CHÍNH LÀ cái bẫy mà case đầu tiên soi: số 0 có
           sẵn trong tay FE, và FE không được in nó ra. */
        return json(route, { sealed: empty, draft: empty, availability: 'UNAVAILABLE' })
      }
      const items = url.searchParams.get('entryId') === 'AHU_STAGE' ? PROJECT_USAGE_ITEMS : []
      return json(route, {
        sealed: { count: items.length, truncated: false, items },
        draft: empty,
        availability: 'SEALED_ONLY'
      })
    }
  )
}

async function openLibrary(page: Page, lane: LibraryLane) {
  const state: MockState = {
    etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED',
    commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false
  }
  await installProgrammingMocks(page, state)
  await installLibraryLaneRoutes(page, lane)
  await login(page)
  await navigate(page, LIBRARY_PATH)
}

function libraryList(page: Page) {
  return page.getByRole('list', { name: 'Danh sách khối Thư viện điều khiển' })
}

test.describe('PGM-04 Thư viện điều khiển (T61-503)', () => {
  test('D61-07: “chưa đo được” không được hiện thành “0 nơi dùng”', async ({ page }) => {
    const lane = libraryLane()
    const failures = observeBrowserFailures(page)
    await openLibrary(page, lane)

    const list = libraryList(page)
    const usage = page.getByRole('region', { name: 'Nơi sử dụng' })

    /* Vế đối chứng, và nó phải đứng TRƯỚC: khi máy chủ ĐO ĐƯỢC thì con số phải
       hiện. Thiếu vế này, một bề mặt không bao giờ in số nào cũng "đạt" case
       dưới — và đó là một cách khác để nói dối. */
    await list.getByRole('button', { name: /^AHU_STAGE/ }).click()
    await expect(usage.getByText('2 nơi dùng')).toBeVisible()
    await expect(usage.getByText('Điều khiển AHU')).toBeVisible()

    /* Vế thật: `UNAVAILABLE` nghĩa là CHƯA ĐO ĐƯỢC. In `0` ở đây là mời người
       ta xoá một khối có thể đang điều khiển tủ — hai câu dẫn tới hai hành
       động ngược nhau, nên bề mặt không được phép gộp chúng. */
    const usageResponse = page.waitForResponse(
      (response) => response.url().includes('/library-usages') && response.url().includes('entryId=LIMIT')
    )
    await list.getByRole('button', { name: /^LIMIT/ }).click()
    const payload = (await (await usageResponse).json()) as { availability: string; sealed: { count: number } }
    // Máy chủ CÓ đưa số 0 cho FE; câu hỏi duy nhất là FE có in nó ra không.
    expect(payload.availability).toBe('UNAVAILABLE')
    expect(payload.sealed.count).toBe(0)

    await expect(usage.getByText(/Chưa đo được/)).toBeVisible()
    expect(await usage.innerText(), 'khay Nơi sử dụng in một con số khi chưa đo được').not.toMatch(/\d+\s*nơi dùng/)
    await expect(page.getByText('0 nơi dùng')).toHaveCount(0)

    expectNoBrowserFailures(failures, 'PGM-04 Used-In')
  })

  test('T61-204: lọc theo phân loại thu hẹp danh sách và sống sót qua khay Chi tiết', async ({ page }) => {
    const lane = libraryLane()
    const failures = observeBrowserFailures(page)
    await openLibrary(page, lane)

    const list = libraryList(page)
    await expect(list.getByRole('button')).toHaveCount(LIBRARY_CATALOG.length)

    const category = page.getByRole('combobox', { name: 'Phân loại' })
    await category.selectOption('timer')
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByRole('button', { name: /^TON/ })).toBeVisible()
    /* Phép lọc phải đi TỚI MÁY CHỦ. Thư viện thật có phân trang; lọc trên trang
       đã tải sẽ đúng với bốn khối của mock và bỏ sót ở thư viện thật — một lỗi
       chỉ lộ ra khi catalog vượt `limit`. */
    expect(lane.libraryQueries.some((search) => search.includes('category=timer'))).toBe(true)

    // Mở khay Chi tiết rồi quay lại danh sách: bộ lọc và lựa chọn còn nguyên.
    // Chọn một khối mà làm bộ lọc bật lại "Tất cả" là ném người dùng về đầu
    // danh sách sau mỗi lần xem một khối.
    await list.getByRole('button', { name: /^TON/ }).click()
    await expect(page.getByText('Bộ định thời trễ bật')).toBeVisible()
    await expect(category).toHaveValue('timer')
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByRole('button', { name: /^TON/ })).toHaveAttribute('aria-current', 'true')

    // Gỡ bộ lọc trả lại đủ catalog — thu hẹp phải là thu hẹp, không phải mất.
    await category.selectOption('')
    await expect(list.getByRole('button')).toHaveCount(LIBRARY_CATALOG.length)

    expectNoBrowserFailures(failures, 'PGM-04 lọc phân loại')
  })

  test('D61-07: lỗi tải thư viện KHÔNG được hiện như một thư viện rỗng', async ({ page }) => {
    const lane = libraryLane()
    lane.failLibraries = true
    await openLibrary(page, lane)

    /* "Không có khối nào" và "không đọc được" dẫn tới hai hành động khác hẳn:
       một bên là đi tạo khối, một bên là đi xem vì sao máy chủ im. Trang nào
       trộn hai câu đó lại là trang đẩy người dùng đi sai đường. */
    await expect(page.getByText('Không tải được Thư viện điều khiển.')).toBeVisible()
    // Cả HAI câu "rỗng" đều bị cấm ở đây, không chỉ câu về bộ lọc: "thư viện
    // của Project chưa có khối nào" còn mời người ta đi tạo lại đúng thứ đang
    // có sẵn trên thiết bị.
    await expect(page.getByText('Không có khối nào khớp bộ lọc.')).toHaveCount(0)
    await expect(page.getByText('Thư viện của Project này chưa có khối nào.')).toHaveCount(0)
    await expect(libraryList(page)).toHaveCount(0)

    // Đường thử lại phải là đường THẬT: mở lại máy chủ rồi bấm, danh sách phải
    // về. Một nút Thử lại không gọi lại gì chỉ là một lời an ủi.
    const blocks = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Danh sách khối' }) })
    const retry = blocks.getByRole('button', { name: 'Thử lại' })
    await expect(retry).toBeVisible()
    const before = lane.libraryQueries.length
    lane.failLibraries = false
    await retry.click()
    await expect(libraryList(page).getByRole('button')).toHaveCount(LIBRARY_CATALOG.length)
    expect(lane.libraryQueries.length).toBeGreaterThan(before)
  })

  test('D61-04: khối chờ review có badge, không có Insert bật được và không có ô bỏ qua', async ({ page }) => {
    const lane = libraryLane()
    const failures = observeBrowserFailures(page)
    await openLibrary(page, lane)

    const list = libraryList(page)
    const pid = list.getByRole('button', { name: /^PID/ })
    await expect(pid).toContainText('Chờ review Controls/Safety')

    await pid.click()
    await expect(page.getByText(/chưa qua review Controls\/Safety/)).toBeVisible()

    /* `T59-205`/`D61-04`: không có đường bỏ qua. Khẳng định viết theo "mọi lối
       Insert đều khoá" chứ không theo "không có nút Insert nào": bề mặt hôm nay
       chưa dựng Insert ở PGM-04, và khi `T61-405` dựng nó thì case này vẫn phải
       là phép kiểm đúng thứ nó nói, không phải một case chết. */
    for (const control of await page.getByRole('button', { name: /Chèn|Insert/i }).all()) {
      await expect(control).toBeDisabled()
    }
    await expect(page.getByRole('link', { name: /Chèn|Insert/i })).toHaveCount(0)
    // Không có ô tick "bỏ qua review", và cũng không có nút tự duyệt: token phê
    // duyệt Controls/Safety suy ra từ contract profile, giao diện không cấp được.
    await expect(page.getByRole('checkbox', { name: /bỏ qua|bypass|ghi đè|override|vẫn dùng/i })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: /bỏ qua|bypass|ghi đè|override|review/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Duyệt|Approve)/i })).toHaveCount(0)

    expectNoBrowserFailures(failures, 'PGM-04 review gate')
  })

  test('T61-306: PGM-04 không có vi phạm axe nghiêm trọng', async ({ page }) => {
    const lane = libraryLane()
    await openLibrary(page, lane)

    // Quét khi khay Chi tiết ĐANG MỞ: đóng nó lại thì hơn nửa bề mặt của trang
    // (Used-In, lịch sử phiên bản, hai nút mutation) không có mặt trong lần quét.
    await libraryList(page).getByRole('button', { name: /^AHU_STAGE/ }).click()
    await expect(page.getByRole('region', { name: 'Nơi sử dụng' })).toBeVisible()

    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(severe, 'PGM-04: axe serious/critical').toEqual([])
  })
})
