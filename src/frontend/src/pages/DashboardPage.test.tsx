import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { DashboardPage } from './DashboardPage'

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getPoints: vi.fn(),
  getAlarms: vi.fn(),
  refetch: vi.fn()
}))

const uiPoints = Array.from({ length: 4 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  return {
    id: `UI-${number}`,
    tag: `UI-${number}`,
    name: `Sensor ${number}`,
    kind: 'UI' as const,
    value: 20 + index,
    unit: 'degC',
    quality: 'good' as const,
    source: 'test',
    updatedAt: '2026-07-23T08:00:00Z'
  }
})

const points = [
  ...uiPoints,
  { ...uiPoints[0], id: 'AO-01', tag: 'AO-01', name: 'Valve command', kind: 'AO' as const, value: 42, unit: '%' },
  { ...uiPoints[0], id: 'DO-01', tag: 'DO-01', name: 'Supply fan', kind: 'DO' as const, value: true, unit: undefined },
  { ...uiPoints[0], id: 'VP1', tag: 'Calculated load', name: 'Calculated load', kind: 'virtual' as const, value: 68, unit: '%' }
]

vi.mock('../api/client', () => ({
  apiClient: {
    getHealth: mocks.getHealth,
    getPoints: mocks.getPoints,
    getAlarms: mocks.getAlarms
  }
}))

// WEB-UX-001 cần dựng được cả trường hợp KHÔNG có health, nên payload phải đổi
// được giữa các test thay vì hằng số cứng trong factory.
let healthPayload: Record<string, unknown> | null = { overall: 'ok', services: {} }

vi.mock('../hooks/useApi', () => ({
  useApi: (fetcher: unknown) => {
    const data = fetcher === mocks.getPoints
      ? points
      : fetcher === mocks.getHealth
        ? healthPayload
        : []
    return { data, loading: false, error: null, refetch: mocks.refetch }
  }
}))

vi.mock('../realtime', () => ({
  useRealtime: () => ({ allPoints: [], lastPointEventAt: null })
}))

vi.mock('../components/ControllerDiagram', () => ({
  ControllerDiagram: () => <div>Controller diagram</div>
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
  healthPayload = { overall: 'ok', services: {} }
})
afterEach(cleanup)

function renderDashboard() {
  return render(
    <MemoryRouter>
      <I18nProvider><DashboardPage /></I18nProvider>
    </MemoryRouter>
  )
}

/**
 * WEB-UX-001 — trung thực dữ liệu.
 *
 * Các test dưới đây chặn đúng một loại hồi quy: đặt lại một giá trị dự phòng
 * "trông hợp lý" khi API không trả dữ liệu. Bản cũ có `?? 23` (CPU), `?? 48`
 * (RAM), một uptime 12 ngày dựng sẵn, MAC và giờ hệ thống gán cứng trong JSX, và
 * `DeviceStatusCard()` không tham số nên luôn vẽ "ONLINE" màu xanh. Hậu quả:
 * một board đã mất liên lạc vẫn hiển thị y hệt một board khoẻ mạnh.
 */
describe('Dashboard data honesty', () => {
  it('shows a dash instead of invented metrics when health is unavailable', () => {
    healthPayload = null
    renderDashboard()

    expect(screen.getByText('UNKNOWN')).toBeInTheDocument()
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument()
    // Không còn con số dự phòng nào của bản cũ.
    expect(screen.queryByText('23%')).not.toBeInTheDocument()
    expect(screen.queryByText('48%')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No data').length).toBeGreaterThanOrEqual(3)

    // MAC và giờ hệ thống gán cứng của bản cũ phải biến mất hoàn toàn.
    expect(screen.queryByText('00:0D:18:24:AC:01')).not.toBeInTheDocument()
    expect(screen.queryByText('23/05/2025 14:32:18')).not.toBeInTheDocument()
  })

  it('maps the real overall status onto the device card instead of always ONLINE', () => {
    healthPayload = { overall: 'fault', services: {} }
    renderDashboard()

    expect(screen.getByText('FAULT')).toBeInTheDocument()
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument()
  })

  it('renders device identity coming from the API', () => {
    healthPayload = {
      overall: 'ok',
      services: {},
      cpuPercent: 7.5,
      deviceMac: 'AA:BB:CC:DD:EE:FF',
      deviceIp: '10.0.0.9',
      location: 'Panel B2',
      description: 'AHU-2 loop'
    }
    renderDashboard()

    expect(screen.getByText('AA:BB:CC:DD:EE:FF')).toBeInTheDocument()
    // IP xuất hiện ở cả ô Ethernet lẫn bảng thông tin thiết bị.
    expect(screen.getAllByText('10.0.0.9').length).toBeGreaterThan(0)
    expect(screen.getByText('Panel B2')).toBeInTheDocument()
    expect(screen.getByText('AHU-2 loop')).toBeInTheDocument()
    expect(screen.getByText('8%')).toBeInTheDocument()
  })
})

describe('Dashboard live trend point picker', () => {
  it('allows changing the displayed points while enforcing a maximum of four', async () => {
    const user = userEvent.setup()
    const view = render(
      <MemoryRouter>
        <I18nProvider><DashboardPage /></I18nProvider>
      </MemoryRouter>
    )

    await user.click(await screen.findByRole('button', { name: 'Points 4/4' }))
    expect(screen.getByRole('heading', { name: 'POINT TREND' })).toBeInTheDocument()
    const analogOutput = screen.getByRole('checkbox', { name: /AO-01/ })
    expect(analogOutput).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /UI-01/ }))
    expect(analogOutput).toBeEnabled()
    await user.click(analogOutput)

    expect(screen.getByText('4/4')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /DO-01/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /VP1/ })).toBeDisabled()

    await waitFor(() => expect(JSON.parse(localStorage.getItem('mkddc:dashboard-trend-points:v1') ?? '[]')).toEqual(['UI-02', 'UI-03', 'UI-04', 'AO-01']))
    view.unmount()

    render(
      <MemoryRouter>
        <I18nProvider><DashboardPage /></I18nProvider>
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Points 4/4' }))
    expect(screen.getByRole('checkbox', { name: /UI-01/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /AO-01/ })).toBeChecked()
  })
})
