import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteErrorBoundary } from './RouteErrorBoundary'

function Boom(): JSX.Element {
  throw new TypeError("Cannot read properties of null (reading 'length')")
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    // React ghi lỗi ra console khi ranh giới bắt được; im lặng để output test sạch.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  /* Sự cố board 2026-08-06: một trường JSON `null` làm React unmount cả cây và
   * người vận hành nhận được MÀN HÌNH ĐEN — không tiêu đề, không menu, không
   * một dòng giải thích. Với tủ điều khiển đang chạy, đó là tình huống tệ nhất
   * vì không phân biệt được phần mềm hỏng với mất điện. */
  it('giữ giao diện dùng được và NÓI RÕ lỗi thay vì để trang trắng', () => {
    render(
      <RouteErrorBoundary label="/eng/modbus-rtu">
        <Boom />
      </RouteErrorBoundary>
    )
    const box = screen.getByTestId('route-error-boundary')
    expect(box).toHaveTextContent('Trang này gặp lỗi và không hiển thị được')
    expect(box).toHaveTextContent('/eng/modbus-rtu')
    // Thông điệp gốc phải còn để kỹ thuật viên gửi lại được, không bị nuốt.
    expect(box).toHaveTextContent("Cannot read properties of null (reading 'length')")
  })

  it('render bình thường khi con không lỗi', () => {
    render(
      <RouteErrorBoundary>
        <p>nội dung ổn</p>
      </RouteErrorBoundary>
    )
    expect(screen.getByText('nội dung ổn')).toBeInTheDocument()
    expect(screen.queryByTestId('route-error-boundary')).not.toBeInTheDocument()
  })

  /* Chuyển sang trang khác phải thoát khỏi màn hình lỗi, nếu không người dùng
   * kẹt lại đó cho tới khi tải lại trang — mà tải lại trang thì mất phiên. */
  it('thử render lại khi đổi route', () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/a">
        <Boom />
      </RouteErrorBoundary>
    )
    expect(screen.getByTestId('route-error-boundary')).toBeInTheDocument()

    rerender(
      <RouteErrorBoundary resetKey="/b">
        <p>trang khác</p>
      </RouteErrorBoundary>
    )
    expect(screen.getByText('trang khác')).toBeInTheDocument()
    expect(screen.queryByTestId('route-error-boundary')).not.toBeInTheDocument()
  })
})
