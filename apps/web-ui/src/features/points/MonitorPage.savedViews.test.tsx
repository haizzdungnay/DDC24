import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { savedViewsStorageKey, setSavedViewAccount } from '../../shared/savedViews'
import type { Point, VirtualPoint } from '../../shared/types'
import { MonitorPage } from './MonitorPage'

/**
 * `T57-2.3` — khung nhìn đặt tên trên trang Giám sát.
 *
 * Ba điều phải đúng, và cả ba đều hỏng âm thầm nếu sai:
 *  1. Lưu rồi mở lại phải ra ĐÚNG bộ lọc đã lưu.
 *  2. `?view=` phải nở thành chính bộ lọc trên thanh địa chỉ, rồi biến mất —
 *     nếu tên khung nhìn ở lại URL thì đường dẫn gửi cho đồng nghiệp sẽ trỏ
 *     tới một khung nhìn chỉ tồn tại trên máy người gửi.
 *  3. `?view=` trỏ tới tên không tồn tại **không được** làm trang kẹt hay hiện
 *     bảng rỗng im lặng — đúng luật của `F-UX-02/03/04`.
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

const points: Point[] = [
  { id: 'UI-01', tag: 'UI-01', name: 'Gió hồi', kind: 'UI', value: 23, unit: 'degC', quality: 'good', source: 'core', updatedAt: new Date().toISOString() },
  { id: 'UI-02', tag: 'UI-02', name: 'Gió cấp', kind: 'UI', value: 18, unit: 'degC', quality: 'bad', source: 'core', updatedAt: new Date().toISOString() }
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

describe('T57-2.3 — khung nhìn đặt tên trên Giám sát', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'vi')
    setSavedViewAccount('admin')
    hookState.points = points
    hookState.virtualPoints = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
    setSavedViewAccount(null)
  })

  it('lưu khung nhìn chụp lại đúng bộ lọc đang xem', async () => {
    const user = userEvent.setup()
    renderAt('?quality=bad&q=gio')

    await user.click(screen.getByRole('button', { name: /Lưu khung nhìn/ }))
    await user.type(screen.getByLabelText('Đặt tên cho bộ lọc đang xem'), 'Điểm lỗi')
    await user.click(screen.getByRole('button', { name: 'Lưu' }))

    const stored = JSON.parse(localStorage.getItem(savedViewsStorageKey('monitor')) ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Điểm lỗi')
    expect(stored[0].params).toMatchObject({ quality: 'bad', q: 'gio' })
  })

  it('chọn khung nhìn trong danh sách áp lại bộ lọc đã lưu', async () => {
    localStorage.setItem(savedViewsStorageKey('monitor'), JSON.stringify([
      { name: 'Chỉ điểm hỏng', params: { quality: 'bad', kind: 'all', q: '', state: 'all', group: 'all' } }
    ]))
    const user = userEvent.setup()
    renderAt()

    await user.selectOptions(screen.getByLabelText('Khung nhìn đã lưu'), 'Chỉ điểm hỏng')

    expect((screen.getByLabelText('Lọc theo chất lượng') as HTMLSelectElement).value).toBe('bad')
  })

  it('`?view=` nở thành bộ lọc rồi tự rời khỏi thanh địa chỉ', async () => {
    localStorage.setItem(savedViewsStorageKey('monitor'), JSON.stringify([
      { name: 'Ép tay', params: { state: 'forced' } }
    ]))
    renderAt('?view=' + encodeURIComponent('Ép tay'))

    await waitFor(() => {
      expect((screen.getByLabelText('Lọc theo trạng thái vận hành') as HTMLSelectElement).value).toBe('forced')
    })
  })

  it('`?view=` trỏ tới tên không tồn tại thì trang vẫn dùng được với bộ lọc mặc định', async () => {
    renderAt('?view=khong-ton-tai')

    await waitFor(() => {
      expect((screen.getByLabelText('Lọc theo chất lượng') as HTMLSelectElement).value).toBe('all')
    })
    expect(screen.getAllByText('UI-01').length).toBeGreaterThan(0)
  })

  it('xoá khung nhìn thì nó biến mất khỏi danh sách chọn', async () => {
    localStorage.setItem(savedViewsStorageKey('monitor'), JSON.stringify([{ name: 'Tạm', params: {} }]))
    const user = userEvent.setup()
    renderAt()

    await user.selectOptions(screen.getByLabelText('Khung nhìn đã lưu'), 'Tạm')
    await user.click(screen.getByRole('button', { name: 'Xoá' }))

    expect(screen.queryByRole('option', { name: 'Tạm' })).toBeNull()
    expect(JSON.parse(localStorage.getItem(savedViewsStorageKey('monitor')) ?? '[]')).toEqual([])
  })
})
