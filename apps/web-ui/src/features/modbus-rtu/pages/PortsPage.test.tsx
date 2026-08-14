import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortsPage } from './PortsPage'
import { ApiError } from '../../../shared/types'
import { I18nProvider } from '../../../shared/i18n'

const api = vi.hoisted(() => ({
  getModbusBuses: vi.fn(),
  getModbusPorts: vi.fn(),
  updateModbusBus: vi.fn()
}))
vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

const auth = vi.hoisted(() => ({ role: 'admin' as string }))
vi.mock('../../auth', () => ({
  useAuth: () => ({ session: { role: auth.role } }),
  roleAtLeast: (role: string | undefined, min: string) => {
    const order = ['viewer', 'operator', 'admin']
    return order.indexOf(role ?? '') >= order.indexOf(min)
  }
}))

function bus(busID: string, extra: Record<string, unknown> = {}) {
  return {
    bus_id: busID,
    display_name: busID.toUpperCase(),
    port: `/dev/${busID}`,
    port_alias: busID === 'rs485-1' ? 'ttyS5' : 'ttyS1',
    open_state: 'RUNNING',
    baud: 19200,
    parity: 'N',
    data_bits: 8,
    stop_bits: 1,
    offline_probe_ms: 5000,
    enabled: true,
    total_devices: 0,
    online_devices: 0,
    poll_latency_p50_ms: null,
    poll_latency_p95_ms: null,
    bus_utilization_percent: null,
    timeout_errors: 0,
    crc_errors: 0,
    ...extra
  }
}

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/modbus-rtu/ports']}>
        <PortsPage />
      </MemoryRouter>
    </I18nProvider>
  )
}

describe('PortsPage', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('mkddc-lang', 'vi')
    auth.role = 'admin'
    api.getModbusPorts.mockResolvedValue([
      { port: '/dev/rs485-1', alias: 'ttyS5', description: 'RS485-1 (cổng chính)', max_baud: 115200 },
      { port: '/dev/rs485-2', alias: 'ttyS1', description: 'RS485-2 (Header P16)', max_baud: 115200 }
    ])
    api.getModbusBuses.mockResolvedValue([bus('rs485-1'), bus('rs485-2', { baud: 9600, parity: 'E' })])
    api.updateModbusBus.mockResolvedValue({ bus: bus('rs485-1') })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  /* Sản phẩm có HAI cổng RS-485 (OD-MBRTU-001). Trang chỉ hiện một cổng nghĩa là
   * cổng còn lại không cấu hình được từ giao diện — đúng tình trạng trước đây. */
  it('hiện đủ hai cổng RS-485', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-card-rs485-1')).toBeInTheDocument())
    expect(screen.getByTestId('port-card-rs485-2')).toBeInTheDocument()
  })

  it('nạp form từ cấu hình đang lưu của TỪNG cổng, không dùng chung mặc định', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-card-rs485-2')).toBeInTheDocument())
    expect(screen.getByLabelText('Baud rs485-1')).toHaveValue('19200')
    expect(screen.getByLabelText('Baud rs485-2')).toHaveValue('9600')
    expect(screen.getByLabelText('Parity rs485-2')).toHaveValue('E')
  })

  /* "Áp dụng riêng cho từng cổng": bấm áp ở cổng 1 không được đụng tới cổng 2.
   * Hai sợi dây là hai miền vật lý tách biệt; gộp lại buộc người vận hành chạm
   * vào dây đang chạy tốt khi họ chỉ muốn sửa dây kia. */
  it('áp cấu hình chỉ cho đúng cổng được bấm', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-card-rs485-2')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Baud rs485-2'), { target: { value: '38400' } })
    const card = screen.getByTestId('port-card-rs485-2')
    fireEvent.click(within(card).getByRole('button', { name: /Áp dụng cho cổng này/ }))

    await waitFor(() => expect(api.updateModbusBus).toHaveBeenCalledTimes(1))
    const [busID, payload] = api.updateModbusBus.mock.calls[0]
    expect(busID).toBe('rs485-2')
    expect(payload.baud).toBe(38400)
  })

  /* `bus_id`, `port`, `data_bits`, `direction` là sự thật phần cứng. Gửi chúng
   * lên nghĩa là mở đường cho giao diện trỏ hai bus vào cùng một device node. */
  it('không gửi các trường thuộc phần cứng lên backend', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-card-rs485-1')).toBeInTheDocument())
    const card = screen.getByTestId('port-card-rs485-1')
    fireEvent.click(within(card).getByRole('button', { name: /Áp dụng cho cổng này/ }))

    await waitFor(() => expect(api.updateModbusBus).toHaveBeenCalledTimes(1))
    const payload = api.updateModbusBus.mock.calls[0][1]
    for (const forbidden of ['bus_id', 'port', 'data_bits', 'direction']) {
      expect(payload).not.toHaveProperty(forbidden)
    }
  })

  /* Đổi khung truyền của dây ảnh hưởng MỌI thiết bị trên dây. Người vận hành
   * phải biết trước, không phải phát hiện bằng cách mất liên lạc hàng loạt. */
  it('cảnh báo khi cổng đang có thiết bị', async () => {
    api.getModbusBuses.mockResolvedValue([bus('rs485-1', { total_devices: 3 }), bus('rs485-2')])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-warning-rs485-1')).toBeInTheDocument())
    expect(screen.getByTestId('port-warning-rs485-1')).toHaveTextContent('3 thiết bị')
    expect(screen.queryByTestId('port-warning-rs485-2')).not.toBeInTheDocument()
  })

  /* Backend trả `details[]`; hiện mỗi "validation failed" thì người dùng không
   * có đường tự sửa. */
  it('hiện chi tiết trường sai chứ không chỉ câu tóm tắt', async () => {
    api.updateModbusBus.mockRejectedValue(
      new ApiError('validation failed', 400, [
        { path: 'buses[0].baud', message: 'phải trong 1200..115200', reason: 'OUT_OF_RANGE' }
      ])
    )
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-card-rs485-1')).toBeInTheDocument())
    const card = screen.getByTestId('port-card-rs485-1')
    fireEvent.click(within(card).getByRole('button', { name: /Áp dụng cho cổng này/ }))

    await waitFor(() => {
      expect(screen.getByTestId('port-status-rs485-1')).toHaveTextContent('buses[0].baud')
    })
    expect(screen.getByTestId('port-status-rs485-1')).toHaveTextContent('phải trong 1200..115200')
  })

  it('vai trò không đủ quyền thì khoá form thay vì để bấm rồi bị từ chối', async () => {
    auth.role = 'operator'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('port-card-rs485-1')).toBeInTheDocument())
    expect(screen.getByLabelText('Baud rs485-1')).toBeDisabled()
  })
})
