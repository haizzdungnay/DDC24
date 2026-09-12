import { describe, expect, it } from 'vitest'
import { formatTechnicalDate, formatTechnicalDateTime, formatTechnicalTime } from './dateTime'

describe('timestamp kỹ thuật 24 giờ và UTC', () => {
  it.each([
    ['2026-09-05T00:07:08Z', '00:07:08 UTC'],
    ['2026-09-05T12:07:08Z', '12:07:08 UTC'],
    ['2026-09-05T23:07:08Z', '23:07:08 UTC'],
  ])('khóa chu kỳ 24 giờ tại %s', (value, expected) => {
    expect(formatTechnicalTime(value, 'en-US')).toBe(expected)
    expect(formatTechnicalTime(value, 'vi-VN')).toBe(expected)
  })

  it('định dạng ngày theo locale nhưng giữ nguyên instant UTC khi đổi ngày', () => {
    const instant = '2026-09-05T23:30:00-02:00'
    expect(formatTechnicalDateTime(instant, 'vi-VN')).toBe('06/09/2026 · 01:30:00 UTC')
    expect(formatTechnicalDateTime(instant, 'en-US')).toBe('09/06/2026 · 01:30:00 UTC')
    expect(formatTechnicalDate(instant, 'vi-VN')).toBe('06/09/2026')
  })

  it.each([null, undefined, '', 'không-phải-thời-gian'])('fail-closed với mốc thiếu hoặc sai: %s', (value) => {
    expect(formatTechnicalTime(value, 'vi-VN')).toBe('—')
    expect(formatTechnicalDateTime(value, 'en-US')).toBe('—')
  })
})
