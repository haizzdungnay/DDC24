import type { ProgrammingSimulationCapability } from '../model/types'
import { roleCan, USER_ROLES } from '../../../shared/auth/capabilities'
import type { UserRole } from '../../../shared/types'

/**
 * `T59-815` / `PGM02-V22-WP-08` — mô hình THUẦN của một phiên SIMULATE.
 *
 * Vì sao tách khỏi React: ba bất biến nguy hiểm nhất của màn hình này đều là
 * quy tắc về DỮ LIỆU, không phải về giao diện, và chúng phải kiểm được mà không
 * cần dựng cây component:
 *
 * 1. **Không có trạng thái lạc quan.** Bấm Run rồi hiện "đang chạy" trước khi
 *    server xác nhận là nói dối về một thứ đang thực thi chương trình. Mọi
 *    chuyển trạng thái ở đây chỉ đến từ read-back.
 * 2. **Không nhận phản hồi cũ.** Phản hồi tới muộn của một lệnh trước có thể
 *    ghi đè trạng thái mới hơn; và sau `RESET`, mẫu của epoch cũ mang đúng hình
 *    dạng hợp lệ nhưng nói về một dòng thời gian đã bị xoá.
 * 3. **Không lẫn nguồn.** Giá trị SIMULATE và giá trị LIVE trông giống hệt nhau
 *    trên màn hình. Chúng được gắn nhãn nguồn ngay trong kiểu dữ liệu để không
 *    có đường nào một giá trị mô phỏng đi vào chỗ dành cho gói đang chạy.
 */

export const SIMULATION_STATES = [
  'PREPARING', 'PAUSED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED', 'STOPPED',
] as const
export type SimulationState = (typeof SIMULATION_STATES)[number]

export const SIMULATION_ACTIONS = ['RUN', 'PAUSE', 'STEP_CYCLE', 'RESET', 'SET_SPEED'] as const
export type SimulationAction = (typeof SIMULATION_ACTIONS)[number]

export const SIMULATION_SPEEDS = [1, 10, 60] as const
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number]

export interface SimulationInputDescriptor {
  observationId: string
  programId: string
  variable: string
  sourceKind: 'VAR_INPUT' | 'READ_BINDING'
  dataType: 'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME'
  unit: string | null
  min: number | null
  max: number | null
  simulationWritable: boolean
}

export interface SimulationObservation {
  observationId: string
  programId: string
  variable: string
  kind: 'INPUT' | 'OUTPUT'
  dataType: SimulationInputDescriptor['dataType']
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'UNAVAILABLE'
  value: unknown
}

export interface SimulationSessionView {
  sessionId: string
  controllerId: string
  projectId: string
  sourceDraftRevisionId: string
  sourceContentSha256: string
  state: SimulationState
  sessionSequence: string
  etag: string
  baseTickMs: number | null
  virtualTimeMs: string
  speed: number
  observationSequence: string
  resetEpoch: string
  createdAt: string
  lastActivityAt: string
  idleExpiresAt: string
  hardExpiresAt: string
  failureCode: string | null
  workerVersion: string | null
  simulationInputs?: SimulationInputDescriptor[]
}

export interface SimulationFrame {
  virtualTimeMs: number
  snapshotSequence: number
  resetEpoch: number
  observations: SimulationObservation[]
}

/**
 * Giá trị hiển thị của MỘT observation.
 *
 * `source` là một phần của kiểu, không phải một chú thích: nhờ vậy không có
 * đường nào một giá trị mô phỏng lọt vào chỗ đọc giá trị Active mà trình biên
 * dịch im lặng.
 */
export interface SimulationValue {
  source: 'SIMULATION'
  observationId: string
  dataType: SimulationInputDescriptor['dataType']
  quality: SimulationObservation['quality']
  /** `null` = chưa có mẫu nào. KHÔNG được hiển thị thành 0. */
  value: unknown
  virtualTimeMs: number
  snapshotSequence: number
}

export type SimulationStatus =
  | { kind: 'IDLE' }
  | { kind: 'UNSUPPORTED'; reason: string }
  | { kind: 'STARTING' }
  | { kind: 'ACTIVE'; session: SimulationSessionView }
  | { kind: 'RECONCILING'; session: SimulationSessionView; reason: string }
  | { kind: 'ERROR'; code: string | null; message: string; session: SimulationSessionView | null }

export interface SimulationSlice {
  status: SimulationStatus
  frame: SimulationFrame | null
  /** Lý do lệnh gần nhất bị từ chối; giữ nguyên trạng thái phiên trước đó. */
  lastDenial: { code: string | null; message: string } | null
  /** Lệnh đang bay — dùng để khoá nút, KHÔNG dùng để đoán kết quả. */
  pending: SimulationAction | 'CREATE' | 'STOP' | 'SET_INPUT' | null
}

export const initialSimulationSlice: SimulationSlice = {
  status: { kind: 'IDLE' },
  frame: null,
  lastDenial: null,
  pending: null,
}

export function isTerminalState(state: SimulationState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'EXPIRED' || state === 'STOPPED'
}

/**
 * Phiên có đang nhận lệnh điều khiển được không.
 *
 * `PREPARING` KHÔNG nhận: worker chưa báo sẵn sàng, và gửi lệnh vào đó sẽ nhận
 * một lỗi mà người dùng không có cách nào hiểu.
 */
export function acceptsCommands(session: SimulationSessionView | null): boolean {
  if (session === null) return false
  return session.state === 'PAUSED' || session.state === 'RUNNING'
}

/**
 * Hành động nào hợp lệ ở trạng thái hiện tại.
 *
 * Trả về danh sách thay vì boolean rời rạc để nút và bàn phím dùng CHUNG một
 * câu trả lời — hai bảng quyết định cho cùng một thứ sẽ lệch nhau, và lúc lệch
 * thì bàn phím thường là bên gọi được thứ giao diện đã khoá.
 */
export function allowedActions(session: SimulationSessionView | null): SimulationAction[] {
  if (!acceptsCommands(session)) return []
  if (session!.state === 'RUNNING') return ['PAUSE', 'SET_SPEED']
  return ['RUN', 'STEP_CYCLE', 'RESET', 'SET_SPEED']
}

export function isSimulationSupported(
  capability: ProgrammingSimulationCapability | undefined | null,
): boolean {
  if (!capability) return false
  if (capability.supported !== true) return false
  // Thiếu bất kỳ mảnh nào của hợp đồng ⇒ coi như không hỗ trợ. FE không suy
  // capability từ việc endpoint hay nút tồn tại (spec §9.2).
  if (!Array.isArray(capability.mutationRoles) || capability.mutationRoles.length === 0) return false
  if (!capability.limits || typeof capability.limits.workerCommandTimeoutMs !== 'number') return false
  return true
}

/**
 * Vai này có được điều khiển phiên không.
 *
 * Phải đồng thời qua capability `simulation.run` của FE và `mutationRoles` do
 * server công bố. Giao của hai nguồn giữ fail-closed khi một phía bị drift.
 */
export function canControlSimulation(
  capability: ProgrammingSimulationCapability | undefined | null,
  role: string | undefined | null,
): boolean {
  if (!isSimulationSupported(capability)) return false
  if (!role) return false
  const normalized = role.toLowerCase() as UserRole
  if (!USER_ROLES.includes(normalized) || !roleCan(normalized, 'simulation.run')) return false
  return capability!.mutationRoles.some((allowed) => allowed.toLowerCase() === normalized)
}

/**
 * Nhận một read-back phiên.
 *
 * Bỏ qua phản hồi thuộc phiên khác, và bỏ qua phản hồi có `sessionSequence` cũ
 * hơn thứ đang giữ: hai lệnh gần nhau có thể về không đúng thứ tự, và bản cũ về
 * sau sẽ kéo giao diện lùi lại một trạng thái đã không còn đúng.
 */
export function acceptSession(
  slice: SimulationSlice,
  session: SimulationSessionView,
): SimulationSlice {
  const current = currentSession(slice)
  if (current && current.sessionId !== session.sessionId) return slice
  if (current && compareSequence(session.sessionSequence, current.sessionSequence) < 0) return slice

  const next: SimulationSlice = {
    ...slice,
    status: { kind: 'ACTIVE', session },
    pending: null,
    lastDenial: null,
  }
  /* Reset xoá dòng thời gian cũ. Giữ lại frame của epoch trước sẽ hiện những
   * con số trông hợp lệ nhưng nói về một lần chạy đã bị xoá. */
  if (slice.frame && slice.frame.resetEpoch !== Number(session.resetEpoch)) {
    next.frame = null
  }
  return next
}

/**
 * Nhận một frame quan sát. Bỏ mẫu lùi hoặc thuộc epoch khác.
 */
export function acceptFrame(slice: SimulationSlice, frame: SimulationFrame): SimulationSlice {
  const session = currentSession(slice)
  if (session && Number(session.resetEpoch) !== frame.resetEpoch) return slice
  if (slice.frame) {
    if (frame.resetEpoch < slice.frame.resetEpoch) return slice
    if (frame.resetEpoch === slice.frame.resetEpoch &&
        frame.snapshotSequence < slice.frame.snapshotSequence) {
      return slice
    }
  }
  return { ...slice, frame }
}

/**
 * Ghi nhận một lệnh bị từ chối.
 *
 * Trạng thái phiên GIỮ NGUYÊN. Một lần từ chối không phải là bằng chứng về
 * trạng thái mới, và biến nó thành FAILED sẽ làm người dùng mất một phiên còn
 * sống chỉ vì gõ sai một giá trị.
 */
export function acceptDenial(
  slice: SimulationSlice,
  denial: { code: string | null; message: string },
): SimulationSlice {
  return { ...slice, pending: null, lastDenial: denial }
}

export function currentSession(slice: SimulationSlice): SimulationSessionView | null {
  switch (slice.status.kind) {
    case 'ACTIVE':
    case 'RECONCILING':
      return slice.status.session
    case 'ERROR':
      return slice.status.session
    default:
      return null
  }
}

/**
 * So sánh hai sequence dạng CHUỖI thập phân.
 *
 * Không đổi sang `Number`: đây là uint64 và JavaScript mất chính xác từ 2^53.
 * Một sequence bị làm tròn làm phép so sánh sai theo cách không ai nhìn thấy.
 */
export function compareSequence(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/, '')
  const b = right.replace(/^0+(?=\d)/, '')
  if (a.length !== b.length) return a.length - b.length
  return a === b ? 0 : (a < b ? -1 : 1)
}

/**
 * Bảng giá trị theo `observationId` cho lớp overlay.
 *
 * `quality` khác `GOOD` giữ nguyên giá trị server gửi kèm nhãn chất lượng —
 * không thay bằng 0 và không ẩn đi: một ô trống nói "chưa có mẫu", còn số 0 nói
 * "đo được 0", và trộn hai thứ đó là kiểu sai nguy hiểm nhất ở màn hình này.
 */
export function simulationValuesByObservation(
  frame: SimulationFrame | null,
): Readonly<Record<string, SimulationValue>> {
  if (!frame) return {}
  const values: Record<string, SimulationValue> = {}
  for (const observation of frame.observations) {
    values[observation.observationId] = {
      source: 'SIMULATION',
      observationId: observation.observationId,
      dataType: observation.dataType,
      quality: observation.quality,
      value: observation.quality === 'UNAVAILABLE' ? null : observation.value,
      virtualTimeMs: frame.virtualTimeMs,
      snapshotSequence: frame.snapshotSequence,
    }
  }
  return values
}

export interface InputValidation {
  ok: boolean
  /** Mã lý do ổn định để test và i18n bám vào, không phải câu chữ. */
  reason: 'OK' | 'NOT_WRITABLE' | 'TYPE' | 'RANGE' | 'EMPTY' | 'NOT_FINITE'
}

/**
 * Kiểm giá trị input ở client cho TIỆN, không phải để thay server.
 *
 * Server vẫn là authority và vẫn phải từ chối sai kiểu/đơn vị/miền (spec §9.5).
 * Việc kiểm ở đây chỉ để người dùng biết ngay, và để một lần gõ nhầm không tốn
 * một vòng mạng — nó không được nới lỏng bất cứ thứ gì server siết.
 */
export function validateSimulationInput(
  descriptor: SimulationInputDescriptor | undefined,
  raw: string,
): InputValidation {
  if (!descriptor || !descriptor.simulationWritable) return { ok: false, reason: 'NOT_WRITABLE' }
  const text = raw.trim()
  if (text === '') return { ok: false, reason: 'EMPTY' }

  if (descriptor.dataType === 'BOOL') {
    const normalized = text.toUpperCase()
    return normalized === 'TRUE' || normalized === 'FALSE' || normalized === '0' || normalized === '1'
      ? { ok: true, reason: 'OK' }
      : { ok: false, reason: 'TYPE' }
  }

  const numeric = Number(text)
  if (!Number.isFinite(numeric)) return { ok: false, reason: 'NOT_FINITE' }
  if (descriptor.dataType !== 'REAL' && !Number.isInteger(numeric)) {
    return { ok: false, reason: 'TYPE' }
  }
  if (descriptor.min !== null && numeric < descriptor.min) return { ok: false, reason: 'RANGE' }
  if (descriptor.max !== null && numeric > descriptor.max) return { ok: false, reason: 'RANGE' }
  return { ok: true, reason: 'OK' }
}

/** Chuyển chuỗi người dùng gõ thành giá trị typed gửi lên server. */
export function encodeSimulationInput(
  descriptor: SimulationInputDescriptor,
  raw: string,
): boolean | number {
  const text = raw.trim()
  if (descriptor.dataType === 'BOOL') {
    const normalized = text.toUpperCase()
    return normalized === 'TRUE' || normalized === '1'
  }
  return Number(text)
}

/**
 * `T59-816` / `PGM02-V22-WP-06-R3` — chiếu khung mô phỏng thành dòng Watch của
 * workbench dùng chung.
 *
 * Vì sao đi qua `presentStRuntimeValue` thay vì tự định dạng: luật "giá trị
 * không đọc được KHÔNG BAO GIỜ hiện thành 0" chỉ được viết một lần, ở đó. Một
 * bản định dạng thứ hai cho mô phỏng là một bản để lệch — và lệch theo đúng
 * hướng nguy hiểm nhất, vì người dùng đang thử một thay đổi trước khi đưa nó ra
 * thiết bị thật.
 *
 * `quality` của mô phỏng dùng chung bảng với runtime: worker trả `GOOD` cho giá
 * trị đã tính, `UNAVAILABLE` khi chưa có. Không ánh xạ lại tên ở đây.
 */
export function simulationWatchRows(
  frame: SimulationFrame | null,
): { observationId: string; name: string; value: unknown; quality: string; dataType: string }[] {
  if (!frame) return []
  return frame.observations.map((observation) => ({
    observationId: observation.observationId,
    /* Tên hiển thị bỏ tiền tố Program: khay Watch đã nói POU nào đang mở, và
     * `Fast.Setpoint` lặp lại "Fast" trên mọi dòng chỉ làm hẹp cột giá trị. */
    name: observation.observationId.includes('.')
      ? observation.observationId.slice(observation.observationId.indexOf('.') + 1)
      : observation.observationId,
    value: observation.quality === 'UNAVAILABLE' ? null : observation.value,
    quality: observation.quality,
    dataType: observation.dataType,
  }))
}
