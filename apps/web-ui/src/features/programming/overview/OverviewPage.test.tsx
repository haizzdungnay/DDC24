import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { OverviewPage } from './OverviewPage'
import { RuntimeServicePage } from '../runtime/RuntimeServicePage'
import { ProgrammingLayout } from '../layout/ProgrammingLayout'

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

function renderOverview(initialLang: 'vi' | 'en' = 'en') {
  localStorage.setItem('mkddc-lang', initialLang)
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming']}>
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
    expect(screen.getAllByText('FAULTED 1 · RUNNING 1')).toHaveLength(2)
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
 * lỗi/vừa đạt. */
describe('OverviewPage — DraftAttentionPanel theo latestCheck (WP-01)', () => {
  function stubProjectWithCheck(latestCheck: Record<string, unknown> | null) {
    stubDefaultEndpoints({
      listProgrammingProjects: () => Promise.resolve({
        items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: ACTIVE_ID, latestCheck }]
      })
    })
  }

  it('dirty: chưa Check lần nào — chỉ có "Tiếp tục chỉnh sửa"', async () => {
    stubProjectWithCheck(null)
    renderOverview('vi')
    await screen.findByText('Đang chỉnh sửa — chưa Kiểm tra lần nào cho bản này.')
    expect(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Xem lỗi' })).not.toBeInTheDocument()
  })

  it('checking: Check đang QUEUED/RUNNING — hiện đang xử lý, không giả thành trạng thái sửa bình thường', async () => {
    stubProjectWithCheck({ checkId: 'check-1', revisionId: ACTIVE_ID, state: 'RUNNING', createdAt: '2026-08-15T00:00:00Z' })
    renderOverview('vi')
    await screen.findByText('Đang kiểm tra…')
    expect(screen.getByRole('button', { name: 'Xem tiến trình' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tiếp tục chỉnh sửa' })).not.toBeInTheDocument()
  })

  it('failed: Check FAILED — primary action "Xem lỗi", vẫn giữ lối "Tiếp tục chỉnh sửa"', async () => {
    stubProjectWithCheck({ checkId: 'check-1', revisionId: ACTIVE_ID, state: 'FAILED', createdAt: '2026-08-15T00:00:00Z', completedAt: '2026-08-15T00:01:00Z' })
    renderOverview('vi')
    await screen.findByText('Kiểm tra gần nhất KHÔNG đạt.')
    expect(screen.getByRole('button', { name: 'Xem lỗi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' })).toBeInTheDocument()
  })

  it('ready: Check PASSED — primary action mở Kiểm tra & Đưa vào vận hành', async () => {
    stubProjectWithCheck({ checkId: 'check-1', revisionId: ACTIVE_ID, state: 'PASSED', createdAt: '2026-08-15T00:00:00Z', completedAt: '2026-08-15T00:01:00Z' })
    renderOverview('vi')
    await screen.findByText('Kiểm tra gần nhất đạt — sẵn sàng Đưa vào vận hành.')
    expect(screen.getByRole('button', { name: 'Mở Kiểm tra & Đưa vào vận hành' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' })).toBeInTheDocument()
  })
})
