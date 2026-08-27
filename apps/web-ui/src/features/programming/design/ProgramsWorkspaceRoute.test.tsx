import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingProject, ProgrammingProjectPage, RemoteState } from '../model/types'
import { ProgramsWorkspaceRoute } from './ProgramsWorkspaceRoute'

const state = vi.hoisted(() => ({
  projects: null as unknown as RemoteState<ProgrammingProjectPage>
}))

vi.mock('../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth')>()),
  useAuth: () => ({
    session: { username: 'admin', role: 'admin', loginAt: '2026-08-24T00:00:00Z' },
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    getAuthHeader: () => ({})
  })
}))

vi.mock('../layout/ProgrammingLayout', () => ({
  useProgrammingRuntimeContext: () => ({ projects: state.projects })
}))

vi.mock('../layout/useProgrammingViewport', () => ({
  useProgrammingMobileReadOnly: () => false
}))

vi.mock('../api/mutations', () => ({
  useCreateProgrammingProject: () => ({ createProject: vi.fn(), creating: false, error: null })
}))

vi.mock('./DesignWorkspacePage', () => ({
  DesignWorkspacePage: ({ projectIdOverride, mobileReadOnlyOverride }: { projectIdOverride?: string; mobileReadOnlyOverride?: boolean }) => (
    <output data-testid="editor">{projectIdOverride}:{String(mobileReadOnlyOverride)}</output>
  )
}))

function project(projectId: string, name = projectId): ProgrammingProject {
  return {
    projectId,
    name,
    etag: '"1"',
    activeRevisionId: null,
    draftRevisionId: `draft-${projectId}`,
    baseRevisionId: `base-${projectId}`,
    updatedAt: '2026-08-24T00:00:00Z',
    dirty: false,
    draftSequence: 1,
    activeSequence: null
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search + location.hash}</output>
}

function renderRoute(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/eng/programming/programs" element={<><ProgramsWorkspaceRoute /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  state.projects = { status: 'ready', data: { items: [] }, error: null, refresh: vi.fn() }
})
afterEach(cleanup)

describe('ProgramsWorkspaceRoute — resolver 0/1/nhiều/invalid', () => {
  it('đúng một Project và thiếu query: canonicalize bằng replace rồi mount đúng editor', async () => {
    state.projects.data = { items: [project('p1', 'Project One')] }
    renderRoute('/eng/programming/programs')
    expect(await screen.findByTestId('location')).toHaveTextContent('/eng/programming/programs?project=p1&mode=EDIT')
    expect(await screen.findByTestId('editor')).toHaveTextContent('p1:false')
  })

  it('nhiều Project và thiếu query: hiện chooser, không mount editor', () => {
    state.projects.data = { items: [project('p1', 'Project One'), project('p2', 'Project Two')] }
    renderRoute('/eng/programming/programs?line=4#source')
    expect(screen.getByText('Chọn Project')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Project One' })).toHaveAttribute('href', '/eng/programming/programs?project=p1&mode=EDIT&line=4#source')
    expect(screen.getByRole('link', { name: 'Project Two' })).toHaveAttribute('href', '/eng/programming/programs?project=p2&mode=EDIT&line=4#source')
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  it('Project invalid không fallback sang Project đầu', () => {
    state.projects.data = { items: [project('p1')] }
    renderRoute('/eng/programming/programs?project=missing&mode=EDIT')
    expect(screen.getByText('Không tìm thấy Project hoặc bạn không có quyền truy cập.')).toBeInTheDocument()
    expect(screen.getByText('Workspace không mở một Project khác để thay thế.')).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  it('0 Project: empty state, không mount editor', () => {
    renderRoute('/eng/programming/programs')
    expect(screen.getByText('Chưa có Project')).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })
})

describe('ProgramsWorkspaceRoute — canonical deep-link/mode', () => {
  beforeEach(() => {
    state.projects.data = { items: [project('p1')] }
  })

  it('sanitize direct URL, thêm alias pou và giữ hash trước khi mount', async () => {
    renderRoute('/eng/programming/programs?project=p1&program=object-1&unknown=drop#line')
    expect(await screen.findByTestId('location')).toHaveTextContent('/eng/programming/programs?project=p1&pou=object-1&mode=EDIT&program=object-1#line')
    expect(screen.getByTestId('location')).not.toHaveTextContent('unknown')
    expect(await screen.findByTestId('editor')).toHaveTextContent('p1:false')
  })

  it('mode invalid fail closed, không tự hạ về EDIT', () => {
    renderRoute('/eng/programming/programs?project=p1&mode=edit')
    expect(screen.getByText('Chế độ workspace không hợp lệ.')).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  /* `T59-811` mở LIVE ở R2; SIMULATE vẫn đóng tới R3. Điều KHÔNG đổi: chế độ
   * chưa có capability phải nói ra, không được âm thầm hiện Draft. */
  it('SIMULATE chưa implement hiển thị UNAVAILABLE thay vì Draft', () => {
    renderRoute('/eng/programming/programs?project=p1&mode=SIMULATE')
    expect(screen.getByText(/SIMULATE chưa khả dụng/)).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  it('LIVE mở được workspace, không còn chặn ở resolver', () => {
    renderRoute('/eng/programming/programs?project=p1&mode=LIVE')
    expect(screen.queryByText(/LIVE chưa khả dụng/)).toBeNull()
    expect(screen.getByTestId('editor')).toBeInTheDocument()
  })
})
