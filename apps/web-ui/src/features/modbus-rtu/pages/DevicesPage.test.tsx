import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserRole } from '../../../shared/types'
import { DevicesPage } from './DevicesPage'

const api = vi.hoisted(() => ({
  getModbusDevices: vi.fn(), getModbusPoints: vi.fn(), getModbusDiagnostics: vi.fn(),
  createModbusDevice: vi.fn(), updateModbusDevice: vi.fn(), deleteModbusDevice: vi.fn()
}))

vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

/* Đ-04: trang này mở cho Viewer đọc, nên test phải cấp được vai trò. */
const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-05T00:00:00Z' },
      login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({})
    })
  }
})

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/eng/modbus-rtu/devices${search}`]}>
      <DevicesPage />
    </MemoryRouter>
  )
}

describe('DevicesPage', () => {
  beforeEach(() => {
    auth.role = 'admin'
    api.getModbusDevices.mockResolvedValue([
      { device_id: 'ahu-1', display_name: 'AHU 1', enabled: true, rs485_port: '/dev/rs485-1', baud: 19200, parity: 'E', stop_bit: 1, slave_id: 7, poll_ms: 1000, timeout_ms: 300, retry: 2 },
      { device_id: 'meter-2', display_name: 'Meter 2', enabled: true, rs485_port: '/dev/rs485-2', baud: 9600, parity: 'N', stop_bit: 1, slave_id: 9, poll_ms: 2000, timeout_ms: 300, retry: 1 }
    ])
    api.getModbusPoints.mockResolvedValue([
      { point_id: 'MB-AHU-SAT', device_id: 'ahu-1', tag_name: 'ahu1 sat', display_name: 'Supply air', register_type: 'input_register', address: 100, data_type: 'float32', byte_order: 'little', word_order: 'low_high', scale: 0.1, offset: -10, unit: 'degC', read_write: 'read', default_value: 20, safe_value: 0, enabled: true }
    ])
    api.getModbusDiagnostics.mockResolvedValue([
      { device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 10, total_errors: 2, timeout_errors: 1, crc_errors: 1, retry_attempts: 2, consecutive_errors: 2, last_seen_ms: 123 },
      { device_id: 'meter-2', slave_id: 9, online: true, total_polls: 50, total_errors: 0, timeout_errors: 0, crc_errors: 0, retry_attempts: 0, consecutive_errors: 0, last_seen_ms: 10 }
    ])
    api.createModbusDevice.mockResolvedValue({})
    api.deleteModbusDevice.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('gửi cấu hình qua form, không đặt sẵn cổng không tồn tại', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText('ahu-1')
    await user.type(screen.getByRole('textbox', { name: 'Tên thiết bị' }), 'New meter')
    /* D-14: form chỉ cho chọn cổng hợp lệ (/dev/rs485-1 hoặc /dev/rs485-2). */
    await user.selectOptions(screen.getByRole('combobox', { name: 'RS485 port' }), '/dev/rs485-1')
    await user.click(screen.getByRole('button', { name: 'Thêm thiết bị mới' }))
    expect(api.createModbusDevice).toHaveBeenCalledWith(expect.objectContaining({
      display_name: 'New meter', rs485_port: '/dev/rs485-1', baud: 19200,
      parity: 'N', stop_bit: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2
    }))
  })

  /* FE-MB-04: KPI card "Offline" ở Overview điều hướng kèm `?status=OFFLINE`.
   * Trước bản sửa, route `devices` render `ModbusRtuPage` vốn không đọc
   * `location.search` nên deep link ra danh sách đầy đủ, không lọc gì. */
  it('lọc theo ?status=OFFLINE từ deep link của Overview', async () => {
    renderAt('?status=OFFLINE')
    expect(await screen.findByText('ahu-1')).toBeInTheDocument()
    expect(screen.queryByText('meter-2')).not.toBeInTheDocument()
    expect(screen.getByText('Đang lọc: OFFLINE')).toBeInTheDocument()
  })

  it('lọc theo ?status=ONLINE', async () => {
    renderAt('?status=ONLINE')
    expect(await screen.findByText('meter-2')).toBeInTheDocument()
    expect(screen.queryByText('ahu-1')).not.toBeInTheDocument()
  })

  it('không có query thì hiện đủ thiết bị', async () => {
    renderAt()
    expect(await screen.findByText('ahu-1')).toBeInTheDocument()
    expect(screen.getByText('meter-2')).toBeInTheDocument()
    expect(screen.queryByText(/Đang lọc/)).not.toBeInTheDocument()
  })

  /* D-07: thiết bị chưa từng được poll không được gọi là STALE ("dữ liệu cũ"). */
  it('thiết bị chưa từng liên lạc không bị gọi là dữ liệu cũ', async () => {
    api.getModbusDiagnostics.mockResolvedValue([
      { device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 0, total_errors: 0, timeout_errors: 0, crc_errors: 0, retry_attempts: 0, consecutive_errors: 0, last_seen_ms: 0 }
    ])
    renderAt()
    expect(await screen.findByText('Chưa liên lạc lần nào')).toBeInTheDocument()
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
  })

  /* D-08: xoá phải qua xác nhận; huỷ thì không gọi API. */
  it('xoá thiết bị yêu cầu xác nhận', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText('ahu-1')

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[0])
    expect(api.deleteModbusDevice).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    /* Cảnh báo còn Point tham chiếu phải hiện trước khi người dùng bấm xác nhận. */
    expect(screen.getByText(/còn 1 Modbus Point/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(api.deleteModbusDevice).not.toHaveBeenCalled()

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[0])
    await user.click(screen.getByRole('dialog').querySelector('button:last-child') as HTMLElement)
    expect(api.deleteModbusDevice).toHaveBeenCalledWith('ahu-1')
  })

  /* Đ-04: Viewer xem được nhưng không sửa được. */
  it('viewer xem được nhưng mọi control thay đổi bị khoá', async () => {
    auth.role = 'viewer'
    renderAt()
    expect(await screen.findByText('ahu-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thêm thiết bị mới' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: 'Xoá' })) {
      expect(button).toBeDisabled()
    }
    for (const button of screen.getAllByRole('button', { name: 'Sửa' })) {
      expect(button).toBeDisabled()
    }
  })
})
