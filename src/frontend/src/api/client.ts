import { API_ORIGIN, IS_DEMO } from '../config'
import {
  ackDemoAlarm,
  forceDemoPoint,
  getAiInputConfigs,
  getAlarmSettings as getDemoAlarmSettings,
  getDemoAlarmHistory,
  getDemoAlarms,
  getDemoChannels,
  getDemoHealth,
  getDemoNetwork,
  getDemoOutputs,
  getDemoPoints,
  getDemoSchedule,
  getDemoVirtualIo,
  getUserParams as getDemoUserParams,
  deleteDemoVirtualIo,
  putDemoAiInputs,
  putDemoSchedule,
  putAlarmSettings as putDemoAlarmSettings,
  putDemoOutputs,
  putUserParams as putDemoUserParams,
  putDemoVirtualIo,
  returnDemoAlarm,
  runDemoCommissioning,
  suppressDemoAlarm,
  updateDemoPointConfig,
  validateGraphLocal
} from '../demo/simulator'
import { isDigitalContact, type AiInputConfig, type AiSignalType, type Alarm, type AlarmHistoryEntry, type AlarmHistoryQuery, type AlarmSetting, type AoConfig, type AoSignalMode, type CommissioningTestResult, type ConfigPutResult, type CurrentUser, type DoSafeState, type GraphValidationResult, type HealthResponse, type IoChannel, type NetworkData, type OutputsConfig, type Point, type ScheduleRow, type ScheduleTarget, type ScheduleType, type TrendSample, type UserParamsConfig, type VirtualIoPoint } from '../types'
import { isGenericPointLabel, normalizeHealth, nowIso, uiNode } from '../utils'
import { normalizePoint, pointRecordsFrom } from './pointNormalizer'

export { normalizePoint, pointRecordsFrom } from './pointNormalizer'

type AuthHeaderProvider = () => Record<string, string>
let authHeaderProvider: AuthHeaderProvider = () => ({})

const base = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`
const pointConfigOverridesKey = 'mkddc:point-config-overrides:v1'

type ApiRequestInit = RequestInit & { suppressAuthExpired?: boolean }
type PointConfigPatch = { name?: string; unit?: string; trendEnabled?: boolean }
type AlarmDurationChoice = { permanent: boolean; durationS?: number }
const scheduleTypes: ScheduleType[] = ['not_active', 'controller_operation_mode', 'control_loop_setpoint', 'analog_output_value', 'fan_state_value', 'digital_output_value', 'holiday_period']

export const POINT_UNIT_OPTIONS = [
  { value: '', label: '0 = No units shown' },
  { value: '%', label: '1 = % Percentage' },
  { value: 'C', label: '2 = °C / °F Degrees Celsius or Degrees Fahrenheit' },
  { value: 'Pa', label: '3 = P Pascals' }
] as const

export function setAuthHeaderProvider(provider: AuthHeaderProvider) {
  authHeaderProvider = provider
}

async function requestJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { suppressAuthExpired, ...fetchInit } = init
  const headers = new Headers(fetchInit.headers)
  for (const [key, value] of Object.entries(authHeaderProvider())) headers.set(key, value)
  if (fetchInit.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const response = await fetch(`${base}${path}`, { ...fetchInit, headers, credentials: 'include' })
  if (!suppressAuthExpired && (response.status === 401 || response.status === 403)) {
    window.dispatchEvent(new CustomEvent('mkddc:auth-expired'))
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `${response.status} ${response.statusText}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function readPointConfigOverrides(): Record<string, PointConfigPatch> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(pointConfigOverridesKey)
    return raw ? JSON.parse(raw) as Record<string, PointConfigPatch> : {}
  } catch {
    return {}
  }
}

function savePointConfigOverride(id: string, config: PointConfigPatch): PointConfigPatch & { id: string } {
  const overrides = readPointConfigOverrides()
  const current = overrides[id] ?? {}
  const next: PointConfigPatch = { ...current }
  if (Object.prototype.hasOwnProperty.call(config, 'name')) next.name = config.name
  if (Object.prototype.hasOwnProperty.call(config, 'unit')) next.unit = config.unit
  if (Object.prototype.hasOwnProperty.call(config, 'trendEnabled')) next.trendEnabled = config.trendEnabled
  overrides[id] = next
  window.localStorage.setItem(pointConfigOverridesKey, JSON.stringify(overrides))
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
    services,
  }
}

function normalizeAlarm(raw: Record<string, unknown>): Alarm {
  const id = String(raw.id ?? raw.alarmId ?? raw.alarm_id ?? crypto.randomUUID())
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

function normalizeSchedule(raw: Record<string, unknown>, index: number): ScheduleRow {
  const scheduleType = scheduleTypes.includes(raw.scheduleType as ScheduleType) ? raw.scheduleType as ScheduleType : scheduleTypes.includes(raw.schedule_type as ScheduleType) ? raw.schedule_type as ScheduleType : 'not_active'
  const weekdays = Array.isArray(raw.weekdays) ? raw.weekdays.map(String) : []
  const startTime = String(raw.startTime ?? raw.start_time ?? raw.timeOfDay ?? raw.time_of_day ?? '08:00')
  return {
    id: String(raw.id ?? `SCH-${String(index + 1).padStart(3, '0')}`),
    label: String(raw.label ?? raw.name ?? ''),
    notes: stringFrom(raw.notes ?? raw.note),
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
    scheduleType,
    timeOfDay: startTime,
    startTime,
    endTime: String(raw.endTime ?? raw.end_time ?? '17:00'),
    startDate: stringFrom(raw.startDate ?? raw.start_date) || '01-01',
    endDate: stringFrom(raw.endDate ?? raw.end_date) || '01-01',
    weekdays,
    target: normalizeScheduleTarget(raw.target),
    value: numberFrom(raw.value) ?? 0
  }
}

function normalizeScheduleTarget(value: unknown): ScheduleTarget | undefined {
  if (typeof value === 'string') return scheduleTargetFromPointId(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const kind = stringFrom(raw.kind)
  if (kind !== 'AO' && kind !== 'DO' && kind !== 'AV' && kind !== 'BV' && kind !== 'MSV' && kind !== 'HOL') return undefined
  const pointId = stringFrom(raw.pointId ?? raw.point_id)
  const parsed = pointId ? scheduleTargetFromPointId(pointId) : undefined
  const channel = numberFrom(raw.channel) ?? (parsed?.kind === kind ? parsed.channel : undefined)
  return { kind, ...(channel !== undefined ? { channel } : {}), ...(pointId ? { pointId } : {}) }
}

function scheduleTargetFromPointId(pointId: string): ScheduleTarget | undefined {
  const match = pointId.match(/^([A-Z]+)-?(\d+)$/)
  if (!match) return undefined
  const kind = match[1] === 'FAN' ? 'DO' : match[1]
  const channel = Number(match[2])
  if (kind !== 'AO' && kind !== 'DO' && kind !== 'AV' && kind !== 'BV' && kind !== 'MSV' && kind !== 'HOL') return undefined
  return { kind, channel, pointId: `${kind}-${String(channel).padStart(2, '0')}` }
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

type IoUiConfig = {
  ch?: number
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
  [key: string]: unknown
}

type IoAoConfig = {
  ch?: number
  mode?: string
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

function signalTypeFromIo(item: IoUiConfig): AiSignalType {
  if (item.type === 'none') return 0
  if (item.type === '0-10V') return 1
  if (item.type === '2-10V' || item.type === '4-20mA') return 2
  if (item.type === 'NTC10k' || item.type === 'NTC20k' || item.type === 'PT100' || item.type === 'PT1000') return 3
  if (item.type === 'dry') return item.invert ? 5 : 4
  if (item.type === 'potentiometer') return 6
  if (item.type === 'light') return 7
  if (item.type === 'pulse') return 8
  return 0
}

function signalTypeToIoType(config: Pick<AiInputConfig, 'signalType' | 'analogCurrent'>): IoUiConfig['type'] {
  const signalType = config.signalType
  if (signalType === 1) return '0-10V'
  if (signalType === 2) return config.analogCurrent ? '4-20mA' : '2-10V'
  if (signalType === 3) return 'NTC10k'
  if (signalType === 4 || signalType === 5) return 'dry'
  if (signalType === 6) return 'potentiometer'
  if (signalType === 7) return 'light'
  if (signalType === 8) return 'pulse'
  return 'none'
}

function unitFromIo(value: unknown): number {
  const unit = String(value ?? '').toLowerCase()
  if (unit === 'percent' || unit === '%' || unit === '%rh') return 1
  if (unit === 'degc' || unit === 'degf' || unit === 'c' || unit === 'f') return 2
  if (unit === 'pa' || unit === 'pascal') return 3
  if (unit === 'ppm') return 4
  return 0
}

function unitToIo(unit: number): string {
  if (unit === 1) return 'percent'
  if (unit === 2) return 'degC'
  if (unit === 3) return 'Pa'
  if (unit === 4) return 'ppm'
  return ''
}

function defaultAiConfig(channel: number): AiInputConfig {
  return {
    channel,
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

function aiConfigFromIo(item: IoUiConfig, index: number): AiInputConfig {
  const channel = typeof item.ch === 'number' && Number.isFinite(item.ch) ? item.ch : index + 1
  const signalType = signalTypeFromIo(item)
  return {
    channel,
    label: stringFrom(item.name) ?? aiNode(channel),
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
    note: stringFrom(item.note) ?? ''
  }
}

function aiConfigToIo(config: AiInputConfig): IoUiConfig {
  const item: IoUiConfig = {
    ch: config.channel,
    type: signalTypeToIoType(config),
    name: config.label,
    note: config.note,
    enabled: config.enabled,
    unit: unitToIo(config.unit),
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

function safeState(value: unknown): DoSafeState {
  return String(value ?? '').toLowerCase() === 'closed' ? 'closed' : 'open'
}

function outputByChannel<T extends { ch?: number }>(items: T[] | undefined, channel: number): T | undefined {
  return items?.find((item, index) => channelFromEntry(item, index) === channel)
}

function outputsFromConfig(io: IoConfig, safe: SafeStateConfig): OutputsConfig {
  const demo = getDemoOutputs()
  return {
    ao: demo.ao.map((config) => {
      const ioItem = outputByChannel(io.ao, config.channel)
      const safeItem = outputByChannel(safe.ao, config.channel)
      return {
        ...config,
        mode: outputMode(ioItem?.mode ?? config.mode),
        safeValue: numberFrom(safeItem?.safe) ?? config.safeValue,
        label: stringFrom(ioItem?.name) ?? config.label
      }
    }),
    do: demo.do.map((config) => {
      const safeItem = outputByChannel(safe.do, config.channel)
      return {
        ...config,
        safeState: safeState(safeItem?.safe ?? config.safeState)
      }
    })
  }
}

function mergeAoConfig(current: IoConfig, outputs: AoConfig[]): IoConfig {
  const nextAo = [...(current.ao ?? [])]
  for (const output of outputs) {
    const index = nextAo.findIndex((item, itemIndex) => channelFromEntry(item, itemIndex) === output.channel)
    const patch: IoAoConfig = { ch: output.channel, mode: output.mode }
    if (output.label) patch.name = output.label
    if (index >= 0) nextAo[index] = { ...nextAo[index], ...patch }
    else nextAo.push(patch)
  }
  return { ...current, ui: current.ui ?? [], ao: nextAo }
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
    const records = pointRecordsFrom(await requestJson<unknown>('/points', { suppressAuthExpired: true }))
    return applyPointConfigOverrides(records.map(normalizePoint))
  },

  async getNetwork(): Promise<NetworkData> {
    if (IS_DEMO) return getDemoNetwork()
    return requestJson<NetworkData>('/network')
  },

  async saveNetwork(data: NetworkData) {
    if (IS_DEMO) return { result: 'success', applied: true, reload: 'none', warnings: [] }
    return requestJson('/network', { method: 'PUT', body: JSON.stringify(data) })
  },

  async getHistory(pointIds: string[], range: string): Promise<TrendSample[]> {
    if (IS_DEMO || !pointIds.length) return []
    const params = new URLSearchParams({ point: pointIds.join(','), range })
    const raw = await requestJson<Array<Record<string, unknown>>>(`/history?${params.toString()}`)
    return raw.map(normalizeTrendSample)
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
    const current = await requestJson<IoConfig>('/system/config/io')
    await requestJson('/system/config/io', {
      method: 'PUT',
      body: JSON.stringify({
        ui: configs.map(aiConfigToIo),
        ao: current.ao ?? []
      })
    })
    saveAiInputPointConfigOverrides(configs)
  },

  async getOutputs(): Promise<OutputsConfig> {
    if (IS_DEMO) return getDemoOutputs()
    const [io, safe] = await Promise.all([
      requestJson<IoConfig>('/system/config/io'),
      requestJson<SafeStateConfig>('/system/config/safe-state')
    ])
    return outputsFromConfig(io, safe)
  },

  async putOutputs(config: OutputsConfig): Promise<void> {
    putDemoOutputs(config)
    if (IS_DEMO) return
    const [currentIo, currentSafe] = await Promise.all([
      requestJson<IoConfig>('/system/config/io'),
      requestJson<SafeStateConfig>('/system/config/safe-state')
    ])
    await requestJson('/system/config/io', {
      method: 'PUT',
      body: JSON.stringify(mergeAoConfig(currentIo, config.ao))
    })
    await requestJson('/system/config/safe-state', {
      method: 'PUT',
      body: JSON.stringify(mergeSafeState(currentSafe, config))
    })
  },

  async forceOutput(id: string, value: number | boolean, release = false) {
    return this.forcePoint(id, value, release)
  },

  async getVirtualIo(): Promise<VirtualIoPoint[]> {
    if (IS_DEMO) return getDemoVirtualIo()
    return requestJson<VirtualIoPoint[]>('/virtual-io')
  },

  async createVirtualIo(point: Partial<VirtualIoPoint>): Promise<VirtualIoPoint> {
    if (IS_DEMO) {
      return putDemoVirtualIo(point)
    }
    return requestJson<VirtualIoPoint>('/virtual-io', {
      method: 'POST',
      body: JSON.stringify(point)
    })
  },

  async updateVirtualIo(point: VirtualIoPoint): Promise<VirtualIoPoint> {
    if (IS_DEMO) {
      return putDemoVirtualIo(point)
    }
    return requestJson<VirtualIoPoint>(`/virtual-io/${encodeURIComponent(point.id)}`, {
      method: 'PUT',
      body: JSON.stringify(point)
    })
  },

  async deleteVirtualIo(id: string): Promise<void> {
    if (IS_DEMO) {
      deleteDemoVirtualIo(id)
      return
    }
    await requestJson(`/virtual-io/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async getUserParams(): Promise<UserParamsConfig> {
    // Mock demo-only: EasySet User Parameters has no backend/core hook yet.
    return getDemoUserParams()
  },

  async putUserParams(config: UserParamsConfig): Promise<void> {
    // Mock demo-only: do not call REST from this page.
    putDemoUserParams(config)
  },

  async getSchedules(): Promise<ScheduleRow[]> {
    if (IS_DEMO) return getDemoSchedule()
    const raw = await requestJson<Array<Record<string, unknown>>>('/schedules')
    return raw.map(normalizeSchedule)
  },

  async putSchedules(rows: ScheduleRow[]): Promise<ConfigPutResult> {
    if (IS_DEMO) {
      putDemoSchedule(rows)
      return { result: 'success', applied: true, reload: 'none', warnings: [] }
    }
    return requestJson<ConfigPutResult>('/schedules', {
      method: 'PUT',
      body: JSON.stringify(rows)
    })
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

  async getMe(): Promise<CurrentUser> {
    if (IS_DEMO) return { username: 'demo', role: 'admin' }
    return requestJson<CurrentUser>('/me')
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

  async forcePoint(id: string, value: number | boolean, release = false) {
    if (IS_DEMO) return forceDemoPoint(id, value, release)
    return requestJson(`/points/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(release ? { release: true } : { value })
    })
  },

  async updatePointName(id: string, name: string): Promise<{ id: string; name?: string }> {
    return this.updatePointConfig(id, { name })
  },

  async updatePointConfig(id: string, config: { name?: string; unit?: string; trendEnabled?: boolean }): Promise<{ id: string; name?: string; unit?: string; trendEnabled?: boolean }> {
    if (IS_DEMO) {
      savePointConfigOverride(id, config)
      return updateDemoPointConfig(id, config)
    }
    try {
      return await requestJson<{ id: string; name?: string; unit?: string; trendEnabled?: boolean }>(`/points/${encodeURIComponent(id)}/config`, {
        method: 'PUT',
        body: JSON.stringify(config)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/401|403|forbidden|unauthorized/i.test(message)) throw err
      return savePointConfigOverride(id, config)
    }
  },

  async runCommissioningTest(pointId: string, value: number | boolean): Promise<CommissioningTestResult> {
    if (IS_DEMO) return runDemoCommissioning(pointId, value)
    const raw = await requestJson<Record<string, unknown>>(`/commissioning/points/${encodeURIComponent(pointId)}/test`, {
      method: 'POST',
      body: JSON.stringify({ value })
    })
    return normalizeCommissioningResult(raw, pointId)
  },

  async validateGraph(id: string, graph: unknown): Promise<GraphValidationResult> {
    if (IS_DEMO) return validateGraphLocal(graph)
    try {
      return await requestJson<GraphValidationResult>(`/graphs/${encodeURIComponent(id)}/validate`, {
        method: 'POST',
        body: JSON.stringify(graph)
      })
    } catch {
      return requestJson<GraphValidationResult>('/graph/validate', { method: 'POST', body: JSON.stringify(graph) })
    }
  }
}
