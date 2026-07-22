import { Check, Clock3, Plus, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { historyClient, historySeriesKey, type HistoryResponse } from '../api/history'
import { HISTORIAN_V2_TRENDS_ENABLED } from '../config'
import { Button } from '../components/Button'
import { DataTable, Column } from '../components/DataTable'
import { HistoryStateBanner, type HistoryPresentationState } from '../components/HistoryStateBanner'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { TrendChart, type TrendSeries } from '../components/TrendChart'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'
import type { Point, TrendSample, VirtualPoint } from '../types'
import { canonicalVirtualPointId, cn, isFreshIso, mergePointsById, pointDisplayTag } from '../utils'
import { filterTrendPoints, filterTrendSamplesByRange, parseTrendCustomRange, utcDateTimeInputValue, type TrendCustomRange, type TrendFilterKind } from './trendsFilters'

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
const REALTIME_STALE_MS = 2500
const TREND_PREFS_KEY = 'mkddc:trends:v1'
const DEFAULT_TREND_IDS = Array.from({ length: 8 }, (_, index) => `UI-${String(index + 1).padStart(2, '0')}`)
const trendFilterKinds: TrendFilterKind[] = ['UI', 'AO', 'DO', 'VP']

interface TrendPrefs {
  selectedIds: string[]
  rangeMinutes: number
}

function pointNumber(value: Point['value']) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return null
}

function isPhysicalTrendPoint(point: Point): boolean {
  return (point.kind === 'UI' || point.kind === 'AO' || point.kind === 'DO') && pointNumber(point.value) !== null
}

function isVirtualTrendPoint(item: VirtualPoint): boolean {
  return item.enabled && (item.signalType === 'boolean' || item.signalType === 'integer' || item.signalType === 'float')
}

function visibleTrendPoints(points: Point[], virtualPoints: VirtualPoint[]): Point[] {
  const virtualById = new Map(
    virtualPoints
      .filter(isVirtualTrendPoint)
      .map((item) => [canonicalVirtualPointId(item.id), item])
  )
  return points.flatMap((point) => {
    if (point.kind !== 'virtual') return isPhysicalTrendPoint(point) ? [point] : []
    const meta = virtualById.get(canonicalVirtualPointId(point.id))
    if (!meta) return []
    const value = meta.value ?? point.value
    if (pointNumber(value) === null) return []
    return [{
      ...point,
      id: canonicalVirtualPointId(meta.id),
      tag: meta.tag,
      name: meta.tag,
      value,
      unit: meta.unit ?? point.unit,
      signalType: meta.signalType,
      logEnabled: meta.logEnabled,
      logIntervalMs: meta.logIntervalMs,
      updatedAt: meta.updatedAt ?? point.updatedAt
    }]
  })
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
  const virtualState = useApi(apiClient.getVirtualPoints, [], { refreshMs: 2000 })
  const analogPoints = useMemo(() => {
    const polledPoints = pointsState.data ?? []
    const source = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
      ? mergePointsById(polledPoints, realtime.allPoints)
      : polledPoints
    return visibleTrendPoints(source, virtualState.data ?? []).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
  }, [pointsState.data, realtime.allPoints, realtime.lastPointEventAt, virtualState.data])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialPrefsRef.current?.selectedIds ?? [])
  const [rangeMinutes, setRangeMinutes] = useState<number>(() => initialPrefsRef.current?.rangeMinutes ?? 30)
  const [prefsReady, setPrefsReady] = useState(() => initialPrefsRef.current !== null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerKinds, setPickerKinds] = useState<TrendFilterKind[]>(trendFilterKinds)
  const [pickerDraft, setPickerDraft] = useState<string[]>([])
  const [customFrom, setCustomFrom] = useState(() => utcDateTimeInputValue(new Date(Date.now() - 30 * 60_000)))
  const [customTo, setCustomTo] = useState(() => utcDateTimeInputValue(new Date()))
  const [customRange, setCustomRange] = useState<TrendCustomRange | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const analogPanelRef = useRef<HTMLDivElement>(null)
  const addTrendButtonRef = useRef<HTMLButtonElement>(null)
  const [analogPanelHeight, setAnalogPanelHeight] = useState<number | null>(null)

  const selectedPoints = useMemo(() => analogPoints.filter((point) => selectedIds.includes(point.id)), [analogPoints, selectedIds])
  const selectedSignature = selectedIds.join(',')
  const historyState = useApi(async () => {
    const toMs = customRange?.toMs ?? Date.now()
    const fromMs = customRange?.fromMs ?? toMs - rangeMinutes * 60_000
    if (!selectedIds.length) return emptyHistoryResponse(fromMs, toMs)
    if (!HISTORIAN_V2_TRENDS_ENABLED) {
      const legacy = await apiClient.getHistory(selectedIds, customRange ? '24h' : legacyHistoryRange(rangeMinutes))
      const samples = customRange ? filterTrendSamplesByRange(legacy, fromMs, toMs) : legacy
      return legacyHistoryResponse(selectedIds, samples, fromMs, toMs)
    }
    return historyClient.query({
      pointIds: selectedIds,
      from: new Date(fromMs),
      to: new Date(toMs),
      resolution: 'auto',
      maxPoints: 5000,
      source: historySourceForRange(customRange)
    })
  }, [customRange?.fromMs, customRange?.toMs, rangeMinutes, selectedSignature], { refreshMs: 10_000 })
  const chartModel = useMemo(() => buildHistoryChartModel(historyState.data, selectedPoints), [historyState.data, selectedPoints])
  const samples = chartModel.samples
  const filteredPickerPoints = useMemo(() => filterTrendPoints(analogPoints, pickerQuery, pickerKinds), [analogPoints, pickerKinds, pickerQuery])
  const series = chartModel.series
  const chartSamples = useMemo(
    () => appendLiveTrendSample(samples, series, selectedPoints, HISTORIAN_V2_TRENDS_ENABLED && !customRange),
    [customRange, samples, selectedPoints, series]
  )
  const tableRows = useMemo(() => buildTrendRows(series, selectedPoints, samples, HISTORIAN_V2_TRENDS_ENABLED && !customRange), [customRange, samples, selectedPoints, series])
  const historyPresentation = historyPresentationState(historyState.data, historyState.error)
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

  function togglePoint(id: string) {
    hasSavedPrefsRef.current = true
    setPrefsReady(true)
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 8))
  }

  function openPicker() {
    setPickerDraft([...selectedIds])
    setPickerOpen(true)
  }

  function togglePickerPoint(id: string) {
    setPickerDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 8 ? [...current, id] : current)
  }

  function applyPicker() {
    hasSavedPrefsRef.current = true
    setPrefsReady(true)
    setSelectedIds(pickerDraft)
    setPickerOpen(false)
  }

  function togglePickerKind(kind: TrendFilterKind) {
    setPickerKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind])
  }

  function applyCustomRange() {
    try {
      setCustomRange(parseTrendCustomRange(customFrom, customTo))
      setRangeMinutes(1440)
      setCustomError(null)
    } catch (error: unknown) {
      setCustomError(error instanceof Error ? error.message : String(error))
    }
  }

  function applyQuickRange(minutes: number) {
    setRangeMinutes(minutes)
    setCustomRange(null)
    setCustomError(null)
  }

  function resetAuto() {
    hasSavedPrefsRef.current = true
    setPrefsReady(true)
    const available = new Set(analogPoints.map((point) => point.id))
    const defaults = DEFAULT_TREND_IDS.filter((id) => available.has(id))
    setSelectedIds(defaults.length ? defaults : analogPoints.slice(0, 8).map((point) => point.id))
    setRangeMinutes(30)
    setCustomRange(null)
    setCustomError(null)
  }

  const columns: Array<Column<TrendRow>> = [
    { key: 'trend', header: 'Trend', render: (row) => <span className="font-semibold">{row.name}</span> },
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
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Trend Log dùng unified historian backend với trạng thái gap/partial rõ ràng.', 'Trend Log uses the unified historian backend with explicit gap and partial states.')}</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[300px_1fr]">
        <div className="min-h-0" style={analogPanelHeight ? { height: analogPanelHeight } : undefined}>
          <Panel title="Series" className="flex h-full min-h-0 flex-col overflow-hidden" action={<Button ref={addTrendButtonRef} size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openPicker}>{pick('Thêm trend', 'Add trend')}</Button>}>
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
              {rangeOptions.map((item) => <Button key={item.minutes} size="sm" variant={!customRange && rangeMinutes === item.minutes ? 'primary' : 'secondary'} icon={<Clock3 className="h-4 w-4" />} onClick={() => applyQuickRange(item.minutes)}>{pick(item.labelVi, item.labelEn)}</Button>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedPoints.map((point, index) => <button key={point.id} type="button" onClick={() => togglePoint(point.id)} className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-xs text-[var(--c-text)]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />{pointDisplayTag(point)}</button>)}
            </div>
          </div>
          <div className="mb-4 grid gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-xs">From (UTC)<input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block h-9 w-full rounded border border-[var(--c-border)] bg-transparent px-2" /></label>
            <label className="text-xs">To (UTC)<input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block h-9 w-full rounded border border-[var(--c-border)] bg-transparent px-2" /></label>
            <Button size="sm" onClick={applyCustomRange}>Apply custom</Button>
            {customError && <span role="alert" className="text-xs text-[var(--c-fault-fg)] md:col-span-3">{customError}</span>}
          </div>
          {historyPresentation && <HistoryStateBanner state={historyPresentation.state} gaps={historyPresentation.gaps} detail={historyPresentation.detail ?? (!HISTORIAN_V2_TRENDS_ENABLED ? pick('Legacy query vẫn authoritative; unified Trends chờ activation/cutover marker.', 'Legacy query remains authoritative; unified Trends awaits the activation/cutover marker.') : undefined)} onRetry={historyPresentation.state === 'unavailable' ? () => { void historyState.refetch() } : undefined} />}
          {pointsState.loading && !analogPoints.length
            ? <StateBlock state="loading" title={pick('Đang tải điểm analog', 'Loading analog points')} />
            : pointsState.error && !analogPoints.length
              ? <StateBlock state="error" title={pick('Không tải được điểm analog', 'Could not load analog points')} detail={pointsState.error.message} />
              : historyState.loading && !historyState.data
                ? <StateBlock state="loading" title={pick('Đang tải historian', 'Loading historian')} />
                : historyState.error
                  ? <StateBlock state="error" title={pick('Không tải được historian', 'Could not load historian')} detail={historyState.error.message} />
                : series.length && chartSamples.length > 1
                ? <TrendChart data={chartSamples} series={series} height={360} />
                : <StateBlock state="empty" title={series.length ? pick('Không có mẫu trong khoảng đã chọn', 'No history in the selected range') : pick('Chọn ít nhất một điểm trend', 'Select at least one trend point')} detail={series.length ? pick('Backend không trả sample khả dụng; gap evidence ở banner phía trên.', 'The backend returned no available samples; see the gap evidence above.') : undefined} />}
          </Panel>
        </div>
      </div>

      <Modal open={pickerOpen} returnFocusRef={addTrendButtonRef} title={pick('Thêm trend', 'Add trend')} size="xl" confirmLabel={pick('Áp dụng', 'Apply')} cancelLabel={pick('Hủy', 'Cancel')} onConfirm={applyPicker} onClose={() => setPickerOpen(false)}>
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded border border-[var(--c-border)] px-3">
            <Search className="h-4 w-4" />
            <input autoFocus value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder={pick('Tìm theo ID hoặc tên...', 'Search by ID or name...')} className="h-10 w-full bg-transparent outline-none" />
          </div>
          <div className="flex flex-wrap gap-2">
            {trendFilterKinds.map((kind) => <Button key={kind} size="sm" variant={pickerKinds.includes(kind) ? 'primary' : 'secondary'} onClick={() => togglePickerKind(kind)}>{kind}</Button>)}
            <span className="self-center text-xs">{pickerDraft.length}/8 selected</span>
          </div>
          <div className="grid max-h-[52vh] gap-2 overflow-y-auto md:grid-cols-2">
            {filteredPickerPoints.map((point) => (
              <label key={point.id} className="flex cursor-pointer items-center gap-3 rounded border border-[var(--c-border)] p-3">
                <input type="checkbox" checked={pickerDraft.includes(point.id)} disabled={!pickerDraft.includes(point.id) && pickerDraft.length >= 8} onChange={() => togglePickerPoint(point.id)} />
                <span className="min-w-0 flex-1 truncate font-semibold">{point.kind === 'virtual' ? point.tag : `${point.id} - ${point.name}`}</span>
                <span className="text-xs">{point.unit ?? '-'}</span>
              </label>
            ))}
            {!filteredPickerPoints.length && <p>{pick('Không tìm thấy điểm.', 'No matching points.')}</p>}
          </div>
        </div>
      </Modal>

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
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{pointDisplayTag(point)}</div>
          {point.kind !== 'virtual' && <div className="mt-1 truncate text-xs text-[var(--c-text-dim)]">{point.name}</div>}
          <div className="mono mt-2 text-xs text-[var(--c-text-dim)]">{point.value} {point.unit ?? ''}</div>
        </div>
        <button type="button" onClick={onRemove} className={cn('grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-[var(--c-border)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]')} aria-label={`Remove ${pointDisplayTag(point)}`}>
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function buildTrendRows(series: TrendSeries[], points: Point[], samples: TrendSample[], useLiveCurrent = false): TrendRow[] {
  const pointsById = new Map(points.map((point) => [point.id, point]))
  return series.map((item) => {
    const values = samples.map((sample) => Number(sample[item.key])).filter(Number.isFinite)
    const sum = values.reduce((total, value) => total + value, 0)
    const point = pointsById.get(item.pointId ?? '')
    const fallback = pointNumber(point?.value ?? 0) ?? 0
    const liveCurrent = point ? pointNumber(point.value) : null
    const current = useLiveCurrent && liveCurrent !== null
      ? liveCurrent
      : values.length ? values[values.length - 1] : fallback
    const aggregateValues = values.length ? values : [current]
    return {
      id: item.key,
      name: item.label,
      current: Number(current.toFixed(useLiveCurrent ? 3 : 1)),
      avg: Number((sum / Math.max(1, values.length)).toFixed(1)),
      min: Number(Math.min(...aggregateValues).toFixed(1)),
      max: Number(Math.max(...aggregateValues).toFixed(1)),
      unit: item.unit ?? '-',
      samples: values.length
    }
  })
}

export function appendLiveTrendSample(samples: TrendSample[], series: TrendSeries[], points: Point[], enabled: boolean, capturedAtMs = Date.now()): TrendSample[] {
  if (!enabled || !series.length || !Number.isFinite(capturedAtMs)) return samples

  const pointsById = new Map(points.map((point) => [point.id, point]))
  const latestGenerationByPoint = new Map<string, number>()
  for (const item of series) {
    if (!item.pointId || item.generation === undefined) continue
    latestGenerationByPoint.set(item.pointId, Math.max(latestGenerationByPoint.get(item.pointId) ?? 0, item.generation))
  }

  const row: TrendSample = { time: new Date(capturedAtMs).toISOString(), __ts: capturedAtMs }
  let valuesAdded = 0
  for (const item of series) {
    if (!item.pointId) continue
    const latestGeneration = latestGenerationByPoint.get(item.pointId)
    if (latestGeneration !== undefined && item.generation !== latestGeneration) continue
    const point = pointsById.get(item.pointId)
    const value = point ? pointNumber(point.value) : null
    if (!point || value === null) continue
    row[item.key] = value
    row[`${item.key}:quality`] = String(point.quality).toUpperCase()
    row[`${item.key}:source`] = point.source || 'runtime'
    row[`${item.key}:tier`] = 'live'
    valuesAdded += 1
  }

  if (!valuesAdded) return samples
  return [...samples, row].sort((left, right) => Number(left.__ts) - Number(right.__ts))
}

export function buildHistoryChartModel(response: HistoryResponse | null, points: Point[]): { samples: TrendSample[]; series: TrendSeries[] } {
  if (!response) return { samples: [], series: [] }
  const pointsById = new Map(points.map((point) => [point.id, point]))
  const generationsByPoint = new Map<string, number>()
  for (const item of response.series) generationsByPoint.set(item.pointId, (generationsByPoint.get(item.pointId) ?? 0) + 1)

  const keyByIdentity = new Map<string, string>()
  const series = response.series.map<TrendSeries>((item, index) => {
    const point = pointsById.get(item.pointId)
    const key = `${item.pointId}::g${item.generation}`
    keyByIdentity.set(historySeriesKey(item.pointId, item.generation), key)
    const baseLabel = point ? (point.kind === 'virtual' ? point.tag : `${point.id} - ${point.name}`) : item.pointId
    const showGeneration = (generationsByPoint.get(item.pointId) ?? 0) > 1
    return {
      key,
      pointId: item.pointId,
      generation: item.generation,
      label: showGeneration ? `${baseLabel} · g${item.generation}` : baseLabel,
      color: colors[index % colors.length],
      unit: point?.unit,
      kind: point?.kind === 'virtual' ? 'VP' : point?.kind,
      stepped: point?.kind === 'DO' || point?.kind === 'DI' || point?.signalType === 'boolean' || typeof point?.value === 'boolean'
    }
  })

  const rows = new Map<number, TrendSample>()
  const rowAt = (timeMs: number) => {
    const existing = rows.get(timeMs)
    if (existing) return existing
    const row: TrendSample = { time: new Date(timeMs).toISOString(), __ts: timeMs }
    rows.set(timeMs, row)
    return row
  }
  for (const item of response.series) {
    const key = keyByIdentity.get(historySeriesKey(item.pointId, item.generation))
    if (!key) continue
    for (const sample of item.samples) {
      const row = rowAt(sample.timeMs)
      row[key] = sample.quality === 'BAD' ? null : sample.value
      row[`${key}:quality`] = sample.quality
      row[`${key}:source`] = sample.source
      row[`${key}:tier`] = sample.tier
    }
  }
  for (const gap of response.gaps) {
    const key = keyByIdentity.get(historySeriesKey(gap.pointId, gap.generation))
    if (!key) continue
    for (const timeMs of [gap.fromUtcMs, Math.max(gap.fromUtcMs, gap.toUtcMs - 1)]) {
      const row = rowAt(timeMs)
      row[key] = null
      row[`${key}:quality`] = 'GAP'
      row[`${key}:source`] = gap.reason
      row[`${key}:tier`] = '—'
    }
  }
  return { samples: [...rows.values()].sort((left, right) => Number(left.__ts) - Number(right.__ts)), series }
}

export function historyPresentationState(response: HistoryResponse | null, error: Error | null): { state: HistoryPresentationState; gaps: HistoryResponse['gaps']; detail?: string } | null {
  if (error) return { state: 'unavailable', gaps: response?.gaps ?? [], detail: error.message }
  if (!response) return null
  if (!response.complete || response.gaps.length > 0) return { state: 'partial', gaps: response.gaps }
  const samples = response.series.reduce((count, item) => count + item.samples.length, 0)
  return { state: samples > 0 ? 'complete' : 'no-history', gaps: response.gaps }
}

export function historySourceForRange(customRange: TrendCustomRange | null): 'cache' | 'database' {
  return customRange ? 'database' : 'cache'
}

function emptyHistoryResponse(fromMs: number, toMs: number): HistoryResponse {
  return {
    from: new Date(fromMs).toISOString(),
    fromMs,
    to: new Date(toMs).toISOString(),
    toMs,
    complete: true,
    series: [],
    gaps: [],
    tiersUsed: []
  }
}

function legacyHistoryRange(minutes: number): string {
  if (minutes <= 30) return '30m'
  if (minutes <= 60) return '1h'
  if (minutes <= 360) return '6h'
  return '24h'
}

export function legacyHistoryResponse(pointIds: string[], rows: TrendSample[], fromMs: number, toMs: number): HistoryResponse {
  return {
    from: new Date(fromMs).toISOString(),
    fromMs,
    to: new Date(toMs).toISOString(),
    toMs,
    complete: false,
    series: pointIds.map((pointId) => ({
      pointId,
      generation: 1,
      effectiveResolution: '1s',
      samples: rows.flatMap((row) => {
        const timeMs = typeof row.__ts === 'number' ? row.__ts : Number.NaN
        const value = Number(row[pointId])
        if (!Number.isFinite(timeMs) || !Number.isFinite(value)) return []
        const qualityText = String(row[`${pointId}:quality`] ?? 'GOOD').toUpperCase()
        const quality = qualityText === 'BAD' || qualityText === 'UNCERTAIN' ? qualityText : 'GOOD'
        const tierText = row[`${pointId}:tier`]
        const tier = tierText === 'ram' || tierText === 'archive' ? tierText : 'hot'
        return [{
          time: new Date(timeMs).toISOString(),
          timeMs,
          value,
          min: value,
          max: value,
          sum: value,
          count: 1,
          quality,
          source: String(row[`${pointId}:source`] ?? 'legacy'),
          tier,
          generation: 1
        }]
      })
    })),
    gaps: pointIds.map((pointId) => ({
      pointId,
      generation: 1,
      fromUtc: new Date(fromMs).toISOString(),
      fromUtcMs: fromMs,
      toUtc: new Date(toMs).toISOString(),
      toUtcMs: toMs,
      reason: 'legacy_query_gap_evidence_unavailable',
      detail: 'Legacy query authority does not expose unified tier frontier or explicit gap metadata.'
    })),
    tiersUsed: []
  }
}
