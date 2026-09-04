import type { ProgrammingLibraryEntry, ProgrammingLibraryPage } from '../../model/types'
import { groupLibraryEntries } from '../../model/library'
import {
  libraryPresentation,
  type LibraryPresentation,
  type LibraryUsability as SharedLibraryUsability,
} from '../../library/libraryPresentation'

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

/**
 * `T61-203` — mục catalog CHÍNH LÀ mô hình trình bày dùng chung.
 *
 * Trước lát này đây là một mô hình THỨ HAI với ngữ nghĩa riêng: `category` đọc
 * từ blob chữ ký (thiếu thì bịa `'other'`), chữ ký thì tự parse `interface` khi
 * `signature` vắng, và không hề biết tới `DEPRECATED`. Hệ quả đo được: một khối
 * đã ngừng sử dụng bị PGM-04 chặn nhưng vẫn chèn được từ Quick Library, và cùng
 * một khối hiện hai phân loại khác nhau ở hai màn hình.
 *
 * Nay nó là bí danh của `LibraryPresentation`. Giữ tên `CatalogEntry` vì bảy
 * mô-đun khác (chèn ST, palette FBD, Inspector, hover) đang cầm kiểu này; đổi
 * tên là một lần sửa cơ học không nói thêm điều gì.
 */
export type CatalogEntry = LibraryPresentation

/** Bí danh giữ tương thích cho chỗ gọi cũ. Thang bậc thật nằm ở mô hình chung. */
export type LibraryUsability = SharedLibraryUsability

/**
 * Chuẩn hoá một trang catalog. Mục có chữ ký hỏng KHÔNG bị bỏ đi: nó vẫn xuất
 * hiện với `SIGNATURE_UNAVAILABLE` để người dùng thấy "có mục này nhưng chưa
 * dùng được", thay vì biến mất và trở thành một câu hỏi không ai trả lời được.
 */
export function catalogEntries(page: ProgrammingLibraryPage | null | undefined): CatalogEntry[] {
  return catalogEntriesOf(page?.items)
}

/**
 * `T61-202`/`T61-203` — cùng phép chiếu, nhận DANH SÁCH ĐÃ GHÉP thay vì một
 * trang, và GOM THEO ĐỊNH DANH trước khi chiếu.
 *
 * Phép gom không phải để cho gọn. `GET /libraries` trả mọi library revision của
 * Project (DRAFT + PUBLISHED + DEPRECATED), nên bản cũ — chiếu thẳng từng hàng —
 * hiện cùng một khối nhiều lần, mỗi lần một version, và người dùng phải tự đoán
 * cái nào là cái đang dùng. Luật chọn version hiện hành (`groupLibraryEntries`:
 * ưu tiên DRAFT, nếu không thì version cao nhất) là luật của PGM-04; dùng lại nó
 * ở đây chính là điều làm hai màn hình nói cùng một câu.
 */
export function catalogEntriesOf(
  items: readonly ProgrammingLibraryEntry[] | null | undefined
): CatalogEntry[] {
  if (!items) return []
  return groupLibraryEntries([...items]).map((group) => libraryPresentation(group.current))
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
      /* `category` nay có thể là `null` ("chưa ai phân loại"). Bản cũ quy nó về
         `'other'`, nên gõ "other" khớp mọi khối chưa phân loại — một nhóm chưa
         từng tồn tại. */
      (entry.category?.toLocaleLowerCase().includes(needle) ?? false) ||
      entry.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))
    )
  })
}

/** Các phân loại CÓ THẬT trong danh sách. Khối chưa phân loại không sinh ra một
 *  chip rỗng — cũng không sinh ra chip `'other'` như bản cũ. */
export function catalogCategories(entries: readonly CatalogEntry[]): string[] {
  const categories = entries.map((entry) => entry.category).filter((value): value is string => value !== null)
  return [...new Set(categories)].sort()
}

export function isInsertable(entry: CatalogEntry): boolean {
  return entry.usability.kind === 'AVAILABLE'
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
