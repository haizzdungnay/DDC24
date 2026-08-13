import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgrammingApiClient } from './authClient'
import { ProgrammingApiError } from './generated/client'
import { programmingErrorCopy } from './errorCopy'
import { useI18n } from '../../../shared/i18n'
import type {
  ProgrammingAuditPage,
  ProgrammingCapabilities,
  ProgrammingPointCatalogPage,
  ProgrammingProjectPage,
  ProgrammingRuntime,
  RemoteState
} from '../model/types'

/**
 * Hook đọc dùng chung cho bốn workspace — theo mẫu `useModbusRuntime`/
 * `useModbusConfig` sẵn có trong repo (không dùng react-query, dự án này
 * chưa có dependency đó và không cần thêm cho một tập hook đọc/poll đơn
 * giản). `intervalMs` mặc định `0` = chỉ đọc lúc mount + khi gọi `refresh()`.
 */
function useProgrammingResource<T>(load: () => Promise<T>, intervalMs = 0): RemoteState<T> {
  const { pick } = useI18n()
  const [status, setStatus] = useState<RemoteState<T>['status']>('loading')
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const generation = useRef(0)

  const run = useCallback(() => {
    const myGeneration = ++generation.current
    loadRef.current().then(
      (value) => {
        if (myGeneration !== generation.current) return
        setData(value)
        setError(null)
        setStatus('ready')
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current) return
        const message =
          reason instanceof ProgrammingApiError
            ? programmingErrorCopy(pick, reason.envelope.error.code)
            : reason instanceof Error
              ? reason.message
              : pick('Lỗi không xác định.', 'Unknown error.')
        setError(message)
        setStatus('error')
      }
    )
  }, [pick])

  useEffect(() => {
    run()
    if (intervalMs <= 0) return undefined
    const timer = window.setInterval(run, intervalMs)
    return () => window.clearInterval(timer)
  }, [run, intervalMs])

  return { status, data, error, refresh: run }
}

/** `GET /capabilities` — cache 5 s theo IFSPEC-PROG-001 §11.1; đủ để refresh mỗi 5 s. */
export function useProgrammingCapabilities(): RemoteState<ProgrammingCapabilities> {
  const client = useProgrammingApiClient()
  const load = useCallback(
    () => client.request<ProgrammingCapabilities>('getProgrammingCapabilities'),
    [client]
  )
  return useProgrammingResource(load, 5000)
}

/** `GET /runtime` — snapshot authoritative, không suy từ DB Web. */
export function useProgrammingRuntime(): RemoteState<ProgrammingRuntime> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => client.request<ProgrammingRuntime>('getProgrammingRuntime'), [client])
  return useProgrammingResource(load, 5000)
}

/** `GET /projects` — tối đa 100 item/page theo hợp đồng; PGM-01/PGM-02 chỉ cần trang đầu. */
export function useProgrammingProjects(): RemoteState<ProgrammingProjectPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(
    () => client.request<ProgrammingProjectPage>('listProgrammingProjects', { query: { limit: 100 } }),
    [client]
  )
  return useProgrammingResource(load, 0)
}

/** `GET /point-catalog` — tab Điểm & Ánh xạ có nhịp làm mới riêng (UX §0.1
 * ràng buộc 3: `usePointCatalogQuery` tách khỏi `useDraftQuery`). */
export function useProgrammingPointCatalog(): RemoteState<ProgrammingPointCatalogPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => client.request<ProgrammingPointCatalogPage>('getProgrammingPointCatalog'), [client])
  return useProgrammingResource(load, 10000)
}

/** `GET /audit` — dùng cho `RecentEngineeringTimeline` của PGM-01 (5 bản ghi mới nhất). */
export function useProgrammingRecentAudit(limit = 5): RemoteState<ProgrammingAuditPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(
    () => client.request<ProgrammingAuditPage>('listProgrammingAudit', { query: { limit } }),
    [client, limit]
  )
  return useProgrammingResource(load, 0)
}
