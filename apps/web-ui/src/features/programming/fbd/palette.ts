import {
  PROGRAMMING_LIBRARY_CATEGORY_ORDER,
  PROGRAMMING_LIBRARY_ENTRIES,
  type LibraryCategory,
  type LibraryEntry,
} from '../api/generated/library_registry'
import { type FbdDataType, type FbdNodeKind, type FbdParameterValue } from './model'

/* Palette sinh từ `contracts/programming/pou_library_registry_v1.json` — nguồn
 * duy nhất dùng chung với allowlist FBD của Core. Trước đây danh sách này được
 * chép tay song song với `st_fbd_model.cpp` và đã trôi khỏi compiler thật:
 * Core cho phép SCALE/DEADBAND/CTU/PI vốn không tồn tại, đồng thời từ chối
 * SQRT cùng bốn conversion mà palette vẫn chào người dùng. */

export type FbdPaletteCategory = LibraryCategory

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

function toPaletteEntry(entry: LibraryEntry): FbdPaletteEntry {
  const typedPortNames = entry.typedPortNames
  return {
    id: entry.id,
    kind: entry.kind,
    typeRef: entry.id,
    category: entry.category,
    labelVi: entry.labelVi,
    labelEn: entry.labelEn,
    polymorphic: entry.polymorphic,
    allowedTypes: entry.allowedTypes,
    defaultType: entry.defaultType,
    typedPortNames,
    ...(entry.warning ? { warning: entry.warning } : {}),
    // Port trong registry ghi kiểu ở `defaultType`; port nằm trong
    // `typedPortNames` đi theo T do người dùng chọn, port còn lại giữ kiểu cố định.
    buildPorts: (operandType: FbdDataType) =>
      entry.ports.map((port) => ({
        name: port.name,
        direction: port.direction,
        dataType: typedPortNames.includes(port.name) ? operandType : port.dataType,
      })),
  }
}

export const FBD_PALETTE: readonly FbdPaletteEntry[] =
  PROGRAMMING_LIBRARY_ENTRIES.map(toPaletteEntry)

export const FBD_PALETTE_CATEGORY_ORDER: readonly {
  id: FbdPaletteCategory
  labelVi: string
  labelEn: string
}[] = PROGRAMMING_LIBRARY_CATEGORY_ORDER

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
