import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPage } from './DiagnosticsPage'

const api = vi.hoisted(() => ({
  getModbusDiagnostics: vi.fn(),
  getModbusDevices: vi.fn()
}))

vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

describe('DiagnosticsPage', () => {
  beforeEach(() => {
    api.getModbusDevices.mockResolvedValue([
      { device_id: 'ahu-1', display_name: 'AHU 1', enabled: true, rs485_port: '/dev/rs485-1', baud: 19200, parity: 'E', stop_bit: 1, slave_id: 7, poll_ms: 1000, timeout_ms: 300, retry: 2 }
    ])
    api.getModbusDiagnostics.mockResolvedValue([
      { device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 10, total_errors: 2, timeout_errors: 1, crc_errors: 1, retry_attempts: 2, consecutive_errors: 2, last_seen_ms: 123 }
    ])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hiển thị bộ đếm CRC / timeout / phát lại theo slave', async () => {
    render(<DiagnosticsPage />)
    /* Bảng diagnostics mô tả tình trạng liên lạc của THIẾT BỊ, không gọi là quality. */
    expect(await screen.findByText('Mất liên lạc')).toBeInTheDocument()
    expect(screen.getByText('10 / 2')).toBeInTheDocument()
    /* Tên hiển thị dễ đọc hơn device_id thô khi đứng cạnh số slave. */
    expect(screen.getByText('AHU 1')).toBeInTheDocument()
  })

  /* D-07: thiết bị chưa từng được poll không được gọi là STALE ("dữ liệu cũ"). */
  it('thiết bị chưa từng liên lạc không bị gọi là dữ liệu cũ', async () => {
    api.getModbusDiagnostics.mockResolvedValue([
      { device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 0, total_errors: 0, timeout_errors: 0, crc_errors: 0, retry_attempts: 0, consecutive_errors: 0, last_seen_ms: 0 }
    ])
    render(<DiagnosticsPage />)
    expect(await screen.findByText('Chưa liên lạc lần nào')).toBeInTheDocument()
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
  })

  it('không có telemetry thì nói rõ là chưa có', async () => {
    api.getModbusDiagnostics.mockResolvedValue([])
    render(<DiagnosticsPage />)
    expect(await screen.findByText('Chưa có telemetry Modbus RTU từ iobus.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /* D-07: "không đọc được" khác "chưa có". Gộp hai trường hợp thành cùng một
   * bảng rỗng là cách nhanh nhất để người vận hành tưởng bus đang im lặng trong
   * khi thật ra authority đã chết. */
  it('authority chết thì báo lỗi, không giả vờ là chưa có telemetry', async () => {
    api.getModbusDiagnostics.mockRejectedValue(new Error('502 Bad Gateway'))
    render(<DiagnosticsPage />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không đọc được diagnostics')
    expect(alert).toHaveTextContent('502 Bad Gateway')
    expect(screen.queryByText('Chưa có telemetry Modbus RTU từ iobus.')).not.toBeInTheDocument()
  })
})
