import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState, Point } from '../types'
import { LIVE_POINTS_STALE_MS, useLivePoints } from './useLivePoints'
import { resetSharedPollsForTests } from './useSharedPoll'

/* T63-108 — kênh sống thay vòng poll `/points`, nhưng KHÔNG BAO GIỜ để một
 * kênh im lặng che bản poll mới hơn. */

const mocks = vi.hoisted(() => ({
  realtime: {
    connectionState: 'connected' as ConnectionState,
    allPoints: [] as Point[],
    lastPointEventAt: null as string | null
  },
  getPoints: vi.fn()
}))

vi.mock('../realtime', () => ({ useRealtime: () => mocks.realtime }))
vi.mock('../api/client', () => ({ apiClient: { getPoints: mocks.getPoints } }))

function point(id: string, value: number, updatedAt: string): Point {
  return { id, channel: 1, tag: id, name: id, kind: 'UI', value, unit: '°C', quality: 'good', source: 'io', updatedAt } as Point
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
  vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'))
  resetSharedPollsForTests()
  mocks.realtime.connectionState = 'connected'
  mocks.realtime.allPoints = []
  mocks.realtime.lastPointEventAt = null
  mocks.getPoints.mockReset()
  mocks.getPoints.mockImplementation(async () => [point('UI-01', 20, new Date().toISOString())])
})

afterEach(() => {
  cleanup()
  resetSharedPollsForTests()
  vi.useRealTimers()
})

describe('useLivePoints', () => {
  it('polls /points every 2 s while there is no live channel', async () => {
    const hook = renderHook(() => useLivePoints())
    await advance(0)
    expect(mocks.getPoints).toHaveBeenCalledTimes(1)
    expect(hook.result.current.live).toBe(false)
    await advance(2000)
    await advance(2000)
    expect(mocks.getPoints).toHaveBeenCalledTimes(3)
    expect(hook.result.current.points[0].value).toBe(20)
  })

  it('backs off to the 10 s backstop while the live channel is fresh, and shows the live value', async () => {
    mocks.realtime.allPoints = [point('UI-01', 42, new Date().toISOString())]
    mocks.realtime.lastPointEventAt = new Date().toISOString()
    const hook = renderHook(() => useLivePoints())
    await advance(0)
    expect(hook.result.current.live).toBe(true)
    expect(hook.result.current.points[0].value).toBe(42)
    const initial = mocks.getPoints.mock.calls.length
    // Kênh sống đẩy mỗi 200 ms: mô phỏng bằng cách làm mới mốc trước mỗi lần render.
    for (let i = 0; i < 40; i++) {
      mocks.realtime.lastPointEventAt = new Date(Date.now()).toISOString()
      hook.rerender()
      await advance(200)
    }
    // 8 s sống: không một GET /points nào ngoài lần đầu (nhịp dự phòng là 10 s).
    expect(mocks.getPoints.mock.calls.length).toBe(initial)
  })

  it('falls back to polling AT ONCE when the live channel goes silent, without waiting for another render', async () => {
    mocks.realtime.allPoints = [point('UI-01', 42, new Date().toISOString())]
    mocks.realtime.lastPointEventAt = new Date().toISOString()
    const hook = renderHook(() => useLivePoints())
    await advance(0)
    expect(hook.result.current.live).toBe(true)
    const before = mocks.getPoints.mock.calls.length

    // Không khung WS nào nữa (Core đứng). Không ai gọi rerender: hook phải tự nhận ra.
    await advance(LIVE_POINTS_STALE_MS + 5)
    expect(hook.result.current.live).toBe(false)
    expect(mocks.getPoints.mock.calls.length).toBe(before + 1)
    // Giá trị hiển thị là của bản poll, không phải giá trị WS cũ 42.
    expect(hook.result.current.points[0].value).toBe(20)
  })

  it('does not treat a reconnecting socket as live even if its last frame is recent', async () => {
    mocks.realtime.allPoints = [point('UI-01', 42, new Date().toISOString())]
    mocks.realtime.lastPointEventAt = new Date().toISOString()
    mocks.realtime.connectionState = 'reconnecting'
    const hook = renderHook(() => useLivePoints())
    await advance(0)
    expect(hook.result.current.live).toBe(false)
    expect(hook.result.current.points[0].value).toBe(20)
  })

  it('shares one /points poll between several panels', async () => {
    renderHook(() => useLivePoints())
    renderHook(() => useLivePoints())
    renderHook(() => useLivePoints())
    await advance(0)
    expect(mocks.getPoints).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(mocks.getPoints).toHaveBeenCalledTimes(2)
  })

  it('reports polled = null until the first answer, so callers cannot read "no points" into "not read yet"', async () => {
    mocks.getPoints.mockImplementation(() => new Promise(() => {}))
    const hook = renderHook(() => useLivePoints())
    await advance(0)
    expect(hook.result.current.polled).toBeNull()
    expect(hook.result.current.points).toEqual([])
    expect(hook.result.current.loading).toBe(true)
  })
})
