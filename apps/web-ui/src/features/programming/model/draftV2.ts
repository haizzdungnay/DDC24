import type { ProgrammingBinding, ProgrammingDraftDocument, ProgrammingProgram, ProgrammingTaskConfig, ProgrammingVariable } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BINDING_DIRECTIONS = new Set<ProgrammingBinding['direction']>(['READ', 'WRITE', 'READ_WRITE'])
const BINDING_DATA_TYPES = new Set(['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'])
const BINDING_QUALITY_POLICIES = new Set<ProgrammingBinding['qualityPolicy']>(['REQUIRE_GOOD', 'ALLOW_UNCERTAIN', 'FAIL_POLICY'])
const BINDING_FIELDS = new Set([
  'bindingId', 'variableId', 'point', 'direction', 'dataType', 'unit', 'writable', 'qualityPolicy',
  // Hai field owner do backend bổ sung vào document v2. View model Mapping
  // không cần chúng vì Variable là nguồn owner, nhưng adapter phải nhận biết
  // tường minh thay vì coi chúng là field lạ rồi làm rơi Binding hợp lệ.
  'programId', 'variable',
])
const POINT_FIELDS = new Set(['category', 'deviceId', 'pointId'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

/**
 * Thu hẹp collection Binding v2 tại biên đọc. Backend lưu thêm owner
 * `programId/variable`, còn Mapping chỉ tiêu thụ contract typed bền. Chỉ cần
 * một phần tử malformed, cả collection fail-closed thành rỗng: không được dựng
 * một read-back nửa thật/nửa bị bỏ qua rồi báo sai count cho người vận hành.
 */
export function programmingBindingsFromV2(value: unknown): ProgrammingBinding[] {
  if (!Array.isArray(value)) return []
  const result: ProgrammingBinding[] = []
  for (const item of value) {
    const binding = record(item)
    if (!binding || !exactFields(binding, BINDING_FIELDS)
      || typeof binding.bindingId !== 'string' || !UUID.test(binding.bindingId)
      || typeof binding.variableId !== 'string' || !UUID.test(binding.variableId)
      || typeof binding.direction !== 'string' || !BINDING_DIRECTIONS.has(binding.direction as ProgrammingBinding['direction'])
      || typeof binding.dataType !== 'string' || !BINDING_DATA_TYPES.has(binding.dataType)
      || typeof binding.writable !== 'boolean'
      || typeof binding.qualityPolicy !== 'string' || !BINDING_QUALITY_POLICIES.has(binding.qualityPolicy as ProgrammingBinding['qualityPolicy'])
      || (binding.unit !== undefined && (typeof binding.unit !== 'string' || binding.unit.length > 32))) {
      return []
    }
    const point = record(binding.point)
    if (!point || !exactFields(point, POINT_FIELDS)
      || (point.category !== 'LOCAL' && point.category !== 'VP' && point.category !== 'MB_RTU')
      || typeof point.pointId !== 'string' || point.pointId.length < 1 || point.pointId.length > 64
      || (point.category === 'MB_RTU'
        ? typeof point.deviceId !== 'string' || point.deviceId.length < 1 || point.deviceId.length > 64
        : point.deviceId !== undefined)) {
      return []
    }
    result.push({
      bindingId: binding.bindingId,
      variableId: binding.variableId,
      point: {
        category: point.category,
        pointId: point.pointId,
        ...(typeof point.deviceId === 'string' ? { deviceId: point.deviceId } : {}),
      },
      direction: binding.direction as ProgrammingBinding['direction'],
      dataType: binding.dataType,
      ...(typeof binding.unit === 'string' ? { unit: binding.unit } : {}),
      writable: binding.writable,
      qualityPolicy: binding.qualityPolicy as ProgrammingBinding['qualityPolicy'],
    })
  }
  return result
}

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
      ...(dependencies === undefined ? {} : { dependencies }),
      /* `DEV-PROG-004` — chú thích chỉ đi qua khi Draft THẬT SỰ có khoá đó.
         Không có ⇒ trường vắng mặt, để Inspector nói "chưa ghi" thay vì hiện
         một ô rỗng trông như đã ghi rồi xoá. */
      ...(typeof object.description === 'string' ? { description: object.description } : {}),
      ...(typeof object.access === 'string' ? { access: object.access } : {})
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
    bindings: programmingBindingsFromV2(source.bindings),
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
