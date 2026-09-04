import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import {
  OptionalNumberInput,
  displayRangeLimits,
  engineeringLimits,
  normalizeVirtualPoint,
  numericSignalType
} from './VirtualIoPage'
import type { VirtualPoint } from '../../shared/types'

/* `ISS-PIO-15` — biên KỸ THUẬT cho điểm ảo (F-PIO-016).
 *
 * `displayMin`/`displayMax` là thang HIỂN THỊ; không đường nào từ chối một lệnh
 * ghi 45 °C vào setpoint khai dải 16–30 °C. Điểm Modbus cùng hệ đã có
 * `min_value`/`max_value` đúng nghĩa — hai nguồn Point, hai mức nghiêm ngặt.
 */

afterEach(cleanup)

function vp(overrides: Partial<VirtualPoint> = {}): VirtualPoint {
  return {
    id: 'VP1', channel: 25, tag: 'SAT_SETPOINT', name: 'SAT', label: 'SAT',
    signalType: 'float', enabled: true, writable: true, logEnabled: false,
    value: 22, unit: 'degC', ...overrides
  }
}

describe('dải thang hiển thị phụ thuộc unit', () => {
  /* Bản cũ ghi cứng [-50, 205] cho MỌI unit ở frontend trong khi web-api cho
   * `Pa` tới 2000. Một setpoint áp suất tĩnh 250 Pa hợp lệ ở backend bị ô nhập
   * KẸP xuống 205 — không thông báo, không cách nào gõ đúng số. */
  it('cho Pa tới 2000 và ppm tới 5000, khớp web-api', () => {
    expect(displayRangeLimits('Pa')).toEqual([-50, 2000])
    expect(displayRangeLimits('ppm')).toEqual([0, 5000])
    expect(displayRangeLimits('degC')).toEqual([-50, 205])
    expect(displayRangeLimits(undefined)).toEqual([-50, 205])
  })

  it('chuẩn hoá KHÔNG kẹp displayMax 250 Pa xuống 205', () => {
    const next = normalizeVirtualPoint(vp({ unit: 'Pa', displayMin: 0, displayMax: 250 }))
    expect(next.displayMax).toBe(250)
  })

  // Và vẫn kẹp thật khi vượt trần của chính unit đó — nới không phải là bỏ.
  it('vẫn kẹp khi vượt trần của unit', () => {
    const next = normalizeVirtualPoint(vp({ unit: 'Pa', displayMin: 0, displayMax: 9999 }))
    expect(next.displayMax).toBe(2000)
  })
})

describe('biên kỹ thuật', () => {
  it('chỉ áp dụng cho kiểu số', () => {
    expect(numericSignalType('float')).toBe(true)
    expect(numericSignalType('integer')).toBe(true)
    expect(numericSignalType('boolean')).toBe(false)
    expect(numericSignalType('string')).toBe(false)
    expect(numericSignalType(undefined)).toBe(false)
  })

  it('giữ nguyên cặp biên hợp lệ trên kiểu số', () => {
    expect(engineeringLimits('float', 16, 30)).toEqual({ minValue: 16, maxValue: 30 })
  })

  // Một vế cũng đủ nghĩa: "không bao giờ dưới 0" là một yêu cầu thật.
  it('cho phép khai một vế', () => {
    expect(engineeringLimits('float', 0, undefined)).toEqual({ minValue: 0, maxValue: undefined })
    expect(engineeringLimits('float', undefined, 100)).toEqual({ minValue: undefined, maxValue: 100 })
  })

  it('bỏ biên trên kiểu không phải số', () => {
    expect(engineeringLimits('boolean', 16, 30)).toEqual({ minValue: undefined, maxValue: undefined })
  })

  /* KHÔNG tự đảo khi người dùng gõ ngược.
   *
   * Đảo hộ là đoán ý, và một dải bị đảo âm thầm sẽ cưỡng chế đúng cái người
   * dùng không định. Gửi nguyên trạng để web-api từ chối và nói rõ trường sai. */
  it('không tự đảo min/max gõ ngược', () => {
    expect(engineeringLimits('float', 30, 16)).toEqual({ minValue: 30, maxValue: 16 })
  })

  it('chuẩn hoá mang biên đi qua nguyên vẹn', () => {
    const next = normalizeVirtualPoint(vp({ minValue: 16, maxValue: 30 }))
    expect(next.minValue).toBe(16)
    expect(next.maxValue).toBe(30)
  })

  // Kiểu boolean thì chuẩn hoá phải dọn biên, nếu không form gửi lên và nhận 400.
  it('chuẩn hoá dọn biên khi kiểu không phải số', () => {
    const next = normalizeVirtualPoint(vp({ signalType: 'boolean', value: true, minValue: 16, maxValue: 30 }))
    expect(next.minValue).toBeUndefined()
    expect(next.maxValue).toBeUndefined()
  })
})

describe('ô nhập biên kỹ thuật', () => {
  /* Ô TRỐNG phải là một trạng thái có nghĩa — "không khai biên" — chứ không
   * phải số 0. Biến trống thành 0 sẽ lặng lẽ cấm mọi giá trị âm trên mọi điểm
   * chưa cấu hình gì. */
  it('gửi undefined khi xoá trắng ô, không phải 0', async () => {
    const seen: Array<number | undefined> = []
    render(
      <I18nProvider>
        <OptionalNumberInput value={16} label="min" onChange={(next) => seen.push(next)} />
      </I18nProvider>
    )
    const input = screen.getByLabelText('min') as HTMLInputElement
    expect(input.value).toBe('16')
    await userEvent.clear(input)
    const last = seen[seen.length - 1]
    expect(last).toBeUndefined()
    expect(last).not.toBe(0)
  })

  it('hiện ô trống khi chưa khai biên', () => {
    render(
      <I18nProvider>
        <OptionalNumberInput value={undefined} label="max" onChange={() => {}} />
      </I18nProvider>
    )
    expect((screen.getByLabelText('max') as HTMLInputElement).value).toBe('')
  })

  it('khoá ô khi kiểu tín hiệu không phải số', () => {
    render(
      <I18nProvider>
        <OptionalNumberInput value={undefined} disabled label="min" onChange={() => {}} />
      </I18nProvider>
    )
    expect(screen.getByLabelText('min')).toBeDisabled()
  })
})
