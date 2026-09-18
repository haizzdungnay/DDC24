import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import type { FbdNodeGeometry, FbdWireGeometry } from '../../fbd/geometry'
import {
  WorkbenchMinimapPanel,
  minimapClientToGraphCoordinates,
  type FbdCanvasBridge,
} from './WorkbenchMinimapPanel'

function createMockBridge(overrides: Partial<FbdCanvasBridge & { wires?: readonly FbdWireGeometry[] }> = {}): FbdCanvasBridge {
  const nodes: FbdNodeGeometry[] = Array.from({ length: 30 }, (_, i) => ({
    id: `node-${i + 1}`,
    x: (i % 5) * 200 + 40,
    y: Math.floor(i / 5) * 120 + 40,
    width: 168,
    height: 80,
    ports: [],
    auto: false,
  }))

  return {
    nodes,
    width: 1200,
    height: 800,
    viewport: { x: 0, y: 0, scale: 1 },
    scale: 1,
    scrollPosition: { left: 100, top: 100, clientWidth: 600, clientHeight: 400 },
    selection: { kind: 'node', networkId: 'net-1', nodeId: 'node-2' },
    onNavigate: vi.fn(),
    onStepNavigate: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})

afterEach(() => {
  cleanup()
})

describe('WorkbenchMinimapPanel (Task T9-02)', () => {
  it('render tiêu đề "Bản đồ thu nhỏ" và 3 nút điều khiển zoom (+, -, fit)', () => {
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel bridge={createMockBridge()} />
      </I18nProvider>,
    )

    expect(screen.getByText('Bản đồ thu nhỏ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Phóng to' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vừa khung' })).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('khi không có FBD document / không khả dụng: render placeholder tiếng Việt đúng chuẩn', () => {
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel bridge={null} />
      </I18nProvider>,
    )

    const placeholder = screen.getByRole('region', { name: 'Bản đồ thu nhỏ' })
    expect(placeholder).toBeInTheDocument()
    expect(placeholder).toHaveTextContent('Bản đồ thu nhỏ chỉ khả dụng cho sơ đồ khối FBD')
    expect(screen.queryByRole('button', { name: 'Phóng to' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Thu nhỏ' })).toBeNull()
  })

  it('khi có FBD nodes: render SVG thumbnail và viewport indicator', () => {
    const bridge = createMockBridge()
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel bridge={bridge} />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    expect(minimap).toBeInTheDocument()
    expect(minimap).toHaveAttribute('data-fbd-minimap', 'true')

    const nodeRects = minimap.querySelectorAll('rect[data-fbd-minimap-node="true"]')
    expect(nodeRects.length).toBe(30)

    const selectedRect = minimap.querySelector('rect[data-fbd-node-id="node-2"]')
    expect(selectedRect).toHaveAttribute('fill', 'var(--c-accent)')

    const unselectedRect = minimap.querySelector('rect[data-fbd-node-id="node-1"]')
    expect(unselectedRect).toHaveAttribute('fill', 'var(--c-text-dim)')

    const viewportIndicator = minimap.querySelector('[data-testid="minimap-viewport-indicator"]')
    expect(viewportIndicator).toBeInTheDocument()
  })

  it('render danh sách đường nối (wires) dưới các khối', () => {
    const wires: FbdWireGeometry[] = [
      { id: 'wire-1', path: 'M 10 10 L 100 100', from: { x: 10, y: 10 }, to: { x: 100, y: 100 } },
      { id: 'wire-2', path: 'M 20 20 L 200 200', from: { x: 20, y: 20 }, to: { x: 200, y: 200 } },
    ]
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel bridge={createMockBridge({ wires })} />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const wirePaths = minimap.querySelectorAll('path[data-fbd-minimap-wire="true"]')
    expect(wirePaths.length).toBe(2)
    expect(wirePaths[0]).toHaveAttribute('d', 'M 10 10 L 100 100')
    expect(wirePaths[1]).toHaveAttribute('d', 'M 20 20 L 200 200')

    const firstWire = wirePaths[0]
    const firstNode = minimap.querySelector('rect[data-fbd-minimap-node="true"]')
    expect(firstWire.compareDocumentPosition(firstNode!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('khi bridge không có wires: render 0 path wire mà không crash', () => {
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel bridge={createMockBridge({ wires: undefined })} />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const wirePaths = minimap.querySelectorAll('path[data-fbd-minimap-wire="true"]')
    expect(wirePaths.length).toBe(0)
  })

  it('tách zoom minimap khỏi canvas: đổi viewBox minimap, không gọi callback bridge', () => {
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    const onResetZoom = vi.fn()

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            scale: 1.2,
            onZoomIn,
            onZoomOut,
            onResetZoom,
          })}
        />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(minimap).toHaveAttribute('viewBox', '-37 -37 1122 834')

    // 1. Phóng to: đổi nhãn 120%, đổi viewBox "57 33 935 695", KHÔNG gọi callback bridge
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    expect(onZoomIn).not.toHaveBeenCalled()
    expect(onZoomOut).not.toHaveBeenCalled()
    expect(onResetZoom).not.toHaveBeenCalled()
    expect(screen.getByText('120%')).toBeInTheDocument()
    expect(minimap).toHaveAttribute('viewBox', '57 33 935 695')

    // 2. Vừa khung: reset về 100% và viewBox gốc, KHÔNG gọi callback bridge
    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung' }))
    expect(onResetZoom).not.toHaveBeenCalled()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(minimap).toHaveAttribute('viewBox', '-37 -37 1122 834')
  })

  it('chặn biên zoom minimap: tối đa 250% (2.5) và tối thiểu 40% (0.4)', () => {
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel bridge={createMockBridge()} />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const zoomInBtn = screen.getByRole('button', { name: 'Phóng to' })
    const zoomOutBtn = screen.getByRole('button', { name: 'Thu nhỏ' })

    // Bấm phóng to nhiều lần (10 lần) kẹp tại 250%
    for (let i = 0; i < 10; i++) {
      fireEvent.click(zoomInBtn)
    }
    expect(screen.getByText('250%')).toBeInTheDocument()
    expect(minimap).toHaveAttribute('viewBox', '300 213 449 334')

    // Bấm thu nhỏ nhiều lần (15 lần) kẹp tại 40%
    for (let i = 0; i < 15; i++) {
      fireEvent.click(zoomOutBtn)
    }
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(minimap).toHaveAttribute('viewBox', '-878 -662 2805 2085')
  })

  it('TC-FBD-NAV-001: tương tác chuột và phím trên minimap gọi onNavigate và onStepNavigate', () => {
    const onNavigate = vi.fn()
    const onStepNavigate = vi.fn()

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            onNavigate,
            onStepNavigate,
          })}
        />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })

    fireEvent.pointerDown(minimap, { pointerId: 1, clientX: 200, clientY: 150 })
    expect(onNavigate).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(minimap, { key: 'ArrowRight' })
    expect(onStepNavigate).toHaveBeenCalledWith(expect.any(Number), 0)

    fireEvent.keyDown(minimap, { key: 'ArrowDown' })
    expect(onStepNavigate).toHaveBeenCalledWith(0, expect.any(Number))
  })

  it('viewBox bám theo bounding box của nodes kèm padding thay vì toàn bộ canvas width/height', () => {
    const smallNodes: FbdNodeGeometry[] = [
      { id: 'and-1', x: 24, y: 24, width: 168, height: 28, ports: [], auto: false },
      { id: 'and-2', x: 24, y: 56, width: 168, height: 28, ports: [], auto: false },
      { id: 'and-3', x: 24, y: 88, width: 168, height: 28, ports: [], auto: false },
    ]

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            nodes: smallNodes,
            width: 1200,
            height: 1600,
          })}
        />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const viewBox = minimap.getAttribute('viewBox')
    expect(viewBox).not.toBe('0 0 1200 1600')
    expect(viewBox).toBe('0 0 216 140')
  })

  it('xử lý an toàn trường hợp biên bbox suy biến (width/height = 0)', () => {
    const degenerateNodes: FbdNodeGeometry[] = [
      { id: 'dot-1', x: 50, y: 50, width: 0, height: 0, ports: [], auto: false },
    ]

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            nodes: degenerateNodes,
            width: 1200,
            height: 1600,
          })}
        />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const viewBox = minimap.getAttribute('viewBox')
    expect(viewBox).toBe('-6 -6 112 112')

    const [x, y, width, height] = (viewBox ?? '').split(/\s+/).map(Number)
    expect(x + width / 2).toBe(50)
    expect(y + height / 2).toBe(50)
  })

  it('điều hướng chuột truyền đúng toạ độ khi viewBox có gốc khác 0', () => {
    const onNavigate = vi.fn()
    const smallNodes: FbdNodeGeometry[] = [
      { id: 'and-1', x: 400, y: 200, width: 168, height: 28, ports: [], auto: false },
      { id: 'and-2', x: 400, y: 232, width: 168, height: 28, ports: [], auto: false },
      { id: 'and-3', x: 400, y: 264, width: 168, height: 28, ports: [], auto: false },
    ]

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            nodes: smallNodes,
            width: 1200,
            height: 1600,
            onNavigate,
          })}
        />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' }) as unknown as SVGSVGElement
    minimap.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 216,
      height: 140,
      right: 216,
      bottom: 140,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    expect(minimap).toHaveAttribute('viewBox', '376 176 216 140')

    // Tâm khung SVG phải thành tâm graph (484, 246), sau đó được mã hoá về
    // client coordinate của callback bridge dùng viewBox toàn canvas cũ.
    fireEvent.pointerDown(minimap, { pointerId: 1, clientX: 108, clientY: 70 })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    const [virtualClientX, virtualClientY, element] = onNavigate.mock.calls[0]
    expect(virtualClientX).toBeCloseTo(97.85, 5)
    expect(virtualClientY).toBeCloseTo(21.525, 5)
    expect(element).toBe(minimap)

    expect(minimapClientToGraphCoordinates(
      { x: 108, y: 70 },
      { left: 0, top: 0, width: 216, height: 140 },
      { x: 376, y: 176, width: 216, height: 140 },
    )).toEqual({ x: 484, y: 246 })
  })

  it('khi zoom out xa: indicator co về vừa khít viewBox, không vượt quá biên bbox', () => {
    const smallNodes: FbdNodeGeometry[] = [
      { id: 'and-1', x: 24, y: 24, width: 168, height: 28, ports: [], auto: false },
    ]

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            nodes: smallNodes,
            scale: 0.1,
            viewport: { x: 0, y: 0, scale: 0.1 },
            scrollPosition: { left: 0, top: 0, clientWidth: 1200, clientHeight: 800 },
          })}
        />
      </I18nProvider>,
    )

    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const viewBoxAttr = minimap.getAttribute('viewBox')
    expect(viewBoxAttr).toBe('0 -18 216 112')

    const indicator = minimap.querySelector('[data-testid="minimap-viewport-indicator"]')
    expect(indicator).toBeInTheDocument()

    const x = Number(indicator?.getAttribute('x'))
    const y = Number(indicator?.getAttribute('y'))
    const width = Number(indicator?.getAttribute('width'))
    const height = Number(indicator?.getAttribute('height'))

    // Khi viewport (12000x8000) lớn hơn viewBox (216x112), indicator phải co về vừa khít viewBox
    expect(x).toBe(0)
    expect(y).toBe(-18)
    expect(width).toBe(216)
    expect(height).toBe(112)
    expect(x + width).toBeLessThanOrEqual(216)
    expect(y + height).toBeLessThanOrEqual(94)
  })

  it('hồi quy: khi viewport nhỏ hơn viewBox, vị trí và kích thước indicator giữ nguyên không bị lệch', () => {
    const smallNodes: FbdNodeGeometry[] = [
      { id: 'and-1', x: 24, y: 24, width: 168, height: 28, ports: [], auto: false },
    ]

    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge({
            nodes: smallNodes,
            scale: 1,
            viewport: { x: 0, y: 0, scale: 1 },
            scrollPosition: { left: 30, top: 20, clientWidth: 80, clientHeight: 50 },
          })}
        />
      </I18nProvider>,
    )

    const indicator = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' }).querySelector('[data-testid="minimap-viewport-indicator"]')
    expect(indicator).toBeInTheDocument()

    const x = Number(indicator?.getAttribute('x'))
    const y = Number(indicator?.getAttribute('y'))
    const width = Number(indicator?.getAttribute('width'))
    const height = Number(indicator?.getAttribute('height'))

    // Giữ nguyên đúng giá trị viewport tính từ scrollPosition / scale
    expect(x).toBe(30)
    expect(y).toBe(20)
    expect(width).toBe(80)
    expect(height).toBe(50)
  })

  it('render ST Mini Map khi có stSource và gọi onJumpToOffset khi click dòng/outline', () => {
    const onJumpToOffset = vi.fn()
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={null}
          stSource={'PROGRAM P\nVAR\n  FanCmd : BOOL;\nEND_VAR\nFanCmd := TRUE;\nEND_PROGRAM\n'}
          onJumpToOffset={onJumpToOffset}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('region', { name: 'Bản đồ mã nguồn ST' })).toBeInTheDocument()
    expect(screen.getByText('ST')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PROGRAM P/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /VAR/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /PROGRAM P/ }))
    expect(onJumpToOffset).toHaveBeenCalledWith(0, 1)
  })

  it('nút thu gọn gọi onCollapse khi được truyền', () => {
    const onCollapse = vi.fn()
    render(
      <I18nProvider>
        <WorkbenchMinimapPanel
          bridge={createMockBridge()}
          onCollapse={onCollapse}
        />
      </I18nProvider>,
    )

    const collapseBtn = screen.getByRole('button', { name: 'Thu gọn Bản đồ' })
    expect(collapseBtn).toBeInTheDocument()
    fireEvent.click(collapseBtn)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})
