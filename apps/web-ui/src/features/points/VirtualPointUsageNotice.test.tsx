import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { VirtualPointUsageNotice } from './VirtualPointUsageNotice'

/**
 * `T57-3.12` — "ai đang dùng điểm ảo này" trước khi xoá.
 *
 * Ba trạng thái đều phải nói ĐÚNG một điều khác nhau, và cả ba đều dẫn tới một
 * quyết định xoá hay không xoá:
 *  · có nơi dùng ⇒ liệt kê ra;
 *  · không có nơi nào dùng ⇒ nói kèm PHẠM VI đã quét;
 *  · tra cứu hỏng ⇒ nói là **không biết**, tuyệt đối không im lặng — im lặng bị
 *    đọc thành "không có gì dùng nó".
 */

const api = vi.hoisted(() => ({ getVirtualPointUsage: vi.fn() }))
vi.mock('../../shared/api/client', () => ({ apiClient: api }))

function renderNotice(pointId: string | null) {
  return render(<I18nProvider><VirtualPointUsageNotice pointId={pointId} /></I18nProvider>)
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  api.getVirtualPointUsage.mockReset()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('T57-3.12 — khối tra cứu nơi dùng điểm ảo', () => {
  it('liệt kê từng nơi đang dùng, kèm loại và tên', async () => {
    api.getVirtualPointUsage.mockResolvedValue({
      pointId: 'VP1',
      references: [
        { kind: 'alarm', id: 'ALM-014', name: 'Nhiệt độ cao', detail: 'nguồn kích hoạt' },
        { kind: 'schedule', id: 'SCH-2', name: 'Lịch AHU-1', detail: 'đối tượng đích' }
      ],
      scanned: ['alarm-settings', 'schedules'],
      incomplete: false
    })

    renderNotice('VP1')

    expect(await screen.findByText(/2 nơi đang dùng điểm này/)).toBeInTheDocument()
    expect(screen.getByText('ALM-014')).toBeInTheDocument()
    expect(screen.getByText('SCH-2')).toBeInTheDocument()
    expect(screen.getByText(/mất nguồn\/đích/)).toBeInTheDocument()
  })

  it('không có nơi nào dùng ⇒ nói rõ ĐÃ QUÉT những gì', async () => {
    api.getVirtualPointUsage.mockResolvedValue({
      pointId: 'VP9', references: [], scanned: ['alarm-settings', 'schedules'], incomplete: false
    })

    renderNotice('VP9')

    const text = await screen.findByText(/Không có cảnh báo hay lịch vận hành nào/)
    expect(text).toHaveTextContent('alarm-settings')
    expect(text).toHaveTextContent('schedules')
  })

  it('nguồn đọc hỏng ⇒ nói danh sách chưa đầy đủ, không khẳng định là an toàn', async () => {
    api.getVirtualPointUsage.mockResolvedValue({
      pointId: 'VP9', references: [], scanned: ['alarm-settings'], incomplete: true
    })

    renderNotice('VP9')
    expect(await screen.findByText(/chưa đầy đủ/)).toBeInTheDocument()
  })

  it('tra cứu hỏng hẳn ⇒ nói là KHÔNG BIẾT hậu quả, không im lặng', async () => {
    api.getVirtualPointUsage.mockRejectedValue(new Error('network down'))
    renderNotice('VP1')
    expect(await screen.findByRole('status')).toHaveTextContent(/Không tra cứu được/)
  })

  it('lỗi đồng bộ của client không được làm trắng hộp thoại xoá', async () => {
    api.getVirtualPointUsage.mockImplementation(() => { throw new TypeError('not a function') })
    renderNotice('VP1')
    expect(await screen.findByRole('status')).toHaveTextContent(/Không tra cứu được/)
  })

  it('chưa mở hộp thoại (pointId rỗng) thì không gọi API', () => {
    renderNotice(null)
    expect(api.getVirtualPointUsage).not.toHaveBeenCalled()
  })
})
