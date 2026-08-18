import { describe, expect, it } from 'vitest'
import { previewEngineeringValue } from './InputsPage'
import { aoSignalRange, previewAoSignal } from './OutputsPage'
import type { AiInputConfig, AoConfig } from '../../shared/types'

/**
 * Khoá hành vi của `BB-7` — xem trước quy đổi (`T57-2.9`) và xem trước tín hiệu
 * ra (`T57-2.12`).
 *
 * Hai hàm này là **máy tính tay dùng đúng công thức thiết bị sẽ dùng**. Sai ở
 * đây không làm hỏng giao diện mà làm người vận hành tin vào một con số sai
 * ngay lúc họ đang quyết định cấu hình — nên chúng cần test riêng, không chỉ
 * được phủ gián tiếp qua render.
 */

function ai(overrides: Partial<AiInputConfig>): AiInputConfig {
  return {
    channel: 1, tag: 'UI-01', label: 'Test', signalType: 1, displayMin: 0, displayMax: 100,
    rangeMultiplier: 0, unit: 0, filterSamples: 0, sensorCal: 0, mathFunction: 0,
    enabled: true, note: '', ...overrides
  } as AiInputConfig
}

function ao(overrides: Partial<AoConfig>): AoConfig {
  return { id: 'AO-01', kind: 'AO', channel: 1, label: 'Van', mode: '0-10V', units: 0, minPv: 0, maxPv: 100, safeValue: 0, manualValue: 0, ...overrides } as AoConfig
}

describe('T57-2.9 — xem trước quy đổi ngõ vào', () => {
  it('0-10 V quy đổi tuyến tính đúng hai đầu và điểm giữa', () => {
    const config = ai({ signalType: 1, displayMin: -50, displayMax: 150 })
    expect(previewEngineeringValue(config, 0)).toBe(-50)
    expect(previewEngineeringValue(config, 10)).toBe(150)
    expect(previewEngineeringValue(config, 5)).toBe(50)
  })

  it('4-20 mA lấy đúng gốc 4 mA, không phải 0', () => {
    const config = ai({ signalType: 2, analogCurrent: true, displayMin: 0, displayMax: 100 })
    expect(previewEngineeringValue(config, 4), '4 mA phải là ĐẦU DẢI, không phải 25%').toBe(0)
    expect(previewEngineeringValue(config, 12)).toBe(50)
    expect(previewEngineeringValue(config, 20)).toBe(100)
  })

  it('2-10 V khác 0-10 V ở gốc dải', () => {
    const config = ai({ signalType: 2, analogCurrent: false, displayMin: 0, displayMax: 100 })
    expect(previewEngineeringValue(config, 2)).toBe(0)
    expect(previewEngineeringValue(config, 6)).toBe(50)
  })

  it('loại tín hiệu KHÔNG có dải thô tuyến tính thì trả null, không đoán', () => {
    for (const signalType of [0, 3, 4, 5, 6, 7, 8]) {
      expect(
        previewEngineeringValue(ai({ signalType: signalType as AiInputConfig['signalType'] }), 5),
        `signalType=${signalType} không có dải thô cố định — một con số đoán ở đây còn tệ hơn không có`
      ).toBeNull()
    }
  })
})

describe('T57-2.12 — xem trước tín hiệu ra AO', () => {
  it('0-10 V: giá trị kỹ thuật giữa dải cho ra giữa dải tín hiệu', () => {
    expect(previewAoSignal(ao({ minPv: 0, maxPv: 100 }), 50)).toBe(5)
  })

  it('4-20 mA: đầu dải kỹ thuật cho ra 4 mA, không phải 0', () => {
    const config = ao({ mode: '4-20mA', minPv: 0, maxPv: 100 })
    expect(previewAoSignal(config, 0), 'ra 0 mA nghĩa là mất tín hiệu, không phải "van đóng"').toBe(4)
    expect(previewAoSignal(config, 100)).toBe(20)
  })

  it('dải kỹ thuật suy biến trả null thay vì chia cho 0', () => {
    expect(previewAoSignal(ao({ minPv: 50, maxPv: 50 }), 50)).toBeNull()
  })

  it('dải nghịch (min > max) vẫn quy đổi đúng chiều nghịch', () => {
    // Van thường-mở: 0 % mở ⇒ 10 V, 100 % mở ⇒ 0 V.
    const config = ao({ minPv: 100, maxPv: 0 })
    expect(previewAoSignal(config, 100)).toBe(0)
    expect(previewAoSignal(config, 0)).toBe(10)
  })

  it('aoSignalRange phản ánh đúng hai chế độ', () => {
    expect(aoSignalRange('0-10V')).toEqual({ low: 0, high: 10, unit: 'V' })
    expect(aoSignalRange('4-20mA')).toEqual({ low: 4, high: 20, unit: 'mA' })
  })
})
