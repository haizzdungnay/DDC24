import { describe, expect, it } from 'vitest'
import { aiInputDraftDiff } from './inputsDraftDiff'
import type { AiInputConfig } from '../../shared/types'

/**
 * Khoá hành vi của `BB-8` — diff "đang lưu ↔ bản nháp" cho ngõ vào (`T57-2.10`).
 *
 * Bảng này là thứ cuối cùng người vận hành đọc trước khi cấu hình đi xuống
 * thiết bị. Hai kiểu hỏng đều nguy hiểm ngang nhau: **bỏ sót** một trường đã
 * đổi (người dùng lưu thứ mình không định lưu) và **báo thừa** (bảng đầy nhiễu
 * thì lần sau không ai đọc nữa).
 */

const pick = (vi: string) => vi

function ai(overrides: Partial<AiInputConfig>): AiInputConfig {
  return {
    channel: 1, tag: 'UI-01', label: 'Nhiệt độ hồi', signalType: 1, displayMin: 0, displayMax: 100,
    rangeMultiplier: 0, unit: 0, filterSamples: 0, sensorCal: 0, mathFunction: 0,
    enabled: true, note: '', ...overrides
  } as AiInputConfig
}

describe('T57-2.10 — diff bản nháp ngõ vào', () => {
  it('không có thay đổi ⇒ không có hàng nào', () => {
    const saved = [ai({}), ai({ channel: 2, tag: 'UI-02' })]
    expect(aiInputDraftDiff(saved, saved.map((config) => ({ ...config })), pick)).toEqual([])
  })

  it('chỉ nêu trường THẬT SỰ đổi, kèm giá trị cũ và mới', () => {
    const saved = [ai({ displayMax: 100, mathFunction: 0 })]
    const draft = [ai({ displayMax: 150, mathFunction: 3 })]
    const rows = aiInputDraftDiff(saved, draft, pick)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ group: 'UI-01', label: 'Giá trị hiển thị đầu cao', from: '100', to: '150' })
    expect(rows[1]).toMatchObject({ label: 'Hàm toán', from: 'Không hoạt động', to: 'Lớn nhất (Max)' })
  })

  it('nói ra giá trị bằng NGÔN NGỮ NGƯỜI, không phải mã số của firmware', () => {
    const rows = aiInputDraftDiff([ai({ unit: 0 })], [ai({ unit: 3 })], pick)
    expect(rows[0].from, 'mã 0 không nói lên gì với người vận hành').toBe('Không hiển thị')
    expect(rows[0].to).toBe('Pa')
  })

  it('4-20 mA và 2-10 V dùng chung signalType 2 nhưng KHÁC hành vi ⇒ phải thấy trong diff', () => {
    const rows = aiInputDraftDiff(
      [ai({ signalType: 2, analogCurrent: false })],
      [ai({ signalType: 2, analogCurrent: true })],
      pick
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'Loại tín hiệu', from: 'Điện áp 2-10 V', to: 'Dòng 4-20 mA' })
  })

  it('biến thể cảm biến (`ioType`) đổi ⇒ vẫn phải thấy, vì đường cong đo đổi theo', () => {
    const rows = aiInputDraftDiff(
      [ai({ signalType: 3, ioType: 'NTC10k' })],
      [ai({ signalType: 3, ioType: 'NTC20k' })],
      pick
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].from).toContain('NTC10k')
    expect(rows[0].to).toContain('NTC20k')
  })

  it('sao chép sang nhiều kênh (`T57-2.11`) ⇒ diff gom theo từng kênh đích', () => {
    const saved = [1, 2, 3].map((channel) => ai({ channel, tag: `UI-0${channel}`, displayMax: 100 }))
    const draft = saved.map((config) => config.channel === 1 ? config : { ...config, displayMax: 250 })
    const rows = aiInputDraftDiff(saved, draft, pick)
    expect(rows.map((row) => row.group)).toEqual(['UI-02', 'UI-03'])
  })

  it('kênh mới xuất hiện hoặc biến mất đều được nói ra, không im lặng', () => {
    const saved = [ai({})]
    const draft = [ai({}), ai({ channel: 2, tag: 'UI-02', label: 'Áp suất' })]
    expect(aiInputDraftDiff(saved, draft, pick)).toEqual([
      { group: 'UI-02', label: 'Kênh mới', from: '—', to: 'Áp suất' }
    ])
    expect(aiInputDraftDiff(draft, saved, pick)).toEqual([
      { group: 'UI-02', label: 'Kênh bị gỡ', from: 'Áp suất', to: '—' }
    ])
  })

  it('hàng được sắp theo số kênh, không theo thứ tự mảng đầu vào', () => {
    const saved = [3, 1, 2].map((channel) => ai({ channel, tag: `UI-0${channel}`, enabled: false }))
    const draft = saved.map((config) => ({ ...config, enabled: true }))
    expect(aiInputDraftDiff(saved, draft, pick).map((row) => row.group)).toEqual(['UI-01', 'UI-02', 'UI-03'])
  })
})
