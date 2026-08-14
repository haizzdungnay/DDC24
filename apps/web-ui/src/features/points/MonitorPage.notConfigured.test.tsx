import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { Point } from '../../shared/types'
import { MonitorPage } from './MonitorPage'

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  updatePointConfig: vi.fn(),
  forcePoint: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as Point[], refetch: vi.fn() }))

vi.mock('../../shared/api/client', () => ({
  POINT_UNIT_OPTIONS: [{ value: '', label: 'None' }],
  aiUnitFromPointUnit: () => 0,
  pointUnitFromAiUnit: () => '',
  apiClient: api
}))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (loader: unknown) => loader === api.getVirtualPoints
    ? { data: hookState.virtualPoints, loading: false, error: null, refetch: hookState.refetch }
    : { data: hookState.points, loading: false, error: null, refetch: hookState.refetch }
}))
vi.mock('../../shared/realtime', () => ({
  useRealtime: () => ({ allPoints: [], lastPointEventAt: undefined, connectionState: 'connected', forcePoint: vi.fn() })
}))
vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'admin', role: 'admin', loginAt: '2026-08-01T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
  }
})

function renderPage() {
  return render(<MemoryRouter><I18nProvider><ToastProvider><MonitorPage /></ToastProvider></I18nProvider></MemoryRouter>)
}

// F-DASH-LOCALIO-01 — UI-09..16 với Signal Type "none" là chủ ý chưa nối cảm
// biến, không phải fault. Monitor page không được đếm chúng vào "Điểm lỗi /
// mất tín hiệu" hay hiện đỏ BAD cho chúng, trong khi điểm bad THẬT vẫn phải
// báo đúng.
describe('MonitorPage — kênh Signal Type none không bị coi là lỗi', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'vi')
    hookState.points = [
      { id: 'UI-01', tag: 'UI-01', name: 'UI-01', kind: 'UI', value: 23, unit: 'degC', quality: 'good', signalType: '0-10V', source: 'core', updatedAt: new Date().toISOString() },
      { id: 'UI-02', tag: 'UI-02', name: 'UI-02', kind: 'UI', value: 0, quality: 'bad', signalType: '0-10V', source: 'core', fault: true, updatedAt: new Date().toISOString() },
      { id: 'UI-09', tag: 'UI-09', name: 'UI-09', kind: 'UI', value: 0, quality: 'bad', signalType: 'none', source: 'core', fault: true, updatedAt: new Date().toISOString() },
      { id: 'UI-10', tag: 'UI-10', name: 'UI-10', kind: 'UI', value: 0, quality: 'bad', signalType: 'none', source: 'core', fault: true, updatedAt: new Date().toISOString() }
    ]
    hookState.virtualPoints = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hiện "Chưa cấu hình" thay vì BAD đỏ cho kênh signalType none', async () => {
    renderPage()
    const rows = await screen.findAllByText('Chưa cấu hình')
    expect(rows).toHaveLength(2)
    // Điểm bad thật (UI-02) vẫn phải hiện BAD, không bị nuốt mất.
    expect(screen.getByText('BAD')).toBeInTheDocument()
  })

  it('"Điểm lỗi / mất tín hiệu" chỉ đếm bad thật, không tính kênh chưa cấu hình', async () => {
    renderPage()
    await screen.findAllByText('Chưa cấu hình')
    // 4 điểm: 1 good, 1 bad thật, 2 none — chỉ UI-02 được tính là lỗi.
    const card = screen.getByText('Điểm lỗi / mất tín hiệu').parentElement
    expect(card).toHaveTextContent('1')
  })
})
