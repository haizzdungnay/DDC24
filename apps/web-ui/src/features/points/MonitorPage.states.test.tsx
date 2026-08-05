import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

/* Trạng thái của `useApi` cho đường `/points`; đường `/virtual-points` luôn OK
 * để test cô lập đúng nhánh đang xét. */
const pointsState = vi.hoisted(() => ({
  data: null as Point[] | null,
  loading: false,
  error: null as Error | null,
  refetch: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({
  POINT_UNIT_OPTIONS: [{ value: '', label: 'None' }],
  aiUnitFromPointUnit: () => 0,
  pointUnitFromAiUnit: () => '',
  apiClient: api
}))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (loader: unknown) => loader === api.getVirtualPoints
    ? { data: [], loading: false, error: null, refetch: vi.fn() }
    : pointsState
}))
vi.mock('../../shared/realtime', () => ({
  useRealtime: () => ({ allPoints: [], lastPointEventAt: undefined, connectionState: 'connected', forcePoint: vi.fn() })
}))
vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'admin', role: 'admin', loginAt: '2026-08-05T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
  }
})

const goodPoint: Point = {
  id: 'UI-01', tag: 'UI-01', name: 'Room', kind: 'UI', value: 23, unit: 'degC', quality: 'good',
  source: 'core', updatedAt: '2026-08-05T00:00:00Z'
}
const badPoint: Point = { ...goodPoint, id: 'UI-02', tag: 'UI-02', name: 'Duct', quality: 'bad' }
const secondGoodPoint: Point = { ...goodPoint, id: 'UI-03', tag: 'UI-03', name: 'Return' }

function renderPage() {
  return render(<I18nProvider><ToastProvider><MonitorPage /></ToastProvider></I18nProvider>)
}

/* FE-DATA-01 (review FE 2026-08-05). Khi mọi endpoint trả 502, trang này từng
 * render đầy đủ và khẳng định "0 điểm / 0% lỗi / 100% bình thường" — trình bày
 * "không đọc được" thành "mọi thứ bình thường" trên một màn hình giám sát DDC. */
describe('MonitorPage — trạng thái khi authority không trả lời', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    pointsState.data = null
    pointsState.loading = false
    pointsState.error = null
    pointsState.refetch = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('chưa từng đọc được thì báo lỗi kèm Retry, không hiện thẻ số đo', () => {
    pointsState.error = new Error('502 Bad Gateway')
    renderPage()
    expect(screen.getByText('Could not load I/O points')).toBeInTheDocument()
    expect(screen.getByText('502 Bad Gateway')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    /* Không được có thẻ nào khẳng định tình trạng điểm. */
    expect(screen.queryByText('Normal UI/AO points')).not.toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  it('đang tải lần đầu thì hiện trạng thái tải, không hiện số đo rỗng', () => {
    pointsState.loading = true
    renderPage()
    expect(screen.getByText('Loading I/O points')).toBeInTheDocument()
    expect(screen.queryByText('Total points')).not.toBeInTheDocument()
  })

  /* Hỏng giữa chừng KHÔNG được xoá màn hình của ca trực: giữ lần đọc gần nhất
   * nhưng phải nói rõ số đang xem là số cũ. */
  it('hỏng sau khi đã có dữ liệu thì giữ bảng và cảnh báo số đo là lần đọc cũ', () => {
    pointsState.data = [goodPoint, badPoint]
    pointsState.error = new Error('502 Bad Gateway')
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Authority unreachable')
    expect(screen.getByText('Total points')).toBeInTheDocument()
  })

  /* Thẻ "Normal UI/AO points" từng gán cứng detail="100%", nên luôn khẳng định
   * mọi điểm analog bình thường kể cả khi một nửa đang lỗi. */
  it('tỉ lệ điểm bình thường tính thật, không gán cứng 100%', () => {
    pointsState.data = [goodPoint, secondGoodPoint, badPoint]
    renderPage()
    // 2/3 điểm analog good ⇒ 67%; 1/3 điểm bất thường ⇒ 33%. Bản gán cứng
    // detail="100%" không bao giờ in ra được "67%".
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('33%')).toBeInTheDocument()
  })

  it('không có điểm nào thì tỉ lệ là — chứ không phải 100%', () => {
    pointsState.data = []
    renderPage()
    expect(screen.getByText('Normal UI/AO points')).toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
