import type { Point } from '../types'
import { normalizeInputPointId, normalizeKind, normalizeQuality, nowIso, uiNode } from '../utils'
import { displayPointName } from './pointTags'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordArrayFrom(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function pointArraySource(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (!isRecord(raw)) return null
  for (const key of ['points', 'items', 'results']) {
    if (Array.isArray(raw[key])) return raw[key]
  }
  for (const key of ['payload', 'data']) {
    const nested = pointArraySource(raw[key])
    if (nested) return nested
  }
  return null
}

export function pointRecordsFrom(raw: unknown): Record<string, unknown>[] {
  return recordArrayFrom(pointArraySource(raw) ?? [])
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function pointChannel(raw: Record<string, unknown>): number | undefined {
  return numberFrom(raw.channel ?? raw.ch ?? raw.index ?? raw.idx)
}

function idChannel(id: string): number | undefined {
  const numeric = numberFrom(id)
  if (numeric !== undefined && numeric > 0) return numeric
  const match = id.trim().match(/^[A-Z]+[-_]?(\d+)$/i)
  if (!match) return undefined
  const channel = Number(match[1])
  return Number.isFinite(channel) && channel > 0 ? channel : undefined
}

// Core exposes physical output channels in the global 1..24 namespace (AO=17..20, DO=21..24).
// Trends and other APIs use the canonical per-kind 1..4 IDs instead.
function canonicalOutputChannel(kind: Point['kind'], channel?: number): number | undefined {
  if (channel === undefined) return undefined
  if (kind === 'AO' && channel >= 17 && channel <= 20) return channel - 16
  if (kind === 'DO' && channel >= 21 && channel <= 24) return channel - 20
  return channel
}

function pointKind(raw: Record<string, unknown>, rawId: string, channel?: number): Point['kind'] {
  const rawKind = raw.kind ?? raw.type ?? raw.point_type ?? raw.pointType ?? raw.object_type ?? raw.objectType
  const idPrefix = rawId.trim().match(/^([A-Z]+)[-_]?\d+$/i)?.[1]
  if (idPrefix && ['VP', 'AV', 'BV', 'MSV'].includes(idPrefix.toUpperCase())) return 'virtual'
  const direct = normalizeKind(rawKind ?? idPrefix ?? rawId.split(/[-_.]/)[0])
  if (direct !== 'virtual') return direct

  const text = String(rawKind ?? rawId).toLowerCase()
  if (text.includes('analog_output')) return 'AO'
  if (text.includes('digital_output') || text.includes('binary_output') || text.includes('relay')) return 'DO'
  if (text.includes('universal') || text.includes('analog_input') || text.includes('digital_input') || text === 'input') return 'UI'

  return channel ? 'UI' : 'virtual'
}

function pointId(raw: Record<string, unknown>, kind: Point['kind'], channel?: number): string {
  const rawId = raw.id ?? raw.point_id ?? raw.pointId ?? raw.object_id ?? raw.objectId ?? raw.name ?? raw.label
  const id = rawId === undefined || rawId === null ? '' : String(rawId).trim()
  const rawKind = String(raw.kind ?? raw.type ?? raw.point_type ?? raw.pointType ?? id).toUpperCase()
  const inferredChannel = canonicalOutputChannel(kind, channel ?? idChannel(id))
  if (kind === 'UI') {
    if (inferredChannel) return uiNode(rawKind.startsWith('DI') || rawKind.startsWith('BI') ? inferredChannel + 8 : inferredChannel)
    return normalizeInputPointId(id || 'UNKNOWN')
  }
  if ((kind === 'AO' || kind === 'DO') && inferredChannel) {
    return `${kind}-${String(inferredChannel).padStart(2, '0')}`
  }
  return id || 'UNKNOWN'
}

function pointValue(raw: Record<string, unknown>): Point['value'] {
  const value = raw.value ?? raw.present_value ?? raw.presentValue ?? raw.pv ?? raw.raw ?? raw.state
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const numeric = numberFrom(trimmed)
    if (numeric !== undefined) return numeric
    const lowered = trimmed.toLowerCase()
    if (['true', 'on', 'open', 'closed', 'active'].includes(lowered)) return true
    if (['false', 'off', 'inactive'].includes(lowered)) return false
    return trimmed
  }
  return 0
}

function pointQuality(raw: Record<string, unknown>): Point['quality'] {
  if (raw.online === false || raw.fault === true) return 'bad'
  const value = raw.quality ?? raw.q ?? raw.status
  const text = String(value ?? '').toLowerCase()
  if (['offline', 'fault', 'failed', 'error', 'bad'].includes(text)) return 'bad'
  if (['timeout', 'stale'].includes(text)) return 'stale'
  return normalizeQuality(value)
}

export function normalizePoint(raw: Record<string, unknown>): Point {
  const channel = pointChannel(raw)
  const rawId = String(raw.id ?? raw.point_id ?? raw.pointId ?? raw.object_id ?? raw.objectId ?? raw.name ?? raw.label ?? '')
  const kind = pointKind(raw, rawId, channel)
  const id = pointId(raw, kind, channel)
  const value = pointValue(raw)
  const rawValue = numberFrom(raw.raw)
  const rawUnit = raw.rawUnit ?? raw.raw_unit
  return {
    id,
    tag: String(raw.tag ?? id),
    name: displayPointName(raw.name ?? raw.label, id),
    kind,
    value,
    unit: raw.unit ? String(raw.unit) : undefined,
    ...(rawValue !== undefined ? { raw: rawValue } : {}),
    ...(rawUnit ? { rawUnit: String(rawUnit) } : {}),
    quality: pointQuality(raw),
    source: String(raw.source ?? 'Core'),
    priority: raw.priority ? String(raw.priority) : raw.active_source ? String(raw.active_source) : undefined,
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? raw.timestamp ?? raw.ts ?? nowIso()),
    fault: Boolean(raw.fault ?? false),
    forced: Boolean(raw.forced ?? false),
    sensorType: raw.sensorType ? String(raw.sensorType) : raw.sensor_type ? String(raw.sensor_type) : raw.type ? String(raw.type) : undefined,
    signalType: raw.signalType ? String(raw.signalType) : raw.signal_type ? String(raw.signal_type) : undefined,
    writable: typeof raw.writable === 'boolean' ? raw.writable : undefined,
    logEnabled: typeof raw.logEnabled === 'boolean' ? raw.logEnabled : typeof raw.log_enabled === 'boolean' ? raw.log_enabled : undefined,
    logIntervalMs: numberFrom(raw.logIntervalMs ?? raw.log_interval_ms),
    namespaceState: raw.namespaceState ? String(raw.namespaceState) : raw.namespace_state ? String(raw.namespace_state) : undefined
  }
}
