import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { CheckCommissionPage } from './CheckCommissionPage'
import { ProgrammingLayout } from '../layout/ProgrammingLayout'
import type { ProgrammingCheck, ProgrammingRevision, ProgrammingRevisionChanges } from '../model/types'

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

const REVISION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHECK_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OPERATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
type RequestOptions = {
  path?: Record<string, string>
  ifMatch?: string
  body?: { baseRevisionId?: string }
}

function passedCheck(): ProgrammingCheck {
  return { checkId: CHECK_ID, revisionId: REVISION_ID, state: 'PASSED', diagnostics: [], createdAt: '2026-08-13T00:00:00Z', attemptCount: 1 }
}

/** ProgrammingLayout quan sát snapshot immutable của revision Active; đây chỉ
 * là fixture đọc tối thiểu, không thay authority `/programming/runtime`. */
function immutableRevision(revisionId: string): ProgrammingRevision {
  return {
    revisionId,
    projectId: 'project-1',
    state: 'IMMUTABLE',
    contentHash: `hash-${revisionId}`,
    createdAt: '2026-08-13T00:00:00Z'
  }
}

function baseProject() {
  return {
    projectId: 'project-1', name: 'AHU-01', etag: '"draft-1:1"',
    activeRevisionId: null, draftRevisionId: 'draft-1', baseRevisionId: 'draft-1', updatedAt: '2026-08-13T00:00:00Z',
    draft: {
      schemaVersion: 1,
      project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
      programs: [], variables: [], bindings: [],
      task: { taskId: 'task-1', periodMs: 1000, programOrder: [] },
      library: { profile: 'CORE_REVA', version: '1' }
    }
  }
}

function changesWithTwoPresentGroups(): ProgrammingRevisionChanges {
  return {
    fromRevisionId: 'none',
    toRevisionId: REVISION_ID,
    changes: [{ objectId: 'program-1', kind: 'PROGRAM', changeType: 'ADDED', category: 'LOGIC' }],
    impact: {
      impactRef: 'impact-ref-001',
      retain: { status: 'PRESENT', items: ['var-1'] },
      activeOverrides: { status: 'PRESENT', items: ['AO-01'] },
      cutover: { status: 'NONE', items: [] },
      outputMappingChanges: { status: 'NONE', items: [] }
    }
  }
}

function renderPage(useCanonicalQuery = false) {
  const initialEntry = useCanonicalQuery
    ? `/eng/programming/projects/project-1/commission?revisionId=${REVISION_ID}&checkId=${CHECK_ID}`
    : { pathname: '/eng/programming/projects/project-1/commission', state: { revisionId: REVISION_ID, checkId: CHECK_ID } }
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<ProgrammingLayout />}>
            <Route path="/eng/programming/projects/:projectId/commission" element={<CheckCommissionPage />} />
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

describe('CheckCommissionPage — S5-C (TASK-PROG-504)', () => {
  it('Check FAILED vẫn hiển thị chẩn đoán nhưng chặn Commission fail-closed', async () => {
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve({ ...passedCheck(), state: 'FAILED', diagnostics: [{ code: 'PRG-ERR-001', severity: 'ERROR', messageKey: 'programming.check.error' }] })
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage(true)
    await waitFor(() => expect(screen.getByText('FAILED')).toBeInTheDocument())
    expect(screen.getByText(/Chỉ Kiểm tra PASSED mới mở được/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).toBeDisabled()
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'commissionProgrammingRevision')).toBe(false)
  })

  it('ô xác nhận khớp đúng số nhóm impact PRESENT (VS-PROG-019) và gửi Commission một lần sau re-auth', async () => {
    let runtimeReads = 0
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') {
        runtimeReads += 1
        return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: runtimeReads > 1 ? REVISION_ID : 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      }
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      if (operationId === 'commissionProgrammingRevision') return Promise.resolve({ operationId: OPERATION_ID, statusUrl: '', state: 'QUEUED', requestHash: 'hash', acceptedAt: '2026-08-13T00:00:01Z', correlationId: 'corr-1' })
      if (operationId === 'getProgrammingOperation') return Promise.resolve({ operationId: OPERATION_ID, state: 'SUCCEEDED', step: 'done', requestedRevisionId: REVISION_ID, previousActiveRevisionId: 'previous-revision', actualActiveRevisionId: REVISION_ID, keepsRunningRevision: false, startedAt: '2026-08-13T00:00:01Z', updatedAt: '2026-08-13T00:00:02Z' })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Đưa vào vận hành…' }))

    // Đúng hai ô xác nhận cho hai nhóm PRESENT (retain, activeOverrides) — không phải bốn ô cố định.
    const dialog = await screen.findByRole('dialog')
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Xác nhận Đưa vào vận hành' }))
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2))

    const confirmButton = within(dialog).getByRole('button', { name: `Xác nhận ${REVISION_ID.slice(0, 8)}` })
    expect(confirmButton).toBeDisabled()

    for (const checkbox of within(dialog).getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.change(within(dialog).getByLabelText(/Xác thực lại/), { target: { value: 'secret' } })
    expect(confirmButton).not.toBeDisabled()

    fireEvent.click(confirmButton)

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('secret', 'admin'))
    await waitFor(() => {
      const commissionCall = client.request.mock.calls.find(([op]) => op === 'commissionProgrammingRevision')
      expect(commissionCall).toBeTruthy()
    })
    const [, commissionOptions] = client.request.mock.calls.find(([op]) => op === 'commissionProgrammingRevision')!
    expect(commissionOptions.body.acknowledgements.slice().sort()).toEqual(['activeOverrides', 'retain'])
    expect(commissionOptions.body.impactRef).toBe('impact-ref-001')

    await waitFor(() => expect(screen.getByText(/Đưa vào vận hành thành công/)).toBeInTheDocument())
    await waitFor(() => expect(runtimeReads).toBeGreaterThan(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).toBeDisabled()
    // Chỉ MỘT lần gọi commission dù có polling/re-render nhiều lần.
    expect(client.request.mock.calls.filter(([op]) => op === 'commissionProgrammingRevision')).toHaveLength(1)
    const compareCalls = client.request.mock.calls.filter(([op]) => op === 'compareProgrammingRevisions')
    expect(compareCalls.some(([, options]) => options.path.from === REVISION_ID)).toBe(false)
  })

  it('UNAVAILABLE chặn Đưa vào vận hành ngay cả khi Check PASSED', async () => {
    client.request.mockImplementation((operationId: string, _options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'STOPPED', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') {
        const changes = changesWithTwoPresentGroups()
        changes.impact.cutover = { status: 'UNAVAILABLE', items: [] }
        return Promise.resolve(changes)
      }
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/Đưa vào vận hành bị chặn/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).toBeDisabled()
  })

  it('ROLLED_BACK báo read-back revision và không coi Commission là thành công', async () => {
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      if (operationId === 'commissionProgrammingRevision') return Promise.resolve({ operationId: OPERATION_ID, statusUrl: '', state: 'QUEUED', requestHash: 'hash', acceptedAt: '2026-08-13T00:00:01Z', correlationId: 'corr-1' })
      if (operationId === 'getProgrammingOperation') return Promise.resolve({ operationId: OPERATION_ID, state: 'ROLLED_BACK', step: 'rollback', requestedRevisionId: REVISION_ID, previousActiveRevisionId: 'previous-revision', actualActiveRevisionId: 'previous-revision', keepsRunningRevision: true, startedAt: '2026-08-13T00:00:01Z', updatedAt: '2026-08-13T00:00:02Z' })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage(true)
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Đưa vào vận hành…' }))
    const dialog = await screen.findByRole('dialog')
    for (const checkbox of within(dialog).getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.change(within(dialog).getByLabelText(/Xác thực lại/), { target: { value: 'secret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: `Xác nhận ${REVISION_ID.slice(0, 8)}` }))

    await waitFor(() => expect(screen.getByText(/đã được Core quay lui/)).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByText(/previous-revision/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Đưa vào vận hành thành công/)).not.toBeInTheDocument()
  })

  it('SUCCEEDED nhưng Active read-back khác candidate là alert fail-closed, không thành công', async () => {
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      if (operationId === 'commissionProgrammingRevision') return Promise.resolve({ operationId: OPERATION_ID, statusUrl: '', state: 'QUEUED', requestHash: 'hash', acceptedAt: '2026-08-13T00:00:01Z', correlationId: 'corr-1' })
      if (operationId === 'getProgrammingOperation') return Promise.resolve({ operationId: OPERATION_ID, state: 'SUCCEEDED', step: 'done', requestedRevisionId: REVISION_ID, previousActiveRevisionId: 'previous-revision', actualActiveRevisionId: 'other-revision', keepsRunningRevision: true, startedAt: '2026-08-13T00:00:01Z', updatedAt: '2026-08-13T00:00:02Z' })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage(true)
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Đưa vào vận hành…' }))
    const dialog = await screen.findByRole('dialog')
    for (const checkbox of within(dialog).getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.change(within(dialog).getByLabelText(/Xác thực lại/), { target: { value: 'secret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: `Xác nhận ${REVISION_ID.slice(0, 8)}` }))

    const mismatchText = await screen.findByText(/SUCCEEDED nhưng Active read-back không khớp bản ứng viên/)
    const mismatch = mismatchText.closest('[role="alert"]')
    expect(mismatch).not.toBeNull()
    if (!mismatch) throw new Error('Thiếu alert read-back mismatch')
    expect(mismatch).toHaveTextContent(/SUCCEEDED nhưng Active read-back không khớp bản ứng viên/)
    expect(mismatch).toHaveTextContent('other-revision')
    expect(screen.queryByText(/Đưa vào vận hành thành công/)).not.toBeInTheDocument()
  })

  it('deep-link query tải đúng Check/Revision sau reload và không phụ thuộc location.state', async () => {
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId} ${JSON.stringify(options)}`)
    })

    renderPage(true)
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    const checkCall = client.request.mock.calls.find(([op]) => op === 'getProgrammingCheck')
    const changesCall = client.request.mock.calls.find(([op]) => op === 'compareProgrammingRevisions')
    expect(checkCall?.[1].path.checkId).toBe(CHECK_ID)
    expect(changesCall?.[1].path.to).toBe(REVISION_ID)
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).not.toBeDisabled()
  })

  it('safeState=true nhưng chỉ do chưa ai điều khiển (safeStateNoControllerOnly) không chặn Commission', async () => {
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: true, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())

    // Banner giải thích — không phải banner chặn.
    await waitFor(() => expect(screen.getByText(/Core đang ở trạng thái an toàn vì chưa có Program nào điều khiển output/)).toBeInTheDocument())
    expect(screen.queryByText(/Đưa vào vận hành bị chặn/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).not.toBeDisabled()
  })

  it('Core safe-state và lỗi đọc override đều fail-closed dù Check PASSED', async () => {
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'getProgrammingRevision') return Promise.resolve(immutableRevision(options?.path?.revisionId ?? 'previous-revision'))
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.reject(new Error('Core override registry offline'))
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/Core chưa READY hoặc đang ở trạng thái an toàn/)).toBeInTheDocument())
    expect(screen.getByText(/Không xác minh được override hiện hành/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).toBeDisabled()
  })

  it('D-01: mở PGM-03 không kèm Check nào tự seal/run/poll bằng nút "Kiểm tra", rồi hiện đúng kết quả', async () => {
    const project = baseProject()
    const sealedEtag = '"draft-1:2"'
    client.request.mockImplementation((operationId: string, options?: RequestOptions) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: 'draft-1' }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'createProgrammingRevision') {
        expect(options?.ifMatch).toBe(project.etag)
        expect(options?.body?.baseRevisionId).toBe(project.baseRevisionId)
        return Promise.resolve({ resource: { projectId: 'project-1', revisionId: REVISION_ID }, etag: sealedEtag, auditId: 'audit-1', correlationId: 'corr-1' })
      }
      if (operationId === 'createProgrammingCheck') {
        return Promise.resolve({ checkId: CHECK_ID, statusUrl: '', state: 'QUEUED', requestHash: 'h', acceptedAt: '2026-08-13T00:00:00Z', correlationId: 'corr-2' })
      }
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/eng/programming/projects/project-1/commission']}>
          <Routes>
            <Route element={<ProgrammingLayout />}>
              <Route path="/eng/programming/projects/:projectId/commission" element={<CheckCommissionPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    )

    expect(await screen.findByText('Chưa có Kiểm tra nào.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Chưa kiểm tra')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))

    // Sau khi seal+check xong, trang tự điều hướng vào đúng revisionId/checkId
    // (D-01) và hiện lại toàn bộ panel kết quả y hệt đường deep-link cũ.
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).not.toBeDisabled()
  })
})
