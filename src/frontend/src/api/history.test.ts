import { describe, expect, it, vi } from 'vitest'
import {
  HistoryApiError,
  buildHistoryQuery,
  createHistoryClient,
  historyCsvUrl,
  historyPresetDurationMs,
  normalizeHistoryResponse,
  type HistoryQuery
} from './history'

const query: HistoryQuery = {
  pointIds: ['UI-01', 'AO-01', 'VP2'],
  from: '2026-07-20T00:00:00Z',
  to: '2026-07-20T00:01:00Z',
  resolution: '15s',
  maxPoints: 200
}

describe('unified history client contract', () => {
  it.each([
    ['30m', 30 * 60_000],
    ['1h', 60 * 60_000],
    ['6h', 6 * 60 * 60_000],
    ['24h', 24 * 60 * 60_000]
  ] as const)('maps the %s preset to its exact duration', (range, durationMs) => {
    expect(historyPresetDurationMs(range)).toBe(durationMs)
  })

  it('builds an explicit UTC half-open query without legacy range fallback', () => {
    const params = buildHistoryQuery(query)

    expect(params.get('point')).toBe('UI-01,AO-01,VP2')
    expect(params.get('from')).toBe('2026-07-20T00:00:00.000Z')
    expect(params.get('to')).toBe('2026-07-20T00:01:00.000Z')
    expect(params.get('resolution')).toBe('15s')
    expect(params.get('maxPoints')).toBe('200')
    expect(params.has('range')).toBe(false)
  })

  it('rejects non-canonical IDs, non-UTC bounds, and reversed ranges', () => {
    expect(() => buildHistoryQuery({ ...query, pointIds: ['AI-1'] })).toThrow(/canonical/i)
    expect(() => buildHistoryQuery({ ...query, from: '2026-07-20T07:00:00+07:00' })).toThrow(/UTC/i)
    expect(() => buildHistoryQuery({ ...query, to: query.from })).toThrow(/before/i)
    expect(() => buildHistoryQuery({ ...query, pointIds: [] })).toThrow(/1..8/i)
  })

  it('normalizes generation-aware samples and metadata while preserving server tiers', () => {
    const response = normalizeHistoryResponse({
      from: query.from,
      to: query.to,
      complete: false,
      tiersUsed: ['archive', 'hot', 'archive'],
      series: [{
        pointId: 'VP2',
        generation: 3,
        effectiveResolution: '15s',
        samples: [{
          time: '2026-07-20T00:00:15Z', value: 1, min: 1, max: 1, sum: 1, count: 1,
          quality: 'good', source: 'runtime', tier: 'hot', generation: 3
        }]
      }],
      gaps: [{ pointId: 'VP2', generation: 2, fromUtc: query.from, toUtc: query.to, reason: 'restart' }]
    })

    expect(response.tiersUsed).toEqual(['archive', 'hot'])
    expect(response.series[0].generation).toBe(3)
    expect(response.series[0].samples[0].timeMs).toBe(Date.parse('2026-07-20T00:00:15Z'))
    expect(response.series[0].samples[0].quality).toBe('GOOD')
    expect(response.gaps[0].fromUtcMs).toBe(Date.parse('2026-07-20T00:00:00Z'))
  })

  it('uses the same explicit query for JSON and CSV URLs', () => {
    const json = new URL('https://device.test/api/v1/history?' + buildHistoryQuery(query).toString())
    const csv = new URL(historyCsvUrl(query, 'https://device.test/api/v1'))
    expect(csv.pathname).toBe('/api/v1/history/export.csv')
    expect(csv.search).toBe(json.search)
    expect(csv.searchParams.has('range')).toBe(false)
  })

  it.each(['cache', 'database'] as const)('serializes the explicit %s source', (source) => {
    expect(buildHistoryQuery({ ...query, source }).get('source')).toBe(source)
  })

  it('rejects an invalid source at runtime', () => {
    expect(() => buildHistoryQuery({ ...query, source: 'memory' as 'cache' })).toThrow(/source/i)
  })

  it.each([
    [400, 'invalid_request'],
    [413, 'output_budget_exceeded'],
    [503, 'historian_unavailable']
  ] as const)('maps status %i to a structured %s error', async (status, kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'history query failed', code: status, request_id: 'req-7' }), {
      status,
      headers: { 'content-type': 'application/json' }
    }))
    const client = createHistoryClient({ baseUrl: 'https://device.test/api/v1', fetchImpl })

    await expect(client.query(query)).rejects.toMatchObject({
      name: 'HistoryApiError', status, kind, requestId: 'req-7'
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('exposes invalid response as a typed API error', () => {
    expect(() => normalizeHistoryResponse({})).toThrow(HistoryApiError)
  })
})
