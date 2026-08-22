import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, ShieldAlert, WifiOff } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import type {
  ProgrammingProgramIntentList,
  ProgrammingProgramRuntimeState,
  ProgrammingRuntime,
  ProgrammingTargetState,
  RemoteState
} from '../model/types'
import type { ProgrammingEditingContext } from './ProgrammingLayout'

type ResourceStatus = RemoteState<unknown>['status']
type NoticeKind = 'loading' | 'empty' | 'error' | 'permission' | 'stale' | 'offline' | 'unknown'

interface ContextNotice {
  kind: NoticeKind
  title: string
  detail?: string
}

/**
 * `T59-503` — context bền vững của sáu workspace. Draft, Active Package,
 * desired intent và runtime read-back là bốn dữ kiện khác nhau; component này
 * cố ý không gộp `desiredEnabled=true` thành `RUNNING`.
 */
export function ProgrammingContextBar({
  projectStatus,
  runtimeStatus,
  runtime,
  intentStatus,
  intents,
  intentError,
  editing,
  canMutate
}: {
  projectStatus: ResourceStatus
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  intentStatus: ResourceStatus
  intents: ProgrammingProgramIntentList | null
  intentError: string | null
  editing: ProgrammingEditingContext | null
  canMutate: boolean
}) {
  const { pick } = useI18n()
  const coreBadgeState = coreConnectionBadge(runtimeStatus, runtime?.producerState)
  const coreLabel = coreConnectionLabel(pick, runtimeStatus, runtime?.producerState)
  const notice = contextNotice({
    pick,
    projectStatus,
    runtimeStatus,
    runtime,
    intentStatus,
    intents,
    intentError,
    editing,
    canMutate
  })

  return (
    <section
      aria-labelledby="programming-context-title"
      className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-3 text-sm"
    >
      <h2 id="programming-context-title" className="sr-only">
        {pick('Ngữ cảnh Lập trình hiện tại', 'Current Programming context')}
      </h2>
      <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-6">
        <ContextValue label={pick('Controller / Core', 'Controller / Core')}>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[var(--c-text)]">{runtime?.controllerId ?? pick('— chưa rõ', '— unknown')}</span>
            <StatusBadge state={coreBadgeState} label={coreLabel} />
          </span>
        </ContextValue>
        <ContextValue label={pick('Project', 'Project')}>
          <span className="text-[var(--c-text)]">{projectValue(pick, projectStatus, editing?.projectName)}</span>
        </ContextValue>
        <ContextValue label={pick('Bản nháp đang sửa', 'Editing draft')}>
          <span className="break-all font-mono text-[var(--c-text)]">{projectValue(pick, projectStatus, editing?.draftRevisionId)}</span>
          {editing?.dirty ? <strong className="ml-1 text-[var(--c-warn-fg)]">· {pick('Chưa lưu', 'Unsaved')}</strong> : null}
          {editing && editing.checkState !== 'idle' ? (
            <span className="ml-1 text-[var(--c-text-dim)]">· {checkStateLabel(pick, editing.checkState)}</span>
          ) : null}
        </ContextValue>
        <ContextValue label={pick('Active Package', 'Active package')}>
          <span className="break-all font-mono text-[var(--c-text)]">{activeValue(pick, runtimeStatus, runtime)}</span>
        </ContextValue>
        <ContextValue label={pick('Ý định Enable', 'Enable intent')}>
          <IntentBadge pick={pick} projectStatus={projectStatus} intentStatus={intentStatus} intents={intents} editing={editing} />
        </ContextValue>
        <ContextValue label={pick('Runtime thực tế', 'Actual runtime')}>
          <RuntimeBadge
            pick={pick}
            projectStatus={projectStatus}
            runtimeStatus={runtimeStatus}
            runtime={runtime}
            intentStatus={intentStatus}
            intents={intents}
            editing={editing}
          />
        </ContextValue>
      </dl>
      {notice ? <ContextStateNotice notice={notice} /> : null}
    </section>
  )
}

function ContextValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mt-1 min-h-6 leading-6">{children}</dd>
    </div>
  )
}

function IntentBadge({
  pick,
  projectStatus,
  intentStatus,
  intents,
  editing
}: {
  pick: (vi: string, en: string) => string
  projectStatus: ResourceStatus
  intentStatus: ResourceStatus
  intents: ProgrammingProgramIntentList | null
  editing: ProgrammingEditingContext | null
}) {
  if (projectStatus === 'loading' || (editing && intentStatus === 'loading')) {
    return <StatusBadge state="unknown" label={pick('Đang tải…', 'Loading…')} />
  }
  if (projectStatus === 'error' || intentStatus === 'error') {
    return <StatusBadge state="fault" label={pick('Không đọc được', 'Unavailable')} />
  }
  if (!editing || !intents || intents.items.length === 0) {
    return <StatusBadge state="off" label={pick('Chưa có chương trình', 'No programs')} />
  }
  const enabled = intents.items.filter((item) => item.desiredEnabled).length
  return (
    <StatusBadge
      state={enabled > 0 ? 'on' : 'off'}
      label={pick(`${enabled}/${intents.items.length} muốn bật`, `${enabled}/${intents.items.length} enabled by intent`)}
    />
  )
}

function RuntimeBadge({
  pick,
  projectStatus,
  runtimeStatus,
  runtime,
  intentStatus,
  intents,
  editing
}: {
  pick: (vi: string, en: string) => string
  projectStatus: ResourceStatus
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  intentStatus: ResourceStatus
  intents: ProgrammingProgramIntentList | null
  editing: ProgrammingEditingContext | null
}) {
  if (runtimeStatus === 'error' || runtime?.producerState === 'UNAVAILABLE') {
    return <StatusBadge state="offline" label={pick('Không kết nối được Core', 'Core unreachable')} />
  }
  if (runtime?.producerState === 'DEGRADED') {
    return <StatusBadge state="stale" label={pick('Dữ liệu đã cũ', 'Data is stale')} />
  }
  if (projectStatus === 'loading' || runtimeStatus === 'loading' || (editing && intentStatus === 'loading')) {
    return <StatusBadge state="unknown" label={pick('Đang tải…', 'Loading…')} />
  }
  if (projectStatus === 'error' || intentStatus === 'error') {
    return <StatusBadge state="fault" label={pick('Không đọc được', 'Unavailable')} />
  }
  if (!runtime || !editing || !intents || intents.items.length === 0) {
    return <StatusBadge state="off" label={pick('Chưa có chương trình', 'No programs')} />
  }

  const counts = countRuntimeStates(intents)
  const label = runtimeStateSummary(counts)
  const state = counts.FAULTED > 0
    ? 'fault'
    : counts.UNKNOWN > 0
      ? 'unknown'
      : counts.STARTING > 0 || counts.STOPPING > 0 || counts.WAITING > 0
        ? 'warning'
        : counts.RUNNING > 0
          ? 'online'
          : 'stopped'
  return <StatusBadge state={state} label={label} />
}

function countRuntimeStates(intents: ProgrammingProgramIntentList): Record<ProgrammingProgramRuntimeState, number> {
  const counts: Record<ProgrammingProgramRuntimeState, number> = {
    DISABLED: 0,
    STARTING: 0,
    RUNNING: 0,
    WAITING: 0,
    STOPPING: 0,
    FAULTED: 0,
    UNKNOWN: 0
  }
  for (const item of intents.items) counts[item.runtimeState] += 1
  return counts
}

function runtimeStateSummary(counts: Record<ProgrammingProgramRuntimeState, number>): string {
  const order: ProgrammingProgramRuntimeState[] = ['FAULTED', 'UNKNOWN', 'STARTING', 'STOPPING', 'WAITING', 'RUNNING', 'DISABLED']
  return order.filter((state) => counts[state] > 0).map((state) => `${state} ${counts[state]}`).join(' · ')
}

function contextNotice({
  pick,
  projectStatus,
  runtimeStatus,
  runtime,
  intentStatus,
  intents,
  intentError,
  editing,
  canMutate
}: {
  pick: (vi: string, en: string) => string
  projectStatus: ResourceStatus
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  intentStatus: ResourceStatus
  intents: ProgrammingProgramIntentList | null
  intentError: string | null
  editing: ProgrammingEditingContext | null
  canMutate: boolean
}): ContextNotice | null {
  if (runtimeStatus === 'error' || runtime?.producerState === 'UNAVAILABLE') {
    return {
      kind: 'offline',
      title: pick('Không kết nối được Core', 'Core is unreachable'),
      detail: runtime?.observedAt
        ? pick(`Active last-known lúc ${formatObservedAt(runtime.observedAt)}; mọi thao tác thay đổi runtime bị khóa.`, `Active was last known at ${formatObservedAt(runtime.observedAt)}; runtime mutations are locked.`)
        : pick('Không có read-back đủ tin cậy; mọi thao tác thay đổi runtime bị khóa.', 'There is no trustworthy read-back; runtime mutations are locked.')
    }
  }
  if (runtime?.producerState === 'DEGRADED') {
    return {
      kind: 'stale',
      title: pick('Dữ liệu đã cũ', 'Data is stale'),
      detail: pick(`Lần đọc gần nhất: ${formatObservedAt(runtime.observedAt)}. Hãy làm mới trước khi thao tác.`, `Last observed: ${formatObservedAt(runtime.observedAt)}. Refresh before acting.`)
    }
  }
  if (projectStatus === 'error') {
    return { kind: 'error', title: pick('Không tải được Project.', 'Could not load the project.') }
  }
  if (intentStatus === 'error') {
    return {
      kind: 'error',
      title: pick('Không tải được trạng thái chương trình.', 'Could not load program states.'),
      detail: intentError ?? undefined
    }
  }
  if (runtimeStatus === 'ready' && !runtime) {
    return { kind: 'unknown', title: pick('Chưa xác định kết quả — đang đối soát', 'Result unknown — reconciling') }
  }
  if (intents?.items.some((item) => item.runtimeState === 'UNKNOWN')) {
    return {
      kind: 'unknown',
      title: pick('Chưa xác định kết quả — đang đối soát', 'Result unknown — reconciling'),
      detail: pick('Ý định Enable được giữ riêng; không tự suy Program đang chạy.', 'Enable intent is preserved separately; the Program is not assumed to be running.')
    }
  }
  if (projectStatus === 'ready' && !editing) {
    return { kind: 'empty', title: pick('Chưa có chương trình', 'No programs yet') }
  }
  if (intentStatus === 'ready' && intents && intents.items.length === 0) {
    return { kind: 'empty', title: pick('Chưa có chương trình', 'No programs yet') }
  }
  if (projectStatus === 'loading' || runtimeStatus === 'loading' || intentStatus === 'loading') {
    return { kind: 'loading', title: pick('Đang tải dữ liệu Programming…', 'Loading Programming data…') }
  }
  if (!canMutate) {
    return {
      kind: 'permission',
      title: pick('Bạn không có quyền thực hiện thao tác này', 'You do not have permission to perform this action'),
      detail: pick('Ngữ cảnh vẫn hiển thị ở chế độ chỉ đọc; máy chủ tiếp tục là nơi quyết định quyền.', 'Context remains visible in read-only mode; the server remains the permission authority.')
    }
  }
  return null
}

function ContextStateNotice({ notice }: { notice: ContextNotice }) {
  const Icon = notice.kind === 'loading'
    ? Loader2
    : notice.kind === 'offline'
      ? WifiOff
      : notice.kind === 'permission'
        ? ShieldAlert
        : AlertTriangle
  const tone = notice.kind === 'error' || notice.kind === 'offline'
    ? 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
    : notice.kind === 'stale' || notice.kind === 'unknown'
      ? 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'
      : 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)]'
  const role = notice.kind === 'error' || notice.kind === 'offline' || notice.kind === 'unknown' ? 'alert' : 'status'

  return (
    <div role={role} className={`mt-3 flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-xs ${tone}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${notice.kind === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>
        <strong>{notice.title}</strong>
        {notice.detail ? <span className="mt-0.5 block">{notice.detail}</span> : null}
      </span>
    </div>
  )
}

function projectValue(
  pick: (vi: string, en: string) => string,
  status: ResourceStatus,
  value: string | undefined
): string {
  if (status === 'loading') return pick('Đang tải…', 'Loading…')
  if (status === 'error') return pick('— không đọc được', '— unavailable')
  return value || pick('— chưa có', '— none')
}

function activeValue(
  pick: (vi: string, en: string) => string,
  status: ResourceStatus,
  runtime: ProgrammingRuntime | null
): string {
  if (status === 'loading') return pick('Đang tải…', 'Loading…')
  if (status === 'error') return pick('— không đọc được', '— unavailable')
  return runtime?.activeRevisionId ?? pick('— chưa có', '— none')
}

function formatObservedAt(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString()
}

function checkStateLabel(
  pick: (vi: string, en: string) => string,
  state: ProgrammingEditingContext['checkState']
): string {
  if (state === 'checking') return pick('Đang kiểm tra', 'Checking')
  if (state === 'passed') return pick('Kiểm tra đạt', 'Check passed')
  if (state === 'failed') return pick('Kiểm tra lỗi', 'Check failed')
  if (state === 'unknown') return pick('Kết quả chưa xác định', 'Result unknown')
  return ''
}

function coreConnectionBadge(status: ResourceStatus, producerState?: ProgrammingTargetState) {
  if (status === 'loading' || (status === 'ready' && !producerState)) return 'unknown'
  if (status === 'error' || producerState === 'UNAVAILABLE') return 'disconnected'
  if (producerState === 'DEGRADED') return 'degraded'
  return 'connected'
}

function coreConnectionLabel(
  pick: (vi: string, en: string) => string,
  status: ResourceStatus,
  producerState?: ProgrammingTargetState
): string {
  if (status === 'loading') return pick('Đang tải…', 'Loading…')
  if (status === 'error' || producerState === 'UNAVAILABLE') return pick('Không kết nối được Core', 'Core unreachable')
  if (status === 'ready' && !producerState) return pick('Chưa xác định', 'Unknown')
  if (producerState === 'DEGRADED') return pick('Core suy giảm', 'Core degraded')
  return pick('Core đang chạy', 'Core running')
}
