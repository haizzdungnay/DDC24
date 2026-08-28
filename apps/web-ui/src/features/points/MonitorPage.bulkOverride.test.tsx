import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { Point, UserRole } from '../../shared/types'
import { MonitorPage } from './MonitorPage'

/**
 * Test khoá HÀNH VI cho cột "Còn lại" (`T57-1.3`) và ép tay hàng loạt
 * (`T57-1.4`) ở tầng giao diện.
 *
 * Logic thuần đã khoá ở `bulkOverride.test.ts`; tệp này khoá những thứ chỉ hỏng
 * được ở tầng DOM: cột TTL hiện đúng ba trạng thái, ô chọn tôn trọng vai trò,
 * và nút Áp dụng thật sự bị chặn cho tới khi tick ô xác nhận.
 */

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  updatePointConfig: vi.fn(),
  forcePoint: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as Point[], refetch: vi.fn() }))
const authState = vi.hoisted(() => ({ role: 'operator' as UserRole }))
const rt = vi.hoisted(() => ({ forcePoint: vi.fn() }))

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
  useRealtime: () => ({ allPoints: [], lastPointEventAt: undefined, connectionState: 'connected', forcePoint: rt.forcePoint })
}))
vi.mock('../../shared/api/history', () => ({
  createHistoryClient: () => ({ query: () => Promise.resolve({ series: [] }) })
}))
vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'op1', role: authState.role, loginAt: '2026-08-18T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
  }
})

function point(over: Partial<Point> & Pick<Point, 'id' | 'kind'>): Point {
  return {
    tag: over.id, name: `Điểm ${over.id}`, value: 0, quality: 'good', source: 'core',
    updatedAt: '2026-08-18T03:00:00Z', ...over
  } as Point
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/monitor']}>
      <I18nProvider><ToastProvider><MonitorPage /></ToastProvider></I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  hookState.points = []
  hookState.virtualPoints = []
  authState.role = 'operator'
  api.forcePoint.mockReset()
  api.forcePoint.mockResolvedValue({})
  rt.forcePoint.mockReset()
  // Trả `false` để `forcePointWithDuration` rơi xuống nhánh REST — nhánh có
  // thể quan sát được kết quả và lỗi từng điểm.
  rt.forcePoint.mockReturnValue(false)
})
afterEach(cleanup)

describe('T57-1.3 — cột "Còn lại" trên bảng Monitor', () => {
  it('điểm đang ép tay hiện đếm ngược mm:ss ngay trên bảng', () => {
    hookState.points = [point({ id: 'DO-01', kind: 'DO', value: true, forced: true, overrideExpiresInS: 1104 })]
    renderPage()
    expect(screen.getByText('18:24')).toBeInTheDocument()
  })

  it('điểm ép tay KHÔNG có TTL hiện "không có thời hạn", không phải 00:00', () => {
    hookState.points = [point({ id: 'AO-01', kind: 'AO', value: 40, forced: true })]
    renderPage()
    expect(screen.getByText('không có thời hạn')).toBeInTheDocument()
    expect(screen.queryByText('00:00')).not.toBeInTheDocument()
  })

  it('sắp hết hạn có nhãn CHỮ kèm theo, không chỉ đổi màu (WCAG 1.4.1)', () => {
    hookState.points = [point({ id: 'AO-01', kind: 'AO', value: 40, forced: true, overrideExpiresInS: 251 })]
    renderPage()
    expect(screen.getByText('sắp hết hạn')).toBeInTheDocument()
    expect(screen.getByText('04:11')).toBeInTheDocument()
  })

  it('điểm KHÔNG bị ép tay để trống ô này, không hiện — (tránh 26 dấu — che 3 số)', () => {
    hookState.points = [point({ id: 'DO-01', kind: 'DO', value: false })]
    renderPage()
    expect(screen.queryByText('không có thời hạn')).not.toBeInTheDocument()
  })
})

describe('T57-1.4 — chọn điểm và thanh hành động', () => {
  it('viewer KHÔNG thấy cột chọn — không mời vào một lệnh ghi họ không được phép', () => {
    authState.role = 'viewer'
    hookState.points = [point({ id: 'DO-01', kind: 'DO', value: false })]
    renderPage()
    expect(screen.queryByRole('checkbox', { name: /ép tay hàng loạt/ })).not.toBeInTheDocument()
  })

  it('operator thấy ô chọn, và ô của điểm đọc-vào bị VÔ HIỆU kèm lý do', () => {
    hookState.points = [
      point({ id: 'DO-01', kind: 'DO', value: false }),
      point({ id: 'UI-01', kind: 'UI', value: 23.5, signalType: 'analog' })
    ]
    renderPage()
    expect(screen.getByRole('checkbox', { name: /DO-01.*ép tay hàng loạt/ })).toBeEnabled()
    const readOnly = screen.getByRole('checkbox', { name: /UI-01.*ép tay hàng loạt/ })
    expect(readOnly).toBeDisabled()
    expect(readOnly).toHaveAttribute('title', 'Điểm này không ép tay được')
  })

  it('thanh hành động chỉ xuất hiện SAU khi chọn, không nằm sẵn cạnh bộ lọc', async () => {
    const user = userEvent.setup()
    hookState.points = [point({ id: 'DO-01', kind: 'DO', value: false })]
    renderPage()
    expect(screen.queryByRole('region', { name: 'Thao tác hàng loạt' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /DO-01.*ép tay hàng loạt/ }))
    expect(screen.getByRole('region', { name: 'Thao tác hàng loạt' })).toBeInTheDocument()
    expect(screen.getByText('Đã chọn 1 điểm ghi được')).toBeInTheDocument()
  })

  it('"Bỏ chọn tất cả" xoá lựa chọn và ẩn lại thanh hành động', async () => {
    const user = userEvent.setup()
    hookState.points = [point({ id: 'DO-01', kind: 'DO', value: false })]
    renderPage()
    await user.click(screen.getByRole('checkbox', { name: /DO-01.*ép tay hàng loạt/ }))
    await user.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }))
    expect(screen.queryByRole('region', { name: 'Thao tác hàng loạt' })).not.toBeInTheDocument()
  })
})

describe('T57-1.4 — hộp thoại ép tay hàng loạt', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: /DO-01.*ép tay hàng loạt/ }))
    await user.click(screen.getByRole('checkbox', { name: /AO-01.*ép tay hàng loạt/ }))
    await user.click(screen.getByRole('button', { name: /Ép tay 2 điểm/ }))
    return screen.getByRole('dialog')
  }

  beforeEach(() => {
    hookState.points = [
      point({ id: 'DO-01', kind: 'DO', value: false }),
      point({ id: 'AO-01', kind: 'AO', value: 12.5, unit: '%' })
    ]
  })

  it('MỘT hộp thoại liệt kê từng điểm với giá trị hiện tại → giá trị mới', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)
    expect(within(dialog).getAllByRole('row')).toHaveLength(3) // header + 2 điểm
    const rows = within(dialog).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('AO-01')
    expect(rows[1]).toHaveTextContent('12.5')
    expect(rows[2]).toHaveTextContent('DO-01')
  })

  it('nút Áp dụng bị CHẶN cho tới khi tick ô xác nhận — ma sát cố ý', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)
    const apply = within(dialog).getByRole('button', { name: /Áp dụng cho 2 điểm/ })
    expect(apply).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /chịu trách nhiệm/ }))
    expect(apply).toBeEnabled()
  })

  it('MỘT thời hạn dùng chung đi vào TẤT CẢ lệnh, không phải mỗi điểm một hạn', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)
    const duration = within(dialog).getByRole('spinbutton', { name: /Thời hạn dùng chung/ })
    await user.clear(duration)
    await user.type(duration, '15')
    await user.click(within(dialog).getByRole('checkbox', { name: /chịu trách nhiệm/ }))
    await user.click(within(dialog).getByRole('button', { name: /Áp dụng cho 2 điểm/ }))

    await waitFor(() => expect(api.forcePoint).toHaveBeenCalledTimes(2))
    // Chữ ký: forcePoint(id, value, release, ttlS)
    expect(api.forcePoint.mock.calls.map((call) => call[3])).toEqual([900, 900])
  })

  it('một điểm hỏng KHÔNG làm chìm điểm đã ép — báo kết quả từng điểm', async () => {
    const user = userEvent.setup()
    api.forcePoint.mockImplementation(async (id: string) => {
      if (id === 'AO-01') throw new Error('403 forbidden')
      return {}
    })
    renderPage()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: /chịu trách nhiệm/ }))
    await user.click(within(dialog).getByRole('button', { name: /Áp dụng cho 2 điểm/ }))

    await waitFor(() => expect(screen.getByText('THẤT BẠI')).toBeInTheDocument())
    expect(screen.getByText('ĐÃ ÉP')).toBeInTheDocument()
    // Lỗi giữ NGUYÊN VĂN từ backend.
    expect(screen.getByText('403 forbidden')).toBeInTheDocument()
    // Cả hai điểm đều được thử, không dừng ở điểm hỏng.
    expect(api.forcePoint).toHaveBeenCalledTimes(2)
  })

  it('sau khi xong, nói rõ điểm đã ép VẪN đang giữ quyền và đóng hộp thoại không nhả chúng', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: /chịu trách nhiệm/ }))
    await user.click(within(dialog).getByRole('button', { name: /Áp dụng cho 2 điểm/ }))
    await waitFor(() => expect(screen.getByText(/vẫn đang giữ quyền điều khiển/)).toBeInTheDocument())
    expect(screen.getByText(/Đóng hộp thoại này KHÔNG nhả chúng/)).toBeInTheDocument()
  })

  it('giá trị analog không hợp lệ chặn nút Áp dụng và nói ra lỗi', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: /chịu trách nhiệm/ }))
    const analog = within(dialog).getByRole('spinbutton', { name: /Giá trị mới cho nhóm analog/ })
    await user.clear(analog)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Giá trị analog phải là một số')
    expect(within(dialog).getByRole('button', { name: /Áp dụng cho 2 điểm/ })).toBeDisabled()
  })
})
