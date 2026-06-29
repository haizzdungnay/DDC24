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
const TREND_PREFS_KEY = 'mkddc:trends:v1'
const DEFAULT_TREND_IDS = Array.from({ length: 8 }, (_, index) => `UI-${String(index + 1).padStart(2, '0')}`)

interface TrendPrefs {
  selectedIds: string[]
  rangeMinutes: number
}

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
  const now = Date.now()
  const sample: TrendSample = { time: new Date(now).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), __ts: now }
  let hasValue = false
  for (const point of points) {
    const value = pointNumber(point.value)
    if (value !== null) {
      sample[point.id] = Number(value.toFixed(2))
      hasValue = true
    }
  }
  return hasValue ? sample : null
}

function mergeTrendSamples(history: TrendSample[] | null | undefined, live: TrendSample[]) {
  const historySamples = history ?? []
  if (!historySamples.length) return stableTrendSamples(live)
  const latestHistoryTs = Math.max(...historySamples.map(sampleTimestamp).filter(Number.isFinite))
  const liveTail = Number.isFinite(latestHistoryTs) ? live.filter((sample) => sampleTimestamp(sample) > latestHistoryTs) : []
  return stableTrendSamples([...historySamples, ...liveTail])
}

function sampleTimestamp(sample: TrendSample) {
  const value = sample.__ts
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
}

function stableTrendSamples(samples: TrendSample[]) {
  const bySlot = new Map<string, TrendSample>()
  for (const sample of samples) {
    const timestamp = sampleTimestamp(sample)
    const key = Number.isFinite(timestamp) ? String(Math.round(timestamp / 1000)) : sample.time
    bySlot.set(key, { ...(bySlot.get(key) ?? {}), ...sample })
  }
  return [...bySlot.values()].sort((a, b) => sampleTimestamp(a) - sampleTimestamp(b))
}

function readTrendPrefs(): TrendPrefs | null {
  try {
    const raw = window.localStorage.getItem(TREND_PREFS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TrendPrefs>
    const selectedIds = Array.isArray(parsed.selectedIds) ? parsed.selectedIds.filter((id): id is string => typeof id === 'string') : []
    const storedRange = parsed.rangeMinutes
    const rangeMinutes = typeof storedRange === 'number' && rangeOptions.some((item) => item.minutes === storedRange) ? storedRange : 30
    return { selectedIds, rangeMinutes }
  } catch {
    return null
  }
}

function writeTrendPrefs(prefs: TrendPrefs) {
  try {
    window.localStorage.setItem(TREND_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage can be unavailable in private/locked browser modes.
  }
}

export function TrendsPage() {
  const realtime = useRealtime()
  const { pick } = useI18n()
  const initialPrefsRef = useRef<TrendPrefs | null | undefined>(undefined)
  if (initialPrefsRef.current === undefined) initialPrefsRef.current = readTrendPrefs()
  const hasSavedPrefsRef = useRef(initialPrefsRef.current !== null)
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const analogPoints = useMemo(() => {
    const polledPoints = pointsState.data ?? []
    const source = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
      ? mergePointsById(polledPoints, realtime.allPoints)
      : polledPoints
    return source.filter((point) => (point.kind === 'UI' || point.kind === 'AO') && pointNumber(point.value) !== null).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
  }, [pointsState.data, realtime.allPoints, realtime.lastPointEventAt])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialPrefsRef.current?.selectedIds ?? [])
  const [rangeMinutes, setRangeMinutes] = useState<number>(() => initialPrefsRef.current?.rangeMinutes ?? 30)
  const [prefsReady, setPrefsReady] = useState(() => initialPrefsRef.current !== null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const analogPanelRef = useRef<HTMLDivElement>(null)
  const [analogPanelHeight, setAnalogPanelHeight] = useState<number | null>(null)

  const selectedPoints = useMemo(() => analogPoints.filter((point) => selectedIds.includes(point.id)), [analogPoints, selectedIds])
  const selectedSignature = selectedIds.join(',')
  const historyRange = useMemo(() => historyRangeFromMinutes(rangeMinutes), [rangeMinutes])
  const historyState = useApi(() => apiClient.getHistory(selectedIds, historyRange), [historyRange, selectedSignature], { refreshMs: 10_000 })
  const selectedPointsRef = useRef<Point[]>([])
  const [liveSamples, setLiveSamples] = useState<TrendSample[]>([])
  const samples = useMemo(() => mergeTrendSamples(historyState.data, liveSamples), [historyState.data, liveSamples])
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
    if (!analogPoints.length) return
    setSelectedIds((current) => {
      const available = new Set(analogPoints.map((point) => point.id))
      if (hasSavedPrefsRef.current) return current.filter((id) => available.has(id))

      const defaults = DEFAULT_TREND_IDS.filter((id) => available.has(id))
      return defaults.length ? defaults : analogPoints.slice(0, 8).map((point) => point.id)
    })
    setPrefsReady(true)
  }, [analogPoints])

  useEffect(() => {
    if (!prefsReady) return
    writeTrendPrefs({ selectedIds, rangeMinutes })
    hasSavedPrefsRef.current = true
  }, [prefsReady, rangeMinutes, selectedIds])

  useEffect(() => {
    const target = analogPanelRef.current
    if (!target) return undefined

    const syncHeight = () => setAnalogPanelHeight(Math.ceil(target.getBoundingClientRect().height))
    syncHeight()

    const observer = new ResizeObserver(syncHeight)
    observer.observe(target)
    window.addEventListener('resize', syncHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncHeight)
    }
  }, [])

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
    hasSavedPrefsRef.current = true
    setPrefsReady(true)
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function resetAuto() {
    hasSavedPrefsRef.current = true
    setPrefsReady(true)
    const available = new Set(analogPoints.map((point) => point.id))
    const defaults = DEFAULT_TREND_IDS.filter((id) => available.has(id))
    setSelectedIds(defaults.length ? defaults : analogPoints.slice(0, 8).map((point) => point.id))
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

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[300px_1fr]">
        <div className="min-h-0" style={analogPanelHeight ? { height: analogPanelHeight } : undefined}>
          <Panel title="Series" className="flex h-full min-h-0 flex-col overflow-hidden" action={<Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setPickerOpen((open) => !open)}>{pickerOpen ? pick('Đóng', 'Close') : pick('Thêm trend', 'Add trend')}</Button>}>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {selectedPoints.map((point, index) => <SeriesCard key={point.id} point={point} color={colors[index % colors.length]} onRemove={() => togglePoint(point.id)} />)}
              {!selectedPoints.length && <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-4 text-sm text-[var(--c-text-dim)]">{pick('Chưa chọn điểm trend.', 'No trend points selected.')}</div>}
            </div>
          </Panel>
        </div>

        <div ref={analogPanelRef}>
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
