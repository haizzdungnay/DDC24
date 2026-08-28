import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingProjectPage, RemoteState } from '../model/types'
import { ProgrammingLayout } from './ProgrammingLayout'

vi.mock('../../auth', () => ({ useAuth: () => ({ session: { role: 'admin' } }) }))

const queryState = vi.hoisted(() => ({
  projects: null as RemoteState<ProgrammingProjectPage> | null
}))

vi.mock('../api/queries', () => ({
  useProgrammingCapabilities: () => ({ status: 'ready', data: { schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: ['ST'], types: ['REAL'], taskPeriodsMs: [], limits: {} }, error: null, refresh: vi.fn(), lastSuccessAt: Date.now() }),
  useProgrammingRevision: () => ({ status: 'ready', data: { revisionId: 'active-1', projectId: 'project-1', baseRevisionId: 'base-1', createdAt: '2026-08-20T00:00:00Z', sourceHash: 'hash', manifestHash: 'manifest' }, error: null, refresh: vi.fn(), lastSuccessAt: Date.now() }),
  useProgrammingRuntime: () => ({
    status: 'ready',
    data: {
      schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
      activeRevisionId: 'active-1', lkgRevisionId: null, taskState: 'RUNNING', safeState: false,
      safeStateNoControllerOnly: false, observedAt: '2026-08-19T00:00:00Z'
    },
    error: null,
    refresh: vi.fn(),
    lastSuccessAt: Date.now()
  }),
  useProgrammingProjects: () => queryState.projects
}))

function projectState(items: ProgrammingProjectPage['items']): RemoteState<ProgrammingProjectPage> {
  return { status: 'ready', data: { items }, error: null, refresh: vi.fn(), lastSuccessAt: Date.now() }
}

function renderPath(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProgrammingLayout />}>
            <Route path="/eng/programming" element={<div>Overview child</div>} />
            <Route path="/eng/programming/projects/:projectId/design" element={<button type="button">Mutation child</button>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  queryState.projects = projectState([{ projectId: 'project-1', name: 'AHU-01', draftRevisionId: 'draft-1' } as ProgrammingProjectPage['items'][number]])
})
afterEach(cleanup)

describe('ProgrammingLayout project route guard', () => {
  it('route không có projectId giữ flow Overview và dùng project đầu cho điều hướng', async () => {
    renderPath('/eng/programming')
    expect(await screen.findByText('Overview child')).toBeInTheDocument()
    expect(screen.getAllByText('AHU-01').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Thiết kế' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Thiết kế' })[0]).toHaveAttribute('href', '/eng/programming/projects/project-1/design')
  })

  it('ID hợp lệ dựng đúng workspace và context', async () => {
    renderPath('/eng/programming/projects/project-1/design')
    expect(await screen.findByRole('button', { name: 'Mutation child' })).toBeInTheDocument()
    expect(screen.getAllByText('AHU-01').length).toBeGreaterThan(0)
  })

  it('ID không tồn tại giữ URL nhưng không mount mutation surface hay fallback project đầu', async () => {
    renderPath('/eng/programming/projects/project-khong-ton-tai/design')
    expect(await screen.findByText('Project không tồn tại.')).toBeInTheDocument()
    expect(screen.getAllByText(/project-khong-ton-tai/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Mutation child' })).not.toBeInTheDocument()
    expect(screen.queryByText('AHU-01')).not.toBeInTheDocument()
  })

  it('lỗi danh sách Project fail-closed và cho GET retry', async () => {
    const refresh = vi.fn()
    queryState.projects = { status: 'error', data: null, error: '503 unavailable', refresh, lastSuccessAt: null }
    renderPath('/eng/programming/projects/project-1/design')
    expect(await screen.findByText('Không xác minh được Project.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mutation child' })).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Thử lại' }).click()
    expect(refresh).toHaveBeenCalledOnce()
  })
})
