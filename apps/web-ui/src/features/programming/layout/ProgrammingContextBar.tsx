import { useI18n } from '../../../shared/i18n'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import type { ProgrammingRuntime, ProgrammingTargetState } from '../model/types'
import type { ProgrammingEditingContext } from './ProgrammingLayout'

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
  editing
}: {
  runtimeStatus: 'loading' | 'ready' | 'error'
  runtime: ProgrammingRuntime | null
  editing: ProgrammingEditingContext | null
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
      <span className="text-[var(--c-text-dim)]">
        {pick('CONTROLLER', 'CONTROLLER')}:{' '}
        <span className="font-mono text-[var(--c-text)]">{runtime?.controllerId ?? pick('— chưa rõ', '— unknown')}</span>
      </span>
      <span className="text-[var(--c-text-dim)]">
        {pick('PROJECT', 'PROJECT')}:{' '}
        <span className="text-[var(--c-text)]">{editing?.projectName ?? pick('— chưa có', '— none')}</span>
      </span>
      <span className="text-[var(--c-text-dim)]">
        {pick('ĐANG SỬA', 'EDITING')}:{' '}
        <span className="font-mono text-[var(--c-text)]">{editing?.draftRevisionId ?? pick('— chưa có', '— none')}</span>
        {editing?.dirty ? <strong className="ml-1 text-[var(--c-warn-fg)]">· {pick('Chưa lưu', 'Unsaved')}</strong> : null}
        {editing && editing.checkState !== 'idle' ? (
          <span className="ml-1 text-[var(--c-text-dim)]">· {checkStateLabel(pick, editing.checkState)}</span>
        ) : null}
      </span>
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
