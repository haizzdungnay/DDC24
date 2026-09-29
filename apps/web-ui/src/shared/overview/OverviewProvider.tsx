import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { OverviewSchemaError, fetchOverview } from '../api/overview'
import { pageHidden } from '../hooks/useApi'
import type { OverviewResponse } from '../types'

/**
 * OverviewProvider — PA3-205, sở hữu DUY NHẤT nhịp poll của read model Landing.
 *
 * VÌ SAO CẦN (PA3-F12)
 *
 * Trước PA3, `AppShell` poll `/alarms` mỗi giây và `/system/status` mỗi 5 giây,
 * còn `DashboardPage` poll `/system/status`, `/points`, `/alarms` mỗi giây NỮA.
 * Mở Dashboard là 5 vòng poll độc lập cho ba endpoint, hai vùng của cùng một
 * màn hình đọc hai snapshot lệch nhau, và không vùng nào biết dữ liệu mình đang
 * vẽ cũ bao lâu.
 *
 * Nay một provider, một nhịp, một `generatedAt` — mọi nơi hiển thị đều nói về
 * cùng một thời điểm và có thể nói ra thời điểm đó.
 */

export type OverviewStatus = 'loading' | 'ready' | 'error' | 'incompatible'

export interface OverviewContextValue {
  data: OverviewResponse | null
  status: OverviewStatus
  error: Error | null
  /** Thời điểm FE nhận được snapshot hiện tại (epoch ms), để tính tuổi dữ liệu. */
  receivedAt: number | null
  refresh: () => Promise<void>
}

const OverviewContext = createContext<OverviewContextValue | null>(null)

/* T63-108 (PERF-API-03): 2 s → 1 s. Chuông cảnh báo của shell nay đọc số đếm từ
 * snapshot này thay cho vòng poll `/alarms` riêng mỗi 1 s (xem
 * `useShellAlarms`). Giữ nhịp 1 s để độ tươi của chuông và annunciation KHÔNG
 * tệ hơn trước; tổng cộng vẫn bớt một vòng poll (1 GET/s thay cho 1,5 GET/s). */
export const DEFAULT_OVERVIEW_REFRESH_MS = 1000

export function OverviewProvider({ children, refreshMs = DEFAULT_OVERVIEW_REFRESH_MS }: { children: ReactNode; refreshMs?: number }) {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<OverviewStatus>('loading')
  const [receivedAt, setReceivedAt] = useState<number | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = await fetchOverview()
      if (!mounted.current) return
      setData(next)
      setError(null)
      setStatus('ready')
      setReceivedAt(Date.now())
    } catch (err) {
      if (!mounted.current) return
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      /* Lệch schema là lỗi KHÁC hẳn mất mạng: dữ liệu cũ trong tay không còn
         đáng tin để hiển thị tiếp, nên xoá đi và fail closed. */
      if (normalized instanceof OverviewSchemaError) {
        setData(null)
        setStatus('incompatible')
      } else {
        setStatus('error')
      }
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!refreshMs) return undefined
    /* T63-108: tab ẩn thì không poll — không ai nhìn snapshot đó. Hiện lại thì
       effect dưới nạp ngay. */
    const timer = window.setInterval(() => { if (!pageHidden()) void load() }, refreshMs)
    return () => window.clearInterval(timer)
  }, [load, refreshMs])

  // Quay lại tab sau khi để lâu: nạp ngay thay vì chờ hết nhịp, để người dùng
  // không nhìn một snapshot vài phút tuổi mà tưởng là hiện tại.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [load])

  const value = useMemo<OverviewContextValue>(
    () => ({ data, status, error, receivedAt, refresh: load }),
    [data, status, error, receivedAt, load]
  )
  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>
}

export function useOverview(): OverviewContextValue {
  const ctx = useContext(OverviewContext)
  if (!ctx) throw new Error('useOverview phải nằm trong OverviewProvider')
  return ctx
}

/** Đọc overview mà không bắt buộc phải có provider — dùng cho component dùng
 *  chung có thể được render ngoài shell (ví dụ trong test đơn lẻ). */
export function useOptionalOverview(): OverviewContextValue | null {
  return useContext(OverviewContext)
}
