import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, FolderPlus, Loader2, PlayCircle, RefreshCw, XCircle } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingProjects, useProgrammingRecentAudit } from '../api/queries'
import { useCreateProgrammingProject } from '../api/mutations'
import type { ProgrammingProject, ProgrammingRuntime } from '../model/types'
import { programmingCoreTruth } from '../shared/runtimeTruth'

/**
 * `OverviewPage` (PGM-01) — `UJ-PROG-01`. Trong `≤5 giây` phải thấy: Core,
 * bản đang vận hành, safe-state, việc cần chú ý, và hành động tiếp theo
 * (UX §5 PGM-01). KHÔNG đặt CPU/RAM/hash/compiler/% sức khỏe ở đây (§3.1).
 */
export function OverviewPage() {
  const { runtime } = useProgrammingRuntimeContext()
  const projects = useProgrammingProjects()
  const audit = useProgrammingRecentAudit(5)

  return (
    <div className="space-y-3">
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.85fr)]">
        <RuntimeAuthorityPanel runtime={runtime.data} status={runtime.status} onRetry={runtime.refresh} />
        <DraftAttentionPanel projects={projects} />
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.85fr)]">
        <ProgrammingAttentionList runtime={runtime.data} status={runtime.status} />
        <RecentEngineeringTimeline audit={audit} />
      </div>
    </div>
  )
}

function shortRevision(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : '—'
}

function RuntimeAuthorityPanel({ runtime, status, onRetry }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error'; onRetry: () => void }) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const truth = programmingCoreTruth({ status, data: runtime })
  const coreState = truth === 'ready' ? 'connected' : truth === 'degraded' ? 'degraded' : truth === 'unavailable' ? 'disconnected' : truth === 'stale' ? 'stale' : 'unknown'
  const coreLabel = truth === 'ready'
    ? pick('Core sẵn sàng', 'Core ready')
    : truth === 'degraded'
      ? pick('Core suy giảm', 'Core degraded')
      : truth === 'unavailable'
        ? pick('Không kết nối được Core', 'Core unreachable')
        : truth === 'stale'
          ? pick('Snapshot Core cũ', 'Stale Core snapshot')
          : pick('Trạng thái Core chưa xác định', 'Core state unknown')
  const activeTitle = truth !== 'ready'
    ? pick('Chưa xác nhận được bản đang vận hành', 'Running revision is not confirmed')
    : runtime?.activeRevisionId
      ? `Revision ${shortRevision(runtime.activeRevisionId)}`
      : pick('Chưa có bản Active', 'No active revision')
  const taskState = truth === 'ready' && runtime?.taskState === 'RUNNING'
    ? 'online'
    : truth === 'ready' && runtime?.taskState === 'FAULT'
      ? 'fault'
      : truth === 'unavailable'
        ? 'disconnected'
        : truth === 'stale'
          ? 'stale'
          : truth === 'degraded'
            ? 'degraded'
            : 'unknown'

  return (
    <section aria-labelledby="programming-runtime-authority" className="min-w-0 overflow-hidden rounded-[var(--radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)] shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--c-border)] px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--c-text-dim)]"><Activity className="h-3.5 w-3.5" aria-hidden="true" />{pick('Bản Active & Runtime', 'Active revision & runtime')}</p>
          <h2 id="programming-runtime-authority" className="mt-1 text-xl font-bold tracking-tight text-[var(--c-text)] sm:text-2xl">{status === 'loading' ? pick('Đang đọc trạng thái…', 'Reading state…') : activeTitle}</h2>
          <p className="mt-1 break-all font-mono text-xs text-[var(--c-text-dim)]">{pick('Active revision', 'Active revision')}: {truth === 'ready' ? (runtime?.activeRevisionId ?? '—') : pick('chưa xác nhận', 'not confirmed')}</p>
        </div>
        <StatusBadge
          state={taskState}
          label={status === 'loading' ? pick('ĐANG ĐỌC', 'LOADING') : truth === 'ready' ? (runtime?.taskState ?? 'UNKNOWN') : coreLabel}
        />
      </div>

      <dl className="grid divide-y divide-[var(--c-border)] border-b border-[var(--c-border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="min-w-0 px-4 py-3 sm:px-5">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">Core</dt>
          <dd className="mt-1"><StatusBadge state={coreState} label={coreLabel} /></dd>
        </div>
        <div className="min-w-0 px-4 py-3 sm:px-5">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{pick('Trạng thái an toàn', 'Safe state')}</dt>
          <dd className={`mt-1 text-sm font-semibold ${truth === 'ready' && runtime?.safeState ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-text)]'}`}>
            {truth === 'ready' && runtime ? (runtime.safeState ? pick('ĐANG TÁC ĐỘNG', 'ACTIVE') : 'NORMAL') : '—'}
          </dd>
        </div>
        <div className="min-w-0 px-4 py-3 sm:px-5">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{pick('Chu kỳ tác vụ', 'Task period')}</dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--c-text)]">{truth === 'ready' && runtime?.task ? `${runtime.task.periodMs} ms` : '—'}</dd>
          <dd className="mt-0.5 text-xs text-[var(--c-text-dim)]">{runtime?.observedAt ? `${pick('Đọc lúc', 'Observed')} ${new Date(runtime.observedAt).toLocaleTimeString()}` : pick('Chưa có mốc đọc', 'No observation yet')}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <p className="max-w-xl text-xs text-[var(--c-text-dim)]">
          {truth === 'ready'
            ? pick('Trạng thái runtime được đọc trực tiếp từ producer đang sẵn sàng.', 'Runtime state comes directly from the ready producer.')
            : pick('Không dùng snapshot/unknown để suy ra hệ thống đang chạy. Các thao tác runtime tiếp tục fail-closed.', 'Snapshot/unknown data is not treated as running. Runtime actions remain fail-closed.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {truth !== 'ready' && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={onRetry}>{pick('Đọc lại', 'Retry read')}</Button>}
          <Button size="sm" variant="secondary" icon={<PlayCircle className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate('/eng/programming/runtime')}>
            {pick('Mở Runtime', 'Open runtime')}
          </Button>
        </div>
      </div>
    </section>
  )
}

function DraftAttentionPanel({ projects }: { projects: ReturnType<typeof useProgrammingProjects> }) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { createProject, creating, error } = useCreateProgrammingProject()
  const [nameDraft, setNameDraft] = useState('')
  const canAdmin = roleAtLeast(session?.role, 'admin')

  if (projects.status === 'loading') {
    return <Panel title={pick('Bản nháp cần xử lý', 'Draft needs attention')}><StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} /></Panel>
  }
  if (projects.status === 'error' || !projects.data) {
    return (
      <Panel title={pick('Bản nháp cần xử lý', 'Draft needs attention')}>
        <StateBlock state="error" title={pick('Không tải được Project.', 'Could not load the project.')} detail={projects.error ?? undefined} onRetry={projects.refresh} />
      </Panel>
    )
  }
  const project = projects.data.items[0]
  if (!project) {
    return (
      <Panel title={pick('Bản nháp cần xử lý', 'Draft needs attention')}>
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có Project nào trên controller này.', 'No project exists on this controller.')}</p>
        {canAdmin && (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void createProject(nameDraft || pick('Ứng dụng điều khiển', 'Control application')).then((created) => {
                if (created) navigate(`/eng/programming/projects/${created.projectId}/design`)
              })
            }}
          >
            <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-new-project-name">
              {pick('Tên Project', 'Project name')}
            </label>
            <input
              id="programming-new-project-name"
              className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder={pick('Ứng dụng điều khiển', 'Control application')}
            />
            <Button type="submit" size="sm" icon={<FolderPlus className="h-4 w-4" aria-hidden="true" />} loading={creating}>
              {pick('Tạo bản nháp', 'Create draft')}
            </Button>
            {error && <p className="text-xs text-[var(--c-fault-fg)]">{error}</p>}
          </form>
        )}
      </Panel>
    )
  }
  return (
    <Panel title={pick('Bản nháp cần xử lý', 'Draft needs attention')}>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--c-text-dim)]">Project</span>
          <span className="text-[var(--c-text)]">{project.name}</span>
        </div>
        <DraftCheckStatus project={project} />
        <div className="flex flex-wrap gap-2">
          <DraftPrimaryAction project={project} navigate={navigate} />
        </div>
      </div>
    </Panel>
  )
}

/**
 * WP-01 (Overview state model, D-01, `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15`
 * §5.2, quyết định CTO/Owner 2026-08-15): `DraftAttentionPanel` trước đây chỉ
 * có 2 nhánh (no-draft/dirty), không phân biệt được Check đang chạy/vừa lỗi/
 * vừa đạt — kỹ sư mở Tổng quan sau một lần Check FAILED chỉ thấy "Tiếp tục
 * chỉnh sửa" giống hệt lúc chưa từng Check. Nay đọc `project.latestCheck`
 * (mới, `GET /projects`) để phân biệt 4/6 trạng thái thiết kế yêu cầu:
 * no-draft, dirty (chưa Check hoặc chưa có Draft nào được niêm phong),
 * checking, failed, ready. Bảng thiết kế còn liệt kê `conflict` (409 khi
 * lưu) — KHÔNG cài ở đây: 409 là phản hồi tức thời của một lần lưu đang diễn
 * ra tại `PGM-02` (đã xử lý sống ở `DesignWorkspacePage`/`useDraftWorkspace`),
 * không phải một trạng thái được server lưu lại — không có "conflict" nào để
 * đọc lại khi mở Tổng quan ở một phiên trình duyệt mới. Xem
 * `docs/03_implementation/56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md`
 * WP-01 mục "Quyết định thiết kế" để có lý do đầy đủ.
 */
function draftAttentionState(project: ProgrammingProject): 'dirty' | 'checking' | 'failed' | 'ready' {
  const state = project.latestCheck?.state
  if (state === 'QUEUED' || state === 'RUNNING') return 'checking'
  if (state === 'FAILED' || state === 'TIMED_OUT') return 'failed'
  if (state === 'PASSED') return 'ready'
  return 'dirty'
}

function DraftCheckStatus({ project }: { project: ProgrammingProject }) {
  const { pick } = useI18n()
  const state = draftAttentionState(project)
  if (state === 'checking') {
    return (
      <div className="flex items-center gap-2 text-[var(--c-text-dim)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {pick('Đang kiểm tra…', 'Checking…')}
      </div>
    )
  }
  if (state === 'failed') {
    return (
      <div className="flex items-center gap-2 text-[var(--c-fault-fg)]">
        <XCircle className="h-4 w-4" aria-hidden="true" />
        {pick('Kiểm tra gần nhất KHÔNG đạt.', 'Latest check FAILED.')}
      </div>
    )
  }
  if (state === 'ready') {
    return (
      <div className="flex items-center gap-2 text-[var(--c-good-fg)]">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {pick('Kiểm tra gần nhất đạt — sẵn sàng Đưa vào vận hành.', 'Latest check PASSED — ready to commission.')}
      </div>
    )
  }
  return (
    <div className="text-[var(--c-text-dim)]">
      {pick('Đang chỉnh sửa — chưa Kiểm tra lần nào cho bản này.', 'Editing — this draft has not been checked yet.')}
    </div>
  )
}

function DraftPrimaryAction({ project, navigate }: { project: ProgrammingProject; navigate: (path: string) => void }) {
  const { pick } = useI18n()
  const state = draftAttentionState(project)
  const designPath = `/eng/programming/projects/${project.projectId}/design`
  const commissionPath = `/eng/programming/projects/${project.projectId}/commission`
  if (state === 'checking') {
    return (
      <Button size="sm" onClick={() => navigate(commissionPath)}>
        {pick('Xem tiến trình', 'View progress')}
      </Button>
    )
  }
  if (state === 'failed') {
    return (
      <>
        <Button size="sm" variant="primary" icon={<XCircle className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate(commissionPath)}>
          {pick('Xem lỗi', 'View errors')}
        </Button>
        <Button size="sm" onClick={() => navigate(designPath)}>{pick('Tiếp tục chỉnh sửa', 'Continue editing')}</Button>
      </>
    )
  }
  if (state === 'ready') {
    return (
      <>
        <Button size="sm" variant="primary" icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate(commissionPath)}>
          {pick('Mở Kiểm tra & Đưa vào vận hành', 'Open Check & Commission')}
        </Button>
        <Button size="sm" onClick={() => navigate(designPath)}>{pick('Tiếp tục chỉnh sửa', 'Continue editing')}</Button>
      </>
    )
  }
  return <Button size="sm" onClick={() => navigate(designPath)}>{pick('Tiếp tục chỉnh sửa', 'Continue editing')}</Button>
}

function ProgrammingAttentionList({ runtime, status }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error' }) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const items: Array<{ code: string; severity: 'error' | 'warning'; text: string; scope: string; action: string }> = []
  const truth = programmingCoreTruth({ status, data: runtime })
  if (truth === 'unavailable') items.push({ code: 'PRG-CORE-UNAVAILABLE', severity: 'error', text: pick('Không kết nối được Core.', 'Core is unreachable.'), scope: 'Core', action: pick('Kiểm tra service/Core và kết nối IPC.', 'Check the service/Core and IPC connection.') })
  else if (truth === 'degraded') items.push({ code: 'PRG-CORE-DEGRADED', severity: 'warning', text: pick('Core đang suy giảm; dữ liệu có thể cũ.', 'Core is degraded; data may be stale.'), scope: 'Core', action: pick('Chỉ chẩn đoán; mọi mutation runtime đang bị khóa.', 'Diagnose only; runtime mutations are locked.') })
  else if (truth === 'stale' || truth === 'unknown') items.push({ code: 'PRG-CORE-UNKNOWN', severity: 'warning', text: pick('Trạng thái Core hiện chưa xác định; snapshot cũ không được xem là live.', 'The current Core state is unknown; the last-known snapshot is not live.'), scope: 'Core', action: pick('Chỉ chẩn đoán và thử đọc lại; mọi mutation runtime đang bị khóa.', 'Diagnose and retry the read only; runtime mutations are locked.') })
  if (truth === 'ready' && runtime?.taskState === 'FAULT') items.push({ code: 'PRG-TASK-FAULT', severity: 'error', text: pick('Tác vụ điều khiển đang lỗi (FAULT).', 'The control task is faulted.'), scope: runtime.task?.taskId ?? 'Control_Main', action: pick('Mở Runtime để xem số lần quá giờ và trạng thái tác vụ.', 'Open Runtime to inspect overruns and task state.') })
  if (truth === 'ready' && runtime?.safeState) items.push(
    runtime.safeStateNoControllerOnly
      ? {
          code: 'PRG-SAFE-ACTIVE',
          severity: 'warning',
          text: pick(
            'Safe-state đang tác động vì chưa Program nào ghi output vật lý ở mức trên Default — bình thường nếu logic chỉ dùng Virtual Point.',
            'Safe-state is active because no Program is writing physical output above Default yet — expected if this logic only uses Virtual Points.'
          ),
          scope: runtime.task?.taskId
            ? `${runtime.task.taskId} / ${pick('các output do Program điều khiển', 'Program-controlled outputs')}`
            : pick('Các output do Program điều khiển (chưa có danh sách Point)', 'Program-controlled outputs (Point list unavailable)'),
          action: pick('Không chặn Đưa vào vận hành/Khôi phục. Mở Runtime nếu mong đợi có output vật lý.', 'Does not block Commission/Restore. Open Runtime if you expect a physical output.')
        }
      : {
          code: 'PRG-SAFE-ACTIVE',
          severity: 'error',
          text: pick('Safe-state đang tác động do lỗi thật (I/O/dữ liệu cũ/quá giờ); Core chưa cung cấp mã nguyên nhân chi tiết hơn.', 'Safe-state is active due to a real fault (I/O/stale data/overrun); Core did not provide a more detailed reason code.'),
          scope: runtime.task?.taskId
            ? `${runtime.task.taskId} / ${pick('các output do Program điều khiển', 'Program-controlled outputs')}`
            : pick('Các output do Program điều khiển (chưa có danh sách Point)', 'Program-controlled outputs (Point list unavailable)'),
          action: pick('Giữ Commission/Restore bị khóa; kiểm tra Core, I/O và alarm trước khi phục hồi.', 'Keep Commission/Restore locked; inspect Core, I/O, and alarms before recovery.')
        }
  )

  return (
    <Panel title={pick('Việc cần chú ý', 'Attention required')}>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Không có việc cần chú ý.', 'Nothing needs attention.')}</p>
      ) : (
        <ul className="space-y-2">
          {/* BUG-016 (TR-MKDDC24-P2-20260814-02 / TC-D08): trước đây mỗi mục là
              `<li>` phẳng, không click/điều hướng được — người dùng thấy
              `PRG-SAFE-ACTIVE` nhưng không có lối vào chi tiết. Chi tiết
              (Active/LKG, safe-state, Core connection, task table) đã có sẵn ở
              tab Runtime (`RuntimeTab.tsx`) cho cả ba mã `PRG-CORE-*`,
              `PRG-TASK-FAULT` và `PRG-SAFE-ACTIVE`, nên điều hướng thẳng tới
              đó thay vì dựng lại một trang chi tiết mới. */}
          {items.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                onClick={() => navigate('/eng/programming/runtime')}
                className="flex w-full items-start gap-2 rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-left text-sm hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
              >
                <AlertTriangle className={item.severity === 'error' ? 'mt-0.5 h-4 w-4 shrink-0 text-[var(--c-fault-fg)]' : 'mt-0.5 h-4 w-4 shrink-0 text-[var(--c-warn-fg)]'} aria-hidden="true" />
                <span>
                  <strong className="font-mono text-xs">{item.code}</strong> — {item.text}
                  <span className="mt-1 block text-xs text-[var(--c-text-dim)]">{pick('Phạm vi', 'Scope')}: {item.scope} · {pick('Hành động', 'Action')}: {item.action}</span>
                  <span className="mt-1 block text-xs font-semibold text-[var(--c-accent)]">{pick('Mở Runtime để xem chi tiết →', 'Open Runtime for details →')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecentEngineeringTimeline({ audit }: { audit: ReturnType<typeof useProgrammingRecentAudit> }) {
  const { pick } = useI18n()
  if (audit.status === 'loading') return <Panel title={pick('Hoạt động kỹ thuật gần đây', 'Recent engineering activity')}><StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} /></Panel>
  if (audit.status === 'error' || !audit.data) {
    return (
      <Panel title={pick('Hoạt động kỹ thuật gần đây', 'Recent engineering activity')}>
        <StateBlock state="offline" title={pick('Chưa đọc được nhật ký hoạt động.', 'Activity log is not available yet.')} detail={audit.error ?? undefined} onRetry={audit.refresh} />
      </Panel>
    )
  }
  if (audit.data.items.length === 0) {
    return (
      <Panel title={pick('Hoạt động kỹ thuật gần đây', 'Recent engineering activity')}>
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có hoạt động nào.', 'No activity yet.')}</p>
      </Panel>
    )
  }
  return (
    <Panel title={pick('Hoạt động kỹ thuật gần đây', 'Recent engineering activity')}>
      <ul className="space-y-2 text-sm">
        {audit.data.items.map((entry) => (
          <li key={entry.auditId} className="flex items-center justify-between gap-2">
            <span className="text-[var(--c-text)]">{entry.action}</span>
            <span className="text-[var(--c-text-dim)]">{entry.actorId} · {new Date(entry.occurredAt).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
