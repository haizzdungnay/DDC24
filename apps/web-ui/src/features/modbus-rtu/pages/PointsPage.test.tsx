import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserRole } from '../../../shared/types'
import { PointsPage } from './PointsPage'
import { I18nProvider } from '../../../shared/i18n'

function renderPage() {
  return render(<I18nProvider><PointsPage /></I18nProvider>)
}

const api = vi.hoisted(() => ({
  getModbusDevices: vi.fn(), getModbusPoints: vi.fn(), getPoints: vi.fn(),
  createModbusPoint: vi.fn(), updateModbusPoint: vi.fn(), deleteModbusPoint: vi.fn(),
  writeModbusTest: vi.fn()
}))

vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

/* `PointsPage` dùng `useModbusRuntime` → `useRealtime`, mà provider được gắn ở
 * `App.tsx` bọc toàn ứng dụng. Test render trang CÔ LẬP nên phải cấp thay. Giữ
 * hook production nghiêm ngặt (ném lỗi khi thiếu provider) là có chủ đích: quên
 * bọc provider là lỗi wiring thật, không nên bị che. */
vi.mock('../../../shared/realtime', () => ({
  useRealtime: () => ({ connectionState: 'connected', allPoints: [] })
}))

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

describe('PointsPage', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('mkddc-lang', 'vi')
    auth.role = 'admin'
    api.getModbusDevices.mockResolvedValue([
      { device_id: 'ahu-1', display_name: 'AHU 1', enabled: true, rs485_port: '/dev/rs485-1', baud: 19200, parity: 'E', stop_bits: 1, slave_id: 7, poll_ms: 1000, timeout_ms: 300, retry: 2 }
    ])
    api.getModbusPoints.mockResolvedValue([
      { point_id: 'MB-AHU-SAT', device_id: 'ahu-1', tag_name: 'ahu1 sat', display_name: 'Supply air', register_type: 'input_register', address: 100, data_type: 'float32', byte_order: 'little', word_order: 'low_high', scale: 0.1, offset: -10, unit: 'degC', read_write: 'read', default_value: 20, safe_value: 0, enabled: true },
      { point_id: 'MB-AHU-SP', device_id: 'ahu-1', tag_name: 'ahu1 sp', display_name: 'Setpoint', register_type: 'holding_register', address: 102, data_type: 'float32', byte_order: 'big', word_order: 'high_low', scale: 1, offset: 0, unit: 'degC', read_write: 'read_write', default_value: 22.5, safe_value: 0, enabled: true }
    ])
    api.getPoints.mockResolvedValue([
      { id: 'MB-AHU-SAT', tag: 'ahu1 sat', name: 'Supply air', kind: 'modbus_rtu', value: 21.5, quality: 'offline', source: 'modbus_rtu', updatedAt: '2026-08-05T00:00:00Z' }
    ])
    api.createModbusPoint.mockResolvedValue({})
    api.deleteModbusPoint.mockResolvedValue(undefined)
    api.writeModbusTest.mockResolvedValue({ point_id: 'MB-AHU-SP', applied_value: 22.5, status: 'success' })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hiển thị nút Ghi thử cho Point read_write và thực thi lệnh ghi sau xác nhận', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('MB-AHU-SP')).toBeInTheDocument()
    const writeBtn = screen.getByRole('button', { name: 'Ghi thử' })
    expect(writeBtn).toBeInTheDocument()

    await user.click(writeBtn)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Ghi thử Modbus RTU Point')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Xác nhận Ghi' }))
    expect(api.writeModbusTest).toHaveBeenCalledWith('MB-AHU-SP', 22.5)
  })

  it('hiển thị cấu hình và quality runtime từ authority', async () => {
    renderPage()
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    /* Quality của Point lấy từ /points (authority), không suy diễn. */
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    expect(screen.getByText('float32 · little/low_high')).toBeInTheDocument()
  })

  /* D-07: thiếu telemetry KHÔNG được hiển thị thành BAD hay 0. Trước bản sửa,
   * `runtimeQuality[id] ?? 'bad'` báo mọi Point hỏng khi chỉ là FE chưa lấy được
   * dữ liệu — báo động giả làm mất niềm tin vào cả bảng. */
  it('thiếu telemetry hiển thị — chứ không phải BAD', async () => {
    api.getPoints.mockRejectedValue(new Error('mạng lỗi'))
    renderPage()
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    expect(screen.queryByText('BAD')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  /* D-08: xoá phải qua xác nhận; huỷ thì không gọi API. */
  it('xoá Point yêu cầu xác nhận', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MB-AHU-SAT')

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[0])
    expect(api.deleteModbusPoint).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(api.deleteModbusPoint).not.toHaveBeenCalled()

    await user.click(screen.getAllByRole('button', { name: 'Xoá' })[0])
    await user.click(screen.getByRole('dialog').querySelector('button:last-child') as HTMLElement)
    expect(api.deleteModbusPoint).toHaveBeenCalledWith('MB-AHU-SAT')
  })

  /* Đ-04: Viewer xem được nhưng không sửa được; ghi thử cần Operator trở lên. */
  it('viewer xem được nhưng mọi control thay đổi bị khoá', async () => {
    auth.role = 'viewer'
    renderPage()
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thêm Point' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ghi thử' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: 'Xoá' })) {
      expect(button).toBeDisabled()
    }
  })

  it('operator ghi thử được nhưng không sửa cấu hình', async () => {
    auth.role = 'operator'
    renderPage()
    expect(await screen.findByText('MB-AHU-SAT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghi thử' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Thêm Point' })).toBeDisabled()
  })

  /* Mọi ô trong form Point phải có nhãn NHÌN THẤY ĐƯỢC. Placeholder biến mất
   * ngay khi ô có giá trị, mà các ô số đều có sẵn mặc định — người dùng chỉ
   * thấy `0 · uint16 · 1 · 0 · 0` và không biết ô nào là gì. */
  it('mọi ô trong form Point đều có nhãn hiển thị', async () => {
    renderPage()
    await screen.findByText('MB-AHU-SAT')
    for (const caption of ['Point ID', 'Thiết bị', 'Tag name', 'Tên hiển thị',
                           'Loại thanh ghi', 'Địa chỉ thanh ghi', 'Kiểu dữ liệu',
                           'Thứ tự byte', 'Thứ tự word', 'Hệ số nhân',
                           'Bù (offset)', 'Đơn vị', 'Quyền đọc/ghi',
                           'Giá trị mặc định', 'Giá trị an toàn']) {
      expect(screen.getByText(caption)).toBeInTheDocument()
    }
  })
})
