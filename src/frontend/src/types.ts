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
  ramUsedMb?: number
  ramTotalMb?: number
  tempC?: number
  uptimeS?: number
  firmware?: string
  deviceName?: string
  deviceIp?: string
  bacnetDeviceId?: string
}

export interface CurrentUser {
  username: string
  role: UserRole
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

export type AlarmType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AlarmPriority = 'low' | 'medium' | 'high' | 'critical'

export interface AlarmSetting {
  pointId: string
  label: string
  enabled: boolean
  hh: number
  h: number
  l: number
  ll: number
  delayS: number
  priority: AlarmPriority
  alarmType: AlarmType
  sourcePointId: string
  ackDelayS: number
  interlock: boolean
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

export interface GraphPort {
  name: string
  type?: 'float' | 'bool' | 'int' | 'string'
}

export interface GraphNode {
  id: string
  type: string
  ports?: {
    inputs?: Array<string | GraphPort>
    outputs?: Array<string | GraphPort>
  }
  inputs?: Array<string | GraphPort>
  outputs?: Array<string | GraphPort>
  params?: Record<string, unknown>
  config?: Record<string, unknown>
  limit?: { min?: number; max?: number; limit_lo?: number; limit_hi?: number }
  fallback?: unknown
  safeState?: unknown
  safe_state?: unknown
  power_on?: Record<string, unknown>
}

export interface GraphLink {
  from: string
  to: string
}

export interface GraphIoPoint {
  node: string
  channel?: number
  sensor?: string
  unit?: string
  mode?: string
  limit_lo?: number
  limit_hi?: number
  fallback?: unknown
  safeState?: unknown
  safe_state?: unknown
}

export interface GraphModbusPoint {
  node: string
  fc?: number
  addr?: number
  type?: string
  scale?: number
  fallback?: unknown
  safeState?: unknown
  safe_state?: unknown
}

export interface GraphModbusDevice {
  bus?: number
  baud?: number
  slave?: number
  host?: string
  unit?: number
  poll_ms?: number
  points?: GraphModbusPoint[]
}

export interface Graph {
  schema_version: string
  device: { bacnet_device_id: number | string; name: string; scan_ms: number }
  io_map: {
    ai?: GraphIoPoint[]
    ao?: GraphIoPoint[]
    di?: GraphIoPoint[]
    do?: GraphIoPoint[]
  }
  modbus?: {
    rtu?: GraphModbusDevice[]
    tcp?: GraphModbusDevice[]
  }
  nodes: GraphNode[]
  links: GraphLink[]
  meta?: Record<string, unknown>
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

export type LinkState = 'online' | 'offline'
export type ModbusProfile = 'EXT I/O' | 'Remote HMI' | 'Meter' | 'VFD'
export type PollState = 'online' | 'offline' | 'degraded'

export interface NetworkConfig {
  deviceName: string
  ip: string
  dhcp: boolean
  wifiEnabled: boolean
  subnet: string
  gateway: string
  bacnetDeviceId: string
  bacnetDeviceName: string
  bacnetPort: number
  bmsLink: LinkState
}

export interface ModbusSlave {
  address: number
  name: string
  profile: ModbusProfile
  baudRate: number
  pollState: PollState
  errorRate: number
  lastPollMs: number
}

export interface NetworkData {
  northbound: NetworkConfig
  southbound: ModbusSlave[]
}

export interface UserRow {
  username: string
  fullName: string
  role: UserRole
  online: boolean
}


export type AiSignalType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export function isAnalogSignal(signalType: AiSignalType): boolean {
  return signalType === 1 || signalType === 2 || signalType === 3 || signalType === 6 || signalType === 7 || signalType === 8
}

export function isDigitalContact(signalType: AiSignalType): boolean {
  return signalType === 4 || signalType === 5
}

export interface AiInputConfig {
  channel: number
  label: string
  signalType: AiSignalType
  displayMin: number
  displayMax: number
  rangeMultiplier: number
  unit: number
  filterSamples: number
  sensorCal: number
  mathFunction: number
  enabled: boolean
}

export interface DiInputConfig {
  channel: number
  node: string
  label: string
  invert: boolean
  normalState: 'open' | 'closed'
  debounceMs: number
  enabled: boolean
}
