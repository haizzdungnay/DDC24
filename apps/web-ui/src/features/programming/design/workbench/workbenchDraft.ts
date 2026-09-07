import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'

/**
 * Chiếu các buffer POU chưa lưu vào bản chỉ-đọc dành cho workbench.
 *
 * `ProgramsTab` đã phát source local dưới dạng operation; dùng chính payload đó
 * tránh tạo thêm một kho buffer/validator song song. Bản chiếu này tuyệt đối
 * không được gửi lên API và không thay đổi authority của Draft đã read-back.
 */
export function projectPendingProgramSources(
  document: ProgrammingDraftDocument,
  operations: readonly ProgrammingDraftOperation[],
): ProgrammingDraftDocument {
  if (operations.length === 0) return document
  let changed = false
  const programs = document.programs.map((program) => {
    let next = program
    for (const operation of operations) {
      if (operation.op === 'replaceProgramSource' && operation.programId === program.programId) {
        if (next.document !== operation.source || next.language !== operation.language) {
          next = { ...next, document: operation.source, language: operation.language }
          changed = true
        }
      } else if (operation.op === 'upsertProgram' && operation.program.programId === program.programId) {
        const pending = operation.program
        next = {
          ...next,
          name: pending.name,
          kind: pending.kind,
          language: pending.language,
          document: pending.document,
        }
        changed = true
      }
    }
    return next
  })
  return changed ? { ...document, programs } : document
}
