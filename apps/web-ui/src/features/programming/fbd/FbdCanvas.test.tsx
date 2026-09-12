import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
import { minimapClientToGraph } from './FbdCanvas'
import type { FbdDocument } from './model'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function renderEditor(canEdit = true) {
  const onChange = vi.fn()
  render(
    <I18nProvider>
      <StructuredFbdEditor document={golden()} canEdit={canEdit} onChange={onChange} />
    </I18nProvider>,
  )
  return { onChange, surface: screen.getByRole('group', { name: /Sơ đồ ENABLE_LOGIC/ }) }
}

/** Kéo một block: pointerdown → pointermove → pointerup, toạ độ client. */
function dragNode(label: RegExp, dx: number, dy: number) {
  const node = screen.getByRole('button', { name: label })
  fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
  fireEvent.pointerMove(node, { pointerId: 1, clientX: dx, clientY: dy })
  fireEvent.pointerUp(node, { pointerId: 1, clientX: dx, clientY: dy })
  return node
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  /* jsdom chưa cài Pointer Capture API — canvas chỉ dùng nó để giữ chuột khi
   * con trỏ ra khỏi block đang kéo, không phải để tính toạ độ. */
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})
afterEach(cleanup)

/*
 * `AC-FBD-001` — "FBD is a true node-edge canvas", và AC kèm theo trong
 * `WP-05`: "wires not hidden".
 *
 * Bản trước vẽ block thành thẻ xếp lưới và liệt kê dây thành hàng nút
 * `abcd1234 → ef567890`. Thứ duy nhất một sơ đồ FBD tồn tại để nói — cái gì
 * nối vào cái gì — lại là thứ người dùng phải tự ghép bằng tám ký tự đầu UUID.
 */
describe('FbdCanvas — canvas node-edge thật (T59-806)', () => {
  it('mỗi wire là một đường vẽ được, không còn là nút mã UUID', () => {
    const { surface } = renderEditor()
    const paths = surface.querySelectorAll('path[role="button"]')
    expect(paths).toHaveLength(golden().networks[0].wires.length)
    for (const path of paths) {
      expect(path.getAttribute('d')).toMatch(/^M [\d.-]+ [\d.-]+ C /)
    }
    // không còn nút nào mang nhãn kiểu "abcd1234 → ef567890"
    expect(screen.queryByRole('button', { name: /^[0-9a-f]{8} → [0-9a-f]{8}$/ })).toBeNull()
  })

  it('block và port vẫn là phần tử nhận tiêu điểm, bàn phím chọn được', () => {
    renderEditor()
    const block = screen.getByRole('button', { name: /#2 · AND/ })
    expect(block).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(block, { key: 'Enter' })
    expect(block).toHaveAttribute('aria-pressed', 'true')

    const port = screen.getByRole('button', { name: /AND INPUT IN1 BOOL/ })
    expect(port).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(port, { key: ' ' })
    expect(port).toHaveAttribute('aria-pressed', 'true')
  })

  it('kéo block ghi toạ độ vào layout và KHÔNG đổi executionOrder', () => {
    const { onChange } = renderEditor()
    dragNode(/#2 · AND/, 60, 40)

    expect(onChange).toHaveBeenCalled()
    const calls = onChange.mock.calls
    const saved = calls[calls.length - 1][0] as FbdDocument
    const andNode = saved.networks[0].nodes.find((node) => node.typeRef === 'AND')!
    expect(saved.layout?.nodes[andNode.id]).toBeDefined()
    expect(andNode.executionOrder).toBe(
      golden().networks[0].nodes.find((node) => node.typeRef === 'AND')!.executionOrder,
    )
  })

  it('một thao tác kéo = MỘT lệnh, không phải một lệnh mỗi frame', () => {
    const { onChange } = renderEditor()
    const node = screen.getByRole('button', { name: /#2 · AND/ })
    fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    for (const step of [10, 20, 30, 40, 50]) {
      fireEvent.pointerMove(node, { pointerId: 1, clientX: step, clientY: step })
    }
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(node, { pointerId: 1, clientX: 50, clientY: 50 })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('nhấp mà không di chuyển thì KHÔNG sinh thay đổi tài liệu', () => {
    const { onChange } = renderEditor()
    const node = screen.getByRole('button', { name: /#2 · AND/ })
    fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 12, clientY: 12 })
    fireEvent.pointerUp(node, { pointerId: 1, clientX: 12, clientY: 12 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('chỉ đọc thì kéo không đổi được gì', () => {
    const { onChange } = renderEditor(false)
    dragNode(/#2 · AND/, 60, 40)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('thu phóng đổi kích thước vẽ nhưng giữ nguyên hệ toạ độ', () => {
    const { surface } = renderEditor()
    const viewBox = surface.getAttribute('viewBox')
    const before = Number(surface.getAttribute('width'))

    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
    expect(Number(surface.getAttribute('width'))).toBeGreaterThan(before)
    expect(surface.getAttribute('viewBox')).toBe(viewBox)

    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung' }))
    expect(Number(surface.getAttribute('width'))).toBe(before)
  })

  it('sơ đồ mở lần đầu đã đọc được: INPUT bên trái, OUTPUT bên phải', () => {
    const { surface } = renderEditor()
    const rects = [...surface.querySelectorAll('g[role="button"] rect')]
    const xs = rects.map((rect) => Number(rect.getAttribute('x')))
    // bốn block, ít nhất ba cột khác nhau ⇒ không phải một chồng đè lên nhau
    expect(new Set(xs).size).toBeGreaterThanOrEqual(3)
  })
})

/*
 * `AC-FBD-007` — "Problems jump to exact block/wire".
 *
 * Validator luôn biết CHÍNH XÁC lỗi nằm ở đâu (`$.networks[0].nodes[2].typeRef`),
 * nhưng UI chỉ hiện một con số "3 lỗi Draft". Người dùng có toạ độ lỗi trong
 * tay mà vẫn phải tự đi tìm.
 */
describe('FBD Problems — một danh sách dùng chung ở bottom workbench', () => {
  function brokenDocument(): FbdDocument {
    const document = golden()
    // typeRef không khớp kind ⇒ FBD-SEM-TYPE-REF-001 neo vào đúng node
    document.networks[0].nodes[2].typeRef = 'BOOL'
    return document
  }

  it('editor chỉ đánh dấu block lỗi, không dựng danh sách Problems thứ hai', () => {
    render(
      <I18nProvider>
        <StructuredFbdEditor document={brokenDocument()} canEdit onChange={vi.fn()} />
      </I18nProvider>,
    )
    expect(screen.queryByRole('group', { name: 'Vấn đề FBD' })).toBeNull()
    expect(screen.getByRole('button', { name: /#2 · BOOL/ })).toHaveAccessibleName(/Có lỗi chẩn đoán/)
  })
})

/* `AC-FBD-012` — "minimap is available for diagrams above configured size
 * threshold". Dưới ngưỡng, cả sơ đồ nằm gọn trong khung nhìn nên minimap chỉ
 * là thêm thứ để nhìn; trên ngưỡng, người dùng bắt đầu cuộn và cần biết mình
 * đang ở đâu. */
describe('FbdCanvas — minimap theo ngưỡng kích thước (AC-FBD-012)', () => {
  function documentWithNodes(count: number): FbdDocument {
    const document = golden()
    const template = document.networks[0].nodes[0]
    const nodes = []
    for (let index = 0; index < count; index += 1) {
      nodes.push({
        ...JSON.parse(JSON.stringify(template)),
        id: `30000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        executionOrder: index,
        parameters: { variable: `VAR_${index}` },
        ports: [{
          id: `4000${index.toString(16).padStart(4, '0')}-0000-4000-8000-000000000001`,
          name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 0,
        }],
      })
    }
    document.networks[0].nodes = nodes
    document.networks[0].wires = []
    return document
  }

  it('sơ đồ nhỏ KHÔNG có minimap', () => {
    renderEditor()
    expect(screen.queryByRole('group', { name: 'Bản đồ thu nhỏ' })).toBeNull()
  })

  it('sơ đồ vượt ngưỡng thì có minimap, vẽ đủ mọi block', () => {
    render(
      <I18nProvider>
        <StructuredFbdEditor document={documentWithNodes(30)} canEdit onChange={vi.fn()} />
      </I18nProvider>,
    )
    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    expect(minimap).toHaveAttribute('tabindex', '0')
    expect(minimap).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('ArrowRight'))
    expect(minimap.querySelectorAll('rect')).toHaveLength(30)
    // minimap dùng CHUNG hệ toạ độ với canvas chính, không phải một phép xếp thứ hai
    const surface = screen.getByRole('group', { name: /Sơ đồ ENABLE_LOGIC/ })
    expect(minimap.getAttribute('viewBox')).toBe(surface.getAttribute('viewBox'))
  })

  it('TC-FBD-NAV-001: bàn phím điều hướng Mini Map mà không mutate canonical', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <StructuredFbdEditor document={documentWithNodes(30)} canEdit onChange={onChange} />
      </I18nProvider>,
    )
    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' })
    const surface = screen.getByRole('group', { name: /Sơ đồ ENABLE_LOGIC/ })
    const viewport = surface.parentElement as HTMLDivElement
    minimap.focus()
    fireEvent.keyDown(minimap, { key: 'ArrowRight' })
    fireEvent.keyDown(minimap, { key: 'ArrowDown' })
    expect(viewport.scrollLeft).toBe(32)
    expect(viewport.scrollTop).toBe(32)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('TC-FBD-NAV-001: phép đổi toạ độ loại phần letterbox của xMidYMid meet', () => {
    const point = minimapClientToGraph(
      { x: 88, y: 43.2 },
      { left: 0, top: 0, width: 176, height: 104 },
      1_000,
      100,
    )
    expect(point?.x).toBeCloseTo(500, 6)
    expect(point?.y).toBeCloseTo(0, 6)
  })

  it('TC-FBD-NAV-001: kéo trên minimap đổi viewport nhưng không mutate canonical', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <StructuredFbdEditor document={documentWithNodes(30)} canEdit onChange={onChange} />
      </I18nProvider>,
    )
    const minimap = screen.getByRole('group', { name: 'Bản đồ thu nhỏ' }) as unknown as SVGSVGElement
    minimap.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 176, height: 104, right: 176, bottom: 104, x: 0, y: 0,
      toJSON: () => {},
    })
    const surface = screen.getByRole('group', { name: /Sơ đồ ENABLE_LOGIC/ })
    const viewport = surface.parentElement as HTMLDivElement
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 160 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 100 })

    const background = surface.querySelector('[data-fbd-canvas-bg="true"]') as SVGRectElement
    fireEvent.pointerDown(background, { pointerId: 3, button: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(background, { pointerId: 3, button: 1, clientX: 40, clientY: 24 })
    fireEvent.pointerUp(background, { pointerId: 3, button: 1, clientX: 40, clientY: 24 })
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))

    fireEvent.pointerDown(minimap, { pointerId: 9, clientX: 88, clientY: 52 })
    const firstTop = viewport.scrollTop
    fireEvent.pointerMove(minimap, { pointerId: 9, clientX: 88, clientY: 96 })
    fireEvent.pointerUp(minimap, { pointerId: 9, clientX: 88, clientY: 96 })

    expect(viewport.scrollTop).toBeGreaterThan(firstTop)
    const [, , graphWidth, graphHeight] = (minimap.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
    const target = minimapClientToGraph(
      { x: 88, y: 96 },
      { left: 0, top: 0, width: 176, height: 104 },
      graphWidth,
      graphHeight,
    )
    expect(target).not.toBeNull()
    expect(Math.abs((viewport.scrollLeft + viewport.clientWidth / 2) - (40 + target!.x * 1.2))).toBeLessThanOrEqual(8)
    expect(Math.abs((viewport.scrollTop + viewport.clientHeight / 2) - (24 + target!.y * 1.2))).toBeLessThanOrEqual(8)
    expect(onChange).not.toHaveBeenCalled()
  })
})
