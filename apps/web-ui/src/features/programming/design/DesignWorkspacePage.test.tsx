import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { DesignWorkspacePage } from './DesignWorkspacePage'
import { ProgrammingApiError } from '../api/generated/client'
import type { ProgrammingDraftDocument, ProgrammingProject } from '../model/types'
import type { ProgrammingRuntimeMonitorState } from '../api/queries'
import { slotKey } from './editor/ProgramsTab'
import { BUNDLE_COMPATIBILITY } from '../shared/programmingCompatibility'

/* `ISS-STED-19` — workspace CHẶN soạn thảo khi không đọc được bộ ba tương
 * thích của thiết bị (thiếu bằng chứng ≠ khớp). Nên mọi mock ở đây phải trả
 * lời `getProgrammingCapabilities` như một thiết bị thật: cùng phiên bản với
 * bundle. Test nào muốn kiểm cảnh lệch thì tự ghi đè bằng phiên bản khác. */
function deviceCapabilities(compatibility: unknown = { ...BUNDLE_COMPATIBILITY }) {
  return {
    schemaVersion: '1.0',
    profile: 'MK-DDC-24-REV-A',
    targetState: 'READY',
    languages: ['ST', 'FBD'],
    types: ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'],
    taskPeriodsMs: [1000, 5000, 30000],
    limits: {
      projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512,
      statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256,
    },
    compatibility,
  }
}

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
/* `setContextStripSlot` là đường DUY NHẤT trang đưa cụm `EDIT/LIVE/SIMULATE` +
 * `Lưu`/`Kiểm tra` + chỉ báo `Chưa lưu` ra màn hình — layout thật nhận node đó
 * làm children của `GlobalContextBar`. Một mock `vi.fn()` NUỐT node ấy, nên
 * mọi khẳng định về cụm đó lại đi đo một bản dựng khác trong thân trang, và
 * cây DOM mà unit test nhìn thấy không còn là cây người dùng nhìn thấy. Đúng
 * khoảng mù đó đã che việc chỉ báo `Chưa lưu` được dựng HAI lần (một ở slot,
 * một sót lại ở thân trang) cho tới khi Playwright đâm vào `strict mode
 * violation`. Bắc cầu để harness RENDER slot thật. */
const slotBridge = vi.hoisted(() => ({ render: null as ((node: ReactNode) => void) | null }))
vi.mock('../layout/ProgrammingLayout', () => ({
  useProgrammingRuntimeContext: () => ({
    setEditingContext: vi.fn(),
    setContextStripSlot: (node: ReactNode) => { slotBridge.render?.(node) }
  })
}))

/** Chỗ đứng của ContextStrip trong harness: nhận node slot và dựng nó thật. */
function ContextStripSlotOutlet() {
  const [node, setNode] = useState<ReactNode>(null)
  useEffect(() => {
    slotBridge.render = setNode
    return () => { slotBridge.render = null }
  }, [])
  return <>{node}</>
}

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

/* Địa chỉ thật mà router đang đứng. `#675` khoá URL chứ không khoá lời hứa của
 * một handler: "mở `?tab=execution`" chỉ đúng nếu `project` và `pou` còn nguyên
 * sau cú bấm — rơi một tham số là bắt người dùng chọn lại đúng thứ họ vừa đứng
 * trong đó, và một `expect(handler).toHaveBeenCalled()` không thấy được điều ấy. */
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="router-location">{`${location.pathname}${location.search}`}</span>
}

function renderWorkspace(initialPath = '/eng/programming/projects/project-1/design') {
  return render(
    <I18nProvider>
      <ContextStripSlotOutlet />
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
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

function createPou(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Mới' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Tạo POU mới' })).getByRole('menuitem', { name: label }))
}

function pouAction(name: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: `Thao tác với ${name}` }))
  fireEvent.click(within(screen.getByRole('menu', { name: `Thao tác với ${name}` })).getByRole('menuitem', { name: action }))
}

describe('DesignWorkspacePage — Draft workspace (TASK-PROG-501)', () => {
  it('TC-FBD-STATE-001: khi Draft chưa tải xong chỉ hiện skeleton và chưa mount control mutation', () => {
    client.request.mockReturnValue(new Promise(() => {}))
    renderWorkspace()
    expect(screen.getByText('Đang tải Draft…')).toBeInTheDocument()
    expect(screen.queryByTestId('fbd-workspace-shell')).toBeNull()
    expect(screen.queryByRole('button', { name: /Thêm khối/ })).toBeNull()
  })

  it('mount Published Signals trên route Mapping bằng raw Draft v2, không qua adapter làm mất signals[]', async () => {
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?tab=mapping')

    /* ponytail: tab buttons ẩn — verify qua bảng Published Signal trực tiếp. */
    const table = await screen.findByRole('table', { name: 'Bảng Published Signal của bản nháp' })
    expect(within(table).getByRole('row', { name: /SupplyTemp/ })).toHaveTextContent('AirHandler')
    expect(within(table).getByRole('row', { name: /SupplyTemp/ })).toHaveTextContent('5000 ms')
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    await waitFor(() => expect(screen.getByText('Chưa có chương trình. Bấm Mới để tạo.')).toBeInTheDocument())

    createPou('Program · ST')

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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    const inspector = await screen.findByRole('complementary', { name: 'Thuộc tính' })
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

  it('không báo lỗi tên legacy chưa sửa và vẫn cho lưu mô tả độc lập', async () => {
    const project = baseProject()
    project.draft!.programs.push({
      programId: 'program-1', objectId: 'object-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', description: '',
      document: 'PROGRAM AHU_MAIN\nEND_PROGRAM\n'
    })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    fireEvent.click(await pouInTree('Điều khiển AHU'))
    const inspector = await screen.findByRole('complementary', { name: 'Thuộc tính' })
    const nameInput = within(inspector).getByLabelText('Tên')
    expect(nameInput).not.toHaveAttribute('aria-invalid')
    expect(within(inspector).queryByText(/Tên phải bắt đầu bằng chữ/)).not.toBeInTheDocument()

    fireEvent.change(within(inspector).getByLabelText('Mô tả'), { target: { value: 'Điều khiển AHU tầng 1' } })
    const save = within(inspector).getByRole('button', { name: 'Lưu thuộc tính' })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(client.request.mock.calls.some(([operationId]) => operationId === 'updateProgrammingDraft')).toBe(true))
    const [, options] = client.request.mock.calls.find(([operationId]) => operationId === 'updateProgrammingDraft')!
    expect(options.body.operations).toEqual([{ op: 'annotateObject', objectId: 'object-1', description: 'Điều khiển AHU tầng 1' }])
  })

  it('WP-11: bố cục 3 cột (Cây/Editor/Inspector) theo UX §16.2 — Inspector là cột riêng, không nằm dưới editor', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await pouInTree('Chương trình A')

    // Chưa chọn chương trình nào: cột Inspector vẫn tồn tại, hiện trạng thái trống.
    const tree = screen.getByRole('navigation', { name: 'Cây POU' })
    const inspectorEmpty = await screen.findByRole('complementary', { name: 'Thuộc tính' })
    expect(within(inspectorEmpty).getByText('Chọn một chương trình để xem thuộc tính.')).toBeInTheDocument()

    fireEvent.click(await pouInTree('Chương trình A'))
    await screen.findByLabelText(/Mã nguồn ST/)

    // Sau khi chọn: cây, editor và Inspector cùng có mặt đồng thời (3 cột),
    // không phải Inspector thay thế editor hay nằm dưới nó.
    expect(tree).toBeInTheDocument()
    expect(screen.getByLabelText(/Mã nguồn ST/)).toBeInTheDocument()
    const inspector = await screen.findByRole('complementary', { name: 'Thuộc tính' })
    expect(within(inspector).getByLabelText('Tên')).toHaveValue('Chương trình A')
    expect(within(inspector).getByLabelText('Loại')).toHaveValue('PROGRAM')
  })

  it('PPI-001: Loại là identity chỉ đọc, hiện đủ ba kind và KHÔNG còn cảnh báo "chưa được Kiểm tra hỗ trợ"', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await pouInTree('Chương trình A')
    fireEvent.click(await pouInTree('Chương trình A'))
    await screen.findByLabelText(/Mã nguồn ST/)

    const inspector = await screen.findByRole('complementary', { name: 'Thuộc tính' })
    const kindSelect = within(inspector).getByLabelText('Loại') as HTMLSelectElement
    const options = within(kindSelect).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
    // Backend (`attachLocalPOUSources`/`compilerInputs`) biên dịch cả ba kind,
    // nên UI không được nói ngược lại bằng cách ẩn hai lựa chọn.
    expect(options).toEqual(['PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK'])
    expect(kindSelect).toHaveValue('PROGRAM')
    // Kind cố định lúc tạo: mỗi kind có header source riêng và BE không kiểm
    // header khớp kind, nên đổi tại đây là đường dẫn tới Check đỏ.
    expect(kindSelect).toBeDisabled()
    expect(within(inspector).queryByText(/chưa được Kiểm tra hỗ trợ biên dịch/)).not.toBeInTheDocument()
  })

  it('PPI-001: POU kind FUNCTION_BLOCK hiện đúng giá trị thật, không bị ẩn và không bị khuyên "đổi về PROGRAM"', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'FB cũ từ bundle', kind: 'FUNCTION_BLOCK', language: 'ST', document: 'FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await pouInTree('FB cũ từ bundle')
    fireEvent.click(await pouInTree('FB cũ từ bundle'))
    await screen.findByLabelText(/Mã nguồn ST/)

    const inspector = await screen.findByRole('complementary', { name: 'Thuộc tính' })
    const kindSelect = within(inspector).getByLabelText('Loại') as HTMLSelectElement
    expect(kindSelect).toHaveValue('FUNCTION_BLOCK')
    expect(kindSelect).toBeDisabled()
    expect(within(inspector).queryByText(/chưa được Kiểm tra hỗ trợ biên dịch/)).not.toBeInTheDocument()
    expect(within(inspector).queryByText(/đổi về PROGRAM/)).not.toBeInTheDocument()
  })

  it('409 giữ nguyên buffer đang gõ và hiện banner reload/merge (UX §9)', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Chương trình A', kind: 'PROGRAM', language: 'ST', document: 'X := 1;' })
    project.draft!.task.programOrder = ['program-1']

    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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

  it('TC-FBD-UX-001: + FBD tạo canonical POU và mount StructuredFbdEditor thật', async () => {
    client.request.mockImplementation((operationId: string, options?: { body?: { operations: Array<{ op: string; program?: { programId: string; name: string; document: unknown } }> } }) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mới' })).toBeInTheDocument())
    createPou('Program · FBD')

    // StructuredFbdEditor render toolbar lệnh thật — không phải chữ placeholder cũ.
    await waitFor(() => expect(screen.queryByText(/mount ở TASK-PROG-502/)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Lệnh FBD' })).toBeInTheDocument())
  })

  it('AC-PGM02-009 / AC-ST-004: nút Kiểm tra điều hướng sang PGM-05, không tự seal/check nên Active không đổi (D-01)', async () => {
    const project = baseProject()
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kiểm tra' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))

    await waitFor(() => expect(screen.getByText('Check & Commission page')).toBeInTheDocument())
    // D-01: PGM-02 không được tự gọi seal/Check — đó là việc của PGM-05 giờ.
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'createProgrammingRevision')).toBe(false)
    expect(client.request.mock.calls.some(([operationId]) => operationId === 'createProgrammingCheck')).toBe(false)
  })

  it('URL mang line/column/length (điều hướng từ Problems ở PGM-05) nhảy đúng vùng chọn trong ST editor (F-PROG-ASBUILT-003)', async () => {
    const source = 'PROGRAM P\nVAR_OUTPUT X : BOOL; END_VAR\nX := ;\nEND_PROGRAM\n'
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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

    await waitFor(() => expect(screen.getByTestId('draft-dirty-indicator')).toHaveTextContent(/Chưa lưu/))
    /* ĐẾM, không chỉ đọc nội dung. `getByTestId` ở trên đã ngầm đòi duy nhất,
     * nhưng chỉ khi harness thật sự dựng cả slot — mà bản trước mock
     * `setContextStripSlot` bằng `vi.fn()` nên nó chỉ nhìn thấy bản ở thân
     * trang và không bao giờ đếm tới hai. Khẳng định tường minh này là chốt
     * chặn cho đúng lỗi đó: hai vùng `role="status"` cùng câu chữ trên một màn
     * hình, mà Playwright mới bắt được bằng `strict mode violation`. */
    expect(screen.queryAllByTestId('draft-dirty-indicator')).toHaveLength(1)
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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

    pouAction('Điều khiển AHU', 'Xóa')
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    pouAction('SCALE_LIN', 'Xóa')
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    pouAction('AHU_MasterSequence', 'Xóa')
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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

  it('Bảng lệnh nhanh: mục "Kiểm tra" điều hướng sang PGM-05 giống hệt nút Kiểm tra (D-01) — chỉ khi người dùng chủ động chọn', async () => {
    const project = baseProject()
    project.draft!.programs.push({ programId: 'program-1', name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM P\nEND_PROGRAM\n' })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
    expect(screen.queryByRole('button', { name: 'Mới' })).not.toBeInTheDocument()
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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

    /* `LiveProgramView` và workbench hiện đọc cùng Revision qua hai hook riêng.
       Textarea sẵn sàng chỉ chứng minh lượt đọc của view; đợi số đếm `(0)`
       chứng minh workbench cũng đã nhận nguồn Active trước khi tương tác. */
    const searchTab = await screen.findByRole('tab', { name: 'Tìm kiếm (0)' })
    fireEvent.click(searchTab)
    expect(searchTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Tìm kiếm/)
    const search = screen.getByLabelText('Tìm trong POU đang mở')
    fireEvent.change(search,
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1')

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    expect(screen.getByTestId('programming-mobile-read-only')).toBeInTheDocument()
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Mới' })).not.toBeInTheDocument()
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

  it('TC-FBD-RESP-003 / TC-FBD-STATE-004: dưới 768 px hiện banner, FBD khóa mutation và không gửi write API', async () => {
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-fbd')

    const editor = await screen.findByRole('region', { name: 'Bộ dựng FBD có cấu trúc' })
    expect(screen.getByTestId('programming-mobile-read-only')).toHaveTextContent('Màn hình nhỏ — chỉ hỗ trợ xem sơ đồ')
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
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
  /* `ISS-STED-19` — CỔNG TƯƠNG THÍCH PHIÊN BẢN Ở ĐÚNG NƠI NGƯỜI DÙNG GÕ.
   *
   * Test đơn vị của `programmingCompatibility` chứng minh phán quyết đúng;
   * những test dưới đây chứng minh phán quyết ĐÓ THỰC SỰ CHẶN được màn hình.
   * Hai thứ này tách nhau: một phán quyết đúng mà không ai nối vào `canEdit`
   * thì vẫn để người dùng soạn chương trình sai. */
  /* Phiên bản thiết bị DỰNG TỪ hằng bundle, không chép số: `T61-102` bump
   * registry `rev-a.3 -> rev-a.4` có kiểm soát, và bản cũ ghim hai chuỗi ấy nên
   * đỏ vì chính cú bump hợp lệ. Điều đang kiểm là màn hình có CHẶN khi lệch hay
   * không, không phải số hiệu version là bao nhiêu. */
  it('bundle gặp thiết bị lệch version thư viện thì chặn soạn thảo và nêu rõ hai phiên bản', async () => {
    const deviceLibraryVersion = `${BUNDLE_COMPATIBILITY.libraryRegistryVersion}-thiết-bị-khác`
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') {
        return Promise.resolve(
          deviceCapabilities({ ...BUNDLE_COMPATIBILITY, libraryRegistryVersion: deviceLibraryVersion }),
        )
      }
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()

    const alert = await screen.findByTestId('programming-compatibility-block')
    expect(alert).toHaveAttribute('data-compatibility-state', 'MISMATCH')
    expect(alert.textContent).toContain(BUNDLE_COMPATIBILITY.libraryRegistryVersion)
    expect(alert.textContent).toContain(deviceLibraryVersion)
    // Không tự hạ cấp: cổng soạn thảo phải đóng, không chỉ hiện cảnh báo.
    expect(screen.queryByRole('button', { name: 'Mới' })).not.toBeInTheDocument()
  })

  it('thiết bị không công bố bộ ba thì chặn (thiếu bằng chứng không phải bằng chứng khớp)', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') {
        /* Thiết bị đời cũ BỎ HẲN trường, chứ không gửi `compatibility: undefined`.
         * Xoá key mô phỏng đúng phản hồi đó — và cũng tránh bẫy tham số mặc
         * định của `deviceCapabilities`, nơi truyền `undefined` lại rơi về bộ
         * ba khớp. */
        const capabilities = deviceCapabilities() as Record<string, unknown>
        delete capabilities.compatibility
        return Promise.resolve(capabilities)
      }
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()

    const alert = await screen.findByTestId('programming-compatibility-block')
    expect(alert).toHaveAttribute('data-compatibility-state', 'UNVERIFIABLE')
    expect(screen.queryByRole('button', { name: 'Mới' })).not.toBeInTheDocument()
  })

  it('thiết bị cùng phiên bản thì không hiện cảnh báo và vẫn soạn thảo được', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(baseProject())
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })

    renderWorkspace()

    expect(await screen.findByRole('button', { name: 'Mới' })).toBeInTheDocument()
    expect(screen.queryByTestId('programming-compatibility-block')).not.toBeInTheDocument()
  })
})

/*
`T61-405` / `ISS-PGM04-14` — ý định chèn khối tới từ PGM-04.

Quyết định canonical: **PGM-04 chỉ điều hướng**. Phép chèn — và bước Hoàn tác của
nó — thuộc về PGM-02, vì đó là nơi người dùng nhìn thấy mã nguồn thay đổi và có
`Ctrl+Z` trong tầm tay. Nhóm test này khoá đúng ranh giới ấy.
*/
describe('PGM-02 tiếp nhận ý định chèn khối từ Thư viện (T61-405)', () => {
  const LIBRARY_REVISION = 'sys-1'

  function stubWorkspaceWithLibrary(entryOverrides: Record<string, unknown> = {}) {
    const project = baseProject()
    project.draft = {
      ...baseDocument(),
      programs: [{
        programId: 'program-a', name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST',
        document: 'PROGRAM AHU_MAIN\nEND_PROGRAM\n'
      }]
    }
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      if (operationId === 'searchProgrammingLibraries') {
        /* Trì hoãn một microtask để trạng thái `loading` thật sự quan sát được
         * trong assertion dưới. `Promise.resolve()` đồng bộ không bảo đảm
         * React kịp hiện loading trước khi dữ liệu tới. */
        return new Promise((resolve) => setTimeout(() => resolve({
          items: [{
            scope: 'SYSTEM', libraryRevisionId: LIBRARY_REVISION, libraryVersion: 'rev-a.1',
            libraryState: 'PUBLISHED', entryId: 'TON', kind: 'FUNCTION_BLOCK', name: 'TON',
            featureState: 'AVAILABLE', contentSha256: 'a'.repeat(64),
            signature: {
              dispatch: 'FB_TYPE', polymorphic: false, typedPortNames: [], category: 'timer',
              labelVi: 'Trễ bật', labelEn: 'On delay', allowedTypes: [],
              ports: [
                { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
                { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
                { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
              ],
            },
            dependencies: [], stateLayoutKnown: true, stateSizeBytes: 16,
            ...entryOverrides,
          }]
        }), 0))
      }
      throw new Error(`unexpected operation ${operationId}`)
    })
  }

  function designPath(query: string) {
    return `/eng/programming/projects/project-1/design?pou=program-a&mode=EDIT&${query}`
  }

  /*
  Điều quan trọng nhất: ý định là một LỜI ĐỀ NGHỊ, không phải một lệnh. Chèn
  thẳng khi trang vừa mở là một thay đổi mã nguồn người dùng không hề bấm, và họ
  sẽ không biết `Ctrl+Z` là để hoàn tác cái gì.
  */
  it('hỏi lại trước khi chèn, và chỉ chèn sau một lần bấm tường minh', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath(`insertEntry=TON&insertLibraryRevision=${LIBRARY_REVISION}`))

    const banner = await screen.findByTestId('programs-insert-intent')
    /* Trong lúc danh mục còn đang nạp, băng KHÔNG được nói "khối này không có
       trong thư viện": đó là một câu sai, và nó sai đúng lúc người dùng vừa
       nhìn thấy khối ấy ở màn hình Thư viện. */
    expect(banner).toHaveAttribute('data-status', 'loading')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'ready'))
    expect(banner).toHaveTextContent('TON')

    const editor = await screen.findByLabelText(/Mã nguồn ST/)
    expect(editor).toHaveValue('PROGRAM AHU_MAIN\nEND_PROGRAM\n')

    fireEvent.click(within(banner).getByRole('button', { name: /Chèn vào POU đang mở/ }))
    // Mã nguồn đổi Ở ĐÂY, trong bộ soạn thảo — chủ sở hữu của phép ghi và của
    // bước Hoàn tác.
    /* `toHaveValue` so KHỚP TUYỆT ĐỐI, không nhận matcher con — đọc giá trị ra
       rồi so chứa mới đúng thứ cần khẳng định ở đây. */
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('TON_1 : TON;'))
    expect((editor as HTMLTextAreaElement).value).toContain('TON_1(')
    // Ý định đã ngã ngũ thì phải biến mất: để nó nằm lại trên URL nghĩa là mỗi
    // lần tải trang lại mời chèn cùng một khối.
    await waitFor(() => expect(screen.queryByTestId('programs-insert-intent')).toBeNull())
  })

  it('bấm Bỏ qua thì không chèn gì, và ý định không quay lại', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath(`insertEntry=TON&insertLibraryRevision=${LIBRARY_REVISION}`))

    const banner = await screen.findByTestId('programs-insert-intent')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'ready'))
    const editor = await screen.findByLabelText(/Mã nguồn ST/)
    fireEvent.click(within(banner).getByRole('button', { name: 'Bỏ qua' }))

    await waitFor(() => expect(screen.queryByTestId('programs-insert-intent')).toBeNull())
    expect(editor).toHaveValue('PROGRAM AHU_MAIN\nEND_PROGRAM\n')
  })

  /* Hai ca xấu nói HAI câu khác nhau, vì chúng đòi hai hành động khác nhau của
     người vận hành — và cả hai đều không chèn gì. */
  it('khối được đề nghị không có trong thư viện thì nói ra và không chèn', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath(`insertEntry=KHONG_CO&insertLibraryRevision=${LIBRARY_REVISION}`))

    const banner = await screen.findByTestId('programs-insert-intent')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'unknown-entry'))
    expect(banner).toHaveTextContent('không chèn gì cả')
    expect(within(banner).queryByRole('button', { name: /Chèn vào POU đang mở/ })).toBeNull()
  })

  it('khối thuộc phiên bản thư viện khác thì nói ra và không chèn', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath('insertEntry=TON&insertLibraryRevision=ban-khac'))

    const banner = await screen.findByTestId('programs-insert-intent')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'revision-mismatch'))
    expect(banner).toHaveTextContent('phiên bản thư viện khác')
    expect(within(banner).queryByRole('button', { name: /Chèn vào POU đang mở/ })).toBeNull()
  })

  /*
  `T61-406` / `AC-PGM04` — "Mutation thật chỉ sau xác nhận trong editor và có
  ĐÚNG MỘT Undo entry".

  Phép chèn một FB có trạng thái ghi vào HAI chỗ cách xa nhau trong tệp: một
  dòng khai báo trong khối `VAR` và một lời gọi trong thân. Nếu hai chỗ ấy đi
  qua hai lần ghi thì người dùng bấm `Ctrl+Z` một lần sẽ gỡ lời gọi mà BỎ LẠI
  dòng khai báo — một biến thừa nằm im trong `VAR`, không lỗi biên dịch, không
  ai thấy. `AC-ST-003` khoá việc ấy cho đường Quick Library; đường ý định từ
  PGM-04 là một lối vào KHÁC và phải khoá riêng, vì một lối vào không đi qua
  `applyEditRange` sẽ hỏng đúng kiểu ấy mà test cũ vẫn xanh.
  */
  it('chèn từ băng ý định là ĐÚNG MỘT bước Hoàn tác, không bỏ lại khai báo', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath(`insertEntry=TON&insertLibraryRevision=${LIBRARY_REVISION}`))

    const banner = await screen.findByTestId('programs-insert-intent')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'ready'))
    const editor = (await screen.findByLabelText(/Mã nguồn ST/)) as HTMLTextAreaElement
    const before = editor.value

    fireEvent.click(within(banner).getByRole('button', { name: /Chèn vào POU đang mở/ }))
    await waitFor(() => expect(editor.value).toContain('TON_1 : TON;'))
    expect(editor.value).toContain('TON_1(')

    fireEvent.click(screen.getByRole('button', { name: /Hoàn tác/ }))
    // MỘT lần hoàn tác trả về nguyên trạng: cả khai báo lẫn lời gọi cùng biến
    // mất. Không còn `TON_1` nào sót lại trong khối VAR.
    await waitFor(() => expect(editor.value).toBe(before))
    expect(editor.value).not.toContain('TON_1')
  })

  /*
  `ISS-PGM04-15` — "Guard chỉ tồn tại ở UI nhưng test direct intent có thể
  bypass" là một trong ba lý do issue TỪ CHỐI đóng.

  Ý định đi qua URL. Nút Chèn của PGM-04 khoá cho bốn lý do, nhưng URL dưới đây
  không hề đi qua cái nút ấy — nó là thứ người ta gõ tay, dán lại, hoặc mở từ
  một bookmark cũ. Phép chặn phải được ĐỌC LẠI từ danh mục của máy chủ ở đây,
  và mã nguồn phải không đổi một ký tự.
  */
  it('ý định gõ thẳng vào URL vẫn bị chặn bởi cùng luật, và không đổi mã nguồn', async () => {
    const blocked = [
      [{ featureState: 'REVIEW_REQUIRED' }, /chờ review Controls\/Safety/],
      [{ libraryState: 'DEPRECATED' }, /đã ngừng sử dụng/],
      [{ signature: undefined }, /Không đọc được chữ ký/],
      [{
        compatibility: {
          state: 'REQUIRES_MIGRATION', requiredVersion: '1.0.0', availableVersion: '2.0.0', reason: 'pin cũ'
        }
      }, /pin một phiên bản khác/],
    ] as const
    for (const [overrides, message] of blocked) {
      cleanup()
      stubWorkspaceWithLibrary(overrides)
      renderWorkspace(designPath(`insertEntry=TON&insertLibraryRevision=${LIBRARY_REVISION}`))

      const banner = await screen.findByTestId('programs-insert-intent')
      await waitFor(() => expect(banner).toHaveAttribute('data-status', 'blocked'))
      expect(banner).toHaveTextContent(message)
      expect(within(banner).queryByRole('button', { name: /Chèn vào POU đang mở/ })).toBeNull()
      const editor = (await screen.findByLabelText(/Mã nguồn ST/)) as HTMLTextAreaElement
      expect(editor.value).toBe('PROGRAM AHU_MAIN\nEND_PROGRAM\n')
    }
  })

  /*
  `ISS-PGM04-15` — "Unknown compatibility phải fail closed HOẶC yêu cầu flow
  được authority phê duyệt; không coi unknown là compatible."

  Fail-closed không dùng được ở đây: hợp đồng ghi `UNKNOWN` là giá trị MẶC ĐỊNH
  và MỌI entry SYSTEM đều mang nó, nên chặn cứng là chặn `TON` trên mọi Project
  chưa Commission. Đường còn lại là flow của `AUTH-PROG-2026-08-29-PGM04-003`:
  một lần bấm xác nhận, VỚI sự thật đang hiện trên màn hình. Nếu câu ấy vắng thì
  lần bấm là một lần bấm mù — và im lặng đúng là cách `UNKNOWN` bị đọc thành
  `COMPATIBLE`.
  */
  it('tương thích chưa đo được thì hiện NGAY trên băng xác nhận', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath(`insertEntry=TON&insertLibraryRevision=${LIBRARY_REVISION}`))
    const banner = await screen.findByTestId('programs-insert-intent')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'ready'))
    expect(within(banner).getByTestId('programs-insert-compatibility'))
      .toHaveTextContent(/chưa có nghĩa là tương thích/)
  })

  /* Và nó KHÔNG phải một câu luôn hiện: máy chủ khẳng định tương thích thì im
     lặng mới đúng. Một cảnh báo hiện ở mọi lần chèn là một cảnh báo không ai
     đọc nữa. */
  it('máy chủ khẳng định tương thích thì băng không thêm cảnh báo nào', async () => {
    stubWorkspaceWithLibrary({
      compatibility: {
        state: 'COMPATIBLE', requiredVersion: 'rev-a.1', availableVersion: 'rev-a.1', reason: null
      }
    })
    renderWorkspace(designPath(`insertEntry=TON&insertLibraryRevision=${LIBRARY_REVISION}`))
    const banner = await screen.findByTestId('programs-insert-intent')
    await waitFor(() => expect(banner).toHaveAttribute('data-status', 'ready'))
    expect(within(banner).queryByTestId('programs-insert-compatibility')).toBeNull()
  })

  it('không có ý định thì không có băng nào — băng không tự mọc ra', async () => {
    stubWorkspaceWithLibrary()
    renderWorkspace(designPath('tab=design'))
    await screen.findByLabelText(/Mã nguồn ST/)
    expect(screen.queryByTestId('programs-insert-intent')).toBeNull()
  })
})
/**
 * `#675` — lối vào `Cấu hình chạy` trong mục Thực thi của Inspector.
 *
 * Lối vào cấu hình chạy đã biến mất khỏi giao diện (`Cấu hình Task` không còn
 * chuỗi nào trong `src/`), chỉ còn một liên kết nằm trong mục `Tham chiếu` đóng
 * sẵn. Ba test dưới đây khoá ba điều khác nhau: nút CÓ ở chế độ sửa được, nó đi
 * tới đúng địa chỉ và GIỮ ĐƯỢC tham số, và nó VẮNG MẶT ở mọi bề mặt chỉ đọc.
 */
describe('DesignWorkspacePage — lối vào `Cấu hình chạy` (#675)', () => {
  function projectWithStProgram() {
    const project = baseProject()
    project.draft!.programs.push({
      programId: 'program-1', objectId: 'object-1', name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_MAIN\nEND_PROGRAM\n'
    })
    project.draft!.task.programOrder = ['program-1']
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingCapabilities') return Promise.resolve(deviceCapabilities())
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'getProgrammingPointCatalog') return Promise.resolve({ items: [] })
      throw new Error(`unexpected operation ${operationId}`)
    })
    return project
  }

  it('AC-675-2: bấm `Cấu hình chạy` mở `?tab=execution` và GIỮ NGUYÊN `project` lẫn `pou`', async () => {
    projectWithStProgram()
    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1&mode=EDIT')
    await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)

    const button = await screen.findByRole('button', { name: 'Cấu hình chạy' })
    fireEvent.click(button)

    await waitFor(() => {
      const location = new URL(screen.getByTestId('router-location').textContent ?? '', 'http://x')
      expect(location.searchParams.get('tab')).toBe('execution')
      // Route canonical KHÔNG đổi: `execution` là tab con, không phải trang IA.
      expect(location.pathname).toBe('/eng/programming/projects/project-1/design')
      // Hai tham số mà `AC-2` gọi tên — rơi một cái là hỏng, kể cả khi tab đúng.
      expect(location.searchParams.get('pou')).toBe('object-1')
      expect(location.searchParams.get('mode')).toBe('EDIT')
    })

    /* `AC-3` — `ExecutionTab` không bị sửa hành vi: nó vẫn là thứ hiện ra, đọc
       đúng Task của Draft. Nếu prop của nó bị đổi thì màn hình này rỗng.
       Đo bằng chính tiêu đề của tab (`<h3>` sr-only) chứ không bằng tên POU:
       tên POU còn nằm trong cây POU của tab Chương trình (tab ẩn chứ không
       unmount), nên nó không phân biệt được hai màn hình. */
    const executionHeading = await screen.findByRole('heading', { name: 'Tác vụ thực thi', level: 3 })
    expect(executionHeading).toBeInTheDocument()
    expect(executionHeading.closest('[hidden]')).toBeNull()
  })

  it('AC-675-4: dưới 768 px KHÔNG có lối vào nào tới cấu hình chạy — cả nút lẫn liên kết cũ', async () => {
    stubMobileViewport()
    projectWithStProgram()
    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1')
    await screen.findByLabelText<HTMLTextAreaElement>(/Mã nguồn ST/)
    expect(screen.getByTestId('programming-mobile-read-only')).toBeInTheDocument()

    /* Gỡ nút mà để lại liên kết trong mục `Tham chiếu` là vẫn lộ nguyên đường
       ghi — hai lối cùng đi tới một chỗ, nên chúng phải tắt cùng nhau. */
    expect(screen.queryByRole('button', { name: 'Cấu hình chạy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mở cấu hình Task toàn cục' })).not.toBeInTheDocument()
  })

  it('AC-675-4: ở SIMULATE KHÔNG có lối vào nào tới cấu hình chạy', async () => {
    projectWithStProgram()
    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1&mode=SIMULATE')
    /* SIMULATE thay HẲN cột soạn thảo bằng `SimulateWorkspace`, nên Inspector —
       và cùng với nó là lối vào cấu hình chạy — không được mount. Đó là vế
       "vắng mặt" mà `AC-PGM02-006` đòi, không phải một nút bấm không được. */
    await screen.findByRole('region', { name: 'Mô phỏng' })
    expect(screen.queryByTestId('context-inspector')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cấu hình chạy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mở cấu hình Task toàn cục' })).not.toBeInTheDocument()
  })

  it('AC-675-4: ở LIVE KHÔNG có lối vào nào tới cấu hình chạy', async () => {
    const project = projectWithStProgram()
    project.activeRevisionId = 'revision-active'
    runtimeMonitor.state = {
      status: 'ready', error: null, failure: null, producerRestarted: false, refresh: vi.fn(),
      data: { schemaVersion: '1.0', activeRevisionId: 'revision-active', producer: { capturedMonotonicNs: '1000' }, safeState: false, task: null, items: [] }
    }
    const base = client.request.getMockImplementation()!
    client.request.mockImplementation((operationId: string, ...rest: unknown[]) => {
      if (operationId === 'getProgrammingRevision') return Promise.resolve({
        revisionId: 'revision-active',
        snapshot: { objects: [{
          objectId: 'object-1', kind: 'PROGRAM',
          payload: { objectId: 'object-1', kind: 'PROGRAM', name: 'AHU_MAIN', language: 'ST', source: 'PROGRAM ACTIVE\nEND_PROGRAM\n' },
        }] },
      })
      return (base as (id: string, ...args: unknown[]) => unknown)(operationId, ...rest)
    })

    renderWorkspace('/eng/programming/projects/project-1/design?pou=object-1&mode=LIVE')
    await screen.findByLabelText<HTMLTextAreaElement>('Mã nguồn đang chạy')

    expect(screen.queryByRole('button', { name: 'Cấu hình chạy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mở cấu hình Task toàn cục' })).not.toBeInTheDocument()
  })
})
