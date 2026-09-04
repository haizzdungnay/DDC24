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
      pointId: 'VP9', references: [],
      scanned: ['alarm-settings', 'schedules', 'programming-drafts', 'programming-active-revision'],
      incomplete: false
    })

    renderNotice('VP9')

    /* Kỳ vọng cũ đòi câu chữ "Không có cảnh báo hay lịch vận hành nào" — tức nó
       khoá lại đúng chỗ hẹp mà ISS-PIO-18 sửa: backend nay quét bốn nguồn, còn
       câu đó chỉ kể hai. Nay kiểm điều thật sự quan trọng: câu trả lời KHÔNG tự
       liệt kê nguồn, và `scanned` từ backend được đọc ra đủ. */
    const text = await screen.findByText(/Không nơi nào đang dùng điểm này/)
    for (const source of ['alarm-settings', 'schedules', 'programming-drafts', 'programming-active-revision']) {
      expect(text).toHaveTextContent(source)
    }
  })

  /* ISS-PIO-18 — tham chiếu `program` phải hiện, và NHIỀU binding trong CÙNG một
     Project phải hiện đủ. Khoá React cũ là `kind-id`, mà với binding Programming
     thì `id` là projectId dùng chung — trùng khoá sẽ làm React nuốt mất dòng, và
     một cảnh báo xoá nuốt mất một mục là đúng thứ nó sinh ra để chặn. */
  it('nhiều binding cùng một Project ⇒ hiện đủ từng dòng', async () => {
    api.getVirtualPointUsage.mockResolvedValue({
      pointId: 'VP9', references: [
        { kind: 'program', id: 'proj-1', name: 'AHU-1', detail: 'Revision đang chạy: biến Fan (WRITE)' },
        { kind: 'program', id: 'proj-1', name: 'AHU-1', detail: 'bản đang soạn: biến Setpoint (READ)' }
      ],
      scanned: ['alarm-settings', 'schedules', 'programming-drafts', 'programming-active-revision'],
      incomplete: false
    })

    /* Canh CHÍNH lỗi khoá trùng, không chỉ canh "có hiện đủ dòng không".
       Đã kiểm bằng tiêm lỗi: trả khoá về `kind-id` thì React VẪN vẽ đủ hai dòng
       ở lần render đầu, nên một phép đếm dòng sẽ xanh mà không kiểm gì. Thứ thật
       sự đổi là React ghi lỗi "same key" ra console. */
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })

    renderNotice('VP9')

    expect(await screen.findByText(/2 nơi đang dùng điểm này/)).toBeInTheDocument()
    expect(screen.getByText(/biến Fan \(WRITE\)/)).toBeInTheDocument()
    expect(screen.getByText(/biến Setpoint \(READ\)/)).toBeInTheDocument()

    const duplicateKey = errors.filter((line) => /same key|duplicate key/i.test(line))
    expect(duplicateKey, `React báo khoá trùng: ${duplicateKey.join(' | ')}`).toEqual([])
    spy.mockRestore()
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
