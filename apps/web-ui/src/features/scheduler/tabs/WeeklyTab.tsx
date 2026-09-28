import { CheckSquare, Copy, Edit3, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import type { ScheduleDayKey, ScheduleObject, ScheduleTimeValue, ScheduleValue } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import {
  DAY_KEYS, DAY_LABELS, EM_DASH, activeValue, blockToTimeValues, dayToBlocks,
  formatValue, isActiveValue, removeBlockFromDay, secondsToTime, shortTime, sortTimeValues, timeToSeconds,
  type TimeBlock
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
  const [clipboard, setClipboard] = useState<{ duration: number; value: ScheduleValue } | null>(null)
  const [editModal, setEditModal] = useState<{
    origDay: ScheduleDayKey
    day: ScheduleDayKey
    origStartSec: number
    origEndSec: number
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
  } | null>(null)

  const defaultValue = draft.schedule_default.value
  const onValue = activeValue(draft.value_type)

  const setDay = (day: ScheduleDayKey, events: ScheduleTimeValue[]) => {
    onChange({ weekly_schedule: { ...draft.weekly_schedule, [day]: sortTimeValues(events) } })
  }

  function addBlock(day: ScheduleDayKey, startSec = 8 * 3600, endSec = 17 * 3600, val = onValue) {
    const next = blockToTimeValues(draft.weekly_schedule[day], startSec, endSec, val, defaultValue)
    setDay(day, next)
    setActiveDay(day)
  }

  function removeBlock(day: ScheduleDayKey, startSec: number, endSec: number) {
    const next = removeBlockFromDay(draft.weekly_schedule[day], startSec, endSec, defaultValue)
    setDay(day, next)
    setSelected(null)
  }

  function resizeBlock(day: ScheduleDayKey, oldStart: number, oldEnd: number, newStart: number, newEnd: number, val: ScheduleValue) {
    const without = removeBlockFromDay(draft.weekly_schedule[day], oldStart, oldEnd, defaultValue)
    const next = blockToTimeValues(without, newStart, newEnd, val, defaultValue)
    setDay(day, next)
  }

  function moveBlock(fromDay: ScheduleDayKey, toDay: ScheduleDayKey, oldStart: number, oldEnd: number, newStart: number, newEnd: number, val: ScheduleValue) {
    const without = removeBlockFromDay(draft.weekly_schedule[fromDay], oldStart, oldEnd, defaultValue)
    if (fromDay === toDay) {
      const next = blockToTimeValues(without, newStart, newEnd, val, defaultValue)
      setDay(fromDay, next)
    } else {
      const targetWithNew = blockToTimeValues(draft.weekly_schedule[toDay], newStart, newEnd, val, defaultValue)
      onChange({
        weekly_schedule: {
          ...draft.weekly_schedule,
          [fromDay]: without,
          [toDay]: targetWithNew
        }
      })
      setActiveDay(toDay)
    }
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
      {/* N-08: tab nằm trong `ScheduleEditorPage` vốn đã giữ `<h1>`, nên đây là
          `<h2>` — và `sr-only` vì tên tab đã hiện trên thanh tab, lặp lại bằng
          mắt là nhiễu. Cây heading vẫn phải liền mạch cho trình đọc màn hình
          (WCAG 2.2 §2.4.6). */}
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
          onRemoveBlock={removeBlock}
          onResizeBlock={resizeBlock}
          onMoveBlock={moveBlock}
          onOpenEditModal={(day, b) => setEditModal({
            origDay: day,
            day,
            origStartSec: b.startSec,
            origEndSec: b.endSec,
            startSec: b.startSec,
            endSec: b.endSec,
            value: b.value
          })}
          onOpenContextMenu={(e, day, b, timeSec) => setContextMenu({
            x: e.clientX,
            y: e.clientY,
            day,
            timeSec: timeSec ?? (b ? b.startSec : 0),
            block: b
          })}
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

      {/* Context Menu chuẩn Google Calendar */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-52 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-1.5 shadow-2xl text-xs text-[var(--c-text)] select-none"
          style={{
            left: Math.min(typeof window !== 'undefined' ? window.innerWidth - 220 : 0, contextMenu.x),
            top: Math.min(typeof window !== 'undefined' ? window.innerHeight - 230 : 0, contextMenu.y)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 font-semibold text-[11px] text-[var(--c-text-dim)] border-b border-[var(--c-border)] mb-1 flex items-center justify-between">
            <span>{DAY_LABELS[contextMenu.day]}</span>
            <span className="font-mono">
              {contextMenu.block
                ? shortTime(secondsToTime(contextMenu.block.startSec)) + ' – ' + shortTime(secondsToTime(contextMenu.block.endSec))
                : shortTime(secondsToTime(contextMenu.timeSec))}
            </span>
          </div>

          {contextMenu.block ? (
            <>
              {(draft.value_type === 'BINARY' || draft.value_type === 'BOOLEAN') && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                  onClick={() => {
                    const currentActive = isActiveValue(contextMenu.block!.value, draft.value_type)
                    const nextVal = currentActive ? defaultValue : onValue
                    resizeBlock(
                      contextMenu.day,
                      contextMenu.block!.startSec,
                      contextMenu.block!.endSec,
                      contextMenu.block!.startSec,
                      contextMenu.block!.endSec,
                      nextVal
                    )
                    setContextMenu(null)
                  }}
                >
                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Đổi giá trị sang {formatValue(isActiveValue(contextMenu.block.value, draft.value_type) ? defaultValue : onValue, draft.value_type)}</span>
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--c-surface-2)] text-left"
                onClick={() => {
                  setEditModal({
                    origDay: contextMenu.day,
                    day: contextMenu.day,
                    origStartSec: contextMenu.block!.startSec,
                    origEndSec: contextMenu.block!.endSec,
                    startSec: contextMenu.block!.startSec,
                    endSec: contextMenu.block!.endSec,
                    value: contextMenu.block!.value
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
                  setClipboard({
                    duration: contextMenu.block!.endSec - contextMenu.block!.startSec,
                    value: contextMenu.block!.value
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
                  removeBlock(contextMenu.day, contextMenu.block!.startSec, contextMenu.block!.endSec)
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
                    const end = Math.min(86_400, start + clipboard.duration)
                    addBlock(contextMenu.day, start, end, clipboard.value)
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

      {/* Hộp thoại chỉnh sửa chi tiết (Mở khi nhấp đúp hoặc từ context menu) */}
      {editModal && (
        <Modal
          open={true}
          title={'Chỉnh sửa khoảng thời gian (' + DAY_LABELS[editModal.day] + ')'}
          confirmLabel="Lưu thay đổi"
          cancelLabel="Hủy"
          onClose={() => setEditModal(null)}
          onConfirm={() => {
            if (editModal.startSec >= editModal.endSec) return
            moveBlock(
              editModal.origDay,
              editModal.day,
              editModal.origStartSec,
              editModal.origEndSec,
              editModal.startSec,
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
                  Thứ trong tuần
                </label>
                <select
                  className="h-9 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
                  value={editModal.day}
                  onChange={(e) => setEditModal({ ...editModal, day: e.target.value as ScheduleDayKey })}
                >
                  {DAY_KEYS.map((d) => (
                    <option key={d} value={d}>{DAY_LABELS[d]}</option>
                  ))}
                </select>
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
            </div>

            <div className="grid grid-cols-2 gap-4">
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

            {editModal.startSec >= editModal.endSec && (
              <p className="text-xs text-[var(--c-bad-fg)] font-semibold">
                Giờ bắt đầu phải trước giờ kết thúc.
              </p>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-[var(--c-border)]">
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => {
                  removeBlock(editModal.origDay, editModal.origStartSec, editModal.origEndSec)
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
      day: ScheduleDayKey
      anchorSec: number
      currentSec: number
    }
  | {
      type: 'resize-top'
      day: ScheduleDayKey
      origStartSec: number
      origEndSec: number
      currentSec: number
      value: ScheduleValue
    }
  | {
      type: 'resize-bottom'
      day: ScheduleDayKey
      origStartSec: number
      origEndSec: number
      currentSec: number
      value: ScheduleValue
    }
  | {
      type: 'move'
      fromDay: ScheduleDayKey
      targetDay: ScheduleDayKey
      origStartSec: number
      origEndSec: number
      currentStartSec: number
      duration: number
      offsetSec: number
      value: ScheduleValue
    }

function WeekGrid({
  draft, canEdit, selected, onValue, defaultValue, onSelect, onDayFocus,
  onAddBlock, onRemoveBlock, onResizeBlock, onMoveBlock, onOpenEditModal, onOpenContextMenu
}: {
  draft: ScheduleObject
  canEdit: boolean
  selected: { day: ScheduleDayKey; index: number } | null
  onValue: ScheduleValue
  defaultValue: ScheduleValue
  onSelect: (day: ScheduleDayKey, index: number) => void
  onDayFocus: (day: ScheduleDayKey) => void
  onAddBlock: (day: ScheduleDayKey, startSec: number, endSec: number) => void
  onRemoveBlock: (day: ScheduleDayKey, startSec: number, endSec: number) => void
  onResizeBlock: (day: ScheduleDayKey, oldStart: number, oldEnd: number, newStart: number, newEnd: number, val: ScheduleValue) => void
  onMoveBlock: (fromDay: ScheduleDayKey, toDay: ScheduleDayKey, oldStart: number, oldEnd: number, newStart: number, newEnd: number, val: ScheduleValue) => void
  onOpenEditModal: (day: ScheduleDayKey, block: TimeBlock) => void
  onOpenContextMenu: (e: React.MouseEvent, day: ScheduleDayKey, block?: TimeBlock, timeSec?: number) => void
}) {
  const nowPct = useNowPercent(draft.timezone)
  const dayColRefs = useRef<Record<string, HTMLElement | null>>({})
  const [dragAction, setDragAction] = useState<DragAction | null>(null)
  const [hoverGuide, setHoverGuide] = useState<{ day: ScheduleDayKey; sec: number; y: number } | null>(null)

  function yToSec(clientY: number, colEl: HTMLElement): number {
    const rect = colEl.getBoundingClientRect()
    const relY = Math.max(0, Math.min(rect.height, clientY - rect.top))
    const ratio = relY / rect.height
    const rawSec = ratio * 86_400
    const snapped = Math.round(rawSec / STEP_SEC) * STEP_SEC
    return Math.max(0, Math.min(86_400, snapped))
  }

  useEffect(() => {
    if (!dragAction) return

    const handlePointerMove = (e: PointerEvent) => {
      const elUnder = document.elementFromPoint(e.clientX, e.clientY)
      const dayColEl = elUnder?.closest<HTMLElement>('[data-day-col]')
      const hoveredDay = (dayColEl?.dataset.day as ScheduleDayKey) || (dragAction.type === 'move' ? dragAction.targetDay : dragAction.day)

      const refCol = dayColEl || dayColRefs.current[dragAction.type === 'move' ? dragAction.targetDay : dragAction.day]
      if (!refCol) return
      const sec = yToSec(e.clientY, refCol)

      setDragAction((curr) => {
        if (!curr) return null
        if (curr.type === 'create') {
          return { ...curr, currentSec: sec }
        }
        if (curr.type === 'resize-top') {
          const snapped = Math.min(sec, curr.origEndSec - STEP_SEC)
          return { ...curr, currentSec: Math.max(0, snapped) }
        }
        if (curr.type === 'resize-bottom') {
          const snapped = Math.max(sec, curr.origStartSec + STEP_SEC)
          return { ...curr, currentSec: Math.min(86_400, snapped) }
        }
        if (curr.type === 'move') {
          const rawStart = sec - curr.offsetSec
          const clampedStart = Math.max(0, Math.min(86_400 - curr.duration, Math.round(rawStart / STEP_SEC) * STEP_SEC))
          return {
            ...curr,
            targetDay: hoveredDay,
            currentStartSec: clampedStart
          }
        }
        return curr
      })
    }

    const handlePointerUp = () => {
      setDragAction((curr) => {
        if (curr && canEdit) {
          if (curr.type === 'create') {
            const start = Math.min(curr.anchorSec, curr.currentSec)
            const end = Math.max(curr.anchorSec, curr.currentSec)
            if (end - start >= STEP_SEC) {
              onAddBlock(curr.day, start, end)
            } else {
              onDayFocus(curr.day)
            }
          } else if (curr.type === 'resize-top') {
            if (curr.currentSec !== curr.origStartSec) {
              onResizeBlock(curr.day, curr.origStartSec, curr.origEndSec, curr.currentSec, curr.origEndSec, curr.value)
            }
          } else if (curr.type === 'resize-bottom') {
            if (curr.currentSec !== curr.origEndSec) {
              onResizeBlock(curr.day, curr.origStartSec, curr.origEndSec, curr.origStartSec, curr.currentSec, curr.value)
            }
          } else if (curr.type === 'move') {
            const moved = curr.fromDay !== curr.targetDay || curr.currentStartSec !== curr.origStartSec
            if (moved) {
              onMoveBlock(
                curr.fromDay,
                curr.targetDay,
                curr.origStartSec,
                curr.origEndSec,
                curr.currentStartSec,
                curr.currentStartSec + curr.duration,
                curr.value
              )
            }
          }
        }
        return null
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragAction, canEdit, onAddBlock, onDayFocus, onResizeBlock, onMoveBlock])

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
              ref={(el) => {
                if (el) dayColRefs.current[day] = el
                else delete dayColRefs.current[day]
              }}
              data-day-col
              data-day={day}
              onPointerDown={(e) => {
                if (e.button !== 0 || !canEdit) return
                if ((e.target as HTMLElement).closest('[data-block-item]')) return
                const sec = yToSec(e.clientY, e.currentTarget)
                setDragAction({
                  type: 'create',
                  day,
                  anchorSec: sec,
                  currentSec: sec
                })
              }}
              onDoubleClick={(e) => {
                if (!canEdit) return
                if ((e.target as HTMLElement).closest('[data-block-item]')) return
                const sec = yToSec(e.clientY, e.currentTarget)
                const end = Math.min(86_400, sec + 3600)
                onAddBlock(day, sec, end)
              }}
              onContextMenu={(e) => {
                if ((e.target as HTMLElement).closest('[data-block-item]')) return
                e.preventDefault()
                const sec = yToSec(e.clientY, e.currentTarget)
                onOpenContextMenu(e, day, undefined, sec)
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
              {/* vạch giờ mỗi 6 tiếng cho dễ định vị */}
              {[6, 12, 18].map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-[var(--c-border)] opacity-50"
                     style={{ top: (h / 24) * GRID_HEIGHT }} />
              ))}

              {/* Đường vạch kẻ chuột theo thời gian thực (Google Calendar hover guide) */}
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
                const isBeingDragged =
                  (dragAction?.type === 'move' && dragAction.fromDay === day && dragAction.origStartSec === b.startSec) ||
                  ((dragAction?.type === 'resize-top' || dragAction?.type === 'resize-bottom') && dragAction.day === day && dragAction.origStartSec === b.startSec)

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
                      onOpenEditModal(day, b)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onOpenContextMenu(e, day, b)
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || !canEdit) return
                      if ((e.target as HTMLElement).closest('[data-resize-handle]')) return
                      e.stopPropagation()
                      const colEl = dayColRefs.current[day]
                      if (!colEl) return
                      const sec = yToSec(e.clientY, colEl)
                      setDragAction({
                        type: 'move',
                        fromDay: day,
                        targetDay: day,
                        origStartSec: b.startSec,
                        origEndSec: b.endSec,
                        currentStartSec: b.startSec,
                        duration: b.endSec - b.startSec,
                        offsetSec: sec - b.startSec,
                        value: b.value
                      })
                    }}
                    onKeyDown={(e) => {
                      if (!canEdit) return
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault()
                        onRemoveBlock(day, b.startSec, b.endSec)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        const dur = b.endSec - b.startSec
                        const newStart = Math.max(0, b.startSec - STEP_SEC)
                        onMoveBlock(day, day, b.startSec, b.endSec, newStart, newStart + dur, b.value)
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        const dur = b.endSec - b.startSec
                        const newStart = Math.min(86_400 - dur, b.startSec + STEP_SEC)
                        onMoveBlock(day, day, b.startSec, b.endSec, newStart, newStart + dur, b.value)
                      }
                    }}
                    title={shortTime(secondsToTime(b.startSec)) + '–' + shortTime(secondsToTime(b.endSec)) + ' · Bấm đúp để sửa, chuột phải để mở menu, kéo để di chuyển'}
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
                    {/* Handle kéo co giãn mép trên */}
                    {canEdit && (
                      <div
                        data-resize-handle="top"
                        className="absolute inset-x-0 -top-1 h-2.5 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !canEdit) return
                          e.stopPropagation()
                          setDragAction({
                            type: 'resize-top',
                            day,
                            origStartSec: b.startSec,
                            origEndSec: b.endSec,
                            currentSec: b.startSec,
                            value: b.value
                          })
                        }}
                        title="Kéo để đổi giờ bắt đầu"
                      >
                        <div className="h-1 w-6 rounded-full bg-white shadow" />
                      </div>
                    )}

                    {/* Thân hiển thị giờ của khối */}
                    <div className="flex h-full w-full flex-col justify-between overflow-hidden p-1 pointer-events-none">
                      <div className="truncate text-[9px] leading-tight font-medium">
                        {shortTime(secondsToTime(b.startSec))} – {shortTime(secondsToTime(b.endSec))}
                      </div>
                      {b.endSec - b.startSec >= 5400 && (
                        <div className="truncate text-[8px] opacity-80">
                          {formatValue(b.value, draft.value_type)}
                        </div>
                      )}
                    </div>

                    {/* Handle kéo co giãn mép dưới */}
                    {canEdit && (
                      <div
                        data-resize-handle="bottom"
                        className="absolute inset-x-0 -bottom-1 h-2.5 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !canEdit) return
                          e.stopPropagation()
                          setDragAction({
                            type: 'resize-bottom',
                            day,
                            origStartSec: b.startSec,
                            origEndSec: b.endSec,
                            currentSec: b.endSec,
                            value: b.value
                          })
                        }}
                        title="Kéo để đổi giờ kết thúc"
                      >
                        <div className="h-1 w-6 rounded-full bg-white shadow" />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Ghost block xem trước khi Kéo tạo mới */}
              {dragAction?.type === 'create' && dragAction.day === day && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg backdrop-blur-[1px]"
                  style={{
                    top: (Math.min(dragAction.anchorSec, dragAction.currentSec) / 86_400) * GRID_HEIGHT,
                    height: Math.max(14, (Math.abs(dragAction.currentSec - dragAction.anchorSec) / 86_400) * GRID_HEIGHT)
                  }}
                >
                  <span>
                    {shortTime(secondsToTime(Math.min(dragAction.anchorSec, dragAction.currentSec)))} – {shortTime(secondsToTime(Math.max(dragAction.anchorSec, dragAction.currentSec)))}
                  </span>
                </div>
              )}

              {/* Ghost block xem trước khi Kéo mép trên */}
              {dragAction?.type === 'resize-top' && dragAction.day === day && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg"
                  style={{
                    top: (dragAction.currentSec / 86_400) * GRID_HEIGHT,
                    height: Math.max(14, ((dragAction.origEndSec - dragAction.currentSec) / 86_400) * GRID_HEIGHT)
                  }}
                >
                  <span>
                    {shortTime(secondsToTime(dragAction.currentSec))} – {shortTime(secondsToTime(dragAction.origEndSec))}
                  </span>
                </div>
              )}

              {/* Ghost block xem trước khi Kéo mép dưới */}
              {dragAction?.type === 'resize-bottom' && dragAction.day === day && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-80 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-lg"
                  style={{
                    top: (dragAction.origStartSec / 86_400) * GRID_HEIGHT,
                    height: Math.max(14, ((dragAction.currentSec - dragAction.origStartSec) / 86_400) * GRID_HEIGHT)
                  }}
                >
                  <span>
                    {shortTime(secondsToTime(dragAction.origStartSec))} – {shortTime(secondsToTime(dragAction.currentSec))}
                  </span>
                </div>
              )}

              {/* Ghost block xem trước khi Kéo di chuyển khối */}
              {dragAction?.type === 'move' && dragAction.targetDay === day && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 rounded border-2 border-dashed border-white bg-[var(--c-accent)] opacity-85 z-30 flex items-center justify-center text-[10px] font-semibold text-white shadow-xl ring-2 ring-white/60"
                  style={{
                    top: (dragAction.currentStartSec / 86_400) * GRID_HEIGHT,
                    height: Math.max(14, (dragAction.duration / 86_400) * GRID_HEIGHT)
                  }}
                >
                  <span>
                    {shortTime(secondsToTime(dragAction.currentStartSec))} – {shortTime(secondsToTime(dragAction.currentStartSec + dragAction.duration))}
                  </span>
                </div>
              )}

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
      <summary className="cursor-pointer font-semibold">Thao tác kiểu Google Calendar & Bàn phím</summary>
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
