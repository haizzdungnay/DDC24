export type HmiLocale = 'vi-VN' | 'en-US'

export const TECHNICAL_TIME_ZONE = 'UTC'

type TimestampValue = Date | number | string | null | undefined

function validDate(value: TimestampValue): Date | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatter(locale: HmiLocale, includeDate: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    ...(includeDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } as const : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: TECHNICAL_TIME_ZONE,
  })
}

/**
 * Timestamp kỹ thuật luôn dùng UTC vì API lưu/phát RFC3339 UTC. Hậu tố UTC
 * được in ra để trình duyệt không âm thầm đổi mốc sang timezone của máy trạm.
 */
export function formatTechnicalTime(value: TimestampValue, locale: HmiLocale): string {
  const parsed = validDate(value)
  return parsed ? `${formatter(locale, false).format(parsed)} UTC` : '—'
}

export function formatTechnicalDateTime(value: TimestampValue, locale: HmiLocale): string {
  const parsed = validDate(value)
  return parsed ? `${formatTechnicalDate(parsed, locale)} · ${formatTechnicalTime(parsed, locale)}` : '—'
}

export function formatTechnicalDate(value: TimestampValue, locale: HmiLocale): string {
  const parsed = validDate(value)
  if (!parsed) return '—'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TECHNICAL_TIME_ZONE,
  }).format(parsed)
}
