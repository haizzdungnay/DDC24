import type {
  ProgrammingDraftDocument,
  ProgrammingDraftLibraryLock,
  ProgrammingDraftProgramConfigV2,
  ProgrammingPublishedSignal,
  ProgrammingSignalDraftInput,
  ProgrammingSignalStalePolicy,
  ProgrammingSignalStalePolicyWire,
  ProgrammingSignalType
} from './types'

/**
 * T59-203 — logic thuần của Published Signal authoring (PGM-03, DDD §4.5/§7.3).
 *
 * Toàn bộ ràng buộc ở file này là BẢN SAO CÓ CHỦ Ý của validator backend
 * (`apps/web-api/internal/programming/application/draft_v2.go`:
 * `upsertSignalDefinition` + `validateDraftDocumentV2`). Chép chứ không đoán:
 * mỗi hằng số dưới đây đối chiếu được với đúng một dòng bên Go. Mục đích là báo
 * lỗi TẠI CHỖ GÕ thay vì để người dùng bấm Lưu rồi nhận 400 không nói field nào
 * sai — nó KHÔNG thay thế validator server, và không được nới lỏng hơn server.
 */

/** `freshness_ms BETWEEN 10 AND 150000` — cùng dải mà schema store ép sau
 *  migration `0016` (ADR-061 mục 4.5): một base step 10 ms tới 3 × 50 s. */
export const SIGNAL_FRESHNESS_MIN_MS = 10
export const SIGNAL_FRESHNESS_MAX_MS = 150_000
/** Hạn tươi gợi ý cho signal mới: 1 s, KHÔNG phải cận dưới 10 ms — 10 ms chỉ
 *  đúng khi publisher chạy 10 ms, và Check từ chối freshness < chu kỳ publisher. */
export const SIGNAL_FRESHNESS_DEFAULT_MS = 1000
export const SIGNAL_NAME_MAX_LENGTH = 64
export const SIGNAL_UNIT_MAX_LENGTH = 32

const SIGNAL_FALLBACK_RANGES: Partial<Record<ProgrammingSignalType, readonly [number, number]>> = {
  INT: [-32_768, 32_767],
  DINT: [-2_147_483_648, 2_147_483_647],
  UINT: [0, 65_535],
  REAL: [-3.4028234663852886e38, 3.4028234663852886e38],
  // Backend giới hạn TIME theo `math.MaxInt64 / 1_000_000` mili giây. Giá trị
  // trên dây phải là số nguyên, nên cận nguyên lớn nhất là floor của thương.
  TIME: [0, 9_223_372_036_854]
}

export const SIGNAL_TYPES: readonly ProgrammingSignalType[] = ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME']

/**
 * Bản đồ 1-1 giữa tên DDD §7.3 và enum runtime, khoá ở
 * `PLAN59-CONTRACT-LOCK-2026-08-24` §2.3.
 *
 * Giao diện KHÔNG được hiển thị `HOLD_LAST`/`WAIT`: hai chữ đó nói về cơ chế
 * bên trong scheduler, còn người vận hành cần biết hệ quả — "giữ riêng giá trị
 * cũ" hay "chặn cả Program". Ngược lại đường ghi KHÔNG được gửi tên DDD: backend
 * chỉ nhận enum runtime.
 */
export const SIGNAL_STALE_POLICY_TO_WIRE: Record<ProgrammingSignalStalePolicy, ProgrammingSignalStalePolicyWire> = {
  USE_FALLBACK: 'USE_FALLBACK',
  HOLD_PRIVATE: 'HOLD_LAST',
  BLOCK_PROGRAM: 'WAIT'
}

export const SIGNAL_STALE_POLICIES: readonly ProgrammingSignalStalePolicy[] = ['USE_FALLBACK', 'HOLD_PRIVATE', 'BLOCK_PROGRAM']

export function isSignalStalePolicy(value: string): value is ProgrammingSignalStalePolicy {
  return (SIGNAL_STALE_POLICIES as readonly string[]).includes(value)
}

/**
 * `FAIL_CLOSED` backend còn nhận nhưng DDD §7.3 không đặt tên — trả `null` để
 * lớp hiển thị nói thẳng "chính sách ngoài DDD" thay vì im lặng gán bừa một
 * trong ba tên đã biết.
 */
export function stalePolicyFromWire(value: ProgrammingSignalStalePolicyWire | string): ProgrammingSignalStalePolicy | null {
  switch (value) {
    case 'USE_FALLBACK':
      return 'USE_FALLBACK'
    case 'HOLD_LAST':
      return 'HOLD_PRIVATE'
    case 'WAIT':
      return 'BLOCK_PROGRAM'
    default:
      return null
  }
}

/** Từ khoá bị cấm làm tên POU/Signal — chép từ `reservedPouNames` bên Go. */
export const RESERVED_PROGRAMMING_NAMES = new Set([
  'PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK', 'VAR', 'END_VAR',
  'IF', 'THEN', 'ELSE', 'END_IF', 'TRUE', 'FALSE',
  'AND', 'OR', 'XOR', 'NOT', 'MOD'
])

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

/** Port của `validPouName` bên Go: identifier ASCII 1..64, không phải từ khoá. */
export function isValidProgrammingIdentifier(name: string): boolean {
  if (name.length < 1 || name.length > SIGNAL_NAME_MAX_LENGTH) return false
  if (RESERVED_PROGRAMMING_NAMES.has(name.toUpperCase())) return false
  return IDENTIFIER_PATTERN.test(name)
}

function rawDocument(draft: ProgrammingDraftDocument): Record<string, unknown> {
  return draft as unknown as Record<string, unknown>
}

function collection(draft: ProgrammingDraftDocument, field: string): Record<string, unknown>[] {
  const value = rawDocument(draft)[field]
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

/** Document v1 (không có `objects`) không có khái niệm Published Signal. */
export function isDraftV2(draft: ProgrammingDraftDocument): boolean {
  return draft.schemaVersion === 2 && Array.isArray(rawDocument(draft).objects)
}

export interface DraftPouObject {
  objectId: string
  kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  name: string
  language: 'ST' | 'FBD'
  source: string
  dependencies: string[]
}

export function draftObjects(draft: ProgrammingDraftDocument): DraftPouObject[] {
  return collection(draft, 'objects').map((object) => ({
    objectId: String(object.objectId ?? ''),
    kind: (object.kind as DraftPouObject['kind']) ?? 'PROGRAM',
    name: String(object.name ?? ''),
    language: (object.language as DraftPouObject['language']) ?? 'ST',
    source: typeof object.source === 'string' ? object.source : '',
    dependencies: Array.isArray(object.dependencies) ? (object.dependencies as unknown[]).map(String) : []
  }))
}

export function draftProgramConfigs(draft: ProgrammingDraftDocument): ProgrammingDraftProgramConfigV2[] {
  return collection(draft, 'programs')
    .filter((program) => typeof program.objectId === 'string')
    .map((program) => ({
      programId: String(program.programId ?? ''),
      objectId: String(program.objectId ?? ''),
      periodMs: Number(program.periodMs ?? 0),
      ...(typeof program.taskId === 'string' ? { taskId: program.taskId } : {})
    }))
}

export interface DraftProducerOption {
  programId: string
  objectId: string
  name: string
  periodMs: number
}

/** Chỉ POU kind `PROGRAM` CÓ cấu hình chạy mới publish được: `SIG_PUB` nằm
 *  trong đường quét của một Program, FUNCTION/FB không có điểm vào riêng. */
export function draftProducerOptions(draft: ProgrammingDraftDocument): DraftProducerOption[] {
  const objectById = new Map(draftObjects(draft).map((object) => [object.objectId, object]))
  return draftProgramConfigs(draft)
    .map((config) => {
      const object = objectById.get(config.objectId)
      if (!object || object.kind !== 'PROGRAM') return null
      return { programId: config.programId, objectId: config.objectId, name: object.name, periodMs: config.periodMs }
    })
    .filter((item): item is DraftProducerOption => item !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function draftSignals(draft: ProgrammingDraftDocument): ProgrammingPublishedSignal[] {
  return collection(draft, 'signals')
    .map((signal) => {
      const item: ProgrammingPublishedSignal = {
        signalId: String(signal.signalId ?? ''),
        name: String(signal.name ?? ''),
        type: (signal.type as ProgrammingSignalType) ?? 'REAL',
        publisherProgramId: String(signal.publisherProgramId ?? ''),
        freshnessMs: Number(signal.freshnessMs ?? 0),
        stalePolicy: (signal.stalePolicy as ProgrammingSignalStalePolicyWire) ?? 'HOLD_LAST'
      }
      if (typeof signal.unit === 'string' && signal.unit !== '') item.unit = signal.unit
      if (typeof signal.fallbackValue === 'number') item.fallbackValue = signal.fallbackValue
      return item
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function draftLibraryLock(draft: ProgrammingDraftDocument): ProgrammingDraftLibraryLock | null {
  const library = rawDocument(draft).library
  if (!library || typeof library !== 'object') return null
  const value = library as Record<string, unknown>
  // Document v1 dùng `{profile, version}`; nó không mang khoá version PROJECT
  // nào nên trả `null` thay vì dựng một khoá rỗng trông như đã đọc được.
  if (typeof value.systemVersion !== 'string') return null
  return {
    systemProfile: String(value.systemProfile ?? ''),
    systemVersion: value.systemVersion,
    projectLibraryRevisionId: typeof value.projectLibraryRevisionId === 'string' ? value.projectLibraryRevisionId : null
  }
}

/**
 * Bỏ chú thích ST trước khi dò tham chiếu tên. Không bỏ thì một dòng
 * `(* TODO: dùng SupplyTemp *)` sẽ bị đếm là consumer thật.
 */
export function stripStComments(source: string): string {
  return source.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

export interface SignalConsumerReference {
  objectId: string
  name: string
  kind: DraftPouObject['kind']
}

/**
 * POU nào **nhắc tới tên signal** trong mã nguồn Draft.
 *
 * ĐÂY KHÔNG PHẢI danh sách consumer authoritative và giao diện phải nói rõ điều
 * đó. Bảng `signal_refs` của IR (contract lock §2.2) chỉ tồn tại sau khi Kiểm
 * tra biên dịch xong, và không có endpoint nào trả nó cho Draft. Thứ hàm này
 * báo cáo đúng bằng những gì nó đo được: đối sánh identifier nguyên từ trên mã
 * nguồn đã bỏ chú thích. Bịa ra một danh sách "consumer" từ chỗ khác, hoặc để
 * trống rồi ngụ ý "không ai dùng", đều là nói sai.
 */
export function signalConsumerReferences(
  draft: ProgrammingDraftDocument,
  signalName: string,
  producerObjectId: string
): SignalConsumerReference[] {
  if (!isValidProgrammingIdentifier(signalName)) return []
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${signalName}([^A-Za-z0-9_]|$)`)
  return draftObjects(draft)
    .filter((object) => object.objectId !== producerObjectId && pattern.test(stripStComments(object.source)))
    .map((object) => ({ objectId: object.objectId, name: object.name, kind: object.kind }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export type SignalFieldName = 'name' | 'type' | 'unit' | 'publisher' | 'freshness' | 'policy' | 'fallback'

export type SignalErrorCode =
  | 'NAME_REQUIRED'
  | 'NAME_INVALID'
  | 'NAME_RESERVED'
  | 'NAME_DUPLICATE'
  | 'TYPE_INVALID'
  | 'UNIT_TOO_LONG'
  | 'PUBLISHER_REQUIRED'
  | 'PUBLISHER_UNKNOWN'
  | 'FRESHNESS_RANGE'
  | 'FRESHNESS_BELOW_PUBLISHER_PERIOD'
  | 'POLICY_INVALID'
  | 'FALLBACK_REQUIRED'
  | 'FALLBACK_INVALID'
  | 'FALLBACK_RANGE'

/** Form nhập: `fallbackValue` là CHUỖI vì ô nhập trống khác 0. */
export interface SignalFormValue {
  signalId: string
  name: string
  type: ProgrammingSignalType
  unit: string
  publisherProgramId: string
  freshnessMs: string
  /** Chuỗi rỗng biểu thị policy cũ ngoài DDD cần người dùng chọn thay thế rõ ràng. */
  stalePolicy: ProgrammingSignalStalePolicy | ''
  unsupportedStalePolicy?: string
  fallbackValue: string
}

export interface SignalValidationContext {
  /** Toàn bộ signal đang có trong Draft — dùng để bắt trùng tên case-folded. */
  signals: ProgrammingPublishedSignal[]
  /** `programId` hợp lệ (Program có cấu hình chạy và trỏ tới POU kind PROGRAM). */
  producerProgramIds: string[]
  /**
   * Chu kỳ (ms) của từng publisher. Có thì kiểm luật ADR-061 mục 4.5 "freshness
   * ≥ chu kỳ publisher" ngay tại ô nhập — cùng luật Check áp (`ST-SIG-003`), để
   * người dùng không lưu một signal chắc chắn trượt Check.
   */
  producerPeriodsMs?: Readonly<Record<string, number>>
}

const INTEGER_TYPES = new Set<ProgrammingSignalType>(['INT', 'DINT', 'UINT', 'TIME'])

/**
 * Chuyển ô nhập fallback sang số theo đúng kiểu signal.
 *
 * `BOOL` nhận `TRUE`/`FALSE`/`1`/`0` và gửi đi 0/1 vì backend khai `*float64`.
 * `TIME` là mili giây nguyên không âm. Trả `null` khi không phân giải được —
 * KHÔNG rơi về 0, vì 0 là một giá trị dự phòng hợp lệ và trộn nó với "không đọc
 * được" chính là lối "im lặng thay bằng 0" mà DDD §10 cấm.
 */
export function parseSignalFallback(type: ProgrammingSignalType, raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  if (type === 'BOOL') {
    const upper = text.toUpperCase()
    if (upper === 'TRUE' || upper === '1') return 1
    if (upper === 'FALSE' || upper === '0') return 0
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  if (INTEGER_TYPES.has(type) && !Number.isInteger(value)) return null
  return value
}

function isSignalFallbackInRange(type: ProgrammingSignalType, value: number): boolean {
  if (type === 'BOOL') return value === 0 || value === 1
  const range = SIGNAL_FALLBACK_RANGES[type]
  return !range || (value >= range[0] && value <= range[1])
}

export function formatSignalFallback(type: ProgrammingSignalType, value: number | undefined): string {
  if (value === undefined) return ''
  if (type === 'BOOL') return value === 0 ? 'FALSE' : 'TRUE'
  return String(value)
}

export function validateSignalForm(
  value: SignalFormValue,
  context: SignalValidationContext
): Partial<Record<SignalFieldName, SignalErrorCode>> {
  const errors: Partial<Record<SignalFieldName, SignalErrorCode>> = {}
  const name = value.name.trim()
  if (name === '') {
    errors.name = 'NAME_REQUIRED'
  } else if (RESERVED_PROGRAMMING_NAMES.has(name.toUpperCase())) {
    errors.name = 'NAME_RESERVED'
  } else if (!isValidProgrammingIdentifier(name)) {
    errors.name = 'NAME_INVALID'
  } else if (
    context.signals.some((signal) => signal.signalId !== value.signalId && signal.name.toUpperCase() === name.toUpperCase())
  ) {
    // Unique CASE-FOLDED, đúng như `validateDraftDocumentV2`: `Temp` và `TEMP`
    // là hai signal khác nhau ở FE nhưng cùng một ở compiler.
    errors.name = 'NAME_DUPLICATE'
  }

  if (!SIGNAL_TYPES.includes(value.type)) errors.type = 'TYPE_INVALID'
  if (value.unit.length > SIGNAL_UNIT_MAX_LENGTH) errors.unit = 'UNIT_TOO_LONG'

  if (value.publisherProgramId === '') {
    errors.publisher = 'PUBLISHER_REQUIRED'
  } else if (!context.producerProgramIds.includes(value.publisherProgramId)) {
    errors.publisher = 'PUBLISHER_UNKNOWN'
  }

  const freshness = Number(value.freshnessMs)
  if (
    value.freshnessMs.trim() === '' ||
    !Number.isFinite(freshness) ||
    !Number.isInteger(freshness) ||
    freshness < SIGNAL_FRESHNESS_MIN_MS ||
    freshness > SIGNAL_FRESHNESS_MAX_MS
  ) {
    errors.freshness = 'FRESHNESS_RANGE'
  } else {
    const publisherPeriod = context.producerPeriodsMs?.[value.publisherProgramId]
    if (typeof publisherPeriod === 'number' && publisherPeriod > 0 && freshness < publisherPeriod) {
      errors.freshness = 'FRESHNESS_BELOW_PUBLISHER_PERIOD'
    }
  }

  if (!isSignalStalePolicy(value.stalePolicy)) errors.policy = 'POLICY_INVALID'

  if (value.stalePolicy === 'USE_FALLBACK') {
    if (value.fallbackValue.trim() === '') {
      errors.fallback = 'FALLBACK_REQUIRED'
    } else {
      const parsed = parseSignalFallback(value.type, value.fallbackValue)
      if (parsed === null) errors.fallback = 'FALLBACK_INVALID'
      else if (!isSignalFallbackInRange(value.type, parsed)) errors.fallback = 'FALLBACK_RANGE'
    }
  }

  return errors
}

/**
 * Dựng payload `upsertSignal`. Trả `null` khi form còn lỗi — không có đường
 * nào gửi một signal chưa hợp lệ ra dây.
 */
export function toSignalDraftInput(value: SignalFormValue, context: SignalValidationContext): ProgrammingSignalDraftInput | null {
  if (Object.keys(validateSignalForm(value, context)).length > 0) return null
  if (!isSignalStalePolicy(value.stalePolicy)) return null
  const wirePolicy = SIGNAL_STALE_POLICY_TO_WIRE[value.stalePolicy]
  const input: ProgrammingSignalDraftInput = {
    signalId: value.signalId,
    name: value.name.trim(),
    type: value.type,
    publisherProgramId: value.publisherProgramId,
    freshnessMs: Number(value.freshnessMs),
    stalePolicy: wirePolicy
  }
  const unit = value.unit.trim()
  if (unit !== '') input.unit = unit
  // Ba chính sách còn lại KHÔNG được mang `fallbackValue`: backend từ chối cặp
  // lệch theo cả hai chiều.
  if (wirePolicy === 'USE_FALLBACK') {
    const parsed = parseSignalFallback(value.type, value.fallbackValue)
    if (parsed === null) return null
    input.fallbackValue = parsed
  }
  return input
}

export function emptySignalForm(signalId: string, defaultProducerProgramId: string): SignalFormValue {
  return {
    signalId,
    name: '',
    type: 'REAL',
    unit: '',
    publisherProgramId: defaultProducerProgramId,
    freshnessMs: String(SIGNAL_FRESHNESS_DEFAULT_MS),
    stalePolicy: 'HOLD_PRIVATE',
    fallbackValue: ''
  }
}

export function signalFormFrom(signal: ProgrammingPublishedSignal): SignalFormValue {
  const policy = stalePolicyFromWire(signal.stalePolicy)
  return {
    signalId: signal.signalId,
    name: signal.name,
    type: signal.type,
    unit: signal.unit ?? '',
    publisherProgramId: signal.publisherProgramId,
    freshnessMs: String(signal.freshnessMs),
    // Không được đổi ngầm `FAIL_CLOSED` thành một policy khác khi người dùng chỉ
    // sửa tên/đơn vị. Chuỗi rỗng buộc họ chọn một phép chuyển đổi rõ ràng.
    stalePolicy: policy ?? '',
    ...(!policy ? { unsupportedStalePolicy: signal.stalePolicy } : {}),
    fallbackValue: formatSignalFallback(signal.type, signal.fallbackValue)
  }
}
