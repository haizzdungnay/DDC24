import { describe, expect, it } from 'vitest'
import { filterTrendSamplesByRange, parseTrendCustomRange, utcDateTimeInputValue } from './trendsFilters'

describe('Trends explicit UTC range', () => {
  it('treats datetime-local text as UTC wall time without browser timezone conversion', () => {
    const range = parseTrendCustomRange('2026-07-18T01:02', '2026-07-20T03:04', Date.parse('2026-07-20T04:00:00Z'))
    expect(range).toEqual({
      fromMs: Date.parse('2026-07-18T01:02:00Z'),
      toMs: Date.parse('2026-07-20T03:04:00Z')
    })
  })

  it('allows ranges older than 24 hours and rejects future or reversed bounds', () => {
    const now = Date.parse('2026-07-20T04:00:00Z')
    expect(() => parseTrendCustomRange('2026-01-01T00:00', '2026-07-20T03:00', now)).not.toThrow()
    expect(() => parseTrendCustomRange('2026-07-20T03:00', '2026-07-20T02:00', now)).toThrow(/before/i)
    expect(() => parseTrendCustomRange('2026-07-20T03:00', '2026-07-20T05:00', now)).toThrow(/future/i)
  })

  it('formats a Date using UTC components for the UTC-labelled input', () => {
    expect(utcDateTimeInputValue(new Date('2026-07-20T03:04:05Z'))).toBe('2026-07-20T03:04')
  })

  it('keeps legacy adapter filtering half-open at the To boundary', () => {
    const samples = [
      { time: 'a', __ts: 1000, value: 1 },
      { time: 'b', __ts: 2000, value: 2 }
    ]
    expect(filterTrendSamplesByRange(samples, 1000, 2000)).toHaveLength(1)
  })
})
