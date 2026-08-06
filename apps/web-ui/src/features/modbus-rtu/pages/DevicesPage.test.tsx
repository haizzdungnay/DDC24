import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type UserRole } from '../../../shared/types'
import { DevicesPage } from './DevicesPage'

const api = vi.hoisted(() => ({
  getModbusDevices: vi.fn(), getModbusPoints: vi.fn(), getModbusDiagnostics: vi.fn(),
  createModbusDevice: vi.fn(), updateModbusDevice: vi.fn(), deleteModbusDevice: vi.fn(),
  testModbusConnection: vi.fn(), getModbusBuses: vi.fn()
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
      { device_id: 'ahu-1', display_name: 'AHU 1', enabled: true, rs485_port: '/dev/rs485-1', baud: 19200, parity: 'E', stop_bits: 1, slave_id: 7, poll_ms: 1000, timeout_ms: 300, retry: 2 },
      { device_id: 'meter-2', display_name: 'Meter 2', enabled: true, rs485_port: '/dev/rs485-2', baud: 9600, parity: 'N', stop_bits: 1, slave_id: 9, poll_ms: 2000, timeout_ms: 300, retry: 1 }
    ])
    api.getModbusPoints.mockResolvedValue([
      { point_id: 'MB-AHU-SAT', device_id: 'ahu-1', tag_name: 'ahu1 sat', display_name: 'Supply air', register_type: 'input_register', address: 100, data_type: 'float32', byte_order: 'little', word_order: 'low_high', scale: 0.1, offset: -10, unit: 'degC', read_write: 'read', default_value: 20, safe_value: 0, enabled: true }
    ])
    api.getModbusDiagnostics.mockResolvedValue([
      { device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 10, total_errors: 2, timeout_errors: 1, crc_errors: 1, retry_attempts: 2, consecutive_errors: 2, last_seen_ms: 123 },
      { device_id: 'meter-2', slave_id: 9, online: true, total_polls: 50, total_errors: 0, timeout_errors: 0, crc_errors: 0, retry_attempts: 0, consecutive_errors: 0, last_seen_ms: 10 }
    ])
    api.getModbusBuses.mockResolvedValue([
      { bus_id: 'rs485-1', display_name: 'RS485-1', port: '/dev/rs485-1', port_alias: 'ttyS5',
        open_state: 'RUNNING', baud: 19200, parity: 'N', data_bits: 8, stop_bits: 1,
        offline_probe_ms: 5000, enabled: true, total_devices: 1, online_devices: 0,
        poll_latency_p50_ms: null, poll_latency_p95_ms: null, bus_utilization_percent: null,
        timeout_errors: 0, crc_errors: 0 }
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
      parity: 'N', stop_bits: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2
    }))
  })

  /* OD-MBRTU-002 (CLOSED): tham số serial thuộc về DÂY, không thuộc thiết bị.
   *
   * Bản trước có ô nhập baud/parity/stop ngay trong form Thiết bị — tức mô hình
   * dữ liệu nói một đằng, validator cưỡng chế điều đó, còn giao diện thì mời
   * người dùng nhập một nẻo rồi từ chối sau khi họ bấm lưu, mà không có chỗ nào
   * sửa cho đúng. Test này khoá lại: những ô đó KHÔNG được quay lại. */
  it('form Thiết bị không có ô nhập khung truyền', async () => {
    renderAt()
    await screen.findByText('ahu-1')
    expect(screen.queryByRole('spinbutton', { name: 'Baud' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Parity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Stop bit' })).not.toBeInTheDocument()
  })

  it('hiện khung truyền kế thừa từ cổng và chỉ đường tới nơi sửa được', async () => {
    renderAt()
    await screen.findByText('ahu-1')
    const inherited = screen.getByTestId('device-serial-inherited')
    expect(inherited).toHaveTextContent('19200 N81')
    expect(within(inherited).getByRole('link', { name: /Cổng RS-485/ }))
      .toHaveAttribute('href', '/eng/modbus-rtu/ports')
  })

  /* Backend trả `details[]` chỉ đúng trường sai; hiện mỗi "validation failed"
   * thì người dùng phải đoán từng ô. Đúng tình huống gặp trên bo 2026-08-06. */
  it('hiện chi tiết trường sai khi lưu thất bại', async () => {
    const user = userEvent.setup()
    api.createModbusDevice.mockRejectedValue(
      new ApiError('validation failed', 400, [
        { path: 'devices[0].device_id', message: 'phải dài 1..23 ký tự ASCII và bắt đầu bằng chữ' }
      ])
    )
    renderAt()
    await screen.findByText('ahu-1')
    await user.type(screen.getByRole('textbox', { name: 'Tên thiết bị' }), 'X')
    await user.click(screen.getByRole('button', { name: 'Thêm thiết bị mới' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('devices[0].device_id')
    expect(status).toHaveTextContent('bắt đầu bằng chữ')
  })

  /* FE-MB-04: KPI card "Offline" ở Overview điều hướng kèm `?status=OFFLINE`.
   * Trước bản sửa, route `devices` render `ModbusRtuPage` vốn không đọc
   * `location.search` nên deep link ra danh sách đầy đủ, không lọc gì. */
  it('lọc theo ?status=OFFLINE từ deep link của Overview', async () => {
    renderAt('?status=OFFLINE')
    expect(await screen.findByText('ahu-1')).toBeInTheDocument()
    expect(screen.queryByText('meter-2')).not.toBeInTheDocument()
    /* Deep link phải HIỆN LÊN control, không chỉ lọc ngầm: người dùng cần thấy
     * cái gì đang lọc và bỏ được nó. */
    expect(screen.getByLabelText('Lọc theo trạng thái')).toHaveValue('OFFLINE')
    expect(screen.getByTestId('device-count')).toHaveTextContent('1/2 thiết bị')
  })

  it('lọc theo cổng RS-485', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText('ahu-1')
    await user.selectOptions(screen.getByLabelText('Lọc theo cổng'), '/dev/rs485-2')
    expect(screen.getByText('meter-2')).toBeInTheDocument()
    expect(screen.queryByText('ahu-1')).not.toBeInTheDocument()
  })

  it('tìm theo ID, tên hoặc slave ID', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText('ahu-1')
    await user.type(screen.getByLabelText('Tìm thiết bị'), 'Meter')
    expect(screen.getByText('meter-2')).toBeInTheDocument()
    expect(screen.queryByText('ahu-1')).not.toBeInTheDocument()
  })

  /* Bị lọc mà không bỏ được là kẹt: deep link từ Overview đưa người dùng vào
   * trạng thái lọc, nên phải có đường ra ngay trên trang. */
  it('bỏ lọc trả về danh sách đầy đủ', async () => {
    const user = userEvent.setup()
    renderAt('?status=OFFLINE')
    await screen.findByText('ahu-1')
    expect(screen.queryByText('meter-2')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bỏ lọc' }))
    expect(screen.getByText('meter-2')).toBeInTheDocument()
    expect(screen.getByTestId('device-count')).toHaveTextContent('2 thiết bị')
  })

  /* D-07: "chưa liên lạc lần nào" KHÔNG phải "mất liên lạc". Gộp hai thứ đó là
   * nói thiết bị đã hỏng trong khi ta chưa hỏi nó lần nào. */
  it('tách "chưa liên lạc lần nào" khỏi "mất liên lạc"', async () => {
    api.getModbusDiagnostics.mockResolvedValue([
      { device_id: 'ahu-1', slave_id: 7, online: false, total_polls: 0, total_errors: 0, timeout_errors: 0, crc_errors: 0, retry_attempts: 0, consecutive_errors: 0, last_seen_ms: 0 },
      { device_id: 'meter-2', slave_id: 9, online: false, total_polls: 9, total_errors: 9, timeout_errors: 9, crc_errors: 0, retry_attempts: 0, consecutive_errors: 3, last_seen_ms: 5 }
    ])
    renderAt('?status=NEVER')
    expect(await screen.findByText('ahu-1')).toBeInTheDocument()
    expect(screen.queryByText('meter-2')).not.toBeInTheDocument()
  })

  /* Mọi ô nhập phải có nhãn NHÌN THẤY ĐƯỢC. Placeholder biến mất ngay khi ô có
   * giá trị, mà mọi ô số ở đây đều có sẵn mặc định — người dùng chỉ thấy một
   * hàng số trần. */
  it('mọi ô số trong form đều có nhãn hiển thị', async () => {
    renderAt()
    await screen.findByText('ahu-1')
    for (const caption of ['Slave ID', 'Chu kỳ poll (ms)', 'Timeout (ms)',
                           'Số lần phát lại', 'Lỗi liên tiếp ⇒ Offline']) {
      expect(screen.getByText(caption)).toBeInTheDocument()
    }
  })

  /* `offline_probe_ms` thuộc về BUS. Backend không có trường đó trên Device nên
   * ô nhập cũ là ô ma: gõ vào rồi bị bỏ lặng lẽ. */
  it('form không còn ô chu kỳ dò lại Offline (thuộc về cổng)', async () => {
    renderAt()
    await screen.findByText('ahu-1')
    expect(screen.queryByLabelText('Chu kỳ thử lại Offline ms')).not.toBeInTheDocument()
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

  /* TF-MBRTU-08 (MBR-B307/B208): "Thử kết nối" là lệnh CHẠM DÂY thật, khác hẳn
   * cột "Liên lạc" vốn phản ánh telemetry của vòng poll định kỳ. Không có nút
   * này, kỹ thuật viên đứng cạnh tủ phải chờ trọn một chu kỳ poll để biết dây
   * vừa đấu đã thông chưa. */
  it('gọi commissioning thật khi bấm Thử kết nối và hiện thời gian phản hồi', async () => {
    api.testModbusConnection.mockResolvedValue({ result: 'ok', value: 1234, elapsed_us: 4200 })
    renderAt()

    const buttons = await screen.findAllByRole('button', { name: 'Thử kết nối' })
    await userEvent.click(buttons[0])

    expect(api.testModbusConnection).toHaveBeenCalledWith('ahu-1')
    expect(await screen.findByTestId('probe-ahu-1')).toHaveTextContent('4200 µs')
  })

  it('nói rõ thiết bị không trả lời thay vì im lặng', async () => {
    api.testModbusConnection.mockResolvedValue({ result: 'fail', reason: 'Connection timed out' })
    renderAt()

    const buttons = await screen.findAllByRole('button', { name: 'Thử kết nối' })
    await userEvent.click(buttons[0])
    expect(await screen.findByTestId('probe-ahu-1')).toHaveTextContent('Không trả lời: Connection timed out')
  })

  /* Đ-04: chạm thiết bị hiện trường cần Operator trở lên. Viewer thấy nút
   * nhưng bị khoá — mời họ bấm rồi trả 403 là thiết kế tệ hơn. */
  it('khoá nút Thử kết nối với vai trò viewer', async () => {
    auth.role = 'viewer'
    renderAt()
    const buttons = await screen.findAllByRole('button', { name: 'Thử kết nối' })
    expect(buttons[0]).toBeDisabled()
  })

  /* D-07 (phát hiện khi soi giao diện trên board 2026-08-06): trang nuốt im
   * lặng lỗi 503 của `/modbus/diagnostics`, nên cột "Liên lạc" hiện "—" mà
   * không nói vì sao. Người vận hành không phân biệt được "thiết bị im" với
   * "không đọc được authority". */
  it('nói rõ khi không đọc được telemetry thay vì chỉ hiện dấu gạch', async () => {
    api.getModbusDiagnostics.mockRejectedValue(new Error('iobus chưa publish telemetry Modbus RTU'))
    renderAt()
    const note = await screen.findByTestId('telemetry-warning')
    expect(note).toHaveTextContent('iobus chưa publish telemetry Modbus RTU')
    expect(note).toHaveTextContent('chưa biết')
  })
})
