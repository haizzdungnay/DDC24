import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { Point, VirtualPoint } from '../../shared/types'
import { MonitorPage } from './MonitorPage'

/**
 * Thẻ thiết bị công nghệ trên trang Giám sát — `T57-3.1` (`ADR-042`), đường tối
 * thiểu đã chốt cho `T57-4.1`.
 *
 * Khoảng hở mà nó lấp: người vận hành nghĩ bằng **thiết bị** ("AHU-1 đang chạy
 * thế nào?") còn giao diện chỉ nói được bằng **kênh I/O**. Bộ lọc này là bước
 * nhỏ nhất nối được hai cách nghĩ đó mà không cần trình soạn đồ hoạ (Rev B).
 *
 * Hai luật phải khoá: "Chưa gán" là một nhóm THẬT chứ không phải lỗi, và danh
 * sách thiết bị dựng TỪ DỮ LIỆU chứ không đoán theo tên điểm.
 */

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  updatePointConfig: vi.fn(),
  forcePoint: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as VirtualPoint[], refetch: vi.fn() }))

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

const now = new Date().toISOString()
const points: Point[] = [
  { id: 'UI-01', tag: 'UI-01', name: 'Gió hồi AHU-1', kind: 'UI', value: 23, unit: 'degC', quality: 'good', source: 'core', updatedAt: now, equipment: 'AHU-1' },
  { id: 'UI-02', tag: 'UI-02', name: 'Gió cấp AHU-1', kind: 'UI', value: 18, unit: 'degC', quality: 'good', source: 'core', updatedAt: now, equipment: 'AHU-1' },
  { id: 'UI-03', tag: 'UI-03', name: 'Phòng 305', kind: 'UI', value: 25, unit: 'degC', quality: 'good', source: 'core', updatedAt: now, equipment: 'FCU-03' },
  { id: 'UI-04', tag: 'UI-04', name: 'Chưa gắn thẻ', kind: 'UI', value: 21, unit: 'degC', quality: 'good', source: 'core', updatedAt: now }
]

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/monitor${search}`]}>
      <I18nProvider>
        <ToastProvider>
          <MonitorPage />
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  hookState.points = points
  hookState.virtualPoints = []
  api.updatePointConfig.mockResolvedValue({ id: 'UI-01' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('T57-3.1 / T57-4.1 — nhóm điểm theo thiết bị công nghệ', () => {
  it('danh sách thiết bị dựng từ chính các thẻ đang gắn trên điểm', () => {
    renderAt()
    const select = screen.getByLabelText('Lọc theo thiết bị công nghệ')
    expect(select).toHaveTextContent('AHU-1')
    expect(select).toHaveTextContent('FCU-03')
    // Không có thẻ nào tên "Phòng 305" dù có điểm tên như vậy — cấm đoán từ tên.
    expect(select).not.toHaveTextContent('Phòng 305')
  })

  it('chọn một thiết bị thì chỉ còn điểm của thiết bị đó', async () => {
    const user = userEvent.setup()
    renderAt()

    await user.selectOptions(screen.getByLabelText('Lọc theo thiết bị công nghệ'), 'AHU-1')

    /* Điểm mốc là những điểm KHÔNG phải điểm đang chọn: điểm đang chọn còn hiện
       ở khung chi tiết bên phải nên sự có mặt của nó không nói gì về bộ lọc. */
    await waitFor(() => expect(screen.queryAllByText('Phòng 305')).toHaveLength(0))
    expect(screen.queryAllByText('Chưa gắn thẻ')).toHaveLength(0)
    expect(screen.queryAllByText('Gió cấp AHU-1').length).toBeGreaterThan(0)
  })

  it('"Chưa gán" là một nhóm xem được, không phải trạng thái lỗi', async () => {
    const user = userEvent.setup()
    renderAt()

    const select = screen.getByLabelText('Lọc theo thiết bị công nghệ')
    expect(select).toHaveTextContent('Chưa gán (1)')
    await user.selectOptions(select, '__unassigned__')

    await waitFor(() => expect(screen.queryAllByText('Phòng 305')).toHaveLength(0))
    expect(screen.queryAllByText('Gió cấp AHU-1')).toHaveLength(0)
    expect(screen.queryAllByText('Chưa gắn thẻ').length).toBeGreaterThan(0)
  })

  it('bộ lọc thiết bị nằm trong URL nên gửi được cho đồng nghiệp', async () => {
    renderAt('?equip=FCU-03')
    await waitFor(() => expect(screen.queryAllByText('Chưa gắn thẻ')).toHaveLength(0))
    expect(screen.queryAllByText('Gió cấp AHU-1')).toHaveLength(0)
    expect(screen.queryAllByText('Phòng 305').length).toBeGreaterThan(0)
  })
})
