import type { ProgrammingDraftDocument, ProgrammingLibraryEntry } from './types'
import { draftObjects, type DraftPouObject } from './signals'

/**
 * T59-203 — logic thuần của Control Library authoring (PGM-04, DDD §3.4/§8).
 *
 * HAI SỰ THẬT VỀ HỢP ĐỒNG THẬT, đọc kỹ trước khi sửa file này:
 *
 * 1. `GET /libraries` trả **mọi** library revision của Project (DRAFT +
 *    PUBLISHED + DEPRECATED), không chỉ bản mới nhất — xem
 *    `store/library.go: SearchLibraryEntries`, câu JOIN không lọc `state`. Nên
 *    cùng một `entryId` xuất hiện NHIỀU LẦN với `libraryVersion`/`libraryState`
 *    khác nhau. Đó chính là lịch sử version, và cũng chính là lý do bản trước
 *    của `LibraryPage` chọn nhầm: `entries.find(entryId)` lấy bản đầu tiên gặp,
 *    tức một version tuỳ ý.
 * 2. KHÔNG có route HTTP để publish/tạo version thủ công. Publish và tạo version
 *    vẫn là hệ quả của hai thao tác có thật:
 *      - `POST /projects/{id}/library/entries` luôn ghi vào **DRAFT đang mở**;
 *        chưa có DRAFT thì store mở một bản minor kế tiếp CLONE từ bản publish
 *        mới nhất (`ensureProjectLibraryDraftTx`) — đó là "tạo version mới".
 *      - Seal Revision (`POST /projects/{id}/draft/revisions`) publish DRAFT
 *        library trong CÙNG transaction (`store/commands.go`) — đó là "publish".
 *    Giao diện vì vậy phải nói đúng nguồn gốc của trạng thái, không được dựng
 *    một nút "Publish" gọi vào endpoint không tồn tại. Riêng chuyển tiếp một
 *    chiều PUBLISHED -> DEPRECATED có route admin rõ ràng:
 *    `POST /projects/{id}/library/revisions/{libraryRevisionId}/deprecate`.
 */

/** So sánh SemVer (`domain.ValidateProjectLibraryVersion`). Chuỗi không phải
 *  SemVer (ví dụ version của registry SYSTEM) rơi về so sánh chuỗi để thứ tự
 *  vẫn tất định thay vì phụ thuộc thứ tự tới của mảng. */
export function compareLibraryVersions(left: string, right: string): number {
  const parse = (value: string): number[] | null => {
    const core = value.split('-')[0].split('+')[0]
    const parts = core.split('.')
    if (parts.length !== 3) return null
    const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
    return numbers.some(Number.isNaN) ? null : numbers
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return left.localeCompare(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  // Bản có prerelease đứng TRƯỚC bản không prerelease (SemVer 2.0.0 §11).
  const preLeft = left.includes('-')
  const preRight = right.includes('-')
  if (preLeft !== preRight) return preLeft ? -1 : 1
  return left.localeCompare(right)
}

export interface LibraryEntryGroup {
  /** Khoá ổn định cho React: một entry chỉ thuộc đúng một scope. */
  key: string
  scope: ProgrammingLibraryEntry['scope']
  entryId: string
  name: string
  kind: ProgrammingLibraryEntry['kind']
  /** Version đang có hiệu lực để chỉnh sửa/hiển thị: ưu tiên bản DRAFT (bản duy
   *  nhất còn sửa được), nếu không thì bản version cao nhất. */
  current: ProgrammingLibraryEntry
  /** Toàn bộ version của entry này, mới nhất trước. */
  versions: ProgrammingLibraryEntry[]
}

export function groupLibraryEntries(items: ProgrammingLibraryEntry[]): LibraryEntryGroup[] {
  const groups = new Map<string, ProgrammingLibraryEntry[]>()
  for (const item of items) {
    const key = `${item.scope}/${item.entryId}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  }
  const result: LibraryEntryGroup[] = []
  for (const [key, bucket] of groups) {
    const versions = [...bucket].sort((left, right) => compareLibraryVersions(right.libraryVersion, left.libraryVersion))
    const current = versions.find((item) => item.libraryState === 'DRAFT') ?? versions[0]
    result.push({
      key,
      scope: current.scope,
      entryId: current.entryId,
      name: current.name,
      kind: current.kind,
      current,
      versions
    })
  }
  return result.sort((left, right) => {
    const byName = left.name.toUpperCase().localeCompare(right.name.toUpperCase())
    return byName !== 0 ? byName : left.entryId.localeCompare(right.entryId)
  })
}

export type LibraryMutationBlock =
  | 'SYSTEM_IMMUTABLE'
  | 'NEEDS_ADMIN'
  | 'NO_PROJECT'
  | 'PUBLISHED_IMMUTABLE'
  | 'DEPRECATE_REQUIRES_PUBLISHED'
  | 'DEPENDED_ON'

export interface LibraryEntryPermissions {
  /** Lưu được (ghi vào DRAFT library đang mở). */
  canSave: boolean
  /** Lưu sẽ tạo một version mới thay vì sửa tại chỗ. */
  savesNewVersion: boolean
  canDelete: boolean
  saveBlock: LibraryMutationBlock | null
  deleteBlock: LibraryMutationBlock | null
}

/**
 * Quyết định mutability. Đây là hàng rào THẬT, không phải mẹo ẩn nút: chỗ gọi
 * bắt buộc hỏi hàm này trước khi phát request, nên một nút bị bỏ sót `disabled`
 * vẫn không gửi được gì. `SYSTEM` bị chặn vì `entryId` của registry (`TON`,
 * `PID`…) không phải UUID, và `UpsertEntry` bên Go từ chối nó bằng 400 — hiển
 * thị một form "sửa được" cho nó là hứa một thứ server không bao giờ làm.
 */
export function libraryEntryPermissions(
  group: LibraryEntryGroup,
  options: { canAdmin: boolean; hasProject: boolean; dependents: string[] }
): LibraryEntryPermissions {
  if (group.scope === 'SYSTEM') {
    return { canSave: false, savesNewVersion: false, canDelete: false, saveBlock: 'SYSTEM_IMMUTABLE', deleteBlock: 'SYSTEM_IMMUTABLE' }
  }
  if (!options.canAdmin) {
    return { canSave: false, savesNewVersion: false, canDelete: false, saveBlock: 'NEEDS_ADMIN', deleteBlock: 'NEEDS_ADMIN' }
  }
  if (!options.hasProject) {
    return { canSave: false, savesNewVersion: false, canDelete: false, saveBlock: 'NO_PROJECT', deleteBlock: 'NO_PROJECT' }
  }
  const draftVersion = group.versions.find((item) => item.libraryState === 'DRAFT')
  const savesNewVersion = draftVersion === undefined
  if (options.dependents.length > 0) {
    return { canSave: true, savesNewVersion, canDelete: false, saveBlock: null, deleteBlock: 'DEPENDED_ON' }
  }
  return {
    canSave: true,
    savesNewVersion,
    canDelete: draftVersion !== undefined,
    saveBlock: null,
    // Version đã publish là bất biến: store chỉ xoá được entry nằm trong DRAFT.
    deleteBlock: draftVersion !== undefined ? null : 'PUBLISHED_IMMUTABLE'
  }
}

/** Hàng rào cho mutation áp dụng lên CẢ PROJECT Library revision. DRAFT chưa
 * được publish và DEPRECATED đã kết thúc vòng đời đều không được gửi request;
 * route server chỉ chấp nhận đúng chuyển tiếp PUBLISHED -> DEPRECATED. */
export function libraryRevisionDeprecationBlock(
  revision: ProgrammingLibraryEntry,
  options: { canAdmin: boolean; hasProject: boolean }
): LibraryMutationBlock | null {
  if (revision.scope === 'SYSTEM') return 'SYSTEM_IMMUTABLE'
  if (!options.canAdmin) return 'NEEDS_ADMIN'
  if (!options.hasProject) return 'NO_PROJECT'
  if (revision.libraryState !== 'PUBLISHED') return 'DEPRECATE_REQUIRES_PUBLISHED'
  return null
}

/** Entry nào trong CÙNG library revision đang khai `entryId` này làm dependency
 *  — đúng vòng kiểm mà `DeleteProjectLibraryEntry` chạy trước khi xoá. */
export function libraryDependents(group: LibraryEntryGroup, items: ProgrammingLibraryEntry[]): string[] {
  const revisionId = group.current.libraryRevisionId
  return items
    .filter(
      (item) =>
        item.libraryRevisionId === revisionId &&
        item.entryId !== group.entryId &&
        item.dependencies.some((dependency) => dependency.entryId.toUpperCase() === group.entryId.toUpperCase())
    )
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right))
}

export interface LibraryUsage {
  objectId: string
  name: string
  kind: DraftPouObject['kind']
}

/**
 * POU nào trong Draft đang dùng entry nào.
 *
 * Nguồn là `objects[].dependencies` của chính tài liệu Draft — cùng mảng mà
 * seal Revision chuyển thành bản ghi `library_usages`
 * (`application/draft.go: revisionPayload`), nên đây là dữ liệu thật chứ không
 * phải suy đoán. Bảng `library_usages` (đã seal) không có endpoint HTTP nào,
 * nên Draft là nguồn usage duy nhất đọc được.
 */
export function libraryUsagesByEntryId(draft: ProgrammingDraftDocument | undefined): Map<string, LibraryUsage[]> {
  const map = new Map<string, LibraryUsage[]>()
  if (!draft) return map
  for (const object of draftObjects(draft)) {
    for (const entryId of object.dependencies) {
      const key = entryId.toUpperCase()
      const bucket = map.get(key)
      const usage: LibraryUsage = { objectId: object.objectId, name: object.name, kind: object.kind }
      if (bucket) bucket.push(usage)
      else map.set(key, [usage])
    }
  }
  for (const bucket of map.values()) bucket.sort((left, right) => left.name.localeCompare(right.name))
  return map
}
