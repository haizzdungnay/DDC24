import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, FolderPlus, PlayCircle } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingProjects, useProgrammingRecentAudit } from '../api/queries'
import { useCreateProgrammingProject } from '../api/mutations'
import type { ProgrammingRuntime } from '../model/types'

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
    <div className="grid gap-4 lg:grid-cols-3">
      <RunningApplicationPanel runtime={runtime.data} status={runtime.status} />
      <CoreSafeStatePanel runtime={runtime.data} status={runtime.status} />
      <DraftAttentionPanel projects={projects} />
      <div className="lg:col-span-2">
        <ProgrammingAttentionList runtime={runtime.data} />
      </div>
      <RecentEngineeringTimeline audit={audit} />
    </div>
  )
}

function RunningApplicationPanel({ runtime, status }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error' }) {
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
        <Button size="sm" variant="secondary" icon={<PlayCircle className="h-4 w-4" aria-hidden="true" />} onClick={() => navigate('/eng/programming/runtime')}>
          {pick('Mở runtime', 'Open runtime')}
        </Button>
      </div>
    </Panel>
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
        <Button size="sm" onClick={() => navigate(`/eng/programming/projects/${project.projectId}/design`)}>
          {pick('Tiếp tục chỉnh sửa', 'Continue editing')}
        </Button>
      </div>
    </Panel>
  )
}

function ProgrammingAttentionList({ runtime }: { runtime: ProgrammingRuntime | null }) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const items: Array<{ code: string; severity: 'error' | 'warning'; text: string; scope: string; action: string }> = []
  if (runtime?.producerState === 'UNAVAILABLE') items.push({ code: 'PRG-CORE-UNAVAILABLE', severity: 'error', text: pick('Không kết nối được Core.', 'Core is unreachable.'), scope: 'Core', action: pick('Kiểm tra service/Core và kết nối IPC.', 'Check the service/Core and IPC connection.') })
  else if (runtime?.producerState === 'DEGRADED') items.push({ code: 'PRG-CORE-DEGRADED', severity: 'warning', text: pick('Core đang suy giảm; dữ liệu có thể cũ.', 'Core is degraded; data may be stale.'), scope: 'Core', action: pick('Chỉ chẩn đoán; mọi mutation runtime đang bị khóa.', 'Diagnose only; runtime mutations are locked.') })
  if (runtime?.taskState === 'FAULT') items.push({ code: 'PRG-TASK-FAULT', severity: 'error', text: pick('Tác vụ điều khiển đang lỗi (FAULT).', 'The control task is faulted.'), scope: runtime.task?.taskId ?? 'Control_Main', action: pick('Mở Runtime để xem số lần quá giờ và trạng thái tác vụ.', 'Open Runtime to inspect overruns and task state.') })
  if (runtime?.safeState) items.push({
    code: 'PRG-SAFE-ACTIVE',
    severity: 'error',
    text: pick('Safe-state đang tác động; Core chưa cung cấp mã nguyên nhân chi tiết.', 'Safe-state is active; Core did not provide a detailed reason code.'),
    scope: runtime.task?.taskId
      ? `${runtime.task.taskId} / ${pick('các output do Program điều khiển', 'Program-controlled outputs')}`
      : pick('Các output do Program điều khiển (chưa có danh sách Point)', 'Program-controlled outputs (Point list unavailable)'),
    action: pick('Giữ Commission/Restore bị khóa; kiểm tra Core, I/O và alarm trước khi phục hồi.', 'Keep Commission/Restore locked; inspect Core, I/O, and alarms before recovery.')
  })

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
