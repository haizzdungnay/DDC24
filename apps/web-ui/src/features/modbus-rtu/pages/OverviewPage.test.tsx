import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewPage } from './OverviewPage'

const api = vi.hoisted(() => ({
  getModbusOverview: vi.fn(),
  getModbusBuses: vi.fn(),
  getModbusEvents: vi.fn()
}))

vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

function renderPage() {
  render(
    <BrowserRouter>
      <OverviewPage />
    </BrowserRouter>
  )
}

describe('OverviewPage', () => {
  beforeEach(() => {
    api.getModbusOverview.mockResolvedValue({
      total_devices: 12,
      online: 9,
      offline: 2,
      initializing: 0,
      fault_config: 1,
      revision: 42,
      checksum: '9f3ac1',
      telemetry_available: true
    })
    api.getModbusBuses.mockResolvedValue([
      {
        bus_id: 'rs485-1',
        display_name: 'RS485-1 (Main Port)',
        port: '/dev/rs485-1',
        port_alias: 'ttyS5',
        open_state: 'RUNNING',
        baud: 19200,
        parity: 'N',
        data_bits: 8,
        stop_bits: 1,
        total_devices: 8,
        online_devices: 7,
        poll_latency_p50_ms: 24,
        poll_latency_p95_ms: 61,
        timeout_errors: 12,
        crc_errors: 0,
        bus_utilization_percent: 38
      },
      {
        bus_id: 'rs485-2',
        display_name: 'RS485-2 (Expansion Port)',
        port: '/dev/rs485-2',
        port_alias: 'ttyS1',
        open_state: 'RUNNING',
        baud: 19200,
        parity: 'N',
        data_bits: 8,
        stop_bits: 1,
        total_devices: 4,
        online_devices: 2,
        poll_latency_p50_ms: 18,
        poll_latency_p95_ms: 45,
        timeout_errors: 2,
        crc_errors: 1,
        bus_utilization_percent: 15
      }
    ])
    api.getModbusEvents.mockResolvedValue([
      {
        timestamp: '2026-08-05T10:41:02Z',
        bus_id: 'rs485-1',
        device_id: 'MTR-01',
        message: 'OFFLINE -> ONLINE',
        level: 'info'
      }
    ])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders 4 KPI cards, 2 RS485 bus cards and event feed', async () => {
    renderPage()

    expect(await screen.findByTestId('kpi-total')).toHaveTextContent('12')
    expect(screen.getByTestId('kpi-online')).toHaveTextContent('9')
    expect(screen.getByTestId('kpi-offline')).toHaveTextContent('2')
    expect(screen.getByTestId('kpi-fault')).toHaveTextContent('1')

    expect(screen.getByText('RS485-1 (Main Port)')).toBeInTheDocument()
    expect(screen.getByText('RS485-2 (Expansion Port)')).toBeInTheDocument()
    expect(screen.getByText('OFFLINE -> ONLINE')).toBeInTheDocument()

    expect(screen.getByTestId('p50-rs485-1')).toHaveTextContent('24 ms')
    expect(screen.getByTestId('util-rs485-1')).toHaveTextContent('38.0%')
  })

  /* TF-MBRTU-01 — D-07 ở tầng Overview.
   *
   * Bản trước lấy p50/p95/utilization từ hằng số viết cứng trong handler Go, nên
   * màn hình hiển thị "24 ms / 61 ms / 28 %" kể cả khi không có thiết bị nào
   * được đấu. Người vận hành không có cách nào phân biệt số thật với số trang
   * trí. Nay thiếu số đo là "—". */
  it('hiện "—" thay vì 0 khi iobus chưa đo được latency và utilization', async () => {
    api.getModbusBuses.mockResolvedValue([
      {
        bus_id: 'rs485-1',
        display_name: 'RS485-1',
        port: '/dev/rs485-1',
        port_alias: 'ttyS5',
        open_state: 'UNKNOWN',
        baud: 19200,
        parity: 'N',
        data_bits: 8,
        stop_bits: 1,
        total_devices: 0,
        online_devices: 0,
        poll_latency_p50_ms: null,
        poll_latency_p95_ms: null,
        timeout_errors: 0,
        crc_errors: 0,
        bus_utilization_percent: null
      }
    ])
    renderPage()

    expect(await screen.findByTestId('p50-rs485-1')).toHaveTextContent('—')
    expect(screen.getByTestId('p95-rs485-1')).toHaveTextContent('—')
    expect(screen.getByTestId('util-rs485-1')).toHaveTextContent('—')
    expect(screen.getByTestId('bus-state-rs485-1')).toHaveTextContent('UNKNOWN')
  })

  /* TF-MBRTU-02: telemetry chưa có ⇒ KPI runtime là "—" và có lời giải thích.
   * Hiện 0 online / 0 offline cho một hệ thống chưa poll lần nào là bịa. */
  it('không hiện số online/offline khi iobus chưa publish telemetry', async () => {
    api.getModbusOverview.mockResolvedValue({
      total_devices: 3,
      online: 0,
      offline: 0,
      initializing: 3,
      fault_config: 0,
      revision: 7,
      checksum: 'abc',
      telemetry_available: false
    })
    renderPage()

    expect(await screen.findByTestId('telemetry-missing')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('3')
    expect(screen.getByTestId('kpi-online')).toHaveTextContent('—')
    expect(screen.getByTestId('kpi-offline')).toHaveTextContent('—')
  })

  /* TF-MBRTU-03: không còn danh sách sự kiện mẫu. */
  it('hiện thông báo rỗng khi chưa quan sát được sự kiện nào', async () => {
    api.getModbusEvents.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('Chưa quan sát được lần chuyển trạng thái nào.')).toBeInTheDocument()
    expect(screen.queryByText(/MTR-01/)).not.toBeInTheDocument()
  })
})
