/* Hàm định dạng dùng chung cho phần bảng (TrendChart.tsx, chunk chính) và phần
 * vẽ SVG (TrendChartPlot.tsx, tải lười cùng thư viện biểu đồ — T63-104/T63-109).
 * Tách ra file riêng để hai phía cùng đọc một nguồn mà không import vòng. */
import type { TrendSample } from '../types'

/** Hậu tố khoá của dải min–max trong `TrendSample`. Một chỗ duy nhất định
 *  nghĩa, để nơi dựng dữ liệu và nơi vẽ không trôi khỏi nhau. */
export const TREND_BAND_SUFFIX = '::band'

export function trendBandKey(seriesKey: string): string {
  return `${seriesKey}${TREND_BAND_SUFFIX}`
}

export function displayTrendValue(value: TrendSample[string] | undefined, kind?: string, stepped?: boolean): string {
  if (value === null || value === undefined) return 'No value'
  if (Array.isArray(value)) return value.length === 2 ? `${value[0]} … ${value[1]}` : 'No value'
  if (typeof value === 'string') return value
  if (stepped || kind === 'DO' || kind === 'DI') return value ? 'ON' : 'OFF'
  return String(value)
}

export function formatTrendTime(value: number | string | number[] | null, timeZone: 'UTC' | 'local' = 'local'): string {
  if (value === null || Array.isArray(value)) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('vi-VN', timeZone === 'UTC' ? { timeZone: 'UTC', hour12: false } : undefined)
    : String(value)
}

export function formatTrendRaw(value: unknown, unit: string): string {
  if (typeof value !== 'number') return '—'
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed} ${unit}`
}
