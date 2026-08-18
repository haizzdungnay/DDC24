import { describe, expect, it } from 'vitest'
import { computeClockDelta, formatClockDelta } from './TimeSettingsPage'

/**
 * Test khoá HÀNH VI cho `T57-1.8` — cảnh báo hậu quả khi đổi giờ hệ thống
 * (đề xuất §6.17-P1).
 *
 * Mệnh đề quan trọng nhất: hướng dịch chuyển phải tính từ giờ THIẾT BỊ, không
 * phải giờ máy trạm. Máy trạm lệch giờ là chuyện thường ở công trường, và nếu
 * tính sai hướng thì cảnh báo "bạn đang LÙI đồng hồ" sẽ hiện nhầm lúc — hoặc
 * tệ hơn, KHÔNG hiện đúng lúc.
 */

describe('computeClockDelta', () => {
  it('giờ đích sau giờ thiết bị ⇒ dương (tiến)', () => {
    expect(computeClockDelta('2026-08-18T10:05:00Z', '2026-08-18T10:00:00Z')).toBe(300)
  })

  it('giờ đích trước giờ thiết bị ⇒ ÂM (lùi) — đây là ca nguy hiểm', () => {
    expect(computeClockDelta('2026-08-18T09:00:00Z', '2026-08-18T10:00:00Z')).toBe(-3600)
  })

  it('so sánh theo mốc tuyệt đối nên hai chuỗi khác múi giờ vẫn đúng', () => {
    // 17:00+07:00 chính là 10:00Z ⇒ lệch 0, không phải 7 giờ.
    expect(computeClockDelta('2026-08-18T17:00:00+07:00', '2026-08-18T10:00:00Z')).toBe(0)
  })

  it('thiếu một trong hai mốc ⇒ null, giao diện KHÔNG được đoán hướng', () => {
    expect(computeClockDelta(undefined, '2026-08-18T10:00:00Z')).toBeNull()
    expect(computeClockDelta('2026-08-18T10:00:00Z', undefined)).toBeNull()
    expect(computeClockDelta('', '2026-08-18T10:00:00Z')).toBeNull()
  })

  it('chuỗi không phân giải được ⇒ null thay vì NaN', () => {
    expect(computeClockDelta('không phải ngày', '2026-08-18T10:00:00Z')).toBeNull()
  })
})

describe('formatClockDelta', () => {
  it('nói rõ hướng bằng CHỮ, không chỉ bằng dấu âm', () => {
    expect(formatClockDelta(-3600)).toMatch(/^lùi /)
    expect(formatClockDelta(3600)).toMatch(/^tiến /)
  })

  it('dưới một phút hiện theo giây', () => {
    expect(formatClockDelta(-45)).toBe('lùi 45 giây')
  })

  it('dưới một giờ hiện phút và giây', () => {
    expect(formatClockDelta(-125)).toBe('lùi 2 phút 5 giây')
  })

  it('từ một giờ trở lên hiện giờ và phút', () => {
    expect(formatClockDelta(-7860)).toBe('lùi 2 giờ 11 phút')
  })
})
