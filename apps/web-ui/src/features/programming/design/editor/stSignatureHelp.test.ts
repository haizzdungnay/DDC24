import { describe, expect, it, vi } from 'vitest'
import {
  stSignatureHelp,
  stSignatureLabel,
  stSignatureParameterLabel,
} from './stSignatureHelp'
import { PROGRAMMING_LIBRARY_ENTRIES } from '../../api/generated/library_registry'

/* Issue #802: profile production đã ký token cho `PID`. File này kiểm CƠ CHẾ
   của khối REVIEW_REQUIRED (bị khoá/đánh dấu), nên dựng lại đúng bảng review
   gate trước khi ký — PID chưa duyệt. Trạng thái production (PID dùng được)
   được khoá riêng ở `model/reviewGate.test.ts`. */
vi.mock('../../api/generated/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/generated/profile')>()),
  PROGRAMMING_REVIEW_GATED_FEATURES: [{ featureId: 'PID', approved: false, approvalToken: '' }],
}))

const NO_SYMBOLS: { name: string; type: string }[] = []
const TON_1 = [{ name: 'TON_1', type: 'TON' }]

/** Vị trí ngay sau chuỗi `needle` trong `source`. */
function after(source: string, needle: string): number {
  const index = source.indexOf(needle)
  expect(index).toBeGreaterThanOrEqual(0)
  return index + needle.length
}

describe('stSignatureHelp — ISS-STED-11', () => {
  it('gõ `(` sau tên hàm thì có chữ ký, tham số lấy từ registry', () => {
    const source = 'x := LIMIT('
    const help = stSignatureHelp(source, source.length, NO_SYMBOLS)
    expect(help).not.toBeNull()
    expect(help!.calleeName).toBe('LIMIT')
    expect(help!.kind).toBe('function')
    // Không khai tay: so thẳng với registry.
    const entry = PROGRAMMING_LIBRARY_ENTRIES.find((item) => item.id === 'LIMIT')!
    expect(help!.parameters.map((p) => p.name)).toEqual(
      entry.ports.filter((port) => port.direction === 'INPUT').map((port) => port.name),
    )
  })

  it('tham số đang nhập được làm nổi, và dịch theo dấu phẩy', () => {
    const source = 'x := LIMIT(a, b, '
    expect(stSignatureHelp('x := LIMIT(', 11, NO_SYMBOLS)!.activeParameter).toBe(0)
    expect(stSignatureHelp('x := LIMIT(a, ', 14, NO_SYMBOLS)!.activeParameter).toBe(1)
    expect(stSignatureHelp(source, source.length, NO_SYMBOLS)!.activeParameter).toBe(2)
  })

  it('vượt quá số tham số thì KHÔNG làm nổi bừa một cái', () => {
    const entry = PROGRAMMING_LIBRARY_ENTRIES.find((item) => item.id === 'LIMIT')!
    const inputs = entry.ports.filter((port) => port.direction === 'INPUT').length
    const source = `x := LIMIT(${'a, '.repeat(inputs)}`
    // Làm nổi sai còn tệ hơn không làm nổi: nó khẳng định một điều sai.
    expect(stSignatureHelp(source, source.length, NO_SYMBOLS)!.activeParameter).toBe(-1)
  })

  it('instance FB phân giải qua biến đã khai, và đòi gọi theo tên', () => {
    const source = 'TON_1('
    const help = stSignatureHelp(source, source.length, TON_1)
    expect(help).not.toBeNull()
    expect(help!.kind).toBe('function-block')
    expect(help!.typeRef).toBe('TON')
    expect(help!.calleeName).toBe('TON_1')
    expect(help!.namedArgumentsRequired).toBe(true)
    expect(help!.parameters.map((p) => p.name)).toEqual(['IN', 'PT'])
  })

  it('với FB, tham số đang nhập đọc từ tên bên trái `:=`, không đếm dấu phẩy', () => {
    // Người dùng được viết các cặp theo thứ tự bất kỳ, nên đoạn thứ hai KHÔNG
    // nhất thiết là tham số thứ hai. Đếm dấu phẩy sẽ làm nổi sai chỗ.
    const source = 'TON_1(PT := T#5s, IN := '
    const help = stSignatureHelp(source, source.length, TON_1)!
    expect(help.parameters[help.activeParameter].name).toBe('IN')

    const reversed = 'TON_1(IN := start, PT := '
    const second = stSignatureHelp(reversed, reversed.length, TON_1)!
    expect(second.parameters[second.activeParameter].name).toBe('PT')
  })

  it('tên tham số chưa khớp cổng nào thì không làm nổi gì', () => {
    const source = 'TON_1(XY'
    expect(stSignatureHelp(source, source.length, TON_1)!.activeParameter).toBe(-1)
  })

  it('gọi thẳng KIỂU FB (không qua instance) không hiện chữ ký', () => {
    // Hiện lên là ngầm bảo rằng viết vậy được; FB phải qua instance đã khai.
    expect(stSignatureHelp('TON(', 4, NO_SYMBOLS)).toBeNull()
  })

  it('lời gọi lồng nhau lấy chữ ký của lời gọi TRONG CÙNG', () => {
    const source = 'x := LIMIT(0, ABS('
    const help = stSignatureHelp(source, source.length, NO_SYMBOLS)!
    expect(help.calleeName).toBe('ABS')
  })

  it('đóng ngoặc xong thì hết chữ ký', () => {
    const source = 'x := ABS(a);'
    expect(stSignatureHelp(source, source.length, NO_SYMBOLS)).toBeNull()
  })

  it('không hiện chữ ký bên trong chú thích', () => {
    // Quét xuôi có bỏ qua chú thích; quét lùi từ con trỏ sẽ nhầm `(*` thành
    // dấu mở lời gọi.
    const block = '(* x := ABS( *)'
    expect(stSignatureHelp(block, after(block, 'ABS('), NO_SYMBOLS)).toBeNull()
    const line = '// x := ABS('
    expect(stSignatureHelp(line, line.length, NO_SYMBOLS)).toBeNull()
  })

  it('tên không có trong registry thì không đoán bừa', () => {
    expect(stSignatureHelp('KHONG_CO_HAM_NAY(', 17, NO_SYMBOLS)).toBeNull()
  })

  it('con trỏ ngoài buffer trả null thay vì ném', () => {
    expect(stSignatureHelp('ABS(', -1, NO_SYMBOLS)).toBeNull()
    expect(stSignatureHelp('ABS(', 99, NO_SYMBOLS)).toBeNull()
  })

  it('khối chờ review được đánh dấu, không bị giấu đi', () => {
    // Tiêu chí: vẫn hiện chữ ký nhưng NÓI RÕ Kiểm tra sẽ từ chối.
    const help = stSignatureHelp('PID_1(', 6, [{ name: 'PID_1', type: 'PID' }])
    expect(help).not.toBeNull()
    expect(help!.reviewGated).toBe(true)
    expect(help!.parameters.length).toBeGreaterThan(0)
  })

  it('nhãn tham số dùng đúng dạng gọi của từng loại', () => {
    const fb = stSignatureHelp('TON_1(', 6, TON_1)!
    expect(stSignatureParameterLabel(fb.parameters[0], true)).toBe('IN := BOOL')
    const fn = stSignatureHelp('x := ABS(', 9, NO_SYMBOLS)!
    expect(stSignatureParameterLabel(fn.parameters[0], false)).toContain(':')
    expect(stSignatureParameterLabel(fn.parameters[0], false)).not.toContain(':=')
    expect(stSignatureLabel(fb)).toBe('TON_1(IN := BOOL, PT := TIME)')
  })

  it('biến khai báo thắng tên hàm trùng — khai báo cụ thể hơn', () => {
    const help = stSignatureHelp('ABS(', 4, [{ name: 'ABS', type: 'TON' }])
    expect(help!.typeRef).toBe('TON')
  })
})
