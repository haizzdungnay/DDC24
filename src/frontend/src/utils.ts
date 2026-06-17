import type { HealthStatus, Point, PointKind, PointQuality } from './types'

export function cn(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(' ')
}

export function normalizeKind(value: unknown): PointKind {
  const raw = String(value ?? '').toUpperCase()
  if (raw === 'BI') return 'DI'
  if (raw === 'BO') return 'DO'
  if (raw === 'AV') return 'AI'
  if (raw === 'BV') return 'DO'
  if (raw === 'AI' || raw === 'DI' || raw === 'AO' || raw === 'DO') return raw
  return 'virtual'
}

export function normalizeQuality(value: unknown): PointQuality {
  const raw = String(value ?? 'good').toLowerCase()
  if (raw === 'uncertain' || raw === 'bad' || raw === 'stale') return raw
  return 'good'
}

export function normalizeHealth(value: unknown): HealthStatus {
  const raw = String(value ?? 'unknown').toLowerCase()
  if (raw === 'normal') return 'ok'
  if (raw === 'safe') return 'degraded'
  if (raw === 'ok' || raw === 'degraded' || raw === 'fault' || raw === 'unknown' || raw === 'n/a') return raw
  return 'unknown'
}

export function pointNumber(point: Point): number {
  if (typeof point.value === 'number') return point.value
  if (typeof point.value === 'boolean') return point.value ? 1 : 0
  const parsed = Number(point.value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatValue(value: Point['value'], unit?: string): string {
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
  if (typeof value === 'number') {
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
