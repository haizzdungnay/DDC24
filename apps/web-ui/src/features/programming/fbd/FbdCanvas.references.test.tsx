import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FbdCanvas } from './FbdCanvas'
import type { FbdDocument } from './model'
import type { FbdWireReferenceMap } from './wireReferences'

function mockPick(viStr: string, _enStr: string) {
  return viStr
}

function createSampleDoc(): FbdDocument {
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: 1,
    profileId: 'revA-1t-1-5-30',
    graphId: 'a0000000-0000-4000-8000-000000000000',
    name: 'CANVAS_REF_TEST',
    networks: [
      {
        id: 'b0000000-0000-4000-8000-000000000000',
        name: 'NW1',
        order: 0,
        nodes: [
          {
            id: 'c0000000-0000-4000-8000-000000000001',
            kind: 'INPUT',
            typeRef: 'REAL',
            executionOrder: 29,
            parameters: { variable: 'DAMPER_POSITION_FEEDBACK' },
            ports: [
              { id: 'd0000000-0000-4000-8000-000000000001', name: 'OUT', direction: 'OUTPUT', dataType: 'REAL', unit: '%', order: 0 },
            ],
          },
          {
            id: 'c0000000-0000-4000-8000-000000000002',
            kind: 'OUTPUT',
            typeRef: 'REAL',
            executionOrder: 30,
            parameters: { variable: 'DAMPER_ACTUATOR_CMD' },
            ports: [
              { id: 'd0000000-0000-4000-8000-000000000002', name: 'IN', direction: 'INPUT', dataType: 'REAL', unit: '%', order: 0 },
            ],
          },
        ],
        wires: [
          {
            id: 'e0000000-0000-4000-8000-000000000001',
            from: { nodeId: 'c0000000-0000-4000-8000-000000000001', portId: 'd0000000-0000-4000-8000-000000000001' },
            to: { nodeId: 'c0000000-0000-4000-8000-000000000002', portId: 'd0000000-0000-4000-8000-000000000002' },
          },
        ],
      },
    ],
  }
}

describe('Module C: Canvas Reference Interactions', () => {
  afterEach(cleanup)

  it('TEST-C-001 & C-002: Bật Peek Wire và Hover Tooltip Card khi rê chuột vào stub', () => {
    const doc = createSampleDoc()
    const wireReferences: FbdWireReferenceMap = {
      'e0000000-0000-4000-8000-000000000001': {
        wireId: 'e0000000-0000-4000-8000-000000000001',
        signalName: 'DAMPER_POSITION_FEEDBACK_OUT',
        createdAt: 1,
      },
    }

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        wireReferences={wireReferences}
        selection={null}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={vi.fn()}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    const sourceStub = screen.getByTestId('fbd-source-stub-d0000000-0000-4000-8000-000000000001')
    expect(sourceStub).toBeInTheDocument()

    // Tên dài không bị cắt khi có chỗ trống
    expect(sourceStub).toHaveTextContent('DAMPER_POSITION_FEEDBACK_OUT')

    // Chưa hover -> Chưa có hover card & peek wire
    expect(screen.queryByTestId('fbd-peek-wire')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fbd-reference-hover-card')).not.toBeInTheDocument()

    // TEST-C-001: Rê chuột vào Source Stub -> Hiện Peek Wire & Card thông tin chi tiết
    fireEvent.pointerEnter(sourceStub, { clientX: 300, clientY: 400 })
    expect(screen.getByTestId('fbd-peek-wire')).toBeInTheDocument()

    const card = screen.getByTestId('fbd-reference-hover-card')
    expect(card).toBeInTheDocument()
    expect(card).toHaveTextContent('DAMPER_POSITION_FEEDBACK_OUT')
    expect(card).toHaveTextContent('DAMPER_POSITION_FEEDBACK')
    expect(card).toHaveTextContent('DAMPER_ACTUATOR_CMD')
    expect(card).toHaveTextContent('Giá trị truyền chi tiết')

    // TEST-C-002: Rời chuột khỏi Source Stub -> Ẩn
    fireEvent.pointerLeave(sourceStub)
    expect(screen.queryByTestId('fbd-peek-wire')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fbd-reference-hover-card')).not.toBeInTheDocument()
  })

  it('TEST-C-003 & C-004: Kích hoạt Inline Rename bằng F2 và huỷ bằng Escape', () => {
    const doc = createSampleDoc()
    const wireId = 'e0000000-0000-4000-8000-000000000001'
    const wireReferences: FbdWireReferenceMap = {
      [wireId]: {
        wireId,
        signalName: 'TEMP_SIG',
        createdAt: 1,
      },
    }

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        wireReferences={wireReferences}
        selection={{ kind: 'wire', networkId: doc.networks[0].id, wireId }}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={vi.fn()}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    fireEvent.keyDown(window, { key: 'F2' })

    const overlay = screen.getByTestId('fbd-inline-rename-overlay')
    expect(overlay).toBeInTheDocument()
    const input = screen.getByTestId('fbd-inline-rename-input') as HTMLInputElement
    expect(input.value).toBe('TEMP_SIG')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('fbd-inline-rename-overlay')).not.toBeInTheDocument()
  })

  it('TEST-C-005: Menu chuột phải trên dây có mục "Chuyển thành tham chiếu"', () => {
    const doc = createSampleDoc()
    const dispatch = vi.fn()

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        selection={null}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={dispatch}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    const wirePath = screen.getByRole('button', { name: /Dây nối/i })
    fireEvent.contextMenu(wirePath)

    const cutOption = screen.getByRole('menuitem', { name: /Chuyển thành tham chiếu/i })
    expect(cutOption).toBeInTheDocument()

    fireEvent.click(cutOption)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001',
    })
  })

  it('Menu chuột phải trên stub hỗ trợ kéo dài dây nối (+32px)', () => {
    const doc = createSampleDoc()
    const wireId = 'e0000000-0000-4000-8000-000000000001'
    const wireReferences: FbdWireReferenceMap = {
      [wireId]: {
        wireId,
        signalName: 'TEMP_SIG',
        createdAt: 1,
        sourceOffset: 16,
      },
    }
    const dispatch = vi.fn()

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        wireReferences={wireReferences}
        selection={null}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={dispatch}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    const sourceStub = screen.getByTestId('fbd-source-stub-d0000000-0000-4000-8000-000000000001')
    fireEvent.contextMenu(sourceStub)

    const extendOption = screen.getByRole('menuitem', { name: /Kéo dài dây nối/i })
    expect(extendOption).toBeInTheDocument()
    fireEvent.click(extendOption)

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_REFERENCE_OFFSET',
      networkId: doc.networks[0].id,
      wireId,
      target: 'source',
      offset: 16 + 32,
    })
  })

  it('Double click vào Sink Stub gọi điều hướng nhảy tới khối nguồn (Go to Partner)', () => {
    const doc = createSampleDoc()
    const wireId = 'e0000000-0000-4000-8000-000000000001'
    const wireReferences: FbdWireReferenceMap = {
      [wireId]: {
        wireId,
        signalName: 'TEMP_SIG',
        createdAt: 1,
      },
    }

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        wireReferences={wireReferences}
        selection={null}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={vi.fn()}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    const sinkStub = screen.getByTestId(`fbd-sink-stub-${wireId}`)
    expect(sinkStub).toBeInTheDocument()
    expect(() => fireEvent.doubleClick(sinkStub)).not.toThrow()
  })

  it("TEST-C-006: UI Inline Rename nhap ten sai cu phap / trung tu khoa IEC -> chan dispatch, bao loi", () => {
    const doc = createSampleDoc()
    const wireId = "e0000000-0000-4000-8000-000000000001"
    const wireReferences: FbdWireReferenceMap = {
      [wireId]: {
        wireId,
        signalName: "TEMP_SIG",
        createdAt: 1,
      },
    }
    const dispatch = vi.fn()

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        wireReferences={wireReferences}
        selection={{ kind: "wire", networkId: doc.networks[0].id, wireId }}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={dispatch}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    fireEvent.keyDown(window, { key: "F2" })
    const input = screen.getByTestId("fbd-inline-rename-input") as HTMLInputElement

    // Nhập từ khóa IEC "VAR"
    fireEvent.change(input, { target: { value: "VAR" } })
    fireEvent.keyDown(input, { key: "Enter" })

    // Bị chặn dispatch và hiện thông báo lỗi
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getByText(/từ khóa IEC/i)).toBeInTheDocument()

    // Nhập tên rỗng
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getByText(/không được để trống/i)).toBeInTheDocument()
  })

  it("TEST-C-007: Drag offset khong ban action trung gian khi pointermove, chi ban 1 lan khi pointerup", () => {
    const doc = createSampleDoc()
    const wireId = "e0000000-0000-4000-8000-000000000001"
    const wireReferences: FbdWireReferenceMap = {
      [wireId]: {
        wireId,
        signalName: "TEMP_SIG",
        createdAt: 1,
        sourceOffset: 8,
      },
    }
    const dispatch = vi.fn()

    render(
      <FbdCanvas
        network={doc.networks[0]}
        document={doc}
        layout={doc.layout}
        wireReferences={wireReferences}
        selection={null}
        connectionFromPortId={null}
        canEdit={true}
        dispatch={dispatch}
        pick={mockPick}
        registerPort={vi.fn()}
      />
    )

    const sourceStub = screen.getByTestId("fbd-source-stub-d0000000-0000-4000-8000-000000000001")
    const dragHandle = sourceStub.querySelector(".cursor-ew-resize")!
    expect(dragHandle).toBeInTheDocument()

    // 1. PointerDown bat dau keo
    fireEvent.pointerDown(dragHandle, { button: 0, pointerId: 1, clientX: 200 })
    expect(dispatch).not.toHaveBeenCalled()

    // 2. PointerMove qua 3 toa do
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 230 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 250 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 260 })
    // Chua duoc phat action len reducer trong luc di chuot
    expect(dispatch).not.toHaveBeenCalled()

    // 3. PointerUp hoan tat
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 260 })
    // Chi ban dung 1 lan action duy nhat voi gia tri offset cuoi
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_REFERENCE_OFFSET",
      networkId: doc.networks[0].id,
      wireId,
      target: "source",
      offset: 8 + (260 - 200),
    })
  })

})
