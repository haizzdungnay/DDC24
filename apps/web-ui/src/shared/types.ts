import type { ActivationReport } from './api/activation'
export type PointKind = 'UI' | 'AI' | 'DI' | 'AO' | 'DO' | 'virtual' | 'modbus_rtu'
/* `ISS-PIO-35`: nguồn sự thật là `api/quality.ts`, vốn được kiểm hai chiều với
 * `contracts/quality/point_quality_v1.json`. Khai lại bằng tay ở đây từng là
 * cách `unknown` và `config_error` biến mất khỏi kiểu rồi bị hạ về `good`. */
import type { PointQuality } from './api/quality'
export type { PointQuality }
export type HealthStatus = 'ok' | 'degraded' | 'fault' | 'unknown' | 'n/a'
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
export type DdcMode = 'demo' | 'live'
/* `WEB-RBAC-001` — bốn vai. `engineer` nằm giữa `operator` và `admin`: cấu hình
 * được thiết bị và đưa chương trình vào vận hành, nhưng KHÔNG quản lý được tài
 * khoản hay cơ sở dữ liệu. Xem ma trận ở `apps/web-api/internal/auth`. */
export type UserRole = 'admin' | 'engineer' | 'operator' | 'viewer'
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
  /** `ISS-PIO-16` — với điểm ảo, AI SỞ HỮU slot (`WEB` / `PROGRAM`).
   *
   *  Khác `source` ngay trên: `source` là nguồn của MẪU ĐO hiện tại, còn
   *  `virtualSource` là chủ sở hữu đã cấu hình. Giao diện cần nó để giải thích
   *  vì sao nút Write bị khoá; `writable` một mình chỉ nói "không được", không
   *  nói "vì sao". Vắng mặt với mọi điểm không phải VP. */
  virtualSource?: VirtualPointSource
  priority?: string
  /** `undefined` = producer KHÔNG cấp mốc thời gian.
   *
   *  PA3-F04: bản trước điền `nowIso()` vào chỗ này, nên một point không ai
   *  biết cập nhật lúc nào lại hiện "vừa xong" — chính xác là kiểu dối trá mà
   *  người trực ca không có cách nào phát hiện. Nơi hiển thị phải ra `—`. */
  updatedAt?: string
  fault?: boolean
  forced?: boolean
  /** `T57-3.1` (`ADR-042`) — thiết bị công nghệ mà điểm thuộc về (AHU-1…).
   *  Rỗng/thiếu ⇒ nhóm "Chưa gán"; CẤM đoán từ tên điểm. */
  equipment?: string
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
  /** `T57-3.17` (`ADR-047`) — phiên đang bị buộc đổi mật khẩu. Backend chặn mọi
   *  endpoint khác bằng `403 password_change_required`; cờ này chỉ để giao diện
   *  nói đúng NGUYÊN NHÂN thay vì hiện một lỗi quyền chung chung. */
  mustChangePassword?: boolean
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
  /** Mốc ISO-8601 UTC. Backend lọc theo khoảng; FE không tự cắt sau khi tải,
   *  vì cắt ở FE chỉ giấu bớt dòng chứ không đưa người dùng tới đúng thời điểm
   *  cần xem khi kho sự kiện dài hơn một trang. */
  from?: string
  to?: string
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
  /* `ISS-PIO-33`: bước Read-back Verify. Vắng mặt KHÔNG có nghĩa là "đã xác
   * nhận" — xem `activationWarning` ở `shared/api/activation.ts`. */
  activation?: ActivationReport
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
  /** ISS-PIO-26 — thời hạn ĐÃ YÊU CẦU cho lệnh test (giây). */
  ttlS?: number
  /** Thời hạn CÒN LẠI do Core báo. `undefined` nghĩa là Core không báo, KHÁC
   *  hẳn "còn 0 giây" — không được đếm ngược khi trường này vắng. */
  expiresInS?: number
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
  /** Cặp `[min, max]` cho dải aggregate (khoá `<series>::band`) là lý do duy
   *  nhất có `number[]` ở đây; recharts đọc thẳng tuple này để vẽ vùng. */
  [series: string]: string | number | number[] | null
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
  mustChangePassword?: boolean
}

/** Chỉ số hệ alarm ISA-18.2 §16 — `T57-3.3`. */
export interface AlarmMetrics {
  window: string
  windowS: number
  /** Nhịp trong 10 phút gần nhất — con số so trực tiếp với ngưỡng flood. */
  rate10m: number
  ratePerHour: number
  totalRaised: number
  /** Quá 10 cảnh báo trong 10 phút theo ISA-18.2. */
  flooding: boolean
  topRepeating: Array<{ alarmId: string; name?: string; count: number }>
  shelved: Array<{ alarmId: string; name?: string; shelvedAt: string }>
}

/** Kết quả mô phỏng luật cảnh báo — `T57-2.13`. Engine là binary Core. */
export interface AlarmSimulateResult {
  events: Array<{ at: string; event: string; severity?: string; value: number; reason?: string }>
  engine: string
}

/** Một giao dịch Modbus đã thực hiện — `T57-3.9`.
 *
 *  `ADR-046` bản sửa 2026-08-19: Rev A ghi BẢN GHI GIAO DỊCH, không có byte thô.
 *  Vòng nhớ nằm trong tiến trình iobus nên MẤT khi restart — giao diện phải nói
 *  ra, không được mô tả như nhật ký lưu trữ. */
export interface ModbusFrame {
  at: number
  bus: number
  slave: number
  fc: number
  addr: number
  count: number
  ok: boolean
  reason: string
  elapsedUs: number
  attempt: number
}

export interface ModbusFramesResponse {
  schemaVersion: number
  bus: number
  frames: ModbusFrame[]
  volatile: boolean
  rawBytes: boolean
}

/** Mẫu thiết bị Modbus dựng sẵn — `T57-3.11`.
 *
 *  `source` là BẮT BUỘC ở backend: mẫu không nói được nó đến từ đâu thì không
 *  được hiển thị. Giao diện phải hiện `source` cạnh mẫu, vì người dùng sẽ tin
 *  mẫu hơn tin tài liệu. */
export interface ModbusTemplatePoint {
  name: string
  fc: number
  addr: number
  count: number
  type: string
  byte_order?: string
  scale?: number
  offset?: number
  unit?: string
  writable?: boolean
}

export interface ModbusTemplate {
  id: string
  name: string
  manufacturer?: string
  description?: string
  source: string
  origin: 'builtin' | 'site' | string
  points: ModbusTemplatePoint[]
}

/** Kiểm kết nối sau khi apply mạng — `T57-3.18`.
 *
 *  `unknown` KHÁC `unreachable`: gộp hai thứ này lại sẽ khiến người dùng rollback
 *  một cấu hình hoàn toàn đúng chỉ vì thiết bị thiếu công cụ chẩn đoán. */
export interface NetworkCheckTarget {
  kind: 'gateway' | 'dns' | 'dns_resolve' | string
  host: string
  state: 'ok' | 'unreachable' | 'unknown'
  detail?: string
  rttMs?: number
}

export interface NetworkCheckResponse {
  checkedAt: string
  targets: NetworkCheckTarget[]
  summary: 'ok' | 'degraded' | 'unknown'
}

/** Ước lượng tần suất cảnh báo từ lịch sử điểm — `T57-3.13`. */
export interface AlarmEstimateResult {
  pointId: string
  days: number
  samplesAvailable: number
  samplesUsed: number
  /** Bước lấy mẫu sau hạ tần: đỉnh ngắn hơn khoảng này KHÔNG được nhìn thấy. */
  stepS: number
  raises: number
  raisesPerDay: number
  downsampled: boolean
  engine: string
}

/** Hiệu lực thực tế của lịch trên một điểm — `T57-3.5`/`T57-3.6`/`T57-3.7`. */
export interface ScheduleEffectiveSegment {
  from: string
  to: string
  value: unknown
  scheduleId?: string
  scheduleName?: string
  priority?: number
  reason?: string
}

export interface ScheduleEffectiveResponse {
  pointId: string
  from: string
  to: string
  segments: ScheduleEffectiveSegment[]
  conflicts: Array<{ at: string; scheduleIds: string[]; winnerId: string; detail?: string }>
  engine: string
}

/** Lịch sử sức khoẻ máy chủ 60 phút — `T57-3.4`. */
export interface SystemHistorySample {
  at: string
  cpuPercent: number | null
  ramPercent: number | null
  tempC: number | null
}

export interface SystemHistoryResponse {
  windowS: number
  intervalS: number
  /** Vòng nhớ chỉ có từ lần khởi động dịch vụ web gần nhất. */
  sinceRestart: string
  samples: SystemHistorySample[]
}

/** Tham chiếu tới một điểm ảo — `T57-3.12`. */
export interface VirtualPointReference {
  kind: 'alarm' | 'schedule' | 'program' | string
  id: string
  name?: string
  detail?: string
}

export interface VirtualPointUsage {
  pointId: string
  tag?: string
  references: VirtualPointReference[]
  /** Phạm vi đã quét — danh sách rỗng chỉ có nghĩa khi biết đã quét những gì. */
  scanned: string[]
  /** Có nguồn không đọc được ⇒ danh sách KHÔNG đầy đủ. */
  incomplete: boolean
  errors?: string[]
}

/** Một dòng soát truy cập tài khoản — `T57-3.16`. */
export interface UserAccessRow extends UserAccount {
  /** `null` = KHÔNG tìm thấy vết trong kho Activity. Có thể vì chưa từng đăng
   *  nhập, cũng có thể vì vết đã bị đẩy khỏi vòng nhớ 2000 sự kiện — giao diện
   *  phải nói "không rõ", không được nói "chưa đăng nhập bao giờ". */
  lastLoginAt: string | null
  lastLoginRemote: string | null
  lastFailedLoginAt: string | null
  activeSessions: number
}

export interface UserSession {
  username: string
  role: UserRole
  issuedAt: string
  lastSeenAt: string
  remote?: string
}

export interface UserAccessResponse {
  users: UserAccessRow[]
  sessions: UserSession[]
  /** Sổ phiên nằm trong bộ nhớ tiến trình nên chỉ nói được từ mốc này trở đi. */
  sessionsSince: string
  activityWindow: number
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
  /** Chuỗi `type`/`unit` gốc từ `io_config.conf` (vd `NTC20k`, `PT1000`, `RPM`) —
   *  FE chưa có control chọn biến thể riêng nên giữ nguyên khi round-trip thay
   *  vì tự ý hạ cấp về giá trị mặc định của nhóm signalType. Xem
   *  `REV-UI-CFG-GAP-2026-08-14` finding `F-UI-CFG-002`. */
  ioType?: string
  ioUnit?: string
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

/* `ISS-PIO-25` — AoConfig/DoConfig chỉ khai những trường CÓ NGƯỜI ĐỌC.
 *
 * TRIỆU CHỨNG: hai interface này từng khai 26 trường phụ (`minHeatOutput`,
 * `piSeqLowerFan1`, `switchOnDelay`, `pwmCycleTime`, `runtimeAlarmHours`, …).
 * `grep` cho mỗi trường ra ĐÚNG một kết quả — chính dòng khai báo — cộng với các
 * literal buộc phải điền vì trường là bắt buộc. Không form nào ghi, không backend
 * nào đọc, `renderOutputField` trả `null` cho tất cả.
 *
 * VÌ SAO PHẢI XOÁ CHỨ KHÔNG ĐỂ ĐÓ: một interface là lời hứa. Ai đọc
 * `pwmCycleTime` trong `DoConfig` sẽ tin rằng đặt nó vào sẽ đổi chu kỳ PWM của
 * kênh — trong khi `grep -rn "pwm" apps/iobus apps/core` ra 0 kết quả, tức
 * firmware KHÔNG có khái niệm đó. Bề mặt hợp đồng hứa một tính năng không tồn
 * tại thì tệ hơn là không hứa gì.
 *
 * NGUỒN CHUẨN cho việc trường nào có thật: `internal/configschema` phía Go, gói
 * này liệt kê đúng các key firmware đọc (`iobus_config.cpp`,
 * `safe_state_config.cpp`). AO đọc `ch/mode/units/min_pv/max_pv` + metadata
 * điểm; DO đọc `ch` + metadata; `safe` nằm ở `safe_state.conf`.
 * `outputsContract.test.ts` canh cho hai bên không lệch lại.
 *
 * `manualValue` KHÔNG phải cấu hình và vẫn ở lại: nó là giá trị soạn cho nút ép
 * tay, đi thẳng `apiClient.forceOutput` → `PUT /points/{id}`, không đi qua đường
 * lưu cấu hình. Giữ đúng vì nó CÓ đường xuống thiết bị thật.
 *
 * Nếu sau này cần ramp/min-on-time/PWM thật thì thêm lại TỪ DƯỚI LÊN: firmware
 * trước, `configschema` sau, rồi mới tới đây — chứ không phải khai trước ở TS
 * rồi chờ ai đó hiện thực hoá.
 */
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
  /** Giá trị soạn cho nút ép tay (phần trăm full-scale). Không lưu vào cấu hình. */
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
  /** Giá trị soạn cho nút ép tay. Không lưu vào cấu hình — xem chú thích AoConfig. */
  manualValue: boolean
  note?: string
  demoNote?: OutputDemoNote
}

export interface OutputsConfig {
  ao: AoConfig[]
  do: DoConfig[]
}

export type VirtualPointRestartPolicy = 'retain' | 'initial'

export type VirtualPointSignalType = 'boolean' | 'integer' | 'float' | 'string' | 'datetime'

/** `ISS-PIO-16` — hai chủ sở hữu hợp lệ của một slot điểm ảo. */
export type VirtualPointSource = 'WEB' | 'PROGRAM'

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
  /** Thang HIỂN THỊ — chỉ nói đồ thị vẽ từ đâu tới đâu, KHÔNG chặn lệnh ghi. */
  displayMin?: number
  displayMax?: number
  /** `ISS-PIO-15` — biên KỸ THUẬT của điểm, tách khỏi thang hiển thị ở trên.
   *
   *  `displayMin`/`displayMax` là thang vẽ; chúng không từ chối một lệnh ghi
   *  45 °C vào setpoint khai dải làm việc 16–30 °C. Hai trường này thì có: API
   *  TỪ CHỐI lệnh ghi ngoài dải với 400 và KHÔNG kẹp về biên — kẹp im lặng trả
   *  200 cho một lệnh đã bị đổi nghĩa.
   *
   *  `undefined` = KHÔNG khai báo (cấu hình đang chạy giữ nguyên hành vi cũ).
   *  Chỉ có nghĩa với `signalType` `integer`/`float`. */
  minValue?: number
  maxValue?: number
  rangeMultiplier?: number
  filterSamples?: number
  sensorCal?: number
  mathFunction?: number
  note?: string
  updatedAt?: string
  namespaceState?: string
  generation?: number
  /** `ISS-PIO-16` — AI SỞ HỮU slot của điểm ảo (F-PIO-017, đề bài §16).
   *
   *  Tách hẳn khỏi `writable`, và hai trục trả lời hai câu khác nhau:
   *    `writable` — operator có được phép sửa giá trị từ dashboard không;
   *    `source`   — ai GHI slot: web-api (`WEB`) hay chương trình ST (`PROGRAM`).
   *
   *  `PROGRAM` nghĩa là chương trình ghi slot này mỗi chu kỳ, nên web-api không
   *  ghi vào và mọi lệnh ghi tay đều bị từ chối — kể cả khi `writable: true`.
   *  Không phơi trục này ra là để người kỹ sư nhìn một điểm "chỉ đọc" mà không
   *  có manh mối nào vì sao.
   *
   *  Backend luôn chuẩn hoá về `WEB`/`PROGRAM` khi đọc, nên giao diện không phải
   *  đoán nghĩa của chuỗi rỗng. */
  source?: VirtualPointSource
  /** `ISS-PIO-14` — giá trị điểm sau khi bộ điều khiển khởi động lại (đề bài §13).
   *
   *  `retain`  giữ giá trị cuối cùng (mặc định, và là hành vi cũ).
   *  `initial` quay về `initialValue`.
   *
   *  Vắng mặt nghĩa là cấu hình đời cũ ⇒ đọc thành `retain`. */
  restartPolicy?: VirtualPointRestartPolicy
  /** Giá trị khởi tạo, TÁCH khỏi `value`.
   *
   *  Lệnh ghi runtime cập nhật `value` nhưng KHÔNG chạm vào trường này — đó là
   *  toàn bộ lý do nó tồn tại. Trước `ISS-PIO-14`, một trường gánh cả hai nghĩa
   *  nên giá trị khởi tạo biến mất ngay lần ghi đầu tiên. */
  initialValue?: number | boolean | string
  /** `ISS-PIO-03` — slot Core mà VP này chiếm (`AV-01`…`AV-32`, `BV-01`…`BV-16`).
   *
   *  Backend cấp tự động theo `signalType` khi tạo. Vắng mặt nghĩa là kiểu tín
   *  hiệu KHÔNG có slot ở Core (`string`, `datetime`) — VP vẫn dùng được như
   *  overlay cấu hình, nhưng **không map được vào biến chương trình**, và giao
   *  diện phải nói ra điều đó thay vì để người dùng đoán vì sao điểm của họ
   *  không xuất hiện ở tab Ánh xạ. */
  boundPointId?: string
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
