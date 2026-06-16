import type {
  Alarm,
  CommissioningTestResult,
  GraphValidationResult,
  HealthResponse,
  IoChannel,
  NetworkNode,
  Point,
  ScheduleRow,
  TrendSample,
  UserRow
} from '../types'
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
    return { ...point, value: !Boolean(point.value), updatedAt }
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

export function getTrendSamples(): TrendSample[] {
  const tracked = ['AI-01', 'AI-02', 'AI-03', 'AI-04']
  const now = Date.now()
  return Array.from({ length: 18 }, (_, i) => {
    const sample: TrendSample = { time: new Date(now - (17 - i) * 5 * 60_000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
    for (const id of tracked) {
      const point = points.find((item) => item.id === id)
      sample[id] = point?.trend?.[i] ?? pointNumber(point ?? points[0])
    }
    return sample
  })
}

export function getDemoSchedule(): ScheduleRow[] {
  const days = ['CN 18/05', 'T2 19/05', 'T3 20/05', 'T4 21/05', 'T5 22/05', 'T6 23/05', 'T7 24/05']
  return ['AHU-01', 'PUMP-01', 'LIGHT-01', 'FAN-01', 'VLV-01'].map((id, rowIndex) => ({
    id,
    label: ['Air Handling Unit', 'Chilled Water Pump', 'Lobby Light', 'Exhaust Fan', 'Water Valve'][rowIndex],
    cells: days.map((day) => ({ day, value: (['ON', 'ON', 'ON', 'ON', 'OPEN'] as const)[rowIndex], start: rowIndex === 2 ? '18:00' : '06:00', end: rowIndex === 2 ? '06:00' : '18:00' }))
  }))
}

export function getDemoNetwork(): NetworkNode {
  return {
    id: 'DDC24', label: 'DDC 24 Main Controller', ip: '192.168.1.100', status: 'ok', children: [
      { id: 'DDC-01', label: 'DDC-01', ip: '192.168.1.101', status: 'ok', children: [{ id: 'AI-DI', label: 'AI DI', ip: '8 / 8', status: 'ok' }, { id: 'UIO', label: 'UIO', ip: '0 / 16', status: 'unknown' }] },
      { id: 'DDC-02', label: 'DDC-02', ip: '192.168.1.102', status: 'ok', children: [{ id: 'AO', label: 'AO', ip: '0 / 4', status: 'ok' }, { id: 'DO', label: 'DO', ip: '0 / 8', status: 'unknown' }] },
      { id: 'DDC-03', label: 'DDC-03', ip: '192.168.1.103', status: 'degraded', children: [{ id: 'DI', label: 'DI', ip: '0 / 16', status: 'ok' }, { id: 'DO2', label: 'DO', ip: '0 / 16', status: 'unknown' }] }
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

export function validateGraphLocal(graph: unknown): GraphValidationResult {
  const text = JSON.stringify(graph)
  const errors: GraphValidationResult['errors'] = []
  if (!text.includes('safe') && !text.includes('safeState')) errors.push({ path: '$.safe_state', message: 'Thiếu safe-state fallback cho IO lỗi', severity: 'error' })
  if (!text.includes('limit') && !text.includes('max')) errors.push({ path: '$.outputs.AO', message: 'AO chưa có limit min/max', severity: 'error' })
  return { pass: errors.length === 0, errors }
}
