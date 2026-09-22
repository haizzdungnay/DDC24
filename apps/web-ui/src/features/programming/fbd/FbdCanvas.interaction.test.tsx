import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import type { FbdDocument, FbdNetwork } from './model'
import type { FbdEditorAction, FbdSelection } from './commands'
import { FbdCanvas } from './FbdCanvas'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function mockPick(viStr: string, _enStr: string) {
  return viStr
}

interface RenderCanvasOptions {
  network?: FbdNetwork
  layout?: FbdDocument['layout']
  selection?: FbdSelection | null
  connectionFromPortId?: string | null
  canEdit?: boolean
  wireStyle?: 'ORTHOGONAL' | 'BEZIER'
  gridVisible?: boolean
  snapEnabled?: boolean
  snapSize?: 4 | 8 | 16 | 32
  marqueeMode?: boolean
  selectionRevision?: number
}

function renderCanvas(options: RenderCanvasOptions = {}) {
  const doc = golden()
  const network = options.network ?? doc.networks[0]
  const layout = options.layout ?? doc.layout
  const selection = options.selection !== undefined ? options.selection : null
  const connectionFromPortId = options.connectionFromPortId ?? null
  const canEdit = options.canEdit !== undefined ? options.canEdit : true
  const dispatch = vi.fn((_action: FbdEditorAction) => {})
  const registerPort = vi.fn()

  const utils = render(
    <FbdCanvas
      network={network}
      layout={layout}
      selection={selection}
      connectionFromPortId={connectionFromPortId}
      canEdit={canEdit}
      dispatch={dispatch}
      pick={mockPick}
      registerPort={registerPort}
      wireStyle={options.wireStyle}
      gridVisible={options.gridVisible}
      snapEnabled={options.snapEnabled}
      snapSize={options.snapSize}
      marqueeMode={options.marqueeMode}
      selectionRevision={options.selectionRevision}
    />
  )

  const surface = screen.getByRole('group', { name: new RegExp(`Sơ đồ ${network.name}`) })
  return { ...utils, dispatch, registerPort, surface, network }
}

beforeEach(() => {
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})
afterEach(cleanup)

describe('FbdCanvas — Task 5 Viewport, Layering & Interaction', () => {
  describe('Layering & SVG Grid & Accessibility attributes', () => {
    it('renders SVG with data-fbd-network-id attribute', () => {
      const { surface, network } = renderCanvas()
      expect(surface).toHaveAttribute('data-fbd-network-id', network.id)
    })

    it('renders grid pattern when gridVisible is true (default)', () => {
      const { surface, network } = renderCanvas({ gridVisible: true })
      const pattern = surface.querySelector(`pattern[id="fbd-grid-${network.id}"]`)
      expect(pattern).toBeInTheDocument()
      const gridRect = surface.querySelector(`rect[fill="url(#fbd-grid-${network.id})"]`)
      expect(gridRect).toBeInTheDocument()
    })

    it('does not render grid pattern when gridVisible is false', () => {
      const { surface, network } = renderCanvas({ gridVisible: false })
      const pattern = surface.querySelector(`pattern[id="fbd-grid-${network.id}"]`)
      expect(pattern).toBeNull()
    })

    it('passes wireStyle to geometry (renders orthogonal wires when wireStyle="ORTHOGONAL")', () => {
      const { surface } = renderCanvas({ wireStyle: 'ORTHOGONAL' })
      const paths = surface.querySelectorAll('path[role="button"]')
      expect(paths.length).toBeGreaterThan(0)
      // Orthogonal paths have H or V commands
      const d = paths[0].getAttribute('d') ?? ''
      expect(d).toMatch(/[HV]/)
    })
  })

  describe('Viewport Pan & Context Menu', () => {
    it('prevents default context menu on canvas', () => {
      const { surface } = renderCanvas()
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      const prevented = !surface.dispatchEvent(event)
      expect(prevented).toBe(true)
    })

    it('pans viewport with middle click drag (button === 1)', () => {
      const { surface } = renderCanvas()
      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      // Pointer down button 1
      fireEvent.pointerDown(bg, { pointerId: 1, button: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(bg, { pointerId: 1, clientX: 150, clientY: 130 })
      fireEvent.pointerUp(bg, { pointerId: 1, clientX: 150, clientY: 130 })

      // Check scene transform updated (translate(50, 30))
      const sceneGroup = surface.querySelector('[data-fbd-scene="true"]')
      expect(sceneGroup).toBeInTheDocument()
      expect(sceneGroup?.getAttribute('transform')).toContain('translate(50, 30)')
    })

    it('right click mở menu ngữ cảnh và không chiếm cử chỉ pan', () => {
      const { surface } = renderCanvas()
      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.contextMenu(bg, { clientX: 100, clientY: 100 })

      const sceneGroup = surface.querySelector('[data-fbd-scene="true"]')
      expect(sceneGroup?.getAttribute('transform')).toBeNull()
      expect(screen.getByRole('menu', { name: 'Mặt vẽ' })).toBeInTheDocument()
    })

    it('right click drag vượt ngưỡng 3px kích hoạt pan và chặn menu ngữ cảnh', () => {
      const { surface } = renderCanvas()
      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.pointerDown(bg, { pointerId: 1, button: 2, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(bg, { pointerId: 1, clientX: 150, clientY: 130 })
      fireEvent.pointerUp(bg, { pointerId: 1, clientX: 150, clientY: 130 })

      const sceneGroup = surface.querySelector('[data-fbd-scene="true"]')
      expect(sceneGroup).toBeInTheDocument()
      expect(sceneGroup?.getAttribute('transform')).toContain('translate(50, 30)')

      fireEvent.contextMenu(bg, { clientX: 150, clientY: 130 })
      expect(screen.queryByRole('menu', { name: 'Mặt vẽ' })).toBeNull()
    })

    it('click chuột phải tại chỗ (hoặc di chuyển <= 3px) vẫn mở menu ngữ cảnh', () => {
      const { surface } = renderCanvas()
      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]') || surface
      fireEvent.pointerDown(bg, { pointerId: 1, button: 2, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(bg, { pointerId: 1, clientX: 101, clientY: 101 })
      fireEvent.pointerUp(bg, { pointerId: 1, clientX: 101, clientY: 101 })

      const sceneGroup = surface.querySelector('[data-fbd-scene="true"]')
      expect(sceneGroup?.getAttribute('transform')).toBeNull()

      fireEvent.contextMenu(bg, { clientX: 101, clientY: 101 })
      expect(screen.getByRole('menu', { name: 'Mặt vẽ' })).toBeInTheDocument()
    })

    it('right click dây mở đúng workflow Ngắt dây', () => {
      const { surface, dispatch, network } = renderCanvas()
      const wireHit = surface.querySelector<SVGPathElement>('[data-fbd-wire-hit]')!
      const wireId = wireHit.getAttribute('data-fbd-wire-hit')!

      fireEvent.contextMenu(wireHit, { clientX: 200, clientY: 100 })
      fireEvent.click(screen.getByRole('menuitem', { name: /Ngắt dây/ }))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'DELETE_WIRES',
        networkId: network.id,
        wireIds: [wireId],
      })
    })

    it('right click dây cho nối lại đầu đích và giữ nguyên wire id', () => {
      const { surface, dispatch, network } = renderCanvas()
      const wireHit = surface.querySelector<SVGPathElement>('[data-fbd-wire-hit]')!
      const wireId = wireHit.getAttribute('data-fbd-wire-hit')!
      const wire = network.wires.find((item) => item.id === wireId)!
      const targetHit = surface.querySelector<SVGCircleElement>(`[data-fbd-port-hit="${wire.to.portId}"]`)!
      const targetGroup = targetHit.closest('g')!

      fireEvent.contextMenu(wireHit, { clientX: 200, clientY: 100 })
      fireEvent.click(screen.getByRole('menuitem', { name: /Nối lại đầu đích/ }))
      expect(surface.querySelector('[data-fbd-wire-preview="true"]')).toBeInTheDocument()

      fireEvent.pointerDown(targetGroup, { pointerId: 41, button: 0, clientX: 300, clientY: 100 })
      fireEvent.pointerUp(targetGroup, { pointerId: 41, button: 0, clientX: 300, clientY: 100 })
      fireEvent.click(targetGroup)
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'RECONNECT_WIRE',
        networkId: network.id,
        wireId,
        wire: expect.objectContaining({ id: wireId }),
      }))
    })
  })

  describe('Wheel Zoom', () => {
    it('zooms viewport with wheel event', () => {
      const { surface } = renderCanvas()
      // Mock getBoundingClientRect
      surface.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })

      fireEvent.wheel(surface, { deltaY: -100, clientX: 200, clientY: 150, ctrlKey: true })
      const sceneGroup = surface.querySelector('[data-fbd-scene="true"]')
      expect(sceneGroup).toBeInTheDocument()
      const transform = sceneGroup?.getAttribute('transform') || ''
      const translated = transform.match(/translate\(([-\d.]+), ([-\d.]+)\)/)
      expect(translated).not.toBeNull()
      // translate nằm trong hệ user-unit của SVG nên được chia cho scale 1.12;
      // sau khi SVG scale, điểm graph dưới con trỏ vẫn đứng nguyên trên màn hình.
      expect(Number(translated![1])).toBeCloseTo(-24 / 1.12)
      expect(Number(translated![2])).toBeCloseTo(-18 / 1.12)
    })
  })

  describe('Marquee Selection', () => {
    it('draws transient marquee rect during left-click drag on empty canvas and dispatches SELECT on pointerup', () => {
      const { surface, dispatch, network } = renderCanvas()
      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]')
      expect(bg).toBeInTheDocument()

      surface.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 800,
        bottom: 800,
        right: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })

      // Start drag on empty background at (0, 0)
      fireEvent.pointerDown(bg!, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
      // Move to (500, 500)
      fireEvent.pointerMove(bg!, { pointerId: 1, clientX: 500, clientY: 500 })

      // Transient marquee rect exists
      const marquee = surface.querySelector('[data-fbd-marquee="true"]')
      expect(marquee).toBeInTheDocument()
      expect(dispatch).not.toHaveBeenCalled()

      // Pointer up commits selection
      fireEvent.pointerUp(bg!, { pointerId: 1, clientX: 500, clientY: 500 })
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SELECT',
          selection: expect.objectContaining({
            networkId: network.id,
          }),
        })
      )
    })

    it('cancels marquee selection on Escape or pointercancel without dispatching', () => {
      const { surface, dispatch } = renderCanvas()
      const bg = surface.querySelector('[data-fbd-canvas-bg="true"]')!
      fireEvent.pointerDown(bg, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(bg, { pointerId: 1, clientX: 300, clientY: 300 })
      expect(surface.querySelector('[data-fbd-marquee="true"]')).toBeInTheDocument()

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(surface.querySelector('[data-fbd-marquee="true"]')).toBeNull()
      expect(dispatch).not.toHaveBeenCalled()
    })
  })

  describe('Node & Multi-Node Dragging with Snap and Selection Revision', () => {
    it('drags a single node with snapPoint applied on pointerup', () => {
      const { dispatch, network } = renderCanvas({ snapEnabled: true, snapSize: 8 })
      const node = screen.getByRole('button', { name: /#2 · AND/ })

      // Drag dx=21, dy=23 => should snap to dx=24, dy=24 (or rounded)
      fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(node, { pointerId: 1, clientX: 121, clientY: 123 })
      // No dispatch during move
      expect(dispatch).not.toHaveBeenCalled()

      fireEvent.pointerUp(node, { pointerId: 1, clientX: 121, clientY: 123 })
      expect(dispatch).toHaveBeenCalledTimes(1)
      const call = dispatch.mock.calls[0][0]
      expect(call.type).toBe('SET_NODE_POSITION')
      if (call.type === 'SET_NODE_POSITION') {
        expect(call.networkId).toBe(network.id)
        expect(call.x % 8).toBe(0)
        expect(call.y % 8).toBe(0)
      }
    })

    it('bypasses snap when altKey is true', () => {
      const { dispatch } = renderCanvas({ snapEnabled: true, snapSize: 8 })
      const node = screen.getByRole('button', { name: /#2 · AND/ })

      fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(node, { pointerId: 1, clientX: 123, clientY: 127, altKey: true })
      fireEvent.pointerUp(node, { pointerId: 1, clientX: 123, clientY: 127, altKey: true })

      expect(dispatch).toHaveBeenCalledTimes(1)
      const call = dispatch.mock.calls[0][0]
      expect(call.type).toBe('SET_NODE_POSITION')
      if (call.type === 'SET_NODE_POSITION') {
        // dx=23, dy=27 not snapped to 8
        expect(call.x % 8).not.toBe(0)
      }
    })

    it('drags multi-node selection and dispatches MULTI_MOVE with expectedSelectionRevision', () => {
      const doc = golden()
      const net = doc.networks[0]
      const node1 = net.nodes[0]
      const node2 = net.nodes[1]
      const selection: FbdSelection = {
        kind: 'multi-node',
        networkId: net.id,
        nodeIds: [node1.id, node2.id],
      }

      const { dispatch } = renderCanvas({
        network: net,
        selection,
        selectionRevision: 42,
        snapEnabled: false,
      })

      const nodeButton = screen.getByRole('button', { name: new RegExp(`#${node1.executionOrder} · `) })
      fireEvent.pointerDown(nodeButton, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(nodeButton, { pointerId: 1, clientX: 150, clientY: 130 })
      expect(dispatch).not.toHaveBeenCalled()

      fireEvent.pointerUp(nodeButton, { pointerId: 1, clientX: 150, clientY: 130 })
      expect(dispatch).toHaveBeenCalledTimes(1)
      const call = dispatch.mock.calls[0][0]
      expect(call.type).toBe('MULTI_MOVE')
      if (call.type === 'MULTI_MOVE') {
        expect(call.expectedSelectionRevision).toBe(42)
        expect(call.moves).toHaveLength(2)
        expect(call.moves.map((m) => m.nodeId).sort()).toEqual([node1.id, node2.id].sort())
      }
    })

    it('cancels drag on pointercancel or Escape without dispatching mutation', () => {
      const { dispatch } = renderCanvas()
      const node = screen.getByRole('button', { name: /#2 · AND/ })

      fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(node, { pointerId: 1, clientX: 200, clientY: 200 })
      fireEvent.pointerCancel(node, { pointerId: 1 })

      expect(dispatch).not.toHaveBeenCalled()
    })
  })
})
