import { describe, expect, it } from 'vitest'
import {
  buildCommandPaletteEntries,
  filterPaletteEntries,
  toggleComment,
  wrapInBlock,
  type PaletteEntry,
} from './quickControl'

const pick = (vi: string) => vi

describe('toggleComment', () => {
  it('bọc vùng chọn chưa có comment', () => {
    const source = 'X := 1;'
    const result = toggleComment(source, 5, 6)
    expect(result.text).toBe('X := (* 1 *);')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('(* 1 *)')
  })

  it('gỡ comment khi vùng chọn đã đúng khớp định dạng gói — round-trip đối xứng', () => {
    const original = 'X := 1;'
    const wrapped = toggleComment(original, 5, 6)
    const unwrapped = toggleComment(wrapped.text, wrapped.selectionStart, wrapped.selectionEnd)
    expect(unwrapped.text).toBe(original)
    expect(unwrapped.selectionStart).toBe(5)
    expect(unwrapped.selectionEnd).toBe(6)
  })

  it('vùng chọn rỗng (start === end) không đổi gì', () => {
    const result = toggleComment('X := 1;', 3, 3)
    expect(result.text).toBe('X := 1;')
    expect(result.selectionStart).toBe(3)
    expect(result.selectionEnd).toBe(3)
  })
})

describe('wrapInBlock', () => {
  it('bọc một dòng đơn trong IF…THEN/END_IF, thụt lề thêm 2 khoảng trắng', () => {
    const source = 'PROGRAM P\n  FanSpeed := 80;\nEND_PROGRAM\n'
    const lineStart = source.indexOf('  FanSpeed')
    const lineEnd = lineStart + '  FanSpeed := 80;'.length
    const result = wrapInBlock(source, lineStart, lineEnd, 'IF')
    expect(result.text).toBe(
      'PROGRAM P\n  IF TRUE THEN\n    FanSpeed := 80;\n  END_IF;\nEND_PROGRAM\n',
    )
  })

  it('điều kiện placeholder "TRUE" được chọn sẵn để gõ đè', () => {
    const source = 'PROGRAM P\n  FanSpeed := 80;\nEND_PROGRAM\n'
    const lineStart = source.indexOf('  FanSpeed')
    const lineEnd = lineStart + '  FanSpeed := 80;'.length
    const result = wrapInBlock(source, lineStart, lineEnd, 'IF')
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('TRUE')
  })

  it('bọc nhiều dòng: mọi dòng có nội dung đều được thụt lề thêm, dòng trống giữ nguyên', () => {
    const source = 'PROGRAM P\n  A := 1;\n\n  B := 2;\nEND_PROGRAM\n'
    const start = source.indexOf('  A := 1;')
    const end = source.indexOf('B := 2;') + 'B := 2;'.length
    const result = wrapInBlock(source, start, end, 'IF')
    expect(result.text).toBe(
      'PROGRAM P\n  IF TRUE THEN\n    A := 1;\n\n    B := 2;\n  END_IF;\nEND_PROGRAM\n',
    )
  })

  it('vùng chọn nằm giữa dòng vẫn mở rộng ra trọn dòng trước khi bọc (không cắt dòng)', () => {
    const source = 'PROGRAM P\n  FanSpeed := 80;\nEND_PROGRAM\n'
    // chọn chỉ đúng chữ "FanSpeed" (không phải trọn dòng)
    const start = source.indexOf('FanSpeed')
    const end = start + 'FanSpeed'.length
    const result = wrapInBlock(source, start, end, 'IF')
    expect(result.text).toBe(
      'PROGRAM P\n  IF TRUE THEN\n    FanSpeed := 80;\n  END_IF;\nEND_PROGRAM\n',
    )
  })
})

describe('buildCommandPaletteEntries', () => {
  const programs = [
    { programId: 'p1', name: 'AHU_FanControl', language: 'ST' as const },
    { programId: 'p2', name: 'AHU_FBD', language: 'FBD' as const },
  ]

  it('tạo mục Program cho mọi Program, mục Variable chỉ cho Program ST', () => {
    const entries = buildCommandPaletteEntries(
      programs,
      { p1: [{ name: 'SupplyTemp', type: 'REAL', offset: 10 }] },
      pick,
    )
    const programEntries = entries.filter((entry) => entry.kind === 'program')
    expect(programEntries).toHaveLength(2)
    const variableEntries = entries.filter((entry) => entry.kind === 'variable')
    expect(variableEntries).toHaveLength(1)
    expect(variableEntries[0]).toMatchObject({ programId: 'p1', label: 'SupplyTemp' })
  })

  it('luôn có đúng ba mục Lệnh: Định dạng/Lưu/Kiểm tra — không có mục diagnostic (PGM-02 không còn nhận diagnostic thật sau D-01)', () => {
    const entries = buildCommandPaletteEntries(programs, {}, pick)
    const commandEntries = entries.filter((entry) => entry.kind === 'command')
    expect(commandEntries.map((entry) => entry.commandId)).toEqual(['format', 'save', 'check'])
    expect(entries.some((entry) => entry.kind === ('diagnostic' as never))).toBe(false)
  })
})

describe('filterPaletteEntries', () => {
  const entries: PaletteEntry[] = [
    { kind: 'program', programId: 'p1', label: 'AHU_FanControl', detail: 'ST' },
    { kind: 'variable', programId: 'p1', programName: 'AHU_FanControl', label: 'SupplyTemp', detail: 'REAL · AHU_FanControl', offset: 0, length: 10 },
    { kind: 'command', commandId: 'save', label: 'Lưu', detail: 'Lưu Draft' },
  ]

  it('chuỗi rỗng trả về nguyên vẹn danh sách', () => {
    expect(filterPaletteEntries(entries, '')).toHaveLength(3)
  })

  it('so khớp không phân biệt hoa/thường trên label', () => {
    expect(filterPaletteEntries(entries, 'supply')).toEqual([entries[1]])
  })

  it('so khớp trên detail (vd tìm theo tên Program chứa trong detail của biến)', () => {
    const result = filterPaletteEntries(entries, 'fancontrol')
    expect(result.map((entry) => entry.kind)).toEqual(['program', 'variable'])
  })

  it('không khớp gì trả về mảng rỗng', () => {
    expect(filterPaletteEntries(entries, 'zzz-không-tồn-tại')).toEqual([])
  })
})
