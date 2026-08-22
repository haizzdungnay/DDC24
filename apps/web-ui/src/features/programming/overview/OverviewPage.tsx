import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardCheck, FolderPlus, Loader2, PlayCircle, XCircle } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingRecentAudit } from '../api/queries'
import { useCreateProgrammingProject } from '../api/mutations'
import type { ProgrammingProgramIntentList, ProgrammingProject, ProgrammingProjectPage, ProgrammingRuntime, RemoteState } from '../model/types'

/**
 * `OverviewPage` (PGM-01) — `UJ-PROG-01`. Trong `≤5 giây` phải thấy: Core,
 * bản đang vận hành, safe-state, việc cần chú ý, và hành động tiếp theo
 * (UX §5 PGM-01). KHÔNG đặt CPU/RAM/hash/compiler/% sức khỏe ở đây (§3.1).
 */
export function OverviewPage() {
  const { pick } = useI18n()
  const { runtime, projects, programIntents } = useProgrammingRuntimeContext()
  const audit = useProgrammingRecentAudit(5)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* F-UX-15 (`REV-FE-UIUX-UC-2026-08-18` §7.1): mỗi màn/tab phải có mốc
          tiêu đề riêng trong cây heading. `<h1>` của route Programming nằm ở
          `ProgrammingLayout` (một và chỉ một), nên ở đây là `<h2>`/`<h3>`.
          Ẩn thị giác vì thanh tab đã hiện tên — thứ còn thiếu là mốc điều
          hướng cho trình đọc màn hình, không phải thêm chữ lên màn hình. */}
      <h2 className="sr-only">{pick('Tổng quan lập trình', 'Programming overview')}</h2>
      <RunningApplicationPanel runtime={runtime.data} status={runtime.status} programIntents={programIntents} />
      <CoreSafeStatePanel runtime={runtime.data} status={runtime.status} />
      <DraftAttentionPanel projects={projects} />
      <div className="lg:col-span-2">
        <ProgrammingAttentionList runtime={runtime.data} />
      </div>
      <RecentEngineeringTimeline audit={audit} />
    </div>
  )
}

function RunningApplicationPanel({
  runtime,
  status,
  programIntents
}: {
  runtime: ProgrammingRuntime | null
  status: 'loading' | 'ready' | 'error'
  programIntents: RemoteState<ProgrammingProgramIntentList>
}) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  if (status === 'loading') return <Panel title={pick('Ứng dụng đang vận hành', 'Running application')}><StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} /></Panel>
  if (status === 'error' || !runtime) {
    return (
      <Panel title={pick('Ứng dụng đang vận hành', 'Running application')}>
        <StateBlock state="offline" title={pick('Không kết nối được Core', 'Core unreachable')} />
      </Panel>
    )
  }
  if (!runtime.activeRevisionId) {
    return (
      <Panel title={pick('Ứng dụng đang vận hành', 'Running application')}>
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick('Chưa có ứng dụng điều khiển nào được đưa vào vận hành.', 'No control application has been commissioned.')}
        </p>
      </Panel>
    )
  }
  return (
    <Panel title={pick('Ứng dụng đang vận hành', 'Running application')}>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--c-text-dim)]">{pick('Đang vận hành', 'Active revision')}</span>
          <span className="font-mono text-[var(--c-text)]">{runtime.activeRevisionId}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--c-text-dim)]">{pick('Tác vụ', 'Task')}</span>
          <StatusBadge state={runtime.taskState === 'RUNNING' ? 'online' : runtime.taskState === 'FAULT' ? 'fault' : 'unknown'} label={runtime.taskState} />
        </div>
        <ProgramIntentRuntimeSummary state={programIntents} />
        <Button size="sm" variant="secondary" icon={<PlayCircle className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate('/eng/programming/runtime')}>
          {pick('Mở runtime', 'Open runtime')}
        </Button>
      </div>
    </Panel>
  )
}

function ProgramIntentRuntimeSummary({ state }: { state: RemoteState<ProgrammingProgramIntentList> }) {
  const { pick } = useI18n()
  if (state.status === 'loading') {
    return <p role="status" className="text-xs text-[var(--c-text-dim)]">{pick('Đang tải ý định và trạng thái Program…', 'Loading Program intent and runtime state…')}</p>
  }
  if (state.status === 'error' || !state.data) {
    return <p role="alert" className="text-xs text-[var(--c-fault-fg)]">{pick('Không đọc được ý định/trạng thái Program.', 'Program intent/runtime state is unavailable.')}</p>
  }
  if (state.data.items.length === 0) {
    return <p className="text-xs text-[var(--c-text-dim)]">{pick('Chưa có chương trình', 'No programs yet')}</p>
  }
  const desired = state.data.items.filter((item) => item.desiredEnabled).length
  const runtimeCounts = new Map<string, number>()
  for (const item of state.data.items) runtimeCounts.set(item.runtimeState, (runtimeCounts.get(item.runtimeState) ?? 0) + 1)
  const runtime = ['FAULTED', 'UNKNOWN', 'STARTING', 'STOPPING', 'WAITING', 'RUNNING', 'DISABLED']
    .filter((runtimeState) => runtimeCounts.has(runtimeState))
    .map((runtimeState) => `${runtimeState} ${runtimeCounts.get(runtimeState)}`)
    .join(' · ')
  return (
    <dl className="space-y-2 border-t border-[var(--c-border)] pt-2">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-[var(--c-text-dim)]">{pick('Ý định Enable', 'Enable intent')}</dt>
        <dd><StatusBadge state={desired > 0 ? 'on' : 'off'} label={pick(`${desired}/${state.data.items.length} muốn bật`, `${desired}/${state.data.items.length} enabled by intent`)} /></dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-[var(--c-text-dim)]">{pick('Runtime thực tế', 'Actual runtime')}</dt>
        <dd className="text-right font-mono text-xs text-[var(--c-text)]">{runtime}</dd>
      </div>
    </dl>
  )
}

function CoreSafeStatePanel({ runtime, status }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error' }) {
  const { pick } = useI18n()
  if (status === 'loading') return <Panel title={pick('Core & trạng thái an toàn', 'Core & safe state')}><StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} /></Panel>
  const coreState = status === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE'
    ? 'disconnected'
    : runtime.producerState === 'DEGRADED'
      ? 'degraded'
      : 'connected'
  const coreLabel = status === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE'
    ? pick('Không kết nối được Core', 'Core unreachable')
    : runtime.producerState === 'DEGRADED'
      ? pick('Core suy giảm', 'Core degraded')
      : pick('Core đang chạy', 'Core running')
  return (
    <Panel title={pick('Core & trạng thái an toàn', 'Core & safe state')}>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--c-text-dim)]">Core</span>
          <StatusBadge state={coreState} label={coreLabel} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--c-text-dim)]">{pick('Trạng thái an toàn', 'Safe state')}</span>
          <span className="text-[var(--c-text)]">{runtime && status === 'ready' ? (runtime.safeState ? pick('Có', 'Yes') : pick('Không', 'No')) : '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--c-text-dim)]">{pick('Cập nhật lúc', 'Observed at')}</span>
          <span className="text-[var(--c-text-dim)]">{runtime ? new Date(runtime.observedAt).toLocaleTimeString() : '—'}</span>
        </div>
      </div>
    </Panel>
  )
}

function DraftAttentionPanel({ projects }: { projects: RemoteState<ProgrammingProjectPage> }) {
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
                if (created) navigate(`/eng/programming/projects/${created.projectId}/programs`)
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
  const designPath = `/eng/programming/projects/${project.projectId}/programs`
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

function ProgrammingAttentionList({ runtime }: { runtime: ProgrammingRuntime | null }) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const items: Array<{ code: string; severity: 'error' | 'warning'; text: string; scope: string; action: string }> = []
  if (runtime?.producerState === 'UNAVAILABLE') items.push({ code: 'PRG-CORE-UNAVAILABLE', severity: 'error', text: pick('Không kết nối được Core.', 'Core is unreachable.'), scope: 'Core', action: pick('Kiểm tra service/Core và kết nối IPC.', 'Check the service/Core and IPC connection.') })
  else if (runtime?.producerState === 'DEGRADED') items.push({ code: 'PRG-CORE-DEGRADED', severity: 'warning', text: pick('Core đang suy giảm; dữ liệu có thể cũ.', 'Core is degraded; data may be stale.'), scope: 'Core', action: pick('Chỉ chẩn đoán; mọi mutation runtime đang bị khóa.', 'Diagnose only; runtime mutations are locked.') })
  if (runtime?.taskState === 'FAULT') items.push({ code: 'PRG-TASK-FAULT', severity: 'error', text: pick('Tác vụ điều khiển đang lỗi (FAULT).', 'The control task is faulted.'), scope: runtime.task?.taskId ?? 'Control_Main', action: pick('Mở Runtime để xem số lần quá giờ và trạng thái tác vụ.', 'Open Runtime to inspect overruns and task state.') })
  if (runtime?.safeState) items.push(
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
