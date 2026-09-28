import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverviewContextValue } from '../overview/OverviewProvider'
import type { Alarm, OverviewResponse } from '../types'
import { SHELL_ALARM_FALLBACK_MS, countShellAlarms, useShellAlarms } from './useShellAlarms'

/* T63-108 (PERF-API-03) — chuông cảnh báo đọc từ snapshot overview; `/alarms`
 * chỉ còn là đường dự phòng khi snapshot không đáng tin cho cảnh báo. */

const mocks = vi.hoisted(() => ({ getAlarms: vi.fn() }))
vi.mock('../api/client', () => ({ apiClient: { getAlarms: mocks.getAlarms } }))

function alarm(partial: Partial<Alarm>): Alarm {
  return { id: 'A1', time: '2026-09-28T10:00:00Z', severity: 'high', status: 'active', message: 'm', source: 'UI-01', value: '', detail: '', ...partial } as Alarm
}

/* `activeOrUnacked` mặc định = `total` cho các ca không bàn về định nghĩa;
 * truyền `null` để mô phỏng server đời cũ không có trường này. */
function overviewValue(partial: { total: number; unacked: number; activeOrUnacked?: number | null; degraded?: string[]; status?: OverviewContextValue['status'] }): OverviewContextValue {
  const bell = partial.activeOrUnacked === undefined ? partial.total : partial.activeOrUnacked
  const data = {
    alarms: {
      critical: 0, high: partial.total, medium: 0, low: 0, info: 0, unacked: partial.unacked, total: partial.total,
      ...(bell === null ? {} : { activeOrUnacked: bell })
    },
    degraded: partial.degraded ?? []
  } as unknown as OverviewResponse
  return { data, status: partial.status ?? 'ready', error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) }
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
  mocks.getAlarms.mockReset()
  mocks.getAlarms.mockResolvedValue([
    alarm({ id: 'A1', status: 'unack', active: true }),
    alarm({ id: 'A2', status: 'acked', active: true }),
    alarm({ id: 'H1', status: 'active', active: true })
  ])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useShellAlarms', () => {
  it('counts from the overview snapshot and never polls /alarms while that snapshot is trusted', async () => {
    const hook = renderHook(() => useShellAlarms(overviewValue({ total: 5, unacked: 2 })))
    await advance(10 * SHELL_ALARM_FALLBACK_MS)
    expect(mocks.getAlarms).not.toHaveBeenCalled()
    expect(hook.result.current).toMatchObject({ total: 5, unacked: 2, source: 'overview' })
  })

  /* Chỉ đổi NGUỒN, không đổi ngữ nghĩa: chuông đọc `activeOrUnacked`, KHÔNG
   * đọc `total` (total còn đếm hàng shelved đã hết điều kiện). */
  it('shows activeOrUnacked, never total, on the bell', async () => {
    const hook = renderHook(() => useShellAlarms(overviewValue({ total: 3, activeOrUnacked: 2, unacked: 1 })))
    await advance(SHELL_ALARM_FALLBACK_MS)
    expect(hook.result.current).toMatchObject({ total: 2, unacked: 1, source: 'overview' })
    expect(mocks.getAlarms).not.toHaveBeenCalled()
  })

  it('falls back to /alarms when the server does not send activeOrUnacked (older server), instead of using total', async () => {
    const hook = renderHook(() => useShellAlarms(overviewValue({ total: 7, activeOrUnacked: null, unacked: 1 })))
    await advance(0)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toMatchObject({ total: 3, unacked: 1, source: 'alarms' })
    await advance(SHELL_ALARM_FALLBACK_MS)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(2)
  })

  it('treats a negative or non-finite activeOrUnacked as untrusted', async () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      mocks.getAlarms.mockClear()
      const hook = renderHook(() => useShellAlarms(overviewValue({ total: 7, activeOrUnacked: bad, unacked: 1 })))
      await advance(0)
      expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
      expect(hook.result.current.source).toBe('alarms')
      hook.unmount()
    }
  })

  it('falls back to polling /alarms every second when the backend says alarms are degraded', async () => {
    // Core im: overview chỉ còn đếm cảnh báo điểm ảo (0). Đếm nó là báo THIẾU.
    const hook = renderHook(() => useShellAlarms(overviewValue({ total: 0, unacked: 0, degraded: ['alarms'] })))
    await advance(0)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toMatchObject({ total: 3, unacked: 1, source: 'alarms' })
    await advance(SHELL_ALARM_FALLBACK_MS)
    await advance(SHELL_ALARM_FALLBACK_MS)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(3)
  })

  it('falls back when the overview itself failed, instead of trusting a snapshot it could not refresh', async () => {
    const hook = renderHook(() => useShellAlarms(overviewValue({ total: 0, unacked: 0, status: 'error' })))
    await advance(0)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
    expect(hook.result.current.source).toBe('alarms')
    expect(hook.result.current.total).toBe(3)
  })

  it('keeps the last trusted count while the first fallback read is pending, never dropping to 0', async () => {
    mocks.getAlarms.mockImplementation(() => new Promise(() => {}))
    const hook = renderHook(({ value }: { value: OverviewContextValue }) => useShellAlarms(value), {
      initialProps: { value: overviewValue({ total: 4, unacked: 1 }) }
    })
    await advance(0)
    expect(hook.result.current.total).toBe(4)

    hook.rerender({ value: overviewValue({ total: 0, unacked: 0, degraded: ['alarms'] }) })
    await advance(0)
    expect(hook.result.current).toMatchObject({ total: 4, unacked: 1, source: 'alarms' })
  })

  it('stops the fallback poll once the overview is trusted again', async () => {
    const hook = renderHook(({ value }: { value: OverviewContextValue }) => useShellAlarms(value), {
      initialProps: { value: overviewValue({ total: 0, unacked: 0, degraded: ['alarms'] }) }
    })
    await advance(0)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
    hook.rerender({ value: overviewValue({ total: 2, unacked: 0 }) })
    await advance(5 * SHELL_ALARM_FALLBACK_MS)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toMatchObject({ total: 2, source: 'overview' })
  })

  it('refresh() reloads the overview (after an ack) rather than only the list', async () => {
    const value = overviewValue({ total: 1, unacked: 1 })
    const hook = renderHook(() => useShellAlarms(value))
    await advance(0)
    act(() => hook.result.current.refresh())
    expect(value.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.getAlarms).not.toHaveBeenCalled()
  })
})

describe('countShellAlarms', () => {
  it('keeps the bell definition: active or unacknowledged rows, cleared rows excluded', () => {
    expect(countShellAlarms([
      alarm({ id: '1', status: 'unack', active: false }),
      alarm({ id: '2', status: 'acked', active: true }),
      alarm({ id: '3', status: 'cleared', active: false }),
      alarm({ id: '4', status: 'active' })
    ])).toEqual({ total: 3, unacked: 1 })
  })

  /* Trên dây `/alarms` KHÔNG có `active` khi nó là false (`omitempty` ở Go),
   * nên hàng chốt tay đã xác nhận, hết điều kiện đến FE với `active`
   * undefined và được đếm theo status `acked`; hàng `shelved` thì không. */
  it('counts an acked row without the active flag and skips a shelved one, as the /alarms wire format implies', () => {
    expect(countShellAlarms([
      alarm({ id: 'latched', status: 'acked' }),
      alarm({ id: 'shelved', status: 'shelved' }),
      alarm({ id: 'shelved-on', status: 'shelved', active: true })
    ])).toEqual({ total: 2, unacked: 0 })
  })
})
