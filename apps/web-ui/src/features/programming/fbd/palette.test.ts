import { describe, expect, it } from 'vitest'

import { FBD_DATA_TYPES } from './model'
import {
  FBD_PALETTE,
  FBD_PALETTE_CATEGORY_ORDER,
  defaultConstantLiteral,
  fbdPaletteEntry,
  isValidConstantLiteral,
} from './palette'

/* Đối chiếu trực tiếp apps/core/application/st/st_program.cpp (kFuncs[]) và
 * st_fbd_compile.cpp (binop_from_type_ref, khối `type_ref == "NOT"`,
 * declare_function_blocks/st_fb_type_from_name) — FBD_EDITOR_DESIGN.md §1. */
const KFUNCS_ARITY: Record<string, number> = {
  ABS: 1, MIN: 2, MAX: 2, LIMIT: 3, SEL: 3, SQRT: 1,
  INT_TO_REAL: 1, REAL_TO_INT: 1, TIME_TO_REAL: 1, REAL_TO_TIME: 1,
  INT_TO_DINT: 1, INT_TO_UINT: 1, DINT_TO_INT: 1, DINT_TO_UINT: 1,
  UINT_TO_INT: 1, UINT_TO_DINT: 1, DINT_TO_REAL: 1, UINT_TO_REAL: 1,
  REAL_TO_DINT: 1, REAL_TO_UINT: 1,
}
const BINOP_TYPE_REFS = ['AND', 'OR', 'XOR', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD']

describe('FBD_PALETTE (FBD_EDITOR_DESIGN.md §1)', () => {
  it('mọi typeRef duy nhất và khớp entry.id', () => {
    const ids = FBD_PALETTE.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of FBD_PALETTE) expect(entry.typeRef).toBe(entry.id)
  })

  it('mọi category dùng trong palette có trong FBD_PALETTE_CATEGORY_ORDER', () => {
    const known = new Set(FBD_PALETTE_CATEGORY_ORDER.map((category) => category.id))
    for (const entry of FBD_PALETTE) expect(known.has(entry.category)).toBe(true)
  })

  it('binop (AND/OR/XOR/EQ/NE/LT/LE/GT/GE/ADD/SUB/MUL/DIV/MOD) luôn đúng 2 input + 1 output', () => {
    for (const typeRef of BINOP_TYPE_REFS) {
      const entry = fbdPaletteEntry(typeRef)
      expect(entry, `missing palette entry for ${typeRef}`).toBeDefined()
      const ports = entry!.buildPorts(entry!.defaultType)
      expect(ports.filter((port) => port.direction === 'INPUT')).toHaveLength(2)
      expect(ports.filter((port) => port.direction === 'OUTPUT')).toHaveLength(1)
    }
  })

  it('NOT là unary (1 input, 1 output) — xử lý riêng ngoài binop map và kFuncs', () => {
    const entry = fbdPaletteEntry('NOT')
    const ports = entry!.buildPorts('BOOL')
    expect(ports.filter((port) => port.direction === 'INPUT')).toHaveLength(1)
    expect(ports.filter((port) => port.direction === 'OUTPUT')).toHaveLength(1)
  })

  it('arity kFuncs khớp đúng số input port cho mọi hàm liệt kê trong bảng nguồn', () => {
    for (const [typeRef, arity] of Object.entries(KFUNCS_ARITY)) {
      const entry = fbdPaletteEntry(typeRef)
      expect(entry, `missing palette entry for ${typeRef}`).toBeDefined()
      const ports = entry!.buildPorts(entry!.defaultType)
      expect(ports.filter((port) => port.direction === 'INPUT')).toHaveLength(arity)
      expect(ports.filter((port) => port.direction === 'OUTPUT')).toHaveLength(1)
    }
  })

  it('so sánh (EQ/NE/LT/LE/GT/GE) luôn xuất OUT:BOOL kể cả khi đổi kiểu toán hạng', () => {
    for (const typeRef of ['EQ', 'NE', 'LT', 'LE', 'GT', 'GE']) {
      const entry = fbdPaletteEntry(typeRef)!
      for (const type of entry.allowedTypes) {
        const ports = entry.buildPorts(type)
        expect(ports.find((port) => port.name === 'OUT')?.dataType).toBe('BOOL')
      }
    }
  })

  it('MOD chỉ cho phép INT/DINT/UINT, không cho REAL/BOOL/TIME', () => {
    const entry = fbdPaletteEntry('MOD')!
    expect([...entry.allowedTypes].sort()).toEqual(['DINT', 'INT', 'UINT'].sort())
  })

  it('TON/TOF/R_TRIG/F_TRIG/PID có port shape cố định theo st_fb_*', () => {
    expect(fbdPaletteEntry('TON')!.buildPorts('BOOL')).toEqual([
      { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
      { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
      { name: 'ET', direction: 'OUTPUT', dataType: 'TIME' },
    ])
    expect(fbdPaletteEntry('R_TRIG')!.buildPorts('BOOL')).toEqual([
      { name: 'CLK', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
    ])
    const pid = fbdPaletteEntry('PID')!
    expect(pid.warning).toBeDefined()
    expect(pid.buildPorts('REAL')).toHaveLength(10)
  })

  it('14 hàm chuyển đổi có đúng 1 input/1 output, kiểu cố định theo tên', () => {
    const conversions = FBD_PALETTE.filter((entry) => entry.kind === 'CONVERSION')
    expect(conversions).toHaveLength(14)
    for (const entry of conversions) {
      const ports = entry.buildPorts(entry.defaultType)
      expect(ports).toHaveLength(2)
      const [from, to] = entry.typeRef.split('_TO_')
      expect(ports[0].dataType).toBe(from)
      expect(ports[1].dataType).toBe(to)
    }
  })
})

describe('isValidConstantLiteral / defaultConstantLiteral', () => {
  it('chấp nhận default literal của chính nó cho mọi kiểu', () => {
    for (const type of FBD_DATA_TYPES) {
      expect(isValidConstantLiteral(type, defaultConstantLiteral(type))).toBe(true)
    }
  })

  it('từ chối giá trị sai kiểu hoặc ngoài khoảng (INT int16, UINT không âm)', () => {
    expect(isValidConstantLiteral('BOOL', 1)).toBe(false)
    expect(isValidConstantLiteral('INT', 40000)).toBe(false)
    expect(isValidConstantLiteral('UINT', -1)).toBe(false)
    expect(isValidConstantLiteral('REAL', Number.NaN)).toBe(false)
    expect(isValidConstantLiteral('TIME', 'not-a-time')).toBe(false)
    expect(isValidConstantLiteral('TIME', 'T#1m30s')).toBe(true)
  })
})
