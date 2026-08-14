import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ClipboardCheck } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { StateBlock } from '../../../shared/components/StateBlock'
import { Button } from '../../../shared/components/Button'
import { useDraftWorkspace, useCheckWorkflow } from './useDraftWorkspace'
import { ProgramsTab } from './editor/ProgramsTab'
import { MappingTab } from './mapping/MappingTab'
import { ExecutionTab } from './task/ExecutionTab'
import { ProblemsDrawer } from '../shared/ProblemsDrawer'
import { Modal } from '../../../shared/components/Modal'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import type { ProgrammingDiagnostic, ProgrammingDraftOperation } from '../model/types'

const VALID_TABS = ['programs', 'mapping', 'execution'] as const
type DesignTab = (typeof VALID_TABS)[number]

const TAB_LABEL: Record<DesignTab, [string, string]> = {
  programs: ['Chương trình', 'Programs'],
  mapping: ['Điểm & Ánh xạ', 'Points & Mapping'],
  execution: ['Thực thi', 'Execution']
}

/**
 * PGM-02 Thiết kế — `UJ-PROG-02/03/04` (TASK-PROG-501..503). Một workspace,
 * ba tab, một context Draft/ETag và một `ProblemsDrawer` dùng chung
 * (DDD-FE-PROG-001 §0.1). Tab là trạng thái URL, đọc/ghi bằng `replace`
 * trong `useEffect` (không setState lúc render).
 */
export function DesignWorkspacePage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { setEditingContext } = useProgrammingRuntimeContext()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'
  const [selectedProgramId, setSelectedProgramId] = useState<string>()
  const [focusDiagnostic, setFocusDiagnostic] = useState<ProgrammingDiagnostic | null>(null)
  const [programOperations, setProgramOperations] = useState<ProgrammingDraftOperation[]>([])
  const [executionOperations, setExecutionOperations] = useState<ProgrammingDraftOperation[]>([])
  const [discardVersion, setDiscardVersion] = useState(0)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)

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
  const checkWorkflow = useCheckWorkflow(projectId)
  const pendingOperations = useMemo(() => [...programOperations, ...executionOperations], [executionOperations, programOperations])
  const draftDirty = pendingOperations.length > 0

  const updateProgramOperations = useCallback((operations: ProgrammingDraftOperation[]) => setProgramOperations(operations), [])
  const updateExecutionOperations = useCallback((operations: ProgrammingDraftOperation[]) => setExecutionOperations(operations), [])

  useEffect(() => {
    if (workspace.status !== 'ready' || !workspace.project) return
    const phase = checkWorkflow.state.phase
    const checkState = phase === 'sealing' || phase === 'checking'
      ? 'checking'
      : phase === 'done'
        ? checkWorkflow.state.check.state === 'PASSED' ? 'passed' : 'failed'
        : phase === 'error' ? 'unknown' : 'idle'
    setEditingContext({
      projectId: workspace.project.projectId,
      projectName: workspace.project.name,
      draftRevisionId: workspace.project.draftRevisionId,
      dirty: draftDirty,
      checkState
    })
    return () => setEditingContext(null)
  }, [checkWorkflow.state, draftDirty, setEditingContext, workspace.project, workspace.status])

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

  const diagnostics: ProgrammingDiagnostic[] = checkWorkflow.state.phase === 'done' ? checkWorkflow.state.check.diagnostics : []
  const tabErrorCount = useMemo(() => {
    const counts: Record<DesignTab, number> = { programs: 0, mapping: 0, execution: 0 }
    for (const diagnostic of diagnostics) {
      if (diagnostic.location?.bindingId) counts.mapping += 1
      else if (diagnostic.location?.programId) counts.programs += 1
      else counts.execution += 1
    }
    return counts
  }, [diagnostics])

  if (workspace.status === 'loading') {
    return <StateBlock state="loading" title={pick('Đang tải Draft…', 'Loading draft…')} />
  }
  if (workspace.status === 'error' || !workspace.project?.draft) {
    return <StateBlock state="error" title={pick('Không tải được Project.', 'Could not load the project.')} detail={workspace.error ?? undefined} onRetry={workspace.reload} />
  }
  const document = workspace.project.draft

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-2">
        <div role="tablist" aria-label={pick('Tab workspace Thiết kế', 'Design workspace tabs')} className="flex gap-1">
          {VALID_TABS.map((candidate) => {
            const errors = tabErrorCount[candidate]
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === tab}
                className={`rounded-t-[var(--radius)] border-b-2 px-3 py-1.5 text-sm font-medium ${
                  candidate === tab ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
                }`}
                onClick={() =>
                  setSearchParams(
                    (current) => {
                      const next = new URLSearchParams(current)
                      next.set('tab', candidate)
                      return next
                    },
                    { replace: true }
                  )
                }
              >
                {pick(...TAB_LABEL[candidate])}
                {errors > 0 && <span className="ml-1.5 rounded-full bg-[var(--c-fault-bg)] px-1.5 text-[10px] font-bold text-[var(--c-on-fault)]">{errors}</span>}
              </button>
            )
          })}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
              loading={checkWorkflow.state.phase === 'sealing' || checkWorkflow.state.phase === 'checking'}
              disabled={draftDirty}
              onClick={() => workspace.project && void checkWorkflow.runCheck(workspace.project)}
            >
              {pick('Kiểm tra', 'Check')}
            </Button>
            {checkWorkflow.state.phase === 'done' && checkWorkflow.state.check.state === 'PASSED' && (() => {
              const passedCheck = checkWorkflow.state.check
              return (
                <Button
                  size="sm"
                  icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  onClick={() =>
                    navigate(`/eng/programming/projects/${projectId}/commission?revisionId=${encodeURIComponent(passedCheck.revisionId)}&checkId=${encodeURIComponent(passedCheck.checkId)}`, {
                      state: { revisionId: passedCheck.revisionId, checkId: passedCheck.checkId }
                    })
                  }
                >
                  {pick('Mở Kiểm tra & Đưa vào vận hành', 'Open Check & Commission')}
                </Button>
              )
            })()}
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
      {checkWorkflow.state.phase === 'error' && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
          {checkWorkflow.state.message}
        </div>
      )}
      {draftDirty && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
          {pick('Draft có thay đổi chưa lưu. Hãy lưu trước khi Kiểm tra.', 'The draft has unsaved changes. Save before running Check.')}
        </div>
      )}
      {checkWorkflow.state.phase === 'done' && (
        <div
          role="status"
          className={`rounded-[var(--radius)] border p-3 text-sm ${
            checkWorkflow.state.check.state === 'PASSED'
              ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]'
              : 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
          }`}
        >
          {checkWorkflow.state.check.state === 'PASSED'
            ? pick('Kiểm tra đạt. Bản đang chạy không đổi.', 'Check passed. The running version is unchanged.')
            : pick(`Kiểm tra không đạt (${checkWorkflow.state.check.state}). Bản đang chạy không đổi.`, `Check did not pass (${checkWorkflow.state.check.state}). The running version is unchanged.`)}
        </div>
      )}

      {/* Cả ba tab luôn MOUNTED, chỉ ẩn bằng CSS (không unmount/remount theo
          `tab`). Bắt buộc: unmount xoá state cục bộ của `SourceEditor`/
          `FbdEditorPane` (buffer đang gõ, chưa lưu), nên đổi tab rồi quay lại
          sẽ "mất nội dung đang gõ" — đúng hành vi bị cấm ở
          DDD-FE-PROG-001 §0.1 ràng buộc 1. Phát hiện qua Playwright E2E
          (TASK-PROG-506), sửa ngay trong cùng phiên. */}
      <div hidden={tab !== 'programs'}>
        <ProgramsTab
          document={document}
          saving={workspace.saving}
          selectedProgramId={selectedProgramId}
          onSelectProgram={setSelectedProgramId}
          onSave={workspace.save}
          diagnostics={diagnostics}
          focusDiagnostic={focusDiagnostic}
          onPendingOperationsChange={updateProgramOperations}
          discardVersion={discardVersion}
        />
      </div>
      <div hidden={tab !== 'mapping'}>
        <MappingTab document={document} saving={workspace.saving} onSave={workspace.save} />
      </div>
      <div hidden={tab !== 'execution'}>
        <ExecutionTab document={document} saving={workspace.saving} onSave={workspace.save} onPendingOperationsChange={updateExecutionOperations} discardVersion={discardVersion} />
      </div>

      {diagnostics.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Vấn đề', 'Problems')}</h3>
          <ProblemsDrawer
            diagnostics={diagnostics}
            onSelect={(diagnostic) => {
              if (diagnostic.location?.bindingId) {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current)
                  next.set('tab', 'mapping')
                  return next
                })
              } else if (typeof diagnostic.location?.programId === 'string') {
                setFocusDiagnostic(diagnostic)
                setSelectedProgramId(diagnostic.location.programId)
                setSearchParams((current) => {
                  const next = new URLSearchParams(current)
                  next.set('tab', 'programs')
                  return next
                })
              }
            }}
          />
        </div>
      )}

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
