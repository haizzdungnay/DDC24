import { Check, Clock3, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { DataTable, Column } from '../components/DataTable'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { TrendChart, type TrendSeries } from '../components/TrendChart'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'
import type { Point, TrendSample } from '../types'
import { cn, isFreshIso, mergePointsById } from '../utils'

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
const liveSampleLimit = 3600
const REALTIME_STALE_MS = 2500

function historyRangeFromMinutes(minutes: number) {
  if (minutes <= 30) return '30m'
  if (minutes <= 60) return '1h'
  if (minutes <= 360) return '6h'
  return '24h'
}

function pointNumber(value: Point['value']) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function makeTrendSample(points: Point[]) {
  if (!points.length) return null
  const sample: TrendSample = { time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  for (const point of points) {
    const value = pointNumber(point.value)
    if (value !== null) sample[point.id] = Number(value.toFixed(2))
  }
  return Object.keys(sample).length > 1 ? sample : null
}

export function TrendsPage() {
  const realtime = useRealtime()
  const { pick } = useI18n()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const analogPoints = useMemo(() => {
    const polledPoints = pointsState.data ?? []
    const source = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
      ? mergePointsById(polledPoints, realtime.allPoints)
      : polledPoints
    return source.filter((point) => (point.kind === 'UI' || point.kind === 'AO') && pointNumber(point.value) !== null).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
  }, [pointsState.data, realtime.allPoints, realtime.lastPointEventAt])
  const autoSelectedRef = useRef(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rangeMinutes, setRangeMinutes] = useState<number>(30)
  const [pickerOpen, setPickerOpen] = useState(false)

  const selectedPoints = useMemo(() => analogPoints.filter((point) => selectedIds.includes(point.id)), [analogPoints, selectedIds])
  const selectedSignature = selectedIds.join(',')
  const historyRange = useMemo(() => historyRangeFromMinutes(rangeMinutes), [rangeMinutes])
  const historyState = useApi(() => apiClient.getHistory(selectedIds, historyRange), [historyRange, selectedSignature], { refreshMs: 10_000 })
  const selectedPointsRef = useRef<Point[]>([])
  const [liveSamples, setLiveSamples] = useState<TrendSample[]>([])
  const samples = historyState.data?.length ? historyState.data : liveSamples
  const series = useMemo<TrendSeries[]>(() => selectedPoints.map((point, index) => ({
    key: point.id,
    label: `${point.id} - ${point.name}`,
    color: colors[index % colors.length],
    unit: point.unit
  })), [selectedPoints])
  const tableRows = useMemo(() => buildTrendRows(selectedPoints, samples), [samples, selectedPoints])
  const currentRange = rangeOptions.find((item) => item.minutes === rangeMinutes)
  const rangeLabel = currentRange ? pick(currentRange.labelVi, currentRange.labelEn) : pick(`${rangeMinutes} phút`, `${rangeMinutes} min`)

  useEffect(() => {
    setSelectedIds((current) => {
      const existing = current.filter((id) => analogPoints.some((point) => point.id === id))
      if (existing.length || autoSelectedRef.current) return existing
      if (!analogPoints.length) return existing
      autoSelectedRef.current = true
      return analogPoints.slice(0, 4).map((point) => point.id)
    })
  }, [analogPoints])

  useEffect(() => {
    selectedPointsRef.current = selectedPoints
  }, [selectedPoints])

  useEffect(() => {
    setLiveSamples([])
  }, [historyRange, selectedSignature])

  useEffect(() => {
    const appendSample = () => {
      const sample = makeTrendSample(selectedPointsRef.current)
      if (!sample) return
      setLiveSamples((current) => [...current, sample].slice(-liveSampleLimit))
    }

    appendSample()
    const timerId = window.setInterval(appendSample, 1000)
    return () => window.clearInterval(timerId)
  }, [])

  function togglePoint(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function resetAuto() {
    setSelectedIds(analogPoints.slice(0, 4).map((point) => point.id))
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
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Trend Log live: object list, historian và buffer hiển thị 1s', 'Live Trend Log: object list, historian, and 1s display buffer')}</p>
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
              <div className="mb-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Object list analog UI/AO', 'Analog UI/AO object list')}</div>
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
          {pointsState.loading && !analogPoints.length
            ? <StateBlock state="loading" title={pick('Đang tải điểm analog', 'Loading analog points')} />
            : pointsState.error && !analogPoints.length
              ? <StateBlock state="error" title={pick('Không tải được điểm analog', 'Could not load analog points')} detail={pointsState.error.message} />
              : series.length && samples.length > 1
                ? <TrendChart data={samples} series={series} height={360} />
                : <StateBlock state="empty" title={series.length ? pick('Chưa có dữ liệu xu hướng live', 'No live trend data yet') : pick('Chọn ít nhất một điểm analog', 'Select at least one analog point')} detail={series.length ? pick('Trang này đọc /history nếu có và tự ghi buffer 1s từ /points hoặc WebSocket khi historian chưa có mẫu.', 'This page reads /history when available and records a 1s local buffer from /points or WebSocket until historian has samples.') : undefined} />}
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
    const fallback = pointNumber(point.value) ?? 0
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
