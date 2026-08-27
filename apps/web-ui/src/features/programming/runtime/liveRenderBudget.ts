/**
 * `T59-812` / `DDO-PGM02-009` — ngân sách vẽ giá trị LIVE.
 *
 * Producer có thể chuyển từ poll sang stream mà không được làm React commit theo
 * mọi sample. Bộ điều tiết này giữ sample MỚI NHẤT và phát không quá 10 Hz; nó
 * không nội suy, không cộng dồn và không biến sample bị bỏ thành dữ liệu khác.
 */
export const LIVE_RENDER_MAX_HZ = 10
export const LIVE_RENDER_MIN_INTERVAL_MS = 1000 / LIVE_RENDER_MAX_HZ

export interface LatestRenderBudget<T> {
  push: (value: T) => void
  /** Hủy timer và quên sample chờ khi rời LIVE/unmount/fault. */
  cancel: () => void
}

interface RenderBudgetClock {
  now: () => number
  schedule: (callback: () => void, delayMs: number) => number
  cancel: (timer: number) => void
}

const browserClock: RenderBudgetClock = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (timer) => window.clearTimeout(timer),
}

/**
 * Bộ điều tiết trailing-latest: sample đầu phát ngay; trong cửa sổ 100 ms chỉ
 * giữ sample cuối. `clock` được tiêm để test giới hạn bằng đồng hồ giả, không
 * phụ thuộc tốc độ máy chạy CI.
 */
export function createLatestRenderBudget<T>(
  emit: (value: T) => void,
  clock: RenderBudgetClock = browserClock,
): LatestRenderBudget<T> {
  let lastEmitAt: number | null = null
  let pending: T | undefined
  let hasPending = false
  let timer: number | null = null

  const flush = () => {
    timer = null
    if (!hasPending) return
    const value = pending as T
    pending = undefined
    hasPending = false
    lastEmitAt = clock.now()
    emit(value)
  }

  return {
    push(value) {
      const now = clock.now()
      if (lastEmitAt === null || now - lastEmitAt >= LIVE_RENDER_MIN_INTERVAL_MS) {
        if (timer !== null) clock.cancel(timer)
        timer = null
        pending = undefined
        hasPending = false
        lastEmitAt = now
        emit(value)
        return
      }

      pending = value
      hasPending = true
      if (timer !== null) return
      timer = clock.schedule(flush, LIVE_RENDER_MIN_INTERVAL_MS - (now - lastEmitAt))
    },
    cancel() {
      if (timer !== null) clock.cancel(timer)
      timer = null
      pending = undefined
      hasPending = false
      lastEmitAt = null
    },
  }
}
