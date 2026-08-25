import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { ProgrammingLayout } from './ProgrammingLayout'

vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'admin', role: 'admin', loginAt: '2026-08-21T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => client }))

function RouteSwitch() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/eng/programming/projects/project-2/programs')}>Project 2</button>
}

function renderLayout(entry = '/eng/programming/projects/project-1/programs') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<ProgrammingLayout />}>
            <Route path="/eng/programming/projects/:projectId/programs" element={<RouteSwitch />} />
            <Route path="/eng/programming/programs" element={<div data-testid="canonical-outlet" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

/** Shell dùng chung: capabilities/runtime/projects luôn trả lời được. */
function shellRequest(operationId: string) {
  if (operationId === 'getProgrammingCapabilities') {
    return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
  }
  if (operationId === 'getProgrammingRuntime') {
    return Promise.resolve({
      schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
      activeRevisionId: 'active-1', lkgRevisionId: 'active-1', taskState: 'RUNNING',
      safeState: false, safeStateNoControllerOnly: false, observedAt: '2026-08-21T00:00:00Z'
    })
  }
  if (operationId === 'listProgrammingProjects') {
    return Promise.resolve({ items: [
      { projectId: 'project-1', name: 'Project One', draftRevisionId: 'draft-1' },
      { projectId: 'project-2', name: 'Project Two', draftRevisionId: 'draft-2' }
    ] })
  }
  return null
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  client.request.mockReset()
})
afterEach(cleanup)

describe('ProgrammingLayout — context sáu workspace', () => {
  it('không trộn snapshot intent của Project cũ trong lúc chuyển route Project', async () => {
    let resolveProject2!: (value: unknown) => void
    const project2 = new Promise((resolve) => { resolveProject2 = resolve })
    client.request.mockImplementation((operationId: string, options?: { path?: { projectId?: string } }) => {
      if (operationId === 'getProgrammingCapabilities') {
        return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
      }
      if (operationId === 'getProgrammingRuntime') {
        return Promise.resolve({
          schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
          activeRevisionId: 'active-1', lkgRevisionId: 'active-1', taskState: 'RUNNING',
          safeState: false, safeStateNoControllerOnly: false, observedAt: '2026-08-21T00:00:00Z'
        })
      }
      if (operationId === 'listProgrammingProjects') {
        return Promise.resolve({ items: [
          { projectId: 'project-1', name: 'Project One', draftRevisionId: 'draft-1' },
          { projectId: 'project-2', name: 'Project Two', draftRevisionId: 'draft-2' }
        ] })
      }
      if (operationId === 'listProgrammingProgramIntents' && options?.path?.projectId === 'project-1') {
        return Promise.resolve({ items: [
          { programId: 'program-1', desiredEnabled: true, generation: 1, runtimeState: 'RUNNING', updatedBy: 'admin', updatedAtUtcMs: 1 }
        ] })
      }
      if (operationId === 'listProgrammingProgramIntents' && options?.path?.projectId === 'project-2') return project2
      return Promise.reject(new Error(`unexpected operation ${operationId}`))
    })

    renderLayout()
    expect(await screen.findByText('1/1 muốn bật')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Project 2' }))

    expect(await screen.findByText('Project Two')).toBeInTheDocument()
    expect(screen.queryByText('1/1 muốn bật')).not.toBeInTheDocument()
    expect(screen.getAllByText('Đang tải…').length).toBeGreaterThan(0)

    resolveProject2({ items: [
      { programId: 'program-2', desiredEnabled: false, generation: 1, runtimeState: 'DISABLED', updatedBy: 'admin', updatedAtUtcMs: 2 }
    ] })
    await waitFor(() => expect(screen.getByText('0/1 muốn bật')).toBeInTheDocument())
  })

  /* `T59-802`: canonical route mang Project trong query. Khi id đó KHÔNG có
   * trong danh sách đã `ready`, resolver trả not-found — shell không được vẫn
   * gọi read-model của nó. Trước khi siết, mỗi lần mở một deep-link hỏng đều
   * để lại một dòng 503 trong Console của người dùng. */
  it('không gọi read-model cho Project không tồn tại trong danh sách đã ready', async () => {
    client.request.mockImplementation((operationId: string) => shellRequest(operationId)
      ?? Promise.reject(new Error(`unexpected operation ${operationId}`)))

    renderLayout('/eng/programming/programs?project=project-missing&mode=EDIT')
    expect(await screen.findByTestId('canonical-outlet')).toBeInTheDocument()
    await waitFor(() => expect(client.request).toHaveBeenCalledWith('listProgrammingProjects', expect.anything()))

    const intentCalls = client.request.mock.calls.filter(([operationId]) => operationId === 'listProgrammingProgramIntents')
    expect(intentCalls).toEqual([])
  })

  it('vẫn gọi read-model đúng Project khi query trỏ tới Project có thật', async () => {
    client.request.mockImplementation((operationId: string, options?: { path?: { projectId?: string } }) => {
      const shell = shellRequest(operationId)
      if (shell) return shell
      if (operationId === 'listProgrammingProgramIntents' && options?.path?.projectId === 'project-2') {
        return Promise.resolve({ items: [] })
      }
      return Promise.reject(new Error(`unexpected operation ${operationId}`))
    })

    renderLayout('/eng/programming/programs?project=project-2&mode=EDIT')
    await waitFor(() => expect(client.request).toHaveBeenCalledWith(
      'listProgrammingProgramIntents',
      expect.objectContaining({ path: { projectId: 'project-2' } })
    ))
  })
})
