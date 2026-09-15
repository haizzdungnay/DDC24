import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
import type { FbdDocument } from './model'
import { buildFbdRuntimeOverlay, type FbdRuntimeOverlay } from './runtimeOverlay'
import type { StRuntimeOverlayState } from '../design/editor/StRuntimeValueOverlay'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function renderEditor(canEdit = true, runtime?: FbdRuntimeOverlay | null) {
  const onChange = vi.fn()
  render(
    <I18nProvider>
      <StructuredFbdEditor
        document={golden()}
        canEdit={canEdit}
        onChange={onChange}
        runtime={runtime}
      />
    </I18nProvider>,
  )
  return { onChange }
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})

afterEach(cleanup)

describe('FbdCanvas hover tooltip (Task 2)', () => {
  it('hover vào khối kích hoạt hiển thị tooltip với role="tooltip"', () => {
    renderEditor()
    const block = screen.getByRole('button', { name: /#2 · AND/ })
    fireEvent.pointerEnter(block, { clientX: 120, clientY: 180 })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(block).toHaveAttribute('aria-describedby', tooltip.id)
  })

  it('rời chuột tắt tooltip và xóa aria-describedby', () => {
    renderEditor()
    const block = screen.getByRole('button', { name: /#2 · AND/ })
    fireEvent.pointerEnter(block, { clientX: 120, clientY: 180 })

    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerLeave(block)

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(block).not.toHaveAttribute('aria-describedby')
  })

  it('focus và blur hỗ trợ bàn phím hiển thị và ẩn tooltip', () => {
    renderEditor()
    const block = screen.getByRole('button', { name: /#2 · AND/ })
    fireEvent.focus(block)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(block).toHaveAttribute('aria-describedby', tooltip.id)

    fireEvent.blur(block)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('nội dung tooltip hiển thị đúng tên khối, typeRef, executionOrder và chân vào/ra', () => {
    renderEditor()
    const block = screen.getByRole('button', { name: /#2 · AND/ })
    fireEvent.pointerEnter(block, { clientX: 120, clientY: 180 })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('AND')
    expect(tooltip).toHaveTextContent('#2')
    expect(tooltip).toHaveTextContent('FUNCTION')
    expect(tooltip).toHaveTextContent('IN1')
    expect(tooltip).toHaveTextContent('IN2')
    expect(tooltip).toHaveTextContent('OUT')
  })

  it('nội dung tooltip hiển thị giá trị runtime và trạng thái live khi có dữ liệu', () => {
    const runtimeOverlay: StRuntimeOverlayState = {
      status: 'ready',
      items: [
        {
          variableId: 'v1',
          variableName: 'OCCUPIED',
          value: true,
          valid: true,
          quality: 'GOOD',
          freshness: 'LIVE',
          unit: undefined,
        },
      ],
    }

    const doc = golden()
    const runtime = buildFbdRuntimeOverlay(doc, runtimeOverlay)
    renderEditor(true, runtime)
    const block = screen.getByRole('button', { name: /#0 · BOOL/ })
    fireEvent.pointerEnter(block, { clientX: 100, clientY: 150 })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('OCCUPIED')
    expect(tooltip).toHaveTextContent('#0')
    expect(tooltip).toHaveTextContent('TRUE')
    expect(tooltip).toHaveTextContent(/Trực tiếp|Live/)
  })

  it('không hiện tooltip khi đang kéo block', () => {
    renderEditor()
    const andBlock = screen.getByRole('button', { name: /#2 · AND/ })
    const fanBlock = screen.getByRole('button', { name: /#3 · BOOL/ })

    // Bắt đầu kéo andBlock
    fireEvent.pointerDown(andBlock, { pointerId: 1, button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(andBlock, { pointerId: 1, clientX: 80, clientY: 80 })

    // Con trỏ di chuyển qua fanBlock trong khi drag đang active
    fireEvent.pointerEnter(fanBlock, { clientX: 150, clientY: 150 })
    expect(screen.queryByRole('tooltip')).toBeNull()

    // Kết thúc kéo
    fireEvent.pointerUp(andBlock, { pointerId: 1, clientX: 80, clientY: 80 })
  })

  it('không hiện tooltip khi đang pan canvas', () => {
    renderEditor()
    const andBlock = screen.getByRole('button', { name: /#2 · AND/ })
    const bg = document.querySelector('[data-fbd-canvas-bg="true"]')!

    // Giữ chuột giữa trên background để pan
    fireEvent.pointerDown(bg, { pointerId: 2, button: 1, clientX: 50, clientY: 50 })

    // Con trỏ chạm vào block khi đang pan
    fireEvent.pointerEnter(andBlock, { clientX: 100, clientY: 100 })
    expect(screen.queryByRole('tooltip')).toBeNull()

    // Thả chuột giữa
    fireEvent.pointerUp(bg, { pointerId: 2, clientX: 50, clientY: 50 })
  })
})
