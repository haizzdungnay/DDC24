import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../../shared/components/Button'
import type { ScheduleDateRule, ScheduleException, ScheduleObject } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import { describeDateRule, findExceptionConflicts, formatVN, previewDateRule } from '../dateRules'
import { activeValue, formatValue, isActiveValue, shortTime, sortTimeValues } from '../shared'

/**
 * Quản lý ngoại lệ của một lịch.
 *
 * Cột "12 tháng tới rơi vào" là BẮT BUỘC, không phải trang trí: `WEEK_N_DAY`
 * và `HOLIDAY_GROUP` là hai kiểu quy tắc con người không tính nhẩm được.
 * Không có cột này thì người dùng publish một quy tắc mà không biết nó sẽ nổ
 * vào ngày nào.
 *
 * Hai ngoại lệ cùng ngày và cùng `event_priority` được báo là xung đột chứ
 * KHÔNG tự chọn hộ (đặc tả §7.3) — im lặng chọn hộ là cách để một lỗi cấu hình
 * sống sót qua commissioning rồi nổ ngoài hiện trường.
 */
export function ExceptionTab({
  draft, canEdit, onChange
}: {
  draft: ScheduleObject
  canEdit: boolean
  onChange: (changes: Partial<ScheduleObject>) => void
}) {
  const conflicts = useMemo(() => findExceptionConflicts(draft.exception_schedule), [draft.exception_schedule])

  const setExceptions = (list: ScheduleException[]) => onChange({ exception_schedule: list })

  function add() {
    const n = draft.exception_schedule.length + 1
    const today = new Date().toISOString().slice(0, 10)
    setExceptions([
      ...draft.exception_schedule,
      {
        exception_id: `EXC-${String(n).padStart(3, '0')}`,
        name: `Ngoại lệ ${n}`,
        date_rule: { type: 'DATE', date: today },
        event_priority: 1,
        time_values: [{ time: '00:00:00', value: draft.schedule_default.value }]
      }
    ])
  }

  function update(index: number, changes: Partial<ScheduleException>) {
    const list = [...draft.exception_schedule]
    list[index] = { ...list[index], ...changes }
    setExceptions(list)
  }

  return (
    <div className="space-y-3">
      {/* N-08: tab nằm trong `ScheduleEditorPage` vốn đã giữ `<h1>`, nên đây là
          `<h2>` — và `sr-only` vì tên tab đã hiện trên thanh tab, lặp lại bằng
          mắt là nhiễu. Cây heading vẫn phải liền mạch cho trình đọc màn hình
          (WCAG 2.2 §2.4.6). */}
      <h2 className="sr-only">Ngoại lệ</h2>
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--c-text-dim)]">
          Ngoại lệ ghi đè lịch tuần khi ngày khớp. Thứ tự tính: ngoại lệ → lịch tuần → giá trị mặc định.
        </p>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit} onClick={add}>
          Thêm ngoại lệ
        </Button>
      </div>

      {conflicts.map((c) => (
        <div key={`${c.a}-${c.b}`} className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-2.5 text-sm text-[var(--c-bad-fg)]">
          <span className="font-mono text-xs font-bold">SCH-CONFIG-003</span>
          <div className="mt-0.5">
            <strong>{c.a}</strong> và <strong>{c.b}</strong> cùng rơi vào {formatVN(c.day)} và cùng mức ưu tiên.
            Hệ thống <strong>không tự chọn</strong> — hãy đổi mức ưu tiên của một trong hai.
          </div>
        </div>
      ))}

      {draft.exception_schedule.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-6 text-sm text-[var(--c-text-dim)]">
          Chưa có ngoại lệ nào. Ngày lễ, ngày bảo trì hay ngày nghỉ đặc biệt đều là ngoại lệ.
        </p>
      ) : (
        <div className="space-y-3">
          {draft.exception_schedule.map((ex, i) => (
            <ExceptionCard
              key={ex.exception_id + i}
              exception={ex}
              draft={draft}
              canEdit={canEdit}
              conflicted={conflicts.some((c) => c.a === ex.exception_id || c.b === ex.exception_id)}
              onChange={(changes) => update(i, changes)}
              onRemove={() => setExceptions(draft.exception_schedule.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExceptionCard({
  exception, draft, canEdit, conflicted, onChange, onRemove
}: {
  exception: ScheduleException
  draft: ScheduleObject
  canEdit: boolean
  conflicted: boolean
  onChange: (changes: Partial<ScheduleException>) => void
  onRemove: () => void
}) {
  const preview = useMemo(() => previewDateRule(exception.date_rule), [exception.date_rule])
  const events = sortTimeValues(exception.time_values)

  return (
    <article className={cn(
      'rounded-[var(--radius)] border bg-[var(--c-bg)] p-4',
      conflicted ? 'border-[var(--c-bad)]' : 'border-[var(--c-border)]'
    )}>
      <div className="flex flex-wrap items-start gap-3">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Mã</span>
          <input
            className={cellClass + ' w-32 font-mono'}
            value={exception.exception_id}
            disabled={!canEdit}
            onChange={(e) => onChange({ exception_id: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="min-w-[10rem] flex-1 space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Tên</span>
          <input className={cellClass} value={exception.name} disabled={!canEdit}
                 onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Ưu tiên</span>
          <input
            type="number" min={1} max={16}
            className={cellClass + ' w-20'}
            value={exception.event_priority}
            disabled={!canEdit}
            onChange={(e) => onChange({ event_priority: Number(e.target.value) })}
          />
        </label>
        <button
          type="button"
          className="mt-5 rounded p-1.5 text-[var(--c-text-dim)] hover:text-[var(--c-bad-fg)] disabled:opacity-40"
          disabled={!canEdit}
          aria-label={`Xoá ${exception.exception_id}`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <DateRuleEditor rule={exception.date_rule} canEdit={canEdit} onChange={(r) => onChange({ date_rule: r })} />

        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
          <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)}">12 tháng tới rơi vào</div>
          {preview.needsExternalData ? (
            <p className="mt-1 text-sm text-[var(--c-warn-fg)]">
              Phụ thuộc dữ liệu ngoài — chưa nạp nhóm ngày lễ thì quy tắc này không khớp ngày nào.
            </p>
          ) : preview.dates.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--c-text-dim)]">Không rơi vào ngày nào trong 12 tháng tới.</p>
          ) : (
            <p className="mt-1 font-mono text-xs leading-relaxed text-[var(--c-text)]">
              {preview.dates.map(formatVN).join(' · ')}{preview.truncated ? ' …' : ''}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          Sự kiện trong ngày ngoại lệ
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {events.map((tv, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-1 text-sm">
              <input
                type="time"
                className="w-24 bg-transparent font-mono text-sm text-[var(--c-text)] outline-none"
                value={shortTime(tv.time)}
                disabled={!canEdit}
                aria-label={`Giờ sự kiện ngoại lệ ${i + 1}`}
                onChange={(e) => {
                  const list = [...events]
                  list[i] = { ...list[i], time: `${e.target.value}:00` }
                  onChange({ time_values: list })
                }}
              />
              <span className="text-[var(--c-text-dim)]">=</span>
              {draft.value_type === 'BINARY' || draft.value_type === 'BOOLEAN' ? (
                <select
                  className="bg-transparent text-sm text-[var(--c-text)] outline-none"
                  value={isActiveValue(tv.value, draft.value_type) ? 'on' : 'off'}
                  disabled={!canEdit}
                  aria-label="Giá trị"
                  onChange={(e) => {
                    const on = e.target.value === 'on'
                    const list = [...events]
                    list[i] = { ...list[i], value: draft.value_type === 'BINARY' ? (on ? 'ACTIVE' : 'INACTIVE') : on }
                    onChange({ time_values: list })
                  }}
                >
                  <option value="off">TẮT</option>
                  <option value="on">BẬT</option>
                </select>
              ) : (
                <input
                  type="number"
                  className="w-20 bg-transparent text-sm text-[var(--c-text)] outline-none"
                  value={Number(tv.value)}
                  disabled={!canEdit}
                  aria-label="Giá trị"
                  onChange={(e) => {
                    const list = [...events]
                    list[i] = { ...list[i], value: Number(e.target.value) }
                    onChange({ time_values: list })
                  }}
                />
              )}
              {events.length > 1 && (
                <button
                  type="button"
                  className="text-[var(--c-text-dim)] hover:text-[var(--c-bad-fg)]"
                  disabled={!canEdit}
                  aria-label="Xoá sự kiện"
                  onClick={() => onChange({ time_values: events.filter((_, idx) => idx !== i) })}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          <Button
            size="sm"
            disabled={!canEdit}
            onClick={() => onChange({
              time_values: [...events, { time: '12:00:00', value: activeValue(draft.value_type) }]
            })}
          >
            + Sự kiện
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs text-[var(--c-text-dim)]">
        {describeDateRule(exception.date_rule)} — giá trị đầu tiên:{' '}
        {formatValue(events[0]?.value ?? null, draft.value_type)}
      </p>
    </article>
  )
}

function DateRuleEditor({
  rule, canEdit, onChange
}: { rule: ScheduleDateRule; canEdit: boolean; onChange: (r: ScheduleDateRule) => void }) {
  return (
    <div className="space-y-2">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Quy tắc ngày</span>
        <select
          className={cellClass}
          value={rule.type}
          disabled={!canEdit}
          onChange={(e) => {
            const type = e.target.value as ScheduleDateRule['type']
            const today = new Date().toISOString().slice(0, 10)
            if (type === 'DATE') onChange({ type, date: today })
            else if (type === 'DATE_RANGE') onChange({ type, start_date: today, end_date: today })
            else if (type === 'WEEK_N_DAY') onChange({ type, month: 0, week_of_month: 1, day_of_week: 1 })
            else if (type === 'CALENDAR_REFERENCE') onChange({ type, calendar_id: 'CAL-001' })
            else onChange({ type, group_id: 'HG-001' })
          }}
        >
          <option value="DATE">Một ngày cụ thể</option>
          <option value="DATE_RANGE">Khoảng ngày</option>
          <option value="WEEK_N_DAY">Thứ N của tuần thứ M trong tháng</option>
          <option value="CALENDAR_REFERENCE">Tham chiếu lịch</option>
          <option value="HOLIDAY_GROUP">Nhóm ngày lễ</option>
        </select>
      </label>

      {rule.type === 'DATE' && (
        <input type="date" className={cellClass} value={rule.date ?? ''} disabled={!canEdit}
               aria-label="Ngày" onChange={(e) => onChange({ ...rule, date: e.target.value })} />
      )}

      {rule.type === 'DATE_RANGE' && (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={cellClass} value={rule.start_date ?? ''} disabled={!canEdit}
                 aria-label="Từ ngày" onChange={(e) => onChange({ ...rule, start_date: e.target.value })} />
          <input type="date" className={cellClass} value={rule.end_date ?? ''} disabled={!canEdit}
                 aria-label="Đến ngày" onChange={(e) => onChange({ ...rule, end_date: e.target.value })} />
        </div>
      )}

      {rule.type === 'WEEK_N_DAY' && (
        <div className="grid grid-cols-3 gap-2">
          <select className={cellClass} value={rule.month ?? 0} disabled={!canEdit} aria-label="Tháng"
                  onChange={(e) => onChange({ ...rule, month: Number(e.target.value) })}>
            <option value={0}>Mỗi tháng</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select className={cellClass} value={rule.week_of_month ?? 1} disabled={!canEdit} aria-label="Tuần"
                  onChange={(e) => onChange({ ...rule, week_of_month: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>Tuần {w}</option>)}
            {/* 6 = tuần CUỐI theo quy ước BACnet, không phải tuần thứ sáu. */}
            <option value={6}>Tuần cuối</option>
          </select>
          <select className={cellClass} value={rule.day_of_week ?? 1} disabled={!canEdit} aria-label="Thứ"
                  onChange={(e) => onChange({ ...rule, day_of_week: Number(e.target.value) })}>
            {['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'].map((d, i) => (
              <option key={d} value={i + 1}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {rule.type === 'CALENDAR_REFERENCE' && (
        <input className={cellClass} value={rule.calendar_id ?? ''} disabled={!canEdit} placeholder="CAL-001"
               aria-label="Mã lịch" onChange={(e) => onChange({ ...rule, calendar_id: e.target.value.toUpperCase() })} />
      )}

      {rule.type === 'HOLIDAY_GROUP' && (
        <input className={cellClass} value={rule.group_id ?? ''} disabled={!canEdit} placeholder="HG-001"
               aria-label="Mã nhóm ngày lễ" onChange={(e) => onChange({ ...rule, group_id: e.target.value.toUpperCase() })} />
      )}
    </div>
  )
}

const cellClass =
  'h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
