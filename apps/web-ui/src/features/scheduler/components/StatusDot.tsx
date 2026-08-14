import type { ScheduleObject, ScheduleRuntimeState } from '../../../shared/types'
import { EM_DASH, overrideSourceLabel, statusPresentation } from '../shared'
import { cn } from '../../../shared/utils'
import { useI18n } from '../../../shared/i18n'

/**
 * Trạng thái lịch. Mỗi trạng thái có KÝ HIỆU riêng, không chỉ có màu — đọc
 * được khi in đen trắng và khi người dùng bị mù màu (nguyên tắc S8).
 */
export function StatusDot({ schedule, className }: { schedule: ScheduleObject; className?: string }) {
  const { lang } = useI18n()
  const p = statusPresentation(schedule.status, lang)
  const applied = schedule.runtime?.applied_revision
  const outOfSync = schedule.status === 'OUT_OF_SYNC'

  return (
    <span className={cn('inline-flex flex-col gap-0.5 text-sm', className)}>
      <span className={cn('inline-flex items-center gap-1.5 font-medium', p.tone)}>
        <span aria-hidden="true">{p.glyph}</span>
        {p.label}
      </span>
      {/* OUT_OF_SYNC là trạng thái DUY NHẤT người dùng phải hành động ngay,
          nên nó được thêm một dòng. Nén nó bằng kích cỡ với các trạng thái
          khác chính là giấu nó đi. */}
      {outOfSync && (
        <span className="font-mono text-xs text-[var(--c-warn-fg)]">
          rev {schedule.revision} ≠ {applied ?? EM_DASH}
        </span>
      )}
    </span>
  )
}

/**
 * Dải runtime — luôn hiện diện ở mọi tab của Editor, để người dùng không bao
 * giờ sửa lịch mà không thấy lịch đang làm gì (S2).
 */
export function RuntimeStrip({
  runtime,
  valueLabel
}: {
  runtime: ScheduleRuntimeState | null | undefined
  valueLabel: string
}) {
  if (!runtime || runtime.value_source === null) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-2.5 text-sm text-[var(--c-text-dim)]">
        Controller chưa báo trạng thái — đang hiển thị {EM_DASH}
      </div>
    )
  }

  const sourceLabel =
    runtime.value_source === 'WEEKLY' ? 'Lịch tuần'
      : runtime.value_source === 'EXCEPTION' ? `Ngoại lệ ${runtime.source_exception_id ?? ''}`.trim()
        : 'Giá trị mặc định'

  const overridden = runtime.targets.find((t) => t.overridden_by !== null)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-2.5 text-sm">
        <span className="text-[var(--c-text-dim)]">Đang hiệu lực:</span>
        <span className="font-semibold text-[var(--c-text)]">{valueLabel}</span>
        <span className="text-[var(--c-text-dim)]">· nguồn:</span>
        <span className="text-[var(--c-text)]">{sourceLabel}</span>
        <span className="text-[var(--c-text-dim)]">· chuyển kế tiếp:</span>
        <span className="font-mono text-[var(--c-text)]">
          {runtime.next_transition_at ? formatWhen(runtime.next_transition_at) : EM_DASH}
        </span>
      </div>
      {overridden && (
        /* Câu trả lời cho "lịch bật rồi mà sao thiết bị không chạy" — câu hỏi
           tốn nhiều thời gian hiện trường nhất. */
        <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-4 py-2 text-sm text-[var(--c-warn-fg)]">
          ⚠ {overridden.target_id} đang bị {overrideSourceLabel(overridden.overridden_by)} giữ —
          lệnh lịch không tới được đầu ra.
        </div>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? `${time} hôm nay` : `${time} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
