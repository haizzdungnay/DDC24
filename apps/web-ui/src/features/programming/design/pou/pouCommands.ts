import type {
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingTaskConfig
} from '../../model/types'
import { defaultPouName, pouSourceTemplate } from './pouTemplates'
import type { PouItem, PouKind, PouLanguage } from './pouViewModel'

/**
 * `T59-803` — mọi thao tác vòng đời POU dựng batch operation ở ĐÂY, thuần và
 * kiểm được, thay vì nằm rải trong handler của cây.
 *
 * Thứ tự trong batch là một phần của hợp đồng, không phải sở thích: backend
 * fail-closed nếu một tham chiếu còn sống, nên xoá phải đi binding → biến →
 * cấu hình chạy → chính POU. Đảo thứ tự là nhận `PRG-ERR-REQ-001` không kèm lý
 * do đọc được.
 */

/** Tên đã dùng (không phân biệt hoa thường) — POU name là token duy nhất trong
 *  Project, kể cả giữa hai kind khác nhau. */
function nameTaken(items: readonly PouItem[], name: string, exceptObjectId?: string): boolean {
  const normalized = name.trim().toLocaleLowerCase()
  return items.some(
    (item) => item.objectId !== exceptObjectId && item.name.trim().toLocaleLowerCase() === normalized
  )
}

export function uniquePouName(items: readonly PouItem[], baseName: string): string {
  if (!nameTaken(items, baseName)) return baseName
  let suffix = 2
  while (nameTaken(items, `${baseName}_${suffix}`)) suffix += 1
  return `${baseName}_${suffix}`
}

/** Tên POU theo grammar IEC: chữ cái/gạch dưới mở đầu, sau đó chữ/số/gạch dưới.
 *  Kiểm ở FE để nói ra lý do ngay, KHÔNG thay cho kiểm của backend. */
const POU_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type PouNameError = 'EMPTY' | 'PATTERN' | 'DUPLICATE' | null

export function validatePouName(
  items: readonly PouItem[],
  name: string,
  exceptObjectId?: string
): PouNameError {
  const trimmed = name.trim()
  if (trimmed === '') return 'EMPTY'
  if (!POU_NAME_PATTERN.test(trimmed)) return 'PATTERN'
  if (nameTaken(items, trimmed, exceptObjectId)) return 'DUPLICATE'
  return null
}

export interface CreatePouInput {
  kind: PouKind
  language: PouLanguage
  /** Identity do caller cấp để retry cùng request giữ nguyên định danh. */
  objectId: string
  name?: string
  /** Cấu hình chạy hiện hành, chỉ dùng cho PROGRAM. */
  task: ProgrammingTaskConfig
}

export interface CreatePouResult {
  operations: ProgrammingDraftOperation[]
  objectId: string
  name: string
}

/**
 * Tạo POU. PROGRAM đi qua `upsertProgram` (compat tạo cả object lẫn cấu hình
 * chạy rồi thêm vào `programOrder`), còn FUNCTION/FUNCTION_BLOCK đi qua
 * `upsertObject` và KHÔNG BAO GIỜ chạm `programs[]`: chúng không phải đơn vị
 * lập lịch, và cấp cho chúng một mục cấu hình là dựng ra một Program ma.
 */
export function createPouOperations(items: readonly PouItem[], input: CreatePouInput): CreatePouResult {
  const name = uniquePouName(items, input.name?.trim() || defaultPouName(input.kind, input.language))
  const source = pouSourceTemplate(input.kind, input.language, name)
  if (input.kind === 'PROGRAM') {
    return {
      objectId: input.objectId,
      name,
      operations: [
        {
          op: 'upsertProgram',
          program: { programId: input.objectId, name, kind: 'PROGRAM', language: input.language, document: source }
        },
        {
          op: 'setTask',
          task: { ...input.task, programOrder: [...input.task.programOrder, input.objectId] }
        }
      ]
    }
  }
  return {
    objectId: input.objectId,
    name,
    operations: [
      {
        op: 'upsertObject',
        object: {
          objectId: input.objectId,
          kind: input.kind,
          name,
          language: input.language,
          source,
          locals: []
        }
      }
    ]
  }
}

export function renamePouOperations(objectId: string, name: string): ProgrammingDraftOperation[] {
  return [{ op: 'renameObject', objectId, name: name.trim() }]
}

export interface DuplicatePouResult {
  operations: ProgrammingDraftOperation[]
  objectId: string
  name: string
}

/**
 * Nhân bản NỘI DUNG, cấp identity mới, và KHÔNG mang theo cấu hình chạy: bản
 * sao của một Program đang chạy không được tự động được xếp lịch, nếu không
 * một cú nhấn "Nhân bản" sẽ thêm một Program vào chu kỳ điều khiển thật.
 */
export function duplicatePouOperations(
  items: readonly PouItem[],
  source: PouItem,
  newObjectId: string
): DuplicatePouResult {
  const name = uniquePouName(items, `${source.name}_copy`)
  return {
    objectId: newObjectId,
    name,
    operations: [{ op: 'duplicateObject', objectId: source.objectId, newObjectId, name }]
  }
}

/** POU khác đang gọi POU này. Xoá khi còn người gọi làm Check hỏng ở lần sau
 *  chứ không hỏng ngay, nên phải chặn tại chỗ và nói ra ai đang gọi. */
export function pouDeleteBlockers(items: readonly PouItem[], objectId: string): PouItem[] {
  return items.filter((item) => item.objectId !== objectId && item.dependencies.includes(objectId))
}

/**
 * Xoá POU cùng mọi thứ chỉ thuộc về nó. Thứ tự bắt buộc: binding → biến → cấu
 * hình chạy (CHỈ khi POU thật sự có) → chính POU.
 *
 * `scheduled` chứ không phải `kind` quyết định có gửi `removeProgram` hay
 * không: một POU kind PROGRAM vẫn có thể chưa xếp lịch, và gửi `removeProgram`
 * cho nó làm backend từ chối cả batch — người dùng không xoá được đúng cái POU
 * đó, một vòng lặp chết đã từng xảy ra thật.
 */
export function deletePouOperations(
  document: ProgrammingDraftDocument,
  item: PouItem
): ProgrammingDraftOperation[] {
  const runtimeProgramId = item.runtimeProgramId ?? item.objectId
  const variableIds = document.variables
    .filter((variable) => variable.programId === runtimeProgramId)
    .map((variable) => variable.variableId)
  const bindingIds = document.bindings
    .filter((binding) => variableIds.includes(binding.variableId))
    .map((binding) => binding.bindingId)
  return [
    ...bindingIds.map((bindingId): ProgrammingDraftOperation => ({ op: 'removeBinding', bindingId })),
    ...variableIds.map((variableId): ProgrammingDraftOperation => ({ op: 'removeVariable', variableId })),
    ...(item.scheduled && item.runtimeProgramId
      ? [{ op: 'removeProgram', programId: item.runtimeProgramId } as ProgrammingDraftOperation]
      : []),
    { op: 'removeObject', objectId: item.objectId }
  ]
}
