import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { StateBlock } from '../../../shared/components/StateBlock'
import { Button } from '../../../shared/components/Button'
import { useDraftWorkspace } from './useDraftWorkspace'
import { ProgramsTab } from './editor/ProgramsTab'
import { MappingTab } from './mapping/MappingTab'
import { ExecutionTab } from './task/ExecutionTab'
import { Modal } from '../../../shared/components/Modal'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import type { ProgrammingDiagnostic, ProgrammingDraftOperation } from '../model/types'
import { toWorkspaceDocument } from '../model/draftV2'
import { PouExplorer } from './pou/PouExplorer'
import { useProgrammingRuntimeMonitor, useProgrammingCapabilities, useProgrammingRuntime, useProgrammingRevision } from '../api/queries'
import { runtimeOverlayByProgramId, userPouInterfacesFromDraft } from './editor/workspaceAdapters'
import { programsWorkspacePath } from '../shared/programsRoute'
import { PROGRAMS_WORKSPACE_V2_ENABLED } from '../../../shared/config'
import { DesignWorkbench } from './workbench/DesignWorkbench'
import { LiveProgramView } from './LiveProgramView'
import { SimulateWorkspace } from '../simulation/SimulateWorkspace'
import { useSimulation } from '../simulation/useSimulation'
import { ProgramsModeSwitcher } from './ProgramsModeSwitcher'
import { programsModeCapabilities } from '../shared/programsMode'
import { isProgramsWorkspaceMode, type ProgramsWorkspaceMode } from '../shared/programsRoute'
import { useProgrammingMobileReadOnly } from '../layout/useProgrammingViewport'

const VALID_TABS = ['programs', 'mapping', 'execution'] as const
type DesignTab = (typeof VALID_TABS)[number]

const TAB_LABEL: Record<DesignTab, [string, string]> = {
  programs: ['Chương trình', 'Programs'],
  mapping: ['Điểm & Ánh xạ', 'Points & Mapping'],
  execution: ['Thực thi', 'Execution']
}

/* D-01: PGM-02 không còn tự chạy Check nên không còn nguồn diagnostic nào ở
 * trang này — hằng số module-level tránh tạo mảng rỗng mới mỗi render. */
const EMPTY_DIAGNOSTICS: ProgrammingDiagnostic[] = []

/**
 * PGM-02 Thiết kế — `UJ-PROG-02/03/04` (TASK-PROG-501..503). Một workspace,
 * ba tab, một context Draft/ETag. D-01: Check/Problems giờ ở PGM-03
 * (`CheckCommissionPage`) — trang này chỉ lưu rồi điều hướng, có dirty guard
 * (DDD-FE-PROG-001 §0.1). Tab là trạng thái URL, đọc/ghi bằng `replace`
 * trong `useEffect` (không setState lúc render).
 */
/**
 * T59-306: `route` cố định tab theo ROUTE ĐÍCH của IA sáu trang (DDD §8). Route
 * thắng query vì URL đích là nguồn sự thật — nếu query thắng thì
 * `/mapping?tab=programs` sẽ hiện một trang không khớp địa chỉ của chính nó.
 *
 * T59-501 sửa hai hệ quả mà `--wave W3` không bắt được vì ma trận cổng của W3
 * không có `e2e`:
 *
 * 1. Thanh tab BẤM KHÔNG ĂN trên `/programs` và `/mapping`. Nút chỉ ghi lại
 *    `?tab=`, mà `route` thì ghi đè query — người dùng bấm và không có gì xảy
 *    ra. Nay nút ĐIỀU HƯỚNG sang đúng route của IA.
 * 2. `execution` mất chỗ hiển thị. Nó KHÔNG phải một trong sáu trang IA mà là
 *    một tab con, nên nó chỉ sống dưới dạng `?tab=execution` — và đúng dạng đó
 *    lại bị `route` ghi đè. Nay `execution` là ngoại lệ tường minh: query
 *    thắng route CHỈ cho giá trị này, đúng nơi mà `/task` (lối vào cũ) và nút
 *    tab cùng trỏ tới.
 */
export function DesignWorkspacePage({
  route,
  projectIdOverride,
  mobileReadOnlyOverride
}: {
  route?: DesignTab
  projectIdOverride?: string
  mobileReadOnlyOverride?: boolean
} = {}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  /* `T59-814` — capability là nguồn sự thật cho SIMULATE. Đọc ở đây thay vì
     hardcode trong `programsModeCapabilities` để một thiết bị thiếu worker mô
     phỏng không bị hứa hẹn một chế độ nó không có. */
  const capabilities = useProgrammingCapabilities()
  /* `T59-815` — vòng đời phiên SIMULATE. Hook luôn được gọi (luật hook), nhưng
     nó chỉ poll khi thực sự có phiên sống, nên EDIT/LIVE không sinh tải nào. */
  const simulation = useSimulation()
  const runtime = useProgrammingRuntime()
  const { setEditingContext } = useProgrammingRuntimeContext()
  const detectedMobileReadOnly = useProgrammingMobileReadOnly()
  const mobileReadOnly = mobileReadOnlyOverride ?? detectedMobileReadOnly
  const { projectId: routeProjectId } = useParams<{ projectId: string }>()
  const projectId = projectIdOverride ?? routeProjectId
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  /* Mode là state URL. Tính trước mọi hook/query để LIVE là nơi DUY NHẤT mở
   * monitor subscription; rời LIVE phải cleanup ngay cả khi component không
   * unmount vì route canonical chỉ đổi query. */
  const modeParam = searchParams.get('mode')
  const workspaceMode: ProgramsWorkspaceMode = isProgramsWorkspaceMode(modeParam) ? modeParam : 'EDIT'
  const canEdit = roleAtLeast(session?.role, 'admin') && !mobileReadOnly && workspaceMode === 'EDIT'
  const fromQuery: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'
  /* `execution` là tab con, không phải trang IA: nó chỉ có địa chỉ dưới dạng
   * `?tab=execution` trên route `programs`. Mọi giá trị khác thì route thắng. */
  const tab: DesignTab = requested === 'execution' ? 'execution' : (route ?? fromQuery)
  // BUG-007 — cho phép deep-link `?program=<id>` từ ProblemsDrawer của PGM-03
  // (Check) chọn sẵn đúng Program bị lỗi khi mở workspace Thiết kế.
  const [selectedPouId, setSelectedPouId] = useState<string | undefined>(() => searchParams.get('pou') ?? searchParams.get('program') ?? undefined)
  const queryPouId = searchParams.get('pou') ?? undefined
  /* URL là nguồn chân lý của POU đang mở, không chỉ ở lần mount đầu.
   *
   * Trước `T59-803`, `selectedPouId` chỉ đọc query MỘT LẦN lúc mount. Điều đó
   * còn chạy được khi mỗi Project có route riêng — đi tới đó là remount. Sau
   * cut-over PGM-02, một cú nhảy chẩn đoán từ PGM-03 chỉ đổi QUERY trên cùng
   * route, nên workspace giữ nguyên POU cũ và người dùng bấm vào lỗi mà không
   * có gì mở ra. Effect này nhận thay đổi query; chọn POU trong ứng dụng thì
   * ghi ngược lại query (bằng `replace`) để reload giữ đúng POU đang mở. */
  useEffect(() => {
    if (queryPouId === undefined || queryPouId === selectedPouId) return
    setSelectedPouId(queryPouId)
  }, [queryPouId, selectedPouId])
  /* D-01/F-PROG-ASBUILT-003: PGM-03 giờ sở hữu Check/Problems (không phải ở
   * đây nữa) — khi người dùng bấm một diagnostic ở đó, nó điều hướng sang đây
   * kèm `line/column/length` trong query string thay vì state cùng trang.
   * Đọc một lần lúc mount, đúng pattern `selectedProgramId` ở trên.
   *
   * `T59-807`: setter được mở lại — KHÔNG phải để trang tự chạy Check (D-01 vẫn
   * giữ nguyên: PGM-03 sở hữu Check), mà để workbench nhảy tới một vị trí trong
   * POU đang mở. Dùng lại đúng cơ chế neo `line/column/length` đã có thay vì
   * dựng đường nhảy thứ hai. */
  const [focusDiagnostic, setFocusDiagnostic] = useState<ProgrammingDiagnostic | null>(() => {
    const programId = searchParams.get('program')
    const line = searchParams.get('line')
    const column = searchParams.get('column')
    if (!programId || !line || !column) return null
    const length = searchParams.get('length')
    return {
      code: '', severity: 'ERROR', messageKey: '',
      location: { programId, line: Number(line), column: Number(column), length: length ? Number(length) : 1 }
    }
  })
  const [programOperations, setProgramOperations] = useState<ProgrammingDraftOperation[]>([])
  const [executionOperations, setExecutionOperations] = useState<ProgrammingDraftOperation[]>([])
  const [discardVersion, setDiscardVersion] = useState(0)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)

  useEffect(() => {
    /* Trên route của IA sáu trang, ĐỊA CHỈ đã mang tab — ghi thêm `?tab=` chỉ
     * tạo một URL thứ hai cho cùng một trang, và chính vòng ghi đó là thứ làm
     * `/programs` điều hướng lại chính nó ở e2e. Chỉ đồng bộ query cho lối vào
     * cũ (không có `route`) và cho `execution`, thứ không có route riêng. */
    if (route && tab !== 'execution') {
      if (requested && requested !== 'execution') {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current)
            next.delete('tab')
            return next
          },
          { replace: true }
        )
      }
      return
    }
    if (requested === tab) return
    /* Trên route canonical PGM-02 v2, tab do query quyết định (không có prop
     * `route`). Tab mặc định KHÔNG được ghi `?tab=programs`: canonical URL phải
     * là một chuỗi ổn định, còn mỗi param thừa lại là một biến thể mà resolver
     * phải so lại và có thể tự điều hướng vòng. */
    if (!route && !requested && tab === 'programs') return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('tab', tab)
        return next
      },
      { replace: true }
    )
  }, [requested, route, tab, setSearchParams])

  const workspace = useDraftWorkspace(projectId)
  const monitor = useProgrammingRuntimeMonitor(workspaceMode === 'LIVE')
  /* `toWorkspaceDocument` cấp object/array mới. Nếu gọi trực tiếp dưới render,
   * mỗi lần monitor poll sẽ làm ProgramsTab tưởng Draft đổi, phát lại
   * `onPendingOperationsChange([])` rồi cha set state bằng một mảng mới: vòng
   * render vô hạn (`Maximum update depth exceeded`) chỉ lộ trên browser thật.
   * Neo adapter theo đúng payload Draft authority; monitor thay đổi không được
   * làm identity của tài liệu chỉnh sửa thay đổi theo. */
  const workspaceDocument = useMemo(
    () => workspace.project?.draft ? toWorkspaceDocument(workspace.project.draft) : null,
    [workspace.project?.draft]
  )
  const pendingOperations = useMemo(() => [...programOperations, ...executionOperations], [executionOperations, programOperations])
  const draftDirty = pendingOperations.length > 0

  /* `T59-815` — phiên mô phỏng chỉ mở được trên Revision ĐÃ Kiểm tra đạt.
   *
   * Không tự chọn `draftRevisionId` hay `baseRevisionId`: worker chỉ nhận
   * artifact bất biến do chính pipeline Check sinh ra (`ADR-053` §3), nên một
   * Revision chưa Check thì chưa có gì để chạy. Nói ra điều đó tốt hơn là gửi
   * lên rồi nhận lỗi. */
  const latestCheck = workspace.project?.latestCheck
  const simulateRevisionId = latestCheck && latestCheck.state === 'PASSED' ? latestCheck.revisionId : null
  const simulateRevision = useProgrammingRevision(workspaceMode === 'SIMULATE' ? simulateRevisionId : null)
  const startSimulation = useCallback(() => {
    const controllerId = runtime.data?.controllerId
    /* `useProgrammingRevision` trả `unknown` vì snapshot Revision là tài liệu
     * mở; đọc đúng một trường ở đây và kiểm kiểu tại chỗ, thay vì ép kiểu cả
     * đối tượng thành một hình dạng mà nó không hứa. */
    const revisionData = simulateRevision.data as { contentHash?: unknown } | undefined
    const contentHash = typeof revisionData?.contentHash === 'string' ? revisionData.contentHash : null
    /* Thiếu bất kỳ mảnh danh tính nào thì KHÔNG gửi: `sourceContentSha256` là
     * thứ duy nhất phân biệt "mô phỏng bản tôi vừa lưu" với "mô phỏng thứ gì
     * đó", nên gửi một chuỗi rỗng để server tự đoán là bỏ đúng chốt chặn ấy. */
    if (!controllerId || !simulateRevisionId || !contentHash || !projectId) return
    void simulation.start({
      controllerId,
      projectId,
      sourceDraftRevisionId: simulateRevisionId,
      sourceContentSha256: contentHash,
    })
  }, [projectId, runtime.data?.controllerId, simulateRevision.data, simulateRevisionId, simulation])

  const updateProgramOperations = useCallback((operations: ProgrammingDraftOperation[]) => setProgramOperations(operations), [])
  const updateExecutionOperations = useCallback((operations: ProgrammingDraftOperation[]) => setExecutionOperations(operations), [])

  /* Dùng chung cho nút "Kiểm tra" ở đây VÀ mục lệnh "Kiểm tra" của Bảng lệnh
   * nhanh (ST Editor Quick Control #2, đã duyệt) — cùng một "dirty guard"
   * D-01: không điều hướng sang Commission khi Draft còn thay đổi chưa lưu. */
  const goToCommission = useCallback(() => {
    if (!canEdit || draftDirty || !projectId) return
    navigate(`/eng/programming/projects/${projectId}/commission`)
  }, [canEdit, draftDirty, navigate, projectId])

  /* D-01: PGM-02 không còn tự chạy Check nên không có `checkState` thật để
   * báo — Check/Commission (PGM-03) là nơi duy nhất cập nhật giá trị này giờ
   * (`CheckCommissionPage`). Giữ nguyên `idle` ở đây thay vì suy đoán. */
  useEffect(() => {
    if (workspace.status !== 'ready' || !workspace.project) return
    setEditingContext({
      projectId: workspace.project.projectId,
      projectName: workspace.project.name,
      draftRevisionId: workspace.project.draftRevisionId,
      dirty: draftDirty,
      checkState: 'idle'
    })
    return () => setEditingContext(null)
  }, [draftDirty, setEditingContext, workspace.project, workspace.status])

  useEffect(() => {
    if (!draftDirty) return undefined
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const interceptInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target || anchor.download) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`)
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    globalThis.document.addEventListener('click', interceptInternalLink, true)
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload)
      globalThis.document.removeEventListener('click', interceptInternalLink, true)
    }
  }, [draftDirty])

  if (workspace.status === 'loading') {
    return <StateBlock state="loading" title={pick('Đang tải Draft…', 'Loading draft…')} />
  }
  if (workspace.status === 'error' || !workspace.project?.draft) {
    return <StateBlock state="error" title={pick('Không tải được Project.', 'Could not load the project.')} detail={workspace.error ?? undefined} onRetry={workspace.reload} />
  }
  // T59-301: BE trả document v2; adapter chiếu về view model của bốn tab.
  const document = workspaceDocument as NonNullable<typeof workspaceDocument>
  /* Route v2 chọn POU bằng `objectId`; editor cũ vẫn nhận `programId`. Adapter
   * hẹp này chỉ nối hai định danh khi cùng một record Draft khai cả hai, không
   * suy theo tên/index và không dùng objectId làm mutation target sai. */
  const selectedProgram = document.programs.find((program) => (program.objectId ?? program.programId) === selectedPouId)
    ?? (searchParams.has('program') ? document.programs.find((program) => program.programId === searchParams.get('program')) : undefined)
  const selectedProgramId = selectedProgram?.programId
  const selectedObjectId = selectedProgram ? (selectedProgram.objectId ?? selectedProgram.programId) : selectedPouId
  const selectPou = (objectId: string | undefined) => {
    setSelectedPouId(objectId)
    /* Chỉ ghi vào URL khi route canonical đang sở hữu địa chỉ; trên route cũ,
     * `?pou=` không phải là hợp đồng và ghi vào đó là tạo một URL thứ hai cho
     * cùng một trang. */
    if (!PROGRAMS_WORKSPACE_V2_ENABLED) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (objectId) next.set('pou', objectId)
        else next.delete('pou')
        return next
      },
      { replace: true }
    )
  }

  const selectProgram = (programId: string | undefined) => {
    if (!programId) {
      selectPou(undefined)
      return
    }
    const program = document.programs.find((item) => item.programId === programId)
    selectPou(program?.objectId ?? programId)
  }
  /* `T59-807` — dữ liệu cho workbench dùng chung.
   *
   * Nguồn văn bản chỉ có với POU ngôn ngữ ST; POU FBD trả `null` để tab Tìm
   * kiếm nói thẳng "không phải mã nguồn văn bản" thay vì hiện một ô nhập vô
   * nghĩa. */
  const workbenchSource = selectedProgram?.language === 'ST' && typeof selectedProgram.document === 'string'
    ? selectedProgram.document
    : null
  const workbenchSourceLabel = selectedProgram
    ? `Draft · ${selectedProgram.name}`
    : pick('Draft · chưa chọn POU', 'Draft · no POU selected')

  /** Nhảy tới một offset trong POU đang mở, dùng lại đúng cơ chế neo
   *  `line/column/length` mà PGM-03 đã dùng — không dựng đường nhảy thứ hai. */
  const jumpToSourceOffset = (offset: number, length: number) => {
    if (!selectedProgramId || workbenchSource === null) return
    const before = workbenchSource.slice(0, offset)
    const lines = before.split('\n')
    setFocusDiagnostic({
      code: '', severity: 'ERROR', messageKey: '',
      location: {
        programId: selectedProgramId,
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
        length: Math.max(1, length),
      },
    })
  }

  const runtimeOverlays = runtimeOverlayByProgramId(document.programs, monitor, workspace.project.activeRevisionId)
  const userPouInterfaces = userPouInterfacesFromDraft(workspace.project.draft, selectedProgramId)

  return (
    <div className="space-y-3">
      {/* F-UX-15 (`REV-FE-UIUX-UC-2026-08-18` §7.1): mỗi màn/tab phải có mốc
          tiêu đề riêng trong cây heading. `<h1>` của route Programming nằm ở
          `ProgrammingLayout` (một và chỉ một), nên ở đây là `<h2>`/`<h3>`.
          Ẩn thị giác vì thanh tab đã hiện tên — thứ còn thiếu là mốc điều
          hướng cho trình đọc màn hình, không phải thêm chữ lên màn hình. */}
      <h2 className="sr-only">{pick('Workspace Thiết kế', 'Design workspace')}</h2>
      {mobileReadOnly && (
        <p role="status" data-testid="programming-mobile-read-only" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
          {pick('Dưới 768 px, workspace chỉ cho xem; hãy dùng màn hình rộng hơn để chỉnh sửa.', 'Below 768 px, the workspace is read-only; use a wider screen to edit.')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-2">
        <div role="tablist" aria-label={pick('Tab workspace Thiết kế', 'Design workspace tabs')} className="flex gap-1">
          {VALID_TABS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === tab}
              className={`rounded-t-[var(--radius)] border-b-2 px-3 py-1.5 text-sm font-medium ${
                candidate === tab ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
              onClick={() => {
                /* Điều hướng sang ROUTE của IA thay vì chỉ ghi `?tab=`: trên
                 * `/programs` và `/mapping`, query bị `route` ghi đè nên ghi
                 * query là bấm vào chỗ không có gì xảy ra. */
                const query = new URLSearchParams(searchParams)
                query.delete('tab')
                if (PROGRAMS_WORKSPACE_V2_ENABLED) {
                  /* Cut-over BẬT: cả ba tab ở LẠI route canonical và chỉ đổi
                   * query. Cho tab Ánh xạ nhảy sang `/projects/:id/mapping` sẽ
                   * unmount workspace — và cùng với nó là buffer ST chưa lưu
                   * của người dùng. Trước khi siết chỗ này, journey "đổi tab
                   * không mất nội dung đang gõ" mất trắng nội dung, vì hai địa
                   * chỉ mount hai cây component khác nhau. */
                  if (candidate !== 'programs') query.set('tab', candidate)
                  navigate(programsWorkspacePath(projectId ?? '', { search: query.toString() }), { replace: true })
                  return
                }
                if (candidate === 'execution') query.set('tab', 'execution')
                const target = candidate === 'mapping' ? 'mapping' : 'programs'
                const suffix = query.toString()
                const destination = target === 'programs'
                  ? programsWorkspacePath(projectId ?? '', { search: suffix })
                  : `/eng/programming/projects/${projectId}/${target}${suffix ? `?${suffix}` : ''}`
                navigate(destination, { replace: true })
              }}
            >
              {pick(...TAB_LABEL[candidate])}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `T59-807` — trước lát này `?mode=` chỉ đổi được bằng cách GÕ TAY
              vào URL, và giao diện không nói workspace đang ở chế độ nào. */}
          <ProgramsModeSwitcher
            mode={workspaceMode}
            draftDirty={draftDirty}
            /* `T59-814` — SIMULATE lấy capability TỪ SERVER. Thiếu
               `workspaceModes` (server đời cũ) thì `simulation` là undefined và
               mode ở trạng thái UNAVAILABLE, không phải "chắc là có". */
            capabilities={programsModeCapabilities(pick, capabilities.data?.workspaceModes?.simulation)}
            onSwitch={(next) => {
              const query = new URLSearchParams(searchParams)
              query.set('mode', next)
              navigate(programsWorkspacePath(projectId ?? '', { search: query.toString() }), { replace: true })
            }}
          />
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {/* D-01: PGM-02 không tự seal/run Check nữa — chỉ điều hướng sang
             * PGM-03 (Check & Commission), nơi giờ sở hữu toàn bộ vòng
             * seal/run/poll/result. Nút vẫn khoá khi Draft chưa lưu, đúng
             * "dirty guard" D-01 yêu cầu. */}
            <Button
              size="sm"
              variant="secondary"
              icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
              disabled={draftDirty}
              onClick={goToCommission}
            >
              {pick('Kiểm tra', 'Check')}
            </Button>
          </div>
        )}
      </div>

      {workspace.conflict && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm">
          <p className="font-semibold text-[var(--c-warn-fg)]">{pick('Bản nháp đã thay đổi ở phiên khác.', 'The draft changed in another session.')}</p>
          <p className="mt-1 text-[var(--c-text)]">
            {pick('Bản mong đợi', 'Expected')}: <span className="font-mono">{workspace.conflict.expected ?? '—'}</span> · {pick('Bản hiện tại', 'Current')}:{' '}
            <span className="font-mono">{workspace.conflict.actual ?? '—'}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={workspace.reload}>{pick('Tải lại', 'Reload')}</Button>
            <Button size="sm" variant="ghost" onClick={workspace.dismissConflict}>{pick('Giữ bản đang gõ', 'Keep my edits')}</Button>
          </div>
        </div>
      )}
      {draftDirty && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
          {pick('Draft có thay đổi chưa lưu. Hãy lưu trước khi Kiểm tra.', 'The draft has unsaved changes. Save before running Check.')}
        </div>
      )}

      {/* Cả ba tab luôn MOUNTED, chỉ ẩn bằng CSS (không unmount/remount theo
          `tab`). Bắt buộc: unmount xoá state cục bộ của `SourceEditor`/
          `FbdEditorPane` (buffer đang gõ, chưa lưu), nên đổi tab rồi quay lại
          sẽ "mất nội dung đang gõ" — đúng hành vi bị cấm ở
          DDD-FE-PROG-001 §0.1 ràng buộc 1. Phát hiện qua Playwright E2E
          (TASK-PROG-506), sửa ngay trong cùng phiên. */}
      <div hidden={tab !== 'programs'}>
        {/* T59-306/PGM-02: cây POU gom ba nhóm Programs/Functions/Function
            Blocks và inspector kind-aware. Nó đọc document v2 TRỰC TIẾP, không
            qua adapter — đây là phần IA mới, còn `ProgramsTab` bên dưới vẫn là
            editor cũ cho tới khi lane editor chuyển sang v2. */}
        {/* MỘT POU Explorer duy nhất (T59-803): trước đây cây này và cây
            "Cây ứng dụng" bên trong ProgramsTab cùng nằm trong DOM, đọc hai
            nguồn khác nhau và có thể nói khác nhau về cùng một Project. */}
        <div className="mb-3 rounded border border-[var(--c-border)] p-3">
          <PouExplorer
            document={document}
            canEdit={canEdit}
            saving={workspace.saving}
            selectedObjectId={selectedObjectId}
            onSelect={selectPou}
            onSave={workspace.save}
          />
        </div>
        {/* `T59-811` — LIVE KHÔNG phải "editor với nút Lưu bị khoá". Nó là một
            tài liệu khác: nguồn của gói ĐANG CHẠY. Dùng lại đúng component
            editor rồi tắt sửa là cách chắc chắn nhất để một hôm nào đó Draft rò
            vào chỗ đáng lẽ phải là Active, mà không có dấu hiệu bên ngoài nào. */}
        {workspaceMode === 'SIMULATE' ? (
          /* `T59-815` — SIMULATE cũng KHÔNG phải editor bị khoá: nó là bản đã
             lưu và đã Kiểm tra mà phiên đang chạy, pin theo Revision của phiên
             chứ không theo Active của thiết bị. */
          <SimulateWorkspace
            capability={capabilities.data?.workspaceModes?.simulation}
            role={session?.role}
            slice={simulation.slice}
            inputs={simulation.inputs}
            objectId={selectedObjectId}
            draftDirty={draftDirty}
            draftRevisionId={simulateRevisionId}
            onStart={startSimulation}
            onAction={simulation.act}
            onSetInput={simulation.setInput}
            onStop={simulation.stop}
          />
        ) : workspaceMode === 'LIVE' ? (
          <LiveProgramView
            program={selectedProgram}
            objectId={selectedObjectId}
            activeRevisionId={workspace.project.activeRevisionId ?? null}
            monitor={monitor}
          />
        ) : (
        <ProgramsTab
          document={document}
          saving={workspace.saving}
          selectedProgramId={selectedProgramId}
          onSelectProgram={selectProgram}
          onSave={workspace.save}
          diagnostics={EMPTY_DIAGNOSTICS}
          focusDiagnostic={focusDiagnostic}
          onPendingOperationsChange={updateProgramOperations}
          discardVersion={discardVersion}
          onRunCheck={goToCommission}
          userPouInterfaces={userPouInterfaces}
          forceReadOnly={mobileReadOnly}
        />
        )}
        {/* `T59-807` / `WP-06-R1` — MỘT workbench dùng chung. Trước đây mỗi
            loại thông tin sống ở một chỗ và theo một luật khác nhau: lỗi Draft
            FBD nằm trong editor FBD, tham chiếu ST nằm trong editor ST, tìm
            kiếm nằm trong thanh công cụ ST. Không có chỗ nào để hỏi "Draft này
            đang có vấn đề gì" cho CẢ Project. */}
        <DesignWorkbench
          mode={workspaceMode === 'LIVE' ? 'LIVE' : 'EDIT'}
          {...(workspaceMode === 'LIVE' && selectedProgramId
            ? { runtimeOverlay: runtimeOverlays[selectedProgramId] ?? { status: 'unavailable' as const } }
            : {})}
          traceOwnerHref="/eng/programming/runtime?tab=watch"
          document={document}
          source={workbenchSource}
          sourceLabel={workbenchSourceLabel}
          checkOwnerHref={`/eng/programming/projects/${projectId}/commission`}
          onSelectProgram={selectProgram}
          onJumpToOffset={jumpToSourceOffset}
        />
      </div>
      <div hidden={tab !== 'mapping'}>
        <MappingTab
          draft={workspace.project.draft}
          document={document}
          saving={workspace.saving}
          onSave={workspace.save}
          forceReadOnly={mobileReadOnly}
        />
      </div>
      <div hidden={tab !== 'execution'}>
        <ExecutionTab document={document} saving={workspace.saving} onSave={workspace.save} onPendingOperationsChange={updateExecutionOperations} discardVersion={discardVersion} forceReadOnly={mobileReadOnly} />
      </div>

      {canEdit && <Modal
        open={pendingNavigation !== null}
        title={pick('Draft có thay đổi chưa lưu', 'Draft has unsaved changes')}
        cancelLabel={pick('Ở lại', 'Stay')}
        confirmLabel={pick('Lưu Draft', 'Save Draft')}
        confirmLoading={savingBeforeNavigation}
        onClose={() => setPendingNavigation(null)}
        onConfirm={() => {
          if (!pendingNavigation) return
          setSavingBeforeNavigation(true)
          void workspace.save(pendingOperations).then((saved) => {
            setSavingBeforeNavigation(false)
            if (!saved) return
            const destination = pendingNavigation
            setPendingNavigation(null)
            navigate(destination)
          })
        }}
      >
        <p>{pick('Lưu toàn bộ thay đổi trong một batch, bỏ thay đổi cục bộ, hoặc ở lại trang.', 'Save all changes in one batch, discard local changes, or stay on this page.')}</p>
        <Button
          className="mt-3"
          variant="danger"
          disabled={savingBeforeNavigation}
          onClick={() => {
            if (!pendingNavigation) return
            const destination = pendingNavigation
            setDiscardVersion((current) => current + 1)
            setProgramOperations([])
            setExecutionOperations([])
            setPendingNavigation(null)
            navigate(destination)
          }}
        >
          {pick('Bỏ thay đổi cục bộ', 'Discard local changes')}
        </Button>
      </Modal>}
    </div>
  )
}
