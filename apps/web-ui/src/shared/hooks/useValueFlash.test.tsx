import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useValueFlash } from './useValueFlash'

/**
 * Khoá hai luật của `T57-2.16`. Cả hai đều là quyết định UX, không phải chi
 * tiết cài đặt — nên phải có test, nếu không lần refactor sau sẽ đổi mất mà
 * không ai biết.
 */

function Probe({ value }: { value: unknown }) {
  const flash = useValueFlash(value, 640)
  return <span data-testid="cell" className={flash}>{String(value)}</span>
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('useValueFlash — T57-2.16', () => {
  it('LUẬT 1 — KHÔNG chớp ở lần render đầu', () => {
    render(<Probe value={23.5} />)
    expect(
      screen.getByTestId('cell').className,
      'mở trang mà cả bảng chớp cùng lúc là nhiễu, và nó dạy người dùng bỏ qua hiệu ứng đúng lúc cần chú ý'
    ).toBe('')
  })

  it('chớp khi giá trị ĐỔI, rồi tự tắt', () => {
    const { rerender } = render(<Probe value={23.5} />)
    rerender(<Probe value={24.1} />)
    expect(screen.getByTestId('cell')).toHaveClass('value-flash')

    act(() => { vi.advanceTimersByTime(700) })
    expect(screen.getByTestId('cell').className, 'hiệu ứng phải tự tắt, không dính lại vĩnh viễn').toBe('')
  })

  it('LUẬT 2 — giá trị lặp lại KHÔNG chớp', () => {
    const { rerender } = render(<Probe value={23.5} />)
    rerender(<Probe value={23.5} />)
    expect(
      screen.getByTestId('cell').className,
      'poll mỗi giây trả về cùng con số mà ô vẫn chớp thì cả bảng nhấp nháy liên tục vô nghĩa'
    ).toBe('')
  })

  it('phân biệt được giá trị boolean false với 0 (Object.is)', () => {
    const { rerender } = render(<Probe value={false} />)
    rerender(<Probe value={0} />)
    expect(screen.getByTestId('cell')).toHaveClass('value-flash')
  })
})
