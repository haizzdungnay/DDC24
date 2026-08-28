import { describe, expect, it } from 'vitest'
import type { CatalogEntry } from '../library/libraryCatalog'
import {
  collectDeclaredInstances,
  maskStComments,
  nextInstanceName,
  planLibraryInsertion,
  stCallStatement,
} from './stInstanceInsertion'

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    entryId: 'SYSTEM:TON',
    scope: 'SYSTEM',
    kind: 'FUNCTION_BLOCK',
    name: 'TON',
    labelVi: 'Trễ bật',
    labelEn: 'On delay',
    category: 'timer',
    libraryVersion: '1.0.0',
    contentSha256: 'a'.repeat(64),
    usability: { kind: 'AVAILABLE' },
    ports: [
      { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
      { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
    ],
    allowedTypes: [],
    stateful: true,
    ...overrides,
  }
}

const FUNCTION_ENTRY = entry({
  entryId: 'SYSTEM:LIMIT',
  kind: 'FUNCTION',
  name: 'LIMIT',
  stateful: false,
  ports: [
    { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
    { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
    { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
    { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' },
  ],
})

describe('stInstanceInsertion', () => {
  it('che chú thích nhưng giữ nguyên offset', () => {
    const source = 'PROGRAM P\n(* END_VAR bẫy *)\nVAR\n  A : INT;\nEND_VAR\nEND_PROGRAM\n'
    const masked = maskStComments(source)
    expect(masked).toHaveLength(source.length)
    expect(masked.indexOf('VAR\n')).toBe(source.indexOf('VAR\n'))
    // chữ END_VAR nằm trong chú thích không còn nhìn thấy được
    expect(masked.slice(10, 27)).not.toContain('END_VAR')
  })

  it('khai báo instance đi vào khối VAR, KHÔNG nằm giữa thân', () => {
    const source = 'PROGRAM P\nVAR\n  A : INT;\nEND_VAR\nA := 1;\nEND_PROGRAM\n'
    const cursor = source.indexOf('A := 1;') + 'A := 1;'.length
    const plan = planLibraryInsertion(source, entry(), cursor)

    expect(plan.declarationAdded).toBe(true)
    expect(plan.instanceName).toBe('TON_1')
    expect(plan.text).toBe(
      'PROGRAM P\nVAR\n  A : INT;\n  TON_1 : TON;\nEND_VAR\nA := 1;\nTON_1(IN := IN, PT := PT);\nEND_PROGRAM\n',
    )
    // không có khối VAR thứ hai nào bị sinh ra giữa thân
    expect(plan.text.match(/END_VAR/g)).toHaveLength(1)
  })

  it('dựng khối VAR mới khi POU chưa có khối nào nhận được instance', () => {
    const source = 'PROGRAM P\nVAR_INPUT\n  Cmd : BOOL;\nEND_VAR\nCmd := TRUE;\nEND_PROGRAM\n'
    const plan = planLibraryInsertion(source, entry(), source.length)

    expect(plan.declarationAdded).toBe(true)
    expect(plan.text).toContain('VAR\n  TON_1 : TON;\nEND_VAR')
    // VAR_INPUT không được dùng làm chỗ khai instance (parser từ chối)
    expect(plan.text.indexOf('VAR_INPUT')).toBeLessThan(plan.text.indexOf('TON_1 : TON;'))
  })

  it('giữ nguyên kiểu viết một dòng của khối VAR sẵn có', () => {
    const source = 'PROGRAM test VAR Counter : INT; END_VAR Counter := Counter + 1; END_PROGRAM'
    const plan = planLibraryInsertion(source, entry(), source.length)

    expect(plan.text).toContain('VAR Counter : INT; TON_1 : TON; END_VAR')
    expect(plan.text.match(/END_VAR/g)).toHaveLength(1)
  })

  it('lời gọi bị dời xuống thân khi con trỏ đang ở vùng khai báo', () => {
    const source = 'PROGRAM P\nVAR\n  A : INT;\nEND_VAR\nA := 1;\nEND_PROGRAM\n'
    const cursorInsideVar = source.indexOf('A : INT;')
    const plan = planLibraryInsertion(source, entry(), cursorInsideVar)

    expect(plan.callRelocated).toBe(true)
    const callAt = plan.text.indexOf('TON_1(IN := IN, PT := PT);')
    expect(callAt).toBeGreaterThan(plan.text.indexOf('END_VAR'))
  })

  it('tên instance mới không đụng định danh đang có, kể cả khác hoa thường', () => {
    const source = 'PROGRAM P\nVAR\n  TON_1 : TON;\n  ton_2 : TON;\nEND_VAR\nEND_PROGRAM\n'
    expect(nextInstanceName(source, 'TON')).toBe('TON_3')
  })

  it('chọn instance đã khai thì KHÔNG sinh thêm khai báo', () => {
    const source = 'PROGRAM P\nVAR\n  FanDelay : TON;\nEND_VAR\nEND_PROGRAM\n'
    const plan = planLibraryInsertion(source, entry(), source.indexOf('END_PROGRAM'), { instanceName: 'FanDelay' })

    expect(plan.declarationAdded).toBe(false)
    expect(plan.instanceName).toBe('FanDelay')
    expect(plan.text.match(/FanDelay : TON;/g)).toHaveLength(1)
    expect(plan.text).toContain('FanDelay(IN := IN, PT := PT);')
  })

  it('liệt kê đúng instance của một kiểu, bỏ qua biến thường', () => {
    const source = 'PROGRAM P\nVAR\n  A : INT;\n  T1 : TON;\n  T2 : TOF;\nEND_VAR\nEND_PROGRAM\n'
    expect(collectDeclaredInstances(source, 'TON').map((item) => item.name)).toEqual(['T1'])
    expect(collectDeclaredInstances(source).map((item) => item.name)).toEqual(['A', 'T1', 'T2'])
  })

  it('FUNCTION chèn thẳng lời gọi, không tạo instance', () => {
    const source = 'PROGRAM P\nX := 0;\nEND_PROGRAM\n'
    const plan = planLibraryInsertion(source, FUNCTION_ENTRY, source.indexOf('X := 0;') + 7)

    expect(plan.instanceName).toBeNull()
    expect(plan.declarationAdded).toBe(false)
    expect(plan.text).toContain('OUT := LIMIT(MN, IN, MX);')
    expect(stCallStatement(FUNCTION_ENTRY)).toBe('OUT := LIMIT(MN, IN, MX);')
  })

  it('con trỏ dừng ngay sau lời gọi vừa chèn', () => {
    const source = 'PROGRAM P\nA := 1;\nEND_PROGRAM\n'
    const plan = planLibraryInsertion(source, FUNCTION_ENTRY, source.indexOf('A := 1;') + 7)
    expect(plan.text.slice(0, plan.selectionStart).endsWith('OUT := LIMIT(MN, IN, MX);')).toBe(true)
    expect(plan.selectionEnd).toBe(plan.selectionStart)
  })

  it('giữ thụt lề của dòng đang đứng khi chèn giữa thân', () => {
    const source = 'PROGRAM P\nIF A THEN\n  B := 1;\nEND_IF;\nEND_PROGRAM\n'
    const plan = planLibraryInsertion(source, FUNCTION_ENTRY, source.indexOf('B := 1;') + 7)
    expect(plan.text).toContain('  B := 1;\n  OUT := LIMIT(MN, IN, MX);\n')
  })
})

/** `a` là dãy con của `b` theo đúng thứ tự — bằng chứng "không xoá ký tự nào". */
function isSubsequence(a: string, b: string): boolean {
  let index = 0
  for (const char of b) if (index < a.length && char === a[index]) index += 1
  return index === a.length
}

describe('planLibraryInsertion — nguồn ngoài subset vẫn cho kế hoạch dùng được', () => {
  const HOSTILE = [
    '',
    'PROGRAM P\n(* không đóng\nEND_PROGRAM\n',
    'PROGRAM P\nVAR\n  A : INT;\nEND_PROGRAM\n',
    'VAR END_VAR VAR END_VAR',
    ')(:=',
  ]

  it.each(HOSTILE)('không ném, giữ nguyên phần nguồn cũ: %j', (source) => {
    for (const target of [entry(), FUNCTION_ENTRY]) {
      const plan = planLibraryInsertion(source, target, source.length)
      expect(plan.text.length).toBeGreaterThanOrEqual(source.length)
      expect(plan.selectionStart).toBeGreaterThanOrEqual(0)
      expect(plan.selectionStart).toBeLessThanOrEqual(plan.text.length)
      expect(plan.selectionEnd).toBe(plan.selectionStart)
      // mọi ký tự cũ vẫn còn theo đúng thứ tự: kế hoạch chỉ CHÈN, không xoá.
      // (Không dùng `toContain` vì chèn giữa nguồn làm đứt đoạn liên tục.)
      expect(isSubsequence(source, plan.text)).toBe(true)
    }
  })
})
