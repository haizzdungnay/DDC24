import { describe, expect, it } from 'vitest'
import { buildStReferenceIndex, stSymbolAt } from './stReferenceIndex'

const SOURCE = [
  'PROGRAM AHU',
  'VAR',
  '  SupplyTemp : REAL;',
  '  FanCmd : BOOL;',
  '  FanDelay : TON;',
  'END_VAR',
  'FanCmd := SupplyTemp > 22.0;',
  'FanDelay(IN := FanCmd, PT := T#5s);',
  'IF FanDelay.Q THEN',
  '  FanCmd := FALSE;',
  'END_IF;',
  'END_PROGRAM',
  '',
].join('\n')

describe('stReferenceIndex', () => {
  it('phân biệt biến thường với instance FUNCTION_BLOCK', () => {
    const index = buildStReferenceIndex(SOURCE)
    expect(index.byName.get('SupplyTemp')?.kind).toBe('VARIABLE')
    expect(index.byName.get('FanDelay')?.kind).toBe('FB_INSTANCE')
    expect(index.byName.get('FanDelay')?.typeName).toBe('TON')
  })

  it('gán tham số trong lời gọi KHÔNG bị tính là ghi', () => {
    const index = buildStReferenceIndex(SOURCE)
    const fanCmd = index.byName.get('FanCmd')
    // `FanCmd :=` ở mức câu lệnh: 2 lần ghi. `IN := FanCmd` là đọc.
    expect(fanCmd?.occurrences.filter((item) => item.role === 'WRITE')).toHaveLength(2)
    expect(fanCmd?.occurrences.filter((item) => item.role === 'READ')).toHaveLength(1)
  })

  it('instance chỉ được ĐỌC kể cả khi thành viên của nó bị gán', () => {
    const source = 'PROGRAM P\nVAR\n  T1 : TON;\nEND_VAR\nT1.PT := T#1s;\nEND_PROGRAM\n'
    const index = buildStReferenceIndex(source)
    expect(index.byName.get('T1')?.occurrences.every((item) => item.role === 'READ')).toBe(true)
  })

  it('lần xuất hiện trong khối VAR không tính là dùng', () => {
    const index = buildStReferenceIndex(SOURCE)
    const supply = index.byName.get('SupplyTemp')
    expect(supply?.occurrences).toHaveLength(1)
    expect(supply?.occurrences[0].role).toBe('READ')
  })

  it('khai báo trong chú thích không tạo ký hiệu ma', () => {
    const source = 'PROGRAM P\n(* VAR Ghost : INT; END_VAR *)\nVAR\n  Real1 : INT;\nEND_VAR\nEND_PROGRAM\n'
    const index = buildStReferenceIndex(source)
    expect(index.byName.has('Ghost')).toBe(false)
    expect(index.byName.has('Real1')).toBe(true)
  })

  it('tra được ký hiệu dưới con trỏ, kể cả khi con trỏ ở cuối tên', () => {
    const at = SOURCE.indexOf('FanDelay(')
    expect(stSymbolAt(SOURCE, at)?.identifier).toBe('FanDelay')
    expect(stSymbolAt(SOURCE, at + 'FanDelay'.length)?.identifier).toBe('FanDelay')
    expect(stSymbolAt(SOURCE, at)?.entry?.typeName).toBe('TON')
  })

  it('định danh chưa khai báo trả entry null — KHÔNG đoán', () => {
    const source = 'PROGRAM P\nUnknownThing := 1;\nEND_PROGRAM\n'
    const found = stSymbolAt(source, source.indexOf('UnknownThing') + 2)
    expect(found?.identifier).toBe('UnknownThing')
    expect(found?.entry).toBeNull()
  })

  it('con trỏ ở chỗ không phải định danh trả null', () => {
    expect(stSymbolAt(SOURCE, SOURCE.indexOf(' > 22.0') + 2)).toBeNull()
  })

  it('offset khai báo trỏ đúng vào tên trong khối VAR', () => {
    const index = buildStReferenceIndex(SOURCE)
    const entry = index.byName.get('FanDelay')
    expect(SOURCE.slice(entry!.declarationOffset, entry!.declarationOffset + 'FanDelay'.length)).toBe('FanDelay')
    expect(entry!.declarationOffset).toBeLessThan(SOURCE.indexOf('END_VAR'))
  })
})

/* `AC-ST-010` ở lớp module thuần: nguồn mà compiler không nhận vẫn không được
 * làm hàm nào ném lỗi — editor dựng trên hai hàm này, một `throw` là mất buffer
 * người dùng đang gõ. */
describe('stReferenceIndex — nguồn ngoài subset không ném lỗi', () => {
  const HOSTILE = [
    '',
    '   \n\t',
    'PROGRAM P\n(* chú thích không đóng\nEND_PROGRAM\n',
    'PROGRAM P\nVAR\n  A : INT;\nEND_PROGRAM\n',
    'VAR VAR VAR END_VAR END_VAR',
    'PROGRAM P\nVAR A : ARRAY[1..10] OF INT; END_VAR\nEND_PROGRAM\n',
    ')(:=:=:=',
    `PROGRAM P\nVAR\n${'  X : INT;\n'.repeat(200)}END_VAR\nEND_PROGRAM\n`,
  ]

  it.each(HOSTILE)('không ném và trả offset hợp lệ: %j', (source) => {
    const index = buildStReferenceIndex(source)
    for (const entry of index.symbols) {
      expect(entry.declarationOffset).toBeGreaterThanOrEqual(0)
      expect(entry.declarationOffset).toBeLessThanOrEqual(source.length)
      for (const occurrence of entry.occurrences) {
        expect(occurrence.offset).toBeGreaterThanOrEqual(0)
        expect(occurrence.offset).toBeLessThan(source.length)
      }
    }
    for (let offset = 0; offset <= source.length; offset += 1) {
      const found = stSymbolAt(source, offset, index)
      if (found) expect(found.end).toBeGreaterThan(found.start)
    }
  })
})

describe('DEV-PROG-004 — từ khoá ST không phải ký hiệu', () => {
  it('con trỏ trên PROGRAM/VAR/IF trả null, không trả một "ký hiệu chưa tra được"', () => {
    // Con trỏ đặt ở đầu tệp (mặc định khi vừa mở POU) từng làm Inspector chuyển
    // sang ngữ cảnh "Ký hiệu ST" với bốn dòng "không xác định được", che mất
    // thuộc tính của chính POU đang mở. `PROGRAM` không phải một biến chưa tra
    // được — nó là một từ khoá.
    const source = 'PROGRAM P\nVAR\n  Fan : BOOL;\nEND_VAR\nIF Fan THEN\nEND_IF\nEND_PROGRAM\n'
    expect(stSymbolAt(source, 0)).toBeNull()
    expect(stSymbolAt(source, source.indexOf('VAR'))).toBeNull()
    expect(stSymbolAt(source, source.indexOf('IF Fan'))).toBeNull()
    // Ký hiệu thật vẫn tra được như cũ.
    expect(stSymbolAt(source, source.indexOf('Fan : BOOL'))?.identifier).toBe('Fan')
  })
})
