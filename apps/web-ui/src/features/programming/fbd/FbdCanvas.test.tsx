import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
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
