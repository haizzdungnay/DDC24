import type { ProgrammingDraftDocument, ProgrammingProgram } from '../../model/types'

/**
 * `T59-803` (`PGM02-V22-WP-02`) — view model của MỘT POU Explorer duy nhất.
 *
 * Hai trục định danh không được lẫn (DDD-SW-PGM02-WORKSPACE-001 §3.5):
 * `objectId` sở hữu tài liệu (chọn, deep-link, đổi tên, xoá), còn `programId`
 * là identity runtime và CHỈ tồn tại khi POU thực sự có cấu hình chạy. Trước
 * lát này, giao diện chọn POU bằng `programId` và với POU chưa xếp lịch thì
 * `programId` chỉ là `objectId` mượn tạm — hai khái niệm trùng giá trị nên
 * không ai thấy chỗ sai cho tới khi backend cấp `programId` khác.
 */
export type PouKind = ProgrammingProgram['kind']
export type PouLanguage = ProgrammingProgram['language']

export const POU_KINDS: readonly PouKind[] = ['PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK']

export interface PouItem {
  /** Identity tài liệu — authority cho mọi thao tác của Explorer. */
  objectId: string
  /** Identity runtime; `undefined` khi POU chưa có cấu hình chạy. */
  runtimeProgramId?: string
  name: string
  kind: PouKind
  language: PouLanguage
  /** POU có mục trong `programs[]` hay không. FUNCTION/FB luôn `false`. */
  scheduled: boolean
  periodMs?: number
  dependencies: readonly string[]
}

/**
 * Chiếu document workspace (đã chuẩn hoá v1/v2 ở `toWorkspaceDocument`) sang
 * danh sách POU. Không đọc lại Draft thô ở đây: hai đường chiếu song song là
 * cách nhanh nhất để hai bề mặt nói hai điều khác nhau về cùng một POU.
 */
export function pouItems(document: ProgrammingDraftDocument): PouItem[] {
  return document.programs.map((program) => {
    const objectId = program.objectId ?? program.programId
    /* `hasRuntimeConfig === undefined` là document v1 đi qua nguyên trạng: ở đó
     * mọi Program đều có cấu hình chạy, nên suy theo kind là đúng. */
    const scheduled = program.hasRuntimeConfig ?? program.kind === 'PROGRAM'
    return {
      objectId,
      ...(scheduled ? { runtimeProgramId: program.programId } : {}),
      name: program.name,
      kind: program.kind,
      language: program.language,
      scheduled,
      ...(program.periodMs === undefined ? {} : { periodMs: program.periodMs }),
      dependencies: program.dependencies ?? []
    }
  })
}

export interface PouGroup {
  kind: PouKind
  items: PouItem[]
}

/** Nhóm theo kind và sắp theo tên; thứ tự nhóm cố định để tiêu điểm bàn phím
 *  không nhảy chỗ giữa hai lần render. */
export function groupPouItems(items: readonly PouItem[]): PouGroup[] {
  return POU_KINDS.map((kind) => ({
    kind,
    items: items
      .filter((item) => item.kind === kind)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
  }))
}

/** Lọc theo tên/ngôn ngữ, không phân biệt hoa thường và bỏ khoảng trắng thừa. */
export function filterPouItems(items: readonly PouItem[], query: string): PouItem[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return items.slice()
  return items.filter(
    (item) =>
      item.name.toLocaleLowerCase().includes(needle) ||
      item.language.toLocaleLowerCase() === needle
  )
}

/**
 * Phân giải POU đang chọn. KHÔNG fallback theo tên hay theo chỉ số: một
 * `objectId` không thuộc Project phải cho `null` để giao diện nói "không tìm
 * thấy", chứ không mở POU thứ nhất rồi để người dùng sửa nhầm tệp.
 */
export function resolvePouSelection(
  items: readonly PouItem[],
  requestedObjectId: string | undefined
): PouItem | null {
  if (!requestedObjectId) return null
  return items.find((item) => item.objectId === requestedObjectId) ?? null
}

/**
 * Đổi `objectId` sang identity runtime. Trả `undefined` cho POU chưa xếp lịch —
 * đó là câu trả lời đúng, và mượn `objectId` làm `programId` sẽ tạo ra một
 * identity runtime không tồn tại ở Core.
 */
export function runtimeProgramIdOf(
  items: readonly PouItem[],
  objectId: string | undefined
): string | undefined {
  if (!objectId) return undefined
  return items.find((item) => item.objectId === objectId)?.runtimeProgramId
}

/** Ngược lại: từ identity runtime về identity tài liệu, cho deep-link cũ mang
 *  `?program=` và cho overlay runtime trỏ ngược vào Explorer. */
export function objectIdOfRuntimeProgram(
  items: readonly PouItem[],
  programId: string | undefined
): string | undefined {
  if (!programId) return undefined
  return items.find((item) => item.runtimeProgramId === programId)?.objectId
}
