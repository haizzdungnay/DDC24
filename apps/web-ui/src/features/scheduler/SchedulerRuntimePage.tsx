import { RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../shared/components/Button'
import { StateBlock } from '../../shared/components/StateBlock'
import type { ScheduleObject } from '../../shared/types'
import { cn } from '../../shared/utils'
import { StatusDot } from './components/StatusDot'
import { EM_DASH, ERROR_CODE_HINTS, formatValue, overrideSourceLabel } from './shared'
import { useScheduler } from './useScheduler'

/**
 * Giám sát trực tiếp — Logic Cards (Mode 3 của đặc tả §16.3).
 *
 * Mỗi thẻ vẽ chuỗi Calendar/Exception → giá trị hiệu lực → priority → điểm
 * điều khiển → kết quả thật, đọc từ trái sang phải.
 *
 * Dòng cảnh báo override là LÝ DO trang này tồn tại: nó trả lời câu hỏi
 * "lịch bật rồi mà sao quạt không chạy" — câu tốn nhiều thời gian hiện trường
 * nhất, và là câu mà trang lịch cũ hoàn toàn im lặng.
 */
export function SchedulerRuntimePage() {
  const { schedules, loading, error, reload } = useScheduler()

  const withRuntime = useMemo(() => schedules.filter((s) => s.runtime), [schedules])
  const diagnostics = useMemo(() => collectDiagnostics(schedules), [schedules])

  if (error && schedules.length === 0) {
    return <StateBlock state="error" title="Không tải được trạng thái lịch" detail={error.message} onRetry={() => { void reload() }} />
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text)]">Giám sát lịch</h1>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">
            Trạng thái thật của controller · nguồn giá trị · kết quả ghi từng điểm
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="inline-flex h-9 items-center rounded-[var(--radius)] border border-[var(--c-border)] px-3 text-sm text-[var(--c-text)] hover:bg-[var(--c-surface-2)]" to="/eng/scheduler">
            Danh sách lịch
          </Link>
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={() => { void reload() }}>
            Tải lại
          </Button>
        </div>
      </header>

      {diagnostics.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-[var(--c-text-dim)]">Chẩn đoán</h2>
          {diagnostics.map((d, i) => (
            <div key={i} className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-2.5 text-sm text-[var(--c-bad-fg)]">
              <span className="font-mono text-xs font-bold">{d.code}</span>
              <span className="ml-2">{ERROR_CODE_HINTS[d.code] ?? ''}</span>
              <div className="mt-0.5">{d.detail}</div>
            </div>
          ))}
        </section>
      )}

      {withRuntime.length === 0 ? (
        <StateBlock
          state="empty"
          title="Controller chưa báo trạng thái lịch nào"
          detail={'Lịch phải được publish xuống controller thì mới có trạng thái runtime. ' +
            'Chưa publish thì mọi ô hiển thị gạch ngang chứ không hiện giá trị suy đoán.'}
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {withRuntime.map((s) => <LogicCard key={s.schedule_id} schedule={s} />)}
        </div>
      )}
    </div>
  )
}

function LogicCard({ schedule }: { schedule: ScheduleObject }) {
  const rt = schedule.runtime!
  const sourceLabel =
    rt.value_source === 'WEEKLY' ? 'Lịch tuần'
      : rt.value_source === 'EXCEPTION' ? `Ngoại lệ ${rt.source_exception_id ?? ''}`.trim()
        : rt.value_source === 'DEFAULT' ? 'Giá trị mặc định'
          : EM_DASH
  const overridden = rt.targets.filter((t) => t.overridden_by)

  return (
    <article className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-2">
        <Link className="font-medium text-[var(--c-accent)] hover:underline" to={`/eng/scheduler/${schedule.schedule_id}`}>
          <span className="font-mono">{schedule.schedule_id}</span> · {schedule.schedule_name}
        </Link>
        <StatusDot schedule={schedule} />
      </header>

      {/* Chuỗi: nguồn → giá trị → priority → điểm → kết quả */}
      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-start">
        <div className="text-sm">
          <div className="text-xs uppercase text-[var(--c-text-dim)]">Nguồn</div>
          <div className="font-medium text-[var(--c-text)]">{sourceLabel}</div>
          <div className="mt-1 text-xs text-[var(--c-text-dim)]">
            chuyển kế tiếp: {rt.next_transition_at ? formatStamp(rt.next_transition_at) : EM_DASH}
          </div>
        </div>

        <div className="text-sm">
          <div className="text-xs uppercase text-[var(--c-text-dim)]">Giá trị</div>
          <div className="text-lg font-semibold text-[var(--c-text)]">
            {formatValue(rt.effective_value, schedule.value_type)}
          </div>
          <div className="mt-1 text-xs text-[var(--c-text-dim)]">
            ưu tiên {schedule.priority_for_writing} → mức {schedule.core_priority_level}
          </div>
        </div>

        <ul className="space-y-1 text-sm">
          {rt.targets.length === 0 && <li className="text-[var(--c-text-dim)]">Không có điểm điều khiển</li>}
          {rt.targets.map((t) => (
            <li key={t.target_id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[var(--c-text-dim)]">{t.target_id}</span>
              <span className="font-medium text-[var(--c-text)]">
                {formatValue(t.actual_value, schedule.value_type)}
              </span>
              <span className={cn(
                'text-xs',
                t.write_result === 'OK' ? 'text-[var(--c-good-fg)]'
                  : t.write_result === 'SKIPPED' ? 'text-[var(--c-text-dim)]'
                    : 'text-[var(--c-bad-fg)]'
              )}>
                {t.write_result === 'OK' ? '✓'
                  : t.write_result === 'SKIPPED' ? 'thua phân xử'
                    : `⚠ ${t.error_code ?? t.write_result ?? ''}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {overridden.map((t) => (
        /* Đây là dòng làm nên giá trị của cả trang. */
        <div key={t.target_id} className="mt-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-sm text-[var(--c-warn-fg)]">
          ⚠ {t.target_id} đang bị {overrideSourceLabel(t.overridden_by)} giữ — lệnh lịch không tới được đầu ra.
        </div>
      ))}
    </article>
  )
}

function collectDiagnostics(schedules: ScheduleObject[]): { code: string; detail: string }[] {
  const out: { code: string; detail: string }[] = []
  for (const s of schedules) {
    if (s.runtime?.error_code) {
      out.push({ code: s.runtime.error_code, detail: `${s.schedule_id} — ${s.schedule_name}` })
    }
    for (const t of s.runtime?.targets ?? []) {
      if (t.error_code) {
        out.push({ code: t.error_code, detail: `${s.schedule_id} · ${t.target_id} — các điểm khác vẫn chạy` })
      }
    }
    if (s.status === 'OUT_OF_SYNC') {
      out.push({
        code: 'SCH-VERSION-001',
        detail: `${s.schedule_id} — máy chủ ở revision ${s.revision}, controller đang chạy ${s.runtime?.applied_revision ?? EM_DASH}`
      })
    }
  }
  return out
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
