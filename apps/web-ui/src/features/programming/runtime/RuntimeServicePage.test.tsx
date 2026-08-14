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
    if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY', activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
    if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: ACTIVE_ID }] })
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
    fireEvent.click(await screen.findByRole('tab', { name: /Phiên bản & Bảo trì/ }))
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

    fireEvent.click(await screen.findByRole('tab', { name: /Phiên bản & Bảo trì/ }))
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

  it('DEGRADED và safe-state đều khóa Restore, không mở modal', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.resolve({ schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'DEGRADED', activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: true, observedAt: '2026-08-13T00:00:00Z' })
    })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Phiên bản & Bảo trì/ }))
    const restoreButton = await screen.findByRole('button', { name: /Khôi phục bản trước…/ })
    expect(restoreButton).toBeDisabled()
    fireEvent.click(restoreButton)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('RETAIN fail-closed khi chưa có impact: nút khóa và không gửi UUID Active giả', async () => {
    stubDefaultEndpoints()
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Phiên bản & Bảo trì/ }))
    const retainButton = await screen.findByRole('button', { name: /Đặt lại RETAIN/ })
    expect(retainButton).toBeDisabled()
    expect(screen.getByText(/backend chưa cung cấp danh sách biến RETAIN/)).toBeInTheDocument()
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'resetProgrammingRetain')).toBe(false)
  })

  it('xuất source-only bundle của Active Revision và tạo file tải xuống', async () => {
    const createObjectURL = vi.fn(() => 'blob:programming-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    stubDefaultEndpoints({
      exportProgrammingBundle: () => Promise.resolve({ schemaVersion: '1.0', bundleSha256: 'a'.repeat(64), byteSize: 4, selectedRevisionId: ACTIVE_ID, bundleBase64: 'UEsDBA==' })
    })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Phiên bản & Bảo trì/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Xuất gói .zip' }))

    await waitFor(() => expect(client.request.mock.calls.some(([operationId]) => operationId === 'exportProgrammingBundle')).toBe(true))
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'exportProgrammingBundle')!
    expect(options.body.revisionIds).toEqual([ACTIVE_ID])
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:programming-export')
    click.mockRestore()
  })

  it('hiển thị chi tiết safe-state thay vì chỉ Có/Không — safe-state do lỗi thật (không phải no-controller-only)', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.resolve({ schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY', activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: false, observedAt: '2026-08-13T00:00:00Z', task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 1, missedReleaseCount: 0, lastExecNs: 1, maxExecNs: 1, overrunCount: 0, consecutiveOverruns: 0 } })
    })
    renderPage()
    expect(await screen.findByText(/PRG-SAFE-ACTIVE/)).toBeInTheDocument()
    expect(screen.getByText(/Nguyên nhân: I\/O lỗi\/dữ liệu cũ\/quá giờ/)).toBeInTheDocument()
    expect(screen.getByText(/giữ Commission\/Restore bị khóa/)).toBeInTheDocument()
  })

  it('safeState=true nhưng chỉ do chưa ai điều khiển (safeStateNoControllerOnly) hiện cảnh báo nhẹ, không nói bị khóa', async () => {
    stubDefaultEndpoints({
      getProgrammingRuntime: () => Promise.resolve({ schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY', activeRevisionId: ACTIVE_ID, lkgRevisionId: LKG_ID, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: true, observedAt: '2026-08-13T00:00:00Z', task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 1, missedReleaseCount: 0, lastExecNs: 1, maxExecNs: 1, overrunCount: 0, consecutiveOverruns: 0 } })
    })
    renderPage()
    expect(await screen.findByText(/PRG-SAFE-ACTIVE/)).toBeInTheDocument()
    expect(screen.getByText(/chưa Program nào ghi AO\/DO vật lý/)).toBeInTheDocument()
    expect(screen.getByText(/KHÔNG bị khóa vì lý do này/)).toBeInTheDocument()
    expect(screen.queryByText(/giữ Commission\/Restore bị khóa/)).not.toBeInTheDocument()
  })

  it('có bottom navigation bốn workspace trên shell Programming', async () => {
    stubDefaultEndpoints()
    renderPage()
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng workspace Lập trình' })
    expect(nav).toHaveTextContent('Tổng quan')
    expect(nav).toHaveTextContent('Thiết kế')
    expect(nav).toHaveTextContent('Kiểm tra')
    expect(nav).toHaveTextContent('Runtime')
  })

  it('tab Theo dõi gọi GET /runtime/monitor thật và hiện đúng trạng thái chưa sẵn sàng khi 503', async () => {
    stubDefaultEndpoints()
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Theo dõi' }))
    expect(screen.queryByText('Vùng thao tác nguy hiểm')).not.toBeInTheDocument()
    await waitFor(() => expect(client.request.mock.calls.some(([op]) => op === 'getProgrammingRuntimeMonitor')).toBe(true))
    await waitFor(() => expect(screen.getByText('Không đọc được monitor')).toBeInTheDocument())
  })

  it('tách giá trị Program/Actual/override và cho admin tạo rồi dừng trace bounded', async () => {
    let stopped = false
    stubDefaultEndpoints({
      getProgrammingRuntimeMonitor: () => Promise.resolve({
        schemaVersion: '1.0', activeRevisionId: ACTIVE_ID, safeState: false,
        task: { taskId: 'main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 10, missedReleaseCount: 0, lastExecNs: 1200, maxExecNs: 3000, overrunCount: 1, consecutiveOverruns: 0 },
        items: [{
          variableId: '55555555-5555-4555-8555-555555555555', variableName: 'SupplySetpoint', programId: 'program-1',
          point: { category: 'LOCAL', pointId: 'AO-01' }, direction: 'WRITE', dataType: 'REAL', unit: 'V',
          programValue: 41, actualValue: 62, overriddenBy: 'manual', effectivePriority: 2,
          overrideActor: 'operator-1', overrideRemainingS: 272, quality: 'GOOD', observedAt: '2026-08-13T00:00:00Z', freshness: 'LIVE'
        }]
      }),
      createProgrammingTrace: () => Promise.resolve({ traceId: '99999999-9999-4999-8999-999999999999', statusUrl: '/api/v1/programming/runtime/traces/99999999-9999-4999-8999-999999999999', state: 'RUNNING', requestHash: 'hash', acceptedAt: '2026-08-13T00:00:00Z', correlationId: 'corr' }),
      getProgrammingTrace: () => Promise.resolve({
        traceId: '99999999-9999-4999-8999-999999999999', state: stopped ? 'STOPPED' : 'RUNNING',
        variableIds: ['55555555-5555-4555-8555-555555555555'], durationMs: 60000, samplePeriodMs: 1000,
        startedAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:01Z', stopReason: stopped ? 'USER_STOPPED' : null,
        droppedSamples: 0, samples: [{ sequence: 1, observedAt: '2026-08-13T00:00:00Z', values: [{ variableId: '55555555-5555-4555-8555-555555555555', programValue: 41, actualValue: 62, overriddenBy: 'manual', effectivePriority: 2, quality: 'GOOD', freshness: 'LIVE' }] }]
      }),
      stopProgrammingTrace: () => { stopped = true; return Promise.resolve(undefined) }
    })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Theo dõi' }))

    expect(await screen.findByText('41 V')).toBeInTheDocument()
    expect(screen.getByText('62 V')).toBeInTheDocument()
    expect(screen.getByText('manual · operator-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trace SupplySetpoint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu trace' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dừng trace' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Dừng trace' }))
    await waitFor(() => expect(screen.getByText(/USER_STOPPED/)).toBeInTheDocument())
    expect(client.request.mock.calls.filter(([op]) => op === 'createProgrammingTrace')).toHaveLength(1)
    expect(client.request.mock.calls.filter(([op]) => op === 'stopProgrammingTrace')).toHaveLength(1)
  })
})
