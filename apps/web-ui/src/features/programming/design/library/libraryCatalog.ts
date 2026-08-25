import type { ProgrammingLibraryEntry, ProgrammingLibraryPage } from '../../model/types'

/**
 * `T59-804` (`PGM02-V22-WP-03`) — MỘT catalog cho cả Quick Library của PGM-02
 * và Control Library của PGM-04.
 *
 * Authority là `GET /programming/libraries`: nó trả SYSTEM (sinh từ
 * `contracts/programming/pou_library_registry_v1.json`) và PROJECT trong cùng
 * một trang, kèm `contentSha256` và `featureState` thật. Module này chỉ CHUẨN
 * HOÁ trang đó — không chép chữ ký, không dựng danh sách block thứ hai, và
 * không tự bịa metadata cho mục mà backend trả thiếu.
 */
export type LibraryPortDirection = 'INPUT' | 'OUTPUT'

export interface LibraryPort {
  name: string
  direction: LibraryPortDirection
  dataType: string
}

/** Trạng thái dùng được của một mục, đã gộp `featureState` + tính đầy đủ chữ ký. */
export type LibraryUsability =
  | { kind: 'AVAILABLE' }
  /** Có thật nhưng cần review sản phẩm trước khi dùng (vd PID). */
  | { kind: 'REVIEW_REQUIRED' }
  /** Backend trả mục nhưng chữ ký không đọc được — KHÔNG đoán port. */
  | { kind: 'SIGNATURE_UNAVAILABLE' }

export interface CatalogEntry {
  entryId: string
  scope: 'SYSTEM' | 'PROJECT'
  kind: ProgrammingLibraryEntry['kind']
  name: string
  labelVi: string
  labelEn: string
  category: string
  /** `undefined` = mục không ràng buộc ngôn ngữ (đa số SYSTEM entry). */
  language?: 'ST' | 'FBD'
  libraryVersion: string
  contentSha256: string
  usability: LibraryUsability
  ports: readonly LibraryPort[]
  allowedTypes: readonly string[]
  defaultType?: string
  /** POU dùng chung có trạng thái nội tại: FB phải khai instance trước khi gọi. */
  stateful: boolean
}

interface SignatureShape {
  category?: unknown
  labelVi?: unknown
  labelEn?: unknown
  allowedTypes?: unknown
  defaultType?: unknown
  ports?: unknown
}

function parsePorts(raw: unknown): LibraryPort[] | null {
  if (!Array.isArray(raw)) return null
  const ports: LibraryPort[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const port = item as Record<string, unknown>
    const name = typeof port.name === 'string' ? port.name : null
    const dataType = typeof port.dataType === 'string' ? port.dataType : null
    const direction = port.direction === 'INPUT' || port.direction === 'OUTPUT' ? port.direction : null
    if (!name || !dataType || !direction) return null
    ports.push({ name, direction, dataType })
  }
  return ports
}

function signatureOf(entry: ProgrammingLibraryEntry): SignatureShape | null {
  const raw = entry.interface
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SignatureShape
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') return raw as SignatureShape
  return null
}

/**
 * Chuẩn hoá một trang catalog. Mục có chữ ký hỏng KHÔNG bị bỏ đi: nó vẫn xuất
 * hiện với `SIGNATURE_UNAVAILABLE` để người dùng thấy "có mục này nhưng chưa
 * dùng được", thay vì biến mất và trở thành một câu hỏi không ai trả lời được.
 */
export function catalogEntries(page: ProgrammingLibraryPage | null | undefined): CatalogEntry[] {
  if (!page?.items) return []
  return page.items.map((entry) => {
    const signature = signatureOf(entry)
    const ports = signature ? parsePorts(signature.ports) : null
    const usability: LibraryUsability =
      ports === null
        ? { kind: 'SIGNATURE_UNAVAILABLE' }
        : entry.featureState === 'REVIEW_REQUIRED'
          ? { kind: 'REVIEW_REQUIRED' }
          : { kind: 'AVAILABLE' }
    return {
      entryId: entry.entryId,
      scope: entry.scope,
      kind: entry.kind,
      name: entry.name,
      labelVi: typeof signature?.labelVi === 'string' ? signature.labelVi : entry.name,
      labelEn: typeof signature?.labelEn === 'string' ? signature.labelEn : entry.name,
      category: typeof signature?.category === 'string' ? signature.category : 'other',
      ...(entry.language ? { language: entry.language } : {}),
      libraryVersion: entry.libraryVersion,
      contentSha256: entry.contentSha256,
      usability,
      ports: ports ?? [],
      allowedTypes: Array.isArray(signature?.allowedTypes)
        ? (signature.allowedTypes as unknown[]).filter((type): type is string => typeof type === 'string')
        : [],
      ...(typeof signature?.defaultType === 'string' ? { defaultType: signature.defaultType } : {}),
      stateful: entry.kind === 'FUNCTION_BLOCK'
    }
  })
}

export interface CatalogFilter {
  query?: string
  category?: string
  /** Ngôn ngữ POU đang mở; mục ràng buộc ngôn ngữ khác bị loại. */
  language?: 'ST' | 'FBD'
  /** Chỉ giữ mục có ít nhất một port kiểu này (lọc theo port đang chọn). */
  dataType?: string
}

/** Lọc thuần. Mục không dùng được KHÔNG bị giấu — chúng được giải thích ở UI. */
export function filterCatalog(entries: readonly CatalogEntry[], filter: CatalogFilter): CatalogEntry[] {
  const needle = (filter.query ?? '').trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    if (filter.category && entry.category !== filter.category) return false
    if (filter.language && entry.language && entry.language !== filter.language) return false
    if (filter.dataType) {
      const matchesPort = entry.ports.some((port) => port.dataType === filter.dataType)
      const matchesPolymorphic = entry.allowedTypes.includes(filter.dataType)
      if (!matchesPort && !matchesPolymorphic) return false
    }
    if (needle === '') return true
    return (
      entry.name.toLocaleLowerCase().includes(needle) ||
      entry.entryId.toLocaleLowerCase().includes(needle) ||
      entry.labelVi.toLocaleLowerCase().includes(needle) ||
      entry.labelEn.toLocaleLowerCase().includes(needle) ||
      entry.category.toLocaleLowerCase().includes(needle)
    )
  })
}

export function catalogCategories(entries: readonly CatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.category))].sort()
}

export function isInsertable(entry: CatalogEntry): boolean {
  return entry.usability.kind === 'AVAILABLE'
}

/**
 * Sinh đoạn ST cho một mục catalog.
 *
 * FUNCTION là biểu thức thuần nên chèn ngay tại con trỏ dưới dạng lời gọi có
 * đủ tham số giữ chỗ. FUNCTION_BLOCK có trạng thái nội tại: theo grammar IEC,
 * nó phải có INSTANCE khai trong `VAR ... END_VAR` rồi mới gọi được, nên đoạn
 * sinh ra gồm cả hai phần và người dùng thấy ngay điều đó thay vì nhận lỗi
 * Check "instance chưa khai".
 */
export function stInsertionSnippet(entry: CatalogEntry, instanceName?: string): string {
  const inputs = entry.ports.filter((port) => port.direction === 'INPUT')
  const outputs = entry.ports.filter((port) => port.direction === 'OUTPUT')
  if (!entry.stateful) {
    const args = inputs.map((port) => port.name).join(', ')
    const target = outputs[0]?.name ?? 'OUT'
    return `${target} := ${entry.name}(${args});`
  }
  const instance = instanceName ?? `${entry.name}_1`
  const assignments = inputs.map((port) => `${port.name} := ${port.name}`).join(', ')
  const readback = outputs[0] ? `\n(* ${instance}.${outputs[0].name} *)` : ''
  return `VAR\n  ${instance} : ${entry.name};\nEND_VAR\n${instance}(${assignments});${readback}`
}

/**
 * Parity giữa catalog của backend và registry sinh sẵn ở FE. Hai bề mặt cùng
 * đọc một hợp đồng, nên tập `entryId` SYSTEM phải trùng khít; lệch nghĩa là một
 * bên đang chào block mà bên kia không có — đúng lớp lỗi đã từng xảy ra
 * (palette FBD từng chào SCALE/DEADBAND/CTU/PI mà compiler không hề hỗ trợ).
 */
export interface CatalogParityResult {
  onlyInBackend: string[]
  onlyInGenerated: string[]
  matched: number
}

export function catalogParity(
  entries: readonly CatalogEntry[],
  generatedEntryIds: readonly string[]
): CatalogParityResult {
  const backend = new Set(entries.filter((entry) => entry.scope === 'SYSTEM').map((entry) => entry.entryId))
  const generated = new Set(generatedEntryIds)
  return {
    onlyInBackend: [...backend].filter((id) => !generated.has(id)).sort(),
    onlyInGenerated: [...generated].filter((id) => !backend.has(id)).sort(),
    matched: [...backend].filter((id) => generated.has(id)).length
  }
}
