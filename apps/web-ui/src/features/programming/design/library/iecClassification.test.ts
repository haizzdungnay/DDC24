import { describe, expect, it, vi } from 'vitest'
import { iecClassificationOf, isManufacturerExtension } from './iecClassification'
import { PROGRAMMING_LIBRARY_ENTRIES } from '../../api/generated/library_registry'
import { buildStCompletions } from '../editor/stEditorSupport'
import { FBD_PALETTE } from '../../fbd/palette'
import curated from '../../../../../../../contracts/programming/st_language_profile_v1.curated.json'

/* Issue #802: profile production đã ký token cho `PID`. File này kiểm CƠ CHẾ
   của khối REVIEW_REQUIRED (bị khoá/đánh dấu), nên dựng lại đúng bảng review
   gate trước khi ký — PID chưa duyệt. Trạng thái production (PID dùng được)
   được khoá riêng ở `model/reviewGate.test.ts`. */
vi.mock('../../api/generated/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/generated/profile')>()),
  PROGRAMMING_REVIEW_GATED_FEATURES: [{ featureId: 'PID', approved: false, approvalToken: '' }],
}))

/**
 * `ISS-STED-17` / `ADR-054` điểm 3 — IEC cho phép mở rộng nhà sản xuất **miễn
 * là công bố rõ**. "Công bố rõ" nghĩa là nhãn tới được nơi người dùng **CHỌN**
 * khối; nằm trong tài liệu là nhãn không ai đọc đúng lúc.
 */

const VENDOR_NAMES = (curated.vendorExtensions as { name: string }[]).map((item) => item.name)

describe('phân loại IEC của thư viện — ISS-STED-17', () => {
  it('mọi entry registry đều có phân loại, không mục nào để trống', () => {
    // Để trống một entry là để người dùng đoán, mà đoán sai ở đây nghĩa là họ
    // tin một khối Mekong tự định nghĩa sẽ chạy trên PLC của hãng khác.
    for (const entry of PROGRAMMING_LIBRARY_ENTRIES) {
      expect(['IEC_STANDARD', 'MANUFACTURER_EXTENSION']).toContain(entry.iecClassification)
    }
    expect(PROGRAMMING_LIBRARY_ENTRIES.length).toBeGreaterThanOrEqual(40)
  })

  it('phân loại SUY RA từ hồ sơ ngôn ngữ, không phải một danh sách thứ hai', () => {
    // Nếu ai đó thêm khối mở rộng thứ năm vào hồ sơ mà quên registry, test này đỏ.
    const flagged = PROGRAMMING_LIBRARY_ENTRIES
      .filter((entry) => entry.iecClassification === 'MANUFACTURER_EXTENSION')
      .map((entry) => entry.id)
      .sort()
    expect(flagged).toEqual([...VENDOR_NAMES].sort())
  })

  it.each(VENDOR_NAMES)('`%s` được nhận là mở rộng nhà sản xuất', (name) => {
    expect(isManufacturerExtension(name)).toBe(true)
  })

  it('khối IEC chuẩn KHÔNG bị dán nhãn mở rộng', () => {
    for (const name of ['TON', 'TOF', 'CTU', 'ABS', 'LIMIT', 'SEL']) {
      expect(isManufacturerExtension(name)).toBe(false)
      expect(iecClassificationOf(name)).toBe('IEC_STANDARD')
    }
  })

  it('POU người dùng định nghĩa nhận `null`, không nhận một trong hai nhãn', () => {
    // Nó không thuộc IEC lẫn thư viện Mekong; gắn nhãn nào cũng là nói sai.
    expect(iecClassificationOf('FB_KhoiCuaNguoiDung')).toBeNull()
  })

  it('palette FBD mang phân loại tới nơi người dùng thả khối', () => {
    const pid = FBD_PALETTE.find((entry) => entry.typeRef === 'PID')
    expect(pid?.iecClassification).toBe('MANUFACTURER_EXTENSION')
    const ton = FBD_PALETTE.find((entry) => entry.typeRef === 'TON')
    expect(ton?.iecClassification).toBe('IEC_STANDARD')
  })

  it('gợi ý ST nói ra khối nào không thuộc IEC', () => {
    const hysteresis = buildStCompletions('HYST', []).find((item) => item.label === 'HYSTERESIS')
    expect(hysteresis?.detail).toContain('không thuộc IEC')

    // Chỉ gắn cho mở rộng: dán nhãn "IEC" lên 42/46 mục sẽ làm nhiễu đúng 4
    // mục cần chú ý.
    const ton = buildStCompletions('TON', []).find((item) => item.label === 'TON')
    expect(ton?.detail).not.toContain('không thuộc IEC')
  })

  it('`PID` giữ nguyên cổng review, nhãn mở rộng KHÔNG thay thế nó', () => {
    // Hai thứ khác nhau: "không thuộc IEC" nói về nguồn gốc, "chờ review" nói
    // về trạng thái phê duyệt. Gộp lại sẽ mất một trong hai.
    const pid = buildStCompletions('PID', []).find((item) => item.label === 'PID')
    expect(pid?.reviewGated).toBe(true)
    expect(isManufacturerExtension('PID')).toBe(true)
  })
})
