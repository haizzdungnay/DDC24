import { describe, expect, it } from 'vitest'
import { aoSafeConsequence, doSafeConsequence } from './OutputsPage'
import type { AoConfig } from '../../shared/types'

/**
 * Test khoá HÀNH VI cho `T57-1.7` — diễn giải hậu quả `safeState`/`safeValue`
 * bằng ngôn ngữ vận hành (đề xuất §6.10-P1b).
 *
 * Hai mệnh đề đối lập nhau được khoá cùng lúc:
 *  - câu mô tả PHẢI nói ra hậu quả **điện** cụ thể theo giá trị đang chọn;
 *  - câu mô tả **KHÔNG** được khẳng định thiết bị đầu cuối là gì (van/quạt/bơm),
 *    vì hệ thống chưa có trường "thuộc thiết bị" (`T57-3.1`). Viết "van sẽ đóng"
 *    khi không biết đó có phải van hay không chính là bịa.
 */

function ao(over: Partial<AoConfig>): AoConfig {
  return {
    channel: 1, mode: '0-10V', units: 'percent', minPv: 0, maxPv: 100,
    safeValue: 0, manualValue: 0, ...over
  } as AoConfig
}

describe('doSafeConsequence — hai lựa chọn cho hai hậu quả điện khác nhau', () => {
  it('closed nói rõ tiếp điểm ĐÓNG và tải CÓ điện', () => {
    const text = doSafeConsequence('closed')
    expect(text).toMatch(/ĐÓNG/)
    expect(text).toMatch(/CÓ điện/)
  })

  it('open nói rõ tiếp điểm HỞ và tải MẤT điện', () => {
    const text = doSafeConsequence('open')
    expect(text).toMatch(/HỞ/)
    expect(text).toMatch(/MẤT điện/)
  })

  it('hai lựa chọn cho ra hai câu KHÁC NHAU, không phải một dòng trợ giúp tĩnh', () => {
    expect(doSafeConsequence('open')).not.toBe(doSafeConsequence('closed'))
  })

  it('nói ra khi nào trạng thái an toàn có hiệu lực, không chỉ nói giá trị', () => {
    expect(doSafeConsequence('open')).toMatch(/mất liên lạc|mất quyền điều khiển|khởi động lại/i)
  })

  it('KHÔNG khẳng định thiết bị đầu cuối là van hay quạt — chưa có dữ liệu đó', () => {
    for (const state of ['open', 'closed'] as const) {
      const text = doSafeConsequence(state)
      // Chỉ được NHẮC người dùng đối chiếu, không được kết luận thay họ.
      expect(text).toMatch(/Đối chiếu với cơ cấu thật/)
    }
  })
})

describe('aoSafeConsequence — vị trí trong dải và bẫy dưới 4 mA', () => {
  it('0 V trên dải 0-10V là ĐẦU THẤP', () => {
    expect(aoSafeConsequence(ao({ mode: '0-10V', safeValue: 0 }), 'Safe value')).toMatch(/ĐẦU THẤP/)
  })

  it('10 V trên dải 0-10V là ĐẦU CAO', () => {
    expect(aoSafeConsequence(ao({ mode: '0-10V', safeValue: 10 }), 'Safe value')).toMatch(/ĐẦU CAO/)
  })

  it('giá trị ở giữa được nói là giữa dải, không bị gộp vào một trong hai đầu', () => {
    const text = aoSafeConsequence(ao({ mode: '0-10V', safeValue: 5 }), 'Safe value')
    expect(text).toMatch(/giữa dải/)
    expect(text).not.toMatch(/ĐẦU THẤP|ĐẦU CAO/)
  })

  it('dưới 4 mA trên vòng 4-20mA phải CẢNH BÁO là bị hiểu thành đứt dây', () => {
    // Đây là bẫy hiện trường thật: đặt safe value 0 mA trên một vòng 4-20 mA
    // không phải "lệnh 0%", mà là tín hiệu mà cơ cấu đọc là ĐỨT DÂY.
    const text = aoSafeConsequence(ao({ mode: '4-20mA', safeValue: 0 }), 'Safe value')
    expect(text).toMatch(/ĐỨT DÂY/)
  })

  it('4 mA trên vòng 4-20mA KHÔNG bị cảnh báo đứt dây', () => {
    expect(aoSafeConsequence(ao({ mode: '4-20mA', safeValue: 4 }), 'Safe value')).not.toMatch(/ĐỨT DÂY/)
  })

  it('0 V trên dải 0-10V KHÔNG bị cảnh báo đứt dây — cảnh báo đó chỉ đúng cho vòng dòng', () => {
    expect(aoSafeConsequence(ao({ mode: '0-10V', safeValue: 0 }), 'Safe value')).not.toMatch(/ĐỨT DÂY/)
  })

  it('nói rõ đây là tín hiệu ĐIỆN, không phải phần trăm hành trình', () => {
    expect(aoSafeConsequence(ao({ safeValue: 5 }), 'Safe value')).toMatch(/tín hiệu ĐIỆN/)
  })

  it('kèm đơn vị đúng theo chế độ tín hiệu', () => {
    expect(aoSafeConsequence(ao({ mode: '0-10V', safeValue: 5 }), 'Safe value')).toMatch(/5 V/)
    expect(aoSafeConsequence(ao({ mode: '4-20mA', safeValue: 12 }), 'Safe value')).toMatch(/12 mA/)
  })
})
