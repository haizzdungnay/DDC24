import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ModbusFramesResponse } from '../../../shared/types'
import { FrameMonitor } from './FrameMonitor'

/**
 * `T57-3.9` — bảng khung truyền trên trang chẩn đoán Modbus RTU.
 *
 * Test ở đây khoá HAI thứ mà lỗi sẽ dẫn tới hành động sai ngoài hiện trường:
 *
 * 1. **Không đọc được ≠ bus im lặng.** Lỗi API phải hiện thành lỗi. Nuốt lỗi
 *    thành bảng rỗng là bảo người kỹ thuật rằng bus không có giao dịch nào —
 *    họ sẽ đi tháo dây tìm một sự cố không tồn tại.
 * 2. **Phân loại lỗi phải hiện nguyên.** `crc` và `timeout` dẫn tới hai hành
 *    động sửa chữa khác hẳn nhau; gộp thành "lỗi" là xoá đúng phần có giá trị.
 */

const api = vi.hoisted(() => ({ getModbusFrames: vi.fn() }))
vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

const reply: ModbusFramesResponse = {
  schemaVersion: 1,
  bus: 0,
  volatile: true,
  rawBytes: false,
  frames: [
    { at: 1755600000000, bus: 1, slave: 7, fc: 3, addr: 100, count: 2, ok: false, reason: 'crc', elapsedUs: 2500, attempt: 2 },
    { at: 1755599999000, bus: 1, slave: 4, fc: 4, addr: 20, count: 1, ok: true, reason: 'ok', elapsedUs: 1200, attempt: 1 }
  ]
}

function renderPanel() {
  return render(<I18nProvider><FrameMonitor /></I18nProvider>)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  api.getModbusFrames.mockResolvedValue(reply)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('FrameMonitor', () => {
  it('hiện từng giao dịch kèm phân loại lỗi nguyên vẹn', async () => {
    renderPanel()

    await waitFor(() => expect(screen.getByText('CRC')).toBeInTheDocument())
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('2.5 ms')).toBeInTheDocument()
  })

  it('nói rõ dữ liệu mất khi iobus restart và Rev A không có byte thô', async () => {
    renderPanel()

    // Hai giới hạn này phải nằm trên màn hình, không nằm trong tài liệu: người
    // đọc mới là người sẽ kết luận sai nếu tưởng đây là nhật ký lưu trữ.
    await waitFor(() => expect(screen.getByText(/mất khi dịch vụ khởi động lại/i)).toBeInTheDocument())
    expect(screen.getByText(/không có byte thô/i)).toBeInTheDocument()
  })

  it('lỗi đọc KHÔNG được hiện thành bảng rỗng', async () => {
    api.getModbusFrames.mockRejectedValue(new Error('iobus không trả được khung: unsupported'))
    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unsupported/i)
    // Và tuyệt đối không được kèm câu "chưa có giao dịch nào" — đó là kết luận
    // của một tình trạng khác hẳn.
    expect(screen.queryByText(/Chưa có giao dịch nào/i)).not.toBeInTheDocument()
  })

  it('vòng nhớ rỗng thật thì nói rõ là rỗng, kèm hai lý do có thể', async () => {
    api.getModbusFrames.mockResolvedValue({ ...reply, frames: [] })
    renderPanel()

    await waitFor(() => expect(screen.getByText(/Chưa có giao dịch nào/i)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('bấm Tải lại thì gọi lại API', async () => {
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(api.getModbusFrames).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Tải lại' }))
    await waitFor(() => expect(api.getModbusFrames).toHaveBeenCalledTimes(2))
  })

  /* U-18 (REC-DDC-FIELD-USE-20260927): trước bản này người vận hành chỉ thấy
   * "FC05 coil 3 OK" và phải đoán lệnh vừa rồi là đóng hay mở từ lượt đọc lại
   * một giây sau. */
  it('khung ghi hiện giá trị đã phát, khung đọc hiện dấu gạch', async () => {
    api.getModbusFrames.mockResolvedValue({
      ...reply,
      frames: [
        { at: 1755600000003, bus: 1, slave: 4, fc: 15, addr: 0, count: 8, ok: true, reason: 'ok', elapsedUs: 30000, attempt: 1, values: [1, 0, 1, 1, 0, 0, 1, 0] },
        { at: 1755600000002, bus: 1, slave: 5, fc: 6, addr: 40, count: 1, ok: true, reason: 'ok', elapsedUs: 20000, attempt: 1, values: [1234] },
        { at: 1755600000001, bus: 1, slave: 4, fc: 1, addr: 0, count: 8, ok: true, reason: 'ok', elapsedUs: 29000, attempt: 1 }
      ]
    })
    renderPanel()

    await waitFor(() => expect(screen.getAllByTestId('frame-values')).toHaveLength(3))
    const cells = screen.getAllByTestId('frame-values')
    expect(screen.getByRole('columnheader', { name: 'Giá trị ghi' })).toBeInTheDocument()
    expect(cells[0]).toHaveTextContent('1 0 1 1 0 0 1 0')
    expect(cells[0]).toHaveAttribute('title', 'Phần tử đầu ứng với địa chỉ 0')
    expect(cells[1]).toHaveTextContent('1234')
    expect(cells[2]).toHaveTextContent('—')
  })

  it('không tự bật theo dõi liên tục — mặc định là một lượt đọc', async () => {
    vi.useFakeTimers()
    try {
      render(<I18nProvider><FrameMonitor /></I18nProvider>)
      await vi.advanceTimersByTimeAsync(10_000)
      // Một panel chẩn đoán tự poll ngầm sẽ giữ tải lên iobus ngay cả khi không
      // ai nhìn; bật liên tục phải là hành động có chủ ý của người dùng.
      expect(api.getModbusFrames).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /* T63-108 (PERF-API-03): theo dõi liên tục KHÔNG poll khi tab ẩn — không ai
   * nhìn bảng khung, mà mỗi lượt đọc vẫn chạm iobus. */
  it('theo dõi liên tục dừng khi tab ẩn và đọc bù ngay khi hiện lại', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    vi.useFakeTimers()
    try {
      render(<I18nProvider><FrameMonitor /></I18nProvider>)
      await vi.advanceTimersByTimeAsync(0)
      screen.getByRole('button', { name: 'Theo dõi liên tục' }).click()
      await vi.advanceTimersByTimeAsync(4000)
      const visibleCalls = api.getModbusFrames.mock.calls.length
      expect(visibleCalls).toBeGreaterThanOrEqual(3)

      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(api.getModbusFrames).toHaveBeenCalledTimes(visibleCalls)

      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
      expect(api.getModbusFrames).toHaveBeenCalledTimes(visibleCalls + 1)
    } finally {
      visibility = 'visible'
      vi.useRealTimers()
    }
  })
})
