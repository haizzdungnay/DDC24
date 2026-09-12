import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import type { ActivityPage, OverviewResponse, Point } from '../../shared/types'
import { DashboardPage } from './DashboardPage'

/**
 * PA3-308 — nghiệm thu Landing.
 *
 * Bộ test này chốt đúng những gì bản Dashboard cũ làm sai và không được quay
 * lại: debug metric trên trang chủ, `RS485-2` không có thật, giá trị `0` cho
 * point offline, và trạng thái "ổn" khi thật ra không đọc được gì.
 */

const mocks = vi.hoisted(() => ({
  getPoints: vi.fn(),
  fetchActivity: vi.fn(),
  refetch: vi.fn()
}))

const points: Point[] = [
  { id: 'UI-01', tag: 'UI-01', name: 'Nhiệt độ phòng', kind: 'UI', value: 23.6, unit: '°C', quality: 'good', source: 'local_physical_io', updatedAt: '2026-08-08T03:00:00Z' },
  { id: 'UI-02', tag: 'UI-02', name: 'Áp suất bơm', kind: 'UI', value: 2.41, unit: 'bar', quality: 'good', source: 'local_physical_io', updatedAt: '2026-08-08T03:00:00Z' },
  { id: 'UI-03', tag: 'UI-03', name: 'Cảm biến mất tín hiệu', kind: 'UI', value: undefined, quality: 'offline', source: 'local_physical_io' },
  { id: 'AO-01', tag: 'AO-01', name: 'Van cấp', kind: 'AO', value: 42, unit: '%', quality: 'good', source: 'local_physical_io', updatedAt: '2026-08-08T03:00:00Z', forced: true, overrideExpiresInS: 272 }
]

let overviewState: {
  data: OverviewResponse | null
  status: 'loading' | 'ready' | 'error' | 'incompatible'
  error: Error | null
  receivedAt: number | null
  refresh: () => Promise<void>
}

function baseOverview(): OverviewResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-08T03:00:05Z',
    controller: { deviceName: 'DDC24-TANG-1', location: 'Panel B2', firmware: '1.0', webVersion: 'test', ip: '10.0.0.9', mac: 'AA:BB:CC:DD:EE:FF', systemTime: '2026-08-08T10:00:05+07:00', uptimeS: 4200 },
    connected: true,
    lastDataAt: '2026-08-08T03:00:00Z',
    overallState: 'degraded',
    overallReasonCode: 'high_alarm_active',
    alarms: { critical: 0, high: 1, medium: 1, low: 0, info: 0, unacked: 1, total: 2 },
    points: {
      total: 4, good: 3, uncertain: 0, bad: 0, stale: 0, offline: 1, forced: 1,
      groups: [
        { kind: 'UI', total: 3, good: 2, uncertain: 0, bad: 0, stale: 0, offline: 1, forced: 0 },
        { kind: 'AO', total: 1, good: 1, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 1 }
      ]
    },
    health: [
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-08T03:00:05Z', link: '/diagnostics' },
      { domain: 'local_io', state: 'degraded', reasonCode: 'stale_points', source: 'plc_shm', observedAt: '2026-08-08T03:00:05Z', detail: '1 điểm stale/offline' },
      { domain: 'modbus', state: 'unknown', reasonCode: 'not_configured', source: 'iobus_telemetry', observedAt: '2026-08-08T03:00:05Z' },
      { domain: 'network', state: 'good', reasonCode: 'ok', source: 'kernel_interfaces', observedAt: '2026-08-08T03:00:05Z', detail: '10.0.0.9' },
      { domain: 'historian', state: 'unknown', reasonCode: 'no_logged_points', source: 'historian_policy', observedAt: '2026-08-08T03:00:05Z' }
    ],
    attention: [
      { id: 'alarm:A1', severity: 'high', category: 'alarm', title: 'Pump-02 communication failure', detail: 'Bus 1 · Slave 12', targetType: 'alarm', targetId: 'A1', observedAt: '2026-08-08T03:00:00Z' },
      { id: 'point:UI-03', severity: 'medium', category: 'quality', title: 'UI-03 — STALE', detail: 'UI-03', targetType: 'point', targetId: 'UI-03' }
    ],
    capabilities: { digitalInputs: 0, universalInputs: 16, analogOutputs: 4, digitalOutputs: 4, modbusRtuBuses: 0, bacnetIpEnabled: false },
    degraded: []
  }
}

vi.mock('../../shared/api/client', () => ({ apiClient: { getPoints: mocks.getPoints } }))
vi.mock('../../shared/api/overview', () => ({ fetchActivity: mocks.fetchActivity }))

vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (fetcher: unknown) => {
    if (fetcher === mocks.getPoints) return { data: points, loading: false, error: null, refetch: mocks.refetch }
    const activity: ActivityPage = { schemaVersion: 1, generatedAt: '2026-08-08T03:00:05Z', items: [], nextCursor: null, retained: 0, capacity: 100 }
    return { data: activity, loading: false, error: null, refetch: mocks.refetch }
  }
}))

vi.mock('../../shared/realtime', () => ({ useRealtime: () => ({ allPoints: [], lastPointEventAt: null }) }))
vi.mock('../auth', () => ({ useAuth: () => ({ session: { username: 'op1', role: 'operator' } }) }))
vi.mock('../../shared/overview/OverviewProvider', () => ({ useOverview: () => overviewState }))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  overviewState = { data: baseOverview(), status: 'ready', error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) }
})
afterEach(cleanup)

function renderDashboard() {
  return render(<MemoryRouter><I18nProvider><DashboardPage /></I18nProvider></MemoryRouter>)
}

describe('Landing PA3 — thông tin vận hành thay cho debug', () => {
  it('không còn CPU/RAM/nhiệt độ/uptime/service/RS485-2 trên trang chủ', () => {
    renderDashboard()
    // PA3-F01: sáu ô debug từng chiếm nửa trên của Landing.
    expect(screen.queryByText(/CPU/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/BỘ NHỚ|MEMORY/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/UPTIME/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^SERVICES$/i)).not.toBeInTheDocument()
    // PA3-F02: Rev A không có cổng RS-485 thứ hai.
    expect(screen.queryByText(/RS485-2/i)).not.toBeInTheDocument()
  })

  it('hiện trạng thái tổng, tuổi dữ liệu và số cảnh báo theo mức', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: 'DDC24-TANG-1' })).toBeInTheDocument()
    expect(screen.getAllByText('DEGRADED').length).toBeGreaterThan(0)
    expect(screen.getByText('HIGH 1')).toBeInTheDocument()
    expect(screen.getByText('MEDIUM 1')).toBeInTheDocument()
    expect(screen.getByText('CRITICAL 0')).toBeInTheDocument()
  })

  it('mỗi ô Health Strip nói ra nguồn dữ liệu và giữ UNKNOWN tách khỏi GOOD', () => {
    renderDashboard()
    const strip = screen.getByRole('region', { name: 'Sức khoẻ phân hệ' })
    expect(within(strip).getByText('Bộ điều khiển')).toBeInTheDocument()
    expect(within(strip).getAllByText('UNKNOWN').length).toBe(2) // modbus + historian
    expect(within(strip).getByText(/core_shm/)).toBeInTheDocument()
  })

  it('Attention xếp theo mức và mỗi dòng drill-down về đúng đối tượng', () => {
    renderDashboard()
    const links = screen.getAllByRole('link', { name: /Xem chi tiết/ })
    expect(links[0]).toHaveAttribute('href', '/alarms?alarm=A1')
    expect(links[1]).toHaveAttribute('href', '/monitor?point=UI-03')
  })

  it('Operating Summary không có hàng DI trên base SKU', () => {
    renderDashboard()
    expect(screen.getByRole('link', { name: 'UI' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'DI' })).not.toBeInTheDocument()
  })

  it('fail closed khi thiết bị trả schemaVersion lạ', () => {
    overviewState = { data: null, status: 'incompatible', error: new Error('Overview schemaVersion 99'), receivedAt: null, refresh: vi.fn(async () => {}) }
    renderDashboard()
    expect(screen.getByText(/lệch phiên bản dữ liệu/i)).toBeInTheDocument()
    // Không được vẽ tổng quan bằng dữ liệu đoán.
    expect(screen.queryByRole('region', { name: 'Sức khoẻ phân hệ' })).not.toBeInTheDocument()
  })

  it('hiện — thay vì giờ hiện tại khi không point nào có mốc thời gian thật', () => {
    const overview = baseOverview()
    overview.lastDataAt = null
    overviewState = { data: overview, status: 'ready', error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) }
    renderDashboard()
    const label = screen.getByText('Dữ liệu mới nhất').parentElement
    expect(label).toHaveTextContent('—')
  })
})

describe('My Workspace', () => {
  it('ghim theo namespace controller + người dùng và hiện — cho point offline', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(screen.getByRole('button', { name: /Quản lý ghim/ }))
    await user.click(screen.getByRole('checkbox', { name: /UI-03/ }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mkddc:v1:workspace:DDC24-TANG-1:op1') ?? '[]')).toEqual(['UI-03']))
    await user.click(screen.getByRole('button', { name: 'Xong' }))

    // §8: point offline hiện `—`, KHÔNG hiện `0`.
    const tile = screen.getByRole('link', { name: /Cảm biến mất tín hiệu/ })
    expect(within(tile).getByText('—')).toBeInTheDocument()
    expect(within(tile).queryByText('0')).not.toBeInTheDocument()
    expect(within(tile).getByText('OFFLINE')).toBeInTheDocument()
  })

  it('nói ra khi ghim trỏ tới đối tượng không còn tồn tại', () => {
    localStorage.setItem('mkddc:v1:workspace:DDC24-TANG-1:op1', JSON.stringify(['UI-99']))
    renderDashboard()
    expect(screen.getByText(/không còn trong cấu hình hiện tại/i)).toBeInTheDocument()
  })
})

describe('Trend preview', () => {
  it('chỉ đề xuất point có số đo và nhớ lựa chọn', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole('button', { name: /Điểm 0\/4/ }))
    // UI-03 chưa có số đo (`value === undefined`) nên KHÔNG được đề xuất: vẽ nó
    // lên biểu đồ đồng nghĩa với vẽ một đường 0 không ai đo được (REV-FE-04).
    expect(screen.queryByRole('checkbox', { name: /UI-03/ })).not.toBeInTheDocument()
    for (const id of ['UI-01', 'UI-02', 'AO-01']) {
      await user.click(screen.getByRole('checkbox', { name: new RegExp(id) }))
    }
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mkddc:v1:landing-trend-points') ?? '[]')).toEqual(['UI-01', 'UI-02', 'AO-01']))
  })
})


/**
 * `ISS-PGUI-02` — giao diện English KHÔNG được lọt tiếng Việt do máy chủ nối
 * sẵn (`PC-005`, `PM-006`, `pm-006`, `pm-014`).
 *
 * Fixture dưới đây dựng đúng hình dạng đã tái hiện trên production: máy chủ vẫn
 * gửi `detail`/`title` tiếng Việt (hợp đồng giữ chúng làm diagnostic fallback),
 * và giao diện phải dựng câu của chính nó từ `reasonCode`/`titleCode` + tham số
 * typed.
 */
const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i

describe('ISS-PGUI-02 — Dashboard không trộn EN/VI', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    const overview = baseOverview()
    overview.health = [
      { domain: 'local_io', state: 'fault', reasonCode: 'bad_quality_points', source: 'plc_shm', observedAt: '2026-08-08T03:00:05Z', detailCount: 3, detail: '3 điểm chất lượng bad' },
      { domain: 'modbus', state: 'unknown', reasonCode: 'not_configured', source: 'iobus_telemetry', observedAt: '2026-08-08T03:00:05Z', detail: 'Chưa cấu hình thiết bị Modbus RTU' },
      { domain: 'network', state: 'good', reasonCode: 'ok', source: 'kernel_interfaces', observedAt: '2026-08-08T03:00:05Z', detail: '10.0.0.9' },
      { domain: 'historian', state: 'good', reasonCode: 'ok', source: 'historian_policy', observedAt: '2026-08-08T03:00:05Z', detailCount: 12, detail: '12 điểm đang ghi' },
    ]
    overview.attention = [
      { id: 'alarm:A1', severity: 'high', category: 'alarm', title: 'Pump-02 communication failure', detail: 'Bus 1 · Slave 12', targetType: 'alarm', targetId: 'A1', observedAt: '2026-08-08T03:00:00Z' },
      { id: 'modbus:1-12', severity: 'high', category: 'communication', title: 'Thiết bị Modbus mất liên lạc', titleCode: 'modbus_device_offline', subject: '', detailCode: 'modbus_bus_slave', detailParams: { busId: 1, slaveAddr: 12 }, detail: 'Bus 1 · Slave 12', targetType: 'bus', targetId: '1' },
      { id: 'forced:AO-01', severity: 'medium', category: 'forced', title: 'Van cấp — đang ép tay', titleCode: 'point_forced', subject: 'Van cap', detailCode: 'forced_no_expiry', detail: 'AO-01 · không có thời hạn tự nhả', targetType: 'point', targetId: 'AO-01' },
    ]
    overviewState = { data: overview, status: 'ready', error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) }
  })

  it('Health Strip không còn chữ tiếng Việt của máy chủ khi giao diện là English', () => {
    renderDashboard()
    const strip = screen.getByLabelText('Subsystem health')
    expect(strip).toHaveTextContent('3 points with BAD quality')
    expect(strip).toHaveTextContent('Not configured')
    expect(strip).toHaveTextContent('12 points being logged')
    // Địa chỉ IP là ĐỊNH DANH — giữ nguyên, không dịch và không thay bằng nhãn.
    expect(strip).toHaveTextContent('10.0.0.9')
    expect(strip.textContent ?? '').not.toMatch(VI_DIACRITICS)
  })

  it('Việc cần chú ý dựng câu từ mã; thông điệp alarm của Core giữ nguyên văn', () => {
    renderDashboard()
    expect(screen.getByText('A Modbus device lost contact')).toBeInTheDocument()
    expect(screen.getByText('Van cap — manually forced')).toBeInTheDocument()
    expect(screen.getByText(/No automatic release deadline/)).toBeInTheDocument()
    // `titleCode` rỗng ⇒ văn bản đục của authority thượng nguồn, in nguyên văn.
    expect(screen.getByText('Pump-02 communication failure')).toBeInTheDocument()
    expect(screen.queryByText(/Thiết bị Modbus mất liên lạc/)).not.toBeInTheDocument()
    expect(screen.queryByText(/không có thời hạn tự nhả/)).not.toBeInTheDocument()
  })

  it('cùng fixture ở tiếng Việt thì mọi câu tương ứng là tiếng Việt', () => {
    localStorage.setItem('mkddc-lang', 'vi')
    renderDashboard()
    const strip = screen.getByLabelText('Sức khoẻ phân hệ')
    expect(strip).toHaveTextContent('3 điểm chất lượng BAD')
    expect(strip).toHaveTextContent('Chưa cấu hình')
    expect(strip).toHaveTextContent('12 điểm đang ghi')
    expect(screen.getByText('Thiết bị Modbus mất liên lạc')).toBeInTheDocument()
    expect(screen.getByText('Van cap — đang ép tay')).toBeInTheDocument()
  })
})
