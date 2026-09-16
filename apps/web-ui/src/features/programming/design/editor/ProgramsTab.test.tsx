import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../../../shared/i18n'
import type { FbdDocument } from '../../fbd/model'
import { canonicalFbdJson } from '../../fbd/model'
import type {
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingProgram,
} from '../../model/types'
import { ProgramsTab } from './ProgramsTab'

vi.mock('../../../auth', () => ({
  useAuth: () => ({
    session: { username: 'test-admin', role: 'admin', loginAt: '2026-09-04T00:00:00Z' },
    isAuthenticated: true,
  }),
  roleAtLeast: () => true,
}))

vi.mock('../../api/queries', () => ({
  useProgrammingLibraryPaged: () => ({
    status: 'ready', items: [], error: null, failure: null, loadMoreError: null,
    loadingMore: false, hasMore: false, loadMore: vi.fn(), refresh: vi.fn(),
  }),
  useLazyProgrammingLibraryCatalog: () => ({
    status: 'ready',
    data: { items: [] },
    error: null,
    ensureLoaded: vi.fn(),
  }),
  useLazyProgrammingPointCatalog: () => ({
    status: 'ready',
    data: { items: [] },
    error: null,
    ensureLoaded: vi.fn(),
  }),
}))

afterEach(cleanup)
beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
})

const sampleFbdDoc: FbdDocument = {
  $schema: '../../fbd_v1.schema.json',
  schemaVersion: 1,
  profileId: 'revA-1t-1-5-30',
  graphId: '10000000-0000-4000-8000-000000000001',
  name: 'FBD_PROG',
  networks: [
    {
      id: 'net-1',
      name: 'Net1',
      order: 1,
      nodes: [
        {
          id: 'node-1',
          kind: 'INPUT',
          typeRef: 'BOOL',
          executionOrder: 1,
          parameters: { variable: 'Start' },
          ports: [
            { id: 'p1', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
          ],
        },
        {
          id: 'node-2',
          kind: 'INPUT',
          typeRef: 'BOOL',
          executionOrder: 2,
          parameters: { variable: 'Stop' },
          ports: [
            { id: 'p2', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 },
          ],
        },
      ],
      wires: [],
    },
  ],
}

const fbdProgram: ProgrammingProgram = {
  programId: 'prog-fbd-1',
  name: 'FBD_PROG',
  kind: 'PROGRAM',
  language: 'FBD',
  document: canonicalFbdJson(sampleFbdDoc),
  executionOrder: 1,
  functionalTags: [],
}

const stProgram: ProgrammingProgram = {
  programId: 'prog-st-1',
  name: 'ST_PROG',
  kind: 'PROGRAM',
  language: 'ST',
  document: 'PROGRAM ST_PROG\nVAR\n  Sensor : BOOL;\nEND_VAR\nEND_PROGRAM',
  executionOrder: 2,
  functionalTags: [],
}

const draftDoc: ProgrammingDraftDocument = {
  schemaVersion: 1,
  project: { projectId: 'proj-1', name: 'Project 1', functionalTags: [] },
  programs: [fbdProgram, stProgram],
  variables: [],
  bindings: [],
  task: { taskId: 'task-1', periodMs: 1000, programOrder: ['prog-fbd-1', 'prog-st-1'] },
  library: { profile: 'CORE_REVA', version: '1' },
}

function renderProgramsTab(props?: {
  document?: ProgrammingDraftDocument
  selectedProgramId?: string
  onSelectProgram?: (id: string | undefined) => void
  onSave?: (ops: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const onSelectProgram = props?.onSelectProgram ?? vi.fn()
  const onSave = props?.onSave ?? vi.fn().mockResolvedValue(true)
  const onPendingOperationsChange = vi.fn()
  const onRunCheck = vi.fn()

  const utils = render(
    <I18nProvider>
      <ProgramsTab
        document={props?.document ?? draftDoc}
        saving={false}
        selectedProgramId={props?.selectedProgramId}
        onSelectProgram={onSelectProgram}
        onSave={onSave}
        diagnostics={[]}
        focusDiagnostic={null}
        onPendingOperationsChange={onPendingOperationsChange}
        discardVersion={0}
        onRunCheck={onRunCheck}
      />
    </I18nProvider>,
    { wrapper: MemoryRouter },
  )

  return {
    ...utils,
    onSelectProgram,
    onSave,
  }
}

describe('ProgramsTab — workspace bốn cột', () => {
  it('hiện Explorer | Editor | Library | Inspector, có ba tay kéo và thu gọn Library', async () => {
    renderProgramsTab({ selectedProgramId: 'prog-st-1' })

    expect(screen.getByTestId('pou-explorer-column')).toBeInTheDocument()
    expect(screen.getByTestId('programming-editor-column')).toBeInTheDocument()
    const libraryColumn = screen.getByTestId('quick-library-column')
    expect(libraryColumn).toBeInTheDocument()
    expect(screen.getByTestId('inspector-column')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^workspace-resize-/)).toHaveLength(3)

    const panel = await screen.findByTestId('quick-library-panel')
    fireEvent.click(within(panel).getByRole('button', { name: 'Thu gọn' }))
    await waitFor(() => expect(screen.queryByTestId('quick-library-panel')).not.toBeInTheDocument())
    expect(screen.getByTestId('programs-workspace').style.getPropertyValue('--pgm-library-width')).toBe('44px')
    expect(within(libraryColumn).getByRole('button', { name: 'Mở Thư viện nhanh' })).toBeInTheDocument()
  })

  /* Ngưỡng là `1440`, không phải `1024`.
   *
   * `TC-FBD-RESP-001` khoá sáu mốc của shell FBD: chỉ từ `1440 px` mới có đồng
   * thời bốn cột; ở `1280`/`1024` khay Thư viện và Inspector phải ĐÓNG, chỉ còn
   * nút mở. Bản trước của test này ghim `>=1024` — tức ghim đúng hành vi mà AC
   * cấm — nên nó xanh trong khi cổng e2e đỏ. Hai phép đo nói ngược nhau về cùng
   * một bố cục thì phép đo mang mã AC là phép đo đúng. */
  it('giữ Quick Library FBD ở cột thứ tư khi desktop rộng (>=1440px)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const libraryColumn = screen.getByTestId('quick-library-column')
    const panel = await within(libraryColumn).findByTestId('quick-library-panel')
    expect(panel).toBeVisible()
    expect(screen.getByTestId('programs-workspace').style.getPropertyValue('--pgm-library-width')).not.toBe('44px')
  })

  it('dưới 1440px FBD KHÔNG dựng cột Thư viện nhanh (TC-FBD-RESP-001)', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    // Cột vẫn là một ô lưới, nhưng KHÔNG mount panel: đó là khác biệt giữa
    // "khay đang đóng" và "khay đang mở", thứ mà AC đo ở mốc 1280/1024.
    expect(within(screen.getByTestId('quick-library-column')).queryByTestId('quick-library-panel')).toBeNull()
  })

  /* ===================================================================
   * `#676` AC-2/AC-3 — BA hình thái của Thư viện nhanh khi soạn FBD.
   *
   * Hồi quy được chặn ở đây là chuỗi `5fa334b` → `11d7b33` → PR `#685`: mỗi
   * lần chữa triệu chứng của lần trước, và điểm dừng lại là dải hẹp KHÔNG có
   * lối vào Thư viện nào. `TC-FBD-RESP-001` cấm cột THƯỜNG TRỰC dưới `1440`,
   * không cấm dock/khay có nút mở — các ca dưới đây khoá đúng khoảng hở đó.
   *
   * Đo bằng HÌNH THÁI (track lưới có/không, panel mount hay chưa, nút mở nằm
   * trong hay ngoài khay), không bằng sự có mặt của một lớp Tailwind: một lớp
   * sai ngưỡng vẫn "có mặt" trong `className`. Phép đo toạ độ thật nằm ở lane
   * e2e (`TC-FBD-RESP-001`), nơi có layout engine.
   * =================================================================== */

  const setViewportWidth = (value: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value })
  }
  const libraryTrackWidth = () =>
    screen.getByTestId('programs-workspace').style.getPropertyValue('--pgm-library-width')

  it('AC-676-1: FBD ≥1440 là CỘT — track lưới rộng và panel mở sẵn', async () => {
    setViewportWidth(1440)
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const column = screen.getByTestId('quick-library-column')
    expect(column).toHaveAttribute('data-library-presentation', 'column')
    expect(await within(column).findByTestId('quick-library-panel')).toBeVisible()
    expect(libraryTrackWidth()).not.toBe('0px')
    expect(libraryTrackWidth()).not.toBe('44px')
  })

  it('AC-676-2: FBD 1366×768 là DOCK — có track ray 44px và mở được từ chính cột', async () => {
    /* Đúng khổ mà AC-3 đòi bằng chứng: `1366×768` là laptop phổ thông, và cũng
       là 1080p ở scale 125/150%. Trước `#676` khổ này không có đường nào mở
       Thư viện khi soạn FBD — không phải "khó tìm" mà là không tồn tại. */
    setViewportWidth(1366)
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const column = screen.getByTestId('quick-library-column')
    expect(column).toHaveAttribute('data-library-presentation', 'dock')
    // Dock nằm TRONG luồng lưới: track tồn tại, thu về ray 44px khi đóng.
    expect(libraryTrackWidth()).toBe('44px')
    // Không mount panel khi đóng ⇒ không phải cột thường trực (TC-FBD-RESP-001).
    expect(within(column).queryByTestId('quick-library-panel')).toBeNull()

    // Và nó TỚI ĐƯỢC: nút mở nằm ngay trong cột, bấm là có panel.
    fireEvent.click(within(column).getByRole('button', { name: 'Mở Thư viện nhanh' }))
    const panel = await within(column).findByTestId('quick-library-panel')
    expect(panel).toBeVisible()
    // Mở dock thì track nở ra — canvas hẹp lại thật, đây là khác biệt đo được
    // với drawer (drawer `fixed`, track giữ `0px`).
    expect(libraryTrackWidth()).not.toBe('44px')
    expect(libraryTrackWidth()).not.toBe('0px')
  })

  it('AC-676-3: FBD <1280 là DRAWER — không chiếm track, mở từ nút ngoài khay', async () => {
    setViewportWidth(1024)
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const column = screen.getByTestId('quick-library-column')
    expect(column).toHaveAttribute('data-library-presentation', 'drawer')
    // KHÔNG chiếm chỗ vẽ: ở khổ hẹp chỗ vẽ là thứ đắt nhất.
    expect(libraryTrackWidth()).toBe('0px')
    expect(within(column).queryByTestId('quick-library-panel')).toBeNull()
    /* Khay đóng thì RỖNG — không thanh ray, không nút, không gì cả.
     *
     * Không khẳng định `.not.toBeVisible()` ở đây, và đó là chủ ý: jsdom không
     * nạp stylesheet Tailwind nên `class="hidden"` KHÔNG thành `display:none`,
     * phép đo ấy sẽ đo sự có mặt của một chuỗi ký tự chứ không đo hình thái —
     * đúng thứ `AC-2` cấm. Phép đo khuất/hiện thật thuộc lane e2e, nơi có
     * layout engine; ở đây đo thứ jsdom đo được thật: cây con rỗng. */
    expect(column).toBeEmptyDOMElement()

    // Nút mở nằm NGOÀI khay, trên đầu cột soạn thảo — vì khay không có ray.
    const editorColumn = screen.getByTestId('programming-editor-column')
    const opener = within(editorColumn).getByRole('button', { name: 'Mở Thư viện nhanh' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(opener)

    expect(await within(column).findByTestId('quick-library-panel')).toBeVisible()
    expect(opener).toHaveAttribute('aria-expanded', 'true')
    // Vẫn không lấy track lưới khi đã mở: drawer phủ lên canvas, không đẩy nó.
    expect(libraryTrackWidth()).toBe('0px')
    // Phủ lên nội dung ⇒ phải khai là `dialog`, khác hẳn bản `docked`.
    expect(within(column).getByRole('dialog')).toBeInTheDocument()
  })

  it('AC-676-4: Escape đóng drawer Thư viện nhanh và trả focus về nút mở', async () => {
    setViewportWidth(1024)
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const column = screen.getByTestId('quick-library-column')
    const opener = within(screen.getByTestId('programming-editor-column'))
      .getByRole('button', { name: 'Mở Thư viện nhanh' })
    fireEvent.click(opener)
    await within(column).findByTestId('quick-library-panel')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(within(column).queryByTestId('quick-library-panel')).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('AC-676-5: đổi khổ không rò trạng thái — mở khay ở dải hẹp không mở sẵn cột ở dải rộng', async () => {
    /* Hai dải dùng hai trạng thái tách nhau. Gộp lại thì một lần mở khay ở
       `1366` sẽ làm cột ở `1920` tự mở theo, và ngược lại — hai khổ không liên
       quan gì tới nhau lại kéo nhau. */
    setViewportWidth(1440)
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const column = screen.getByTestId('quick-library-column')
    const panel = await within(column).findByTestId('quick-library-panel')
    fireEvent.click(within(panel).getByRole('button', { name: 'Thu gọn' }))
    await waitFor(() => expect(within(column).queryByTestId('quick-library-panel')).toBeNull())
    // Cột đã thu về ray — trạng thái này là của `column`, không phải của dock.
    expect(libraryTrackWidth()).toBe('44px')
    expect(within(column).getByRole('button', { name: 'Mở Thư viện nhanh' })).toBeInTheDocument()
  })

  it('AC-676-7: dock đang mở mà thu cửa sổ xuống <1280 thì drawer KHÔNG tự bung ra', async () => {
    /* Hồi quy thật, `TC-FBD-RESP-001` bắt được ở mốc `1279` khi `dock` và
     * `drawer` còn dùng chung một biến mở/đóng: người dùng mở dock ở `1366`
     * rồi thu cửa sổ, trạng thái mở đi theo, và drawer là tấm `fixed` cao hết
     * màn phủ 24rem mép phải — nó tự bung ra đè lên canvas mà không ai bấm gì,
     * đúng lúc màn hình đã hẹp nhất. Dock đẩy chỗ nên mở sẵn vô hại; drawer
     * phủ chỗ nên mở sẵn là cướp mặt vẽ. */
    setViewportWidth(1366)
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    const column = screen.getByTestId('quick-library-column')
    fireEvent.click(within(column).getByRole('button', { name: 'Mở Thư viện nhanh' }))
    await within(column).findByTestId('quick-library-panel')

    // Thu cửa sổ qua biên 1280 — `useMinWidth` nghe `resize` khi không có matchMedia.
    setViewportWidth(1279)
    fireEvent(window, new Event('resize'))

    await waitFor(() =>
      expect(screen.getByTestId('quick-library-column'))
        .toHaveAttribute('data-library-presentation', 'drawer'))
    expect(within(screen.getByTestId('quick-library-column')).queryByTestId('quick-library-panel'))
      .toBeNull()
    expect(libraryTrackWidth()).toBe('0px')
  })

  it('AC-676-6: ST giữ CỘT ở mọi khổ — §7.5 chỉ nói về FBD', async () => {
    setViewportWidth(1024)
    renderProgramsTab({ selectedProgramId: 'prog-st-1' })

    const column = screen.getByTestId('quick-library-column')
    expect(column).toHaveAttribute('data-library-presentation', 'column')
    expect(await within(column).findByTestId('quick-library-panel')).toBeVisible()
  })

  it('G-15: bảng Interface bám theo declaration đang sửa trong buffer, không chờ save/read-back', async () => {
    const source = 'PROGRAM ST_PROG\nVAR_INPUT\n  Sensor : BOOL;\nEND_VAR\nEND_PROGRAM'
    renderProgramsTab({
      selectedProgramId: 'prog-st-1',
      document: {
        ...draftDoc,
        programs: [fbdProgram, { ...stProgram, document: source }],
      },
    })

    const table = screen.getByTestId('interface-input-table')
    expect(within(table).getByText('Sensor')).toBeInTheDocument()
    expect(within(table).getByText('BOOL')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Mã nguồn ST của ST_PROG'), {
      target: {
        value: 'PROGRAM ST_PROG\nVAR_INPUT\n  SensorSetpoint : REAL;\nEND_VAR\nEND_PROGRAM',
      },
    })

    await waitFor(() => {
      expect(within(table).getByText('SensorSetpoint')).toBeInTheDocument()
      expect(within(table).getByText('REAL')).toBeInTheDocument()
    })
  })
})

describe('ProgramsTab — Luồng A: FBD Node Inspector & Slot Integration', () => {
  it('STATE-003: payload FBD lồng hỏng khóa editor và không làm sập ContextInspector', () => {
    const malformedProgram = {
      ...fbdProgram,
      document: JSON.stringify({ networks: [{}] }),
    }
    renderProgramsTab({
      selectedProgramId: malformedProgram.programId,
      document: { ...draftDoc, programs: [malformedProgram, stProgram] },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('FBD-SCHEMA-JSON-001')
    expect(screen.getByTestId('context-inspector')).toHaveAttribute('data-context', 'PROGRAM')
    expect(screen.queryByLabelText(/Tên biến/i)).toBeNull()
  })

  it('STATE-003: read-back đổi valid sang invalid thu hồi Inspector cũ', async () => {
    const { rerender } = renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })
    fireEvent.click(screen.getByRole('button', { name: /#1 · BOOL · INPUT/ }))
    expect(screen.getByLabelText(/Tên biến/i)).toBeInTheDocument()
    const malformedProgram = { ...fbdProgram, document: JSON.stringify({ networks: [{}] }) }
    rerender(
      <I18nProvider>
        <ProgramsTab
          document={{ ...draftDoc, programs: [malformedProgram, stProgram] }}
          saving={false}
          selectedProgramId="prog-fbd-1"
          onSelectProgram={vi.fn()}
          onSave={vi.fn().mockResolvedValue(true)}
          diagnostics={[]}
          focusDiagnostic={null}
          onPendingOperationsChange={vi.fn()}
          discardVersion={1}
          onRunCheck={vi.fn()}
        />
      </I18nProvider>,
    )
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('FBD-SCHEMA-JSON-001'))
    expect(screen.queryByLabelText(/Tên biến/i)).toBeNull()
    expect(screen.getByTestId('context-inspector')).toHaveAttribute('data-context', 'PROGRAM')
  })

  it('A-T5: Không chọn gì (hoặc chưa chọn node FBD) ⇒ dock không có form sửa node FBD', () => {
    // 1. Khi chưa chọn POU nào
    const { rerender } = renderProgramsTab({ selectedProgramId: undefined })
    expect(screen.getByText(/Chọn một chương trình để xem thuộc tính/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Tên biến/i)).toBeNull()

    // 2. Khi chọn POU FBD nhưng chưa bấm chọn node nào
    rerender(
      <I18nProvider>
        <ProgramsTab
          document={draftDoc}
          saving={false}
          selectedProgramId="prog-fbd-1"
          onSelectProgram={vi.fn()}
          onSave={vi.fn().mockResolvedValue(true)}
          diagnostics={[]}
          focusDiagnostic={null}
          onPendingOperationsChange={vi.fn()}
          discardVersion={0}
          onRunCheck={vi.fn()}
        />
      </I18nProvider>,
    )
    // Chưa chọn node thì Inspector trở về context POU, vẫn không có form mutation của node.
    expect(screen.getByTestId('context-inspector')).toHaveAttribute('data-context', 'PROGRAM')
    expect(screen.queryByLabelText(/Tên biến/i)).toBeNull()
    expect(screen.queryByLabelText(/Kiểu toán hạng/i)).toBeNull()
  })

  it('A-T8: Chọn node xong chọn node khác ⇒ chỉ có đúng 1 form thuộc tính node trong DOM (trong dock Inspector, không có ở canvas)', () => {
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    // 1. Click chọn node #1 (INPUT BOOL)
    fireEvent.click(screen.getByRole('button', { name: /#1 · BOOL · INPUT/ }))

    // Form FbdNodeInspector xuất hiện trong dock Inspector
    const varInput = screen.getByLabelText(/Tên biến/i) as HTMLInputElement
    expect(varInput).toBeInTheDocument()
    expect(varInput.value).toBe('Start')

    // Khẳng định chỉ có đúng 1 ô nhập "Tên biến" trong toàn bộ DOM (không còn khay inline ở canvas)
    expect(screen.getAllByLabelText(/Tên biến/i)).toHaveLength(1)

    // 2. Click chọn sang node #2 (INPUT BOOL Stop)
    fireEvent.click(screen.getByRole('button', { name: /#2 · BOOL · INPUT/ }))

    const varInput2 = screen.getByLabelText(/Tên biến/i) as HTMLInputElement
    expect(varInput2).toBeInTheDocument()
    expect(varInput2.value).toBe('Stop')
    // Vẫn chỉ có đúng 1 form sửa node trong DOM
    expect(screen.getAllByLabelText(/Tên biến/i)).toHaveLength(1)
  })

  it('A-T11: Chọn node FBD rồi chuyển sang POU ST ⇒ target reset, dock không còn form node của POU cũ (CB-2)', () => {
    const { rerender } = renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    // Click chọn node FBD #1
    fireEvent.click(screen.getByRole('button', { name: /#1 · BOOL · INPUT/ }))
    expect(screen.getByLabelText(/Tên biến/i)).toBeInTheDocument()

    // Chuyển sang POU ST
    rerender(
      <I18nProvider>
        <ProgramsTab
          document={draftDoc}
          saving={false}
          selectedProgramId="prog-st-1"
          onSelectProgram={vi.fn()}
          onSave={vi.fn().mockResolvedValue(true)}
          diagnostics={[]}
          focusDiagnostic={null}
          onPendingOperationsChange={vi.fn()}
          discardVersion={0}
          onRunCheck={vi.fn()}
        />
      </I18nProvider>,
    )

    // Form sửa node FBD cũ đã biến mất khỏi dock
    expect(screen.queryByLabelText(/Tên biến/i)).toBeNull()
  })

  it('A-T12: Chọn node, re-render nhiều lần ⇒ onNodeEditorTargetChange không gây lặp vô hạn (CB-3)', () => {
    const { rerender } = renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    // Chọn node
    fireEvent.click(screen.getByRole('button', { name: /#1 · BOOL · INPUT/ }))
    expect(screen.getByLabelText(/Tên biến/i)).toBeInTheDocument()

    // Re-render nhiều lần liên tiếp không làm tràn callstack hay ném Maximum update depth exceeded
    for (let i = 0; i < 5; i++) {
      rerender(
        <I18nProvider>
          <ProgramsTab
            document={draftDoc}
            saving={false}
            selectedProgramId="prog-fbd-1"
            onSelectProgram={vi.fn()}
            onSave={vi.fn().mockResolvedValue(true)}
            diagnostics={[]}
            focusDiagnostic={null}
            onPendingOperationsChange={vi.fn()}
            discardVersion={i}
            onRunCheck={vi.fn()}
          />
        </I18nProvider>,
      )
    }

    // Node inspector vẫn hiển thị ổn định
    expect(screen.getByLabelText(/Tên biến/i)).toBeInTheDocument()
  })

  it('A-T10: Chọn port của một node ⇒ dock hiện block cha kèm dòng port đó; form sửa thuộc về node cha, không sinh khay riêng cho port', () => {
    renderProgramsTab({ selectedProgramId: 'prog-fbd-1' })

    // Bấm vào port OUT của node #1 (INPUT BOOL): aria-label là "BOOL OUTPUT OUT BOOL"
    const [portButton] = screen.getAllByRole('button', { name: 'BOOL OUTPUT OUT BOOL' })
    fireEvent.click(portButton!)

    /* 1. Dock hiện ngữ cảnh FBD_BLOCK của node cha: mục Vào/Ra liệt kê dòng port đó.
       Bám `data-testid` cho phần MỤC, vì tiêu đề mục là câu chữ mà thiết kế được
       phép đổi (`Cổng vào/ra` → `Vào/Ra` khi Inspector gom thành năm mục theo
       `PGM-02B §9`). Nội dung dòng port thì vẫn kiểm bằng text — đó mới là dữ
       liệu, không phải nhãn trang trí. */
    const ioSection = screen.getByTestId('inspector-fbd-io')
    expect(within(ioSection).getByText('← OUT : BOOL')).toBeInTheDocument()

    // 2. Dock hiện form sửa của node cha: ô "Tên biến" mang giá trị "Start" của node #1
    const varInput = screen.getByLabelText(/Tên biến/i) as HTMLInputElement
    expect(varInput).toBeInTheDocument()
    expect(varInput.value).toBe('Start')

    // 3. Chỉ có đúng 1 khay thuộc tính / 1 form trong DOM — không sinh khay riêng cho port
    expect(screen.getAllByLabelText(/Tên biến/i)).toHaveLength(1)
  })
})
