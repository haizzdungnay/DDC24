import { FBD_DATA_TYPES, type FbdDataType, type FbdNodeKind, type FbdParameterValue } from './model'

/* FBD_EDITOR_DESIGN.md §1 (DDD-FBD-EDITOR-PROG-001) — mọi entry ở đây đối
 * chiếu trực tiếp `apps/core/application/st/st_program.cpp` (`kFuncs[]`) và
 * `st_fbd_compile.cpp` (`binop_from_type_ref`, khối `type_ref == "NOT"`,
 * `st_fb_type_from_name`). Không thêm typeRef nào compiler chưa hỗ trợ. */

export type FbdPaletteCategory =
  | 'interface' | 'constants' | 'logic' | 'compare' | 'math'
  | 'conversion' | 'timer' | 'trigger' | 'control'

export interface FbdPalettePortTemplate {
  name: string
  direction: 'INPUT' | 'OUTPUT'
  dataType: FbdDataType
}

export interface FbdPaletteEntry {
  id: string
  kind: Extract<FbdNodeKind, 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'>
  typeRef: string
  category: FbdPaletteCategory
  labelVi: string
  labelEn: string
  /** Có toán hạng kiểu T chọn được lúc tạo/sửa hay không. */
  polymorphic: boolean
  allowedTypes: readonly FbdDataType[]
  defaultType: FbdDataType
  /** Tên các port đổi theo T khi `SET_NODE_TYPE`; port không có trong danh
   *  sách này giữ nguyên kiểu cố định (vd `OUT:BOOL` của phép so sánh). */
  typedPortNames: readonly string[]
  warning?: { vi: string; en: string }
  buildPorts: (operandType: FbdDataType) => FbdPalettePortTemplate[]
}

const NUMERIC_TYPES: readonly FbdDataType[] = ['INT', 'DINT', 'UINT', 'REAL']
const INTEGRAL_TYPES: readonly FbdDataType[] = ['INT', 'DINT', 'UINT']
const COMPARABLE_TYPES: readonly FbdDataType[] = FBD_DATA_TYPES

function p(name: string, direction: 'INPUT' | 'OUTPUT', dataType: FbdDataType): FbdPalettePortTemplate {
  return { name, direction, dataType }
}

function fixedPorts(ports: FbdPalettePortTemplate[]): FbdPaletteEntry['buildPorts'] {
  return () => ports
}

function boolBinop(typeRef: string, labelVi: string, labelEn: string): FbdPaletteEntry {
  return {
    id: typeRef, kind: 'FUNCTION', typeRef, category: 'logic', labelVi, labelEn,
    polymorphic: false, allowedTypes: ['BOOL'], defaultType: 'BOOL', typedPortNames: [],
    buildPorts: fixedPorts([p('IN1', 'INPUT', 'BOOL'), p('IN2', 'INPUT', 'BOOL'), p('OUT', 'OUTPUT', 'BOOL')]),
  }
}

function compareOp(typeRef: string, labelVi: string, labelEn: string): FbdPaletteEntry {
  return {
    id: typeRef, kind: 'FUNCTION', typeRef, category: 'compare', labelVi, labelEn,
    polymorphic: true, allowedTypes: COMPARABLE_TYPES, defaultType: 'REAL', typedPortNames: ['IN1', 'IN2'],
    buildPorts: (t) => [p('IN1', 'INPUT', t), p('IN2', 'INPUT', t), p('OUT', 'OUTPUT', 'BOOL')],
  }
}

function binMathOp(typeRef: string, labelVi: string, labelEn: string, allowedTypes: readonly FbdDataType[], defaultType: FbdDataType): FbdPaletteEntry {
  return {
    id: typeRef, kind: 'FUNCTION', typeRef, category: 'math', labelVi, labelEn,
    polymorphic: true, allowedTypes, defaultType, typedPortNames: ['IN1', 'IN2', 'OUT'],
    buildPorts: (t) => [p('IN1', 'INPUT', t), p('IN2', 'INPUT', t), p('OUT', 'OUTPUT', t)],
  }
}

function conversion(typeRef: string, from: FbdDataType, to: FbdDataType): FbdPaletteEntry {
  return {
    id: typeRef, kind: 'CONVERSION', typeRef, category: 'conversion', labelVi: typeRef, labelEn: typeRef,
    polymorphic: false, allowedTypes: [from], defaultType: from, typedPortNames: [],
    buildPorts: fixedPorts([p('IN1', 'INPUT', from), p('OUT', 'OUTPUT', to)]),
  }
}

export const FBD_PALETTE: readonly FbdPaletteEntry[] = [
  // Logic (kFuncs không có AND/OR/XOR/NOT — xử lý riêng ở binop_from_type_ref
  // và khối `type_ref == "NOT"`, cả hai đã đọc trực tiếp trong st_fbd_compile.cpp)
  boolBinop('AND', 'AND', 'AND'),
  boolBinop('OR', 'OR', 'OR'),
  boolBinop('XOR', 'XOR', 'XOR'),
  {
    id: 'NOT', kind: 'FUNCTION', typeRef: 'NOT', category: 'logic', labelVi: 'NOT', labelEn: 'NOT',
    polymorphic: false, allowedTypes: ['BOOL'], defaultType: 'BOOL', typedPortNames: [],
    buildPorts: fixedPorts([p('IN1', 'INPUT', 'BOOL'), p('OUT', 'OUTPUT', 'BOOL')]),
  },
  {
    // kFuncs: {"SEL", StFunc::SEL, 3}
    id: 'SEL', kind: 'FUNCTION', typeRef: 'SEL', category: 'logic', labelVi: 'SEL (chọn theo điều kiện)', labelEn: 'SEL (select)',
    polymorphic: true, allowedTypes: COMPARABLE_TYPES, defaultType: 'REAL', typedPortNames: ['IN0', 'IN1', 'OUT'],
    buildPorts: (t) => [p('G', 'INPUT', 'BOOL'), p('IN0', 'INPUT', t), p('IN1', 'INPUT', t), p('OUT', 'OUTPUT', t)],
  },

  // Compare — binop_from_type_ref: EQ/NE/LT/LE/GT/GE, luôn OUT:BOOL
  compareOp('EQ', 'Bằng (EQ)', 'Equal (EQ)'),
  compareOp('NE', 'Khác (NE)', 'Not equal (NE)'),
  compareOp('LT', 'Nhỏ hơn (LT)', 'Less than (LT)'),
  compareOp('LE', 'Nhỏ hơn hoặc bằng (LE)', 'Less or equal (LE)'),
  compareOp('GT', 'Lớn hơn (GT)', 'Greater than (GT)'),
  compareOp('GE', 'Lớn hơn hoặc bằng (GE)', 'Greater or equal (GE)'),

  // Math — binop_from_type_ref: ADD/SUB/MUL/DIV/MOD; kFuncs: ABS,MIN,MAX,LIMIT,SQRT
  binMathOp('ADD', 'Cộng (ADD)', 'Add', NUMERIC_TYPES, 'REAL'),
  binMathOp('SUB', 'Trừ (SUB)', 'Subtract', NUMERIC_TYPES, 'REAL'),
  binMathOp('MUL', 'Nhân (MUL)', 'Multiply', NUMERIC_TYPES, 'REAL'),
  binMathOp('DIV', 'Chia (DIV)', 'Divide', NUMERIC_TYPES, 'REAL'),
  binMathOp('MOD', 'Chia lấy dư (MOD)', 'Modulo (MOD)', INTEGRAL_TYPES, 'INT'),
  {
    id: 'ABS', kind: 'FUNCTION', typeRef: 'ABS', category: 'math', labelVi: 'Giá trị tuyệt đối (ABS)', labelEn: 'Absolute value (ABS)',
    polymorphic: true, allowedTypes: NUMERIC_TYPES, defaultType: 'REAL', typedPortNames: ['IN1', 'OUT'],
    buildPorts: (t) => [p('IN1', 'INPUT', t), p('OUT', 'OUTPUT', t)],
  },
  binMathOp('MIN', 'Nhỏ nhất (MIN)', 'Minimum (MIN)', NUMERIC_TYPES, 'REAL'),
  binMathOp('MAX', 'Lớn nhất (MAX)', 'Maximum (MAX)', NUMERIC_TYPES, 'REAL'),
  {
    id: 'LIMIT', kind: 'FUNCTION', typeRef: 'LIMIT', category: 'math', labelVi: 'Giới hạn (LIMIT)', labelEn: 'Limit',
    polymorphic: true, allowedTypes: NUMERIC_TYPES, defaultType: 'REAL', typedPortNames: ['MN', 'IN', 'MX', 'OUT'],
    buildPorts: (t) => [p('MN', 'INPUT', t), p('IN', 'INPUT', t), p('MX', 'INPUT', t), p('OUT', 'OUTPUT', t)],
  },
  {
    id: 'SQRT', kind: 'FUNCTION', typeRef: 'SQRT', category: 'math', labelVi: 'Căn bậc hai (SQRT)', labelEn: 'Square root (SQRT)',
    polymorphic: false, allowedTypes: ['REAL'], defaultType: 'REAL', typedPortNames: [],
    buildPorts: fixedPorts([p('IN1', 'INPUT', 'REAL'), p('OUT', 'OUTPUT', 'REAL')]),
  },

  // Conversion — 14 hàm kFuncs, arity 1, kiểu cố định theo tên
  conversion('INT_TO_REAL', 'INT', 'REAL'),
  conversion('REAL_TO_INT', 'REAL', 'INT'),
  conversion('INT_TO_DINT', 'INT', 'DINT'),
  conversion('INT_TO_UINT', 'INT', 'UINT'),
  conversion('DINT_TO_INT', 'DINT', 'INT'),
  conversion('DINT_TO_UINT', 'DINT', 'UINT'),
  conversion('UINT_TO_INT', 'UINT', 'INT'),
  conversion('UINT_TO_DINT', 'UINT', 'DINT'),
  conversion('DINT_TO_REAL', 'DINT', 'REAL'),
  conversion('UINT_TO_REAL', 'UINT', 'REAL'),
  conversion('REAL_TO_DINT', 'REAL', 'DINT'),
  conversion('REAL_TO_UINT', 'REAL', 'UINT'),
  conversion('TIME_TO_REAL', 'TIME', 'REAL'),
  conversion('REAL_TO_TIME', 'REAL', 'TIME'),

  // Timer / Trigger / Control — st_fb_type_from_name (FUNCTION_BLOCK)
  {
    id: 'TON', kind: 'FUNCTION_BLOCK', typeRef: 'TON', category: 'timer', labelVi: 'Trễ lúc bật (TON)', labelEn: 'On-delay timer (TON)',
    polymorphic: false, allowedTypes: [], defaultType: 'BOOL', typedPortNames: [],
    buildPorts: fixedPorts([p('IN', 'INPUT', 'BOOL'), p('PT', 'INPUT', 'TIME'), p('Q', 'OUTPUT', 'BOOL'), p('ET', 'OUTPUT', 'TIME')]),
  },
  {
    id: 'TOF', kind: 'FUNCTION_BLOCK', typeRef: 'TOF', category: 'timer', labelVi: 'Trễ lúc tắt (TOF)', labelEn: 'Off-delay timer (TOF)',
    polymorphic: false, allowedTypes: [], defaultType: 'BOOL', typedPortNames: [],
    buildPorts: fixedPorts([p('IN', 'INPUT', 'BOOL'), p('PT', 'INPUT', 'TIME'), p('Q', 'OUTPUT', 'BOOL'), p('ET', 'OUTPUT', 'TIME')]),
  },
  {
    id: 'R_TRIG', kind: 'FUNCTION_BLOCK', typeRef: 'R_TRIG', category: 'trigger', labelVi: 'Cạnh lên (R_TRIG)', labelEn: 'Rising edge (R_TRIG)',
    polymorphic: false, allowedTypes: [], defaultType: 'BOOL', typedPortNames: [],
    buildPorts: fixedPorts([p('CLK', 'INPUT', 'BOOL'), p('Q', 'OUTPUT', 'BOOL')]),
  },
  {
    id: 'F_TRIG', kind: 'FUNCTION_BLOCK', typeRef: 'F_TRIG', category: 'trigger', labelVi: 'Cạnh xuống (F_TRIG)', labelEn: 'Falling edge (F_TRIG)',
    polymorphic: false, allowedTypes: [], defaultType: 'BOOL', typedPortNames: [],
    buildPorts: fixedPorts([p('CLK', 'INPUT', 'BOOL'), p('Q', 'OUTPUT', 'BOOL')]),
  },
  {
    id: 'PID', kind: 'FUNCTION_BLOCK', typeRef: 'PID', category: 'control', labelVi: 'Bộ điều khiển PID', labelEn: 'PID controller',
    polymorphic: false, allowedTypes: [], defaultType: 'REAL', typedPortNames: [],
    warning: {
      vi: 'Chưa Controls+Safety review — không dùng cho logic sản xuất (xem ST_SUBSET_SPEC §6.2)',
      en: 'Not yet Controls+Safety reviewed — do not use for production logic (see ST_SUBSET_SPEC §6.2)',
    },
    buildPorts: fixedPorts([
      p('SP', 'INPUT', 'REAL'), p('PV', 'INPUT', 'REAL'), p('KP', 'INPUT', 'REAL'),
      p('KI', 'INPUT', 'REAL'), p('KD', 'INPUT', 'REAL'), p('OUT_MIN', 'INPUT', 'REAL'),
      p('OUT_MAX', 'INPUT', 'REAL'), p('ACTUAL', 'INPUT', 'REAL'),
      p('OUT', 'OUTPUT', 'REAL'), p('TRACKING', 'OUTPUT', 'BOOL'),
    ]),
  },
]

export const FBD_PALETTE_CATEGORY_ORDER: readonly { id: FbdPaletteCategory; labelVi: string; labelEn: string }[] = [
  { id: 'interface', labelVi: 'Giao diện', labelEn: 'Interface' },
  { id: 'constants', labelVi: 'Hằng số', labelEn: 'Constants' },
  { id: 'logic', labelVi: 'Logic', labelEn: 'Logic' },
  { id: 'compare', labelVi: 'So sánh', labelEn: 'Compare' },
  { id: 'math', labelVi: 'Toán học', labelEn: 'Math' },
  { id: 'conversion', labelVi: 'Chuyển đổi kiểu', labelEn: 'Conversion' },
  { id: 'timer', labelVi: 'Timer', labelEn: 'Timer' },
  { id: 'trigger', labelVi: 'Trigger', labelEn: 'Trigger' },
  { id: 'control', labelVi: 'Điều khiển', labelEn: 'Control' },
]

export function fbdPaletteEntry(typeRef: string): FbdPaletteEntry | undefined {
  return FBD_PALETTE.find((entry) => entry.id === typeRef)
}

export function defaultConstantLiteral(type: FbdDataType): FbdParameterValue {
  switch (type) {
    case 'BOOL': return false
    case 'INT': case 'DINT': case 'UINT': return 0
    case 'REAL': return 0
    case 'TIME': return 'T#0s'
  }
}

/* ST_SUBSET_SPEC_MK-DDC-24_VI.md §3.1 (integer_min/max của st_program.cpp)
 * + §3.2 time_literal = "T#" time_part {time_part}. Kiểm tra này chỉ là gợi
 * ý UX — Check (server) vẫn là authority cuối cho cú pháp/khoảng giá trị. */
const TIME_LITERAL = /^T#(?:\d+(?:ms|d|h|m|s))+$/i

export function isValidConstantLiteral(type: FbdDataType, value: FbdParameterValue): boolean {
  switch (type) {
    case 'BOOL': return typeof value === 'boolean'
    case 'INT': return typeof value === 'number' && Number.isInteger(value) && value >= -32768 && value <= 32767
    case 'DINT': return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    case 'UINT': return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535
    case 'REAL': return typeof value === 'number' && Number.isFinite(value)
    case 'TIME': return typeof value === 'string' && TIME_LITERAL.test(value)
  }
}
