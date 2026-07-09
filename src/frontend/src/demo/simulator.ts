import type {
  Alarm,
  AlarmHistoryEntry,
  AlarmSetting,
  AiInputConfig,
  AoConfig,
  DiInputConfig,
  DoConfig,
  CommissioningTestResult,
  ConfigPutResult,
  Graph,
  GraphLink,
  GraphValidationResult,
  HealthResponse,
  IoChannel,
  NetworkData,
  Point,
  ScheduleRow,
  OutputsConfig,
  TrendSample,
  UserParamsConfig,
  UserRow,
  VirtualPoint
} from '../types'
import { DEVICE_DEFAULTS } from '../config'
import { clamp, nowIso, pointNumber } from '../utils'

const startedAt = Date.now() - 12 * 86400_000 - 4 * 3600_000 - 32 * 60_000

const names: Record<string, string> = {
  'DO-01': 'PUMP START',
  'DO-02': 'FAN START',
  'DO-03': 'VALVE OPEN',
  'DO-04': 'ALARM BUZZER',
  'UI-01': 'SUPPLY AIR TEMP',
  'UI-02': 'DUCT PRESSURE',
  'UI-03': 'ROOM HUMIDITY',
  'UI-04': 'OUTDOOR TEMP',
  'UI-05': 'FILTER SWITCH',
  'UI-06': 'FIRE ALARM CONTACT',
  'UI-07': 'DAMPER POTENTIOMETER',
  'UI-08': 'PULSE METER',
  'UI-09': 'RETURN AIR TEMP',
  'UI-10': 'CO2 SENSOR',
  'UI-11': 'CHILLED WATER TEMP',
  'UI-12': 'SUPPLY FAN STATUS',
  'UI-13': 'MOTION SENSOR',
  'UI-14': 'LIGHT LEVEL',
  'UI-15': 'WATER LEAK CONTACT',
  'UI-16': 'SPARE UNIVERSAL INPUT',
  'AO-01': 'VFD SPEED',
  'AO-02': 'HEATING VALVE',
  'AO-03': 'COOLING VALVE',
  'AO-04': 'DAMPER POSITION',
  VP1: 'ROOM SETPOINT',
  VP2: 'OCCUPANCY REQUEST',
  VP3: 'MODE INDEX',
  VP17: 'VIRTUAL COOLING DEMAND'
}

const basePoints: Point[] = [
  ...Array.from({ length: 4 }, (_, i) => {
    const id = `DO-${String(i + 1).padStart(2, '0')}`
    return { id, name: names[id], kind: 'DO' as const, value: demoDoValue(i), quality: 'good' as const, source: 'Core', priority: 'Logic', updatedAt: nowIso(), sensorType: 'Relay' }
  }),
  { id: 'UI-01', name: names['UI-01'], kind: 'UI', value: 23.7, unit: 'C', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'NTC10k' },
  { id: 'UI-02', name: names['UI-02'], kind: 'UI', value: 6.2, unit: 'bar', quality: 'uncertain', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: '4-20mA' },
  { id: 'UI-03', name: names['UI-03'], kind: 'UI', value: 54.2, unit: '%RH', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'UI-04', name: names['UI-04'], kind: 'UI', value: 18.6, unit: 'C', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'PT100' },
  { id: 'UI-05', name: names['UI-05'], kind: 'UI', value: true, unit: '', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'dry' },
  { id: 'UI-06', name: names['UI-06'], kind: 'UI', value: false, unit: '', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'dry' },
  { id: 'UI-07', name: names['UI-07'], kind: 'UI', value: 72.4, unit: '%', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'potentiometer' },
  { id: 'UI-08', name: names['UI-08'], kind: 'UI', value: 128, unit: 'pulse', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'pulse' },
  { id: 'UI-09', name: names['UI-09'], kind: 'UI', value: 24.9, unit: 'C', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'NTC10k' },
  { id: 'UI-10', name: names['UI-10'], kind: 'UI', value: 742, unit: 'ppm', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'UI-11', name: names['UI-11'], kind: 'UI', value: 7.4, unit: 'C', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'PT1000' },
  { id: 'UI-12', name: names['UI-12'], kind: 'UI', value: true, unit: '', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'dry' },
  { id: 'UI-13', name: names['UI-13'], kind: 'UI', value: false, unit: '', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'dry' },
  { id: 'UI-14', name: names['UI-14'], kind: 'UI', value: 68, unit: '%', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'light' },
  { id: 'UI-15', name: names['UI-15'], kind: 'UI', value: false, unit: '', quality: 'good', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'dry' },
  { id: 'UI-16', name: names['UI-16'], kind: 'UI', value: 0, unit: '', quality: 'stale', source: 'IOP', priority: 'Input', updatedAt: nowIso(), sensorType: 'none' },
  { id: 'AO-01', name: names['AO-01'], kind: 'AO', value: 62.5, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AO-02', name: names['AO-02'], kind: 'AO', value: 35, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AO-03', name: names['AO-03'], kind: 'AO', value: 12.5, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' },
  { id: 'AO-04', name: names['AO-04'], kind: 'AO', value: 45, unit: '%', quality: 'good', source: 'Core', priority: 'PID', updatedAt: nowIso(), sensorType: '0-10V' }
]

let points: Point[] = basePoints.map((point) => ({ ...point, trend: makeTrend(pointNumber(point)) }))

const alarms: Alarm[] = [
  { id: 'AL-001', time: '2025-05-23T14:31:02Z', severity: 'critical', status: 'active', message: 'UI-05 Filter Switch', source: 'UI-05', value: 'ON', detail: 'trip=HH threshold=1 current=ON (High-high); occurrence=1', triggerLevel: 'HH', threshold: '1', active: true },
  { id: 'AL-002', time: '2025-05-23T14:29:45Z', severity: 'high', status: 'active', message: 'UI-02 Pressure High', source: 'UI-02', value: '9.8 bar', detail: 'trip=H threshold=8 current=9.8 (High); occurrence=1', triggerLevel: 'H', threshold: '8', active: true },
  { id: 'AL-003', time: '2025-05-23T14:27:18Z', severity: 'info', status: 'acked', message: 'DO-03 Pump Start', source: 'DO-03', value: 'ON', detail: 'Output switched on', active: true },
  { id: 'AL-004', time: '2025-05-23T14:25:03Z', severity: 'info', status: 'acked', message: 'SYSTEM', source: 'SYSTEM', value: 'admin', detail: 'admin signed in', active: false },
  { id: 'AL-005', time: '2025-05-23T14:20:11Z', severity: 'info', status: 'acked', message: 'COMMUNICATION', source: 'SYSTEM', value: 'OK', detail: 'Modbus RTU connected', active: false }
]

const demoAlarmHistory: AlarmHistoryEntry[] = [
  { id: 'AL-006', time: '2025-05-23T13:54:12Z', severity: 'medium', status: 'cleared', message: 'UI-10 CO2 Sensor', source: 'UI-10', value: '1240 ppm', detail: 'CO2 returned below threshold', acknowledgedAt: '2025-05-23T13:56:03Z', ackedBy: 'operator1', clearedAt: '2025-05-23T14:05:44Z' },
  { id: 'AL-007', time: '2025-05-23T13:21:49Z', severity: 'low', status: 'cleared', message: 'AO-02 Heating Valve', source: 'AO-02', value: '0%', detail: 'Output returned to normal range', acknowledgedAt: '2025-05-23T13:23:10Z', ackedBy: 'admin', clearedAt: '2025-05-23T13:39:20Z' },
  { id: 'AL-008', time: '2025-05-23T12:44:08Z', severity: 'high', status: 'acked', message: 'UI-15 Water Leak Contact', source: 'UI-15', value: 'OFF', detail: 'Leak input acknowledged during inspection', acknowledgedAt: '2025-05-23T12:46:32Z', ackedBy: 'operator2' }
]

function makeTrend(base: number): number[] {
  return Array.from({ length: 18 }, (_, i) => Number((base + Math.sin(i / 2) * 4 + (Math.random() - 0.5) * 2).toFixed(1)))
}

function demoDoValue(index: number, now = Date.now()): boolean {
  const phase = Math.floor(now / 30_000) % 4
  const ui12On = phase === 0 || phase === 1
  const ui13On = phase === 1 || phase === 2
  if (index === 0) return ui12On
  if (index === 1) return ui13On
  if (index === 2) return ui12On && !ui13On
  return ui13On && !ui12On
}

function jitter(point: Point): Point {
  const updatedAt = nowIso()
  if (point.kind === 'DO' && !point.forced) {
    const channel = Number(point.id.slice(3)) || 1
    return { ...point, value: demoDoValue(channel - 1), priority: 'Logic', updatedAt }
  }
  if ((point.kind === 'UI' && typeof point.value === 'number') || point.kind === 'AO') {
    const spread = point.kind === 'UI' ? 1.2 : 2.5
    const max = point.unit === 'bar' ? 12 : point.unit === 'ppm' ? 2000 : point.unit === 'pulse' ? 9999 : 100
    const next = clamp(pointNumber(point) + (Math.random() - 0.48) * spread, 0, max)
    const trend = [...(point.trend ?? []), Number(next.toFixed(1))].slice(-18)
    return { ...point, value: Number(next.toFixed(1)), trend, updatedAt }
  }
  if (Math.random() < 0.025 && typeof point.value === 'boolean' && point.id !== 'UI-05') {
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
    cpuClockMhz: 1512,
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
    range: point.kind === 'UI' || point.kind === 'AO' ? '0-100' : 'ON/OFF',
    safeState: point.kind === 'AO' || point.kind === 'DO' ? 'OFF' : 'n/a'
  }))
}

export function getDemoAlarms(): Alarm[] {
  return alarms.map((alarm) => ({ ...alarm }))
}

export function getDemoAlarmHistory(): AlarmHistoryEntry[] {
  return [...alarms, ...demoAlarmHistory].map((alarm) => ({ ...alarm }))
}

const defaultAlarmSettings: AlarmSetting[] = [
  {
    id: 'ALM-001',
    label: 'Supply air temperature',
    enabled: true,
    alarmType: 1,
    sources: [{ kind: 'UI', channel: 1, pointId: 'UI-01' }],
    priority: 'high',
    delayS: 10,
    publishBacnet: true,
    notificationClass: 1,
    params: { hh: 32, h: 28, l: 16, ll: 12, hysteresis: 1 }
  },
  {
    id: 'ALM-002',
    label: 'Duct pressure range',
    enabled: true,
    alarmType: 1,
    sources: [{ kind: 'UI', channel: 2, pointId: 'UI-02' }],
    priority: 'critical',
    delayS: 5,
    publishBacnet: true,
    notificationClass: 1,
    params: { hh: 9.5, h: 8, l: 2, ll: 1, hysteresis: 0.2 }
  },
  {
    id: 'ALM-003',
    label: 'Fan runtime hours',
    enabled: true,
    alarmType: 3,
    sources: [
      { kind: 'DO', channel: 1, pointId: 'DO-01' },
      { kind: 'DO', channel: 2, pointId: 'DO-02' }
    ],
    priority: 'medium',
    delayS: 0,
    publishBacnet: false,
    params: { runtimeHours: 3600 }
  },
  {
    id: 'ALM-004',
    label: 'Outdoor temperature spare',
    enabled: false,
    alarmType: 0,
    sources: [],
    priority: 'low',
    delayS: 0,
    publishBacnet: false,
    params: {}
  }
]

let alarmSettings = defaultAlarmSettings.map(cloneAlarmSetting)
type DemoAlarmDurationChoice = { permanent: boolean; durationS?: number }

function cloneAlarmSetting(row: AlarmSetting): AlarmSetting {
  return {
    ...row,
    sources: row.sources.map((source) => ({ ...source })),
    params: { ...row.params }
  }
}

export function getAlarmSettings(): AlarmSetting[] {
  return alarmSettings.map(cloneAlarmSetting)
}

export function putAlarmSettings(rows: AlarmSetting[]): ConfigPutResult {
  alarmSettings = rows.map(cloneAlarmSetting)
  return { result: 'success', applied: true, reload: 'sighup-core', warnings: [] }
}

export function ackDemoAlarm(id: string, choice?: DemoAlarmDurationChoice): Alarm[] {
  const target = alarms.find((alarm) => alarm.id === id)
  if (target) {
    target.status = 'acked'
    if (choice) target.detail = `${target.detail}; ack=${formatDemoDuration(choice)}`
  }
  return getDemoAlarms()
}

export function suppressDemoAlarm(id: string, choice: DemoAlarmDurationChoice): Alarm[] {
  const target = alarms.find((alarm) => alarm.id === id)
  if (target) {
    target.status = 'shelved'
    target.active = false
    target.detail = `${target.detail}; off=${formatDemoDuration(choice)}`
  }
  return getDemoAlarms()
}

export function returnDemoAlarm(id: string): Alarm[] {
  const target = alarms.find((alarm) => alarm.id === id && alarm.status === 'acked' && alarm.active !== false)
  if (target) target.status = 'active'
  return getDemoAlarms()
}

function formatDemoDuration(choice: DemoAlarmDurationChoice): string {
  return choice.permanent ? 'permanent' : `${choice.durationS ?? 0}s`
}

export function forceDemoPoint(id: string, value: number | boolean | string, release = false) {
  const target = canonicalDemoVirtualPointId(id)
  points = points.map((point) => canonicalDemoVirtualPointId(point.id) === target ? { ...point, value, forced: !release, source: release ? 'Core' : 'Local manual', priority: release ? 'Auto' : 'Manual override', updatedAt: nowIso() } : point)
  return { result: 'accepted' as const, applied_value: value, active_source: release ? 'core' : 'local_manual' }
}

export function updateDemoPointName(id: string, name: string) {
  points = points.map((point) => point.id === id ? { ...point, name } : point)
  return { id, name }
}

export function updateDemoPointConfig(id: string, config: { name?: string; unit?: string; trendEnabled?: boolean }) {
  points = points.map((point) => {
    if (point.id !== id) return point
    const updated = { ...point }
    if (config.name !== undefined) updated.name = config.name
    if (config.unit !== undefined) updated.unit = config.unit
    if (config.trendEnabled !== undefined) {
      // Demo doesn't track trend enabled state, just return success
    }
    return updated
  })
  return { id, ...config }
}

export function runDemoCommissioning(pointId: string, value: number | boolean): CommissioningTestResult {
  forceDemoPoint(pointId, value)
  return { result: 'passed', pointId, appliedValue: value, message: 'Command accepted by demo core', scanMs: 12 }
}

export function getTrendSamples(pointIds: string[] = ['UI-01', 'UI-02', 'UI-03', 'UI-04'], rangeMinutes = 30): TrendSample[] {
  const tracked = pointIds.filter((id) => points.some((point) => point.id === id && (point.kind === 'UI' || point.kind === 'AO') && typeof point.value === 'number'))
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

let demoSchedules: ScheduleRow[] = [
  { id: 'SCH-001', label: 'Occupied mode', notes: 'Weekday morning startup.', enabled: true, scheduleType: 'controller_operation_mode', timeOfDay: '06:00', startTime: '06:00', endTime: '18:00', weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], target: { kind: 'VP', channel: 3, pointId: 'VP3' }, value: 1 },
  { id: 'SCH-002', label: 'Supply fan night off', notes: '', enabled: true, scheduleType: 'fan_state_value', timeOfDay: '18:00', startTime: '18:00', endTime: '23:00', weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], target: { kind: 'DO', channel: 1, pointId: 'DO-01' }, value: 0 },
  { id: 'SCH-003', label: 'Cooling setpoint', notes: 'Weekend relaxed setpoint.', enabled: false, scheduleType: 'control_loop_setpoint', timeOfDay: '09:00', startTime: '09:00', endTime: '17:00', weekdays: ['saturday', 'sunday'], target: { kind: 'VP', channel: 1, pointId: 'VP1' }, value: 26 }
]

export function getDemoSchedule(): ScheduleRow[] {
  return demoSchedules.map((row) => ({ ...row, weekdays: [...row.weekdays], target: row.target ? { ...row.target } : undefined }))
}

export function putDemoSchedule(rows: ScheduleRow[]): void {
  demoSchedules = rows.map((row) => ({ ...row, weekdays: [...row.weekdays], target: row.target ? { ...row.target } : undefined }))
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

export function getDemoGraph(): Graph {
  return {
    schema_version: '1.0',
    device: { bacnet_device_id: 1001, name: 'AHU01_DDC', scan_ms: 1000 },
    io_map: { ui: [], ao: [], do: [] },
    modbus: { rtu: [], tcp: [] },
    nodes: [],
    links: [],
    meta: { author: 'demo', rev: 1 }
  }
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
  const inputNodes = mapIoNodes([...readRecordArray(ioMap.ui), ...readRecordArray(ioMap.ai)])
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
    if ((isSensorNode(node) || inputNodes.has(id)) && !hasFallbackOrSafe(node) && !hasFallbackOrSafe(inputNodes.get(id))) {
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
  return type.includes('sensor') || ((type.includes('ui') || type.includes('ai')) && type.includes('input'))
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
  return demoAiInputConfigs.map((config) => ({ ...config }))
}

let demoAiInputConfigs: AiInputConfig[] = [
  { channel: 1, label: 'Supply Air Temp', signalType: 3, displayMin: -20, displayMax: 80, rangeMultiplier: 0, unit: 2, filterSamples: 3, sensorCal: 0, mathFunction: 1, enabled: true, note: 'Check against handheld probe during commissioning.' },
  { channel: 2, label: 'Duct Pressure', signalType: 2, displayMin: 0, displayMax: 200, rangeMultiplier: 2, unit: 3, filterSamples: 5, sensorCal: 0.2, mathFunction: 0, enabled: true, note: 'High alarm review after TAB.' },
  { channel: 3, label: 'Room Humidity', signalType: 1, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 1, filterSamples: 3, sensorCal: 0, mathFunction: 2, enabled: true, note: '' },
  { channel: 4, label: 'Outdoor Light', signalType: 7, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 1, filterSamples: 8, sensorCal: -0.5, mathFunction: 3, enabled: true, note: '' },
  { channel: 5, label: 'Filter Switch', signalType: 4, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 6, label: 'Fire Alarm Contact', signalType: 5, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 7, label: 'Damper Potentiometer', signalType: 6, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 1, filterSamples: 4, sensorCal: 0, mathFunction: 0, enabled: true, note: 'Authoring-only until iobus consumer supports EasySet signal 6.' },
  { channel: 8, label: 'Pulse Meter', signalType: 8, displayMin: 0, displayMax: 205, rangeMultiplier: 1, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 9, label: 'Return Air Temp', signalType: 3, displayMin: -20, displayMax: 80, rangeMultiplier: 0, unit: 2, filterSamples: 3, sensorCal: 0, mathFunction: 1, enabled: true, note: '' },
  { channel: 10, label: 'CO2 Sensor', signalType: 1, displayMin: 0, displayMax: 200, rangeMultiplier: 1, unit: 4, filterSamples: 5, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 11, label: 'Chilled Water Temp', signalType: 3, displayMin: -20, displayMax: 80, rangeMultiplier: 0, unit: 2, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 12, label: 'Supply Fan Status', signalType: 4, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 13, label: 'Motion Sensor', signalType: 5, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 14, label: 'Light Level', signalType: 7, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 1, filterSamples: 4, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 15, label: 'Water Leak Contact', signalType: 4, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: true, note: '' },
  { channel: 16, label: 'Spare Universal Input', signalType: 0, displayMin: 0, displayMax: 100, rangeMultiplier: 0, unit: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, enabled: false, note: '' }
]

export function putDemoAiInputs(configs: AiInputConfig[]): void {
  demoAiInputConfigs = configs.map((config) => ({ ...config }))
}

const defaultAoConfigs: AoConfig[] = [
  { kind: 'AO', channel: 1, id: 'AO-01', label: 'VFD Speed', enabled: true, mode: '0-10V', safeValue: 0, source: 1, loopConfig: 1, minHeatOutput: 0, maxHeatOutput: 100, minCoolOutput: 0, maxCoolOutput: 100, alarm100: 1, alarm0: 2, input: 0, notUsed10: 0, notUsed11: 0, piSeqLowerFan1: 0, fanSpeed2: 50, piSeqUpperFan3: 100, setbackAlarm: 50, notInUse16: 0, manualValue: 62.5, note: '', demoNote: 'demo' },
  { kind: 'AO', channel: 2, id: 'AO-02', label: 'Heating Valve', enabled: true, mode: '0-10V', safeValue: 0, source: 1, loopConfig: 0, minHeatOutput: 0, maxHeatOutput: 100, minCoolOutput: 0, maxCoolOutput: 100, alarm100: 0, alarm0: 0, input: 0, notUsed10: 0, notUsed11: 0, piSeqLowerFan1: 0, fanSpeed2: 50, piSeqUpperFan3: 100, setbackAlarm: 50, notInUse16: 0, manualValue: 35, note: '', demoNote: 'demo' },
  { kind: 'AO', channel: 3, id: 'AO-03', label: 'Cooling Valve', enabled: true, mode: '4-20mA', safeValue: 0, source: 1, loopConfig: 4, minHeatOutput: 0, maxHeatOutput: 100, minCoolOutput: 0, maxCoolOutput: 100, alarm100: 0, alarm0: 0, input: 0, notUsed10: 0, notUsed11: 0, piSeqLowerFan1: 0, fanSpeed2: 50, piSeqUpperFan3: 100, setbackAlarm: 50, notInUse16: 0, manualValue: 12.5, note: '', demoNote: 'demo' },
  { kind: 'AO', channel: 4, id: 'AO-04', label: 'Damper Position', enabled: true, mode: '0-10V', safeValue: 0, source: 6, loopConfig: 7, minHeatOutput: 0, maxHeatOutput: 100, minCoolOutput: 0, maxCoolOutput: 100, alarm100: 0, alarm0: 0, input: 0, notUsed10: 0, notUsed11: 0, piSeqLowerFan1: 0, fanSpeed2: 50, piSeqUpperFan3: 100, setbackAlarm: 50, notInUse16: 0, manualValue: 45, note: '', demoNote: 'demo' }
]

const defaultDoConfigs: DoConfig[] = [
  { kind: 'DO', channel: 1, id: 'DO-01', label: 'Pump Start', safeState: 'open', manualValue: true },
  { kind: 'DO', channel: 2, id: 'DO-02', label: 'Fan Start', safeState: 'open', manualValue: true },
  { kind: 'DO', channel: 3, id: 'DO-03', label: 'Valve Open', safeState: 'closed', manualValue: true },
  { kind: 'DO', channel: 4, id: 'DO-04', label: 'Alarm Buzzer', safeState: 'open', manualValue: false }
]

let demoOutputs: OutputsConfig = {
  ao: defaultAoConfigs.map((config) => ({ ...config })),
  do: defaultDoConfigs.map((config) => ({ ...config }))
}

export function getDemoOutputs(): OutputsConfig {
  return {
    ao: demoOutputs.ao.map((config) => ({ ...config })),
    do: demoOutputs.do.map((config) => ({ ...config }))
  }
}

export function putDemoOutputs(config: OutputsConfig): void {
  demoOutputs = {
    ao: config.ao.map((item) => ({ ...item, demoNote: 'demo' })),
    do: config.do.map((item) => ({ ...item }))
  }
}

let demoVirtualPoints: VirtualPoint[] = [
  { id: 'VP1', label: 'Room Setpoint', signalType: 'float', enabled: true, writable: true, logEnabled: true, logIntervalMs: 1000, retentionS: 30 * 24 * 60 * 60, value: 24, unit: 'degC', displayMin: 16, displayMax: 30, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '', updatedAt: nowIso() },
  { id: 'VP2', label: 'Occupancy Request', signalType: 'boolean', enabled: true, writable: true, logEnabled: true, logIntervalMs: 1000, retentionS: 7 * 24 * 60 * 60, value: true, unit: '', displayMin: 0, displayMax: 1, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '', updatedAt: nowIso() },
  { id: 'VP3', label: 'Mode Index', signalType: 'integer', enabled: true, writable: true, logEnabled: false, value: 1, unit: '', displayMin: 0, displayMax: 3, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '', updatedAt: nowIso() },
  { id: 'VP4', label: 'Mode Text', signalType: 'string', enabled: true, writable: true, logEnabled: false, value: 'auto', unit: '', displayMin: 0, displayMax: 100, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '', updatedAt: nowIso() },
  { id: 'VP5', label: 'Last Change', signalType: 'datetime', enabled: true, writable: false, logEnabled: false, value: nowIso(), unit: '', displayMin: 0, displayMax: 100, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '', updatedAt: nowIso() }
]

syncDemoVirtualPoints()

export function getDemoVirtualPoints(): VirtualPoint[] {
  return demoVirtualPoints.map((item) => ({ ...item }))
}

export function putDemoVirtualPoint(point: Partial<VirtualPoint>): VirtualPoint {
  const existingIndex = point.id ? demoVirtualPoints.findIndex((item) => canonicalDemoVirtualPointId(item.id) === canonicalDemoVirtualPointId(point.id ?? '')) : -1
  const current = existingIndex >= 0 ? demoVirtualPoints[existingIndex] : undefined
  const next: VirtualPoint = normalizeDemoVirtualPoint({
    id: point.id ?? nextDemoVirtualPointId(),
    label: point.label ?? current?.label ?? 'Virtual Point',
    signalType: point.signalType ?? current?.signalType ?? 'float',
    enabled: point.enabled ?? current?.enabled ?? true,
    writable: point.writable ?? current?.writable ?? true,
    logEnabled: point.logEnabled ?? current?.logEnabled ?? false,
    logIntervalMs: point.logIntervalMs ?? current?.logIntervalMs,
    retentionS: point.retentionS ?? current?.retentionS,
    value: point.value ?? current?.value,
    unit: point.unit ?? current?.unit ?? '',
    displayMin: point.displayMin ?? current?.displayMin ?? 0,
    displayMax: point.displayMax ?? current?.displayMax ?? 100,
    rangeMultiplier: point.rangeMultiplier ?? current?.rangeMultiplier ?? 0,
    filterSamples: point.filterSamples ?? current?.filterSamples ?? 3,
    sensorCal: point.sensorCal ?? current?.sensorCal ?? 0,
    mathFunction: point.mathFunction ?? current?.mathFunction ?? 0,
    note: point.note ?? current?.note ?? '',
    updatedAt: nowIso()
  })
  if (existingIndex >= 0) demoVirtualPoints[existingIndex] = next
  else demoVirtualPoints = [...demoVirtualPoints, next]
  syncDemoVirtualPoints()
  return { ...next }
}

export function deleteDemoVirtualPoint(id: string): void {
  demoVirtualPoints = demoVirtualPoints.filter((item) => canonicalDemoVirtualPointId(item.id) !== canonicalDemoVirtualPointId(id))
  syncDemoVirtualPoints()
}

function normalizeDemoVirtualPoint(point: VirtualPoint): VirtualPoint {
  const id = canonicalDemoVirtualPointId(point.id)
  const signalType = demoSignalTypes.includes(point.signalType) ? point.signalType : 'float'
  return {
    ...point,
    id,
    signalType,
    unit: normalizeDemoVirtualUnit(point.unit),
    displayMin: clampDemoNumber(point.displayMin, -50, 205, 0),
    displayMax: clampDemoNumber(point.displayMax, -50, 205, 100),
    rangeMultiplier: clampDemoInteger(point.rangeMultiplier, 0, 5, 0),
    filterSamples: clampDemoInteger(point.filterSamples, 0, 100, 3),
    sensorCal: clampDemoNumber(point.sensorCal, -12.7, 12.8, 0),
    mathFunction: clampDemoInteger(point.mathFunction, 0, 3, 0),
    value: normalizeDemoVirtualValue(signalType, point.value),
    logIntervalMs: point.logEnabled ? point.logIntervalMs ?? 1000 : undefined,
    retentionS: point.logEnabled ? point.retentionS ?? defaultDemoRetention(point.logIntervalMs ?? 1000) : undefined
  }
}

function normalizeDemoVirtualUnit(unit?: string): string {
  const text = String(unit ?? '').toLowerCase()
  if (text === 'percent' || text === '%' || text === '%rh') return 'percent'
  if (text === 'degc' || text === 'degf' || text === 'c' || text === 'f') return 'degC'
  if (text === 'pa' || text === 'pascal') return 'Pa'
  if (text === 'ppm') return 'ppm'
  return ''
}

function clampDemoNumber(value: unknown, min: number, max: number, fallback: number): number {
  const next = Number(value)
  const finite = Number.isFinite(next) ? next : fallback
  return Math.min(max, Math.max(min, finite))
}

function clampDemoInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampDemoNumber(value, min, max, fallback))
}

const demoSignalTypes: VirtualPoint['signalType'][] = ['boolean', 'integer', 'float', 'string', 'datetime']

function normalizeDemoVirtualValue(signalType: VirtualPoint['signalType'], value: unknown): number | boolean | string {
  if (signalType === 'boolean') return value === true || value === 'true' || value === 1
  if (signalType === 'integer') return Math.trunc(Number(value ?? 0))
  if (signalType === 'float') return Number(value ?? 0)
  if (signalType === 'datetime') {
    const text = String(value ?? nowIso())
    return Number.isNaN(new Date(text).getTime()) ? nowIso() : text
  }
  return String(value ?? '')
}

function defaultDemoRetention(intervalMs: number): number {
  if (intervalMs === 10) return 60 * 60
  if (intervalMs === 100) return 7 * 24 * 60 * 60
  return 30 * 24 * 60 * 60
}

function nextDemoVirtualPointId(): string {
  const used = new Set(demoVirtualPoints.map((item) => Number(canonicalDemoVirtualPointId(item.id).slice(2))))
  for (let channel = 1; channel <= 464; channel += 1) {
    if (!used.has(channel)) return `VP${channel}`
  }
  return 'VP464'
}

function syncDemoVirtualPoints(): void {
  const wanted = new Set(demoVirtualPoints.filter((item) => item.enabled).map((item) => canonicalDemoVirtualPointId(item.id)))
  points = points.filter((point) => point.kind !== 'virtual' || wanted.has(canonicalDemoVirtualPointId(point.id)))
  for (const item of demoVirtualPoints) {
    if (!item.enabled) continue
    const id = canonicalDemoVirtualPointId(item.id)
    const value = normalizeDemoVirtualValue(item.signalType, item.value)
    const trend = typeof value === 'number' || typeof value === 'boolean' ? makeTrend(typeof value === 'boolean' ? Number(value) : value) : undefined
    const point: Point = { id, name: item.label, kind: 'virtual', value, unit: item.unit, quality: 'good', source: 'Backend', priority: item.writable ? 'Writable' : 'Read only', updatedAt: item.updatedAt ?? nowIso(), sensorType: 'VP', signalType: item.signalType, writable: item.writable, logEnabled: item.logEnabled, logIntervalMs: item.logIntervalMs, ...(trend ? { trend } : {}) }
    const index = points.findIndex((entry) => canonicalDemoVirtualPointId(entry.id) === id)
    if (index >= 0) points[index] = { ...points[index], ...point }
    else points = [...points, point]
  }
}

function canonicalDemoVirtualPointId(point: string): string {
  const match = point.trim().toUpperCase().match(/^(?:VP|AV)[-_]?0*(\d+)$/)
  return match ? `VP${Number(match[1])}` : point.trim().toUpperCase()
}

const defaultUserParams: UserParamsConfig = {
  note: 'Demo-only EasySet User Parameters mock. Backend/core hook is not available yet.',
  UP00: 1,
  UP01: 1,
  UP02: 1,
  UP03: 1,
  UP04: 1,
  UP05: 2,
  UP06: 0,
  UP07: 0,
  UP08: 0,
  UP09: 1,
  UP10: 'Universal Input 1',
  UP11: 2,
  UP12: 1,
  UP13: 3,
  UP14: 'Analog Output 1',
  UP15: 1,
  UP16: 1,
  UP17: 0,
  UP18: '01:00',
  UP19: 0,
  UP20: 0,
  UP21: 0,
  UP22: 0,
  UP23: 0,
  UP24: 0,
  UP25: 'Not used',
  UP26: 1,
  UP27: 0,
  UP28: 'Not used',
  UP29: 0,
  UPSP: 1,
  UPTS: 0,
  UPHT: 'Auto',
  UPSB: 'Occupied',
  UPFAN: 0,
  LOCK1: 1,
  LOCK2: 9,
  LOCK3: 241
}

let demoUserParams: UserParamsConfig = { ...defaultUserParams }

export function getUserParams(): UserParamsConfig {
  return { ...demoUserParams }
}

export function putUserParams(config: UserParamsConfig): void {
  demoUserParams = { ...config }
}

export function getDiInputConfigs(): DiInputConfig[] {
  return [
    { channel: 1, node: 'UI-01', label: 'Emergency Stop', invert: false, normalState: 'closed', debounceMs: 50, enabled: true },
    { channel: 2, node: 'UI-02', label: 'Fan Status', invert: false, normalState: 'open', debounceMs: 100, enabled: true },
    { channel: 3, node: 'UI-03', label: 'Filter Alarm', invert: false, normalState: 'closed', debounceMs: 500, enabled: true },
    { channel: 4, node: 'UI-04', label: 'Fire Alarm', invert: false, normalState: 'open', debounceMs: 10, enabled: true },
    { channel: 5, node: 'UI-05', label: 'Spare 1', invert: false, normalState: 'open', debounceMs: 100, enabled: false },
    { channel: 6, node: 'UI-06', label: 'Spare 2', invert: false, normalState: 'open', debounceMs: 100, enabled: false },
    { channel: 7, node: 'UI-07', label: 'Spare 3', invert: false, normalState: 'open', debounceMs: 100, enabled: false },
    { channel: 8, node: 'UI-08', label: 'Spare 4', invert: false, normalState: 'open', debounceMs: 100, enabled: false }
  ]
}
