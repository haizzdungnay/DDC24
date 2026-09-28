import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERVIEW_REFRESH_MS, OverviewProvider, useOverview } from './OverviewProvider'

/* T63-108 (PERF-API-03) — nhịp snapshot Landing: 1 s khi tab hiện, 0 khi ẩn,
 * nạp ngay khi hiện lại; không chồng request. */

const mocks = vi.hoisted(() => ({ fetchOverview: vi.fn() }))
vi.mock('../api/overview', () => ({
  fetchOverview: mocks.fetchOverview,
  OverviewSchemaError: class OverviewSchemaError extends Error {}
}))

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function Probe() {
  const { status } = useOverview()
  return <span data-testid="status">{status}</span>
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  mocks.fetchOverview.mockReset()
  mocks.fetchOverview.mockResolvedValue({ alarms: { total: 0, unacked: 0 }, degraded: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('OverviewProvider polling', () => {
  it('refreshes every second by default, so the alarm bell fed from it stays within 1 s', async () => {
    expect(DEFAULT_OVERVIEW_REFRESH_MS).toBe(1000)
    render(<OverviewProvider><Probe /></OverviewProvider>)
    await advance(0)
    expect(mocks.fetchOverview).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) await advance(1000)
    expect(mocks.fetchOverview).toHaveBeenCalledTimes(4)
  })

  it('stops polling while the tab is hidden and reloads as soon as it is visible again', async () => {
    render(<OverviewProvider><Probe /></OverviewProvider>)
    await advance(0)
    act(() => setVisibility('hidden'))
    await advance(60_000)
    expect(mocks.fetchOverview).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await advance(0)
    expect(mocks.fetchOverview).toHaveBeenCalledTimes(2)
  })

  it('does not stack requests when the server is slower than the interval', async () => {
    let release!: (value: unknown) => void
    mocks.fetchOverview.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    render(<OverviewProvider><Probe /></OverviewProvider>)
    await advance(5000)
    expect(mocks.fetchOverview).toHaveBeenCalledTimes(1)
    await act(async () => { release({ alarms: { total: 0, unacked: 0 }, degraded: [] }) })
    await advance(1000)
    expect(mocks.fetchOverview).toHaveBeenCalledTimes(2)
  })
})
