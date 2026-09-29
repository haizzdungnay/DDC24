import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSharedPollsForTests, useSharedPoll } from './useSharedPoll'

/* T63-108 (PERF-API-03) — hợp đồng của vòng poll dùng chung.
 *
 * Mỗi ca ở đây canh một trong các lời hứa ghi ở đầu `useSharedPoll.ts`; bỏ phần
 * mã tương ứng (khử trùng, dừng khi tab ẩn, đọc bù khi hiện lại, đọc ngay khi
 * nhịp ngắn lại) thì đúng ca đó đỏ. */

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  resetSharedPollsForTests()
})

afterEach(() => {
  cleanup()
  resetSharedPollsForTests()
  vi.useRealTimers()
})

describe('useSharedPoll', () => {
  it('three subscribers of one key share ONE timer and ONE request per tick', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ++n)
    const a = renderHook(() => useSharedPoll('points', fetcher, 2000))
    const b = renderHook(() => useSharedPoll('points', fetcher, 2000))
    const c = renderHook(() => useSharedPoll('points', fetcher, 2000))
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect([a.result.current.data, b.result.current.data, c.result.current.data]).toEqual([1, 1, 1])

    await advance(2000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(c.result.current.data).toBe(3)
  })

  it('dedupes an in-flight request: refetch while a request flies does not open a second one', async () => {
    let release!: (value: string) => void
    const fetcher = vi.fn(() => new Promise<string>((resolve) => { release = resolve }))
    const hook = renderHook(() => useSharedPoll('alarms', fetcher, 1000))
    expect(fetcher).toHaveBeenCalledTimes(1)

    let second!: Promise<void>
    act(() => { second = hook.result.current.refetch() })
    await advance(1000) // nhịp tới trong lúc request còn bay
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => { release('ok'); await second })
    expect(hook.result.current.data).toBe('ok')
  })

  it('does not poll while the tab is hidden and catches up at once when it becomes visible', async () => {
    const fetcher = vi.fn(async () => 'v')
    renderHook(() => useSharedPoll('overview', fetcher, 1000))
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)

    act(() => setVisibility('hidden'))
    await advance(10_000)
    expect(fetcher).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await flush()
    // Dữ liệu đã cũ 10 s > nhịp 1 s ⇒ đọc ngay, không bắt người dùng nhìn snapshot cũ thêm một nhịp.
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reads immediately when the interval shrinks and the data is already older than the new interval', async () => {
    const fetcher = vi.fn(async () => 'v')
    const hook = renderHook(({ ms }: { ms: number }) => useSharedPoll('points', fetcher, ms), { initialProps: { ms: 10_000 } })
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await advance(3000)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Kênh sống vừa mất: nhịp 10 s → 2 s. Dữ liệu đã 3 s tuổi ⇒ đọc ngay.
    hook.rerender({ ms: 2000 })
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('uses the shortest interval any subscriber asks for, and relaxes when that subscriber leaves', async () => {
    const fetcher = vi.fn(async () => 'v')
    renderHook(() => useSharedPoll('points', fetcher, 10_000))
    const fast = renderHook(() => useSharedPoll('points', fetcher, 2000))
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(fetcher).toHaveBeenCalledTimes(2)

    fast.unmount()
    await advance(8000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('keeps the last data on error but reports the error and when that data was received', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new Error('authority unavailable'))
    const hook = renderHook(() => useSharedPoll('points', fetcher, 1000))
    await flush()
    const receivedAt = hook.result.current.receivedAt
    expect(hook.result.current.data).toBe('first')
    expect(receivedAt).not.toBeNull()

    await advance(1000)
    expect(hook.result.current.error?.message).toBe('authority unavailable')
    expect(hook.result.current.data).toBe('first')
    expect(hook.result.current.receivedAt).toBe(receivedAt)
  })

  it('stops the timer when the last subscriber unmounts', async () => {
    const fetcher = vi.fn(async () => 'v')
    const hook = renderHook(() => useSharedPoll('points', fetcher, 1000))
    await flush()
    hook.unmount()
    await advance(5000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports loading with no data before the first answer, never an empty value', async () => {
    let release!: (value: string[]) => void
    const fetcher = vi.fn(() => new Promise<string[]>((resolve) => { release = resolve }))
    const hook = renderHook(() => useSharedPoll('points', fetcher, 1000))
    expect(hook.result.current.loading).toBe(true)
    expect(hook.result.current.data).toBeNull()
    await act(async () => { release([]) })
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.data).toEqual([])
  })
})

describe('useSharedPoll — khoá không mượn fetcher của component khác', () => {
  it('a component switching to another key does not change what the old key fetches for the others', async () => {
    const fetchUser = vi.fn(async () => 'user-events')
    const fetchSystem = vi.fn(async () => 'system-events')
    // A tạo khoá "user" trước (như tab Hoạt động), B đọc chung khoá đó (như khối "Ai giữ quyền").
    const a = renderHook(({ kind }: { kind: 'user' | 'system' }) =>
      useSharedPoll(`activity:${kind}`, kind === 'user' ? fetchUser : fetchSystem, 10_000), { initialProps: { kind: 'user' as 'user' | 'system' } })
    const b = renderHook(() => useSharedPoll('activity:user', fetchUser, 10_000))
    await flush()
    expect(fetchUser).toHaveBeenCalledTimes(1)

    // A chuyển sang tab "Hệ thống"; B vẫn đọc "user".
    a.rerender({ kind: 'system' })
    await flush()
    expect(fetchSystem).toHaveBeenCalledTimes(1)
    await advance(10_000)
    expect(fetchUser).toHaveBeenCalledTimes(2)
    expect(b.result.current.data).toBe('user-events')
    expect(a.result.current.data).toBe('system-events')
  })
})
