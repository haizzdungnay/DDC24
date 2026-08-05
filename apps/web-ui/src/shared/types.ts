export type PointKind = 'UI' | 'AI' | 'DI' | 'AO' | 'DO' | 'virtual' | 'modbus_rtu'
export type PointQuality = 'good' | 'uncertain' | 'bad' | 'stale' | 'offline'
export type HealthStatus = 'ok' | 'degraded' | 'fault' | 'unknown' | 'n/a'
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
export type DdcMode = 'demo' | 'live'
export type UserRole = 'admin' | 'operator' | 'viewer'
export type Language = 'vi' | 'en'

export interface Point {
  id: string
  tag: string
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
  /** Backend may surface this while legacy duplicate names are being repaired. */
  namespaceState?: string
  pointId?: string
  tagName?: string
  displayName?: string
  dataType?: string
  timestamp?: string
  readWrite?: 'read' | 'read_write'
  defaultValue?: number | boolean | string | null
  safeValue?: number | boolean | string | null
}

export interface ModbusRTUDevice {
  device_id: string
  display_name: string
  enabled: boolean
  rs485_port: string
  baud: number
  parity: 'N' | 'E' | 'O'
  stop_bit: 1 | 2
  slave_id: number
  poll_ms: number
  timeout_ms: number
  retry: number
  offline_after_errors?: number
  offline_probe_ms?: number
}

export interface ModbusRTUPoint {
  point_id: string
  device_id: string
  tag_name: string
  display_name: string
  register_type: 'coil' | 'discrete_input' | 'input_register' | 'holding_register'
  address: number
  data_type: 'bool' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32'
  byte_order: 'big' | 'little'
  word_order: 'high_low' | 'low_high'
  scale: number
  offset: number
  unit: string
  read_write: 'read' | 'read_write'
  default_value: number | boolean
  safe_value: number | boolean
  enabled: boolean
}

export interface ModbusRTUDiagnostics {
  device_id: string
  slave_id: number
  online: boolean
  total_polls: number
  total_errors: number
  timeout_errors: number
  crc_errors: number
  retry_attempts: number
  consecutive_errors: number
  last_seen_ms: number
}

export interface ModbusOverview {
  total_devices: number
  online: number
  offline: number
  fault_config: number
  revision: number
  checksum: string
}

export interface ModbusBusInfo {
  bus_id: string
  display_name: string
  port: string
  port_alias: string
  open_state: string
  baud: number
  parity: string
  data_bits: number
  stop_bits: number
  total_devices: number
  online_devices: number
  poll_latency_p50_ms: number
  poll_latency_p95_ms: number
  timeout_errors: number
  crc_errors: number
  bus_utilization_percent: number
}

export interface ModbusEventItem {
  timestamp: string
  bus_id: string
  device_id: string
  message: string
  level: string
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
  deviceMac?: string
  description?: string
  location?: string
  systemTime?: string
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
  reload: 'sighup-core' | 'sighup-iobus' | 'sighup-iobus+sighup-core' | 'restart-iobus' | 'system' | 'none'
  warnings?: string[]
  revision?: number
  checksum?: string
}

export interface TimeConfig {
  timezone: string
  ntpEnabled: boolean
  ntpServers: string[]
  systemTime: string
  revision: number
}

export interface TimeConfigUpdate extends Omit<TimeConfig, 'revision'> {
  baseRevision: number
  operationId?: string
}

export interface TimeStatus {
  nowUtc: string
  nowLocal: string
  timezone: string
  mode: 'ntp' | 'manual'
  synchronized: boolean
  source: string | null
  offsetMs: number | null
  lastSyncUtc: string | null
  rtcPresent: boolean
  rtcUtc: string | null
  health: 'healthy' | 'degraded' | 'fault' | 'unknown'
  warnings: string[]
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
  [series: string]: string | number | null
}

export type HistorianInterval = '1s' | '3s' | '5s' | '15s' | '30s' | '1m' | '3m' | '5m' | '15m' | '30m' | '60m'
export type HistorianPolicyState = 'off' | 'scheduled' | 'recording' | 'error'

export interface HistorianPolicy {
  pointId: string
  generation: number
  dbLoggingEnabled: boolean
  dbInterval: HistorianInterval
  retentionDays: number
  maxRetentionDays?: number
  hotCacheEnabled: boolean
  hotCacheHours: number
  startAtUtc: string
  state: HistorianPolicyState
  health: string
  lastError?: string
}

export interface HistorianCapacity {
  enabledPoints: number
  reservedBytes: number
  budgetBytes: number
  freeBytes: number
  requiredFreeBytes: number
}

export interface HistorianConfig {
  revision: number
  serverNowUtc: string
  points: HistorianPolicy[]
  capacity: HistorianCapacity
  namespaceState?: string
  namespaceRevision: number
  retentionMaxDaysByInterval?: Partial<Record<HistorianInterval, number>>
}

export interface HistorianPolicyPatch {
  pointId: string
  generation: number
  dbLoggingEnabled: boolean
  dbInterval: HistorianInterval
  retentionDays: number
  startAtUtc: string | null
}

export interface HistorianConfigUpdate {
  baseRevision: number
  baseNamespaceRevision: number
  points: HistorianPolicyPatch[]
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

// 'unknown' KHÔNG phải giá trị trang trí: backend trả về đúng giá trị này khi
// iobus chưa publish số đo thật. Suy nó thành online/offline chính là finding
// F-03/F-04 mà bản 2026-07-31 đã sửa.
export type LinkState = 'online' | 'offline' | 'unknown'
export type ModbusProfile = 'EXT I/O' | 'Remote HMI' | 'Meter' | 'VFD'
export type PollState = 'online' | 'offline' | 'degraded' | 'unknown'

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
  /** Cổng UDP BACnet đang bind THẬT; null khi authority chưa báo. */
  activeBacnetPort: number | null
  /** Phiên bản phần mềm đang chạy thật (F-10). */
  firmware: string
  /** Serial phần cứng; chuỗi rỗng = thiết bị chưa được nạp serial (F-10). */
  serial: string
}

export interface ModbusSlave {
  address: number
  name: string
  profile: ModbusProfile
  baudRate: number
  pollState: PollState
  /**
   * Số đo THẬT per-slave do iobus đếm (F-03). `null` = chưa có số đo và giao
   * diện phải hiển thị "—", tuyệt đối không hiển thị 0 — trước đây errorRate bị
   * gán cứng 0 nên thanh lỗi luôn rỗng dù bus đang hỏng.
   */
  errorRate: number | null
  lastPollMs: number | null
  totalPolls: number | null
  totalErrors: number | null
}

export interface NetworkData {
  northbound: NetworkConfig
  southbound: ModbusSlave[]
}

export type NetcfgMode = 'static' | 'dhcp'
export type NetcfgLink = 'up' | 'down' | 'unknown'
export type NetcfgState = 'idle' | 'staged' | 'applying' | 'awaiting_confirmation' | 'confirmed' | 'rolling_back' | 'rolled_back' | 'failed'
export type NetcfgTransactionAction = 'validate' | 'stage' | 'apply' | 'confirm' | 'rollback'

export interface NetcfgDns {
  mode: 'auto' | 'manual'
  servers: string[]
}

export interface NetcfgCandidate {
  interface: string
  mode: NetcfgMode
  ipv4?: string
  netmask?: string
  gateway?: string
  dns?: NetcfgDns
}

export interface NetcfgActive {
  interface: string
  link: NetcfgLink
  adminUp?: boolean
  carrier?: boolean
  reasonCode?: string
  mode: NetcfgMode | 'unknown'
  ipv4: string
  prefixLength: number
  gateway: string
  dnsServers?: string[]
}

export interface NetcfgManagement {
  hostname: string
  mdnsName: string
  stable: boolean
}

export interface NetcfgResponse {
  version: 1
  requestId: string
  result: 'accepted' | 'rejected'
  reasonCode: string
  message?: string
  transactionId?: string
  state: NetcfgState
  rollbackRemainingS?: number
  active?: NetcfgActive
  pending?: NetcfgCandidate
  configured?: NetcfgCandidate
  capabilities?: string[]
  management?: NetcfgManagement
}

export interface NetcfgTransactionRequest {
  transactionId?: string
  candidate?: NetcfgCandidate
}

export interface UserRow {
  username: string
  fullName: string
  role: UserRole
  online: boolean
}

/** Khớp `ConfigDevice` trong apps/web-api/internal/app/dto.go (`device.conf`). Xem WEB-UX-006. */
export interface ConfigDevice {
  deviceId: number
  deviceName: string
  description: string
  location: string
}

/**
 * Tài khoản như backend thực sự lưu (`UserDTO` trong apps/web-api/internal/app/dto.go): chỉ có
 * username và role.
 *
 * Khác hẳn `UserRow` ở trên — vốn là dữ liệu dựng cho bản demo và có thêm
 * `fullName` với `online`, hai thứ backend KHÔNG lưu. Trang Người dùng của
 * WEB-UX-011 phải dùng kiểu này để không hiển thị cột nào không có nguồn thật.
 */
export interface UserAccount {
  username: string
  role: UserRole
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
  tag: string
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
export type AoEngineeringUnit = 'percent' | 'volt' | 'milliampere' | 'degC' | 'Pa' | 'RPM' | 'ppm' | 'no_units'
export type DoSafeState = 'open' | 'closed'
export type OutputDemoNote = 'demo'

export interface AoConfig {
  kind: 'AO'
  channel: number
  id: string
  tag: string
  label: string
  enabled: boolean
  mode: AoSignalMode
  units: AoEngineeringUnit
  minPv: number
  maxPv: number
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
  tag: string
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
  channel?: number
  tag: string
  /** Legacy alias for label; label is the canonical display name field. */
  name?: string
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
  namespaceState?: string
  generation?: number
}

export interface ApiValidationDetail {
  path: string
  message?: string
  reason?: string
  pointId?: string
  conflictPointId?: string
  conflictPath?: string
  tag?: string
  name?: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ApiValidationDetail[] = []
  ) {
    super(message)
    this.name = 'ApiError'
  }
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
