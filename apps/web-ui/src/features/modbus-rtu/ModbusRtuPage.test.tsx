import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserRole } from '../../shared/types'
import { ModbusRtuPage } from './ModbusRtuPage'

const api = vi.hoisted(() => ({
  getModbusDevices: vi.fn(), getModbusPoints: vi.fn(), getModbusDiagnostics: vi.fn(),
  getPoints: vi.fn(), createModbusDevice: vi.fn(), updateModbusDevice: vi.fn(),
  deleteModbusDevice: vi.fn(), createModbusPoint: vi.fn(), updateModbusPoint: vi.fn(),
  deleteModbusPoint: vi.fn(), writeModbusTest: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

/* Đ-04: trang nay mở cho Viewer đọc, nên test phải cấp được vai trò. */
const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-04T00:00:00Z' },
      login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({})
    })
  }
})

describe('ModbusRtuPage', () => {
  beforeEach(() => {
    auth.role = 'admin'
    api.getModbusDevices.mockResolvedValue([{ device_id: 'ahu-1', display_name: 'AHU 1', enabled: true, rs485_port: '/dev/ttyS5', baud: 19200, parity: 'E', stop_bit: 1, slave_id: 7, poll_ms: 1000, timeout_ms: 300, retry: 2 }])
    api.getModbusPoints.mockResolvedValue([
      { point_id: 'MB-AHU-SAT', device_id: 'ahu-1', tag_name: 'ahu1 sat', display_name: 'Supply air', register_type: 'input_register', address: 100, data_type: 'float32', byte_order: 'little', word_order: 'low_high', scale: 0.1, offset: -10, unit: 'degC', read_write: 'read', default_value: 20, safe_value: 0, enabled: true },
      { point_id: 'MB-AHU-SP', device_id: 'ahu-1', tag_name: 'ahu1 sp', display_name: 'Setpoint', register_type: 'holding_register', address: 102, data_type: 'float32', byte_order: 'big', word_order: 'high_low', scale: 1, offset: 0, unit: 'degC', read_write: 'read_write', default_value: 22.5, safe_value: 0, enabled: true }
    ])
    api.getModbusDiagnostics.mockResolvedValue([{ device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 10, total_errors: 2, timeout_errors: 1, crc_errors: 1, retry_attempts: 2, consecutive_errors: 2, last_seen_ms: 123 }])
    api.getPoints.mockResolvedValue([{ id: 'MB-AHU-SAT', tag: 'ahu1 sat', name: 'Supply air', kind: 'modbus_rtu', value: 21.5, quality: 'offline', source: 'modbus_rtu', updatedAt: '2026-08-03T00:00:00Z' }])
    api.createModbusDevice.mockResolvedValue({})
    api.deleteModbusDevice.mockResolvedValue(undefined)
    api.deleteModbusPoint.mockResolvedValue(undefined)
    api.writeModbusTest.mockResolvedValue({ point_id: 'MB-AHU-SP', applied_value: 22.5, status: 'success' })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hiển thị nút Ghi thử cho Point read_write và thực thi lệnh ghi sau xác nhận', async () => {
    const user = userEvent.setup()
    render(<ModbusRtuPage />)
    expect(await screen.findByText('MB-AHU-SP')).toBeInTheDocument()
    const writeBtn = screen.getByRole('button', { name: 'Ghi thử' })
    expect(writeBtn).toBeInTheDocument()

    await user.click(writeBtn)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Ghi thử Modbus RTU Point')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Xác nhận Ghi' }))
    expect(api.writeModbusTest).toHaveBeenCalledWith('MB-AHU-SP', 22.5)
  })

  it('hiển thị cấu hình, quality runtime và diagnostics từ backend', async () => {
    render(<ModbusRtuPage />)
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    /* Quality của Point lấy từ /points (authority), không suy diễn. */
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    /* Bảng diagnostics mô tả tình trạng liên lạc của THIẾT BỊ, không gọi là quality. */
    expect(screen.getByText('Mất liên lạc')).toBeInTheDocument()
    expect(screen.getByText('10 / 2')).toBeInTheDocument()
    expect(screen.getByText('float32 · little/low_high')).toBeInTheDocument()
  })

  it('gửi cấu hình qua Device Manager, không đặt sẵn cổng không tồn tại', async () => {
    const user = userEvent.setup()
    render(<ModbusRtuPage />)
    await screen.findByText('MB-AHU-SAT')
    await user.type(screen.getByRole('textbox', { name: 'Tên thiết bị' }), 'New meter')
    /* D-14: form chọn cổng hợp lệ (/dev/rs485-1 hoặc /dev/rs485-2). */
    await user.selectOptions(screen.getByRole('combobox', { name: 'RS485 port' }), '/dev/rs485-1')
    await user.click(screen.getByRole('button', { name: 'Thêm thiết bị' }))
    expect(api.createModbusDevice).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'New meter', rs485_port: '/dev/rs485-1', baud: 19200,
      parity: 'N', stop_bit: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2
    }))
  })

  /* D-07: thiếu telemetry KHÔNG được hiển thị thành BAD hay 0. Trước bản sửa,
   * `runtimeQuality[id] ?? 'bad'` báo mọi Point hỏng khi chỉ là FE chưa lấy được
   * dữ liệu — báo động giả làm mất niềm tin vào cả bảng. */
  it('thiếu telemetry hiển thị — chứ không phải BAD', async () => {
    api.getPoints.mockRejectedValue(new Error('mạng lỗi'))
    api.getModbusDiagnostics.mockResolvedValue([])
    render(<ModbusRtuPage />)
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    expect(screen.queryByText('BAD')).not.toBeInTheDocument()
    expect(screen.getByText('Chưa có telemetry Modbus RTU từ iobus.')).toBeInTheDocument()
  })

  /* D-07: thiết bị chưa từng được poll không được gọi là STALE ("dữ liệu cũ"). */
  it('thiết bị chưa từng liên lạc không bị gọi là dữ liệu cũ', async () => {
    api.getModbusDiagnostics.mockResolvedValue([{ device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 0, total_errors: 0, timeout_errors: 0, crc_errors: 0, retry_attempts: 0, consecutive_errors: 0, last_seen_ms: 0 }])
    render(<ModbusRtuPage />)
    expect(await screen.findByText('Chưa liên lạc lần nào')).toBeInTheDocument()
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
  })

  /* D-08: xoá phải qua xác nhận; huỷ thì không gọi API. */
  it('xoá thiết bị yêu cầu xác nhận', async () => {
    const user = userEvent.setup()
    render(<ModbusRtuPage />)
    await screen.findByText('MB-AHU-SAT')

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[0])
    expect(api.deleteModbusDevice).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(api.deleteModbusDevice).not.toHaveBeenCalled()

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[0])
    await user.click(screen.getByRole('dialog').querySelector('button:last-child') as HTMLElement)
    expect(api.deleteModbusDevice).toHaveBeenCalledWith('ahu-1')
  })

  /* Đ-04: Viewer xem được nhưng không sửa được. */
  it('viewer xem được nhưng mọi control thay đổi bị khoá', async () => {
    auth.role = 'viewer'
    render(<ModbusRtuPage />)
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Chế độ chỉ xem')
    expect(screen.getByRole('button', { name: 'Thêm thiết bị' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Thêm Point' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: 'Xoá' })) {
      expect(button).toBeDisabled()
    }
  })
})
