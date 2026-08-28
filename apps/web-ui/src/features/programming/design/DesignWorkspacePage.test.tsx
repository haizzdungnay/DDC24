import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { DesignWorkspacePage } from './DesignWorkspacePage'
import { ProgrammingApiError } from '../api/generated/client'
import type { ProgrammingDraftDocument, ProgrammingProject } from '../model/types'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-13T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => client }))
vi.mock('../layout/ProgrammingLayout', () => ({
  useProgrammingRuntimeContext: () => ({
    setEditingContext: vi.fn(),
    capabilities: {
      status: 'ready',
      data: { schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: ['ST', 'FBD'], types: ['BOOL', 'REAL'], taskPeriodsMs: [1000, 5000, 30000], limits: {} },
      error: null,
      refresh: vi.fn()
    },
    runtime: {
      status: 'ready',
      data: { producerState: 'READY', taskState: 'RUNNING', activeRevisionId: null, task: { taskId: 'task-1', periodMs: 1000, runCount: 0 } },
      error: null,
      refresh: vi.fn()
    },
    activeRevision: { status: 'ready', data: null, error: null, refresh: vi.fn() }
  })
}))

function baseDocument(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [],
    variables: [],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: [] },
    library: { profile: 'CORE_REVA', version: '1' }
  }
}

function baseProject(): ProgrammingProject {
  return {
    projectId: 'project-1', name: 'AHU-01', etag: '"draft-1:1"',
    activeRevisionId: null, draftRevisionId: 'draft-1', baseRevisionId: 'draft-1', updatedAt: '2026-08-13T00:00:00Z',
    draft: baseDocument()
  }
}

function renderWorkspace(initialPath = '/eng/programming/projects/project-1/design') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/eng/programming/projects/:projectId/design" element={<DesignWorkspacePage />} />
          <Route path="/eng/programming/projects/:projectId/commission" element={<div>Check &amp; Commission page</div>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  auth.role = 'admin'
  client.request.mockReset()
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DesignWorkspacePage — Draft workspace (TASK-PROG-501)', () => {
  it('mobile Explorer drawer traps focus, locks scroll, closes with Escape, and restores trigger focus', async () => {
    vi.stubGlobal('innerWidth', 390)
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    renderWorkspace()
    const trigger = await screen.findByRole('button', { name: /Cây|Explorer/ })
    fireEvent.click(trigger)
    const drawer = screen.getByRole('dialog', { name: /Cây ứng dụng|Application tree/ })
    const close = within(drawer).getByRole('button', { name: /Đóng cây ứng dụng|Close explorer/ })
    expect(screen.getByRole('button', { name: /Đóng ngăn kéo|Close drawer/ })).toHaveClass('min-[1280px]:hidden')
    expect(close).toHaveClass('min-[1024px]:hidden')
    expect(document.body.style.overflow).toBe('hidden')
    expect(close).toHaveFocus()
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(within(drawer).getByRole('button', { name: /Application.*AHU-01/ })).toHaveFocus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
  })

  it('click backdrop của Inspector trả focus về trigger', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    renderWorkspace()
    const trigger = await screen.findByRole('button', { name: /Thuộc tính|Inspector/ })
    fireEvent.click(trigger)
    const backdrop = screen.getByRole('button', { name: /Đóng ngăn kéo|Close drawer/ })
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog', { name: /Thuộc tính|Inspector/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('mobile Inspector drawer traps focus, locks scroll, closes with Escape, and restores trigger focus', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    renderWorkspace()
    const trigger = await screen.findByRole('button', { name: /Thuộc tính|Inspector/ })
    fireEvent.click(trigger)
    const drawer = screen.getByRole('dialog', { name: /Thuộc tính|Inspector/ })
    const close = within(drawer).getByRole('button', { name: /Đóng thuộc tính|Close inspector/ })
    expect(screen.getByRole('button', { name: /Đóng ngăn kéo|Close drawer/ })).toHaveClass('min-[1280px]:hidden')
    expect(close).toHaveClass('min-[1280px]:hidden')
    expect(document.body.style.overflow).toBe('hidden')
    expect(close).toHaveFocus()
    // Empty Inspector only has the close control, so both directions must remain trapped there.
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Thuộc tính|Inspector/ })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
  })

  it('Explorer/Inspector triggers expose matching ARIA controls and selecting a mobile ST program closes Explorer and focuses the editor', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    renderWorkspace()
    const explorerTrigger = await screen.findByRole('button', { name: /Cây|Explorer/ })
    const inspectorTrigger = screen.getByRole('button', { name: /Thuộc tính|Inspector/ })
    expect(explorerTrigger).toHaveAttribute('aria-controls', 'programming-explorer-pane')
    expect(inspectorTrigger).toHaveAttribute('aria-controls', 'programming-inspector-pane')
    fireEvent.click(explorerTrigger)
    expect(explorerTrigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(screen.getByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).getByRole('treeitem', { name: /^Chương trình A/ }))
    await waitFor(() => expect(explorerTrigger).toHaveAttribute('aria-expanded', 'false'))
    await waitFor(() => expect(screen.getByLabelText(/Mã nguồn ST/)).toHaveFocus())
  })

  it('Giai đoạn 1: Explorer nhóm Program theo functional tag thật, có collapse và breadcrumb khớp Program được chọn', async () => {
    const project = baseProject()
    project.draft!.project.functionalTags = ['AHU', 'Bơm', 'Chiller']
    project.draft!.programs.push(
      { programId: 'fan', name: 'Quạt cấp', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM Fan\nEND_PROGRAM\n', functionalTags: ['AHU', 'sample', 'local-io'] },
      { programId: 'pump', name: 'Bơm tuần hoàn', kind: 'PROGRAM', language: 'FBD', document: '{}', functionalTags: ['Bơm'] },
      { programId: 'other', name: 'Chưa gắn nhóm', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM Other\nEND_PROGRAM\n', functionalTags: [] },
    )
    project.draft!.task.programOrder = ['fan', 'pump', 'other']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    const tree = await screen.findByRole('tree', { name: 'Cây chương trình theo nhóm chức năng' })
    const ahu = within(tree).getByRole('treeitem', { name: 'AHU, 1 chương trình' })
    const pump = within(tree).getByRole('treeitem', { name: 'Bơm, 1 chương trình' })
    const unassigned = within(tree).getByRole('treeitem', { name: 'Chưa phân nhóm, 1 chương trình' })
    expect(ahu).toHaveAttribute('aria-level', '2')
    expect(pump).toHaveAttribute('aria-expanded', 'true')
    expect(unassigned).toHaveAttribute('aria-expanded', 'true')
    expect(within(tree).getByRole('treeitem', { name: /Quạt cấp/ })).toHaveAttribute('aria-current', 'true')
    expect(within(tree).getAllByRole('treeitem').filter((item) => item.getAttribute('aria-level') === '3')).toHaveLength(project.draft!.programs.length)
    expect(within(tree).queryByRole('treeitem', { name: /sample|local-io/i })).not.toBeInTheDocument()
    expect(within(tree).queryByRole('treeitem', { name: /Chiller/ })).not.toBeInTheDocument()
    expect(within(tree).getByTitle('Tag phụ: sample, local-io')).toHaveTextContent('+2 tag')

    const breadcrumb = await screen.findByRole('navigation', { name: 'Đường dẫn chương trình' })
    expect(breadcrumb).toHaveTextContent(/AHU-01\s*\/\s*AHU\s*\/\s*Quạt cấp/)
    expect(breadcrumb.parentElement).toHaveTextContent('PROGRAM · ST')
    expect(breadcrumb.parentElement).not.toHaveTextContent('LIVE')

    fireEvent.click(ahu)
    expect(ahu).toHaveAttribute('aria-expanded', 'false')
    expect(within(tree).queryByRole('treeitem', { name: /Quạt cấp/ })).not.toBeInTheDocument()
  })

  it('tri-pane dùng từ 1280px; Explorer vẫn là cột ở tablet ngang 1024px', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    renderWorkspace()
    await screen.findByRole('button', { name: /Cây|Explorer/ })
    const grid = screen.getByText('Chưa có chương trình. Bấm + để tạo.').closest('div.grid')
    expect(grid?.className).toContain('min-[1280px]:grid-cols-[260px_1fr_300px]')
    expect(grid?.className).toContain('min-[1024px]:grid-cols-[260px_1fr]')
    expect(grid?.className).not.toContain('xl:grid-cols')
  })

  it('mobile hiển thị trạng thái Check cạnh hành động chính mà không cần cuộn tới Problems', async () => {
    const project = baseProject()
    project.latestCheck = {
      checkId: 'check-1', revisionId: 'draft-1', state: 'PASSED',
      createdAt: '2026-08-20T00:00:00Z', completedAt: '2026-08-20T00:00:01Z'
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    const status = await screen.findByLabelText('Trạng thái Check: Đạt')
    expect(status).toHaveTextContent('Check · Đạt')
    expect(status).toHaveClass('min-[1024px]:hidden')
  })

  it('đóng pane khi resize lên desktop và Ctrl+P trả focus trước khi mở palette', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    renderWorkspace()
    const trigger = await screen.findByRole('button', { name: /Cây|Explorer/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Cây ứng dụng|Application tree/ }), { key: 'p', ctrlKey: true })
    await waitFor(() => expect(trigger).toHaveFocus())
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Bảng lệnh nhanh|Command palette/ })).toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(trigger)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('')
  })

  it('đóng drawer khi chuyển sang desktop để trả lại ARIA và body scroll', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    vi.stubGlobal('innerWidth', 1024)
    renderWorkspace()
    const trigger = await screen.findByRole('button', { name: /Cây|Explorer/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).toBeInTheDocument()
    vi.stubGlobal('innerWidth', 1280)
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('')
  })

  it('mở Command Palette sẽ đóng drawer đang mở', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    renderWorkspace()
    const explorerTrigger = await screen.findByRole('button', { name: /Cây|Explorer/ })
    fireEvent.click(explorerTrigger)
    const drawer = screen.getByRole('dialog', { name: /Cây ứng dụng|Application tree/ })
    fireEvent.click(within(drawer).getByTitle(/Bảng lệnh nhanh|Command palette/))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Cây ứng dụng|Application tree/ })).not.toBeInTheDocument())
    await screen.findByRole('dialog', { name: /Bảng lệnh nhanh|Command palette/ })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Bảng lệnh nhanh|Command palette/ })).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('')
  })

  it('nạp Draft thật và cho phép thêm chương trình ST qua PATCH batch upsertProgram+setTask', async () => {
    let counter = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(counter++)
        return bytes
      }
    })
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        const document = baseDocument()
        document.programs.push({ programId: 'program-1', name: 'New program', kind: 'PROGRAM', language: 'ST', document: '' })
        document.task.programOrder = ['program-1']
        return Promise.resolve({ resource: { projectId: 'project-1', draftRevisionId: 'draft-1', content: document }, etag: '"draft-1:2"', auditId: 'audit-1', correlationId: 'corr-1' })
      }
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Chưa có chương trình. Bấm + để tạo.')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Thêm chương trình ST'))

    await waitFor(() => {
      const call = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')
      expect(call).toBeTruthy()
    })
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.ifMatch).toBe('"draft-1:1"')
    const [upsertOp, setTaskOp] = options.body.operations
    expect(upsertOp.op).toBe('upsertProgram')
    expect(upsertOp.program.language).toBe('ST')
    expect(setTaskOp.op).toBe('setTask')
    expect(setTaskOp.task.programOrder).toEqual([upsertOp.program.programId])

    await waitFor(() => expect(screen.getByRole('treeitem', { name: /^New program/ })).toBeInTheDocument())
  })

  it('WP-11: bố cục 3 cột (Cây/Editor/Inspector) theo UX §16.2 — Inspector là cột riêng, không nằm dưới editor', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Chương trình A')).toBeInTheDocument())

    // Draft có chương trình sẽ tự mở chương trình đầu tiên để người vận hành
    // không rơi vào màn hình trống; Inspector vì vậy hiển thị metadata ngay.
    const tree = screen.getByRole('navigation', { name: 'Cây ứng dụng' })
    await screen.findByLabelText(/Mã nguồn ST/)

    // Sau khi chọn: cây, editor và Inspector cùng có mặt đồng thời (3 cột),
    // không phải Inspector thay thế editor hay nằm dưới nó.
    expect(tree).toBeInTheDocument()
    expect(screen.getByLabelText(/Mã nguồn ST/)).toBeInTheDocument()
    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Thuộc tính' }))
    expect(within(inspector).getByLabelText('Tên')).toHaveValue('Chương trình A')
    expect(within(inspector).getByLabelText('Loại')).toHaveValue('PROGRAM')
  })

  it('WP-02 (CTO/Owner approval 2026-08-15 §1): dropdown Loại chỉ expose PROGRAM, không tự hiện lại FUNCTION/FUNCTION_BLOCK', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Chương trình A')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Chương trình A/ }))
    await screen.findByLabelText(/Mã nguồn ST/)

    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Thuộc tính' }))
    const kindSelect = within(inspector).getByLabelText('Loại') as HTMLSelectElement
    const options = within(kindSelect).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
    expect(options).toEqual(['PROGRAM'])
    expect(options).not.toContain('FUNCTION')
    expect(options).not.toContain('FUNCTION_BLOCK')
    expect(kindSelect).toHaveValue('PROGRAM')
    expect(within(inspector).queryByText(/chưa được Kiểm tra hỗ trợ biên dịch/)).not.toBeInTheDocument()
  })

  it('WP-02: Program có kind khác PROGRAM sẵn từ trước (import bundle) vẫn hiện đúng giá trị thật kèm cảnh báo, không bị ẩn/mất dữ liệu', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'FB cũ từ bundle', kind: 'FUNCTION_BLOCK', language: 'ST', document: 'FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('FB cũ từ bundle')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^FB cũ từ bundle/ }))
    await screen.findByLabelText(/Mã nguồn ST/)

    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Thuộc tính' }))
    // Accessible name của <select> nuốt luôn text cảnh báo trong cùng <label>
    // khi kind khác PROGRAM (span warning render bên trong label bao ngoài) —
    // dùng regex bắt đầu bằng "Loại" thay vì so khớp tuyệt đối.
    const kindSelect = within(inspector).getByLabelText(/^Loại/) as HTMLSelectElement
    const options = within(kindSelect).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
    // Chỉ đúng 2 lựa chọn: PROGRAM (luôn có) + giá trị thật hiện tại của Program
    // (FUNCTION_BLOCK) — không tự thêm lựa chọn thứ ba (FUNCTION) chưa từng
    // được backend hỗ trợ.
    expect(options.sort()).toEqual(['FUNCTION_BLOCK', 'PROGRAM'].sort())
    expect(kindSelect).toHaveValue('FUNCTION_BLOCK')
    expect(within(inspector).getByText(/Loại này chưa được Check hỗ trợ biên dịch/)).toBeInTheDocument()
  })

  it('409 giữ nguyên buffer đang gõ và hiện banner reload/merge (UX §9)', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.task.programOrder = ['program-1']

    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        return Promise.reject(
          new ProgrammingApiError(409, {
            error: { code: 'PRG-ERR-CONFLICT-001', messageKey: 'programming.conflict.revision', retryable: false, keepsRunningRevision: true, correlationId: 'corr-1', args: { expected: '"draft-1:1"', actual: '"draft-1:5"' } }
          })
        )
      }
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Chương trình A')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Chương trình A/ }))

    const textarea = await screen.findByLabelText(/Mã nguồn ST/)
    fireEvent.change(textarea, { target: { value: 'X := 2; (* chưa lưu *)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(screen.getByText('Bản nháp đã thay đổi ở phiên khác.')).toBeInTheDocument())
    // 409: buffer đang gõ KHÔNG được xoá.
    expect(textarea).toHaveValue('X := 2; (* chưa lưu *)')
  })

  it('thêm chương trình FBD mount StructuredFbdEditor thật, không placeholder (TASK-PROG-502)', async () => {
    client.request.mockImplementation((operationId: string, options?: { body?: { operations: Array<{ op: string; program?: { programId: string; document: unknown } }> } }) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        const upsertOp = options?.body?.operations.find((op) => op.op === 'upsertProgram')
        const document = baseDocument()
        document.programs.push({ programId: upsertOp!.program!.programId, name: 'FBD mới', kind: 'PROGRAM', language: 'FBD', document: upsertOp!.program!.document })
        document.task.programOrder = [upsertOp!.program!.programId]
        return Promise.resolve({ resource: { projectId: 'project-1', draftRevisionId: 'draft-1', content: document }, etag: '"draft-1:2"', auditId: 'audit-1', correlationId: 'corr-1' })
      }
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByTitle('Thêm chương trình FBD')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Thêm chương trình FBD'))

    // StructuredFbdEditor render toolbar lệnh thật — không phải chữ placeholder cũ.
    await waitFor(() => expect(screen.queryByText(/mount ở TASK-PROG-502/)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Lệnh FBD' })).toBeInTheDocument())
  })

  it('nút Kiểm tra điều hướng sang PGM-03 (Check & Commission), không tự seal/check (D-01)', async () => {
    const project = baseProject()
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kiểm tra' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))

    await waitFor(() => expect(screen.getByText('Check & Commission page')).toBeInTheDocument())
    // D-01: PGM-02 không được tự gọi seal/Check — đó là việc của PGM-03 giờ.
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'createProgrammingRevision')).toBe(false)
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'createProgrammingCheck')).toBe(false)
  })

  it('URL mang line/column/length (điều hướng từ Problems ở PGM-03) nhảy đúng vùng chọn trong ST editor (F-PROG-ASBUILT-003)', async () => {
    const source = 'PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := ;\nEND_PROGRAM\n'
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?tab=programs&program=program-1&line=3&column=6&length=1')

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    const expectedOffset = source.indexOf('X := ;') + 5 // vị trí ';' — cột 6, dòng 3
    await waitFor(() => expect(textarea.selectionStart).toBe(expectedOffset))
    expect(textarea.selectionEnd).toBe(expectedOffset + 1)
  })

  it('giữ dirty state, chặn Check/beforeunload và Ctrl+S lưu đúng buffer ST', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'VAR\n  Supply : REAL;\nEND_VAR\nSupply := 1;' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string, options?: { body?: { operations: unknown[] } }) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        const updated = structuredClone(project)
        updated.draft!.programs[0].document = 'VAR\n  Supply : REAL;\nEND_VAR\nSupply := 2;'
        updated.etag = '"draft-1:2"'
        return Promise.resolve({ resource: { projectId: 'project-1', draftRevisionId: 'draft-1', content: updated.draft }, etag: updated.etag, auditId: 'audit-2', correlationId: 'corr-2' })
      }
      throw new Error(`unexpected operation ${operationId} ${String(options)}`)
    })

    renderWorkspace()
    fireEvent.click(await screen.findByText('Điều khiển AHU'))
    const textarea = await screen.findByLabelText(/Mã nguồn ST/)
    fireEvent.change(textarea, { target: { value: 'VAR\n  Supply : REAL;\nEND_VAR\nSupply := 2;' } })

    await waitFor(() => expect(screen.getByText(/Draft có thay đổi chưa lưu/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Kiểm tra' })).toBeDisabled()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true })

    await waitFor(() => expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(true))
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.body.operations).toEqual([{ op: 'replaceProgramSource', programId: 'program-1', language: 'ST', source: 'VAR\n  Supply : REAL;\nEND_VAR\nSupply := 2;' }])
  })

  it('xóa Program hỏi xác nhận rồi gửi batch removeBinding+removeVariable+removeProgram+setTask', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.variables.push({ variableId: 'var-1', programId: 'program-1', name: 'X', type: 'REAL', class: 'LOCAL', initialValue: 0, retain: false })
    project.draft!.bindings.push({
      bindingId: 'bind-1', variableId: 'var-1', point: { category: 'VP', pointId: 'p1' },
      direction: 'READ', dataType: 'REAL', writable: false, qualityPolicy: 'REQUIRE_GOOD'
    })
    project.draft!.task.programOrder = ['program-1']

    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        return Promise.resolve({
          resource: { projectId: 'project-1', draftRevisionId: 'draft-1', content: baseDocument() },
          etag: '"draft-1:2"', auditId: 'audit-1', correlationId: 'corr-1'
        })
      }
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Điều khiển AHU')).toBeInTheDocument())
    expect(screen.queryByText('Xóa chương trình?')).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Cây ứng dụng' })).getByTitle(/^Xóa chương trình/))
    const dialog = screen.getByRole('dialog', { name: 'Xóa chương trình?' })
    expect(within(dialog).getByText(/Điều khiển AHU/)).toHaveTextContent('Không thể hoàn tác sau khi lưu.')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }))

    await waitFor(() => {
      const call = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')
      expect(call).toBeTruthy()
    })
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.body.operations).toEqual([
      { op: 'removeBinding', bindingId: 'bind-1' },
      { op: 'removeVariable', variableId: 'var-1' },
      { op: 'removeProgram', programId: 'program-1' },
      { op: 'setTask', task: { taskId: 'task-1', periodMs: 1000, programOrder: [] } }
    ])
    await waitFor(() => expect(screen.queryByText('Xóa chương trình?')).not.toBeInTheDocument())
  })
})

describe('DesignWorkspacePage — ST Editor Quick Control (đã duyệt, decisions #01-04)', () => {
  it('Ctrl+P mở Bảng lệnh nhanh, Escape đóng — không tự Lưu/Kiểm tra', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM P\nVAR\n  Supply : REAL;\nEND_VAR\nEND_PROGRAM\n' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Điều khiển AHU')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Điều khiển AHU/ }))
    const textarea = await screen.findByLabelText(/Mã nguồn ST/)

    fireEvent.keyDown(textarea, { key: 'p', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Bảng lệnh nhanh' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bảng lệnh nhanh' })).not.toBeInTheDocument())

    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })

  it('Bảng lệnh nhanh: chọn biến ở Program KHÁC — đổi Program đang mở và chọn đúng vùng, không tự Lưu (tìm xuyên Draft, quyết định #04)', async () => {
    const sourceA = 'PROGRAM A\nVAR\n  Supply : REAL;\nEND_VAR\nEND_PROGRAM\n'
    const sourceB = 'PROGRAM B\nVAR\n  Backup : REAL;\nEND_VAR\nEND_PROGRAM\n'
    const project = baseProject()
    project.draft!.programs.push(
      { programId: 'program-a', name: 'Program A', kind: 'PROGRAM', language: 'ST', document: sourceA },
      { programId: 'program-b', name: 'Program B', kind: 'PROGRAM', language: 'ST', document: sourceB },
    )
    project.draft!.task.programOrder = ['program-a', 'program-b']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Program A')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Program A/ }))
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    expect(textarea).toHaveValue(sourceA)

    fireEvent.keyDown(textarea, { key: 'p', ctrlKey: true })
    const input = screen.getByPlaceholderText(/Nhảy tới Program, biến/)
    fireEvent.change(input, { target: { value: 'Backup' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)).toHaveValue(sourceB))
    const nextTextarea = screen.getByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    const expectedOffset = sourceB.indexOf('Backup')
    await waitFor(() => expect(nextTextarea.selectionStart).toBe(expectedOffset))
    expect(nextTextarea.selectionEnd).toBe(expectedOffset + 'Backup'.length)
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })

  it('Bảng lệnh nhanh: mục "Kiểm tra" điều hướng sang PGM-03 giống hệt nút Kiểm tra (D-01) — chỉ khi người dùng chủ động chọn', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM P\nEND_PROGRAM\n' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Điều khiển AHU')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Điều khiển AHU/ }))
    const textarea = await screen.findByLabelText(/Mã nguồn ST/)

    fireEvent.keyDown(textarea, { key: 'p', ctrlKey: true })
    const input = screen.getByPlaceholderText(/Nhảy tới Program, biến/)
    fireEvent.change(input, { target: { value: 'Kiểm tra' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Check & Commission page')).toBeInTheDocument())
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'createProgrammingCheck')).toBe(false)
  })

  it('Thanh lệnh nhanh vùng chọn: Ghi chú bọc (* … *) quanh đúng vùng chọn — chỉ đổi buffer, không tự Lưu/Kiểm tra', async () => {
    const source = 'PROGRAM P\n  X := 1;\nEND_PROGRAM\n'
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Điều khiển AHU')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Điều khiển AHU/ }))
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)

    const start = source.indexOf('X := 1;')
    const end = start + 'X := 1;'.length
    textarea.setSelectionRange(start, end)
    fireEvent.select(textarea)

    fireEvent.click(await screen.findByRole('button', { name: /Ghi chú/ }))
    expect(textarea.value).toBe('PROGRAM P\n  (* X := 1; *)\nEND_PROGRAM\n')
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })

  it('Thanh lệnh nhanh vùng chọn: Bọc IF chèn khung IF TRUE THEN…END_IF quanh dòng đã chọn, điều kiện TRUE được chọn sẵn — chỉ FOR/WHILE bị loại vì compiler chưa hỗ trợ (ST_SUBSET_SPEC §5.5), KHÔNG có trong danh sách nút', async () => {
    const source = 'PROGRAM P\n  X := 1;\nEND_PROGRAM\n'
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Điều khiển AHU')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Điều khiển AHU/ }))
    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)

    const start = source.indexOf('X := 1;')
    const end = start + 'X := 1;'.length
    textarea.setSelectionRange(start, end)
    fireEvent.select(textarea)

    const toolbar = await screen.findByRole('toolbar', { name: 'Lệnh nhanh vùng chọn' })
    expect(within(toolbar).queryByText(/FOR|WHILE/)).not.toBeInTheDocument()
    fireEvent.click(within(toolbar).getByRole('button', { name: /Bọc IF/ }))

    expect(textarea.value).toBe('PROGRAM P\n  IF TRUE THEN\n    X := 1;\n  END_IF;\nEND_PROGRAM\n')
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('TRUE')
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })

  it('Panel chèn nhanh Point/Variable: mở panel gọi GET /point-catalog đúng một lần thêm, đóng-mở lại KHÔNG gọi lại (cache, quyết định #02)', async () => {
    // Lưu ý: `MappingTab` (luôn mount nền theo TASK-PROG-506) tự poll
    // point-catalog độc lập, đếm TUYỆT ĐỐI ("chưa từng gọi") sẽ sai — đếm
    // theo DELTA quanh việc mở panel mới đúng là điều quyết định #02 cần.
    const source = 'PROGRAM P\nEND_PROGRAM\n'
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') {
        return Promise.resolve({ items: [{ category: 'LOCAL', pointId: 'AO-01', name: 'AO-01', dataType: 'REAL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: 1 }] })
      }
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByText('Điều khiển AHU')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('treeitem', { name: /^Điều khiển AHU/ }))
    await screen.findByLabelText(/Mã nguồn ST/)

    const countCatalogCalls = () => client.request.mock.calls.filter(([operationId]) => operationId === 'getProgrammingPointCatalog').length
    const before = countCatalogCalls()

    fireEvent.click(screen.getByRole('button', { name: 'Chèn Point/Variable' }))
    await waitFor(() => expect(countCatalogCalls()).toBe(before + 1))
    await waitFor(() => expect(screen.getByText('AO-01')).toBeInTheDocument())

    // Đóng rồi mở lại — dùng cache, không thêm request nào nữa.
    fireEvent.click(screen.getByRole('button', { name: 'Chèn Point/Variable' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chèn Point/Variable' }))
    await waitFor(() => expect(screen.getByText('AO-01')).toBeInTheDocument())
    expect(countCatalogCalls()).toBe(before + 1)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    fireEvent.click(screen.getByText('AO-01'))
    expect(textarea.value).toContain('AO-01')
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })
})
