import type {
  Alarm,
  AlarmSetting,
  AiInputConfig,
  DiInputConfig,
  CommissioningTestResult,
  Graph,
  GraphLink,
  GraphValidationResult,
  HealthResponse,
  IoChannel,
  NetworkData,
  Point,
  ScheduleRow,
  TrendSample,
  UserRow
} from '../types'
import { DEVICE_DEFAULTS } from '../config'
import { clamp, nowIso, pointNumber } from '../utils'

const startedAt = Date.now() - 12 * 86400_000 - 4 * 3600_000 - 32 * 60_000

const names: Record<string, string> = {
  'DI-01': 'EMERGENCY STOP',
  'DI-02': 'DOOR SWITCH',
  'DI-03': 'HIGH PRESS SWITCH',
  'DI-04': 'LOW PRESS SWITCH',
  'DI-05': 'FLOW SWITCH',
  'DI-06': 'FAN STATUS',
  'DI-07': 'FILTER DIRTY',
  'DI-08': 'FIRE ALARM',
  'DO-01': 'PUMP START',
  'DO-02': 'FAN START',
  'DO-03': 'VALVE OPEN',
  'DO-04': 'ALARM BUZZER',
  'DO-05': 'HEATER ON',
  'DO-06': 'COOLER ON',
  'DO-07': 'LIGHT',
  'DO-08': 'SPARE',
  'AI-01': 'SUPPLY AIR TEMP',
  'AI-02': 'DUCT PRESSURE',
  'AI-03': 'ROOM HUMIDITY',
  'AI-04': 'OUTDOOR TEMP',
  'AO-01': 'VFD SPEED',
  'AO-02': 'HEATING VALVE',
  'AO-03': 'COOLING VALVE',
  'AO-04': 'DAMPER POSITION'
}

const basePoints: Point[] = [
  ...Array.from({ length: 8 }, (_, i) => {
    const id = `DI-${String(i + 1).padStart(2, '0')}`
    return { id, name: names[id], kind: 'DI' as const, value: i === 0 || i === 4, quality: 'good' as const, source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'Dry Contact' }
  }),
  ...Array.from({ length: 8 }, (_, i) => {
    const id = `DO-${String(i + 1).padStart(2, '0')}`
    return { id, name: names[id], kind: 'DO' as const, value: i < 3, quality: 'good' as const, source: 'Core', priority: 'Schedule', updatedAt: nowIso(), sensorType: 'Relay' }
  }),
  { id: 'AI-01', name: names['AI-01'], kind: 'AI', value: 23.7, unit: 'C', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'NTC10k' },
  { id: 'AI-02', name: names['AI-02'], kind: 'AI', value: 6.2, unit: 'bar', quality: 'uncertain', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: '4-20mA' },
  { id: 'AI-03', name: names['AI-03'], kind: 'AI', value: 54.2, unit: '%RH', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AI-04', name: names['AI-04'], kind: 'AI', value: 18.6, unit: 'C', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'PT100' },
  { id: 'AO-01', name: names['AO-01'], kind: 'AO', value: 62.5, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AO-02', name: names['AO-02'], kind: 'AO', value: 35, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AO-03', name: names['AO-03'], kind: 'AO', value: 12.5, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AO-04', name: names['AO-04'], kind: 'AO', value: 45, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' }
]

let points: Point[] = basePoints.map((point) => ({ ...point, trend: makeTrend(pointNumber(point)) }))

const alarms: Alarm[] = [
  { id: 'AL-001', time: '2025-05-23T14:31:02Z', severity: 'critical', status: 'active', message: 'DI-01 Emergency Stop', source: 'DI-01', value: 'ON', detail: 'Nút dừng khẩn cấp đang kích hoạt' },
  { id: 'AL-002', time: '2025-05-23T14:29:45Z', severity: 'high', status: 'active', message: 'AI-02 Pressure High', source: 'AI-02', value: '9.8 bar', detail: 'Áp suất vượt ngưỡng 5.0 bar' },
  { id: 'AL-003', time: '2025-05-23T14:27:18Z', severity: 'info', status: 'acked', message: 'DO-03 Pump Start', source: 'DO-03', value: 'ON', detail: 'Trạng thái ON' },
  { id: 'AL-004', time: '2025-05-23T14:25:03Z', severity: 'info', status: 'acked', message: 'SYSTEM', source: 'SYSTEM', value: 'admin', detail: 'Đăng nhập bởi admin' },
  { id: 'AL-005', time: '2025-05-23T14:20:11Z', severity: 'info', status: 'acked', message: 'COMMUNICATION', source: 'SYSTEM', value: 'OK', detail: 'Modbus RTU kết nối thành công' }
]

function makeTrend(base: number): number[] {
  return Array.from({ length: 18 }, (_, i) => Number((base + Math.sin(i / 2) * 4 + (Math.random() - 0.5) * 2).toFixed(1)))
}

function jitter(point: Point): Point {
  const updatedAt = nowIso()
  if (point.kind === 'AI' || point.kind === 'AO') {
    const spread = point.kind === 'AI' ? 1.2 : 2.5
    const next = clamp(pointNumber(point) + (Math.random() - 0.48) * spread, 0, point.unit === 'bar' ? 12 : 100)
    const trend = [...(point.trend ?? []), Number(next.toFixed(1))].slice(-18)
    return { ...point, value: Number(next.toFixed(1)), trend, updatedAt }
  }
  if (Math.random() < 0.025 && point.id !== 'DI-01') {
    return { ...point, value: !point.value, updatedAt }
  }
  return { ...point, updatedAt }
}

export function tickDemoPoints(): Point[] {
  points = points.map(jitter)
  return getDemoPoints()
}

export function getDemoPoints(): Point[] {
  return points.map((point) => ({ ...point, trend: [...(point.trend ?? [])] }))
}

export function getDemoHealth(): HealthResponse {
  return {
    overall: 'ok',
    cpuPercent: 23,
    ramPercent: 48,
    ramUsedMb: 3100,
    ramTotalMb: 8192,
    tempC: 38.6,
    uptimeS: Math.floor((Date.now() - startedAt) / 1000),
    firmware: 'v1.3.7',
    deviceName: 'DDC24-AC',
    deviceIp: '192.168.1.100',
    bacnetDeviceId: '47808',
    services: {
      core: { status: 'ok', uptime_s: 604800, last_scan_ms: 8 },
      iobus: { status: 'ok', uptime_s: 604700, last_scan_ms: 12 },
      web: { status: 'ok', uptime_s: 604600, last_scan_ms: 3 },
      IOP: { status: 'ok', uptime_s: 604500, last_scan_ms: 15 },
      bacnet: { status: 'ok', uptime_s: 604300, last_scan_ms: 18 }
    }
  }
}

export function getDemoChannels(): IoChannel[] {
  return getDemoPoints().map((point) => ({
    id: `CH-${point.id}`,
    pointId: point.id,
    kind: point.kind,
    label: point.name,
    signal: point.sensorType ?? 'Virtual',
    range: point.kind === 'AI' || point.kind === 'AO' ? '0-100' : 'ON/OFF',
    safeState: point.kind === 'AO' || point.kind === 'DO' ? 'OFF' : 'n/a'
  }))
}

export function getDemoAlarms(): Alarm[] {
  return alarms.map((alarm) => ({ ...alarm }))
}

export function getAlarmSettings(): AlarmSetting[] {
  return [
    { pointId: 'AI-01', label: 'Supply Air Temp', enabled: true, hh: 32, h: 28, l: 16, ll: 12, delayS: 10, priority: 'high', alarmType: 1, sourcePointId: 'AI-01', ackDelayS: 0, interlock: false },
    { pointId: 'AI-02', label: 'Duct Pressure', enabled: true, hh: 9.5, h: 8, l: 2, ll: 1, delayS: 5, priority: 'critical', alarmType: 2, sourcePointId: 'AI-02', ackDelayS: 60, interlock: false },
    { pointId: 'DO-01', label: 'Supply Fan', enabled: true, hh: 0, h: 0, l: 0, ll: 0, delayS: 3600, priority: 'medium', alarmType: 3, sourcePointId: 'DO-01', ackDelayS: 0, interlock: true },
    { pointId: 'DO-02', label: 'Exhaust Fan', enabled: true, hh: 0, h: 0, l: 0, ll: 0, delayS: 10, priority: 'critical', alarmType: 4, sourcePointId: 'DO-02', ackDelayS: 0, interlock: true },
    { pointId: 'DO-03', label: 'Pump', enabled: true, hh: 0, h: 0, l: 0, ll: 0, delayS: 5, priority: 'medium', alarmType: 5, sourcePointId: 'DO-03', ackDelayS: 0, interlock: false },
    { pointId: 'AO-01', label: 'VFD Speed', enabled: true, hh: 100, h: 92, l: 10, ll: 0, delayS: 15, priority: 'medium', alarmType: 6, sourcePointId: 'AO-01', ackDelayS: 0, interlock: false },
    { pointId: 'AI-03', label: 'Room Humidity', enabled: true, hh: 75, h: 65, l: 35, ll: 25, delayS: 30, priority: 'medium', alarmType: 7, sourcePointId: 'AI-03', ackDelayS: 0, interlock: false },
    { pointId: 'AI-04', label: 'Outdoor Temp', enabled: false, hh: 42, h: 38, l: 5, ll: 0, delayS: 60, priority: 'low', alarmType: 0, sourcePointId: '', ackDelayS: 0, interlock: false }
  ]
}

export function ackDemoAlarm(id: string): Alarm[] {
  const target = alarms.find((alarm) => alarm.id === id)
  if (target) target.status = 'acked'
  return getDemoAlarms()
}

export function forceDemoPoint(id: string, value: number | boolean, release = false) {
  points = points.map((point) => point.id === id ? { ...point, value, forced: !release, source: release ? 'Core' : 'Local manual', priority: release ? 'Auto' : 'Manual override', updatedAt: nowIso() } : point)
  return { result: 'accepted' as const, applied_value: value, active_source: release ? 'core' : 'local_manual' }
}

export function runDemoCommissioning(pointId: string, value: number | boolean): CommissioningTestResult {
  forceDemoPoint(pointId, value)
  return { result: 'passed', pointId, appliedValue: value, message: 'Command accepted by demo core', scanMs: 12 }
}

export function getTrendSamples(pointIds: string[] = ['AI-01', 'AI-02', 'AI-03', 'AI-04'], rangeMinutes = 30): TrendSample[] {
  const tracked = pointIds.filter((id) => points.some((point) => point.id === id && (point.kind === 'AI' || point.kind === 'AO')))
  const sampleCount = rangeMinutes <= 30 ? 18 : rangeMinutes <= 60 ? 24 : rangeMinutes <= 360 ? 36 : 48
  const stepMs = (rangeMinutes * 60_000) / Math.max(1, sampleCount - 1)
  const now = Date.now()
  return Array.from({ length: sampleCount }, (_, i) => {
    const offset = sampleCount - 1 - i
    const timestamp = new Date(now - offset * stepMs)
    const sample: TrendSample = { time: timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
    for (const id of tracked) {
      const point = points.find((item) => item.id === id)
      const base = pointNumber(point ?? points[0])
      const amplitude = point?.kind === 'AO' ? 8 : point?.unit === 'bar' ? 0.8 : 5
      const wave = Math.sin((i / Math.max(1, sampleCount - 1)) * Math.PI * 4 + id.length) * amplitude
      const slowDrift = Math.cos((offset / sampleCount) * Math.PI * 2 + id.charCodeAt(id.length - 1)) * amplitude * 0.35
      const historical = point?.trend?.[i % (point.trend.length || 1)] ?? base
      sample[id] = Number((historical * 0.35 + (base + wave + slowDrift) * 0.65).toFixed(1))
    }
    return sample
  })
}

export function getDemoSchedule(): ScheduleRow[] {
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  return ['AHU-01', 'PUMP-01', 'LIGHT-01', 'FAN-01', 'VLV-01'].map((id, rowIndex) => ({
    id,
    label: ['Air Handling Unit', 'Chilled Water Pump', 'Lobby Light', 'Exhaust Fan', 'Water Valve'][rowIndex],
    cells: days.map((day) => ({ day, value: (['ON', 'ON', 'ON', 'ON', 'OPEN'] as const)[rowIndex], start: rowIndex === 2 ? '18:00' : '06:00', end: rowIndex === 2 ? '06:00' : '18:00' }))
  }))
}

export function getDemoNetwork(): NetworkData {
  return {
    northbound: {
      deviceName: DEVICE_DEFAULTS.name,
      ip: DEVICE_DEFAULTS.ip,
      dhcp: false,
      wifiEnabled: true,
      subnet: '255.255.255.0',
      gateway: '192.168.1.1',
      bacnetDeviceId: DEVICE_DEFAULTS.bacnetDeviceId,
      bacnetDeviceName: DEVICE_DEFAULTS.name,
      bacnetPort: 47808,
      bmsLink: 'online'
    },
    southbound: [
      { address: 1, name: 'KINEXUS-EXT-IO-01', profile: 'EXT I/O', baudRate: 38400, pollState: 'online', errorRate: 0.2, lastPollMs: 18 },
      { address: 5, name: 'REMOTE-HMI-Lobby', profile: 'Remote HMI', baudRate: 38400, pollState: 'online', errorRate: 0.5, lastPollMs: 24 },
      { address: 12, name: 'PM-212 Energy Meter', profile: 'Meter', baudRate: 9600, pollState: 'degraded', errorRate: 3.8, lastPollMs: 75 },
      { address: 21, name: 'VFD-SupplyFan-01', profile: 'VFD', baudRate: 19200, pollState: 'online', errorRate: 0.9, lastPollMs: 31 },
      { address: 34, name: 'VFD-Exhaust-Standby', profile: 'VFD', baudRate: 19200, pollState: 'offline', errorRate: 100, lastPollMs: 0 }
    ]
  }
}

export function getDemoUsers(): UserRow[] {
  return [
    { username: 'admin', fullName: 'Administrator', role: 'admin', online: true },
    { username: 'operator1', fullName: 'Operator One', role: 'operator', online: true },
    { username: 'operator2', fullName: 'Operator Two', role: 'operator', online: true },
    { username: 'guest', fullName: 'Guest User', role: 'viewer', online: false },
    { username: 'maintenance', fullName: 'Maintenance', role: 'operator', online: true }
  ]
}

type GraphError = GraphValidationResult['errors'][number]
type JsonRecord = Record<string, unknown>

const inferredInputs: Record<string, string[]> = {
  AO_Output: ['in'],
  DO_Output: ['in'],
  Scale: ['in'],
  Limit: ['in'],
  PID: ['pv', 'sp'],
  Compare: ['a', 'b'],
  Hysteresis: ['in']
}

export function validateGraphLocal(input: unknown): GraphValidationResult {
  const parsed = parseGraphInput(input)
  if (!parsed.ok) return { pass: false, errors: [{ path: '$', message: parsed.message, severity: 'error' }] }

  const graph = parsed.graph
  const errors: GraphError[] = []
  const nodes = readRecordArray(graph.nodes)
  const links = readRecordArray(graph.links)

  if (!Array.isArray(graph.nodes)) errors.push({ path: '$.nodes', message: 'Thiếu nodes[] trong graph.json', severity: 'error' })
  if (!Array.isArray(graph.links)) errors.push({ path: '$.links', message: 'Thiếu links[] trong graph.json', severity: 'error' })

  nodes.forEach((node, index) => {
    const id = stringField(node, 'id')
    const type = stringField(node, 'type')
    if (!id) errors.push({ path: `$.nodes[${index}].id`, message: 'Node thiếu id', severity: 'error' })
    if (!type) errors.push({ path: `$.nodes[${index}].type`, message: 'Node thiếu type', severity: 'error' })
  })

  const incoming = new Map<string, GraphLink[]>()
  links.forEach((link, index) => {
    const from = stringField(link, 'from')
    const to = stringField(link, 'to')
    if (!from || !to) {
      errors.push({ path: `$.links[${index}]`, message: 'Link phải có from/to dạng node.port', severity: 'error' })
      return
    }
    incoming.set(to, [...(incoming.get(to) ?? []), { from, to }])
  })

  nodes.forEach((node, index) => {
    const id = stringField(node, 'id')
    if (!id) return
    inputPorts(node).forEach((port) => {
      const target = `${id}.${port}`
      const writers = incoming.get(target) ?? []
      if (writers.length === 0) {
        errors.push({ path: `$.nodes[${index}].inputs.${port}`, message: `Input ${target} chưa nối`, severity: 'error' })
      }
      if (writers.length > 1) {
        errors.push({ path: `$.links.to:${target}`, message: `Port ${target} bị nhiều nguồn ghi (${writers.length} writers)`, severity: 'error' })
      }
    })
  })

  for (const [target, writers] of incoming.entries()) {
    if (writers.length > 1 && !errors.some((error) => error.path === `$.links.to:${target}`)) {
      errors.push({ path: `$.links.to:${target}`, message: `Port ${target} nhận nhiều nguồn ghi (${writers.length} writers)`, severity: 'error' })
    }
  }

  const ioMap = isRecord(graph.io_map) ? graph.io_map : {}
  const aiNodes = mapIoNodes(readRecordArray(ioMap.ai))
  const aoNodes = mapIoNodes(readRecordArray(ioMap.ao))
  const doNodes = mapIoNodes(readRecordArray(ioMap.do))

  nodes.forEach((node, index) => {
    const id = stringField(node, 'id')
    if (!id) return
    const ioAo = aoNodes.get(id)
    if (isAoNode(node) || ioAo) {
      if (!hasLimitPair(node) && !hasLimitPair(getRecord(node, 'params')) && !hasLimitPair(getRecord(node, 'config')) && (!ioAo || !hasLimitPair(ioAo))) {
        errors.push({ path: `$.nodes[${index}].params`, message: `AO ${id} thiếu limit min/max`, severity: 'error' })
      }
    }
    if ((isSensorNode(node) || aiNodes.has(id)) && !hasFallbackOrSafe(node) && !hasFallbackOrSafe(aiNodes.get(id))) {
      errors.push({ path: `$.nodes[${index}].fallback`, message: `Sensor ${id} thiếu fallback/safe-state`, severity: 'error' })
    }
    if ((isOutputNode(node) || aoNodes.has(id) || doNodes.has(id)) && !hasFallbackOrSafe(node) && !hasPowerOn(node) && !hasFallbackOrSafe(aoNodes.get(id)) && !hasFallbackOrSafe(doNodes.get(id))) {
      errors.push({ path: `$.nodes[${index}].power_on`, message: `Output ${id} thiếu safe-state/power_on`, severity: 'error' })
    }
  })

  for (const section of ['rtu', 'tcp'] as const) {
    const devices = readRecordArray(getRecord(graph.modbus, section))
    devices.forEach((device, deviceIndex) => {
      readRecordArray(device.points).forEach((point, pointIndex) => {
        if (!hasFallbackOrSafe(point)) {
          errors.push({ path: `$.modbus.${section}[${deviceIndex}].points[${pointIndex}].fallback`, message: `Modbus point ${stringField(point, 'node') || pointIndex} thiếu fallback`, severity: 'error' })
        }
      })
    })
  }

  return { pass: errors.length === 0, errors }
}

function parseGraphInput(input: unknown): { ok: true; graph: Partial<Graph> & JsonRecord } | { ok: false; message: string } {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input
    if (!isRecord(value)) return { ok: false, message: 'graph.json phải là object JSON' }
    return { ok: true, graph: value as Partial<Graph> & JsonRecord }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'JSON parse failed' }
  }
}

function inputPorts(node: JsonRecord): string[] {
  const ports = getRecord(node, 'ports')
  const explicit = [...portNames(ports.inputs), ...portNames(node.inputs)]
  if (explicit.length > 0) return [...new Set(explicit)]
  const type = stringField(node, 'type')
  if (inferredInputs[type]) return inferredInputs[type]
  const lower = type.toLowerCase()
  if (lower.includes('pid')) return ['pv', 'sp']
  if ((lower.includes('ao') || lower.includes('do')) && lower.includes('output')) return ['in']
  if (lower.includes('scale') || lower.includes('limit') || lower.includes('filter')) return ['in']
  return []
}

function portNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : isRecord(item) ? stringField(item, 'name') : '').filter(Boolean)
}

function mapIoNodes(items: JsonRecord[]): Map<string, JsonRecord> {
  const entries: Array<[string, JsonRecord]> = []
  items.forEach((item) => {
    const id = stringField(item, 'node')
    if (id) entries.push([id, item])
  })
  return new Map(entries)
}

function isAoNode(node: JsonRecord): boolean {
  const type = stringField(node, 'type').toLowerCase()
  return type.includes('ao') && type.includes('output')
}

function isOutputNode(node: JsonRecord): boolean {
  const type = stringField(node, 'type').toLowerCase()
  return (type.includes('ao') || type.includes('do')) && type.includes('output')
}

function isSensorNode(node: JsonRecord): boolean {
  const type = stringField(node, 'type').toLowerCase()
  return type.includes('sensor') || (type.includes('ai') && type.includes('input'))
}

function hasLimitPair(value: unknown): boolean {
  if (!isRecord(value)) return false
  const limit = getRecord(value, 'limit')
  return (hasNumber(value, 'limit_lo') && hasNumber(value, 'limit_hi')) || (hasNumber(value, 'min') && hasNumber(value, 'max')) || (hasNumber(limit, 'limit_lo') && hasNumber(limit, 'limit_hi')) || (hasNumber(limit, 'min') && hasNumber(limit, 'max'))
}

function hasFallbackOrSafe(value: unknown): boolean {
  if (!isRecord(value)) return false
  return hasValue(value, 'fallback') || hasValue(value, 'safeState') || hasValue(value, 'safe_state') || hasFallbackOrSafe(value.params) || hasFallbackOrSafe(value.config)
}

function hasPowerOn(value: unknown): boolean {
  const powerOn = getRecord(value, 'power_on')
  return Object.keys(powerOn).length > 0
}

function readRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function getRecord(value: unknown, key: string): JsonRecord {
  if (!isRecord(value)) return {}
  const child = value[key]
  return isRecord(child) ? child : {}
}

function stringField(value: JsonRecord, key: string): string {
  const item = value[key]
  return typeof item === 'string' ? item : ''
}

function hasNumber(value: JsonRecord, key: string): boolean {
  return typeof value[key] === 'number' && Number.isFinite(value[key])
}

function hasValue(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null && value[key] !== undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getAiInputConfigs(): AiInputConfig[] {
  return [
    { channel: 1, node: 'AI-01', label: 'Supply Air Temp', signalType: '0-10V', unit: 'C', displayMin: 0, displayMax: 50, offset: 0, fallback: 25, enabled: true },
    { channel: 2, node: 'AI-02', label: 'Duct Pressure', signalType: '2-10V', unit: 'bar', displayMin: 0, displayMax: 10, offset: 0, fallback: 5, enabled: true },
    { channel: 3, node: 'AI-03', label: 'Room Humidity', signalType: '0-10V', unit: '%RH', displayMin: 0, displayMax: 100, offset: 0, fallback: 50, enabled: true },
    { channel: 4, node: 'AI-04', label: 'Outdoor Temp', signalType: '0-10V', unit: 'C', displayMin: -10, displayMax: 50, offset: 0, fallback: 30, enabled: true }
  ]
}

export function getDiInputConfigs(): DiInputConfig[] {
  return [
    { channel: 1, node: 'DI-01', label: 'Emergency Stop', invert: false, normalState: 'closed', debounceMs: 50, enabled: true },
    { channel: 2, node: 'DI-02', label: 'Fan Status', invert: false, normalState: 'open', debounceMs: 100, enabled: true },
    { channel: 3, node: 'DI-03', label: 'Filter Alarm', invert: false, normalState: 'closed', debounceMs: 500, enabled: true },
    { channel: 4, node: 'DI-04', label: 'Fire Alarm', invert: false, normalState: 'open', debounceMs: 10, enabled: true },
    { channel: 5, node: 'DI-05', label: 'Spare 1', invert: false, normalState: 'open', debounceMs: 100, enabled: false },
    { channel: 6, node: 'DI-06', label: 'Spare 2', invert: false, normalState: 'open', debounceMs: 100, enabled: false },
    { channel: 7, node: 'DI-07', label: 'Spare 3', invert: false, normalState: 'open', debounceMs: 100, enabled: false },
    { channel: 8, node: 'DI-08', label: 'Spare 4', invert: false, normalState: 'open', debounceMs: 100, enabled: false }
  ]
}
