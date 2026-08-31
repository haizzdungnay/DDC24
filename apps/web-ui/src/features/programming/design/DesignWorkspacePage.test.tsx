import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { DesignWorkspacePage } from './DesignWorkspacePage'
import { ProgrammingApiError } from '../api/generated/client'
import type { ProgrammingDraftDocument, ProgrammingProject } from '../model/types'
import type { ProgrammingRuntimeMonitorState } from '../api/queries'
import { slotKey } from './editor/ProgramsTab'

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
const runtimeMonitor = vi.hoisted(() => ({
  state: null as unknown as ProgrammingRuntimeMonitorState,
  enabled: vi.fn(),
}))
vi.mock('../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/queries')>()
  return {
    ...actual,
    useProgrammingRuntimeMonitor: (enabled = true) => {
      runtimeMonitor.enabled(enabled)
      return runtimeMonitor.state
    },
  }
})
vi.mock('../layout/ProgrammingLayout', () => ({
  useProgrammingRuntimeContext: () => ({ setEditingContext: vi.fn() })
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
    // `T60-015`: server luôn gửi ba khoá này, kể cả khi giá trị là `null`.
    dirty: false, draftSequence: 1, activeSequence: null,
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

function stubMobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    media: '(max-width: 767px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })))
}

beforeEach(() => {
  auth.role = 'admin'
  client.request.mockReset()
  runtimeMonitor.state = {
    status: 'ready',
    data: { schemaVersion: '1.0', activeRevisionId: null, safeState: false, task: null, items: [] },
    error: null,
    failure: null, producerRestarted: false,
    refresh: vi.fn()
  }
  runtimeMonitor.enabled.mockClear()
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Chọn một POU theo tên trong CÂY POU.
 *
 * Không dùng `screen.getByText(<tên>)` nữa: từ `PR #311`, tab Điểm & Ánh xạ
 * (luôn mounted, chỉ ẩn bằng CSS) có một `<select>` liệt kê Program, nên mỗi
 * tên POU xuất hiện HAI lần trong DOM — một ở cây, một ở `<option>`. `getByText`
 * khi đó ném "found multiple elements" cho một trang hoàn toàn đúng.
 *
 * Bám vào tên truy cập của nút trong cây (`Mở <tên>`) là bám đúng thứ case này
 * nói tới, và nó không vỡ khi một bề mặt khác cũng nhắc tới cùng cái tên.
 */
function pouInTree(name: string) {
  return screen.findByRole('button', { name: `Mở ${name}` })
}

describe('DesignWorkspacePage — Draft workspace (TASK-PROG-501)', () => {
  it('không mount Published Signals trên route Mapping', async () => {
    const project = baseProject()
    project.draft = {
      schemaVersion: 2,
      project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
      objects: [{
        objectId: '22222222-2222-4222-8222-222222222222',
        kind: 'PROGRAM',
        name: 'AirHandler',
        language: 'ST',
        source: 'PROGRAM AirHandler\nEND_PROGRAM',
        interface: { inputs: [], outputs: [] },
        locals: [],
        dependencies: []
      }],
      programs: [{
        programId: '11111111-1111-4111-8111-111111111111',
        objectId: '22222222-2222-4222-8222-222222222222',
        periodMs: 1000
      }],
      signals: [{
        signalId: '44444444-4444-4444-8444-444444444444',
        name: 'SupplyTemp',
        type: 'REAL',
        unit: 'degC',
        publisherProgramId: '11111111-1111-4111-8111-111111111111',
        freshnessMs: 5000,
        stalePolicy: 'HOLD_LAST'
      }],
      bindings: [],
      library: { systemProfile: 'CORE_REVA', systemVersion: '1', projectLibraryRevisionId: null },
      execution: {}
    } as unknown as ProgrammingDraftDocument
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?tab=mapping')

    expect(await screen.findByRole('tab', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('table', { name: 'Bảng Published Signal của bản nháp' })).not.toBeInTheDocument()
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
        document.programs.push({ programId: 'program-1', name: 'NewProgram', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM NewProgram\nEND_PROGRAM\n' })
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
    expect(upsertOp).toEqual({
      op: 'upsertProgram',
      program: {
        programId: expect.any(String),
        name: 'NewProgram',
        kind: 'PROGRAM',
        language: 'ST',
        document: 'PROGRAM NewProgram\nEND_PROGRAM\n',
      },
    })
    expect(upsertOp.program).not.toHaveProperty('executionOrder')
    expect(upsertOp.program).not.toHaveProperty('functionalTags')
    expect(setTaskOp.op).toBe('setTask')
    expect(setTaskOp.task.programOrder).toEqual([upsertOp.program.programId])

    // `getAllBy` vì mỗi POU nay có thêm nút Đổi tên/Nhân bản/Xóa mang chính
    // tên POU trong nhãn — chọn đúng nút MỞ POU thay vì khẳng định "duy nhất".
    await waitFor(() => expect(screen.getAllByRole('button', { name: /NewProgram/ }).length).toBeGreaterThan(0))
  })

  it('ghi thuộc tính Program bằng payload v2 hẹp và chặn tên POU backend sẽ từ chối', async () => {
    const project = baseProject()
    project.draft!.programs.push({
      programId: 'program-1', name: 'ValidName', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM ValidName\nEND_PROGRAM\n', executionOrder: 0, functionalTags: ['legacy-view-only']
    })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        return Promise.resolve({
          resource: { projectId: 'project-1', draftRevisionId: 'draft-1', content: project.draft },
          etag: '"draft-1:2"', auditId: 'audit-1', correlationId: 'corr-1'
        })
      }
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    fireEvent.click(await pouInTree('ValidName'))
    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
    expect(within(inspector).queryByText('Tag chức năng')).not.toBeInTheDocument()

    const nameInput = within(inspector).getByLabelText('Tên')
    fireEvent.change(nameInput, { target: { value: 'New program' } })
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(within(inspector).getByText(/Tên phải bắt đầu bằng chữ/)).toBeInTheDocument()
    expect(within(inspector).getByRole('button', { name: 'Lưu thuộc tính' })).toBeDisabled()
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)

    fireEvent.change(nameInput, { target: { value: 'New_Name' } })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Lưu thuộc tính' }))
    await waitFor(() => expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(true))
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.body.operations).toEqual([{
      op: 'upsertProgram',
      program: {
        programId: 'program-1', name: 'New_Name', kind: 'PROGRAM', language: 'ST',
        document: 'PROGRAM ValidName\nEND_PROGRAM\n'
      }
    }])
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
    await pouInTree('Chương trình A')

    // Chưa chọn chương trình nào: cột Inspector vẫn tồn tại, hiện trạng thái trống.
    const tree = screen.getByRole('navigation', { name: 'Cây POU' })
    const inspectorEmpty = screen.getByRole('complementary', { name: 'Thuộc tính' })
    expect(within(inspectorEmpty).getByText('Chọn một chương trình để xem thuộc tính.')).toBeInTheDocument()

    fireEvent.click(await pouInTree('Chương trình A'))
    await screen.findByLabelText(/Mã nguồn ST/)

    // Sau khi chọn: cây, editor và Inspector cùng có mặt đồng thời (3 cột),
    // không phải Inspector thay thế editor hay nằm dưới nó.
    expect(tree).toBeInTheDocument()
    expect(screen.getByLabelText(/Mã nguồn ST/)).toBeInTheDocument()
    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
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
    await pouInTree('Chương trình A')
    fireEvent.click(await pouInTree('Chương trình A'))
    await screen.findByLabelText(/Mã nguồn ST/)

    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
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
    await pouInTree('FB cũ từ bundle')
    fireEvent.click(await pouInTree('FB cũ từ bundle'))
    await screen.findByLabelText(/Mã nguồn ST/)

    const inspector = screen.getByRole('complementary', { name: 'Thuộc tính' })
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
    expect(within(inspector).getByText(/chưa được Kiểm tra hỗ trợ biên dịch/)).toBeInTheDocument()
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
    await pouInTree('Chương trình A')
    fireEvent.click(await pouInTree('Chương trình A'))

    const textarea = await screen.findByLabelText(/Mã nguồn ST/)
    fireEvent.change(textarea, { target: { value: 'X := 2; (* chưa lưu *)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(screen.getByText('Bản nháp đã thay đổi ở phiên khác.')).toBeInTheDocument())
    // 409: buffer đang gõ KHÔNG được xoá.
    expect(textarea).toHaveValue('X := 2; (* chưa lưu *)')
  })

  it('thêm chương trình FBD mount StructuredFbdEditor thật, không placeholder (TASK-PROG-502)', async () => {
    client.request.mockImplementation((operationId: string, options?: { body?: { operations: Array<{ op: string; program?: { programId: string; name: string; document: unknown } }> } }) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'updateProgrammingDraft') {
        const upsertOp = options?.body?.operations.find((op) => op.op === 'upsertProgram')
        const document = baseDocument()
        document.programs.push({ programId: upsertOp!.program!.programId, name: upsertOp!.program!.name, kind: 'PROGRAM', language: 'FBD', document: upsertOp!.program!.document })
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

  it('AC-PGM02-009 / AC-ST-004: nút Kiểm tra điều hướng sang PGM-03, không tự seal/check nên Active không đổi (D-01)', async () => {
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
    fireEvent.click(await pouInTree('Điều khiển AHU'))
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

  it('xóa Program hỏi xác nhận rồi gửi batch removeBinding+removeVariable+removeProgram+removeObject', async () => {
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
    await pouInTree('Điều khiển AHU')
    expect(screen.queryByText('Xóa chương trình?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle(/^Xóa /))
    const dialog = screen.getByRole('dialog', { name: 'Xóa POU?' })
    expect(within(dialog).getByText(/Điều khiển AHU/)).toHaveTextContent('Không thể hoàn tác sau khi lưu.')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }))

    await waitFor(() => {
      const call = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')
      expect(call).toBeTruthy()
    })
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    // `F-P59-DELETE-PROGRAM-001`: batch KHÔNG còn `setTask` (Draft v2 giữ chu kỳ
    // theo từng Program, và `setTaskCompat` sẽ ghi đè chu kỳ của mọi Program
    // trong danh sách), và PHẢI có `removeObject` — thiếu nó thì POU vẫn nằm
    // trong Draft và vẫn hiện trên danh sách sau khi "xóa" thành công.
    expect(options.body.operations).toEqual([
      { op: 'removeBinding', bindingId: 'bind-1' },
      { op: 'removeVariable', variableId: 'var-1' },
      { op: 'removeProgram', programId: 'program-1' },
      { op: 'removeObject', objectId: 'program-1' }
    ])
    await waitFor(() => expect(screen.queryByText('Xóa chương trình?')).not.toBeInTheDocument())
  })

  /** `F-P59-DELETE-PROGRAM-001` — user FUNCTION/FUNCTION_BLOCK KHÔNG có cấu hình
   *  chạy trong `programs[]`. Bản trước vẫn gửi `removeProgram` cho chúng, và
   *  backend trả `PRG-ERR-REQ-001` vì không tìm thấy id — nghĩa là xóa một
   *  FUNCTION do người dùng tạo chưa bao giờ thành công. */
  it('xóa user FUNCTION chỉ gửi removeObject, không gửi removeProgram', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'fn-1', objectId: 'fn-1', name: 'SCALE_LIN', kind: 'FUNCTION', language: 'ST', document: 'FUNCTION SCALE_LIN : REAL\nEND_FUNCTION\n' })
    project.draft!.task.programOrder = []

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
    await pouInTree('SCALE_LIN')
    fireEvent.click(screen.getByTitle(/^Xóa /))
    const dialog = screen.getByRole('dialog', { name: 'Xóa POU?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }))

    await waitFor(() => {
      expect(client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')).toBeTruthy()
    })
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.body.operations).toEqual([{ op: 'removeObject', objectId: 'fn-1' }])
  })

  /** Chương trình "ma": POU kind PROGRAM còn trong `objects[]` nhưng đã mất mục
   *  trong `programs[]` — di chứng của lỗi xoá cũ, đo thật trên bo Foxlinx
   *  2026-08-24. Gửi `removeProgram` cho nó trả `operations[0].removeProgram`,
   *  nghĩa là người dùng KHÔNG bao giờ xoá được nó: vòng lặp chết. */
  it('xóa PROGRAM không có cấu hình chạy chỉ gửi removeObject', async () => {
    const project = baseProject()
    project.draft!.programs.push({
      programId: 'ghost-1', objectId: 'ghost-1', hasRuntimeConfig: false,
      name: 'AHU_MasterSequence', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM P\nEND_PROGRAM\n'
    })
    project.draft!.task.programOrder = []

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
    await pouInTree('AHU_MasterSequence')
    fireEvent.click(screen.getByTitle(/^Xóa /))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Xóa POU?' })).getByRole('button', { name: 'Xóa' }))

    await waitFor(() => {
      expect(client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')).toBeTruthy()
    })
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.body.operations).toEqual([{ op: 'removeObject', objectId: 'ghost-1' }])
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
    await pouInTree('Điều khiển AHU')
    fireEvent.click(await pouInTree('Điều khiển AHU'))
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
    await pouInTree('Program A')
    fireEvent.click(await pouInTree('Program A'))
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
    await pouInTree('Điều khiển AHU')
    fireEvent.click(await pouInTree('Điều khiển AHU'))
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
    await pouInTree('Điều khiển AHU')
    fireEvent.click(await pouInTree('Điều khiển AHU'))
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
    await pouInTree('Điều khiển AHU')
    fireEvent.click(await pouInTree('Điều khiển AHU'))
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
    await pouInTree('Điều khiển AHU')
    fireEvent.click(await pouInTree('Điều khiển AHU'))
    await screen.findByLabelText(/Mã nguồn ST/)

    const countCatalogCalls = () => client.request.mock.calls.filter(([operationId]) => operationId === 'getProgrammingPointCatalog').length
    const before = countCatalogCalls()

    /* Từ `PR #311`, tab Điểm & Ánh xạ (luôn mounted) cũng liệt kê `AO-01`, nên
       phép chọn phải soi ĐÚNG panel chèn nhanh — thứ case này nói tới. */
    const insertPanel = () => screen.getByRole('dialog', { name: 'Chèn nhanh Point/Variable' })

    fireEvent.click(screen.getByRole('button', { name: 'Chèn Point/Variable' }))
    await waitFor(() => expect(countCatalogCalls()).toBe(before + 1))
    await waitFor(() => expect(within(insertPanel()).getByText('AO-01')).toBeInTheDocument())

    // Đóng rồi mở lại — dùng cache, không thêm request nào nữa.
    fireEvent.click(screen.getByRole('button', { name: 'Chèn Point/Variable' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chèn Point/Variable' }))
    await waitFor(() => expect(within(insertPanel()).getByText('AO-01')).toBeInTheDocument())
    expect(countCatalogCalls()).toBe(before + 1)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    fireEvent.click(within(insertPanel()).getByText('AO-01'))
    expect(textarea.value).toContain('AO-01')
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })
})

describe('DesignWorkspacePage — nối runtime/POU T59-506', () => {
  it('EDIT không subscribe/chiếu Active overlay lên Draft dù monitor có dữ liệu', async () => {
    const project = baseProject()
    project.activeRevisionId = 'revision-active'
    project.draft!.programs.push({
      programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU\nEND_PROGRAM\n'
    })
    project.draft!.task.programOrder = ['program-1']
    runtimeMonitor.state = {
      status: 'ready', error: null, failure: null, producerRestarted: false, refresh: vi.fn(),
      data: {
        schemaVersion: '1.0', activeRevisionId: 'revision-active', producer: { capturedMonotonicNs: '1000' }, safeState: false, task: null,
        items: [
          {
            variableId: 'variable-zero', variableName: 'OutputZero', programId: 'program-1',
            point: { category: 'LOCAL', pointId: 'AO-01' }, direction: 'WRITE', dataType: 'REAL', unit: '%',
            programValue: 0, actualValue: 0, overriddenBy: null, effectivePriority: 5,
            overrideActor: null, overrideRemainingS: null, quality: 'GOOD',
            observedAt: '2026-08-21T00:00:00Z', freshness: 'LIVE'
          },
          {
            variableId: 'variable-missing', variableName: 'OutputMissing', programId: 'program-1',
            point: { category: 'LOCAL', pointId: 'AO-02' }, direction: 'WRITE', dataType: 'REAL', unit: '%',
            programValue: null, actualValue: null, overriddenBy: null, effectivePriority: null,
            overrideActor: null, overrideRemainingS: null, quality: 'BAD', observedAt: '', freshness: 'UNAVAILABLE'
          }
        ]
      }
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    fireEvent.click(await pouInTree('Điều khiển AHU'))
    expect(screen.queryByRole('region', { name: 'Lớp giá trị runtime ST' })).not.toBeInTheDocument()
    expect(runtimeMonitor.enabled).toHaveBeenCalledWith(false)
  })

  it('LIVE khóa mutation ở toàn workspace, không chỉ khóa textarea chính', async () => {
    const project = baseProject()
    project.activeRevisionId = 'revision-active'
    project.draft!.programs.push({
      programId: 'program-1', objectId: 'object-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'DRAFT KHÔNG ĐƯỢC HIỆN'
    })
    project.draft!.task.programOrder = ['program-1']
    runtimeMonitor.state = {
      status: 'ready', error: null, failure: null, producerRestarted: false, refresh: vi.fn(),
      data: { schemaVersion: '1.0', activeRevisionId: 'revision-active', producer: { capturedMonotonicNs: '1000' }, safeState: false, task: null, items: [] }
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'getProgrammingRevision') return Promise.resolve({
        revisionId: 'revision-active',
        snapshot: { objects: [{
          objectId: 'object-1', kind: 'PROGRAM',
          payload: { objectId: 'object-1', kind: 'PROGRAM', name: 'Điều khiển AHU', language: 'ST', source: 'PROGRAM ACTIVE\nEND_PROGRAM\n' },
        }] },
      })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1&mode=LIVE')
    const source = await screen.findByLabelText<HTMLTextAreaElement>('Mã nguồn đang chạy')
    expect(source).toHaveValue('PROGRAM ACTIVE\nEND_PROGRAM\n')
    expect(source).toHaveAttribute('readonly')
    expect(runtimeMonitor.enabled).toHaveBeenCalledWith(true)

    /* Những control này nằm NGOÀI LiveProgramView; trước T59-812 admin vẫn
     * sửa Draft từ chúng dù màn hình tự nhận là LIVE. */
    expect(screen.queryByTitle('Thêm chương trình ST')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Thêm chương trình FBD')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Lưu$/ })).not.toBeInTheDocument()
    fireEvent.keyDown(source, { key: 's', ctrlKey: true })
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })

  /*
  `T59-816` — workbench dùng chung phải đọc ĐÚNG tài liệu của chế độ đang mở.

  Trước lát này nó luôn đọc buffer Draft: ở LIVE và SIMULATE, tab Tìm kiếm tìm
  trong Draft trong khi màn hình chiếu bản đã niêm phong. Hai tài liệu, một
  khay, và không dấu hiệu nào cho biết khay đang nói về cái nào — nên một lần
  tìm "biến này còn dùng ở đâu" trả lời về một chương trình KHÁC chương trình
  đang chạy trên tủ.
  */
  it('ở LIVE, workbench tìm trong bản đang chạy chứ không tìm trong Draft', async () => {
    const project = baseProject()
    project.activeRevisionId = 'revision-active'
    project.draft!.programs.push({
      programId: 'program-1', objectId: 'object-1', name: 'Điều khiển AHU', kind: 'PROGRAM',
      language: 'ST', document: 'PROGRAM CHI_CO_TRONG_DRAFT\nEND_PROGRAM\n'
    })
    project.draft!.task.programOrder = ['program-1']
    runtimeMonitor.state = {
      status: 'ready', error: null, failure: null, producerRestarted: false, refresh: vi.fn(),
      data: { schemaVersion: '1.0', activeRevisionId: 'revision-active', safeState: false, task: null, items: [] }
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'getProgrammingRevision') return Promise.resolve({
        revisionId: 'revision-active',
        snapshot: { objects: [{
          objectId: 'object-1', kind: 'PROGRAM',
          payload: { objectId: 'object-1', kind: 'PROGRAM', name: 'Điều khiển AHU', language: 'ST',
            source: 'PROGRAM CHI_CO_TRONG_ACTIVE\nEND_PROGRAM\n' },
        }] },
      })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1&mode=LIVE')
    await screen.findByLabelText<HTMLTextAreaElement>('Mã nguồn đang chạy')

    // Nhãn khay phải nói nguồn, không được ghi "Draft" khi đang chiếu bản chạy.
    expect(screen.getByText(/LIVE · Đang chạy · Điều khiển AHU/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    fireEvent.change(screen.getByLabelText('Tìm trong POU đang mở'),
      { target: { value: 'CHI_CO_TRONG' } })
    /* Đọc TRONG khay kết quả: chuỗi này cũng nằm trong textarea chiếu nguồn,
       nên tìm ở phạm vi toàn trang sẽ khớp cả hai và không chứng minh được
       khay đang tìm ở đâu. */
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText(/PROGRAM CHI_CO_TRONG_ACTIVE/)).toBeInTheDocument()
    expect(within(panel).queryByText(/PROGRAM CHI_CO_TRONG_DRAFT/)).not.toBeInTheDocument()
  })

  it('nối interface Draft v2 vào palette FBD và lọc chính POU đang mở', async () => {
    const fbdSource = JSON.stringify({
      $schema: '../../fbd_v1.schema.json', schemaVersion: 1, profileId: 'revA-1t-1-5-30',
      graphId: '10000000-0000-4000-8000-000000000001', name: 'SelfBlock',
      networks: [{
        id: '20000000-0000-4000-8000-000000000001', name: 'Main', order: 0, nodes: [], wires: []
      }]
    })
    const project = baseProject()
    project.draft = {
      schemaVersion: 2,
      project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
      objects: [
        {
          objectId: 'fb-self', kind: 'FUNCTION_BLOCK', name: 'SelfBlock', language: 'FBD', source: fbdSource,
          interface: { inputs: [{ name: 'In', type: 'REAL' }], outputs: [{ name: 'Out', type: 'REAL' }] },
          locals: []
        },
        {
          objectId: 'function-other', kind: 'FUNCTION', name: 'OtherFn', language: 'ST',
          source: 'FUNCTION OtherFn : REAL\nEND_FUNCTION',
          interface: { inputs: [{ name: 'X', type: 'REAL' }], returnType: 'REAL' }, locals: []
        }
      ],
      programs: [], signals: [], bindings: [], library: {}, execution: {}
    } as unknown as ProgrammingDraftDocument
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?program=fb-self')
    await screen.findByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    expect(screen.getByRole('option', { name: /OtherFn · FUNCTION/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /SelfBlock · FUNCTION_BLOCK/ })).not.toBeInTheDocument()
  })

  it('T59-802: dưới 768 px admin vẫn chỉ đọc ST, không có control/shortcut ghi', async () => {
    stubMobileViewport()
    const project = baseProject()
    project.draft!.programs.push({
      programId: 'program-1', objectId: 'object-1', name: 'MobileST', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM MobileST\nEND_PROGRAM\n'
    })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1')

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    expect(screen.getByTestId('programming-mobile-read-only')).toBeInTheDocument()
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.queryByTitle('Thêm chương trình ST')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Thêm chương trình FBD')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument()

    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true })
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)

    fireEvent.click(screen.getByTitle('Bảng lệnh nhanh (Ctrl+P)'))
    const palette = screen.getByRole('dialog', { name: 'Bảng lệnh nhanh' })
    expect(within(palette).queryByRole('option', { name: /Lưu/ })).not.toBeInTheDocument()
    expect(within(palette).queryByRole('option', { name: /Kiểm tra/ })).not.toBeInTheDocument()
    expect(within(palette).queryByRole('option', { name: /Định dạng/ })).not.toBeInTheDocument()
  })

  it('T59-802: dưới 768 px FBD nhận canEdit=false và Insert không đổi graph', async () => {
    stubMobileViewport()
    const fbd = JSON.stringify({
      $schema: '../../fbd_v1.schema.json',
      schemaVersion: 1,
      profileId: 'revA-1t-1-5-30',
      graphId: '10000000-0000-4000-8000-000000000001',
      name: 'MobileFbd',
      networks: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Main', order: 0, nodes: [], wires: [] }]
    })
    const project = baseProject()
    project.draft!.programs.push({
      programId: 'program-fbd', objectId: 'object-fbd', name: 'MobileFbd', kind: 'PROGRAM', language: 'FBD', document: fbd
    })
    project.draft!.task.programOrder = ['program-fbd']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-fbd')

    const editor = await screen.findByRole('region', { name: 'Bộ dựng FBD có cấu trúc' })
    expect(within(editor).getByText('Chỉ đọc')).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: 'Thêm khối' })).toBeDisabled()
    expect(within(editor).getByText('0/256 block')).toBeInTheDocument()

    fireEvent.keyDown(editor, { key: 'Insert' })
    expect(within(editor).getByText('0/256 block')).toBeInTheDocument()
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(false)
  })
})

/* `T59-808` — RBAC negative ở TẦNG GIAO DIỆN.
 *
 * 403 của backend là nửa sau của câu chuyện; nửa trước là giao diện. Một viewer
 * không được thấy nút dẫn tới thao tác chắc chắn bị từ chối — bấm rồi mới biết
 * mình không có quyền là bắt người dùng học luật bằng cách va vào nó. Nhưng
 * chặn ghi KHÔNG có nghĩa là làm mù: nguồn vẫn phải đọc được. */
describe('PGM-02 — viewer/operator không sửa được nguồn (T59-808)', () => {
  function stubProject() {
    const project = baseProject()
    project.draft = {
      ...baseDocument(),
      programs: [{
        programId: 'program-a', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST',
        document: 'PROGRAM A\nEND_PROGRAM\n'
      }]
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
  }

  it.each(['viewer', 'operator'] as const)('%s: nguồn đọc được nhưng không có đường sửa', async (role) => {
    auth.role = role
    stubProject()
    renderWorkspace()
    await pouInTree('Chương trình A')
    fireEvent.click(await pouInTree('Chương trình A'))

    const source = await screen.findByLabelText(/Mã nguồn ST/)
    expect((source as HTMLTextAreaElement).value).toContain('PROGRAM')
    expect(source).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Hoàn tác/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Định dạng/ })).toBeNull()
  })

  it('admin thì ngược lại — có đủ đường sửa', async () => {
    auth.role = 'admin'
    stubProject()
    renderWorkspace()
    await pouInTree('Chương trình A')
    fireEvent.click(await pouInTree('Chương trình A'))
    const source = await screen.findByLabelText(/Mã nguồn ST/)
    expect(source).not.toHaveAttribute('readonly')
  })
})

/* `T59-807` / `WP-01` (phần đi cùng `WP-06`) — hai cột biên thu gọn được.
 *
 * Ở 1280 px, ba cột `280px + 1fr + 308px` chỉ chừa ~690 px cho chính chỗ người
 * dùng gõ. Thu gọn một biên trả lại ~280 px cho editor. */
describe('PGM-02 — slot lưới thu gọn được (T59-807)', () => {
  it('slotKey chọn đúng lớp lưới cho bốn tổ hợp', () => {
    expect(slotKey({ left: true, inspector: true })).toBe('both-open')
    expect(slotKey({ left: false, inspector: true })).toBe('left-closed')
    expect(slotKey({ left: true, inspector: false })).toBe('inspector-closed')
    expect(slotKey({ left: false, inspector: false })).toBe('both-closed')
  })
})

/* `T59-808` — security hardening: nguồn thù địch.
 *
 * Tên POU và mã nguồn là dữ liệu do người dùng nhập, và chúng được hiện lại ở
 * cây POU, khay Vấn đề, khay tham chiếu và thanh ngữ cảnh. React thoát HTML
 * mặc định, nhưng "mặc định an toàn" chỉ đúng tới lần đầu ai đó thêm một
 * `dangerouslySetInnerHTML` cho tiện. Bộ test này khoá điều đó lại. */
describe('PGM-02 — nguồn và tên thù địch hiện thành CHỮ, không thành mã (T59-808)', () => {
  const HOSTILE_NAME = '<img src=x onerror="window.__pwned=1">'
  const HOSTILE_SOURCE = 'PROGRAM P\n(* <script>window.__pwned=1</script> *)\nX := 1;\nEND_PROGRAM\n'

  it('tên POU chứa thẻ HTML không tạo phần tử nào và không chạy script', async () => {
    const project = baseProject()
    project.draft = {
      ...baseDocument(),
      programs: [{ programId: 'program-a', name: HOSTILE_NAME, kind: 'PROGRAM', language: 'ST', document: HOSTILE_SOURCE }]
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await pouInTree(HOSTILE_NAME)

    // Tên hiện ra ĐÚNG NGUYÊN VĂN, và không có `<img>` nào được tạo từ nó.
    expect(globalThis.document.querySelector('img[src="x"]')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()

    fireEvent.click(await pouInTree(HOSTILE_NAME))
    const source = await screen.findByLabelText(/Mã nguồn ST/)
    expect((source as HTMLTextAreaElement).value).toBe(HOSTILE_SOURCE)
    expect(globalThis.document.querySelector('script')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined()
  })
})
