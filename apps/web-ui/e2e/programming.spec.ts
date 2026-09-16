import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { login } from './helpers/session'
import { BUNDLE_COMPATIBILITY } from '../src/features/programming/shared/programmingCompatibility'
import { PROGRAMMING_ENDPOINTS } from '../src/features/programming/api/generated/client'
import { PGM04_ROLE_MATRIX, assertMatrixDiscriminates, type Pgm04Role } from './helpers/pgm04RoleMatrix'
import { PGM04_SKIP_LEDGER, readPgm04SkipReasons } from './helpers/pgm04Skips'
import { IMPACT_GROUP_ORDER } from '../src/features/programming/commission/impactGroups'
import { PROGRAMMING_AUTHORING_MIN_WIDTH_PX } from '../src/features/programming/layout/useProgrammingViewport'
import type { FbdDocument } from '../src/features/programming/fbd/model'

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
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTIVE_REVISION_ID = '22222222-2222-4222-8222-222222222222'
const POU_OBJECT_ID = '44444444-4444-4444-8444-444444444444'
const PROGRAM_ID = '66666666-6666-4666-8666-666666666666'
const TECHNICAL_TIMESTAMP = '2026-09-05T23:07:08Z'
/* `T59-816` — bản đã niêm phong mà phiên mô phỏng chạy, và ID phiên. Cố ý KHÁC
   `ACTIVE_REVISION_ID`: một phiên mô phỏng chạy được trên bản chưa hề điều
   khiển tủ, và mọi nhãn nguồn phải nói đúng bản nào. */
const SIM_REVISION_ID = '77777777-7777-4777-8777-777777777777'
const SIM_SESSION_ID = '88888888-8888-4888-8888-888888888888'
const GOLDEN_FBD = JSON.parse(readFileSync(
  new URL('../../../contracts/programming/fbd/golden/ahu_fan_enable.json', import.meta.url),
  'utf8',
)) as FbdDocument

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
  monitorQuality?: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'OFFLINE' | 'UNKNOWN'
  monitorFreshness?: 'LIVE' | 'STALE' | 'UNAVAILABLE'
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
    const path = new URL(request.url()).pathname
    const errorText = request.failure()?.errorText ?? 'unknown'
    /* `net::ERR_ABORTED` trên một tài nguyên NGOÀI API không phải lỗi ứng dụng:
     * đó là trình duyệt HUỶ một request còn dở vì điều hướng hoặc `reload` chen
     * vào trước khi nó xong. `AC-PGM02-001` reload giữa chừng để chứng minh POU
     * sống sót, nên `GET /favicon.svg` kịp xong hay bị huỷ phụ thuộc vào nhịp
     * máy — và cổng sẽ đỏ hay xanh theo tải của runner chứ không theo chất
     * lượng mã. Một cổng đỏ ngẫu nhiên còn tệ hơn một cổng đỏ ổn định: nó dạy
     * người chạy bỏ qua màu đỏ.
     *
     * Tha ĐÚNG cặp "huỷ + ngoài API", không hơn: mọi `ERR_ABORTED` trên
     * `/api/` vẫn đỏ (huỷ một lời gọi API giữa chừng là dấu hiệu thật của
     * race trong mã), và mọi mã lỗi khác trên tài nguyên tĩnh cũng vẫn đỏ. */
    if (errorText === 'net::ERR_ABORTED' && !path.startsWith('/api/')) return
    failures.requestFailures.push(`${request.method()} ${path}: ${errorText}`)
  })
  page.on('response', (response) => {
    if (response.status() < 500) return
    if (!isProgrammingSurface(response.url())) return
    failures.serverFailures.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`)
  })
  return failures
}

/**
 * Chờ bố cục ĐỨNG YÊN sau khi đổi khung nhìn, trước khi đo bất kỳ số nào.
 *
 * `ProgrammingFeatureRail` có `transition-[width] duration-200`: đổi khung nhìn
 * qua một breakpoint làm nó CHẠY từ bề rộng cũ sang bề rộng mới trong 200 ms.
 * Đo ngay sau `setViewportSize` vì thế đọc phải một con số giữa chừng — tại
 * `768 px` rail đo được `183 px` trong khi bề rộng nó thực sự nhận là `64 px`,
 * và mọi bề rộng tính từ đó (`listWidth`) lệch theo đúng chừng ấy. Phép đo hụt
 * ~119 px là vì vậy, không phải vì trang chừa cột cho khay phủ.
 *
 * Đây là hạn chế của PHÉP ĐO, không phải của sản phẩm: dải `768–1023 px` sau
 * khi transition xong đúng là chế độ chỉ-icon `64 px` như hồ sơ rail công bố.
 * Nên chờ đúng thứ cần chờ, thay vì nới ngưỡng cho tới khi số giữa chừng lọt
 * qua — nới ngưỡng là bịt đúng cái cổng này sinh ra để canh.
 */
async function settleLayout(page: Page) {
  await expect
    .poll(
      () => page.evaluate(async () => {
        const rail = document.querySelector('[data-testid="programming-feature-rail"]')
        if (!rail) return 'no-rail'
        const before = rail.getBoundingClientRect().width
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))
        return Math.abs(rail.getBoundingClientRect().width - before) < 0.5 ? 'settled' : 'moving'
      }),
      { timeout: 5_000, message: 'bố cục vẫn đang chuyển động sau khi đổi khung nhìn' }
    )
    .not.toBe('moving')
}

/**
 * `T61-503` — lỗi do FIXTURE CỐ Ý bơm vào không phải lỗi của sản phẩm.
 *
 * `ISS-PGM04-16` đòi "console error/requestfailed **ngoài lỗi fixture** = 0". Một
 * case đo đường hỏng (503 trang-N, 403 mất quyền) BẮT BUỘC sinh ra đúng những
 * dòng ấy — đó là điều nó đang đo. Không có chỗ khai báo thì mọi case đường hỏng
 * chỉ còn hai lối: bỏ hẳn phép kiểm console (mất luôn khả năng bắt lỗi thật), hoặc
 * không viết case đường hỏng nào. Cả hai đều là cách một cổng biến mất.
 *
 * `allow` là danh sách path mà case NÀY đã tự bơm lỗi vào. Nó KHÔNG nới cho mọi
 * lỗi: chỉ path khớp mới được bỏ qua, mọi console error khác vẫn làm đỏ. `pageerror`
 * (ngoại lệ JS chưa bắt) KHÔNG bao giờ được nới — một fixture 503 không sinh ra
 * ngoại lệ JS, nên một dòng `pageerror` luôn là lỗi thật.
 */
function expectNoBrowserFailures(
  failures: BrowserFailures,
  label: string,
  allow: readonly string[] = [],
): void {
  const unexpected = (entry: string) => !allow.some((path) => entry.includes(path))
  expect(failures.consoleErrors.filter(unexpected), `${label}: console.error`).toEqual([])
  expect(failures.pageErrors, `${label}: pageerror`).toEqual([])
  expect(failures.requestFailures.filter(unexpected), `${label}: requestfailed`).toEqual([])
  expect(failures.serverFailures.filter(unexpected), `${label}: HTTP 5xx`).toEqual([])
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

function draftWithFbdProblem() {
  const draft = initialDraft()
  const document = structuredClone(GOLDEN_FBD)
  // Wire đầu vẫn vẽ được nhưng nguồn chạy sau đích: validator phải neo đúng
  // `FBD-SEM-ORDER-001` vào chính wire này.
  document.networks[0].nodes[0].executionOrder = 5
  draft.programs.push({
    objectId: POU_OBJECT_ID,
    programId: PROGRAM_ID,
    name: 'FBD_WITH_PROBLEM',
    kind: 'PROGRAM',
    language: 'FBD',
    document: JSON.stringify(document),
    executionOrder: 0,
    functionalTags: [],
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
        /* `ISS-STED-19` — thiết bị PHẢI công bố bộ ba tương thích. Thiếu nó, FE
           fail-closed: `UNVERIFIABLE` ⇒ chặn soạn thảo, `canEdit=false`, cây POU
           mất nút tạo và đổi luôn câu empty-state. Mock trước đây không phát nó,
           nên toàn bộ journey EDIT của lane mock đang kiểm một bàn làm việc bị
           KHOÁ mà không ai nhận ra — bước `E2E mock` chưa từng chạy trên CI.
           Lấy thẳng hằng đã build vào bundle: mock đóng vai một thiết bị chạy
           ĐÚNG phiên bản này, và khi phiên bản đổi thì nó tự theo. */
        compatibility: BUNDLE_COMPATIBILITY,
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
        taskState: 'RUNNING', safeState: false, observedAt: TECHNICAL_TIMESTAMP,
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 120, missedReleaseCount: 0, lastExecNs: 120000, maxExecNs: 310000, overrunCount: 1, consecutiveOverruns: 0 }
      })
    }
    if (method === 'GET' && path === '/libraries') {
      /*
      Shape đúng như `GET /programming/libraries` thật: máy chủ gửi CẢ HAI —
      `interface` (blob thô) và `signature` (chữ ký ĐÃ PHÂN GIẢI).

      `T61-503` — bản trước chỉ gửi `interface`, kèm chú thích "chữ ký đi trong
      `interface`". Câu ấy đúng cho tới `T61-203`, lát chấm dứt việc FE tự parse
      `interface` (hai nơi cùng đoán là hai nơi kết luận khác nhau về cùng một
      khối, và ở đây "bên nào đúng" quyết định người dùng nối dây vào chân nào).
      Từ đó, fixture này làm mọi mục hoá `SIGNATURE_UNAVAILABLE`, nên Thư viện
      nhanh khoá `Chèn LIMIT` với `title="Thiếu chữ ký từ thiết bị"` và
      `AC-PGM02-004` đỏ trên `main`. Sản phẩm đúng — nó nói thật rằng nó không
      có chữ ký; fixture mới là thứ đã cũ đi mà không ai sửa.
      */
      return json(route, {
        items: [
          {
            scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
            entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT', featureState: 'AVAILABLE',
            contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
            signature: {
              dispatch: 'FUNC_TABLE', polymorphic: true, typedPortNames: [], category: 'math',
              labelVi: 'Giới hạn (LIMIT)', labelEn: 'Limit', allowedTypes: ['REAL'], defaultType: 'REAL',
              ports: [
                { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
                { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
                { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
                { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
              ]
            },
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
            signature: {
              dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [], category: 'control',
              labelVi: 'PID', labelEn: 'PID', allowedTypes: [],
              ports: [
                { name: 'PV', direction: 'INPUT', dataType: 'REAL' },
                { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
              ]
            },
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
        observedAt: TECHNICAL_TIMESTAMP,
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
          observedAt: TECHNICAL_TIMESTAMP,
          periodMs: state.draft.task.periodMs,
          lastExecNs: 120000,
          maxExecNs: 310000,
          missedReleaseCount: 0,
          consecutiveMissedRelease: 0,
          lastRunAtUtc: TECHNICAL_TIMESTAMP,
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
    /* `T59-816` — project view khai `latestCheck.checkId = 'check-sim-0001'`,
       và PGM-03 đọc lại chính check đó qua `GET /checks/{checkId}`. Mock trước
       đây khai id này mà KHÔNG phục vụ nó: backend giả trả 503, phiên SIMULATE
       ghi console.error, và cổng `expectNoBrowserFailures` đỏ vì đồ gá chứ
       không vì sản phẩm. Fixture phải phục vụ đúng thứ chính nó quảng cáo. */
    if (method === 'GET' && path === '/checks/check-sim-0001') {
      return json(route, {
        checkId: 'check-sim-0001', revisionId: SIM_REVISION_ID, state: 'PASSED',
        diagnostics: [], createdAt: new Date().toISOString(), attemptCount: 1
      })
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
          /* `T59-502` — MỌI nhóm impact phải có mặt. Thiếu nhóm nào thì trang
             fail-closed: "không thấy" không phải "không có", và một lần
             Commission trên một ảnh hưởng chưa đo được là một lần cutover mù.

             `T61-503` — bốn nhóm dưới đây (`writableOutputsAffected` và ba nhóm
             ánh xạ Điểm) được `ISS-PIO-*` thêm vào `ProgrammingImpactKey` NHƯNG
             không được thêm vào fixture, nên lane e2e đọc chúng thành `UNAVAILABLE`
             và nút Đưa vào vận hành khoá vĩnh viễn — journey `UJ-PROG-01..08`
             đỏ trên `main` vì đúng lý do ấy. Sản phẩm đúng; fixture cũ. Case
             `T61-503: fixture impact phủ đủ mọi nhóm` dưới đây khoá lại để nhóm
             thứ mười ba không lặp lại chuyện này trong im lặng. */
          publishedSignals: { status: 'NONE', items: [] },
          controlLibrary: { status: 'NONE', items: [] },
          programSet: { status: 'NONE', items: [] },
          enableIntent: { status: 'NONE', items: [] },
          writableOutputsAffected: { status: 'NONE', items: [] },
          physicalMappingChanges: { status: 'NONE', items: [] },
          modbusMappingChanges: { status: 'NONE', items: [] },
          virtualPointChanges: { status: 'NONE', items: [] }
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
          /* `T59-502` — MỌI nhóm impact phải có mặt. Thiếu nhóm nào thì trang
             fail-closed: "không thấy" không phải "không có", và một lần
             Commission trên một ảnh hưởng chưa đo được là một lần cutover mù.

             `T61-503` — bốn nhóm dưới đây (`writableOutputsAffected` và ba nhóm
             ánh xạ Điểm) được `ISS-PIO-*` thêm vào `ProgrammingImpactKey` NHƯNG
             không được thêm vào fixture, nên lane e2e đọc chúng thành `UNAVAILABLE`
             và nút Đưa vào vận hành khoá vĩnh viễn — journey `UJ-PROG-01..08`
             đỏ trên `main` vì đúng lý do ấy. Sản phẩm đúng; fixture cũ. Case
             `T61-503: fixture impact phủ đủ mọi nhóm` dưới đây khoá lại để nhóm
             thứ mười ba không lặp lại chuyện này trong im lặng. */
          publishedSignals: { status: 'NONE', items: [] },
          controlLibrary: { status: 'NONE', items: [] },
          programSet: { status: 'NONE', items: [] },
          enableIntent: { status: 'NONE', items: [] },
          writableOutputsAffected: { status: 'NONE', items: [] },
          physicalMappingChanges: { status: 'NONE', items: [] },
          modbusMappingChanges: { status: 'NONE', items: [] },
          virtualPointChanges: { status: 'NONE', items: [] }
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
          { category: 'LOCAL', pointId: 'AO-01', name: 'AO-01', dataType: 'REAL', unit: 'V', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: 4.2, observedAt: TECHNICAL_TIMESTAMP },
          { category: 'LOCAL', pointId: 'UI-01', name: 'UI-01', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 21.5, observedAt: TECHNICAL_TIMESTAMP }
        ]
      })
    }
    if (method === 'GET' && path === '/runtime/monitor') {
      state.monitorRequests = (state.monitorRequests ?? 0) + 1
      const quality = state.monitorQuality ?? 'GOOD'
      const freshness = state.monitorFreshness ?? 'LIVE'
      const available = quality !== 'BAD' && quality !== 'OFFLINE' && quality !== 'UNKNOWN' && freshness !== 'UNAVAILABLE'
      return json(route, {
        schemaVersion: '1.0', activeRevisionId: ACTIVE_REVISION_ID, safeState: false,
        producer: { capturedMonotonicNs: String(1_000 + state.monitorRequests) },
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 120, missedReleaseCount: 0, lastExecNs: 120000, maxExecNs: 310000, overrunCount: 1, consecutiveOverruns: 0 },
        items: [{
          variableId: '55555555-5555-4555-8555-555555555555', variableName: 'SupplySetpoint', programId: state.draft.programs[0]?.programId ?? '44444444-4444-4444-8444-444444444444',
          point: { category: 'LOCAL', pointId: 'AO-01' }, direction: 'WRITE', dataType: 'REAL', unit: 'V',
          programValue: available ? 4.1 : null, actualValue: available ? 6.2 : null,
          overriddenBy: available ? 'manual' : null, effectivePriority: available ? 2 : null,
          overrideActor: available ? 'operator-e2e' : null,
          overrideRemainingS: available ? 272 : null,
          quality, observedAt: new Date().toISOString(), freshness,
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

async function createPou(page: Page, label: 'Program · ST' | 'Program · FBD' | 'Function · ST' | 'Function Block · ST') {
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.getByRole('menu', { name: 'Tạo POU mới' }).getByRole('menuitem', { name: label }).click()
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
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
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
    await expect(page.getByRole('button', { name: /Làm mới|Refresh/ })).toBeVisible()
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
    await expect(page.getByText('Chưa có chương trình. Bấm Mới để tạo.')).toBeVisible()

    // Thêm chương trình ST bằng bàn phím hoàn toàn (Tab tới nút, Enter kích hoạt)
    await page.getByRole('button', { name: 'Mới', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Program · ST' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'NewProgram' })).toBeVisible()
    const sourceBox = page.getByLabel(/Mã nguồn ST/)
    await sourceBox.fill('AO1 := UI1 * 2.0;')
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('02-design-st.png'), fullPage: true })

    // Buffer bẩn phải chặn Check và được cảnh báo gọn ngay cạnh mode switch.
    // Cut-over v2 không còn cụm tab Programs/Mapping/Execution trùng sidebar.
    await sourceBox.fill('AO1 := UI1 * 2.0; (* dở dang *)')
    await expect(page.getByRole('tablist', { name: /Tab workspace Thiết kế/ })).toHaveCount(0)
    await expect(page.getByTestId('draft-dirty-indicator')).toContainText(/Chưa lưu/)
    /* `DEV-PROG-009` đưa `Kiểm tra` lên header nữa, nên có HAI nút cho cùng
       hành động — đúng ý đồ ("giữ ở toolbar, nơi chính là header"). Tên truy
       cập khác nhau (`Kiểm tra` vs `Kiểm tra gói`) nên phép chọn phải nói rõ
       nó nhắm nút nào; cả hai đều phải bị khoá khi Draft còn bẩn. */
    await expect(page.getByRole('button', { name: 'Kiểm tra', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Kiểm tra gói', exact: true })).toBeDisabled()
    await sourceBox.press('Control+s')
    await expect(page.getByText('Chưa lưu.')).toHaveCount(0)

    // UJ-PROG-02 (FBD) — thêm chương trình FBD, mount StructuredFbdEditor thật
    await createPou(page, 'Program · FBD')
    const fbdToolbar = page.getByRole('toolbar', { name: 'Lệnh FBD' })
    await expect(fbdToolbar).toBeVisible()

    // TASK-PROG-506 / DDD-FE-PROG-001 §0.1: FBD phải "hoàn tất bằng bàn
    // phím". Chuỗi dưới chỉ dùng `page.keyboard` (Insert/Arrow/Enter/
    // Delete/Ctrl+Z) — KHÔNG click chuột — để thêm 2 block, nối wire, xóa,
    // hoàn tác. `.focus()` chỉ đặt điểm bắt đầu (tương đương Tab tới một nút
    // trong toolbar), không thay cho thao tác nghiệp vụ nào bên dưới.
    await fbdToolbar.getByRole('button').first().focus()
    await page.keyboard.press('Insert') // ADD_BLOCK — block AND #1 (network_1 có sẵn từ emptyFbdDocument)
    /* Chip đếm khối bám `data-testid`: nó bỏ chữ `block` để thanh công cụ gọn
       lại (nhãn cho trình đọc màn hình vẫn còn), và câu chữ hiển thị không
       phải mỏ neo ổn định cho một phép đo về SỐ LƯỢNG. */
    await expect(page.getByTestId('fbd-block-count')).toContainText('1/256')
    // Problems là sibling của editor nhưng phải đọc buffer local chưa Save:
    // network rỗng có 1 lỗi; thêm block hợp lệ phải xóa lỗi ngay trước read-back.
    await expect(page.getByRole('tab', { name: 'Vấn đề (0)', exact: true })).toBeVisible()
    await page.keyboard.press('Insert') // ADD_BLOCK — block AND #2
    await expect(page.getByTestId('fbd-block-count')).toContainText('2/256')

    // TASK-9-FBD-EDIT: làm lệch một block để Auto Layout có delta thật, rồi
    // đo cả hai nhánh Cancel/Apply trên Chrome. Ghost preview là transient:
    // nó xuất hiện trước khi Draft đổi và phải biến mất sau mỗi quyết định.
    const firstFbdNode = page.locator('[data-fbd-node-id]').first()
    const firstFbdNodeBox = await firstFbdNode.boundingBox()
    expect(firstFbdNodeBox, 'block FBD đầu tiên phải có hình học trên Chrome').not.toBeNull()
    await page.mouse.move(firstFbdNodeBox!.x + 20, firstFbdNodeBox!.y + 20)
    await page.mouse.down()
    await page.mouse.move(firstFbdNodeBox!.x + 180, firstFbdNodeBox!.y + 84, { steps: 4 })
    await page.mouse.up()

    await fbdToolbar.getByRole('button', { name: 'Tự sắp xếp', exact: true }).click()
    await expect(page.locator('[data-fbd-layout-preview]')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Draft chưa thay đổi' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('03a-design-fbd-layout-preview.png'), fullPage: true })
    await fbdToolbar.getByRole('button', { name: 'Hủy xem trước', exact: true }).click()
    await expect(page.locator('[data-fbd-layout-preview]')).toHaveCount(0)

    await fbdToolbar.getByRole('button', { name: 'Tự sắp xếp', exact: true }).click()
    await fbdToolbar.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
    await expect(page.locator('[data-fbd-layout-preview]')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'một bước hoàn tác' })).toBeVisible()
    // Các click toolbar ở trên để focus trên button; trả focus về graph trước
    // khi tiếp tục hợp đồng phím Arrow/Enter của editor.
    await page.locator('section[aria-label="Bộ dựng FBD có cấu trúc"]').focus()

    await page.keyboard.press('ArrowDown') // chọn port #1.IN1
    await page.keyboard.press('ArrowDown') // chọn port #1.IN2
    await page.keyboard.press('ArrowDown') // chọn port #1.OUT — nguồn nối
    await page.keyboard.press('Enter') // bắt đầu nối từ #1.OUT
    await page.keyboard.press('ArrowDown') // chọn port #2.IN1 — đích nối
    await page.keyboard.press('Enter') // hoàn tất nối #1.OUT → #2.IN1
    /* Cùng lý do như chip đếm khối: bám `data-testid`, không bám câu chữ. */
    await expect(page.getByTestId('fbd-wire-count')).toContainText('1/512')
    await page.keyboard.press('Delete') // xóa vùng chọn (port đích) — kéo theo wire vừa nối
    await expect(page.getByTestId('fbd-wire-count')).toContainText('0/512')
    await page.keyboard.press('Control+z') // hoàn tác — wire khôi phục
    await expect(page.getByTestId('fbd-wire-count')).toContainText('1/512')
    // `T59-806` — canvas node–edge mới phải qua chính bộ quét a11y của dự án.
    // Bộ quét cũ chỉ chạy trên workspace mặc định (chương trình ST), nên trước
    // lát này CHƯA lần nào FBD editor bị soi thật.
    const fbdAxe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(fbdAxe.violations, 'Vi phạm a11y trên canvas FBD').toEqual([])

    await page.screenshot({ path: testInfo.outputPath('03-design-fbd.png'), fullPage: true })
    // FBD chỉ dùng lệnh chung ở header; tên truy cập đầy đủ của nút là
    // “Lưu bản nháp”, còn nhãn nhìn thấy được rút gọn thành “Lưu”.
    await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click()

    // UJ-PROG-03 — Điểm & Ánh xạ
    const workspaceRail = page.getByRole('navigation', { name: /Điều hướng sáu workspace/ })
    await workspaceRail.getByRole('link', { name: 'Điểm & Ánh xạ' }).click()
    /* `PR #311` dựng lại tab Điểm & Ánh xạ (`MappingWorkbench`); câu trạng thái
       rỗng nay nói rõ nó nói về DRAFT, không phải về thiết bị — "Chưa có ánh xạ
       nào" một mình có thể bị đọc thành "thiết bị không có điểm nào". */
    await expect(page.getByText('Chưa có ánh xạ nào trong Draft.')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('04-design-mapping.png'), fullPage: true })

    // UJ-PROG-04 — Thực thi
    /* `#675` — journey đi qua ĐÚNG lối vào mà người dùng có trong trang.
       Lối vào cũ (`Cấu hình Task` trên thanh tab của workspace) đã bị gỡ cùng
       thanh đó; bản vá tạm sau đó cho journey bấm mục `Execution` của feature
       rail, nhưng rail là lối đi TOÀN CỤC — nó không chứng minh được rằng
       người đang đứng trong Inspector của một POU có cách nào mở cấu hình chạy.
       Trên thực tế họ không có: lối vào duy nhất trong trang là một liên kết
       nằm trong mục `Tham chiếu`, mà mục đó đóng sẵn.

       Nay mục `Thực thi` của Inspector có nút `Cấu hình chạy`, và journey bấm
       chính nó — bằng bàn phím, vì `AC-1` đòi Tab tới và Enter kích hoạt. */
    await workspaceRail.getByRole('link', { name: 'Chương trình' }).click()
    await page.getByRole('button', { name: 'Mở NewProgram', exact: true }).click()
    /* Inspector là khay NĂM NGỮ CẢNH: con trỏ gõ đang nằm trên một ký hiệu thì
       nó nói về ký hiệu đó, và mục `Thực thi` (thuộc ngữ cảnh POU) không dựng.
       Đưa con trỏ ra sau dấu `;` để khay trở về ngữ cảnh POU — đây là hành vi
       sẵn có của `ContextInspector`, không phải thứ `#675` đổi. */
    const stSource = page.getByLabel(/Mã nguồn ST/)
    await stSource.click()
    await page.keyboard.press('Control+End')
    await expect(page.getByTestId('context-inspector')).toHaveAttribute('data-context', 'PROGRAM')
    const executionEntry = page.getByRole('button', { name: 'Cấu hình chạy', exact: true })
    /* "Đúng một" là một phần của hợp đồng: hai lối vào cùng tên trong một khay
       là hai chỗ để luật khoá read-only lệch nhau. */
    await expect(executionEntry).toHaveCount(1)
    await executionEntry.focus()
    await page.keyboard.press('Enter')
    await page.waitForURL((url) => url.searchParams.get('tab') === 'execution')
    /* `AC-2` — rơi `project` hay `pou` là bắt người dùng chọn lại đúng thứ họ
       vừa đứng trong đó; tab đúng mà mất tham số thì vẫn là hỏng. */
    const executionUrl = new URL(page.url())
    expect(executionUrl.pathname).toBe(CANONICAL_PROGRAMS_PATH)
    expect(executionUrl.searchParams.get('project')).toBe(PROJECT_ID)
    expect(executionUrl.searchParams.get('pou')).not.toBeNull()
    await expect(page.getByText('Control_Main')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('05-design-execution.png'), fullPage: true })

    // UJ-PROG-05 — Kiểm tra (D-01: PGM-02 chỉ lưu rồi điều hướng, PGM-03 sở
    // hữu toàn bộ seal/run/poll/result — không còn seal/Check inline ở đây).
    await workspaceRail.getByRole('link', { name: 'Chương trình' }).click()
    // FBD không lặp lệnh Kiểm tra trong editor; dùng lệnh chung ở header.
    await expect(page.getByRole('button', { name: 'Kiểm tra gói', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Kiểm tra gói', exact: true }).click()
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
      { path: '/eng/programming', ready: page.getByRole('button', { name: /Làm mới|Refresh/ }) },
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
  test('ISS-PGUI-03: timestamp kỹ thuật dùng 24 giờ, UTC và đổi locale trên desktop/mobile', async ({ page }, testInfo) => {
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    state.draft.programs.push({ programId: PROGRAM_ID, name: 'AHU_Main', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM AHU_Main\nEND_PROGRAM' })
    state.draft.variables.push({ variableId: '55555555-5555-4555-8555-555555555555', programId: PROGRAM_ID, name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false })
    state.draft.bindings.push({ bindingId: 'binding-e2e-time', variableId: '55555555-5555-4555-8555-555555555555', point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', writable: false, qualityPolicy: 'REQUIRE_GOOD' })
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page, { lang: 'vi' })
    await navigate(page, '/eng/programming')
    await expect(page.getByTestId('system-health-hero')).toBeVisible()

    const viText = await page.locator('body').evaluate((body) => body.innerText)
    expect(viText).toContain('05/09/2026 · 23:07:08 UTC')
    expect(viText).not.toMatch(/\b(?:AM|PM)\b/)

    await page.getByRole('button', { name: 'Đổi ngôn ngữ' }).click()
    const enText = await page.locator('body').evaluate((body) => body.innerText)
    expect(enText).toContain('09/05/2026 · 23:07:08 UTC')
    expect(enText).not.toMatch(/\b(?:AM|PM)\b/)

    await navigate(page, '/eng/programming/runtime')
    await expect(page.getByRole('heading', { name: 'Runtime status' })).toBeAttached()
    expect(await page.locator('body').evaluate((body) => body.innerText)).toContain('09/05/2026 · 23:07:08 UTC')

    if (testInfo.project.name === 'desktop-chrome') {
      await navigate(page, `/eng/programming/projects/${PROJECT_ID}/mapping`)
      await expect(page.getByRole('heading', { name: 'Assigned Mappings' })).toBeVisible()
      expect(await page.locator('body').evaluate((body) => body.innerText)).toContain('09/05/2026 · 23:07:08 UTC')
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    expectNoBrowserFailures(failures, 'ISS-PGUI-03')
  })

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
    await expect(page.getByRole('button', { name: 'Mới', exact: true })).toHaveCount(0)

    expect(writes, 'màn hẹp không được gửi mutation nào').toEqual([])
    expectNoBrowserFailures(failures, 'mobile read-only')
  })

  test('TC-FBD-RESP-001..003/HEADER-001/STATE-004: shell FBD đúng sáu mốc và mobile không ghi', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Một lane desktop tự đổi kích thước để giữ cùng một tài liệu FBD')
    await page.setViewportSize({ width: 1440, height: 900 })
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    const writes = observeProgrammingWrites(page)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)

    await createPou(page, 'Program · FBD')
    const shell = page.getByTestId('fbd-workspace-shell')
    await expect(shell).toBeVisible()
    const fbdToolbar = page.getByRole('toolbar', { name: 'Lệnh FBD' })
    await expect(fbdToolbar).toBeVisible()

    // HEADER-001: FBD chỉ có lệnh chung ở header, không dựng bản sao trong shell.
    await expect(page.getByRole('button', { name: 'Lưu bản nháp', exact: true })).toHaveCount(1)
    await expect(shell.getByRole('button', { name: /^(Lưu|Kiểm tra|Làm mới)$/ })).toHaveCount(0)

    /* MỘT canvas (`#674`). Bản trước bấm `Network` để có network thứ hai rồi
     * đối chiếu `SELECTED`/`ALL` = 1/2 article. Quyết định chủ sở hữu
     * `owner-decision-20260912T0300Z` bỏ hẳn đường tạo network thứ hai, nên
     * mốc "2 article ở ALL" không còn hợp đồng nào để khoá; thay vào đó khoá
     * chính điều mới: không còn lối vào nhiều Network, và cả hai khung nhìn
     * đều cho đúng MỘT article.
     *
     * Bằng chứng thay thế cho phần bị bỏ (tài liệu nhiều Network xử lý ra sao)
     * do lane vitest gánh — `StructuredFbdEditor.test.tsx` `AC-674-4`: tài liệu
     * 2 Network mở chỉ đọc, giữ đủ 2 article và phát 0 mutation. Lane e2e
     * không dựng được trạng thái đó nữa vì UI không tạo ra nó. */
    await expect(fbdToolbar.getByRole('button', { name: 'Network', exact: true })).toHaveCount(0)
    await expect(shell.getByTestId('fbd-active-network')).toHaveCount(0)
    await expect(shell.locator('article[data-fbd-network-id]')).toHaveCount(1)
    /* Tuỳ chọn hiển thị (Khung nhìn / Lưới / Bám lưới / Kiểu dây / Giao diện
       FBD) nay nằm sau nút bánh răng của thanh công cụ canvas, không còn là một
       dải thường trực chiếm 37 px chiều cao ở mọi lúc. Mở khay ra rồi thao tác
       — trình duyệt thật từ chối thao tác trên phần tử ẩn, và đó đúng là điều
       cần: một điều khiển không nhìn thấy thì người dùng cũng không bấm được. */
    await page.getByTestId('fbd-display-settings-toggle').click()
    await page.getByLabel('Khung nhìn').selectOption('ALL')
    await expect(shell.locator('article[data-fbd-network-id]')).toHaveCount(1)

    const inspector = page.locator('aside[aria-label="Thuộc tính"]')
    const inspectorOpener = page.getByRole('button', { name: 'Mở Thuộc tính', exact: true }).first()
    const libraryColumn = page.getByTestId('quick-library-column')
    const marquee = page.getByRole('button', { name: 'Chọn vùng', exact: true })

    /* BA NGƯỠNG CỦA THƯ VIỆN NHANH (`#676`, hợp đồng §7.5), đo bằng HÌNH THÁI
     * THẬT chứ không bằng sự có mặt của lớp CSS — một lớp Tailwind sai ngưỡng
     * vẫn "có mặt" trong `className` và vẫn cho test xanh (`AC-2`).
     *
     * Phép đo phân biệt ba hình thái là `position` + bề rộng track + bề rộng
     * canvas, không phải tên lớp:
     *   - `column` (`≥1440`)     : trong luồng, mở sẵn, là cột thứ ba của lưới;
     *   - `dock`   (`1280–1439`) : trong luồng, thu về ray; MỞ RA THÌ CANVAS HẸP LẠI;
     *   - `drawer` (`<1280`)     : `position: fixed`, phủ lên canvas, canvas GIỮ NGUYÊN.
     *
     * Vì sao dải hẹp phải có lối vào: `TC-FBD-RESP-001` cấm cột THƯỜNG TRỰC
     * dưới `1440`, không cấm dock/khay có nút mở. Bản trước đọc nhầm điều đó
     * thành "dưới 1440 thì không có Thư viện", và đó là chuỗi `5fa334b` →
     * `11d7b33` → PR `#685`, mỗi bước chữa triệu chứng của bước trước. */
    const libraryMorphology = () => page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="quick-library-column"]')
      const canvas = document.querySelector<HTMLElement>('[data-testid="programming-editor-column"]')
      const box = node?.getBoundingClientRect()
      const style = node ? window.getComputedStyle(node) : null
      return {
        presentation: node?.dataset.libraryPresentation ?? 'missing',
        position: style?.position ?? 'missing',
        display: style?.display ?? 'missing',
        width: Math.round(box?.width ?? 0),
        canvasWidth: Math.round(canvas?.getBoundingClientRect().width ?? 0),
      }
    })

    // ≥1440: Explorer | Canvas | Thư viện nhanh | Inspector cùng hiển thị.
    await expect(inspector).toBeVisible()
    await expect(libraryColumn).toBeVisible()
    await expect(inspectorOpener).toBeHidden()
    await expect(marquee).toBeHidden()
    const wide = await libraryMorphology()
    expect(wide.presentation, JSON.stringify(wide)).toBe('column')
    // Cột thật: nằm trong luồng và rộng hơn một thanh ray.
    expect(wide.position, JSON.stringify(wide)).not.toBe('fixed')
    expect(wide.width, JSON.stringify(wide)).toBeGreaterThan(100)
    // AC-5: `1440×900` là mốc đầu của bốn khổ phải không tràn ngang.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '1440px không tràn ngang').toBe(true)

    /* `1366×768` — khổ mà `AC-3` đòi bằng chứng đích danh: laptop phổ thông, và
     * cũng là 1080p ở scale 125/150%. Trước `#676`, soạn FBD ở đây KHÔNG có
     * đường nào mở Thư viện nhanh; không phải "khó tìm" mà là không tồn tại. */
    await page.setViewportSize({ width: 1366, height: 768 })
    await expect(shell).toBeVisible()
    await expect(inspector).toBeHidden()
    await expect(inspectorOpener).toBeVisible()
    const dockClosed = await libraryMorphology()
    expect(dockClosed.presentation, JSON.stringify(dockClosed)).toBe('dock')
    expect(dockClosed.position, JSON.stringify(dockClosed)).not.toBe('fixed')
    // Thu về ray: hiện, bấm được, nhưng KHÔNG phải cột thường trực.
    expect(dockClosed.width, JSON.stringify(dockClosed)).toBeGreaterThan(0)
    expect(dockClosed.width, JSON.stringify(dockClosed)).toBeLessThan(100)

    // AC-3: Thư viện TỚI ĐƯỢC ở khổ này — mở từ chính thanh ray trong cột.
    await libraryColumn.getByRole('button', { name: 'Mở Thư viện nhanh' }).click()
    await expect(libraryColumn.getByRole('region', { name: 'Thư viện nhanh' })).toBeVisible()
    const dockOpen = await libraryMorphology()
    // Dock nằm TRONG luồng ⇒ mở ra thì canvas hẹp lại thật. Đây là phép đo
    // phân biệt dock với drawer, và nó không đọc một lớp CSS nào.
    expect(dockOpen.width, JSON.stringify(dockOpen)).toBeGreaterThan(dockClosed.width)
    expect(dockOpen.canvasWidth, JSON.stringify({ dockOpen, dockClosed }))
      .toBeLessThan(dockClosed.canvasWidth)
    expect(dockOpen.position, JSON.stringify(dockOpen)).not.toBe('fixed')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '1366px không tràn ngang').toBe(true)

    /* `1280` là BIÊN DƯỚI của dải dock — mốc dễ trượt nhất, nên khoá đích danh.
     * Cột vẫn phải khuất theo `TC-FBD-RESP-001` (không cột thường trực), nhưng
     * hình thái là `dock` chứ không phải `drawer`. */
    await page.setViewportSize({ width: 1280, height: 820 })
    await expect(shell).toBeVisible()
    const dockLowerBound = await libraryMorphology()
    expect(dockLowerBound.presentation, JSON.stringify(dockLowerBound)).toBe('dock')
    expect(dockLowerBound.position, JSON.stringify(dockLowerBound)).not.toBe('fixed')
    // AC-5: `1280×820`.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '1280px không tràn ngang').toBe(true)

    /* `<1280`: drawer. `1024` giữ nguyên mốc cũ của `TC-FBD-RESP-001` — cột
     * phải KHUẤT khi chưa mở, và ở đây nó khuất hẳn (`display: none`) chứ
     * không phải thu về ray: khổ này chỗ vẽ đắt nhất, một ray 44px thường trực
     * là lấy chỗ vẽ đổi lấy thứ đã có nút mở ở đầu cột soạn thảo. */
    for (const width of [1279, 1024]) {
      await page.setViewportSize({ width, height: 820 })
      await expect(shell).toBeVisible()
      await expect(inspector).toBeHidden()
      await expect(libraryColumn).toBeHidden()
      await expect(inspectorOpener).toBeVisible()
      await expect(marquee).toBeHidden()
      const drawerClosed = await libraryMorphology()
      expect(drawerClosed.presentation, JSON.stringify(drawerClosed)).toBe('drawer')
      // Không chiếm chỗ vẽ khi đóng: khác hẳn ray 44px của dock.
      expect(drawerClosed.width, JSON.stringify(drawerClosed)).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px không tràn ngang`).toBe(true)
    }

    /* AC-3 ở dải drawer: vẫn TỚI ĐƯỢC, qua nút nằm NGOÀI khay (khay không có
     * ray để bấm), và mở ra thì PHỦ LÊN canvas chứ không đẩy canvas. */
    await page.setViewportSize({ width: 1024, height: 820 })
    const libraryOpener = page.getByRole('button', { name: 'Mở Thư viện nhanh', exact: true }).first()
    await expect(libraryOpener).toBeVisible()
    const canvasBeforeDrawer = (await libraryMorphology()).canvasWidth
    await libraryOpener.click()
    await expect(libraryColumn).toBeVisible()
    const drawerOpen = await libraryMorphology()
    expect(drawerOpen.position, JSON.stringify(drawerOpen)).toBe('fixed')
    expect(drawerOpen.width, JSON.stringify(drawerOpen)).toBeGreaterThan(100)
    // Phủ lên, KHÔNG đẩy: canvas giữ nguyên bề rộng — ngược hẳn với dock.
    expect(drawerOpen.canvasWidth, JSON.stringify({ drawerOpen, canvasBeforeDrawer }))
      .toBe(canvasBeforeDrawer)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '1024px mở khay không tràn ngang').toBe(true)

    // Escape đóng khay Thư viện và trả focus về đúng nút đã mở nó.
    await page.keyboard.press('Escape')
    await expect(libraryColumn).toBeHidden()
    await expect(libraryOpener).toBeFocused()

    // Drawer Inspector trả focus sau Escape ở dải desktop hẹp.
    await page.setViewportSize({ width: 1280, height: 820 })
    await inspectorOpener.click()
    await expect(inspector).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await expect(inspectorOpener).toBeFocused()

    // 768–1023: nút Chọn vùng dành cho touch/stylus xuất hiện.
    for (const width of [820, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(marquee).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px không tràn ngang`).toBe(true)
    }

    // <768: banner đúng nội dung, điều khiển sửa bị khóa và không có mutation.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('programming-mobile-read-only')).toContainText('Màn hình nhỏ — chỉ hỗ trợ xem sơ đồ')
    await expect(shell.getByRole('button', { name: 'Thêm khối', exact: true })).toBeDisabled()
    const writesBeforeMobileAttempt = writes.length
    await page.locator('body').focus()
    await page.keyboard.press('Insert')
    await expect.poll(() => writes.length).toBe(writesBeforeMobileAttempt)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '390px không tràn ngang').toBe(true)

    expectNoBrowserFailures(failures, 'ma trận responsive FBD')
  })

  test('TC-FBD-DIAG-001: Problems nhảy đúng wire lỗi trên Chrome', async ({ page }) => {
    const state: MockState = { etagGeneration: 1, draft: draftWithFbdProblem(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    const writes = observeProgrammingWrites(page)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)

    await page.getByRole('tab', { name: /Vấn đề/ }).click()
    await page.getByRole('button', { name: /FBD-SEM-ORDER-001/ }).click()
    const selectedWire = page.locator('path[role="button"][aria-pressed="true"]')
    await expect(selectedWire).toHaveCount(1)
    expect(await selectedWire.getAttribute('d')).toMatch(/^M /)
    expect(writes, 'jump diagnostic chỉ đổi selection, không ghi Draft').toEqual([])
    expectNoBrowserFailures(failures, 'FBD diagnostic exact wire')
  })

  test('TC-FBD-NAV-001: Mini Map click/kéo/phím chính xác và không mutate trên Chrome', async ({ page }, testInfo) => {
    /* LANE DESKTOP, VÀ LÝ DO NÓI RA.
     *
     * Case này soạn 25 khối để Mini Map vượt `FBD_MINIMAP_NODE_THRESHOLD` rồi
     * đo điều hướng. Soạn thảo là MUTATION, mà dưới 768 px PGM-02 là read-only
     * theo `AC-PGM02-010`/`T59-802` — bản trước của case này vẫn chạy ở lane
     * mobile và nằm chờ nút `Mới` trên chính màn hình mà thiết kế đã khoá, cho
     * tới khi hết 60 giây. Đó là kỳ vọng sai của phép đo, không phải lỗi sản
     * phẩm, và nó là một trong tám test đỏ sẵn của `#665`.
     *
     * Đã thử giữ lane mobile bằng cách nạp sẵn Draft đủ khối thay vì soạn.
     * Không giữ được, và lý do đáng ghi lại: ở khổ 412 px, tài liệu nạp sẵn
     * cho ra mặt vẽ mà 30% bề ngang Mini Map vẫn nằm trong nửa khung nhìn đầu,
     * nên `scrollLeft` hợp lệ bằng `0` và khẳng định `> 0` của case này vô
     * nghĩa ở đó. Ép nó đạt sẽ phải nới chính con số mà case này sinh ra để
     * canh. Vậy case chạy đúng lane desktop, cùng lý do và cùng cách mà
     * `TC-FBD-RESP-001` trong chính describe này đã làm.
     *
     * Mini Map trên màn hẹp vì thế CHƯA có bằng chứng — một khoảng trống thật,
     * cần phép đo riêng cho hình thái mobile chứ không phải một dòng chờ hết
     * giờ. Đã mở finding riêng thay vì giấu nó trong một test đỏ. */
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'soạn 25 khối là mutation; dưới 768 px PGM-02 read-only (AC-PGM02-010)'
    )
    /* Cột Mini Map của Workbench chỉ sở hữu component từ 1440 px. Viewport
     * mặc định 1280 px của project desktop chỉ kiểm nhánh inline trong
     * FbdCanvas và từng cho kết quả xanh giả đối với thay đổi ở Cột 3. */
    await page.setViewportSize({ width: 1920, height: 1080 })
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    const writes = observeProgrammingWrites(page)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)
    await createPou(page, 'Program · FBD')
    const editor = page.locator('section[aria-label="Bộ dựng FBD có cấu trúc"]')
    await editor.focus()
    for (let index = 0; index < 25; index += 1) await page.keyboard.press('Insert')
    await expect(page.getByTestId('fbd-block-count')).toContainText('25/256')
    await expect.poll(() => writes.length).toBeGreaterThan(0)
    writes.splice(0, writes.length)

    const minimap = page.locator('[data-fbd-minimap="true"]')
    await expect(minimap).toBeVisible()
    await expect(page.getByTestId('workbench-minimap-column').locator('[data-fbd-minimap="true"]')).toHaveCount(1)
    await minimap.scrollIntoViewIfNeeded()
    const surface = page.locator('svg[data-fbd-network-id]').first()
    const transformsBefore = await surface.locator('[data-fbd-node-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')))
    const box = await minimap.boundingBox()
    expect(box).not.toBeNull()
    await minimap.click({ position: { x: box!.width * 0.3, y: box!.height * 0.5 } })
    expect(await surface.evaluate((element) => element.parentElement?.scrollLeft ?? 0)).toBeGreaterThan(0)
    const dragBox = await minimap.boundingBox()
    expect(dragBox).not.toBeNull()
    await page.mouse.move(dragBox!.x + dragBox!.width * 0.3, dragBox!.y + dragBox!.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(dragBox!.x + dragBox!.width * 0.7, dragBox!.y + dragBox!.height * 0.5, { steps: 5 })
    await page.mouse.up()

    const minimapMetrics = await minimap.evaluate((element, ratio) => {
      const svg = element as SVGSVGElement
      const rect = svg.getBoundingClientRect()
      const viewBox = svg.viewBox.baseVal
      const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height)
      const offsetX = (rect.width - viewBox.width * scale) / 2
      const localGraphX = (rect.width * ratio - offsetX) / scale
      const graphX = Math.min(
        viewBox.x + viewBox.width,
        Math.max(viewBox.x, viewBox.x + localGraphX),
      )
      const surfaceElement = document.querySelector<SVGSVGElement>('svg[data-fbd-network-id]')
      const scroller = surfaceElement?.parentElement
      if (!scroller) throw new Error('Thiếu viewport FBD')
      return {
        centerError: Math.abs(scroller.scrollLeft + scroller.clientWidth / 2 - graphX),
        clientWidth: scroller.clientWidth,
        scrollLeft: scroller.scrollLeft,
        scrollWidth: scroller.scrollWidth,
        graphX,
        viewBoxX: viewBox.x,
        viewBoxWidth: viewBox.width,
      }
    }, 0.7)
    expect(
      minimapMetrics.centerError,
      `tâm viewport lệch không quá một grid 8 px: ${JSON.stringify(minimapMetrics)}`,
    ).toBeLessThanOrEqual(8)

    const scrollBeforeKey = await surface.evaluate((element) => element.parentElement?.scrollLeft ?? 0)
    await minimap.focus()
    await page.keyboard.press('ArrowLeft')
    const scrollAfterKey = await surface.evaluate((element) => element.parentElement?.scrollLeft ?? 0)
    expect(scrollAfterKey).toBeLessThan(scrollBeforeKey)
    expect(await surface.locator('[data-fbd-node-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')))).toEqual(transformsBefore)
    await page.screenshot({ path: testInfo.outputPath('fbd-minimap-navigation.png'), fullPage: true })
    expect(writes, 'điều hướng Mini Map không gửi mutation').toEqual([])
    expectNoBrowserFailures(failures, 'FBD Mini Map')
  })

  test('TC-FBD-USABLE-001: dựng INPUT → AND → TIMER → OUTPUT bằng wiring trực tiếp rồi sửa bằng chuột và bàn phím', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'dưới 768 px PGM-02 là chế độ chỉ đọc theo AC-PGM02-010',
    )
    const state: MockState = { etagGeneration: 1, draft: initialDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&mode=EDIT`)
    await createPou(page, 'Program · FBD')

    const toolbar = page.getByRole('toolbar', { name: 'Lệnh FBD' })
    await toolbar.getByRole('button', { name: 'Input', exact: true }).click()
    await page.getByLabel('Tên biến').fill('START_CMD')
    await page.getByRole('button', { name: 'Tạo', exact: true }).click()

    const palette = toolbar.locator('select').first()
    await palette.selectOption('AND')
    await toolbar.getByRole('button', { name: 'Thêm khối', exact: true }).click()
    await palette.selectOption('TON')
    await toolbar.getByRole('button', { name: 'Thêm khối', exact: true }).click()

    await toolbar.getByRole('button', { name: 'Output', exact: true }).click()
    await page.getByLabel('Tên biến').fill('FAN_ENABLE')
    await page.getByRole('button', { name: 'Tạo', exact: true }).click()
    await expect(page.getByTestId('fbd-block-count')).toContainText('4/256')

    const blocks = page.locator('g[data-fbd-node-id]')
    await expect(blocks).toHaveCount(4)
    const input = blocks.nth(0)
    const andBlock = blocks.nth(1)
    const timer = blocks.nth(2)
    const output = blocks.nth(3)

    async function wire(from: ReturnType<typeof page.locator>, to: ReturnType<typeof page.locator>) {
      const source = await from.boundingBox()
      const target = await to.boundingBox()
      expect(source, 'cổng nguồn phải có hình học').not.toBeNull()
      expect(target, 'cổng đích phải có hình học').not.toBeNull()
      await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
      await page.mouse.down()
      await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 5 })
      await page.mouse.up()
    }

    await wire(
      input.getByRole('button', { name: /BOOL OUTPUT OUT BOOL/ }),
      andBlock.getByRole('button', { name: /AND INPUT IN1 BOOL/ }),
    )
    await expect(page.getByTestId('fbd-wire-count')).toContainText('1/512')
    await wire(
      andBlock.getByRole('button', { name: /AND OUTPUT OUT BOOL/ }),
      timer.getByRole('button', { name: /TON INPUT IN BOOL/ }),
    )
    await expect(page.getByTestId('fbd-wire-count')).toContainText('2/512')
    await wire(
      timer.getByRole('button', { name: /TON OUTPUT Q BOOL/ }),
      output.getByRole('button', { name: /BOOL INPUT IN BOOL/ }),
    )
    await expect(page.getByTestId('fbd-wire-count')).toContainText('3/512')

    const editor = page.locator('section[aria-label="Bộ dựng FBD có cấu trúc"]')
    const andNodeButton = andBlock.getByRole('button', { name: /#1 · AND · FUNCTION/ })
    await andNodeButton.click()
    const beforeNudge = await andBlock.boundingBox()
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(async () => (await andBlock.boundingBox())?.x ?? 0).toBeGreaterThan((beforeNudge?.x ?? 0) + 4)

    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    await expect(page.getByTestId('fbd-block-count')).toContainText('5/256')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('fbd-block-count')).toContainText('4/256')

    await andNodeButton.click()
    await page.keyboard.press('Control+d')
    await expect(page.getByTestId('fbd-block-count')).toContainText('5/256')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('fbd-block-count')).toContainText('4/256')

    await andNodeButton.click()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('fbd-block-count')).toContainText('3/256')
    await expect(page.getByTestId('fbd-wire-count')).toContainText('1/512')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('fbd-block-count')).toContainText('4/256')
    await expect(page.getByTestId('fbd-wire-count')).toContainText('3/512')

    const surface = page.locator('svg[data-fbd-network-id]').first()
    const zoom = page.getByRole('button', { name: 'Thu phóng 100%', exact: true })
    await expect(zoom).toContainText('100%')
    const surfaceBox = await surface.boundingBox()
    expect(surfaceBox).not.toBeNull()
    await page.mouse.move(surfaceBox!.x + surfaceBox!.width / 2, surfaceBox!.y + surfaceBox!.height / 2)
    /* Playwright/CDP headless không chuyển Ctrl+mouseWheel vào DOM trên lane
       này (capture listener ở window nhận 0 event). Phát WheelEvent tại chính
       SVG vẫn chạy qua browser runtime và native non-passive listener của sản
       phẩm; wiring và middle-pan ở trên/dưới vẫn dùng input chuột CDP thật. */
    await surface.dispatchEvent('wheel', {
      ctrlKey: true,
      clientX: surfaceBox!.x + surfaceBox!.width / 2,
      clientY: surfaceBox!.y + surfaceBox!.height / 2,
      deltaY: -120,
      bubbles: true,
      cancelable: true,
    })
    await expect(zoom).not.toContainText('100%')

    const scene = surface.locator('[data-fbd-scene="true"]')
    const transformBeforePan = await scene.getAttribute('transform')
    await page.mouse.move(surfaceBox!.x + 80, surfaceBox!.y + 80)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(surfaceBox!.x + 140, surfaceBox!.y + 120, { steps: 4 })
    await page.mouse.up({ button: 'middle' })
    await expect.poll(() => scene.getAttribute('transform')).not.toBe(transformBeforePan)

    await editor.focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Escape')
    expectNoBrowserFailures(failures, 'FBD usable direct-manipulation flow')
  })

  test('TC-FBD-STATE-006: Watch OFFLINE giữ badge và không biến null thành 0 trên Chrome', async ({ page }) => {
    const state: MockState = {
      etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0,
      restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false,
      monitorQuality: 'OFFLINE', monitorFreshness: 'UNAVAILABLE',
    }
    await installProgrammingMocks(page, state)
    const failures = observeBrowserFailures(page)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=LIVE`)
    await page.getByRole('tab', { name: /Watch/ }).click()
    await expect(page.getByText('Mất kết nối')).toHaveAttribute('data-quality', 'OFFLINE')
    await expect(page.getByRole('tabpanel')).toContainText('—')
    await expect(page.getByRole('tabpanel').getByText(/^0(?:\.0+)?$/)).toHaveCount(0)
    expectNoBrowserFailures(failures, 'FBD Watch offline')
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
    expect(count, 'workbench phải có đủ bốn khay').toBe(4)
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
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
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
    await createPou(page, 'Function · ST')
    await expect(page.getByRole('button', { name: 'Mở NewFunction', exact: true })).toBeVisible()
    await createPou(page, 'Function Block · ST')
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
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
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
    await page.setViewportSize({ width: 1920, height: 1080 })

    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)
    await expect(page.getByLabel(/Mã nguồn ST/)).toBeVisible()
    // G-01/G-03: desktop chỉ còn một Global Context Bar ở mép trên; TopBar
    // toàn hệ thống không tạo tầng header thứ hai và badge Program chi tiết đã
    // rời khỏi hàng chính.
    await expect(page.getByTestId('app-top-bar')).toBeHidden()
    const contextBox = await page.getByTestId('programming-global-context-bar').boundingBox()
    expect(contextBox?.y ?? 999).toBeLessThanOrEqual(16)
    await expect(page.locator('[data-context-field="health"]')).toHaveCount(0)
    /* Workspace mới mở sẵn panel cắm ở cột thứ ba. Catalog vẫn chỉ được nạp
       bởi chính panel này, không bởi shell hay editor trước khi panel mount. */
    const panel = page.getByRole('region', { name: 'Thư viện nhanh' })
    await expect(panel).toBeVisible()
    await expect.poll(() => libraryRequests.length).toBeGreaterThan(0)

    const fourColumns = await page.evaluate(() => {
      const ids = ['pou-explorer-column', 'programming-editor-column', 'quick-library-column', 'inspector-column']
      return ids.map((id) => {
        const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
        const box = node?.getBoundingClientRect()
        return { id, x: Math.round(box?.x ?? -1), width: Math.round(box?.width ?? 0) }
      })
    })
    expect(fourColumns.every((column) => column.width > 0), JSON.stringify(fourColumns)).toBe(true)
    expect(fourColumns.map((column) => column.x)).toEqual([...fourColumns.map((column) => column.x)].sort((a, b) => a - b))
    await expect(page.getByRole('button', { name: /Đổi kích thước/ })).toHaveCount(3)
    await page.screenshot({ path: testInfo.outputPath('pgm02-four-column-1920x1080.png'), fullPage: false })

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
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
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
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'khổ hẹp là read-only, có case riêng')
    const state: MockState = { etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page)
    await navigate(page, `${CANONICAL_PROGRAMS_PATH}?project=${PROJECT_ID}&pou=${POU_OBJECT_ID}&mode=EDIT`)

    const target = page.getByRole('button', { name: 'EDIT', exact: true })
    await expect(target).toBeVisible()

    /* Focus phải đến bằng BÀN PHÍM, không bằng `locator.focus()`.
     *
     * Vòng ring dùng `:focus-visible`, mà Chromium chỉ khớp giả lớp đó theo
     * phương thức tương tác gần nhất: sau khi `login()` và `navigate()` đã bấm
     * chuột, một cú focus bằng script KHÔNG bật `:focus-visible`, nên phép đo cũ
     * đọc được `outline-width: 0` và tố cáo sản phẩm thiếu vòng focus — trong
     * khi lớp `focus-visible:outline-2` vẫn nằm nguyên trên nút.
     *
     * Đo bằng Tab vừa đúng thứ test tuyên bố đo ("thứ người dùng bàn phím
     * thấy"), vừa giữ nguyên khả năng bắt lỗi thật: nếu lớp ring bị gỡ, phép đo
     * này vẫn ra 0. */
    await page.keyboard.press('Tab')
    for (let hop = 0; hop < 80; hop += 1) {
      if (await target.evaluate((element) => element === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    expect(
      await target.evaluate((element) => element === document.activeElement),
      'không Tab tới được nút EDIT — thứ tự tiêu điểm bàn phím đã hỏng',
    ).toBe(true)

    const outlineWidth = await target.evaluate((element) => {
      const style = window.getComputedStyle(element)
      // Trình duyệt trả `px`; `outline-width` là thứ người dùng bàn phím thấy.
      return Number.parseFloat(style.outlineWidth || '0')
    })
    expect(outlineWidth, 'focusRingMinPx = 2 trong nfr.accessibility').toBeGreaterThanOrEqual(2)
  })

  test('AC-PGM02-008: bộ chuyển chế độ đi hết bằng bàn phím và nói rõ vì sao SIMULATE chưa có', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'khổ hẹp là read-only, có case riêng')
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
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'khổ hẹp là read-only, có case riêng')
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
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
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

    // Trace không còn là tab trong workbench (T9-03).
    await expect(page.getByRole('tab', { name: 'Trace' })).toHaveCount(0)

    expectNoBrowserFailures(failures, 'LIVE')
  })

  test('AC-PGM02-003: đổi EDIT → LIVE khi Draft bẩn phải hỏi trước', async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
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
      await expect(page.getByRole('button', { name: 'Mới', exact: true })).toHaveCount(0)

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
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'đo vòng đời một lần ở lane desktop')
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
  /* Chữ ký ĐÃ PHÂN GIẢI do backend công bố (`T59-804`). Cố ý để MỘT khối thiếu
     field này: bề mặt phải nói "chưa đọc được chữ ký" thay vì tự parse
     `interface` để đoán hộ, và một lane mà mọi khối đều có chữ ký sẽ không bao
     giờ chạy qua nhánh ấy. */
  signature?: {
    category: string
    dispatch: 'OPERATOR' | 'FUNC_TABLE' | 'FB_TYPE' | 'EXPANSION'
    polymorphic: boolean
    allowedTypes: string[]
    typedPortNames: string[]
    ports: { name: string; direction: 'INPUT' | 'OUTPUT'; dataType: string }[]
  }
}

/* Bốn khối vì lane cần bốn vai khác nhau: một khối SYSTEM bình thường, khối
   SYSTEM đang chờ review (`PID` — đúng mục `approved:false` của profile), một
   khối SYSTEM thuộc nhóm `timer` để phép lọc có cái để thu hẹp, và một khối
   PROJECT — nguồn DUY NHẤT mà `library_usages` đo được. `description` khác
   nhau từng khối để nói được "đang đọc đúng khối nào" mà không cần bám class.
   Từ `T61-303` mô tả xuất hiện ở CẢ thẻ lẫn khay Chi tiết, nên khẳng định về
   nó phải nêu rõ đang soi vùng nào. */
const LIBRARY_CATALOG: MockLibraryEntry[] = [
  {
    scope: 'SYSTEM', libraryRevisionId: SYSTEM_LIBRARY_REVISION_ID, libraryVersion: 'rev-a.3',
    libraryState: 'PUBLISHED', entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT',
    featureState: 'AVAILABLE', category: 'math', description: 'Kẹp giá trị vào khoảng cho phép',
    contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
    signature: {
      category: 'math', dispatch: 'FUNC_TABLE', polymorphic: false,
      allowedTypes: ['REAL'], typedPortNames: [],
      ports: [
        { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
        { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
        { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
        { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
      ]
    }
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
    contentSha256: 'd'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 16,
    signature: {
      category: 'timer', dispatch: 'FB_TYPE', polymorphic: false,
      allowedTypes: [], typedPortNames: [],
      ports: [
        { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
        { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
        { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
        { name: 'ET', direction: 'OUTPUT', dataType: 'TIME' }
      ]
    }
  },
  {
    scope: 'PROJECT', libraryRevisionId: PROJECT_LIBRARY_REVISION_ID, libraryVersion: '1.2',
    libraryState: 'PUBLISHED', entryId: 'AHU_STAGE', kind: 'FUNCTION_BLOCK', name: 'AHU_STAGE',
    featureState: 'AVAILABLE', category: 'control', description: 'Khối phân cấp giai đoạn AHU của dự án',
    contentSha256: 'e'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 32
  },
  /*
  `T61-503` — khối PROJECT **CÓ chữ ký**, và nó phải tồn tại.

  `AHU_STAGE` ở trên cố ý KHÔNG có chữ ký: nó là fixture của case "vắng chữ ký
  thì nói ra". Nhưng từ `T61-406`, thiếu chữ ký là một lý do CHẶN chèn — nên
  toàn bộ đường Chèn của lane e2e đang đo trên đúng khối không chèn được, và
  một case "Chèn bật được" chạy trên nó chỉ còn hai kết cục: đỏ, hoặc xanh vì
  cổng đã bị nới. Một fixture thứ hai, chèn được thật, là thứ tách hai câu hỏi
  ấy ra.
  */
  {
    scope: 'PROJECT', libraryRevisionId: PROJECT_LIBRARY_REVISION_ID, libraryVersion: '1.2',
    libraryState: 'PUBLISHED', entryId: 'AHU_RESET', kind: 'FUNCTION', name: 'AHU_RESET',
    featureState: 'AVAILABLE', category: 'control', description: 'Đặt lại chuỗi giai đoạn AHU',
    contentSha256: 'f'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
    signature: {
      dispatch: 'FUNC_TABLE', polymorphic: false, typedPortNames: [], category: 'control',
      labelVi: 'Đặt lại giai đoạn', labelEn: 'Reset stage', allowedTypes: [],
      ports: [
        { name: 'RST', direction: 'INPUT', dataType: 'BOOL' },
        { name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }
      ]
    }
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
  /**
   * `T61-503` — CẮT TRANG ở mock, để trang-N có thật.
   *
   * Bản trước luôn trả `nextCursor: null`, nên lane e2e **không có phân trang**:
   * mọi khẳng định về "trang sau lỗi" hay "giữ lại trang đã tải" đều không thể
   * viết, và tình trạng ấy đọc từ ngoài y hệt "đã phủ".
   */
  pageSize: number | null
  /** Bật 503 cho ĐÚNG lượt gọi có cursor (trang 2+), giữ trang 1 thành công. */
  failNextPage: boolean
  /** Bật 403 cho `/libraries` — mất quyền GIỮA CHỪNG, khác 503 mất kết nối. */
  forbidLibraries: boolean
}

function libraryLane(): LibraryLane {
  return {
    libraryQueries: [], failLibraries: false,
    pageSize: null, failNextPage: false, forbidLibraries: false,
  }
}

async function installLibraryLaneRoutes(page: Page, lane: LibraryLane) {
  await page.route(
    (url) => url.pathname === '/api/v1/programming/libraries',
    async (route) => {
      const url = new URL(route.request().url())
      lane.libraryQueries.push(url.search)
      const cursor = url.searchParams.get('cursor')
      if (lane.failLibraries) {
        return json(
          route,
          { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true, keepsRunningRevision: true, correlationId: 'e2e-correlation-pgm04' } },
          503
        )
      }
      /* `T61-503` — MẤT QUYỀN giữa chừng ≠ mất kết nối. 403 nói "phiên này
         không còn được đọc", 503 nói "thiết bị chưa trả lời"; hai câu dẫn tới
         hai hành động khác nhau của người vận hành, và một bề mặt gộp chúng lại
         sẽ mời người ta bấm Thử lại mãi cho một thứ thử lại không sửa được. */
      if (lane.forbidLibraries) {
        return json(
          route,
          { error: { code: 'PRG-ERR-FORBIDDEN-001', messageKey: 'programming.error.forbidden', retryable: false, keepsRunningRevision: true, correlationId: 'e2e-correlation-pgm04' } },
          403
        )
      }
      /* Trang-N hỏng: chỉ lượt gọi CÓ cursor mới 503. Trang 1 vẫn thành công,
         nên case đo được đúng thứ nó muốn đo — dữ liệu đã tải có bị xoá không. */
      if (lane.failNextPage && cursor) {
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
      if (lane.pageSize === null) return json(route, { items, nextCursor: null })
      const start = cursor ? Number(cursor) : 0
      const slice = items.slice(start, start + lane.pageSize)
      const nextStart = start + lane.pageSize
      return json(route, {
        items: slice,
        nextCursor: nextStart < items.length ? String(nextStart) : null,
      })
    }
  )

  /*
  `T61-503` — khay **Mã nguồn** (`T61-404`) chưa từng có route mock nào.

  Nó rơi vào nhánh 503 bắt-tất-cả ở cuối `installProgrammingMocks`, nên mọi lần
  mở khay ấy trong lane e2e đều in một dòng `console.error` — và vì không case
  nào từng mở khay ấy, không ai thấy. Một bề mặt đọc không có mock là một bề mặt
  không được kiểm: một `POST` lọt vào đường đọc sẽ không có gì bắt.
  */
  await page.route(
    (url) => url.pathname === '/api/v1/programming/library-entry-source',
    async (route) => {
      const url = new URL(route.request().url())
      const entryId = url.searchParams.get('entryId')
      const entry = LIBRARY_CATALOG.find((item) => item.entryId === entryId)
      if (!entry) {
        return json(
          route,
          { error: { code: 'PRG-ERR-NOT-FOUND-001', messageKey: 'programming.error.notFound', retryable: false, keepsRunningRevision: true, correlationId: 'e2e-correlation-pgm04' } },
          404
        )
      }
      /* `AHU_STAGE` không lưu mã nguồn — `NOT_STORED` là một câu THẬT của máy
         chủ, không phải một lỗi. Khay phải nói ra nó và KHÔNG được dựng một
         khung ST "trông giống" từ `interface`. */
      const stored = entry.entryId !== 'AHU_STAGE'
      return json(route, {
        scope: entry.scope,
        libraryRevisionId: entry.libraryRevisionId,
        libraryVersion: entry.libraryVersion,
        libraryState: entry.libraryState,
        entryId: entry.entryId,
        name: entry.name,
        kind: entry.kind,
        language: 'ST',
        contentSha256: entry.contentSha256,
        availability: stored ? 'AVAILABLE' : 'NOT_STORED',
        ...(stored
          ? { source: `FUNCTION ${entry.name} : BOOL\nEND_FUNCTION\n` }
          : { reason: 'Thiết bị không lưu mã nguồn của phiên bản này' }),
      })
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

/* `T61-302` — hai phạm vi nay là hai TAB, và chúng KHÔNG trộn dữ liệu. Mỗi case
   phải nói nó đang đứng ở tab nào; một case không nói gì sẽ đọc danh sách của
   tab mặc định và khẳng định về khối của tab kia. */
const SYSTEM_ENTRY_COUNT = LIBRARY_CATALOG.filter((entry) => entry.scope === 'SYSTEM').length
const PROJECT_ENTRY_COUNT = LIBRARY_CATALOG.filter((entry) => entry.scope === 'PROJECT').length

async function switchScope(page: Page, scope: 'SYSTEM' | 'PROJECT') {
  await page.getByTestId(`library-scope-tab-${scope}`).click()
  await expect(page.getByTestId(`library-scope-tab-${scope}`)).toHaveAttribute('aria-selected', 'true')
}

/**
 * `T61-503` — mở PGM-04 **theo một vai cụ thể**.
 *
 * Vai đi vào phiên qua TÊN ĐĂNG NHẬP, không qua một cờ riêng của test: nhánh
 * mock của `AuthProvider` nay suy vai từ tên (`mockRoleOf`), nên `login(page,
 * { username: 'viewer' })` dựng đúng một phiên viewer bằng chính đường mà người
 * dùng đi. Một cờ riêng chỉ cho test sẽ dựng một trạng thái không ai đạt tới
 * được trong sản phẩm — và một case như thế xanh mà không chứng minh gì.
 */
async function openLibrary(
  page: Page,
  lane: LibraryLane,
  scope: 'SYSTEM' | 'PROJECT' = 'SYSTEM',
  role: Pgm04Role = 'admin',
) {
  const state: MockState = {
    etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED',
    commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false
  }
  await installProgrammingMocks(page, state)
  await installLibraryLaneRoutes(page, lane)
  await login(page, { username: role, password: role })
  await navigate(page, `${LIBRARY_PATH}?scope=${scope}`)
}

function libraryList(page: Page) {
  return page.getByRole('list', { name: 'Danh sách khối Thư viện điều khiển' })
}

/* `T61-303` — mỗi thẻ nay có HAI nút: mở thẻ, và ngôi sao Yêu thích. Đếm
   `getByRole('button')` trong lưới sẽ ra 2N và không còn nói được điều nó muốn
   nói ("có bao nhiêu khối"). Đếm THẺ. */
function libraryCards(page: Page) {
  return libraryList(page).getByTestId('library-block-card')
}

test.describe('PGM-04 Thư viện điều khiển (T61-503)', () => {
  test('D61-07: “chưa đo được” không được hiện thành “0 nơi dùng”', async ({ page }) => {
    const lane = libraryLane()
    const failures = observeBrowserFailures(page)
    await openLibrary(page, lane, 'PROJECT')

    const list = libraryList(page)
    /* `T61-204` — Inspector nay có bốn khay và mở mặc định ở Chi tiết. Khay
       Used-In phải được CHỌN mới hiện; đọc nó khi chưa chọn là đọc một vùng bị
       ẩn, và một assertion "không thấy số" sẽ xanh vì lý do sai. */
    const usageTab = page.getByRole('tab', { name: 'Nơi sử dụng' })
    const usage = page.getByRole('region', { name: 'Nơi sử dụng' })

    /* Vế đối chứng, và nó phải đứng TRƯỚC: khi máy chủ ĐO ĐƯỢC thì con số phải
       hiện. Thiếu vế này, một bề mặt không bao giờ in số nào cũng "đạt" case
       dưới — và đó là một cách khác để nói dối. */
    await list.getByRole('button', { name: /^AHU_STAGE/ }).click()
    await usageTab.click()
    await expect(usage.getByText('2 nơi dùng')).toBeVisible()
    await expect(usage.getByText('Điều khiển AHU')).toBeVisible()

    /* Vế thật: `UNAVAILABLE` nghĩa là CHƯA ĐO ĐƯỢC. In `0` ở đây là mời người
       ta xoá một khối có thể đang điều khiển tủ — hai câu dẫn tới hai hành
       động ngược nhau, nên bề mặt không được phép gộp chúng. */
    const usageResponse = page.waitForResponse(
      (response) => response.url().includes('/library-usages') && response.url().includes('entryId=LIMIT')
    )
    /* `T61-304` — ở khổ hẹp Inspector là khay PHỦ, nên phải đóng nó trước khi
       chạm lại vào danh sách phía sau. Đó là hành vi đúng của một hộp thoại, và
       cũng là thao tác người dùng thật phải làm. */
    if (await page.getByRole('dialog').count() > 0) await page.keyboard.press('Escape')
    // `LIMIT` là khối SYSTEM: nó nằm ở tab kia, và đó chính là điều tab bảo đảm.
    await switchScope(page, 'SYSTEM')
    await list.getByRole('button', { name: /^LIMIT/ }).click()
    await usageTab.click()
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
    await expect(libraryCards(page)).toHaveCount(SYSTEM_ENTRY_COUNT)

    /* `T61-302` — dưới 768 px bộ lọc thu vào MỘT nút (`SPEC-PGM04-VISUAL-001`
       §1). Nút chỉ hiện ở khổ hẹp, nên mở nó khi có và bỏ qua khi không — cùng
       một case đo được cả hai khổ. */
    const filterToggle = page.getByTestId('library-filter-toggle')
    if (await filterToggle.isVisible()) await filterToggle.click()

    const category = page.getByRole('combobox', { name: 'Phân loại' })
    await category.selectOption('timer')
    await expect(libraryCards(page)).toHaveCount(1)
    await expect(list.getByRole('button', { name: /^TON/ })).toBeVisible()
    /* Phép lọc phải đi TỚI MÁY CHỦ. Thư viện thật có phân trang; lọc trên trang
       đã tải sẽ đúng với bốn khối của mock và bỏ sót ở thư viện thật — một lỗi
       chỉ lộ ra khi catalog vượt `limit`. */
    expect(lane.libraryQueries.some((search) => search.includes('category=timer'))).toBe(true)

    // Mở khay Chi tiết rồi quay lại danh sách: bộ lọc và lựa chọn còn nguyên.
    // Chọn một khối mà làm bộ lọc bật lại "Tất cả" là ném người dùng về đầu
    // danh sách sau mỗi lần xem một khối.
    await list.getByRole('button', { name: /^TON/ }).click()
    // Soi trong KHAY chi tiết: từ `T61-303` mô tả cũng nằm trên thẻ, nên một
    // `getByText` toàn trang khớp hai chỗ và không còn nói được "chi tiết đang
    // mở đúng khối nào".
    /* `T61-302` — trang nay có hai dải tab, nên `getByRole('tabpanel')` trần
       khớp cả khay phạm vi lẫn khay chi tiết. Hỏi đúng khay đang soi. */
    await expect(page.getByRole('tabpanel', { name: 'Chi tiết' }).getByText('Bộ định thời trễ bật')).toBeVisible()
    await expect(category).toHaveValue('timer')
    await expect(libraryCards(page)).toHaveCount(1)
    await expect(list.getByRole('button', { name: /^TON/ })).toHaveAttribute('aria-current', 'true')

    // Gỡ bộ lọc trả lại đủ catalog — thu hẹp phải là thu hẹp, không phải mất.
    await category.selectOption('')
    await expect(libraryCards(page)).toHaveCount(SYSTEM_ENTRY_COUNT)

    expectNoBrowserFailures(failures, 'PGM-04 lọc phân loại')
  })

  test('D61-07: lỗi tải thư viện KHÔNG được hiện như một thư viện rỗng', async ({ page }) => {
    const lane = libraryLane()
    lane.failLibraries = true
    await openLibrary(page, lane)

    /* "Không có khối nào" và "không đọc được" dẫn tới hai hành động khác hẳn:
       một bên là đi tạo khối, một bên là đi xem vì sao máy chủ im. Trang nào
       trộn hai câu đó lại là trang đẩy người dùng đi sai đường. */
    /* 503 được xếp cùng nhánh "không với tới được" với mất mạng, nên câu chữ
       phải đúng cho CẢ HAI: không đổ cho mạng của người dùng khi thật ra thiết
       bị đang quá tải. Điều case này khoá vẫn là lỗi ĐỌC ≠ thư viện rỗng. */
    await expect(page.getByText(/Chưa đọc được Thư viện điều khiển/)).toBeVisible()
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
    await expect(libraryCards(page)).toHaveCount(SYSTEM_ENTRY_COUNT)
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

  /*
  `AC-PGM04-01` — chữ ký phải đọc được TRÊN THẺ, trước khi mở chi tiết.

  Đây là lý do tồn tại của cả màn hình: "tìm, hiểu và dùng lại khối mà không
  phải mở mã nguồn chỉ để biết giao diện khối". Một thẻ chỉ có tên bắt người
  dùng mở từng khối để biết khối nào nhận REAL — với vài chục khối, đó là vài
  chục lần mở.
  */
  test('AC-PGM04-01: chữ ký khối đọc được ngay trên thẻ', async ({ page }) => {
    const lane = libraryLane()
    await openLibrary(page, lane)

    const limit = libraryList(page).getByRole('button', { name: /^LIMIT/ })
    await expect(limit).toContainText('LIMIT(IN: REAL, MN: REAL, MX: REAL) → OUT: REAL')
    // Nhiều đầu ra được bọc ngoặc để không đọc nhầm thành một kiểu ghép.
    await expect(libraryList(page).getByRole('button', { name: /^TON/ }))
      .toContainText('TON(IN: BOOL, PT: TIME) → (Q: BOOL, ET: TIME)')
    /* Vắng chữ ký thì NÓI RA. Không tự parse `interface` để đoán hộ: hai nơi
       cùng đoán là hai nơi kết luận khác nhau về cùng một khối, và ở đây "bên
       nào đúng" quyết định người dùng nối dây vào chân nào. */
    await switchScope(page, 'PROJECT')
    await expect(libraryList(page).getByRole('button', { name: /^AHU_STAGE/ }))
      .toContainText('Chưa đọc được chữ ký')
    /* Chưa mở khay chi tiết nào: chữ ký phải có mặt TRƯỚC đó. Khay phạm vi thì
       luôn có (nó là danh sách đang đọc), nên phải hỏi ĐÍCH DANH khay chi tiết. */
    await expect(page.getByRole('tabpanel', { name: 'Chi tiết' })).toHaveCount(0)
  })

  /*
  `AC-PGM04-03` — form tạo khối mở THEO YÊU CẦU.

  Bản trước giữ một khung "Tạo khối PROJECT" luôn hiện với một câu hướng dẫn
  thay cho nội dung, nên một phần chiều cao khung phải luôn dành cho thứ người
  dùng không dùng tới — đúng phần chiều cao mà danh sách khối đang thiếu.
  */
  test('AC-PGM04-03: form tạo khối chỉ mở khi được gọi', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'khổ hẹp là read-only, có case riêng')
    const lane = libraryLane()
    await openLibrary(page, lane)
    await expect(libraryCards(page).first()).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Khối PROJECT mới' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Tên khối')).toBeVisible()
    // Hai trường metadata phải có mặt: cột `category`/`description` đã được ĐỌC
    // lên màn hình từ `T61-101`, nhưng tới `T61-401` mới có đường GHI.
    await expect(dialog.getByLabel('Phân loại')).toBeVisible()
    await expect(dialog.getByLabel('Mô tả ngắn')).toBeVisible()

    await dialog.getByRole('button', { name: 'Huỷ' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  /*
  `T61-401` / `ISS-PGM04-11` — đi TRỌN năm bước bằng BÀN PHÍM, trong trình duyệt
  thật.

  Test jsdom chứng minh từng luật; nó không chứng minh được rằng năm màn ấy đi
  hết được mà không có bẫy tiêu điểm nào giữ người dùng lại, và cũng không thấy
  được lần gọi mạng nào thật sự rời trình duyệt. Ở đây khoá cả hai:

   - mỗi lần đổi bước, tiêu điểm nằm ở tiêu đề của bước mới (nếu không, người
     dùng bàn phím vẫn đứng ở nút vừa bấm và không biết màn đã đổi);
   - bước Kiểm tra gọi ĐÚNG `POST .../library/entries/check`, và lần gọi đó
     KHÔNG mang `If-Match` — một lần bấm "Kiểm tra" không được tiêu ETag Draft;
   - đường ghi chỉ chạy khi phép kiểm sạch và tới từ bước cuối.
  */
  test('T61-401: wizard 5 bước đi hết bằng bàn phím, Kiểm tra là dry run và Lưu chỉ ghi bản nháp', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'khổ hẹp là read-only, có case riêng')
    const lane = libraryLane()
    const checkCalls: { ifMatch: string | null; body: Record<string, unknown> }[] = []
    const upsertCalls: Record<string, unknown>[] = []
    await openLibrary(page, lane, 'PROJECT')
    await page.route(
      (url) => url.pathname.endsWith('/library/entries/check'),
      async (route) => {
        checkCalls.push({
          ifMatch: route.request().headerValue ? await route.request().headerValue('if-match') : null,
          body: JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        })
        return json(route, { blocking: false, diagnostics: [], libraryVersion: '1.0.0' })
      }
    )
    await page.route(
      (url) => url.pathname.endsWith('/library/entries'),
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        upsertCalls.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
        return json(route, {
          resource: { libraryRevisionId: 'lib-draft-1' }, etag: '"draft-1:2"',
          auditId: 'audit-1', correlationId: 'e2e-correlation-pgm04'
        })
      }
    )
    await expect(libraryCards(page).first()).toBeVisible()

    await page.getByRole('button', { name: 'Khối PROJECT mới' }).click()
    const dialog = page.getByRole('dialog')
    const next = async (heading: string) => {
      await dialog.getByRole('button', { name: 'Tiếp' }).click()
      // Tiêu điểm phải ở TIÊU ĐỀ của bước mới, không phải ở nút vừa bấm.
      await expect(dialog.getByRole('heading', { name: heading })).toBeFocused()
    }

    await dialog.getByLabel('Tên khối').fill('E2E_RAMP')
    await dialog.getByLabel('Mô tả ngắn').fill('Khối dốc dựng trong e2e')
    await next('Giao diện')

    await dialog.getByLabel('Kiểu trả về').selectOption('REAL')
    await next('Hiện thực')

    await dialog.getByLabel(/Mã nguồn ST/).fill('FUNCTION E2E_RAMP : REAL\nEND_FUNCTION\n')
    await next('Kiểm tra')

    expect(upsertCalls).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Chạy kiểm tra trên máy chủ' }).click()
    await expect(dialog.getByTestId('library-wizard-check-result')).toBeVisible()
    expect(checkCalls).toHaveLength(1)
    expect(checkCalls[0].ifMatch).toBeFalsy()
    expect(checkCalls[0].body.name).toBe('E2E_RAMP')
    // Dry run: tới lúc này vẫn chưa có một lệnh ghi nào rời trình duyệt.
    expect(upsertCalls).toHaveLength(0)

    await next('Xem lại và lưu')
    await expect(dialog.getByTestId('library-wizard-changes')).toBeVisible()
    // Không có Publish rời: bước cuối chỉ ghi vào BẢN NHÁP.
    await expect(dialog.getByRole('button', { name: /Publish/i })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Lưu vào bản nháp thư viện' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].name).toBe('E2E_RAMP')
    expect(upsertCalls[0].description).toBe('Khối dốc dựng trong e2e')
  })

  /*
  `AC-PGM04-06` — Chèn độc lập đòi ngữ cảnh đích TƯỜNG MINH, và Thư viện không
  tự ghi vào bản nháp (handoff §4: "Do not silently create a POU or mutate
  draft").
  */
  test('AC-PGM04-06: Chèn hỏi POU đích và không ghi gì vào bản nháp', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'khổ hẹp là read-only, có case riêng')
    const lane = libraryLane()
    const writes: string[] = []
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/programming/'),
      async (route) => {
        if (route.request().method() !== 'GET') writes.push(route.request().method() + ' ' + new URL(route.request().url()).pathname)
        await route.fallback()
      }
    )
    await openLibrary(page, lane, 'PROJECT')

    /* `T61-406` — khối CÓ chữ ký. `AHU_STAGE` cố ý thiếu chữ ký, và thiếu chữ
       ký nay là một lý do chặn chèn: đo đường Chèn trên nó là đo trên đúng khối
       không chèn được. */
    await libraryList(page).getByRole('button', { name: /^AHU_RESET/ }).click()
    const insert = page.getByRole('button', { name: /Chèn vào POU/ })
    await expect(insert).toBeEnabled()
    await insert.click()

    // Bản nháp của lane này còn ở schema v1 nên chưa liệt kê được POU đích —
    // và màn hình phải nói ĐÚNG lý do đó, không nói "chưa có POU nào" (câu ấy
    // mời người dùng đi tạo lại đúng thứ họ đang có).
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/chưa ở schema v2/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Mở POU và chèn/ })).toBeDisabled()

    await dialog.getByRole('button', { name: 'Huỷ' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Zero mutation: không một lệnh ghi nào rời khỏi trang.
    expect(writes, 'PGM-04 phát ra lệnh ghi trong đường Chèn').toEqual([])
  })

  /*
  `SPEC-PGM04-VISUAL-001` §5 — lưới thẻ là MỘT điểm dừng tab, và mũi tên DI
  CHUYỂN chứ không MỞ. Một thư viện 200 khối mà mỗi thẻ là một điểm dừng thì
  phím Tab không còn đi tới được Inspector.
  */
  test('T61-306: lưới thẻ là một điểm dừng tab, mũi tên di chuyển không mở', async ({ page }) => {
    const lane = libraryLane()
    await openLibrary(page, lane)

    const cards = libraryCards(page)
    await expect(cards).toHaveCount(SYSTEM_ENTRY_COUNT)
    /* `T61-303` — số điểm dừng `Tab` của lưới là một HẰNG SỐ, không tỉ lệ với
       số thẻ. Thẻ nay có hai nút (mở thẻ + Yêu thích) và cả hai cùng nhận
       `tabIndex` luân phiên, nên hằng số là 2; điều bị cấm là 2N. Đúng MỘT
       trong hai là thẻ. */
    expect(await libraryList(page).locator('button[tabindex="0"]').count()).toBe(2)
    expect(await libraryList(page).locator('[data-testid="library-block-card"][tabindex="0"]').count()).toBe(1)

    await cards.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(cards.nth(1)).toBeFocused()
    // Di chuyển KHÔNG chọn: URL chưa mang khối nào, và chưa có khay nào mở.
    expect(new URL(page.url()).searchParams.get('entry')).toBeNull()

    await page.keyboard.press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('entry')).not.toBeNull()
  })

  /*
  `SPEC-PGM04-VISUAL-001` §1 — dưới 768 px PGM-02 đã là chỉ-đọc, nên PGM-04
  cũng không được hiện MỘT đường ghi nào bật được. Hai luật cho một thiết bị là
  cách một kỹ thuật viên sửa thư viện trên điện thoại giữa lúc đứng cạnh tủ.
  */
  test('PGM-04 khổ hẹp là chỉ-đọc: không một đường ghi nào bật được', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) >= PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'case này thuộc khổ hẹp')
    const lane = libraryLane()
    await openLibrary(page, lane, 'PROJECT')
    await libraryList(page).getByRole('button', { name: /^AHU_STAGE/ }).click()

    /* Nút vẫn THẤY và mang lý do — ẩn nó đi làm người dùng tưởng thiết bị
       không có khả năng đó rồi đi hỏi sai người. Điều bị cấm là nó bật được. */
    for (const label of [/Khối PROJECT mới/, /Chèn vào POU/, /^Sửa/, /^Xoá khối/]) {
      for (const control of await page.getByRole('button', { name: label }).all()) {
        await expect(control).toBeDisabled()
      }
    }
    await expect(page.getByText(/Màn hình dưới 768 px là chỉ đọc/)).toBeVisible()
    /* `T61-304` — điều bị cấm là hộp thoại SOẠN THẢO, không phải mọi hộp thoại:
       từ lát này Inspector ở khổ hẹp CHÍNH LÀ một hộp thoại toàn màn, đúng
       `SPEC-PGM04-VISUAL-001` §1. Khẳng định cũ (`dialog` = 0) nay đo nhầm
       thứ — nó sẽ cấm luôn cái bố cục mà spec đòi. */
    await expect(page.getByLabel('Tên khối')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: /Khối PROJECT mới|Sửa khối/ })).toHaveCount(0)
  })

  /*
  `T61-505` — SỐ ĐO ở bốn khổ của `SPEC-PGM04-VISUAL-001` §1, không phải cảm
  giác về bố cục.

  Điều được khoá là **không tràn ngang**: `scrollWidth` của tài liệu không được
  vượt bề rộng khung nhìn. Một thư viện có tên khối dài và chữ ký dài là đúng
  chỗ tràn ngang xuất hiện, và tràn ngang trên tủ đặt ở hành lang nghĩa là một
  nửa thẻ nằm ngoài màn hình mà không ai cuộn tới.
  */
  test('T61-505: PGM-04 không tràn ngang ở bốn khổ đã khoá', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'phép đo này tự đặt khung nhìn')
    const lane = libraryLane()
    const failures = observeBrowserFailures(page)
    /* Tab Hệ thống có BA khối; tab Dự án chỉ có một. Đếm cột trên một danh sách
       một phần tử là đo một thứ luôn bằng 1 — nó "đạt" ở mọi khổ và không nói
       được gì về bố cục. */
    await openLibrary(page, lane, 'SYSTEM')

    /* `T61-305` — mỗi khổ khoá BA số, không chỉ "không tràn ngang":
       số cột của lưới, hình thái Inspector, và bề rộng khay khi nó CẮM.
       `SPEC-PGM04-VISUAL-001` §1 khoá cả ba; đo mỗi một cái thì hai cái kia
       trôi tự do — và chúng đã trôi: lưới chuyển hai cột ở 640 px thay vì 768,
       còn khay cắm rộng 22rem ở mọi khổ thay vì 20rem tại 1024. */
    const sizes = [
      { label: '1440 — lưới 3 cột + inspector 22rem', width: 1440, height: 900, columns: 3, inspector: 'dock', dockWidth: 352 },
      { label: '1280 — lưới 3 cột + inspector 22rem', width: 1280, height: 800, columns: 3, inspector: 'dock', dockWidth: 352 },
      { label: '1024 — lưới 2 cột + inspector 20rem', width: 1024, height: 768, columns: 2, inspector: 'dock', dockWidth: 320 },
      { label: '768 — lưới 2 cột + khay phủ', width: 768, height: 1024, columns: 2, inspector: 'drawer', dockWidth: null },
      /* `700` là khổ QUYẾT ĐỊNH của lát này, không phải một điểm đo thêm cho
         đủ. Bốn khổ kia không phân biệt được ngưỡng `640` với `768`: ở 768 cả
         hai đều cho hai cột, ở 390 cả hai đều cho một. Chỉ trong dải 640–767
         mới lộ ra rằng lưới đang chuyển cột ở SAI ngưỡng — và đó đúng là dải
         mà bản trước hiện hai cột dưới ngưỡng chỉ-đọc. */
      { label: '700 — dưới ngưỡng chỉ-đọc, vẫn MỘT cột', width: 700, height: 900, columns: 1, inspector: 'fullscreen', dockWidth: null },
      { label: '390 — một cột + khay toàn màn', width: 390, height: 844, columns: 1, inspector: 'fullscreen', dockWidth: null }
    ] as const
    const measured: string[] = []
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await settleLayout(page)
      await expect(libraryCards(page).first()).toBeVisible()
      /* Chọn một khối để Inspector có nội dung: một khay rỗng không tràn được,
         nên đo lúc nó rỗng là đo một thứ không có rủi ro.

         `T61-304` — khối đang chọn nằm trong URL nên nó SỐNG SÓT qua mọi lần
         đổi khung nhìn; và từ `1023 px` trở xuống Inspector là một khay PHỦ,
         nên bấm lại vào danh sách phía sau nền mờ sẽ treo. Chỉ chọn khi chưa
         có gì được chọn. */
      if (await page.getByRole('dialog').count() === 0
          && await page.locator('[data-testid="library-block-card"][aria-current="true"]').count() === 0) {
        await libraryList(page).getByRole('button', { name: /^LIMIT/ }).click()
      }
      const metrics = await page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>('[data-testid="library-block-card"]')]
        /* Đếm cột bằng TOẠ ĐỘ THẬT, không bằng lớp CSS: một lớp Tailwind sai
           ngưỡng vẫn "có mặt" trong `className`, còn toạ độ thì không nói dối. */
        const top = cards.length ? cards[0].getBoundingClientRect().top : 0
        const columns = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - top) < 1).length
        const drawer = document.querySelector<HTMLElement>('[data-testid="library-inspector-drawer"]')
        const dock = document.querySelector<HTMLElement>('section h2')?.parentElement
        void dock
        const heading = [...document.querySelectorAll<HTMLElement>('h2')]
          .find((node) => node.textContent === 'Khối đang chọn')
        const dockPanel = heading?.closest('section') as HTMLElement | null
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          columns,
          inspector: drawer ? drawer.dataset.mode ?? 'drawer' : 'dock',
          dockWidth: drawer ? null : Math.round(dockPanel?.getBoundingClientRect().width ?? 0),
          /* Bề rộng THẬT của khay phủ. `data-mode` chỉ nói hook nghĩ gì; nó vẫn
             đúng khi lớp CSS vẽ ra một khay hẹp giữa màn hình toàn màn. */
          drawerWidth: drawer ? Math.round(drawer.getBoundingClientRect().width) : null,
          /* Bề rộng vùng DANH SÁCH. Ở hai hình thái phủ, khay không nằm trong
             dòng chảy, nên trang không được chừa cột thứ hai cho nó: chừa chỗ
             cho một thứ đang nổi lên trên là bóp danh sách còn 3/4 mà không đổi
             lấy gì. */
          listWidth: Math.round(
            (document.querySelector('[aria-label="Danh sách khối Thư viện điều khiển"]')
              ?.closest('section') as HTMLElement | null)?.getBoundingClientRect().width ?? 0,
          ),
        }
      })
      measured.push(
        `${size.label}: scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`
        + ` cột=${metrics.columns} inspector=${metrics.inspector} dockWidth=${metrics.dockWidth ?? '—'}`
        + ` drawerWidth=${metrics.drawerWidth ?? '—'} listWidth=${metrics.listWidth}`
      )
      expect(metrics.scrollWidth, `tràn ngang ở ${size.label}`).toBeLessThanOrEqual(metrics.clientWidth + 1)
      expect(metrics.columns, `số cột sai ở ${size.label}`).toBe(size.columns)
      expect(metrics.inspector, `hình thái Inspector sai ở ${size.label}`).toBe(size.inspector)
      if (size.inspector === 'fullscreen') {
        // TOÀN MÀN nghĩa là hết bề ngang khung nhìn, không phải "một khay hẹp
        // mà hook gọi là toàn màn".
        expect(metrics.drawerWidth, `khay toàn màn không phủ hết bề ngang ở ${size.label}`)
          .toBe(size.width)
      }
      if (size.inspector === 'drawer') {
        // Khay tablet: 22rem = 352 px, và phải HẸP HƠN khung nhìn — một khay
        // rộng bằng màn hình ở tablet là toàn màn đội lốt khay.
        expect(Math.abs((metrics.drawerWidth ?? 0) - 352), `bề rộng khay sai ở ${size.label}`)
          .toBeLessThanOrEqual(2)
        expect(metrics.drawerWidth ?? 0).toBeLessThan(size.width)
      }
      if (size.inspector !== 'dock') {
        /* Không chừa cột thứ hai cho khay phủ. Biên `160 px` chọn từ SỐ ĐO
           thật, không phải từ cảm giác: khung ứng dụng (điều hướng, lề trang)
           đã ăn khoảng 106 px ở khổ này, còn một cột `20rem` bị chừa ra sẽ
           cộng thêm 320 px nữa — `160` nằm gọn giữa hai con số ấy, nên nó phân
           biệt được đúng thứ cần phân biệt. */
        expect(size.width - metrics.listWidth,
          `trang chừa cột cho khay phủ ở ${size.label} (listWidth=${metrics.listWidth})`)
          .toBeLessThanOrEqual(160)
      }
      if (size.dockWidth !== null) {
        // Bề rộng khay cắm: cho phép ±2 px cho viền và bo góc, không hơn.
        expect(Math.abs((metrics.dockWidth ?? 0) - size.dockWidth),
          `bề rộng khay cắm sai ở ${size.label} (đo ${metrics.dockWidth})`).toBeLessThanOrEqual(2)
      }
    }
    /* In ra dòng số đo theo đúng thói quen của các lane khác trong tệp này:
       một attachment chỉ nằm trong thư mục kết quả, còn dòng log thì có mặt
       ngay trong bản ghi lần chạy mà người đọc hồ sơ nhìn thấy. */
    console.log(`[T61-505] PGM-04 layout: ${measured.join(' | ')}`)
    await testInfo.attach('pgm04-layout', { body: measured.join('\n'), contentType: 'text/plain' })
    expectNoBrowserFailures(failures, 'PGM-04 số đo bố cục')
  })

  /* ================================================================== *
   * `T61-503` / `ISS-PGM04-16` — MA TRẬN MOCK: bốn vai, lỗi trang-N,     *
   * mất quyền, và zero-mutation đo bằng PHƯƠNG THỨC HTTP.                *
   *                                                                      *
   * Lane này là **MOCK/HOST**: mọi route `/api/v1/programming/**` do      *
   * `installProgrammingMocks` + `installLibraryLaneRoutes` phục vụ, không *
   * có backend Go và không có thiết bị. Bằng chứng ở đây KHÔNG thay thế   *
   * lane real (`programming-real.spec.ts`, `T61-504`) và không được nâng  *
   * thành TARGET/HIL.                                                    *
   * ================================================================== */

  /* Neo chống-tautology, phải đứng riêng: nếu hợp đồng một ngày cho mọi vai
     ghi được thì mọi kỳ vọng dưới đây hoá `true` và ma trận vẫn "xanh" trong
     khi nó không còn kiểm gì. */
  test('T61-503: ma trận bốn vai suy từ hợp đồng và THẬT SỰ phân biệt được vai', async () => {
    assertMatrixDiscriminates()
    expect(PGM04_ROLE_MATRIX.map((row) => `${row.role}:${row.canWriteLibrary ? 'W' : 'R'}`))
      .toEqual(['viewer:R', 'operator:R', 'engineer:W', 'admin:W'])
    /* Và kỳ vọng ấy phải TRÙNG KHÍT với bảng vai của máy chủ. Viết tay bốn giá
       trị ở trên rồi cũng viết tay đúng bốn giá trị ấy trong ma trận là so một
       hằng với chính nó; vế dưới đây mới là vế đối chiếu thật. */
    expect(PGM04_ROLE_MATRIX.filter((row) => row.canWriteLibrary).map((row) => row.role).sort())
      .toEqual([...PROGRAMMING_ENDPOINTS.upsertProgrammingLibraryEntry.roles].sort())
  })

  for (const expectation of PGM04_ROLE_MATRIX) {
    /*
    Trước lát này KHÔNG có case nào ở vai khác `admin`, và lý do nằm trong sản
    phẩm chứ không trong bộ test: nhánh mock của `AuthProvider` dựng phiên
    `role: 'admin'` viết cứng, nên lane e2e không có đường nào tới một phiên
    viewer. `mockRoleOf` mở đường ấy, và đây là bốn case dùng nó.
    */
    test(`T61-503: vai ${expectation.role} — đọc được, và đường ghi đúng như hợp đồng`, async ({ page }, testInfo) => {
      test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
        'khổ hẹp khoá mọi vai thành chỉ-đọc; ma trận vai đo ở lane desktop')
      const lane = libraryLane()
      const failures = observeBrowserFailures(page)
      const writes = observeProgrammingWrites(page)
      await openLibrary(page, lane, 'PROJECT', expectation.role)

      // ĐỌC: mọi vai đều thấy danh sách. PGM-04 không có bí mật nào theo vai.
      await expect(libraryCards(page)).toHaveCount(PROJECT_ENTRY_COUNT)

      const create = page.getByRole('button', { name: 'Khối PROJECT mới' })
      /* Nút LUÔN hiện, kể cả khi khoá (`AC-PGM04-06`): ẩn nó đi làm người dùng
         tưởng thiết bị không có khả năng đó rồi đi hỏi sai người. */
      await expect(create).toBeVisible()

      await libraryList(page).getByRole('button', { name: /^AHU_STAGE/ }).click()
      const edit = page.getByRole('button', { name: /^Sửa/ })
      const remove = page.getByRole('button', { name: /^Xoá khối/ })

      if (expectation.canWriteLibrary) {
        await expect(create).toBeEnabled()
        await expect(edit).toBeEnabled()
      } else {
        await expect(create).toBeDisabled()
        await expect(edit).toBeDisabled()
        await expect(remove).toBeDisabled()
        /* Khoá mà KHÔNG nói lý do là tệ hơn ẩn: người dùng thấy một nút không
           bấm được và không có gì để đọc. */
        await expect(page.getByText(expectation.writeBlockReason!)).toBeVisible()
      }

      /* Chèn KHÔNG phải một quyền ghi: PGM-04 chỉ điều hướng
         (`AUTH-PROG-2026-08-29-PGM04-003`), nên nó mở cho mọi vai và cổng ghi
         thật nằm ở PGM-02. Khẳng định ra ở đây để "Chèn bật cho viewer" không
         bị đọc nhầm thành một lỗ hổng. Đo trên khối CÓ chữ ký: `AHU_STAGE`
         thiếu chữ ký nên nó bị chặn vì lý do khác, và một case đọc nhầm hai lý
         do sẽ "đạt" ở mọi vai. */
      await libraryList(page).getByRole('button', { name: /^AHU_RESET/ }).click()
      await expect(page.getByRole('button', { name: /Chèn vào POU/ })).toBeEnabled()

      /* Và bất kể vai nào, PHIÊN NÀY không phát một lệnh ghi nào: người dùng
         mới chỉ đọc và bấm vào các thẻ. */
      expect(writes, `vai ${expectation.role} phát lệnh ghi khi chỉ đang đọc`).toEqual([])
      expectNoBrowserFailures(failures, `PGM-04 vai ${expectation.role}`)
      await testInfo.attach(`pgm04-role-${expectation.role}`, {
        body: JSON.stringify({ lane: 'MOCK/HOST', ...expectation, writeBlockReason: String(expectation.writeBlockReason) }, null, 2),
        contentType: 'application/json',
      })
    })
  }

  /*
  `ISS-PGM04-16` — "Intercept toàn bộ method mutation để khẳng định zero
  mutation cho Preview/Used-In/Insert navigation/cancel/blocked."

  Case Chèn cũ đã đếm lệnh ghi, nhưng CHỈ trên đường Chèn. Preview (mã nguồn) và
  Used-In là hai bề mặt đọc mới của `T61-403`/`T61-404`, và chúng chưa từng bị
  đo — một `POST` lọt vào đường đọc sẽ không có gì bắt.

  Phép đo đọc `PROGRAMMING_ENDPOINTS` — bảng do hợp đồng sinh ra — chứ không một
  danh sách tên viết tay: `checkProgrammingLibraryEntry` là `POST` nhưng KHÔNG
  ghi gì (máy chủ khoá nó theo tên ở `security_matrix_test.go`), và mọi
  operation khác được phân loại theo đúng method của nó, kể cả operation chưa
  tồn tại lúc viết dòng này.
  */
  test('T61-503: Preview, Used-In và Chèn (cả huỷ lẫn bị chặn) phát 0 mutation', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
      'khổ hẹp khoá sẵn mọi đường ghi; case chỉ-đọc khổ hẹp đã có riêng')
    const lane = libraryLane()
    const failures = observeBrowserFailures(page)
    const writes = observeProgrammingWrites(page)
    await openLibrary(page, lane, 'PROJECT')

    await libraryList(page).getByRole('button', { name: /^AHU_STAGE/ }).click()

    /* 1) Preview mã nguồn (`T61-404`). `AHU_STAGE` không lưu mã nguồn, và khay
       phải NÓI RA điều đó thay vì dựng một khung ST "trông giống" từ
       `interface` — ghép ra một thứ chưa từng chạy trên thiết bị nào là cách
       một người đọc sai thứ đang điều khiển tủ. */
    await page.getByRole('tab', { name: 'Mã nguồn' }).click()
    await expect(page.getByTestId('library-source-unavailable'))
      .toHaveAttribute('data-availability', 'NOT_STORED')

    // 2) Used-In (`T61-403`).
    await page.getByRole('tab', { name: 'Nơi sử dụng' }).click()
    await expect(page.getByRole('region', { name: 'Nơi sử dụng' })).toBeVisible()

    // 3) Chèn → HUỶ, trên khối CÓ chữ ký (`AHU_STAGE` thiếu chữ ký nên bị chặn).
    await libraryList(page).getByRole('button', { name: /^AHU_RESET/ }).click()
    // Vế đối chứng của khay Mã nguồn: khối CÓ lưu mã nguồn thì phải hiện ra nó.
    // Thiếu vế này, một khay không bao giờ in gì cũng "đạt" ca NOT_STORED.
    await page.getByRole('tab', { name: 'Mã nguồn' }).click()
    await expect(page.getByTestId('library-source-viewer')).toHaveValue(/FUNCTION AHU_RESET/)
    await page.getByRole('tab', { name: 'Chi tiết' }).click()
    await page.getByRole('button', { name: /Chèn vào POU/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Huỷ' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // 4) Ca BỊ CHẶN: khối chờ review Controls/Safety, ở tab Hệ thống.
    await switchScope(page, 'SYSTEM')
    await libraryList(page).getByRole('button', { name: /^PID/ }).click()
    const blockedInsert = page.getByRole('button', { name: /Chèn vào POU/ })
    await expect(blockedInsert).toBeDisabled()
    await blockedInsert.click({ force: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const mutations = writes.filter((entry) => {
      const path = entry.split(' ')[1]
      // Đường kiểm (`.../entries/check`) là POST CHỈ-ĐỌC, khoá theo tên ở máy
      // chủ. Nó không xuất hiện trên đường đọc nào ở đây, nhưng loại nó ra một
      // cách tường minh vẫn đúng hơn là để phép đo phụ thuộc vào việc nó vắng.
      return !path.endsWith('/library/entries/check')
    })
    expect(mutations, 'PGM-04 phát lệnh ghi trên đường CHỈ ĐỌC').toEqual([])
    await testInfo.attach('pgm04-zero-mutation', {
      body: `lane=MOCK/HOST\nsurfaces=Preview,Used-In,Insert-cancel,Insert-blocked\nwrites=${JSON.stringify(writes)}`,
      contentType: 'text/plain',
    })
    expectNoBrowserFailures(failures, 'PGM-04 zero mutation')
  })

  /*
  `ISS-PGM04-16` — "Offline fixture biến lỗi thành empty thay vì giữ dữ liệu" là
  một trong ba lý do issue TỪ CHỐI đóng.

  Trang 1 về được; trang 2 hỏng. Điều bị cấm là danh sách đã tải **biến mất**:
  người dùng đang đọc ba khối, xin thêm, và mất luôn ba khối đang đọc — một cái
  giá không ai chọn để đổi lấy một thông báo lỗi.
  */
  test('T61-503: trang-N lỗi GIỮ NGUYÊN trang đã tải và thử lại được', async ({ page }) => {
    const lane = libraryLane()
    lane.pageSize = 2
    const failures = observeBrowserFailures(page)
    await openLibrary(page, lane, 'SYSTEM')

    await expect(libraryCards(page)).toHaveCount(2)
    const more = page.getByRole('button', { name: /Tải thêm khối/ })
    await expect(more).toBeVisible()

    lane.failNextPage = true
    await more.click()
    await expect(page.getByRole('alert')).toBeVisible()
    // Dữ liệu đã tải KHÔNG bị xoá.
    await expect(libraryCards(page)).toHaveCount(2)
    await expect(page.getByText('Không có khối nào khớp bộ lọc.')).toHaveCount(0)
    await expect(page.getByText(/Chưa đọc được Thư viện điều khiển/)).toHaveCount(0)

    // Và đường thử lại là đường THẬT: mở lại máy chủ rồi bấm, trang sau phải về.
    lane.failNextPage = false
    await page.getByRole('button', { name: /Tải thêm khối/ }).click()
    await expect(libraryCards(page)).toHaveCount(SYSTEM_ENTRY_COUNT)
    /* 503 của trang 2 là do CHÍNH case này bơm vào — nó là thứ đang được đo.
       Mọi lỗi console khác vẫn làm đỏ. */
    expectNoBrowserFailures(failures, 'PGM-04 phân trang lỗi trang-N', ['/programming/libraries'])
  })

  /* Hai câu "rỗng" khác nhau dẫn tới hai hành động khác nhau: một bên là bỏ bộ
     lọc, một bên là đi tạo khối. Trang nào gộp chúng lại là trang mời người ta
     tạo lại đúng thứ đang có sẵn trên thiết bị. */
  test('T61-503: "0 kết quả vì bộ lọc" KHÁC "thư viện chưa có khối nào"', async ({ page }) => {
    const lane = libraryLane()
    await openLibrary(page, lane, 'PROJECT')
    await expect(libraryCards(page)).toHaveCount(PROJECT_ENTRY_COUNT)

    await page.getByRole('searchbox').fill('KHONG_TON_TAI_KHOI_NAO')
    await expect(page.getByText('Không có khối nào khớp bộ lọc.')).toBeVisible()
    await expect(page.getByText('Thư viện của Project này chưa có khối nào.')).toHaveCount(0)
    /* Đúng MỘT hành động ở trạng thái RỖNG, và nó là đường QUAY LẠI. Thanh lọc
       phía trên cũng có một nút cùng tên, nên phải hỏi ĐÍCH DANH nút nằm trong
       khu danh sách — nếu không, phép kiểm đo nút của thanh lọc và không nói
       được gì về trạng thái rỗng. */
    const blocksSection = page.locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Danh sách khối' }) })
    await blocksSection.getByRole('button', { name: 'Xoá bộ lọc' }).click()
    await expect(libraryCards(page)).toHaveCount(PROJECT_ENTRY_COUNT)
  })

  /*
  Mất quyền GIỮA CHỪNG ≠ mất kết nối. 403 nói "phiên này không còn được đọc",
  503 nói "thiết bị chưa trả lời". Mời người ta bấm Thử lại cho một 403 là mời
  họ lặp lại một việc không bao giờ thành công.
  */
  test('T61-503: mất quyền giữa chừng nói đúng câu, không mượn câu của mất kết nối', async ({ page }) => {
    const lane = libraryLane()
    lane.forbidLibraries = true
    await openLibrary(page, lane, 'PROJECT')

    await expect(page.getByText(/Vai hiện tại không xem được Thư viện điều khiển/)).toBeVisible()
    await expect(page.getByText(/Chưa đọc được Thư viện điều khiển/)).toHaveCount(0)
    await expect(page.getByText('Thư viện của Project này chưa có khối nào.')).toHaveCount(0)
    await expect(libraryCards(page)).toHaveCount(0)
  })

  /*
  `ISS-PGM04-16` — "Có test skip nhưng summary gọi toàn suite PASS" là một trong
  ba lý do issue TỪ CHỐI đóng.

  Một `test.skip` có điều kiện KHÔNG sai: desktop và khổ hẹp là hai lane, và mỗi
  phép đo chỉ có nghĩa ở một trong hai. Cái sai là khi một lần bỏ qua **không có
  lane nào gánh nó** — lúc ấy tổng kết in "20 passed, 1 skipped" và không ai đọc
  được rằng phép kiểm ấy chưa từng chạy ở đâu cả.

  Case này đọc THẲNG tệp spec, gom mọi `test.skip` trong khối PGM-04, rồi đòi mỗi
  lý do phải có mặt trong sổ kế toán kèm tên lane gánh nó. Thêm một `test.skip`
  mới mà quên khai sẽ làm ĐỎ ngay tại đây — "bỏ qua rồi quên" không còn là một
  trạng thái im lặng được nữa.
  */
  test('T61-503: mọi lần bỏ qua của PGM-04 đều khai được lane nào gánh nó', async ({}, testInfo) => {
    const reasons = readPgm04SkipReasons()
    expect(reasons.length, 'khối PGM-04 không còn test.skip nào — sổ kế toán đã lỗi thời').toBeGreaterThan(0)

    const ledger = new Map(PGM04_SKIP_LEDGER.map((entry) => [entry.reason, entry]))
    const undeclared = [...new Set(reasons)].filter((reason) => !ledger.has(reason))
    expect(undeclared, 'test.skip chưa khai trong PGM04_SKIP_LEDGER').toEqual([])

    /* Và chiều ngược lại: một mục trong sổ mà không còn `test.skip` nào ứng với
       nó là một lời khai về một thứ không tồn tại — nó làm sổ đọc như thể phạm
       vi rộng hơn thực tế. */
    const orphaned = PGM04_SKIP_LEDGER.map((entry) => entry.reason)
      .filter((reason) => !reasons.includes(reason))
    expect(orphaned, 'mục trong sổ không còn test.skip nào ứng với nó').toEqual([])

    // Không mục nào được để trống lane gánh: đó chính là trạng thái bị cấm.
    for (const entry of PGM04_SKIP_LEDGER) {
      expect(entry.coveredBy, `"${entry.reason}" không khai lane gánh`).toBeTruthy()
      expect(entry.why.length, `"${entry.reason}" không nói vì sao lane kia bỏ qua`).toBeGreaterThan(20)
    }

    await testInfo.attach('pgm04-skip-ledger', {
      body: PGM04_SKIP_LEDGER
        .map((entry) => `${entry.coveredBy}\t${entry.reason}\n\t${entry.why}`)
        .join('\n'),
      contentType: 'text/plain',
    })
  })

  /*
  `T61-503` — FIXTURE `impact` phải phủ ĐỦ mọi nhóm mà sản phẩm vẽ ra.

  Đây là một lỗi đã xảy ra thật, không phải một giả thiết. `ISS-PIO-*` thêm bốn
  nhóm (`writableOutputsAffected` và ba nhóm ánh xạ Điểm) vào
  `ProgrammingImpactKey`; fixture của lane e2e không được cập nhật, nên trang
  đọc chúng thành `UNAVAILABLE` — hành vi ĐÚNG, vì "không thấy" không phải
  "không có" — và nút Đưa vào vận hành khoá vĩnh viễn. Journey `UJ-PROG-01..08`
  đỏ trên `main`, và không có gì trong bộ test nói được vì sao.

  Case này đọc `IMPACT_GROUP_ORDER` — danh sách mà CHÍNH TRANG dùng để vẽ — rồi
  đối chiếu với payload fixture thật, lấy qua đúng route mock. Nhóm thứ mười ba
  thêm vào ngày mai sẽ làm đỏ Ở ĐÂY, kèm tên nhóm còn thiếu, thay vì làm đỏ một
  journey dài với thông báo "nút không bấm được".
  */
  test('T61-503: fixture impact phủ đủ mọi nhóm mà trang Commission vẽ ra', async ({ page }) => {
    const state: MockState = {
      etagGeneration: 1, draft: draftWithProgram(), checkState: 'PASSED',
      commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false
    }
    await installProgrammingMocks(page, state)
    await login(page)

    /* Gọi THẲNG route mock rồi đọc payload: đối chiếu với một hằng viết tay
       trong test sẽ là so một bản sao với một bản sao khác. Payload lấy từ
       chính đường mà ứng dụng đi mới là vế đối chiếu thật. */
    const payloads = await page.evaluate(async (paths) => {
      const out: Record<string, string[]> = {}
      for (const path of paths) {
        const response = await fetch(path)
        const body = await response.json() as { impact?: Record<string, unknown> }
        out[path] = Object.keys(body.impact ?? {})
      }
      return out
    }, [
      `/api/v1/programming/revisions/${ACTIVE_REVISION_ID}/changes/revision-mock-0001`,
      `/api/v1/programming/revisions/none/changes/${ACTIVE_REVISION_ID}`,
    ])

    for (const [path, keys] of Object.entries(payloads)) {
      const missing = IMPACT_GROUP_ORDER.filter((key) => !keys.includes(key))
      expect(missing, `fixture impact thiếu nhóm ở ${path}`).toEqual([])
    }
    /* Và danh sách của trang phải KHÔNG RỖNG: nếu `IMPACT_GROUP_ORDER` một ngày
       rỗng thì `missing` cũng rỗng, và case này "đạt" mà không kiểm gì. */
    expect(IMPACT_GROUP_ORDER.length).toBeGreaterThanOrEqual(12)
  })

  test('T61-306: PGM-04 không có vi phạm axe nghiêm trọng', async ({ page }) => {
    const lane = libraryLane()
    await openLibrary(page, lane, 'PROJECT')

    // Quét khi khay Chi tiết ĐANG MỞ: đóng nó lại thì hơn nửa bề mặt của trang
    // (Used-In, lịch sử phiên bản, hai nút mutation) không có mặt trong lần quét.
    await libraryList(page).getByRole('button', { name: /^AHU_STAGE/ }).click()
    await page.getByRole('tab', { name: 'Nơi sử dụng' }).click()
    await expect(page.getByRole('region', { name: 'Nơi sử dụng' })).toBeVisible()

    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(severe, 'PGM-04: axe serious/critical').toEqual([])
  })
})

/**
 * `ISS-PGM03-05` — row, toolbar, validation và accessibility của tab Ánh xạ.
 *
 * Bốn phép đo dưới đây chỉ trình duyệt thật trả lời được, và cả bốn đều thuộc
 * loại "màn hình vẫn chạy nhưng người dùng đọc sai hoặc không thao tác nổi":
 * hàng toolbar xuống dòng ở khổ máy kỹ thuật, bộ lọc đang áp không gỡ được
 * bằng bàn phím, và trạng thái/hành động bị che khi phóng 200 %.
 */
test.describe('ISS-PGM03-05 — Ánh xạ: row, toolbar và a11y', () => {
  const MAPPING_VARIABLE_ID = '55555555-5555-4555-8555-555555555555'

  function mappingDraft() {
    const draft = initialDraft()
    draft.programs.push({
      objectId: POU_OBJECT_ID,
      programId: PROGRAM_ID,
      name: 'AHU_Main',
      kind: 'PROGRAM',
      language: 'ST',
      /* Tên biến dài cố ý: `AC` đòi chuỗi VI/EN dài KHÔNG che action/status.
         Một fixture toàn tên ngắn sẽ cho màn hình đẹp mà không chứng minh gì. */
      document: 'PROGRAM AHU_Main\nVAR_INPUT\n SupplyTemp : REAL;\nNhietDoGioCapSauDanNongTangHaiKhuVucPhiaDongToaNhaA : REAL;\nEND_VAR\nVAR_OUTPUT\n FanCmd : BOOL;\nEND_VAR\nEND_PROGRAM\n',
      executionOrder: 0,
      functionalTags: ['AHU'],
    })
    draft.variables.push({ variableId: MAPPING_VARIABLE_ID, programId: PROGRAM_ID, name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false })
    draft.bindings.push({ bindingId: 'binding-e2e-mapping', variableId: MAPPING_VARIABLE_ID, point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', writable: false, qualityPolicy: 'REQUIRE_GOOD' })
    draft.task.programOrder = [PROGRAM_ID]
    return draft
  }

  async function openMapping(page: Page) {
    const state: MockState = { etagGeneration: 1, draft: mappingDraft(), checkState: 'PASSED', commissionCount: 0, restoreCount: 0, retainResetCount: 0, traceCount: 0, traceRunning: false }
    await installProgrammingMocks(page, state)
    await login(page, { lang: 'vi' })
    await navigate(page, `/eng/programming/projects/${PROJECT_ID}/mapping`)
    await expect(page.getByRole('heading', { name: 'Biến chương trình' })).toBeVisible()
    return state
  }

  /* Tám control cùng cấp làm hàng lọc xuống dòng ở đúng khổ màn hình kỹ thuật
   * hay dùng nhất. Đo bằng `offsetTop` của từng control chứ không bằng ảnh: một
   * phép so ảnh sẽ đỏ vì lý do khác mỗi lần đổi font. */
  test('toolbar primary giữ đúng MỘT hàng ở 1280×800', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'phép đo dành cho khổ desktop')
    await page.setViewportSize({ width: 1280, height: 800 })
    await openMapping(page)

    const rows = await page.getByTestId('mapping-toolbar-primary').evaluate((node) => {
      const tops = Array.from(node.children).map((child) => Math.round((child as HTMLElement).offsetTop))
      return [...new Set(tops)].length
    })
    expect(rows, 'toolbar primary xuống dòng ở 1280×800').toBe(1)

    // Và bộ lọc nâng cao vẫn giữ đủ năng lực đã giao ở #395/#396.
    await page.getByRole('button', { name: /^Bộ lọc nâng cao/ }).click()
    await expect(page.getByRole('combobox', { name: 'Loại Point' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Quyền truy cập Point' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Trạng thái Point' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Chương trình' })).toBeVisible()
  })

  test('bộ lọc đang áp gỡ được chỉ bằng bàn phím', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'đo đường bàn phím một lần ở lane desktop')
    await page.setViewportSize({ width: 1280, height: 800 })
    await openMapping(page)

    const search = page.getByRole('searchbox', { name: 'Tìm biến hoặc Point' })
    // Tới ô tìm kiếm bằng Tab, không bằng chuột.
    for (let step = 0; step < 40 && !(await search.evaluate((node) => node === document.activeElement)); step += 1) {
      await page.keyboard.press('Tab')
    }
    expect(await search.evaluate((node) => node === document.activeElement), 'không Tab tới được ô tìm kiếm').toBe(true)
    await page.keyboard.type('FanCmd')

    const chip = page.getByRole('button', { name: 'Xóa bộ lọc Tìm kiếm: FanCmd' })
    await expect(chip).toBeVisible()
    for (let step = 0; step < 20 && !(await chip.evaluate((node) => node === document.activeElement)); step += 1) {
      await page.keyboard.press('Tab')
    }
    expect(await chip.evaluate((node) => node === document.activeElement), 'chip bộ lọc không nằm trong thứ tự Tab').toBe(true)
    await page.keyboard.press('Enter')

    await expect(page.getByRole('button', { name: 'Xóa bộ lọc Tìm kiếm: FanCmd' })).toHaveCount(0)
    await expect(search).toHaveValue('')
  })

  /* 200 % zoom ở 1280×800 tương đương khung CSS 640×400. Thứ phải chứng minh
   * không phải "trang vẫn vẽ" mà là trạng thái và hành động của hàng đang chọn
   * vẫn NHÌN THẤY được, và trang không tràn ngang. */
  test('200% zoom không che trạng thái lẫn hành động và không tràn ngang', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) < PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'đo zoom một lần ở lane desktop')
    await page.setViewportSize({ width: 640, height: 400 })
    await openMapping(page)

    await page.getByRole('button', { name: /^AHU_Main · FanCmd ·/ }).click()
    await expect(page.getByTestId('mapping-variable-list').getByText('Chưa map').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mở nguồn' })).toBeVisible()

    // Và với biến mang tên rất dài: trạng thái lẫn hành động vẫn không bị che.
    await page.getByRole('button', { name: /^AHU_Main · NhietDoGioCap/ }).click()
    const longRow = page.getByTestId('mapping-variable-list')
    await expect(longRow.getByText('Chưa map').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mở nguồn' })).toBeVisible()
    const listOverflow = await longRow.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(listOverflow, 'tên biến dài đẩy danh sách tràn ngang').toBeLessThanOrEqual(1)

    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    expect(width.document, '200% zoom: document tràn ngang').toBeLessThanOrEqual(width.viewport + 1)
    expect(width.body, '200% zoom: body tràn ngang').toBeLessThanOrEqual(width.viewport + 1)

    const axe = await new AxeBuilder({ page }).analyze()
    const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(severe, '200% zoom: axe serious/critical').toEqual([])
  })

  test('tab Ánh xạ không có vi phạm axe nghiêm trọng', async ({ page }) => {
    const failures = observeBrowserFailures(page)
    await openMapping(page)

    const axe = await new AxeBuilder({ page }).analyze()
    const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(severe, 'Ánh xạ: axe serious/critical').toEqual([])

    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }))
    expect(width.document, 'Ánh xạ: document tràn ngang').toBeLessThanOrEqual(width.viewport + 1)
    expectNoBrowserFailures(failures, 'ISS-PGM03-05')
  })

  /* `AC-PGM03-02` — mobile giữ policy read-only, nhưng "Mở nguồn" KHÔNG phải
   * mutation: cắt nó đi là cắt luôn đường đọc mã của người đang trực. */
  test('mobile read-only: không control mutation nhưng vẫn mở được nguồn', async ({ page }, testInfo) => {
    test.skip((testInfo.project.use.viewport?.width ?? 1280) >= PROGRAMMING_AUTHORING_MIN_WIDTH_PX, 'phép đo dành cho lane mobile')
    await openMapping(page)

    await expect(page.getByRole('button', { name: /^Ánh xạ / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Đổi ánh xạ / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Gỡ/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mở nguồn' })).toHaveCount(1)
  })
})
