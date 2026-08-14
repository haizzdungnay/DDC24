import { describe, expect, it } from 'vitest'
import type { Point } from './types'
import { NO_DATA, formatValue, isChannelNotConfigured, pointNumber } from './utils'


// REV-FE-04: nơi hiển thị và nơi tính toán phải phân biệt "chưa có số đo" với 0.
describe('formatValue và pointNumber với dữ liệu chưa đo', () => {
  it('formatValue hiện NO_DATA thay vì 0 hay "undefined"', () => {
    expect(formatValue(undefined)).toBe(NO_DATA)
    expect(formatValue(undefined, 'degC')).toBe(NO_DATA)
    expect(formatValue(Number.NaN)).toBe(NO_DATA)
  })

  it('formatValue giữ nguyên số 0 đo được', () => {
    expect(formatValue(0, 'degC')).toBe('0.0 degC')
    expect(formatValue(false)).toBe('OFF')
  })

  it('pointNumber trả null khi chưa có số đo, không trả 0', () => {
    const base: Omit<Point, 'value'> = { id: 'UI-01', tag: 'ui1', name: 'UI 1', kind: 'UI', quality: 'good', source: 'Core', updatedAt: '2026-08-08T00:00:00Z' }
    expect(pointNumber({ ...base, value: undefined })).toBeNull()
    expect(pointNumber({ ...base, value: 'không phải số' })).toBeNull()
    expect(pointNumber({ ...base, value: 0 })).toBe(0)
    expect(pointNumber({ ...base, value: true })).toBe(1)
    expect(pointNumber({ ...base, value: 21.5 })).toBe(21.5)
  })
})

// F-DASH-LOCALIO-01: kênh Signal Type "none" là chủ ý chưa nối, không phải fault.
describe('isChannelNotConfigured', () => {
  it('true khi signalType là "none" (không phân biệt hoa/thường, khoảng trắng)', () => {
    expect(isChannelNotConfigured({ signalType: 'none' })).toBe(true)
    expect(isChannelNotConfigured({ signalType: 'None' })).toBe(true)
    expect(isChannelNotConfigured({ signalType: ' NONE ' })).toBe(true)
  })

  it('false với signal type thật hoặc thiếu field', () => {
    expect(isChannelNotConfigured({ signalType: '0-10V' })).toBe(false)
    expect(isChannelNotConfigured({ signalType: undefined })).toBe(false)
    expect(isChannelNotConfigured({ signalType: '' })).toBe(false)
  })
})
