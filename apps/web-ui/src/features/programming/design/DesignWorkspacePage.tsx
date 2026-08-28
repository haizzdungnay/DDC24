import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import { ProblemsDrawer } from '../shared/ProblemsDrawer'

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
export function DesignWorkspacePage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { capabilities, runtime, activeRevision, setEditingContext } = useProgrammingRuntimeContext()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'
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
  const tabRefs = useRef<Partial<Record<DesignTab, HTMLButtonElement | null>>>({})

  const selectTab = useCallback((nextTab: DesignTab, focus = false) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('tab', nextTab)
        return next
      },
      { replace: true }
    )
    if (focus) globalThis.requestAnimationFrame(() => tabRefs.current[nextTab]?.focus())
  }, [setSearchParams])

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: DesignTab) {
    const currentIndex = VALID_TABS.indexOf(currentTab)
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % VALID_TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + VALID_TABS.length) % VALID_TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = VALID_TABS.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    selectTab(VALID_TABS[nextIndex], true)
  }

  useEffect(() => {
    if (requested === tab) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('tab', tab)
        return next
      },
      { replace: true }
    )
  }, [requested, tab, setSearchParams])

  const workspace = useDraftWorkspace(projectId)
  /* A real project should open on its first program, not on a blank editor.
   * Keep an explicit/deep-linked selection when it still exists; if a draft
   * removed that program, fail soft to the first remaining item. */
  useEffect(() => {
    const programs = workspace.project?.draft?.programs ?? []
    if (workspace.status !== 'ready' || programs.length === 0) {
      if (programs.length === 0 && selectedProgramId) setSelectedProgramId(undefined)
      return
    }
    if (!selectedProgramId || !programs.some((program) => program.programId === selectedProgramId)) {
      setSelectedProgramId(programs[0].programId)
    }
  }, [selectedProgramId, workspace.project?.draft?.programs, workspace.status])
  const pendingOperations = useMemo(() => [...programOperations, ...executionOperations], [executionOperations, programOperations])
  const draftDirty = pendingOperations.length > 0

  const updateProgramOperations = useCallback((operations: ProgrammingDraftOperation[]) => setProgramOperations(operations), [])
  const updateExecutionOperations = useCallback((operations: ProgrammingDraftOperation[]) => setExecutionOperations(operations), [])

  const openProgramFromMapping = useCallback((programId: string) => {
    setSelectedProgramId(programId)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', 'programs')
      next.set('program', programId)
      return next
    }, { replace: true })
    globalThis.requestAnimationFrame(() => tabRefs.current.programs?.focus())
  }, [setSearchParams])

  /* Dùng chung cho nút "Kiểm tra" ở đây VÀ mục lệnh "Kiểm tra" của Bảng lệnh
   * nhanh (ST Editor Quick Control #2, đã duyệt) — cùng một "dirty guard"
   * D-01: không điều hướng sang Commission khi Draft còn thay đổi chưa lưu. */
  const goToCommission = useCallback(() => {
    if (draftDirty) return
    navigate(`/eng/programming/projects/${projectId}/commission`)
  }, [draftDirty, navigate, projectId])

  /* Project detail có latestCheck canonical. Chỉ dùng khi Check thuộc đúng
   * baseRevision hiện hành; kết quả của revision cũ không được gắn sang Draft. */
  useEffect(() => {
    if (workspace.status !== 'ready' || !workspace.project) return
    setEditingContext({
      projectId: workspace.project.projectId,
      projectName: workspace.project.name,
      draftRevisionId: workspace.project.draftRevisionId,
      dirty: draftDirty,
      checkState: projectCheckState(workspace.project)
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
  const document = workspace.project.draft
  const checkState = projectCheckState(workspace.project)
  const compactCheck = compactCheckStatus(pick, checkState)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-2">
        <div role="tablist" aria-label={pick('Tab workspace Thiết kế', 'Design workspace tabs')} className="flex gap-1">
          {VALID_TABS.map((candidate) => (
            <button
              key={candidate}
              id={`programming-design-tab-${candidate}`}
              ref={(element) => { tabRefs.current[candidate] = element }}
              type="button"
              role="tab"
              aria-selected={candidate === tab}
              aria-controls={`programming-design-panel-${candidate}`}
              tabIndex={candidate === tab ? 0 : -1}
              className={`rounded-t-[var(--radius)] border-b-2 px-3 py-1.5 text-sm font-medium ${
                candidate === tab ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
              onClick={() => selectTab(candidate)}
              onKeyDown={(event) => handleTabKeyDown(event, candidate)}
            >
              {pick(...TAB_LABEL[candidate])}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase min-[1024px]:hidden ${compactCheck.className}`}
              aria-label={pick(`Trạng thái Check: ${compactCheck.label}`, `Check status: ${compactCheck.label}`)}
            >
              {pick('Check', 'Check')} · {compactCheck.label}
            </span>
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
      <div id="programming-design-panel-programs" role="tabpanel" aria-labelledby="programming-design-tab-programs" hidden={tab !== 'programs'}>
        <ProgramsTab
          document={document}
          saving={workspace.saving}
          selectedProgramId={selectedProgramId}
          onSelectProgram={setSelectedProgramId}
          onSave={workspace.save}
          diagnostics={EMPTY_DIAGNOSTICS}
          runtime={runtime}
          activeRevision={activeRevision}
          focusDiagnostic={focusDiagnostic}
          onPendingOperationsChange={updateProgramOperations}
          discardVersion={discardVersion}
          onRunCheck={goToCommission}
        />
      </div>
      <div id="programming-design-panel-mapping" role="tabpanel" aria-labelledby="programming-design-tab-mapping" hidden={tab !== 'mapping'}>
        <MappingTab
          document={document}
          saving={workspace.saving}
          onSave={workspace.save}
          projectId={projectId}
          saveError={workspace.error}
          active={tab === 'mapping'}
          onOpenSource={openProgramFromMapping}
        />
      </div>
      <div id="programming-design-panel-execution" role="tabpanel" aria-labelledby="programming-design-tab-execution" hidden={tab !== 'execution'}>
        <ExecutionTab document={document} saving={workspace.saving} onSave={workspace.save} onPendingOperationsChange={updateExecutionOperations} discardVersion={discardVersion} capabilities={capabilities} />
      </div>

      <ProblemsDrawer
        diagnostics={EMPTY_DIAGNOSTICS}
        emptyState={
          checkState === 'passed' ? 'no-problems'
          : checkState === 'failed' ? 'check-failed'
          : checkState === 'checking' ? 'checking'
          : checkState === 'unknown' ? 'unknown'
          : 'not-checked'
        }
        onEmptyAction={draftDirty ? undefined : goToCommission}
      />

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

function projectCheckState(project: { baseRevisionId: string; latestCheck?: { revisionId: string; state: string } | null }): 'idle' | 'checking' | 'passed' | 'failed' | 'unknown' {
  const check = project.latestCheck
  if (!check || check.revisionId !== project.baseRevisionId) return 'idle'
  if (check.state === 'QUEUED' || check.state === 'RUNNING') return 'checking'
  if (check.state === 'PASSED') return 'passed'
  if (check.state === 'FAILED' || check.state === 'TIMED_OUT') return 'failed'
  return 'unknown'
}

function compactCheckStatus(
  pick: (vi: string, en: string) => string,
  state: ReturnType<typeof projectCheckState>,
): { label: string; className: string } {
  if (state === 'passed') return { label: pick('Đạt', 'Passed'), className: 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' }
  if (state === 'failed') return { label: pick('Không đạt', 'Failed'), className: 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]' }
  if (state === 'checking') return { label: pick('Đang kiểm tra', 'Checking'), className: 'border-[var(--c-info)] bg-[var(--c-accent-bg)] text-[var(--c-info)]' }
  if (state === 'unknown') return { label: 'UNKNOWN', className: 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]' }
  return { label: pick('Chưa kiểm tra', 'Not checked'), className: 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]' }
}
