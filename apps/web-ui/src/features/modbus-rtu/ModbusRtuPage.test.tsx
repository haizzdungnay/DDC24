import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModbusRtuPage } from './ModbusRtuPage'

const api = vi.hoisted(() => ({
  getModbusDevices: vi.fn(), getModbusPoints: vi.fn(), getModbusDiagnostics: vi.fn(),
  getPoints: vi.fn(), createModbusDevice: vi.fn(), updateModbusDevice: vi.fn(),
  deleteModbusDevice: vi.fn(), createModbusPoint: vi.fn(), updateModbusPoint: vi.fn(),
  deleteModbusPoint: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

describe('ModbusRtuPage', () => {
  beforeEach(() => {
    api.getModbusDevices.mockResolvedValue([{ device_id: 'ahu-1', display_name: 'AHU 1', enabled: true, rs485_port: '/dev/ttyS3', baud: 19200, parity: 'E', stop_bit: 1, slave_id: 7, poll_ms: 1000, timeout_ms: 300, retry: 2 }])
    api.getModbusPoints.mockResolvedValue([{ point_id: 'MB-AHU-SAT', device_id: 'ahu-1', tag_name: 'ahu1 sat', display_name: 'Supply air', register_type: 'input_register', address: 100, data_type: 'float32', byte_order: 'little', word_order: 'low_high', scale: 0.1, offset: -10, unit: 'degC', read_write: 'read', default_value: 20, safe_value: 0, enabled: true }])
    api.getModbusDiagnostics.mockResolvedValue([{ device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 10, total_errors: 2, timeout_errors: 1, crc_errors: 1, retry_attempts: 2, consecutive_errors: 2, last_seen_ms: 123 }])
    api.getPoints.mockResolvedValue([{ id: 'MB-AHU-SAT', tag: 'ahu1 sat', name: 'Supply air', kind: 'modbus_rtu', value: 21.5, quality: 'offline', source: 'modbus_rtu', updatedAt: '2026-08-03T00:00:00Z' }])
    api.createModbusDevice.mockResolvedValue({})
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hiển thị cấu hình, quality runtime và diagnostics từ backend', async () => {
    render(<ModbusRtuPage />)
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    expect(screen.getAllByText('OFFLINE')).toHaveLength(2)
    expect(screen.getByText('10 / 2')).toBeInTheDocument()
    expect(screen.getByText('float32 · little/low_high')).toBeInTheDocument()
  })

  it('gửi cấu hình RS485 mặc định qua Device Manager', async () => {
    const user = userEvent.setup()
    render(<ModbusRtuPage />)
    await screen.findByText('MB-AHU-SAT')
    await user.type(screen.getByRole('textbox', { name: 'Tên thiết bị' }), 'New meter')
    await user.click(screen.getByRole('button', { name: 'Thêm thiết bị' }))
    expect(api.createModbusDevice).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'New meter', rs485_port: '/dev/ttyS3', baud: 19200,
      parity: 'N', stop_bit: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2
    }))
  })
})
