import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import type { ProgrammingRuntime } from '../model/types'

/**
 * Tab "Runtime" của PGM-04 (`UJ-PROG-07`) — `RuntimeSummary` + `TaskRuntimeTable`
 * + `CoreConnectionPanel`. `max/overrun/last-run` của Task KHÔNG có trong
 * STATUS payload UDS v1 hiện tại (`RuntimeOperationSnapshot` chỉ mang
 * producer/active/lkg/overrideIds, không có metric Task) — hiện `—` trung
 * thực thay vì suy đoán, và ghi rõ đây là khoảng hở Core cần một action UDS
 * mới, ngoài phạm vi tối thiểu của P5.
 */
export function RuntimeTab({ runtime, status }: { runtime: ProgrammingRuntime | null; status: 'loading' | 'ready' | 'error' }) {
  const { pick } = useI18n()
  const coreState = status === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE' ? 'disconnected' : runtime.producerState === 'DEGRADED' ? 'degraded' : 'connected'
  const coreLabel =
    status === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE'
      ? pick('Không kết nối được Core', 'Core unreachable')
      : runtime.producerState === 'DEGRADED'
        ? pick('Core suy giảm', 'Core degraded')
        : pick('Core đang chạy', 'Core running')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
            <dd className="text-[var(--c-text-dim)]">{runtime ? new Date(runtime.observedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
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
              <td className="py-1 pr-3 text-[var(--c-text-dim)]">—</td>
              <td className="py-1 pr-3 text-[var(--c-text-dim)]">—</td>
              <td className="py-1 text-[var(--c-text-dim)]">—</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--c-text-dim)]">
          {pick(
            'Chu kỳ/lớn nhất/số lần quá giờ chưa có trong hợp đồng UDS STATUS hiện tại — Core cần bổ sung action riêng để mang metric Task, ngoài phạm vi tối thiểu của P5.',
            'Last/max run and overrun count are not part of the current UDS STATUS contract — Core needs a dedicated action to carry task metrics; out of P5 minimal scope.'
          )}
        </p>
      </Panel>
    </div>
  )
}
