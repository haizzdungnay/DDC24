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

/* BL-008: bộ chọn khoảng thời gian Trends làm việc theo GIỜ ĐỊA PHƯƠNG.
 *
 * `<input type="datetime-local">` theo định nghĩa là giờ địa phương không mang
 * offset: trình duyệt hiển thị đúng chuỗi ta đưa vào và trả lại đúng chuỗi người
 * dùng gõ. Vì vậy hai hàm dưới đây phải cùng dùng một hệ quy chiếu.
 *
 * Trước 2026-08-04 chúng dùng UTC (`toISOString()` để hiển thị, `Date.parse(v+'Z')`
 * để đọc) và nhãn ghi "From (UTC)" — sai lệch nhưng NHẤT QUÁN, nên vẫn dùng được.
 * Khi nhãn được đổi sang "Giờ địa phương" mà phần tính toán giữ nguyên, cặp
 * nhãn/hành vi trở thành mâu thuẫn: người dùng ở UTC+7 gõ 14:00 với ý 2 giờ chiều
 * sẽ truy vấn 14:00 UTC, tức 21:00 giờ Việt Nam — lệch 7 tiếng mà không có dấu
 * hiệu nào trên giao diện. Sửa phần tính toán cho khớp nhãn, không sửa nhãn. */

export function parseTrendCustomRange(fromLocal: string, toLocal: string, nowMs = Date.now()): TrendCustomRange {
  const fromMs = parseLocalDateTimeInput(fromLocal)
  const toMs = parseLocalDateTimeInput(toLocal)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) throw new Error('From must be before To.')
  if (toMs > nowMs + 60_000) throw new Error('To must not be in the future.')
  return { fromMs, toMs }
}

/** Chuỗi `YYYY-MM-DDTHH:mm` theo giờ địa phương, dùng cho `<input datetime-local>`. */
export function localDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
       + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Tên múi giờ đang có hiệu lực của trình duyệt, để nhãn không thể nói sai. */
export function localTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'giờ địa phương'
}

function parseLocalDateTimeInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return Number.NaN
  /* Chuỗi date-time KHÔNG có offset được ECMAScript quy định là giờ địa phương. */
  return Date.parse(value)
}
