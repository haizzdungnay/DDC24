import { describe, expect, it } from 'vitest'
import { formatStDocument, formatStRange } from './index'
import { parseSt } from './parser'
import { lexSt } from './lexer'

/**
 * `DEV-PROG-019` — nút Định dạng của ST Editor.
 *
 * Trọng tâm của bộ này KHÔNG phải "in có đẹp không" mà là **formatter không
 * được đổi chương trình**. Bản trước làm bằng regex và nó phá chú thích thật;
 * bộ test này khoá lại từng lời hứa một.
 */

function format(source: string): string {
  const result = formatStDocument(source)
  if (!result.ok) throw new Error(`${result.reason} (dòng ${result.line})`)
  return result.text
}

describe('DEV-PROG-019 — bốn ví dụ của đề bài', () => {
  it('ví dụ 1: END_IF và dấu ";" bị tách dòng được gộp lại', () => {
    expect(format([
      'PROGRAM t',
      'IF Occupied AND NOT fbSafety.TripLatched THEN',
      'AhuState := 10;',
      'END_IF',
      ';',
      'END_PROGRAM',
    ].join('\n'))).toBe([
      'PROGRAM t',
      '    IF Occupied AND NOT fbSafety.TripLatched THEN',
      '        AhuState := 10;',
      '    END_IF;',
      'END_PROGRAM',
      '',
    ].join('\n'))
  })

  it('ví dụ 2: CASE bị xé nhiều dòng được đưa về một dòng, nhánh thụt đều', () => {
    expect(format([
      'PROGRAM t', 'CASE', 'AhuState OF', '0:', 'IF Occupied THEN', 'AhuState:=10;', 'END_IF', ';',
      '10:', 'IF FanStatusRaw THEN', 'AhuState:=20;', 'END_IF', ';', 'END_CASE', ';', 'END_PROGRAM',
    ].join('\n'))).toBe([
      'PROGRAM t',
      '    CASE AhuState OF',
      '',
      '        0:',
      '            IF Occupied THEN',
      '                AhuState := 10;',
      '            END_IF;',
      '',
      '        10:',
      '            IF FanStatusRaw THEN',
      '                AhuState := 20;',
      '            END_IF;',
      '',
      '    END_CASE;',
      'END_PROGRAM',
      '',
    ].join('\n'))
  })

  it('ví dụ 3: lời gọi FB dài xuống dòng và CĂN CỘT ":="', () => {
    const source = 'PROGRAM t\nfbFanPI(Enable:=Running,SP:=DspSetpoint,PV:=DSP,Kp:=FanKp,Ki:=FanKi,'
      + 'Cycle_s:=1.0,OutMin:=MinFanPct,OutMax:=100.0,ReverseActing:=FALSE);\nEND_PROGRAM'
    expect(format(source)).toBe([
      'PROGRAM t',
      '    fbFanPI(',
      '        Enable        := Running,',
      '        SP            := DspSetpoint,',
      '        PV            := DSP,',
      '        Kp            := FanKp,',
      '        Ki            := FanKi,',
      '        Cycle_s       := 1.0,',
      '        OutMin        := MinFanPct,',
      '        OutMax        := 100.0,',
      '        ReverseActing := FALSE',
      '    );',
      'END_PROGRAM',
      '',
    ].join('\n'))
  })

  it('ví dụ 4: biểu thức luận lý dài tách mỗi điều kiện một dòng', () => {
    const source = 'PROGRAM t\nCoolEnable := Running AND NOT LowTempProtectActive AND '
      + '(SAT > (SatSetpoint + 0.3)) AND (NOT EconAvailable OR (EconomizerPct >= 95.0));\nEND_PROGRAM'
    expect(format(source)).toBe([
      'PROGRAM t',
      '    CoolEnable :=',
      '        Running',
      '        AND NOT LowTempProtectActive',
      '        AND (SAT > (SatSetpoint + 0.3))',
      '        AND (NOT EconAvailable OR (EconomizerPct >= 95.0));',
      'END_PROGRAM',
      '',
    ].join('\n'))
  })
})

describe('DEV-PROG-019 — bốn thứ formatter TUYỆT ĐỐI không được làm', () => {
  it('1. không thêm/bớt ngoặc, không đổi AND/OR', () => {
    // `IF A OR B AND C THEN` phải giữ NGUYÊN. Biến nó thành `(A OR B) AND C` là
    // đổi chương trình; cảnh báo nhập nhằng là việc của Kiểm tra, không phải
    // của Định dạng.
    const formatted = format('PROGRAM t\nIF A OR B AND C THEN\nX := 1;\nEND_IF;\nEND_PROGRAM')
    expect(formatted).toContain('IF A OR B AND C THEN')
    expect(formatted).not.toContain('(A OR B)')
  })

  it('2. không đảo thứ tự câu lệnh', () => {
    const formatted = format('PROGRAM t\nB := 2;\nA := 1;\nC := 3;\nEND_PROGRAM')
    const order = formatted.split('\n').filter((line) => line.includes(':=')).map((line) => line.trim())
    expect(order).toEqual(['B := 2;', 'A := 1;', 'C := 3;'])
  })

  it('3. không đảo thứ tự khai báo biến', () => {
    const formatted = format('PROGRAM t\nVAR\nZulu : INT;\nAlpha : INT;\nEND_VAR\nEND_PROGRAM')
    const names = formatted.split('\n').filter((line) => line.includes(' : INT;')).map((line) => line.trim().split(' ')[0])
    expect(names).toEqual(['Zulu', 'Alpha'])
  })

  it('4. không đổi literal, tên biến, tên FB hay nội dung chú thích', () => {
    const source = 'PROGRAM t\nVAR\nx_Ten : REAL;\nEND_VAR\nx_Ten := 1.50;\nfbTon(IN := TRUE, PT := T#5s);\nEND_PROGRAM'
    const formatted = format(source)
    expect(formatted).toContain('x_Ten := 1.50;')
    expect(formatted).toContain('T#5s')
    expect(formatted).toContain('fbTon(IN := TRUE, PT := T#5s);')
  })

  it('KHÔNG đổi hoa/thường của định danh, nhưng CÓ viết hoa từ khoá', () => {
    const formatted = format('PROGRAM t\nif aVar then\nbVar := true;\nend_if;\nEND_PROGRAM')
    expect(formatted).toContain('IF aVar THEN')
    expect(formatted).toContain('bVar := TRUE;')
    expect(formatted).toContain('END_IF;')
  })
})

describe('DEV-PROG-019 — chú thích: lớp lỗi mà bản regex đã gây ra', () => {
  it('chú thích chứa dấu ";" và chữ "IF" KHÔNG bị xé', () => {
    /* Bản regex cũ (`.replace(/;/g, ';\n')` + tách theo từ khoá) biến
     *   `(* chú thích có dấu ; và chữ IF bên trong *)`
     * thành ba dòng rác. Nó không biết mình đang ở trong chú thích. */
    const source = 'PROGRAM t\n(* chú thích có dấu ; và chữ IF bên trong *)\nX := 1;\nEND_PROGRAM'
    const formatted = format(source)
    expect(formatted).toContain('(* chú thích có dấu ; và chữ IF bên trong *)')
  })

  it('chú thích cuối dòng ở LẠI cuối dòng đó', () => {
    const formatted = format('PROGRAM t\nX := 1; (* đặt lại *)\nY := 2;\nEND_PROGRAM')
    expect(formatted).toContain('X := 1;  (* đặt lại *)')
  })

  it('chú thích đứng riêng dòng KHÔNG bị kéo lên cùng dòng khai báo', () => {
    // Đề bài chốt rõ: dời chú thích lên cùng dòng là việc của "Organize
    // Declarations" sau này, KHÔNG phải của Định dạng.
    const formatted = format('PROGRAM t\nVAR\n(* UI-01 Supply Air Temperature *)\nSAT : REAL;\nEND_VAR\nEND_PROGRAM')
    const lines = formatted.split('\n').map((line) => line.trim())
    expect(lines).toContain('(* UI-01 Supply Air Temperature *)')
    expect(lines).toContain('SAT : REAL;')
    expect(formatted).not.toContain('SAT : REAL;  (* UI-01')
  })

  it('chú thích // tới hết dòng được giữ nguyên', () => {
    expect(format('PROGRAM t\n// ghi chú\nX := 1;\nEND_PROGRAM')).toContain('// ghi chú')
  })

  it('chú thích khối nhiều dòng giữ nguyên từng dòng bên trong', () => {
    const source = 'PROGRAM t\n(* dòng một\n   dòng hai *)\nX := 1;\nEND_PROGRAM'
    expect(format(source)).toContain('(* dòng một\n   dòng hai *)')
  })
})

describe('DEV-PROG-019 — fail-closed: không hiểu thì KHÔNG format', () => {
  it('chú thích chưa đóng ⇒ từ chối, không đổi một byte nào', () => {
    const source = 'PROGRAM t\n(* mở mà không đóng\nX := 1;\nEND_PROGRAM'
    const result = formatStDocument(source)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/không được đóng/)
  })

  it('cú pháp ngoài subset ⇒ từ chối kèm số dòng', () => {
    const result = formatStDocument('PROGRAM t\nX := ;\nEND_PROGRAM')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.line).toBeGreaterThan(0)
  })

  it('thiếu END_PROGRAM ⇒ từ chối, không đoán chỗ đóng khối', () => {
    expect(formatStDocument('PROGRAM t\nX := 1;').ok).toBe(false)
  })

  it('nguồn rỗng/toàn khoảng trắng ⇒ trả nguyên trạng, không báo lỗi', () => {
    expect(formatStDocument('')).toEqual({ ok: true, text: '', changed: false })
    expect(formatStDocument('   \n\t\n')).toEqual({ ok: true, text: '   \n\t\n', changed: false })
  })
})

describe('DEV-PROG-019 — bất biến của chính formatter', () => {
  const SOURCE = [
    'PROGRAM AHU',
    'VAR_INPUT',
    'SAT : REAL;',
    'Occupied : BOOL;',
    'END_VAR',
    'VAR RETAIN',
    'TripCount : INT;',
    'END_VAR',
    '',
    '(* mở van *)',
    'IF Occupied AND (SAT > 18.0) THEN',
    'Valve := 100.0;',
    'ELSIF NOT Occupied THEN',
    'Valve := 0.0;',
    'ELSE',
    'Valve := 50.0;',
    'END_IF;',
    'fbTon(IN := Occupied, PT := T#5s);',
    'END_PROGRAM',
  ].join('\n')

  it('format hai lần cho cùng một kết quả (idempotent)', () => {
    const once = format(SOURCE)
    expect(format(once)).toBe(once)
  })

  it('thụt lề bằng 4 dấu cách, không bao giờ có Tab', () => {
    const formatted = format(SOURCE.replace(/\n/g, '\n\t'))
    expect(formatted).not.toContain('\t')
    expect(formatted).toContain('\n    IF Occupied AND (SAT > 18.0) THEN')
  })

  it('"VAR RETAIN" ở lại trên MỘT dòng', () => {
    expect(format(SOURCE)).toContain('    VAR RETAIN\n')
  })

  it('nhiều dòng trống liên tiếp thu về đúng một', () => {
    const formatted = format('PROGRAM t\nX := 1;\n\n\n\n\nY := 2;\nEND_PROGRAM')
    expect(formatted).toContain('X := 1;\n\n    Y := 2;')
    expect(formatted).not.toContain('\n\n\n')
  })

  it('cây ngữ nghĩa sau khi format TRÙNG cây trước — đo trực tiếp trên AST', () => {
    const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item) =>
      (key === 'trivia' || key === 'endTrivia' || key === 'elseTrivia' ? undefined : item)))
    expect(strip(parseSt(format(SOURCE)))).toEqual(strip(parseSt(SOURCE)))
  })

  it('mọi token có nghĩa được giữ nguyên số lượng và thứ tự', () => {
    const significant = (text: string) => lexSt(text)
      .filter((token) => token.kind !== 'comment')
      .map((token) => (token.kind === 'keyword' ? token.text.toUpperCase() : token.text))
    expect(significant(format(SOURCE))).toEqual(significant(SOURCE))
  })
})

describe('DEV-PROG-019 — Format Selection', () => {
  const SOURCE = 'PROGRAM t\n    X := 1;\nY:=2;\n    Z := 3;\nEND_PROGRAM\n'

  it('chỉ thay các dòng nằm trong vùng chọn', () => {
    const start = SOURCE.indexOf('Y:=2;')
    const { result } = formatStRange(SOURCE, start, start + 5)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Dòng được chọn đã chuẩn hoá…
    expect(result.text).toContain('    Y := 2;')
    // …còn dòng ngoài vùng chọn giữ NGUYÊN khoảng trắng cũ.
    expect(result.text).toContain('    Z := 3;')
  })

  it('nguồn hỏng ⇒ vùng chọn không đổi và báo lỗi như Format Document', () => {
    const { result, selectionStart, selectionEnd } = formatStRange('PROGRAM t\nX := ;\nEND_PROGRAM', 3, 5)
    expect(result.ok).toBe(false)
    expect([selectionStart, selectionEnd]).toEqual([3, 5])
  })
})
