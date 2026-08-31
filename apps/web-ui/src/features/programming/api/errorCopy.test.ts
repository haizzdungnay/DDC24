import { describe, expect, it } from 'vitest'

import { programmingErrorCopy } from './errorCopy'
import { PROGRAMMING_ERROR_CATALOG } from './generated/errors'

const pick = (vi: string, _en: string) => vi
const pickEn = (_vi: string, en: string) => en

describe('programmingErrorCopy phủ toàn bộ catalog', () => {
  it('mọi mã public đều có copy riêng, không rơi vào nhánh mặc định', () => {
    // Nhánh `default` nhúng chính mã lỗi vào câu chữ. Nếu một mã mới được thêm
    // vào catalog mà quên copy, người dùng sẽ thấy mã thô — đúng lớp lỗi
    // RSK-PROG-014. Test này chặn điều đó ngay khi catalog lớn lên.
    for (const code of Object.keys(PROGRAMMING_ERROR_CATALOG)) {
      const vi = programmingErrorCopy(pick, code)
      const en = programmingErrorCopy(pickEn, code)
      expect(vi, `${code} thiếu copy VI`).not.toContain(code)
      expect(en, `${code} thiếu copy EN`).not.toContain(code)
      expect(vi.length).toBeGreaterThan(10)
      expect(en.length).toBeGreaterThan(10)
      expect(vi).not.toBe(en)
    }
  })

  it('mã lạ và undefined vẫn fail-safe, có nêu mã để hỗ trợ', () => {
    expect(programmingErrorCopy(pick, 'PRG-ERR-KHONG-CO')).toContain('PRG-ERR-KHONG-CO')
    expect(programmingErrorCopy(pick, undefined)).toContain('không rõ mã lỗi')
    expect(programmingErrorCopy(pickEn, undefined)).toContain('unknown error code')
  })

  it('các mã ST-WARN-* có bản dịch riêng biệt cho VI và EN', () => {
    const warnCodes = ['ST-WARN-001', 'ST-WARN-002', 'ST-WARN-003', 'ST-WARN-004']
    for (const code of warnCodes) {
      const vi = programmingErrorCopy(pick, code)
      const en = programmingErrorCopy(pickEn, code)
      expect(vi, `${code} không được chứa mã thô`).not.toContain(code)
      expect(en, `${code} không được chứa mã thô`).not.toContain(code)
      expect(vi.length).toBeGreaterThan(10)
      expect(en.length).toBeGreaterThan(10)
      expect(vi).not.toBe(en)
    }
  })
})
