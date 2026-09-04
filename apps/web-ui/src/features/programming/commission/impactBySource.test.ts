import { describe, expect, it } from 'vitest'
import { IMPACT_GROUP_LABEL, IMPACT_GROUP_ORDER } from './CheckCommissionPage'
import type { ProgrammingImpactKey } from '../api/generated/client'

/* `ISS-PIO-29` — Commission Impact tách theo nguồn Point (F-PIO-027, đề bài §33).
 *
 * `outputMappingChanges` gộp cả ba nguồn vào một con số. Người vận hành đứng
 * trước nút Commission thấy "3 thay đổi ánh xạ" và không biết đó là ba mapping
 * Modbus hay ba mapping AO — hai mức rủi ro rất khác nhau.
 */

const NEW_KEYS: ProgrammingImpactKey[] = [
  'physicalMappingChanges', 'virtualPointChanges', 'modbusMappingChanges', 'writableOutputsAffected'
]

it('bốn nhóm mới đều được hiển thị', () => {
  for (const key of NEW_KEYS) {
    expect(IMPACT_GROUP_ORDER).toContain(key)
  }
})

/* MỌI nhóm trong danh sách hiển thị phải có nhãn.
 *
 * Thiếu nhãn thì ô xác nhận hiện ra với chuỗi rỗng, và người vận hành được hỏi
 * "bạn có chấp nhận (trống) không" ngay trước khi thay chương trình đang chạy. */
it('mọi nhóm hiển thị đều có nhãn hai ngôn ngữ', () => {
  for (const key of IMPACT_GROUP_ORDER) {
    const label = IMPACT_GROUP_LABEL[key]
    expect(label, `thiếu nhãn cho ${key}`).toBeDefined()
    expect(label[0].length, `nhãn tiếng Việt rỗng cho ${key}`).toBeGreaterThan(0)
    expect(label[1].length, `nhãn tiếng Anh rỗng cho ${key}`).toBeGreaterThan(0)
  }
})

/* Nhãn phải NÓI RÕ NGUỒN — đó chính là thứ quyết định mức rủi ro.
 *
 * Một nhãn chung như "thay đổi ánh xạ" cho cả ba nguồn đưa vấn đề về đúng chỗ
 * cũ: người vận hành lại phải đoán. */
it('nhãn nói rõ nguồn của từng nhóm', () => {
  expect(IMPACT_GROUP_LABEL.physicalMappingChanges[0]).toMatch(/VẬT LÝ/)
  expect(IMPACT_GROUP_LABEL.virtualPointChanges[0]).toMatch(/ẢO/)
  expect(IMPACT_GROUP_LABEL.modbusMappingChanges[0]).toMatch(/MODBUS/)
})

describe('thứ tự đọc theo mức rủi ro', () => {
  const indexOf = (key: ProgrammingImpactKey) => IMPACT_GROUP_ORDER.indexOf(key)

  /* Đầu ra ghi được và mapping vật lý đứng TRÊN Modbus/điểm ảo: một cơ cấu chấp
   * hành nối cứng vào tủ nhận lệnh từ chỗ khác là hậu quả trực tiếp nhất. */
  it('nguồn vật lý đứng trên nguồn phần mềm', () => {
    expect(indexOf('writableOutputsAffected')).toBeLessThan(indexOf('modbusMappingChanges'))
    expect(indexOf('physicalMappingChanges')).toBeLessThan(indexOf('modbusMappingChanges'))
    expect(indexOf('physicalMappingChanges')).toBeLessThan(indexOf('virtualPointChanges'))
  })

  // Bốn nhóm mới xen vào SAU `outputMappingChanges` — chúng nói cùng một chuyện
  // ở độ phân giải cao hơn, nên đọc liền mạch từ tổng quát xuống chi tiết.
  it('bốn nhóm mới đứng sau outputMappingChanges', () => {
    for (const key of NEW_KEYS) {
      expect(indexOf(key)).toBeGreaterThan(indexOf('outputMappingChanges'))
    }
  })

  // Nhóm cũ giữ nguyên vị trí tương đối: người vận hành đã quen đọc từ trên.
  it('giữ nguyên thứ tự tương đối của các nhóm cũ', () => {
    expect(indexOf('enableIntent')).toBeLessThan(indexOf('programSet'))
    expect(indexOf('programSet')).toBeLessThan(indexOf('retain'))
    expect(indexOf('outputMappingChanges')).toBeLessThan(indexOf('publishedSignals'))
    expect(indexOf('publishedSignals')).toBeLessThan(indexOf('controlLibrary'))
  })
})
