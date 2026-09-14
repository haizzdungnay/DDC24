import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import type { FbdDocument, FbdNetwork } from './model'
import type { FbdEditorAction, FbdSelection } from './commands'
import { FbdCanvas, LIBRARY_DRAG_TYPE } from './FbdCanvas'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function mockPick(viStr: string, _enStr: string) {
  return viStr
}

interface RenderCanvasOptions {
  network?: FbdNetwork
  document?: FbdDocument
  layout?: FbdDocument['layout']
  selection?: FbdSelection | null
  connectionFromPortId?: string | null
  canEdit?: boolean
  snapEnabled?: boolean
  snapSize?: 4 | 8 | 16 | 32
  pendingPlacement?: { entryId: string } | null
  onCancelPlacement?: () => void
  onCommitPlacement?: () => void
}

function renderCanvas(options: RenderCanvasOptions = {}) {
  const doc = options.document ?? golden()
  const network = options.network ?? doc.networks[0]
  const layout = options.layout ?? doc.layout
  const selection = options.selection !== undefined ? options.selection : null
  const connectionFromPortId = options.connectionFromPortId ?? null
  const canEdit = options.canEdit !== undefined ? options.canEdit : true
  const dispatch = vi.fn((_action: FbdEditorAction) => {})
  const registerPort = vi.fn()
  const onCancelPlacement = options.onCancelPlacement ?? vi.fn()
  const onCommitPlacement = options.onCommitPlacement ?? vi.fn()

  const utils = render(
    <FbdCanvas
      network={network}
      document={doc}
      layout={layout}
      selection={selection}
      connectionFromPortId={connectionFromPortId}
      canEdit={canEdit}
      dispatch={dispatch}
      pick={mockPick}
      registerPort={registerPort}
      snapEnabled={options.snapEnabled ?? true}
      snapSize={options.snapSize ?? 8}
      pendingPlacement={options.pendingPlacement ?? null}
      onCancelPlacement={onCancelPlacement}
      onCommitPlacement={onCommitPlacement}
    />
  )

  const surface = screen.getByRole('group', { name: new RegExp(`Sơ đồ ${network.name}`) })
  // Provide scene bounding rect for screenToGraph calculations
  surface.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  })

  return { ...utils, dispatch, registerPort, surface, network, onCancelPlacement, onCommitPlacement }
}

function getPortElement(surface: HTMLElement, direction: 'INPUT' | 'OUTPUT'): SVGGElement {
  const el = Array.from(surface.querySelectorAll<SVGGElement>('g[role="button"]')).find(
    (g) => g.querySelector('circle') !== null && g.getAttribute('aria-label')?.includes(direction)
  )
  if (!el) throw new Error(`Port ${direction} not found`)
  return el
}

function getPortCenter(port: SVGGElement): { x: number; y: number } {
  const hit = port.querySelector<SVGCircleElement>('[data-fbd-port-hit]')
  if (!hit) throw new Error('Port hit target not found')
  return {
    x: Number(hit.getAttribute('cx')),
    y: Number(hit.getAttribute('cy')),
  }
}

beforeEach(() => {
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})
afterEach(cleanup)

describe('FbdCanvas — Task 6 Placement & Wiring Interaction Tests', () => {
  describe('TC-FBD-LIB-001: Native Drag & Drop', () => {
    it('thả entry AVAILABLE thành công: dispatch ADD_NODE với toạ độ đã snap', () => {
      const { surface, dispatch, network } = renderCanvas()

      const dataTransfer = {
        types: [LIBRARY_DRAG_TYPE],
        getData: (type: string) => (type === LIBRARY_DRAG_TYPE ? 'OR' : ''),
        dropEffect: 'none',
      }

      // dragOver
      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      Object.assign(dragOverEvent, { dataTransfer, clientX: 203, clientY: 101 })
      surface.dispatchEvent(dragOverEvent)

      // drop
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(dropEvent, { dataTransfer, clientX: 203, clientY: 101 })
      surface.dispatchEvent(dropEvent)

      expect(dispatch).toHaveBeenCalledTimes(1)
      const action = dispatch.mock.calls[0][0]
      expect(action.type).toBe('ADD_NODE')
      if (action.type === 'ADD_NODE') {
        expect(action.networkId).toBe(network.id)
        expect(action.node.typeRef).toBe('OR')
        // 203 snapped to 8 -> 200, 101 snapped to 8 -> 104
        expect(action.position).toEqual({ x: 200, y: 104 })
      }
    })

    it('TC-FBD-LIB-001 (PID): thả khối PID (REVIEW_REQUIRED) bị từ chối ngay tại canvas, 0 dispatch', () => {
      const { surface, dispatch } = renderCanvas()

      const dataTransfer = {
        types: [LIBRARY_DRAG_TYPE],
        getData: (type: string) => (type === LIBRARY_DRAG_TYPE ? 'PID' : ''),
        dropEffect: 'none',
      }

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(dropEvent, { dataTransfer, clientX: 200, clientY: 100 })
      surface.dispatchEvent(dropEvent)

      expect(dispatch).not.toHaveBeenCalled()
    })

    it('chặn thả khối khi canEdit = false (chế độ chỉ đọc)', () => {
      const { surface, dispatch } = renderCanvas({ canEdit: false })

      const dataTransfer = {
        types: [LIBRARY_DRAG_TYPE],
        getData: (type: string) => (type === LIBRARY_DRAG_TYPE ? 'AND' : ''),
        dropEffect: 'none',
      }

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.assign(dropEvent, { dataTransfer, clientX: 100, clientY: 100 })
      surface.dispatchEvent(dropEvent)

      expect(dispatch).not.toHaveBeenCalled()
    })

    it('hiển thị ghost layer khi dragover (native HTML5 DnD) và dọn sạch khi dragleave / drop', () => {
      const { surface } = renderCanvas()

      // Giả lập HTML5 Drag & Drop protected mode: getData trả rỗng trong dragover,
      // nhưng types mang kiểu mã hoá entryId: application/x-mkddc-library-entry/OR
      const dataTransfer = {
        types: [LIBRARY_DRAG_TYPE, `${LIBRARY_DRAG_TYPE}/OR`],
        getData: (_type: string) => '',
        dropEffect: 'none',
      }

      // 1. dragEnter + dragOver: ghost xuất hiện tại vị trí snapped
      const dragEnterEvent = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.assign(dragEnterEvent, { dataTransfer, clientX: 160, clientY: 120 })
      fireEvent(surface, dragEnterEvent)

      const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
      Object.assign(dragOverEvent, { dataTransfer, clientX: 160, clientY: 120 })
      fireEvent(surface, dragOverEvent)

      let ghost = surface.querySelector('[data-fbd-ghost="true"]')
      expect(ghost).toBeInTheDocument()
      expect(ghost?.getAttribute('transform')).toBe('translate(160, 120)')

      // 2. dragLeave: ghost bị gỡ bỏ
      const dragLeaveEvent = new Event('dragleave', { bubbles: true, cancelable: true })
      Object.assign(dragLeaveEvent, { dataTransfer, relatedTarget: null })
      fireEvent(surface, dragLeaveEvent)

      ghost = surface.querySelector('[data-fbd-ghost="true"]')
      expect(ghost).not.toBeInTheDocument()

      // 3. dragOver lại rồi drop: ghost biến mất sau drop
      fireEvent(surface, dragOverEvent)
      expect(surface.querySelector('[data-fbd-ghost="true"]')).toBeInTheDocument()

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      const dropDataTransfer = {
        ...dataTransfer,
        getData: (type: string) => (type === LIBRARY_DRAG_TYPE ? 'OR' : ''),
      }
      Object.assign(dropEvent, { dataTransfer: dropDataTransfer, clientX: 160, clientY: 120 })
      fireEvent(surface, dropEvent)

      expect(surface.querySelector('[data-fbd-ghost="true"]')).not.toBeInTheDocument()
    })
  })

  describe('TC-FBD-LIB-002: Click-to-place Ghost element & Cancellation', () => {
    it('hiển thị ghost layer khi có pendingPlacement và con trỏ di chuyển', () => {
      const { surface } = renderCanvas({
        pendingPlacement: { entryId: 'AND' },
      })

      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.pointerMove(bg, { pointerId: 1, clientX: 160, clientY: 120 })

      const ghost = surface.querySelector('[data-fbd-ghost="true"]')
      expect(ghost).toBeInTheDocument()
      expect(ghost?.getAttribute('transform')).toBe('translate(160, 120)')
    })

    it('pointerup trên background commit ADD_NODE và gọi onCommitPlacement', () => {
      const { surface, dispatch, onCommitPlacement } = renderCanvas({
        pendingPlacement: { entryId: 'AND' },
      })

      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.pointerDown(bg, { pointerId: 1, clientX: 162, clientY: 121 })
      fireEvent.pointerUp(bg, { pointerId: 1, clientX: 162, clientY: 121 })

      expect(dispatch).toHaveBeenCalledTimes(1)
      const action = dispatch.mock.calls[0][0]
      expect(action.type).toBe('ADD_NODE')
      if (action.type === 'ADD_NODE') {
        expect(action.node.typeRef).toBe('AND')
        // 162 -> 160, 121 -> 120
        expect(action.position).toEqual({ x: 160, y: 120 })
      }
      expect(onCommitPlacement).toHaveBeenCalledTimes(1)
    })

    it('Escape khi đang có pendingPlacement huỷ bỏ ghost và gọi onCancelPlacement (0 mutation)', () => {
      const { dispatch, onCancelPlacement } = renderCanvas({
        pendingPlacement: { entryId: 'AND' },
      })

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(dispatch).not.toHaveBeenCalled()
      expect(onCancelPlacement).toHaveBeenCalledTimes(1)
    })

    it('pointercancel trên background huỷ bỏ placement (0 mutation)', () => {
      const { surface, dispatch, onCancelPlacement } = renderCanvas({
        pendingPlacement: { entryId: 'AND' },
      })

      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.pointerCancel(bg, { pointerId: 1 })

      expect(dispatch).not.toHaveBeenCalled()
      expect(onCancelPlacement).toHaveBeenCalledTimes(1)
    })
  })

  describe('TC-FBD-LIB-004: Đặt block khi đang chọn một port', () => {
    it('đặt block khi connectionFromPortId đang chọn không tự kích hoạt tạo wire thừa', () => {
      const doc = golden()
      const sourcePortId = doc.networks[0].nodes[0].ports[0].id
      const { surface, dispatch } = renderCanvas({
        connectionFromPortId: sourcePortId,
        pendingPlacement: { entryId: 'OR' },
      })

      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.pointerUp(bg, { pointerId: 1, clientX: 200, clientY: 100 })

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][0].type).toBe('ADD_NODE')
      // Không có action ADD_WIRE nào được phát
      expect(dispatch.mock.calls.some((c) => c[0].type === 'ADD_WIRE')).toBe(false)
    })
  })

  describe('TC-FBD-WIRE-001 & TC-FBD-WIRE-003: Pointer Wire Drag & Typed Wiring', () => {
    it('kéo pointer từ OUTPUT sang INPUT tạo action ADD_WIRE hợp lệ với preview layer', () => {
      const doc = golden()
      doc.networks[0].wires = []
      const { surface, dispatch, network } = renderCanvas({ document: doc })

      const outputPortG = getPortElement(surface, 'OUTPUT')
      expect(outputPortG).toBeInTheDocument()

      const inputPortG = getPortElement(surface, 'INPUT')
      expect(inputPortG).toBeInTheDocument()

      const output = getPortCenter(outputPortG)
      const input = getPortCenter(inputPortG)

      // 1. pointerdown trên OUTPUT port -> bắt đầu wire drag
      fireEvent.pointerDown(outputPortG, { pointerId: 5, button: 0, clientX: output.x, clientY: output.y })

      // Preview layer xuất hiện
      const preview = surface.querySelector('[data-fbd-wire-preview="true"]')
      expect(preview).toBeInTheDocument()

      // 2. pointermove trên window -> preview cập nhật
      fireEvent.pointerMove(window, { pointerId: 5, clientX: input.x, clientY: input.y })

      // 3. Nhả đúng trên INPUT phải commit dù port chặn event khỏi node cha.
      fireEvent.pointerUp(inputPortG, { pointerId: 5, clientX: input.x, clientY: input.y })

      expect(dispatch).toHaveBeenCalledTimes(1)
      const action = dispatch.mock.calls[0][0]
      expect(action.type).toBe('ADD_WIRE')
      if (action.type === 'ADD_WIRE') {
        expect(action.networkId).toBe(network.id)
        expect(action.wire.id).toBeDefined()
        expect(action.wire.from.portId).toBeDefined()
        expect(action.wire.to.portId).toBeDefined()
      }

      // Preview layer biến mất sau khi nhả chuột
      expect(surface.querySelector('[data-fbd-wire-preview="true"]')).toBeNull()
    })

    it('kéo ngược từ INPUT về OUTPUT vẫn tạo dây canonical OUTPUT → INPUT', () => {
      const doc = golden()
      doc.networks[0].wires = []
      const { surface, dispatch } = renderCanvas({ document: doc })
      const inputPortG = getPortElement(surface, 'INPUT')
      const outputPortG = getPortElement(surface, 'OUTPUT')
      const input = getPortCenter(inputPortG)
      const output = getPortCenter(outputPortG)
      const inputId = inputPortG.querySelector('[data-fbd-port-hit]')?.getAttribute('data-fbd-port-hit')
      const outputId = outputPortG.querySelector('[data-fbd-port-hit]')?.getAttribute('data-fbd-port-hit')

      fireEvent.pointerDown(inputPortG, { pointerId: 5, button: 0, clientX: input.x, clientY: input.y })
      expect(surface.querySelector('[data-fbd-wire-preview="true"]')).toBeInTheDocument()
      fireEvent.pointerMove(window, { pointerId: 5, clientX: output.x, clientY: output.y })
      fireEvent.pointerUp(outputPortG, { pointerId: 5, clientX: output.x, clientY: output.y })

      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ADD_WIRE',
        wire: expect.objectContaining({
          from: expect.objectContaining({ portId: outputId }),
          to: expect.objectContaining({ portId: inputId }),
        }),
      }))
    })

    it('Ctrl + click: nhịp 1 chọn OUTPUT port, nhịp 2 click INPUT port dispatch ADD_WIRE', () => {
      const doc = golden()
      doc.networks[0].wires = []
      const { surface, dispatch, network } = renderCanvas({ document: doc })
      const outputPortG = getPortElement(surface, 'OUTPUT')
      const inputPortG = getPortElement(surface, 'INPUT')

      // Nhịp 1: Ctrl + click vào OUTPUT port
      fireEvent.click(outputPortG, { ctrlKey: true })
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'BEGIN_OR_COMMIT_CONNECTION' }))

      // Nhịp 2: Click vào INPUT port
      fireEvent.click(inputPortG)
      const wireCalls = dispatch.mock.calls.filter((c) => c[0].type === 'ADD_WIRE')
      expect(wireCalls).toHaveLength(1)
      const addWireAction = wireCalls[0][0]
      if (addWireAction.type === 'ADD_WIRE') {
        expect(addWireAction.networkId).toBe(network.id)
      }
    })

    it('chuỗi pointerdown/up/click thật không để wire-drag nuốt mất chế độ nối hai click', () => {
      const doc = golden()
      doc.networks[0].wires = []
      const { surface, dispatch } = renderCanvas({ document: doc })
      const outputPortG = getPortElement(surface, 'OUTPUT')
      const inputPortG = getPortElement(surface, 'INPUT')
      const output = getPortCenter(outputPortG)
      const input = getPortCenter(inputPortG)

      fireEvent.pointerDown(outputPortG, { pointerId: 31, button: 0, clientX: output.x, clientY: output.y })
      fireEvent.pointerUp(outputPortG, { pointerId: 31, button: 0, clientX: output.x, clientY: output.y })
      fireEvent.click(outputPortG)

      fireEvent.pointerDown(inputPortG, { pointerId: 32, button: 0, clientX: input.x, clientY: input.y })
      fireEvent.pointerUp(inputPortG, { pointerId: 32, button: 0, clientX: input.x, clientY: input.y })
      fireEvent.click(inputPortG)

      expect(dispatch.mock.calls.filter((call) => call[0].type === 'ADD_WIRE')).toHaveLength(1)
    })

    it('pointercancel trong lúc kéo dây dọn dẹp preview layer (0 mutation)', () => {
      const { surface, dispatch } = renderCanvas()
      const outputPortG = getPortElement(surface, 'OUTPUT')

      fireEvent.pointerDown(outputPortG, { pointerId: 5, button: 0, clientX: 100, clientY: 100 })
      expect(surface.querySelector('[data-fbd-wire-preview="true"]')).toBeInTheDocument()

      fireEvent.pointerCancel(window, { pointerId: 5 })
      expect(surface.querySelector('[data-fbd-wire-preview="true"]')).toBeNull()
      expect(dispatch).not.toHaveBeenCalled()
    })
  })

  describe('G4: Cách ly cử chỉ port với node drag', () => {
    it('pointerdown trên port gọi stopPropagation, không kích hoạt kéo di chuyển node', () => {
      const { surface, dispatch } = renderCanvas()
      const outputPortG = getPortElement(surface, 'OUTPUT')

      fireEvent.pointerDown(outputPortG, { pointerId: 1, button: 0, clientX: 50, clientY: 50 })
      fireEvent.pointerMove(outputPortG, { pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerUp(outputPortG, { pointerId: 1, clientX: 100, clientY: 100 })

      // Không có action SET_NODE_POSITION hay MULTI_MOVE nào
      const moveCalls = dispatch.mock.calls.filter(
        (c) => c[0].type === 'SET_NODE_POSITION' || c[0].type === 'MULTI_MOVE'
      )
      expect(moveCalls).toHaveLength(0)
    })
  })
})
