import { API_ORIGIN, IS_DEMO } from '../config'
import {
  ackDemoAlarm,
  forceDemoPoint,
  getAiInputConfigs,
  getDemoAlarms,
  getDemoChannels,
  getDemoHealth,
  getDemoNetwork,
  getDemoPoints,
  putDemoAiInputs,
  runDemoCommissioning,
  updateDemoPointConfig,
  validateGraphLocal
} from '../demo/simulator'
import { isAnalogSignal, isDigitalContact, type AiInputConfig, type AiSignalType, type Alarm, type CommissioningTestResult, type CurrentUser, type GraphValidationResult, type HealthResponse, type IoChannel, type NetworkData, type Point, type TrendSample } from '../types'
import { normalizeHealth, normalizeKind, normalizeQuality, nowIso } from '../utils'

type AuthHeaderProvider = () => Record<string, string>
let authHeaderProvider: AuthHeaderProvider = () => ({})

const base = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`

export function setAuthHeaderProvider(provider: AuthHeaderProvider) {
  authHeaderProvider = provider
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(authHeaderProvider())) headers.set(key, value)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: 'include' })
  if (response.status === 401 || response.status === 403) {
    window.dispatchEvent(new CustomEvent('mkddc:auth-expired'))
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `${response.status} ${response.statusText}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function normalizePoint(raw: Record<string, unknown>): Point {
  const id = String(raw.id ?? raw.point_id ?? 'UNKNOWN')
  const value = raw.value as Point['value'] ?? 0
  return {
    id,
    name: String(raw.name ?? raw.label ?? id),
    kind: normalizeKind(raw.kind ?? raw.type),
    value,
    unit: raw.unit ? String(raw.unit) : undefined,
    quality: normalizeQuality(raw.quality),
    source: String(raw.source ?? 'Core'),
    priority: raw.priority ? String(raw.priority) : raw.active_source ? String(raw.active_source) : undefined,
    updatedAt: String(raw.updatedAt ?? raw.timestamp ?? raw.ts ?? nowIso()),
    fault: Boolean(raw.fault ?? false),
    forced: Boolean(raw.forced ?? false),
    sensorType: raw.sensorType ? String(raw.sensorType) : raw.sensor_type ? String(raw.sensor_type) : undefined
  }
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
  return {
    id,
    time: String(raw.time ?? raw.ts ?? raw.timestamp ?? raw.createdAt ?? raw.created_at ?? nowIso()),
    severity: severityFrom(raw.severity ?? raw.priority ?? raw.level),
    status: alarmStatusFrom(raw.status ?? raw.state ?? acknowledged),
    message: String(raw.message ?? raw.name ?? raw.type ?? `Alarm ${id}`),
    source: String(source),
    value: String(raw.value ?? raw.currentValue ?? raw.current_value ?? raw.triggerValue ?? raw.trigger_value ?? ''),
    detail: String(raw.detail ?? raw.description ?? raw.reason ?? raw.condition ?? '')
  }
}

function normalizeTrendSample(raw: Record<string, unknown>): TrendSample {
  const sample: TrendSample = { time: formatTrendTime(raw.time ?? raw.ts ?? raw.timestamp) }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'time' || key === 'ts' || key === 'timestamp') continue
    if (typeof value === 'number' && Number.isFinite(value)) sample[key] = value
  }
  return sample
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
  if (raw === 'unack' || raw === 'acked' || raw === 'shelved') return raw
  if (raw === 'acknowledged') return 'acked'
  if (raw === 'unacknowledged') return 'unack'
  return 'active'
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
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
  ao?: unknown[]
}

function aiNode(channel: number): string {
  return `AI-${String(channel).padStart(2, '0')}`
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

function signalTypeToIoType(signalType: AiSignalType): IoUiConfig['type'] {
  if (signalType === 1) return '0-10V'
  if (signalType === 2) return '2-10V'
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
  return 0
}

function unitToIo(unit: number): string {
  if (unit === 1) return 'percent'
  if (unit === 2) return 'degC'
  if (unit === 3) return 'Pa'
  return ''
}

function defaultAiConfig(channel: number): AiInputConfig {
  return {
    channel,
    label: aiNode(channel),
    signalType: 0,
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
    type: signalTypeToIoType(config.signalType),
    name: config.label,
    note: config.note,
    enabled: config.enabled
  }
  if (isDigitalContact(config.signalType)) {
    item.invert = config.signalType === 5
    item.unit = ''
    return item
  }
  if (isAnalogSignal(config.signalType)) {
    item.unit = unitToIo(config.unit)
    item.scale_lo = config.displayMin
    item.scale_hi = config.displayMax
    item.range_mult = config.rangeMultiplier
    item.filter_samples = config.filterSamples
    item.sensor_cal = config.sensorCal
    item.math_func = config.mathFunction
  }
  return item
}

function aiConfigsFromIo(raw: IoConfig): AiInputConfig[] {
  const byChannel = new Map<number, AiInputConfig>()
  raw.ui?.forEach((item, index) => {
    const config = aiConfigFromIo(item, index)
    byChannel.set(config.channel, config)
  })
  return Array.from({ length: 8 }, (_, index) => byChannel.get(index + 1) ?? defaultAiConfig(index + 1))
}

function formatTrendTime(value: unknown): string {
  if (typeof value !== 'string') return nowIso()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const apiClient = {
  async getHealth(): Promise<HealthResponse> {
    if (IS_DEMO) return getDemoHealth()
    try {
      return normalizeSystemStatus(await requestJson<Record<string, unknown>>('/system/status'))
    } catch {
      try {
        return normalizeHealthResponse(await requestJson<Record<string, unknown>>('/health'))
      } catch {
        return getDemoHealth()
      }
    }
  },

  async getPoints(): Promise<Point[]> {
    if (IS_DEMO) return getDemoPoints()
    const raw = await requestJson<Array<Record<string, unknown>>>('/points')
    return raw.map(normalizePoint)
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
    if (IS_DEMO) return getAiInputConfigs()
    const raw = await requestJson<IoConfig>('/system/config/io')
    return aiConfigsFromIo(raw)
  },

  async putAiInputs(configs: AiInputConfig[]): Promise<void> {
    if (IS_DEMO) {
      putDemoAiInputs(configs)
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
  },

  async getAlarms(): Promise<Alarm[]> {
    if (IS_DEMO) return getDemoAlarms()
    const raw = await requestJson<Array<Record<string, unknown>>>('/alarms')
    return raw.map(normalizeAlarm)
  },

  async getMe(): Promise<CurrentUser> {
    if (IS_DEMO) return { username: 'demo', role: 'admin' }
    return requestJson<CurrentUser>('/me')
  },

  async ackAlarm(id: string): Promise<Alarm[]> {
    if (IS_DEMO) return ackDemoAlarm(id)
    await requestJson(`/alarms/${encodeURIComponent(id)}/ack`, { method: 'POST' })
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
    if (IS_DEMO) return updateDemoPointConfig(id, config)
    return requestJson<{ id: string; name?: string; unit?: string; trendEnabled?: boolean }>(`/points/${encodeURIComponent(id)}/config`, {
      method: 'PUT',
      body: JSON.stringify(config)
    })
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
