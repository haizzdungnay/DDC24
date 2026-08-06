import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MappingPage } from './MappingPage'

const api = vi.hoisted(() => ({ getModbusMapping: vi.fn() }))
vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

describe('MappingPage', () => {
  beforeEach(() => {
    api.getModbusMapping.mockResolvedValue({
      rows: [
        {
          point_id: 'MB-KWH', tag_name: 'meter kwh', device_id: 'mtr-1', bus_id: 'rs485-1',
          slave_id: 3, register_type: 'holding_register', address: 0, registers: 2,
          data_type: 'uint32', read_write: 'read', enabled: true
        },
        {
          point_id: 'MB-SAT', tag_name: 'ahu sat', device_id: 'ahu-1', bus_id: 'rs485-2',
          slave_id: 5, register_type: 'input_register', address: 100, registers: 1,
          data_type: 'int16', read_write: 'read', enabled: true
        }
      ],
      errors: [],
      load: [
        { bus_id: 'rs485-1', port: '/dev/rs485-1', baud: 19200, device_count: 1, point_count: 2,
          estimated_percent: 12.5, warn_percent: 50, reject_percent: 70 }
      ]
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('hiện vùng register của từng Point kèm số register chiếm dụng', async () => {
    render(<MappingPage />)
    expect(await screen.findByText('MB-KWH')).toBeInTheDocument()
    // uint32 chiếm hai register nên phải hiện dải, không phải một địa chỉ đơn.
    expect(screen.getByText('holding_register 0–1')).toBeInTheDocument()
    expect(screen.getByText('input_register 100')).toBeInTheDocument()
  })

  /* TF-MBRTU-06 — lỗi chặn apply phải hiện Ở ĐÂY, trước khi người dùng bấm
   * "Áp dụng" và nhận một lỗi 400 khó hiểu. */
  it('liệt kê lỗi validate kèm mã ổn định', async () => {
    api.getModbusMapping.mockResolvedValue({
      rows: [],
      errors: [
        { path: 'points[1].address', message: 'chồng vùng register với MB-KWH', reason: 'ADDRESS_OVERLAP' }
      ],
      load: []
    })
    render(<MappingPage />)
    const box = await screen.findByTestId('mapping-errors')
    expect(box).toHaveTextContent('ADDRESS_OVERLAP')
    expect(box).toHaveTextContent('points[1].address')
  })

  /* MBR-B207: tải bus vượt ngưỡng phải nhìn thấy được trước khi apply — một
   * cấu hình quá tải vẫn "lưu được" nhưng sẽ trượt deadline poll ngoài hiện
   * trường. */
  it('cảnh báo khi tải bus ước tính vượt ngưỡng từ chối', async () => {
    api.getModbusMapping.mockResolvedValue({
      rows: [],
      errors: [],
      load: [
        { bus_id: 'rs485-1', port: '/dev/rs485-1', baud: 9600, device_count: 8, point_count: 200,
          estimated_percent: 183.6, warn_percent: 50, reject_percent: 70 }
      ]
    })
    render(<MappingPage />)
    const card = await screen.findByTestId('load-rs485-1')
    expect(card).toHaveTextContent('183.6%')
    expect(card).toHaveTextContent('Vượt ngưỡng')
  })

  it('hiện thông báo rỗng khi bản nháp chưa có Point nào', async () => {
    api.getModbusMapping.mockResolvedValue({ rows: [], errors: [], load: [] })
    render(<MappingPage />)
    expect(await screen.findByText('Chưa có Point nào trong bản nháp.')).toBeInTheDocument()
  })
})
