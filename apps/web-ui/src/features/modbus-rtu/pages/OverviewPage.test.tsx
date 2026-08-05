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

describe('OverviewPage', () => {
  beforeEach(() => {
    api.getModbusOverview.mockResolvedValue({
      total_devices: 12,
      online: 9,
      offline: 2,
      fault_config: 1,
      revision: 42,
      checksum: '9f3ac1'
    })
    api.getModbusBuses.mockResolvedValue([
      {
        bus_id: 'RS485-1',
        display_name: 'RS485-1 (Main Port)',
        port: '/dev/rs485-1',
        port_alias: 'ttyS5',
        open_state: 'OPEN',
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
        bus_id: 'RS485-2',
        display_name: 'RS485-2 (Expansion Port)',
        port: '/dev/rs485-2',
        port_alias: 'ttyS1',
        open_state: 'OPEN',
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
      { timestamp: '10:41:02', bus_id: 'RS485-1', device_id: 'MTR-01', message: 'OFFLINE -> ONLINE', level: 'info' }
    ])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders 4 KPI cards, 2 RS485 bus cards and event feed', async () => {
    render(
      <BrowserRouter>
        <OverviewPage />
      </BrowserRouter>
    )

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    expect(screen.getByText('RS485-1 (Main Port)')).toBeInTheDocument()
    expect(screen.getByText('RS485-2 (Expansion Port)')).toBeInTheDocument()
    expect(screen.getByText('OFFLINE -> ONLINE')).toBeInTheDocument()
  })
})
