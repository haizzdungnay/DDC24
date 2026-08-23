import { createContext, useContext, useMemo, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useProgrammingCapabilities, useProgrammingProgramIntents, useProgrammingProjects, useProgrammingRuntime } from '../api/queries'
import type { ProgrammingCapabilities, ProgrammingProgramIntentList, ProgrammingProjectPage, ProgrammingRuntime, RemoteState } from '../model/types'
import { roleAtLeast, useAuth } from '../../auth'
import { ProgrammingHeader } from './ProgrammingHeader'
import { ProgrammingContextStrip } from './ProgrammingContextStrip'
import { ProgrammingFeatureRail } from './ProgrammingFeatureRail'
import { ProgrammingMobileNav } from './ProgrammingMobileNav'

interface ProgrammingRuntimeContextValue {
  capabilities: RemoteState<ProgrammingCapabilities>
  runtime: RemoteState<ProgrammingRuntime>
  projects: RemoteState<ProgrammingProjectPage>
  programIntents: RemoteState<ProgrammingProgramIntentList>
  setEditingContext: (context: ProgrammingEditingContext | null) => void
}

export interface ProgrammingEditingContext {
  projectId: string
  projectName: string
  draftRevisionId: string
  dirty: boolean
  checkState: 'idle' | 'checking' | 'passed' | 'failed' | 'unknown'
}

const ProgrammingRuntimeContext = createContext<ProgrammingRuntimeContextValue | null>(null)

/** Sáu workspace dùng chung các read-model ở tầng layout — tránh poll trùng
 * lặp và giữ đúng một nguồn cho `ProgrammingContextStrip`. */
export function useProgrammingRuntimeContext(): ProgrammingRuntimeContextValue {
  const ctx = useContext(ProgrammingRuntimeContext)
  if (!ctx) throw new Error('useProgrammingRuntimeContext phải nằm trong ProgrammingLayout')
  return ctx
}

/**
 * `ProgrammingLayout` — TASK-PROG-500/T59-503, dựng lại bố cục theo Plan 60 §5.
 *
 * Bọc cả sáu workspace bên trong `AppShell` (đã có `<main>`, skip-link và
 * `RouteErrorBoundary` riêng — KHÔNG mở thêm `<main>`/boundary ở đây, cùng lý
 * do đã ghi ở `ModbusRtuLayout`). Có đúng một `<h1>` (trong `ProgrammingHeader`).
 *
 * BỐ CỤC (README §3 — Feature Rail 220 | Context Strip | workspace):
 *
 * ```text
 * ProgrammingFeatureRail 220px │ ProgrammingContextStrip 38px, sticky
 *                              │ ProgrammingHeader (<h1> + Làm mới)
 *                              │ <Outlet/>
 * ```
 *
 * `T60-101` thay `ProgrammingDesktopNav` (dải tab ngang) bằng rail dọc, và
 * `T60-102` thay `ProgrammingContextBar` (panel `<dl>` sáu ô, cuộn theo trang)
 * bằng strip một hàng dính. Cả hai là ĐỔI BỐ CỤC: mọi luật fail-closed và mọi
 * đích điều hướng được mang sang nguyên vẹn, không mục nào và không nhánh
 * trạng thái nào bị bỏ.
 */
export function ProgrammingLayout() {
  const { session } = useAuth()
  const capabilities = useProgrammingCapabilities()
  const runtime = useProgrammingRuntime()
  const projects = useProgrammingProjects()
  const [editingContext, setEditingContext] = useState<ProgrammingEditingContext | null>(null)
  const { projectId } = useParams<{ projectId?: string }>()

  const listedProject = useMemo(() => {
    if (projects.status !== 'ready' || !projects.data) return null
    if (projectId) return projects.data.items.find((item) => item.projectId === projectId) ?? null
    return projects.data.items[0] ?? null
  }, [projectId, projects.data, projects.status])
  const routeEditingContext = editingContext && (!projectId || editingContext.projectId === projectId) ? editingContext : null
  const visibleEditingContext = listedProject
    ? {
        projectId: listedProject.projectId,
        projectName: routeEditingContext?.projectName || listedProject.name,
        draftRevisionId: routeEditingContext?.draftRevisionId || listedProject.draftRevisionId,
        dirty: routeEditingContext?.dirty ?? false,
        checkState: routeEditingContext?.checkState ?? ('idle' as const)
      }
    : routeEditingContext
  // Khi API Project tạm lỗi, vẫn giữ nguyên định danh từ URL để điều hướng giữa
  // PGM-02..05 và thử read-model intent của đúng Project; không thay bằng
  // Project đầu tiên hoặc tự dựng định danh mới.
  const scopedProjectId = visibleEditingContext?.projectId ?? projectId
  const programIntents = useProgrammingProgramIntents(scopedProjectId)
  const refreshing =
    capabilities.status === 'loading' ||
    runtime.status === 'loading' ||
    projects.status === 'loading' ||
    programIntents.status === 'loading'

  return (
    <ProgrammingRuntimeContext.Provider value={{ capabilities, runtime, projects, programIntents, setEditingContext }}>
      <div className="flex gap-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <ProgrammingFeatureRail projectId={scopedProjectId ?? null} />
        {/* `min-w-0` là bắt buộc: một flex item mặc định `min-width:auto` sẽ
            KHÔNG co lại dưới kích thước nội dung, nên một bảng rộng trong
            workspace sẽ đẩy cả trang tràn ngang thay vì tự cuộn trong ô của nó. */}
        <div className="min-w-0 flex-1 space-y-4">
          <ProgrammingContextStrip
            projectStatus={projects.status}
            runtimeStatus={runtime.status}
            runtime={runtime.data}
            intentStatus={programIntents.status}
            intents={programIntents.data}
            intentError={programIntents.error}
            editing={visibleEditingContext}
            canMutate={roleAtLeast(session?.role, 'admin')}
            details={{
              draftRevisionId: visibleEditingContext?.draftRevisionId ?? null,
              activeRevisionId: runtime.data?.activeRevisionId ?? null,
              lkgRevisionId: runtime.data?.lkgRevisionId ?? null,
              controllerId: runtime.data?.controllerId ?? null,
              observedAt: runtime.data?.observedAt ?? null,
              /* `contentHash` nằm trong thân Revision (`GET /revisions/{id}`),
                 mà shell KHÔNG tải — và không được tự gọi HTTP ở đây (README
                 §5.1/§5.2: chỉ `api/queries.ts` biết về mạng). Truyền `null`
                 để popover nói thẳng "chưa đọc được ở màn này" thay vì bịa
                 một chuỗi hash. Khi `T60-203` mở đường đọc Revision, nối vào
                 đúng hai dòng này là xong. */
              draftContentHash: null,
              activeContentHash: null,
              /* Ba tình trạng, KHÔNG phải một cờ nhị phân. `loading` phải
                 tách riêng: `useProgrammingResource` chỉ để `status =
                 'loading'` ở lần đọc đầu (refresh giữ nguyên `ready`), nên gộp
                 nó vào "không đọc được" sẽ dán một cảnh báo mất kết nối giả
                 lên mỗi lần vào trang. Ba nguồn "Core im" thì phải gộp: HTTP
                 lỗi, chưa có thân phản hồi, và `producerState = UNAVAILABLE` —
                 thiếu nhánh nào thì popover nói "chưa Commission" trong khi sự
                 thật là không ai biết, đúng kiểu suy diễn README §5.4 cấm. */
              coreStatus: runtime.status === 'loading'
                ? 'loading'
                : runtime.status === 'error' || !runtime.data || runtime.data.producerState === 'UNAVAILABLE'
                  ? 'unreadable'
                  : 'readable'
            }}
          />
          <ProgrammingHeader
            refreshing={refreshing}
            onRefresh={() => {
              capabilities.refresh()
              runtime.refresh()
              projects.refresh()
              programIntents.refresh()
            }}
          />
          <Outlet />
        </div>
      </div>
      <ProgrammingMobileNav projectId={scopedProjectId ?? null} />
    </ProgrammingRuntimeContext.Provider>
  )
}
