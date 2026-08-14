import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { CheckCommissionPage } from './CheckCommissionPage'
import { ProgrammingLayout } from '../layout/ProgrammingLayout'
import type { ProgrammingCheck, ProgrammingRevisionChanges } from '../model/types'

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

function passedCheck(): ProgrammingCheck {
  return { checkId: CHECK_ID, revisionId: REVISION_ID, state: 'PASSED', diagnostics: [], createdAt: '2026-08-13T00:00:00Z', attemptCount: 1 }
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
  it('ô xác nhận khớp đúng số nhóm impact PRESENT (VS-PROG-019) và gửi Commission một lần sau re-auth', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      if (operationId === 'commissionProgrammingRevision') return Promise.resolve({ operationId: OPERATION_ID, statusUrl: '', state: 'REQUESTED', requestHash: 'hash', acceptedAt: '2026-08-13T00:00:01Z', correlationId: 'corr-1' })
      if (operationId === 'getProgrammingOperation') return Promise.resolve({ operationId: OPERATION_ID, state: 'SUCCEEDED', step: 'done', requestedRevisionId: REVISION_ID, previousActiveRevisionId: 'previous-revision', actualActiveRevisionId: REVISION_ID, keepsRunningRevision: false, startedAt: '2026-08-13T00:00:01Z', updatedAt: '2026-08-13T00:00:02Z' })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Đưa vào vận hành…' }))

    // Đúng hai ô xác nhận cho hai nhóm PRESENT (retain, activeOverrides) — không phải bốn ô cố định.
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2))

    const confirmButton = within(dialog).getByRole('button', { name: 'Gửi lệnh' })
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
    // Chỉ MỘT lần gọi commission dù có polling/re-render nhiều lần.
    expect(client.request.mock.calls.filter(([op]) => op === 'commissionProgrammingRevision')).toHaveLength(1)
  })

  it('UNAVAILABLE chặn Đưa vào vận hành ngay cả khi Check PASSED', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'STOPPED', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
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

  it('deep-link query tải đúng Check/Revision sau reload và không phụ thuộc location.state', async () => {
    client.request.mockImplementation((operationId: string, options?: { path?: Record<string, string> }) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
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
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: true, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
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
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
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
})
