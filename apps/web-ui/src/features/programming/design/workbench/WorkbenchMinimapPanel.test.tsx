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
})
