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

/**
 * `ISS-PGUI-01` — route THEO Project chỉ được hiện Active/Running khi gói đang
 * chạy thật sự thuộc Project đó.
 *
 * Shell từng đổ `runtime.activeRevisionId` (read model của CONTROLLER) thẳng
 * vào dải ngữ cảnh và vào popover `Chi tiết`. Mở Project nào cũng thấy
 * `Active: Yes` và thấy UUID của gói đang chạy — kể cả khi gói ấy là của
 * Project khác (`PC-001`).
 */
describe('ProgrammingLayout — ISS-PGUI-01', () => {
  /** Danh sách hai Project: gói `active-2` đang chạy và thuộc `project-2`. */
  function ownershipShell(operationId: string) {
    if (operationId === 'getProgrammingCapabilities') {
      return Promise.resolve({ schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: [], types: [], taskPeriodsMs: [], limits: {} })
    }
    if (operationId === 'getProgrammingRuntime') {
      return Promise.resolve({
        schemaVersion: '1.0', controllerId: 'controller-local', producerState: 'READY',
        activeRevisionId: 'active-2', lkgRevisionId: 'active-2', taskState: 'RUNNING',
        safeState: false, safeStateNoControllerOnly: false, observedAt: '2026-09-03T00:00:00Z'
      })
    }
    if (operationId === 'listProgrammingProjects') {
      return Promise.resolve({ items: [
        { projectId: 'project-1', name: 'AHU-MASTER-SEQUENCE', draftRevisionId: 'draft-1', activeRevisionId: null, activeSequence: null, draftSequence: 3 },
        { projectId: 'project-2', name: 'SOAK-10P-20260824-172521', draftRevisionId: 'draft-2', activeRevisionId: 'active-2', activeSequence: 20, draftSequence: 21 }
      ] })
    }
    if (operationId === 'listProgrammingProgramIntents') return Promise.resolve({ items: [] })
    return null
  }

  function stubOwnershipShell() {
    client.request.mockImplementation((operationId: string) => ownershipShell(operationId)
      ?? Promise.reject(new Error(`unexpected operation ${operationId}`)))
  }

  function activeField(container: HTMLElement): HTMLElement {
    const element = container.querySelector<HTMLElement>('[data-context-field="active"]')
    if (!element) throw new Error('không có dữ kiện "active" trên Context Strip')
    return element
  }

  it('mở Project KHÔNG chạy gói ⇒ Active không phải "Có" và nói rõ gói thuộc Project nào', async () => {
    stubOwnershipShell()
    const { container } = renderLayout('/eng/programming/projects/project-1/programs')

    await screen.findByTestId('programming-context-strip-row')
    await waitFor(() => expect(activeField(container).textContent)
      .toContain('Gói đang chạy thuộc SOAK-10P-20260824-172521'))
    expect(activeField(container).textContent).not.toContain('Có')
  })

  /* Popover `Chi tiết` là chỗ thứ hai đọc cùng con số ấy. In UUID của gói
     Project khác vào đây là mượn dữ liệu của Project khác — điều tiêu chí cấm
     thẳng — và người vận hành sẽ chép đúng UUID đó đi tra cứu. */
  it('popover Chi tiết KHÔNG mượn UUID gói đang chạy của Project khác', async () => {
    stubOwnershipShell()
    renderLayout('/eng/programming/projects/project-1/programs')

    fireEvent.click(await screen.findByRole('button', { name: /Chi tiết/ }))
    const popover = await screen.findByRole('dialog')
    /* Đọc ĐÚNG hàng `ID Revision đang vận hành`. Hàng LKG bên dưới cũng mang
       `active-2` và nó ĐƯỢC PHÉP: LKG là dữ kiện của bộ điều khiển, không phải
       một khẳng định về Project đang mở. */
    const activeRow = await waitFor(() => {
      const found = popover.querySelector<HTMLElement>('[data-detail-row="activeRevisionId"]')
      if (!found) throw new Error('không có hàng activeRevisionId trong popover Chi tiết')
      return found
    })
    expect(activeRow.textContent).not.toContain('active-2')
    // Và ô trống phải nói ĐÚNG lý do, không đổ cho "chưa Commission".
    expect(activeRow.textContent).toContain('Gói đang vận hành thuộc Project khác')
  })

  it('mở ĐÚNG Project đang chạy ⇒ giữ nguyên số hiệu và UUID như cũ', async () => {
    stubOwnershipShell()
    const { container } = renderLayout('/eng/programming/projects/project-2/programs')

    await screen.findByTestId('programming-context-strip-row')
    await waitFor(() => expect(activeField(container).textContent).toContain('r20'))
    fireEvent.click(screen.getByRole('button', { name: /Chi tiết/ }))
    const popover = await screen.findByRole('dialog')
    await waitFor(() => expect(
      popover.querySelector('[data-detail-row="activeRevisionId"]')?.textContent
    ).toContain('active-2'))
  })
})
