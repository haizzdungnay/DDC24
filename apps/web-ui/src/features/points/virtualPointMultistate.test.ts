import { describe, expect, it } from 'vitest'
import { parseValue, sanitizeStates } from './VirtualIoPage'
import { formatPointValue } from '../../shared/utils'

/* `ISS-PIO-17`/`F-PIO-014` — kiểu `multistate` (đề bài §15). */

describe('sanitizeStates', () => {
  it('cắt khoảng trắng nhãn và sắp theo giá trị', () => {
    expect(sanitizeStates([
      { value: 3, label: '  Emergency ' },
      { value: 0, label: 'Off' },
      { value: 1, label: 'Auto' },
    ])).toEqual([
      { value: 0, label: 'Off' },
      { value: 1, label: 'Auto' },
      { value: 3, label: 'Emergency' },
    ])
  })

  it('KHÔNG đánh số lại — value là danh tính của state', () => {
    // Đánh số lại sẽ làm mọi binding và mọi lịch trình đang trỏ tới state cũ
    // âm thầm đổi nghĩa.
    expect(sanitizeStates([{ value: 10, label: 'Auto' }, { value: 20, label: 'Manual' }]))
      .toEqual([{ value: 10, label: 'Auto' }, { value: 20, label: 'Manual' }])
  })

  it('bỏ state không có nhãn và state âm', () => {
    expect(sanitizeStates([
      { value: 0, label: 'Off' },
      { value: 1, label: '   ' },
      { value: -1, label: 'Auto' },
      { value: 2, label: 'Manual' },
    ])).toEqual([{ value: 0, label: 'Off' }, { value: 2, label: 'Manual' }])
  })

  it('danh sách rỗng sau khi dọn thì trả ví dụ §15, không trả mảng rỗng', () => {
    // Web-api từ chối multistate dưới hai state; gửi `[]` chỉ đổi một form dở
    // dang thành một lỗi 400.
    expect(sanitizeStates([]).length).toBe(4)
    expect(sanitizeStates([{ value: 0, label: '  ' }])).toEqual([
      { value: 0, label: 'Off' },
      { value: 1, label: 'Auto' },
      { value: 2, label: 'Manual' },
      { value: 3, label: 'Emergency' },
    ])
  })
})

describe('formatPointValue', () => {
  it('hiện nhãn state kèm số cho điểm multistate', () => {
    expect(formatPointValue({ value: 1, signalType: 'multistate', stateLabel: 'Auto' })).toBe('Auto (1)')
  })

  it('nhãn rỗng ⇒ hiện con số trần, KHÔNG bịa nhãn', () => {
    // Rỗng nghĩa là giá trị hiện tại không thuộc danh sách khai báo; bịa một
    // nhãn ở đây là nói dối về trạng thái thiết bị.
    expect(formatPointValue({ value: 9, signalType: 'multistate' })).toBe('9')
    expect(formatPointValue({ value: 9, signalType: 'multistate', stateLabel: '  ' })).toBe('9')
  })

  it('không đụng vào các kiểu tín hiệu khác', () => {
    expect(formatPointValue({ value: 21.4, unit: '°C', signalType: 'float' })).toBe('21.4 °C')
    expect(formatPointValue({ value: true, signalType: 'boolean' })).toBe('ON')
  })
})

describe('parseValue cho multistate', () => {
  it('nhận state nguyên không âm', () => {
    expect(parseValue('multistate', '2')).toBe(2)
    expect(parseValue('multistate', '0')).toBe(0)
  })

  it('KHÔNG cắt phần thập phân — 2.5 không được âm thầm thành state 2', () => {
    // `Math.trunc(2.5)` cho 2, một state thường có thật, nên cắt ở đây sẽ gửi
    // lên một giá trị đã bị đổi nghĩa mà người dùng không hề biết. Web-api từ
    // chối đúng như vậy; FE phải nói cùng một điều.
    expect(() => parseValue('multistate', '2.5')).toThrow()
  })

  it('từ chối state âm và chuỗi không phải số', () => {
    expect(() => parseValue('multistate', '-1')).toThrow()
    expect(() => parseValue('multistate', 'auto')).toThrow()
  })
})
