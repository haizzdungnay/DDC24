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

export function statusColor(status: HealthStatus | PointQuality | 'online' | 'offline' | 'force'): string {
  if (status === 'ok' || status === 'good' || status === 'online') return 'var(--c-good)'
  if (status === 'degraded' || status === 'uncertain' || status === 'stale') return 'var(--c-warn)'
  if (status === 'force') return 'var(--c-force)'
  if (status === 'fault' || status === 'bad' || status === 'offline') return 'var(--c-fault)'
  return 'var(--c-info)'
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
