import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Pusher() {
  const toast = useToast()
  return <button type="button" onClick={() => toast.push('info', 'Đã lưu')}>push</button>
}

describe('ToastProvider', () => {
  it('toast tự ẩn sau 3,6 s', () => {
    vi.useFakeTimers()
    render(<ToastProvider><Pusher /></ToastProvider>)
    act(() => screen.getByRole('button', { name: 'push' }).click())
    expect(screen.getByText('Đã lưu')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3600) })
    expect(screen.queryByText('Đã lưu')).not.toBeInTheDocument()
  })

  /* Timer tự ẩn không được sống lâu hơn provider: bản cũ `setItems` lên provider
   * đã gỡ sau 3,6 s, và khi jsdom đã dỡ thì React ném `window is not defined`,
   * làm cả bộ vitest exit 1 dù mọi test PASS. */
  it('gỡ provider thì huỷ timer đang chờ', () => {
    vi.useFakeTimers()
    const { unmount } = render(<ToastProvider><Pusher /></ToastProvider>)
    act(() => screen.getByRole('button', { name: 'push' }).click())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
