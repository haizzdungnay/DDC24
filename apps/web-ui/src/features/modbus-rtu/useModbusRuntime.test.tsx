import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useModbusRuntime } from './useModbusRuntime'

const api = vi.hoisted(() => ({ getPoints: vi.fn() }))
vi.mock('../../shared/api/client', () => ({ apiClient: api }))

const realtime = vi.hoisted(() => ({
  connectionState: 'connected' as string,
  allPoints: [] as unknown[]
}))
vi.mock('../../shared/realtime', () => ({
  useRealtime: () => ({ connectionState: realtime.connectionState, allPoints: realtime.allPoints })
}))

function Probe() {
  const runtime = useModbusRuntime()
  return (
    <div>
      <span data-testid="live">{String(runtime.live)}</span>
      <span data-testid="reason">{runtime.staleReason}</span>
      <span data-testid="q">{runtime.points['MB-KWH']?.quality ?? 'NONE'}</span>
      <span data-testid="v">{String(runtime.points['MB-KWH']?.value ?? 'NONE')}</span>
    </div>
  )
}

function point(id: string, quality: string, value: number) {
  return { id, kind: 'modbus_rtu', quality, value, updatedAt: '2026-08-06T00:00:00Z', writable: false }
}

describe('useModbusRuntime', () => {
  beforeEach(() => {
    realtime.connectionState = 'connected'
    realtime.allPoints = []
    api.getPoints.mockResolvedValue([point('MB-KWH', 'GOOD', 100)])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  /* Ảnh đầu tiên phải lấy qua REST: WS chỉ phát khi CÓ thay đổi, nên chờ nó thì
   * một hệ thống đứng yên sẽ hiện bảng rỗng vô thời hạn. */
  it('lấy ảnh đầy đủ qua REST ngay lần đầu, không chờ WS phát', async () => {
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('q')).toHaveTextContent('GOOD'))
    expect(api.getPoints).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('live')).toHaveTextContent('true')
  })

  it('ưu tiên giá trị từ luồng WS khi đang live', async () => {
    realtime.allPoints = [point('MB-KWH', 'STALE', 250)]
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('q')).toHaveTextContent('STALE'))
    expect(screen.getByTestId('v')).toHaveTextContent('250')
  })

  /* MBR-B310 — điểm khó nhất: mất kết nối thì số trên màn hình là số CŨ, và
   * phải nói ra. Giữ nguyên số mà im lặng là để người vận hành quyết định dựa
   * trên một giá trị không còn đúng. */
  it('mất kết nối ⇒ không còn live và nói rõ lý do', async () => {
    const { rerender } = render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent('true'))

    realtime.connectionState = 'disconnected'
    rerender(<Probe />)
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent('false'))
    expect(screen.getByTestId('reason')).toHaveTextContent('mất kết nối')
    // Giá trị cuối vẫn giữ để người dùng còn thấy trạng thái trước đó.
    expect(screen.getByTestId('q')).toHaveTextContent('GOOD')
  })

  /* Kết nối LẠI phải lấy ảnh đầy đủ TRƯỚC khi tin cập nhật tiếp theo: trong lúc
   * đứt, giá trị có thể đã đổi nhiều lần, và áp delta lên nền cũ cho ra bảng
   * trộn giữa hai thời điểm — sai mà trông vẫn hợp lý. */
  it('kết nối lại ⇒ lấy snapshot mới trước khi tin delta', async () => {
    const { rerender } = render(<Probe />)
    await waitFor(() => expect(api.getPoints).toHaveBeenCalledTimes(1))

    realtime.connectionState = 'reconnecting'
    rerender(<Probe />)
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent('false'))

    api.getPoints.mockResolvedValue([point('MB-KWH', 'OFFLINE', 999)])
    realtime.connectionState = 'connected'
    rerender(<Probe />)

    await waitFor(() => expect(api.getPoints).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('q')).toHaveTextContent('OFFLINE'))
  })

  /* Quality lạ (producer mới hơn consumer) ⇒ UNKNOWN, không đoán về GOOD. */
  it('quality không nhận diện được thành UNKNOWN', async () => {
    api.getPoints.mockResolvedValue([point('MB-KWH', 'SOMETHING_NEW', 1)])
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('q')).toHaveTextContent('UNKNOWN'))
  })

  it('REST hỏng ⇒ báo lý do thay vì im lặng hiện bảng rỗng', async () => {
    api.getPoints.mockRejectedValue(new Error('core offline'))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('reason')).toHaveTextContent('core offline'))
    expect(screen.getByTestId('live')).toHaveTextContent('false')
  })
})
