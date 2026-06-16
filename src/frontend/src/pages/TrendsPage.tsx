import { Plus, Shuffle } from 'lucide-react'
import { Button } from '../components/Button'
import { DataTable, Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { TrendChart } from '../components/TrendChart'
import { getTrendSamples } from '../demo/simulator'

interface TrendRow { id: string; current: number; avg: number; min: number; max: number; unit: string; show: boolean }

const rows: TrendRow[] = [
  { id: 'AI-01 - Temperature', current: 38.6, avg: 37.9, min: 32.1, max: 42.8, unit: 'C', show: true },
  { id: 'AI-02 - Pressure', current: 9.8, avg: 9.6, min: 8.7, max: 10.4, unit: 'bar', show: true },
  { id: 'AI-03 - Humidity', current: 78.6, avg: 76.3, min: 65.2, max: 82.1, unit: '%', show: true },
  { id: 'AI-04 - Flow', current: 120.4, avg: 118.7, min: 110.2, max: 128.6, unit: 'm3/h', show: true }
]

export function TrendsPage() {
  const columns: Array<Column<TrendRow>> = [
    { key: 'trend', header: 'Trend', render: (row) => <span className="font-semibold">{row.id}</span> },
    { key: 'current', header: 'Giá trị hiện tại', render: (row) => <span className="mono">{row.current}</span> },
    { key: 'avg', header: 'Giá trị TB', render: (row) => <span className="mono">{row.avg}</span> },
    { key: 'min', header: 'Giá trị min', render: (row) => <span className="mono">{row.min}</span> },
    { key: 'max', header: 'Giá trị max', render: (row) => <span className="mono">{row.max}</span> },
    { key: 'unit', header: 'Đơn vị', render: (row) => row.unit },
    { key: 'show', header: 'Hiển thị', render: () => <StatusBadge state="online" label="ON" /> }
  ]
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Trends</h1><p className="text-sm text-[var(--c-text-dim)]">Xu hướng tín hiệu analog</p></div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_1fr]">
        <Panel title="Series" action={<Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />}>Thêm trend</Button>}>
          <div className="space-y-2">
            {rows.map((row) => <div key={row.id} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(11,18,32,0.5)] p-3"><div className="text-sm font-semibold">{row.id}</div><div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{row.current} {row.unit}</div></div>)}
          </div>
        </Panel>
        <Panel title="30 phút" action={<div className="flex gap-2"><Button size="sm">1 giờ</Button><Button size="sm">6 giờ</Button><Button size="sm" icon={<Shuffle className="h-4 w-4" />}>Auto</Button></div>}>
          <TrendChart data={getTrendSamples()} height={360} />
        </Panel>
      </div>
      <Panel>
        <DataTable rows={rows} columns={columns} getRowKey={(row) => row.id} />
      </Panel>
    </div>
  )
}
