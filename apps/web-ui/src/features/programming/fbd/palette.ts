import {
  PROGRAMMING_LIBRARY_CATEGORY_ORDER,
  PROGRAMMING_LIBRARY_ENTRIES,
  type LibraryCategory,
  type LibraryEntry,
  type LibraryFeatureState,
} from '../api/generated/library_registry'
import { effectiveFeatureState, type ReviewGateRow } from '../model/reviewGate'
import { PROGRAMMING_REVIEW_GATED_FEATURES } from '../api/generated/profile'
import { type FbdDataType, type FbdNodeKind, type FbdParameterValue } from './model'

/* Palette sinh từ `contracts/programming/pou_library_registry_v1.json` — nguồn
 * duy nhất dùng chung với allowlist FBD của Core. Trước đây danh sách này được
 * chép tay song song với `st_fbd_model.cpp` và đã trôi khỏi compiler thật:
 * Core cho phép SCALE/DEADBAND/CTU/PI vốn không tồn tại, đồng thời từ chối
 * SQRT cùng bốn conversion mà palette vẫn chào người dùng. */

export type FbdPaletteCategory = LibraryCategory | 'signals'

export interface FbdPalettePortTemplate {
  name: string
  direction: 'INPUT' | 'OUTPUT'
  dataType: FbdDataType
  unit?: string | null
}

export interface FbdPaletteEntry {
  id: string
  kind: Extract<FbdNodeKind, 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION' | 'SIGNAL_READ' | 'SIGNAL_PUBLISH'>
  typeRef: string
  category: FbdPaletteCategory
  labelVi: string
  labelEn: string
  /** Có toán hạng kiểu T chọn được lúc tạo/sửa hay không. */
  polymorphic: boolean
  allowedTypes: readonly FbdDataType[]
  defaultType: FbdDataType
  /** Tham số canonical gắn lúc tạo node. Registry tĩnh không cần trường này;
   * Published Signal dùng `{ signal: <tên> }` và không cho editor đoán lại. */
  parameters?: Readonly<Record<string, FbdParameterValue>>
  /** Tên các port đổi theo T khi `SET_NODE_TYPE`; port không có trong danh
   *  sách này giữ nguyên kiểu cố định (vd `OUT:BOOL` của phép so sánh). */
  typedPortNames: readonly string[]
  /** Trạng thái duyệt của khối (AVAILABLE | REVIEW_REQUIRED). */
  featureState: LibraryFeatureState
  /** `ISS-STED-17` — khối thuộc IEC 61131-3 hay là mở rộng của Mekong. */
  iecClassification: LibraryEntry['iecClassification'] | null
  warning?: { vi: string; en: string }
  buildPorts: (operandType: FbdDataType) => FbdPalettePortTemplate[]
}

/** Dựng một mục palette từ entry registry. `reviewTable` mặc định là bảng
 *  review gate sinh từ product profile; test cơ chế truyền bảng giả. */
export function fbdPaletteEntryFromRegistry(
  entry: LibraryEntry,
  reviewTable: readonly ReviewGateRow[] = PROGRAMMING_REVIEW_GATED_FEATURES,
): FbdPaletteEntry {
  const typedPortNames = entry.typedPortNames
  /* Issue #802: trạng thái HIỆU LỰC — registry giữ nhãn `REVIEW_REQUIRED` vĩnh
     viễn, còn việc duyệt là token trong product profile. Cảnh báo registry của
     khối chờ review nói "chưa review, không dùng cho sản xuất"; khi profile đã
     ký token thì câu đó sai, nên bỏ nó đi cùng với nhãn. */
  const featureState = effectiveFeatureState(entry.id, entry.featureState, reviewTable)
  const reviewLifted = entry.featureState === 'REVIEW_REQUIRED' && featureState === 'AVAILABLE'
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
    featureState,
    iecClassification: entry.iecClassification,
    ...(entry.warning && !reviewLifted ? { warning: entry.warning } : {}),
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
  PROGRAMMING_LIBRARY_ENTRIES.map((entry) => fbdPaletteEntryFromRegistry(entry))

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

/**
 * `T59-804` (`PGM02-V22-WP-03`) — lọc palette theo cổng ĐANG CHỌN.
 *
 * Plan đòi "compatible filters theo ... selected port": khi người dùng đang
 * đứng ở một cổng `REAL`, danh sách 40+ block khiến họ phải tự đối chiếu kiểu
 * trong đầu, và nối nhầm kiểu chỉ lộ ra ở Check.
 *
 * Hai điều KHÔNG làm ở đây: không tự nối (ambiguity phải do người dùng giải),
 * và không xoá vĩnh viễn mục không khớp khỏi palette — bộ lọc là một lựa chọn
 * bật/tắt, vì "không khớp cổng này" khác hẳn "không tồn tại".
 */
export function paletteEntryAcceptsType(entry: FbdPaletteEntry, dataType: FbdDataType): boolean {
  if (entry.allowedTypes.includes(dataType)) return true
  /* Block không đa hình vẫn có thể khớp qua một cổng kiểu cố định (vd `OUT:BOOL`
   * của phép so sánh), nên phải hỏi CHÍNH bộ cổng nó dựng ra ở kiểu mặc định. */
  return entry.buildPorts(entry.defaultType).some((port) => port.dataType === dataType)
}

export function paletteEntriesCompatibleWith(
  entries: readonly FbdPaletteEntry[],
  dataType: FbdDataType | null
): readonly FbdPaletteEntry[] {
  if (dataType === null) return entries
  return entries.filter((entry) => paletteEntryAcceptsType(entry, dataType))
}
