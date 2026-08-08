import type { HealthStatus, Point, PointKind, PointQuality } from './types'

export const VISIBLE_UI_CHANNELS = 16

export function cn(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(' ')
}

export function normalizeKind(value: unknown): PointKind {
  const raw = String(value ?? '').toUpperCase()
  if (raw === 'UI' || raw === 'AI' || raw === 'DI' || raw === 'BI') return 'UI'
  if (raw === 'BO') return 'DO'
  if (raw === 'AO' || raw === 'DO') return raw
  return 'virtual'
}

export function uiNode(channel: number): string {
  return `UI-${String(channel).padStart(2, '0')}`
}

const genericPointNamePattern = /^(UI|AI|DI|AO|DO)[-_ ]?\d+$/i

export function isGenericPointLabel(id: string, name: unknown): boolean {
  const text = typeof name === 'string' ? name.trim() : ''
  if (!text) return true
  return text.toUpperCase() === id.trim().toUpperCase() || genericPointNamePattern.test(text)
}

export function uiChannelFromId(id: string): number | null {
  const match = id.trim().match(/^(UI|AI|DI)[-_]?(\d+)$/i)
  if (!match) return null
  const channel = Number(match[2])
  return Number.isFinite(channel) ? channel : null
}

export function normalizeInputPointId(id: string): string {
  const channel = uiChannelFromId(id)
  return channel ? uiNode(channel) : id
}

export function canonicalOutputPointId(id: string): string {
  const match = id.trim().toUpperCase().match(/^(AO|DO)[-_]?(\d+)$/)
  if (!match) return id
  const channel = Number(match[2])
  if (match[1] === 'AO' && channel >= 17 && channel <= 20) return `AO-${String(channel - 16).padStart(2, '0')}`
  if (match[1] === 'DO' && channel >= 21 && channel <= 24) return `DO-${String(channel - 20).padStart(2, '0')}`
  return `${match[1]}-${String(channel).padStart(2, '0')}`
}

export function isUniversalInputKind(kind: PointKind): boolean {
  return kind === 'UI' || kind === 'AI' || kind === 'DI'
}

export function isVisibleUniversalInput(point: Point, maxChannel = VISIBLE_UI_CHANNELS): boolean {
  if (!isUniversalInputKind(point.kind)) return false
  const channel = uiChannelFromId(point.id)
  return channel === null || (channel >= 1 && channel <= maxChannel)
}

export function normalizeQuality(value: unknown): PointQuality {
  const raw = String(value ?? 'good').toLowerCase()
  if (raw === 'uncertain' || raw === 'bad' || raw === 'stale' || raw === 'offline') return raw
  return 'good'
}

export function normalizeHealth(value: unknown): HealthStatus {
  const raw = String(value ?? 'unknown').toLowerCase()
  if (raw === 'normal') return 'ok'
  if (raw === 'safe') return 'degraded'
  if (raw === 'ok' || raw === 'degraded' || raw === 'fault' || raw === 'unknown' || raw === 'n/a') return raw
  return 'unknown'
}

/** Số của một point, hoặc `null` khi CHƯA CÓ số đo.
 *
 * Bản trước trả `0` cho mọi thứ không quy được về số — kể cả point chưa từng
 * được poll. Nơi gọi không phân biệt được "0 đo được" với "chưa biết", nên
 * giao diện hiện `0 °C` và biểu đồ vẽ một đường phẳng ở 0 (REV-FE-04). */
export function pointNumber(point: Point): number | null {
  if (typeof point.value === 'number') return Number.isFinite(point.value) ? point.value : null
  if (typeof point.value === 'boolean') return point.value ? 1 : 0
  if (point.value === undefined) return null
  const parsed = Number(point.value)
  return Number.isFinite(parsed) ? parsed : null
}

export function pointDisplayTag(point: Pick<Point, 'id' | 'tag' | 'kind'>): string {
  return point.kind === 'virtual' ? point.tag : point.id
}

export function canonicalVirtualPointId(id: string): string {
  const match = id.trim().toUpperCase().match(/^(?:VP|AV)[-_]?0*(\d+)$/)
  return match ? `VP${Number(match[1])}` : id.trim().toUpperCase()
}

export function isFreshIso(value: string | null | undefined, maxAgeMs: number): boolean {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && Date.now() - time <= maxAgeMs
}

export function mergePointsById(base: Point[], updates: Point[]): Point[] {
  const byId = new Map(base.map((point) => [point.id, point]))
  for (const point of updates) {
    const current = byId.get(point.id)
    byId.set(point.id, current ? mergePointUpdate(current, point) : point)
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
}

function mergePointUpdate(current: Point, update: Point): Point {
  return {
    ...current,
    ...update,
    name: isGenericPointLabel(update.id, update.name) ? current.name : update.name,
    unit: update.unit ?? current.unit,
    sensorType: update.sensorType ?? current.sensorType,
    trend: update.trend ?? current.trend
  }
}

/** Ký hiệu "chưa có dữ liệu" dùng chung cho mọi chỗ hiển thị số đo. */
export const NO_DATA = '—'

export function formatValue(value: Point['value'], unit?: string): string {
  // Chưa có số đo thì hiện `—`, không hiện `0` và cũng không hiện "undefined".
  if (value === undefined || value === null) return NO_DATA
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NO_DATA
    const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
    return `${fixed}${unit ? ` ${unit}` : ''}`
  }
  return `${value}${unit ? ` ${unit}` : ''}`
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('vi-VN', { hour12: false })
}

export function formatUptime(seconds = 0): string {
  const day = Math.floor(seconds / 86400)
  const hour = Math.floor((seconds % 86400) / 3600)
  const minute = Math.floor((seconds % 3600) / 60)
  const sec = Math.floor(seconds % 60)
  return `${day}d ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

type StatusColorInput = HealthStatus | PointQuality | 'normal' | 'online' | 'offline' | 'live' | 'connected' | 'disconnected' | 'force' | 'forced' | 'critical' | 'safety' | 'warn' | 'warning' | 'alarm' | 'unknown' | 'n/a' | 'on' | 'off' | 'stopped' | 'inactive'

function statusBucket(status: StatusColorInput): 'good' | 'off' | 'warn' | 'fault' | 'force' | 'critical' | 'unknown' {
  const raw = String(status).toLowerCase()
  if (raw === 'normal' || raw === 'good' || raw === 'ok' || raw === 'online' || raw === 'on' || raw === 'live' || raw === 'connected') return 'good'
  if (raw === 'off' || raw === 'stopped' || raw === 'inactive') return 'off'
  if (raw === 'warn' || raw === 'warning' || raw === 'uncertain' || raw === 'stale' || raw === 'degraded') return 'warn'
  if (raw === 'fault' || raw === 'bad' || raw === 'offline' || raw === 'disconnected' || raw === 'alarm') return 'fault'
  if (raw === 'force' || raw === 'forced') return 'force'
  if (raw === 'critical' || raw === 'safety') return 'critical'
  return 'unknown'
}

export function statusColor(status: StatusColorInput): string {
  const bucket = statusBucket(status)
  if (bucket === 'good') return 'var(--c-good-fg)'
  if (bucket === 'off') return 'var(--c-off)'
  if (bucket === 'warn') return 'var(--c-warn-fg)'
  if (bucket === 'fault') return 'var(--c-fault-fg)'
  if (bucket === 'force') return 'var(--c-force)'
  if (bucket === 'critical') return 'var(--c-critical)'
  return 'var(--c-text-dim)'
}

export function statusFill(status: StatusColorInput): string {
  const bucket = statusBucket(status)
  if (bucket === 'good') return 'var(--c-good)'
  if (bucket === 'off') return 'var(--c-off)'
  if (bucket === 'warn') return 'var(--c-warn)'
  if (bucket === 'fault') return 'var(--c-fault)'
  if (bucket === 'force') return 'var(--c-force)'
  if (bucket === 'critical') return 'var(--c-critical)'
  return 'var(--c-text-dim)'
}

export function statusIndicatorColor(status: StatusColorInput): string {
  return statusFill(status)
}

export function metricStatusColor(value: number, warnAt: number, faultAt: number, direction: 'high' | 'low' = 'high'): string {
  if (!Number.isFinite(value)) return 'var(--c-off)'
  if (direction === 'low') {
    if (value <= faultAt) return 'var(--c-fault-fg)'
    if (value <= warnAt) return 'var(--c-warn-fg)'
    return 'var(--c-good-fg)'
  }
  if (value >= faultAt) return 'var(--c-fault-fg)'
  if (value >= warnAt) return 'var(--c-warn-fg)'
  return 'var(--c-good-fg)'
}

export function metricStatusFill(value: number, warnAt: number, faultAt: number, direction: 'high' | 'low' = 'high'): string {
  if (!Number.isFinite(value)) return 'var(--c-off)'
  if (direction === 'low') {
    if (value <= faultAt) return 'var(--c-fault)'
    if (value <= warnAt) return 'var(--c-warn)'
    return 'var(--c-good)'
  }
  if (value >= faultAt) return 'var(--c-fault)'
  if (value >= warnAt) return 'var(--c-warn)'
  return 'var(--c-good)'
}
export function nowIso(): string {
  return new Date().toISOString()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
