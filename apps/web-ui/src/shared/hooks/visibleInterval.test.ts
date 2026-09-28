import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVisibleInterval } from './visibleInterval'

/* T63-108 (PERF-API-03) — vòng poll tự viết không chạy khi tab ẩn. */

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  visibility = 'visible'
  vi.useRealTimers()
})

describe('startVisibleInterval', () => {
  it('ticks on the interval while visible, not at all while hidden, and catches up once on return', () => {
    const tick = vi.fn()
    const stop = startVisibleInterval(tick, 1000)
    vi.advanceTimersByTime(3000)
    expect(tick).toHaveBeenCalledTimes(3)

    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    expect(tick).toHaveBeenCalledTimes(3)

    setVisibility('visible')
    expect(tick).toHaveBeenCalledTimes(4)
    stop()
    vi.advanceTimersByTime(5000)
    expect(tick).toHaveBeenCalledTimes(4)
  })

  it('does not catch up when the last tick is still within one interval', () => {
    const tick = vi.fn()
    const stop = startVisibleInterval(tick, 5000)
    vi.advanceTimersByTime(1000)
    setVisibility('hidden')
    vi.advanceTimersByTime(1000)
    setVisibility('visible')
    expect(tick).not.toHaveBeenCalled()
    stop()
  })

  it('stops listening for visibility after cleanup', () => {
    const tick = vi.fn()
    const stop = startVisibleInterval(tick, 1000)
    stop()
    vi.advanceTimersByTime(5000)
    setVisibility('hidden')
    setVisibility('visible')
    expect(tick).not.toHaveBeenCalled()
  })
})
