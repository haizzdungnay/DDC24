import { API_ORIGIN, HISTORIAN_V2_TRENDS_ENABLED } from '../config'
import { apiClient } from './client'
import type { TrendSample } from '../types'
import { formatTime } from '../utils'

export const HISTORY_FIXED_RESOLUTIONS = ['1s', '3s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '60m'] as const
export const HISTORY_QUERY_RESOLUTIONS = ['auto', ...HISTORY_FIXED_RESOLUTIONS] as const
export const HISTORY_PRESET_RANGES = ['5m', '15m', '30m', '1h', '6h', '24h'] as const
export const HISTORY_MAX_POINTS = 5000

export type HistoryFixedResolution = (typeof HISTORY_FIXED_RESOLUTIONS)[number]
export type HistoryResolution = (typeof HISTORY_QUERY_RESOLUTIONS)[number]
export type HistoryPresetRange = (typeof HISTORY_PRESET_RANGES)[number]
export type HistoryTier = 'cache' | 'ram' | 'hot' | 'archive'
export type HistorySource = 'cache' | 'database'
export type HistoryQuality = 'GOOD' | 'UNCERTAIN' | 'BAD'
export type HistoryGapReason = string
export type HistoryErrorKind = 'invalid_request' | 'output_budget_exceeded' | 'historian_unavailable' | 'network_error' | 'http_error' | 'invalid_response'

export interface HistoryQuery {
  pointIds: readonly string[]
  from: string | Date
  to: string | Date
  resolution?: HistoryResolution
  maxPoints?: number
  source?: HistorySource
}

export interface HistorySample {
  time: string
  timeMs: number
  value: number
  min: number
  max: number
  sum: number
  count: number
  quality: HistoryQuality
  source: string
  tier: HistoryTier
  generation: number
}

export interface HistorySeries {
  pointId: string
  generation: number
  effectiveResolution: HistoryFixedResolution
  samples: HistorySample[]
}

export interface HistoryGap {
  pointId: string
  generation: number
  fromUtc: string
  fromUtcMs: number
  toUtc: string
  toUtcMs: number
  reason: HistoryGapReason
  detail?: string
}

export interface HistoryResponse {
  from: string
  fromMs: number
  to: string
  toMs: number
  complete: boolean
  series: HistorySeries[]
  gaps: HistoryGap[]
  tiersUsed: HistoryTier[]
}

interface HistoryErrorBody {
  error?: unknown
  code?: unknown
  request_id?: unknown
  details?: unknown
}

export class HistoryApiError extends Error {
  readonly status: number
  readonly kind: HistoryErrorKind
  readonly code?: number
  readonly requestId?: string
  readonly details?: unknown

  constructor(message: string, status: number, kind: HistoryErrorKind, body: HistoryErrorBody = {}) {
    super(message)
    this.name = 'HistoryApiError'
    this.status = status
    this.kind = kind
    this.code = typeof body.code === 'number' ? body.code : undefined
    this.requestId = typeof body.request_id === 'string' ? body.request_id : undefined
    this.details = body.details
  }
}

export interface HistoryClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  getHeaders?: () => HeadersInit
  onUnauthorized?: () => void
}

export interface HistoryRequestOptions {
  signal?: AbortSignal
}

export interface HistoryClient {
  query(query: HistoryQuery, options?: HistoryRequestOptions): Promise<HistoryResponse>
  csvUrl(query: HistoryQuery): string
}

type HistoryAuthHeaderProvider = () => HeadersInit

const historyApiBase = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`
let historyAuthHeaderProvider: HistoryAuthHeaderProvider = () => ({})

export function setHistoryAuthHeaderProvider(provider: HistoryAuthHeaderProvider): void {
  historyAuthHeaderProvider = provider
}

export function buildHistoryQuery(query: HistoryQuery): URLSearchParams {
  validatePointIds(query.pointIds)
  const from = normalizeUtcInput(query.from, 'from')
  const to = normalizeUtcInput(query.to, 'to')
  if (from.timeMs >= to.timeMs) throw new TypeError('History from must be before to for the [from,to) range')

  const resolution = query.resolution ?? 'auto'
  if (!isHistoryResolution(resolution)) throw new TypeError('History resolution is invalid')
  const maxPoints = query.maxPoints ?? HISTORY_MAX_POINTS
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > HISTORY_MAX_POINTS) {
    throw new TypeError(`History maxPoints must be in 1..${HISTORY_MAX_POINTS}`)
  }
  if (query.source !== undefined && query.source !== 'cache' && query.source !== 'database') {
    throw new TypeError('History source must be cache or database')
  }

  const params = new URLSearchParams({
    point: query.pointIds.join(','),
    from: from.time,
    to: to.time,
    resolution,
    maxPoints: String(maxPoints)
  })
  if (query.source) params.set('source', query.source)
  return params
}

export function historyCsvUrl(query: HistoryQuery, baseUrl = historyApiBase): string {
  return `${baseUrl.replace(/\/$/, '')}/history/export.csv?${buildHistoryQuery(query).toString()}`
}

export function historySeriesKey(pointId: string, generation: number): string {
  return `${pointId}\u0000${generation}`
}

export function historyPresetDurationMs(range: HistoryPresetRange): number {
  switch (range) {
    case '5m': return 5 * 60_000
    case '15m': return 15 * 60_000
    case '30m': return 30 * 60_000
    case '1h': return 60 * 60_000
    case '6h': return 6 * 60 * 60_000
    case '24h': return 24 * 60 * 60_000
  }
}

export function normalizeHistoryResponse(raw: unknown): HistoryResponse {
  const root = asRecord(raw, 'history response')
  const from = normalizeWireUtc(root.from, 'history response from')
  const to = normalizeWireUtc(root.to, 'history response to')
  if (from.timeMs >= to.timeMs) invalidResponse('History response has an invalid [from,to) range')
  if (typeof root.complete !== 'boolean') invalidResponse('History response complete must be boolean')
  if (!Array.isArray(root.series) || !Array.isArray(root.gaps) || !Array.isArray(root.tiersUsed)) {
    invalidResponse('History response series, gaps, and tiersUsed must be arrays')
  }

  const tiersUsed = unique(root.tiersUsed.map((tier, index) => readTier(tier, `tiersUsed[${index}]`)))
  const series = root.series.map((item, index) => normalizeSeries(item, index))
  const keys = new Set<string>()
  for (const item of series) {
    const key = historySeriesKey(item.pointId, item.generation)
    if (keys.has(key)) invalidResponse(`History response contains duplicate series ${item.pointId} generation ${item.generation}`)
    keys.add(key)
  }

  return {
    from: from.time,
    fromMs: from.timeMs,
    to: to.time,
    toMs: to.timeMs,
    complete: root.complete,
    series,
    gaps: root.gaps.map((item, index) => normalizeGap(item, index)),
    tiersUsed
  }
}

export function createHistoryClient(options: HistoryClientOptions = {}): HistoryClient {
  const baseUrl = (options.baseUrl ?? historyApiBase).replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const getHeaders = options.getHeaders ?? (() => historyAuthHeaderProvider())

  return {
    async query(query, requestOptions = {}) {
      const headers = new Headers(getHeaders())
      headers.set('accept', 'application/json')
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/history?${buildHistoryQuery(query).toString()}`, {
          method: 'GET',
          headers,
          credentials: 'include',
          signal: requestOptions.signal
        })
      } catch (error) {
        if (requestOptions.signal?.aborted) throw error
        const message = error instanceof Error ? error.message : 'History request failed'
        throw new HistoryApiError(message, 0, 'network_error')
      }

      if (response.status === 401) options.onUnauthorized?.()
      if (!response.ok) throw await responseError(response)

      let raw: unknown
      try {
        raw = await response.json()
      } catch {
        throw new HistoryApiError('History response is not valid JSON', response.status, 'invalid_response')
      }
      return normalizeHistoryResponse(raw)
    },
    csvUrl(query) {
      return historyCsvUrl(query, baseUrl)
    }
  }
}

export const historyClient = createHistoryClient({
  onUnauthorized: () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mkddc:auth-expired'))
  }
})

function normalizeSeries(raw: unknown, index: number): HistorySeries {
  const item = asRecord(raw, `series[${index}]`)
  const pointId = readCanonicalPointId(item.pointId, `series[${index}].pointId`)
  const generation = readPositiveInteger(item.generation, `series[${index}].generation`)
  const effectiveResolution = item.effectiveResolution
  if (!isFixedHistoryResolution(effectiveResolution)) invalidResponse(`series[${index}].effectiveResolution is invalid`)
  if (!Array.isArray(item.samples)) invalidResponse(`series[${index}].samples must be an array`)

  return {
    pointId,
    generation,
    effectiveResolution,
    samples: item.samples.map((sample, sampleIndex) => normalizeSample(sample, index, sampleIndex, generation))
  }
}

function normalizeSample(raw: unknown, seriesIndex: number, sampleIndex: number, seriesGeneration: number): HistorySample {
  const path = `series[${seriesIndex}].samples[${sampleIndex}]`
  const item = asRecord(raw, path)
  const time = normalizeWireUtc(item.time, `${path}.time`)
  const generation = readPositiveInteger(item.generation, `${path}.generation`)
  if (generation !== seriesGeneration) invalidResponse(`${path}.generation does not match its series`)
  const quality = typeof item.quality === 'string' ? item.quality.toUpperCase() : item.quality
  if (!isHistoryQuality(quality)) invalidResponse(`${path}.quality is invalid`)

  return {
    time: time.time,
    timeMs: time.timeMs,
    value: readFiniteNumber(item.value, `${path}.value`),
    min: readFiniteNumber(item.min, `${path}.min`),
    max: readFiniteNumber(item.max, `${path}.max`),
    sum: readFiniteNumber(item.sum, `${path}.sum`),
    count: readPositiveInteger(item.count, `${path}.count`),
    quality,
    source: readNonEmptyString(item.source, `${path}.source`),
    tier: readTier(item.tier, `${path}.tier`),
    generation
  }
}

function normalizeGap(raw: unknown, index: number): HistoryGap {
  const path = `gaps[${index}]`
  const item = asRecord(raw, path)
  const from = normalizeWireUtc(item.fromUtc, `${path}.fromUtc`)
  const to = normalizeWireUtc(item.toUtc, `${path}.toUtc`)
  if (from.timeMs >= to.timeMs) invalidResponse(`${path} has an invalid [from,to) range`)
  if (!isGapReason(item.reason)) invalidResponse(`${path}.reason is invalid`)
  if (item.detail !== undefined && typeof item.detail !== 'string') invalidResponse(`${path}.detail must be a string`)

  return {
    pointId: readCanonicalPointId(item.pointId, `${path}.pointId`),
    generation: readPositiveInteger(item.generation, `${path}.generation`),
    fromUtc: from.time,
    fromUtcMs: from.timeMs,
    toUtc: to.time,
    toUtcMs: to.timeMs,
    reason: item.reason,
    ...(item.detail === undefined ? {} : { detail: item.detail })
  }
}

async function responseError(response: Response): Promise<HistoryApiError> {
  const text = await response.text().catch(() => '')
  let body: HistoryErrorBody = {}
  try {
    body = JSON.parse(text) as HistoryErrorBody
  } catch {
    // Plain text remains useful when a proxy generated the failure.
  }
  const message = typeof body.error === 'string' ? body.error : text || `${response.status} ${response.statusText}`
  return new HistoryApiError(message, response.status, errorKind(response.status), body)
}

function errorKind(status: number): HistoryErrorKind {
  if (status === 400) return 'invalid_request'
  if (status === 413) return 'output_budget_exceeded'
  if (status === 503) return 'historian_unavailable'
  return 'http_error'
}

function validatePointIds(pointIds: readonly string[]): void {
  if (pointIds.length < 1 || pointIds.length > 8) throw new TypeError('History pointIds must contain 1..8 canonical IDs')
  const seen = new Set<string>()
  for (const pointId of pointIds) {
    if (!isCanonicalPointId(pointId)) throw new TypeError(`History point ID must be canonical: ${pointId}`)
    if (seen.has(pointId)) throw new TypeError(`History point IDs must be unique: ${pointId}`)
    seen.add(pointId)
  }
}

function readCanonicalPointId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !isCanonicalPointId(value)) invalidResponse(`${path} must be a canonical point ID`)
  return value
}

function isCanonicalPointId(value: string): boolean {
  const physical = /^(UI|AO|DO)-(\d+)$/.exec(value)
  if (physical) {
    const channel = Number(physical[2])
    return Number.isSafeInteger(channel) && channel > 0 && physical[2] === String(channel).padStart(2, '0')
  }
  const virtual = /^VP(\d+)$/.exec(value)
  if (!virtual) return false
  const channel = Number(virtual[1])
  return Number.isSafeInteger(channel) && channel > 0 && virtual[1] === String(channel)
}

function normalizeUtcInput(value: string | Date, path: string): { time: string; timeMs: number } {
  if (value instanceof Date) return normalizeDate(value, path)
  if (typeof value !== 'string' || !/(?:Z|\+00:00)$/i.test(value)) {
    throw new TypeError(`History ${path} must be an explicit RFC3339 UTC timestamp`)
  }
  return normalizeDate(new Date(value), path)
}

function normalizeWireUtc(value: unknown, path: string): { time: string; timeMs: number } {
  if (typeof value !== 'string' || !/(?:Z|\+00:00)$/i.test(value)) invalidResponse(`${path} must be an RFC3339 UTC timestamp`)
  return normalizeWireDate(new Date(value), path)
}

function normalizeDate(value: Date, path: string): { time: string; timeMs: number } {
  const timeMs = value.getTime()
  if (!Number.isFinite(timeMs)) throw new TypeError(`History ${path} must be a valid UTC timestamp`)
  return { time: value.toISOString(), timeMs }
}

function normalizeWireDate(value: Date, path: string): { time: string; timeMs: number } {
  const timeMs = value.getTime()
  if (!Number.isFinite(timeMs)) invalidResponse(`${path} must be a valid UTC timestamp`)
  return { time: value.toISOString(), timeMs }
}

export function historyResponseToTrendSamples(res: HistoryResponse, pointIds: readonly string[]): TrendSample[] {
  const byTime = new Map<number, TrendSample>()
  for (const series of res.series) {
    for (const sample of series.samples) {
      let row = byTime.get(sample.timeMs)
      if (!row) {
        row = {
          __ts: sample.timeMs,
          time: formatTime(new Date(sample.timeMs).toISOString()),
          raw: sample.value,
          [series.pointId]: sample.value
        }
        byTime.set(sample.timeMs, row)
      } else {
        row[series.pointId] = sample.value
        if (pointIds.length === 1 && series.pointId === pointIds[0]) {
          row.raw = sample.value
        }
      }
    }
  }
  return [...byTime.values()].sort((a, b) => Number(a.__ts ?? 0) - Number(b.__ts ?? 0))
}

export async function fetchRecentTrendSamples(
  pointIds: readonly string[],
  windowMs = 120_000,
  maxPoints = 60
): Promise<TrendSample[]> {
  const canonicalIds = pointIds.filter(isCanonicalPointId).slice(0, 8)
  if (!canonicalIds.length) return []
  const now = Date.now()
  // Bổ sung buffer lùi quá khứ để mẫu cũ nhất luôn nằm trước mép trái biểu đồ,
  // bù trừ độ trễ chốt bucket 15s của backend và tránh bị khoảng trắng đầu trục.
  const lookbackBufferMs = Math.max(120_000, Math.round(windowMs * 0.25))
  const from = new Date(now - windowMs - lookbackBufferMs)
  const to = new Date(now)

  if (HISTORIAN_V2_TRENDS_ENABLED) {
    try {
      const res = await historyClient.query({
        pointIds: canonicalIds,
        from,
        to,
        resolution: 'auto',
        maxPoints,
        source: 'cache'
      })
      if (res.series.some((s) => s.samples.length > 0)) {
        return historyResponseToTrendSamples(res, canonicalIds)
      }
      const dbRes = await historyClient.query({
        pointIds: canonicalIds,
        from,
        to,
        resolution: 'auto',
        maxPoints,
        source: 'database'
      })
      if (dbRes.series.some((s) => s.samples.length > 0)) {
        return historyResponseToTrendSamples(dbRes, canonicalIds)
      }
    } catch {
      // Fall through to legacy API on error
    }
  }

  try {
    const rangeSec = Math.max(30, Math.ceil(windowMs / 1000))
    return await apiClient.getHistory(canonicalIds, `${rangeSec}s`)
  } catch {
    return []
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidResponse(`${path} must be an object`)
  return value as Record<string, unknown>
}

function readPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalidResponse(`${path} must be a positive integer`)
  return value
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidResponse(`${path} must be a finite number`)
  return value
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalidResponse(`${path} must be a non-empty string`)
  return value
}

function readTier(value: unknown, path: string): HistoryTier {
  if (value !== 'cache' && value !== 'ram' && value !== 'hot' && value !== 'archive') invalidResponse(`${path} is invalid`)
  return value
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function isHistoryResolution(value: unknown): value is HistoryResolution {
  return typeof value === 'string' && (HISTORY_QUERY_RESOLUTIONS as readonly string[]).includes(value)
}

function isFixedHistoryResolution(value: unknown): value is HistoryFixedResolution {
  return typeof value === 'string' && (HISTORY_FIXED_RESOLUTIONS as readonly string[]).includes(value)
}

function isHistoryQuality(value: unknown): value is HistoryQuality {
  return value === 'GOOD' || value === 'UNCERTAIN' || value === 'BAD'
}

function isGapReason(value: unknown): value is HistoryGapReason {
  return typeof value === 'string' && value.trim().length > 0
}

function invalidResponse(message: string): never {
  throw new HistoryApiError(message, 200, 'invalid_response')
}
