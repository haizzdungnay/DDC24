import { Check, Clock3, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../components/Button'
import { DataTable, Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { TrendChart, type TrendSeries } from '../components/TrendChart'
import { getDemoPoints, getTrendSamples } from '../demo/simulator'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'
import type { Point, TrendSample } from '../types'
import { cn } from '../utils'

interface TrendRow {
  id: string
  name: string
  current: number
  avg: number
  min: number
  max: number
  unit: string
  samples: number
}

const rangeOptions = [
  { labelVi: '30 phút', labelEn: '30 min', minutes: 30 },
  { labelVi: '1 giờ', labelEn: '1 hour', minutes: 60 },
  { labelVi: '6 giờ', labelEn: '6 hours', minutes: 360 },
  { labelVi: '24 giờ', labelEn: '24 hours', minutes: 1440 }
] as const

const colors = ['#2A5C8A', 'var(--c-warn-fg)', '#6E5A2E', '#8A4FBF', '#5B6066', 'var(--c-fault-fg)', '#B0179C', 'var(--c-off)']

export function TrendsPage() {
  const realtime = useRealtime()
  const { pick } = useI18n()
  const analogPoints = useMemo(() => {
    const source = realtime.allPoints.length ? realtime.allPoints : getDemoPoints()
    return source.filter((point) => point.kind === 'AI' || point.kind === 'AO').sort((a, b) => a.id.localeCompare(b.id))
  }, [realtime.allPoints])
  const [selectedIds, setSelectedIds] = useState<string[]>(['AI-01', 'AI-02', 'AI-03', 'AI-04'])
  const [rangeMinutes, setRangeMinutes] = useState<number>(30)
  const [pickerOpen, setPickerOpen] = useState(false)

  const selectedPoints = useMemo(() => analogPoints.filter((point) => selectedIds.includes(point.id)), [analogPoints, selectedIds])
  const samples = useMemo(() => getTrendSamples(selectedIds, rangeMinutes), [rangeMinutes, selectedIds, realtime.lastEventAt])
  const series = useMemo<TrendSeries[]>(() => selectedPoints.map((point, index) => ({
    key: point.id,
    label: `${point.id} - ${point.name}`,
    color: colors[index % colors.length],
    unit: point.unit
  })), [selectedPoints])
  const tableRows = useMemo(() => buildTrendRows(selectedPoints, samples), [samples, selectedPoints])
  const currentRange = rangeOptions.find((item) => item.minutes === rangeMinutes)
  const rangeLabel = currentRange ? pick(currentRange.labelVi, currentRange.labelEn) : pick(`${rangeMinutes} phút`, `${rangeMinutes} min`)

  function togglePoint(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function resetAuto() {
    setSelectedIds(['AI-01', 'AI-02', 'AI-03', 'AI-04'].filter((id) => analogPoints.some((point) => point.id === id)))
    setRangeMinutes(30)
  }

  const columns: Array<Column<TrendRow>> = [
    { key: 'trend', header: 'Trend', render: (row) => <span className="font-semibold">{row.id} - {row.name}</span> },
    { key: 'current', header: pick('Giá trị hiện tại', 'Current'), render: (row) => <span className="mono">{row.current}</span> },
    { key: 'avg', header: pick('Giá trị TB', 'Average'), render: (row) => <span className="mono">{row.avg}</span> },
    { key: 'min', header: pick('Giá trị min', 'Minimum'), render: (row) => <span className="mono">{row.min}</span> },
    { key: 'max', header: pick('Giá trị max', 'Maximum'), render: (row) => <span className="mono">{row.max}</span> },
    { key: 'unit', header: pick('Đơn vị', 'Unit'), render: (row) => row.unit },
    { key: 'samples', header: pick('Mẫu', 'Samples'), render: (row) => <span className="mono">{row.samples}</span> },
    { key: 'show', header: pick('Hiển thị', 'Visible'), render: () => <StatusBadge state="online" label="ON" /> }
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{pick('Xu hướng', 'Trends')}</h1>
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Trend Log demo: object list, interval và buffer hiển thị client-side', 'Trend Log demo: object list, interval, and client-side display buffer')}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[300px_1fr]">
        <Panel title="Series" action={<Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setPickerOpen((open) => !open)}>{pickerOpen ? pick('Đóng', 'Close') : pick('Thêm trend', 'Add trend')}</Button>}>
          <div className="space-y-2">
            {selectedPoints.map((point, index) => <SeriesCard key={point.id} point={point} color={colors[index % colors.length]} onRemove={() => togglePoint(point.id)} />)}
            {!selectedPoints.length && <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-4 text-sm text-[var(--c-text-dim)]">{pick('Chưa chọn điểm trend.', 'No trend points selected.')}</div>}
          </div>
        </Panel>

        <Panel title={`${pick('Xu hướng analog', 'Analog trend')} - ${rangeLabel}`} action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={resetAuto}>Auto</Button></div>}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {rangeOptions.map((item) => <Button key={item.minutes} size="sm" variant={rangeMinutes === item.minutes ? 'primary' : 'secondary'} icon={<Clock3 className="h-4 w-4" />} onClick={() => setRangeMinutes(item.minutes)}>{pick(item.labelVi, item.labelEn)}</Button>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedPoints.map((point, index) => <button key={point.id} type="button" onClick={() => togglePoint(point.id)} className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-xs text-[var(--c-text)]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />{point.id}</button>)}
            </div>
          </div>
          {pickerOpen && (
            <div className="mb-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
              <div className="mb-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Object list analog AI/AO', 'Analog AI/AO object list')}</div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {analogPoints.map((point) => (
                  <label key={point.id} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-[var(--c-border)] px-3 py-2 text-sm hover:bg-[rgba(42,92,138,0.08)]">
                    <input type="checkbox" className="accent-[var(--c-accent)]" checked={selectedIds.includes(point.id)} onChange={() => togglePoint(point.id)} />
                    <span className="mono font-semibold">{point.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--c-text-dim)]">{point.name}</span>
                    <span className="mono text-xs text-[var(--c-text-dim)]">{point.unit ?? '-'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {series.length ? <TrendChart data={samples} series={series} height={360} /> : <div className="grid h-[360px] place-items-center rounded-[var(--radius)] border border-dashed border-[var(--c-border)] text-sm text-[var(--c-text-dim)]">{pick('Chọn ít nhất một điểm analog để hiển thị trend.', 'Select at least one analog point to show a trend.')}</div>}
        </Panel>
      </div>

      <Panel title={pick('Thống kê series đang hiển thị', 'Visible series statistics')}>
        <DataTable rows={tableRows} columns={columns} getRowKey={(row) => row.id} emptyText={pick('Chưa chọn trend', 'No trend selected')} />
      </Panel>
    </div>
  )
}

function SeriesCard({ point, color, onRemove }: { point: Point; color: string; onRemove: () => void }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{point.id}</div>
          <div className="mt-1 truncate text-xs text-[var(--c-text-dim)]">{point.name}</div>
          <div className="mono mt-2 text-xs text-[var(--c-text-dim)]">{point.value} {point.unit ?? ''}</div>
        </div>
        <button type="button" onClick={onRemove} className={cn('grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-[var(--c-border)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]')} aria-label={`Remove ${point.id}`}>
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function buildTrendRows(points: Point[], samples: TrendSample[]): TrendRow[] {
  return points.map((point) => {
    const values = samples.map((sample) => Number(sample[point.id])).filter(Number.isFinite)
    const sum = values.reduce((total, value) => total + value, 0)
    const fallback = Number(point.value) || 0
    const current = values.length ? values[values.length - 1] : fallback
    return {
      id: point.id,
      name: point.name,
      current: Number(current.toFixed(1)),
      avg: Number((sum / Math.max(1, values.length)).toFixed(1)),
      min: Number(Math.min(...values, current).toFixed(1)),
      max: Number(Math.max(...values, current).toFixed(1)),
      unit: point.unit ?? '-',
      samples: values.length
    }
  })
}