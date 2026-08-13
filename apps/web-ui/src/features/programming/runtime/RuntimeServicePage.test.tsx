import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { RuntimeServicePage } from './RuntimeServicePage'
import { ProgrammingLayout } from '../layout/ProgrammingLayout'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole, login: vi.fn() }))
vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'admin', role: auth.role, loginAt: '2026-08-13T00:00:00Z' },
      login: auth.login,
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => client }))

const LKG_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const ACTIVE_ID = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'
const OPERATION_ID = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb'

function stubDefaultEndpoints(overrides: Record<string, () => Promise<unknown>> = {}) {
  client.request.mockImplementation((operationId: string) => {
    if (overrides[operationId]) return overrides[operationId]()
    if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
    if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
    if (operationId === 'getProgrammingRuntimeMonitor') return Promise.reject(new Error('503 unavailable'))
    if (operationId === 'listProgrammingOperations') return Promise.resolve({ items: [] })
    if (operationId === 'listProgrammingAudit') return Promise.resolve({ items: [] })
    return Promise.reject(new Error(`unexpected operation ${operationId}`))
  })
}

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming/runtime']}>
        <Routes>
          <Route element={<ProgrammingLayout />}>
            <Route path="/eng/programming/runtime" element={<RuntimeServicePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  auth.role = 'admin'
  auth.login.mockReset().mockResolvedValue(undefined)
  client.request.mockReset()
  localStorage.setItem('mkddc-lang', 'vi')
  sessionStorage.clear()
})
afterEach(cleanup)

describe('RuntimeServicePage — S5-D (TASK-PROG-505)', () => {
  it('viewer thấy vùng nguy hiểm ở chế độ đọc, không thấy nút Khôi phục/Nhập gói/RETAIN', async () => {
    auth.role = 'viewer'
    stubDefaultEndpoints()
    renderPage()
    await waitFor(() => expect(screen.getByText('Vùng thao tác nguy hiểm')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Khôi phục bản trước/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Chọn gói \.zip/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Đặt lại RETAIN/ })).not.toBeInTheDocument()
  })

  it('admin khôi phục về LKG: re-auth thật, POST một lần, đọc ngược actualActiveRevisionId', async () => {
    stubDefaultEndpoints({
      restoreProgrammingRevision: () => Promise.resolve({ operationId: OPERATION_ID, statusUrl: '', state: 'REQUESTED', requestHash: 'h', acceptedAt: '2026-08-13T00:00:01Z', correlationId: 'c1' }),
      getProgrammingOperation: () =>
        Promise.resolve({ operationId: OPERATION_ID, state: 'SUCCEEDED', step: 'done', requestedRevisionId: LKG_ID, previousActiveRevisionId: ACTIVE_ID, actualActiveRevisionId: LKG_ID, keepsRunningRevision: false, startedAt: '2026-08-13T00:00:01Z', updatedAt: '2026-08-13T00:00:02Z' })
    })
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: /Khôi phục bản trước…/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Khôi phục bản trước…/ }))

    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Lý do khôi phục'), { target: { value: 'AHU-01 lỗi ánh xạ mới' } })
    fireEvent.change(screen.getByLabelText(/Xác thực lại/), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }))

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('secret', 'admin'))
    await waitFor(() => expect(screen.getByText(/Khôi phục thành công/)).toBeInTheDocument())
    expect(client.request.mock.calls.filter(([op]) => op === 'restoreProgrammingRevision')).toHaveLength(1)
    const [, restoreOptions] = client.request.mock.calls.find(([op]) => op === 'restoreProgrammingRevision')!
    expect(restoreOptions.body.revisionId).toBe(LKG_ID)
  })

  it('tab Theo dõi gọi GET /runtime/monitor thật và hiện đúng trạng thái chưa sẵn sàng khi 503', async () => {
    stubDefaultEndpoints()
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Theo dõi' }))
    await waitFor(() => expect(client.request.mock.calls.some(([op]) => op === 'getProgrammingRuntimeMonitor')).toBe(true))
    await waitFor(() => expect(screen.getAllByText('Chưa sẵn sàng').length).toBeGreaterThan(0))
  })
})
