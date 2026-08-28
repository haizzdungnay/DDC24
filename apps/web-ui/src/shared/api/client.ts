import { API_ORIGIN, IS_DEMO } from '../config'
import { createUuid } from '../crypto'
import {
  ackDemoAlarm,
  createDemoUserAccount,
  deleteDemoUserAccount,
  getDemoConfigDevice,
  putDemoConfigDevice,
  forceDemoPoint,
  getAiInputConfigs,
  getDemoUserAccounts,
  setDemoUserRole,
  getAlarmSettings as getDemoAlarmSettings,
  getDemoAlarmHistory,
  getDemoAlarms,
  getDemoChannels,
  getDemoHealth,
  getDemoNetwork,
  getDemoOutputs,
  getDemoPoints,
  getDemoTimeConfig,
  getDemoTimeStatus,
  getDemoVirtualPoints,
  getUserParams as getDemoUserParams,
  deleteDemoVirtualPoint,
  putDemoAiInputs,
  putDemoTimeConfig,
  putAlarmSettings as putDemoAlarmSettings,
  putDemoOutputs,
  putUserParams as putDemoUserParams,
  putDemoVirtualPoint,
  returnDemoAlarm,
  runDemoCommissioning,
  suppressDemoAlarm,
  updateDemoPointConfig
} from '../demo/simulator'
import { USER_ROLES } from '../auth/capabilities'
import { ApiError, isDigitalContact, type AiInputConfig, type AiSignalType, type Alarm, type AlarmHistoryEntry, type AlarmHistoryQuery, type AlarmEstimateResult, type AlarmMetrics, type AlarmSetting, type AlarmSimulateResult, type AoEngineeringUnit, type AoSignalMode, type ApiValidationDetail, type CommissioningTestResult, type ConfigDevice, type ConfigPutResult, type CurrentUser, type DoSafeState, type HealthResponse, type HistorianConfig, type HistorianConfigUpdate, type HistorianPolicy, type IoChannel, type ModbusApplyResult, type ModbusBus, type ModbusBusConfigInput, type ModbusBusInfo, type ModbusCandidate, type ModbusConfigLifecycle, type ModbusConfigState, type ModbusDiffEntry, type ModbusEventItem, type ModbusImportError, type ModbusMappingResponse, type ModbusOverview, type ModbusPortCapability, type ModbusProbeResult, type ModbusRTUDevice, type ModbusRTUDiagnostics, type ModbusFramesResponse, type ModbusRTUPoint, type ModbusTemplate, type NetcfgActive, type NetcfgCandidate, type NetcfgResponse, type NetcfgTransactionAction, type NetcfgTransactionRequest, type NetworkCheckResponse, type NetworkData, type OutputsConfig, type Point, type ScheduleObject, type ScheduleValidationResult, type ScheduleSimulateRequest, type ScheduleSimulateResult, type SchedulePublishRequest, type SchedulePublishResult, type ScheduleRevisionInfo, type ScheduleRuntimeState, type ScheduleAuditEntry, type ScheduleEffectiveResponse, type TimeConfig, type TimeConfigUpdate, type TimeStatus, type TrendSample, type SystemHistoryResponse, type UserAccessResponse, type UserAccessRow, type VirtualPointUsage, type UserAccount, type UserParamsConfig, type UserRole, type VirtualPoint } from '../types'
import { isGenericPointLabel, normalizeHealth, nowIso, uiNode } from '../utils'
import { normalizePoint, pointRecordsFrom } from './pointNormalizer'
import { displayPointName } from './pointTags'

export { normalizePoint, pointRecordsFrom } from './pointNormalizer'

type AuthHeaderProvider = () => Record<string, string>
let authHeaderProvider: AuthHeaderProvider = () => ({})

const base = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`
// Chỉ dùng cho simulator trong phiên hiện tại. Live metadata luôn do BE/Core sở hữu.
const demoPointConfigOverrides: Record<string, PointConfigPatch> = {}
let demoNetcfgResponse: NetcfgResponse | null = null

function netmaskPrefix(netmask: string): number {
  return netmask.split('.').reduce((count, part) => {
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) return count
    return count + value.toString(2).replace(/0/g, '').length
  }, 0)
}

function demoNetcfgActive(): NetcfgActive {
  const network = getDemoNetwork().northbound
  return {
    interface: 'eth0',
    link: network.bmsLink === 'online' ? 'up' : 'down',
    mode: network.dhcp ? 'dhcp' : 'static',
    ipv4: network.ip,
    prefixLength: netmaskPrefix(network.subnet),
    gateway: network.gateway
  }
}

function candidateAsActive(candidate: NetcfgCandidate): NetcfgActive {
  return {
    interface: candidate.interface,
    link: 'up',
    mode: candidate.mode,
    ipv4: candidate.ipv4 ?? '',
    prefixLength: netmaskPrefix(candidate.netmask ?? ''),
    gateway: candidate.gateway ?? ''
  }
}

function runDemoNetworkTransaction(action: NetcfgTransactionAction, payload: NetcfgTransactionRequest): NetcfgResponse {
  const previous = demoNetcfgResponse ?? {
    version: 1,
    requestId: 'demo-status',
    result: 'accepted',
    reasonCode: 'OK',
    state: 'idle',
    active: demoNetcfgActive()
  }
  const requestId = `demo-${action}`
  if ((action === 'validate' || action === 'stage') && payload.candidate) {
    demoNetcfgResponse = {
      ...previous,
      requestId,
      result: 'accepted',
      reasonCode: 'OK',
      state: action === 'stage' ? 'staged' : previous.state,
      transactionId: action === 'stage' ? 'demo-tx-1' : previous.transactionId,
      pending: payload.candidate
    }
  } else if (action === 'apply' && previous.pending) {
    demoNetcfgResponse = { ...previous, requestId, state: 'awaiting_confirmation', rollbackRemainingS: 120, active: candidateAsActive(previous.pending) }
  } else if (action === 'confirm') {
    const { pending: _pending, rollbackRemainingS: _remaining, ...confirmed } = previous
    demoNetcfgResponse = { ...confirmed, requestId, state: 'confirmed' }
  } else if (action === 'rollback') {
    const { pending: _pending, rollbackRemainingS: _remaining, ...rolledBack } = previous
    demoNetcfgResponse = { ...rolledBack, requestId, state: 'rolled_back', active: demoNetcfgActive() }
  }
  return demoNetcfgResponse ?? previous
}

type ApiRequestInit = RequestInit & { suppressAuthExpired?: boolean; timeoutMs?: number }

/**
 * Trần thời gian mặc định cho một request.
 *
 * Vì sao bắt buộc: `fetch` KHÔNG tự hết giờ. Trên trang mạng, ngay sau khi đổi địa
 * chỉ IP thì kết nối tới địa chỉ cũ có thể treo — không phản hồi mà cũng không báo
 * lỗi. Khi đó nút "Giữ thay đổi" quay vô hạn, nút "Hoàn tác ngay" bị khoá theo, và
 * người vận hành không còn đường nào ngoài ngồi chờ auto-rollback. Hết giờ sớm và
 * báo lỗi rõ ràng thì họ còn bấm lại được.
 */
const defaultRequestTimeoutMs = 15_000
type PointConfigPatch = { name?: string; unit?: string; trendEnabled?: boolean }
type AlarmDurationChoice = { permanent: boolean; durationS?: number }

export const POINT_UNIT_OPTIONS = [
  { value: '', label: '0 = No units shown' },
  { value: '%', label: '1 = % Percentage' },
  { value: 'C', label: '2 = °C / °F Degrees Celsius or Degrees Fahrenheit' },
  { value: 'Pa', label: '3 = P Pascals' }
] as const

export function setAuthHeaderProvider(provider: AuthHeaderProvider) {
  authHeaderProvider = provider
}

const demoHistorianPolicies = new Map<string, HistorianPolicy>()
let demoHistorianRevision = 0

function getDemoHistorianConfig(): HistorianConfig {
  const now = new Date()
  for (const point of getDemoPoints()) {
    if (point.kind !== 'UI' && point.kind !== 'AO' && point.kind !== 'DO' && point.kind !== 'virtual') continue
    if (!demoHistorianPolicies.has(point.id)) {
      demoHistorianPolicies.set(point.id, {
        pointId: point.id,
        generation: 1,
        dbLoggingEnabled: false,
        dbInterval: '15s',
        retentionDays: 180,
        maxRetentionDays: 180,
        hotCacheEnabled: true,
        hotCacheHours: 48,
        startAtUtc: now.toISOString(),
        state: 'off',
        health: 'demo'
      })
    }
  }
  const points = [...demoHistorianPolicies.values()].map((policy) => {
    if (!policy.dbLoggingEnabled) return { ...policy, state: 'off' as const }
    const start = Date.parse(policy.startAtUtc)
    return { ...policy, state: Number.isFinite(start) && start > now.getTime() ? 'scheduled' as const : 'recording' as const }
  })
  const enabled = points.filter((point) => point.dbLoggingEnabled).length
  return {
    revision: demoHistorianRevision,
    serverNowUtc: now.toISOString(),
    points,
    capacity: { enabledPoints: enabled, reservedBytes: enabled * 1024 * 1024, budgetBytes: 2 * 1024 * 1024 * 1024, freeBytes: 2 * 1024 * 1024 * 1024, requiredFreeBytes: 512 * 1024 * 1024 },
    namespaceRevision: 0,
    retentionMaxDaysByInterval: { '1s': 30, '3s': 60, '5s': 90, '15s': 180, '30s': 365, '1m': 730, '3m': 1095, '5m': 1460, '15m': 1825, '30m': 2555, '60m': 3650 }
  }
}

function putDemoHistorianConfig(update: HistorianConfigUpdate): HistorianConfig {
  if (update.baseRevision !== demoHistorianRevision) throw new ApiError('historian policy revision conflict', 409, [{ path: '$', reason: 'config_conflict', message: 'Reload the current logging policy before saving.' }])
  const known = new Set(getDemoHistorianConfig().points.map((point) => point.pointId))
  for (const patch of update.points) {
    if (!known.has(patch.pointId)) throw new ApiError(`unknown historian point ${patch.pointId}`, 400, [{ path: 'points', reason: 'point_unknown', message: 'Point is not available.' }])
    const current = demoHistorianPolicies.get(patch.pointId)
    if (!current) continue
    demoHistorianPolicies.set(patch.pointId, { ...current, generation: patch.generation, dbLoggingEnabled: patch.dbLoggingEnabled, dbInterval: patch.dbInterval, retentionDays: patch.retentionDays, startAtUtc: patch.startAtUtc ?? new Date().toISOString() })
  }
  demoHistorianRevision += 1
  return getDemoHistorianConfig()
}

export async function requestJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { suppressAuthExpired, timeoutMs, ...fetchInit } = init
  const headers = new Headers(fetchInit.headers)
  for (const [key, value] of Object.entries(authHeaderProvider())) headers.set(key, value)
  if (fetchInit.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const limitMs = timeoutMs ?? defaultRequestTimeoutMs
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), limitMs)
  // Giữ nguyên signal của caller: huỷ từ caller vẫn phải huỷ được request.
  if (fetchInit.signal) {
    if (fetchInit.signal.aborted) controller.abort()
    else fetchInit.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...fetchInit, headers, credentials: 'include', signal: controller.signal })
  } catch (err) {
    // Phân biệt "hết giờ" với lỗi mạng khác: người dùng cần biết thiết bị không trả
    // lời chứ không phải trình duyệt gặp lỗi lạ.
    if (err instanceof DOMException && err.name === 'AbortError' && !fetchInit.signal?.aborted) {
      throw new ApiError(`Thiết bị không phản hồi sau ${Math.round(limitMs / 1000)} giây`, 0, [])
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
  if (!suppressAuthExpired && response.status === 401) {
    window.dispatchEvent(new CustomEvent('mkddc:auth-expired'))
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    /* `T57-3.17` (`ADR-047`): backend chặn mọi endpoint của một phiên đang bị
       buộc đổi mật khẩu. Không nhận ra tín hiệu này thì giao diện chỉ hiện một
       chuỗi lỗi quyền, và người dùng đi tìm quyền bị thiếu thay vì đổi mật khẩu. */
    if (response.status === 403 && body.includes('password_change_required')) {
      window.dispatchEvent(new CustomEvent('mkddc:password-change-required'))
    }
    let message = body || `${response.status} ${response.statusText}`
    let details: ApiValidationDetail[] = []
    try {
      const parsed = JSON.parse(body) as { error?: unknown; details?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
      if (Array.isArray(parsed.details)) details = parsed.details.filter(isApiValidationDetail)
    } catch {
      // Preserve non-JSON error text.
    }
    throw new ApiError(message, response.status, details)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/** Như `requestJson` nhưng trả `Response` thô — dùng cho export CSV/JSON, nơi
 *  nội dung không phải JSON và phải giữ nguyên byte để người dùng tải về. */
/** Chuẩn hoá danh sách trả về từ backend.
 *
 * Go tuần tự hoá nil slice thành `null`, nên một endpoint "không có bản ghi
 * nào" trả `null` chứ không phải `[]`. Mọi `.map`/`.filter`/`.length` phía FE
 * sẽ nổ TypeError, và vì React unmount cả cây khi có exception chưa bắt, hậu
 * quả là TRANG TRẮNG chứ không phải một bảng rỗng (sự cố board 2026-08-06).
 * Chắn ở đúng một chỗ — biên vào — thay vì rải `?? []` khắp component. */
function asList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

export async function requestRaw(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { suppressAuthExpired, timeoutMs, ...fetchInit } = init
  const headers = new Headers(fetchInit.headers)
  for (const [key, value] of Object.entries(authHeaderProvider())) headers.set(key, value)
  const limitMs = timeoutMs ?? defaultRequestTimeoutMs
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), limitMs)
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...fetchInit, headers, credentials: 'include', signal: controller.signal
    })
  } finally {
    window.clearTimeout(timer)
  }
  if (!suppressAuthExpired && response.status === 401) {
    window.dispatchEvent(new CustomEvent('mkddc:auth-expired'))
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(body || `${response.status} ${response.statusText}`, response.status, [])
  }
  return response
}

function readPointConfigOverrides(): Record<string, PointConfigPatch> {
  return demoPointConfigOverrides
}

function savePointConfigOverride(id: string, config: PointConfigPatch): PointConfigPatch & { id: string } {
  const overrides = readPointConfigOverrides()
  const current = overrides[id] ?? {}
  const next: PointConfigPatch = { ...current }
  if (Object.prototype.hasOwnProperty.call(config, 'name')) next.name = config.name
  if (Object.prototype.hasOwnProperty.call(config, 'unit')) next.unit = config.unit
  if (Object.prototype.hasOwnProperty.call(config, 'trendEnabled')) next.trendEnabled = config.trendEnabled
  overrides[id] = next
  return { id, ...next }
}

function applyAiInputConfigOverrides(configs: AiInputConfig[]): AiInputConfig[] {
  const overrides = readPointConfigOverrides()
  return configs.map((config) => {
    const id = uiNode(config.channel)
    const override = overrides[id]
    if (!override) return config
    const genericName = override.name !== undefined && isGenericPointLabel(id, override.name)
    return {
      ...config,
      ...(override.name !== undefined && !genericName ? { label: override.name } : {}),
      ...(override.unit !== undefined && !genericName ? { unit: aiUnitFromPointUnit(override.unit) } : {})
    }
  })
}

function applyAiInputPointNames(configs: AiInputConfig[], points: Point[]): AiInputConfig[] {
  const pointsById = new Map(points.map((point) => [point.id, point]))
  return applyAiInputConfigOverrides(configs.map((config) => {
    const point = pointsById.get(uiNode(config.channel))
    if (!point) return config
    return {
      ...config,
      label: point.name,
      unit: aiUnitFromPointUnit(point.unit)
    }
  }))
}

function saveAiInputPointConfigOverrides(configs: AiInputConfig[]) {
  configs.forEach((config) => {
    savePointConfigOverride(uiNode(config.channel), { name: config.label, unit: pointUnitFromAiUnit(config.unit) })
  })
}

export function applyDemoPointMetadata(points: Point[]): Point[] {
  const demoById = new Map(getDemoPoints().map((point) => [point.id, point]))
  return points.map((point) => {
    const demo = demoById.get(point.id)
    if (!demo) return point
    const genericName = isGenericPointLabel(point.id, point.name)
    return {
      ...point,
      ...(genericName ? { name: demo.name, unit: demo.unit, sensorType: demo.sensorType } : {}),
      ...(!genericName && point.unit === undefined && demo.unit !== undefined ? { unit: demo.unit } : {}),
      ...(!genericName && point.sensorType === undefined && demo.sensorType !== undefined ? { sensorType: demo.sensorType } : {}),
      ...(point.trend === undefined && demo.trend !== undefined ? { trend: [...demo.trend] } : {})
    }
  })
}

export function applyPointConfigOverrides(points: Point[]): Point[] {
  const overrides = readPointConfigOverrides()
  return points.map((point) => {
    const override = overrides[point.id]
    if (!override) return point
    const genericName = override.name !== undefined && isGenericPointLabel(point.id, override.name)
    return {
      ...point,
      ...(override.name !== undefined && !genericName ? { name: override.name } : {}),
      ...(override.unit !== undefined && !genericName ? { unit: override.unit } : {})
    }
  })
}

export function aiUnitFromPointUnit(unit: unknown): number {
  return unitFromIo(unit)
}

export function pointUnitFromAiUnit(unit: number): string {
  if (unit === 1) return '%'
  if (unit === 2) return 'C'
  if (unit === 3) return 'Pa'
  return ''
}

function normalizeHealthResponse(raw: Record<string, unknown>): HealthResponse {
  const servicesRaw = (raw.services ?? {}) as Record<string, Record<string, unknown>>
  const services = Object.fromEntries(Object.entries(servicesRaw).map(([key, value]) => [key, {
    status: normalizeHealth(value.status),
    uptime_s: typeof value.uptime_s === 'number' ? value.uptime_s : undefined,
    last_scan_ms: typeof value.last_scan_ms === 'number' ? value.last_scan_ms : undefined
  }]))

  return {
    overall: normalizeHealth(raw.overall ?? raw.status),
    services,
    cpuPercent: numberFrom(raw.cpuPercent ?? raw.cpu_percent),
    cpuClockMhz: numberFrom(raw.cpuClockMhz ?? raw.cpu_clock_mhz ?? raw.cpuFreqMhz ?? raw.cpu_freq_mhz),
    ramPercent: numberFrom(raw.ramPercent ?? raw.ram_percent),
    ramUsedMb: numberFrom(raw.ramUsedMb ?? raw.ram_used_mb),
    ramTotalMb: numberFrom(raw.ramTotalMb ?? raw.ram_total_mb),
    tempC: numberFrom(raw.tempC ?? raw.temp_c),
    uptimeS: numberFrom(raw.uptimeS ?? raw.uptime_s),
    firmware: stringFrom(raw.firmware),
    deviceName: stringFrom(raw.deviceName ?? raw.device_name),
    deviceIp: stringFrom(raw.deviceIp ?? raw.device_ip),
    bacnetDeviceId: stringFrom(raw.bacnetDeviceId ?? raw.bacnet_device_id)
  }
}

function normalizeSystemStatus(raw: Record<string, unknown>): HealthResponse {
  const iop = (raw.iop ?? {}) as Record<string, unknown>
  const _scan = (raw.scan ?? {}) as Record<string, unknown>
  const versions = (raw.versions ?? {}) as Record<string, unknown>
  const ramPercent = numberFrom(raw.ram_percent)
  const ramUsedMb = numberFrom(raw.ram_used_mb)
  const ramTotalMb = numberFrom(raw.ram_total_mb)
  const finalRamPercent = ramPercent ?? (ramUsedMb !== undefined && ramTotalMb !== undefined && ramTotalMb > 0 ? round2((ramUsedMb / ramTotalMb) * 100) : undefined)

  const servicesRaw = (raw.services ?? {}) as Record<string, Record<string, unknown>>
  const services = Object.fromEntries(Object.entries(servicesRaw).map(([key, value]) => [key, {
    status: normalizeHealth(value.status),
    uptime_s: typeof value.uptime_s === 'number' ? value.uptime_s : undefined,
    last_scan_ms: typeof value.last_scan_ms === 'number' ? value.last_scan_ms : undefined
  }]))

  return {
    overall: normalizeHealth(iop.status ?? raw.overall ?? 'ok'),
    cpuPercent: numberFrom(raw.cpu_percent ?? raw.cpuPercent),
    cpuClockMhz: numberFrom(raw.cpu_clock_mhz ?? raw.cpuClockMhz ?? raw.cpu_freq_mhz ?? raw.cpuFreqMhz),
    ramPercent: finalRamPercent,
    ramUsedMb,
    ramTotalMb,
    tempC: numberFrom(raw.tempC ?? raw.temp_c),
    uptimeS: numberFrom(raw.uptime_s ?? raw.uptimeS),
    firmware: stringFrom(versions.web ?? versions.core ?? versions.iobus),
    deviceIp: stringFrom(raw.deviceIp ?? raw.device_ip),
    deviceMac: stringFrom(raw.deviceMac ?? raw.device_mac),
    deviceName: stringFrom(raw.deviceName ?? raw.device_name),
    description: stringFrom(raw.description),
    location: stringFrom(raw.location),
    systemTime: stringFrom(raw.systemTime ?? raw.system_time),
    services,
  }
}

function normalizeUserAccount(raw: Record<string, unknown> | unknown): UserAccount {
  const record = (raw ?? {}) as Record<string, unknown>
  const role = String(record.role ?? '')
  return {
    username: String(record.username ?? ''),
    /* Cùng nguyên tắc fail-closed như F-07 ở AuthProvider: một role lạ hoặc
       thiếu phải rơi về quyền THẤP NHẤT, không được mặc định thành admin.
    
       `WEB-RBAC-001` — danh sách vai hợp lệ đọc từ `USER_ROLES` thay vì viết
       tay. Bản viết tay cũ (`'admin' || 'operator'`) không biết `engineer`, nên
       một tài khoản engineer hiện ra trong trang Quản lý người dùng dưới nhãn
       `viewer`: người quản trị đang rà soát quyền đọc được một con số SAI về
       chính hệ thống mình quản. Fail-closed vẫn giữ nguyên — vai không có
       trong bảng vẫn rơi về `viewer`. */
    role: (USER_ROLES as readonly string[]).includes(role) ? (role as UserRole) : 'viewer'
  }
}

function normalizeUserAccessRow(raw: unknown): UserAccessRow {
  const record = (raw ?? {}) as Record<string, unknown>
  const base = normalizeUserAccount(record)
  const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
  return {
    ...base,
    mustChangePassword: Boolean(record.mustChangePassword),
    lastLoginAt: text(record.lastLoginAt),
    lastLoginRemote: text(record.lastLoginRemote),
    lastFailedLoginAt: text(record.lastFailedLoginAt),
    activeSessions: Number.isFinite(Number(record.activeSessions)) ? Number(record.activeSessions) : 0
  }
}

function normalizeAlarm(raw: Record<string, unknown>): Alarm {
  const id = String(raw.id ?? raw.alarmId ?? raw.alarm_id ?? createUuid())
  const pointId = raw.pointId ?? raw.point_id
  const source = raw.source ?? pointId ?? raw.device ?? 'SYSTEM'
  const acknowledged = raw.acknowledged ?? raw.ack ?? raw.is_acknowledged
  const triggerLevel = triggerLevelFrom(raw.triggerLevel ?? raw.trigger_level)
  const threshold = raw.threshold ?? raw.thresholdValue ?? raw.threshold_value
  return {
    id,
    time: String(raw.time ?? raw.ts ?? raw.timestamp ?? raw.createdAt ?? raw.created_at ?? nowIso()),
    severity: severityFrom(raw.severity ?? raw.priority ?? raw.level),
    status: alarmStatusFrom(raw.status ?? raw.state ?? acknowledged),
    message: String(raw.message ?? raw.name ?? raw.type ?? `Alarm ${id}`),
    source: String(source),
    value: String(raw.value ?? raw.currentValue ?? raw.current_value ?? raw.triggerValue ?? raw.trigger_value ?? ''),
    detail: String(raw.detail ?? raw.description ?? raw.reason ?? raw.condition ?? ''),
    active: typeof raw.active === 'boolean' ? raw.active : undefined,
    returnable: typeof raw.returnable === 'boolean' ? raw.returnable : undefined,
    ...(triggerLevel ? { triggerLevel } : {}),
    ...(threshold !== undefined && threshold !== null ? { threshold: String(threshold) } : {})
  }
}

function alarmHistoryParams(filters: AlarmHistoryQuery = {}): string {
  const params = new URLSearchParams()
  params.set('limit', String(filters.limit ?? 20))
  if (filters.text?.trim()) params.set('text', filters.text.trim())
  if (filters.alarm?.trim()) params.set('alarm', filters.alarm.trim())
  if (filters.name?.trim()) params.set('name', filters.name.trim())
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.event?.length) params.set('event', filters.event.join(','))
  if (filters.severity) params.set('severity', filters.severity)
  if (filters.status) params.set('status', filters.status)
  return params.toString()
}

function normalizeAlarmHistory(raw: Record<string, unknown>): AlarmHistoryEntry {
  const eventId = stringFrom(raw.eventId ?? raw.event_id)
  const event = stringFrom(raw.event ?? raw.type ?? raw.eventType ?? raw.event_type)
  const user = stringFrom(raw.user)
  const acknowledgedAt = stringFrom(raw.acknowledgedAt ?? raw.acknowledged_at ?? raw.ackedAt ?? raw.acked_at)
  const ackedBy = stringFrom(raw.ackedBy ?? raw.acked_by ?? raw.ackUser ?? raw.ack_user)
  const clearedAt = stringFrom(raw.clearedAt ?? raw.cleared_at ?? raw.resolvedAt ?? raw.resolved_at)
  return {
    ...normalizeAlarm(raw),
    ...(eventId ? { eventId } : {}),
    ...(event ? { event } : {}),
    ...(user ? { user } : {}),
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
    ...(ackedBy ? { ackedBy } : {}),
    ...(clearedAt ? { clearedAt } : {}),
    ...(isAlarmSetting(raw.before) ? { before: raw.before } : {}),
    ...(isAlarmSetting(raw.after) ? { after: raw.after } : {})
  }
}

function normalizeTrendSample(raw: Record<string, unknown>): TrendSample {
  const timestamp = trendTimestamp(raw.time ?? raw.ts ?? raw.timestamp)
  const sample: TrendSample = { time: formatTrendTime(raw.time ?? raw.ts ?? raw.timestamp) }
  if (timestamp !== null) sample.__ts = timestamp
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'time' || key === 'ts' || key === 'timestamp') continue
    if (typeof value === 'number' && Number.isFinite(value)) sample[normalizeTrendPointKey(key)] = value
  }
  return sample
}



function normalizeTrendPointKey(key: string): string {
  const match = key.trim().match(/^([A-Z]+)[-_]?(\d+)$/i)
  if (!match) return key
  const prefix = match[1].toUpperCase()
  const channel = Number(match[2])
  if (!Number.isFinite(channel) || channel <= 0) return key
  if (prefix === 'UI' || prefix === 'AI') return uiNode(channel)
  if (prefix === 'DI' || prefix === 'BI') return uiNode(channel + 8)
  if (prefix === 'AO' || prefix === 'DO') return `${prefix}-${String(channel).padStart(2, '0')}`
  return key
}

function severityFrom(value: unknown): Alarm['severity'] {
  const raw = String(value ?? 'info').toLowerCase()
  if (raw === 'critical' || raw === 'high' || raw === 'medium' || raw === 'low') return raw
  return 'info'
}

function alarmStatusFrom(value: unknown): Alarm['status'] {
  if (value === true) return 'acked'
  if (value === false) return 'unack'
  const raw = String(value ?? 'active').toLowerCase()
  if (raw === 'unack' || raw === 'acked' || raw === 'cleared' || raw === 'shelved') return raw
  if (raw === 'acknowledged') return 'acked'
  if (raw === 'unacknowledged') return 'unack'
  if (raw === 'clear' || raw === 'resolved' || raw === 'normal') return 'cleared'
  return 'active'
}

function triggerLevelFrom(value: unknown): string | undefined {
  const raw = String(value ?? '').trim().toUpperCase()
  return raw === 'HH' || raw === 'H' || raw === 'L' || raw === 'LL' || raw === 'RUNTIME' ? raw : undefined
}

function isAlarmSetting(value: unknown): value is AlarmSetting {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string'
}

function normalizeCommissioningResult(raw: Record<string, unknown>, pointId: string): CommissioningTestResult {
  const result = String(raw.result ?? 'failed').toLowerCase()
  return {
    result: result === 'passed' || result === 'running' ? result : 'failed',
    pointId: String(raw.pointId ?? raw.point_id ?? pointId),
    appliedValue: raw.appliedValue as CommissioningTestResult['appliedValue'] ?? raw.applied_value as CommissioningTestResult['appliedValue'],
    message: String(raw.message ?? raw.detail ?? 'Commissioning test completed'),
    scanMs: numberFrom(raw.scanMs ?? raw.scan_ms)
  }
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isApiValidationDetail(value: unknown): value is ApiValidationDetail {
  return typeof value === 'object' && value !== null && typeof (value as { path?: unknown }).path === 'string'
}

export type IoUiConfig = {
  ch?: number
  tag?: string
  type?: string
  unit?: string
  scale_lo?: number
  scale_hi?: number
  name?: string
  note?: string
  enabled?: boolean
  invert?: boolean
  range_mult?: number
  filter_samples?: number
  sensor_cal?: number
  math_func?: number
}

type IoConfig = {
  ui?: IoUiConfig[]
  ao?: IoAoConfig[]
  do?: IoDoConfig[]
  [key: string]: unknown
}

type IoAoConfig = {
  ch?: number
  tag?: string
  mode?: string
  units?: string
  min_pv?: number
  max_pv?: number
  name?: string
  enabled?: boolean
  [key: string]: unknown
}

type IoDoConfig = {
  ch?: number
  tag?: string
  name?: string
  enabled?: boolean
  [key: string]: unknown
}

type SafeStateEntry = {
  ch?: number
  safe?: unknown
  [key: string]: unknown
}

type SafeStateConfig = {
  ao?: SafeStateEntry[]
  do?: SafeStateEntry[]
  [key: string]: unknown
}

function aiNode(channel: number): string {
  return uiNode(channel)
}

/* Nhóm "resistance" (`signalType === 3`) gộp 4 biến thể contract thật
 * (`NTC10k`/`NTC20k`/`PT100`/`PT1000` — xem `configapi.go` `validateStringEnum`
 * và `docs/02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md` §3) vào một mã
 * FE duy nhất vì UI chưa có control chọn biến thể riêng (UC-UI-03, xem
 * `REV-UI-CFG-GAP-2026-08-14`). `signalTypeToIoType` dùng danh sách này để biết
 * biến thể nào được PHÉP giữ nguyên khi ghi lại — không tự ý coi mọi chuỗi lạ
 * là cùng nhóm. */
const resistanceIoTypes = ['NTC10k', 'NTC20k', 'PT100', 'PT1000']

function signalTypeFromIoType(type: unknown, invert?: boolean): AiSignalType {
  if (type === 'none') return 0
  if (type === '0-10V') return 1
  if (type === '2-10V' || type === '4-20mA') return 2
  if (typeof type === 'string' && resistanceIoTypes.includes(type)) return 3
  if (type === 'dry') return invert ? 5 : 4
  if (type === 'potentiometer') return 6
  if (type === 'light') return 7
  if (type === 'pulse') return 8
  return 0
}

function signalTypeFromIo(item: IoUiConfig): AiSignalType {
  return signalTypeFromIoType(item.type, item.invert)
}

/* BUG (tìm thấy 2026-08-14 khi khảo sát cho REV-UI-CFG-GAP): trước đây hàm này
 * luôn ghi cứng `'NTC10k'` cho signalType 3, bất kể kênh đó đang là
 * `NTC20k`/`PT100`/`PT1000` trên board thật. Vì `putAiInputs` ghi lại TOÀN BỘ
 * 16 kênh mỗi lần lưu, chỉ cần sửa một kênh bất kỳ trên trang Inputs là các
 * kênh khác bị âm thầm hạ cấp biến thể — mất dữ liệu thật không cách nào phục
 * hồi từ FE. Giữ nguyên chuỗi gốc (`ioType`) khi nó vẫn thuộc đúng nhóm
 * signalType hiện tại; chỉ đổi sang mặc định `NTC10k` khi người dùng thật sự
 * chuyển kênh sang nhóm resistance từ một loại khác. */
function signalTypeToIoType(config: Pick<AiInputConfig, 'signalType' | 'analogCurrent' | 'ioType'>): IoUiConfig['type'] {
  const signalType = config.signalType
  if (signalType === 1) return '0-10V'
  if (signalType === 2) return config.analogCurrent ? '4-20mA' : '2-10V'
  if (signalType === 3) {
    if (config.ioType && resistanceIoTypes.includes(config.ioType)) return config.ioType
    return 'NTC10k'
  }
  if (signalType === 4 || signalType === 5) return 'dry'
  if (signalType === 6) return 'potentiometer'
  if (signalType === 7) return 'light'
  if (signalType === 8) return 'pulse'
  return 'none'
}

export function unitFromIo(value: unknown): number {
  const unit = String(value ?? '').toLowerCase()
  if (unit === 'percent' || unit === '%' || unit === '%rh') return 1
  if (unit === 'degc' || unit === 'degf' || unit === 'c' || unit === 'f') return 2
  if (unit === 'pa' || unit === 'pascal') return 3
  if (unit === 'ppm') return 4
  return 0
}

export function unitToIo(unit: number): string {
  if (unit === 1) return 'percent'
  if (unit === 2) return 'degC'
  if (unit === 3) return 'Pa'
  if (unit === 4) return 'ppm'
  return ''
}

/* Cùng lớp bug với `signalTypeToIoType`: nếu board đang có một chuỗi `unit`
 * mà dropdown 5 lựa chọn của FE không biểu diễn được (vd `"RPM"`,
 * `"pulses"`, `"%RH"` — Go chỉ validate là string, không giới hạn enum, xem
 * `configapi.go:507`), việc chọn cùng nhóm enum (`unitFromIo` trả về cùng số)
 * rồi lưu KHÔNG được phép xoá mất chuỗi gốc. Chỉ ghi đè bằng giá trị canonical
 * khi enum thực sự đổi (người dùng chọn unit khác).
 */
function unitToIoRaw(unit: number, ioUnit?: string): string {
  if (ioUnit !== undefined && unitFromIo(ioUnit) === unit) return ioUnit
  return unitToIo(unit)
}

function defaultAiConfig(channel: number): AiInputConfig {
  return {
    channel,
    tag: aiNode(channel),
    label: aiNode(channel),
    signalType: 0,
    analogCurrent: false,
    displayMin: 0,
    displayMax: 100,
    rangeMultiplier: 0,
    unit: 0,
    filterSamples: 3,
    sensorCal: 0,
    mathFunction: 0,
    enabled: true,
    note: ''
  }
}

export function aiConfigFromIo(item: IoUiConfig, index: number): AiInputConfig {
  const channel = typeof item.ch === 'number' && Number.isFinite(item.ch) ? item.ch : index + 1
  const signalType = signalTypeFromIo(item)
  return {
    channel,
    tag: stringFrom(item.tag) ?? aiNode(channel),
    label: displayPointName(item.name, aiNode(channel)),
    signalType,
    analogCurrent: item.type === '4-20mA',
    displayMin: numberFrom(item.scale_lo) ?? 0,
    displayMax: numberFrom(item.scale_hi) ?? 100,
    rangeMultiplier: numberFrom(item.range_mult) ?? 0,
    unit: unitFromIo(item.unit),
    filterSamples: numberFrom(item.filter_samples) ?? 3,
    sensorCal: numberFrom(item.sensor_cal) ?? 0,
    mathFunction: numberFrom(item.math_func) ?? 0,
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    note: stringFrom(item.note) ?? '',
    ioType: stringFrom(item.type),
    ioUnit: stringFrom(item.unit)
  }
}

export function aiConfigToIo(config: AiInputConfig): IoUiConfig {
  const item: IoUiConfig = {
    ch: config.channel,
    tag: config.tag,
    type: signalTypeToIoType(config),
    name: config.label,
    note: config.note,
    enabled: config.enabled,
    unit: unitToIoRaw(config.unit, config.ioUnit),
    scale_lo: config.displayMin,
    scale_hi: config.displayMax,
    range_mult: config.rangeMultiplier,
    filter_samples: config.filterSamples,
    sensor_cal: config.sensorCal,
    math_func: config.mathFunction
  }
  if (isDigitalContact(config.signalType)) {
    item.invert = config.signalType === 5
    item.unit = ''
  }
  return item
}

function aiConfigsFromIo(raw: IoConfig): AiInputConfig[] {
  const byChannel = new Map<number, AiInputConfig>()
  raw.ui?.forEach((item, index) => {
    const config = aiConfigFromIo(item, index)
    byChannel.set(config.channel, config)
  })
  return Array.from({ length: 16 }, (_, index) => byChannel.get(index + 1) ?? defaultAiConfig(index + 1))
}

function channelFromEntry(item: { ch?: number }, index: number): number {
  return typeof item.ch === 'number' && Number.isFinite(item.ch) ? item.ch : index + 1
}

function outputMode(value: unknown): AoSignalMode {
  const raw = String(value ?? '').toUpperCase()
  return raw === '4-20MA' || raw === '4-20M A' ? '4-20mA' : '0-10V'
}

function outputUnit(value: unknown, mode: AoSignalMode): AoEngineeringUnit {
  const unit = String(value ?? '')
  if (['percent', 'volt', 'milliampere', 'degC', 'Pa', 'RPM', 'ppm', 'no_units'].includes(unit)) return unit as AoEngineeringUnit
  return mode === '4-20mA' ? 'milliampere' : 'volt'
}

function safeState(value: unknown): DoSafeState {
  return String(value ?? '').toLowerCase() === 'closed' ? 'closed' : 'open'
}

function outputByChannel<T extends { ch?: number }>(items: T[] | undefined, channel: number): T | undefined {
  return items?.find((item, index) => channelFromEntry(item, index) === channel)
}

function completeIoConfig(io: IoConfig): IoConfig {
  const demoOutputs = getDemoOutputs()
  return {
    ...io,
    ui: Array.from({ length: 16 }, (_, index) => {
      const channel = index + 1
      const current = outputByChannel(io.ui, channel)
      const id = aiNode(channel)
      return { ...current, ch: channel, tag: id, name: current?.name || id, type: current?.type || 'none' }
    }),
    ao: demoOutputs.ao.map((fallback) => {
      const current = outputByChannel(io.ao, fallback.channel)
      return { ...current, ch: fallback.channel, tag: fallback.id, name: current?.name || fallback.label, mode: current?.mode || fallback.mode }
    }),
    do: demoOutputs.do.map((fallback) => {
      const current = outputByChannel(io.do, fallback.channel)
      return { ...current, ch: fallback.channel, tag: fallback.id, name: current?.name || fallback.label }
    })
  }
}

function outputsFromConfig(io: IoConfig, safe: SafeStateConfig): OutputsConfig {
  const demo = getDemoOutputs()
  return {
    ao: demo.ao.map((config) => {
      const ioItem = outputByChannel(io.ao, config.channel)
      const safeItem = outputByChannel(safe.ao, config.channel)
      const mode = outputMode(ioItem?.mode ?? config.mode)
      return {
        ...config,
        tag: stringFrom(ioItem?.tag) ?? config.id,
        mode,
        units: outputUnit(ioItem?.units, mode),
        minPv: numberFrom(ioItem?.min_pv) ?? config.minPv,
        maxPv: numberFrom(ioItem?.max_pv) ?? config.maxPv,
        safeValue: numberFrom(safeItem?.safe) ?? config.safeValue,
        label: displayPointName(ioItem?.name, config.id)
      }
    }),
    do: demo.do.map((config) => {
      const ioItem = outputByChannel(io.do, config.channel)
      const safeItem = outputByChannel(safe.do, config.channel)
      return {
        ...config,
        tag: stringFrom(ioItem?.tag) ?? config.id,
        label: displayPointName(ioItem?.name, config.id),
        safeState: safeState(safeItem?.safe ?? config.safeState)
      }
    })
  }
}

function mergeOutputsConfig(current: IoConfig, outputs: OutputsConfig): IoConfig {
  const nextAo = [...(current.ao ?? [])]
  const nextDo = [...(current.do ?? [])]
  for (const output of outputs.ao) {
    const index = nextAo.findIndex((item, itemIndex) => channelFromEntry(item, itemIndex) === output.channel)
    const patch: IoAoConfig = { ch: output.channel, tag: output.tag, mode: output.mode, units: output.units, min_pv: output.minPv, max_pv: output.maxPv }
    if (output.label) patch.name = output.label
    if (index >= 0) nextAo[index] = { ...nextAo[index], ...patch }
    else nextAo.push(patch)
  }
  for (const output of outputs.do) {
    const index = nextDo.findIndex((item, itemIndex) => channelFromEntry(item, itemIndex) === output.channel)
    const patch: IoDoConfig = { ch: output.channel, tag: output.tag }
    if (output.label) patch.name = output.label
    if (index >= 0) nextDo[index] = { ...nextDo[index], ...patch }
    else nextDo.push(patch)
  }
  return { ...current, ui: current.ui ?? [], ao: nextAo, do: nextDo }
}

function mergeSafeState(current: SafeStateConfig, outputs: OutputsConfig): SafeStateConfig {
  const nextAo = [...(current.ao ?? [])]
  const nextDo = [...(current.do ?? [])]
  for (const output of outputs.ao) {
    const index = nextAo.findIndex((item, itemIndex) => channelFromEntry(item, itemIndex) === output.channel)
    const patch: SafeStateEntry = { ch: output.channel, safe: output.safeValue }
    if (index >= 0) nextAo[index] = { ...nextAo[index], ...patch }
    else nextAo.push(patch)
  }
  for (const output of outputs.do) {
    const index = nextDo.findIndex((item, itemIndex) => channelFromEntry(item, itemIndex) === output.channel)
    const patch: SafeStateEntry = { ch: output.channel, safe: output.safeState }
    if (index >= 0) nextDo[index] = { ...nextDo[index], ...patch }
    else nextDo.push(patch)
  }
  return { ...current, ao: nextAo, do: nextDo }
}

function formatTrendTime(value: unknown): string {
  if (typeof value !== 'string') return nowIso()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function trendTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export const apiClient = {
  async getHealth(): Promise<HealthResponse> {
    if (IS_DEMO) return getDemoHealth()
    try {
      return normalizeSystemStatus(await requestJson<Record<string, unknown>>('/system/status'))
    } catch (statusError) {
      try {
        return normalizeHealthResponse(await requestJson<Record<string, unknown>>('/health'))
      } catch (healthError) {
        throw healthError instanceof Error ? healthError : statusError
      }
    }
  },

  async getPoints(): Promise<Point[]> {
    if (IS_DEMO) return applyPointConfigOverrides(applyDemoPointMetadata(getDemoPoints()))
    const records = pointRecordsFrom(await requestJson<unknown>('/points', { suppressAuthExpired: true, cache: 'no-store' }))
    return records.map(normalizePoint)
  },

  async getNetwork(): Promise<NetworkData> {
    if (IS_DEMO) return getDemoNetwork()
    return requestJson<NetworkData>('/network')
  },

  async getNetworkTransaction(): Promise<NetcfgResponse> {
    if (IS_DEMO) {
      if (!demoNetcfgResponse) {
        demoNetcfgResponse = {
          version: 1,
          requestId: 'demo-status',
          result: 'accepted',
          reasonCode: 'OK',
          state: 'idle',
          active: demoNetcfgActive()
        }
      }
      return demoNetcfgResponse
    }
    return requestJson<NetcfgResponse>('/network/transaction', { cache: 'no-store' })
  },

  async runNetworkTransaction(action: NetcfgTransactionAction, payload: NetcfgTransactionRequest): Promise<NetcfgResponse> {
    if (IS_DEMO) return runDemoNetworkTransaction(action, payload)
    return requestJson<NetcfgResponse>(`/network/transaction/${action}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  async getTimeConfig(): Promise<TimeConfig> {
    if (IS_DEMO) return getDemoTimeConfig()
    const raw = await requestJson<Record<string, unknown>>('/system/config/time')
    return {
      timezone: String(raw.timezone ?? ''),
      ntpEnabled: Boolean(raw.ntp_enabled),
      ntpServers: Array.isArray(raw.ntp_servers) ? raw.ntp_servers.map(String) : [],
      systemTime: typeof raw.system_time === 'string' ? raw.system_time : '',
      revision: typeof raw.revision === 'number' ? raw.revision : 0
    }
  },

  async getTimeStatus(): Promise<TimeStatus> {
    if (IS_DEMO) return getDemoTimeStatus()
    return requestJson<TimeStatus>('/system/time/status')
  },

  async putTimeConfig(config: TimeConfigUpdate): Promise<ConfigPutResult> {
    if (IS_DEMO) return putDemoTimeConfig(config)
    return requestJson<ConfigPutResult>('/system/config/time', {
      method: 'PUT',
      body: JSON.stringify({
        timezone: config.timezone,
        ntp_enabled: config.ntpEnabled,
        ntp_servers: config.ntpServers,
        system_time: config.systemTime,
        baseRevision: config.baseRevision,
        ...(config.operationId ? { operationId: config.operationId } : {})
      })
    })
  },

  async saveNetwork(data: NetworkData): Promise<ConfigPutResult> {
    if (IS_DEMO) return { result: 'success', applied: true, reload: 'none', warnings: [] }
    // Đường này khởi động lại dịch vụ field bus qua reload helper nên chậm hơn
    // hẳn một request thường; 15 s mặc định là quá ngắn.
    return requestJson<ConfigPutResult>('/network', { method: 'PUT', body: JSON.stringify(data), timeoutMs: 120_000 })
  },

  async getHistory(pointIds: string[], range: string): Promise<TrendSample[]> {
    if (IS_DEMO || !pointIds.length) return []
    const params = new URLSearchParams({ point: pointIds.join(','), range })
    const raw = await requestJson<Array<Record<string, unknown>>>(`/history?${params.toString()}`)
    return raw.map(normalizeTrendSample)
  },

  async getHistorianConfig(): Promise<HistorianConfig> {
    if (IS_DEMO) return getDemoHistorianConfig()
    return requestJson<HistorianConfig>('/trends/config')
  },

  async putHistorianConfig(update: HistorianConfigUpdate): Promise<HistorianConfig> {
    if (IS_DEMO) return putDemoHistorianConfig(update)
    return requestJson<HistorianConfig>('/trends/config', {
      method: 'PUT',
      body: JSON.stringify(update)
    })
  },

  async getIoChannels(): Promise<IoChannel[]> {
    if (IS_DEMO) return getDemoChannels()
    return requestJson<IoChannel[]>('/io/channels')
  },

  async getAiInputs(): Promise<AiInputConfig[]> {
    if (IS_DEMO) return applyAiInputPointNames(getAiInputConfigs(), applyPointConfigOverrides(getDemoPoints()))
    const raw = await requestJson<IoConfig>('/system/config/io')
    return applyAiInputPointNames(aiConfigsFromIo(raw), await this.getPoints())
  },

  async putAiInputs(configs: AiInputConfig[]): Promise<void> {
    if (IS_DEMO) {
      putDemoAiInputs(configs)
      saveAiInputPointConfigOverrides(configs)
      return
    }
    const current = completeIoConfig(await requestJson<IoConfig>('/system/config/io'))
    await requestJson('/system/config/io', {
      method: 'PUT',
      body: JSON.stringify({
        ...current,
        ui: configs.map(aiConfigToIo),
        ao: current.ao,
        do: current.do
      })
    })
  },

  async getOutputs(): Promise<OutputsConfig> {
    if (IS_DEMO) return getDemoOutputs()
    const bundle = await requestJson<{ revision?: number; io?: IoConfig; safe_state?: SafeStateConfig }>('/system/config/io-bundle')
    return outputsFromConfig(completeIoConfig(bundle.io ?? {}), bundle.safe_state ?? {})
  },

  async putOutputs(config: OutputsConfig): Promise<void> {
    putDemoOutputs(config)
    if (IS_DEMO) return
    const current = await requestJson<{ revision?: number; io?: IoConfig; safe_state?: SafeStateConfig }>('/system/config/io-bundle')
    const currentIo = completeIoConfig(current.io ?? {})
    const currentSafe = current.safe_state ?? {}
    await requestJson('/system/config/io-bundle', {
      method: 'PUT',
      body: JSON.stringify({
        base_revision: current.revision ?? 0,
        io: mergeOutputsConfig(currentIo, config),
        safe_state: mergeSafeState(currentSafe, config)
      })
    })
  },

  async forceOutput(id: string, value: number | boolean, release = false) {
    return this.forcePoint(id, value, release)
  },

  async getVirtualPoints(): Promise<VirtualPoint[]> {
    if (IS_DEMO) return getDemoVirtualPoints()
    return requestJson<VirtualPoint[]>('/virtual-points')
  },

  async createVirtualPoint(point: Partial<VirtualPoint>): Promise<VirtualPoint> {
    if (IS_DEMO) {
      return putDemoVirtualPoint(point)
    }
    return requestJson<VirtualPoint>('/virtual-points', {
      method: 'POST',
      body: JSON.stringify({ ...point, name: undefined })
    })
  },

  async updateVirtualPoint(point: VirtualPoint): Promise<VirtualPoint> {
    if (IS_DEMO) {
      return putDemoVirtualPoint(point)
    }
    return requestJson<VirtualPoint>(`/virtual-points/${encodeURIComponent(point.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...point, name: undefined })
    })
  },

  async deleteVirtualPoint(id: string): Promise<void> {
    if (IS_DEMO) {
      deleteDemoVirtualPoint(id)
      return
    }
    await requestJson(`/virtual-points/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async getUserParams(): Promise<UserParamsConfig> {
    // Mock demo-only: EasySet User Parameters has no backend/core hook yet.
    return getDemoUserParams()
  },

  async putUserParams(config: UserParamsConfig): Promise<void> {
    // Mock demo-only: do not call REST from this page.
    putDemoUserParams(config)
  },

  /* ── Scheduler Engine v3.1 — 14 endpoint đặc tả §15 ──────────────────
   * Không có lớp "normalize" ở đây: hợp đồng đã đóng băng bằng JSON Schema
   * (contracts/config/schedule_v3_1.schema.json) và backend luôn trả đúng
   * hình dạng đó. Lớp normalize của mô hình cũ tồn tại vì hợp đồng cũ lỏng —
   * giữ lại sẽ che mất lỗi hợp đồng thay vì phơi ra.
   */
  async getSchedules(): Promise<ScheduleObject[]> {
    return requestJson<ScheduleObject[]>('/schedules')
  },

  async getSchedule(id: string): Promise<ScheduleObject> {
    return requestJson<ScheduleObject>(`/schedules/${encodeURIComponent(id)}`)
  },

  async createSchedule(body: ScheduleObject): Promise<ScheduleObject> {
    return requestJson<ScheduleObject>('/schedules', { method: 'POST', body: JSON.stringify(body) })
  },

  async updateSchedule(id: string, body: ScheduleObject): Promise<ScheduleObject> {
    return requestJson<ScheduleObject>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(body)
    })
  },

  async deleteSchedule(id: string): Promise<void> {
    await requestRaw(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async validateSchedule(id: string): Promise<ScheduleValidationResult> {
    return requestJson<ScheduleValidationResult>(`/schedules/${encodeURIComponent(id)}/validate`, {
      method: 'POST'
    })
  },

  async simulateSchedule(id: string, body: ScheduleSimulateRequest): Promise<ScheduleSimulateResult> {
    return requestJson<ScheduleSimulateResult>(`/schedules/${encodeURIComponent(id)}/simulate`, {
      method: 'POST', body: JSON.stringify(body)
    })
  },

  async publishSchedule(id: string, body: SchedulePublishRequest): Promise<SchedulePublishResult> {
    return requestJson<SchedulePublishResult>(`/schedules/${encodeURIComponent(id)}/publish`, {
      method: 'POST', body: JSON.stringify(body),
      // Backend chờ ACK tới 5 s và thử lại có trần; timeout mặc định của client
      // ngắn hơn sẽ cắt ngang và làm người dùng tưởng publish hỏng.
      timeoutMs: 30_000
    })
  },

  async enableSchedule(id: string): Promise<ScheduleObject> {
    return requestJson<ScheduleObject>(`/schedules/${encodeURIComponent(id)}/enable`, { method: 'POST' })
  },

  async disableSchedule(id: string): Promise<ScheduleObject> {
    return requestJson<ScheduleObject>(`/schedules/${encodeURIComponent(id)}/disable`, { method: 'POST' })
  },

  async getScheduleRevisions(id: string): Promise<ScheduleRevisionInfo[]> {
    return requestJson<ScheduleRevisionInfo[]>(`/schedules/${encodeURIComponent(id)}/revisions`)
  },

  async rollbackSchedule(id: string, targetRevision: number, reason: string): Promise<ScheduleObject> {
    return requestJson<ScheduleObject>(`/schedules/${encodeURIComponent(id)}/rollback`, {
      method: 'POST', body: JSON.stringify({ target_revision: targetRevision, reason })
    })
  },

  async getScheduleRuntime(id: string): Promise<ScheduleRuntimeState> {
    return requestJson<ScheduleRuntimeState>(`/schedules/${encodeURIComponent(id)}/runtime`)
  },

  async getScheduleAudit(id: string): Promise<ScheduleAuditEntry[]> {
    return requestJson<ScheduleAuditEntry[]>(`/schedules/${encodeURIComponent(id)}/audit`)
  },


  async getAlarms(): Promise<Alarm[]> {
    if (IS_DEMO) return getDemoAlarms()
    const raw = await requestJson<Array<Record<string, unknown>>>('/alarms')
    return raw.map(normalizeAlarm)
  },

  async getAlarmHistory(filters?: AlarmHistoryQuery): Promise<AlarmHistoryEntry[]> {
    if (IS_DEMO) return getDemoAlarmHistory()
    const raw = await requestJson<Array<Record<string, unknown>>>(`/alarm-history?${alarmHistoryParams(filters)}`)
    return raw.map(normalizeAlarmHistory)
  },

  async getAlarmSettings(): Promise<AlarmSetting[]> {
    if (IS_DEMO) return getDemoAlarmSettings()
    return requestJson<AlarmSetting[]>('/alarm-settings')
  },

  async putAlarmSettings(rows: AlarmSetting[]): Promise<ConfigPutResult> {
    if (IS_DEMO) return putDemoAlarmSettings(rows)
    return requestJson<ConfigPutResult>('/alarm-settings', {
      method: 'PUT',
      body: JSON.stringify(rows)
    })
  },

  /* WEB-UX-006: `GET/PUT /system/config/device` (RoleAdmin) đã có sẵn ở backend
     từ lâu — `configapi.go` với `validateConfigDevice` kiểm cả `device_id` lẫn
     độ dài `device_name`. Trang Thiết bị trước đây không gọi endpoint nào, chỉ
     bắn toast "Đã lưu … (demo)". */
  async getConfigDevice(): Promise<ConfigDevice> {
    if (IS_DEMO) return getDemoConfigDevice()
    const raw = await requestJson<Record<string, unknown>>('/system/config/device', { cache: 'no-store' })
    return {
      deviceId: typeof raw.device_id === 'number' ? raw.device_id : 0,
      deviceName: String(raw.device_name ?? ''),
      description: String(raw.description ?? ''),
      location: String(raw.location ?? '')
    }
  },

  async putConfigDevice(config: ConfigDevice): Promise<ConfigPutResult> {
    if (IS_DEMO) return putDemoConfigDevice(config)
    return requestJson<ConfigPutResult>('/system/config/device', {
      method: 'PUT',
      body: JSON.stringify({
        device_id: config.deviceId,
        device_name: config.deviceName,
        description: config.description,
        location: config.location
      })
    })
  },

  async getMe(): Promise<CurrentUser> {
    if (IS_DEMO) return { username: 'demo', role: 'admin' }
    return requestJson<CurrentUser>('/me')
  },

  /** `T57-3.3` — chỉ số hệ alarm ISA-18.2. Lỗi KHÔNG được nuốt thành 0: nơi gọi
   *  phải phân biệt "không có cảnh báo" với "không đọc được nhật ký". */
  async getAlarmMetrics(window: '10m' | '1h' | '24h' | '7d' = '24h'): Promise<AlarmMetrics> {
    if (IS_DEMO) return { window, windowS: 86400, rate10m: 0, ratePerHour: 0, totalRaised: 0, flooding: false, topRepeating: [], shelved: [] }
    return requestJson<AlarmMetrics>(`/alarms/metrics?window=${window}`, { cache: 'no-store' })
  },

  /** `T57-2.13` — mô phỏng luật cảnh báo bằng chính engine của Core. */
  async simulateAlarmSetting(setting: AlarmSetting, samples: Array<{ t: string; value: number }>): Promise<AlarmSimulateResult> {
    return requestJson<AlarmSimulateResult>('/alarm-settings/simulate', {
      method: 'POST',
      body: JSON.stringify({ setting, samples })
    })
  },

  /** `T57-3.9` — vòng nhớ giao dịch Modbus của iobus. CHỈ ĐỌC, không phát gì
   *  ra bus. Lỗi KHÔNG được nuốt thành mảng rỗng: mảng rỗng đọc thành "bus im
   *  lặng", còn lỗi nghĩa là "không biết". */
  async getModbusFrames(bus = 0, limit = 200): Promise<ModbusFramesResponse> {
    const params = new URLSearchParams({ bus: String(bus), limit: String(limit) })
    return requestJson<ModbusFramesResponse>(`/modbus/frames?${params.toString()}`, { cache: 'no-store' })
  },

  /** `T57-3.11` — mẫu thiết bị Modbus dựng sẵn. Chỉ điền sẵn form; người dùng
   *  vẫn phải xác nhận và lưu như bình thường. */
  async getModbusTemplates(): Promise<ModbusTemplate[]> {
    if (IS_DEMO) return []
    const raw = await requestJson<ModbusTemplate[]>('/modbus/templates', { cache: 'no-store' })
    return Array.isArray(raw) ? raw : []
  },

  /** `T57-3.18` — ping gateway/DNS và phân giải tên NGAY TRÊN THIẾT BỊ, trong cửa
   *  sổ đếm ngược rollback. */
  async checkNetworkConnectivity(): Promise<NetworkCheckResponse> {
    return requestJson<NetworkCheckResponse>('/network/connectivity-check', { method: 'POST' })
  },

  /** `T57-3.13` — ước lượng luật này sẽ bật bao nhiêu lần/ngày, dựa trên lịch sử
   *  THẬT của điểm. Không có lịch sử ⇒ backend trả 503; nơi gọi phải hiện lý do
   *  chứ không được biến nó thành "0 lần/ngày". */
  async estimateAlarmSetting(setting: AlarmSetting, pointId: string, days: number): Promise<AlarmEstimateResult> {
    return requestJson<AlarmEstimateResult>('/alarm-settings/estimate', {
      method: 'POST',
      body: JSON.stringify({ setting, pointId, days })
    })
  },

  /** `T57-3.5`/`T57-3.6`/`T57-3.7` — lịch nào thực sự điều khiển điểm này. */
  async getScheduleEffective(pointId: string, from: string, to: string): Promise<ScheduleEffectiveResponse> {
    const params = new URLSearchParams({ pointId, from, to })
    return requestJson<ScheduleEffectiveResponse>(`/schedules/effective?${params.toString()}`, { cache: 'no-store' })
  },

  /** `T57-3.4` — lịch sử 60 phút của CPU/RAM/nhiệt độ. Vòng nhớ nằm trong tiến
   *  trình web-api nên chỉ có từ lần khởi động gần nhất; `sinceRestart` nói ra
   *  điều đó để giao diện không giả vờ có một giờ dữ liệu ngay sau restart. */
  async getSystemHistory(): Promise<SystemHistoryResponse> {
    if (IS_DEMO) return { windowS: 3600, intervalS: 15, sinceRestart: new Date().toISOString(), samples: [] }
    const raw = await requestJson<Partial<SystemHistoryResponse>>('/system/history', { cache: 'no-store' })
    return {
      windowS: Number(raw.windowS ?? 3600),
      intervalS: Number(raw.intervalS ?? 15),
      sinceRestart: String(raw.sinceRestart ?? ''),
      samples: Array.isArray(raw.samples) ? raw.samples : []
    }
  },

  /** `T57-3.12` — ai đang dùng điểm ảo này. */
  async getVirtualPointUsage(id: string): Promise<VirtualPointUsage> {
    if (IS_DEMO) return { pointId: id, references: [], scanned: [], incomplete: false }
    const raw = await requestJson<Partial<VirtualPointUsage>>(`/virtual-points/${encodeURIComponent(id)}/usage`, { cache: 'no-store' })
    return {
      pointId: String(raw.pointId ?? id),
      tag: raw.tag,
      references: Array.isArray(raw.references) ? raw.references : [],
      scanned: Array.isArray(raw.scanned) ? raw.scanned : [],
      incomplete: Boolean(raw.incomplete),
      errors: Array.isArray(raw.errors) ? raw.errors : undefined
    }
  },

  /** `T57-3.16` — lần đăng nhập gần nhất và phiên đang mở của từng tài khoản. */
  async getUserAccess(): Promise<UserAccessResponse> {
    if (IS_DEMO) {
      const users = await getDemoUserAccounts()
      return {
        users: users.map((user) => ({ ...user, lastLoginAt: null, lastLoginRemote: null, lastFailedLoginAt: null, activeSessions: 0 })),
        sessions: [], sessionsSince: new Date().toISOString(), activityWindow: 0
      }
    }
    const raw = await requestJson<Partial<UserAccessResponse>>('/users/access', { cache: 'no-store' })
    return {
      users: Array.isArray(raw.users) ? raw.users.map(normalizeUserAccessRow) : [],
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      sessionsSince: String(raw.sessionsSince ?? ''),
      activityWindow: Number(raw.activityWindow ?? 0)
    }
  },

  /** `T57-3.2` (`ADR-043`) — tuỳ chọn người dùng lưu trên thiết bị.
   *
   *  Backend không hiểu nội dung; hình dạng do chính FE định nghĩa. Lỗi đọc
   *  KHÔNG được nuốt: nơi gọi phải biết để còn quay về bộ đệm cục bộ và nói ra. */
  async getMyPreferences(): Promise<Record<string, unknown>> {
    if (IS_DEMO) return {}
    return requestJson<Record<string, unknown>>('/me/preferences', { cache: 'no-store' })
  },

  async putMyPreferences(value: Record<string, unknown>): Promise<void> {
    if (IS_DEMO) return
    await requestJson('/me/preferences', { method: 'PUT', body: JSON.stringify(value) })
  },

  /* WEB-UX-003 / WEB-UX-011: các endpoint quản trị tài khoản đã tồn tại đầy đủ ở
     backend (apps/web-api/internal/app/users.go, đăng ký tại http.go:170-176) từ lâu nhưng
     frontend chưa từng gọi tới. Trang Người dùng dựng bảng từ `getDemoUsers()`
     kể cả ở bản live, và nút Đổi mật khẩu chỉ bắn toast. */
  async changeMyPassword(oldPassword: string, newPassword: string): Promise<void> {
    if (IS_DEMO) return
    await requestJson('/me/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    })
  },

  async listUsers(): Promise<UserAccount[]> {
    if (IS_DEMO) return getDemoUserAccounts()
    const raw = await requestJson<unknown>('/users', { cache: 'no-store' })
    return Array.isArray(raw) ? raw.map(normalizeUserAccount) : []
  },

  async createUser(username: string, role: UserRole, password: string): Promise<UserAccount> {
    if (IS_DEMO) return createDemoUserAccount(username, role)
    return normalizeUserAccount(await requestJson<Record<string, unknown>>('/users', {
      method: 'POST',
      body: JSON.stringify({ username, role, password })
    }))
  },

  async setUserRole(username: string, role: UserRole): Promise<UserAccount> {
    if (IS_DEMO) return setDemoUserRole(username, role)
    return normalizeUserAccount(await requestJson<Record<string, unknown>>(`/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: JSON.stringify({ role })
    }))
  },

  async resetUserPassword(username: string, newPassword: string): Promise<void> {
    if (IS_DEMO) return
    await requestJson(`/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword })
    })
  },

  async deleteUser(username: string): Promise<void> {
    if (IS_DEMO) return deleteDemoUserAccount(username)
    await requestJson(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
  },

  async ackAlarm(id: string, choice?: AlarmDurationChoice): Promise<Alarm[]> {
    if (IS_DEMO) return ackDemoAlarm(id, choice)
    await requestJson(`/alarms/${encodeURIComponent(id)}/ack`, {
      method: 'POST',
      ...(choice ? { body: JSON.stringify({ durationS: choice.durationS, permanent: choice.permanent }) } : {})
    })
    return this.getAlarms()
  },

  async suppressAlarm(id: string, choice: AlarmDurationChoice): Promise<Alarm[]> {
    if (IS_DEMO) return suppressDemoAlarm(id, choice)
    await requestJson(`/alarms/${encodeURIComponent(id)}/suppress`, {
      method: 'POST',
      body: JSON.stringify({ durationS: choice.durationS, permanent: choice.permanent })
    })
    return this.getAlarms()
  },

  async returnAlarm(id: string): Promise<Alarm[]> {
    if (IS_DEMO) return returnDemoAlarm(id)
    await requestJson(`/alarms/${encodeURIComponent(id)}/return`, { method: 'POST' })
    return this.getAlarms()
  },

  /**
   * Ghi hoặc nhả một point.
   *
   * PA3-107: `ttlS` đi thẳng xuống Core, nơi cưỡng chế thời hạn. Frontend
   * KHÔNG được tự hẹn giờ rồi gửi lệnh nhả — đóng tab là mất hẹn giờ và output
   * ở lại trạng thái ép tay (PA3-F05).
   */
  async forcePoint(id: string, value: number | boolean | string, release = false, ttlS?: number) {
    if (IS_DEMO) return forceDemoPoint(id, value, release)
    const body = release
      ? { release: true }
      : ttlS && ttlS > 0 ? { value, ttlS: Math.round(ttlS) } : { value }
    return requestJson<Record<string, unknown>>(`/points/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    })
  },

  /** Đọc một point kèm trạng thái override authoritative từ Core. */
  async getPoint(id: string): Promise<Point> {
    if (IS_DEMO) {
      const found = getDemoPoints().find((point) => point.id === id)
      if (!found) throw new ApiError('point not found', 404)
      return found
    }
    return normalizePoint(await requestJson<Record<string, unknown>>(`/points/${encodeURIComponent(id)}`, { cache: 'no-store' }))
  },

  async updatePointName(id: string, name: string): Promise<{ id: string; name?: string }> {
    return this.updatePointConfig(id, { name })
  },

  /** `equipment` — `T57-3.1` (`ADR-042`): chuỗi rỗng là lệnh GỠ thẻ, `undefined`
   *  là "không đụng tới". Hai thứ đó khác nhau và backend phân biệt chúng. */
  async updatePointConfig(id: string, config: { tag?: string; name?: string; unit?: string; trendEnabled?: boolean; equipment?: string }): Promise<{ id: string; tag?: string; name?: string; unit?: string; trendEnabled?: boolean; equipment?: string }> {
    if (IS_DEMO) {
      savePointConfigOverride(id, config)
      return updateDemoPointConfig(id, config)
    }
    return requestJson<{ id: string; tag?: string; name?: string; unit?: string; trendEnabled?: boolean; equipment?: string }>(`/points/${encodeURIComponent(id)}/config`, {
      method: 'PUT',
      body: JSON.stringify(config)
    })
  },

  async getModbusDevices(): Promise<ModbusRTUDevice[]> {
    if (IS_DEMO) return []
    return asList(await requestJson<ModbusRTUDevice[] | null>('/modbus/devices', { cache: 'no-store' }))
  },
  async createModbusDevice(device: ModbusRTUDevice): Promise<ModbusRTUDevice> {
    if (IS_DEMO) return device
    const response = await requestJson<{ device: ModbusRTUDevice }>('/modbus/devices', { method: 'POST', body: JSON.stringify(device) })
    return response.device
  },
  async updateModbusDevice(device: ModbusRTUDevice): Promise<ModbusRTUDevice> {
    if (IS_DEMO) return device
    const response = await requestJson<{ device: ModbusRTUDevice }>(`/modbus/devices/${encodeURIComponent(device.device_id)}`, { method: 'PUT', body: JSON.stringify(device) })
    return response.device
  },
  async deleteModbusDevice(id: string): Promise<void> {
    if (!IS_DEMO) await requestJson(`/modbus/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async getModbusPoints(): Promise<ModbusRTUPoint[]> {
    if (IS_DEMO) return []
    return asList(await requestJson<ModbusRTUPoint[] | null>('/modbus/points', { cache: 'no-store' }))
  },
  async createModbusPoint(point: ModbusRTUPoint): Promise<ModbusRTUPoint> {
    if (IS_DEMO) return point
    const response = await requestJson<{ point: ModbusRTUPoint }>('/modbus/points', { method: 'POST', body: JSON.stringify(point) })
    return response.point
  },
  async updateModbusPoint(point: ModbusRTUPoint): Promise<ModbusRTUPoint> {
    if (IS_DEMO) return point
    const response = await requestJson<{ point: ModbusRTUPoint }>(`/modbus/points/${encodeURIComponent(point.point_id)}`, { method: 'PUT', body: JSON.stringify(point) })
    return response.point
  },
  async deleteModbusPoint(id: string): Promise<void> {
    if (!IS_DEMO) await requestJson(`/modbus/points/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async getModbusDiagnostics(): Promise<ModbusRTUDiagnostics[]> {
    if (IS_DEMO) return []
    return asList(await requestJson<ModbusRTUDiagnostics[] | null>('/modbus/diagnostics', { cache: 'no-store' }))
  },
  async getModbusOverview(): Promise<ModbusOverview> {
    // Demo mode phải nói rõ là KHÔNG có telemetry. Trả `revision: 1` như bản cũ
    // làm giao diện hiện một revision không tồn tại và trông y hệt hệ thống thật.
    if (IS_DEMO) {
      return { total_devices: 0, online: 0, offline: 0, initializing: 0, fault_config: 0,
        revision: 0, checksum: '', telemetry_available: false }
    }
    return requestJson<ModbusOverview>('/modbus/overview', { cache: 'no-store' })
  },
  async getModbusBuses(): Promise<ModbusBusInfo[]> {
    if (IS_DEMO) return []
    return asList(await requestJson<ModbusBusInfo[] | null>('/modbus/buses', { cache: 'no-store' }))
  },

  /** Cấu hình MỘT cổng RS-485 và áp ngay cho riêng cổng đó (MBR-B213). */
  async updateModbusBus(busId: string, patch: ModbusBusConfigInput): Promise<{ bus: ModbusBus }> {
    return requestJson<{ bus: ModbusBus }>(`/modbus/buses/${encodeURIComponent(busId)}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    })
  },
  async getModbusEvents(): Promise<ModbusEventItem[]> {
    if (IS_DEMO) return []
    return asList(await requestJson<ModbusEventItem[] | null>('/modbus/events', { cache: 'no-store' }))
  },
  async writeModbusTest(pointId: string, value: number): Promise<{ point_id: string; applied_value: number; status: string; message?: string }> {
    if (IS_DEMO) return { point_id: pointId, applied_value: value, status: 'success', message: 'Demo mode' }
    return requestJson<{ point_id: string; applied_value: number; status: string; message?: string }>('/modbus/write-test', {
      method: 'POST',
      body: JSON.stringify({ point_id: pointId, value }),
    })
  },

  // ---- Contract v2: vòng đời cấu hình + commissioning + import/export ----
  async getModbusConfigState(): Promise<ModbusConfigState> {
    if (IS_DEMO) return { state: 'CLEAN', active_revision: 0, diff: [], running_on_iobus: { reachable: false } }
    const state = await requestJson<ModbusConfigState>('/modbus/config/state', { cache: 'no-store' })
    return { ...state, diff: asList(state.diff) }
  },
  async getModbusCandidate(): Promise<ModbusCandidate> {
    if (IS_DEMO) return { config: { buses: [], devices: [], points: [] }, base_revision: 0 }
    return requestJson<ModbusCandidate>('/modbus/config/candidate', { cache: 'no-store' })
  },
  async saveModbusCandidate(payload: {
    base_revision: number
    buses: ModbusBus[]
    devices: ModbusRTUDevice[]
    points: ModbusRTUPoint[]
    operation_id?: string
  }): Promise<{ result: string; state: ModbusConfigLifecycle; diff: ModbusDiffEntry[] }> {
    if (IS_DEMO) return { result: 'saved', state: 'DIRTY', diff: [] }
    return requestJson('/modbus/config/candidate', {
      method: 'PUT',
      // MBR-B205: gửi kèm If-Match để server từ chối khi có người khác vừa apply.
      headers: { 'If-Match': String(payload.base_revision) },
      body: JSON.stringify(payload)
    })
  },
  async discardModbusCandidate(): Promise<void> {
    if (!IS_DEMO) await requestJson('/modbus/config/candidate', { method: 'DELETE' })
  },
  async applyModbusConfig(payload: { base_revision: number; operation_id: string }): Promise<ModbusApplyResult> {
    if (IS_DEMO) return { result: 'success', revision: payload.base_revision + 1 }
    return requestJson<ModbusApplyResult>('/modbus/config/apply', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  async getModbusMapping(): Promise<ModbusMappingResponse> {
    if (IS_DEMO) return { rows: [], errors: [], load: [] }
    const mapping = await requestJson<ModbusMappingResponse>('/modbus/mapping', { cache: 'no-store' })
    return { rows: asList(mapping.rows), errors: asList(mapping.errors), load: asList(mapping.load) }
  },
  async getModbusPorts(): Promise<ModbusPortCapability[]> {
    if (IS_DEMO) return []
    return asList(await requestJson<ModbusPortCapability[] | null>('/modbus/ports', { cache: 'no-store' }))
  },
  async testModbusConnection(deviceId: string): Promise<ModbusProbeResult> {
    if (IS_DEMO) return { result: 'fail', reason: 'demo mode' }
    return requestJson<ModbusProbeResult>(`/modbus/devices/${encodeURIComponent(deviceId)}/test-connection`, {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async readModbusTest(payload: {
    bus_id: string
    slave_id: number
    fc: number
    address: number
    count: number
    timeout_ms?: number
  }): Promise<ModbusProbeResult> {
    if (IS_DEMO) return { result: 'fail', reason: 'demo mode' }
    return requestJson<ModbusProbeResult>('/modbus/read-test', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },
  async exportModbusConfig(format: 'csv' | 'json'): Promise<string> {
    if (IS_DEMO) return ''
    const response = await requestRaw(`/modbus/export?format=${format}`, { cache: 'no-store' })
    return response.text()
  },
  async importModbusConfig(format: 'csv' | 'json', content: string): Promise<{
    result: string
    state?: ModbusConfigLifecycle
    point_count?: number
    device_count?: number
    diff?: ModbusDiffEntry[]
    errors?: ModbusImportError[]
  }> {
    if (IS_DEMO) return { result: 'rejected', errors: [{ message: 'Demo mode' }] }
    return requestJson('/modbus/import?format=' + format, { method: 'POST', body: content })
  },

  async runCommissioningTest(pointId: string, value: number | boolean): Promise<CommissioningTestResult> {
    if (IS_DEMO) return runDemoCommissioning(pointId, value)
    const raw = await requestJson<Record<string, unknown>>(`/commissioning/points/${encodeURIComponent(pointId)}/test`, {
      method: 'POST',
      body: JSON.stringify({ value })
    })
    return normalizeCommissioningResult(raw, pointId)
  }
}

// `validateGraph()` đã bị gỡ ngày 2026-08-20 cùng với `/graph/validate` và
// `/graph/deploy` trong `contracts/openapi/openapi.yaml`.
//
// Nó là mã chết đúng nghĩa: không nơi nào gọi (các trang dùng
// `validateGraphLocal` của simulator), và ở chế độ live cả hai nhánh đều trỏ
// tới endpoint KHÔNG có handler — `/graphs/{id}/validate` chưa từng tồn tại,
// còn `/graph/validate` chỉ có trong spec. Nghĩa là nếu từng có ai gọi, nó sẽ
// thử một 404 rồi nuốt lỗi bằng `catch` và thử tiếp một 404 thứ hai.
//
// Canvas lập trình dạng sơ đồ khối thuộc Rev B (REVA_SCOPE_ROADMAP §3). Khi làm
// thật thì implement handler TRƯỚC, khai vào contract, rồi mới thêm lời gọi —
// `TestRouteTableMatchesOpenAPI` chặn thứ tự ngược lại.
