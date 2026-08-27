import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgrammingApiClient } from './authClient'
import { ProgrammingApiError } from './generated/client'
import { programmingErrorCopy } from './errorCopy'
import { useI18n } from '../../../shared/i18n'
import { judgeProducerStamp } from '../runtime/producerStamp'
import { createLatestRenderBudget, type LatestRenderBudget } from '../runtime/liveRenderBudget'
import type {
  ProgrammingAuditPage,
  ProgrammingCapabilities,
  ProgrammingCheck,
  ProgrammingOperationPage,
  ProgrammingOverridePage,
  ProgrammingPointCatalogPage,
  ProgrammingProgramsPage,
  ProgrammingLibraryPage,
  ProgrammingProjectPage,
  ProgrammingRevisionChanges,
  ProgrammingRuntime,
  ProgrammingMonitorPage,
  ProgrammingRuntimeSignalPage,
  RemoteState
} from '../model/types'

type PickCopy = (vi: string, en: string) => string

function programmingResourceErrorMessage(pick: PickCopy, reason: unknown): string {
  return reason instanceof ProgrammingApiError
    ? programmingErrorCopy(pick, reason.envelope.error.code)
    : reason instanceof Error
      ? reason.message
      : pick('Lỗi không xác định.', 'Unknown error.')
}

/**
 * Hook đọc dùng chung cho sáu workspace — theo mẫu `useModbusRuntime`/
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
    // Một client validator hoặc test double có thể ném đồng bộ trước khi trả
    // Promise. Chuẩn hoá cả hai đường vào cùng RemoteState error; nếu không một
    // endpoint context mới đủ làm sập toàn bộ sáu-workspace layout.
    Promise.resolve().then(() => loadRef.current()).then(
      (value) => {
        if (myGeneration !== generation.current) return
        setData(value)
        setError(null)
        setStatus('ready')
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current) return
        setError(programmingResourceErrorMessage(pick, reason))
        setStatus('error')
      }
    )
  }, [pick])

  useEffect(() => {
    run()
    if (intervalMs <= 0) return undefined
    const timer = window.setInterval(run, intervalMs)
    return () => window.clearInterval(timer)
    // `load` cố ý nằm trong deps dù `run()` luôn đọc qua `loadRef` (giá trị
    // mới nhất) — thiếu nó, đổi định danh tài nguyên (vd `checkId` từ
    // `undefined` sang giá trị thật sau một `navigate` cùng trang, xem D-01/
    // `CheckCommissionPage`) sẽ không tự fetch lại, chỉ đọc mãi kết quả rỗng
    // của lần mount đầu tới khi ai đó gọi `refresh()` thủ công.
  }, [run, load, intervalMs])

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

/**
 * `T59-503` + `T60-013` — context PGM-01..06 phải đọc riêng desired intent và
 * runtime read-back của từng Program. Khi chưa xác định được Project, trả trang
 * rỗng cục bộ để không dựng request với định danh giả; dependency đổi sang
 * `projectId` thật sẽ tự tải lại.
 *
 * HỢP ĐỒNG ĐÃ ĐỔI BẢN CHẤT (đọc kỹ trước khi dùng): `GET /projects/{id}/
 * programs` nay trả một **trang** ghép ý định bền vững VỚI read-back sống của
 * Core (`runtimeStateSource`, `periodMs`, `lastRunAtUtc`, `health`…), không
 * còn là danh sách intent thuần. Tên hook giữ nguyên để không kéo theo một
 * đợt đổi tên xuyên `ProgrammingLayout`/`ProgrammingContextStrip` ngoài phạm
 * vi việc này; kiểu trả về `ProgrammingProgramsPage` mới là hợp đồng thật.
 */
export function useProgrammingProgramIntents(projectId: string | undefined): RemoteState<ProgrammingProgramsPage> {
  const client = useProgrammingApiClient()
  const requestedProjectId = projectId ?? null
  const load = useCallback((): Promise<{ projectId: string | null; value: ProgrammingProgramsPage }> => {
    // Chưa biết Project thì KHÔNG dựng một trang giả có `runtimeStateSource`
    // đẹp: `UNAVAILABLE` là câu trả lời đúng cho "chưa đọc được từ đâu cả".
    if (!projectId) {
      return Promise.resolve({
        projectId: null,
        value: { schemaVersion: '1.0', projectId: '', runtimeStateSource: 'UNAVAILABLE', observedAt: null, programsTruncated: null, items: [] }
      })
    }
    return client.request<ProgrammingProgramsPage>('listProgrammingProgramIntents', { path: { projectId } })
      .then((value) => ({ projectId, value }))
  }, [client, projectId])
  const resource = useProgrammingResource(load, 5000)
  const belongsToCurrentProject = resource.data?.projectId === requestedProjectId

  // Route có thể đổi Project trong khi request mới còn đang bay. Không được
  // ghép tên/Draft của Project mới với intent/runtime-state còn giữ từ Project
  // cũ; chuyển rõ sang loading cho tới khi snapshot đúng định danh về tới nơi.
  return {
    status: resource.status === 'ready' && !belongsToCurrentProject ? 'loading' : resource.status,
    data: belongsToCurrentProject ? resource.data?.value ?? null : null,
    error: resource.error,
    refresh: resource.refresh
  }
}

/**
 * `GET /revisions/{revisionId}` — thân Revision thô (`revisionId`, `sequence`,
 * `contentHash`, `snapshot`). `T60-205` dùng nó cho **đúng một** việc: đọc tập
 * Program của **Active Revision** qua `overview/activeProgramSet.ts`.
 *
 * Trả `unknown` chứ không phải một type hẹp: `snapshot` là object tự do trong
 * contract, và `activeProgramSet()` đã là nơi duy nhất chịu trách nhiệm thu hẹp
 * nó một cách fail-closed. Khai một type đẹp ở đây sẽ cho phép chỗ khác đọc
 * thẳng `snapshot.objects` mà bỏ qua toàn bộ luật "không mượn Draft thay
 * Active".
 *
 * `revisionId` rỗng ⇒ KHÔNG phát request và KHÔNG trả `{}`: hook giữ trạng thái
 * `loading` do `load` bị treo sẽ nói dối, nên nhánh này reject để `RemoteState`
 * vào `error` — tầng gọi phân biệt bằng `activeRevisionId === null` trước đó
 * (`ActiveProgramSetReason.NO_ACTIVE_REVISION`), không bằng lỗi này.
 */
export function useProgrammingRevision(revisionId: string | null | undefined): RemoteState<unknown> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!revisionId) return Promise.reject(new Error('revisionId is required'))
    return client.request<unknown>('getProgrammingRevision', { path: { revisionId } })
  }, [client, revisionId])
  return useProgrammingResource(load, 0)
}

/** `GET /point-catalog` — tab Điểm & Ánh xạ có nhịp làm mới riêng (UX §0.1
 * ràng buộc 3: `usePointCatalogQuery` tách khỏi `useDraftQuery`). */
export function useProgrammingPointCatalog(): RemoteState<ProgrammingPointCatalogPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => client.request<ProgrammingPointCatalogPage>('getProgrammingPointCatalog'), [client])
  return useProgrammingResource(load, 10000)
}

export interface LazyPointCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: ProgrammingPointCatalogPage | null
  error: string | null
  /** Gọi mỗi lần panel "Chèn nhanh Point/Variable" mở — CHỈ fetch thật ở lần
   *  gọi đầu (status `idle`); các lần mở tiếp theo dùng cache đã có, không
   *  tạo thêm request. An toàn gọi lại nhiều lần (idempotent theo status). */
  ensureLoaded: () => void
}

/** Biến thể LAZY của `useProgrammingPointCatalog` cho ST Editor
 *  (`design/editor/InsertPointVariablePanel.tsx`, ST Editor Quick Control
 *  quyết định #02): không fetch khi mount như `useProgrammingResource`, và
 *  không tự poll lại — mở ST Editor không được tạo traffic `GET
 *  /point-catalog` nếu người dùng chưa từng mở panel chèn nhanh. Đây là hook
 *  riêng (không tái dùng `useProgrammingResource`) vì hành vi lazy/one-shot
 *  khác hẳn hợp đồng eager-fetch-plus-poll của hook đó. */
export function useLazyProgrammingPointCatalog(): LazyPointCatalogState {
  const { pick } = useI18n()
  const client = useProgrammingApiClient()
  const [status, setStatus] = useState<LazyPointCatalogState['status']>('idle')
  const [data, setData] = useState<ProgrammingPointCatalogPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status

  const ensureLoaded = useCallback(() => {
    if (statusRef.current === 'loading' || statusRef.current === 'ready') return
    setStatus('loading')
    client.request<ProgrammingPointCatalogPage>('getProgrammingPointCatalog').then(
      (value) => {
        setData(value)
        setError(null)
        setStatus('ready')
      },
      (reason: unknown) => {
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
  }, [client, pick])

  return { status, data, error, ensureLoaded }
}

/** `GET /checks/{checkId}` — dùng lại độc lập với `useCheckWorkflow` để
 * PGM-03 luôn đọc trạng thái mới nhất kể cả khi vào thẳng bằng navigation
 * state (không phải vừa chạy Check trong cùng phiên). */
export function useProgrammingCheck(checkId: string | undefined): RemoteState<ProgrammingCheck> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!checkId) return Promise.reject(new Error('checkId is required'))
    return client.request<ProgrammingCheck>('getProgrammingCheck', { path: { checkId } })
  }, [client, checkId])
  return useProgrammingResource(load, 0)
}

/** `GET /revisions/{from}/changes/{to}` — thay đổi có cấu trúc + impact bốn
 * nhóm do MÁY CHỦ tính (bao gồm cutover/activeOverrides đọc Core thật qua
 * `RuntimeImpactProvider` đã nối sẵn ở `NewOperationService`). `from='none'`
 * khi chưa có Active Revision. */
export function useProgrammingRevisionChanges(
  fromRevisionId: string | undefined,
  toRevisionId: string | undefined,
  cursor?: string | null,
): RemoteState<ProgrammingRevisionChanges> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!toRevisionId) return Promise.reject(new Error('toRevisionId is required'))
    // `cursor` chỉ đi kèm khi phản hồi trước nói còn phần chưa đọc. Bịa một
    // cursor ở lần gọi đầu là cách bỏ mất đúng phần đầu danh sách.
    return client.request<ProgrammingRevisionChanges>('compareProgrammingRevisions', {
      path: { from: fromRevisionId ?? 'none', to: toRevisionId },
      ...(cursor ? { query: { cursor } } : {}),
    })
  }, [client, fromRevisionId, toRevisionId, cursor])
  return useProgrammingResource(load, 0)
}

export interface ProgrammingRevisionComparisonState extends RemoteState<ProgrammingRevisionChanges> {
  loadingMore: boolean
  /**
   * Lỗi khi đọc TRANG TIẾP, tách hẳn khỏi `error`.
   *
   * Hai loại hỏng này đòi hai cách xử khác nhau. Cả phép so hỏng thì không có
   * gì đáng tin để vẽ. Còn trang tiếp hỏng thì phần đã tải VẪN ĐÚNG: gộp nó
   * vào `error` sẽ xoá sạch danh sách người dùng đang đọc vì một lỗi mạng
   * thoáng qua, và cùng lúc giấu luôn chính nút thử lại.
   */
  loadMoreError: string | null
  loadMore: (cursor: string) => void
}

interface ComparisonSnapshot {
  key: string | null
  status: RemoteState<ProgrammingRevisionChanges>['status']
  data: ProgrammingRevisionChanges | null
  error: string | null
  loadMoreError: string | null
  loadingMore: boolean
}

/**
 * Đường đọc chuyên biệt cho khay Compare T59-819.
 *
 * Hook tài nguyên dùng chung cố ý giữ data cũ trong lúc dependency đổi; hành vi
 * đó hữu ích cho bảng/poll thông thường nhưng nguy hiểm với Compare vì có thể
 * ghép header của cặp Revision mới với diff của cặp cũ. Hook này gắn state với
 * đúng tuple, xoá data khỏi GIÁ TRỊ TRẢ VỀ ngay khi tuple đổi và tự ghép cursor
 * theo một chuỗi duy nhất.
 */
export function useProgrammingRevisionComparison(
  fromRevisionId: string | undefined,
  toRevisionId: string | undefined,
): ProgrammingRevisionComparisonState {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const key = fromRevisionId && toRevisionId ? `${fromRevisionId}\u0000${toRevisionId}` : null
  const generation = useRef(0)
  const consumedCursors = useRef(new Set<string>())
  const inFlightCursor = useRef<string | null>(null)
  const snapshotRef = useRef<ComparisonSnapshot>({
    key: null, status: 'loading', data: null, error: null, loadMoreError: null, loadingMore: false,
  })
  const [snapshot, setSnapshotState] = useState<ComparisonSnapshot>(snapshotRef.current)

  const setSnapshot = useCallback((next: ComparisonSnapshot | ((current: ComparisonSnapshot) => ComparisonSnapshot)) => {
    setSnapshotState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      snapshotRef.current = value
      return value
    })
  }, [])

  const validateTuple = useCallback((value: ProgrammingRevisionChanges) => {
    if (value.fromRevisionId !== fromRevisionId || value.toRevisionId !== toRevisionId) {
      throw new Error(pick(
        'Máy chủ trả bảng khác biệt của một cặp Revision khác; dữ liệu đã bị từ chối.',
        'The server returned a difference table for another revision pair; the data was rejected.',
      ))
    }
    return value
  }, [fromRevisionId, pick, toRevisionId])

  const requestPage = useCallback((cursor?: string) => {
    if (!fromRevisionId || !toRevisionId) return Promise.reject(new Error('revision pair is required'))
    return client.request<ProgrammingRevisionChanges>('compareProgrammingRevisions', {
      path: { from: fromRevisionId, to: toRevisionId },
      ...(cursor ? { query: { cursor } } : {}),
    }).then(validateTuple)
  }, [client, fromRevisionId, toRevisionId, validateTuple])

  const refresh = useCallback(() => {
    const myGeneration = ++generation.current
    consumedCursors.current.clear()
    inFlightCursor.current = null
    if (!key) {
      setSnapshot({ key: null, status: 'loading', data: null, error: null, loadMoreError: null, loadingMore: false })
      return
    }
    setSnapshot({ key, status: 'loading', data: null, error: null, loadMoreError: null, loadingMore: false })
    Promise.resolve().then(() => requestPage()).then(
      (value) => {
        if (myGeneration !== generation.current) return
        setSnapshot({ key, status: 'ready', data: value, error: null, loadMoreError: null, loadingMore: false })
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current) return
        setSnapshot({
          key, status: 'error', data: null, loadMoreError: null,
          error: programmingResourceErrorMessage(pick, reason), loadingMore: false,
        })
      },
    )
  }, [key, pick, requestPage, setSnapshot])

  useEffect(() => {
    refresh()
    return () => { generation.current += 1 }
  }, [refresh])

  const loadMore = useCallback((cursor: string) => {
    const current = snapshotRef.current
    // `status === 'error'` VẪN được đọc tiếp khi `data` còn: đó chính là ca
    // thử lại sau một lần đọc trang hỏng. Đòi `'ready'` ở đây là cách đường
    // retry bên dưới không bao giờ chạy được.
    if (!key || current.key !== key || current.status === 'loading' || !current.data) return
    if (current.data.nextCursor !== cursor || !cursor || consumedCursors.current.has(cursor) || inFlightCursor.current) {
      return
    }
    consumedCursors.current.add(cursor)
    inFlightCursor.current = cursor
    const myGeneration = generation.current
    setSnapshot({ ...current, status: 'ready', loadingMore: true, loadMoreError: null })
    Promise.resolve().then(() => requestPage(cursor)).then(
      (page) => {
        if (myGeneration !== generation.current || inFlightCursor.current !== cursor) return
        inFlightCursor.current = null
        /* Máy chủ vi phạm hợp đồng phân trang: `nextCursor` trỏ về một trang
         * đã đọc. Đi tiếp là quay vòng vô hạn — nhưng chính trang VỪA nhận thì
         * hợp lệ, vì nó về từ một cursor chưa từng tiêu thụ. Vứt nó đi là tự
         * đánh mất những khác biệt máy chủ đã gửi đúng, nên nó vẫn được ghép;
         * chỉ đường đi tiếp bị cắt. */
        const loopingCursor = (page.nextCursor && consumedCursors.current.has(page.nextCursor))
          || page.nextCursor === cursor
        setSnapshot((latest) => {
          if (latest.key !== key || !latest.data) return latest
          return {
            key,
            status: 'ready',
            error: null,
            loadingMore: false,
            loadMoreError: loopingCursor
              ? pick(
                'Máy chủ trả cursor lặp; danh sách đã dừng để tránh lặp hoặc bỏ sót khác biệt.',
                'The server returned a repeated cursor; loading stopped to avoid duplicate or missing differences.',
              )
              : null,
            data: {
              ...latest.data,
              stHunks: [...(latest.data.stHunks ?? []), ...(page.stHunks ?? [])],
              fbdChanges: [...(latest.data.fbdChanges ?? []), ...(page.fbdChanges ?? [])],
              // Cursor quay vòng ⇒ `truncated` giữ nguyên bật để danh sách tự
              // khai là chưa đầy đủ, và `nextCursor` bị bỏ để không mời thử lại
              // một đường đã chứng minh là quay vòng.
              truncated: loopingCursor ? true : page.truncated,
              nextCursor: loopingCursor ? null : (page.nextCursor ?? null),
            },
          }
        })
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current || inFlightCursor.current !== cursor) return
        inFlightCursor.current = null
        // Request lỗi chưa tiêu thụ trang; cho phép người dùng retry đúng
        // cursor đó thay vì khoá vĩnh viễn phần danh sách còn lại.
        consumedCursors.current.delete(cursor)
        // Danh sách đã tải vẫn ĐÚNG — chỉ trang tiếp hỏng. Xoá nó đi vì một
        // lỗi mạng thoáng qua là vứt luôn phần người dùng đang đọc.
        setSnapshot((latest) => ({
          ...latest, loadingMore: false,
          loadMoreError: programmingResourceErrorMessage(pick, reason),
        }))
      },
    )
  }, [key, pick, requestPage, setSnapshot])

  // Tuple đổi trước khi effect chạy vẫn phải fail-closed ngay trong render.
  if (!key || snapshot.key !== key) {
    return { status: 'loading', data: null, error: null, loadMoreError: null, refresh, loadingMore: false, loadMore }
  }
  return { ...snapshot, refresh, loadMore }
}

/** `GET /overrides` — bảng override thủ công còn hiệu lực (UX §16.3 `ActiveOverrideTable`). */
export function useProgrammingOverrides(): RemoteState<ProgrammingOverridePage> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => client.request<ProgrammingOverridePage>('listProgrammingOverrides', { query: { activeOnly: true } }), [client])
  return useProgrammingResource(load, 0)
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

/** `GET /audit` — bản đầy đủ cho tab "Phiên bản & Bảo trì" của PGM-04. */
export function useProgrammingAudit(limit = 50): RemoteState<ProgrammingAuditPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(
    () => client.request<ProgrammingAuditPage>('listProgrammingAudit', { query: { limit } }),
    [client, limit]
  )
  return useProgrammingResource(load, 0)
}

/** `GET /operations` — lịch sử Commission/Restore/Import/ResetRetain
 * (TASK-PROG-505, tab "Phiên bản & Bảo trì"). */
export function useProgrammingOperations(limit = 20): RemoteState<ProgrammingOperationPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(
    () => client.request<ProgrammingOperationPage>('listProgrammingOperations', { query: { limit } }),
    [client, limit]
  )
  return useProgrammingResource(load, 0)
}

export type ProgrammingMonitorFailure = 'permission' | 'offline' | 'error' | null

export interface ProgrammingRuntimeMonitorState extends RemoteState<ProgrammingMonitorPage> {
  /** Phân loại theo HTTP/network authority để UI không biến mọi lỗi thành
   * "offline" và không parse chuỗi message đã dịch. */
  failure: ProgrammingMonitorFailure
  /**
   * `T59-810` — `true` khi mốc monotonic của Core LÙI so với snapshot đã vẽ,
   * tức Core đã khởi động lại. Giá trị trước và sau một lần restart không thuộc
   * cùng một mạch: bộ đếm, trạng thái FB và LKG đều có thể đã khác, nên nối
   * tiếp im lặng là nói dối về tính liên tục.
   */
  producerRestarted: boolean
}

export function classifyProgrammingMonitorFailure(reason: unknown): Exclude<ProgrammingMonitorFailure, null> {
  if (reason instanceof ProgrammingApiError) {
    if (reason.status === 401 || reason.status === 403) return 'permission'
    if ([429, 502, 503, 504].includes(reason.status)) return 'offline'
    return 'error'
  }
  // `fetch()` chỉ reject cho lỗi transport/abort; AbortError không phải bằng
  // chứng Core offline nên vẫn thuộc lỗi chung.
  if (reason instanceof TypeError) return 'offline'
  return 'error'
}

/** `GET /runtime/monitor` — snapshot cuối-scan authoritative, poll 1 Hz. Khi
 * nguồn lỗi, xoá snapshot khỏi state thay vì giữ mẫu cũ dưới nhãn LIVE. Hook
 * chuyên biệt giữ thêm loại lỗi để Watch phân biệt permission/offline/error. */
export function useProgrammingRuntimeMonitor(enabled = true): ProgrammingRuntimeMonitorState {
  const { pick } = useI18n()
  const client = useProgrammingApiClient()
  const load = useCallback(() => client.request<ProgrammingMonitorPage>('getProgrammingRuntimeMonitor'), [client])
  const [status, setStatus] = useState<ProgrammingRuntimeMonitorState['status']>('loading')
  const [data, setData] = useState<ProgrammingMonitorPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<ProgrammingMonitorFailure>(null)
  const [producerRestarted, setProducerRestarted] = useState(false)
  const loadRef = useRef(load)
  const generation = useRef(0)
  const enabledRef = useRef(enabled)
  const inFlight = useRef(false)
  const rerunAfterFlight = useRef(false)
  const runRef = useRef<() => void>(() => {})
  /* Mốc của snapshot ĐANG HIỆN. `generation` phía trên chỉ bảo vệ khỏi response
   * của chính hook này về trễ; nó không nói gì về việc Core đã restart hay BE
   * phục vụ lại một snapshot đã cache. Mốc producer mới trả lời được điều đó. */
  const lastCaptured = useRef<bigint | null>(null)
  const restartPending = useRef(false)
  loadRef.current = load
  enabledRef.current = enabled

  const renderBudget = useRef<LatestRenderBudget<{
    generation: number
    value: ProgrammingMonitorPage
    producerRestarted: boolean
  }> | null>(null)
  if (renderBudget.current === null) {
    renderBudget.current = createLatestRenderBudget((next) => {
      if (!enabledRef.current || next.generation !== generation.current) return
      restartPending.current = false
      setProducerRestarted(next.producerRestarted)
      setData(next.value)
      setError(null)
      setFailure(null)
      setStatus('ready')
    })
  }

  const run = useCallback(() => {
    if (!enabledRef.current) return
    /* Poll/refresh không được chồng request. Một endpoint chậm mà cứ mở thêm
     * request mỗi giây vừa tạo leak, vừa cho response cũ/mới đua nhau. Giữ đúng
     * một lần chạy và coalesce mọi yêu cầu xen giữa thành một lượt kế tiếp. */
    if (inFlight.current) {
      rerunAfterFlight.current = true
      return
    }
    inFlight.current = true
    /* In-flight bị giới hạn một nên response không thể đảo thứ tự. Generation
     * ở đây là epoch subscription, chỉ tăng lúc disable/unmount/load đổi; nếu
     * tăng theo từng request thì một poll STALE có thể vô tình làm sample mới
     * đang chờ cửa sổ 100 ms bị loại. */
    const myGeneration = generation.current
    setStatus((current) => current === 'error' ? 'loading' : current)
    const finish = () => {
      if (myGeneration !== generation.current) return
      inFlight.current = false
      if (!rerunAfterFlight.current || !enabledRef.current) return
      rerunAfterFlight.current = false
      queueMicrotask(() => runRef.current())
    }
    Promise.resolve().then(() => loadRef.current()).then(
      (value) => {
        if (myGeneration !== generation.current) return
        const verdict = judgeProducerStamp(value.producer, lastCaptured.current)
        if (verdict.kind === 'STALE') {
          /* Snapshot không mới hơn thứ đang hiện: giữ nguyên. Vẽ lại số cũ
           * làm khay giá trị nhấp nháy như vừa có dữ liệu mới. */
          finish()
          return
        }
        if (verdict.kind === 'ACCEPT' || verdict.kind === 'PRODUCER_RESTARTED') {
          lastCaptured.current = verdict.capturedMonotonicNs
        }
        restartPending.current = restartPending.current || verdict.kind === 'PRODUCER_RESTARTED'
        renderBudget.current?.push({
          generation: myGeneration,
          value,
          producerRestarted: restartPending.current,
        })
        finish()
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current) return
        /* Mất kết nối rồi nối lại có thể là một Core khác: quên mốc cũ để lần
         * so tiếp theo không kết luận "restart" hay "stale" từ một mạch đã đứt. */
        lastCaptured.current = null
        restartPending.current = false
        renderBudget.current?.cancel()
        setProducerRestarted(false)
        setData(null)
        setError(programmingResourceErrorMessage(pick, reason))
        setFailure(classifyProgrammingMonitorFailure(reason))
        setStatus('error')
        finish()
      }
    )
  }, [pick])
  runRef.current = run

  useEffect(() => {
    if (!enabled) {
      generation.current += 1
      inFlight.current = false
      rerunAfterFlight.current = false
      lastCaptured.current = null
      restartPending.current = false
      renderBudget.current?.cancel()
      setProducerRestarted(false)
      setData(null)
      setError(null)
      setFailure(null)
      setStatus('loading')
      return undefined
    }
    run()
    const timer = window.setInterval(run, 1000)
    return () => {
      window.clearInterval(timer)
      // Invalidate request đang bay; Promise hoàn tất sau unmount không được
      // cập nhật state hoặc tái hiện snapshot của thế hệ cũ.
      generation.current += 1
      inFlight.current = false
      rerunAfterFlight.current = false
      lastCaptured.current = null
      restartPending.current = false
      renderBudget.current?.cancel()
    }
  }, [enabled, run, load])

  return { status, data, error, failure, producerRestarted, refresh: run }
}

/** T59-504 — Published Signal có endpoint/snapshot riêng; tuyệt đối không join
 * giả từ các row Binding của Point monitor. Poll cùng nhịp 1 Hz để người dùng
 * đối chiếu Program producer, value, quality và freshness trên cùng màn hình. */
export function useProgrammingRuntimeSignals(): RemoteState<ProgrammingRuntimeSignalPage> {
  const client = useProgrammingApiClient()
  const load = useCallback(
    () => client.request<ProgrammingRuntimeSignalPage>('getProgrammingRuntimeSignals'),
    [client]
  )
  return useProgrammingResource(load, 1000)
}

export interface LibrarySearchFilters {
  projectId?: string
  scope?: 'SYSTEM' | 'PROJECT'
  kind?: 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'
  query?: string
}

/** `GET /libraries` — PGM-04. Bộ lọc nằm trong dependency của `load` nên đổi
 * filter là tải lại, không phải lọc phía client trên một trang đã cắt. */
export function useProgrammingLibrary(filters: LibrarySearchFilters): RemoteState<ProgrammingLibraryPage> {
  const client = useProgrammingApiClient()
  const { projectId, scope, kind, query } = filters
  const load = useCallback(() => {
    const search: Record<string, string | number> = { limit: 100 }
    if (projectId) search.projectId = projectId
    if (scope) search.scope = scope
    if (kind) search.kind = kind
    if (query) search.q = query
    return client.request<ProgrammingLibraryPage>('searchProgrammingLibraries', { query: search })
  }, [client, projectId, scope, kind, query])
  return useProgrammingResource(load, 0)
}
