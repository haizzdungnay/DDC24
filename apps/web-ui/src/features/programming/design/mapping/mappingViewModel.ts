import { collectFbdInterfaceVariables, type FbdDocument } from '../../fbd/model'
import { codeReason, serverReasons, type MappingReason } from './mappingReasons'
import { collectStInterfaceVariables } from '../editor/stInterfaceVariables'
import type {
  ProgrammingDraftDocument,
  ProgrammingPointCatalogEntry,
  ProgrammingPointIdentity,
  ProgrammingProgram,
  ProgrammingVariable,
} from '../../model/types'

export type BindingStatus = 'MAPPED' | 'UNMAPPED' | 'POINT_UNAVAILABLE' | 'INCOMPATIBLE'
export type MapEligibility =
  | 'SUPPORTED'
  | 'UNSUPPORTED_BY_CORE'
  | 'UNSUPPORTED_DIRECTION'
  | 'UNSUPPORTED_IDENTITY'
  | 'INCOMPATIBLE'
  | 'QUALITY_BLOCKED'
  | 'CATALOG_STALE'
  | 'PAGING_INCOMPLETE'
  | 'SERVER_DECISION_MISSING'
export type LiveQuality = ProgrammingPointCatalogEntry['quality']
export type CatalogTruthState = {
  status: 'loading' | 'ready' | 'error'
  lastSuccessAt?: number | null
  complete?: boolean
}

export interface MappingCompatibility {
  assignable: boolean
  unitWarning: boolean
  /**
   * `ISS-PGUI-02` — MÃ lý do, không phải câu chữ.
   *
   * Tầng này thuần và không có `pick`, nên mọi câu nó tự dựng sẽ mãi mãi là
   * tiếng Việt và sẽ hiện ra giữa giao diện English. Dịch ở lớp vẽ bằng
   * `mappingReasonText`.
   */
  reasons: MappingReason[]
}

export interface MappingVariableRow {
  id: string
  programId: string
  programName: string
  name: string
  type: string
  direction: 'INPUT' | 'OUTPUT' | 'INOUT'
  bindingId?: string
  point?: ProgrammingPointIdentity
  pointName?: string
  liveValue: unknown
  liveQuality: LiveQuality
  freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE'
  observedAt?: string
  bindingStatus: BindingStatus
  eligibility: MapEligibility
  compatibility: MappingCompatibility
}

export interface MappingPointRow {
  key: string
  category: ProgrammingPointCatalogEntry['category']
  pointId: string
  deviceId?: string
  name: string
  dataType: string
  direction: ProgrammingPointCatalogEntry['direction']
  unit?: string
  writable: boolean
  value: unknown
  quality: LiveQuality
  observedAt?: string
  eligibility: MapEligibility
  compatible: boolean
  compatibilityReasons: MappingReason[]
  suggestionScore?: number
  /** `ISS-PIO-07` — thiết bị công nghệ (`ADR-042`). Rỗng = CHƯA GÁN. */
  equipment?: string
  /** Mô tả tự do; rỗng ở điểm Modbus vì hợp đồng không có trường đó. */
  description?: string
  /** Định danh nguồn có tiền tố (`iop:`/`core:`/`modbus:`); rỗng = chưa có nguồn. */
  sourceRef?: string
  /** `ISS-PIO-09` — ba trường định danh theo nguồn do máy chủ dựng. Rỗng luôn
   *  nghĩa là "chưa dựng được", không phải "trống". */
  displayId?: string
  deviceLabel?: string
  sourceDetail?: string
}

/** Nhãn dùng cho bộ lọc thiết bị khi điểm CHƯA được gán thiết bị nào.
 *
 *  Là một giá trị riêng chứ không phải chuỗi rỗng: "chưa gán" là một nhóm có
 *  thật mà người dùng cần lọc tới, khác hẳn "không lọc". */
export const UNASSIGNED_EQUIPMENT = '__unassigned__' 

interface DeclaredVariable {
  name: string
  type: string
  direction: 'INPUT' | 'OUTPUT' | 'INOUT'
  programId: string
  programName: string
}

function pointKey(point: ProgrammingPointIdentity | ProgrammingPointCatalogEntry): string {
  return `${point.category}:${point.deviceId ?? ''}:${point.pointId}`
}

function declaredVariables(program: ProgrammingProgram): DeclaredVariable[] {
  // Chỉ các POU kiểu PROGRAM mới có biến giao diện để mapping ra Point ngoài.
  // Function Block và Function là các hàm/khối thuật toán cục bộ, không bao giờ xuất hiện ở Mapping.
  if (program.kind && program.kind !== 'PROGRAM') return []
  if (program.language === 'ST') {
    return collectStInterfaceVariables(typeof program.document === 'string' ? program.document : '').map((variable) => ({
      ...variable,
      programId: program.programId,
      programName: program.name,
    }))
  }
  if (typeof program.document !== 'string' || !program.document) return []
  try {
    return collectFbdInterfaceVariables(JSON.parse(program.document) as FbdDocument).map((variable) => ({
      ...variable,
      programId: program.programId,
      programName: program.name,
    }))
  } catch {
    return []
  }
}

function draftVariables(document: ProgrammingDraftDocument): Array<DeclaredVariable & { variableId: string; class: ProgrammingVariable['class'] }> {
  const byName = new Map<string, DeclaredVariable & { variableId: string; class: ProgrammingVariable['class'] }>()
  for (const program of document.programs) {
    if (program.kind && program.kind !== 'PROGRAM') continue
    for (const variable of declaredVariables(program)) {
      byName.set(`${variable.programId}:${variable.name}`, { ...variable, variableId: `${variable.programId}:${variable.name}`, class: variable.direction })
    }
  }
  for (const variable of document.variables) {
    const program = document.programs.find((candidate) => candidate.programId === variable.programId)
    if (program && program.kind && program.kind !== 'PROGRAM') continue
    // Với chương trình FBD, biến chỉ hợp lệ khi tồn tại trong sơ đồ FBD (INPUT hoặc OUTPUT block)
    if (program && program.language === 'FBD') {
      const existing = byName.get(`${variable.programId}:${variable.name}`)
      if (existing) {
        existing.variableId = variable.variableId
      }
      continue
    }
    const direction = variable.class === 'OUTPUT' ? 'OUTPUT' : variable.class === 'INOUT' ? 'INOUT' : 'INPUT'
    byName.set(`${variable.programId}:${variable.name}`, {
      variableId: variable.variableId,
      programId: variable.programId,
      programName: program?.name ?? '—',
      name: variable.name,
      type: variable.type,
      direction,
      class: variable.class,
    })
  }
  return [...byName.values()]
}

function isOutput(direction: string): boolean {
  return direction === 'OUTPUT' || direction === 'INOUT'
}

/* ISS-PIO-32 — eligibility do SERVER quyết định; hàm này chỉ CHỌN CHIỀU rồi
 * chuyển nguyên văn kết quả.
 *
 * Bản cũ ở đây tự giữ allowlist prefix, bảng `PREFIX_TYPE` và hai câu chặn cứng
 * theo category. Cả hai câu ấy đã sai vào lúc bị xoá: Core resolve `MB_RTU` từ
 * trước baseline (`st_io_map.cpp`), và `F-PROG-ASBUILT-016` đã gỡ chặn chiều
 * ghi của VP. Người dùng đọc "Core chưa hỗ trợ" cho hai năng lực đang chạy được
 * và đi sửa nhầm chỗ.
 *
 * Vắng `entry.mapping` (server đời cũ) thì FAIL-CLOSED. Suy lại ở đây là dựng
 * lại đúng bản luật thứ hai vừa gỡ — và một bản dự phòng "tạm thời" sẽ sống lâu
 * đúng bằng tuổi thọ của hệ thống. */
function supportEligibility(direction: string, entry: ProgrammingPointCatalogEntry): { eligibility: MapEligibility; reasons: MappingReason[] } {
  if (direction === 'INOUT') {
    return { eligibility: 'UNSUPPORTED_DIRECTION', reasons: [codeReason('UNSUPPORTED_INOUT')] }
  }

  const decision = entry.mapping ? (isOutput(direction) ? entry.mapping.output : entry.mapping.input) : undefined
  if (!decision) {
    return {
      eligibility: 'SERVER_DECISION_MISSING',
      reasons: [codeReason('SERVER_DECISION_MISSING')],
    }
  }
  if (decision.status === 'SUPPORTED') return { eligibility: 'SUPPORTED', reasons: [] }
  /* `ISS-PIO-32` — nguyên nhân lấy NGUYÊN VĂN từ máy chủ; FE không mã hoá lại
     một câu nó không kiểm soát. */
  return { eligibility: decision.status, reasons: serverReasons(decision.reasons) }
}

function compatibilityFor(
  direction: string,
  type: string,
  unit: string | undefined,
  entry: ProgrammingPointCatalogEntry,
  truth: CatalogTruthState,
): MappingCompatibility & { eligibility: MapEligibility } {
  if (truth.status !== 'ready' || truth.complete === false) {
    return { assignable: false, unitWarning: false, reasons: [codeReason('CATALOG_UNVERIFIED')], eligibility: truth.status === 'error' ? 'CATALOG_STALE' : 'PAGING_INCOMPLETE' }
  }
  const support = supportEligibility(direction, entry)
  if (support.eligibility !== 'SUPPORTED') return { assignable: false, unitWarning: false, reasons: support.reasons, eligibility: support.eligibility }

  const reasons: MappingReason[] = []
  if (entry.dataType !== type) reasons.push(codeReason('TYPE_MISMATCH'))
  if (isOutput(direction) && (!entry.writable || !['WRITE', 'READ_WRITE'].includes(entry.direction))) reasons.push(codeReason('NOT_WRITABLE'))
  if (!isOutput(direction) && !['READ', 'READ_WRITE'].includes(entry.direction)) reasons.push(codeReason('NOT_READABLE'))
  const unitWarning = Boolean(unit && entry.unit && unit !== entry.unit)
  if (unitWarning) reasons.push(codeReason('UNIT_MISMATCH'))
  /* Issue #840 — chất lượng live chỉ chặn chiều ĐỌC (`DDD-CTRL-PROG-001` §5),
     khớp validator máy chủ. Đích ghi đang BAD (ví dụ VP do chính Program ghi
     khi Program không chạy) vẫn gán được. */
  const qualityBlocked = !isOutput(direction) && entry.quality !== 'GOOD'
  if (qualityBlocked) reasons.push(codeReason('QUALITY_NOT_GOOD', entry.quality))
  const assignable = reasons.length === 0
  return { assignable, unitWarning, reasons, eligibility: qualityBlocked ? 'QUALITY_BLOCKED' : assignable ? 'SUPPORTED' : 'INCOMPATIBLE' }
}

function freshnessFor(entry: ProgrammingPointCatalogEntry | undefined, truth: CatalogTruthState): MappingVariableRow['freshness'] {
  if (!entry || truth.status === 'error' || truth.complete === false) return entry ? 'STALE' : 'UNAVAILABLE'
  return entry.quality === 'GOOD' ? 'LIVE' : 'UNAVAILABLE'
}

export function buildMappingVariableRows(document: ProgrammingDraftDocument, catalog: ProgrammingPointCatalogEntry[], truth: CatalogTruthState): MappingVariableRow[] {
  const variables = draftVariables(document)
  const catalogByKey = new Map(catalog.map((entry) => [pointKey(entry), entry]))
  const bindingsByVariable = new Map(document.bindings.map((binding) => [binding.variableId, binding]))

  return variables.map((variable) => {
    const binding = bindingsByVariable.get(variable.variableId)
    const point = binding ? catalogByKey.get(pointKey(binding.point)) : undefined
    if (!binding) {
      return {
        ...variable,
        id: variable.variableId,
        liveValue: null,
        liveQuality: 'UNKNOWN',
        freshness: 'UNAVAILABLE',
        bindingStatus: 'UNMAPPED',
        eligibility: variable.direction === 'INOUT' ? 'UNSUPPORTED_DIRECTION' : 'SUPPORTED',
        compatibility: { assignable: false, unitWarning: false, reasons: [] },
      }
    }
    if (!point && (truth.status !== 'ready' || truth.complete === false)) {
      /* Catalog chưa đủ thì việc chưa thấy Point chỉ có nghĩa là "chưa đọc tới
       * trang chứa nó". Gắn nhãn POINT_UNAVAILABLE ở đây tạo cảnh báo mất Point
       * giả cho mọi Binding trỏ sang trang sau — đúng lỗi ISS-PGM03-08. Binding
       * vẫn tồn tại; chỉ metadata/value của Point bị giữ STALE tới khi snapshot
       * đầy đủ hoặc một lần đọc đầy đủ thật sự chứng minh Point đã mất. */
      return {
        ...variable,
        id: variable.variableId,
        bindingId: binding.bindingId,
        point: binding.point,
        liveValue: null,
        liveQuality: 'STALE',
        freshness: 'STALE',
        bindingStatus: 'MAPPED',
        eligibility: truth.status === 'error' ? 'CATALOG_STALE' : 'PAGING_INCOMPLETE',
        compatibility: { assignable: false, unitWarning: false, reasons: [codeReason('CATALOG_UNVERIFIED')] },
      }
    }
    if (!point) {
      return {
        ...variable,
        id: variable.variableId,
        bindingId: binding.bindingId,
        point: binding.point,
        liveValue: null,
        liveQuality: 'UNKNOWN',
        freshness: 'UNAVAILABLE',
        bindingStatus: 'POINT_UNAVAILABLE',
        eligibility: 'UNSUPPORTED_IDENTITY',
        compatibility: { assignable: false, unitWarning: false, reasons: [codeReason('POINT_NOT_IN_CATALOG')] },
      }
    }
    const result = compatibilityFor(variable.direction, binding.dataType, binding.unit, point, truth)
    return {
      ...variable,
      id: variable.variableId,
      bindingId: binding.bindingId,
      point: binding.point,
      pointName: point.name,
      liveValue: point.value,
      /* Mốc đọc của chính điểm đang gắn. Thiếu dòng này, `MappingVariableRow`
         không bao giờ có `observedAt`, nên cột "Cập nhật" của bảng Ánh xạ đã
         gán và ô "Observed" của Inspector VĨNH VIỄN vẽ `—` — một ô chết trông
         y hệt "máy chủ không đọc được mốc thời gian". */
      observedAt: point.observedAt,
      liveQuality: truth.status === 'error' || truth.complete === false ? 'STALE' : point.quality,
      freshness: freshnessFor(point, truth),
      bindingStatus: result.eligibility === 'INCOMPATIBLE' ? 'INCOMPATIBLE' : 'MAPPED',
      eligibility: result.eligibility,
      compatibility: result,
    }
  })
}

export function buildPointRows(catalog: ProgrammingPointCatalogEntry[], variable: { type: string; direction: 'INPUT' | 'OUTPUT' | 'INOUT' } | undefined, truth: CatalogTruthState): MappingPointRow[] {
  return catalog.map((entry) => {
    const result = variable ? compatibilityFor(variable.direction, variable.type, undefined, entry, truth) : {
      assignable: false,
      unitWarning: false,
      reasons: [],
      eligibility: truth.status === 'error' ? 'CATALOG_STALE' as const : truth.complete === false ? 'PAGING_INCOMPLETE' as const : 'SUPPORTED' as const,
    }
    return {
      key: pointKey(entry),
      category: entry.category,
      pointId: entry.pointId,
      deviceId: entry.deviceId,
      name: entry.name,
      dataType: entry.dataType,
      direction: entry.direction,
      unit: entry.unit,
      writable: entry.writable,
      value: entry.value,
      quality: truth.status === 'error' || truth.complete === false ? 'STALE' : entry.quality,
      observedAt: entry.observedAt,
      eligibility: result.eligibility,
      compatible: result.assignable,
      compatibilityReasons: result.reasons,
      equipment: entry.equipment,
      description: entry.description,
      sourceRef: entry.sourceRef,
      displayId: entry.displayId,
      deviceLabel: entry.deviceLabel,
      sourceDetail: entry.sourceDetail,
    }
  })
}

/** Danh sách thiết bị có trong catalog, đã sắp xếp; kèm nhóm "chưa gán" khi có
 *  ít nhất một điểm chưa được gán. */
export function equipmentOptions(rows: MappingPointRow[]): string[] {
  const named = new Set<string>()
  let hasUnassigned = false
  for (const row of rows) {
    const equipment = row.equipment?.trim()
    if (equipment) named.add(equipment)
    else hasUnassigned = true
  }
  const options = [...named].sort((left, right) => left.localeCompare(right))
  return hasUnassigned ? [...options, UNASSIGNED_EQUIPMENT] : options
}

export function matchesEquipment(row: MappingPointRow, filter: string): boolean {
  if (filter === 'ALL') return true
  const equipment = row.equipment?.trim() ?? ''
  if (filter === UNASSIGNED_EQUIPMENT) return equipment === ''
  return equipment === filter
}

/* `ISS-PIO-10` (F-PIO-025, đề bài §28) — hai bộ lọc còn thiếu ở `MappingToolbar`.
 *
 * `Access` lọc theo QUYỀN của Point, dùng `direction` — quyết định của máy chủ
 * cho từng chiều — chứ không dùng riêng cờ `writable`. Hai nguồn này do cùng
 * `pointCatalogDirection` sinh ra và phải nhất quán; chọn cái nói được CẢ HAI
 * chiều để `READ_WRITE` lọt vào cả `Read` lẫn `Write`, đúng như nó là.
 */
export type AccessFilter = 'ALL' | 'READ' | 'WRITE'

/* `Status` KHÔNG phải ba cái xô loại trừ nhau, mà là ba câu hỏi độc lập:
 *
 *   Good     — chất lượng đang GOOD.
 *   Unmapped — chưa có binding nào trỏ tới điểm này.
 *   Offline  — chất lượng đang OFFLINE.
 *
 * Cố ép chúng thành thứ tự ưu tiên ("offline thắng unmapped") sẽ giấu mất đúng
 * nhóm điểm người vận hành cần nhất: một điểm vừa chưa map vừa đang offline vẫn
 * phải hiện ra khi lọc `Unmapped`, vì việc cần làm với nó là map chứ không phải
 * chờ nó online.
 *
 * `STALE`/`BAD`/`UNCERTAIN` KHÔNG bị gộp vào `Offline`: đó là ba câu trả lời
 * khác nhau của producer, và gộp chúng lại là tự dịch lại sự thật của thiết bị.
 */
export type StatusFilter = 'ALL' | 'GOOD' | 'UNMAPPED' | 'OFFLINE'

export function matchesAccess(row: Pick<MappingPointRow, 'direction'>, filter: AccessFilter): boolean {
  if (filter === 'ALL') return true
  if (filter === 'READ') return row.direction === 'READ' || row.direction === 'READ_WRITE'
  return row.direction === 'WRITE' || row.direction === 'READ_WRITE'
}

/** Khoá của các Point ĐANG được một binding trỏ tới. Dùng chung `pointKey` với
 *  phần dựng hàng, nếu không thì "chưa map" ở bộ lọc và "đã map" ở worklist sẽ
 *  đếm theo hai hệ khoá khác nhau và không bao giờ khớp. */
export function boundPointKeys(rows: Array<Pick<MappingVariableRow, 'point'>>): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    if (row.point) keys.add(pointKey(row.point))
  }
  return keys
}

export function matchesPointStatus(row: MappingPointRow, filter: StatusFilter, bound: Set<string>): boolean {
  switch (filter) {
    case 'GOOD':
      return row.quality === 'GOOD'
    case 'OFFLINE':
      return row.quality === 'OFFLINE'
    case 'UNMAPPED':
      return !bound.has(row.key)
    default:
      return true
  }
}

/* Cùng một bộ lọc phải nói cùng một điều ở CẢ HAI danh sách. Lọc mỗi bên Point
 * mà để nguyên bên Variable sẽ cho một màn hình tự mâu thuẫn: cột trái đầy biến
 * đã map trong khi cột phải chỉ còn điểm chưa map.
 *
 * `Unmapped` ở phía Variable là `bindingStatus`, không phải chất lượng: một biến
 * chưa map thì chưa có gì để nói về chất lượng. */
export function matchesVariableStatus(row: MappingVariableRow, filter: StatusFilter): boolean {
  switch (filter) {
    case 'GOOD':
      return row.liveQuality === 'GOOD'
    case 'OFFLINE':
      return row.liveQuality === 'OFFLINE'
    case 'UNMAPPED':
      return row.bindingStatus === 'UNMAPPED'
    default:
      return true
  }
}

function tokens(value: string): Set<string> {
  return new Set(value.replace(/([a-z])([A-Z])/g, '$1 $2').toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

export function rankPointRows(rows: MappingPointRow[], variable: { name: string; type: string; direction: 'INPUT' | 'OUTPUT' | 'INOUT' }): MappingPointRow[] {
  const variableTokens = tokens(variable.name)
  return rows.map((row) => {
    const nameOverlap = [...variableTokens].filter((token) => tokens(row.name).has(token)).length
    const score = (row.compatible ? 100000 : 0) + (row.dataType === variable.type ? 10000 : 0) + (nameOverlap * 100) + (row.category === 'LOCAL' ? 10 : 0)
    return { ...row, suggestionScore: score }
  }).sort((a, b) => (b.suggestionScore ?? 0) - (a.suggestionScore ?? 0) || a.key.localeCompare(b.key))
}

/**
 * `ISS-PGUI-02` — `pick` là THAM SỐ BẮT BUỘC, không có mặc định.
 *
 * Hàm này từng trả thẳng "Tắt"/"Bật", nên bốn bề mặt Mapping in hai chữ tiếng
 * Việt ấy giữa giao diện English. Cho `pick` một giá trị mặc định sẽ khiến chỗ
 * gọi mới quên truyền mà vẫn biên dịch được — đúng cách lỗi này quay lại. Số
 * và chuỗi giữ nguyên: chúng là giá trị đo được, không phải chữ để dịch.
 */
export function formatMappingValue(value: unknown, pick: (vi: string, en: string) => string): string {
  if (value === null || value === undefined) return '—'
  if (value === false) return pick('Tắt', 'Off')
  if (value === true) return pick('Bật', 'On')
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  return String(value)
}
