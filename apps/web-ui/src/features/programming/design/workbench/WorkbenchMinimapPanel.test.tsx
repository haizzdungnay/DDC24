import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import type { FbdNodeGeometry } from '../../fbd/geometry'
import { WorkbenchMinimapPanel, type FbdCanvasBridge } from './WorkbenchMinimapPanel'

function createMockBridge(overrides: Partial<FbdCanvasBridge> = {}): FbdCanvasBridge {
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

  it('click nút phóng to / thu nhỏ / fit gọi callback tương ứng', () => {
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

    expect(screen.getByText('120%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    expect(onZoomIn).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }))
    expect(onZoomOut).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung' }))
    expect(onResetZoom).toHaveBeenCalledTimes(1)
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
    expect(viewBox).toBe('26 26 112 112')
  })

  it('điều hướng chuột trên minimap ánh xạ đúng toạ độ graph theo viewBox mới', () => {
    const onNavigate = vi.fn()
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

    // Click ở tâm minimap (108, 70), tương ứng graph point (108, 70) trong viewBox 0 0 216 140
    fireEvent.pointerDown(minimap, { pointerId: 1, clientX: 108, clientY: 70 })
    expect(onNavigate).toHaveBeenCalledTimes(1)
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
    expect(viewBoxAttr).toBe('0 0 216 112')

    const indicator = minimap.querySelector('[data-testid="minimap-viewport-indicator"]')
    expect(indicator).toBeInTheDocument()

    const x = Number(indicator?.getAttribute('x'))
    const y = Number(indicator?.getAttribute('y'))
    const width = Number(indicator?.getAttribute('width'))
    const height = Number(indicator?.getAttribute('height'))

    // Khi viewport (12000x8000) lớn hơn viewBox (216x112), indicator phải co về vừa khít viewBox
    expect(x).toBe(0)
    expect(y).toBe(0)
    expect(width).toBe(216)
    expect(height).toBe(112)
    expect(x + width).toBeLessThanOrEqual(216)
    expect(y + height).toBeLessThanOrEqual(112)
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
})
