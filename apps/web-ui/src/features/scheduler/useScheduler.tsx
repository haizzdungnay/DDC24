/**
 * Trạng thái dùng chung của feature Lịch vận hành.
 *
 * Một provider bọc cả bốn route, nên "bản nháp đang soạn" là MỘT trạng thái
 * cho toàn feature. Nếu mỗi tab tự giữ bản nháp riêng thì chuyển tab sẽ mất
 * thay đổi chưa lưu mà không báo gì — đúng lỗi mà `ModbusConfigProvider` đã
 * phải sửa trước đây (MBR-B302).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiClient } from '../../shared/api/client'
import type { ScheduleObject } from '../../shared/types'

interface SchedulerState {
  schedules: ScheduleObject[]
  loading: boolean
  /** Lỗi tải. Giữ riêng khỏi `schedules` để phân biệt "chưa có lịch nào" với
   *  "không đọc được lịch" — chính là finding FE-DATA-02 của đợt 2026-08-05. */
  error: Error | null
  /** Backend báo tệp còn định dạng cũ (HTTP 409). Không phải lỗi máy chủ. */
  legacyFormat: boolean
  reload: () => Promise<void>
  /** Cập nhật một lịch trong bộ nhớ sau khi API trả về bản mới. */
  upsert: (schedule: ScheduleObject) => void
  remove: (id: string) => void
}

const SchedulerContext = createContext<SchedulerState | null>(null)

export function SchedulerProvider({ children }: { children: ReactNode }) {
  const [schedules, setSchedules] = useState<ScheduleObject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [legacyFormat, setLegacyFormat] = useState(false)
  const mounted = useRef(true)

  /* PHẢI đặt lại `true` khi mount, không chỉ đặt `false` khi unmount.
   *
   * `React.StrictMode` chạy effect hai lần ở chế độ dev: mount → unmount →
   * mount. Bản đầu chỉ có cleanup, nên sau lần unmount giả lập thì
   * `mounted.current` mắc kẹt ở `false` và MỌI cập nhật state sau đó bị bỏ
   * qua — trang đứng ở "Đang tải…" vĩnh viễn dù request đã trả 502.
   *
   * Không phải chuyện riêng của StrictMode: bất kỳ lần remount nào của
   * provider cũng làm hỏng nó theo cùng cách. */
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await apiClient.getSchedules()
      if (!mounted.current) return
      setSchedules(list)
      setError(null)
      setLegacyFormat(false)
    } catch (err) {
      if (!mounted.current) return
      const e = err instanceof Error ? err : new Error(String(err))
      // 409 = tệp còn định dạng cũ, di trú chạy lúc khởi động dịch vụ. Đây là
      // một bước quản trị chưa chạy, không phải hỏng hóc — nói đúng như vậy.
      setLegacyFormat(/409/.test(e.message) || /định dạng cũ/.test(e.message))
      setError(e)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const upsert = useCallback((schedule: ScheduleObject) => {
    setSchedules((current) => {
      const idx = current.findIndex((s) => s.schedule_id === schedule.schedule_id)
      if (idx < 0) return [...current, schedule]
      const next = [...current]
      next[idx] = schedule
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setSchedules((current) => current.filter((s) => s.schedule_id !== id))
  }, [])

  const value = useMemo<SchedulerState>(
    () => ({ schedules, loading, error, legacyFormat, reload, upsert, remove }),
    [schedules, loading, error, legacyFormat, reload, upsert, remove]
  )
  return <SchedulerContext.Provider value={value}>{children}</SchedulerContext.Provider>
}

export function useScheduler(): SchedulerState {
  const ctx = useContext(SchedulerContext)
  if (!ctx) throw new Error('useScheduler phải nằm trong SchedulerProvider')
  return ctx
}

/** Lấy một lịch theo id từ store; undefined khi chưa tải xong hoặc không có. */
export function useSchedule(id: string | undefined): ScheduleObject | undefined {
  const { schedules } = useScheduler()
  return useMemo(() => schedules.find((s) => s.schedule_id === id), [schedules, id])
}
