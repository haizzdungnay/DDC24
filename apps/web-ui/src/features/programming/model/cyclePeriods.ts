import { PROGRAMMING_ALLOWED_PERIOD_MS } from '../api/generated/profile'

/**
 * Tập chu kỳ Task/Program phía FE (ADR-061 C1, mục 4.13/4.14).
 *
 * Nguồn thứ nhất là `capabilities.taskPeriodsMs` của thiết bị đang nói chuyện;
 * khi chưa đọc được thì dùng hằng SINH từ `product_profile_v2.json`. Không nơi
 * nào trong FE được chép tay danh sách chu kỳ nữa: bản chép tay `[1000, 5000,
 * 30000]` cũ (X12) đã âm thầm ép mọi chu kỳ lạ về 1000 ms — tức có thể biến một
 * Program 10 ms thành 1000 ms mà không ai thấy.
 */

/** Chu kỳ của profile 2.1 không còn trong tập 2.2 — vẫn ĐỌC được, không ĐẶT được. */
export const LEGACY_PROGRAMMING_PERIODS_MS: readonly number[] = [30000]

/** Chu kỳ mặc định cho Program/Task mới — KHÔNG phải phần tử đầu (10 ms). */
export const DEFAULT_PROGRAMMING_PERIOD_MS = 1000

/**
 * Danh sách chu kỳ chọn được. Nhận `capabilities.taskPeriodsMs` khi có; phần tử
 * không phải số nguyên dương bị bỏ, danh sách rỗng hoặc hỏng rơi về hằng sinh mã.
 */
export function programmingPeriodChoices(capabilityPeriods?: readonly number[] | null): readonly number[] {
  const fromDevice = (capabilityPeriods ?? []).filter((value) => Number.isInteger(value) && value > 0)
  if (fromDevice.length === 0) return PROGRAMMING_ALLOWED_PERIOD_MS
  return [...new Set(fromDevice)].sort((left, right) => left - right)
}

export type ProgrammingPeriodValidity = 'VALID' | 'LEGACY' | 'INVALID'

/** Phân loại một chu kỳ ĐÃ LƯU theo tập đang có hiệu lực. */
export function programmingPeriodValidity(
  periodMs: number,
  allowed: readonly number[] = PROGRAMMING_ALLOWED_PERIOD_MS
): ProgrammingPeriodValidity {
  if (allowed.includes(periodMs)) return 'VALID'
  if (LEGACY_PROGRAMMING_PERIODS_MS.includes(periodMs)) return 'LEGACY'
  return 'INVALID'
}

/**
 * Hiển thị chu kỳ: dưới 1 s viết bằng ms ("10 ms", "500 ms"), từ 1 s trở lên
 * viết bằng giây ("1 s", "50 s", "1.5 s"). Giá trị không phải số hữu hạn dương
 * hiện `—` thay vì một con số bịa.
 */
export function formatProgrammingPeriod(periodMs: number | null | undefined): string {
  if (typeof periodMs !== 'number' || !Number.isFinite(periodMs) || periodMs <= 0) return '—'
  if (periodMs < 1000) return `${periodMs} ms`
  const seconds = periodMs / 1000
  return `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(3))} s`
}

/**
 * Hai chu kỳ hợp lệ gần nhất quanh một giá trị không hợp lệ — dùng để gợi ý
 * "chọn 10 s hoặc 50 s" cho chu kỳ cũ 30 s. Trả mảng 1–2 phần tử theo thứ tự tăng.
 */
export function nearestProgrammingPeriods(
  periodMs: number,
  allowed: readonly number[] = PROGRAMMING_ALLOWED_PERIOD_MS
): number[] {
  const sorted = [...allowed].sort((left, right) => left - right)
  const lower = [...sorted].reverse().find((value) => value < periodMs)
  const upper = sorted.find((value) => value > periodMs)
  return [lower, upper].filter((value): value is number => typeof value === 'number')
}
