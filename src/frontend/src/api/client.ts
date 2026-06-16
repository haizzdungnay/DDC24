import { API_ORIGIN, IS_DEMO } from '../config'
import {
  ackDemoAlarm,
  forceDemoPoint,
  getDemoAlarms,
  getDemoChannels,
  getDemoHealth,
  getDemoPoints,
  runDemoCommissioning,
  validateGraphLocal
} from '../demo/simulator'
import type { Alarm, CommissioningTestResult, GraphValidationResult, HealthResponse, IoChannel, Point } from '../types'
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

function normalizePoint(raw: Record<string, unknown>): Point {
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
  const scan = (raw.scan ?? {}) as Record<string, unknown>
  const versions = (raw.versions ?? {}) as Record<string, unknown>
  return {
    overall: normalizeHealth(iop.status ?? 'ok'),
    cpuPercent: numberFrom(raw.cpu_percent),
    ramPercent: numberFrom(raw.ram_percent),
    uptimeS: numberFrom(raw.uptime_s),
    firmware: stringFrom(versions.web ?? versions.core ?? versions.iobus),
    services: {
      core: { status: normalizeHealth('ok'), last_scan_ms: numberFrom(scan.overrun) },
      iobus: { status: normalizeHealth(iop.status), last_scan_ms: numberFrom(iop.last_io_resp_ms) },
      web: { status: 'ok' },
      IOP: { status: normalizeHealth(iop.status), last_scan_ms: numberFrom(iop.last_io_resp_ms) }
    }
  }
}

function normalizeAlarm(raw: Record<string, unknown>): Alarm {
  return {
    id: String(raw.id ?? raw.alarm_id ?? crypto.randomUUID()),
    time: String(raw.time ?? raw.ts ?? raw.timestamp ?? nowIso()),
    severity: severityFrom(raw.severity),
    status: alarmStatusFrom(raw.status),
    message: String(raw.message ?? raw.name ?? 'Alarm'),
    source: String(raw.source ?? raw.point_id ?? 'SYSTEM'),
    value: String(raw.value ?? ''),
    detail: String(raw.detail ?? raw.description ?? '')
  }
}

function severityFrom(value: unknown): Alarm['severity'] {
  const raw = String(value ?? 'info').toLowerCase()
  if (raw === 'critical' || raw === 'high' || raw === 'medium' || raw === 'low') return raw
  return 'info'
}

function alarmStatusFrom(value: unknown): Alarm['status'] {
  const raw = String(value ?? 'active').toLowerCase()
  if (raw === 'unack' || raw === 'acked' || raw === 'shelved') return raw
  return 'active'
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export const apiClient = {
  async getHealth(): Promise<HealthResponse> {
    if (IS_DEMO) return getDemoHealth()
    try {
      return normalizeHealthResponse(await requestJson<Record<string, unknown>>('/health'))
    } catch {
      return normalizeSystemStatus(await requestJson<Record<string, unknown>>('/system/status'))
    }
  },

  async getPoints(): Promise<Point[]> {
    if (IS_DEMO) return getDemoPoints()
    const raw = await requestJson<Array<Record<string, unknown>>>('/points')
    return raw.map(normalizePoint)
  },

  async getIoChannels(): Promise<IoChannel[]> {
    if (IS_DEMO) return getDemoChannels()
    return requestJson<IoChannel[]>('/io/channels')
  },

  async getAlarms(): Promise<Alarm[]> {
    if (IS_DEMO) return getDemoAlarms()
    const raw = await requestJson<Array<Record<string, unknown>>>('/alarms')
    return raw.map(normalizeAlarm)
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

  async runCommissioningTest(pointId: string, value: number | boolean): Promise<CommissioningTestResult> {
    if (IS_DEMO) return runDemoCommissioning(pointId, value)
    return requestJson<CommissioningTestResult>('/commissioning/test', {
      method: 'POST',
      body: JSON.stringify({ pointId, value })
    })
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
