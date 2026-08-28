import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import type { Point } from '../../shared/types'
import { TrendsPage } from './TrendsPage'

/**
 * `F-UX-03` / `T57-0.7` — deep link `/trends?points=<id>`.
 *
 * VÌ SAO TEST NÀY TỪNG KHÔNG TỒN TẠI
 *
 * Bản viết ngày 2026-08-18 **làm treo vitest ngay lúc import `TrendsPage`**, nên
 * nó bị gỡ khỏi repo thay vì để lại một test treo — và `T57-0.7` ở lại mức
 * 0,5/1. Từ đó tới nay `TrendsPage` đã đổi (khung nhìn đặt tên `T57-2.3`, dấu sự
 * kiện `T57-2.6`, tách chunk `T57-4.2`); import lại được xác nhận là không còn
 * treo trước khi viết test này.
 *
 * HÀNH VI ĐANG KHOÁ
 *
 * `MonitorPage` gắn liên kết "Mở trong Trends" trỏ tới `/trends?points=<id>`.
 * Nếu trang này bỏ qua query đó, người dùng bấm vào và rơi vào bộ chọn đã lưu
 * của lần trước — mất đúng điểm họ đang điều tra, tức là mất cả mục đích của
 * liên kết. Gate hợp đồng hiện có chỉ kiểm rằng mã CÓ đọc `searchParams`; test
 * này kiểm điều thực sự quan trọng: **điểm được yêu cầu có lên màn hình không**.
 */

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  getHistory: vi.fn(),
  getAlarmHistory: vi.fn()
}))
const overview = vi.hoisted(() => ({ fetchActivity: vi.fn() }))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))
vi.mock('../../shared/api/overview', () => ({ fetchActivity: overview.fetchActivity }))
vi.mock('../../shared/api/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/api/history')>()
  return {
    ...actual,
    historyClient: {
      query: vi.fn(async () => ({
        from: '2026-08-19T00:00:00.000Z', fromMs: 0, to: '2026-08-19T01:00:00.000Z', toMs: 1,
        complete: true, tiersUsed: ['hot'], series: []
      }))
    }
  }
})
vi.mock('../../shared/realtime', () => ({
  useRealtime: () => ({ allPoints: [], lastPointEventAt: undefined, connectionState: 'connected' })
}))

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

const points: Point[] = [
  { id: 'UI-01', tag: 'UI-01', name: 'Gió hồi', kind: 'UI', value: 23, unit: 'degC', quality: 'good', source: 'core', updatedAt: '2026-08-19T00:00:00Z' },
  { id: 'UI-07', tag: 'UI-07', name: 'Áp suất ống gió', kind: 'UI', value: 120, unit: 'Pa', quality: 'good', source: 'core', updatedAt: '2026-08-19T00:00:00Z' }
]

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/trends${search}`]}>
      <I18nProvider>
        <TrendsPage />
      </I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  api.getPoints.mockResolvedValue(points)
  api.getVirtualPoints.mockResolvedValue([])
  api.getHistory.mockResolvedValue([])
  api.getAlarmHistory.mockResolvedValue([])
  overview.fetchActivity.mockResolvedValue({ items: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('F-UX-03 — deep link ?points= vào trang Xu hướng', () => {
  it('mở với ?points=UI-07 thì ĐÚNG điểm đó lên bộ chọn, không phải bộ mặc định', async () => {
    renderAt('?points=UI-07')

    await waitFor(() => expect(screen.getAllByText('UI-07').length).toBeGreaterThan(0))
    // Bộ mặc định là UI-01..UI-08; deep link phải THẮNG nó, nếu không người dùng
    // mất đúng điểm mình vừa bấm để xem.
    expect(screen.queryAllByText('UI-01')).toHaveLength(0)
  })

  it('nhiều điểm trong một liên kết đều được chọn', async () => {
    renderAt('?points=UI-01,UI-07')

    await waitFor(() => expect(screen.getAllByText('UI-07').length).toBeGreaterThan(0))
    expect(screen.getAllByText('UI-01').length).toBeGreaterThan(0)
  })

  it('id không tồn tại vẫn hiện ra kèm lời giải thích, KHÔNG im lặng bỏ qua', async () => {
    renderAt('?points=UI-99')

    // Điểm không resolve được vẫn phải có thẻ riêng và nói rõ vì sao — bảng rỗng
    // im lặng là đúng lớp lỗi mà F-UX-02/03/04 tồn tại để chặn.
    await waitFor(() => expect(screen.getAllByText('UI-99').length).toBeGreaterThan(0))
    // Trang nói ra ở HAI chỗ (thẻ series và dải trạng thái) — cả hai đều đúng
    // chỗ, nên assert theo số lượng thay vì đòi duy nhất một.
    expect(screen.getAllByText(/không có trong \/points|Không còn trong danh sách điểm/i).length).toBeGreaterThan(0)
  })

  it('bộ chọn đã lưu trong localStorage KHÔNG đè lên điểm vừa được yêu cầu', async () => {
    localStorage.setItem('mkddc:trends:v1', JSON.stringify({ selectedIds: ['UI-01'], rangeMinutes: 30 }))
    renderAt('?points=UI-07')

    await waitFor(() => expect(screen.getAllByText('UI-07').length).toBeGreaterThan(0))
    expect(screen.queryAllByText('UI-01')).toHaveLength(0)
  })
})
