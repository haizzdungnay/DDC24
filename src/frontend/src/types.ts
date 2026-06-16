export type PointKind = 'AI' | 'DI' | 'AO' | 'DO' | 'virtual'
export type PointQuality = 'good' | 'uncertain' | 'bad' | 'stale'
export type HealthStatus = 'ok' | 'degraded' | 'fault' | 'unknown' | 'n/a'
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
export type DdcMode = 'demo' | 'live'
export type UserRole = 'admin' | 'operator' | 'viewer'
export type Language = 'vi' | 'en'

export interface Point {
  id: string
  name: string
  kind: PointKind
  value: number | boolean | string
  unit?: string
  quality: PointQuality
  source: string
  priority?: string
  updatedAt: string
  fault?: boolean
  forced?: boolean
  sensorType?: string
  trend?: number[]
}

export interface IoChannel {
  id: string
  pointId: string
  kind: PointKind
  label: string
  signal: string
  range?: string
  safeState?: string
}

export interface ServiceHealth {
  status: HealthStatus
  uptime_s?: number
  last_scan_ms?: number
}

export interface HealthResponse {
  overall: HealthStatus
  services: Record<string, ServiceHealth>
  cpuPercent?: number
  ramPercent?: number
  tempC?: number
  uptimeS?: number
  firmware?: string
  deviceName?: string
  deviceIp?: string
  bacnetDeviceId?: string
}

export interface Envelope<TPayload = unknown> {
  v: 1
  type: string
  topic: string
  payload: TPayload
}

export interface IoUpdatePayload {
  scan_ms: number
  points: Point[]
}

export interface Alarm {
  id: string
  time: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  status: 'active' | 'unack' | 'acked' | 'shelved'
  message: string
  source: string
  value: string
  detail: string
}

export interface CommissioningTestResult {
  result: 'passed' | 'failed' | 'running'
  pointId: string
  appliedValue?: number | boolean
  message: string
  scanMs?: number
}

export interface GraphValidationResult {
  pass: boolean
  errors: Array<{ path: string; message: string; severity: 'error' | 'warn' }>
}

export interface TrendSample {
  time: string
  [series: string]: string | number
}

export interface ScheduleCell {
  day: string
  value: 'ON' | 'OFF' | 'OPEN' | 'CLOSE'
  start: string
  end: string
}

export interface ScheduleRow {
  id: string
  label: string
  cells: ScheduleCell[]
}

export interface NetworkNode {
  id: string
  label: string
  ip: string
  status: HealthStatus
  children?: NetworkNode[]
}

export interface UserRow {
  username: string
  fullName: string
  role: UserRole
  online: boolean
}
