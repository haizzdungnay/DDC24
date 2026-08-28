import { useI18n } from '../../../shared/i18n'
import type { ReactNode } from 'react'
import { Panel } from '../../../shared/components/Panel'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import type { ProgrammingRuntime } from '../model/types'
import { programmingCoreTruth } from '../shared/runtimeTruth'

/**
 * Tab "Runtime" của PGM-04 (`UJ-PROG-07`) — `RuntimeSummary` + `TaskRuntimeTable`
 * + `CoreConnectionPanel`. Metric Task được chụp cùng point snapshot ở cuối
 * scan; thiếu snapshot giữ `—`, không suy ra từ nhịp poll của trình duyệt.
 */
export function RuntimeTab({ runtime, status }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error' }) {
  const { pick } = useI18n()
  const truth = programmingCoreTruth({ status, data: runtime })
  const coreState = truth === 'ready' ? 'connected' : truth === 'degraded' ? 'degraded' : truth === 'unavailable' ? 'disconnected' : truth === 'stale' ? 'stale' : 'unknown'
  const coreLabel =
    truth === 'unavailable'
      ? pick('Không kết nối được Core', 'Core unreachable')
      : truth === 'degraded'
        ? pick('Core suy giảm', 'Core degraded')
        : truth === 'ready'
          ? pick('Core sẵn sàng', 'Core ready')
          : truth === 'stale'
            ? pick('Snapshot Core cũ', 'Stale Core snapshot')
            : pick('Trạng thái Core chưa xác định', 'Core state unknown')
  const task = runtime?.task
  const taskBadge = taskPresentation(truth, runtime?.taskState)
  const runtimeConfirmed = truth === 'ready' && runtime !== null

  const observedAge = runtimeConfirmed ? formatAge(runtime?.observedAt) : null
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <Panel title={pick('Runtime hiện tại', 'Current runtime')} className="lg:col-span-7">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RuntimeMetric label={pick('Tác vụ', 'Task')}>
              <StatusBadge state={taskBadge.state} label={taskBadge.label} />
            </RuntimeMetric>
            <RuntimeMetric label="Task ID" value={runtimeConfirmed && task ? task.taskId : '—'} mono />
            <RuntimeMetric label={pick('Chu kỳ', 'Period')} value={runtimeConfirmed && task ? `${task.periodMs} ms` : '—'} />
            <RuntimeMetric label={pick('Ngân sách', 'Budget')} value={runtimeConfirmed && task ? `${task.budgetMs} ms` : '—'} />
            <RuntimeMetric label={pick('Số lần chạy', 'Run count')} value={runtimeConfirmed && task ? String(task.runCount) : '—'} />
            <RuntimeMetric label={pick('Lần chạy gần nhất', 'Last run')} value={runtimeConfirmed && task ? formatDuration(task.lastExecNs) : '—'} />
            <RuntimeMetric label={pick('Thời gian lớn nhất', 'Maximum')} value={runtimeConfirmed && task ? formatDuration(task.maxExecNs) : '—'} />
            <RuntimeMetric label={pick('Quá giờ / lỡ nhịp', 'Overruns / missed')} value={runtimeConfirmed && task ? `${task.overrunCount} / ${task.missedReleaseCount}` : '—'} />
            <RuntimeMetric className="col-span-2 sm:col-span-4" label={pick('Trạng thái an toàn', 'Safe state')} value={runtimeConfirmed ? (runtime.safeState ? pick('ĐANG TÁC ĐỘNG', 'ACTIVE') : pick('Bình thường', 'Normal')) : '—'} />
          </dl>
        {truth === 'ready' && runtime?.safeState && (
          runtime.safeStateNoControllerOnly ? (
            <div role="status" className="mt-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
              <p className="font-semibold">PRG-SAFE-ACTIVE — {pick('Chưa có output vật lý do Program điều khiển', 'No physical output is Program-controlled yet')}</p>
              <p className="mt-1 text-xs">
                {pick('Nguyên nhân: chưa Program nào ghi AO/DO vật lý ở mức trên Default — bình thường nếu logic chỉ dùng Virtual Point.', 'Reason: no Program is writing physical AO/DO above the Default level yet — expected if this logic only uses Virtual Points.')} · {pick('Phạm vi', 'Scope')}: {task?.taskId ?? 'Control_Main'} / {pick('các output do Program điều khiển', 'Program-controlled outputs')}.
              </p>
              <p className="mt-1 text-xs">{pick('Đưa vào vận hành và Khôi phục KHÔNG bị khóa vì lý do này.', 'Commission and Restore are NOT locked because of this.')}</p>
            </div>
          ) : (
            <div role="alert" className="mt-3 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
              <p className="font-semibold">PRG-SAFE-ACTIVE — {pick('Safe-state đang tác động do lỗi', 'Safe-state is active due to a fault')}</p>
              <p className="mt-1 text-xs">
                {pick('Nguyên nhân: I/O lỗi/dữ liệu cũ/quá giờ — Core chưa cung cấp mã chi tiết hơn.', 'Reason: I/O fault/stale data/overrun — Core did not provide a more detailed code.')} · {pick('Phạm vi', 'Scope')}: {task?.taskId ?? 'Control_Main'} / {pick('các output do Program điều khiển', 'Program-controlled outputs')}.
              </p>
              <p className="mt-1 text-xs">{pick('Hành động: giữ Commission/Restore bị khóa và kiểm tra Core, I/O, alarm.', 'Action: keep Commission/Restore locked and inspect Core, I/O, and alarms.')}</p>
            </div>
          )
        )}
        </Panel>

        <Panel title={pick('Chuỗi bằng chứng đang chạy', 'Live evidence chain')} className="lg:col-span-5">
          <ol className="space-y-3" aria-label={pick('Chuỗi bằng chứng runtime', 'Runtime evidence chain')}>
            <EvidenceStep index="01" label="Core / producer">
              <StatusBadge state={coreState} label={coreLabel} />
            </EvidenceStep>
            <EvidenceStep index="02" label={pick('Bản đang Active', 'Active revision')} mono>
              {runtimeConfirmed ? (runtime.activeRevisionId ?? '—') : '—'}
            </EvidenceStep>
            <EvidenceStep index="03" label={pick('Bản khôi phục gần nhất', 'Last known good revision')} mono>
              {runtimeConfirmed ? (runtime.lkgRevisionId ?? '—') : '—'}
            </EvidenceStep>
          </ol>
          <div className="mt-4 border-t border-[var(--c-border)] pt-3 text-xs text-[var(--c-text-dim)]">
            <p className="font-semibold text-[var(--c-text)]">{pick('Mốc đọc từ Core', 'Observed from Core')}</p>
            <p className="mt-1">{runtimeConfirmed ? `${new Date(runtime.observedAt).toLocaleString()} · ${observedAge}` : '—'}</p>
          </div>
          {truth !== 'ready' ? (
            <p className="mt-3 text-sm text-[var(--c-warn-fg)]">{pick('Dữ liệu runtime chưa được xác nhận là live; Đưa vào vận hành và Khôi phục bị khoá.', 'Runtime data is not confirmed live; Commission and Restore are locked.')}</p>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}

function EvidenceStep({ index, label, mono = false, children }: { index: string; label: string; mono?: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--c-accent)] bg-[var(--c-accent-soft)] font-mono text-[11px] font-bold text-[var(--c-accent)]">{index}</span>
      <div className="min-w-0 border-b border-[var(--c-border)] pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{label}</p>
        <div className={`mt-1 break-all text-sm text-[var(--c-text)] ${mono ? 'font-mono text-xs' : ''}`}>{children}</div>
      </div>
    </li>
  )
}

function RuntimeMetric({
  label,
  value,
  mono = false,
  className,
  children
}: {
  label: string
  value?: string
  mono?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{label}</dt>
      <dd className={`mt-1 min-w-0 break-all text-[var(--c-text)] ${mono ? 'font-mono text-xs' : ''}`}>{children ?? value}</dd>
    </div>
  )
}

/** Không được nâng một taskState trong snapshot/degraded response thành lỗi
 * runtime đang hoạt động. Chỉ producer READY mới cho phép diễn giải FAULT hoặc
 * RUNNING; các nguồn khác mang nhãn nguồn tương ứng và fail-closed. */
function taskPresentation(
  truth: ReturnType<typeof programmingCoreTruth>,
  taskState: ProgrammingRuntime['taskState'] | undefined
): { state: 'online' | 'fault' | 'stale' | 'degraded' | 'disconnected' | 'unknown'; label: string } {
  const state = taskState ?? 'UNKNOWN'
  if (truth === 'ready') {
    if (state === 'RUNNING') return { state: 'online', label: state }
    if (state === 'FAULT') return { state: 'fault', label: state }
    return { state: 'unknown', label: state }
  }
  if (truth === 'stale') return { state: 'stale', label: `STALE · ${state}` }
  if (truth === 'degraded') return { state: 'degraded', label: `DEGRADED · ${state}` }
  if (truth === 'unavailable') return { state: 'disconnected', label: `CORE UNAVAILABLE · ${state}` }
  return { state: 'unknown', label: 'UNKNOWN' }
}

function formatDuration(valueNS: number): string {
  if (valueNS >= 1_000_000) return `${(valueNS / 1_000_000).toFixed(2)} ms`
  if (valueNS >= 1_000) return `${(valueNS / 1_000).toFixed(1)} µs`
  return `${valueNS} ns`
}

function formatAge(observedAt: string): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(observedAt)) / 1000))
  if (!Number.isFinite(ageSeconds)) return 'UNKNOWN'
  if (ageSeconds < 60) return `${ageSeconds} s`
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} min`
  return `${Math.floor(ageSeconds / 3600)} h`
}
