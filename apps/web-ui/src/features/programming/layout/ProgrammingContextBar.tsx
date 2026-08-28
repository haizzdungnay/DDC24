import { Info } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useI18n } from '../../../shared/i18n'
import { formatDataAge, formatDateTime } from '../../../shared/utils'
import { useAuth } from '../../auth'
import type { ProgrammingCapabilities, ProgrammingRuntime, RemoteState } from '../model/types'
import { programmingCoreTruth, type ProgrammingCoreTruth } from '../shared/runtimeTruth'
import { ProgrammingContextDrawer } from './ProgrammingContextDrawer'
import type { ProgrammingEditingContext } from './ProgrammingLayout'
import type { ProgrammingProjectRouteState } from './ProjectRouteGuard'

const TOP_BAR_HEIGHT_PX = 64

/** Persistent context cho cả bốn workspace. Active Revision là identity riêng,
 * không được gắn nhãn RUNNING; Core và task là các nguồn sự thật độc lập. */
export function ProgrammingContextBar({
  runtime,
  capabilities,
  editing,
  projectRouteState = 'missing',
  requestedProjectId
}: {
  runtime: RemoteState<ProgrammingRuntime>
  capabilities: RemoteState<ProgrammingCapabilities>
  editing: ProgrammingEditingContext | null
  projectRouteState?: ProgrammingProjectRouteState
  requestedProjectId?: string
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const now = useClockTick()
  const stickyTop = useShellStickyTop()
  const truth = programmingCoreTruth(runtime)
  const core = corePresentation(pick, truth)
  const isStale = truth === 'stale'
  const isUnknown = truth === 'unknown'
  const project = projectPresentation(pick, editing, projectRouteState, requestedProjectId)

  useEffect(() => {
    if (!isUnknown || runtime.status !== 'ready') return
    console.warn('[Programming] producerState thiếu hoặc không được hỗ trợ; UI đã fail-closed.')
  }, [isUnknown, runtime.status])

  const details = (tone: 'dark' | 'light') => (
    <ContextDetails
      editing={editing}
      project={project}
      runtime={runtime.data}
      capabilities={capabilities}
      role={session?.role ?? null}
      core={core}
      isStale={isStale}
      isUnknown={isUnknown}
      lastSuccessAt={runtime.lastSuccessAt ?? null}
      now={now}
      tone={tone}
    />
  )

  return (
    <>
      <section
        className="sticky z-20 overflow-hidden rounded-[var(--radius)] border border-[#314150] bg-[#101820] px-3 py-2.5 text-slate-100 shadow-[0_8px_24px_rgba(6,15,23,0.18)] sm:px-4"
        style={{ top: stickyTop }}
        aria-label={pick('Ngữ cảnh Lập trình', 'Programming context')}
      >
        <div className="hidden lg:block" role="status" aria-live="polite">
          {details('dark')}
        </div>

        <div className="flex min-w-0 items-center gap-2 lg:hidden" role="status" aria-live="polite">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-100">
              {project.compactLabel}
            </p>
            <p className="truncate font-mono text-[11px] text-slate-400">
              {pick('Sửa', 'Editing')} {shortRevision(editing?.draftRevisionId)} {'≠'} {pick('Active', 'Active')} {shortRevision(runtime.data?.activeRevisionId)} · {pick('Task', 'Task')} {runtime.data?.taskState ?? '—'}
            </p>
          </div>
          <StatusBadge state={core.badge} label={core.compactLabel} />
          <button
            ref={triggerRef}
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] border border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400 hover:text-white"
            onClick={() => setDrawerOpen(true)}
            aria-label={pick('Mở chi tiết ngữ cảnh Lập trình', 'Open Programming context details')}
            aria-expanded={drawerOpen}
            aria-controls="programming-context-drawer"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      <ProgrammingContextDrawer open={drawerOpen} returnFocusRef={triggerRef} onClose={() => setDrawerOpen(false)}>
        {details('light')}
      </ProgrammingContextDrawer>
    </>
  )
}

function ContextDetails({
  editing,
  project,
  runtime,
  capabilities,
  role,
  core,
  isStale,
  isUnknown,
  lastSuccessAt,
  now,
  tone
}: {
  editing: ProgrammingEditingContext | null
  project: ProjectPresentation
  runtime: ProgrammingRuntime | null
  capabilities: RemoteState<ProgrammingCapabilities>
  role: string | null
  core: CorePresentation
  isStale: boolean
  isUnknown: boolean
  lastSuccessAt: number | null
  now: number
  tone: 'dark' | 'light'
}) {
  const { pick } = useI18n()
  const taskValue = runtime?.taskState
    ? `${runtime.taskState}${runtime.task?.periodMs ? ` · ${runtime.task.periodMs} ms` : ''}`
    : '—'
  const metaClass = tone === 'dark' ? 'border-slate-700 text-slate-400' : 'border-[var(--c-border)] text-[var(--c-text-dim)]'
  return (
    <div className="grid gap-x-4 gap-y-2 text-sm lg:grid-cols-3 xl:grid-cols-7">
      <ContextValue tone={tone} label={pick('CONTROLLER', 'CONTROLLER')} value={runtime?.controllerId ?? pick('— chưa rõ', '— unknown')} mono />
      <ContextValue tone={tone} label={pick('PROJECT', 'PROJECT')} value={project.label} title={project.title} suffix={project.suffix} />
      <ContextValue
        tone={tone}
        label={pick('BẢN ĐANG SỬA', 'EDITING REVISION')}
        value={editing?.draftRevisionId ?? pick('— chưa có', '— none')}
        mono
        suffix={editing?.dirty ? pick('Chưa lưu', 'Unsaved') : undefined}
      />
      <ContextValue tone={tone} label={pick('KIỂM TRA', 'CHECK')} value={checkStateLabel(pick, editing?.checkState ?? 'idle')} />
      <ContextValue tone={tone} label={pick('BẢN ĐANG ACTIVE', 'ACTIVE REVISION')} value={runtime?.activeRevisionId ?? pick('— chưa có', '— none')} mono />
      <ContextValue tone={tone} label="TASK" value={taskValue} mono />
      <div className="min-w-0">
        <span className={`block text-[10px] font-bold tracking-[0.08em] ${tone === 'dark' ? 'text-slate-400' : 'text-[var(--c-text-dim)]'}`}>CORE</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StatusBadge state={core.badge} label={core.label} />
          {isStale ? <StatusBadge state="stale" label="STALE" /> : null}
        </div>
      </div>

      <div className={`flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] lg:col-span-3 xl:col-span-7 ${metaClass}`}>
        <span><strong>{pick('Profile', 'Profile')}:</strong> {capabilities.status === 'ready' ? capabilities.data?.profile ?? '—' : capabilities.status === 'error' ? 'UNAVAILABLE' : pick('Đang tải', 'Loading')}</span>
        <span><strong>{pick('Ngôn ngữ', 'Languages')}:</strong> {capabilities.data?.languages.join(' / ') || '—'}</span>
        <span><strong>{pick('Chu kỳ cho phép', 'Allowed periods')}:</strong> {capabilities.data?.taskPeriodsMs.length ? capabilities.data.taskPeriodsMs.map((value) => `${value} ms`).join(' / ') : '—'}</span>
        <span><strong>{pick('Quyền phiên', 'Session role')}:</strong> {(role ?? '—').toUpperCase()}</span>
      </div>

      {isStale ? (
        <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)] lg:col-span-3 xl:col-span-7" role="alert">
          <strong>{pick('Đang hiển thị snapshot cuối, không phải dữ liệu live.', 'Showing the last-known snapshot, not live data.')}</strong>{' '}
          {pick('Tuổi snapshot', 'Snapshot age')}: {formatDataAge(runtime?.observedAt, now)} · {pick('Quan sát lúc', 'Observed')}: {formatDateTime(runtime?.observedAt)} · {pick('Đọc thành công cuối', 'Last successful read')}: {formatEpoch(lastSuccessAt)}.
          {' '}{pick('Các thao tác phụ thuộc authority runtime đang bị khóa.', 'Mutations that depend on runtime authority are locked.')}
        </div>
      ) : null}
      {isUnknown ? (
        <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)] lg:col-span-3 xl:col-span-7" role="alert">
          <strong>{pick('Core trả trạng thái thiếu hoặc không được hỗ trợ.', 'Core returned a missing or unsupported state.')}</strong>{' '}
          {pick('FE giữ fail-closed: không coi Core hay task là đang chạy và khóa các thao tác phụ thuộc authority runtime.', 'The UI fails closed: Core and task are not treated as running, and mutations that depend on runtime authority are locked.')}
        </div>
      ) : null}
    </div>
  )
}

function ContextValue({
  label,
  value,
  title,
  mono = false,
  suffix,
  tone
}: {
  label: string
  value: string
  title?: string
  mono?: boolean
  suffix?: string
  tone: 'dark' | 'light'
}) {
  const labelClass = tone === 'dark' ? 'text-slate-400' : 'text-[var(--c-text-dim)]'
  const valueClass = tone === 'dark' ? 'text-slate-100' : 'text-[var(--c-text)]'
  return (
    <div className="min-w-0">
      <span className={`block text-[10px] font-bold tracking-[0.08em] ${labelClass}`}>{label}</span>
      <span className={`mt-1 block truncate ${valueClass} ${mono ? 'font-mono' : 'font-medium'}`} title={title ?? value}>{value}</span>
      {suffix ? <strong className="mt-0.5 block text-xs text-[var(--c-warn-fg)]">{suffix}</strong> : null}
    </div>
  )
}

interface CorePresentation {
  badge: 'connected' | 'degraded' | 'disconnected' | 'stale' | 'unknown'
  label: string
  compactLabel: string
}

interface ProjectPresentation {
  label: string
  compactLabel: string
  title?: string
  suffix?: string
}

function projectPresentation(
  pick: (vi: string, en: string) => string,
  editing: ProgrammingEditingContext | null,
  state: ProgrammingProjectRouteState,
  requestedProjectId?: string
): ProjectPresentation {
  if (state === 'invalid') {
    return {
      label: requestedProjectId ?? pick('— không hợp lệ', '— invalid'),
      compactLabel: pick('Project không tồn tại', 'Project not found'),
      title: requestedProjectId,
      suffix: pick('Không tồn tại · mutation bị khóa', 'Not found · mutations locked')
    }
  }
  if (state === 'error') {
    return {
      label: requestedProjectId ?? pick('— chưa xác định', '— unknown'),
      compactLabel: pick('Chưa xác minh được Project', 'Project not validated'),
      title: requestedProjectId,
      suffix: pick('Chưa xác minh · mutation bị khóa', 'Unverified · mutations locked')
    }
  }
  if (state === 'loading' && requestedProjectId) {
    return {
      label: requestedProjectId,
      compactLabel: pick('Đang xác minh Project', 'Validating project'),
      title: requestedProjectId,
      suffix: pick('Đang xác minh', 'Validating')
    }
  }
  return {
    label: editing?.projectName ?? pick('— chưa có', '— none'),
    compactLabel: editing?.projectName ?? pick('Chưa có Project', 'No project'),
    title: editing?.projectId
  }
}

function corePresentation(
  pick: (vi: string, en: string) => string,
  truth: ProgrammingCoreTruth
): CorePresentation {
  if (truth === 'ready') return { badge: 'connected', label: pick('Core sẵn sàng', 'Core ready'), compactLabel: pick('Sẵn sàng', 'Ready') }
  if (truth === 'degraded') return { badge: 'degraded', label: pick('Core suy giảm', 'Core degraded'), compactLabel: pick('Suy giảm', 'Degraded') }
  if (truth === 'unavailable') return { badge: 'disconnected', label: pick('Không kết nối được Core', 'Core unavailable'), compactLabel: pick('Mất kết nối', 'Offline') }
  if (truth === 'stale') return { badge: 'stale', label: pick('Snapshot Core cũ', 'Stale Core snapshot'), compactLabel: 'STALE' }
  if (truth === 'loading') return { badge: 'unknown', label: pick('Đang tải Core…', 'Loading Core…'), compactLabel: pick('Đang tải', 'Loading') }
  return { badge: 'unknown', label: pick('Trạng thái Core chưa xác định', 'Core state unknown'), compactLabel: 'UNKNOWN' }
}

function checkStateLabel(
  pick: (vi: string, en: string) => string,
  state: ProgrammingEditingContext['checkState']
): string {
  if (state === 'checking') return pick('Đang kiểm tra', 'Checking')
  if (state === 'passed') return pick('Đạt', 'Passed')
  if (state === 'failed') return pick('Không đạt', 'Failed')
  if (state === 'unknown') return pick('Chưa xác định', 'Unknown')
  return pick('Chưa kiểm tra', 'Not checked')
}

function shortRevision(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : '—'
}

function formatEpoch(value: number | null): string {
  return value === null ? '—' : new Date(value).toLocaleString()
}

function useClockTick(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** Đo reconnect banner thật để context sticky luôn nằm dưới TopBar/banner,
 * kể cả khi câu cảnh báo xuống dòng ở viewport hẹp. */
function useShellStickyTop(): number {
  const [top, setTop] = useState(TOP_BAR_HEIGHT_PX)
  useLayoutEffect(() => {
    let observedBanner: HTMLElement | null = null
    let resizeObserver: ResizeObserver | null = null

    const update = () => {
      const banner = document.querySelector<HTMLElement>('[data-app-reconnect-banner]')
      if (banner !== observedBanner) {
        resizeObserver?.disconnect()
        observedBanner = banner
        if (banner && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(update)
          resizeObserver.observe(banner)
        }
      }
      setTop(TOP_BAR_HEIGHT_PX + (banner?.getBoundingClientRect().height ?? 0))
    }

    update()
    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])
  return top
}
