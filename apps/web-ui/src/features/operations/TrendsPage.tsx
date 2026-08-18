import { Check, Clock3, Download, Plus, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { historyClient, historyCsvUrl, historyPresetDurationMs, historySeriesKey, type HistoryPresetRange, type HistoryQuery, type HistoryResponse } from '../../shared/api/history'
import { HISTORIAN_V2_TRENDS_ENABLED } from '../../shared/config'
import { Button } from '../../shared/components/Button'
import { DataTable, Column } from '../../shared/components/DataTable'
import { HistoryStateBanner, type HistoryPresentationState } from '../../shared/components/HistoryStateBanner'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { TrendChart, assignSecondAxis, hasMinMaxBand, trendBandKey, type TrendSeries } from '../../shared/components/TrendChart'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { useRealtime } from '../../shared/realtime'
import type { Point, TrendSample, VirtualPoint } from '../../shared/types'
import { canonicalOutputPointId, canonicalVirtualPointId, cn, isFreshIso, mergePointsById, pointDisplayTag } from '../../shared/utils'
import { filterTrendPoints, filterTrendSamplesByRange, parseTrendCustomRange, localDateTimeInputValue, localTimeZoneLabel, type TrendCustomRange, type TrendFilterKind } from './trendsFilters'

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
export const TREND_LIVE_REFRESH_MS = 1000
const TREND_PREFS_KEY = 'mkddc:trends:v1'
const DEFAULT_TREND_IDS = Array.from({ length: 8 }, (_, index) => `UI-${String(index + 1).padStart(2, '0')}`)
const trendFilterKinds: TrendFilterKind[] = ['UI', 'AO', 'DO', 'VP']

interface TrendPrefs {
  selectedIds: string[]
  rangeMinutes: number
}

export interface TrendHistoryRequest {
  preset: HistoryPresetRange | null
  query: HistoryQuery
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
    const selectedIds = Array.isArray(parsed.selectedIds)
      ? Array.from(new Set(parsed.selectedIds.filter((id): id is string => typeof id === 'string').map(canonicalOutputPointId)))
      : []
    const storedRange = parsed.rangeMinutes
    const rangeMinutes = typeof storedRange === 'number' && rangeOptions.some((item) => item.minutes === storedRange) ? storedRange : 30
    return { selectedIds, rangeMinutes }
  } catch {
    return null
  }
}

/**
 * Đọc `?points=<id>[,<id>...]` — F-UX-03.
 *
 * `MonitorPage` gắn liên kết "Mở trong Trends" trỏ tới `/trends?points=<id>`
 * cho từng điểm, nhưng trang này chưa từng đọc query string: người dùng bấm vào
 * và rơi thẳng vào bộ chọn đã lưu trong localStorage của lần trước, không có
 * điểm mình vừa xem. Với một thao tác chẩn đoán ("giá trị này lạ, xem xu hướng
 * của nó"), mất đúng đối tượng đang điều tra là mất cả mục đích của liên kết.
 */
function parseDeepLinkedTrendIds(raw: string | null): string[] {
  if (!raw) return []
  return Array.from(new Set(
    raw.split(',').map((id) => id.trim()).filter(Boolean).map(canonicalOutputPointId)
  )).slice(0, 8)
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
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkedIdsRef = useRef<string[] | undefined>(undefined)
  if (deepLinkedIdsRef.current === undefined) deepLinkedIdsRef.current = parseDeepLinkedTrendIds(searchParams.get('points'))
  const deepLinkedIds = deepLinkedIdsRef.current
  const initialPrefsRef = useRef<TrendPrefs | null | undefined>(undefined)
  if (initialPrefsRef.current === undefined) initialPrefsRef.current = readTrendPrefs()
  /* Deep link được coi như "đã có lựa chọn" để effect dựng mặc định (UI-01..08)
     không đè lên điểm mà người dùng vừa yêu cầu xem. */
  const hasSavedPrefsRef = useRef(initialPrefsRef.current !== null || deepLinkedIds.length > 0)
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const virtualState = useApi(apiClient.getVirtualPoints, [], { refreshMs: 2000 })
  const analogPoints = useMemo(() => {
    const polledPoints = pointsState.data ?? []
    const source = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
      ? mergePointsById(polledPoints, realtime.allPoints)
      : polledPoints
    return visibleTrendPoints(source, virtualState.data ?? []).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
  }, [pointsState.data, realtime.allPoints, realtime.lastPointEventAt, virtualState.data])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => deepLinkedIds.length ? deepLinkedIds : (initialPrefsRef.current?.selectedIds ?? []))
  const [rangeMinutes, setRangeMinutes] = useState<number>(() => initialPrefsRef.current?.rangeMinutes ?? 30)
  const [prefsReady, setPrefsReady] = useState(() => initialPrefsRef.current !== null || deepLinkedIds.length > 0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerKinds, setPickerKinds] = useState<TrendFilterKind[]>(trendFilterKinds)
  const [pickerDraft, setPickerDraft] = useState<string[]>([])
  const [customFrom, setCustomFrom] = useState(() => localDateTimeInputValue(new Date(Date.now() - 30 * 60_000)))
  const [customTo, setCustomTo] = useState(() => localDateTimeInputValue(new Date()))
  const [customRange, setCustomRange] = useState<TrendCustomRange | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const analogPanelRef = useRef<HTMLDivElement>(null)
  const addTrendButtonRef = useRef<HTMLButtonElement>(null)
  const [analogPanelHeight, setAnalogPanelHeight] = useState<number | null>(null)
  const [showBand, setShowBand] = useState(false)

  const selectedPoints = useMemo(() => analogPoints.filter((point) => selectedIds.includes(point.id)), [analogPoints, selectedIds])
  /* FE-TR-01 (board thật 2026-08-06): panel "Series" và biểu đồ đọc HAI nguồn
   * khác nhau — panel lọc `selectedIds` qua `analogPoints` (tức `/points`), còn
   * truy vấn historian dùng thẳng `selectedIds`. Trên DDC-24-TANG-1, `/points`
   * trả rỗng trong khi historian vẫn còn DO-01..DO-04 với 4185 mẫu, nên trang
   * đồng thời nói "Chưa chọn điểm trend" VÀ vẽ 4 series, liệt kê chúng ở bảng
   * thống kê là ON. Người dùng không xoá được (không có thẻ series) mà cũng
   * không thêm được (picker rỗng) — trang tự mâu thuẫn và không thao tác được.
   *
   * Nay panel dựng từ chính `selectedIds`: id nào không resolve được thành Point
   * vẫn có thẻ riêng kèm nút gỡ, và trang nói rõ vì sao. */
  const unresolvedSelectedIds = useMemo(
    () => selectedIds.filter((id) => !analogPoints.some((point) => point.id === id)),
    [analogPoints, selectedIds]
  )
  const selectedSignature = selectedIds.join(',')
  const historyState = useApi(async () => {
    const request = buildTrendHistoryRequest(selectedIds, rangeMinutes, customRange)
    const fromMs = new Date(request.query.from).getTime()
    const toMs = new Date(request.query.to).getTime()
    if (!selectedIds.length) return emptyHistoryResponse(fromMs, toMs)
    if (!HISTORIAN_V2_TRENDS_ENABLED) {
      const legacy = await apiClient.getHistory(selectedIds, request.preset ?? '24h')
      const samples = customRange ? filterTrendSamplesByRange(legacy, fromMs, toMs) : legacy
      return legacyHistoryResponse(selectedIds, samples, fromMs, toMs)
    }
    return historyClient.query(request.query)
  }, [customRange?.fromMs, customRange?.toMs, rangeMinutes, selectedSignature], { refreshMs: 10_000 })
  const chartModel = useMemo(() => buildHistoryChartModel(historyState.data, selectedPoints), [historyState.data, selectedPoints])
  const samples = chartModel.samples
  const filteredPickerPoints = useMemo(() => filterTrendPoints(analogPoints, pickerQuery, pickerKinds), [analogPoints, pickerKinds, pickerQuery])
  const series = chartModel.series
  const [liveTailNowMs, setLiveTailNowMs] = useState(() => Date.now())
  const chartSamples = useMemo(
    () => appendLiveTrendSample(samples, series, selectedPoints, HISTORIAN_V2_TRENDS_ENABLED && !customRange, liveTailNowMs),
    [customRange, liveTailNowMs, samples, selectedPoints, series]
  )
  const tableRows = useMemo(() => buildTrendRows(series, selectedPoints, samples, HISTORIAN_V2_TRENDS_ENABLED && !customRange), [customRange, samples, selectedPoints, series])
  const historyPresentation = historyPresentationState(historyState.data, historyState.error)
  const currentRange = rangeOptions.find((item) => item.minutes === rangeMinutes)
  /* `T57-2.7` — nói ra tầng dữ liệu ĐANG dùng, lấy từ `tiersUsed` của response
     chứ không suy theo preset: cùng một preset có thể ra tầng khác nhau tuỳ
     lượng dữ liệu còn lưu. Đây là thứ quyết định cách đọc đỉnh/đáy — số từ tầng
     aggregate đã bị gộp nên đỉnh thật có thể cao hơn đỉnh nhìn thấy, và người
     đọc phải biết điều đó trước khi kết luận về một sự cố. */
  const tierLabel = useMemo(() => {
    const tiers = historyState.data?.tiersUsed ?? []
    if (!tiers.length) return ''
    const names: Record<string, string> = { cache: 'cache', ram: 'RAM', hot: 'hot', archive: 'archive' }
    return `${pick('Nguồn', 'Tier')}: ${tiers.map((tier) => names[tier] ?? tier).join(' + ')}`
  }, [historyState.data?.tiersUsed, pick])

  const rangeLabel = customRange
    ? pick('Tùy chỉnh (giờ địa phương)', 'Custom (local time)')
    : currentRange ? pick(currentRange.labelVi, currentRange.labelEn) : pick(`${rangeMinutes} phút`, `${rangeMinutes} min`)
  const databaseSeriesIds = useMemo(() => new Set((historyState.data?.series ?? []).map((item) => item.pointId)), [historyState.data?.series])
  /* Dải min–max chỉ khả dụng khi backend trả mẫu aggregate. Tính từ chính dữ
     liệu đang vẽ chứ không đoán theo khoảng thời gian: cùng một preset có thể
     ra độ phân giải khác nhau tuỳ lượng dữ liệu còn lưu. */
  const bandAvailable = useMemo(() => hasMinMaxBand(chartSamples, series), [chartSamples, series])
  useEffect(() => {
    if (!bandAvailable && showBand) setShowBand(false)
  }, [bandAvailable, showBand])
  /* Link xuất CSV trỏ đúng khoảng đang xem, dùng cùng bộ tham số với truy vấn
     biểu đồ — người dùng tải về đúng thứ họ đang nhìn, không phải một khoảng
     mặc định nào khác. */
  const csvHref = useMemo(() => {
    if (!selectedIds.length) return null
    return historyCsvUrl(buildTrendHistoryRequest(selectedIds, rangeMinutes, customRange).query)
  }, [customRange, rangeMinutes, selectedIds])
  const customPointsWithoutHistory = customRange && historyState.data
    ? selectedPoints.filter((point) => !databaseSeriesIds.has(point.id))
    : []

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

  /* `?points=` là lệnh MỞ một lần, không phải trạng thái của trang. Giữ nó lại
     trên thanh địa chỉ sẽ khiến mọi thay đổi bộ chọn sau đó bị hoàn nguyên ở
     lần tải lại kế tiếp — người dùng thêm series, F5, và chúng biến mất mà
     không rõ vì sao. Tiêu thụ xong thì gỡ khỏi URL. */
  useEffect(() => {
    if (!deepLinkedIds.length) return
    if (!searchParams.has('points')) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('points')
      return next
    }, { replace: true })
  }, [deepLinkedIds.length, searchParams, setSearchParams])

  useEffect(() => {
    if (customRange) return undefined
    setLiveTailNowMs(Date.now())
    const timerId = window.setInterval(() => setLiveTailNowMs(Date.now()), TREND_LIVE_REFRESH_MS)
    return () => window.clearInterval(timerId)
  }, [customRange])

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
              {/* FE-TR-01: id đã chọn nhưng `/points` không trả về vẫn phải hiện,
                  vì historian vẫn vẽ nó lên biểu đồ. Ẩn đi là để trang tự mâu thuẫn. */}
              {unresolvedSelectedIds.map((id) => (
                <div key={id} className="rounded-[var(--radius)] border border-dashed border-[var(--c-warn-fg,var(--c-border))] bg-[var(--c-surface)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{id}</div>
                      <div className="mt-1 text-xs text-[var(--c-warn-fg,var(--c-text-dim))]">
                        {pick('Không còn trong danh sách điểm của authority', 'No longer in the authority point list')}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => togglePoint(id)}>{pick('Gỡ', 'Remove')}</Button>
                  </div>
                </div>
              ))}
              {!selectedIds.length && <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-4 text-sm text-[var(--c-text-dim)]">{pick('Chưa chọn điểm trend.', 'No trend points selected.')}</div>}
            </div>
            {unresolvedSelectedIds.length > 0 && (
              <div role="status" className="mt-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2 text-xs text-[var(--c-text-dim)]">
                {pick(
                  `${unresolvedSelectedIds.length} điểm đang vẽ nhưng không có trong /points. Biểu đồ dưới đây là lịch sử cũ, không phải điểm đang chạy.`,
                  `${unresolvedSelectedIds.length} plotted series are missing from /points. The chart below is stored history, not a running point.`
                )}
              </div>
            )}
          </Panel>
        </div>

        <div ref={analogPanelRef}>
          <Panel
            title={`${pick('Xu hướng analog', 'Analog trend')} - ${rangeLabel}`}
            /* Tầng dữ liệu là thông tin PHỤ nên đi vào `subtitle`, không nối vào
               tiêu đề: tiêu đề là thứ người dùng và test cùng dựa vào để nhận ra
               khối này, nối thêm chuỗi động vào đó làm nó mất tính ổn định. */
            subtitle={tierLabel || undefined}
            action={
              <div className="flex flex-wrap gap-2">
                {/* Dải min–max chỉ bật được khi dữ liệu THẬT SỰ có nó. Ở độ phân
                    giải 1 giây mỗi mẫu là một điểm đo (min = max), nên nút bị
                    khoá kèm lý do thay vì bật ra một dải trùng khít đường chính
                    và làm người đọc tưởng đã thấy biên độ (UX-DES §13). */}
                <Button
                  size="sm"
                  variant={showBand ? 'primary' : 'secondary'}
                  disabled={!bandAvailable}
                  title={bandAvailable ? undefined : pick('Khoảng thời gian này trả mẫu từng điểm, không có min/max để dựng dải', 'This range returns per-sample points; there is no min/max to band')}
                  onClick={() => setShowBand((value) => !value)}
                >
                  {pick('Dải min–max', 'Min–max band')}
                </Button>
                {/* Export là action THỨ CẤP (§13): không chiếm chỗ của thao tác
                    đọc, và chỉ mở được khi có series để xuất. */}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Download className="h-4 w-4" />}
                  disabled={!csvHref}
                  title={csvHref ? undefined : pick('Chọn ít nhất một điểm để xuất', 'Select at least one point to export')}
                  onClick={() => { if (csvHref) window.open(csvHref, '_blank', 'noopener') }}
                >
                  {pick('Xuất CSV', 'Export CSV')}
                </Button>
                <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={resetAuto}>Auto</Button>
              </div>
            }
          >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {rangeOptions.map((item) => <Button key={item.minutes} size="sm" variant={!customRange && rangeMinutes === item.minutes ? 'primary' : 'secondary'} icon={<Clock3 className="h-4 w-4" />} onClick={() => applyQuickRange(item.minutes)}>{pick(item.labelVi, item.labelEn)}</Button>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedPoints.map((point, index) => <button key={point.id} type="button" onClick={() => togglePoint(point.id)} className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-xs text-[var(--c-text)]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />{pointDisplayTag(point)}</button>)}
            </div>
          </div>
          <div className="mb-4 grid gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-xs">{pick(`Từ (giờ địa phương ${localTimeZoneLabel()})`, `From (local time ${localTimeZoneLabel()})`)}<input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block h-9 w-full rounded border border-[var(--c-border)] bg-transparent px-2" /></label>
            <label className="text-xs">{pick(`Đến (giờ địa phương ${localTimeZoneLabel()})`, `To (local time ${localTimeZoneLabel()})`)}<input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block h-9 w-full rounded border border-[var(--c-border)] bg-transparent px-2" /></label>
            <Button size="sm" onClick={applyCustomRange}>{pick('Áp dụng tùy chọn', 'Apply custom')}</Button>
            {/* FE-TR-02: ô chọn nhận GIỜ ĐỊA PHƯƠNG (b67580c) còn biểu đồ và bảng
                bên dưới hiển thị UTC. Hai mốc lệch nhau đúng bằng offset của máy, và
                trước đây không chỗ nào nói ra — người dùng gõ 09:27 rồi thấy bảng ghi
                02:55 và tưởng dữ liệu sai. Giữ nguyên UTC ở phần hiển thị (quyết định
                đã có, xem TrendsPage.test.tsx) nhưng phải nói rõ ngay tại chỗ nhập. */}
            <span className="text-xs text-[var(--c-text-dim)] md:col-span-3">
              {pick(
                `Ô chọn dùng giờ địa phương (${localTimeZoneLabel()}); biểu đồ và bảng bên dưới hiển thị theo UTC.`,
                `The pickers take local time (${localTimeZoneLabel()}); the chart and table below are shown in UTC.`
              )}
            </span>
            {customError && <span role="alert" className="text-xs text-[var(--c-fault-fg)] md:col-span-3">{customError}</span>}
          </div>
          {historyPresentation && <HistoryStateBanner state={historyPresentation.state} gaps={historyPresentation.gaps} detail={historyPresentation.detail ?? (!HISTORIAN_V2_TRENDS_ENABLED ? pick('Legacy query vẫn authoritative; unified Trends chờ activation/cutover marker.', 'Legacy query remains authoritative; unified Trends awaits the activation/cutover marker.') : undefined)} onRetry={historyPresentation.state === 'unavailable' ? () => { void historyState.refetch() } : undefined} />}
          {customPointsWithoutHistory.length > 0 && <div role="status" className="mb-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs text-[var(--c-text-dim)]">
            {pick('Custom chỉ đọc lịch sử database. Không có series database cho:', 'Custom reads database history only. No database series were found for:')} {customPointsWithoutHistory.map(pointDisplayTag).join(', ')}.
          </div>}
          {pointsState.loading && !analogPoints.length
            ? <StateBlock state="loading" title={pick('Đang tải điểm analog', 'Loading analog points')} />
            : pointsState.error && !analogPoints.length
              ? <StateBlock state="error" title={pick('Không tải được điểm analog', 'Could not load analog points')} detail={pointsState.error.message} />
              : historyState.loading && !historyState.data
                ? <StateBlock state="loading" title={pick('Đang tải historian', 'Loading historian')} />
                : historyState.error
                  ? <StateBlock state="error" title={pick('Không tải được historian', 'Could not load historian')} detail={historyState.error.message} />
                : series.length && chartSamples.length > 1
                ? <TrendChart data={chartSamples} series={series} height={360} timeZone="UTC" showBand={showBand} />
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

  assignSecondAxis(series)

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
      const bad = sample.quality === 'BAD'
      row[key] = bad ? null : sample.value
      row[`${key}:quality`] = sample.quality
      row[`${key}:source`] = sample.source
      row[`${key}:tier`] = sample.tier
      /* Dải min–max chỉ có nghĩa khi mẫu là AGGREGATE (min khác max): nó cho
         thấy biên độ dao động bên trong một ô thời gian đã bị gộp, thứ mà
         đường trung bình che mất. Mẫu 1 giây có min = max = value nên bỏ qua,
         không vẽ một dải trùng khít đường chính (UX-DES §13). */
      if (!bad && typeof sample.min === 'number' && typeof sample.max === 'number' && sample.min !== sample.max) {
        row[trendBandKey(key)] = [sample.min, sample.max]
      }
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
      // Gap phải đứt CẢ dải min–max, không chỉ đứt đường trung bình. Một dải
      // tô liền qua khoảng không có dữ liệu là khẳng định đã đo được biên độ ở
      // đó.
      row[trendBandKey(key)] = null
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

export function historyPresetForMinutes(minutes: number): HistoryPresetRange {
  switch (minutes) {
    case 30: return '30m'
    case 60: return '1h'
    case 360: return '6h'
    case 1440: return '24h'
    default: throw new TypeError(`Unsupported trend history range: ${minutes} minutes`)
  }
}

export function buildTrendHistoryRequest(
  pointIds: readonly string[],
  rangeMinutes: number,
  customRange: TrendCustomRange | null,
  nowMs = Date.now()
): TrendHistoryRequest {
  const preset = customRange ? null : historyPresetForMinutes(rangeMinutes)
  const toMs = customRange?.toMs ?? nowMs
  const fromMs = customRange?.fromMs ?? toMs - historyPresetDurationMs(preset!)
  return {
    preset,
    query: {
      pointIds,
      from: new Date(fromMs),
      to: new Date(toMs),
      resolution: 'auto',
      maxPoints: 5000,
      source: historySourceForRange(customRange)
    }
  }
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
