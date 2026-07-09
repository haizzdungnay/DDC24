export type PointKind = 'UI' | 'AI' | 'DI' | 'AO' | 'DO' | 'virtual'
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
  raw?: number
  rawUnit?: string
  quality: PointQuality
  source: string
  priority?: string
  updatedAt: string
  fault?: boolean
  forced?: boolean
  sensorType?: string
  signalType?: VirtualPointSignalType | string
  writable?: boolean
  logEnabled?: boolean
  logIntervalMs?: number
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
  cpuClockMhz?: number
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
  status: 'active' | 'unack' | 'acked' | 'cleared' | 'shelved'
  message: string
  source: string
  value: string
  detail: string
  triggerLevel?: string
  threshold?: string
  active?: boolean
  returnable?: boolean
}

export interface AlarmHistoryEntry extends Alarm {
  eventId?: string
  event?: string
  user?: string
  acknowledgedAt?: string
  ackedBy?: string
  clearedAt?: string
  before?: AlarmSetting
  after?: AlarmSetting
}

export interface AlarmHistoryQuery {
  limit?: number | 'all'
  text?: string
  alarm?: string
  name?: string
  from?: string
  to?: string
  event?: string[]
  severity?: string
  status?: string
}

export type AlarmSourceKind = 'UI' | 'AO' | 'DO' | 'VP'
export type AlarmType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
export type ActiveAlarmType = 0 | 1 | 3
export type DeferredAlarmType = 2 | 4 | 5 | 6 | 7
export type AlarmPriority = 'low' | 'medium' | 'high' | 'critical' | 'flexible'

export interface AlarmSource {
  kind: AlarmSourceKind
  channel: number
  pointId: string
}

export interface AlarmParams {
  hh?: number
  h?: number
  l?: number
  ll?: number
  hysteresis?: number
  runtimeHours?: number
  severityRules?: SeverityRule[]
}

export interface SeverityRule {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  op: '>=' | '<='
  value: number
}

export interface AlarmSetting {
  id: string
  label: string
  enabled: boolean
  alarmType: AlarmType
  sources: AlarmSource[]
  priority: AlarmPriority
  clearMode?: 'auto' | 'manual'
  delayS: number
  publishBacnet?: boolean
  notificationClass?: number
  params: AlarmParams
}

export type AlarmEntity = AlarmSetting

export interface ConfigPutResult {
  result: 'success' | 'failed' | 'accepted' | 'rejected'
  applied: boolean
  reload: 'sighup-core' | 'sighup-iobus' | 'restart-iobus' | 'system' | 'none'
  warnings?: string[]
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
    ui?: GraphIoPoint[]
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

export type ScheduleType =
  | 'not_active'
  | 'controller_operation_mode'
  | 'control_loop_setpoint'
  | 'analog_output_value'
  | 'fan_state_value'
  | 'digital_output_value'
  | 'holiday_period'

export type ScheduleTargetKind = 'AO' | 'DO' | 'VP' | 'HOL'

export interface ScheduleTarget {
  kind: ScheduleTargetKind
  channel?: number
  pointId?: string
}

export interface ScheduleRow {
  id: string
  label: string
  notes?: string
  enabled: boolean
  scheduleType: ScheduleType
  timeOfDay?: string
  startTime: string
  endTime: string
  startDate?: string
  endDate?: string
  weekdays: string[]
  target?: ScheduleTarget
  value: number
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
  analogCurrent?: boolean
  displayMin: number
  displayMax: number
  rangeMultiplier: number
  unit: number
  filterSamples: number
  sensorCal: number
  mathFunction: number
  enabled: boolean
  note: string
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

export type AoSignalMode = '0-10V' | '4-20mA'
export type DoSafeState = 'open' | 'closed'
export type OutputDemoNote = 'demo'

export interface AoConfig {
  kind: 'AO'
  channel: number
  id: string
  label: string
  enabled: boolean
  mode: AoSignalMode
  safeValue: number
  source: number
  loopConfig: number
  minHeatOutput: number
  maxHeatOutput: number
  minCoolOutput: number
  maxCoolOutput: number
  alarm100: number
  alarm0: number
  input: number
  notUsed10: number
  notUsed11: number
  piSeqLowerFan1: number
  fanSpeed2: number
  piSeqUpperFan3: number
  setbackAlarm: number
  notInUse16: number
  manualValue: number
  note: string
  demoNote?: OutputDemoNote
}

export interface DoConfig {
  kind: 'DO'
  channel: number
  id: string
  label: string
  enabled?: boolean
  safeState: DoSafeState
  manualValue: boolean
  floatingMode?: number
  source?: number
  notInUse02?: number
  sequence?: number
  switchOffDelay?: number
  switchOnDelay?: number
  pwmCycleTime?: number
  alarmOn?: number
  alarmOff?: number
  runtimeCounter?: boolean
  runtimeAlarmHours?: number
  usePiSequence?: boolean
  note?: string
}

export interface OutputsConfig {
  ao: AoConfig[]
  do: DoConfig[]
}

export type VirtualPointSignalType = 'boolean' | 'integer' | 'float' | 'string' | 'datetime'

export interface VirtualPoint {
  id: string
  label: string
  signalType: VirtualPointSignalType
  enabled: boolean
  writable: boolean
  logEnabled: boolean
  logIntervalMs?: number
  retentionS?: number
  value?: number | boolean | string
  unit?: string
  displayMin?: number
  displayMax?: number
  rangeMultiplier?: number
  filterSamples?: number
  sensorCal?: number
  mathFunction?: number
  note?: string
  updatedAt?: string
}

export type UserParamKey =
  | 'UP00' | 'UP01' | 'UP02' | 'UP03' | 'UP04' | 'UP05' | 'UP06' | 'UP07' | 'UP08' | 'UP09'
  | 'UP10' | 'UP11' | 'UP12' | 'UP13' | 'UP14' | 'UP15' | 'UP16' | 'UP17' | 'UP18' | 'UP19'
  | 'UP20' | 'UP21' | 'UP22' | 'UP23' | 'UP24' | 'UP25' | 'UP26' | 'UP27' | 'UP28' | 'UP29'
  | 'UPSP' | 'UPTS' | 'UPHT' | 'UPSB' | 'UPFAN' | 'LOCK1' | 'LOCK2' | 'LOCK3'

export type UserParamValue = number | string

export type UserParamsConfig = Record<UserParamKey, UserParamValue> & {
  note: string
}
