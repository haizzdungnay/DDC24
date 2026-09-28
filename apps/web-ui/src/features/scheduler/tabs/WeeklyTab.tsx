import { CheckSquare, Copy, Edit3, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import type { ScheduleDayKey, ScheduleObject, ScheduleTimeValue, ScheduleValue } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import {
  DAY_KEYS, DAY_LABELS, EM_DASH, applySpanToWeekly,
  dayToBlocks, findOvernightSpan, formatValue, getNextDay, getPrevDay, isActiveValue,
  oppositeValue, removePiecesFromWeekly, secondsToTime, shortTime,
  sortTimeValues, timeToSeconds, type DayPiece, type OvernightSpan, type TimeBlock
} from '../shared'

const STEP_SEC = 5 * 60          // bước nhảy 5 phút
const HOUR_PX = 26               // chiều cao một giờ trên lưới
const GRID_HEIGHT = 24 * HOUR_PX

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
  const [clipboard, setClipboard] = useState<{ duration: number; value: ScheduleValue } | null>(null)
  const [editModal, setEditModal] = useState<{
    origPieces: DayPiece[]
    startDay: ScheduleDayKey
    endDay: ScheduleDayKey
    startSec: number
    endSec: number
    value: ScheduleValue
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    day: ScheduleDayKey
    timeSec: number
    block?: TimeBlock
    span?: OvernightSpan
  } | null>(null)

  const defaultValue = draft.schedule_default.value
  const onValue = oppositeValue(defaultValue, draft.value_type)

  const setDay = (day: ScheduleDayKey, events: ScheduleTimeValue[]) => {
    onChange({ weekly_schedule: { ...draft.weekly_schedule, [day]: sortTimeValues(events) } })
  }

  function addBlock(day: ScheduleDayKey, startSec = 8 * 3600, endSec = 17 * 3600, val = onValue) {
    const nextWeekly = applySpanToWeekly(draft.weekly_schedule, day, startSec, day, endSec, val, defaultValue)
    onChange({ weekly_schedule: nextWeekly })
    setActiveDay(day)
  }

  function addSpan(
    startDay: ScheduleDayKey,
    startSec: number,
    endDay: ScheduleDayKey,
    endSec: number,
    val = onValue
  ) {
    const nextWeekly = applySpanToWeekly(draft.weekly_schedule, startDay, startSec, endDay, endSec, val, defaultValue)
    onChange({ weekly_schedule: nextWeekly })
    setActiveDay(endDay)
  }

  function removeSpan(pieces: DayPiece[]) {
    const nextWeekly = removePiecesFromWeekly(draft.weekly_schedule, pieces, defaultValue)
    onChange({ weekly_schedule: nextWeekly })
    setSelected(null)
  }

  function moveSpan(
    origPieces: DayPiece[],
    startDay: ScheduleDayKey,
    startSec: number,
    endDay: ScheduleDayKey,
    endSec: number,
    val: ScheduleValue
  ) {
    const without = removePiecesFromWeekly(draft.weekly_schedule, origPieces, defaultValue)
    const withNew = applySpanToWeekly(without, startDay, startSec, endDay, endSec, val, defaultValue)
    onChange({ weekly_schedule: withNew })
    setActiveDay(startDay)
  }

  function resizeSpan(
    origPieces: DayPiece[],
    startDay: ScheduleDayKey,
    startSec: number,
    endDay: ScheduleDayKey,
    endSec: number,
    val: ScheduleValue
  ) {
    const without = removePiecesFromWeekly(draft.weekly_schedule, origPieces, defaultValue)
    const withNew = applySpanToWeekly(without, startDay, startSec, endDay, endSec, val, defaultValue)
    onChange({ weekly_schedule: withNew })
    setActiveDay(startDay)
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

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <h2 className="sr-only">Lịch tuần</h2>
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <WeekGrid
          draft={draft}
          canEdit={canEdit}
          selected={selected}
          onValue={onValue}
          defaultValue={defaultValue}
          onSelect={(day, index) => { setSelected({ day, index }); setActiveDay(day) }}
          onDayFocus={setActiveDay}
          onAddBlock={addBlock}
          onAddSpan={addSpan}
          onRemoveSpan={removeSpan}
          onMoveSpan={moveSpan}
          onResizeSpan={resizeSpan}
          onOpenEditModal={(span) => setEditModal({
            origPieces: span.pieces,
            startDay: span.startDay,
            endDay: span.endDay,
            startSec: span.startSec,
            endSec: span.endSec,
            value: span.value
          })}
          onOpenContextMenu={(e, day, b, span, timeSec) => setContextMenu({
            x: e.clientX,
            y: e.clientY,
            day,
            timeSec: timeSec ?? (b ? b.startSec : 0),
            block: b,
            span
          })}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--c-text-dim)]">
          <LegendSwatch className="bg-[var(--c-accent)]" label={formatValue(onValue, draft.value_type)} />
          <LegendSwatch className="bg-[var(--c-surface-2)]" label={formatValue(defaultValue, draft.value_type) + ' (mặc định)'} />
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
      </section>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-56 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-1.5 shadow-2xl text-xs text-[var(--c-text)] select-none"
          style={{
            left: Math.min(typeof window !== 'undefined' ? window.innerWidth - 240 : 0, contextMenu.x),
            top: Math.min(typeof window !== 'undefined' ? window.innerHeight - 250 : 0, contextMenu.y)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 font-semibold text-[11px] text-[var(--c-text-dim)] border-b border-[var(--c-border)] mb-1 flex items-center justify-between">
            <span>{DAY_LABELS[contextMenu.day]}</span>
            <span className="font-mono">
              {contextMenu.span
                ? (contextMenu.span.isOvernight
                    ? DAY_LABELS[contextMenu.span.startDay] + ' ' + shortTime(secondsToTime(contextMenu.span.startSec)) + ' → ' + DAY_LABELS[contextMenu.span.endDay] + ' ' + shortTime(secondsToTime(contextMenu.span.endSec))
                    : shortTime(secondsToTime(contextMenu.span.startSec)) + ' – ' + shortTime(secondsToTime(contextMenu.span.endSec)))
                : shortTime(secondsToTime(contextMenu.timeSec))}
            </span>
          </div>

          {contextMenu.span ? (
            <>
              {(draft.value_type === 'BINARY' || draft.value_type === 'BOOLEAN') && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                  onClick={() => {
                    const currentActive = isActiveValue(contextMenu.span!.value, draft.value_type)
                    const nextVal = currentActive ? defaultValue : onValue
                    resizeSpan(
                      contextMenu.span!.pieces,
                      contextMenu.span!.startDay,
                      contextMenu.span!.startSec,
                      contextMenu.span!.endDay,
                      contextMenu.span!.endSec,
                      nextVal
                    )
                    setContextMenu(null)
                  }}
                >
                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Đổi giá trị sang {formatValue(isActiveValue(contextMenu.span.value, draft.value_type) ? defaultValue : onValue, draft.value_type)}</span>
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                onClick={() => {
                  setEditModal({
                    origPieces: contextMenu.span!.pieces,
                    startDay: contextMenu.span!.startDay,
                    endDay: contextMenu.span!.endDay,
                    startSec: contextMenu.span!.startSec,
                    endSec: contextMenu.span!.endSec,
                    value: contextMenu.span!.value
                  })
                  setContextMenu(null)
                }}
              >
                <Edit3 className="h-3.5 w-3.5 shrink-0" />
                <span>Chỉnh sửa chi tiết...</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                onClick={() => {
                  const dur = contextMenu.span!.isOvernight
                    ? (86_400 - contextMenu.span!.startSec) + contextMenu.span!.endSec
                    : (contextMenu.span!.endSec - contextMenu.span!.startSec)
                  setClipboard({
                    duration: dur,
                    value: contextMenu.span!.value
                  })
                  setContextMenu(null)
                }}
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                <span>Sao chép khoảng này</span>
              </button>
              <div className="my-1 border-t border-[var(--c-border)]" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-bad-bg)] text-[var(--c-bad-fg)] text-left"
                onClick={() => {
                  removeSpan(contextMenu.span!.pieces)
                  setContextMenu(null)
                }}
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                <span>Xóa khoảng này</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                onClick={() => {
                  const start = contextMenu.timeSec
                  const end = Math.min(86_400, start + 3600)
                  addBlock(contextMenu.day, start, end)
                  setContextMenu(null)
                }}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>Thêm khoảng 1 giờ tại đây</span>
              </button>
              {clipboard && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                  onClick={() => {
                    const start = contextMenu.timeSec
                    const dur = clipboard.duration
                    if (start + dur > 86_400) {
                      addSpan(contextMenu.day, start, getNextDay(contextMenu.day), start + dur - 86_400, clipboard.value)
                    } else {
                      addSpan(contextMenu.day, start, contextMenu.day, start + dur, clipboard.value)
                    }
                    setContextMenu(null)
                  }}
                >
                  <Copy className="h-3.5 w-3.5 shrink-0" />
                  <span>Dán khoảng ({shortTime(secondsToTime(clipboard.duration))})</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {editModal && (
        <Modal
          open={true}
          title={'Chỉnh sửa khoảng thời gian (' + DAY_LABELS[editModal.startDay] + (editModal.startDay !== editModal.endDay ? ' → ' + DAY_LABELS[editModal.endDay] : '') + ')'}
          confirmLabel="Lưu thay đổi"
          cancelLabel="Hủy"
          onClose={() => setEditModal(null)}
          onConfirm={() => {
            if (editModal.startDay === editModal.endDay && editModal.startSec >= editModal.endSec) return
            moveSpan(
              editModal.origPieces,
              editModal.startDay,
              editModal.startSec,
              editModal.endDay,
              editModal.endSec,
              editModal.value
            )
            setEditModal(null)
          }}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--c-text-dim)] mb-1">
                  Thứ bắt đầu
                </label>
                <select
                  className="h-9 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
                  value={editModal.startDay}
                  onChange={(e) => setEditModal({ ...editModal, startDay: e.target.value as ScheduleDayKey })}
                >
                  {DAY_KEYS.map((d) => (
                    <option key={d} value={d}>{DAY_LABELS[d]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--c-text-dim)] mb-1">
                  Giờ bắt đầu
                </label>
                <input
                  type="time"
                  step={60}
                  className="h-9 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-3 font-mono text-sm text-[var(--c-text)]"
                  value={shortTime(secondsToTime(editModal.startSec))}
                  onChange={(e) => {
                    const sec = timeToSeconds(e.target.value + ':00')
                    if (sec >= 0) setEditModal({ ...editModal, startSec: sec })
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--c-text-dim)] mb-1">
                  Thứ kết thúc
                </label>
                <select
                  className="h-9 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
                  value={editModal.endDay}
                  onChange={(e) => setEditModal({ ...editModal, endDay: e.target.value as ScheduleDayKey })}
                >
                  {DAY_KEYS.map((d) => (
                    <option key={d} value={d}>{DAY_LABELS[d]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--c-text-dim)] mb-1">
                  Giờ kết thúc
                </label>
                <input
                  type="time"
                  step={60}
                  className="h-9 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-3 font-mono text-sm text-[var(--c-text)]"
                  value={shortTime(secondsToTime(editModal.endSec))}
                  onChange={(e) => {
                    const sec = timeToSeconds(e.target.value + ':00')
                    if (sec >= 0) setEditModal({ ...editModal, endSec: sec })
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-[var(--c-text-dim)] mb-1">
                Giá trị điều khiển
              </label>
              <ValueControl
                value={editModal.value}
                valueType={draft.value_type}
                disabled={!canEdit}
                onChange={(v) => setEditModal({ ...editModal, value: v })}
              />
            </div>

            {editModal.startDay === editModal.endDay && editModal.startSec >= editModal.endSec && (
              <p className="text-xs text-[var(--c-bad-fg)] font-semibold">
                Cùng ngày thì giờ bắt đầu phải trước giờ kết thúc, hoặc chọn Thứ kết thúc sang ngày hôm sau.
              </p>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-[var(--c-border)]">
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => {
                  removeSpan(editModal.origPieces)
                  setEditModal(null)
                }}
              >
                Xóa khoảng này
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

type DragAction =
  | {
      type: 'create'
      anchorDay: ScheduleDayKey
      anchorSec: number
      currDay: ScheduleDayKey
      currSec: number
    }
  | {
      type: 'move'
      span: OvernightSpan
      duration: number
      offsetSec: number
      targetDay: ScheduleDayKey
      currentStartSec: number
    }
  | {
      type: 'resize-top'
      span: OvernightSpan
      currentDay: ScheduleDayKey
      currentSec: number
    }
  | {
      type: 'resize-bottom'
      span: OvernightSpan
      currentDay: ScheduleDayKey
      currentSec: number
    }

function WeekGrid({
  draft, canEdit, selected, defaultValue, onSelect, onDayFocus,
  onAddBlock, onAddSpan, onRemoveSpan, onMoveSpan, onResizeSpan, onOpenEditModal, onOpenContextMenu
}: {
  draft: ScheduleObject
  canEdit: boolean
  selected: { day: ScheduleDayKey; index: number } | null
  onValue: ScheduleValue
  defaultValue: ScheduleValue
  onSelect: (day: ScheduleDayKey, index: number) => void
  onDayFocus: (day: ScheduleDayKey) => void
  onAddBlock: (day: ScheduleDayKey, startSec: number, endSec: number) => void
  onAddSpan: (startDay: ScheduleDayKey, startSec: number, endDay: ScheduleDayKey, endSec: number) => void
  onRemoveSpan: (pieces: DayPiece[]) => void
  onMoveSpan: (origPieces: DayPiece[], startDay: ScheduleDayKey, startSec: number, endDay: ScheduleDayKey, endSec: number, val: ScheduleValue) => void
  onResizeSpan: (origPieces: DayPiece[], startDay: ScheduleDayKey, startSec: number, endDay: ScheduleDayKey, endSec: number, val: ScheduleValue) => void
  onOpenEditModal: (span: OvernightSpan) => void
  onOpenContextMenu: (e: React.MouseEvent, day: ScheduleDayKey, block?: TimeBlock, span?: OvernightSpan, timeSec?: number) => void
}) {
  const nowPct = useNowPercent(draft.timezone)

  function getDayFromX(clientX: number): ScheduleDayKey | null {
    for (const day of DAY_KEYS) {
      const el = dayColRefs.current[day]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right) {
        return day
      }
    }
    const firstCol = dayColRefs.current[DAY_KEYS[0]]
    if (firstCol && clientX < firstCol.getBoundingClientRect().left) return DAY_KEYS[0]
    const lastCol = dayColRefs.current[DAY_KEYS[DAY_KEYS.length - 1]]
    if (lastCol && clientX > lastCol.getBoundingClientRect().right) return DAY_KEYS[DAY_KEYS.length - 1]
    return null
  }

  const dayColRefs = useRef<Record<string, HTMLElement | null>>({})
  const [dragAction, setDragAction] = useState<DragAction | null>(null)
  const [hoverGuide, setHoverGuide] = useState<{ day: ScheduleDayKey; sec: number; y: number } | null>(null)

  const DRAG_THRESHOLD_PX = 8
  const pointerStartRef = useRef<{
    x: number
    y: number
    day: ScheduleDayKey
    sec: number
    actionType: 'create' | 'move' | 'resize-top' | 'resize-bottom'
    block?: TimeBlock
    span?: OvernightSpan
  } | null>(null)
  const isDraggingRef = useRef(false)
  const dragActionRef = useRef<DragAction | null>(null)
  const lastDragEndTimeRef = useRef<number>(0)

  function yToSec(clientY: number, colEl: HTMLElement): number {
    const rect = colEl.getBoundingClientRect()
    const relY = Math.max(0, Math.min(rect.height, clientY - rect.top))
    const ratio = relY / rect.height
    const rawSec = ratio * 86_400
    const snapped = Math.round(rawSec / STEP_SEC) * STEP_SEC
    return Math.max(0, Math.min(86_400, snapped))
  }

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const pStart = pointerStartRef.current
      if (!pStart) return

      const dist = Math.hypot(e.clientX - pStart.x, e.clientY - pStart.y)
      if (!isDraggingRef.current && dist < DRAG_THRESHOLD_PX) {
        return
      }
      isDraggingRef.current = true

      const hoveredDay = getDayFromX(e.clientX) || pStart.day
      const refCol = dayColRefs.current[hoveredDay]
      if (!refCol) return
      const sec = yToSec(e.clientY, refCol)

      if (pStart.actionType === 'create') {
        const nextAction: DragAction = {
          type: 'create',
          anchorDay: pStart.day,
          anchorSec: pStart.sec,
          currDay: hoveredDay,
          currSec: sec
        }
        dragActionRef.current = nextAction
        setDragAction(nextAction)
      } else if (pStart.actionType === 'move' && pStart.span) {
        const span = pStart.span
        const duration = span.isOvernight
          ? (86_400 - span.startSec) + span.endSec
          : (span.endSec - span.startSec)
        const offset = pStart.sec - span.startSec
        const rawStart = sec - offset
        const clampedStart = Math.max(0, Math.min(86_400 - STEP_SEC, Math.round(rawStart / STEP_SEC) * STEP_SEC))
        const nextAction: DragAction = {
          type: 'move',
          span,
          duration,
          offsetSec: offset,
          targetDay: hoveredDay,
          currentStartSec: clampedStart
        }
        dragActionRef.current = nextAction
        setDragAction(nextAction)
      } else if (pStart.actionType === 'resize-top' && pStart.span) {
        const nextAction: DragAction = {
          type: 'resize-top',
          span: pStart.span,
          currentDay: hoveredDay,
          currentSec: sec
        }
        dragActionRef.current = nextAction
        setDragAction(nextAction)
      } else if (pStart.actionType === 'resize-bottom' && pStart.span) {
        const nextAction: DragAction = {
          type: 'resize-bottom',
          span: pStart.span,
          currentDay: hoveredDay,
          currentSec: sec
        }
        dragActionRef.current = nextAction
        setDragAction(nextAction)
      }
    }

    const handlePointerUp = () => {
      const pStart = pointerStartRef.current
      pointerStartRef.current = null

      if (!isDraggingRef.current) {
        if (pStart && pStart.actionType === 'create') {
          onDayFocus(pStart.day)
        }
        dragActionRef.current = null
        setDragAction(null)
        return
      }

      lastDragEndTimeRef.current = Date.now()
      isDraggingRef.current = false
      const action = dragActionRef.current
      dragActionRef.current = null
      setDragAction(null)

      if (!action || !canEdit) return

      if (action.type === 'create') {
        const aIdx = DAY_KEYS.indexOf(action.anchorDay)
        const cIdx = DAY_KEYS.indexOf(action.currDay)
        if (aIdx === cIdx) {
          const start = Math.min(action.anchorSec, action.currSec)
          const end = Math.max(action.anchorSec, action.currSec)
          if (end - start >= STEP_SEC) {
            onAddBlock(action.anchorDay, start, end)
          } else {
            onDayFocus(action.anchorDay)
          }
        } else {
          onAddSpan(action.anchorDay, action.anchorSec, action.currDay, action.currSec)
        }
      } else if (action.type === 'move') {
        const span = action.span
        const targetDay = action.targetDay
        const startSec = action.currentStartSec
        const dur = action.duration
        if (startSec + dur > 86_400) {
          const endDay = getNextDay(targetDay)
          const endSec = startSec + dur - 86_400
          onMoveSpan(span.pieces, targetDay, startSec, endDay, endSec, span.value)
        } else {
          onMoveSpan(span.pieces, targetDay, startSec, targetDay, startSec + dur, span.value)
        }
      } else if (action.type === 'resize-top') {
        const span = action.span
        const day = action.currentDay
        const sec = action.currentSec
        onResizeSpan(span.pieces, day, sec, span.endDay, span.endSec, span.value)
      } else if (action.type === 'resize-bottom') {
        const span = action.span
        const day = action.currentDay
        const sec = action.currentSec
        onResizeSpan(span.pieces, span.startDay, span.startSec, day, sec, span.value)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [canEdit, onAddBlock, onAddSpan, onDayFocus, onMoveSpan, onResizeSpan])

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
        const blocks = dayToBlocks(draft.weekly_schedule[day], draft.value_type, defaultValue)
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
              ref={(el) => {
                if (el) dayColRefs.current[day] = el
                else delete dayColRefs.current[day]
              }}
              data-day-col
              data-day={day}
              onPointerDown={(e) => {
                if (e.button !== 0 || !canEdit) return
                if ((e.target as HTMLElement).closest('[data-block-item]')) return
                e.preventDefault()
                const sec = yToSec(e.clientY, e.currentTarget)
                pointerStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  day,
                  sec,
                  actionType: 'create'
                }
                isDraggingRef.current = false
                dragActionRef.current = null
              }}
              onDoubleClick={(e) => {
                if (!canEdit) return
                if (Date.now() - lastDragEndTimeRef.current < 400) return
                if ((e.target as HTMLElement).closest('[data-block-item]')) return
                const sec = yToSec(e.clientY, e.currentTarget)
                const end = Math.min(86_400, sec + 3600)
                onAddBlock(day, sec, end)
              }}
              onContextMenu={(e) => {
                if ((e.target as HTMLElement).closest('[data-block-item]')) return
                e.preventDefault()
                const sec = yToSec(e.clientY, e.currentTarget)
                onOpenContextMenu(e, day, undefined, undefined, sec)
              }}
              onPointerMove={(e) => {
                if (dragAction) return
                const sec = yToSec(e.clientY, e.currentTarget)
                setHoverGuide({ day, sec, y: (sec / 86_400) * GRID_HEIGHT })
              }}
              onPointerLeave={() => {
                setHoverGuide((curr) => (curr?.day === day ? null : curr))
              }}
              className="relative rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] select-none cursor-crosshair overflow-hidden"
              style={{ height: GRID_HEIGHT }}
            >
              {[6, 12, 18].map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-[var(--c-border)] opacity-50"
                     style={{ top: (h / 24) * GRID_HEIGHT }} />
              ))}

              {hoverGuide?.day === day && !dragAction && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--c-accent)] z-20"
                  style={{ top: hoverGuide.y }}
                >
                  <span className="absolute -top-3 left-1 rounded bg-[var(--c-accent)] px-1 py-0.5 font-mono text-[9px] text-white opacity-90 shadow-sm">
                    {shortTime(secondsToTime(hoverGuide.sec))}
                  </span>
                </div>
              )}

              {blocks.map((b, i) => {
                const evIndex = events.findIndex((e) => timeToSeconds(e.time) === b.startSec)
                const isSel = selected?.day === day && selected.index === evIndex
                const span = findOvernightSpan(draft.weekly_schedule, day, b, defaultValue, draft.value_type)
                const isBeingDragged =
                  (dragAction?.type === 'move' && dragAction.span.pieces.some((p) => p.day === day && p.startSec === b.startSec)) ||
                  ((dragAction?.type === 'resize-top' || dragAction?.type === 'resize-bottom') && dragAction.span.pieces.some((p) => p.day === day && p.startSec === b.startSec))

                return (
                  <div
                    key={b.startSec + '-' + i}
                    data-block-item
                    tabIndex={0}
                    role="button"
                    aria-label={DAY_LABELS[day] + ' ' + shortTime(secondsToTime(b.startSec)) + ' - ' + shortTime(secondsToTime(b.endSec))}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(day, evIndex)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onOpenEditModal(span)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onOpenContextMenu(e, day, b, span)
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || !canEdit) return
                      if ((e.target as HTMLElement).closest('[data-resize-handle]')) return
                      e.preventDefault()
                      e.stopPropagation()
                      const colEl = dayColRefs.current[day]
                      if (!colEl) return
                      const sec = yToSec(e.clientY, colEl)
                      pointerStartRef.current = {
                        x: e.clientX,
                        y: e.clientY,
                        day,
                        sec,
                        actionType: 'move',
                        block: b,
                        span
                      }
                      isDraggingRef.current = false
                      dragActionRef.current = null
                    }}
                    onKeyDown={(e) => {
                      if (!canEdit) return
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault()
                        onRemoveSpan(span.pieces)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        const newStart = Math.max(0, span.startSec - STEP_SEC)
                        const dur = span.isOvernight ? (86_400 - span.startSec) + span.endSec : span.endSec - span.startSec
                        onMoveSpan(span.pieces, span.startDay, newStart, span.endDay, newStart + dur, span.value)
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        const newStart = Math.min(86_400 - STEP_SEC, span.startSec + STEP_SEC)
                        const dur = span.isOvernight ? (86_400 - span.startSec) + span.endSec : span.endSec - span.startSec
                        onMoveSpan(span.pieces, span.startDay, newStart, span.endDay, newStart + dur, span.value)
                      }
                    }}
                    title={
                      (span.isOvernight
                        ? DAY_LABELS[span.startDay] + ' ' + shortTime(secondsToTime(span.startSec)) + ' → ' + DAY_LABELS[span.endDay] + ' ' + shortTime(secondsToTime(span.endSec))
                        : shortTime(secondsToTime(b.startSec)) + '–' + shortTime(secondsToTime(b.endSec))) +
                      ' · Bấm đúp để sửa, chuột phải để mở menu, kéo để di chuyển'
                    }
                    className={cn(
                      'group absolute inset-x-0.5 rounded bg-[var(--c-accent)] text-[10px] font-semibold text-white transition-shadow',
                      'hover:brightness-110 cursor-grab active:cursor-grabbing focus-visible:outline-none select-none',
                      isSel && 'ring-2 ring-[var(--c-text)] z-10',
                      isBeingDragged && 'opacity-25'
                    )}
                    style={{
                      top: (b.startSec / 86_400) * GRID_HEIGHT,
                      height: Math.max(12, ((b.endSec - b.startSec) / 86_400) * GRID_HEIGHT)
                    }}
                  >
                    {canEdit && (
                      <div
                        data-resize-handle="top"
                        className="absolute inset-x-0 -top-1 h-2.5 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !canEdit) return
                          e.preventDefault()
                          e.stopPropagation()
                          const colEl = dayColRefs.current[day]
                          if (!colEl) return
                          const sec = yToSec(e.clientY, colEl)
                          pointerStartRef.current = {
                            x: e.clientX,
                            y: e.clientY,
                            day,
                            sec,
                            actionType: 'resize-top',
                            block: b,
                            span
                          }
                          isDraggingRef.current = false
                          dragActionRef.current = null
                        }}
                        title="Kéo để đổi giờ bắt đầu"
                      >
                        <div className="h-1 w-6 rounded-full bg-white shadow" />
                      </div>
                    )}

                    <div className="flex h-full w-full flex-col justify-between overflow-hidden p-1 pointer-events-none">
                      <div className="truncate text-[9px] leading-tight font-medium">
                        {b.endSec === 86_400 && span.isOvernight
                          ? shortTime(secondsToTime(b.startSec)) + ' → sang ' + DAY_LABELS[getNextDay(day)]
                          : (b.startSec === 0 && span.isOvernight
                              ? 'từ ' + DAY_LABELS[getPrevDay(day)] + ' → ' + shortTime(secondsToTime(b.endSec))
                              : shortTime(secondsToTime(b.startSec)) + ' – ' + shortTime(secondsToTime(b.endSec)))}
                      </div>
                      {b.endSec - b.startSec >= 5400 && (
                        <div className="truncate text-[8px] opacity-80">
                          {formatValue(b.value, draft.value_type)}
                        </div>
                      )}
                    </div>

                    {canEdit && (
                      <div
                        data-resize-handle="bottom"
                        className="absolute inset-x-0 -bottom-1 h-2.5 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !canEdit) return
                          e.preventDefault()
                          e.stopPropagation()
                          const colEl = dayColRefs.current[day]
                          if (!colEl) return
                          const sec = yToSec(e.clientY, colEl)
                          pointerStartRef.current = {
                            x: e.clientX,
                            y: e.clientY,
                            day,
                            sec,
                            actionType: 'resize-bottom',
                            block: b,
                            span
                          }
                          isDraggingRef.current = false
                          dragActionRef.current = null
                        }}
                        title="Kéo để đổi giờ kết thúc"
                      >
                        <div className="h-1 w-6 rounded-full bg-white shadow" />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Ghost preview khi Kéo tạo mới */}
              {dragAction?.type === 'create' && (() => {
                const aIdx = DAY_KEYS.indexOf(dragAction.anchorDay)
                const cIdx = DAY_KEYS.indexOf(dragAction.currDay)
                const dIdx = DAY_KEYS.indexOf(day)
                const minIdx = Math.min(aIdx, cIdx)
                const maxIdx = Math.max(aIdx, cIdx)

                if (dIdx < minIdx || dIdx > maxIdx) return null

                let topSec = 0
                let botSec = 0
                let label = ''

                if (minIdx === maxIdx) {
                  topSec = Math.min(dragAction.anchorSec, dragAction.currSec)
                  botSec = Math.max(dragAction.anchorSec, dragAction.currSec)
                  label = shortTime(secondsToTime(topSec)) + ' – ' + shortTime(secondsToTime(botSec))
                } else {
                  const isForward = aIdx <= cIdx
                  const startSec = isForward ? dragAction.anchorSec : dragAction.currSec
                  const endSec = isForward ? dragAction.currSec : dragAction.anchorSec

                  if (dIdx === minIdx) {
                    topSec = startSec
                    botSec = 86_400
                    label = shortTime(secondsToTime(startSec)) + ' → 24:00'
                  } else if (dIdx === maxIdx) {
                    topSec = 0
                    botSec = endSec
                    label = '00:00 → ' + shortTime(secondsToTime(endSec))
                  } else {
                    topSec = 0
                    botSec = 86_400
                    label = 'Cả ngày'
                  }
                }

                if (botSec - topSec <= 0) return null

                return (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg backdrop-blur-[1px]"
                    style={{
                      top: (topSec / 86_400) * GRID_HEIGHT,
                      height: Math.max(14, ((botSec - topSec) / 86_400) * GRID_HEIGHT)
                    }}
                  >
                    <span className="truncate px-1">{label}</span>
                  </div>
                )
              })()}

              {/* Ghost preview khi Kéo di chuyển (Move) */}
              {dragAction?.type === 'move' && (() => {
                const targetDay = dragAction.targetDay
                const startSec = dragAction.currentStartSec
                const dur = dragAction.duration
                const nextDay = getNextDay(targetDay)

                let topSec = 0
                let botSec = 0
                let label = ''

                if (day === targetDay) {
                  topSec = startSec
                  botSec = Math.min(86_400, startSec + dur)
                  label = shortTime(secondsToTime(startSec)) + ' – ' + shortTime(secondsToTime(botSec))
                } else if (startSec + dur > 86_400 && day === nextDay) {
                  topSec = 0
                  botSec = startSec + dur - 86_400
                  label = '00:00 – ' + shortTime(secondsToTime(botSec))
                } else {
                  return null
                }

                return (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-85 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-xl ring-2 ring-white/60"
                    style={{
                      top: (topSec / 86_400) * GRID_HEIGHT,
                      height: Math.max(14, ((botSec - topSec) / 86_400) * GRID_HEIGHT)
                    }}
                  >
                    <span className="truncate px-1">{label}</span>
                  </div>
                )
              })()}

              {/* Ghost preview khi Kéo mép dưới */}
              {dragAction?.type === 'resize-bottom' && (() => {
                const span = dragAction.span
                const currDay = dragAction.currentDay
                const currSec = dragAction.currentSec

                if (span.startDay === currDay) {
                  if (day !== span.startDay) return null
                  const top = span.startSec
                  const bot = Math.max(span.startSec + STEP_SEC, currSec)
                  return (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg"
                      style={{
                        top: (top / 86_400) * GRID_HEIGHT,
                        height: Math.max(14, ((bot - top) / 86_400) * GRID_HEIGHT)
                      }}
                    >
                      <span className="truncate px-1">{shortTime(secondsToTime(top))} – {shortTime(secondsToTime(bot))}</span>
                    </div>
                  )
                } else {
                  if (day === span.startDay) {
                    return (
                      <div
                        className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg"
                        style={{
                          top: (span.startSec / 86_400) * GRID_HEIGHT,
                          height: Math.max(14, ((86_400 - span.startSec) / 86_400) * GRID_HEIGHT)
                        }}
                      >
                        <span className="truncate px-1">{shortTime(secondsToTime(span.startSec))} → 24:00</span>
                      </div>
                    )
                  }
                  if (day === currDay) {
                    return (
                      <div
                        className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg"
                        style={{
                          top: 0,
                          height: Math.max(14, (currSec / 86_400) * GRID_HEIGHT)
                        }}
                      >
                        <span className="truncate px-1">00:00 → {shortTime(secondsToTime(currSec))}</span>
                      </div>
                    )
                  }
                  return null
                }
              })()}

              {/* Ghost preview khi Kéo mép trên */}
              {dragAction?.type === 'resize-top' && (() => {
                const span = dragAction.span
                const currDay = dragAction.currentDay
                const currSec = dragAction.currentSec

                if (currDay === span.endDay) {
                  if (day !== currDay) return null
                  const top = Math.min(currSec, span.endSec - STEP_SEC)
                  const bot = span.endSec
                  return (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg"
                      style={{
                        top: (top / 86_400) * GRID_HEIGHT,
                        height: Math.max(14, ((bot - top) / 86_400) * GRID_HEIGHT)
                      }}
                    >
                      <span className="truncate px-1">{shortTime(secondsToTime(top))} – {shortTime(secondsToTime(bot))}</span>
                    </div>
                  )
                }
                return null
              })()}

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
              key={e.time + '-' + i}
              className={cn('flex items-center gap-2 px-3 py-2', selectedIndex === i && 'bg-[var(--c-surface-2)]')}
              onFocus={() => onSelect(i)}
            >
              <input
                type="time"
                step={60}
                className="h-8 w-28 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 font-mono text-sm text-[var(--c-text)]"
                value={shortTime(e.time)}
                disabled={!canEdit}
                aria-label={'Giờ sự kiện ' + (i + 1)}
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
                onChange={(ev) => onSetTime(i, ev.target.value + ':00')}
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
                aria-label={'Xoá sự kiện ' + shortTime(e.time)}
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

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-3 w-3 rounded-sm border border-[var(--c-border)]', className)} />
      {label}
    </span>
  )
}

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
