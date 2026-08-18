import { describe, expect, it } from 'vitest'
import {
  ENFORCED_MIN_PASSWORD_LENGTH,
  RECOMMENDED_MIN_PASSWORD_LENGTH,
  assessPassword
} from './passwordPolicy'

/**
 * Test khoá HÀNH VI cho chính sách mật khẩu (`T57-1.9`, thi hành `ADR-037`).
 *
 * Mệnh đề quan trọng nhất: **chỉ luật thiết bị mới chặn**; mọi thứ khác là
 * khuyến nghị. Một bản sửa vô tình biến khuyến nghị thành cổng chặn sẽ làm giao
 * diện mô tả sai thiết bị, và đó là lỗi mà `ADR-037` điều 1 loại bỏ.
 */

describe('hằng số phải khớp backend', () => {
  it('độ dài cưỡng chế đúng bằng luật Go `len(password) >= 6`', () => {
    // Đổi số này mà không đổi `validNewPassword` trong
    // `apps/web-api/internal/auth/service.go` là làm giao diện nói dối.
    expect(ENFORCED_MIN_PASSWORD_LENGTH).toBe(6)
  })

  it('mức khuyến nghị CAO HƠN mức cưỡng chế, và là hai số khác nhau', () => {
    expect(RECOMMENDED_MIN_PASSWORD_LENGTH).toBeGreaterThan(ENFORCED_MIN_PASSWORD_LENGTH)
  })
})

describe('meetsEnforced — thứ duy nhất được phép chặn', () => {
  it('đúng 6 ký tự là ĐẠT (biên dưới), 5 ký tự là không đạt', () => {
    expect(assessPassword('123456').meetsEnforced).toBe(true)
    expect(assessPassword('12345').meetsEnforced).toBe(false)
  })

  it('mật khẩu YẾU nhưng đủ dài vẫn ĐẠT luật thiết bị — khuyến nghị không chặn', () => {
    // `password` nằm trong danh sách tầm thường và bị chấm `weak`, nhưng thiết
    // bị vẫn chấp nhận nó. Giao diện phải nói đúng điều đó.
    const assessment = assessPassword('password')
    expect(assessment.meetsEnforced).toBe(true)
    expect(assessment.strength).toBe('weak')
  })

  it('mật khẩu trùng tên đăng nhập vẫn ĐẠT luật thiết bị nhưng bị chấm yếu', () => {
    const assessment = assessPassword('operator1', 'operator1')
    expect(assessment.meetsEnforced).toBe(true)
    expect(assessment.strength).toBe('weak')
    expect(assessment.advice.join(' ')).toMatch(/trùng tên đăng nhập/)
  })
})

describe('strength — chỉ báo khuyến nghị', () => {
  it('quá ngắn ⇒ unusable kèm đúng một lời khuyên về độ dài', () => {
    const assessment = assessPassword('abc')
    expect(assessment.strength).toBe('unusable')
    expect(assessment.advice).toHaveLength(1)
    expect(assessment.advice[0]).toMatch(/tối thiểu 6 ký tự/)
  })

  it('dài và trộn nhiều nhóm ký tự ⇒ strong', () => {
    expect(assessPassword('Mekong#2026x').strength).toBe('strong')
  })

  it('đủ 8 ký tự và 2 nhóm ⇒ fair, không phải strong', () => {
    expect(assessPassword('mekong26').strength).toBe('fair')
  })

  it('12 ký tự nhưng chỉ MỘT nhóm ký tự thì chưa phải strong', () => {
    expect(assessPassword('abcdefghijkl').strength).not.toBe('strong')
  })

  it('so khớp tên đăng nhập KHÔNG phân biệt hoa thường', () => {
    expect(assessPassword('OPERATOR1', 'operator1').strength).toBe('weak')
  })

  it('không truyền username thì không báo trùng tên', () => {
    expect(assessPassword('Mekong#2026x').advice.join(' ')).not.toMatch(/trùng tên đăng nhập/)
  })
})

describe('advice — nói ra khoảng cách tới mức khuyến nghị', () => {
  it('6 ký tự đạt luật nhưng vẫn khuyên nâng lên mức khuyến nghị', () => {
    const advice = assessPassword('Ab#12x').advice.join(' ')
    expect(advice).toMatch(/8 ký tự/)
  })

  it('đã đạt mức khuyến nghị thì không còn khuyên về độ dài', () => {
    const advice = assessPassword('Mekong#2026x').advice.join(' ')
    expect(advice).not.toMatch(/8 ký tự trở lên/)
  })
})
