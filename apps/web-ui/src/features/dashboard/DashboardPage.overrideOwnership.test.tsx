import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import type { ActivityPage, OverviewResponse, Point } from '../../shared/types'
import { DashboardPage, stalestSubsystem } from './DashboardPage'

/**
 * Test khoá HÀNH VI cho khối "Ai đang giữ quyền điều khiển" (`T57-1.2`) và ô
 * "phân hệ cũ nhất" (`T57-1.11`).
 *
 * Mỗi `it` khoá một mệnh đề có thể sai theo một cách cụ thể trên màn hình bàn
 * giao ca; tất cả đã được kiểm ngược bằng mutant.
 */

const mocks = vi.hoisted(() => ({
  getPoints: vi.fn(),
  fetchActivity: vi.fn(),
  refetch: vi.fn()
}))

let pointsResult: { data: Point[] | null; loading: boolean; error: Error | null }
let activityItems: ActivityPage['items']
let overviewData: OverviewResponse

function baseOverview(): OverviewResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-18T07:00:05Z',
    controller: { deviceName: 'DDC24-TANG-1', firmware: '1.0', ip: '10.0.0.9', mac: 'AA:BB:CC:DD:EE:FF', systemTime: '2026-08-18T14:00:05+07:00', uptimeS: 4200 },
    connected: true,
    lastDataAt: '2026-08-18T07:00:00Z',
    overallState: 'good',
    overallReasonCode: 'ok',
    alarms: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unacked: 0, total: 0 },
    points: { total: 3, good: 3, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 2, groups: [] },
    health: [
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-18T07:00:05Z' },
      { domain: 'modbus', state: 'good', reasonCode: 'ok', source: 'iobus_telemetry', observedAt: '2026-08-18T06:20:05Z' }
    ],
    attention: [],
    capabilities: { digitalInputs: 0, universalInputs: 16, analogOutputs: 4, digitalOutputs: 4, modbusRtuBuses: 1, bacnetIpEnabled: false },
    degraded: []
  }
}

vi.mock('../../shared/api/client', () => ({ apiClient: { getPoints: mocks.getPoints } }))
vi.mock('../../shared/api/overview', () => ({ fetchActivity: mocks.fetchActivity }))
/* T63-108: bảng điểm đi qua `useLivePoints` (`polled === null` nghĩa là CHƯA
   đọc được lần nào — cơ sở của "không kết luận được"), nhật ký qua
   `useSharedPoll`. */
vi.mock('../../shared/hooks/useLivePoints', () => ({
  useLivePoints: () => ({
    points: pointsResult.data ?? [],
    live: false,
    polled: pointsResult.data,
    loading: pointsResult.loading,
    error: pointsResult.error,
    refetch: mocks.refetch
  })
}))
vi.mock('../../shared/hooks/useSharedPoll', () => ({
  useSharedPoll: () => {
    const activity: ActivityPage = {
      schemaVersion: 1, generatedAt: '2026-08-18T07:00:05Z', items: activityItems, nextCursor: null, retained: 0, capacity: 2000
    }
    return { data: activity, loading: false, error: null, receivedAt: 0, refetch: mocks.refetch }
  }
}))
vi.mock('../auth', () => ({ useAuth: () => ({ session: { username: 'op1', role: 'viewer' } }) }))
vi.mock('../../shared/overview/OverviewProvider', () => ({
  useOverview: () => ({ data: overviewData, status: 'ready' as const, error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) })
}))

function point(over: Partial<Point> & Pick<Point, 'id'>): Point {
  return { tag: over.id, name: `Tên ${over.id}`, kind: 'DO', value: false, quality: 'good', source: 'core', ...over } as Point
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  activityItems = []
  overviewData = baseOverview()
  pointsResult = { data: [], loading: false, error: null }
})
afterEach(cleanup)

function renderDashboard() {
  return render(<MemoryRouter><I18nProvider><DashboardPage /></I18nProvider></MemoryRouter>)
}

function ownershipPanel(): HTMLElement {
  return screen.getByText('AI ĐANG GIỮ QUYỀN ĐIỀU KHIỂN').closest('section') as HTMLElement
}

describe('T57-1.2 — khối "Ai đang giữ quyền điều khiển"', () => {
  it('liệt kê điểm đang ép tay kèm người ra lệnh và đếm ngược', () => {
    pointsResult = {
      data: [
        point({ id: 'DO-02', name: 'Quạt cấp AHU-1', value: true, forced: true, overrideExpiresInS: 1104, priority: 'LOCAL_MANUAL' })
      ],
      loading: false,
      error: null
    }
    activityItems = [
      { id: 42, time: '2026-08-18T07:02:11Z', kind: 'user', actor: 'chuong', role: 'operator', action: 'point_force', objectId: 'DO-02', outcome: 'accepted' }
    ]
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText('DO-02')).toBeInTheDocument()
    expect(within(panel).getByText('Quạt cấp AHU-1')).toBeInTheDocument()
    expect(within(panel).getByText('chuong · operator')).toBeInTheDocument()
    expect(within(panel).getByText('18:24')).toBeInTheDocument()
  })

  it('không có vết trong Activity ⇒ nói rõ là không có vết, KHÔNG ghi "hệ thống"', () => {
    pointsResult = { data: [point({ id: 'DO-02', forced: true, overrideExpiresInS: 60 })], loading: false, error: null }
    activityItems = []
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText(/không có vết trong nhật ký/)).toBeInTheDocument()
    expect(within(panel).queryByText(/hệ thống/i)).not.toBeInTheDocument()
  })

  it('điểm không có TTL hiện "không có thời hạn", TUYỆT ĐỐI không hiện 00:00', () => {
    // Đây là hồi quy nguy hiểm nhất của khối: `00:00` đọc là "vừa hết hạn", còn
    // sự thật là lệnh này KHÔNG BAO GIỜ tự nhả và phải nhả bằng tay.
    pointsResult = { data: [point({ id: 'VP-SETP-01', kind: 'virtual', forced: true })], loading: false, error: null }
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText('không có thời hạn')).toBeInTheDocument()
    expect(within(panel).queryByText('00:00')).not.toBeInTheDocument()
  })

  it('điểm sắp hết hạn có dấu hiệu PHI-MÀU: nhãn chữ kèm đếm ngược', () => {
    pointsResult = { data: [point({ id: 'AO-01', forced: true, overrideExpiresInS: 251 })], loading: false, error: null }
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText('sắp hết hạn')).toBeInTheDocument()
    expect(within(panel).getByText('04:11')).toBeInTheDocument()
  })

  it('điểm còn nhiều thời gian KHÔNG bị dán nhãn sắp hết hạn', () => {
    pointsResult = { data: [point({ id: 'AO-01', forced: true, overrideExpiresInS: 3600 })], loading: false, error: null }
    renderDashboard()
    expect(within(ownershipPanel()).queryByText('sắp hết hạn')).not.toBeInTheDocument()
  })

  it('mỗi hàng có hai đường đi dùng đúng tham số mà trang đích thật sự đọc', () => {
    pointsResult = { data: [point({ id: 'DO-02', forced: true, overrideExpiresInS: 60 })], loading: false, error: null }
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByRole('link', { name: 'Xem điểm' })).toHaveAttribute('href', '/monitor?point=DO-02')
    expect(within(panel).getByRole('link', { name: 'Xem vết lệnh' })).toHaveAttribute('href', '/activity?objectId=DO-02')
  })

  it('sắp xếp theo mức khẩn: sắp hết hạn lên trên, không TTL xuống cuối', () => {
    pointsResult = {
      data: [
        point({ id: 'DO-09', forced: true }),
        point({ id: 'DO-01', forced: true, overrideExpiresInS: 3000 }),
        point({ id: 'DO-05', forced: true, overrideExpiresInS: 40 })
      ],
      loading: false,
      error: null
    }
    renderDashboard()
    const rows = within(ownershipPanel()).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent?.slice(0, 5))).toEqual(['DO-05', 'DO-01', 'DO-09'])
  })

  it('không có lệnh nào ⇒ nói ra đã đọc được bao nhiêu điểm (kết luận có căn cứ)', () => {
    pointsResult = { data: [point({ id: 'DO-01' }), point({ id: 'DO-02' })], loading: false, error: null }
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText(/Không có lệnh tay nào đang giữ quyền/)).toBeInTheDocument()
    expect(within(panel).getByText(/Đã đọc được 2 điểm/)).toBeInTheDocument()
  })

  it('KHÔNG đọc được bảng điểm phải khác hẳn "không có lệnh nào"', () => {
    // Trình bày "không đọc được" thành "mọi thứ bình thường" trên màn hình bàn
    // giao ca là lỗi an toàn vận hành (cùng họ FE-DATA-01).
    pointsResult = { data: null, loading: false, error: new Error('core unreachable') }
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText(/Không đọc được bảng điểm/)).toBeInTheDocument()
    expect(within(panel).getByText(/Không kết luận được là có hay không có lệnh ép tay/)).toBeInTheDocument()
    expect(within(panel).queryByText(/Không có lệnh tay nào đang giữ quyền/)).not.toBeInTheDocument()
  })

  it('dải tóm tắt đếm tách bạch sắp-hết-hạn và không-có-thời-hạn', () => {
    pointsResult = {
      data: [
        point({ id: 'DO-01', forced: true, overrideExpiresInS: 60 }),
        point({ id: 'DO-02', forced: true, overrideExpiresInS: 7200 }),
        point({ id: 'VP-01', kind: 'virtual', forced: true })
      ],
      loading: false,
      error: null
    }
    renderDashboard()
    const panel = ownershipPanel()
    expect(within(panel).getByText('3 điểm đang bị ép tay')).toBeInTheDocument()
    expect(within(panel).getByText(/1 điểm sắp hết hạn/)).toBeInTheDocument()
    expect(within(panel).getByText(/1 điểm không có thời hạn tự nhả/)).toBeInTheDocument()
  })
})

describe('T57-1.11 — phân hệ có dữ liệu cũ nhất', () => {
  it('chọn đúng phân hệ có observedAt xa nhất, không phải phần tử đầu bảng', () => {
    const now = Date.parse('2026-08-18T07:00:05Z')
    const worst = stalestSubsystem([
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-18T07:00:05Z' },
      { domain: 'modbus', state: 'good', reasonCode: 'ok', source: 'iobus_telemetry', observedAt: '2026-08-18T06:20:05Z' },
      { domain: 'network', state: 'good', reasonCode: 'ok', source: 'kernel', observedAt: '2026-08-18T06:59:05Z' }
    ], now)
    expect(worst?.domain).toBe('modbus')
    expect(worst?.ageMs).toBe(40 * 60 * 1000)
  })

  it('bỏ qua phân hệ không có mốc thời gian thay vì coi nó là cũ vô hạn', () => {
    const now = Date.parse('2026-08-18T07:00:05Z')
    const worst = stalestSubsystem([
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-18T06:59:05Z' },
      { domain: 'historian', state: 'unknown', reasonCode: 'no_logged_points', source: 'policy', observedAt: '' }
    ], now)
    expect(worst?.domain).toBe('controller')
  })

  it('không phân hệ nào có mốc ⇒ null, và giao diện hiện — thay vì ẩn ô', () => {
    expect(stalestSubsystem([
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '' }
    ])).toBeNull()

    overviewData = baseOverview()
    overviewData.health = [{ domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '' }]
    renderDashboard()
    const cell = screen.getByText('Phân hệ cũ nhất').parentElement
    expect(cell).toHaveTextContent('—')
  })

  it('mốc lệch về TƯƠNG LAI cho tuổi 0, không phải một số ÂM', () => {
    // Bo và máy trạm lệch đồng hồ là chuyện thường ở công trường. Không kẹp thì
    // ô này hiện "-10m" — một con số vô nghĩa mà người đọc sẽ diễn giải thành
    // "dữ liệu đến từ tương lai", trong khi sự thật là hai đồng hồ lệch nhau.
    const now = Date.parse('2026-08-18T07:00:05Z')
    const worst = stalestSubsystem([
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-18T07:10:05Z' }
    ], now)
    expect(worst?.ageMs).toBe(0)
    expect(worst?.ageMs).toBeGreaterThanOrEqual(0)
  })

  it('mốc tương lai không thắng phép so "cũ nhất"', () => {
    const now = Date.parse('2026-08-18T07:00:05Z')
    const worst = stalestSubsystem([
      { domain: 'controller', state: 'good', reasonCode: 'ok', source: 'core_shm', observedAt: '2026-08-18T07:10:05Z' },
      { domain: 'modbus', state: 'good', reasonCode: 'ok', source: 'iobus', observedAt: '2026-08-18T06:50:05Z' }
    ], now)
    expect(worst?.domain).toBe('modbus')
  })

  it('hiện tên phân hệ cũ nhất kèm tuổi dữ liệu trên dải trạng thái', () => {
    renderDashboard()
    const cell = screen.getByText('Phân hệ cũ nhất').parentElement
    expect(cell).toHaveTextContent('Modbus RTU')
  })
})
