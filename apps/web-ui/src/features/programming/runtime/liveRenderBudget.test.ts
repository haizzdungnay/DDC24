import { describe, expect, it, vi } from 'vitest'
import {
  createLatestRenderBudget,
  LIVE_RENDER_MAX_HZ,
  LIVE_RENDER_MIN_INTERVAL_MS,
} from './liveRenderBudget'

describe('ngân sách vẽ LIVE (T59-812)', () => {
  it('không phát quá 10 Hz và giữ đúng sample mới nhất', () => {
    vi.useFakeTimers()
    const emitted: number[] = []
    const budget = createLatestRenderBudget<number>((value) => emitted.push(value), {
      now: () => Date.now(),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer),
    })

    expect(LIVE_RENDER_MAX_HZ).toBe(10)
    expect(LIVE_RENDER_MIN_INTERVAL_MS).toBe(100)

    budget.push(1)
    for (let sample = 2; sample <= 50; sample += 1) budget.push(sample)
    expect(emitted).toEqual([1])

    vi.advanceTimersByTime(99)
    expect(emitted).toEqual([1])
    vi.advanceTimersByTime(1)
    expect(emitted).toEqual([1, 50])
    vi.useRealTimers()
  })

  it('cancel khi unsubscribe xóa sample chờ và timer', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const budget = createLatestRenderBudget<number>(emit, {
      now: () => Date.now(),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer),
    })

    budget.push(1)
    budget.push(2)
    budget.cancel()
    vi.advanceTimersByTime(1_000)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenLastCalledWith(1)
    vi.useRealTimers()
  })

  it('không dùng undefined làm sentinel mất sample hợp lệ', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const budget = createLatestRenderBudget<number | undefined>(emit, {
      now: () => Date.now(),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer),
    })

    budget.push(1)
    budget.push(undefined)
    vi.advanceTimersByTime(100)
    expect(emit).toHaveBeenNthCalledWith(1, 1)
    expect(emit).toHaveBeenNthCalledWith(2, undefined)
    vi.useRealTimers()
  })
})
