import { CalendarDays, Plus } from 'lucide-react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { getDemoSchedule } from '../demo/simulator'

const colorByValue: Record<string, string> = { ON: 'bg-[rgba(47,191,113,0.22)] border-[rgba(47,191,113,0.45)]', OFF: 'bg-[rgba(143,161,189,0.12)] border-[rgba(143,161,189,0.25)]', OPEN: 'bg-[rgba(34,211,238,0.18)] border-[rgba(34,211,238,0.42)]', CLOSE: 'bg-[rgba(224,161,6,0.18)] border-[rgba(224,161,6,0.42)]' }

export function SchedulerPage() {
  const rows = getDemoSchedule()
  const days = rows[0]?.cells.map((cell) => cell.day) ?? []
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Scheduler</h1><p className="text-sm text-[var(--c-text-dim)]">Lịch vận hành theo tuần</p></div><Button variant="primary" icon={<Plus className="h-4 w-4" />}>Thêm lịch</Button></div>
      <Panel action={<div className="flex gap-2"><Button size="sm" variant="primary">Tuần</Button><Button size="sm">Tháng</Button></div>}>
        <div className="overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid min-w-[920px] grid-cols-[180px_repeat(7,1fr)] bg-[var(--c-surface-2)] text-xs text-[var(--c-text-dim)]">
            <div className="border-r border-[var(--c-border)] p-3 font-semibold">Thiết bị</div>{days.map((day) => <div key={day} className="border-r border-[var(--c-border)] p-3 font-semibold last:border-0">{day}</div>)}
          </div>
          {rows.map((row) => <div key={row.id} className="grid min-w-[920px] grid-cols-[180px_repeat(7,1fr)] border-t border-[var(--c-border)]"><div className="border-r border-[var(--c-border)] p-3"><div className="font-semibold">{row.id}</div><div className="text-xs text-[var(--c-text-dim)]">{row.label}</div></div>{row.cells.map((cell) => <div key={`${row.id}-${cell.day}`} className="border-r border-[var(--c-border)] p-2 last:border-0"><div className={`rounded-[var(--radius)] border p-2 text-xs ${colorByValue[cell.value]}`}><div className="font-semibold">{cell.value}</div><div className="mono mt-1 text-[10px]">{cell.start} - {cell.end}</div></div></div>)}</div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-5 text-xs text-[var(--c-text-dim)]"><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[var(--c-accent)]" />ON</span><span>OFF</span><span>OPEN</span><span>CLOSE</span></div>
      </Panel>
    </div>
  )
}
