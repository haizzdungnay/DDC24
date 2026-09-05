import { useI18n } from '../../../shared/i18n'
import { formatTechnicalDateTime } from '../../../shared/dateTime'
import { Panel } from '../../../shared/components/Panel'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import type { ProgrammingRuntime } from '../model/types'

/**
 * Tab "Runtime" của PGM-06 (`UJ-PROG-07`) — `RuntimeSummary` + `TaskRuntimeTable`
 * + `CoreConnectionPanel`. Metric Task được chụp cùng point snapshot ở cuối
 * scan; thiếu snapshot giữ `—`, không suy ra từ nhịp poll của trình duyệt.
 */
export function RuntimeTab({ runtime, status }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error' }) {
  const { pick, locale } = useI18n()
  const coreState = status === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE' ? 'disconnected' : runtime.producerState === 'DEGRADED' ? 'degraded' : 'connected'
  const coreLabel =
    status === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE'
      ? pick('Không kết nối được Core', 'Core unreachable')
      : runtime.producerState === 'DEGRADED'
        ? pick('Core suy giảm', 'Core degraded')
        : pick('Core đang chạy', 'Core running')
  const task = runtime?.task

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Trạng thái Runtime', 'Runtime status')}</h3>
      <Panel title={pick('Đang vận hành / LKG', 'Active / LKG')}>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--c-text-dim)]">{pick('Đang vận hành', 'Active')}</dt>
            <dd className="font-mono text-[var(--c-text)]">{runtime?.activeRevisionId ?? '—'}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--c-text-dim)]">LKG</dt>
            <dd className="font-mono text-[var(--c-text)]">{runtime?.lkgRevisionId ?? '—'}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái an toàn', 'Safe state')}</dt>
            <dd className="text-[var(--c-text)]">{status === 'ready' && runtime ? (runtime.safeState ? pick('Có', 'Yes') : pick('Không', 'No')) : '—'}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--c-text-dim)]">{pick('Cập nhật lúc', 'Observed at')}</dt>
            <dd className="whitespace-nowrap text-[var(--c-text-dim)]">{formatTechnicalDateTime(runtime?.observedAt, locale)}</dd>
          </div>
        </dl>
        {runtime?.safeState && (
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

      <Panel title={pick('Kết nối Core', 'Core connection')}>
        <div className="flex items-center gap-2">
          <StatusBadge state={coreState} label={coreLabel} />
        </div>
        {status !== 'ready' || !runtime ? null : runtime.producerState !== 'READY' ? (
          <p className="mt-2 text-sm text-[var(--c-warn-fg)]">{pick('Giá trị runtime mang nhãn dữ liệu cũ; Đưa vào vận hành và Khôi phục bị khoá.', 'Runtime values are stale; Commission and Restore are locked.')}</p>
        ) : null}
      </Panel>

      <Panel title={pick('Tác vụ Control_Main', 'Control_Main task')} className="lg:col-span-2">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-[var(--c-text-dim)]">
              <th className="py-1 pr-3">{pick('Trạng thái', 'State')}</th>
              <th className="py-1 pr-3">{pick('Chu kỳ gần nhất', 'Last run')}</th>
              <th className="py-1 pr-3">{pick('Lớn nhất', 'Max')}</th>
              <th className="py-1">{pick('Số lần quá giờ', 'Overrun count')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1 pr-3">
                <StatusBadge state={runtime?.taskState === 'RUNNING' ? 'online' : runtime?.taskState === 'FAULT' ? 'fault' : 'unknown'} label={runtime?.taskState ?? '—'} />
              </td>
              <td className="py-1 pr-3 text-[var(--c-text-dim)]">{task ? formatDuration(task.lastExecNs) : '—'}</td>
              <td className="py-1 pr-3 text-[var(--c-text-dim)]">{task ? formatDuration(task.maxExecNs) : '—'}</td>
              <td className="py-1 text-[var(--c-text-dim)]">{task?.overrunCount ?? '—'}</td>
            </tr>
          </tbody>
        </table>
        {task && <p className="mt-2 text-xs text-[var(--c-text-dim)]">{pick('Chu kỳ', 'Period')}: {task.periodMs} ms · {pick('Ngân sách', 'Budget')}: {task.budgetMs} ms · {pick('Lỡ nhịp', 'Missed releases')}: {task.missedReleaseCount}</p>}
      </Panel>
    </div>
  )
}

function formatDuration(valueNS: number): string {
  if (valueNS >= 1_000_000) return `${(valueNS / 1_000_000).toFixed(2)} ms`
  if (valueNS >= 1_000) return `${(valueNS / 1_000).toFixed(1)} µs`
  return `${valueNS} ns`
}
