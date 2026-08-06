import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realtimeState = vi.hoisted(() => ({ allPoints: [], lastPointEventAt: null }))
const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('../../shared/config', () => ({
  API_ORIGIN: 'https://device.test',
  HISTORIAN_V2_TRENDS_ENABLED: true,
  IS_DEMO: false
}))

vi.mock('../../shared/api/history', async () => {
  const actual = await vi.importActual<typeof import('../../shared/api/history')>('../../shared/api/history')
  return {
    ...actual,
    historyClient: actual.createHistoryClient({ baseUrl: 'https://device.test/api/v1', fetchImpl: fetchMock })
  }
})

/* Đúng cảnh trên board DDC-24-TANG-1: `/points` trả 200 kèm mảng RỖNG trong khi
 * historian vẫn còn lịch sử của DO-01. */
vi.mock('../../shared/api/client', () => ({
  apiClient: {
    getPoints: vi.fn().mockResolvedValue([]),
    getVirtualPoints: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../../shared/i18n', () => ({
  useI18n: () => ({ pick: (_vi: string, en: string) => en })
}))

vi.mock('../../shared/realtime', () => ({
  useRealtime: () => realtimeState
}))

fetchMock.mockImplementation(async () => new Response(JSON.stringify({
  from: '2026-08-05T00:00:00Z',
  to: '2026-08-06T00:00:00Z',
  complete: true,
  series: [{ pointId: 'DO-01', generation: 1, effectiveResolution: '15s', samples: [] }],
  gaps: [],
  tiersUsed: ['cache']
}), { status: 200, headers: { 'content-type': 'application/json' } }))

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

import { TrendsPage } from './TrendsPage'

/* FE-TR-01 (board thật 2026-08-06).
 *
 * Panel "Series" lọc `selectedIds` qua `/points`, còn truy vấn historian dùng
 * thẳng `selectedIds`. Khi `/points` rỗng mà historian còn dữ liệu, trang đồng
 * thời nói "No trend points selected" VÀ vẽ 4 series DO-01..DO-04, liệt kê
 * chúng ở bảng thống kê là ON. Người dùng không xoá được (không có thẻ series)
 * mà cũng không thêm được (picker rỗng): trang tự mâu thuẫn và bị kẹt. */
describe('TrendsPage — series còn trong prefs nhưng không còn trong /points', () => {
  beforeEach(() => {
    window.localStorage.setItem('mkddc:trends:v1', JSON.stringify({ selectedIds: ['DO-01'], rangeMinutes: 1440 }))
  })

  afterEach(() => {
    cleanup()
    fetchMock.mockClear()
    window.localStorage.clear()
  })

  it('không nói "chưa chọn điểm" khi vẫn còn id đang được vẽ', async () => {
    render(<TrendsPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('No trend points selected.')).not.toBeInTheDocument()
  })

  it('hiện thẻ riêng cho id không resolve được, kèm lý do', async () => {
    render(<TrendsPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // 'DO-01' còn xuất hiện ở nhãn series của biểu đồ và bảng thống kê.
    expect(screen.getAllByText('DO-01').length).toBeGreaterThan(0)
    expect(screen.getByText('No longer in the authority point list')).toBeInTheDocument()
    expect(screen.getByText(/plotted series are missing from \/points/)).toBeInTheDocument()
  })

  it('vẫn gỡ được id mồ côi để thoát khỏi trạng thái kẹt', async () => {
    const user = userEvent.setup()
    render(<TrendsPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('No trend points selected.')).toBeInTheDocument()
    expect(screen.queryByText('No longer in the authority point list')).not.toBeInTheDocument()
  })

  /* FE-TR-02: ô chọn nhận giờ địa phương còn bảng/biểu đồ hiển thị UTC. Chênh
   * lệch phải được nói ra ngay tại chỗ nhập, không để người dùng tự đoán. */
  it('nói rõ ô chọn dùng giờ địa phương còn phần hiển thị dùng UTC', async () => {
    render(<TrendsPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText(/pickers take local time .* the chart and table below are shown in UTC/)).toBeInTheDocument()
  })
})
