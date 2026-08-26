import type { ProgrammingRuntimeMonitorState } from '../../api/queries'
import { FBD_DATA_TYPES, type FbdDataType } from '../../fbd/model'
import type { UserPouInterface } from '../../fbd/userPou'
import type {
  ProgrammingDraftDocument,
  ProgrammingDraftObjectV2,
  ProgrammingPouInterface,
  ProgrammingPouInterfacePort,
  ProgrammingProgram,
} from '../../model/types'
import type { StRuntimeOverlayItem, StRuntimeOverlayState } from './StRuntimeValueOverlay'
import { parseCapturedMonotonicNs } from '../../runtime/producerStamp'

const FBD_DATA_TYPE_SET = new Set<string>(FBD_DATA_TYPES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFbdDataType(value: unknown): value is FbdDataType {
  return typeof value === 'string' && FBD_DATA_TYPE_SET.has(value)
}

function readInterfacePort(value: unknown): ProgrammingPouInterfacePort | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string') return null
  return { name: value.name, type: value.type }
}

function readInterfacePorts(value: unknown): ProgrammingPouInterfacePort[] | null {
  if (!Array.isArray(value)) return null
  const ports: ProgrammingPouInterfacePort[] = []
  for (const item of value) {
    const port = readInterfacePort(item)
    if (!port) return null
    ports.push(port)
  }
  return ports
}

function readPouInterface(value: unknown): ProgrammingPouInterface | null {
  if (!isRecord(value)) return null
  const inputs = readInterfacePorts(value.inputs)
  if (!inputs) return null
  const outputs = value.outputs === undefined ? undefined : readInterfacePorts(value.outputs)
  if (value.outputs !== undefined && !outputs) return null
  if (value.returnType !== undefined && typeof value.returnType !== 'string') return null
  return {
    inputs,
    ...(outputs ? { outputs } : {}),
    ...(typeof value.returnType === 'string' ? { returnType: value.returnType } : {}),
  }
}

function readDraftObject(value: unknown): ProgrammingDraftObjectV2 | null {
  if (!isRecord(value)) return null
  if (
    typeof value.objectId !== 'string' ||
    typeof value.name !== 'string' ||
    (value.kind !== 'PROGRAM' && value.kind !== 'FUNCTION' && value.kind !== 'FUNCTION_BLOCK') ||
    (value.language !== 'ST' && value.language !== 'FBD')
  ) return null

  const declaredInterface = value.interface === undefined ? undefined : readPouInterface(value.interface)
  if (value.interface !== undefined && !declaredInterface) return null
  return {
    objectId: value.objectId,
    kind: value.kind,
    name: value.name,
    language: value.language,
    source: value.source,
    ...(declaredInterface ? { interface: declaredInterface } : {}),
  }
}

function typedPorts(ports: readonly ProgrammingPouInterfacePort[]): UserPouInterface['inputs'] | null {
  const result: Array<{ name: string; dataType: FbdDataType }> = []
  for (const port of ports) {
    if (!isFbdDataType(port.type)) return null
    result.push({ name: port.name, dataType: port.type })
  }
  return result
}

/**
 * Chiếu metadata interface của Draft v2 sang palette FBD. Hàm chỉ đọc
 * `objects[].interface`; `source` cố ý không được xem để ST và FBD không có hai
 * bộ phân tích chữ ký có thể trôi khỏi nhau.
 *
 * `excludedObjectId` là POU đang mở. Loại nó khỏi palette chặn người dùng dựng
 * direct recursion ngay tại UI; Core vẫn giữ recursion gate authoritative.
 */
export function userPouInterfacesFromDraft(
  draft: ProgrammingDraftDocument,
  excludedObjectId?: string,
): readonly UserPouInterface[] {
  const root = draft as unknown as Record<string, unknown>
  if (draft.schemaVersion !== 2 || !Array.isArray(root.objects)) return []

  const result: UserPouInterface[] = []
  for (const rawObject of root.objects) {
    const object = readDraftObject(rawObject)
    if (!object || object.objectId === excludedObjectId || object.kind === 'PROGRAM' || !object.interface) continue
    const inputs = typedPorts(object.interface.inputs)
    if (!inputs) continue
    const outputs = object.interface.outputs ? typedPorts(object.interface.outputs) : undefined
    if (object.interface.outputs && !outputs) continue
    const returnType = object.interface.returnType
    if (returnType !== undefined && !isFbdDataType(returnType)) continue

    result.push({
      name: object.name,
      kind: object.kind,
      inputs,
      ...(outputs ? { outputs } : {}),
      ...(returnType ? { returnType } : {}),
    })
  }
  return result
}

function mapMonitorItem(item: NonNullable<ProgrammingRuntimeMonitorState['data']>['items'][number]): StRuntimeOverlayItem {
  return {
    variableId: item.variableId,
    variableName: item.variableName,
    value: item.programValue,
    // Monitor contract dùng null để nói raw value vắng mặt. 0/false là dữ
    // liệu hợp lệ và không được đổi thành false chỉ vì falsy.
    valid: item.programValue !== null && item.programValue !== undefined,
    unit: item.unit,
    quality: item.quality,
    freshness: item.freshness,
    observedAt: item.observedAt || undefined,
  }
}

/**
 * Ghép snapshot monitor theo identity Program. Mọi Program không thuộc kind
 * PROGRAM bị bỏ qua vì FUNCTION/FB không có runtime độc lập. Snapshot chỉ được
 * dùng khi Active Revision của monitor khớp Project; mismatch luôn unavailable
 * thay vì dán dữ liệu đời cũ lên editor hiện tại.
 */
export function runtimeOverlayByProgramId(
  programs: readonly ProgrammingProgram[],
  monitor: ProgrammingRuntimeMonitorState,
  expectedActiveRevisionId: string | null,
): Readonly<Record<string, StRuntimeOverlayState | undefined>> {
  const programIds = programs.filter((program) => program.kind === 'PROGRAM').map((program) => program.programId)
  const overlays: Record<string, StRuntimeOverlayState> = {}

  if (monitor.status === 'loading') {
    for (const programId of programIds) overlays[programId] = { status: 'loading' }
    return overlays
  }

  /* `T59-810` — một snapshot KHÔNG có dấu producer đọc được là một snapshot
   * không biết mình từ đâu tới. Vẽ giá trị của nó lên topology đang hiện là
   * đúng thứ `AC-FBD-010`/`AC-ST-007` tồn tại để cấm, nên nó rơi vào cùng
   * nhánh fail-closed với lệch Revision. */
  const stampUnusable = parseCapturedMonotonicNs(monitor.data?.producer) === null

  if (
    monitor.status !== 'ready' ||
    !monitor.data ||
    stampUnusable ||
    expectedActiveRevisionId === null ||
    monitor.data.activeRevisionId === null ||
    monitor.data.activeRevisionId !== expectedActiveRevisionId
  ) {
    for (const programId of programIds) overlays[programId] = { status: 'unavailable' }
    return overlays
  }

  const grouped = new Map<string, StRuntimeOverlayItem[]>()
  for (const item of monitor.data.items) {
    if (!programIds.includes(item.programId)) continue
    const group = grouped.get(item.programId) ?? []
    group.push(mapMonitorItem(item))
    grouped.set(item.programId, group)
  }
  for (const programId of programIds) {
    const items = grouped.get(programId) ?? []
    items.sort((left, right) => left.variableName.localeCompare(right.variableName) || left.variableId.localeCompare(right.variableId))
    overlays[programId] = { status: 'ready', items }
  }
  return overlays
}
