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
  RemoteState,
  ProgrammingLibraryUsage,
  ProgrammingLibraryEntry,
  ProgrammingSignalDependencies,
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
 *
 * ISS-#565: thêm `enabled` để tắt fetch + poll khi tab không active.
 */
function useProgrammingResource<T>(load: () => Promise<T>, intervalMs = 0, enabled = true): RemoteState<T> {
  const { pick } = useI18n()
  const [status, setStatus] = useState<RemoteState<T>['status']>('loading')
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const generation = useRef(0)
  const inFlight = useRef(false)
  const rerunAfterFlight = useRef(false)
  const active = useRef(false)
  const runRef = useRef<() => void>(() => {})

  const run = useCallback(() => {
    if (!active.current) return
    /* Đổi định danh tài nguyên hoặc gọi refresh trong lúc request cũ còn bay
       không được làm mất lượt đọc mới. Coalesce thành đúng một lượt kế tiếp:
       không mở request chồng nhau, nhưng cũng không kẹt mãi ở dữ liệu cũ. */
    if (inFlight.current) {
      rerunAfterFlight.current = true
      return
    }
    inFlight.current = true
    const myGeneration = generation.current
    const finish = () => {
      inFlight.current = false
      if (!active.current || !rerunAfterFlight.current) return
      rerunAfterFlight.current = false
      queueMicrotask(() => runRef.current())
    }
    // Một client validator hoặc test double có thể ném đồng bộ trước khi trả
    // Promise. Chuẩn hoá cả hai đường vào cùng RemoteState error; nếu không một
    // endpoint context mới đủ làm sập toàn bộ sáu-workspace layout.
    Promise.resolve().then(() => loadRef.current()).then(
      (value) => {
        if (myGeneration === generation.current) {
          setData(value)
          setError(null)
          setStatus('ready')
        }
        finish()
      },
      (reason: unknown) => {
        if (myGeneration === generation.current) {
          setError(programmingResourceErrorMessage(pick, reason))
          setStatus('error')
        }
        finish()
      }
    )
  }, [pick])
  runRef.current = run

  useEffect(() => {
    active.current = enabled
    generation.current += 1
    rerunAfterFlight.current = false
    if (!enabled) {
      return () => {
        active.current = false
        generation.current += 1
        rerunAfterFlight.current = false
      }
    }
    run()
    const timer = intervalMs > 0 ? window.setInterval(run, intervalMs) : null
    return () => {
      active.current = false
      generation.current += 1
      rerunAfterFlight.current = false
      if (timer !== null) window.clearInterval(timer)
    }
    // `load` cố ý nằm trong deps dù `run()` luôn đọc qua `loadRef` (giá trị
    // mới nhất) — thiếu nó, đổi định danh tài nguyên (vd `checkId` từ
    // `undefined` sang giá trị thật sau một `navigate` cùng trang, xem D-01/
    // `CheckCommissionPage`) sẽ không tự fetch lại, chỉ đọc mãi kết quả rỗng
    // của lần mount đầu tới khi ai đó gọi `refresh()` thủ công.
  }, [run, load, intervalMs, enabled])

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

export type ProgrammingPointCatalogFailure = 'REQUEST_FAILED' | 'INVALID_PAGE' | 'REPEATED_CURSOR'

/** Snapshot Point Catalog tích luỹ qua nhiều trang.
 *
 * `status=ready` và `complete=true` chỉ xuất hiện cùng nhau sau khi máy chủ trả
 * trang cuối (`nextCursor=null`). Khi trang sau lỗi, `data.items` vẫn chứa phần
 * đã đọc để inspect nhưng toàn bộ snapshot tiếp tục fail-closed. */
export interface ProgrammingPointCatalogState extends RemoteState<ProgrammingPointCatalogPage> {
  complete: boolean
  failure: ProgrammingPointCatalogFailure | null
  canRetry: boolean
  /** `SW-PGM03-LIVE-001` — đang đọc lại danh mục trong khi VẪN có snapshot đủ.
   *
   *  Tách khỏi `status='loading'` vì hai thứ này nói hai điều khác nhau:
   *  `loading` là "chưa có gì để tin", còn cờ này là "đang đối chiếu lại bản đã
   *  có". Gộp chúng làm một buộc mọi lần revalidate im lặng phải công bố hai
   *  lần đổi trạng thái, và cả workbench vẽ lại hai lượt cho một thao tác mà
   *  người dùng không hề yêu cầu. */
  revalidating: boolean
  /** Thử lại đúng cursor vừa lỗi, không bỏ phần đã tải của generation hiện tại. */
  retry: () => void
  /** Bỏ generation hiện tại và bắt đầu lại từ trang đầu không mang cursor. */
  restart: () => void
}

const programmingPointCatalogPageLimit = 500
const programmingPointCatalogMaxPages = 1000

/* `SW-PGM03-LIVE-001` — nhịp nền để bắt thay đổi CẤU HÌNH điểm, không phải để
 * lấy giá trị.
 *
 * Bản trước đặt nhịp này ở 10 giây vì danh mục là nguồn duy nhất của cả
 * `value` lẫn `quality`. Giá trị sống nay đến từ WebSocket `/api/v1/ws/monitor`
 * (đã có sẵn, chỉ đẩy khi tập điểm thật sự đổi), nên đọc lại 38,9 KiB metadata
 * mỗi 10 giây chỉ còn là lãng phí: số đo trên bo cho thấy 86% payload không đổi
 * lần nào. Năm phút là lưới an toàn cho trường hợp người khác đổi cấu hình mà
 * tín hiệu lệch định danh không bắt được; tín hiệu chính xác nằm ở
 * `catalogIdentitiesDiverged` phía workbench. */
const programmingPointCatalogRevalidateMs = 300_000

interface PointCatalogGeneration {
  controller: AbortController
  items: Map<string, ProgrammingPointCatalogPage['items'][number]>
  consumedCursors: Set<string>
  inFlight: boolean
  retryCursor: string | null | undefined
  pages: number
}

function programmingPointCatalogKey(entry: ProgrammingPointCatalogPage['items'][number]): string | null {
  if (!entry || !['LOCAL', 'VP', 'MB_RTU'].includes(entry.category)) return null
  if (typeof entry.pointId !== 'string' || entry.pointId.trim() === '') return null
  if (entry.deviceId !== undefined && typeof entry.deviceId !== 'string') return null
  if (entry.category === 'MB_RTU' && (!entry.deviceId || entry.deviceId.trim() === '')) return null
  if (entry.category !== 'MB_RTU' && entry.deviceId !== undefined && entry.deviceId !== '') return null
  return JSON.stringify([entry.category, entry.deviceId ?? '', entry.pointId])
}

/* `SW-PGM03-LIVE-001` — hai snapshot danh mục có cùng NỘI DUNG không.
 *
 * So sánh nông theo từng trường thay vì `JSON.stringify` cả mảng: thứ tự khoá
 * của một object do thứ tự gán quyết định, nên hai entry giống hệt nhau về nội
 * dung vẫn có thể sinh hai chuỗi JSON khác nhau — một phép so sánh im lặng cho
 * kết quả sai mà không ai thấy. `mapping` là object lồng nên vẫn dùng JSON cho
 * riêng nó; nó nhỏ và hình dạng do máy chủ sinh, ổn định theo thứ tự khoá.
 */
function sameCatalogEntry(a: ProgrammingPointCatalogPage['items'][number], b: ProgrammingPointCatalogPage['items'][number]): boolean {
  if (a === b) return true
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof typeof a>
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (Object.is(left, right)) continue
    if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
      if (JSON.stringify(left) === JSON.stringify(right)) continue
    }
    return false
  }
  return true
}

function sameCatalogItems(
  previous: ProgrammingPointCatalogPage['items'] | undefined,
  next: ProgrammingPointCatalogPage['items'],
): boolean {
  if (previous === next) return true
  if (!previous || previous.length !== next.length) return false
  return previous.every((entry, index) => sameCatalogEntry(entry, next[index]))
}

function normalizeProgrammingPointCatalogPage(value: unknown): ProgrammingPointCatalogPage | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { items?: unknown; nextCursor?: unknown }
  if (!Array.isArray(candidate.items)) return null
  if (candidate.nextCursor !== undefined && candidate.nextCursor !== null
      && (typeof candidate.nextCursor !== 'string' || candidate.nextCursor.trim().length === 0 || candidate.nextCursor.length > 1024)) {
    return null
  }
  for (const item of candidate.items) {
    if (programmingPointCatalogKey(item as ProgrammingPointCatalogPage['items'][number]) === null) return null
  }
  return {
    items: candidate.items as ProgrammingPointCatalogPage['items'],
    nextCursor: candidate.nextCursor === undefined ? null : candidate.nextCursor as string | null,
  }
}

/** `GET /point-catalog` — tab Điểm & Ánh xạ có nhịp làm mới riêng (UX §0.1
 * ràng buộc 3: `usePointCatalogQuery` tách khỏi `useDraftQuery`).
 *
 * `ISS-PGM03-08`: mỗi lượt refresh là một generation độc lập. Hook tự rút cạn
 * tuần tự mọi trang, ghép theo canonical identity `(category, deviceId,
 * pointId)`, giữ partial snapshot khi trang sau lỗi và chặn cursor lặp/hỏng.
 * `scopeKey` là định danh route/Project: đổi nó trong lúc request cũ còn bay sẽ
 * bỏ response cũ và đọc lại từ trang đầu, dù endpoint catalog là global.
 *
 * `ISS-#565`: `enabled=false` tắt fetch + poll khi tab không active.
 */
export function useProgrammingPointCatalog(enabled = true, scopeKey?: string): ProgrammingPointCatalogState {
  const { pick } = useI18n()
  const client = useProgrammingApiClient()
  const requestedScope = scopeKey ?? ''
  const active = useRef(false)
  const activeScope = useRef<string | null>(null)
  const current = useRef<PointCatalogGeneration | null>(null)
  const lastCompleteItems = useRef<ProgrammingPointCatalogPage['items']>([])
  const lastSuccessAt = useRef<number | null>(null)
  const [state, setState] = useState<Omit<ProgrammingPointCatalogState, 'refresh' | 'retry' | 'restart'>>({
    status: 'loading',
    data: null,
    error: null,
    lastSuccessAt: null,
    complete: false,
    failure: null,
    canRetry: false,
    revalidating: false,
  })

  const visibleItems = useCallback((generation: PointCatalogGeneration) => (
    generation.items.size > 0 ? [...generation.items.values()] : lastCompleteItems.current
  ), [])

  const publishFailure = useCallback((generation: PointCatalogGeneration, error: string,
    failure: ProgrammingPointCatalogFailure, retryCursor?: string | null) => {
    if (!active.current || current.current !== generation) return
    generation.retryCursor = retryCursor
    setState({
      status: 'error',
      data: { items: visibleItems(generation), nextCursor: retryCursor ?? null },
      error,
      lastSuccessAt: lastSuccessAt.current,
      complete: false,
      failure,
      canRetry: retryCursor !== undefined,
      revalidating: false,
    })
  }, [visibleItems])

  const loadPages = useCallback(async (generation: PointCatalogGeneration, initialCursor: string | null) => {
    if (generation.inFlight || !active.current || current.current !== generation) return
    generation.inFlight = true
    generation.retryCursor = undefined
    let cursor = initialCursor
    try {
      while (active.current && current.current === generation) {
        /* Còn giữ một snapshot ĐỦ của lần trước ⇒ đây là revalidate, không phải
         * lần nạp đầu: giữ nguyên `ready` + dữ liệu cũ và chỉ bật cờ
         * `revalidating`. Hạ xuống `loading` ở đây sẽ xoá bảng đang hiển thị
         * rồi vẽ lại y nguyên, và khoá mọi nút mutation trong khoảnh khắc đó
         * dù không có gì đáng ngờ về dữ liệu. */
        const revalidating = lastCompleteItems.current.length > 0
        setState((previous) => (revalidating
          ? (previous.revalidating ? previous : { ...previous, revalidating: true })
          : {
            status: 'loading',
            data: { items: visibleItems(generation), nextCursor: cursor },
            error: null,
            lastSuccessAt: lastSuccessAt.current,
            complete: false,
            failure: null,
            canRetry: false,
            revalidating: false,
          }))

        let rawPage: unknown
        try {
          rawPage = await client.request<unknown>('getProgrammingPointCatalog', {
            query: cursor === null
              ? { limit: programmingPointCatalogPageLimit }
              : { limit: programmingPointCatalogPageLimit, cursor },
            signal: generation.controller.signal,
          })
        } catch (reason: unknown) {
          if (!active.current || current.current !== generation || generation.controller.signal.aborted) return
          publishFailure(generation, programmingResourceErrorMessage(pick, reason), 'REQUEST_FAILED', cursor)
          return
        }

        if (!active.current || current.current !== generation) return
        const page = normalizeProgrammingPointCatalogPage(rawPage)
        if (!page || page.items.length > programmingPointCatalogPageLimit) {
          publishFailure(
            generation,
            pick('Phản hồi Point Catalog không hợp lệ. Hãy đọc lại từ trang đầu.', 'The Point Catalog response is invalid. Restart from the first page.'),
            'INVALID_PAGE',
          )
          return
        }

        const sizeBefore = generation.items.size
        for (const item of page.items) {
          generation.items.set(programmingPointCatalogKey(item) as string, item)
        }
        generation.pages += 1

        const nextCursor = page.nextCursor ?? null
        if (nextCursor === null) {
          const items = [...generation.items.values()]
          const completedAt = Date.now()
          lastCompleteItems.current = items
          lastSuccessAt.current = completedAt
          generation.retryCursor = undefined
          /* Danh mục y hệt lần trước ⇒ giữ NGUYÊN reference `data` cũ. Đây là
           * trường hợp thường gặp nhất (86% payload là metadata không đổi), và
           * trả về một mảng mới ở đây là đủ để mọi `useMemo` phía dưới tính
           * lại và cả workbench vẽ lại dù không có gì thay đổi. */
          setState((previous) => (previous.status === 'ready' && previous.complete
            && sameCatalogItems(previous.data?.items, items)
            ? { ...previous, lastSuccessAt: completedAt, revalidating: false }
            : {
              status: 'ready',
              data: { items, nextCursor: null },
              error: null,
              lastSuccessAt: completedAt,
              complete: true,
              failure: null,
              canRetry: false,
              revalidating: false,
            }))
          return
        }

        /* Một trang có `nextCursor` nhưng không thêm canonical identity nào sẽ
         * không bao giờ tiến tới snapshot đáng tin. Dừng ồn ào thay vì quay vô
         * hạn qua các cursor khác nhau mà cùng trả một lát dữ liệu. */
        const noProgress = generation.items.size === sizeBefore
        const repeated = nextCursor === cursor || generation.consumedCursors.has(nextCursor)
        const tooManyPages = generation.pages >= programmingPointCatalogMaxPages
        if (noProgress || repeated || tooManyPages) {
          publishFailure(
            generation,
            pick('Cursor Point Catalog bị lặp hoặc không tiến triển. Hãy đọc lại từ trang đầu.', 'The Point Catalog cursor repeated or made no progress. Restart from the first page.'),
            'REPEATED_CURSOR',
          )
          return
        }
        if (cursor !== null) generation.consumedCursors.add(cursor)
        cursor = nextCursor
      }
    } finally {
      generation.inFlight = false
    }
  }, [client, pick, publishFailure, visibleItems])

  const restart = useCallback(() => {
    if (!active.current) return
    current.current?.controller.abort()
    const generation: PointCatalogGeneration = {
      controller: new AbortController(),
      items: new Map(),
      consumedCursors: new Set(),
      inFlight: false,
      retryCursor: undefined,
      pages: 0,
    }
    current.current = generation
    void loadPages(generation, null)
  }, [loadPages])

  const retry = useCallback(() => {
    const generation = current.current
    if (!active.current || !generation || generation.inFlight || generation.retryCursor === undefined) return
    const cursor = generation.retryCursor
    void loadPages(generation, cursor)
  }, [loadPages])

  useEffect(() => {
    active.current = enabled
    if (!enabled) {
      current.current?.controller.abort()
      current.current = null
      activeScope.current = null
      return () => {
        active.current = false
        current.current?.controller.abort()
        current.current = null
        activeScope.current = null
      }
    }
    // Effect chạy sau render. Ghi scope trước khi tạo request và xóa snapshot
    // hoàn chỉnh của route cũ để generation mới không dùng nó làm partial.
    if (activeScope.current !== requestedScope) {
      lastCompleteItems.current = []
      lastSuccessAt.current = null
    }
    activeScope.current = requestedScope
    restart()
    const timer = window.setInterval(() => {
      if (!current.current?.inFlight) restart()
    }, programmingPointCatalogRevalidateMs)
    /* Tab bị ẩn thì không có ai đọc màn hình, nhưng lúc quay lại thì snapshot
     * có thể đã cũ hơn cả nhịp nền. Nạp lại đúng một lần ở thời điểm quay lại
     * là rẻ hơn và đúng hơn là rút ngắn nhịp cho mọi tab. */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const age = lastSuccessAt.current === null ? Infinity : Date.now() - lastSuccessAt.current
      if (age >= programmingPointCatalogRevalidateMs && !current.current?.inFlight) restart()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      current.current?.controller.abort()
      current.current = null
      activeScope.current = null
    }
    // `scopeKey` cố ý là dependency dù không đi lên API: nó chia generation
    // theo route/Project và loại response của route cũ đang bay.
  }, [enabled, requestedScope, restart])

  /* Khi route/Project đổi, effect tạo generation mới chỉ chạy sau render. Che
   * snapshot của scope cũ ngay ở render hiện tại để không có một frame nào
   * công bố `complete=true` và cho phép hành động trên dữ liệu cũ. */
  if (!enabled || activeScope.current !== requestedScope) {
    return {
      status: 'loading', data: null, error: null, lastSuccessAt: null,
      complete: false, failure: null, canRetry: false, revalidating: false,
      refresh: restart, retry, restart,
    }
  }
  return { ...state, refresh: restart, retry, restart }
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

export interface LazyLibraryCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** MỌI mục đã tải, không phải một trang. Xem `ensureLoaded`. */
  items: ProgrammingLibraryEntry[]
  error: string | null
  ensureLoaded: () => void
}

/**
 * `T59-820` — catalog thư viện nạp TRỄ, dùng chung cho Inspector và hover.
 *
 * Chữ ký chuẩn hoá của một khối chỉ có ở catalog. Trước lát này không ai truyền
 * catalog vào `ContextInspector`, nên trường `Chữ ký` của handoff §9 luôn hiện
 * "không xác định được" — đúng về mặt trung thực, nhưng nó đang nói "thư viện
 * không công bố" trong khi sự thật là "chưa ai hỏi thư viện".
 *
 * Nạp trễ chứ không nạp khi mount: phần lớn phiên soạn thảo không chạm tới một
 * khối thư viện nào, và một request cho mọi lần mở tab là chi phí trả cho việc
 * không dùng.
 *
 * `T61-202` — và nạp trễ KHÔNG có nghĩa là nạp một phần. Bản trước đọc đúng một
 * trang `limit: 100` rồi bỏ `nextCursor`, nên khối thứ 101 trở đi rơi vào đúng
 * cái hố mà hook này sinh ra để lấp: Inspector lại hiện "không xác định được"
 * cho một khối mà thư viện CÓ công bố. Ở đây tra cứu chữ ký cần danh sách ĐẦY
 * ĐỦ chứ không phải một danh sách cuộn được, nên vỏ này rút cạn các trang còn
 * lại của cùng engine phân trang mà PGM-04 và Quick Library đang dùng — một
 * thuật toán, không phải ba.
 */
export function useLazyProgrammingLibraryCatalog(projectId: string | undefined): LazyLibraryCatalogState {
  const [awake, setAwake] = useState(false)
  const paged = useProgrammingLibraryPaged({ projectId }, { enabled: awake })
  const ensureLoaded = useCallback(() => setAwake(true), [])

  const { status, hasMore, loadingMore, loadMoreError, loadMore } = paged
  useEffect(() => {
    /* Dừng khi trang vừa xin bị lỗi: `loadMoreError` khác null nghĩa là lần
     * trước hỏng, và xin lại ngay trong effect là một vòng lặp gõ cửa máy chủ
     * mà người dùng không hề bấm gì. Lần `ensureLoaded` sau, hoặc một lần đổi
     * Project, sẽ mở lại đường. */
    if (status !== 'ready' || !hasMore || loadingMore || loadMoreError !== null) return
    loadMore()
  }, [status, hasMore, loadingMore, loadMoreError, loadMore])

  return { status, items: paged.items, error: paged.error, ensureLoaded }
}

/** `GET /checks/{checkId}` — dùng lại độc lập với `useCheckWorkflow` để
 * PGM-05 luôn đọc trạng thái mới nhất kể cả khi vào thẳng bằng navigation
 * state (không phải vừa chạy Check trong cùng phiên). */
export function useProgrammingCheck(checkId: string | undefined): RemoteState<ProgrammingCheck> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!checkId) return Promise.reject(new Error('checkId is required'))
    return client.request<ProgrammingCheck>('getProgrammingCheck', { path: { checkId } })
  }, [client, checkId])
  const result = useProgrammingResource(load, 0, Boolean(checkId))
  // Mở PGM-05 trực tiếp chưa có checkId là trạng thái DRAFT hợp lệ. Đừng báo
  // NETWORK_ERROR cho một request chưa từng được gửi; khi bỏ deep-link cũ cũng
  // không giữ lỗi/dữ liệu Check cũ trong khay log.
  return checkId ? result : { ...result, status: 'loading', data: null, error: null }
}

/** Publisher/consumer do compiler xác nhận, neo vào đúng Draft/Revision/Check. */
export function useProgrammingSignalDependencies(
  projectId: string | undefined,
  enabled = true,
  draftVersion?: string,
): RemoteState<ProgrammingSignalDependencies> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!projectId) return Promise.reject(new Error('projectId is required'))
    return client.request<ProgrammingSignalDependencies>('getProgrammingSignalDependencies', { path: { projectId } })
  }, [client, projectId, draftVersion])
  return useProgrammingResource(load, 0, enabled && Boolean(projectId))
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

/** `GET /audit` — bản đầy đủ cho tab "Phiên bản & Bảo trì" của PGM-06. */
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
  /** `T61-204` — phân loại nghiệp vụ; so chính xác theo `categoryOrder`. */
  category?: string
  query?: string
}

/**
 * `T61-105` — Used-In của một Control Library entry.
 *
 * `libraryRevisionId` rỗng ⇒ hook không gọi gì và trả trạng thái chờ. Không tự
 * gọi với chuỗi rỗng: server sẽ trả 400, và một lỗi 400 hiện lên màn hình vì FE
 * gọi sớm là một lỗi FE mặc áo lỗi server.
 */
export function useProgrammingLibraryUsage(
  libraryRevisionId: string | null | undefined,
  entryId: string | null | undefined,
  scope: 'SYSTEM' | 'PROJECT' | null | undefined,
): RemoteState<ProgrammingLibraryUsage> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!libraryRevisionId) return Promise.reject(new Error('libraryRevisionId is required'))
    const search: Record<string, string> = { libraryRevisionId }
    if (entryId) search.entryId = entryId
    if (scope) search.scope = scope
    return client.request<ProgrammingLibraryUsage>('listProgrammingLibraryUsages', { query: search })
  }, [client, libraryRevisionId, entryId, scope])
  return useProgrammingResource(load, 0)
}

/**
 * `T61-404` / `ISS-PGM04-13` — đọc mã nguồn đã lưu của MỘT entry.
 *
 * Hai định danh đều BẮT BUỘC, và hook không có nhánh "lấy bản mới nhất": đọc mã
 * nguồn của sai revision là đọc sai thứ thiết bị đang chạy, và đó là lỗi im lặng
 * nhất của cả màn hình này. Thiếu một trong hai thì hook đứng yên chứ không đoán.
 *
 * `availability` là thứ màn hình phải xét TRƯỚC khi hiển thị bất cứ gì — `source`
 * VẮNG nghĩa là không có mã nguồn để đọc, không phải "mã nguồn rỗng".
 */
export interface ProgrammingLibraryEntrySource {
  scope: 'SYSTEM' | 'PROJECT'
  libraryRevisionId: string
  libraryVersion: string
  libraryState: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'
  entryId: string
  name: string
  kind: string
  language?: 'ST' | 'FBD'
  contentSha256: string
  availability: 'AVAILABLE' | 'NOT_STORED' | 'HASH_MISMATCH'
  source?: string
  interface?: unknown
  reason?: string
}

export function useProgrammingLibraryEntrySource(
  libraryRevisionId: string | null | undefined,
  entryId: string | null | undefined,
): RemoteState<ProgrammingLibraryEntrySource> {
  const client = useProgrammingApiClient()
  const load = useCallback(() => {
    if (!libraryRevisionId || !entryId) {
      return Promise.reject(new Error('libraryRevisionId và entryId đều bắt buộc'))
    }
    return client.request<ProgrammingLibraryEntrySource>('getProgrammingLibraryEntrySource', {
      query: { libraryRevisionId, entryId }
    })
  }, [client, libraryRevisionId, entryId])
  return useProgrammingResource(load, 0)
}

/**
 * `T61-202` — ENGINE phân trang DUY NHẤT của Control Library.
 *
 * Trước lát này có ba đường đọc `/libraries`, và cả ba đọc đúng MỘT trang
 * `limit: 100` rồi bỏ `nextCursor`: `useProgrammingLibrary` (Quick Library của
 * PGM-02), `useLazyProgrammingLibraryCatalog` (chữ ký cho Inspector) và bản
 * phân trang này. Với một Project nhiều khối, phần dư biến mất **im lặng**: màn
 * hình hiện một danh sách trông đầy đủ, và người dùng kết luận khối họ tìm
 * không tồn tại. Riêng registry SYSTEM đã 46 mục.
 *
 * Hai đường kia nay là VỎ của hàm này (`enabled` cho nạp trễ), nên chỉ còn một
 * thuật toán ghép trang, một luật khử trùng và một luật retry. Ba bản song song
 * không chỉ là trùng mã: chúng phân kỳ: bản Quick Library chưa từng có đường
 * `loadMore`, nên "sửa phân trang" ở PGM-04 không hề chạm tới PGM-02.
 *
 * Ba luật ở đây đều rút từ vết thương của `useProgrammingRevisionComparison`:
 *
 * 1. **`loadMore` phải chạy được sau một trang hỏng.** Trang trước hỏng chính
 *    là lúc cần thử lại; đòi `status === 'ready'` là cách đường retry không bao
 *    giờ chạy được.
 * 2. **Lỗi một trang KHÔNG xoá danh sách đã tải.** Mất mọi thứ đã cuộn qua chỉ
 *    vì trang thứ tư lỗi là một đánh đổi không ai chọn.
 * 3. **Khử trùng theo ĐỊNH DANH, không theo vị trí.** Cursor lặp hoặc trang
 *    chồng lấn sẽ đẩy cùng một khối vào danh sách hai lần; hai thẻ trùng tên tệ
 *    hơn một thẻ thiếu, vì người dùng sửa một thẻ rồi thấy thẻ kia vẫn mang giá
 *    trị cũ và kết luận là mình lưu hỏng.
 */
export interface ProgrammingLibraryPagedOptions {
  /**
   * `false` ⇒ hook KHÔNG phát request nào và đứng ở `idle`.
   *
   * Đây là cách duy nhất để một bề mặt nạp trễ dùng chung engine này. Trước lát
   * này mỗi bề mặt tự viết đường nạp trễ riêng (`useLazyProgrammingLibraryCatalog`
   * có bản của nó, `QuickLibraryHost` dựa vào việc chỉ mount khi mở), nên mỗi
   * bản mang một cách xử lý `nextCursor` khác nhau — mà cả hai bản đều là bỏ nó
   * đi.
   */
  enabled?: boolean
}

export interface ProgrammingLibraryPagedState {
  /** `idle` = bị tắt bằng `enabled: false`, chưa hỏi máy chủ lần nào. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: ProgrammingLibraryEntry[]
  error: string | null
  /* LOẠI lỗi, không chỉ câu chữ. Thiếu nó thì mô hình trạng thái không phân
     biệt được 403 với mất mạng — mà hai thứ ấy phải hành xử khác nhau: một
     phán quyết quyền XOÁ nội dung đang hiện, một sự cố mạng thì giữ. */
  failure: 'permission' | 'offline' | 'error' | null
  /** Lỗi của RIÊNG trang vừa xin thêm — không phải lỗi của cả danh sách. */
  loadMoreError: string | null
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

function libraryEntryIdentity(entry: ProgrammingLibraryEntry): string {
  return entry.libraryRevisionId + ' ' + entry.entryId
}

export function useProgrammingLibraryPaged(
  filters: LibrarySearchFilters,
  options?: ProgrammingLibraryPagedOptions,
): ProgrammingLibraryPagedState {
  const enabled = options?.enabled ?? true
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const { projectId, scope, kind, category, query } = filters
  /* Khoá bộ lọc: đổi bất kỳ mảnh nào là một danh sách KHÁC, nên mọi trang đã
   * tải phải bị bỏ. Ghép trang của bộ lọc cũ vào bộ lọc mới là cách người dùng
   * thấy khối không khớp điều kiện họ vừa chọn. */
  const filterKey = [projectId ?? '', scope ?? '', kind ?? '', category ?? '', query ?? ''].join(' ')

  const [state, setState] = useState<{
    key: string
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: ProgrammingLibraryEntry[]
    cursor: string | null
    error: string | null
    failure: 'permission' | 'offline' | 'error' | null
    loadMoreError: string | null
    loadingMore: boolean
  }>({
    key: filterKey, status: enabled ? 'loading' : 'idle', items: [], cursor: null,
    error: null, failure: null, loadMoreError: null, loadingMore: false,
  })

  const generation = useRef(0)
  const consumed = useRef(new Set<string>())
  const inFlight = useRef<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const requestPage = useCallback((cursor: string | null) => {
    const search: Record<string, string | number> = { limit: 100 }
    if (projectId) search.projectId = projectId
    if (scope) search.scope = scope
    if (kind) search.kind = kind
    if (category) search.category = category
    if (query) search.q = query
    if (cursor) search.cursor = cursor
    return client.request<ProgrammingLibraryPage>('searchProgrammingLibraries', { query: search })
  }, [client, projectId, scope, kind, category, query])

  const loadFirst = useCallback(() => {
    const myGeneration = ++generation.current
    consumed.current = new Set()
    inFlight.current = null
    if (!enabled) {
      /* Tắt ⇒ trở về `idle` RỖNG, không giữ lại danh sách cũ. Giữ lại là để
       * một bề mặt đã tắt vẫn vẽ dữ liệu của lần bật trước, và dữ liệu ấy
       * không còn ai làm mới. */
      setState({
        key: filterKey, status: 'idle', items: [], cursor: null,
        error: null, failure: null, loadMoreError: null, loadingMore: false,
      })
      return
    }
    /* GIỮ danh sách đang hiện trong lúc tải lại.
     *
     * Xoá trắng rồi mới tải là cách màn hình nháy một nhịp mỗi lần đổi bộ lọc —
     * và tệ hơn: `<ul>` bị tháo rồi dựng lại, nên tiêu điểm bàn phím của người
     * đang dùng phím mũi tên rơi về đầu trang. Trạng thái `loading` chỉ dùng
     * khi CHƯA có gì để hiện; còn lại là tải lại tại chỗ. */
    setState((latest) => ({
      key: filterKey,
      status: latest.items.length > 0 ? 'ready' : 'loading',
      items: latest.items,
      cursor: null,
      error: null,
      failure: null,
      loadMoreError: null,
      loadingMore: false,
    }))
    Promise.resolve().then(() => requestPage(null)).then(
      (page) => {
        if (myGeneration !== generation.current) return
        setState({
          key: filterKey, status: 'ready', items: page.items ?? [],
          cursor: page.nextCursor ?? null, error: null, failure: null,
          loadMoreError: null, loadingMore: false,
        })
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current) return
        /* Lỗi tải lại KHÔNG xoá danh sách đang hiện: một lần mất mạng không nên
         * làm người dùng mất luôn thứ họ đang đọc. Nhưng `status` vẫn là
         * `error` để bề mặt nói ra rằng dữ liệu này có thể đã cũ. */
        setState((latest) => ({
          key: filterKey, status: 'error', items: latest.items, cursor: null,
          error: programmingResourceErrorMessage(pick, reason),
          failure: classifyProgrammingMonitorFailure(reason),
          loadMoreError: null, loadingMore: false,
        }))
      },
    )
  }, [filterKey, requestPage, pick, enabled])

  useEffect(() => { loadFirst() }, [loadFirst])

  const loadMore = useCallback(() => {
    const current = stateRef.current
    /* Cố ý KHÔNG đòi `status === 'ready'`: sau một trang hỏng, `loadMoreError`
     * khác null và người dùng bấm "Tải thêm" chính là để thử lại. Điều kiện
     * thật sự là "có cursor và không có request đang bay". */
    if (!current.cursor || inFlight.current || current.loadingMore) return
    const cursor = current.cursor
    if (consumed.current.has(cursor)) return
    consumed.current.add(cursor)
    inFlight.current = cursor
    const myGeneration = generation.current
    setState((latest) => ({ ...latest, loadingMore: true, loadMoreError: null }))
    Promise.resolve().then(() => requestPage(cursor)).then(
      (page) => {
        if (myGeneration !== generation.current || inFlight.current !== cursor) return
        inFlight.current = null
        /* Máy chủ vi phạm hợp đồng phân trang: `nextCursor` trỏ về một trang đã
         * đọc. Đi tiếp là quay vòng vô hạn. Nhưng trang VỪA nhận thì hợp lệ —
         * nó về từ một cursor chưa từng tiêu thụ — nên vẫn ghép; chỉ đường đi
         * tiếp bị cắt. */
        const nextCursor = page.nextCursor ?? null
        const looping = nextCursor !== null &&
          (nextCursor === cursor || consumed.current.has(nextCursor))
        setState((latest) => {
          const seen = new Set(latest.items.map(libraryEntryIdentity))
          const merged = latest.items.slice()
          for (const item of page.items ?? []) {
            const identity = libraryEntryIdentity(item)
            if (seen.has(identity)) continue
            seen.add(identity)
            merged.push(item)
          }
          return {
            ...latest,
            status: 'ready',
            items: merged,
            cursor: looping ? null : nextCursor,
            loadingMore: false,
            loadMoreError: looping
              ? pick(
                'Máy chủ trả cursor lặp; danh sách đã dừng để tránh lặp hoặc bỏ sót khối.',
                'The server returned a repeated cursor; loading stopped to avoid duplicate or missing blocks.',
              )
              : null,
          }
        })
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current || inFlight.current !== cursor) return
        inFlight.current = null
        /* Cho thử lại đúng cursor này: xoá nó khỏi tập đã tiêu thụ. Không xoá
         * thì nút "Tải thêm" thành nút chết sau lần lỗi đầu tiên. */
        consumed.current.delete(cursor)
        setState((latest) => ({
          ...latest,
          loadingMore: false,
          /* Danh sách đã tải GIỮ NGUYÊN — xem luật 2 ở đầu hàm. */
          loadMoreError: programmingResourceErrorMessage(pick, reason),
        }))
      },
    )
  }, [requestPage, pick])

  return {
    status: state.status,
    items: state.items,
    error: state.error,
    failure: state.failure,
    loadMoreError: state.loadMoreError,
    loadingMore: state.loadingMore,
    hasMore: state.cursor !== null,
    loadMore,
    refresh: loadFirst,
  }
}
