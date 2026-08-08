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
  /** `undefined` = CHƯA CÓ SỐ ĐO, khác hẳn với `0`. Nơi hiển thị phải ra
   *  `NO_DATA`/`—`, nơi tính toán phải bỏ qua mẫu (REV-FE-04, nguyên tắc D-07). */
  value: number | boolean | string | undefined
  unit?: string
  raw?: number
  rawUnit?: string
  quality: PointQuality
  source: string
  priority?: string
  /** `undefined` = producer KHÔNG cấp mốc thời gian.
   *
   *  PA3-F04: bản trước điền `nowIso()` vào chỗ này, nên một point không ai
   *  biết cập nhật lúc nào lại hiện "vừa xong" — chính xác là kiểu dối trá mà
   *  người trực ca không có cách nào phát hiện. Nơi hiển thị phải ra `—`. */
  updatedAt?: string
  fault?: boolean
  forced?: boolean
  /** Số giây còn lại của lệnh ép tay, do Core cấp (PA3-107).
   *  `undefined` = không có lệnh có thời hạn, KHÔNG phải "hết hạn". */
  overrideExpiresInS?: number
  /** Lý do chất lượng do producer nói ra; UI hiển thị nguyên văn (D-07). */
  qualityReason?: string
  busId?: number
  slaveAddr?: number
  exceptionCode?: number
  /** `undefined` = producer không báo trạng thái kết nối, khác hẳn `false`. */
  online?: boolean
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

/** MBR-B202 — một sợi dây RS-485. Tham số serial thuộc BUS, không thuộc thiết bị:
 *  hai thiết bị trên cùng dây không thể chạy hai baud khác nhau. */
export interface ModbusBus {
  bus_id: string
  display_name: string
  port: string
  baud: number
  parity: 'N' | 'E' | 'O'
  stop_bits: 1 | 2
  data_bits: number
  offline_probe_ms: number
  enabled: boolean
  /** G-D: phần cứng chỉ có TX/RX ⇒ luôn `auto`. Không có giao diện đổi. */
  direction?: 'auto' | 'rts'
}

/** Thân của `PUT /modbus/buses/{bus_id}`. Chỉ những trường người dùng được sửa:
 *  `bus_id`/`port`/`data_bits`/`direction` là sự thật phần cứng, không nhận từ
 *  client. */
export interface ModbusBusConfigInput {
  display_name?: string
  baud?: number
  parity?: 'N' | 'E' | 'O'
  stop_bits?: 1 | 2
  offline_probe_ms?: number
  enabled?: boolean
}

/** MBR-B211 — cổng board thật sự có. FE dựng dropdown từ đây thay vì để người
 *  dùng gõ tay một đường dẫn không tồn tại (D-14: `/dev/ttyS3`). */
export interface ModbusPortCapability {
  port: string
  alias?: string
  description?: string
  max_baud?: number
}

export interface ModbusRTUDevice {
  device_id: string
  display_name: string
  enabled: boolean
  bus_id?: string
  rs485_port: string
  baud: number
  parity: 'N' | 'E' | 'O'
  /** Kế thừa READ-ONLY từ Bus (OD-MBRTU-002). Giao diện Thiết bị chỉ hiển thị. */
  stop_bits: 1 | 2
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
  /** OD-MBRTU-003 — trích một bit trong register (bool trên Holding/Input). */
  bit_index?: number | null
  min_value?: number | null
  max_value?: number | null
}

/** DATA_MODEL §6.2 — năm mức. `UNKNOWN` xuất hiện khi producer mới hơn
 *  consumer; tuyệt đối không được đoán về GOOD. */
export type ModbusQuality = 'GOOD' | 'STALE' | 'BAD' | 'OFFLINE' | 'CONFIG_ERROR' | 'UNKNOWN'

export interface ModbusRTUDiagnostics {
  device_id: string
  slave_id: number
  bus_id?: number
  online: boolean
  total_polls: number
  total_errors: number
  timeout_errors: number
  crc_errors: number
  retry_attempts: number
  write_failed?: number
  write_dropped?: number
  consecutive_errors: number
  last_exception?: number
  last_seen_ms: number
}

export interface ModbusOverview {
  total_devices: number
  online: number
  offline: number
  initializing?: number
  fault_config: number
  revision: number
  checksum: string
  /** false ⇒ iobus chưa publish lần nào; mọi con số runtime phải hiểu là
   *  KHÔNG BIẾT, không phải 0. */
  telemetry_available: boolean
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
  /** Cấu hình đang lưu — dùng để nạp form trang Cổng RS-485. */
  offline_probe_ms?: number
  enabled?: boolean
  total_devices: number
  online_devices: number
  /** `null` = iobus chưa đo được. Hiện "—", KHÔNG hiện 0 (D-07). */
  poll_latency_p50_ms: number | null
  poll_latency_p95_ms: number | null
  bus_utilization_percent: number | null
  estimated_load_percent?: number
  timeout_errors: number
  crc_errors: number
  port_reopens?: number
}

/** MBR-B302/B303 — ba nguồn state tách bạch: cấu hình đang chạy, bản nháp, và
 *  thứ iobus THẬT SỰ đang chạy. */
export type ModbusConfigLifecycle = 'CLEAN' | 'DIRTY' | 'APPLYING' | 'FAILED'

export interface ModbusDiffEntry {
  kind: 'bus' | 'device' | 'point'
  action: 'added' | 'removed' | 'modified'
  id: string
  field?: string
  before?: string
  after?: string
}

export interface ModbusRunningSnapshot {
  generation?: number
  config_revision?: number
  ext_count?: number
  in_sync?: boolean
  reachable: boolean
}

export interface ModbusConfigState {
  state: ModbusConfigLifecycle
  active_revision: number
  active_checksum?: string
  base_revision?: number
  checksum?: string
  updated_at?: string
  updated_by?: string
  last_error?: string
  diff: ModbusDiffEntry[]
  running_on_iobus?: ModbusRunningSnapshot
}

export interface ModbusCandidate {
  config: {
    buses?: ModbusBus[]
    devices?: ModbusRTUDevice[]
    points?: ModbusRTUPoint[]
    revision?: number
  }
  base_revision: number
  checksum?: string
  state?: ModbusConfigLifecycle
  updated_at?: string
  updated_by?: string
}

export interface ModbusMappingRow {
  point_id: string
  tag_name: string
  device_id: string
  bus_id: string
  slave_id: number
  register_type: string
  address: number
  registers: number
  data_type: string
  read_write: string
  enabled: boolean
}

export interface ModbusBusLoad {
  bus_id: string
  port: string
  baud: number
  device_count: number
  point_count: number
  estimated_percent: number
  warn_percent: number
  reject_percent: number
}

export interface ModbusMappingResponse {
  rows: ModbusMappingRow[]
  errors: ApiValidationDetail[]
  load: ModbusBusLoad[]
}

export interface ModbusProbeResult {
  result: 'ok' | 'fail'
  value?: number
  reason?: string
  exception_code?: number
  elapsed_us?: number
}

export interface ModbusApplyResult {
  result: string
  revision: number
  checksum?: string
  generation?: number
  reload_mode?: 'control' | 'service_restart'
  idempotent?: boolean
  warnings?: string[]
}

export interface ModbusImportError {
  line?: number
  column?: string
  message: string
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

/* ── PA3 Overview read model ─────────────────────────────────────────────────
 *
 * Một snapshot duy nhất cho Landing (PA3-D02). `schemaVersion` là hợp đồng:
 * thấy version lạ thì UI fail-closed, không đoán default — guardrail §10.3.
 */

export const OVERVIEW_SCHEMA_VERSION = 1
export const ACTIVITY_SCHEMA_VERSION = 1

/** Năm trạng thái phân biệt được. `unknown` KHÔNG phải `good`. */
export type OverviewHealthState = 'good' | 'degraded' | 'fault' | 'offline' | 'unknown'
export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type AttentionCategory = 'alarm' | 'communication' | 'quality' | 'forced'
export type AttentionTargetType = 'point' | 'alarm' | 'modbus_device' | 'bus' | 'subsystem'

export interface OverviewController {
  deviceName?: string
  location?: string
  firmware?: string
  webVersion?: string
  ip?: string
  mac?: string
  systemTime?: string
  uptimeS?: number
}

export interface OverviewDomainHealth {
  domain: string
  state: OverviewHealthState
  reasonCode: string
  source: string
  observedAt: string
  detail?: string
  link?: string
}

export interface OverviewAlarmCounts {
  critical: number
  high: number
  medium: number
  low: number
  info: number
  unacked: number
  total: number
}

export interface OverviewPointGroup {
  kind: string
  total: number
  good: number
  uncertain: number
  bad: number
  stale: number
  offline: number
  forced: number
}

export interface OverviewPointSummary {
  total: number
  good: number
  uncertain: number
  bad: number
  stale: number
  offline: number
  forced: number
  groups: OverviewPointGroup[]
}

export interface OverviewAttentionItem {
  id: string
  severity: AttentionSeverity
  category: AttentionCategory
  title: string
  detail?: string
  targetType: AttentionTargetType
  targetId: string
  observedAt?: string
}

export interface OverviewCapabilities {
  digitalInputs: number
  universalInputs: number
  analogOutputs: number
  digitalOutputs: number
  modbusRtuBuses: number
  bacnetIpEnabled: boolean
}

export interface OverviewResponse {
  schemaVersion: number
  generatedAt: string
  controller: OverviewController
  connected: boolean
  /** `null` = không point nào có timestamp thật. KHÔNG được thay bằng giờ hiện tại. */
  lastDataAt: string | null
  overallState: OverviewHealthState
  overallReasonCode: string
  alarms: OverviewAlarmCounts
  points: OverviewPointSummary
  health: OverviewDomainHealth[]
  attention: OverviewAttentionItem[]
  capabilities: OverviewCapabilities
  degraded: string[]
}

export type ActivityKind = 'user' | 'system'

export interface ActivityEvent {
  id: number
  time: string
  kind: ActivityKind
  actor: string
  role?: string
  action: string
  objectType?: string
  objectId?: string
  outcome: string
  reasonCode?: string
  correlationId?: string
  detail?: string
}

export interface ActivityPage {
  schemaVersion: number
  generatedAt: string
  items: ActivityEvent[]
  nextCursor: number | null
  retained: number
  capacity: number
}

export interface ActivityQuery {
  limit?: number
  before?: number
  kind?: ActivityKind
  action?: string
  objectId?: string
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

/* ── Scheduler Engine v3.1 ────────────────────────────────────────────────
 * Authority máy-đọc: contracts/config/schedule_v3_1.schema.json (FROZEN 2026-08-07).
 * Mô hình thanh ghi TSx cũ đã bị loại bỏ hoàn toàn (đặc tả §23).
 *
 * Nguyên tắc S2: cấu hình là Ý ĐỊNH của người dùng, `runtime` là SỰ THẬT do
 * controller trả về. Không component nào được tự tính giá trị hiệu lực.
 */

export type ScheduleValueType = 'BINARY' | 'BOOLEAN' | 'REAL' | 'UNSIGNED' | 'ENUMERATED'

export type ScheduleStatus =
  | 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'ACTIVE'
  | 'INACTIVE' | 'DISABLED' | 'ERROR' | 'OUT_OF_SYNC'

export type ScheduleValueSource = 'WEEKLY' | 'EXCEPTION' | 'DEFAULT'

export type SchedulePointKind = 'AO' | 'DO' | 'AV' | 'BV' | 'MSV' | 'EXT'

export type ScheduleDateRuleType =
  | 'DATE' | 'DATE_RANGE' | 'WEEK_N_DAY' | 'CALENDAR_REFERENCE' | 'HOLIDAY_GROUP'

/** Giá trị lịch: BINARY dùng chuỗi ACTIVE/INACTIVE, BOOLEAN dùng bool, còn lại là số. */
export type ScheduleValue = string | boolean | number

export interface ScheduleTimeValue {
  /** HH:mm:ss theo timezone của lịch. */
  time: string
  value: ScheduleValue
}

/** Luôn đủ bảy ngày, kể cả ngày rỗng (đặc tả §6.1). */
export interface ScheduleWeekly {
  MON: ScheduleTimeValue[]
  TUE: ScheduleTimeValue[]
  WED: ScheduleTimeValue[]
  THU: ScheduleTimeValue[]
  FRI: ScheduleTimeValue[]
  SAT: ScheduleTimeValue[]
  SUN: ScheduleTimeValue[]
}

export type ScheduleDayKey = keyof ScheduleWeekly

export interface ScheduleDateRule {
  type: ScheduleDateRuleType
  date?: string
  start_date?: string
  end_date?: string
  /** 1..12 = tháng cụ thể; 0 = mọi tháng. */
  month?: number
  /** 1..5 = tuần thứ N; 6 = tuần CUỐI (quy ước BACnet), không phải tuần thứ sáu. */
  week_of_month?: number
  /** 1 = Thứ Hai … 7 = Chủ nhật (ISO-8601). */
  day_of_week?: number
  calendar_id?: string
  group_id?: string
}

export interface ScheduleException {
  exception_id: string
  name: string
  date_rule: ScheduleDateRule
  /** 1..16, chỉ phân xử giữa các ngoại lệ. KHÔNG phải priority_for_writing. */
  event_priority: number
  time_values: ScheduleTimeValue[]
}

export interface ScheduleTargetObject {
  target_id: string
  target_type: 'INTERNAL_POINT' | 'BACNET_OBJECT'
  point_kind?: SchedulePointKind
  channel?: number
  point_id?: string
  device_id?: string
  device_instance?: number
  object_type?: string
  object_instance?: number
  property_identifier?: string
  array_index?: number | null
}

export interface ScheduleEffectivePeriod {
  start_date: string | null
  /** null = KHÔNG CÓ ngày kết thúc; giao diện phải nói bằng chữ. */
  end_date: string | null
}

export interface ScheduleTargetRuntime {
  target_id: string
  write_result: 'OK' | 'FAILED' | 'TIMEOUT' | 'SKIPPED' | null
  written_value: ScheduleValue | null
  actual_value: ScheduleValue | null
  /** Nguồn priority cao hơn đang giữ điểm — trả lời "lịch bật mà sao thiết bị không chạy". */
  overridden_by: 'FIRE_SAFETY' | 'LOCAL_MANUAL' | 'BACNET' | 'LOCAL_LOGIC' | null
  error_code: string | null
  last_write_at: string | null
}

/** SỰ THẬT của controller. Thiếu trường nào thì hiển thị gạch ngang, KHÔNG bịa 0. */
export interface ScheduleRuntimeState {
  effective_value: ScheduleValue | null
  value_source: ScheduleValueSource | null
  source_exception_id: string | null
  next_transition_at: string | null
  applied_revision: number | null
  last_evaluated_at: string | null
  error_code: string | null
  targets: ScheduleTargetRuntime[]
}

export interface ScheduleObject {
  schema_version: string
  schedule_id: string
  schedule_name: string
  description?: string
  enabled: boolean
  status: ScheduleStatus
  timezone: string
  effective_period: ScheduleEffectivePeriod
  value_type: ScheduleValueType
  /** 1..16 — phân xử GIỮA CÁC LỊCH cùng ghi một điểm (ADR-023 QĐ-1). */
  priority_for_writing: number
  /** Dẫn xuất, chỉ đọc: mức thật trên bộ phân xử 6 mức mà MỌI lịch dùng chung. */
  core_priority_level: number
  schedule_default: { value: ScheduleValue }
  weekly_schedule: ScheduleWeekly
  exception_schedule: ScheduleException[]
  target_objects: ScheduleTargetObject[]
  bacnet_object?: { object_type: string; object_instance: number; exposed: boolean }
  revision: number
  migrated_from_v1?: boolean
  runtime?: ScheduleRuntimeState | null
  created_at?: string
  created_by?: string
  updated_at?: string
  updated_by?: string
}

export interface ScheduleValidationFinding {
  code: string
  path: string
  message: string
  severity?: 'error' | 'warning'
}

export interface ScheduleValidationResult {
  valid: boolean
  status?: ScheduleStatus
  findings: ScheduleValidationFinding[]
}

export interface SchedulePublishRequest {
  revision: number
  reason: string
  correlation_id?: string
}

export interface SchedulePublishResult {
  result: 'ACCEPTED' | 'REJECTED' | 'TIMEOUT'
  revision: number
  correlation_id?: string
  error_code: string | null
  error_message: string | null
  applied_at: string | null
  attempts?: number
}

export interface ScheduleRevisionInfo {
  revision: number
  created_at: string
  created_by: string
  reason?: string
  published: boolean
  rollback_of: number | null
}

export interface ScheduleSimulateRequest {
  range: '7_DAYS' | '30_DAYS' | 'SPECIFIC_DAY'
  start_date?: string
}

export interface ScheduleSimulateTransition {
  at: string
  source: ScheduleValueSource
  source_exception_id: string | null
  value: ScheduleValue
  target_ids: string[]
  priority_for_writing: number
}

export interface ScheduleSimulateResult {
  transitions: ScheduleSimulateTransition[]
  conflicts: ScheduleValidationFinding[]
  gaps: { from: string; to: string }[]
}

export interface ScheduleAuditEntry {
  at: string
  actor: string
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VALIDATE' | 'PUBLISH' | 'ENABLE' | 'DISABLE' | 'ROLLBACK' | 'MIGRATE'
  schedule_id: string
  revision_before: number | null
  revision_after: number | null
  reason?: string
  changes?: string
  controller_id?: string
  result?: string
  error_code: string | null
  source_ip?: string
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
