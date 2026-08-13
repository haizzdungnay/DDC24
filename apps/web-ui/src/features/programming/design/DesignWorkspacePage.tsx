import { useEffect, useMemo, useState } from 'react'
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
import type { ProgrammingDiagnostic } from '../model/types'

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
  const canEdit = roleAtLeast(session?.role, 'admin')
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'
  const [selectedProgramId, setSelectedProgramId] = useState<string>()

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
                    navigate(`/eng/programming/projects/${projectId}/commission`, {
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
        <ProgramsTab document={document} saving={workspace.saving} selectedProgramId={selectedProgramId} onSelectProgram={setSelectedProgramId} onSave={workspace.save} />
      </div>
      <div hidden={tab !== 'mapping'}>
        <MappingTab document={document} saving={workspace.saving} onSave={workspace.save} />
      </div>
      <div hidden={tab !== 'execution'}>
        <ExecutionTab document={document} saving={workspace.saving} onSave={workspace.save} />
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
    </div>
  )
}
