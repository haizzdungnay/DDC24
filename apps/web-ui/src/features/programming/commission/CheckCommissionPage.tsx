import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, ClipboardCheck, Copy, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { programsWorkspacePath } from '../shared/programsRoute'
import { useProgrammingCheck, useProgrammingOverrides, useProgrammingRevisionChanges } from '../api/queries'
import { useDraftWorkspace, useCheckWorkflow } from '../design/useDraftWorkspace'
import { useCommissionWorkflow, type CommissionWorkflowState } from './useCommissionWorkflow'
import type { ProgrammingImpactKey } from '../api/generated/client'
import type { ProgrammingCheck, ProgrammingDiagnostic } from '../model/types'
import { ProblemsDrawer } from '../shared/ProblemsDrawer'
import { useProgrammingActionAllowed } from '../api/authorization'

// T59-502: thứ tự đi từ thứ tác động MẠNH NHẤT lên thiết bị đang chạy xuống
// thứ nhẹ hơn. Người vận hành đọc từ trên xuống, nên thứ có thể làm hỏng quá
// trình phải nằm trên.
/* `ISS-PIO-29` — bốn nhóm tách theo NGUỒN Point xen vào đúng thứ tự rủi ro.
 *
 * `writableOutputsAffected` và `physicalMappingChanges` đứng NGAY SAU
 * `outputMappingChanges` vì chúng nói cùng một chuyện ở độ phân giải cao hơn:
 * một cơ cấu chấp hành nối cứng vào tủ sẽ nhận lệnh từ chỗ khác. `modbus` và
 * `virtual` xuống dưới — hậu quả của chúng nằm sau một lớp phần mềm nữa. */
/* `T61-503` — danh sách nay ở `impactGroups.ts` (mô-đun thuần dữ liệu), để bộ
   e2e đối chiếu fixture với CHÍNH danh sách này mà không phải kéo cả cây import
   của một trang React. Tái xuất ở đây để mọi chỗ gọi cũ không phải đổi. */
import { IMPACT_GROUP_ORDER } from './impactGroups'
export { IMPACT_GROUP_ORDER }
export const IMPACT_GROUP_LABEL: Record<ProgrammingImpactKey, [string, string]> = {
  retain: ['Trạng thái lưu (RETAIN) sẽ khởi tạo lại', 'RETAIN state will be re-initialised'],
  activeOverrides: ['Override thủ công đang giữ đầu ra', 'Manual overrides currently holding outputs'],
  cutover: ['Chuyển quyền điều khiển graph → program', 'Cutover from graph to program control'],
  outputMappingChanges: ['Thay đổi ánh xạ Điểm ảnh hưởng đầu ra vật lý', 'Point mapping changes affecting physical outputs'],
  enableIntent: ['Chương trình ĐANG CHẠY sẽ bị thay', 'Programs currently running will be replaced'],
  programSet: ['Thêm hoặc bớt chương trình trên thiết bị', 'Programs added to or removed from the controller'],
  publishedSignals: ['Đổi tín hiệu công bố: freshness / chính sách khi mất dữ liệu', 'Published signal changes: freshness / stale policy'],
  controlLibrary: ['Đổi Control Library dùng chung', 'Shared Control Library changes'],
  // `ISS-PIO-29` — nhãn nói RÕ NGUỒN, vì đó chính là thứ quyết định mức rủi ro.
  physicalMappingChanges: ['Thay đổi ánh xạ điểm VẬT LÝ (UI/AO/DO)', 'Physical point mapping changes (UI/AO/DO)'],
  virtualPointChanges: ['Thay đổi ánh xạ điểm ẢO', 'Virtual point mapping changes'],
  modbusMappingChanges: ['Thay đổi ánh xạ điểm MODBUS RTU', 'Modbus RTU point mapping changes'],
  writableOutputsAffected: ['Đầu ra ghi được bị ảnh hưởng', 'Writable outputs affected']
}

type RevisionLifecycleState =
  | 'DRAFT'
  | 'CHECKING'
  | 'READY'
  | 'STAGING'
  | 'ACTIVATING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN_RECONCILING'

const REVISION_LIFECYCLE: RevisionLifecycleState[] = [
  'DRAFT', 'CHECKING', 'READY', 'STAGING', 'ACTIVATING', 'VERIFYING',
  'SUCCEEDED', 'FAILED', 'UNKNOWN_RECONCILING'
]

interface NavState {
  revisionId?: string
  checkId?: string
}

/**
 * PGM-05 Kiểm tra & Đưa vào vận hành — `UJ-PROG-06` (`T59-503`). Trang
 * nhận `revisionId/checkId` từ query canonical và dùng `location.state` làm
 * tương thích điều hướng trong phiên. Deep-link/reload không suy đoán Check
 * "mới nhất": chỉ đọc đúng hai định danh bất biến đã có trong URL.
 */
export function CheckCommissionPage() {
  const { pick } = useI18n()
  const canCheck = useProgrammingActionAllowed('check')
  const canCommission = useProgrammingActionAllowed('commission')
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const locationState = (location.state as NavState | null) ?? null
  const navState: NavState = {
    revisionId: searchParams.get('revisionId') ?? locationState?.revisionId,
    checkId: searchParams.get('checkId') ?? locationState?.checkId
  }
  const { runtime, setEditingContext } = useProgrammingRuntimeContext()

  /* D-01: PGM-05 sở hữu toàn bộ seal/run/poll Check — trước bản vá này chỉ
   * PGM-02 gọi được `useCheckWorkflow`, nên mở PGM-05 trực tiếp (không đến từ
   * nút "Mở Kiểm tra & Đưa vào vận hành" của PGM-02) không có cách nào bắt
   * đầu Check, đúng gap ghi ở As-Built §3/`F-PROG-ASBUILT-004`. */
  const workspace = useDraftWorkspace(projectId)
  const checkWorkflow = useCheckWorkflow(projectId)
  const check = useProgrammingCheck(navState?.checkId)
  /* Revision đang xét CHÍNH LÀ bản đang chạy ⇒ không có gì để đối chiếu.
   *
   * Trước lát này trang gọi thẳng dịch vụ so sánh với `from === to`, mà hợp
   * đồng cấm đúng cặp đó (`application/changes.go`), nên nó trả 400 và trang
   * hiện "Không tải được thay đổi" — một thông báo LỖI cho một tình huống hoàn
   * toàn bình thường. Bắt được trên bo Foxlinx 2026-08-27:
   * `GET /revisions/2d1c9831…/changes/2d1c9831…` → 400.
   *
   * "Không có gì để so vì nó đang chạy" KHÁC HẲN "không đọc được thay đổi", và
   * hai câu đó phải trông khác nhau. */
  const alreadyActive = Boolean(
    navState?.revisionId && runtime.data?.activeRevisionId === navState.revisionId,
  )
  const changes = useProgrammingRevisionChanges(
    alreadyActive ? undefined : (runtime.data?.activeRevisionId ?? 'none'),
    alreadyActive ? undefined : navState?.revisionId,
  )
  const overrides = useProgrammingOverrides()
  const commission = useCommissionWorkflow()

  useEffect(() => {
    if (checkWorkflow.state.phase !== 'done' || !projectId) return
    const { revisionId, checkId } = checkWorkflow.state.check
    if (navState.revisionId === revisionId && navState.checkId === checkId) return
    navigate(`/eng/programming/projects/${projectId}/commission?revisionId=${encodeURIComponent(revisionId)}&checkId=${encodeURIComponent(checkId)}`, { replace: true })
  }, [checkWorkflow.state, projectId, navState.revisionId, navState.checkId, navigate])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState<Set<ProgrammingImpactKey>>(new Set())
  const [password, setPassword] = useState('')

  const impact = changes.data?.impact
  // Nhóm impact VẮNG MẶT là `UNAVAILABLE`, không phải `NONE`. Một BE cũ hơn (hoặc
  // một nhóm mới chưa được nối) gửi thiếu nhóm thì Commission phải fail-closed —
  // coi "không thấy" là "không có" đúng là cách để một tác động thật đi qua mà
  // không ai xác nhận. Đọc phòng thủ cũng giữ trang sống thay vì trắng màn hình.
  const groupStatus = (key: ProgrammingImpactKey) => impact?.[key]?.status ?? 'UNAVAILABLE'
  const presentKeys = useMemo(() => IMPACT_GROUP_ORDER.filter((key) => groupStatus(key) === 'PRESENT'), [impact])
  const hasUnavailable = useMemo(
    () => IMPACT_GROUP_ORDER.some((key) => groupStatus(key) !== 'NONE' && groupStatus(key) !== 'PRESENT'),
    [impact]
  )
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
  /* Đang chạy sẵn thì KHÔNG Commission lại: không có gì để nạp, mà một lần
   * nạp "cho chắc" vẫn là một lần cutover thật trên thiết bị đang điều khiển. */
  const readyToCommission = checkPassed && !alreadyActive && changes.status === 'ready' && overrides.status === 'ready' && !hasUnavailable && coreReady && !!projectId

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
            : check.status !== 'ready' || !check.data
              ? 'checking'
              : check.data.state === 'PASSED'
                ? 'passed'
                : check.data.state === 'FAILED' || check.data.state === 'TIMED_OUT' ? 'failed' : 'checking'
    setEditingContext({ projectId, projectName: '', draftRevisionId: '', dirty: false, checkState })
    return () => setEditingContext(null)
  }, [checkWorkflow.state, check.data, check.status, projectId, setEditingContext])

  const errorLogItems = useMemo(() => {
    const list: ErrorLogItem[] = []
    if (checkWorkflow.state.phase === 'error') {
      list.push({
        id: 'check-workflow-error',
        stage: checkWorkflow.state.stage === 'sealing'
          ? pick('Niêm phong Revision', 'Sealing Revision')
          : pick('Kiểm tra & Biên dịch', 'Check & Compilation'),
        title: checkWorkflow.state.message,
        code: checkWorkflow.state.code,
        correlationId: checkWorkflow.state.correlationId,
        args: checkWorkflow.state.args,
        raw: checkWorkflow.state.raw
      })
    }
    if (check.data && (check.data.state === 'FAILED' || check.data.state === 'TIMED_OUT')) {
      list.push({
        id: 'check-failed',
        stage: pick('Biên dịch & Kiểm tra', 'Compilation & Check'),
        title: check.data.state === 'TIMED_OUT'
          ? pick('Kiểm tra quá thời gian quy định (Timeout).', 'Check timed out.')
          : pick('Kiểm tra gói chương trình thất bại.', 'Program package check failed.'),
        code: check.data.state,
        diagnostics: check.data.diagnostics,
        raw: check.data.diagnostics && check.data.diagnostics.length > 0
          ? JSON.stringify(check.data.diagnostics, null, 2)
          : undefined
      })
    } else if (check.status === 'error') {
      list.push({
        id: 'check-query-error',
        stage: pick('Tải dữ liệu Kiểm tra', 'Loading Check Data'),
        title: pick('Không tải được thông tin Kiểm tra từ máy chủ.', 'Could not load check information from server.'),
        code: 'NETWORK_ERROR'
      })
    }
    if (commission.state.phase === 'error') {
      list.push({
        id: 'commission-error',
        stage: pick('Đưa vào vận hành', 'Commissioning'),
        title: commission.state.message,
        code: commission.state.code,
        correlationId: commission.state.correlationId,
        args: commission.state.args,
        raw: commission.state.raw
      })
    } else if (commission.state.phase === 'terminal' && commission.state.operation.state === 'FAILED') {
      list.push({
        id: 'commission-op-failed',
        stage: pick('Đưa vào vận hành', 'Commissioning'),
        title: pick('Lệnh Đưa vào vận hành thất bại.', 'Commission operation failed.'),
        code: commission.state.operation.step || commission.state.operation.state,
        correlationId: commission.state.operation.operationId,
        raw: JSON.stringify(commission.state.operation, null, 2)
      })
    }
    return list
  }, [checkWorkflow.state, check.data, check.status, commission.state, pick])

  if (!navState?.revisionId || !navState?.checkId) {
    const phase = checkWorkflow.state.phase
    const running = phase === 'sealing' || phase === 'checking'
    return (
      <div className="space-y-3">
        {/* F-UX-15: mọi NHÁNH TRẢ VỀ của màn hình đều phải giữ tiêu đề, kể cả
          nhánh trạng thái rỗng/lỗi — đó chính là chỗ finding gốc chỉ ra ở
          `SchedulerGridPage`. `<h1>` của route nằm ở `ProgrammingLayout`. */}
        <h2 className="sr-only">{pick('Kiểm tra & Đưa vào vận hành', 'Check & Commission')}</h2>
        <RevisionLifecycle current={phase === 'sealing' || phase === 'checking' ? 'CHECKING' : phase === 'error' ? 'FAILED' : 'DRAFT'} />
        {!canCheck ? <ReadOnlyCommissionNotice /> : null}
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
        {canCheck && !running && phase !== 'error' && (
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
            <Link className="text-sm font-medium text-[var(--c-accent)] underline" to={programsWorkspacePath(projectId)}>
              {pick('Về workspace Chương trình', 'Back to the Programs workspace')}
            </Link>
          </div>
        )}
        <ErrorLogPanel items={errorLogItems} />
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
      <h2 className="sr-only">{pick('Kiểm tra & Đưa vào vận hành', 'Check & Commission')}</h2>
      <RevisionLifecycle current={commissionLifecycleState(check.status, check.data, commission.state)} />
      {!canCommission ? <ReadOnlyCommissionNotice /> : null}
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
                  // BUG-007 — lỗi Check trước đây không dẫn đi đâu cả. D-01: PGM-05 sở
                  // hữu Check/result nhưng editor vẫn ở PGM-02 — điều hướng sang đúng
                  // Program kèm line/column/length qua query string (F-PROG-ASBUILT-003)
                  // để `SourceEditor` chọn đúng vùng nguồn ngay khi PGM-02 mount, không
                  // chỉ chọn đúng Program rồi bắt người dùng tự tìm dòng lỗi.
                  if (!projectId || typeof diagnostic.location?.programId !== 'string') return
                  const params = new URLSearchParams({ tab: 'programs', program: diagnostic.location.programId })
                  if (typeof diagnostic.location.line === 'number') params.set('line', String(diagnostic.location.line))
                  if (typeof diagnostic.location.column === 'number') params.set('column', String(diagnostic.location.column))
                  if (typeof diagnostic.location.length === 'number') params.set('length', String(diagnostic.location.length))
                  navigate(programsWorkspacePath(projectId, { pou: diagnostic.location.programId, search: params }))
                }}
              />
            )}
            {!checkPassed && <p className="text-sm text-[var(--c-warn-fg)]">{pick('Chỉ Kiểm tra PASSED mới mở được Đưa vào vận hành.', 'Only a PASSED check unlocks Commission.')}</p>}
          </div>
        )}
      </Panel>

      <Panel title={pick('Thay đổi so với bản đang chạy', 'Changes vs. the running version')}>
        {alreadyActive ? (
          <p className="text-sm text-[var(--c-text-dim)]">
            {pick('Revision này chính là bản đang chạy trên thiết bị — không có gì để đối chiếu.',
                  'This revision is the one already running on the device — there is nothing to compare.')}
          </p>
        ) : changes.status === 'loading' ? (
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

      <Panel title={pick('Ảnh hưởng khi áp dụng', 'Impact when applied')}>
        {alreadyActive ? (
          <p className="text-sm text-[var(--c-text-dim)]">
            {pick('Không có ảnh hưởng để tính: Revision này đang chạy sẵn.',
                  'There is no impact to compute: this revision is already running.')}
          </p>
        ) : changes.status !== 'ready' || !impact ? (
          <StateBlock state={changes.status === 'error' ? 'error' : 'loading'} title={pick('Đang tính ảnh hưởng…', 'Computing impact…')} />
        ) : (
          <ul className="space-y-2 text-sm">
            {IMPACT_GROUP_ORDER.map((key) => {
              const group = impact[key] ?? { status: 'UNAVAILABLE' as const, items: [] }
              return (
                <li key={key} className="flex items-start justify-between gap-3">
                  <span className="text-[var(--c-text)]">{pick(...IMPACT_GROUP_LABEL[key])}</span>
                  <StatusBadge
                    state={group.status === 'PRESENT' ? 'warning' : group.status === 'UNAVAILABLE' ? 'fault' : 'online'}
                    label={group.status === 'NONE' ? pick('Không có', 'None') : group.status === 'PRESENT' ? pick(`${group.items.length} mục`, `${group.items.length} item(s)`) : pick('Chưa tính được', 'Unavailable')}
                  />
                </li>
              )
            })}
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
          <div className="overflow-x-auto">
            <table className="min-w-[520px] w-full text-left text-sm">
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
        )}
      </Panel>

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

      {canCommission && (
        <div className="flex justify-end">
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
          role="status"
          className={`rounded-[var(--radius)] border p-3 text-sm ${
            commission.state.operation.state === 'SUCCEEDED' ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' : 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
          }`}
        >
          {commission.state.operation.state === 'SUCCEEDED' ? (
            <p>{pick(`Đưa vào vận hành thành công. Bản đang chạy: ${commission.state.operation.actualActiveRevisionId ?? '—'}.`, `Commission succeeded. Running version: ${commission.state.operation.actualActiveRevisionId ?? '—'}.`)}</p>
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

      <Modal
        open={dialogOpen}
        title={pick('Xác nhận Đưa vào vận hành', 'Confirm Commission')}
        confirmLabel={pick('Gửi lệnh', 'Submit')}
        confirmLoading={submitting}
        confirmDisabled={submitting || presentKeys.some((key) => !acknowledged.has(key)) || password.length === 0 || !readyToCommission}
        onConfirm={submitCommission}
        onClose={() => {
          if (submitting) return
          setDialogOpen(false)
        }}
      >
        <div className="space-y-3">
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
        </div>
      </Modal>
      <ErrorLogPanel items={errorLogItems} />
    </div>
  )
}

function commissionLifecycleState(
  checkStatus: 'loading' | 'ready' | 'error',
  check: ProgrammingCheck | null,
  commission: CommissionWorkflowState
): RevisionLifecycleState {
  if (commission.phase === 'unknown') return 'UNKNOWN_RECONCILING'
  if (commission.phase === 'terminal') return commission.operation.state === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED'
  if (commission.phase === 'error') return 'FAILED'
  if (commission.phase === 'submitting') return 'STAGING'
  if (commission.phase === 'polling') {
    if (commission.operation?.state === 'APPLYING') return 'ACTIVATING'
    if (commission.operation?.state === 'VERIFYING') return 'VERIFYING'
    return 'STAGING'
  }
  if (checkStatus === 'loading') return 'CHECKING'
  if (checkStatus === 'error' || !check) return 'FAILED'
  if (check.state === 'QUEUED' || check.state === 'RUNNING') return 'CHECKING'
  if (check.state === 'PASSED') return 'READY'
  return 'FAILED'
}

function RevisionLifecycle({ current }: { current: RevisionLifecycleState }) {
  const { pick } = useI18n()
  const labels: Record<RevisionLifecycleState, string> = {
    DRAFT: 'DRAFT',
    CHECKING: 'CHECKING',
    READY: 'READY',
    STAGING: 'STAGING',
    ACTIVATING: 'ACTIVATING',
    VERIFYING: 'VERIFYING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    UNKNOWN_RECONCILING: 'UNKNOWN / RECONCILING'
  }

  return (
    <Panel
      title={pick('Vòng đời Revision', 'Revision lifecycle')}
      subtitle={pick('Trạng thái lấy từ Check và operation read-back; timeout không được xem là thành công.', 'State comes from Check and operation read-back; a timeout is never treated as success.')}
    >
      <ol
        aria-label={pick('Tiến trình Kiểm tra và Đưa vào vận hành', 'Check and Commission progress')}
        tabIndex={0}
        className="flex gap-2 overflow-x-auto pb-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
      >
        {REVISION_LIFECYCLE.map((state) => {
          const active = state === current
          return (
            <li
              key={state}
              aria-current={active ? 'step' : undefined}
              className={`min-h-11 shrink-0 rounded-[var(--radius)] border px-3 py-2 font-mono text-xs ${
                active
                  ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] font-bold text-[var(--c-accent)]'
                  : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
              }`}
            >
              {labels[state]}
            </li>
          )
        })}
      </ol>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--c-text-dim)]">
        {pick('Trạng thái hiện tại', 'Current state')}: <strong className="font-mono text-[var(--c-text)]">{labels[current]}</strong>
      </p>
    </Panel>
  )
}

function ReadOnlyCommissionNotice() {
  const { pick } = useI18n()
  return (
    <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
      <strong className="text-[var(--c-text)]">{pick('Bạn không có quyền thực hiện thao tác này', 'You do not have permission to perform this action')}</strong>
      <span className="mt-1 block">
        {pick('Kết quả Check, impact và read-back vẫn hiển thị ở chế độ chỉ đọc.', 'Check results, impact, and read-back remain visible in read-only mode.')}
      </span>
    </div>
  )
}

interface ErrorLogItem {
  id: string
  stage: string
  title: string
  code?: string
  correlationId?: string
  diagnostics?: ProgrammingDiagnostic[]
  args?: Record<string, unknown>
  raw?: string
}

function ErrorLogPanel({ items }: { items: ErrorLogItem[] }) {
  const { pick } = useI18n()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = (item: ErrorLogItem) => {
    const text = JSON.stringify(item, null, 2)
    void navigator.clipboard?.writeText(text)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <Panel
      title={pick('Log lỗi', 'Error log')}
      subtitle={pick(
        'Chi tiết kỹ thuật về lỗi gặp phải trong quá trình Kiểm tra hoặc Đưa vào vận hành (nếu có)',
        'Technical details of errors encountered during Check or Commission (if any)'
      )}
    >
      {items.length === 0 ? (
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick('Không có lỗi nào được ghi nhận.', 'No errors recorded.')}
        </p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="space-y-3 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-surface-2)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[var(--c-fault)] px-2 py-0.5 text-xs font-semibold text-white">
                    {item.stage}
                  </span>
                  {item.code && (
                    <span className="font-mono text-xs font-bold text-[var(--c-fault-fg)]">
                      {item.code}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copiedId === item.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  onClick={() => handleCopy(item)}
                >
                  {copiedId === item.id ? pick('Đã sao chép', 'Copied') : pick('Sao chép log', 'Copy log')}
                </Button>
              </div>

              <div>
                <p className="text-sm font-medium text-[var(--c-text)]">{item.title}</p>
                {item.correlationId && (
                  <p className="mt-1 font-mono text-xs text-[var(--c-text-dim)]">
                    Correlation ID: {item.correlationId}
                  </p>
                )}
              </div>

              {item.args && Object.keys(item.args).length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-[var(--c-text-dim)]">
                    {pick('Tham số ngữ cảnh', 'Context parameters')}:
                  </span>
                  <pre className="max-h-32 overflow-auto rounded bg-black/40 p-2 font-mono text-xs text-gray-200">
                    {JSON.stringify(item.args, null, 2)}
                  </pre>
                </div>
              )}

              {item.diagnostics && item.diagnostics.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-[var(--c-text-dim)]">
                    {pick('Danh sách chẩn đoán từ compiler', 'Compiler diagnostics')}:
                  </span>
                  <div className="max-h-48 overflow-auto rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-2">
                    <ul className="divide-y divide-[var(--c-border)] text-xs">
                      {item.diagnostics.map((d, idx) => (
                        <li key={idx} className="space-y-1 py-1.5">
                          <div className="flex items-center gap-2 font-mono">
                            <span
                              className={
                                d.severity === 'ERROR'
                                  ? 'font-bold text-[var(--c-fault-fg)]'
                                  : 'text-[var(--c-warn-fg)]'
                              }
                            >
                              [{d.severity}]
                            </span>
                            <span>{d.code}</span>
                            {d.detailCode && (
                              <span className="text-[var(--c-text-dim)]">({d.detailCode})</span>
                            )}
                          </div>
                          {d.message && <p className="font-mono text-[var(--c-text)]">{d.message}</p>}
                          {d.location && (
                            <p className="text-[var(--c-text-dim)]">
                              Program: {String(d.location.programId || '—')}, Line: {String(d.location.line ?? '—')}, Col: {String(d.location.column ?? '—')}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {item.raw && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-[var(--c-text-dim)]">
                    {pick('Chi tiết raw', 'Raw details')}:
                  </span>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-xs text-gray-200">
                    {item.raw}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
