import type { Point, TrendSample } from '../../shared/types'

export type TrendFilterKind = 'UI' | 'AO' | 'DO' | 'VP'
export interface TrendCustomRange { fromMs: number; toMs: number }

function trendFilterKind(point: Point): TrendFilterKind | null {
  if (point.kind === 'virtual') return 'VP'
  return point.kind === 'UI' || point.kind === 'AO' || point.kind === 'DO' ? point.kind : null
}

export function filterTrendPoints(points: Point[], query: string, kinds: TrendFilterKind[]): Point[] {
  const normalized = query.trim().toLowerCase()
  return points.filter((point) => {
    const kind = trendFilterKind(point)
    return kind !== null && kinds.includes(kind) && (!normalized || `${point.id} ${point.name}`.toLowerCase().includes(normalized))
  })
}

export function filterTrendSamplesByRange(samples: TrendSample[], fromMs: number, toMs: number): TrendSample[] {
  return samples.filter((sample) => typeof sample.__ts === 'number' && sample.__ts >= fromMs && sample.__ts < toMs)
}

export function parseTrendCustomRange(fromUtc: string, toUtc: string, nowMs = Date.now()): TrendCustomRange {
  const fromMs = parseUTCInput(fromUtc)
  const toMs = parseUTCInput(toUtc)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) throw new Error('From must be before To.')
  if (toMs > nowMs + 60_000) throw new Error('To must not be in the future.')
  return { fromMs, toMs }
}

export function utcDateTimeInputValue(date: Date): string {
  return date.toISOString().slice(0, 16)
}

function parseUTCInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return Number.NaN
  return Date.parse(`${value}Z`)
}
