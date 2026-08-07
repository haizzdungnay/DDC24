import { Copy, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import type { ScheduleDayKey, ScheduleObject, ScheduleTimeValue } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import {
  DAY_KEYS, DAY_LABELS, EM_DASH, activeValue, blockToTimeValues, dayToBlocks,
  formatValue, isActiveValue, secondsToTime, shortTime, sortTimeValues, timeToSeconds
} from '../shared'

const STEP_SEC = 5 * 60          // bước nhảy 5 phút
const HOUR_PX = 26               // chiều cao một giờ trên lưới
const GRID_HEIGHT = 24 * HOUR_PX

/**
 * Lịch tuần trực quan + bảng Time-Value.
 *
 * Bảng cặp Time-Value nằm NGAY CẠNH lưới, không giấu sau tab. Đây là hiện thân
 * của nguyên tắc S4: người dùng phải thấy được vì sao một khoảng 08:00→18:00
 * lại sinh HAI sự kiện chứ không phải một. Không thấy phép biên dịch này thì
 * không hiểu mô hình, và sẽ dựng sai lịch.
 *
 * Mọi thao tác kéo thả đều có đường bàn phím tương đương (S7). Làm kéo thả rồi
 * thêm bàn phím sau là cách chắc chắn nhất để bàn phím không bao giờ được làm,
 * trong khi tủ điện dùng màn hình chạm nhỏ và commissioning cần thao tác nhanh.
 */
export function WeeklyTab({
  draft, canEdit, onChange
}: {
  draft: ScheduleObject
  canEdit: boolean
  onChange: (changes: Partial<ScheduleObject>) => void
}) {
  const [activeDay, setActiveDay] = useState<ScheduleDayKey>('MON')
  const [selected, setSelected] = useState<{ day: ScheduleDayKey; index: number } | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)

  const defaultValue = draft.schedule_default.value
  const onValue = activeValue(draft.value_type)

  const setDay = (day: ScheduleDayKey, events: ScheduleTimeValue[]) => {
    onChange({ weekly_schedule: { ...draft.weekly_schedule, [day]: sortTimeValues(events) } })
  }

  function addBlock(day: ScheduleDayKey) {
    // Khối mặc định 08:00–17:00 — khung giờ hành chính, chỗ bắt đầu quen thuộc.
    const next = blockToTimeValues(draft.weekly_schedule[day], 8 * 3600, 17 * 3600, onValue, defaultValue)
    setDay(day, next)
    setActiveDay(day)
  }

  function removeEvent(day: ScheduleDayKey, index: number) {
    const next = draft.weekly_schedule[day].filter((_, i) => i !== index)
    setDay(day, next)
    setSelected(null)
  }

  function shiftEvent(day: ScheduleDayKey, index: number, deltaSec: number) {
    const events = [...draft.weekly_schedule[day]]
    const cur = timeToSeconds(events[index].time)
    const next = Math.max(0, Math.min(86_399, cur + deltaSec))
    // Trùng thời điểm là SCH-CONFIG-002 — chặn ngay tại chỗ nhập.
    if (events.some((e, i) => i !== index && timeToSeconds(e.time) === next)) return
    events[index] = { ...events[index], time: secondsToTime(next) }
    setDay(day, events)
  }

  function copyDayTo(target: ScheduleDayKey[]) {
    const source = draft.weekly_schedule[activeDay]
    const weekly = { ...draft.weekly_schedule }
    for (const d of target) weekly[d] = source.map((e) => ({ ...e }))
    onChange({ weekly_schedule: weekly })
    setCopyOpen(false)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <WeekGrid
          draft={draft}
          selected={selected}
          onSelect={(day, index) => { setSelected({ day, index }); setActiveDay(day) }}
          onDayFocus={setActiveDay}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--c-text-dim)]">
          <LegendSwatch className="bg-[var(--c-accent)]" label={formatValue(onValue, draft.value_type)} />
          <LegendSwatch className="bg-[var(--c-surface-2)]" label={`${formatValue(defaultValue, draft.value_type)} (mặc định)`} />
          <span className="ml-auto">Bước nhảy 5 phút</span>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
            value={activeDay}
            onChange={(e) => setActiveDay(e.target.value as ScheduleDayKey)}
            aria-label="Chọn ngày để sửa"
          >
            {DAY_KEYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
          </select>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit} onClick={() => addBlock(activeDay)}>
            Thêm khoảng
          </Button>
          <Button size="sm" icon={<Copy className="h-4 w-4" />} disabled={!canEdit} onClick={() => setCopyOpen((v) => !v)}>
            Sao chép sang…
          </Button>
        </div>

        {copyOpen && (
          <CopyDayPanel
            source={activeDay}
            onApply={copyDayTo}
            onCancel={() => setCopyOpen(false)}
          />
        )}

        {/* S4 — phép biên dịch luôn nhìn thấy được */}
        <TimeValueTable
          day={activeDay}
          events={draft.weekly_schedule[activeDay]}
          valueType={draft.value_type}
          canEdit={canEdit}
          selectedIndex={selected?.day === activeDay ? selected.index : null}
          onSelect={(index) => setSelected({ day: activeDay, index })}
          onShift={(index, delta) => shiftEvent(activeDay, index, delta)}
          onSetTime={(index, time) => {
            const events = [...draft.weekly_schedule[activeDay]]
            events[index] = { ...events[index], time }
            setDay(activeDay, events)
          }}
          onSetValue={(index, value) => {
            const events = [...draft.weekly_schedule[activeDay]]
            events[index] = { ...events[index], value }
            setDay(activeDay, events)
          }}
          onRemove={(index) => removeEvent(activeDay, index)}
        />

        <KeyboardHelp />
      </section>
    </div>
  )
}

function WeekGrid({
  draft, selected, onSelect, onDayFocus
}: {
  draft: ScheduleObject
  selected: { day: ScheduleDayKey; index: number } | null
  onSelect: (day: ScheduleDayKey, index: number) => void
  onDayFocus: (day: ScheduleDayKey) => void
}) {
  const nowPct = useNowPercent(draft.timezone)

  return (
    <div className="flex gap-1 overflow-x-auto">
      <div className="w-10 shrink-0" style={{ paddingTop: 22 }}>
        {Array.from({ length: 13 }, (_, i) => i * 2).map((h) => (
          <div key={h} className="relative text-[10px] text-[var(--c-text-dim)]" style={{ height: HOUR_PX * 2 }}>
            <span className="absolute -top-1.5 right-1 font-mono">{String(h).padStart(2, '0')}</span>
          </div>
        ))}
      </div>

      {DAY_KEYS.map((day) => {
        const blocks = dayToBlocks(draft.weekly_schedule[day], draft.value_type)
        const events = sortTimeValues(draft.weekly_schedule[day])
        return (
          <div key={day} className="min-w-[4.5rem] flex-1">
            <button
              type="button"
              className="w-full pb-1 text-center text-xs font-semibold text-[var(--c-text-dim)] hover:text-[var(--c-text)]"
              onClick={() => onDayFocus(day)}
            >
              {DAY_LABELS[day]}
            </button>
            <div
              className="relative rounded border border-[var(--c-border)] bg-[var(--c-surface-2)]"
              style={{ height: GRID_HEIGHT }}
            >
              {/* vạch giờ mỗi 6 tiếng cho dễ định vị */}
              {[6, 12, 18].map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-[var(--c-border)] opacity-50"
                     style={{ top: (h / 24) * GRID_HEIGHT }} />
              ))}
              {blocks.map((b, i) => {
                const evIndex = events.findIndex((e) => timeToSeconds(e.time) === b.startSec)
                const isSel = selected?.day === day && selected.index === evIndex
                return (
                  <button
                    key={`${b.startSec}-${i}`}
                    type="button"
                    onClick={() => onSelect(day, evIndex)}
                    title={`${shortTime(secondsToTime(b.startSec))}–${shortTime(secondsToTime(b.endSec))}`}
                    className={cn(
                      'absolute inset-x-0.5 rounded bg-[var(--c-accent)] text-[9px] font-semibold text-white transition',
                      isSel && 'ring-2 ring-[var(--c-text)]'
                    )}
                    style={{
                      top: (b.startSec / 86_400) * GRID_HEIGHT,
                      height: Math.max(6, ((b.endSec - b.startSec) / 86_400) * GRID_HEIGHT)
                    }}
                  >
                    {b.endSec - b.startSec >= 3600 ? shortTime(secondsToTime(b.startSec)) : ''}
                  </button>
                )
              })}
              {/* Đường "bây giờ" theo timezone CỦA LỊCH, không theo TZ trình duyệt. */}
              {nowPct !== null && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t-2 border-[var(--c-bad)]"
                  style={{ top: nowPct * GRID_HEIGHT }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TimeValueTable({
  day, events, valueType, canEdit, selectedIndex, onSelect, onShift, onSetTime, onSetValue, onRemove
}: {
  day: ScheduleDayKey
  events: ScheduleTimeValue[]
  valueType: ScheduleObject['value_type']
  canEdit: boolean
  selectedIndex: number | null
  onSelect: (index: number) => void
  onShift: (index: number, deltaSec: number) => void
  onSetTime: (index: number, time: string) => void
  onSetValue: (index: number, value: ScheduleTimeValue['value']) => void
  onRemove: (index: number) => void
}) {
  const sorted = sortTimeValues(events)
  const dup = new Set<string>()
  const seen = new Set<string>()
  for (const e of sorted) { if (seen.has(e.time)) dup.add(e.time); seen.add(e.time) }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]">
      <div className="border-b border-[var(--c-border)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        Cặp Time-Value · {DAY_LABELS[day]}
      </div>
      {sorted.length === 0 ? (
        <p className="px-3 py-4 text-sm text-[var(--c-text-dim)]">
          Ngày này chưa có sự kiện nào — giá trị sẽ theo mốc gần nhất của ngày trước, hoặc giá trị mặc định.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--c-border)]">
          {sorted.map((e, i) => (
            <li
              key={`${e.time}-${i}`}
              className={cn('flex items-center gap-2 px-3 py-2', selectedIndex === i && 'bg-[var(--c-surface-2)]')}
              onFocus={() => onSelect(i)}
            >
              <input
                type="time"
                step={60}
                className="h-8 w-28 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 font-mono text-sm text-[var(--c-text)]"
                value={shortTime(e.time)}
                disabled={!canEdit}
                aria-label={`Giờ sự kiện ${i + 1}`}
                onKeyDown={(ev) => {
                  if (!canEdit) return
                  if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                    ev.preventDefault()
                    onShift(i, (ev.key === 'ArrowRight' ? 1 : -1) * STEP_SEC)
                  } else if (ev.key === 'Delete') {
                    ev.preventDefault()
                    onRemove(i)
                  }
                }}
                onChange={(ev) => onSetTime(i, `${ev.target.value}:00`)}
              />
              <span className="text-[var(--c-text-dim)]">=</span>
              <ValueControl value={e.value} valueType={valueType} disabled={!canEdit} onChange={(v) => onSetValue(i, v)} />
              {dup.has(e.time) && (
                <span className="text-xs font-semibold text-[var(--c-bad-fg)]" title="SCH-CONFIG-002">
                  trùng giờ
                </span>
              )}
              <button
                type="button"
                className="ml-auto rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-bad-fg)] disabled:opacity-40"
                disabled={!canEdit}
                aria-label={`Xoá sự kiện ${shortTime(e.time)}`}
                onClick={() => onRemove(i)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ValueControl({
  value, valueType, disabled, onChange
}: {
  value: ScheduleTimeValue['value']
  valueType: ScheduleObject['value_type']
  disabled: boolean
  onChange: (v: ScheduleTimeValue['value']) => void
}) {
  if (valueType === 'BINARY' || valueType === 'BOOLEAN') {
    const on = isActiveValue(value, valueType)
    return (
      <select
        className="h-8 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)]"
        value={on ? 'on' : 'off'}
        disabled={disabled}
        aria-label="Giá trị"
        onChange={(e) => {
          const next = e.target.value === 'on'
          onChange(valueType === 'BINARY' ? (next ? 'ACTIVE' : 'INACTIVE') : next)
        }}
      >
        <option value="off">TẮT</option>
        <option value="on">BẬT</option>
      </select>
    )
  }
  return (
    <input
      type="number"
      className="h-8 w-24 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)]"
      value={Number(value)}
      disabled={disabled}
      aria-label="Giá trị"
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

function CopyDayPanel({
  source, onApply, onCancel
}: { source: ScheduleDayKey; onApply: (days: ScheduleDayKey[]) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<Set<ScheduleDayKey>>(new Set())
  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-surface-2)] p-3">
      <p className="text-sm text-[var(--c-text)]">Sao chép {DAY_LABELS[source]} sang những ngày nào?</p>
      <div className="flex flex-wrap gap-1.5">
        {DAY_KEYS.filter((d) => d !== source).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setPicked((cur) => {
              const next = new Set(cur)
              if (next.has(d)) next.delete(d); else next.add(d)
              return next
            })}
            className={cn(
              'h-8 min-w-10 rounded border px-2 text-sm font-semibold transition',
              picked.has(d)
                ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white'
                : 'border-[var(--c-border)] text-[var(--c-text-dim)]'
            )}
          >
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={picked.size === 0} onClick={() => onApply([...picked])}>
          Áp dụng cho {picked.size} ngày
        </Button>
        <Button size="sm" onClick={onCancel}>Huỷ</Button>
      </div>
    </div>
  )
}

function KeyboardHelp() {
  return (
    <details className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-xs text-[var(--c-text-dim)]">
      <summary className="cursor-pointer font-semibold">Thao tác bàn phím</summary>
      <ul className="mt-2 space-y-1">
        <li><kbd>Tab</kbd> — chuyển giữa các sự kiện</li>
        <li><kbd>←</kbd> <kbd>→</kbd> — dời sự kiện 5 phút</li>
        <li><kbd>Delete</kbd> — xoá sự kiện đang chọn</li>
        <li>Gõ trực tiếp vào ô giờ để đặt thời điểm chính xác</li>
      </ul>
    </details>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-3 w-3 rounded-sm border border-[var(--c-border)]', className)} />
      {label}
    </span>
  )
}

/** Vị trí đường "bây giờ" (0..1) theo timezone của lịch. */
function useNowPercent(timezone: string): number | null {
  const [pct, setPct] = useState<number | null>(null)
  const tzRef = useRef(timezone)
  tzRef.current = timezone

  useEffect(() => {
    const tick = () => {
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: tzRef.current, hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(new Date())
        const h = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
        const m = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN)
        setPct(Number.isNaN(h) || Number.isNaN(m) ? null : (h * 60 + m) / 1440)
      } catch {
        // Múi giờ không hợp lệ — không vẽ đường nào còn hơn vẽ sai chỗ.
        setPct(null)
      }
    }
    tick()
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return useMemo(() => pct, [pct])
}

export { EM_DASH }
