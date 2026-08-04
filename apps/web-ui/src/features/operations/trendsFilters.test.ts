import { describe, expect, it } from 'vitest'
import { filterTrendSamplesByRange, localDateTimeInputValue, parseTrendCustomRange } from './trendsFilters'

/* BL-008: bộ chọn khoảng thời gian làm việc theo giờ địa phương.
 *
 * Điều kiện đúng đắn quan trọng nhất là HAI CHIỀU KHỚP NHAU: chuỗi do
 * localDateTimeInputValue() sinh ra, khi đưa lại cho parseTrendCustomRange(),
 * phải cho đúng mốc thời gian ban đầu. Nếu một chiều dùng UTC còn chiều kia dùng
 * giờ địa phương thì người dùng ở UTC+7 sẽ truy vấn lệch 7 tiếng mà giao diện
 * không hề báo. Test viết theo cách không phụ thuộc múi giờ của máy chạy CI. */
describe('Trends local-time range', () => {
  it('đọc chuỗi datetime-local theo giờ địa phương', () => {
    const range = parseTrendCustomRange('2026-07-18T01:02', '2026-07-20T03:04',
                                        new Date('2026-07-20T04:00').getTime())
    expect(range).toEqual({
      fromMs: new Date('2026-07-18T01:02').getTime(),
      toMs: new Date('2026-07-20T03:04').getTime()
    })
  })

  it('round-trip: hiển thị rồi đọc lại cho đúng mốc thời gian ban đầu', () => {
    const original = new Date(2026, 6, 20, 14, 30, 0, 0)   // 14:30 giờ địa phương
    const text = localDateTimeInputValue(original)
    expect(text).toBe('2026-07-20T14:30')
    const later = new Date(2026, 6, 20, 15, 0, 0, 0)
    const range = parseTrendCustomRange(text, localDateTimeInputValue(later), later.getTime() + 60_000)
    expect(range.fromMs).toBe(original.getTime())
    expect(range.toMs).toBe(later.getTime())
  })

  it('allows ranges older than 24 hours and rejects future or reversed bounds', () => {
    const now = new Date('2026-07-20T04:00').getTime()
    expect(() => parseTrendCustomRange('2026-01-01T00:00', '2026-07-20T03:00', now)).not.toThrow()
    expect(() => parseTrendCustomRange('2026-07-20T03:00', '2026-07-20T02:00', now)).toThrow(/before/i)
    expect(() => parseTrendCustomRange('2026-07-20T03:00', '2026-07-20T05:00', now)).toThrow(/future/i)
  })

  it('định dạng Date theo thành phần giờ địa phương', () => {
    expect(localDateTimeInputValue(new Date(2026, 6, 20, 3, 4, 5))).toBe('2026-07-20T03:04')
  })

  it('keeps legacy adapter filtering half-open at the To boundary', () => {
    const samples = [
      { time: 'a', __ts: 1000, value: 1 },
      { time: 'b', __ts: 2000, value: 2 }
    ]
    expect(filterTrendSamplesByRange(samples, 1000, 2000)).toHaveLength(1)
  })
})
