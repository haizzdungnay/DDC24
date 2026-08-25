import { describe, expect, it } from 'vitest'

import {
  PROGRAMMING_LIBRARY_CATEGORY_ORDER,
  PROGRAMMING_LIBRARY_ENTRIES,
} from '../api/generated/library_registry'
import { FBD_DATA_TYPES } from './model'
import {
  FBD_PALETTE,
  FBD_PALETTE_CATEGORY_ORDER,
  defaultConstantLiteral,
  fbdPaletteEntry,
  isValidConstantLiteral,
  paletteEntriesCompatibleWith,
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

describe('Palette sinh từ registry POU/Control Library (T59-003)', () => {
  it('không còn entry ma SCALE/DEADBAND/PI', () => {
    // Ba entry này từng nằm trong allowlist FBD của Core mà compiler không hề
    // có; nay registry là nguồn duy nhất nên chúng không thể quay lại một phía.
    // `CTU` đã RỜI danh sách ở `T59-804`: nó có compiler/runtime thật và vector
    // conformance cycle-by-cycle — đó mới là điều kiện để một tên rời danh sách
    // này, không phải vì ai đó muốn thấy nó trên palette.
    for (const ghost of ['SCALE', 'DEADBAND', 'PI']) {
      expect(FBD_PALETTE.some((entry) => entry.id === ghost)).toBe(false)
      expect(PROGRAMMING_LIBRARY_ENTRIES.some((entry) => entry.id === ghost)).toBe(false)
    }
  })

  it('chào đúng những entry Core từng từ chối: SQRT và 4 conversion', () => {
    for (const id of ['SQRT', 'INT_TO_REAL', 'REAL_TO_INT', 'TIME_TO_REAL', 'REAL_TO_TIME']) {
      expect(fbdPaletteEntry(id)).toBeDefined()
    }
  })

  it('palette bằng đúng registry, không thêm bớt', () => {
    expect(FBD_PALETTE.map((entry) => entry.id)).toEqual(
      PROGRAMMING_LIBRARY_ENTRIES.map((entry) => entry.id),
    )
    expect(FBD_PALETTE_CATEGORY_ORDER).toEqual(PROGRAMMING_LIBRARY_CATEGORY_ORDER)
  })

  it('buildPorts chỉ đổi kiểu cho port nằm trong typedPortNames', () => {
    for (const entry of FBD_PALETTE) {
      const source = PROGRAMMING_LIBRARY_ENTRIES.find((item) => item.id === entry.id)
      expect(source).toBeDefined()
      const probe = entry.polymorphic
        ? entry.allowedTypes.find((type) => type !== entry.defaultType)
        : entry.defaultType
      const ports = entry.buildPorts(probe ?? entry.defaultType)
      expect(ports.map((port) => port.name)).toEqual(source!.ports.map((port) => port.name))
      for (const [index, port] of ports.entries()) {
        const declared = source!.ports[index]
        if (entry.typedPortNames.includes(port.name)) {
          expect(port.dataType).toBe(probe ?? entry.defaultType)
        } else {
          expect(port.dataType).toBe(declared.dataType)
        }
      }
    }
  })

  it('PID giữ trạng thái REVIEW_REQUIRED kèm cảnh báo song ngữ', () => {
    const review = PROGRAMMING_LIBRARY_ENTRIES.filter(
      (entry) => entry.featureState === 'REVIEW_REQUIRED',
    )
    expect(review.map((entry) => entry.id)).toEqual(['PID'])
    expect(fbdPaletteEntry('PID')?.warning?.vi).toBeTruthy()
    expect(fbdPaletteEntry('PID')?.warning?.en).toBeTruthy()
  })
})

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

describe('T59-804 — lọc palette theo cổng đang chọn', () => {
  it('không có cổng nào đang chọn thì KHÔNG lọc', () => {
    expect(paletteEntriesCompatibleWith(FBD_PALETTE, null)).toHaveLength(FBD_PALETTE.length)
  })

  it('giữ block đa hình nhận kiểu đó và block có cổng kiểu cố định đó', () => {
    const forTime = paletteEntriesCompatibleWith(FBD_PALETTE, 'TIME').map((entry) => entry.id)
    // TON/TOF có cổng `PT:TIME` cố định — phải còn lại dù không đa hình.
    expect(forTime).toContain('TON')
    expect(forTime).toContain('TOF')
    // AND chỉ có cổng BOOL: không khớp cổng TIME.
    expect(forTime).not.toContain('AND')
  })

  it('so sánh vẫn khớp cổng BOOL nhờ OUT:BOOL cố định', () => {
    const forBool = paletteEntriesCompatibleWith(FBD_PALETTE, 'BOOL').map((entry) => entry.id)
    expect(forBool).toContain('GT')
    expect(forBool).toContain('AND')
  })

  it('lọc không bao giờ rỗng hoá palette một cách im lặng — kiểu lạ trả rỗng có thể quan sát', () => {
    const filtered = paletteEntriesCompatibleWith(FBD_PALETTE, 'REAL')
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.length).toBeLessThan(FBD_PALETTE.length)
  })
})
