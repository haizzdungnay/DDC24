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
import { PouTree } from './PouTree'
import { useProgrammingRuntimeMonitor } from '../api/queries'
import { runtimeOverlayByProgramId, userPouInterfacesFromDraft } from './editor/workspaceAdapters'

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
export function DesignWorkspacePage({ route }: { route?: DesignTab } = {}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { setEditingContext } = useProgrammingRuntimeContext()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const fromQuery: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'
  /* `execution` là tab con, không phải trang IA: nó chỉ có địa chỉ dưới dạng
   * `?tab=execution` trên route `programs`. Mọi giá trị khác thì route thắng. */
  const tab: DesignTab = requested === 'execution' ? 'execution' : (route ?? fromQuery)
  // BUG-007 — cho phép deep-link `?program=<id>` từ ProblemsDrawer của PGM-03
  // (Check) chọn sẵn đúng Program bị lỗi khi mở workspace Thiết kế.
  const [selectedProgramId, setSelectedProgramId] = useState<string | undefined>(() => searchParams.get('program') ?? undefined)
  /* D-01/F-PROG-ASBUILT-003: PGM-03 giờ sở hữu Check/Problems (không phải ở
   * đây nữa) — khi người dùng bấm một diagnostic ở đó, nó điều hướng sang đây
   * kèm `line/column/length` trong query string thay vì state cùng trang.
   * Đọc một lần lúc mount, đúng pattern `selectedProgramId` ở trên; không cần
   * setter vì trang này không còn tự phát sinh diagnostic nào nữa. */
  const [focusDiagnostic] = useState<ProgrammingDiagnostic | null>(() => {
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
  const monitor = useProgrammingRuntimeMonitor()
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

  const updateProgramOperations = useCallback((operations: ProgrammingDraftOperation[]) => setProgramOperations(operations), [])
  const updateExecutionOperations = useCallback((operations: ProgrammingDraftOperation[]) => setExecutionOperations(operations), [])

  /* Dùng chung cho nút "Kiểm tra" ở đây VÀ mục lệnh "Kiểm tra" của Bảng lệnh
   * nhanh (ST Editor Quick Control #2, đã duyệt) — cùng một "dirty guard"
   * D-01: không điều hướng sang Commission khi Draft còn thay đổi chưa lưu. */
  const goToCommission = useCallback(() => {
    if (draftDirty) return
    navigate(`/eng/programming/projects/${projectId}/commission`)
  }, [draftDirty, navigate, projectId])

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
                if (candidate === 'execution') query.set('tab', 'execution')
                const target = candidate === 'mapping' ? 'mapping' : 'programs'
                const suffix = query.toString()
                navigate(
                  `/eng/programming/projects/${projectId}/${target}${suffix ? `?${suffix}` : ''}`,
                  { replace: true }
                )
              }}
            >
              {pick(...TAB_LABEL[candidate])}
            </button>
          ))}
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
        <div className="mb-3 rounded border border-[var(--c-border)] p-3">
          <PouTree
            draft={workspace.project.draft}
            selectedObjectId={selectedProgramId}
            onSelect={setSelectedProgramId}
          />
        </div>
        <ProgramsTab
          document={document}
          saving={workspace.saving}
          selectedProgramId={selectedProgramId}
          onSelectProgram={setSelectedProgramId}
          onSave={workspace.save}
          diagnostics={EMPTY_DIAGNOSTICS}
          focusDiagnostic={focusDiagnostic}
          onPendingOperationsChange={updateProgramOperations}
          discardVersion={discardVersion}
          onRunCheck={goToCommission}
          runtimeOverlayByProgramId={runtimeOverlays}
          userPouInterfaces={userPouInterfaces}
        />
      </div>
      <div hidden={tab !== 'mapping'}>
        <MappingTab
          draft={workspace.project.draft}
          document={document}
          saving={workspace.saving}
          onSave={workspace.save}
        />
      </div>
      <div hidden={tab !== 'execution'}>
        <ExecutionTab document={document} saving={workspace.saving} onSave={workspace.save} onPendingOperationsChange={updateExecutionOperations} discardVersion={discardVersion} />
      </div>

      <Modal
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
      </Modal>
    </div>
  )
}
