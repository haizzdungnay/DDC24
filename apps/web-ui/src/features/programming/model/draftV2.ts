import type { ProgrammingDraftDocument, ProgrammingProgram, ProgrammingTaskConfig, ProgrammingVariable } from './types'

/**
 * T59-301 — BE nâng Draft lên document v2: POU nằm ở `objects` (mã nguồn ở
 * `source`), biến nằm trong `locals` của chính POU, và không còn object `task`.
 *
 * Adapter này chiếu v2 về đúng view model mà bốn tab Design đang dùng. Lý do
 * không sửa thẳng từng tab ở đây: đường GHI vẫn là operation v1 (BE có lớp
 * tương thích), nên đổi cả đọc lẫn ghi cùng lúc sẽ là hai thay đổi lớn chồng
 * nhau trong một bước. Việc chuyển tab sang mô hình v2 nguyên bản thuộc
 * `T59-306`; tới lúc đó adapter này biến mất.
 *
 * Document v1 đi qua nguyên trạng — controller cũ chưa nâng cấp vẫn đọc được.
 */
export function toWorkspaceDocument(draft: ProgrammingDraftDocument): ProgrammingDraftDocument {
  const source = draft as unknown as Record<string, unknown>
  if (draft.schemaVersion !== 2 || !Array.isArray(source.objects)) return draft

  const objects = source.objects as Record<string, unknown>[]
  const configs = (Array.isArray(source.programs) ? source.programs : []) as Record<string, unknown>[]
  const configByObject = new Map(configs.map((item) => [String(item.objectId), item]))

  const programs: ProgrammingProgram[] = []
  const variables: ProgrammingVariable[] = []
  for (const object of objects) {
    const objectId = String(object.objectId)
    const config = configByObject.get(objectId)
    /* Chu kỳ đi theo TỪNG POU, không lấy từ `task.periodMs`: trong Project
     * nhiều chu kỳ, giá trị của Task chỉ là chu kỳ của Program đầu tiên, và
     * dùng nó cho POU thứ hai là nói sai về lịch chạy thật. */
    const periodMs = config?.periodMs === undefined ? undefined : Number(config.periodMs)
    const dependencies = Array.isArray(object.dependencies)
      ? (object.dependencies as unknown[]).map((id) => String(id))
      : undefined
    programs.push({
      programId: String(config?.programId ?? objectId),
      objectId,
      hasRuntimeConfig: config !== undefined,
      name: String(object.name ?? ''),
      kind: (object.kind as ProgrammingProgram['kind']) ?? 'PROGRAM',
      language: (object.language as ProgrammingProgram['language']) ?? 'ST',
      document: typeof object.source === 'string' ? object.source : '',
      ...(periodMs === undefined || Number.isNaN(periodMs) ? {} : { periodMs }),
      ...(dependencies === undefined ? {} : { dependencies })
    })
    for (const local of (Array.isArray(object.locals) ? object.locals : []) as Record<string, unknown>[]) {
      variables.push({ ...(local as unknown as ProgrammingVariable), programId: String(local.programId ?? objectId) })
    }
  }

  // v2 không expose thứ tự Task (DDD §4.1). Tab Thực thi chỉ cần chu kỳ; thứ tự
  // hiển thị lấy theo danh sách Program để giao diện không tự bịa một thứ tự
  // mà runtime không thực hiện.
  //
  // `programOrder` CHỈ gồm POU có cấu hình chạy thật (`programs[]` của document).
  // Bản trước lấy toàn bộ `objects`, nên mọi Project có user FUNCTION/
  // FUNCTION_BLOCK gửi lên một id không nằm trong `programs` — backend từ chối
  // CẢ batch (`setTaskCompat`: "programOrder trỏ tới Program không tồn tại là
  // lỗi người gọi") và người dùng thấy `PRG-ERR-REQ-001` khi Xoá Program, Thêm
  // Program hoặc đổi chu kỳ ở tab Thực thi, không kèm lý do nào đọc được.
  // Ràng buộc fail-closed đó của backend là ĐÚNG; chỗ sai là danh sách gửi lên.
  // Chu kỳ là enum đóng ở contract; giá trị lạ rơi về 1000 thay vì ép kiểu, để
  // giao diện không hiển thị một chu kỳ mà profile không cho phép.
  const rawPeriod = Number(configs[0]?.periodMs ?? 1000)
  const periodMs: ProgrammingTaskConfig['periodMs'] =
    rawPeriod === 5000 ? 5000 : rawPeriod === 30000 ? 30000 : 1000
  const library = (source.library ?? {}) as Record<string, unknown>
  return {
    schemaVersion: draft.schemaVersion,
    project: draft.project,
    programs,
    variables,
    bindings: (Array.isArray(source.bindings) ? source.bindings : []) as ProgrammingDraftDocument['bindings'],
    task: {
      taskId: String(library.projectLibraryRevisionId ?? draft.project.projectId),
      periodMs,
      programOrder: programs
        .filter((program) => configByObject.has(String(program.objectId ?? program.programId)))
        .map((program) => program.programId)
    },
    library: {
      profile: String(library.systemProfile ?? ''),
      version: String(library.systemVersion ?? '')
    }
  }
}
