import { describe, expect, it } from 'vitest'
import { aiConfigFromIo, aiConfigToIo, type IoUiConfig } from './client'
import type { AiInputConfig } from '../types'
import { aiConditioningDefaults } from '../types'

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
      ...aiConditioningDefaults(),
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

/**
 * ISS-PIO-24 §7. Hai nhóm khoá dưới đây được firmware ĐỌC THẬT
 * (`apps/iobus/domain/io/io_conditioning.cpp`), còn `putAiInputs` thì ghi đè
 * nguyên hàng `ui[]`. Khoá nào FE không mang theo sẽ bị xoá âm thầm ở lần lưu
 * kế tiếp — đúng kiểu hỏng không ai thấy cho tới khi bo chạy sai.
 */
describe('ISS-PIO-24: điều hoà tín hiệu và hiệu chuẩn đi qua được round-trip', () => {
  it('mang deadband/clamp/cờ lỗi/chính sách lỗi từ thiết bị lên và trả lại nguyên vẹn', () => {
    const raw: IoUiConfig = {
      ch: 1, type: '0-10V',
      deadband: 0.25, clamp_enabled: true, clamp_min: 4, clamp_max: 36,
      range_fault_enabled: false, loop_fault_enabled: false,
      failure_mode: 'hold', failure_value: 21.5
    }
    const config = aiConfigFromIo(raw, 0)
    expect(config.deadband).toBe(0.25)
    expect(config.clampEnabled).toBe(true)
    expect(config.clampMin).toBe(4)
    expect(config.clampMax).toBe(36)
    expect(config.rangeFaultEnabled).toBe(false)
    expect(config.loopFaultEnabled).toBe(false)
    expect(config.failureMode).toBe('hold')
    expect(config.failureValue).toBe(21.5)

    const written = aiConfigToIo(config)
    expect(written.deadband).toBe(0.25)
    expect(written.clamp_enabled).toBe(true)
    expect(written.clamp_min).toBe(4)
    expect(written.clamp_max).toBe(36)
    expect(written.range_fault_enabled).toBe(false)
    expect(written.loop_fault_enabled).toBe(false)
    expect(written.failure_mode).toBe('hold')
    expect(written.failure_value).toBe(21.5)
  })

  it('kênh chưa từng cấu hình nhận đúng mặc định của firmware', () => {
    const config = aiConfigFromIo({ ch: 2, type: '0-10V' }, 1)
    expect(config.deadband).toBe(0)
    expect(config.clampEnabled).toBe(false)
    expect(config.rangeFaultEnabled).toBe(true)
    expect(config.loopFaultEnabled).toBe(true)
    expect(config.failureMode).toBe('invalid')
  })

  it('failure_mode lạ từ thiết bị được hạ về invalid thay vì lọt vào state', () => {
    const config = aiConfigFromIo({ ch: 3, type: '0-10V', failure_mode: 'giu-nguyen' }, 2)
    expect(config.failureMode).toBe('invalid')
    expect(aiConfigToIo(config).failure_mode).toBe('invalid')
  })

  it('cal_gain/cal_offset của thiết bị KHÔNG bị xoá khi lưu lại', () => {
    const raw: IoUiConfig = { ch: 4, type: '0-10V', cal_gain: 1.02, cal_offset: -0.4 }
    const config = aiConfigFromIo(raw, 3)
    expect(config.calGain).toBe(1.02)
    expect(config.calOffset).toBe(-0.4)

    const written = aiConfigToIo(config)
    expect(written.cal_gain).toBe(1.02)
    expect(written.cal_offset).toBe(-0.4)
  })

  it('kênh chưa hiệu chuẩn thì KHÔNG gửi khoá — để thiết bị giữ nguyên mặc định', () => {
    const written = aiConfigToIo(aiConfigFromIo({ ch: 5, type: '0-10V' }, 4))
    expect('cal_gain' in written).toBe(false)
    expect('cal_offset' in written).toBe(false)
  })

  it('mặc định của FE trùng mặc định của firmware', () => {
    // `aiConditioningDefaults` là bản sao TypeScript của `UiScaleConfig`; lệch
    // một trường là mở trang rồi bấm Lưu cũng đủ đổi hành vi của bo.
    expect(aiConditioningDefaults()).toEqual({
      deadband: 0,
      clampEnabled: false,
      clampMin: 0,
      clampMax: 0,
      rangeFaultEnabled: true,
      loopFaultEnabled: true,
      failureMode: 'invalid',
      failureValue: 0
    })
  })
})
