import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { Point } from '../../shared/types'
import { MonitorPage } from './MonitorPage'

/**
 * Khoá hồi quy cho các finding đã sửa trong `REV-FE-UIUX-UC-2026-08-18`.
 * `T57-0.5` / `T57-0.6` của Plan 57.
 *
 * VÌ SAO CẦN RIÊNG MỘT TỆP
 *
 * Mười một finding của phiên review được sửa khi bộ test hiện có đã xanh, nên
 * **không test nào trong 692 test đó thất bại nếu ai đó hoàn nguyên bản sửa**.
 * Một bản vá không có test khoá là một bản vá đang chờ bị refactor xoá mất —
 * và ba trong số các finding này (nút gạt không dùng được bằng bàn phím, vùng
 * bấm ẩn mở lệnh ép tay, sparkline vẽ số 0 giả) đã từng tồn tại nhiều tháng
 * mà không bộ test nào thấy.
 *
 * Mỗi `it` dưới đây tái hiện đúng triệu chứng cũ, để khi đỏ thì thông điệp nói
 * thẳng ra finding nào vừa quay lại.
 */

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
vi.mock('../../shared/api/history', () => ({
  createHistoryClient: () => ({ query: () => Promise.resolve({ series: [] }) })
}))
vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'admin', role: 'admin', loginAt: '2026-08-01T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
  }
})

function point(overrides: Partial<Point> & Pick<Point, 'id' | 'kind'>): Point {
  return {
    tag: overrides.id,
    name: `Điểm ${overrides.id}`,
    value: 0,
    quality: 'good',
    source: 'core',
    updatedAt: '2026-08-18T03:00:00Z',
    ...overrides
  } as Point
}

function renderPage(initialEntries: string[] = ['/monitor']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider><ToastProvider><MonitorPage /></ToastProvider></I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  hookState.points = []
  hookState.virtualPoints = []
  api.forcePoint.mockReset()
})
afterEach(cleanup)

describe('F-UX-05 — nút gạt DO phải dùng được bằng bàn phím', () => {
  beforeEach(() => {
    hookState.points = [point({ id: 'DO-01', kind: 'DO', value: false })]
  })

  it('là một <button role="switch"> thật, KHÔNG phải <span> lồng trong <button>', () => {
    renderPage()
    const toggle = screen.getByRole('switch', { name: /DO-01/ })
    expect(toggle.tagName, 'nút gạt phải là <button>; <span role="switch"> lồng trong <button> là HTML không hợp lệ (WCAG 4.1.2)').toBe('BUTTON')
    expect(toggle.closest('button')).toBe(toggle)
  })

  it('bấm Space/Enter khi đang có tiêu điểm thì mở hộp thoại ép tay (WCAG 2.1.1)', async () => {
    const user = userEvent.setup()
    renderPage()
    const toggle = screen.getByRole('switch', { name: /DO-01/ })
    toggle.focus()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog'), 'Enter trên nút gạt không làm gì — đúng triệu chứng F-UX-05').toBeInTheDocument()
  })

  it('nhãn của nút gạt nói ra điểm nào bị tác động', () => {
    renderPage()
    expect(screen.getByRole('switch', { name: /DO-01/ })).toHaveAccessibleName(/DO-01/)
  })
})

describe('F-UX-06 — lệnh ép tay phải đi qua nút CÓ NHÃN, không phải ô biểu đồ ẩn', () => {
  it('hàng AO có nút hành động đọc được', async () => {
    hookState.points = [point({ id: 'AO-01', kind: 'AO', value: 12.5, unit: 'V' })]
    const user = userEvent.setup()
    renderPage()

    const action = screen.getByRole('button', { name: /Ép tay|Override/ })
    await user.click(action)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  /* Bổ sung sau kiểm tra độc lập (B-02): bản đầu của `it` phía trên mang tên
     "…và ô Trend không còn là vùng bấm" nhưng KHÔNG assert gì về ô sparkline.
     Kiểm tra viên trả lại `onClick` ẩn trên ô đó và cả 729 test vẫn xanh — tức
     tên test hứa một điều mà nội dung không kiểm. */
  /* Phải kiểm bằng HÀNH VI, không bằng thuộc tính DOM: React gắn handler qua
     synthetic event nên `getAttribute('onclick')` luôn `null` — một assert như
     vậy xanh vĩnh viễn kể cả khi handler ẩn quay lại. Bản đầu của test này mắc
     đúng lỗi đó và tự chạy mutant mới lộ ra. */
  it('bấm vào ô Trend KHÔNG mở hộp thoại ép tay', async () => {
    hookState.points = [point({ id: 'AO-01', kind: 'AO', value: 12.5, unit: 'V' })]
    const user = userEvent.setup()
    const { container } = renderPage()

    const svg = container.querySelector('svg[viewBox="0 0 80 28"]')
    expect(svg, 'không tìm thấy sparkline để kiểm').toBeTruthy()
    await user.click(svg!.parentElement!)

    expect(
      screen.queryByRole('dialog'),
      'ô biểu đồ vẫn là vùng bấm ẩn mở lệnh ghi ra cơ cấu chấp hành — F-UX-06 quay lại'
    ).not.toBeInTheDocument()
  })

  it('VP chỉ đọc (`writable: false`) KHÔNG được bày nút Ghi', () => {
    hookState.points = [point({ id: 'VP-09', kind: 'virtual', value: 1, writable: false } as Partial<Point> & Pick<Point, 'id' | 'kind'>)]
    hookState.virtualPoints = [{ id: 'VP-09', tag: 'VP-09', name: 'Chỉ đọc', enabled: true, value: 1, writable: false } as never]
    renderPage()
    expect(
      screen.queryByRole('button', { name: /^Ghi$|^Write$/ }),
      'bảng mời ghi trong khi khung chi tiết cùng điểm từ chối — mâu thuẫn N-05'
    ).not.toBeInTheDocument()
  })
})

describe('F-UX-09 — điểm chưa có số đo không được điền sẵn chuỗi "null"', () => {
  it('ô Giá trị mới của hộp thoại ép tay để TRỐNG', async () => {
    hookState.points = [point({ id: 'AO-03', kind: 'AO', value: undefined as unknown as number, unit: 'V' })]
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Ép tay|Override/ }))

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText(/Giá trị mới|New value/)
    expect(input).toHaveValue('')
    expect((input as HTMLInputElement).value).not.toBe('null')
  })
})

describe('F-UX-10 — nút gạt trend chỉ hiện khi đang sửa, và Hủy hoàn nguyên', () => {
  beforeEach(() => {
    hookState.points = [point({ id: 'UI-05', kind: 'UI', value: 21.4, signalType: 'float' } as Partial<Point> & Pick<Point, 'id' | 'kind'>)]
  })

  it('chế độ xem chỉ ĐỌC trạng thái, không có nút gạt bấm nhầm được', () => {
    renderPage()
    expect(screen.queryByRole('switch', { name: /trend/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Đang tắt|^Off$/)).toBeInTheDocument()
  })

  it('bấm bút chì mới hiện nút gạt kèm Lưu/Hủy; Hủy hoàn nguyên trạng thái', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Sửa cài đặt trend|Edit trend settings/ }))

    const toggle = screen.getByRole('switch', { name: /trend/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: /^Hủy$|^Cancel$/ }))
    // Hủy phải trả nút gạt về giá trị đã lưu, không để lại trạng thái hiển thị sai.
    expect(screen.getByText(/Đang tắt|^Off$/)).toBeInTheDocument()
  })

  /* Đường đi mà bản test đầu BỎ SÓT (phát hiện khi tự chạy mutant): lỗi
     `?? true` chỉ lộ ra khi người dùng bấm **Lưu mà KHÔNG chạm nút gạt**. Bấm
     gạt rồi Hủy không đi qua nhánh mặc định, nên mutant sống sót. */
  it('bấm Lưu mà không chạm nút gạt thì GIỮ nguyên trạng thái đã lưu, không tự bật', async () => {
    const user = userEvent.setup()
    api.updatePointConfig.mockResolvedValue(undefined)
    renderPage()
    await user.click(screen.getByRole('button', { name: /Sửa cài đặt trend|Edit trend settings/ }))
    await user.click(screen.getByRole('button', { name: /^Lưu$|^Save$/ }))

    expect(api.updatePointConfig).toHaveBeenCalledWith('UI-05', { trendEnabled: false })
  })
})

describe('F-UX-07 — sparkline không được bịa đường 0 cho điểm chưa có số đo', () => {
  it('điểm không có giá trị số thì KHÔNG render polyline', () => {
    hookState.points = [point({ id: 'AO-02', kind: 'AO', value: undefined as unknown as number })]
    const { container } = renderPage()
    expect(
      container.querySelectorAll('polyline').length,
      'vẽ một đường nằm ngang ở mức 0 cho điểm chưa từng đo được là bịa số đo (F-UX-07)'
    ).toBe(0)
  })
})

describe('F-UX-08 — quality `uncertain` không được mang mức severity', () => {
  it('hiện UNCERTAIN, tuyệt đối không phải "Lỗi - HIGH"', () => {
    hookState.points = [point({ id: 'UI-01', kind: 'UI', value: 23.5, quality: 'uncertain', signalType: 'float' } as Partial<Point> & Pick<Point, 'id' | 'kind'>)]
    renderPage()
    expect(screen.getAllByText('UNCERTAIN').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Lỗi - HIGH/)).not.toBeInTheDocument()
    expect(screen.queryByText(/HIGH/)).not.toBeInTheDocument()
  })
})

describe('F-UX-11 — "Điểm ON" chỉ đếm điểm nhị phân', () => {
  it('cảm biến analog khác 0 KHÔNG bị tính là ON', () => {
    hookState.points = [
      point({ id: 'UI-01', kind: 'UI', value: 23.5, signalType: 'float' } as Partial<Point> & Pick<Point, 'id' | 'kind'>),
      point({ id: 'UI-02', kind: 'UI', value: 19.2, signalType: 'float' } as Partial<Point> & Pick<Point, 'id' | 'kind'>),
      point({ id: 'DO-01', kind: 'DO', value: true }),
      point({ id: 'DO-02', kind: 'DO', value: false })
    ]
    renderPage()
    /* `StatCard` dựng nhãn, giá trị và chi tiết thành ba `<div>` anh em trong
       một thẻ; `closest('div')` chỉ trả về chính div của nhãn, nên phải lên
       một cấp mới lấy được cả thẻ. */
    const card = screen.getByText(/Điểm nhị phân đang ON|Binary points ON/).parentElement!
    // 1 trong 2 điểm nhị phân đang ON — hai cảm biến nhiệt độ KHÔNG được tính.
    expect(within(card).getByText('1')).toBeInTheDocument()
    expect(within(card).getByText(/1\/2/)).toBeInTheDocument()
  })
})

describe('F-UX-04 — deep link ?group= từ Health Strip phải lọc thật', () => {
  it('group=virtual chỉ giữ lại điểm ảo', () => {
    hookState.points = [
      point({ id: 'UI-01', kind: 'UI', value: 23.5 }),
      point({ id: 'VP-01', kind: 'virtual', value: 1, writable: true } as Partial<Point> & Pick<Point, 'id' | 'kind'>)
    ]
    hookState.virtualPoints = [{ id: 'VP-01', tag: 'VP-01', name: 'Điểm ảo 1', enabled: true, value: 1, writable: true } as never]
    renderPage(['/monitor?group=virtual'])
    /* Khẳng định trên chính BẢNG, không trên cả tài liệu: khung "Chi tiết
       điểm" bên phải cố ý luôn hiển thị một điểm kể cả khi bộ lọc loại nó khỏi
       bảng, nên `queryByText('UI-01')` toàn trang sẽ bắt nhầm khung đó. */
    expect(
      screen.getByText(/UI - UNIVERSAL INPUT \(0\)/),
      'group=virtual vẫn còn điểm UI trong bảng — bộ lọc không được nối (F-UX-04)'
    ).toBeInTheDocument()
    expect(screen.getByText(/VIRTUAL POINTS \(1\)/)).toBeInTheDocument()
  })
})
