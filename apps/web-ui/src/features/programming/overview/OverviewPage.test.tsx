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
})
