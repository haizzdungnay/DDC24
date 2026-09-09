import { useI18n } from '../../../../../shared/i18n'
import type { InspectorField } from '../inspectorContext'

export interface ExecutionSectionProps {
  cycleMs: InspectorField<number>
  taskName: InspectorField<string>
  scheduled: InspectorField<boolean>
  pouKind: InspectorField<'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'>
}

function formatInterval(periodMs: number): string {
  return periodMs >= 1000 && periodMs % 1000 === 0 ? `${periodMs / 1000} s` : `${periodMs} ms`
}

function UnknownField({ label }: { label: string }) {
  const { pick } = useI18n()
  return (
    <>
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</dd>
    </>
  )
}

/**
 * Context thực thi của POU. Resource/Mode/Priority/Watchdog chưa có trong Draft
 * nên luôn hiện unknown; component tuyệt đối không dựng `CPU_Main`/`Cyclic` giả.
 */
export function ExecutionSection({ cycleMs, taskName, scheduled, pouKind }: ExecutionSectionProps) {
  const { pick } = useI18n()
  const callable = pouKind.known && pouKind.value !== 'PROGRAM'

  return (
    <details open className="mt-3 border-t border-[var(--c-border)]/70 pt-2 text-xs" data-testid="inspector-execution-section">
      <summary className="cursor-pointer font-medium text-[var(--c-text-dim)] hover:text-[var(--c-text)]">{pick('Thực thi', 'Execution')}</summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <UnknownField label="Resource" />
        <dt className="text-[var(--c-text-dim)]">Task</dt>
        <dd className={taskName.known ? 'text-[var(--c-text)]' : 'italic text-[var(--c-text-dim)]'}>
          {taskName.known ? taskName.value : pick('không xác định được', 'not determinable')}
        </dd>
        <UnknownField label={pick('Chế độ', 'Mode')} />
        {!callable && (
          <>
            <dt className="text-[var(--c-text-dim)]">{pick('Chu kỳ', 'Interval')}</dt>
            <dd className={cycleMs.known ? 'font-mono text-[var(--c-text)]' : 'italic text-[var(--c-text-dim)]'} data-testid="execution-interval">
              {cycleMs.known ? formatInterval(cycleMs.value) : pick('không xác định được', 'not determinable')}
            </dd>
          </>
        )}
        <UnknownField label={pick('Ưu tiên', 'Priority')} />
        <UnknownField label="Watchdog" />
        <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái mong muốn', 'Desired state')}</dt>
        <dd className={scheduled.known ? 'text-[var(--c-text)]' : 'italic text-[var(--c-text-dim)]'} data-testid="execution-scheduled">
          {!scheduled.known
            ? pick('không xác định được', 'not determinable')
            : callable
              ? pick('Chạy khi được gọi', 'Runs when called')
              : scheduled.value
                ? pick('Đã xếp lịch chạy', 'Scheduled to run')
                : pick('Chưa xếp lịch chạy', 'Not scheduled to run')}
        </dd>
      </dl>
    </details>
  )
}
