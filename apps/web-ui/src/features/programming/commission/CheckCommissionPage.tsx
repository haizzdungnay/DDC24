import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, GitCompareArrows, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingCheck, useProgrammingOverrides, useProgrammingRevisionChanges } from '../api/queries'
import { useDraftWorkspace, useCheckWorkflow } from '../design/useDraftWorkspace'
import { useCommissionWorkflow } from './useCommissionWorkflow'
import type { ProgrammingImpactGroup, ProgrammingImpactKey } from '../api/generated/client'
import type { ProgrammingOverrideEntry } from '../model/types'
import { ProblemsDrawer } from '../shared/ProblemsDrawer'

const IMPACT_GROUP_ORDER: ProgrammingImpactKey[] = ['retain', 'activeOverrides', 'cutover', 'outputMappingChanges']
const IMPACT_GROUP_LABEL: Record<ProgrammingImpactKey, [string, string]> = {
  retain: ['Trạng thái lưu (RETAIN) sẽ khởi tạo lại', 'RETAIN state will be re-initialised'],
  activeOverrides: ['Override thủ công đang giữ đầu ra', 'Manual overrides currently holding outputs'],
  cutover: ['Chuyển quyền điều khiển graph → program', 'Cutover from graph to program control'],
  outputMappingChanges: ['Thay đổi ánh xạ Điểm ảnh hưởng đầu ra vật lý', 'Point mapping changes affecting physical outputs']
}

function CommissionHeader({
  pick,
  coreReady,
}: {
  pick: (vi: string, en: string) => string
  coreReady: boolean
}) {
  return (
    <header className="rounded-[var(--radius)] border border-[var(--c-border)] border-l-4 border-l-[var(--c-accent)] bg-[var(--c-surface)] px-5 py-4 shadow-sm sm:px-6">
      <p className="text-[10px] font-bold tracking-[0.16em] text-[var(--c-accent)]">PROGRAMMING / PGM-03</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--c-text)]">{pick('Kiểm tra & Đưa vào vận hành', 'Check & Commission')}</h2>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Niêm phong Draft, kiểm tra chẩn đoán rồi xác nhận thay đổi runtime.', 'Seal the Draft, inspect diagnostics, then confirm the runtime change.')}</p>
        </div>
        <StatusBadge state={coreReady ? 'connected' : 'unknown'} label={coreReady ? pick('Core đã xác minh', 'Core verified') : pick('Core chưa xác minh', 'Core unverified')} />
      </div>
    </header>
  )
}

function RevisionTransferStrip({
  pick,
  candidateRevisionId,
  activeRevisionId,
  coreReady,
  commissionReady,
}: {
  pick: (vi: string, en: string) => string
  candidateRevisionId: string
  activeRevisionId: string | null
  coreReady: boolean
  commissionReady: boolean
}) {
  return (
    <section
      aria-label={pick('Đích đưa vào vận hành', 'Commission target')}
      className="grid gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center"
    >
      <div className="rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--c-accent)]">{pick('Bản ứng viên đã niêm phong', 'Sealed candidate')}</p>
        <p className="mt-1 break-all font-mono text-xs font-semibold text-[var(--c-text)]">{candidateRevisionId}</p>
      </div>
      <ArrowRight className="mx-auto hidden h-5 w-5 text-[var(--c-text-dim)] md:block" aria-hidden="true" />
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--c-text-dim)]">Active Revision</p>
        <p className="mt-1 break-all font-mono text-xs font-semibold text-[var(--c-text)]">{activeRevisionId ?? pick('Chưa có bản Active', 'No active revision')}</p>
      </div>
      <div className="flex flex-wrap gap-2 md:max-w-48 md:justify-end">
        <StatusBadge state={coreReady ? 'connected' : 'unknown'} label={coreReady ? pick('Core sẵn sàng', 'Core ready') : pick('Core bị chặn', 'Core blocked')} />
        <StatusBadge state={commissionReady ? 'online' : 'warning'} label={commissionReady ? pick('Có thể vận hành', 'Ready to commission') : pick('Chưa đủ điều kiện', 'Not ready')} />
      </div>
    </section>
  )
}

function ReadinessItem({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2">
      <div className="flex items-center gap-2">
        {ready ? <CheckCircle2 className="h-4 w-4 text-[var(--c-good)]" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-[var(--c-warn)]" aria-hidden="true" />}
        <p className="text-xs font-semibold text-[var(--c-text)]">{label}</p>
      </div>
      <p className="mt-1 text-[11px] text-[var(--c-text-dim)]">{detail}</p>
    </div>
  )
}

function ImpactEvidenceCard({
  pick,
  impactKey,
  group,
  overrides,
}: {
  pick: (vi: string, en: string) => string
  impactKey: ProgrammingImpactKey
  group: ProgrammingImpactGroup
  overrides: ProgrammingOverrideEntry[]
}) {
  const present = group.status === 'PRESENT'
  const unavailable = group.status === 'UNAVAILABLE'
  const stateClass = present
    ? 'border-[var(--c-warn)] bg-[var(--c-warn-bg)]'
    : unavailable
      ? 'border-[var(--c-fault)] bg-[var(--c-fault-bg)]'
      : 'border-[var(--c-border)] bg-[var(--c-surface-2)]'

  return (
    <li className={`rounded-[var(--radius)] border p-3 ${stateClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--c-text)]">{pick(...IMPACT_GROUP_LABEL[impactKey])}</p>
          <p className="mt-1 text-[11px] text-[var(--c-text-dim)]">
            {present
              ? pick(`${group.items.length} bằng chứng do máy chủ trả về`, `${group.items.length} server-provided evidence item(s)`)
              : unavailable
                ? pick('Không đọc được bằng chứng; lệnh bị khóa.', 'Evidence is unavailable; the command is locked.')
                : pick('Không có ảnh hưởng trong nhóm này.', 'No impact in this group.')}
          </p>
        </div>
        <StatusBadge
          state={present ? 'warning' : unavailable ? 'fault' : 'online'}
          label={present ? pick('Cần xác nhận', 'Acknowledge') : unavailable ? pick('Chưa xác định', 'Unknown') : pick('Không có', 'None')}
        />
      </div>
      {present && group.items.length > 0 && (
        <>
        <div className="mt-3 hidden overflow-x-auto border-t border-[var(--c-border)] pt-2 md:block" tabIndex={0} role="region" aria-label={pick('Bằng chứng ảnh hưởng dạng bảng', 'Impact evidence table')}>
          <table className="w-full min-w-[34rem] text-left text-[11px]">
            <thead className="text-[var(--c-text-dim)]"><tr><th className="py-1 pr-2">{pick('Bằng chứng', 'Evidence')}</th><th className="py-1 pr-2">{pick('Hiện tại', 'Current')}</th><th className="py-1 pr-2">{pick('Đề xuất', 'Proposed')}</th><th className="py-1 pr-2">{pick('Bên giữ', 'Owner')}</th><th className="py-1">{pick('Ưu tiên', 'Priority')}</th></tr></thead>
            <tbody>{group.items.map((item) => {
              const override = overrides.find((entry) => entry.pointId === item)
              return <tr key={item} className="border-t border-[var(--c-border)]"><td className="break-all py-1 pr-2 font-mono">{item}</td><td className="py-1 pr-2">{override ? String(override.value) : '—'}</td><td className="py-1 pr-2">—</td><td className="py-1 pr-2">{override ? (override.actorId || pick('Override thủ công', 'Manual override')) : pick('Chưa xác minh', 'Unknown')}</td><td className="py-1">{override?.effectivePriority ?? '—'}</td></tr>
            })}</tbody>
          </table>
        </div>
        <div className="mt-3 space-y-2 border-t border-[var(--c-border)] pt-2 md:hidden">
          {group.items.map((item) => {
            const override = overrides.find((entry) => entry.pointId === item)
            return <dl key={item} className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2 text-[11px]"><div className="col-span-2 min-w-0"><dt className="text-[var(--c-text-dim)]">{pick('Bằng chứng', 'Evidence')}</dt><dd className="break-all font-mono">{item}</dd></div><div><dt className="text-[var(--c-text-dim)]">{pick('Hiện tại', 'Current')}</dt><dd>{override ? String(override.value) : '—'}</dd></div><div><dt className="text-[var(--c-text-dim)]">{pick('Đề xuất', 'Proposed')}</dt><dd>—</dd></div><div><dt className="text-[var(--c-text-dim)]">{pick('Bên giữ', 'Owner')}</dt><dd className="break-words">{override ? (override.actorId || pick('Override thủ công', 'Manual override')) : pick('Chưa xác minh', 'Unknown')}</dd></div><div><dt className="text-[var(--c-text-dim)]">{pick('Ưu tiên', 'Priority')}</dt><dd>{override?.effectivePriority ?? '—'}</dd></div></dl>
          })}
        </div>
        </>
      )}
    </li>
  )
}

function formatObservedTime(value: string | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(parsed)
}

function CommissionSteps({
  pick,
  checkReady,
  commissionReady,
}: {
  pick: (vi: string, en: string) => string
  checkReady: boolean
  commissionReady: boolean
}) {
  const steps = [
    [pick('1. Draft đã lưu', '1. Draft saved'), true],
    [pick('2. Niêm phong & Kiểm tra', '2. Seal & Check'), checkReady],
    [pick('3. Xem chẩn đoán', '3. Review diagnostics'), checkReady],
    [pick('4. Đưa vào vận hành', '4. Commission'), commissionReady],
  ] as const
  return (
    <ol aria-label={pick('Chuỗi công việc Đưa vào vận hành', 'Commission workflow')} className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-2 xl:grid-cols-4">
      {steps.map(([label, complete]) => (
        <li key={label} className={`bg-[var(--c-surface)] px-3 py-2 text-xs font-semibold ${complete ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-text-dim)]'}`}>
          <span aria-hidden="true">{complete ? '✓' : '○'}</span> {label}
        </li>
      ))}
    </ol>
  )
}

interface NavState {
  revisionId?: string
  checkId?: string
}

/**
 * PGM-03 Kiểm tra & Đưa vào vận hành — `UJ-PROG-05/06` (TASK-PROG-504). Trang
 * nhận `revisionId/checkId` từ query canonical và dùng `location.state` làm
 * tương thích điều hướng trong phiên. Deep-link/reload không suy đoán Check
 * "mới nhất": chỉ đọc đúng hai định danh bất biến đã có trong URL.
 */
export function CheckCommissionPage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const locationState = (location.state as NavState | null) ?? null
  const navState: NavState = {
    revisionId: searchParams.get('revisionId') ?? locationState?.revisionId,
    checkId: searchParams.get('checkId') ?? locationState?.checkId
  }
  const { capabilities, runtime, setEditingContext } = useProgrammingRuntimeContext()
  // Giữ Active làm baseline của pre-flight; sau Commission runtime sẽ đổi sang
  // Candidate nhưng màn hình vẫn phải giữ được bằng chứng so sánh ban đầu.
  const [comparisonFromRevisionId, setComparisonFromRevisionId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (comparisonFromRevisionId !== undefined || !runtime.data) return
    setComparisonFromRevisionId(runtime.data.activeRevisionId === navState.revisionId ? null : runtime.data.activeRevisionId)
  }, [comparisonFromRevisionId, navState.revisionId, runtime.data])

  /* D-01: PGM-03 sở hữu toàn bộ seal/run/poll Check — trước bản vá này chỉ
   * PGM-02 gọi được `useCheckWorkflow`, nên mở PGM-03 trực tiếp (không đến từ
   * nút "Mở Kiểm tra & Đưa vào vận hành" của PGM-02) không có cách nào bắt
   * đầu Check, đúng gap ghi ở As-Built §3/`F-PROG-ASBUILT-004`. */
  const workspace = useDraftWorkspace(projectId)
  const checkWorkflow = useCheckWorkflow(projectId)
  const check = useProgrammingCheck(navState?.checkId)
  const changes = useProgrammingRevisionChanges(comparisonFromRevisionId ?? 'none', navState?.revisionId)
  const overrides = useProgrammingOverrides()
  const commission = useCommissionWorkflow(capabilities.data?.taskPeriodsMs)

  useEffect(() => {
    if (checkWorkflow.state.phase !== 'done' || !projectId) return
    const { revisionId, checkId } = checkWorkflow.state.check
    if (navState.revisionId === revisionId && navState.checkId === checkId) return
    navigate(`/eng/programming/projects/${projectId}/commission?revisionId=${encodeURIComponent(revisionId)}&checkId=${encodeURIComponent(checkId)}`, { replace: true })
  }, [checkWorkflow.state, projectId, navState.revisionId, navState.checkId, navigate])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState<Set<ProgrammingImpactKey>>(new Set())
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!dialogOpen) return
    if (commission.state.phase !== 'terminal' && commission.state.phase !== 'unknown' && commission.state.phase !== 'error') return
    // Operation result belongs on the decision rail, not hidden behind the
    // still-open confirmation layer. The password is never retained.
    setDialogOpen(false)
    setPassword('')
  }, [commission.state.phase, dialogOpen])

  const impact = changes.data?.impact
  const presentKeys = useMemo(() => IMPACT_GROUP_ORDER.filter((key) => impact?.[key].status === 'PRESENT'), [impact])
  const hasUnavailable = useMemo(() => IMPACT_GROUP_ORDER.some((key) => !impact || impact[key].status !== 'NONE' && impact[key].status !== 'PRESENT'), [impact])
  const checkPassed = check.data?.state === 'PASSED'
  /* `safeState=true` một mình không chặn Commission: nếu lý do DUY NHẤT là
   * `safeStateNoControllerOnly` (Core trigger T7 — chưa Program nào đang
   * điều khiển output), Commission đúng là hành động giải quyết nó, không
   * phải một fault cần khắc phục trước. Vẫn chặn khi safeState=true mà
   * `safeStateNoControllerOnly=false` (lỗi I/O/stale/overrun thật — xem
   * apps/core/domain/safety/safe_state.hpp §5.2). */
  const coreReady =
    runtime.status === 'ready' &&
    runtime.data?.producerState === 'READY' &&
    (runtime.data.safeState === false || runtime.data.safeStateNoControllerOnly === true)
  const terminalOperation = commission.state.phase === 'terminal' ? commission.state.operation : null
  const readBackVerified = terminalOperation?.state === 'SUCCEEDED' && terminalOperation.actualActiveRevisionId === navState.revisionId
  const displayedActiveRevisionId = readBackVerified ? terminalOperation.actualActiveRevisionId : runtime.data?.activeRevisionId
  const candidateAlreadyActive = displayedActiveRevisionId === navState.revisionId
  const readyToCommission = checkPassed && changes.status === 'ready' && overrides.status === 'ready' && !hasUnavailable && coreReady && !candidateAlreadyActive && !!projectId

  useEffect(() => {
    if (!terminalOperation) return
    runtime.refresh()
  }, [runtime.refresh, terminalOperation?.operationId, terminalOperation?.updatedAt])

  useEffect(() => {
    if (!projectId) return
    const workflowPhase = checkWorkflow.state.phase
    // D-01: khi Check được chạy ngay tại trang này, `checkWorkflow.state` là
    // nguồn đúng hơn `check` (hook deep-link theo `navState.checkId`, chưa có
    // giá trị cho tới khi effect điều hướng-replace ở trên chạy xong).
    const checkState =
      workflowPhase === 'sealing' || workflowPhase === 'checking'
        ? 'checking'
        : workflowPhase === 'done'
          ? (checkWorkflow.state.check.state === 'PASSED' ? 'passed' : 'failed')
          : workflowPhase === 'error'
            ? 'unknown'
            : !navState.revisionId || !navState.checkId
              ? 'idle'
              : check.status !== 'ready' || !check.data
                ? 'checking'
                : check.data.state === 'PASSED'
                  ? 'passed'
                  : check.data.state === 'FAILED' || check.data.state === 'TIMED_OUT' ? 'failed' : 'checking'
    setEditingContext({ projectId, projectName: '', draftRevisionId: '', dirty: false, checkState })
    return () => setEditingContext(null)
  }, [checkWorkflow.state, check.data, check.status, projectId, setEditingContext])

  if (!navState?.revisionId || !navState?.checkId) {
    const phase = checkWorkflow.state.phase
    const running = phase === 'sealing' || phase === 'checking'
    return (
      <div className="space-y-3">
        <CommissionHeader pick={pick} coreReady={coreReady} />
        <CommissionSteps pick={pick} checkReady={false} commissionReady={false} />
        {phase === 'error' ? (
          <StateBlock state="error" title={checkWorkflow.state.message} onRetry={checkWorkflow.reset} />
        ) : (
          <StateBlock
            state={running ? 'loading' : 'empty'}
            title={
              phase === 'sealing'
                ? pick('Đang niêm phong Draft…', 'Sealing the draft…')
                : phase === 'checking'
                  ? pick('Đang kiểm tra…', 'Checking…')
                  : pick('Chưa có Kiểm tra nào.', 'No check yet.')
            }
            detail={
              running
                ? undefined
                : pick(
                    'Bấm "Kiểm tra" để niêm phong Draft hiện tại thành Revision và biên dịch. Draft phải đã lưu ở workspace Thiết kế trước đó.',
                    'Press "Check" to seal the current draft into a revision and compile it. The draft must already be saved in the Design workspace.'
                  )
            }
          />
        )}
        {canEdit && !running && phase !== 'error' && (
          <Button
            icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
            disabled={workspace.status !== 'ready' || !workspace.project}
            onClick={() => workspace.project && void checkWorkflow.runCheck(workspace.project, workspace.syncAfterSeal)}
          >
            {pick('Kiểm tra', 'Check')}
          </Button>
        )}
        {projectId && (
          <div>
            <Link className="text-sm font-medium text-[var(--c-accent)] underline" to={`/eng/programming/projects/${projectId}/design`}>
              {pick('Về workspace Thiết kế', 'Back to the Design workspace')}
            </Link>
          </div>
        )}
      </div>
    )
  }

  function openConfirmDialog() {
    check.refresh()
    changes.refresh()
    overrides.refresh()
    setAcknowledged(new Set())
    setPassword('')
    setDialogOpen(true)
  }

  function submitCommission() {
    if (!readyToCommission || !impact || !navState.revisionId || !navState.checkId) return
    void commission.submit(
      {
        revisionId: navState.revisionId,
        expectedActiveRevisionId: runtime.data?.activeRevisionId ?? null,
        checkId: navState.checkId,
        impactRef: impact.impactRef,
        acknowledgements: presentKeys
      },
      password
    )
  }

  const submitting = commission.state.phase === 'submitting' || commission.state.phase === 'polling'

  return (
    <div className="space-y-4">
      <CommissionHeader pick={pick} coreReady={coreReady} />
      <CommissionSteps pick={pick} checkReady={checkPassed} commissionReady={readyToCommission} />
      <RevisionTransferStrip
        pick={pick}
        candidateRevisionId={navState.revisionId}
        activeRevisionId={displayedActiveRevisionId ?? null}
        coreReady={coreReady}
        commissionReady={readyToCommission}
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.72fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={pick('Kết quả Kiểm tra', 'Check result')}>
        {check.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : check.status === 'error' || !check.data ? (
          <StateBlock state="error" title={pick('Không tải được Kiểm tra.', 'Could not load the check.')} onRetry={check.refresh} />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <StatusBadge state={check.data.state === 'PASSED' ? 'online' : 'fault'} label={check.data.state} />
              <span className="text-sm text-[var(--c-text-dim)]">Revision {navState.revisionId.slice(0, 8)}</span>
            </div>
            {check.data.diagnostics.length > 0 && (
              <ProblemsDrawer
                diagnostics={check.data.diagnostics}
                onSelect={(diagnostic) => {
                  // BUG-007 — lỗi Check trước đây không dẫn đi đâu cả. D-01: PGM-03 sở
                  // hữu Check/result nhưng editor vẫn ở PGM-02 — điều hướng sang đúng
                  // Program kèm line/column/length qua query string (F-PROG-ASBUILT-003)
                  // để `SourceEditor` chọn đúng vùng nguồn ngay khi PGM-02 mount, không
                  // chỉ chọn đúng Program rồi bắt người dùng tự tìm dòng lỗi.
                  if (!projectId || typeof diagnostic.location?.programId !== 'string') return
                  const params = new URLSearchParams({ tab: 'programs', program: diagnostic.location.programId })
                  if (typeof diagnostic.location.line === 'number') params.set('line', String(diagnostic.location.line))
                  if (typeof diagnostic.location.column === 'number') params.set('column', String(diagnostic.location.column))
                  if (typeof diagnostic.location.length === 'number') params.set('length', String(diagnostic.location.length))
                  navigate(`/eng/programming/projects/${projectId}/design?${params.toString()}`)
                }}
              />
            )}
            {!checkPassed && <p className="text-sm text-[var(--c-warn-fg)]">{pick('Chỉ Kiểm tra PASSED mới mở được Đưa vào vận hành.', 'Only a PASSED check unlocks Commission.')}</p>}
          </div>
        )}
      </Panel>

      <Panel title={pick('Thay đổi so với bản đang chạy', 'Changes vs. the running version')} subtitle={pick('Đọc từ Revision bất biến; không tự suy diễn thay đổi.', 'Read from the immutable Revision; no client-side inference.') }>
        {changes.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : changes.status === 'error' || !changes.data ? (
          <StateBlock state="error" title={pick('Không tải được thay đổi.', 'Could not load changes.')} onRetry={changes.refresh} />
        ) : changes.data.changes.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Không có thay đổi so với bản đang chạy.', 'No changes vs. the running version.')}</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {changes.data.changes.map((change) => (
              <li key={`${change.kind}-${change.objectId}`} className="flex items-center justify-between">
                <span className="font-mono text-xs text-[var(--c-text)]">
                  {change.kind}:{change.objectId.slice(0, 8)}
                </span>
                <span className="text-[var(--c-text-dim)]">{change.changeType}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
          </div>

      <Panel title={pick('Ảnh hưởng khi áp dụng', 'Impact when applied')} subtitle={pick('Mỗi nhóm phải được xác nhận riêng nếu đang có ảnh hưởng.', 'Each present group requires its own acknowledgement.') }>
        {changes.status !== 'ready' || !impact ? (
          <StateBlock state={changes.status === 'error' ? 'error' : 'loading'} title={pick('Đang tính ảnh hưởng…', 'Computing impact…')} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {IMPACT_GROUP_ORDER.map((key) => (
              <ImpactEvidenceCard key={key} pick={pick} impactKey={key} group={impact[key]} overrides={overrides.data?.items ?? []} />
            ))}
          </ul>
        )}
        {hasUnavailable && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--c-fault-fg)]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {pick('Chưa tính được đủ ảnh hưởng — Đưa vào vận hành bị chặn.', 'Impact could not be fully computed — Commission is blocked.')}
          </p>
        )}
      </Panel>

      <Panel title={pick('Override thủ công còn hiệu lực', 'Active manual overrides')}>
        {overrides.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : overrides.status === 'error' || !overrides.data ? (
          <StateBlock state="error" title={pick('Không tải được override.', 'Could not load overrides.')} onRetry={overrides.refresh} />
        ) : overrides.data.items.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Không có override nào đang giữ đầu ra.', 'No override is currently holding an output.')}</p>
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-[var(--c-text-dim)]">
                <th className="py-1 pr-3">Point</th>
                <th className="py-1 pr-3">{pick('Giá trị', 'Value')}</th>
                <th className="py-1 pr-3">{pick('Người thực hiện', 'Actor')}</th>
                <th className="py-1">{pick('Còn lại', 'Remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {overrides.data.items.map((entry) => (
                <tr key={`${entry.category}-${entry.pointId}`}>
                  <td className="py-1 pr-3 font-mono text-xs">{entry.pointId}</td>
                  <td className="py-1 pr-3">{String(entry.value)}</td>
                  <td className="py-1 pr-3">{entry.actorId || '—'}</td>
                  <td className="py-1">{entry.remainingS !== null ? `${entry.remainingS}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="space-y-2 md:hidden">
            {overrides.data.items.map((entry) => (
              <article key={`${entry.category}-${entry.pointId}`} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
                <p className="font-mono text-xs font-semibold text-[var(--c-text)]">{entry.pointId}</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[var(--c-text-dim)]">{pick('Giá trị', 'Value')}</dt><dd>{String(entry.value)}</dd></div>
                  <div><dt className="text-[var(--c-text-dim)]">{pick('Còn lại', 'Remaining')}</dt><dd>{entry.remainingS !== null ? `${entry.remainingS}s` : '—'}</dd></div>
                  <div className="col-span-2"><dt className="text-[var(--c-text-dim)]">{pick('Người thực hiện', 'Actor')}</dt><dd>{entry.actorId || '—'}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          </>
        )}
      </Panel>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-3" aria-label={pick('Cổng quyết định đưa vào vận hành', 'Commission decision gate')}>
          <Panel
            title={pick('Cổng quyết định', 'Decision gate')}
            subtitle={pick('Chỉ mở lệnh khi bốn bằng chứng đều đọc được.', 'The command unlocks only when all four evidence sources are readable.')}
            action={<GitCompareArrows className="h-5 w-5 text-[var(--c-accent)]" aria-hidden="true" />}
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <ReadinessItem
                ready={checkPassed}
                label={pick('Kiểm tra Revision', 'Revision check')}
                detail={check.data ? `${check.data.state} · ${formatObservedTime(check.data.completedAt ?? check.data.createdAt)}` : pick('Chưa đọc được kết quả', 'Result unavailable')}
              />
              <ReadinessItem
                ready={changes.status === 'ready' && !hasUnavailable}
                label={pick('Impact từ máy chủ', 'Server impact')}
                detail={changes.status === 'ready' && impact ? `${presentKeys.length} ${pick('nhóm cần xác nhận', 'group(s) require acknowledgement')}` : pick('Chưa tính đủ impact', 'Impact incomplete')}
              />
              <ReadinessItem
                ready={overrides.status === 'ready'}
                label={pick('Override hiện hành', 'Active overrides')}
                detail={overrides.status === 'ready' && overrides.data ? `${overrides.data.items.length} ${pick('override đang giữ đầu ra', 'override(s) holding outputs')}` : pick('Không xác minh được', 'Could not verify')}
              />
              <ReadinessItem
                ready={coreReady}
                label={pick('Core và safe-state', 'Core and safe state')}
                detail={coreReady ? pick('READY · cho phép pre-flight', 'READY · pre-flight allowed') : pick('Không đủ bằng chứng để ghi', 'Insufficient write evidence')}
              />
            </div>

      {coreReady && runtime.data?.safeState === true && runtime.data.safeStateNoControllerOnly === true && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
          {pick(
            'Core đang ở trạng thái an toàn vì chưa có Program nào điều khiển output — Đưa vào vận hành Program này sẽ tự giải quyết.',
            'Core is in safe state because no Program is currently controlling outputs — commissioning this Program will resolve it.'
          )}
        </div>
      )}
      {!coreReady && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
          {pick('Core chưa READY hoặc đang ở trạng thái an toàn do lỗi — Đưa vào vận hành bị chặn.', 'Core is not READY or is in a fault safe state — Commission is blocked.')}
        </div>
      )}
      {overrides.status === 'error' && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
          {pick('Không xác minh được override hiện hành — Đưa vào vận hành bị chặn.', 'Active overrides could not be verified — Commission is blocked.')}
        </div>
      )}

      {canEdit && (
        <div className="border-t border-[var(--c-border)] pt-3">
          <p className="mb-3 text-xs text-[var(--c-text-dim)]">
            {readyToCommission
              ? pick('Lệnh sẽ yêu cầu xác nhận từng impact và nhập lại mật khẩu.', 'The command requires per-impact acknowledgement and password re-entry.')
              : pick('Lệnh đang khóa; xử lý các cổng cảnh báo trước khi tiếp tục.', 'The command is locked; resolve the warning gates before continuing.')}
          </p>
          <Button icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} disabled={!readyToCommission} onClick={openConfirmDialog}>
            {pick('Đưa vào vận hành…', 'Commission…')}
          </Button>
        </div>
      )}

      {commission.state.phase === 'unknown' && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm">
          <p className="font-semibold text-[var(--c-warn-fg)]">{pick('Chưa xác định kết quả. Đang chờ đọc ngược từ Core…', 'Result unknown. Waiting for Core read-back…')}</p>
          <Button size="sm" className="mt-2" onClick={() => commission.recheckStatus(commission.state.phase === 'unknown' ? commission.state.operationId : '')}>
            {pick('Kiểm tra lại trạng thái', 'Re-check status')}
          </Button>
        </div>
      )}
      {commission.state.phase === 'terminal' && (
        <div
          role={readBackVerified ? 'status' : 'alert'}
          className={`rounded-[var(--radius)] border p-3 text-sm ${
            readBackVerified ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' : 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
          }`}
        >
          {readBackVerified ? (
            <p>{pick(`Đưa vào vận hành thành công. Bản đang chạy: ${commission.state.operation.actualActiveRevisionId ?? '—'}.`, `Commission succeeded. Running version: ${commission.state.operation.actualActiveRevisionId ?? '—'}.`)}</p>
          ) : commission.state.operation.state === 'SUCCEEDED' ? (
            <p>{pick(`Core báo SUCCEEDED nhưng Active read-back không khớp bản ứng viên. Đang chạy: ${commission.state.operation.actualActiveRevisionId ?? 'chưa xác định'}.`, `Core reported SUCCEEDED but Active read-back does not match the candidate. Running: ${commission.state.operation.actualActiveRevisionId ?? 'unknown'}.`)}</p>
          ) : commission.state.operation.state === 'ROLLED_BACK' ? (
            <p>{pick(`Đưa vào vận hành đã được Core quay lui. Bản đang chạy sau read-back: ${commission.state.operation.actualActiveRevisionId ?? 'chưa xác định'}.`, `Commission was rolled back by Core. Running revision after read-back: ${commission.state.operation.actualActiveRevisionId ?? 'unknown'}.`)}</p>
          ) : (
            <p>
              {pick('Đưa vào vận hành thất bại.', 'Commission failed.')}{' '}
              {commission.state.operation.keepsRunningRevision ? pick('Phiên bản đang chạy không đổi.', 'The running version is unchanged.') : ''}
            </p>
          )}
        </div>
      )}
      {commission.state.phase === 'error' && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
          {commission.state.message}
        </div>
      )}
          </Panel>
        </aside>
      </div>

      <Modal
        open={dialogOpen}
        title={pick('Xác nhận Đưa vào vận hành', 'Confirm Commission')}
        descriptionId="programming-commission-safety-warning programming-commission-readback-contract"
        confirmLabel={pick(`Xác nhận ${navState.revisionId.slice(0, 8)}`, `Confirm ${navState.revisionId.slice(0, 8)}`)}
        confirmLoading={submitting}
        confirmDisabled={submitting || presentKeys.some((key) => !acknowledged.has(key)) || password.length === 0 || !readyToCommission}
        danger
        size="lg"
        mobileFullscreen
        onConfirm={submitCommission}
        onClose={() => {
          if (submitting) return
          setDialogOpen(false)
        }}
      >
        <div className="space-y-3 pr-1">
          <div id="programming-commission-safety-warning" role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm font-semibold text-[var(--c-fault-fg)]">
            {pick('Hành động thay đổi chương trình đang điều khiển thiết bị. Active hiện tại được giữ cho tới khi Core đọc ngược thành công.', 'This action changes the program controlling the device. The current Active revision remains until Core read-back succeeds.')}
          </div>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-2">
            <div className="bg-[var(--c-surface-2)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]">{pick('Ứng viên', 'Candidate')}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--c-text)]">{navState.revisionId}</p>
            </div>
            <div className="bg-[var(--c-surface-2)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]">Active Revision</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--c-text)]">{displayedActiveRevisionId ?? '—'}</p>
            </div>
            <div className="bg-[var(--c-surface-2)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]">Last-known-good</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--c-text)]">{runtime.data?.lkgRevisionId ?? '—'}</p>
            </div>
            <div className="bg-[var(--c-surface-2)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]">{pick('Hồ sơ đích', 'Target profile')}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--c-text)]">{capabilities.data?.profile ?? pick('Chưa xác định', 'Unknown')}</p>
            </div>
            <div className="bg-[var(--c-surface-2)] p-3 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]">{pick('Bộ điều khiển đích', 'Target controller')}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--c-text)]">{runtime.data?.controllerId ?? pick('Chưa xác định', 'Unknown')}</p>
            </div>
          </div>
          {changes.status === 'loading' && <p>{pick('Đang tải lại ảnh hưởng mới nhất…', 'Reloading the latest impact…')}</p>}
          {presentKeys.length === 0 ? (
            <p>{pick('Không có ảnh hưởng nào cần xác nhận. Vẫn cần xác thực lại.', 'No impact needs acknowledgement. Re-authentication is still required.')}</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Xác nhận ảnh hưởng', 'Acknowledge impact')}</legend>
              {presentKeys.map((key) => (
                <div key={key}>
                  <label className="flex items-start gap-2 text-sm text-[var(--c-text)]">
                    <input
                      type="checkbox"
                      checked={acknowledged.has(key)}
                      onChange={(event) => {
                        setAcknowledged((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }}
                    />
                    {/* SC-RETAIN-RESET (UC-PROG-13): dùng đúng ngôn ngữ điều khiển,
                        không phải thuật ngữ schema. */}
                    {key === 'retain'
                      ? pick(
                          'Trạng thái điều khiển đã lưu không còn tương thích. Các giá trị RETAIN bị ảnh hưởng sẽ được khởi tạo lại.',
                          'Stored control state is no longer compatible. Affected RETAIN values will be re-initialised.'
                        )
                      : pick(...IMPACT_GROUP_LABEL[key])}
                  </label>
                  {impact![key].items.length > 0 && (
                    <ul className="ml-6 mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto text-xs text-[var(--c-text-dim)]">
                      {impact![key].items.map((item) => (
                        <li key={item} className="font-mono">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </fieldset>
          )}
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-commission-reauth-password">
            {pick('Xác thực lại — nhập mật khẩu', 'Re-authenticate — enter password')}
          </label>
          <input
            id="programming-commission-reauth-password"
            type="password"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <div id="programming-commission-readback-contract" role="note" className="rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] p-3 text-xs text-[var(--c-text)]">
            <p className="font-semibold">{pick('Hợp đồng xác nhận và đọc ngược', 'Acceptance and read-back contract')}</p>
            <p className="mt-1">
              {pick(
                'HTTP 202 chỉ xác nhận máy chủ đã nhận lệnh; Active Revision chỉ đổi sau GET đọc ngược từ Core.',
                'HTTP 202 only confirms that the server accepted the command; Active Revision changes only after a GET read-back from Core.'
              )}
            </p>
            <p className="mt-1">
              {pick(
                'Nếu mất phản hồi, hệ thống giữ operationId và chỉ kiểm tra lại trạng thái; không tự gửi POST lần hai.',
                'If the response is lost, the system keeps the operationId and only re-checks status; it never automatically sends a second POST.'
              )}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
