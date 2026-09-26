import { useI18n } from '../../../../../shared/i18n'
import type { InspectorField } from '../inspectorContext'
import { formatProgrammingPeriod, programmingPeriodValidity } from '../../../model/cyclePeriods'

export interface ExecutionSectionProps {
  cycleMs: InspectorField<number>
  taskName: InspectorField<string>
  scheduled: InspectorField<boolean>
  pouKind: InspectorField<'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'>
  /**
   * Mở màn hình cấu hình chạy (`?tab=execution`).
   *
   * `undefined` nghĩa là **không render lối vào nào** — đó là câu trả lời cho
   * "chế độ này không sửa" (LIVE/SIMULATE, dưới 768 px), đúng luật
   * `AC-PGM02-006`/`T59-812`: một nút bị vô hiệu hoá vẫn là một nút có mặt trên
   * màn hình, còn bề mặt chỉ đọc phải đếm bằng 0 lối ghi. Chủ quản của quyết
   * định ấy là `EditorPane` (nơi biết `canEdit`), không phải component này.
   */
  onOpenExecutionTab?: () => void
}

/** Hiển thị chu kỳ theo ADR-061 mục 4.13; chu kỳ không còn trong tập (30 s cũ)
 *  được đánh dấu thay vì im lặng như một giá trị hợp lệ. */
function IntervalValue({ periodMs }: { periodMs: number }) {
  const { pick } = useI18n()
  const validity = programmingPeriodValidity(periodMs)
  return (
    <>
      {formatProgrammingPeriod(periodMs)}
      {validity !== 'VALID' && (
        <span className="ml-1 font-sans text-[var(--c-warn-fg)]" data-testid="execution-interval-invalid">
          {pick('(không còn hợp lệ)', '(no longer valid)')}
        </span>
      )}
    </>
  )
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
export function ExecutionSection({ cycleMs, taskName, scheduled, pouKind, onOpenExecutionTab }: ExecutionSectionProps) {
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
              {cycleMs.known ? <IntervalValue periodMs={cycleMs.value} /> : pick('không xác định được', 'not determinable')}
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
      {/* Lối vào cấu hình chạy nằm ĐÚNG ở mục nói về thực thi. Trước lát này nó
          chỉ còn một liên kết nằm trong mục `Tham chiếu` — mục đóng sẵn — nên
          trên thực tế người dùng không có lối vào nào thấy được, và
          `UJ-PROG-01..08` chờ một nút không còn tồn tại cho tới khi hết giờ.

          Là `<button>` chứ không phải liên kết: đích đến là một tab con của
          CHÍNH trang này (`?tab=execution`), không phải một địa chỉ khác; và
          `<button>` nhận cả Enter lẫn Space, đúng thứ `AC-1` đòi. */}
      {onOpenExecutionTab && (
        <button
          type="button"
          data-testid="execution-open-config"
          onClick={onOpenExecutionTab}
          className="mt-2 inline-flex min-h-9 items-center rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-accent)] hover:border-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
        >
          {pick('Cấu hình chạy', 'Run configuration')}
        </button>
      )}
    </details>
  )
}
