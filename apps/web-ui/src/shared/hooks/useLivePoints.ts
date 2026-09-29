import { useEffect, useMemo, useReducer } from 'react'
import { apiClient } from '../api/client'
import { useRealtime } from '../realtime'
import type { Point } from '../types'
import { isFreshIso, mergePointsById } from '../utils'
import { useSharedPoll } from './useSharedPoll'

/**
 * `useLivePoints` — T63-108 (PERF-API-03): bảng điểm cho một màn hình, lấy từ
 * kênh sống (WebSocket `/ws/monitor`) khi kênh đó CÒN SỐNG, và từ `GET /points`
 * khi không.
 *
 * TRƯỚC: mỗi khối Dashboard tự poll `/points` mỗi 2 s và tự trộn với kênh sống.
 * Kênh sống đẩy trọn bảng điểm mỗi 200 ms, nên khi nó chạy thì cả ba vòng poll
 * chỉ để đọc lại đúng thứ đã có — 90 GET/phút vô ích (đo HOST 2026-09-28).
 *
 * SAU:
 *   - Một vòng poll dùng chung cho mọi khối (`useSharedPoll('points')`).
 *   - Kênh sống còn tươi ⇒ poll lùi về nhịp dự phòng 10 s (vẫn có để danh mục
 *     điểm không phụ thuộc hoàn toàn vào WS), giá trị hiển thị lấy từ WS.
 *   - Kênh sống mất hoặc im quá `LIVE_POINTS_STALE_MS` ⇒ quay lại nhịp 2 s và
 *     đọc NGAY (không chờ hết nhịp dự phòng 10 s), vì lúc đó bản poll là nguồn
 *     duy nhất.
 *
 * FAIL-SAFE: "còn sống" đòi đủ ba điều — socket `connected`, đã có điểm, và
 * khung điểm gần nhất không cũ hơn ngưỡng. Một socket còn mở nhưng im lặng
 * (Core đứng, `ts_ns` không đổi ⇒ server không đẩy) KHÔNG được tính là sống, nếu
 * không màn hình sẽ trộn giá trị WS cũ lên trên bản poll mới. Hook tự hẹn giờ
 * render lại đúng lúc khung WS cuối hết hạn, nên việc chuyển về poll không phụ
 * thuộc vào việc có ai khác làm component render lại.
 */
export const LIVE_POINTS_STALE_MS = 2500
export const POINTS_POLL_MS = 2000
export const POINTS_BACKSTOP_MS = 10_000
export const SHARED_POINTS_KEY = 'points'

const emptyPoints: Point[] = []

export interface LivePointsState {
  /** Bảng điểm để hiển thị: bản poll, trộn giá trị WS lên trên khi kênh sống còn tươi. */
  points: Point[]
  /** Kênh sống đang là nguồn giá trị. */
  live: boolean
  /** Bản poll gần nhất; `null` khi CHƯA đọc được lần nào (khác với "không có điểm"). */
  polled: Point[] | null
  error: Error | null
  loading: boolean
  refetch: () => Promise<void>
}

export function useLivePoints(pollMs: number = POINTS_POLL_MS): LivePointsState {
  const realtime = useRealtime()
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const live = realtime.connectionState === 'connected'
    && realtime.allPoints.length > 0
    && isFreshIso(realtime.lastPointEventAt, LIVE_POINTS_STALE_MS)
  const poll = useSharedPoll<Point[]>(SHARED_POINTS_KEY, apiClient.getPoints, live ? Math.max(pollMs, POINTS_BACKSTOP_MS) : pollMs)

  const lastPointEventMs = realtime.lastPointEventAt ? Date.parse(realtime.lastPointEventAt) : Number.NaN
  useEffect(() => {
    if (!live || !Number.isFinite(lastPointEventMs)) return undefined
    const remaining = lastPointEventMs + LIVE_POINTS_STALE_MS - Date.now()
    const timer = window.setTimeout(rerender, Math.max(0, remaining) + 1)
    return () => window.clearTimeout(timer)
  }, [live, lastPointEventMs])

  const polled = poll.data
  const points = useMemo(
    () => live ? mergePointsById(polled ?? emptyPoints, realtime.allPoints) : (polled ?? emptyPoints),
    [live, polled, realtime.allPoints]
  )
  return { points, live, polled, error: poll.error, loading: poll.loading, refetch: poll.refetch }
}
