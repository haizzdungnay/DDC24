import { describe, expect, it } from 'vitest'
import { aoSignalToEngineering, previewAoSignal } from './OutputsPage'
import type { AoConfig } from '../../shared/types'

/**
 * Khoá hành vi cho `F-OUT-002` (2026-08-19).
 *
 * Triệu chứng: trang Outputs lấy thẳng số Core gửi về — luôn là TÍN HIỆU thô
 * volt/mA — rồi dán nhãn `units` của kênh lên. Kênh AO-03 "Chilled Water
 * Valve" trên board Foxlinx (`0-10V`, `units: percent`, dải 0-100) đang ra
 * 4,5 V = 45 % nhưng màn hình hiện "4,5 %": sai 10 lần trên một lệnh mở van.
 *
 * Bản vá quy đổi tín hiệu về dải kỹ thuật trước khi gắn nhãn. Test khoá đúng
 * hai mệnh đề: quy đổi phải khớp nghịch đảo `previewAoSignal` (cùng đường cong
 * đã hiện trong "Xem trước tín hiệu ra"), và dải suy biến phải trả `null` thay
 * vì một con số bịa.
 */

function ao(over: Partial<AoConfig>): AoConfig {
  return {
    channel: 1, mode: '0-10V', units: 'percent', minPv: 0, maxPv: 100,
    safeValue: 0, manualValue: 0, ...over
  } as AoConfig
}

describe('aoSignalToEngineering — tín hiệu thô về đúng dải kỹ thuật', () => {
  it('0-10V với dải 0-100 %: 4,5 V là 45 %, không phải 4,5 %', () => {
    expect(aoSignalToEngineering(ao({}), 4.5)).toBeCloseTo(45, 6)
  })

  it('4-20mA với dải 0-100 %: 12 mA là 50 % (giữa dải), 4 mA là 0 %', () => {
    const config = ao({ mode: '4-20mA' })
    expect(aoSignalToEngineering(config, 12)).toBeCloseTo(50, 6)
    expect(aoSignalToEngineering(config, 4)).toBeCloseTo(0, 6)
  })

  it('dải kỹ thuật không bắt đầu từ 0 vẫn đúng (0-50 Pa): 5 V là 25 Pa', () => {
    expect(aoSignalToEngineering(ao({ units: 'Pa', minPv: 0, maxPv: 50 }), 5)).toBeCloseTo(25, 6)
  })

  it('dải nghịch (maxPv < minPv) giữ đúng chiều: 0 V là 100 %, 10 V là 0 %', () => {
    const config = ao({ minPv: 100, maxPv: 0 })
    expect(aoSignalToEngineering(config, 0)).toBeCloseTo(100, 6)
    expect(aoSignalToEngineering(config, 10)).toBeCloseTo(0, 6)
  })

  it('đúng nghịch đảo của previewAoSignal — cùng đường cong với bảng xem trước', () => {
    const configs = [ao({}), ao({ mode: '4-20mA' }), ao({ units: 'degC', minPv: 10, maxPv: 30 })]
    for (const config of configs) {
      for (const pv of [config.minPv, (config.minPv + config.maxPv) / 2, config.maxPv]) {
        const signal = previewAoSignal(config, pv)
        expect(signal).not.toBeNull()
        expect(aoSignalToEngineering(config, signal as number)).toBeCloseTo(pv, 6)
      }
    }
  })

  it('dải suy biến (minPv = maxPv) trả null, không bịa số', () => {
    expect(aoSignalToEngineering(ao({ minPv: 50, maxPv: 50 }), 5)).toBeNull()
  })

  it('tín hiệu không hợp lệ trả null', () => {
    expect(aoSignalToEngineering(ao({}), Number.NaN)).toBeNull()
  })
})
