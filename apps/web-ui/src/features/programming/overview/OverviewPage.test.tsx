import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { OverviewPage } from './OverviewPage'
import { RuntimeServicePage } from '../runtime/RuntimeServicePage'
import { ProgrammingLayout } from '../layout/ProgrammingLayout'

/**
 * TUYẾN PHÒNG THỦ CHỐNG HỒI QUY CỦA PGM-01 (`R60-02`).
 *
 * `T60-207` viết lại `OverviewPage` từ năm panel tự vẽ thành tầng ráp sáu khối
 * của handoff v2.1. Mọi khẳng định đã có trong file này **được giữ nguyên**;
 * chỗ nào bố cục đổi thì đổi selector và ghi rõ lý do ngay tại case, không xoá
 * case nào. Ba nhóm khẳng định phải sống sót:
 *
 * - `BUG-016`/`BUG-018` và phân biệt `safeStateNoControllerOnly` — ba case đầu
 *   chạy **nguyên văn**, không sửa một ký tự, vì `NeedsAttentionCard`
 *   (`T60-204`) cố ý giữ đúng các chuỗi mà chúng khẳng định.
 * - Bốn nhánh Check của `WP-01` — nay không còn `DraftAttentionPanel`; chúng
 *   sống ở **cột Draft của `DraftActiveCompareCard`** (nhãn trạng thái) và ở
 *   **CTA chính** (`resolvePrimaryCta`). Xem ghi chú trong từng case.
 * - Tách ý định Enable khỏi runtime thực tế — xem ghi chú ở chính case đó.
 */

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'admin', role: auth.role, loginAt: '2026-08-14T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const ACTIVE_ID = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'
const LKG_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
/** Revision nền của Draft — cố ý KHÁC `ACTIVE_ID` để có gì đó mà so sánh. */
const BASE_ID = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb'
const OBJECT_1 = 'cccccccc-3333-4ccc-8ccc-cccccccccccc'
const OBJECT_2 = 'dddddddd-4444-4ddd-8ddd-dddddddddddd'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => client }))

function stubDefaultEndpoints(overrides: Record<string, () => Promise<unknown>> = {}) {
  client.request.mockImplementation((operationId: string) => {
    if (overrides[operationId]) return overrides[operationId]()
    if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
    if (operationId === 'getProgrammingRuntime') {
      return Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: true,
        observedAt: '2026-08-14T00:00:00Z',
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 1, missedReleaseCount: 0, lastExecNs: 1, maxExecNs: 1, overrunCount: 0, consecutiveOverruns: 0 }
      })
    }
    if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: ACTIVE_ID }] })
    if (operationId === 'listProgrammingProgramIntents') {
      return Promise.resolve({ items: [
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', updatedBy: 'admin', updatedAtUtcMs: 1 },
        { programId: 'program-2', desiredEnabled: false, generation: 2, runtimeState: 'DISABLED', updatedBy: 'admin', updatedAtUtcMs: 2 }
      ] })
    }
    if (operationId === 'listProgrammingAudit') return Promise.resolve({ items: [] })
    if (operationId === 'getProgrammingRuntimeMonitor') return Promise.reject(new Error('503 unavailable'))
    if (operationId === 'listProgrammingOperations') return Promise.resolve({ items: [] })
    return Promise.reject(new Error(`unexpected operation ${operationId}`))
  })
}

/**
 * Đích điều hướng hiện tại, kể cả khi route đó chưa được khai trong cây test.
 * Đặt NGOÀI `<Routes>` để một deep-link sang PGM-02/PGM-05 vẫn kiểm được mà
 * không phải dựng cả hai trang đó chỉ để đọc một đường dẫn.
 */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="probe-path">{`${location.pathname}${location.search}`}</div>
}

function renderOverview(initialLang: 'vi' | 'en' = 'en') {
  localStorage.setItem('mkddc-lang', initialLang)
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming']}>
        <LocationProbe />
        <Routes>
          <Route element={<ProgrammingLayout />}>
            <Route path="/eng/programming" element={<OverviewPage />} />
            <Route path="/eng/programming/runtime" element={<RuntimeServicePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

/* ------------------------------------------------------------------ *
 * Fixture dùng chung cho các case ráp trang                           *
 * ------------------------------------------------------------------ */

/**
 * Item `GET /projects` **đầy đủ theo hợp đồng sau `T60-015`**: `dirty`,
 * `draftSequence`, `activeSequence` và `baseRevisionId` server LUÔN gửi.
 *
 * Fixture cũ của file này chỉ có ba khoá (`projectId`/`name`/`draftRevisionId`)
 * vì `DraftAttentionPanel` ngày đó chỉ đọc `latestCheck`. Trang mới đọc đúng
 * hợp đồng hiện hành, nên một fixture thiếu `dirty` sẽ ra `dirty = null` —
 * và `null` là "máy chủ chưa xác định được", đúng nghĩa fail-closed, chứ không
 * phải nhánh Check mà bốn case `WP-01` muốn kiểm. Vì vậy fixture được bổ sung
 * cho khớp hợp đồng; nhánh `dirty = null` có case riêng bên dưới.
 */
function projectItem(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    name: 'AHU-01',
    etag: 'etag-1',
    activeRevisionId: ACTIVE_ID,
    draftRevisionId: BASE_ID,
    baseRevisionId: BASE_ID,
    updatedAt: '2026-08-23T00:00:00Z',
    dirty: false,
    draftSequence: 14,
    activeSequence: 12,
    latestCheck: null,
    ...overrides
  }
}

/** Hai Program KHAI BÁO trong gói đang vận hành (`T60-017`). */
function activeRevisionBody() {
  return {
    revisionId: ACTIVE_ID,
    snapshot: {
      objects: [
        { objectId: OBJECT_1, kind: 'PROGRAM', payload: { objectId: OBJECT_1, name: 'AHU_Control', language: 'ST', programConfig: { programId: 'program-1', periodMs: 1000 } } },
        { objectId: OBJECT_2, kind: 'PROGRAM', payload: { objectId: OBJECT_2, name: 'VAV_Zone', language: 'FBD', programConfig: { programId: 'program-2', periodMs: 5000 } } }
      ]
    }
  }
}

/** Trang `GET /projects/{id}/programs` ở mức `CORE_LIVE`. */
function liveProgramsPage(items: Array<Record<string, unknown>>) {
  return {
    schemaVersion: '1.0',
    projectId: 'project-1',
    runtimeStateSource: 'CORE_LIVE',
    observedAt: '2026-08-23T10:00:00Z',
    programsTruncated: false,
    items
  }
}

beforeEach(() => {
  auth.role = 'admin'
  client.request.mockReset()
  sessionStorage.clear()
})
afterEach(cleanup)

describe('OverviewPage — Việc cần chú ý (TR-MKDDC24-P2-20260814-02)', () => {
  it('PGM-01 tách ý định Enable khỏi trạng thái runtime thực tế', async () => {
    stubDefaultEndpoints({
      listProgrammingProgramIntents: () => Promise.resolve({ items: [
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'FAULTED', updatedBy: 'admin', updatedAtUtcMs: 1 },
        { programId: 'program-2', desiredEnabled: false, generation: 2, runtimeState: 'RUNNING', updatedBy: 'admin', updatedAtUtcMs: 2 }
      ] })
    })
    renderOverview('vi')
    expect(await screen.findAllByText('1/2 muốn bật')).not.toHaveLength(0)
    /* SELECTOR ĐỔI VÌ BỐ CỤC ĐỔI (`T60-207`), khẳng định giữ nguyên.
     *
     * Trước đây con số tổng hợp này xuất hiện HAI lần: một ở
     * `ProgrammingContextStrip` (tầng layout) và một ở panel "Ứng dụng đang vận
     * hành" mà `OverviewPage` tự vẽ. Handoff v2.1 §1 chốt sáu khối cho PGM-01
     * và KHÔNG có khối tổng hợp thứ hai — bảng Programs nói trạng thái theo
     * TỪNG Program, còn con số gộp là việc của context strip. Nhân đôi cùng một
     * con số ở hai chỗ chỉ tạo thêm một nguồn có thể trôi lệch.
     *
     * Khẳng định gốc — "ý định Enable là một dữ kiện, runtime thực tế là dữ kiện
     * KHÁC" — vẫn nguyên vẹn: hai nhãn vẫn cùng hiện và vẫn nói hai điều khác
     * nhau (`1/2 muốn bật` ≠ `FAULTED 1 · +1`). Case ngay dưới khoá lại
     * cùng khẳng định đó ở mức từng Program, chặt hơn mức gộp.
     *
     * `DEV-PROG-014` rút gọn nhãn gộp còn trạng thái NẶNG NHẤT kèm `+N`; bản
     * đầy đủ nằm ở `title`. */
    expect(screen.getAllByText('FAULTED 1 · +1')).toHaveLength(1)
    expect(screen.getAllByTitle('FAULTED 1 · RUNNING 1')).toHaveLength(1)
  })

  it('T60-207: ý định Enable và runtime thực tế tách nhau ở MỨC TỪNG Program trong bảng', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([
        // Muốn bật nhưng đang LỖI.
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'FAULTED', runtimeStateSource: 'CORE_LIVE', periodMs: 1000, health: 'FAULT', lastRunAtUtc: '2026-08-23T10:00:00Z', lastRunAgeMs: 400, updatedBy: 'admin', updatedAtUtcMs: 1 },
        // Không muốn bật nhưng vẫn ĐANG CHẠY.
        { programId: 'program-2', desiredEnabled: false, generation: 2, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE', periodMs: 5000, health: 'HEALTHY', lastRunAtUtc: '2026-08-23T10:00:01Z', lastRunAgeMs: 100, updatedBy: 'admin', updatedAtUtcMs: 2 }
      ]))
    })
    renderOverview('vi')

    const table = within(await screen.findByTestId('programs-desktop'))
    // Cột `State` là ô thứ TƯ của D-02 (`Program | Language | Cycle | State |
    // Last Exec | Health`); đọc theo ô để không lẫn với cột `Health` vốn cũng
    // có thể mang chữ "Lỗi".
    const faulted = within(table.getByRole('row', { name: /AHU_Control/ })).getAllByRole('cell')
    expect(faulted[3]).toHaveTextContent('Lỗi')
    const running = within(table.getByRole('row', { name: /VAV_Zone/ })).getAllByRole('cell')
    expect(running[3]).toHaveTextContent('Đang chạy')
    // Ý định gộp vẫn nói `1/2 muốn bật` — con số đó KHÔNG được dùng để suy ra
    // Program nào đang chạy.
    expect(screen.getAllByText('1/2 muốn bật').length).toBeGreaterThan(0)
  })

  it('BUG-018: phạm vi PRG-SAFE-ACTIVE không rò tiếng Việt cứng khi ở chế độ EN', async () => {
    stubDefaultEndpoints()
    renderOverview('en')
    await screen.findByText(/PRG-SAFE-ACTIVE/)
    expect(screen.getByText(/Control_Main \/ Program-controlled outputs/)).toBeInTheDocument()
    expect(screen.queryByText(/outputs do Program điều khiển/)).not.toBeInTheDocument()
  })

  it('BUG-016: mục "Việc cần chú ý" bấm được và điều hướng sang tab Runtime', async () => {
    stubDefaultEndpoints()
    renderOverview('vi')
    const item = await screen.findByRole('button', { name: /PRG-SAFE-ACTIVE/ })
    fireEvent.click(item)
    await screen.findByText('Đang vận hành / LKG')
    expect(screen.getAllByText(ACTIVE_ID).length).toBeGreaterThan(0)
  })

  it('safeState=true chỉ do chưa ai điều khiển (safeStateNoControllerOnly) hiện mức cảnh báo nhẹ, không nói bị khóa', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: true,
        observedAt: '2026-08-14T00:00:00Z',
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 1, missedReleaseCount: 0, lastExecNs: 1, maxExecNs: 1, overrunCount: 0, consecutiveOverruns: 0 }
      })
    })
    renderOverview('vi')
    const item = await screen.findByRole('button', { name: /PRG-SAFE-ACTIVE/ })
    expect(item).toHaveTextContent(/chưa Program nào ghi output vật lý/)
    expect(item).toHaveTextContent(/Không chặn Đưa vào vận hành\/Khôi phục/)
    expect(item).not.toHaveTextContent(/Giữ Commission\/Restore bị khóa/)
  })
})

/* WP-01 (Overview state model, D-01, REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15
 * §5.2, quyết định CTO/Owner 2026-08-15): DraftAttentionPanel trước đây chỉ
 * có 2 nhánh (no-draft/dirty) — không phân biệt được Check đang chạy/vừa
 * lỗi/vừa đạt.
 *
 * `T60-207` GỠ `DraftAttentionPanel`; bốn nhánh đó nay nằm ở hai chỗ, và cả hai
 * đều là khối đã có test riêng:
 *
 * - **Nhãn trạng thái Draft** trong `DraftActiveCompareCard` (`T60-203`) —
 *   `Chưa Kiểm tra lần nào` / `Đang Kiểm tra` / `Kiểm tra không đạt` /
 *   `Kiểm tra đạt`.
 * - **CTA chính** do `resolvePrimaryCta` (`T60-201`) quyết định — đúng bảng năm
 *   trạng thái của handoff §3.
 *
 * Bốn case dưới đây giữ nguyên tên và nguyên khẳng định, chỉ đổi selector sang
 * hai bề mặt mới. */
describe('OverviewPage — bốn nhánh Check của WP-01 sau khi ráp trang (T60-207)', () => {
  function stubProjectWithCheck(latestCheck: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({ latestCheck, ...overrides })] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      compareProgrammingRevisions: () => Promise.resolve({ schemaVersion: '1.0', changes: [] }),
      /* `safeState: false` là CÓ CHỦ ĐÍCH. Stub mặc định của file này để
       * `safeState: true` (không kèm `safeStateNoControllerOnly`) cho ba case
       * `PRG-SAFE-ACTIVE` phía trên — nghĩa là safe-state DO LỖI THẬT, và luật
       * đã chốt là giữ Commission/Restore khoá trong tình huống đó. Để nguyên
       * nó ở đây sẽ biến safe-state thành biến ẩn chi phối bốn nhánh Check.
       * Nhánh "lỗi thật khoá cả CTA chính" có case riêng ngay dưới. */
      getProgrammingRuntime: () => Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: false,
        observedAt: '2026-08-14T00:00:00Z',
        task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 1, missedReleaseCount: 0, lastExecNs: 1, maxExecNs: 1, overrunCount: 0, consecutiveOverruns: 0 }
      })
    })
  }

  /** Cột Draft của thẻ so sánh — chỗ nhãn bốn nhánh Check sinh sống. */
  function draftColumn() {
    return within(screen.getByTestId('draft-active-compare-draft'))
  }

  it('dirty: chưa Check lần nào — chỉ có "Tiếp tục chỉnh sửa"', async () => {
    stubProjectWithCheck(null)
    renderOverview('vi')
    // Nhãn cũ: "Đang chỉnh sửa — chưa Kiểm tra lần nào cho bản này."
    expect(await screen.findByTestId('draft-active-compare-draft')).toBeInTheDocument()
    expect(draftColumn().getByText('Chưa Kiểm tra lần nào')).toBeInTheDocument()
    const cta = screen.getByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-cta-kind', 'CONTINUE_EDITING')
    expect(cta).toHaveTextContent('Tiếp tục chỉnh sửa')
    // Nút cũ "Xem lỗi" nay là CTA `Sửa lỗi Kiểm tra`; không nhánh nào được đề
    // xuất nó khi chưa từng Check.
    expect(screen.queryByRole('button', { name: 'Sửa lỗi Kiểm tra' })).not.toBeInTheDocument()
  })

  it('checking: Check đang QUEUED/RUNNING — hiện đang xử lý, không giả thành trạng thái sửa bình thường', async () => {
    stubProjectWithCheck({ checkId: 'check-1', revisionId: BASE_ID, state: 'RUNNING', createdAt: '2026-08-15T00:00:00Z' })
    renderOverview('vi')
    expect(await screen.findByTestId('draft-active-compare-draft')).toBeInTheDocument()
    expect(draftColumn().getByText('Đang Kiểm tra')).toBeInTheDocument()
    /* Khẳng định gốc: không được rơi về "Tiếp tục chỉnh sửa" như thể đây là một
     * phiên sửa bình thường. Nay mạnh hơn — trong lúc Check chạy, trang KHÔNG đề
     * xuất hành động chính nào cả và nói rõ vì sao. */
    expect(screen.queryByTestId('primary-cta')).not.toBeInTheDocument()
    expect(screen.getByTestId('primary-cta-undecided')).toHaveTextContent('Đang Kiểm tra — chờ kết quả')
  })

  it('failed: Check FAILED — primary action "Xem lỗi", vẫn giữ lối "Tiếp tục chỉnh sửa"', async () => {
    stubProjectWithCheck({ checkId: 'check-1', revisionId: BASE_ID, state: 'FAILED', createdAt: '2026-08-15T00:00:00Z', completedAt: '2026-08-15T00:01:00Z' })
    renderOverview('vi')
    expect(await screen.findByTestId('draft-active-compare-draft')).toBeInTheDocument()
    expect(draftColumn().getByText('Kiểm tra không đạt')).toBeInTheDocument()
    const cta = screen.getByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-cta-kind', 'FIX_CHECK_ERRORS')
    expect(cta).toHaveTextContent('Sửa lỗi Kiểm tra')
    // Lối "Tiếp tục chỉnh sửa" vẫn còn — nay là lối tắt trong `QuickActions`,
    // và nó KHÔNG bị chặn.
    const edit = within(screen.getByTestId('quick-actions')).getByRole('button', { name: /Tiếp tục chỉnh sửa/ })
    expect(edit).not.toHaveAttribute('data-blocked-by')
    expect(edit).not.toHaveAttribute('aria-disabled')
    // Việc "Kiểm tra không đạt" cũng phải nổi lên danh sách cần chú ý.
    expect(screen.getByText(/PRG-CHECK-FAILED/)).toBeInTheDocument()
  })

  it('ready: Check PASSED — primary action mở Kiểm tra & Đưa vào vận hành', async () => {
    stubProjectWithCheck({ checkId: 'check-1', revisionId: BASE_ID, state: 'PASSED', createdAt: '2026-08-15T00:00:00Z', completedAt: '2026-08-15T00:01:00Z' })
    renderOverview('vi')
    expect(await screen.findByTestId('draft-active-compare-draft')).toBeInTheDocument()
    expect(draftColumn().getByText('Kiểm tra đạt')).toBeInTheDocument()
    /* Đích không đổi (PGM-05 = Kiểm tra & Đưa vào vận hành); câu chữ đổi theo
     * bảng §3 handoff: đã có Active để đối chiếu ⇒ hàng 3 `Review Changes`. */
    const cta = screen.getByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-cta-kind', 'REVIEW_CHANGES')
    fireEvent.click(cta)
    expect(screen.getByTestId('probe-path')).toHaveTextContent('/eng/programming/projects/project-1/commission')
  })

  it('safe-state do lỗi THẬT giữ CTA chính bị khoá kèm lý do (không mở đường Commission)', async () => {
    // Stub mặc định: `safeState: true` mà KHÔNG có `safeStateNoControllerOnly`
    // ⇒ safe-state do lỗi thật. Luật của `PRG-SAFE-ACTIVE` là giữ Commission/
    // Restore khoá cho tới khi người vận hành kiểm tra Core, I/O và alarm — và
    // luật đó phải áp cho CTA chính y hệt như cho lối tắt, nếu không thì cái
    // nút to nhất màn hình lại là cái duy nhất lách được.
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({
        latestCheck: { checkId: 'check-1', revisionId: BASE_ID, state: 'PASSED', createdAt: '2026-08-15T00:00:00Z' }
      })] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      compareProgrammingRevisions: () => Promise.resolve({ schemaVersion: '1.0', changes: [] })
    })
    renderOverview('vi')
    const cta = await screen.findByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-blocked-by', 'SAFE_STATE_FAULT')
    expect(cta).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(cta)
    expect(screen.getByTestId('probe-path')).toHaveTextContent('/eng/programming')
    expect(screen.getByTestId('probe-path')).not.toHaveTextContent('commission')
    expect(screen.getAllByText(/Safe-state đang tác động do lỗi thật/).length).toBeGreaterThan(0)
  })

  it('T60-201 hàng 4: chưa có Active nào ⇒ CTA chính là Đưa vào vận hành', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({
        activeRevisionId: null,
        activeSequence: null,
        latestCheck: { checkId: 'check-1', revisionId: BASE_ID, state: 'PASSED', createdAt: '2026-08-15T00:00:00Z' }
      })] }),
      getProgrammingRuntime: () => Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        activeRevisionId: null, lkgRevisionId: null, taskState: 'STOPPED', safeState: false,
        observedAt: '2026-08-14T00:00:00Z'
      })
    })
    renderOverview('vi')
    const cta = await screen.findByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-cta-kind', 'COMMISSION')
    expect(cta).toHaveTextContent('Đưa vào vận hành')
  })

  it('dirty = null (máy chủ chưa xác định) KHÔNG được hiểu thành "sạch" — không đề xuất hành động nào', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({ dirty: null })] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody())
    })
    renderOverview('vi')
    expect(await screen.findByTestId('primary-cta-undecided')).toHaveTextContent(
      'Máy chủ chưa xác định được bản nháp còn việc chưa phát hành hay không.'
    )
    expect(screen.queryByTestId('primary-cta')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('draft-active-compare-draft')).getByText('Chưa rõ')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * Ma trận sáu trạng thái của handoff §6 — `T60-207`                   *
 * ------------------------------------------------------------------ */

describe('OverviewPage — ma trận sáu trạng thái (handoff §6, T60-207)', () => {
  it('§6-1 loading: khung chờ KHỚP HÌNH HỌC thẻ/bảng, không phải một dòng "đang tải"', () => {
    // Mọi endpoint treo: đây đúng là lần đọc đầu tiên của trang.
    client.request.mockImplementation(() => new Promise(() => {}))
    const { container } = renderOverview('en')

    // Thẻ System Health tự vẽ khung chờ của nó (`T60-202`).
    expect(screen.getByTestId('system-health-hero-skeleton')).toBeInTheDocument()
    // Hai thẻ còn lại + CTA + bảng sáu cột.
    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByTestId('primary-cta-skeleton')).toBeInTheDocument()
    expect(screen.getByTestId('programs-table-skeleton')).toBeInTheDocument()
    // Chưa có bảng thật, và tuyệt đối chưa có con số nào.
    expect(screen.queryByTestId('programs-desktop')).not.toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/\b0\b/)
  })

  it('§6-2 chưa có Project: giải thích kèm lối tạo cho admin', async () => {
    stubDefaultEndpoints({ listProgrammingProjects: () => Promise.resolve({ items: [] }) })
    renderOverview('vi')
    expect(await screen.findByTestId('no-project')).toHaveTextContent('Controller này chưa có Project nào')
    expect(screen.getByRole('button', { name: /Tạo bản nháp/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên Project')).toBeInTheDocument()
  })

  it('§6-2 chưa có Project: viewer thấy lời giải thích nhưng KHÔNG thấy lối tạo', async () => {
    auth.role = 'viewer'
    stubDefaultEndpoints({ listProgrammingProjects: () => Promise.resolve({ items: [] }) })
    renderOverview('vi')
    expect(await screen.findByTestId('no-project')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tạo bản nháp/ })).not.toBeInTheDocument()
    expect(screen.getByText(/không có quyền tạo Project/)).toBeInTheDocument()
  })

  it('§6-3 Core offline: banner DÍNH, vẫn cho sửa, KHOÁ Đưa vào vận hành', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({ dirty: true })] }),
      getProgrammingRuntime: () => Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'UNAVAILABLE',
        activeRevisionId: null, lkgRevisionId: null, taskState: 'UNKNOWN', safeState: false,
        observedAt: '2026-08-14T00:00:00Z'
      })
    })
    renderOverview('vi')

    const banner = await screen.findByTestId('core-offline-banner')
    // "Persistent" của handoff §6 = không cuộn mất.
    expect(banner.className).toContain('sticky')
    expect(banner).toHaveTextContent('Không kết nối được Core.')

    // VẪN CHO SỬA: CTA chính là chỉnh sửa và nó không bị chặn.
    const cta = screen.getByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-cta-kind', 'CONTINUE_EDITING')
    expect(cta).not.toHaveAttribute('data-blocked-by')
    const quick = within(screen.getByTestId('quick-actions'))
    expect(quick.getByRole('button', { name: /Tiếp tục chỉnh sửa/ })).not.toHaveAttribute('data-blocked-by')
    expect(quick.getByRole('button', { name: /Kiểm tra thay đổi/ })).not.toHaveAttribute('data-blocked-by')

    // KHOÁ COMMISSION.
    const commission = quick.getByRole('button', { name: /Đưa vào vận hành/ })
    expect(commission).toHaveAttribute('data-blocked-by', 'CORE_UNAVAILABLE')
    expect(commission).toHaveAttribute('aria-disabled', 'true')
    expect(commission).toHaveTextContent('Đưa vào vận hành bị khoá')
  })

  it('§6-4 runtime không đọc được ⇒ Unknown, KHÔNG 0 và KHÔNG Stopped', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRuntime: () => Promise.reject(new Error('core down')),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody())
    })
    const { container } = renderOverview('en')

    const hero = await screen.findByTestId('system-health-hero')
    const taskRow = within(hero).getByText('Control task').closest('[data-health-row="task"]')
    expect(taskRow).toHaveAttribute('data-health-state', 'unknown')
    expect(taskRow).toHaveTextContent('Unknown')
    expect(taskRow).not.toHaveTextContent('Stopped')

    // Kết luận tổng không bao giờ ra `good` khi chưa đọc được.
    expect(hero).not.toHaveAttribute('data-summary-state', 'good')
    // Không ô nào rơi về `0`, và không chỗ nào nói "đã dừng".
    expect(container.textContent ?? '').not.toMatch(/Stopped/)
    expect(container.textContent ?? '').not.toMatch(/\b0\b/)
  })

  it('§6-5 Draft == Active ⇒ thẻ so sánh thu gọn và CTA chính là Mở Runtime', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({
        draftRevisionId: ACTIVE_ID,
        baseRevisionId: ACTIVE_ID,
        draftSequence: 12,
        activeSequence: 12,
        latestCheck: { checkId: 'check-1', revisionId: ACTIVE_ID, state: 'PASSED', createdAt: '2026-08-15T00:00:00Z' }
      })] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody())
    })
    renderOverview('vi')
    expect(await screen.findByTestId('draft-active-compare-collapsed')).toHaveTextContent('Không có thay đổi chờ vận hành')
    expect(screen.getByTestId('primary-cta')).toHaveAttribute('data-cta-kind', 'OPEN_RUNTIME')
  })

  it('§6-6 viewer: giữ nguyên phần đọc, vô hiệu hoá hành động KÈM LÝ DO', async () => {
    auth.role = 'viewer'
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({ dirty: true })] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE', periodMs: 1000, health: 'HEALTHY', lastRunAtUtc: '2026-08-23T10:00:00Z', lastRunAgeMs: 400, updatedBy: 'admin', updatedAtUtcMs: 1 }
      ]))
    })
    renderOverview('vi')

    // Phần ĐỌC còn nguyên: sức khoẻ hệ thống và bảng Program vẫn hiện.
    expect(await screen.findByTestId('system-health-hero')).toBeInTheDocument()
    // Scope vào ĐÚNG bản bảng: từ `T60-208`, `ProgramsSummaryTable` render hai
    // bản loại trừ nhau qua media query (thẻ `md:hidden`, bảng `hidden md:block`),
    // và jsdom không áp media query nên cả hai cùng nằm trong DOM.
    expect(within(within(screen.getByTestId('programs-desktop')).getByRole('table')).getByText('AHU_Control')).toBeInTheDocument()

    // Hành động bị vô hiệu hoá và PHẢI nói lý do.
    const cta = screen.getByTestId('primary-cta')
    expect(cta).toHaveAttribute('data-blocked-by', 'NEEDS_PERMISSION')
    expect(cta).toHaveAttribute('aria-disabled', 'true')
    // Lý do hiện ở CẢ CTA chính lẫn các lối tắt — không chỗ nào xám đi mà im lặng.
    expect(screen.getAllByText('Vai hiện tại không có quyền cho thao tác này.').length).toBeGreaterThan(1)

    const quick = within(screen.getByTestId('quick-actions'))
    for (const name of [/Tiếp tục chỉnh sửa/, /Kiểm tra thay đổi/, /Đưa vào vận hành/]) {
      expect(quick.getByRole('button', { name })).toHaveAttribute('data-blocked-by', 'NEEDS_PERMISSION')
    }
    // Xem Runtime là quyền của cả ba vai.
    expect(quick.getByRole('button', { name: /Mở Runtime/ })).not.toHaveAttribute('data-blocked-by')
  })
})

/* ------------------------------------------------------------------ *
 * AC trên toàn trang                                                  *
 * ------------------------------------------------------------------ */

describe('OverviewPage — tiêu chí nghiệm thu toàn trang (T60-207)', () => {
  it('AC-PGM01-01: không chuỗi UUID nào lọt ra mặt trước', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE', periodMs: 1000, health: 'HEALTHY', lastRunAtUtc: '2026-08-23T10:00:00Z', lastRunAgeMs: 400, updatedBy: 'admin', updatedAtUtcMs: 1 },
        { programId: 'program-2', desiredEnabled: false, generation: 2, runtimeState: 'DISABLED', runtimeStateSource: 'CORE_LIVE', periodMs: 5000, updatedBy: 'admin', updatedAtUtcMs: 2 }
      ]))
    })
    const { container } = renderOverview('vi')
    await screen.findByTestId('programs-desktop')
    // Cả phần chữ lẫn thuộc tính DOM: `objectId` chỉ được sống trong khoá React
    // và trong query của deep-link, không nằm trong markup tĩnh.
    expect(container.innerHTML).not.toMatch(UUID_PATTERN)
    // Nhãn đọc được thay cho UUID (D-05).
    expect(screen.getAllByText(/Draft #14/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Active #12/).length).toBeGreaterThan(0)
  })

  it('AC-PGM01-05: đúng MỘT CTA chính, và nó không nằm trong Quick Actions', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem({ dirty: true })] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody())
    })
    const { container } = renderOverview('vi')
    await screen.findByTestId('primary-cta')

    expect(screen.getAllByTestId('primary-cta')).toHaveLength(1)
    // Chỉ một nút trên toàn trang mang nền accent của `variant="primary"`.
    const primaryLooking = [...container.querySelectorAll('button')].filter((node) =>
      node.className.includes('bg-[var(--c-accent)]')
    )
    expect(primaryLooking).toHaveLength(1)
    expect(primaryLooking[0]).toHaveAttribute('data-testid', 'primary-cta')
    // Lối tắt trùng CTA chính được đánh dấu bằng CHỮ, không bằng tô đậm.
    const quick = within(screen.getByTestId('quick-actions'))
    expect(quick.queryByTestId('primary-cta')).not.toBeInTheDocument()
    expect(quick.getByRole('button', { name: /Tiếp tục chỉnh sửa/ })).toHaveAttribute('data-primary-elsewhere', 'true')
  })

  it('T60-205 đã được RÁP: bảng sáu cột nằm trong trang, hàng bấm được mở PGM-02 kèm POU', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE', periodMs: 1000, health: 'HEALTHY', lastRunAtUtc: '2026-08-23T10:00:00Z', lastRunAgeMs: 400, updatedBy: 'admin', updatedAtUtcMs: 1 }
      ]))
    })
    renderOverview('vi')
    const table = within(await screen.findByTestId('programs-desktop'))
    for (const column of ['Chương trình', 'Ngôn ngữ', 'Chu kỳ', 'Trạng thái', 'Chạy gần nhất', 'Sức khoẻ']) {
      expect(table.getByRole('columnheader', { name: column })).toBeInTheDocument()
    }
    // D-02: KHÔNG có cột `Task`, và KHÔNG có CPU/core ở Overview.
    expect(table.queryByRole('columnheader', { name: /Task|CPU/i })).not.toBeInTheDocument()

    fireEvent.click(table.getByRole('button', { name: 'AHU_Control' }))
    expect(screen.getByTestId('probe-path')).toHaveTextContent(
      `/eng/programming/projects/project-1/programs?program=${OBJECT_1}`
    )
  })

  it('AC-PGM01-04: dòng thiếu số liệu ra “—” kèm lý do, không bao giờ ra 0', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      // Core im ở mức trang: có ý định nhưng KHÔNG có read-back nào.
      listProgrammingProgramIntents: () => Promise.resolve({
        schemaVersion: '1.0', projectId: 'project-1', runtimeStateSource: 'UNAVAILABLE',
        observedAt: null, programsTruncated: null, items: []
      })
    })
    renderOverview('vi')
    const table = within(await screen.findByTestId('programs-desktop'))
    const row = table.getByRole('row', { name: /AHU_Control/ })
    // Chu kỳ vẫn có vì gói KHAI BÁO nó — và phải nói rõ đó là số khai báo.
    expect(within(row).getByText('Khai báo trong gói')).toBeInTheDocument()
    // Mốc chạy gần nhất và sức khoẻ thì chưa đọc được.
    expect(within(row).getAllByText('Chưa đọc được từ Core').length).toBeGreaterThan(0)
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
    expect(within(row).queryByText('0 ms')).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * `<768 px` — `T60-208`                                               *
 * ------------------------------------------------------------------ */

describe('OverviewPage — responsive <768 px (T60-208)', () => {
  it('bảng sáu cột có bản thẻ gọn cho màn hẹp, nói đúng cùng một sự thật', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRevision: () => Promise.resolve(activeRevisionBody()),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE', periodMs: 1000, health: 'HEALTHY', lastRunAtUtc: '2026-08-23T10:00:00Z', lastRunAgeMs: 400, updatedBy: 'admin', updatedAtUtcMs: 1 },
        { programId: 'program-2', desiredEnabled: false, generation: 2, runtimeState: 'FAULTED', runtimeStateSource: 'LAST_KNOWN', updatedBy: 'admin', updatedAtUtcMs: 2 }
      ]))
    })
    const { container } = renderOverview('vi')

    const compactPanel = await screen.findByTestId('programs-compact')
    const compact = within(compactPanel)
    // Bảng chỉ hiện từ `md` trở lên; thẻ gọn chỉ hiện dưới `md`.
    expect(screen.getByTestId('programs-desktop').className).toContain('hidden')
    expect(compactPanel.className).toContain('md:hidden')

    // Cùng hai Program, cùng trạng thái, cùng nhãn "giá trị cũ".
    expect(compact.getByRole('button', { name: 'AHU_Control' })).toBeInTheDocument()
    expect(compact.getByText('Đang chạy')).toBeInTheDocument()
    const stale = compact.getByText('VAV_Zone').closest('[data-program-card]')
    expect(stale).toHaveTextContent('Lỗi')
    expect(stale).toHaveTextContent('giá trị cũ')
    // Không số liệu bịa và không UUID nằm ngang trong thẻ gọn.
    expect(stale).toHaveTextContent('—')
    expect(compactPanel.innerHTML).not.toMatch(UUID_PATTERN)
    expect(container.innerHTML).not.toMatch(UUID_PATTERN)
  })

  it('rỗng thì chỉ vẽ MỘT khối trạng thái rỗng, không nhân đôi bảng và thẻ gọn', async () => {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({ items: [projectItem()] }),
      getProgrammingRevision: () => Promise.resolve({ revisionId: ACTIVE_ID, snapshot: { objects: [] } }),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([]))
    })
    renderOverview('vi')
    expect(await screen.findByText('Chưa có chương trình nào đang vận hành.')).toBeInTheDocument()
    expect(screen.queryByTestId('programs-desktop')).not.toBeInTheDocument()
    expect(screen.queryByTestId('programs-compact')).not.toBeInTheDocument()
    // Lối tạo Program chỉ hiện với người đủ quyền (handoff §6 nhánh 2).
    expect(screen.getByTestId('create-program')).toBeInTheDocument()
  })
})


/* ------------------------------------------------------------------ *
 * `ISS-PGUI-01` — Active Revision toàn cục KHÔNG được ghép vào sai     *
 * Project (nguồn: PC-001, PC-002, PM-011)                             *
 * ------------------------------------------------------------------ */

/**
 * `GET /runtime` là read model của CONTROLLER: đúng một `activeRevisionId` cho
 * cả thiết bị. Bản trước chọn `projects.items[0]` rồi ghép con số toàn cục ấy
 * vào, nên khi gói đang chạy thuộc Project THỨ HAI, màn hình đồng thời hiện
 * `Active: Yes`, `Running`, và "active revision number is unresolved" — ba câu
 * không thể cùng đúng — rồi gọi `GET /revisions/{active}/changes/{base}` với
 * hai Revision khác Project và ăn `400 PRG-ERR-REQ-001`.
 *
 * Fixture dưới đây là đúng hình dạng ấy: Project đứng đầu KHÔNG phải Project
 * đang chạy.
 */
const RUNNER_ID = '55555555-5555-4555-8555-555555555555'
const RUNNER_BASE_ID = '66666666-6666-4666-8666-666666666666'
const IDLE_BASE_ID = '77777777-7777-4777-8777-777777777777'

/** Project đứng ĐẦU danh sách nhưng KHÔNG chạy gói nào. */
function idleFirstProject(overrides: Record<string, unknown> = {}) {
  return projectItem({
    projectId: 'project-idle',
    name: 'AHU-MASTER-SEQUENCE',
    activeRevisionId: null,
    draftRevisionId: IDLE_BASE_ID,
    baseRevisionId: IDLE_BASE_ID,
    draftSequence: 3,
    activeSequence: null,
    ...overrides
  })
}

/** Project đứng SAU nhưng chính là gói đang chạy trên thiết bị. */
function runningSecondProject(overrides: Record<string, unknown> = {}) {
  return projectItem({
    projectId: 'project-running',
    name: 'SOAK-10P-20260824-172521',
    activeRevisionId: RUNNER_ID,
    draftRevisionId: RUNNER_BASE_ID,
    baseRevisionId: RUNNER_BASE_ID,
    draftSequence: 21,
    activeSequence: 20,
    ...overrides
  })
}

function runnerRevisionBody() {
  return {
    revisionId: RUNNER_ID,
    snapshot: {
      objects: [
        { objectId: OBJECT_1, kind: 'PROGRAM', payload: { objectId: OBJECT_1, name: 'SOAK_Loop', language: 'ST', programConfig: { programId: 'program-1', periodMs: 1000 } } }
      ]
    }
  }
}

/** Mọi lần gọi `compareProgrammingRevisions` đã phát ra, dưới dạng cặp `{from,to}`. */
function comparePairs(): Array<{ from: unknown; to: unknown }> {
  return client.request.mock.calls
    .filter((call: unknown[]) => call[0] === 'compareProgrammingRevisions')
    .map((call: unknown[]) => (call[1] as { path: { from: unknown; to: unknown } }).path)
}

function revisionReads(): unknown[] {
  return client.request.mock.calls
    .filter((call: unknown[]) => call[0] === 'getProgrammingRevision')
    .map((call: unknown[]) => (call[1] as { path: { revisionId: unknown } }).path.revisionId)
}

describe('ISS-PGUI-01: Overview không ghép Active Revision toàn cục vào sai Project', () => {
  it('Active Revision thuộc Project KHÔNG đứng đầu ⇒ Overview chọn đúng Project và đúng sequence', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        activeRevisionId: RUNNER_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: false,
        observedAt: '2026-09-03T00:00:00Z'
      }),
      listProgrammingProjects: () => Promise.resolve({ items: [idleFirstProject(), runningSecondProject()] }),
      getProgrammingRevision: () => Promise.resolve(runnerRevisionBody()),
      compareProgrammingRevisions: () => Promise.resolve({ schemaVersion: '1.0', changes: [] }),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([
        { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE', periodMs: 1000, health: 'HEALTHY', lastRunAtUtc: '2026-09-03T00:00:00Z', lastRunAgeMs: 100, updatedBy: 'admin', updatedAtUtcMs: 1 }
      ]))
    })
    const { container } = renderOverview('vi')

    // Chủ ngữ của cả shell là Project ĐANG CHẠY, không phải Project đầu danh sách.
    const select = await screen.findByTestId('programming-project-select')
    expect((select as HTMLSelectElement).value).toBe('project-running')

    // Số hiệu đọc từ chính Project ấy: `r21` / `r20`, không phải `r3` của Project đầu.
    const strip = container.querySelector('[data-testid="programming-context-strip-row"]')!
    expect(strip.textContent).toContain('r21')
    expect(strip.textContent).toContain('r20')
    expect(strip.textContent).not.toContain('r3 ')

    // Program đang chạy đọc từ gói của ĐÚNG Project ấy.
    const table = within(await screen.findByTestId('programs-desktop'))
    expect(table.getByRole('row', { name: /SOAK_Loop/ })).toBeInTheDocument()

    /* Cặp so sánh phải cùng một Project. `IDLE_BASE_ID` là Draft nền của
       Project đầu — nó xuất hiện ở đây nghĩa là FE lại ghép chéo Project, đúng
       request mà backend BẮT BUỘC trả 400 `PRG-ERR-REQ-001`. */
    expect(revisionReads()).toEqual([RUNNER_ID])
    expect(comparePairs().length).toBeGreaterThan(0)
    for (const pair of comparePairs()) {
      expect(pair).toEqual({ from: RUNNER_ID, to: RUNNER_BASE_ID })
    }
  })

  it('gói đang chạy KHÔNG quy được về Project nào ⇒ không "Có", không phát request compare', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        // Gói đang chạy không thuộc Project nào trong danh sách (danh sách đã cắt trang, hoặc dữ liệu lệch).
        activeRevisionId: 'aaaaaaaa-9999-4aaa-8aaa-aaaaaaaaaaaa',
        lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: false, observedAt: '2026-09-03T00:00:00Z'
      }),
      listProgrammingProjects: () => Promise.resolve({ items: [idleFirstProject(), runningSecondProject()] }),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([]))
    })
    const { container } = renderOverview('vi')

    await screen.findByTestId('programming-context-strip-row')
    const active = container.querySelector('[data-context-field="active"]')!
    expect(active.textContent).toContain('Chưa xác định được Project của gói đang chạy')
    expect(active.textContent).not.toContain('Có')

    /* `retryable=false`: cặp Revision chưa chứng minh cùng Project thì KHÔNG
       được hỏi lần nào — không có request để mà thử lại. */
    expect(comparePairs()).toEqual([])
    expect(revisionReads()).toEqual([])

    /* Bảng Program VÀ thẻ so sánh cùng nói LÝ DO, không nói "không có Program
       nào" và không nói "controller chưa đưa gói nào vào vận hành". */
    expect((await screen.findAllByText(/Chưa xác định được gói đang vận hành thuộc Project nào/)).length)
      .toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/Controller này chưa đưa gói nào vào vận hành/)).not.toBeInTheDocument()
  })

  it('runtime không đọc được ⇒ giữ fail-closed, không biến thành "chưa vận hành gói nào"', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.reject(new Error('503 unavailable')),
      listProgrammingProjects: () => Promise.resolve({ items: [idleFirstProject(), runningSecondProject()] }),
      listProgrammingProgramIntents: () => Promise.resolve(liveProgramsPage([]))
    })
    renderOverview('vi')

    expect(await screen.findByText(/Không đọc được gói đang vận hành/)).toBeInTheDocument()
    expect(screen.queryByText(/Thiết bị chưa vận hành gói nào/)).not.toBeInTheDocument()
    expect(comparePairs()).toEqual([])
  })
})
