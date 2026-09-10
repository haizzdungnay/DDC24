import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useProgrammingCapabilities, useProgrammingProgramIntents, useProgrammingProjects, useProgrammingRuntime } from '../api/queries'
import type { ProgrammingCapabilities, ProgrammingProgramsPage, ProgrammingProject, ProgrammingProjectPage, ProgrammingRuntime, RemoteState } from '../model/types'
import { useProgrammingActionAllowed } from '../api/authorization'
import { GlobalContextBar } from './GlobalContextBar'
import { activeRevisionOwnership, ownedActiveRevisionId, runningProject } from '../shared/activeRevisionOwnership'
import type { ActiveRevisionOwnership } from '../shared/activeRevisionOwnership'
import { ProgrammingFeatureRail } from './ProgrammingFeatureRail'
import { ProgrammingMobileNav } from './ProgrammingMobileNav'
import { programsWorkspacePath } from '../shared/programsRoute'
import { useI18n } from '../../../shared/i18n'

interface ProgrammingRuntimeContextValue {
  capabilities: RemoteState<ProgrammingCapabilities>
  runtime: RemoteState<ProgrammingRuntime>
  projects: RemoteState<ProgrammingProjectPage>
  programIntents: RemoteState<ProgrammingProgramsPage>
  /**
   * `ISS-PGUI-01` — Project mà TOÀN BỘ shell đang nói về, phân giải MỘT LẦN.
   *
   * `programIntents` bên trên đã được đọc theo đúng Project này. Trang con tự
   * chọn lại Project từ `projects` là cách bảng Program (đọc theo Project của
   * shell) bị ghép với gói đang chạy (chọn theo luật của trang) — hai nửa của
   * một bảng thuộc hai Project khác nhau.
   */
  subjectProject: ProgrammingProject | null
  /** Revision đang chạy có thuộc `subjectProject` không (`ISS-PGUI-01`). */
  activeOwnership: ActiveRevisionOwnership
  setEditingContext: (context: ProgrammingEditingContext | null) => void
  /** Slot đẩy ReactNode từ workspace lên ContextStrip (mode switcher, nút…). */
  setContextStripSlot: (node: ReactNode) => void
}

export interface ProgrammingEditingContext {
  projectId: string
  projectName: string
  draftRevisionId: string
  dirty: boolean
  checkState: 'idle' | 'checking' | 'passed' | 'failed' | 'unknown'
  /**
   * `DEV-PROG-009` — hai hành động chính của workspace đang mở, để header ở
   * trên cùng gọi được chúng.
   *
   * Header KHÔNG tự dựng lệnh Lưu/Kiểm tra: batch operation, luật dirty và
   * đường điều hướng sang PGM-03 đều thuộc workspace. Hai nơi cùng dựng một
   * lệnh là hai nơi để luật khoá lệch nhau — nên workspace ĐĂNG KÝ hành động
   * của nó, còn header chỉ là một chỗ bấm thứ hai cho cùng một hành động.
   *
   * `undefined` = workspace hiện tại không có hành động nào (Tổng quan,
   * Runtime…), và khi đó header không hiện nút chết.
   */
  actions?: {
    onSave: () => void
    saving: boolean
    /** Lý do đọc được khi không lưu được; `null` = lưu được. */
    saveDisabledReason: string | null
    onCheck: () => void
    /** Lý do đọc được khi chưa Kiểm tra được; `null` = kiểm tra được. */
    checkDisabledReason: string | null
  }
}

const ProgrammingRuntimeContext = createContext<ProgrammingRuntimeContextValue | null>(null)

/** Sáu workspace dùng chung các read-model ở tầng layout — tránh poll trùng
 * lặp và giữ đúng một nguồn cho `GlobalContextBar`. */
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
 * do đã ghi ở `ModbusRtuLayout`). Có đúng một `<h1>` (trong `ProgrammingHeader`,
 * dạng `sr-only`); `ProgrammingHeader` chỉ hiện các nút thao tác.
 *
 * BỐ CỤC (README §3 — Feature Rail 220 | Context Strip | workspace):
 *
 * ```text
 * ProgrammingFeatureRail 220px │ GlobalContextBar 38px, sticky
 *                              │ <h1> sr-only
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
  const { pick } = useI18n()
  const canSetRuntimeIntent = useProgrammingActionAllowed('runtimeIntent')
  const capabilities = useProgrammingCapabilities()
  const runtime = useProgrammingRuntime()
  const projects = useProgrammingProjects()
  const [editingContext, setEditingContext] = useState<ProgrammingEditingContext | null>(null)
  const [contextStripSlot, setContextStripSlot] = useState<ReactNode>(null)
  const { projectId: pathProjectId } = useParams<{ projectId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const canonicalProgramsRoute = location.pathname === '/eng/programming/programs'
  const queryProjectId = canonicalProgramsRoute ? new URLSearchParams(location.search).get('project') ?? undefined : undefined
  const projectId = pathProjectId ?? queryProjectId

  const listedProject = useMemo(() => {
    if (projects.status !== 'ready' || !projects.data) return null
    if (projectId) return projects.data.items.find((item) => item.projectId === projectId) ?? null
    // Resolver PGM-02 v2 tự xử lý 0/1/nhiều Project. Shell không được chọn
    // item đầu tiên trước resolver vì context strip/rail sẽ nói sai Project.
    if (canonicalProgramsRoute) return null
    /* `ISS-PGUI-01` — route không mang `projectId` (Tổng quan) thì Project
       ĐANG CHẠY mới là chủ ngữ đúng, không phải Project đầu danh sách.

       Rev A khoá một Project trên mỗi controller nên `items[0]` từng trùng.
       Danh sách production đã có Project thứ hai, và khi gói đang chạy thuộc
       Project thứ hai thì `items[0]` biến cả shell thành một câu sai: dải
       ngữ cảnh nói tên Project A, `GET /projects/A/programs` trả Program của
       A, còn gói đang chạy là của B. Không phân giải được thì vẫn rơi về
       `items[0]` — đó là Project người dùng thấy — nhưng lúc ấy
       `activeOwnership` KHÔNG phải `owned` và mọi khẳng định "đang vận hành"
       bị khoá. */
    return runningProject(projects.data.items, runtime.data?.activeRevisionId) ?? projects.data.items[0] ?? null
  }, [canonicalProgramsRoute, projectId, projects.data, projects.status, runtime.data?.activeRevisionId])
  /* `ISS-PGUI-01` — Revision đang chạy là của CONTROLLER, không của Project.
  
     Strip từng nhận `runtime.activeRevisionId` toàn cục và in `Active: Yes` cho
     BẤT KỲ Project nào đang mở. Trên production, Project đang mở và gói đang
     chạy thuộc hai Project khác nhau — nhãn ấy là một khẳng định sai về thiết
     bị, và nó nằm đúng ở dải người trực ca đọc nhanh nhất. */
  const activeOwnership = activeRevisionOwnership({
    runtimeStatus: runtime.status,
    projectsStatus: projects.status,
    producerState: runtime.data?.producerState,
    runtimeActiveRevisionId: runtime.data?.activeRevisionId,
    projects: projects.data?.items,
    subjectProjectId: listedProject?.projectId ?? null,
  })

  const routeEditingContext = editingContext && (!projectId || editingContext.projectId === projectId) ? editingContext : null
  const visibleEditingContext = listedProject
    ? {
        projectId: listedProject.projectId,
        projectName: routeEditingContext?.projectName || listedProject.name,
        draftRevisionId: routeEditingContext?.draftRevisionId || listedProject.draftRevisionId,
        dirty: routeEditingContext?.dirty ?? false,
        checkState: routeEditingContext?.checkState ?? ('idle' as const),
        /* `DEV-PROG-009` — hành động chỉ đi qua khi CHÍNH Project đang mở đăng
           ký chúng. `listedProject` có thể là một Project khác (id trong URL
           chưa khớp), và mang theo nút Lưu của workspace cũ sẽ ghi vào nhầm
           Draft. */
        ...(routeEditingContext?.actions ? { actions: routeEditingContext.actions } : {})
      }
    : routeEditingContext
  // Khi API Project tạm lỗi, vẫn giữ nguyên định danh từ URL để điều hướng giữa
  // PGM-02..05 và thử read-model intent của đúng Project; không thay bằng
  // Project đầu tiên hoặc tự dựng định danh mới.
  //
  // Ngoại lệ DUY NHẤT: danh sách Project đã `ready` mà id trong URL không nằm
  // trong đó — đây là not-found chắc chắn, không phải lỗi tạm. Vẫn probe
  // read-model của nó chỉ đổi được một dòng 503 trong Console của người dùng,
  // trong khi resolver đã trả not-found. Danh sách đang loading/lỗi thì giữ
  // nguyên hành vi cũ.
  const projectKnownMissing =
    projects.status === 'ready' && Boolean(projectId) && !listedProject && !routeEditingContext
  // Trên route canonical, DDD §3.4 bắt resolver phân giải Project TRƯỚC khi mở
  // workspace. Đọc read-model trong lúc danh sách còn đang bay là đi trước
  // chính cái quyết định đó: nếu id sai, request đã bay đi rồi mới biết. Chờ
  // list `ready` chỉ tốn đúng một nhịp của cùng shell.
  const projectUnconfirmed = canonicalProgramsRoute && projects.status !== 'ready'
  const scopedProjectId = projectKnownMissing || projectUnconfirmed
    ? undefined
    : (visibleEditingContext?.projectId ?? projectId)
  const programIntents = useProgrammingProgramIntents(scopedProjectId)
  const refreshing =
    capabilities.status === 'loading' ||
    runtime.status === 'loading' ||
    projects.status === 'loading' ||
    programIntents.status === 'loading'

  return (
    <ProgrammingRuntimeContext.Provider value={{ capabilities, runtime, projects, programIntents, subjectProject: listedProject, activeOwnership, setEditingContext, setContextStripSlot }}>
      <div className="flex gap-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <ProgrammingFeatureRail projectId={scopedProjectId ?? null} />
        {/* `min-w-0` là bắt buộc: một flex item mặc định `min-width:auto` sẽ
            KHÔNG co lại dưới kích thước nội dung, nên một bảng rộng trong
            workspace sẽ đẩy cả trang tràn ngang thay vì tự cuộn trong ô của nó. */}
        <div className="min-w-0 flex-1 space-y-4">
          <h1 className="sr-only">{pick('Lập trình điều khiển', 'Control programming')}</h1>
          <GlobalContextBar
            projectStatus={projects.status}
            runtimeStatus={runtime.status}
            runtime={runtime.data}
            intentStatus={programIntents.status}
            intents={programIntents.data}
            intentError={programIntents.error}
            editing={visibleEditingContext}
            canMutate={canSetRuntimeIntent}
            /* `DEV-PROG-007` — bộ chọn Project. Danh sách và Project đang mở
               đều lấy từ CÙNG read-model mà shell đã tải; strip không tự gọi
               HTTP (README §5.1/§5.2). */
            projectOptions={projects.data?.items.map((item) => ({ projectId: item.projectId, name: item.name })) ?? []}
            selectedProjectId={scopedProjectId ?? null}
            onSelectProject={(nextProjectId) => navigate(programsWorkspacePath(nextProjectId))}
            /* `DEV-PROG-008` — số thứ tự Revision (`T60-015`). `null` là "đã
               xét và chưa biết", không phải 0; nhãn sẽ bỏ phần `r{N}` chứ
               không in `r0`. */
            draftSequence={listedProject?.draftSequence ?? null}
            activeSequence={listedProject?.activeSequence ?? null}
            activeOwnership={activeOwnership}
            actions={visibleEditingContext?.actions}
            refreshing={refreshing}
            onRefresh={() => {
              capabilities.refresh()
              runtime.refresh()
              projects.refresh()
              programIntents.refresh()
            }}
            details={{
              draftRevisionId: visibleEditingContext?.draftRevisionId ?? null,
              /* Chỉ in khi ĐÃ CHỨNG MINH thuộc Project đang mở; ngược lại
                 `null` để popover nói "chưa đọc được", không mượn id của
                 Project khác. */
              activeRevisionId: ownedActiveRevisionId(activeOwnership, runtime.data?.activeRevisionId ?? null),
              lkgRevisionId: runtime.data?.lkgRevisionId ?? null,
              controllerId: runtime.data?.controllerId ?? null,
              observedAt: runtime.data?.observedAt ?? null,
              /* Vì sao ô `ID Revision đang vận hành` trống: chưa Commission là
                 một câu, "gói đang chạy là của Project khác" là câu khác. */
              activeOwnership: activeOwnership.kind,
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
          >
            {contextStripSlot}
          </GlobalContextBar>
          <Outlet />
        </div>
      </div>
      <ProgrammingMobileNav projectId={scopedProjectId ?? null} />
    </ProgrammingRuntimeContext.Provider>
  )
}
