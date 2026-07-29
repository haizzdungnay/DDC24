import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildHistoryQuery, type HistoryResponse } from '../api/history'
import { formatTrendTime, TrendChart } from '../components/TrendChart'
import { HISTORIAN_V2_TRENDS_ENABLED, IS_DEMO } from '../config'
import type { Point, TrendSample } from '../types'
import { TREND_LIVE_REFRESH_MS, appendLiveTrendSample, buildHistoryChartModel, buildTrendHistoryRequest, buildTrendRows, historyPresentationState, historySourceForRange, legacyHistoryResponse } from './TrendsPage'

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

afterEach(cleanup)

const point: Point = {
  id: 'VP2',
  tag: 'fan_enable',
  name: 'Fan enable',
  kind: 'virtual',
  value: true,
  quality: 'good',
  source: 'runtime',
  updatedAt: '2026-07-20T00:00:00Z',
  signalType: 'boolean'
}

const response: HistoryResponse = {
  from: '2026-07-20T00:00:00.000Z',
  fromMs: Date.parse('2026-07-20T00:00:00Z'),
  to: '2026-07-20T00:01:00.000Z',
  toMs: Date.parse('2026-07-20T00:01:00Z'),
  complete: false,
  tiersUsed: ['archive', 'hot'],
  series: [
    {
      pointId: 'VP2', generation: 1, effectiveResolution: '15s', samples: [
        { time: '2026-07-20T00:00:15.000Z', timeMs: Date.parse('2026-07-20T00:00:15Z'), value: 1, min: 1, max: 1, sum: 1, count: 1, quality: 'GOOD', source: 'runtime', tier: 'archive', generation: 1 },
        { time: '2026-07-20T00:00:30.000Z', timeMs: Date.parse('2026-07-20T00:00:30Z'), value: 0, min: 0, max: 0, sum: 0, count: 1, quality: 'BAD', source: 'runtime', tier: 'archive', generation: 1 }
      ]
    },
    {
      pointId: 'VP2', generation: 2, effectiveResolution: '15s', samples: [
        { time: '2026-07-20T00:00:15.000Z', timeMs: Date.parse('2026-07-20T00:00:15Z'), value: 0, min: 0, max: 0, sum: 0, count: 1, quality: 'GOOD', source: 'runtime', tier: 'hot', generation: 2 }
      ]
    }
  ],
  gaps: [{ pointId: 'VP2', generation: 1, fromUtc: '2026-07-20T00:00:40.000Z', fromUtcMs: Date.parse('2026-07-20T00:00:40Z'), toUtc: '2026-07-20T00:00:50.000Z', toUtcMs: Date.parse('2026-07-20T00:00:50Z'), reason: 'restart' }]
}

describe('unified Trends presentation', () => {
  it('keeps generations separate, preserves server tiers, and inserts BAD/gap breaks', () => {
    const model = buildHistoryChartModel(response, [point])
    expect(model.series.map((item) => [item.generation, item.label, item.stepped])).toEqual([
      [1, 'fan_enable · g1', true],
      [2, 'fan_enable · g2', true]
    ])
    const shared = model.samples.find((row) => row.__ts === Date.parse('2026-07-20T00:00:15Z'))!
    expect(shared['VP2::g1:tier']).toBe('archive')
    expect(shared['VP2::g2:tier']).toBe('hot')
    const bad = model.samples.find((row) => row.__ts === Date.parse('2026-07-20T00:00:30Z'))!
    expect(bad['VP2::g1']).toBeNull()
    expect(bad['VP2::g1:quality']).toBe('BAD')
    const gap = model.samples.find((row) => row.__ts === Date.parse('2026-07-20T00:00:40Z'))!
    expect(gap['VP2::g1']).toBeNull()
    expect(gap['VP2::g1:quality']).toBe('GAP')
  })

  it('renders boolean generations as stepped disconnected lines', () => {
    const model = buildHistoryChartModel(response, [point])
    render(<TrendChart data={model.samples} series={model.series} />)
    expect(screen.getByTestId('trend-line-VP2::g1')).toHaveAttribute('data-line-type', 'stepAfter')
    expect(screen.getByTestId('trend-line-VP2::g1')).toHaveAttribute('data-connect-nulls', 'false')
    expect(screen.getByTestId('trend-line-VP2::g2')).toHaveAttribute('data-line-type', 'stepAfter')
  })

  it('treats explicit gaps as partial even if complete is true', () => {
    expect(historyPresentationState({ ...response, complete: true }, null)?.state).toBe('partial')
  })

  it('defaults live builds to v2 after activation and keeps the legacy adapter explicitly partial', () => {
    const rows: TrendSample[] = [{ time: '00:00:15', __ts: Date.parse('2026-07-20T00:00:15Z'), VP2: 1 }]
    const legacy = legacyHistoryResponse(['VP2'], rows, response.fromMs, response.toMs)
    expect(HISTORIAN_V2_TRENDS_ENABLED).toBe(!IS_DEMO)
    expect(legacy.complete).toBe(false)
    expect(legacy.gaps[0].reason).toBe('legacy_query_gap_evidence_unavailable')
  })

  it('uses the 24-hour cache for presets and the database only for Custom', () => {
    expect(historySourceForRange(null)).toBe('cache')
    expect(historySourceForRange({ fromMs: response.fromMs, toMs: response.toMs })).toBe('database')
  })

  it('formats Custom historian timestamps in UTC instead of browser-local time', () => {
    const timestamp = Date.parse('2026-07-20T03:04:05Z')
    expect(formatTrendTime(timestamp, 'UTC')).toContain('03:04:05')
    expect(formatTrendTime(timestamp, 'UTC')).not.toContain('10:04:05')
  })

  it.each([
    [30, '30m'],
    [60, '1h'],
    [360, '6h'],
    [1440, '24h']
  ] as const)('maps %i minutes to %s on the cache path without a legacy range query', (minutes, preset) => {
    const request = buildTrendHistoryRequest(['VP2'], minutes, null, response.toMs)
    const params = buildHistoryQuery(request.query)

    expect(request.preset).toBe(preset)
    expect(params.get('source')).toBe('cache')
    expect(params.has('range')).toBe(false)
    expect(Date.parse(params.get('to')!) - Date.parse(params.get('from')!)).toBe(minutes * 60_000)
  })

  it('maps Custom to exact database bounds without a legacy range value', () => {
    const customRange = { fromMs: response.fromMs, toMs: response.toMs }
    const request = buildTrendHistoryRequest(['VP2'], 30, customRange, response.toMs + 60_000)
    const params = buildHistoryQuery(request.query)

    expect(request.preset).toBeNull()
    expect(params.get('from')).toBe(response.from)
    expect(params.get('to')).toBe(response.to)
    expect(params.get('source')).toBe('database')
    expect(params.has('range')).toBe(false)
  })

  it('uses the live point value for the realtime table while preserving historian values for Custom', () => {
    const livePoint = { ...point, value: 42 }
    const series = [{ key: 'VP2::g1', pointId: 'VP2', generation: 1, label: 'Fan enable', color: '#123456', stepped: true }]
    const samples: TrendSample[] = [{ time: '2026-07-20T00:00:15.000Z', __ts: Date.parse('2026-07-20T00:00:15Z'), 'VP2::g1': 7 }]

    expect(buildTrendRows(series, [livePoint], samples, true)[0].current).toBe(42)
    expect(buildTrendRows(series, [livePoint], samples, false)[0].current).toBe(7)
  })

  it('adds a one-second live chart tail to presets without changing cache statistics or Custom', () => {
    expect(TREND_LIVE_REFRESH_MS).toBeLessThanOrEqual(1000)
    const livePoint = { ...point, value: 42, quality: 'good' as const, source: 'core' }
    const series = [{ key: 'VP2::g1', pointId: 'VP2', generation: 1, label: 'Fan enable', color: '#123456', stepped: true }]
    const samples: TrendSample[] = [
      { time: '2026-07-20T00:00:15.000Z', __ts: Date.parse('2026-07-20T00:00:15Z'), 'VP2::g1': 7 },
      { time: '2026-07-20T00:00:30.000Z', __ts: Date.parse('2026-07-20T00:00:30Z'), 'VP2::g1': 8 }
    ]
    const capturedAtMs = Date.parse('2026-07-20T00:00:31Z')

    const liveSamples = appendLiveTrendSample(samples, series, [livePoint], true, capturedAtMs)
    expect(liveSamples).toHaveLength(3)
    expect(liveSamples[2]).toMatchObject({
      __ts: capturedAtMs,
      'VP2::g1': 42,
      'VP2::g1:quality': 'GOOD',
      'VP2::g1:source': 'core',
      'VP2::g1:tier': 'live'
    })
    expect(appendLiveTrendSample(samples, series, [livePoint], false, capturedAtMs)).toBe(samples)
    expect(buildTrendRows(series, [livePoint], samples, true)[0]).toMatchObject({ current: 42, avg: 7.5, min: 7, max: 8, samples: 2 })
  })
})
