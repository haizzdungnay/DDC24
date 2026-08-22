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

function renderLayout() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming/projects/project-1/programs']}>
        <Routes>
          <Route element={<ProgrammingLayout />}>
            <Route path="/eng/programming/projects/:projectId/programs" element={<RouteSwitch />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
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
})
