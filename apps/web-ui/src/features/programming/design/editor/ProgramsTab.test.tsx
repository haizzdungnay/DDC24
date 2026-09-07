import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
})

const sampleFbdDoc: FbdDocument = {
  schemaVersion: 1,
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
        document={draftDoc}
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
  )

  return {
    ...utils,
    onSelectProgram,
    onSave,
  }
}

describe('ProgramsTab — Luồng A: FBD Node Inspector & Slot Integration', () => {
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
    // Dock Inspector có ProgramInspector (sửa tên POU), nhưng tuyệt đối KHÔNG có form FbdNodeInspector
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

    // 1. Dock hiện ngữ cảnh FBD_BLOCK của node cha: có mục "Cổng vào/ra" liệt kê dòng port đó
    expect(screen.getByText('Cổng vào/ra')).toBeInTheDocument()
    expect(screen.getByText('← OUT : BOOL')).toBeInTheDocument()

    // 2. Dock hiện form sửa của node cha: ô "Tên biến" mang giá trị "Start" của node #1
    const varInput = screen.getByLabelText(/Tên biến/i) as HTMLInputElement
    expect(varInput).toBeInTheDocument()
    expect(varInput.value).toBe('Start')

    // 3. Chỉ có đúng 1 khay thuộc tính / 1 form trong DOM — không sinh khay riêng cho port
    expect(screen.getAllByLabelText(/Tên biến/i)).toHaveLength(1)
  })
})
