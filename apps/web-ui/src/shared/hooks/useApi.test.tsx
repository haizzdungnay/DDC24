import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApi } from './useApi'

afterEach(cleanup)

describe('useApi request ordering', () => {
  it('does not let a stale response overwrite a newer dependency request', async () => {
    let resolveOld!: (value: string) => void
    let resolveNew!: (value: string) => void
    const oldRequest = new Promise<string>((resolve) => { resolveOld = resolve })
    const newRequest = new Promise<string>((resolve) => { resolveNew = resolve })
    const requests = [oldRequest, newRequest]
    let index = 0
    const hook = renderHook(({ key }: { key: string }) => useApi(() => requests[index++], [key]), { initialProps: { key: 'old' } })

    hook.rerender({ key: 'new' })
    await act(async () => { resolveNew('new-value'); await newRequest })
    expect(hook.result.current.data).toBe('new-value')
    await act(async () => { resolveOld('old-value'); await oldRequest })
    expect(hook.result.current.data).toBe('new-value')
  })

  it('keeps a polling error visible until a later request succeeds', async () => {
    vi.useFakeTimers()
    try {
      let resolveRecovery!: (value: string) => void
      const recovery = new Promise<string>((resolve) => { resolveRecovery = resolve })
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('authority unavailable'))
        .mockImplementationOnce(() => recovery)
      const hook = renderHook(() => useApi(fetcher, [], { refreshMs: 1000 }))

      await act(async () => { await Promise.resolve() })
      expect(hook.result.current.error?.message).toBe('authority unavailable')

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
      })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(hook.result.current.error?.message).toBe('authority unavailable')

      await act(async () => { resolveRecovery('recovered'); await recovery })
      expect(hook.result.current.data).toBe('recovered')
      expect(hook.result.current.error).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('automatically retries a transient browser network failure', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce('reconnected')
      const hook = renderHook(() => useApi(fetcher))

      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(hook.result.current.error).toBeInstanceOf(TypeError)

      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(hook.result.current.data).toBe('reconnected')
      expect(hook.result.current.error).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

/* T63-108 (PERF-API-03) — tab ẩn thì không poll; hiện lại thì đọc bù ngay nếu
 * đã quá nhịp; lượt đọc nền không chồng lên một lượt đang bay. */
describe('useApi polling budget (T63-108)', () => {
  let visibility: DocumentVisibilityState = 'visible'
  const setVisibility = (next: DocumentVisibilityState) => {
    visibility = next
    document.dispatchEvent(new Event('visibilitychange'))
  }
  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('skips poll ticks while the tab is hidden and reads at once when it becomes visible again', async () => {
    vi.useFakeTimers()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    try {
      const fetcher = vi.fn(async () => 'v')
      renderHook(() => useApi(fetcher, [], { refreshMs: 1000 }))
      await advance(0)
      expect(fetcher).toHaveBeenCalledTimes(1)

      act(() => setVisibility('hidden'))
      await advance(30_000)
      expect(fetcher).toHaveBeenCalledTimes(1)

      act(() => setVisibility('visible'))
      await advance(0)
      expect(fetcher).toHaveBeenCalledTimes(2)
      await advance(1000)
      expect(fetcher).toHaveBeenCalledTimes(3)
    } finally {
      visibility = 'visible'
      vi.useRealTimers()
    }
  })

  it('does not read again on becoming visible when the last read is still within one interval', async () => {
    vi.useFakeTimers()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    try {
      const fetcher = vi.fn(async () => 'v')
      renderHook(() => useApi(fetcher, [], { refreshMs: 30_000 }))
      await advance(0)
      act(() => setVisibility('hidden'))
      await advance(5000)
      act(() => setVisibility('visible'))
      await advance(0)
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      visibility = 'visible'
      vi.useRealTimers()
    }
  })

  it('does not open a second background request while one is still in flight', async () => {
    vi.useFakeTimers()
    try {
      let release!: (value: string) => void
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }))
        .mockResolvedValue('later')
      const hook = renderHook(() => useApi(fetcher, [], { refreshMs: 1000 }))
      await advance(0)
      expect(hook.result.current.error).toBeInstanceOf(TypeError)
      await advance(1000) // nhịp poll mở lượt đọc thứ hai, lượt này treo
      expect(fetcher).toHaveBeenCalledTimes(2)
      // Hẹn giờ thử lại mất mạng (2 s), sự kiện `online` và các nhịp poll kế tiếp
      // đều tới trong lúc lượt thứ hai còn bay: không lượt nào được mở request mới.
      await advance(1000)
      act(() => { window.dispatchEvent(new Event('online')) })
      await advance(2000)
      expect(fetcher).toHaveBeenCalledTimes(2)

      await act(async () => { release('second') })
      expect(hook.result.current.data).toBe('second')
      expect(hook.result.current.error).toBeNull()
      await advance(1000)
      expect(fetcher).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
