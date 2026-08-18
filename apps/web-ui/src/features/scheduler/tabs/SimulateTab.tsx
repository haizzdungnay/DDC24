import { Play } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '../../../shared/api/client'
import { Button } from '../../../shared/components/Button'
import type { ScheduleObject, ScheduleSimulateResult } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import { formatVN } from '../dateRules'
import { EM_DASH, formatValue } from '../shared'

/**
 * Mô phỏng lịch trước khi publish.
 *
 * Chạy ở backend bằng ĐÚNG engine đánh giá của controller (binary
 * `mkddc-schedule-sim`). Thiếu binary thì backend trả 503 kèm giải thích chứ
 * không tự tính — và frontend cũng không tính. Một bản cài lại sẽ đúng cho tới
 * ngày nó lệch khỏi controller, và ngày đó không ai biết.
 */
export function SimulateTab({ schedule, dirty }: { schedule: ScheduleObject; dirty: boolean }) {
  const [range, setRange] = useState<'7_DAYS' | '30_DAYS' | 'SPECIFIC_DAY'>('7_DAYS')
  const [startDate, setStartDate] = useState('')
  const [result, setResult] = useState<ScheduleSimulateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await apiClient.simulateSchedule(schedule.schedule_id, {
        range,
        ...(startDate ? { start_date: startDate } : {})
      })
      setResult(res)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* N-08: tab nằm trong `ScheduleEditorPage` vốn đã giữ `<h1>`, nên đây là
          `<h2>` — và `sr-only` vì tên tab đã hiện trên thanh tab, lặp lại bằng
          mắt là nhiễu. Cây heading vẫn phải liền mạch cho trình đọc màn hình
          (WCAG 2.2 §2.4.6). */}
      <h2 className="sr-only">Mô phỏng</h2>
      {dirty && (
        <p className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-4 py-2.5 text-sm text-[var(--c-warn-fg)]">
          Đang có thay đổi chưa lưu. Mô phỏng chạy trên <strong>bản đã lưu</strong> ở máy chủ, không phải bản bạn đang sửa.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Phạm vi mô phỏng</legend>
          {([
            ['7_DAYS', '7 ngày'],
            ['30_DAYS', '30 ngày'],
            ['SPECIFIC_DAY', 'Một ngày']
          ] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-[var(--c-text)]">
              <input
                type="radio"
                name="sim-range"
                className="accent-[var(--c-accent)]"
                checked={range === value}
                onChange={() => setRange(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase text-[var(--c-text-dim)]">Bắt đầu từ</span>
          <input
            type="date"
            className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <Button variant="primary" icon={<Play className="h-4 w-4" />} loading={busy} onClick={() => { void run() }}>
          Chạy mô phỏng
        </Button>
      </div>

      {error && (
        <div className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-3 text-sm text-[var(--c-bad-fg)]">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="flex flex-wrap gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-2.5 text-sm">
            <Stat label="Lần chuyển trạng thái" value={result.transitions.length} />
            <Stat
              label="Khoảng không có giá trị"
              value={result.gaps.length}
              tone={result.gaps.length > 0 ? 'bad' : undefined}
            />
            <Stat
              label="Xung đột"
              value={result.conflicts.length}
              tone={result.conflicts.length > 0 ? 'bad' : undefined}
            />
          </div>

          {result.conflicts.map((c, i) => (
            <div key={i} className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-2.5 text-sm text-[var(--c-bad-fg)]">
              <span className="font-mono text-xs font-bold">{c.code}</span> {c.message}
            </div>
          ))}

          {result.gaps.length > 0 && (
            <div className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-2.5 text-sm text-[var(--c-bad-fg)]">
              <div className="font-semibold">Khoảng thời gian không có giá trị hiệu lực:</div>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {result.gaps.slice(0, 10).map((g, i) => (
                  <li key={i}>{formatStamp(g.from)} → {formatStamp(g.to)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                  <th className="px-3 py-2">Thời điểm</th>
                  <th className="px-3 py-2">Nguồn</th>
                  <th className="px-3 py-2">Giá trị</th>
                  <th className="px-3 py-2">Điểm nhận lệnh</th>
                  <th className="px-3 py-2 text-right">Ưu tiên</th>
                </tr>
              </thead>
              <tbody>
                {result.transitions.map((t, i) => (
                  <tr key={i} className="border-b border-[var(--c-border)]">
                    <td className="px-3 py-1.5 font-mono text-xs">{formatStamp(t.at)}</td>
                    <td className="px-3 py-1.5">
                      {sourceLabel(t.source)}
                      {t.source_exception_id && (
                        <span className="ml-1 font-mono text-xs text-[var(--c-text-dim)]">({t.source_exception_id})</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-semibold">{formatValue(t.value, schedule.value_type)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{t.target_ids.join(', ') || EM_DASH}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{t.priority_for_writing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('text-lg font-semibold', tone === 'bad' ? 'text-[var(--c-bad-fg)]' : 'text-[var(--c-text)]')}>
        {value}
      </span>
      <span className="text-[var(--c-text-dim)]">{label}</span>
    </span>
  )
}

function sourceLabel(source: string): string {
  if (source === 'WEEKLY') return 'Lịch tuần'
  if (source === 'EXCEPTION') return 'Ngoại lệ'
  if (source === 'DEFAULT') return 'Mặc định'
  return source
}

/** Binary mô phỏng trả mốc dạng `YYYY-MM-DDTHH:mm:ss` không kèm múi giờ. */
function formatStamp(stamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(stamp)
  return m ? `${formatVN(m[1])} ${m[2]}` : stamp
}
