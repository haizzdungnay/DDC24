import { describe, expect, it } from 'vitest'
import { aiConfigFromIo, aiConfigToIo, type IoUiConfig } from './client'
import type { AiInputConfig } from '../types'

/**
 * REV-UI-CFG-GAP-2026-08-14 finding F-UI-CFG-002 (bug con): `putAiInputs` ghi
 * lại toàn bộ 16 kênh UI mỗi lần lưu. Trước bản vá này, `aiConfigToIo` luôn
 * ghi cứng `type: 'NTC10k'` cho mọi kênh signalType=3 và `unit` canonical cho
 * mọi giá trị unit — bất kể board đang có `NTC20k`/`PT100`/`PT1000` hay một
 * chuỗi unit khác (`RPM`...) mà FE chưa có control chọn riêng. Kết quả: sửa
 * MỘT kênh bất kỳ rồi lưu sẽ âm thầm hạ cấp các kênh KHÁC không hề bị đụng tới.
 */
describe('aiConfigFromIo/aiConfigToIo round-trip', () => {
  it('preserves an unedited NTC20k channel through load -> save', () => {
    const raw: IoUiConfig = { ch: 5, tag: 'UI-05', type: 'NTC20k', unit: 'degC', name: 'Return air temp' }
    const config = aiConfigFromIo(raw, 4)
    expect(config.signalType).toBe(3)
    expect(config.ioType).toBe('NTC20k')

    // Người dùng không đổi gì ở kênh này — chỉ save lại nguyên trạng.
    const written = aiConfigToIo(config)
    expect(written.type).toBe('NTC20k')
  })

  it('preserves PT100/PT1000 the same way (contract allows them even though Rev A UI does not expose picking them)', () => {
    for (const type of ['PT100', 'PT1000']) {
      const raw: IoUiConfig = { ch: 2, type, unit: 'degC' }
      const config = aiConfigFromIo(raw, 1)
      expect(aiConfigToIo(config).type).toBe(type)
    }
  })

  it('still defaults a brand-new resistance-mode channel to NTC10k', () => {
    const config: AiInputConfig = {
      channel: 3,
      tag: 'UI-03',
      label: 'UI-03',
      signalType: 3,
      displayMin: 0,
      displayMax: 100,
      rangeMultiplier: 0,
      unit: 0,
      filterSamples: 3,
      sensorCal: 0,
      mathFunction: 0,
      enabled: true,
      note: ''
      // no ioType: user is switching this channel into resistance mode for the first time
    }
    expect(aiConfigToIo(config).type).toBe('NTC10k')
  })

  it('overwrites the stored ioType once the user actually switches signal type away from resistance', () => {
    const raw: IoUiConfig = { ch: 5, type: 'NTC20k', unit: 'degC' }
    const config = aiConfigFromIo(raw, 4)
    const switched: AiInputConfig = { ...config, signalType: 1, analogCurrent: false }
    expect(aiConfigToIo(switched).type).toBe('0-10V')
  })

  it('preserves a non-enumerated unit string (e.g. RPM) on an untouched channel', () => {
    const raw: IoUiConfig = { ch: 8, type: 'pulse', unit: 'RPM' }
    const config = aiConfigFromIo(raw, 7)
    expect(config.unit).toBe(0) // FE's closed 5-option dropdown can't represent "RPM" -> falls back to group 0
    expect(config.ioUnit).toBe('RPM')

    const written = aiConfigToIo(config)
    expect(written.unit).toBe('RPM')
  })

  it('overwrites unit with the canonical string once the user picks a different unit', () => {
    const raw: IoUiConfig = { ch: 8, type: 'pulse', unit: 'RPM' }
    const config = aiConfigFromIo(raw, 7)
    const changed: AiInputConfig = { ...config, unit: 1 } // user explicitly selects "%"
    expect(aiConfigToIo(changed).unit).toBe('percent')
  })

  it('round-trips a fresh NTC10k channel unchanged', () => {
    const raw: IoUiConfig = { ch: 1, type: 'NTC10k', unit: 'degC' }
    const config = aiConfigFromIo(raw, 0)
    expect(aiConfigToIo(config).type).toBe('NTC10k')
    expect(aiConfigToIo(config).unit).toBe('degC')
  })
})
