import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
  return { checkId: CHECK_ID, revisionId: REVISION_ID, state: 'PASSED', diagnostics: [], symbols: [], createdAt: '2026-08-13T00:00:00Z', attemptCount: 1 }
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
      outputMappingChanges: { status: 'NONE', items: [] },

      // T59-502: bốn nhóm impact của mô hình đa Program. Thiếu nhóm nào

      // thì trang fail-closed — "không thấy" không phải "không có".

      publishedSignals: { status: 'NONE', items: [] },

      controlLibrary: { status: 'NONE', items: [] },

      programSet: { status: 'NONE', items: [] },

      enableIntent: { status: 'NONE', items: [] },
      // `ISS-PIO-29` — bốn nhóm tách theo nguồn Point.
      physicalMappingChanges: { status: 'NONE', items: [] },
      virtualPointChanges: { status: 'NONE', items: [] },
      modbusMappingChanges: { status: 'NONE', items: [] },
      writableOutputsAffected: { status: 'NONE', items: [] }
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
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      if (operationId === 'commissionProgrammingRevision') return Promise.resolve({ operationId: OPERATION_ID, statusUrl: '', state: 'REQUESTED', requestHash: 'hash', acceptedAt: '2026-08-13T00:00:01Z', correlationId: 'corr-1' })
      if (operationId === 'getProgrammingOperation') return Promise.resolve({ operationId: OPERATION_ID, state: 'SUCCEEDED', step: 'done', requestedRevisionId: REVISION_ID, previousActiveRevisionId: 'previous-revision', actualActiveRevisionId: REVISION_ID, keepsRunningRevision: false, startedAt: '2026-08-13T00:00:01Z', updatedAt: '2026-08-13T00:00:02Z' })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())
    const lifecycle = screen.getByRole('list', { name: 'Tiến trình Kiểm tra và Đưa vào vận hành' })
    expect(within(lifecycle).getByText('READY').closest('li')).toHaveAttribute('aria-current', 'step')
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
    expect(within(lifecycle).getByText('SUCCEEDED').closest('li')).toHaveAttribute('aria-current', 'step')
    // Chỉ MỘT lần gọi commission dù có polling/re-render nhiều lần.
    expect(client.request.mock.calls.filter(([op]) => op === 'commissionProgrammingRevision')).toHaveLength(1)
  })

  it('UNAVAILABLE chặn Đưa vào vận hành ngay cả khi Check PASSED', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'STOPPED', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
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

  it('deep-link query tải đúng Check/Revision sau reload và không phụ thuộc location.state', async () => {
    client.request.mockImplementation((operationId: string, options?: { path?: Record<string, string> }) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
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
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: true, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('PASSED')).toBeInTheDocument())

    // Banner giải thích — không phải banner chặn.
    await waitFor(() => expect(screen.getByText(/Core đang giữ AO\/DO cục bộ ở safe-state/)).toBeInTheDocument())
    expect(screen.queryByText(/Đưa vào vận hành bị chặn/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).not.toBeDisabled()
  })

  it('Core safe-state và lỗi đọc override đều fail-closed dù Check PASSED', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: true, safeStateNoControllerOnly: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
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

  it('D-01: mở PGM-05 không kèm Check nào tự seal/run/poll bằng nút "Kiểm tra", rồi hiện đúng kết quả', async () => {
    const project = baseProject()
    const sealedEtag = '"draft-1:2"'
    client.request.mockImplementation((operationId: string, options?: { ifMatch?: string; body?: { baseRevisionId?: string } }) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: 'draft-1' }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
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
    // Empty state có thể render trước khi Project về. Chờ đúng điều kiện người
    // dùng có thể thao tác; click một button còn disabled là no-op và biến test
    // thành race phụ thuộc tải CPU của cả suite.
    const checkButton = screen.getByRole('button', { name: 'Kiểm tra' })
    await waitFor(() => expect(checkButton).toBeEnabled())
    // Mở thẳng PGM-05 (không đến từ nút "Kiểm tra" của workspace) thì KHÔNG tự
    // niêm phong — chỉ `location.state.autoCheck` mới được phép.
    expect(client.request).not.toHaveBeenCalledWith('createProgrammingRevision', expect.anything())
    fireEvent.click(checkButton)

    // Sau khi seal+check xong, trang tự điều hướng vào đúng revisionId/checkId
    // (D-01) và hiện lại toàn bộ panel kết quả y hệt đường deep-link cũ.
    expect(await screen.findByText('PASSED')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đưa vào vận hành…' })).not.toBeDisabled()
  })

  /* Chủ sở hữu 2026-09-27: "bấm Kiểm tra xong là bấm qua Mô phỏng được". Nút
   * "Kiểm tra" của workspace mở PGM-05 kèm `state.autoCheck`: trang tự chạy
   * seal+Check (D-01 vẫn do PGM-05 làm), đọc lại Project để `latestCheck` là
   * Check vừa xong, và khi PASSED thì đưa nút sang Mô phỏng. */
  function autoCheckMocks(options: { latestAfterSeal: boolean }) {
    let sealed = false
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: '2026-08-13T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: 'draft-1' }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
      if (operationId === 'getProgrammingProject') {
        const latestCheck = sealed && options.latestAfterSeal
          ? { checkId: CHECK_ID, revisionId: REVISION_ID, state: 'PASSED', createdAt: '2026-08-13T00:00:00Z' }
          : { checkId: 'old-check', revisionId: 'old-revision', state: 'FAILED', createdAt: '2026-08-12T00:00:00Z' }
        return Promise.resolve({ ...baseProject(), latestCheck })
      }
      if (operationId === 'createProgrammingRevision') {
        sealed = true
        return Promise.resolve({ resource: { projectId: 'project-1', revisionId: REVISION_ID }, etag: '"draft-1:2"', auditId: 'audit-1', correlationId: 'corr-1' })
      }
      if (operationId === 'createProgrammingCheck') return Promise.resolve({ checkId: CHECK_ID, statusUrl: '', state: 'QUEUED', requestHash: 'h', acceptedAt: '2026-08-13T00:00:00Z', correlationId: 'corr-2' })
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
  }

  function LocationProbe() {
    const location = useLocation()
    return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
  }

  function renderAutoCheck() {
    return render(
      <I18nProvider>
        <MemoryRouter initialEntries={[{ pathname: '/eng/programming/projects/project-1/commission', state: { autoCheck: true } }]}>
          <Routes>
            <Route element={<ProgrammingLayout />}>
              <Route path="/eng/programming/projects/:projectId/commission" element={<CheckCommissionPage />} />
            </Route>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    )
  }

  it('autoCheck: đến từ nút "Kiểm tra" thì tự chạy Check đúng một lần, PASSED thì sang được Mô phỏng', async () => {
    autoCheckMocks({ latestAfterSeal: true })
    renderAutoCheck()

    expect(await screen.findByText('PASSED')).toBeInTheDocument()
    expect(client.request.mock.calls.filter(([op]) => op === 'createProgrammingRevision')).toHaveLength(1)
    expect(client.request.mock.calls.filter(([op]) => op === 'createProgrammingCheck')).toHaveLength(1)

    const simulate = await screen.findByRole('button', { name: 'Sang Mô phỏng' })
    fireEvent.click(simulate)
    const location = await screen.findByTestId('location')
    expect(location.textContent).toContain('mode=SIMULATE')
    expect(location.textContent).toContain('project-1')
  })

  it('deep-link vào một Check PASSED không phải bản mới nhất thì không đưa nút Mô phỏng', async () => {
    autoCheckMocks({ latestAfterSeal: false })
    renderPage(true)

    expect(await screen.findByText('PASSED')).toBeInTheDocument()
    await waitFor(() => expect(client.request).toHaveBeenCalledWith('getProgrammingProject', expect.anything()))
    expect(screen.queryByRole('button', { name: 'Sang Mô phỏng' })).not.toBeInTheDocument()
    expect(client.request).not.toHaveBeenCalledWith('createProgrammingRevision', expect.anything())
  })

  it('viewer vẫn đọc được PGM-05 nhưng thấy rõ trạng thái permission và không có mutation', async () => {
    auth.role = 'viewer'
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY', activeRevisionId: 'previous-revision', lkgRevisionId: null, taskState: 'RUNNING', safeState: false, safeStateNoControllerOnly: false, observedAt: '2026-08-21T00:00:00Z' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [{ programId: 'p1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', updatedBy: 'admin', updatedAtUtcMs: 1 }] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve(passedCheck())
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderPage(true)
    await screen.findByText('PASSED')
    expect(screen.getAllByText('Bạn không có quyền thực hiện thao tác này').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Đưa vào vận hành…' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Tiến trình Kiểm tra và Đưa vào vận hành' })).toBeInTheDocument()
  })

  it('hien thi muc Log loi khi Check hoac niem phong co loi', async () => {
    client.request.mockImplementation((operationId) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve({ permissions: { read: true, programEdit: true, programActivate: true, timeWrite: true } })
      if (operationId === 'getProgrammingRuntime') return Promise.resolve({ activeRevisionId: 'old-rev', lkgRevisionId: 'old-rev', producerState: 'READY' })
      if (operationId === 'listProgrammingProjects') return Promise.resolve({ items: [{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: REVISION_ID }] })
      if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingCheck') return Promise.resolve({
        checkId: CHECK_ID, revisionId: REVISION_ID, state: 'FAILED',
        diagnostics: [{ code: 'PRG-ERR-POU-KIND-001', detailCode: 'ST-POU-001', severity: 'ERROR', message: 'Loi cau truc POU', messageKey: '' }],
        symbols: [], createdAt: '2026-08-13T00:00:00Z', attemptCount: 1
      })
      if (operationId === 'compareProgrammingRevisions') return Promise.resolve(changesWithTwoPresentGroups())
      if (operationId === 'listProgrammingOverrides') return Promise.resolve({ items: [] })
      throw new Error('unexpected operation ' + operationId)
    })

    renderPage(true)
    await screen.findByText('FAILED')
    expect(screen.getByText('Log lỗi')).toBeInTheDocument()
    expect(screen.getByText('PRG-ERR-POU-KIND-001')).toBeInTheDocument()
    expect(screen.getAllByText('Loi cau truc POU').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'Sao chép log' })).toBeInTheDocument()
  })
})
