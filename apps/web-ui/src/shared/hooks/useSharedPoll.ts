import { useCallback, useEffect, useReducer, useRef } from 'react'
import { pageHidden } from './useApi'

/**
 * `useSharedPoll` — T63-108 (PERF-API-03, Plan 63 §4.2): MỘT vòng poll cho MỘT tài
 * nguyên, dù bao nhiêu component cùng cần nó.
 *
 * VÌ SAO CẦN: Dashboard có ba khối (ép tay, bàn làm việc, xu hướng nhanh), mỗi
 * khối gọi `useApi(apiClient.getPoints, …, { refreshMs: 2000 })` riêng. Ba bộ hẹn
 * giờ độc lập đọc CÙNG `/points` — 1,5 GET/s cho đúng một mẩu dữ liệu, đo trên
 * host bằng Playwright 2026-09-28. Không bộ nào biết bộ kia đang có request bay.
 *
 * LUẬT
 *   - Một khoá ⇒ một bộ hẹn giờ, nhịp = nhịp NGẮN NHẤT mà các subscriber đang xin.
 *   - Một request đang bay thì mọi lời gọi khác nhận CHÍNH request đó (khử trùng).
 *   - Tab ẩn (`visibilityState === 'hidden'`) ⇒ không gọi; hiện lại ⇒ đọc ngay nếu
 *     dữ liệu đã cũ hơn nhịp — người dùng không nhìn một snapshot cũ mà tưởng mới.
 *   - Nhịp vừa NGẮN LẠI (ví dụ kênh sống vừa mất) ⇒ đọc ngay nếu đã quá nhịp mới.
 *   - Lỗi KHÔNG xoá dữ liệu cũ (giữ đúng hành vi `useApi`), nhưng `error` và
 *     `receivedAt` được trả ra để nơi hiển thị nói được dữ liệu đó cũ bao lâu.
 *   - Subscriber cuối rời đi ⇒ huỷ hẹn giờ và xoá khoá; request đang bay vẫn chạy
 *     nhưng không còn ai nhận.
 *
 * Mọi subscriber của một khoá PHẢI xin cùng một tài nguyên; fetcher của
 * subscriber tạo ra khoá là fetcher được dùng suốt đời khoá. Khoá giữ CHÍNH hàm
 * đó, không giữ ref của component: một component đổi sang khoá khác (tab
 * "Người dùng" → "Hệ thống") không được kéo theo khoá cũ mà component khác vẫn
 * đang đọc.
 */
export interface SharedPollState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  /** Lúc nhận dữ liệu thành công gần nhất (epoch ms); `null` khi chưa có. */
  receivedAt: number | null
  refetch: () => Promise<void>
}

interface Subscriber {
  intervalMs: number
  notify: () => void
}

interface Entry {
  key: string
  fetcher: () => Promise<unknown>
  subscribers: Map<number, Subscriber>
  data: unknown
  hasData: boolean
  loading: boolean
  error: Error | null
  receivedAt: number | null
  /** Lúc BẮT ĐẦU lần đọc gần nhất; tuổi dữ liệu tính từ đây để không đọc dồn. */
  lastAttemptAt: number
  inFlight: Promise<void> | null
  timer: number | null
  timerMs: number
}

const registry = new Map<string, Entry>()
let nextSubscriberId = 1
let visibilityListening = false

function notifyAll(entry: Entry): void {
  for (const subscriber of entry.subscribers.values()) subscriber.notify()
}

function run(entry: Entry): Promise<void> {
  if (entry.inFlight) return entry.inFlight
  entry.lastAttemptAt = Date.now()
  entry.inFlight = (async () => {
    try {
      const value = await entry.fetcher()
      entry.data = value
      entry.hasData = true
      entry.error = null
      entry.receivedAt = Date.now()
    } catch (err) {
      entry.error = err instanceof Error ? err : new Error(String(err))
    } finally {
      entry.loading = false
      entry.inFlight = null
      if (registry.get(entry.key) === entry) notifyAll(entry)
    }
  })()
  return entry.inFlight
}

function dueNow(entry: Entry): boolean {
  return Number.isFinite(entry.timerMs) && Date.now() - entry.lastAttemptAt >= entry.timerMs
}

function reschedule(entry: Entry): void {
  let shortest = Number.POSITIVE_INFINITY
  for (const subscriber of entry.subscribers.values()) {
    if (subscriber.intervalMs > 0) shortest = Math.min(shortest, subscriber.intervalMs)
  }
  if (shortest === entry.timerMs) return
  if (entry.timer !== null) window.clearInterval(entry.timer)
  entry.timer = null
  const shrinking = shortest < entry.timerMs
  entry.timerMs = shortest
  if (!Number.isFinite(shortest)) return
  entry.timer = window.setInterval(() => {
    if (!pageHidden()) void run(entry)
  }, shortest)
  if (shrinking && entry.lastAttemptAt > 0 && !pageHidden() && dueNow(entry)) void run(entry)
}

function onVisibilityChange(): void {
  if (pageHidden()) return
  for (const entry of registry.values()) {
    if (dueNow(entry)) void run(entry)
  }
}

function ensureVisibilityListener(): void {
  if (visibilityListening || typeof document === 'undefined') return
  document.addEventListener('visibilitychange', onVisibilityChange)
  visibilityListening = true
}

function releaseVisibilityListener(): void {
  if (!visibilityListening || registry.size > 0) return
  document.removeEventListener('visibilitychange', onVisibilityChange)
  visibilityListening = false
}

/** Chỉ dùng cho test: xoá mọi khoá và hẹn giờ để mỗi ca bắt đầu sạch. */
export function resetSharedPollsForTests(): void {
  for (const entry of registry.values()) {
    if (entry.timer !== null) window.clearInterval(entry.timer)
  }
  registry.clear()
  releaseVisibilityListener()
}

export function useSharedPoll<T>(key: string, fetcher: () => Promise<T>, intervalMs: number): SharedPollState<T> {
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const subscriberIdRef = useRef<number | null>(null)

  useEffect(() => {
    let entry = registry.get(key)
    if (!entry) {
      entry = {
        key,
        fetcher: fetcherRef.current,
        subscribers: new Map(),
        data: null,
        hasData: false,
        loading: true,
        error: null,
        receivedAt: null,
        lastAttemptAt: 0,
        inFlight: null,
        timer: null,
        timerMs: Number.POSITIVE_INFINITY
      }
      registry.set(key, entry)
      ensureVisibilityListener()
    }
    const id = nextSubscriberId++
    subscriberIdRef.current = id
    entry.subscribers.set(id, { intervalMs, notify: rerender })
    reschedule(entry)
    // Khoá mới hoặc dữ liệu đã quá nhịp thì đọc ngay; còn không thì dùng chung
    // bản đang có (và request đang bay, nếu có).
    if (!entry.hasData || dueNow(entry)) void run(entry)
    else rerender()
    const current = entry
    return () => {
      current.subscribers.delete(id)
      subscriberIdRef.current = null
      if (current.subscribers.size === 0) {
        if (current.timer !== null) window.clearInterval(current.timer)
        current.timer = null
        if (registry.get(key) === current) registry.delete(key)
        releaseVisibilityListener()
      } else {
        reschedule(current)
      }
    }
    // `intervalMs` đổi được xử lý ở effect dưới, không phải bằng huỷ/đăng ký lại
    // (huỷ/đăng ký lại sẽ đọc thừa một lần mỗi khi kênh sống bật/tắt).
  }, [key])

  useEffect(() => {
    const entry = registry.get(key)
    const id = subscriberIdRef.current
    if (!entry || id === null) return
    const subscriber = entry.subscribers.get(id)
    if (!subscriber || subscriber.intervalMs === intervalMs) return
    subscriber.intervalMs = intervalMs
    reschedule(entry)
  }, [key, intervalMs])

  const refetch = useCallback(async () => {
    const entry = registry.get(key)
    if (entry) await run(entry)
  }, [key])

  const entry = registry.get(key)
  return {
    data: entry?.hasData ? (entry.data as T) : null,
    loading: entry ? entry.loading && !entry.hasData : true,
    error: entry?.error ?? null,
    receivedAt: entry?.receivedAt ?? null,
    refetch
  }
}
