import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSharedPollsForTests } from '../../shared/hooks/useSharedPoll'
import { I18nProvider } from '../../shared/i18n'
import type { ActivityPage, ConnectionState, OverviewResponse, Point } from '../../shared/types'
import { DashboardPage } from './DashboardPage'

/**
 * T63-108 (PERF-API-03) — ngân sách GET của MỘT tab Landing, đo bằng hook THẬT.
 *
 * Trước bản này ba khối (ép tay, không gian của tôi, xu hướng nhanh) mỗi khối
 * tự poll `/points` mỗi 2 s và hai khối tự poll `/activity` mỗi 10 s: 1,5 + 0,2
 * GET/s cho hai tài nguyên. Test này đỏ ngay khi một khối quay lại vòng poll
 * riêng, hoặc khi kênh sống còn tươi mà Landing vẫn poll `/points` mỗi 2 s.
 */

const mocks = vi.hoisted(() => ({
  getPoints: vi.fn(),
  fetchActivity: vi.fn(),
  realtime: { connectionState: 'connected' as ConnectionState, allPoints: [] as Point[], lastPointEventAt: null as string | null }
}))

vi.mock('../../shared/api/client', () => ({ apiClient: { getPoints: mocks.getPoints } }))
vi.mock('../../shared/api/overview', () => ({ fetchActivity: mocks.fetchActivity }))
vi.mock('../../shared/realtime', () => ({ useRealtime: () => mocks.realtime }))
vi.mock('../auth', () => ({ useAuth: () => ({ session: { username: 'op1', role: 'operator' } }) }))
vi.mock('../../shared/overview/OverviewProvider', () => ({
  useOverview: () => ({ data: overview(), status: 'ready' as const, error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) })
}))

function overview(): OverviewResponse {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    controller: { deviceName: 'DDC24-TANG-1', firmware: '1.0', ip: '10.0.0.9', mac: 'AA:BB:CC:DD:EE:FF', systemTime: new Date().toISOString(), uptimeS: 10 },
    connected: true,
    lastDataAt: new Date().toISOString(),
    overallState: 'good',
    overallReasonCode: 'ok',
    alarms: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unacked: 0, total: 0 },
    points: { total: 1, good: 1, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 0, groups: [] },
    health: [],
    attention: [],
    capabilities: { digitalInputs: 0, universalInputs: 16, analogOutputs: 4, digitalOutputs: 4, modbusRtuBuses: 0, bacnetIpEnabled: false },
    degraded: []
  } as OverviewResponse
}

function uiPoint(value: number): Point {
  return { id: 'UI-01', tag: 'UI-01', name: 'UI 01', kind: 'UI', value, unit: '°C', quality: 'good', source: 'core', updatedAt: new Date().toISOString() } as Point
}

const activityPage: ActivityPage = { schemaVersion: 1, generatedAt: '2026-09-28T10:00:00Z', items: [], nextCursor: null, retained: 0, capacity: 2000 }

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
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  resetSharedPollsForTests()
  mocks.getPoints.mockReset()
  mocks.getPoints.mockImplementation(async () => [uiPoint(20)])
  mocks.fetchActivity.mockReset()
  mocks.fetchActivity.mockResolvedValue(activityPage)
  mocks.realtime.connectionState = 'connected'
  mocks.realtime.allPoints = []
  mocks.realtime.lastPointEventAt = null
})

afterEach(() => {
  cleanup()
  resetSharedPollsForTests()
  vi.useRealTimers()
})

function renderDashboard() {
  return render(<MemoryRouter><I18nProvider><DashboardPage /></I18nProvider></MemoryRouter>)
}

describe('Landing GET budget (T63-108)', () => {
  it('reads /points ONCE per 2 s for all panels and /activity once per 10 s without a live channel', async () => {
    renderDashboard()
    await advance(0)
    expect(mocks.getPoints).toHaveBeenCalledTimes(1)
    // Một lần đọc nhật ký cho cả "Ai đang giữ quyền" lẫn tab "Người dùng" của khối Hoạt động.
    expect(mocks.fetchActivity).toHaveBeenCalledTimes(1)
    expect(mocks.fetchActivity).toHaveBeenCalledWith({ limit: 200, kind: 'user' })

    for (let i = 0; i < 5; i++) await advance(2000)
    expect(mocks.getPoints).toHaveBeenCalledTimes(6)
    expect(mocks.fetchActivity).toHaveBeenCalledTimes(2)
  })

  it('does not poll /points every 2 s while the live channel is fresh', async () => {
    mocks.realtime.allPoints = [uiPoint(42)]
    mocks.realtime.lastPointEventAt = new Date().toISOString()
    const view = renderDashboard()
    await advance(0)
    expect(mocks.getPoints).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 40; i++) {
      mocks.realtime.lastPointEventAt = new Date().toISOString()
      mocks.realtime.allPoints = [uiPoint(42 + (i % 3))]
      view.rerender(<MemoryRouter><I18nProvider><DashboardPage /></I18nProvider></MemoryRouter>)
      await advance(200)
    }
    // 8 s sống ⇒ không GET /points nào ngoài lần đầu (nhịp dự phòng 10 s).
    expect(mocks.getPoints).toHaveBeenCalledTimes(1)
  })
})
