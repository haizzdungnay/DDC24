import { describe, expect, it } from 'vitest'

import { buildStReferenceIndex } from './stReferenceIndex'
import { isStKeyword, stDropOffsetAtPoint, stHoverSymbolAtPoint, stOffsetAtPoint, stVisualPositionAt, type StEditorTextMetrics } from './stHover'

/**
 * `T59-820` / `TC-PGM02-HOV-01` — hover ký hiệu ST.
 *
 * Phần khó không phải tooltip mà là **toạ độ → offset**: sai một cột thì
 * tooltip chỉ vào một ký hiệu khác thứ chuột đang trỏ, và người đọc không có
 * cách nào biết. Vì vậy toàn bộ phép quy đổi nằm ở hàm thuần và được kiểm ở
 * đây, kể cả các biên mà người dùng thật gặp hằng ngày: lề, khoảng trắng cuối
 * dòng, tab, và dòng trống.
 */

// 8 px/ký tự, dòng 20 px, đệm 12 px — trùng lưới thật của editor.
const metrics: StEditorTextMetrics = {
  rowHeightPx: 20, padTopPx: 12, padLeftPx: 12, charWidthPx: 8, tabSize: 2,
}

const origin = { scrollLeft: 0, scrollTop: 0 }

/** Điểm giữa ô của ký tự thứ `column` trên dòng `row` (đều đếm từ 0). */
function pointAt(row: number, column: number) {
  return {
    x: metrics.padLeftPx + column * metrics.charWidthPx + metrics.charWidthPx / 2,
    y: metrics.padTopPx + row * metrics.rowHeightPx + metrics.rowHeightPx / 2,
    ...origin,
  }
}

const source = [
  'PROGRAM Main',
  'VAR',
  '  Fan : BOOL;',
  '  Timer1 : TON;',
  'END_VAR',
  '',
  'Fan := TRUE;',
  'END_PROGRAM',
].join('\n')

describe('stOffsetAtPoint — chỉ trả lời khi thật sự có ký tự dưới chuột', () => {
  it('đo được bề rộng ⇒ tra đúng ký tự ở dòng và cột chỉ định', () => {
    const offset = stOffsetAtPoint(source, pointAt(2, 2), metrics)
    expect(offset).not.toBeNull()
    expect(source[offset as number]).toBe('F')
  })

  it('chưa đo được bề rộng ký tự ⇒ null, KHÔNG đoán', () => {
    // Font chưa tải hoặc phần tử chưa layout. Một bề rộng đoán sẽ làm tooltip
    // chỉ vào ký hiệu khác thứ chuột đang trỏ.
    expect(stOffsetAtPoint(source, pointAt(2, 2), { ...metrics, charWidthPx: 0 })).toBeNull()
    expect(stOffsetAtPoint(source, pointAt(2, 2), { ...metrics, charWidthPx: -3 })).toBeNull()
  })

  it('bên phải ký tự cuối dòng ⇒ null, không kẹp về định danh cuối', () => {
    // Kẹp lại sẽ làm rê chuột qua khoảng trắng cuối dòng bật tooltip của tên
    // cuối cùng — nói rằng chuột trỏ vào thứ nó không trỏ vào.
    expect(stOffsetAtPoint(source, pointAt(2, 400), metrics)).toBeNull()
  })

  it('trên lề trái, trên đỉnh, và dưới dòng cuối đều ⇒ null', () => {
    expect(stOffsetAtPoint(source, { x: 2, y: pointAt(2, 0).y, ...origin }, metrics)).toBeNull()
    expect(stOffsetAtPoint(source, { x: pointAt(2, 2).x, y: 1, ...origin }, metrics)).toBeNull()
    expect(stOffsetAtPoint(source, pointAt(99, 0), metrics)).toBeNull()
  })

  it('dòng trống không có ký tự nào ⇒ null', () => {
    expect(stOffsetAtPoint(source, pointAt(5, 0), metrics)).toBeNull()
  })

  it('cuộn được cộng vào toạ độ, không bị bỏ qua', () => {
    const scrolled = { ...pointAt(0, 2), y: pointAt(0, 2).y, scrollTop: 2 * metrics.rowHeightPx, scrollLeft: 0 }
    const offset = stOffsetAtPoint(source, scrolled, metrics)
    expect(offset).not.toBeNull()
    // Cuộn xuống 2 dòng ⇒ điểm của dòng 0 thật ra rơi vào dòng 2.
    expect(source.slice(offset as number, (offset as number) + 3)).toBe('Fan')
  })

  it('tab đẩy tới mốc dừng kế tiếp, không rộng cố định', () => {
    // `tabSize = 2`: tab ở cột 1 chỉ chiếm 1 cột để về mốc 2. Coi nó rộng cố
    // định 2 sẽ làm mọi ký tự sau tab lệch dần.
    const tabbed = 'A\tB'
    expect(stOffsetAtPoint(tabbed, pointAt(0, 0), metrics)).toBe(0)
    expect(stOffsetAtPoint(tabbed, pointAt(0, 1), metrics)).toBe(1)
    expect(stOffsetAtPoint(tabbed, pointAt(0, 2), metrics)).toBe(2)
  })
})

describe('stHoverSymbolAtPoint — phân giải dùng đúng chỉ mục Inspector dùng', () => {
  const index = buildStReferenceIndex(source)

  it('biến khai báo ⇒ trả entry kèm kiểu tra được', () => {
    const symbol = stHoverSymbolAtPoint(source, pointAt(2, 3), metrics, index)
    expect(symbol?.identifier).toBe('Fan')
    expect(symbol?.entry?.typeName).toBe('BOOL')
  })

  it('instance FB ⇒ kind FB_INSTANCE để hover lấy được chữ ký thư viện', () => {
    const symbol = stHoverSymbolAtPoint(source, pointAt(3, 4), metrics, index)
    expect(symbol?.identifier).toBe('Timer1')
    expect(symbol?.entry?.kind).toBe('FB_INSTANCE')
  })

  it('định danh không tra được vẫn trả về, entry null ⇒ "không xác định được"', () => {
    const unknownSource = 'Ghost := 1;'
    const symbol = stHoverSymbolAtPoint(unknownSource, pointAt(0, 1), metrics, buildStReferenceIndex(unknownSource))
    expect(symbol?.identifier).toBe('Ghost')
    // Trả `entry: null` chứ không trả null: người dùng cần biết "đã tra và
    // không thấy", khác hẳn "chỗ này không có gì".
    expect(symbol?.entry).toBeNull()
  })

  it('từ khoá ngôn ngữ ⇒ im lặng, không bật tooltip nhiễu', () => {
    expect(stHoverSymbolAtPoint(source, pointAt(0, 2), metrics, index)).toBeNull()
    expect(stHoverSymbolAtPoint(source, pointAt(7, 2), metrics, index)).toBeNull()
    expect(isStKeyword('if')).toBe(true)
    expect(isStKeyword('Fan')).toBe(false)
  })

  it('dấu câu ngay sau một tên KHÔNG kế thừa tooltip của tên đó', () => {
    // `stSymbolAt` cố ý nhận cả hai phía của biên định danh để phục vụ con trỏ
    // gõ. Chuột thì trỏ vào đúng một ký tự, nên biên phải chặt hơn.
    const line = 'Fan := TRUE;'
    const idx = buildStReferenceIndex(source)
    expect(stHoverSymbolAtPoint(line, pointAt(0, 0), metrics, idx)?.identifier).toBe('Fan')
    expect(stHoverSymbolAtPoint(line, pointAt(0, 3), metrics, idx)).toBeNull()
  })

  it('số không phải ký hiệu', () => {
    const numeric = 'X := 1234;'
    expect(stHoverSymbolAtPoint(numeric, pointAt(0, 6), metrics, buildStReferenceIndex(numeric))).toBeNull()
  })
})

describe('stVisualPositionAt — neo tooltip vào ký hiệu, không vào con chuột', () => {
  it('trả đúng dòng và cột hiển thị', () => {
    expect(stVisualPositionAt(source, source.indexOf('Fan :'), metrics.tabSize)).toEqual({ row: 2, column: 2 })
  })

  it('tab tính theo mốc dừng, không theo chỉ số ký tự', () => {
    // 'A\tB': tab ở cột 1 đẩy tới mốc 2, nên 'B' ở cột hiển thị 2 chứ không 1.
    expect(stVisualPositionAt('A\tB', 2, 2)).toEqual({ row: 0, column: 2 })
  })

  it('offset ngoài phạm vi bị kẹp thay vì trả vị trí âm', () => {
    expect(stVisualPositionAt('AB', -5, 2)).toEqual({ row: 0, column: 0 })
    expect(stVisualPositionAt('AB', 99, 2)).toEqual({ row: 0, column: 2 })
  })
})

describe('DEV-PROG-016 — offset cho thao tác THẢ có kẹp', () => {
  const source = 'AAA\nBB\nCCCC\n'
  const metrics = { rowHeightPx: 20, padTopPx: 4, padLeftPx: 6, charWidthPx: 10, tabSize: 2 }

  it('thả đúng trên một ký tự cho ra chính offset đó', () => {
    const offset = stDropOffsetAtPoint(source, { x: 6 + 15, y: 4 + 25, scrollLeft: 0, scrollTop: 0 }, metrics)
    expect(offset).toBe(source.indexOf('BB') + 1)
  })

  it('thả vào khoảng trắng SAU ký tự cuối dòng ⇒ cuối dòng đó, không phải null', () => {
    // `stOffsetAtPoint` trả `null` ở đây (đúng cho hover), nhưng thả vào đó là
    // một thao tác rõ nghĩa: "chèn ở cuối dòng này".
    expect(stOffsetAtPoint(source, { x: 6 + 500, y: 4 + 25, scrollLeft: 0, scrollTop: 0 }, metrics)).toBeNull()
    expect(stDropOffsetAtPoint(source, { x: 6 + 500, y: 4 + 25, scrollLeft: 0, scrollTop: 0 }, metrics))
      .toBe(source.indexOf('BB') + 2)
  })

  it('thả bên TRÁI lề ⇒ đầu dòng, không phải cuối dòng', () => {
    expect(stDropOffsetAtPoint(source, { x: 0, y: 4 + 25, scrollLeft: 0, scrollTop: 0 }, metrics))
      .toBe(source.indexOf('BB'))
  })

  it('thả dưới dòng cuối ⇒ kẹp về dòng cuối, không vượt ra ngoài tài liệu', () => {
    const offset = stDropOffsetAtPoint(source, { x: 6 + 500, y: 4 + 400, scrollLeft: 0, scrollTop: 0 }, metrics)
    expect(offset).toBeLessThanOrEqual(source.length)
    expect(offset).toBeGreaterThanOrEqual(source.indexOf('CCCC'))
  })
})
