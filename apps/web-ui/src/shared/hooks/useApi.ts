import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

interface UseApiOptions {
  refreshMs?: number
  networkRetryMs?: number | false
}

/** Tab đang ẩn (thu nhỏ, tab nền, màn hình khoá). Ngoài trình duyệt coi như hiện. */
export function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/*
 * T63-108 (PERF-API-03) — hai luật mới cho vòng poll:
 *
 *  1. TAB ẨN THÌ KHÔNG POLL. Trước bản này một tab Dashboard để nền vẫn gọi
 *     ~3,5 GET/s (đo HOST bằng Playwright 2026-09-28) cho một màn hình không ai
 *     nhìn. Hiện lại ⇒ đọc NGAY nếu lần đọc gần nhất đã cũ hơn một nhịp, để
 *     người dùng không nhìn snapshot vài phút tuổi mà tưởng là hiện tại.
 *  2. KHÔNG CHỒNG REQUEST NỀN. Nhịp poll, lượt thử lại khi mất mạng và lượt đọc
 *     bù khi tab hiện lại đều là "đọc nền" (`showLoading = false`); một lượt
 *     đang bay thì lượt nền khác bỏ qua thay vì mở request thứ hai cho cùng dữ
 *     liệu. `refetch()` và đổi `deps` vẫn luôn đọc — đó là yêu cầu có chủ đích,
 *     và `requestSequence` đã chặn phản hồi cũ đè phản hồi mới.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList = [], options: UseApiOptions = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const isMounted = useRef(true)
  const requestSequence = useRef(0)
  const inFlight = useRef(0)
  const lastStartedAt = useRef(0)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const fetchNow = useCallback(async (showLoading: boolean) => {
    if (!isMounted.current) return
    if (!showLoading && inFlight.current > 0) return
    const requestId = ++requestSequence.current
    if (showLoading) {
      setLoading(true)
      setError(null)
    }
    inFlight.current += 1
    lastStartedAt.current = Date.now()
    try {
      const result = await fetcherRef.current()
      if (isMounted.current && requestId === requestSequence.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (isMounted.current && requestId === requestSequence.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      inFlight.current -= 1
      if (isMounted.current && requestId === requestSequence.current && showLoading) {
        setLoading(false)
      }
    }
  }, [])

  const refetch = useCallback(async () => {
    await fetchNow(true)
  }, [fetchNow])

  // Custom hook logic to run fetchNow when deps change
  // We use a ref to track if it's the first render or deps changed
  const depsRef = useRef(deps)
  useEffect(() => {
    let changed = false
    if (deps.length !== depsRef.current.length) {
      changed = true
    } else {
      for (let i = 0; i < deps.length; i++) {
        if (!Object.is(deps[i], depsRef.current[i])) {
          changed = true
          break
        }
      }
    }

    if (changed) {
      depsRef.current = deps
      void fetchNow(true)
    }
  }, [deps, fetchNow])

  // Initial fetch
  useEffect(() => {
    void fetchNow(true)
  }, [fetchNow])

  const networkRetryMs = options.networkRetryMs === false ? 0 : (options.networkRetryMs ?? 2000)
  useEffect(() => {
    if (networkRetryMs <= 0 || !(error instanceof TypeError)) return undefined
    const timerId = window.setTimeout(() => {
      // Tab ẩn: không thử lại nền; lượt thử khi tab hiện lại (effect dưới) lo việc đó.
      if (!pageHidden()) void fetchNow(false)
    }, networkRetryMs)
    return () => window.clearTimeout(timerId)
  }, [error, fetchNow, networkRetryMs])

  useEffect(() => {
    if (!error) return undefined
    const retry = () => { void fetchNow(false) }
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', retryWhenVisible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', retryWhenVisible)
    }
  }, [error, fetchNow])

  useEffect(() => {
    const refreshMs = options.refreshMs
    if (!refreshMs) return undefined
    const poll = () => {
      if (pageHidden()) return
      void fetchNow(false)
    }
    const catchUpWhenVisible = () => {
      if (!pageHidden() && Date.now() - lastStartedAt.current >= refreshMs) void fetchNow(false)
    }

    const timerId = window.setInterval(poll, refreshMs)
    document.addEventListener('visibilitychange', catchUpWhenVisible)

    return () => {
      window.clearInterval(timerId)
      document.removeEventListener('visibilitychange', catchUpWhenVisible)
    }
  }, [fetchNow, options.refreshMs])

  return { data, loading, error, refetch }
}
