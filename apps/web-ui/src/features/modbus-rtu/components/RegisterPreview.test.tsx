import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModbusRTUPoint } from '../../../shared/types'
import { RegisterPreview, overlaps, registerFootprint, scaleSample } from './RegisterPreview'

function point(overrides: Partial<ModbusRTUPoint> = {}): ModbusRTUPoint {
  return {
    point_id: 'MB-A', device_id: 'mtr-1', tag_name: 'a', display_name: 'A',
    register_type: 'holding_register', address: 0, data_type: 'uint16',
    byte_order: 'big', word_order: 'high_low', scale: 1, offset: 0, unit: '',
    read_write: 'read', default_value: 0, safe_value: 0, enabled: true, ...overrides
  }
}

afterEach(cleanup)

describe('registerFootprint', () => {
  it('kiểu 32-bit chiếm HAI register', () => {
    expect(registerFootprint({ address: 10, data_type: 'float32' })).toEqual({ start: 10, width: 2, end: 11 })
    expect(registerFootprint({ address: 10, data_type: 'uint32' })).toEqual({ start: 10, width: 2, end: 11 })
    expect(registerFootprint({ address: 10, data_type: 'uint16' })).toEqual({ start: 10, width: 1, end: 10 })
  })
})

describe('overlaps', () => {
  /* DATA_MODEL §5.5 — hai Point cùng vùng register là hai danh tính cho MỘT ô
   * nhớ; khi ghi chúng đè nhau theo thứ tự không xác định. */
  it('phát hiện điểm 16-bit nằm trong dải của điểm 32-bit', () => {
    expect(overlaps(
      { address: 10, data_type: 'float32' },
      { address: 11, data_type: 'uint16' }
    )).toBe(true)
  })

  it('không báo chồng khi hai dải rời nhau', () => {
    expect(overlaps(
      { address: 10, data_type: 'float32' },
      { address: 12, data_type: 'uint16' }
    )).toBe(false)
  })

  /* Hai bit KHÁC NHAU trong cùng register là hợp lệ và rất phổ biến ở thanh ghi
   * trạng thái của VFD/đồng hồ (OD-MBRTU-003). Báo lỗi ở đây sẽ chặn một cấu
   * hình đúng. */
  it('cho phép hai bit_index khác nhau trong cùng một register', () => {
    expect(overlaps(
      { address: 5, data_type: 'bool', bit_index: 0 },
      { address: 5, data_type: 'bool', bit_index: 1 }
    )).toBe(false)
  })

  it('vẫn chặn hai Point cùng bit_index', () => {
    expect(overlaps(
      { address: 5, data_type: 'bool', bit_index: 2 },
      { address: 5, data_type: 'bool', bit_index: 2 }
    )).toBe(true)
  })
})

describe('scaleSample', () => {
  it('quy đổi theo scale và offset', () => {
    expect(scaleSample(100, 0.1, -10)).toBeCloseTo(0)
    expect(scaleSample(1000, 0.1, -10)).toBeCloseTo(90)
  })

  /* D-02: scale = 0 từng làm encode_register tính raw = 0 rồi trả `true`, tức
   * GHI IM LẶNG giá trị 0 xuống thiết bị hiện trường. Bản xem trước phải nói rõ
   * thay vì hiện một số vô nghĩa. */
  it('trả null khi scale không hợp lệ thay vì hiện một số bịa', () => {
    expect(scaleSample(100, 0, 0)).toBeNull()
    expect(scaleSample(100, Number.NaN, 0)).toBeNull()
  })
})

describe('RegisterPreview', () => {
  it('hiện dấu chân register và cảnh báo chồng lấn', () => {
    render(
      <RegisterPreview
        point={point({ address: 10, data_type: 'float32', scale: 0.1, offset: -10, unit: 'degC' })}
        siblings={[point({ point_id: 'MB-OTHER', address: 11, data_type: 'uint16' })]}
        selfPointId="MB-A"
      />
    )
    expect(screen.getByTestId('footprint')).toHaveTextContent('holding_register 10–11 (2 register)')
    expect(screen.getByTestId('overlap-warning')).toHaveTextContent('MB-OTHER')
    expect(screen.getByTestId('sample-100')).toHaveTextContent('0 degC')
  })

  it('không cảnh báo khi không có điểm nào chồng vùng', () => {
    render(
      <RegisterPreview
        point={point({ address: 10, data_type: 'uint16' })}
        siblings={[point({ point_id: 'MB-OTHER', address: 20 })]}
        selfPointId="MB-A"
      />
    )
    expect(screen.queryByTestId('overlap-warning')).not.toBeInTheDocument()
  })

  it('nói rõ scale không hợp lệ thay vì hiện số quy đổi', () => {
    render(<RegisterPreview point={point({ scale: 0 })} />)
    expect(screen.getByTestId('sample-100')).toHaveTextContent('scale không hợp lệ')
  })
})
