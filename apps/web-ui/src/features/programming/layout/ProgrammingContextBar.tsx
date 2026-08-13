import { useI18n } from '../../../shared/i18n'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import type { ProgrammingRuntime, ProgrammingTargetState } from '../model/types'

/**
 * `ProgrammingContextBar` — UX §4/§16.1.4: phải hiện đồng thời "Đang sửa" và
 * "Đang vận hành" trên MỌI trang Programming, cộng trạng thái Core. Đây là
 * persistent context, không phải mutation surface.
 *
 * Rev A chỉ có một Project/controller nên "Đang sửa" ở tầng layout chỉ hiện
 * khi route hiện tại đã xác định `projectId` (PGM-02/03); PGM-01/PGM-04 chỉ
 * hiện Core + Active — đúng những gì layout thực sự biết mà không tự suy diễn.
 */
export function ProgrammingContextBar({
  runtimeStatus,
  runtime,
  activeProjectId
}: {
  runtimeStatus: 'loading' | 'ready' | 'error'
  runtime: ProgrammingRuntime | null
  activeProjectId?: string
}) {
  const { pick } = useI18n()
  const coreBadgeState = coreConnectionBadge(runtimeStatus, runtime?.producerState)
  const coreLabel = coreConnectionLabel(pick, runtimeStatus, runtime?.producerState)

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-2.5 text-sm"
      role="status"
      aria-live="polite"
    >
      {activeProjectId && (
        <span className="text-[var(--c-text-dim)]">
          {pick('Project', 'Project')}: <span className="font-mono text-[var(--c-text)]">{activeProjectId}</span>
        </span>
      )}
      <span className="text-[var(--c-text-dim)]">
        {pick('ĐANG VẬN HÀNH', 'RUNNING')}:{' '}
        <span className="font-mono text-[var(--c-text)]">{runtime?.activeRevisionId ?? pick('— chưa có', '— none')}</span>
      </span>
      <span className="flex items-center gap-2 text-[var(--c-text-dim)]">
        {pick('Core', 'Core')}: <StatusBadge state={coreBadgeState} label={coreLabel} />
      </span>
    </div>
  )
}

function coreConnectionBadge(status: 'loading' | 'ready' | 'error', producerState?: ProgrammingTargetState) {
  if (status === 'loading') return 'unknown'
  if (status === 'error' || producerState === 'UNAVAILABLE') return 'disconnected'
  if (producerState === 'DEGRADED') return 'degraded'
  return 'connected'
}

function coreConnectionLabel(
  pick: (vi: string, en: string) => string,
  status: 'loading' | 'ready' | 'error',
  producerState?: ProgrammingTargetState
): string {
  if (status === 'loading') return pick('Đang tải…', 'Loading…')
  if (status === 'error' || producerState === 'UNAVAILABLE') return pick('Không kết nối được Core', 'Core unreachable')
  if (producerState === 'DEGRADED') return pick('Core suy giảm', 'Core degraded')
  return pick('Core đang chạy', 'Core running')
}
