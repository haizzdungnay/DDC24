import { CalendarDays, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { getDemoSchedule } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { ScheduleCell, ScheduleRow } from '../types'

type ScheduleValue = ScheduleCell['value']

interface EditingCell {
  rowId: string
  day: string
}

const colorByValue: Record<ScheduleValue, string> = {
  ON: 'bg-[rgba(47,164,90,0.12)] border-[rgba(47,164,90,0.48)] text-[var(--c-good-fg)]',
  OFF: 'bg-[rgba(143,161,189,0.12)] border-[rgba(107,114,128,0.35)] text-[var(--c-off)]',
  OPEN: 'bg-[rgba(42,92,138,0.12)] border-[rgba(42,92,138,0.42)] text-[var(--c-accent)]',
  CLOSE: 'bg-[rgba(232,181,0,0.16)] border-[rgba(232,181,0,0.55)] text-[var(--c-warn-fg)]'
}

const values: ScheduleValue[] = ['ON', 'OFF', 'OPEN', 'CLOSE']
const makeDefaultCell = (day: string): ScheduleCell => ({ day, value: 'OFF', start: '08:00', end: '17:00' })

export function SchedulerPage() {
  const toast = useToast()
  const { pick } = useI18n()
  const [rows, setRows] = useState<ScheduleRow[]>(() => getDemoSchedule())
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [draft, setDraft] = useState<ScheduleCell | null>(null)
  const days = useMemo(() => rows[0]?.cells.map((cell) => cell.day) ?? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], [rows])
  const editingRow = editing ? rows.find((row) => row.id === editing.rowId) : undefined

  function openCell(row: ScheduleRow, cell: ScheduleCell) {
    setEditing({ rowId: row.id, day: cell.day })
    setDraft({ ...cell })
  }

  function saveCell() {
    if (!editing || !draft) return
    setRows((current) => current.map((row) => row.id !== editing.rowId ? row : {
      ...row,
      cells: row.cells.map((cell) => cell.day === editing.day ? { ...draft, day: editing.day } : cell)
    }))
    setEditing(null)
    setDraft(null)
    toast.push('success', pick('Đã lưu (demo)', 'Saved (demo)'))
  }

  function addSchedule() {
    const index = rows.length + 1
    setRows((current) => [...current, { id: `SCH-${String(index).padStart(2, '0')}`, label: 'Weekly Template', cells: days.map(makeDefaultCell) }])
    toast.push('info', pick('Đã thêm lịch demo', 'Demo schedule added'))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Lịch vận hành', 'Scheduler')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Lịch tuần — tự lặp lại mỗi 7 ngày', 'Weekly schedule — repeats every 7 days')}</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={addSchedule}>{pick('Thêm lịch', 'Add schedule')}</Button>
      </div>

      <Panel title="Weekly Schedule Template" subtitle={pick('BACnet Weekly_Schedule: mẫu 7 ngày, tự lặp lại hằng tuần.', 'BACnet Weekly_Schedule: 7-day template, repeating weekly.')}>
        <div className="overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid min-w-[920px] grid-cols-[180px_repeat(7,1fr)] bg-[var(--c-surface-2)] text-xs text-[var(--c-text-dim)]">
            <div className="border-r border-[var(--c-border)] p-3 font-semibold">{pick('Thiết bị', 'Device')}</div>
            {days.map((day) => <div key={day} className="border-r border-[var(--c-border)] p-3 text-center font-semibold last:border-0">{day}</div>)}
          </div>
          {rows.map((row) => (
            <div key={row.id} className="grid min-w-[920px] grid-cols-[180px_repeat(7,1fr)] border-t border-[var(--c-border)]">
              <div className="border-r border-[var(--c-border)] p-3">
                <div className="font-semibold">{row.id}</div>
                <div className="text-xs text-[var(--c-text-dim)]">{row.label}</div>
              </div>
              {row.cells.map((cell) => (
                <div key={`${row.id}-${cell.day}`} className="border-r border-[var(--c-border)] p-2 last:border-0">
                  <button
                    type="button"
                    onClick={() => openCell(row, cell)}
                    className={`min-h-[68px] w-full rounded-[var(--radius)] border p-2 text-left text-xs transition hover:-translate-y-0.5 hover:border-[var(--c-accent)] ${colorByValue[cell.value]}`}
                  >
                    <div className="font-semibold">{cell.value}</div>
                    <div className="mono mt-1 text-[10px] text-[var(--c-text)]">{cell.start} - {cell.end}</div>
                    <div className="mt-2 text-[10px] text-[var(--c-text-dim)]">{pick('Click để sửa', 'Click to edit')}</div>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-5 text-xs text-[var(--c-text-dim)]">
          <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[var(--c-accent)]" />{pick('Tuần lặp', 'Repeating week')}</span>
          {values.map((value) => <span key={value} className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full border ${colorByValue[value]}`} />{value}</span>)}
        </div>
      </Panel>

      <Panel title={pick('Ngoại lệ / ngày lễ', 'Exceptions / holidays')} subtitle={pick('Theo BACnet Exception_Schedule — sẽ bổ sung.', 'BACnet Exception_Schedule — to be added.')}>
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] bg-[var(--c-surface)] p-4 text-sm text-[var(--c-text-dim)]">
          {pick('Placeholder demo cho lịch ngoại lệ, holiday calendar và override theo ngày đặc biệt.', 'Demo placeholder for exception schedules, holiday calendar, and special-day overrides.')}
        </div>
      </Panel>

      <Modal open={Boolean(editing && draft)} title={pick(`Sửa ${editingRow?.id ?? ''} · ${editing?.day ?? ''}`, `Edit ${editingRow?.id ?? ''} · ${editing?.day ?? ''}`)} confirmLabel={pick('Lưu demo', 'Save demo')} onConfirm={saveCell} onClose={() => { setEditing(null); setDraft(null) }}>
        {draft && (
          <div className="space-y-4">
            <label className="block text-sm">
              {pick('Trạng thái', 'State')}
              <select value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value as ScheduleValue })} className="mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3">
                {values.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Start<input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" /></label>
              <label className="block text-sm">End<input type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" /></label>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-xs text-[var(--c-text-dim)]">
              {pick('Thay đổi chỉ lưu trong state local để demo UI. Không ghi backend.', 'Changes are stored only in local state for the UI demo. Backend is not written.')}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}