function PointForceInput({ point, value, onChange }: { point: Point; value: string; onChange: (val: string) => void }) {
  if (point.kind === 'DO' || point.signalType === 'boolean') {
    const isTrue = value === 'true' || value === '1' || String(value).toUpperCase() === 'ON'
    return (
      <select
        value={isTrue ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value)}
        className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
      >
        <option value="true">ON (True)</option>
        <option value="false">OFF (False)</option>
      </select>
    )
  }
  if (point.signalType === 'multistate' && point.states?.length) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
      >
        {point.states.map((st) => (
          <option key={st.value} value={String(st.value)}>
            {st.value} — {st.label}
          </option>
        ))}
      </select>
    )
  }
  const isNumber = point.signalType === 'integer' || point.signalType === 'float' || point.kind === 'AO' || point.kind === 'UI'
  return (
    <input
      inputMode={isNumber ? 'decimal' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
    />
  )
}

import { CheckCircle2, Circle, Pencil, Power, RefreshCw, RotateCcw, Save, Search, ShieldAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { POINT_UNIT_OPTIONS, aiUnitFromPointUnit, apiClient, pointUnitFromAiUnit } from '../../shared/api/client'
import { createHistoryClient, type HistorySample } from '../../shared/api/history'
import { ForcedBadge, QualityBadge } from '../../shared/components/pa3/StateAtoms'
import {
  isBulkSelectable,
  planBulkOverride,
  runBulkOverride,
  summarizeBulkOutcomes,
  type BulkOverrideOutcome,
  type BulkOverrideStatus,
  type BulkPlanRow
} from './bulkOverride'
import { OverrideRemaining } from '../../shared/components/OverrideRemaining'
import { SavedViewBar } from '../../shared/components/SavedViewBar'
import { useSavedViews } from '../../shared/hooks/useSavedViews'
import { findSavedView, type SavedView } from '../../shared/savedViews'
import { useAuth } from '../auth'
import { roleAtLeast } from '../auth'
import { displayPointName, normalizePointName, normalizePointTag, pointNameConflicts, pointFieldErrors, validatePointName, validatePointTag } from '../../shared/api/pointTags'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { PointNameConflictNotice } from '../../shared/components/PointNameConflictNotice'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
import { useValueFlash } from '../../shared/hooks/useValueFlash'
import { useI18n } from '../../shared/i18n'
import { useRealtime } from '../../shared/realtime'
import type { Point, PointKind, PointQuality, VirtualPoint } from '../../shared/types'
import { NO_DATA, canonicalVirtualPointId, cn, formatCountdown, formatDateTime, formatPointValue, formatTime, formatValue, isChannelNotConfigured, isFreshIso, mergePointsById, pointDisplayTag, pointNumber, statusColor, statusFill } from '../../shared/utils'

const MAX_TREND_POINTS = 18
const REALTIME_STALE_MS = 2500
const historyClient = createHistoryClient()

/**
 * Bộ lọc trạng thái vận hành — UX-REQ §9.3 / UC-02.
 *
 * Đây là các câu hỏi người trực thật sự hỏi ("cái gì đang bị ép tay?", "cái gì
 * mất liên lạc?"), không phải một trường dữ liệu đơn lẻ, nên gom thành một bộ
 * chọn thay vì năm hộp kiểm rời.
 */
type MonitorStateFilter = 'all' | 'forced' | 'fault' | 'offline' | 'writable' | 'logging'

/**
 * Nhóm nguồn điểm — tham số `?group=` mà Health Strip của Landing đã trỏ tới từ
 * lâu (`drilldown.ts` → `subsystems.local_io = '/monitor?group=local'`).
 *
 * Trang này trước đây chỉ đọc `kind/quality/state/q/point`, nên bấm ô "I/O tại
 * chỗ" mở đúng trang nhưng KHÔNG lọc gì — đúng kiểu "hỏng im lặng" mà chính
 * `drilldown.ts` cảnh báo trong phần chú thích của nó (finding F-UX-03).
 */
type MonitorGroupFilter = 'all' | 'local' | 'virtual' | 'modbus'

const GROUP_KINDS: Record<Exclude<MonitorGroupFilter, 'all'>, PointKind[]> = {
  local: ['UI', 'AI', 'DI', 'AO', 'DO'],
  virtual: ['virtual'],
  modbus: ['modbus_rtu']
}

function matchesGroupFilter(point: Point, group: MonitorGroupFilter): boolean {
  if (group === 'all') return true
  return GROUP_KINDS[group].includes(point.kind)
}

/** Khoá bộ lọc thuộc một khung nhìn (`T57-2.3`). `point` cố ý KHÔNG nằm ở đây:
 *  điểm đang mở là ngữ cảnh thao tác, không phải bộ lọc. */
const MONITOR_VIEW_KEYS = ['kind', 'quality', 'q', 'state', 'group', 'equip'] as const

function matchesStateFilter(point: Point, filter: MonitorStateFilter): boolean {
  switch (filter) {
    case 'forced': return point.forced === true
    case 'fault': return (point.fault === true || point.quality === 'bad') && !isChannelNotConfigured(point)
    case 'offline': return point.quality === 'offline' || point.online === false
    case 'writable': return point.writable === true || point.kind === 'AO' || point.kind === 'DO'
    case 'logging': return point.logEnabled === true
    default: return true
  }
}

// Hook to maintain a rolling buffer of trend values for a point
function useTrendBuffer(pointId: string, value: number | boolean | string | undefined, trend: number[] | undefined): number[] {
  const [buffer, setBuffer] = useState<number[]>(trend ?? [])

  useEffect(() => {
    const currentValue = pointNumber({ value } as Point)
    if (typeof currentValue === 'number') {
      setBuffer(prev => {
        const next = [...prev, currentValue]
        return next.length > MAX_TREND_POINTS ? next.slice(-MAX_TREND_POINTS) : next
      })
    }
  }, [pointId, value])

  return buffer
}

const kindLabel: Record<PointKind, string> = {
  UI: 'UNIVERSAL INPUT',
  DI: 'LEGACY UNIVERSAL INPUT',
  DO: 'DIGITAL OUTPUT',
  AI: 'LEGACY UNIVERSAL INPUT',
  AO: 'ANALOG OUTPUT',
  virtual: 'VIRTUAL',
  modbus_rtu: 'MODBUS RTU'
}

function visibleMonitorPoints(points: Point[], virtualPoints: VirtualPoint[]): Point[] {
  const virtualById = new Map(
    virtualPoints
      .filter((item) => item.enabled)
      .map((item) => [canonicalVirtualPointId(item.id), item])
  )
  return points.flatMap((point) => {
    if (point.kind !== 'virtual') return [point]
    const meta = virtualById.get(canonicalVirtualPointId(point.id))
    if (!meta) return []
    return [{
      ...point,
      id: canonicalVirtualPointId(meta.id),
      tag: meta.tag,
      name: displayPointName(meta.name ?? meta.label, canonicalVirtualPointId(meta.id)),
      value: meta.value ?? point.value,
      unit: meta.unit ?? point.unit,
      signalType: meta.signalType,
      writable: meta.writable,
      logEnabled: meta.logEnabled,
      logIntervalMs: meta.logIntervalMs,
      namespaceState: meta.namespaceState,
      updatedAt: meta.updatedAt ?? point.updatedAt,
      states: meta.states ?? point.states,
      virtualSource: meta.source ?? point.virtualSource,
      initialValue: meta.initialValue,
      restartPolicy: meta.restartPolicy
    }]
  })
}

/** Điểm nhị phân theo bản chất tín hiệu, không theo giá trị tức thời. */
function isBinaryPoint(point: Point): boolean {
  return point.kind === 'DO' || point.kind === 'DI' || point.signalType === 'boolean' || typeof point.value === 'boolean'
}

function canForcePoint(point: Point): boolean {
  if (point.kind === 'virtual') {
    return point.writable === true && point.virtualSource !== 'PROGRAM' && point.source !== 'PROGRAM'
  }
  return point.kind === 'DO' || point.kind === 'AO'
}

function defaultForceValue(point: Point): string {
  if (point.kind === 'DO' || point.signalType === 'boolean') return typeof point.value === 'boolean' ? String(point.value) : 'false'
  if (point.signalType === 'multistate') return String(point.value ?? 0)
  if (point.kind === 'virtual') return String(point.value ?? '')
  /* `pointNumber` trả `null` khi point chưa có số đo dùng được. `String(null)`
     cho ra chuỗi `"null"` và nó ĐI THẲNG vào ô "Giá trị mới" của hộp thoại ép
     tay — người vận hành nhìn thấy một giá trị trông như dữ liệu thật, còn
     `parseForceValue` thì ném lỗi "must be a number" sau khi đã bấm xác nhận.
     Không có số đo thì để TRỐNG và bắt người dùng tự nhập (finding F-UX-09). */
  const numeric = pointNumber(point)
  return numeric === null ? '' : String(numeric)
}

function parseForceValue(point: Point, raw: string): number | boolean | string {
  const value = raw.trim()
  if (point.kind === 'DO' || point.signalType === 'boolean') return value === 'true' || value === '1' || value.toUpperCase() === 'ON'
  if (point.signalType === 'multistate') {
    const num = Number(value)
    if (!Number.isFinite(num)) throw new Error('Force value must be a valid state number')
    return Math.trunc(num)
  }
  if (point.signalType === 'string') return value
  if (point.signalType === 'datetime') {
    if (Number.isNaN(new Date(value).getTime())) throw new Error('Force value must be a datetime')
    return value
  }
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) throw new Error('Force value must be a number')
  return point.signalType === 'integer' ? Math.trunc(numberValue) : numberValue
}

function parseForceDurationSeconds(raw: string): number {
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Force duration must be greater than 0 minutes')
  return Math.round(minutes * 60)
}

function selectUnitValue(unit?: string): string {
  return pointUnitFromAiUnit(aiUnitFromPointUnit(unit))
}

export function MonitorPage() {
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const virtualState = useApi(apiClient.getVirtualPoints, [], { refreshMs: 2000 })
  const realtime = useRealtime()
  const toast = useToast()
  const { pick } = useI18n()
  /* WEB-UX-005: trang Giám sát để mở cho `viewer` (đây là màn hình theo dõi, chặn
     cả trang sẽ lấy mất khả năng quan sát của ca trực chỉ-đọc), nhưng hai đường
     GHI bên trong nó thì không. `PUT /points/{id}` là `RoleOperator` và
     `PUT /points/{id}/config` là `RoleAdmin` ở backend; trước đây frontend không
     kiểm gì cả nên viewer bấm được nút Force rồi nhận 403 thô. */
  const { session } = useAuth()
  const canForce = roleAtLeast(session?.role, 'operator')
  const canEditPointConfig = roleAtLeast(session?.role, 'admin')

  function denyForce() {
    toast.push('warn', pick('Cần vai trò operator trở lên để ép giá trị output', 'Operator role or higher is required to force outputs'))
  }

  function requestForce(point: Point) {
    if (!canForce) {
      denyForce()
      return
    }
    setSelectedId(point.id)
    setForceValue(defaultForceValue(point))
    setForceOpen(true)
  }
  /* PA3-402: bộ lọc và ô tìm kiếm nằm TRONG URL.
   *
   * Trước đây chúng chỉ là `useState`, nên F5 hay Back là mất sạch ngữ cảnh, và
   * không có cách nào gửi cho đồng nghiệp một đường dẫn tới "các point Modbus
   * đang offline" — thứ mà Attention trên Landing cần trỏ tới. */
  const [searchParams, setSearchParams] = useSearchParams()
  const kind = (searchParams.get('kind') as PointKind | 'all' | null) ?? 'all'
  const quality = (searchParams.get('quality') as PointQuality | 'all' | null) ?? 'all'
  const query = searchParams.get('q') ?? ''
  const stateFilter = (searchParams.get('state') as MonitorStateFilter | null) ?? 'all'
  const group = (searchParams.get('group') as MonitorGroupFilter | null) ?? 'all'
  /* `T57-3.1`/`T57-4.1`: lọc theo THIẾT BỊ CÔNG NGHỆ. Đây là đường tối thiểu
     tới khoảng hở ISA-101 Level 2: người vận hành nghĩ bằng "AHU-1", còn giao
     diện trước nay chỉ nói được bằng kênh I/O. */
  const equipment = searchParams.get('equip') ?? 'all'
  const deepLinkedPoint = searchParams.get('point')

  function setFilter(key: 'kind' | 'quality' | 'q' | 'state' | 'point' | 'group' | 'equip', value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }

  /* `T57-2.3` — khung nhìn đặt tên.
   *
   * Khung nhìn chỉ là một tập tham số URL có tên, nên áp nó = ghi lại đúng
   * những khoá đó. Cố tình KHÔNG đụng tới `point` (điểm đang mở) — đó là ngữ
   * cảnh của thao tác hiện tại, không phải một phần của bộ lọc. */
  const savedViews = useSavedViews('monitor')
  const currentFilterParams: Record<string, string> = { kind, quality, q: query, state: stateFilter, group, equip: equipment }

  function applySavedFilters(params: Record<string, string>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const key of MONITOR_VIEW_KEYS) {
        const value = params[key] ?? ''
        if (!value || value === 'all') next.delete(key)
        else next.set(key, value)
      }
      /* Tên khung nhìn KHÔNG ở lại trên thanh địa chỉ: nó chỉ có nghĩa trên
         trình duyệt đã lưu nó, còn đường dẫn thì phải gửi được cho người khác.
         Áp xong thì URL mang chính bộ lọc — đó mới là thứ chia sẻ được. */
      next.delete('view')
      return next
    }, { replace: true })
  }

  /* `?view=<tên>` là lệnh MỞ một lần, đọc ở lần render đầu — cùng mẫu với
     `?points=` của trang Xu hướng. */
  const requestedViewRef = useRef<string | null | undefined>(undefined)
  if (requestedViewRef.current === undefined) requestedViewRef.current = searchParams.get('view')
  const requestedView = requestedViewRef.current
  useEffect(() => {
    if (!requestedView) return
    const view = findSavedView(savedViews.views, requestedView)
    if (view) applySavedFilters(view.params)
    else setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('view')
      return next
    }, { replace: true })
    requestedViewRef.current = null
    /* Chủ ý chỉ phụ thuộc `requestedView`: đây là lệnh MỞ một lần, chạy lại khi
       danh sách khung nhìn đổi sẽ áp lại bộ lọc đè lên thao tác của người dùng. */
  }, [requestedView])

  const [selectedId, setSelectedId] = useState<string | null>(deepLinkedPoint)
  const [forceOpen, setForceOpen] = useState(false)
  const [forceValue, setForceValue] = useState('1')
  const [forceDurationMinutes, setForceDurationMinutes] = useState('10')
  const [pointModalId, setPointModalId] = useState<string | null>(null)
  /* T57-1.4 — lựa chọn cho ép tay hàng loạt. Giữ ở `Set` id chứ không phải ở
     mảng point: bảng được poll lại mỗi giây, nên giữ tham chiếu point sẽ trỏ
     tới snapshot cũ ngay sau nhịp poll kế tiếp. */
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [editingUnit, setEditingUnit] = useState<string | null>(null)
  const [editingUnitValue, setEditingUnitValue] = useState('')
  const [editingTrend, setEditingTrend] = useState<string | null>(null)
  const [editingTrendEnabled, setEditingTrendEnabled] = useState<Record<string, boolean>>({})

  const polledPoints = pointsState.data ?? []
  const rawPoints = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polledPoints, realtime.allPoints)
    : polledPoints
  const points = useMemo(() => visibleMonitorPoints(rawPoints, virtualState.data ?? []), [rawPoints, virtualState.data])
  const nameConflicts = useMemo(() => pointNameConflicts([
    ...rawPoints.map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...(virtualState.data ?? []).map((point) => ({ id: canonicalVirtualPointId(point.id), name: point.name ?? point.label, kind: 'virtual' }))
  ]), [rawPoints, virtualState.data])
  const modalPoint = pointModalId ? points.find((point) => point.id === pointModalId) : null
  const offline = realtime.connectionState !== 'connected'

  const filtered = useMemo(() => points.filter((point) => {
    const matchesKind = kind === 'all' || point.kind === kind
    const matchesQuality = quality === 'all' || point.quality === quality
    // §9.2: tìm theo id, tag, tên hiển thị và nguồn.
    const haystack = `${point.id} ${point.tag} ${point.name} ${point.source}`.toLowerCase()
    const matchesEquipment = equipment === 'all'
      // "Chưa gán" là một nhóm THẬT, không phải trạng thái lỗi: rất nhiều điểm
      // hợp lệ chưa được gắn thẻ, và chúng vẫn phải xem được.
      || (equipment === '__unassigned__' ? !point.equipment : point.equipment === equipment)
    return matchesKind && matchesQuality && matchesGroupFilter(point, group) && matchesStateFilter(point, stateFilter) && matchesEquipment && haystack.includes(query.toLowerCase())
  }).sort((a, b) => a.id.localeCompare(b.id)), [equipment, group, kind, points, quality, query, stateFilter])

  /* Điểm trong khung chi tiết phải thuộc chính tập đang hiển thị. Trước đây
     chọn nguồn/nhóm Modbus vẫn giữ UI-01 ở panel bên phải dù bốn bảng bên trái
     đều rỗng, khiến người vận hành tưởng bộ lọc đã trả một điểm local. */
  const selected = filtered.find((point) => point.id === selectedId) ?? filtered[0]

  /* Danh sách thiết bị dựng TỪ DỮ LIỆU chứ không từ một bảng cấu hình riêng:
     `ADR-042` cố ý không tạo thực thể thiết bị, nên nguồn duy nhất là chính các
     thẻ đang gắn trên điểm. */
  const equipmentOptions = useMemo(() => {
    const names = new Set<string>()
    for (const point of points) if (point.equipment) names.add(point.equipment)
    return [...names].sort((left, right) => left.localeCompare(right, 'vi', { sensitivity: 'base' }))
  }, [points])
  const unassignedCount = useMemo(() => points.filter((point) => !point.equipment).length, [points])

  /* Điểm đã chọn được GIẢI LẠI từ bảng điểm mới nhất mỗi lần render, nên bảng
     hậu quả trong hộp thoại luôn dùng giá trị hiện tại chứ không phải giá trị
     lúc bấm chọn. Id trỏ tới điểm đã biến mất khỏi cấu hình thì tự rơi ra. */
  const bulkPoints = useMemo(
    () => points.filter((point) => bulkSelection.has(point.id) && isBulkSelectable(point)),
    [points, bulkSelection]
  )

  function toggleBulkSelection(id: string) {
    setBulkSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const groups = useMemo(() => ({
    UI: filtered.filter((point) => point.kind === 'UI'),
    DO: filtered.filter((point) => point.kind === 'DO'),
    AO: filtered.filter((point) => point.kind === 'AO'),
    Virtual: filtered.filter((point) => point.kind === 'virtual').sort((a, b) => {
      const numA = parseInt(a.id.replace(/\D/g, ''), 10) || 0
      const numB = parseInt(b.id.replace(/\D/g, ''), 10) || 0
      return numA - numB
    }),
    Modbus: filtered.filter((point) => point.kind === 'modbus_rtu')
  }), [filtered])

  const analogPoints = points.filter((point) => point.kind === 'UI' || point.kind === 'AO' || point.kind === 'virtual')
  // Kênh "Chưa cấu hình" (signalType none) không được tính vào tổng "lỗi/mất
  // tín hiệu" hay mẫu số "% bình thường" — nó chưa hề được đưa vào vận hành,
  // không phải một điểm đang lỗi (F-DASH-LOCALIO-01).
  const configuredAnalogPoints = analogPoints.filter((point) => !isChannelNotConfigured(point))
  const stats = {
    total: points.length,
    ui: points.filter((point) => point.kind === 'UI').length,
    do: points.filter((point) => point.kind === 'DO').length,
    ao: points.filter((point) => point.kind === 'AO').length,
    virtual: points.filter((point) => point.kind === 'virtual').length,
    /* F-UX-11 — "Điểm ON" chỉ có nghĩa với điểm NHỊ PHÂN. Bản trước đếm
       `Boolean(point.value)` trên toàn bộ inventory, nên một cảm biến nhiệt độ
       đọc 23.5 °C được tính là "ON" còn chính nó lúc 0 °C thì không: thẻ đếm
       nói về một đại lượng không tồn tại, và tỉ lệ % bên dưới nó cũng vậy.
       Mẫu số nay là số điểm nhị phân, không phải tổng số điểm. */
    binaryTotal: points.filter(isBinaryPoint).length,
    on: points.filter((point) => isBinaryPoint(point) && Boolean(point.value)).length,
    analogTotal: configuredAnalogPoints.length,
    analogGood: configuredAnalogPoints.filter((point) => point.quality === 'good').length,
    abnormal: points.filter((point) => point.quality !== 'good' && !isChannelNotConfigured(point)).length
  }

  function openPointModal(point: Point) {
    setSelectedId(point.id)
    setPointModalId(point.id)
  }

  async function savePointBasics(point: Point, config: { tag: string; name: string; unit?: string; equipment?: string }) {
    if (!canEditPointConfig) throw new Error(pick('Cần vai trò admin để sửa cấu hình điểm', 'Admin role is required to edit point configuration'))
    const tagError = point.kind === 'virtual' ? validatePointTag(config.tag) : undefined
    if (tagError) throw new Error(tagError)
    const nameError = validatePointName(config.name)
    if (nameError) throw new Error(nameError)
    const name = normalizePointName(config.name)
    if (nameConflicts.has(point.id)) {
      await apiClient.updatePointName(point.id, name)
    } else {
      await apiClient.updatePointConfig(point.id, {
        ...(point.kind === 'virtual' ? { tag: normalizePointTag(config.tag) } : {}),
        name,
        /* Chỉ gửi khi NGƯỜI DÙNG có nhập ô này: `undefined` là "không đụng tới",
           còn chuỗi rỗng là lệnh gỡ thẻ — hai ý định khác nhau. */
        ...(config.equipment === undefined ? {} : { equipment: config.equipment })
      })
    }
    toast.push('success', pick(`Updated ${pointDisplayTag(point)}`, `Updated ${pointDisplayTag(point)}`))
    await pointsState.refetch()
  }

  /**
   * Ép giá trị một point với thời hạn do CORE cưỡng chế.
   *
   * PA3-F05 — bản trước có `forceReleaseTimers.current[point.id] =
   * window.setTimeout(...)`: thời hạn của một lệnh ghi xuống output vật lý nằm
   * trong tab trình duyệt. Đóng tab, ngủ máy, hay chỉ cần chuyển trang là hẹn
   * giờ biến mất và output ở lại trạng thái ép tay không có gì nhả.
   *
   * Nay `durationSeconds` đi thẳng xuống Core (`ttlS` qua REST, `expire_s` qua
   * WS); `scan_loop` giữ hạn và tự `release_ao/do`. Frontend chỉ hiển thị
   * đồng hồ đếm ngược mà Core báo về.
   */
  async function forcePointWithDuration(point: Point, value: number | boolean | string, durationSeconds: number) {
    if (!canForcePoint(point)) return
    if (!canForce) {
      denyForce()
      return
    }
    if (point.kind === 'virtual') {
      // VP đi đường ghi cấu hình, Core không giữ TTL cho nó — nên KHÔNG gửi
      // ttlS và cũng không giả lập thời hạn ở đây (UX-DES §11).
      await apiClient.forcePoint(point.id, value)
      toast.push('success', pick(`Đã ghi ${pointDisplayTag(point)}`, `Wrote ${pointDisplayTag(point)}`))
      await pointsState.refetch()
      return
    }
    if (realtime.forcePoint(point.id, value as number | boolean, durationSeconds)) {
      toast.push('success', pick(`Đã gửi lệnh ép ${pointDisplayTag(point)}`, `Force sent to ${pointDisplayTag(point)}`))
      window.setTimeout(() => void pointsState.refetch(), 250)
      window.setTimeout(() => void pointsState.refetch(), 1000)
      return
    }
    await apiClient.forcePoint(point.id, value, false, durationSeconds)
    toast.push('success', pick(`Đã gửi lệnh ép ${pointDisplayTag(point)}`, `Force sent to ${pointDisplayTag(point)}`))
    await pointsState.refetch()
  }

  async function releasePoint(point: Point) {
    if (!canForcePoint(point)) return
    if (!canForce) {
      denyForce()
      return
    }
    await apiClient.forcePoint(point.id, point.value as number | boolean, true)
    toast.push('success', pick(`Đã nhả lệnh ép ${pointDisplayTag(point)}`, `Released ${pointDisplayTag(point)}`))
    await pointsState.refetch()
  }

  async function confirmForce() {
    if (!selected) return
    try {
      const value = parseForceValue(selected, forceValue)
      const durationSeconds = parseForceDurationSeconds(forceDurationMinutes)
      await forcePointWithDuration(selected, value, durationSeconds)
      setForceOpen(false)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Force failed')
    }
  }

  function startEditName(point: Point) {
    setEditingName(point.id)
    setEditingNameValue(point.name)
  }

  async function saveName(point: Point) {
    const nameError = validatePointName(editingNameValue)
    if (nameError) {
      toast.push('error', nameError)
      return
    }
    try {
      await apiClient.updatePointName(point.id, normalizePointName(editingNameValue))
      toast.push('success', pick(`Đã đổi tên ${point.id}`, `Renamed ${point.id}`))
      setEditingName(null)
      pointsState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Rename failed')
    }
  }

  function cancelEditName() {
    setEditingName(null)
    setEditingNameValue('')
  }

  function startEditUnit(point: Point) {
    setEditingUnit(point.id)
    setEditingUnitValue(selectUnitValue(point.unit))
  }

  async function saveUnit(point: Point) {
    try {
      await apiClient.updatePointConfig(point.id, { unit: editingUnitValue })
      toast.push('success', pick(`Đã cập nhật đơn vị ${point.id}`, `Updated unit for ${point.id}`))
      setEditingUnit(null)
      pointsState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Update failed')
    }
  }

  function cancelEditUnit() {
    setEditingUnit(null)
    setEditingUnitValue('')
  }

  function startEditTrend(point: Point) {
    setEditingTrend(point.id)
  }

  async function saveTrend(point: Point) {
    /* Giá trị mặc định phải khớp CHÍNH XÁC cái mà `DetailPanel` đang hiển thị
       (`point.trend != null`). Trước đây chỗ hiển thị mặc định theo dữ liệu
       thật còn chỗ ghi mặc định `true`, nên bấm Lưu mà không chạm nút gạt sẽ
       BẬT trend cho một point vốn đang tắt (finding F-UX-10). */
    const enabled = editingTrendEnabled[point.id] ?? (point.trend != null)
    try {
      await apiClient.updatePointConfig(point.id, { trendEnabled: enabled })
      toast.push('success', pick(`Đã cập nhật trend ${point.id}`, `Updated trend for ${point.id}`))
      setEditingTrend(null)
      pointsState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Update failed')
    }
  }

  /** Huỷ phải TRẢ LẠI trạng thái nút gạt về giá trị đã lưu; nếu không, "Hủy"
   *  đóng khung soạn thảo nhưng để lại một nút gạt hiển thị sai so với thiết bị. */
  function cancelEditTrend(pointId?: string) {
    setEditingTrend(null)
    if (!pointId) return
    setEditingTrendEnabled((prev) => {
      if (!(pointId in prev)) return prev
      const next = { ...prev }
      delete next[pointId]
      return next
    })
  }

  function toggleTrend(pointId: string) {
    setEditingTrendEnabled((prev) => ({ ...prev, [pointId]: !prev[pointId] }))
  }

  /* FE-DATA-01 (review FE 2026-08-05): khi authority chết, trang này từng render
   * đầy đủ với "0 điểm / 0% lỗi / 100% bình thường". Trên một màn hình giám sát
   * DDC, trình bày "không đọc được" thành "mọi thứ bình thường" là lỗi an toàn
   * vận hành — cùng họ với D-07 đã sửa cho Modbus.
   *
   * `pointsState.data` chỉ khác `null` sau lần đọc thành công ĐẦU TIÊN, nên hai
   * guard dưới đây chỉ chặn lúc chưa có gì trong tay; hỏng giữa chừng thì giữ số
   * đo cũ và cảnh báo bằng dải bên dưới, không xoá màn hình của ca trực. */
  /* Trạng thái tải/lỗi vẫn GIỮ tiêu đề trang (PA3-603 / WCAG 2.4.6).
     Trả về một `StateBlock` trần làm trang mất `<h1>`: người dùng trình đọc màn
     hình nghe thấy một thông báo lỗi mà không biết mình đang ở trang nào. */
  if (pointsState.loading && !pointsState.data && !realtime.allPoints.length) {
    return (
      <div className="space-y-3">
        <MonitorHeading />
        <StateBlock state="loading" title={pick('Đang tải điểm I/O', 'Loading I/O points')} />
      </div>
    )
  }
  if (pointsState.error && !pointsState.data && !realtime.allPoints.length) {
    return (
      <div className="space-y-3">
        <MonitorHeading />
        <StateBlock
          state="error"
          title={pick('Không tải được điểm I/O', 'Could not load I/O points')}
          detail={pointsState.error.message}
          onRetry={pointsState.refetch}
        />
      </div>
    )
  }

  const pollDegraded = Boolean(pointsState.error)
  /* FE-MON-01 (board thật 2026-08-06): `/points` trả 200 kèm mảng RỖNG là một
   * trạng thái khác hẳn "API chết" — guard lỗi phía trên không bắt được nó. Trên
   * DDC-24-TANG-1 nó cho ra bốn bảng trống không một dòng chữ, trong khi Dashboard
   * cùng lúc vẽ 29 I/O; người trực không có cách nào biết bên nào đúng.
   * Bảng rỗng phải tự nói ra là nó rỗng vì authority không trả điểm nào. */
  const authorityReturnedNoPoints = !pollDegraded && Boolean(pointsState.data) && points.length === 0

  return (
    <div className="space-y-3">
      <MonitorHeading />

      {pollDegraded && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          {pick(
            `Mất kết nối authority; số đo bên dưới là lần đọc gần nhất, không phải trạng thái hiện tại (${pointsState.error?.message}).`,
            `Authority unreachable; the figures below are the last successful read, not the current state (${pointsState.error?.message}).`
          )}
        </div>
      )}

      {authorityReturnedNoPoints && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          {pick(
            'Authority trả lời bình thường nhưng không có điểm I/O nào. Kiểm tra dịch vụ core/iobus và bảng điểm trước khi tin vào các số 0 bên dưới.',
            'The authority responded normally but reported no I/O points. Check the core/iobus services and the point table before trusting the zeros below.'
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label={pick('Tổng số điểm', 'Total points')} value={stats.total} detail={`UI ${stats.ui} | DO ${stats.do} | AO ${stats.ao}`} />
        <StatCard label={pick('Điểm nhị phân đang ON', 'Binary points ON')} value={stats.on} detail={stats.binaryTotal ? `${stats.on}/${stats.binaryTotal} · ${Math.round((stats.on / stats.binaryTotal) * 100)}%` : NO_DATA} />
        {/* `detail` từng gán cứng "100%" nên thẻ này luôn khẳng định mọi điểm
            analog bình thường, kể cả khi không đọc được điểm nào. */}
        <StatCard label={pick('Điểm UI/AO bình thường', 'Normal UI/AO points')} value={stats.analogGood} detail={stats.analogTotal ? `${Math.round((stats.analogGood / stats.analogTotal) * 100)}%` : '—'} />
        <StatCard label={pick('Điểm lỗi / mất tín hiệu', 'Fault / signal-loss points')} value={stats.abnormal} detail={stats.total ? `${Math.round((stats.abnormal / stats.total) * 100)}%` : '—'} danger />
      </div>

      <SavedViewBar
        views={savedViews.views}
        onApply={(view: SavedView) => applySavedFilters(view.params)}
        onSave={(name) => savedViews.save(name, currentFilterParams)}
        onRename={savedViews.rename}
        onRemove={savedViews.remove}
        hint={savedViews.syncState === 'local-only'
          ? pick('Thiết bị không lưu được tuỳ chọn — khung nhìn chỉ nằm trên trình duyệt này.', 'The device cannot store preferences — views stay in this browser only.')
          : pick('Lưu trên thiết bị theo tài khoản đang đăng nhập.', 'Stored on the device under the signed-in account.')}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[170px_170px_170px_170px_190px_1fr_132px]">
        {/* Bộ chọn `group` phải TỒN TẠI trên giao diện, không chỉ đọc được từ
            URL: một bộ lọc chỉ đặt được bằng cách gõ tay query string thì người
            dùng đến từ Health Strip không có cách nào tự gỡ nó ra. */}
        <select aria-label={pick('Lọc theo nguồn điểm', 'Filter by point source')} value={group} onChange={(event) => setFilter('group', event.target.value)} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Nguồn - Tất cả', 'Source - All')}</option>
          <option value="local">{pick('I/O tại chỗ', 'Local I/O')}</option>
          <option value="virtual">{pick('Điểm ảo', 'Virtual')}</option>
          <option value="modbus">Modbus RTU</option>
        </select>
        <select
          aria-label={pick('Lọc theo thiết bị công nghệ', 'Filter by equipment')}
          value={equipment}
          onChange={(event) => setFilter('equip', event.target.value)}
          className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm"
        >
          <option value="all">{pick('Thiết bị - Tất cả', 'Equipment - All')}</option>
          {equipmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          {unassignedCount > 0 && <option value="__unassigned__">{pick(`Chưa gán (${unassignedCount})`, `Unassigned (${unassignedCount})`)}</option>}
        </select>
        <select aria-label={pick('Lọc theo nhóm I/O', 'Filter by I/O group')} value={kind} onChange={(event) => setFilter('kind', event.target.value)} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Nhóm I/O - Tất cả', 'I/O group - All')}</option><option value="UI">UI</option><option value="DO">DO</option><option value="AO">AO</option><option value="virtual">{pick('Ảo', 'Virtual')}</option><option value="modbus_rtu">Modbus RTU</option>
        </select>
        <select aria-label={pick('Lọc theo chất lượng', 'Filter by quality')} value={quality} onChange={(event) => setFilter('quality', event.target.value)} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Chất lượng - Tất cả', 'Quality - All')}</option><option value="good">Good</option><option value="uncertain">Uncertain</option><option value="bad">Bad</option><option value="stale">Stale</option><option value="offline">Offline</option>
        </select>
        <select aria-label={pick('Lọc theo trạng thái vận hành', 'Filter by operating state')} value={stateFilter} onChange={(event) => setFilter('state', event.target.value)} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Trạng thái - Tất cả', 'State - All')}</option>
          <option value="forced">{pick('Đang ép tay', 'Forced')}</option>
          <option value="fault">{pick('Đang lỗi', 'Fault')}</option>
          <option value="offline">{pick('Mất liên lạc', 'Offline')}</option>
          <option value="writable">{pick('Ghi được', 'Writable')}</option>
          <option value="logging">{pick('Đang ghi lịch sử', 'Logging')}</option>
        </select>
        <label className="flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
          <input value={query} onChange={(event) => setFilter('q', event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder={pick('Tìm theo id, tag, tên, nguồn...', 'Search id, tag, name, source...')} />
          <Search className="h-4 w-4 text-[var(--c-text-dim)]" />
        </label>
        <Button icon={<RefreshCw className="h-4 w-4" />} onClick={pointsState.refetch}>{pick('Làm mới', 'Refresh')}</Button>
      </div>

      {/* T57-1.4 — thanh hành động chỉ xuất hiện khi đã chọn ít nhất một điểm.
          Hiện nó thường trực sẽ đặt một nút phát lệnh ghi ra cơ cấu chấp hành
          nằm sẵn trên màn hình giám sát, cạnh các bộ lọc vô hại. */}
      {canForce && bulkSelection.size > 0 && (
        <div role="region" aria-label={pick('Thao tác hàng loạt', 'Bulk actions')} className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-3 py-2">
          <span className="text-sm font-bold text-[var(--c-accent)]">
            {pick(`Đã chọn ${bulkPoints.length} điểm ghi được`, `${bulkPoints.length} writable points selected`)}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setBulkSelection(new Set())}>
              {pick('Bỏ chọn tất cả', 'Clear selection')}
            </Button>
            <Button size="sm" variant="danger" icon={<ShieldAlert className="h-4 w-4" />} disabled={bulkPoints.length === 0} onClick={() => setBulkOpen(true)}>
              {pick(`Ép tay ${bulkPoints.length} điểm…`, `Override ${bulkPoints.length} points…`)}
            </Button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_334px]">
        <div className={cn('space-y-3', offline && 'stale')}>
          <DigitalSection title="DO - DIGITAL OUTPUT" rows={groups.DO} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} onToggle={requestForce} bulkSelection={canForce ? bulkSelection : null} onBulkToggle={toggleBulkSelection} />
          <AnalogSection title="UI - UNIVERSAL INPUT" rows={groups.UI} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} bulkSelection={canForce ? bulkSelection : null} onBulkToggle={toggleBulkSelection} />
          <AnalogSection title="AO - ANALOG OUTPUT" rows={groups.AO} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} onForce={requestForce} bulkSelection={canForce ? bulkSelection : null} onBulkToggle={toggleBulkSelection} />
          <AnalogSection title="VIRTUAL POINTS" rows={groups.Virtual} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} onForce={requestForce} bulkSelection={canForce ? bulkSelection : null} onBulkToggle={toggleBulkSelection} />
          <AnalogSection title="MODBUS RTU POINTS" rows={groups.Modbus} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} bulkSelection={canForce ? bulkSelection : null} onBulkToggle={toggleBulkSelection} />
        </div>
        {selected && <DetailPanel
          point={selected}
          canMutate={canForce}
          editingName={editingName}
          editingNameValue={editingNameValue}
          setEditingNameValue={setEditingNameValue}
          editingUnit={editingUnit}
          editingUnitValue={editingUnitValue}
          setEditingUnitValue={setEditingUnitValue}
          editingTrend={editingTrend}
          editingTrendEnabled={editingTrendEnabled}
          onForce={() => requestForce(selected)}
          onStartEdit={() => startEditName(selected)}
          onSaveEdit={() => saveName(selected)}
          onCancelEdit={cancelEditName}
          onStartEditUnit={() => startEditUnit(selected)}
          onSaveEditUnit={() => saveUnit(selected)}
          onCancelEditUnit={cancelEditUnit}
          onStartEditTrend={() => startEditTrend(selected)}
          onSaveEditTrend={() => saveTrend(selected)}
          onCancelEditTrend={() => cancelEditTrend(selected.id)}
          onToggleTrend={(id) => toggleTrend(id)}
          conflictIds={nameConflicts.get(selected.id)}
        />}
      </div>

      {modalPoint && (
        <PointDetailsModal
          key={modalPoint.id}
          point={modalPoint}
          conflictIds={nameConflicts.get(modalPoint.id)}
          onClose={() => setPointModalId(null)}
          onSave={savePointBasics}
          onForce={forcePointWithDuration}
          onRelease={releasePoint}
        />
      )}

      {bulkOpen && (
        <BulkOverrideDialog
          points={bulkPoints}
          actor={session?.username}
          role={session?.role}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkSelection(new Set()); void pointsState.refetch() }}
          onSend={(row, value, ttlS) => forcePointWithDuration(
            points.find((point) => point.id === row.pointId) as Point,
            value,
            ttlS
          )}
        />
      )}

      {/* Hộp thoại xác nhận ép tay — UX-DES §11 và UX-REQ §12.
          Phải nói rõ ĐỐI TƯỢNG, giá trị hiện tại, giá trị mới, nguồn đang giữ
          quyền và ai đang thực hiện. Không có bộ chọn priority: mọi lệnh từ
          web đều là Local Manual mức 2 (UC-04). */}
      <Modal
        open={forceOpen}
        title={selected ? `${selected.kind === 'virtual' ? pick('Ghi giá trị', 'Write value') : pick('Ép tay', 'Manual override')} — ${pointDisplayTag(selected)}` : ''}
        danger={selected?.kind !== 'virtual'}
        confirmLabel={selected?.kind === 'virtual' ? pick('Ghi giá trị', 'Write value') : pick('Áp dụng ép tay', 'Apply override')}
        onConfirm={confirmForce}
        onClose={() => setForceOpen(false)}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-[var(--c-warn-fg)]">
              <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>
                {selected.kind === 'virtual'
                  ? pick('Ghi trực tiếp vào điểm ảo. Không có thời hạn tự nhả cho loại điểm này.', 'Writes directly to the virtual point. There is no automatic release for this point type.')
                  : pick('Lệnh này tạo override Local Manual và do bộ điều khiển tự nhả khi hết thời hạn, kể cả khi bạn đóng trình duyệt.', 'This creates a Local Manual override released by the controller when the duration expires, even if you close the browser.')}
              </span>
            </div>

            <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
              <dt className="text-[var(--c-text-dim)]">{pick('Đối tượng', 'Object')}</dt>
              <dd className="font-semibold">{pointDisplayTag(selected)} — {selected.name}</dd>
              <dt className="text-[var(--c-text-dim)]">{pick('Giá trị hiện tại', 'Current value')}</dt>
              <dd className="mono">{formatPointValue(selected)}</dd>
              <dt className="text-[var(--c-text-dim)]">{pick('Nguồn đang giữ', 'Current owner')}</dt>
              <dd>{selected.priority ?? NO_DATA}</dd>
              <dt className="text-[var(--c-text-dim)]">{pick('Người thực hiện', 'Actor')}</dt>
              <dd>{session?.username ?? NO_DATA} · {session?.role ?? NO_DATA}</dd>
            </dl>

            <label className="block text-sm">
              {pick('Giá trị mới', 'New value')}
              <PointForceInput point={selected} value={forceValue} onChange={setForceValue} />
            </label>
            {selected.kind !== 'virtual' && (
              <label className="block text-sm">
                {pick('Thời hạn (phút) — do bộ điều khiển cưỡng chế', 'Duration (minutes) — enforced by the controller')}
                <input type="number" min="1" max="1440" step="1" value={forceDurationMinutes} onChange={(event) => setForceDurationMinutes(event.target.value)} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" />
              </label>
            )}
            {selected.forced && (
              <p className="rounded-[var(--radius)] border border-[var(--c-force)] bg-[var(--c-force-bg)] px-3 py-2 text-xs text-[var(--c-force)]">
                {pick('Điểm này ĐANG bị ép tay', 'This point is ALREADY under manual override')}
                {selected.overrideExpiresInS ? ` · ${pick('còn', 'remaining')} ${formatCountdown(selected.overrideExpiresInS)}` : ''}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Tiêu đề trang, dùng chung cho cả trạng thái bình thường lẫn loading/lỗi. */
function MonitorHeading() {
  const { pick } = useI18n()
  return (
    <div>
      <h1 className="text-xl font-semibold leading-tight">Monitor I/O</h1>
      <p className="text-xs text-[var(--c-text-dim)]">{pick('Giám sát trạng thái điểm I/O', 'Monitor I/O point states')}</p>
    </div>
  )
}

function StatCard({ label, value, detail, danger }: { label: string; value: number; detail: string; danger?: boolean }) {
  const color = danger ? 'var(--c-fault-fg)' : 'var(--c-good-fg)'
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
      <div className="text-[11px] uppercase text-[var(--c-text-dim)]">{label}</div>
      <div className="mono mt-3 text-4xl font-bold" style={{ color }}>{value}</div>
      <div className="mt-2 flex justify-between text-xs text-[var(--c-text-dim)]"><span>{detail}</span></div>
    </div>
  )
}

function DigitalSection({ title, rows, selectedId, conflicts, onSelect, onOpenDetails, onToggle, bulkSelection, onBulkToggle }: { title: string; rows: Point[]; selectedId?: string; conflicts: Map<string, string[]>; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onToggle: (point: Point) => void; bulkSelection?: Set<string> | null; onBulkToggle?: (id: string) => void }) {
  const { pick } = useI18n()
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="flex border-b border-[var(--c-border)] py-2 pl-3 text-[10px] uppercase text-[var(--c-text-dim)]">
        {bulkSelection && <span className="w-[30px] shrink-0" />}
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(140px,200px)_minmax(150px,1fr)_112px_128px_104px] items-center gap-x-3">
        <span>{pick('Điểm', 'Point')}</span><span>{pick('Tên điểm', 'Point name')}</span><span>{pick('Trạng thái', 'Status')}</span><span>{pick('Thời gian cập nhật', 'Updated at')}</span><span>{pick('Còn lại', 'Remaining')}</span></div><span className="w-[60px] shrink-0" />
      </div>
      {rows.map((point) => <DigitalRow key={point.id} point={point} conflictIds={conflicts.get(point.id)} selected={point.id === selectedId} onSelect={onSelect} onOpenDetails={onOpenDetails} onToggle={onToggle} bulkSelection={bulkSelection} onBulkToggle={onBulkToggle} />)}
    </SectionFrame>
  )
}

/**
 * Một dòng DO.
 *
 * F-UX-05 — bản trước dựng cả dòng là `<button>` rồi NHÉT thêm một
 * `<span role="switch" tabIndex={0}>` vào bên trong nó. Ba hệ quả:
 *
 *  1. HTML không hợp lệ (phần tử tương tác lồng trong phần tử tương tác); trình
 *     đọc màn hình đọc ra một control mà bàn phím không tới đúng chỗ.
 *  2. `role="switch"` KHÔNG có `onKeyDown`: người dùng Tab tới được nút gạt rồi
 *     bấm Space/Enter thì không có gì xảy ra — WCAG 2.2 §2.1.1 (Keyboard).
 *     Với một control ĐÓNG/MỞ contactor, "nhìn thấy mà không bấm được" là lỗi
 *     khả dụng chứ không phải khiếm khuyết mỹ thuật.
 *  3. Nút gạt không nói ra nó điều khiển cái gì.
 *
 * Nay: hàng là `<div>` với một nút chọn riêng và một `<button role="switch">`
 * thật đứng cạnh — cả hai đều là điểm dừng Tab hợp lệ và tự kích hoạt bằng
 * Space/Enter theo hành vi mặc định của `<button>`.
 */
function DigitalRow({ point, conflictIds, selected, onSelect, onOpenDetails, onToggle, bulkSelection, onBulkToggle }: { point: Point; conflictIds?: string[]; selected: boolean; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onToggle: (point: Point) => void; bulkSelection?: Set<string> | null; onBulkToggle?: (id: string) => void }) {
  const { pick } = useI18n()
  const active = Boolean(point.value)
  const flash = useValueFlash(point.value)
  const state = active ? 'on' : 'off'
  const stateFillColor = statusFill(state)
  const stateTextColor = statusColor(state)
  return (
    <div className={cn('flex w-full items-center border-b border-[var(--c-border)] text-xs transition last:border-0', selected && 'bg-[var(--c-accent-bg)]')}>
      <BulkSelectCell point={point} bulkSelection={bulkSelection} onBulkToggle={onBulkToggle} />
      <button
        type="button"
        onClick={() => onSelect(point.id)}
        onDoubleClick={() => onOpenDetails(point)}
        className="grid min-w-0 flex-1 grid-cols-[minmax(140px,200px)_minmax(150px,1fr)_112px_128px_104px] items-center gap-x-3 py-2 pl-3 text-left transition hover:bg-[var(--c-accent-bg)]"
      >
        <span className="mono min-w-0 truncate font-semibold" title={pointDisplayTag(point)}>{pointDisplayTag(point)}</span>
        <span className="min-w-0 truncate font-semibold" title={point.name}>{point.name}{conflictIds?.length ? ' ⚠' : ''}</span>
        <span className={cn('inline-flex items-center gap-2 rounded px-1 font-semibold', flash)} style={{ color: stateTextColor }}><Circle className="h-2.5 w-2.5 fill-current" style={{ color: stateFillColor }} />{active ? 'ON' : 'OFF'}</span>
        <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
        {/* T57-1.3 (§6.2-P1b) — cột "Còn lại" ngay trên bảng.
            `overrideExpiresInS` trước đây CHỈ hiện trong khung chi tiết của điểm
            đang chọn, nên không quét được toàn bảng xem cái nào sắp hết hạn —
            đúng câu hỏi cần trả lời nhanh nhất khi đang chạy thử một AHU. */}
        <OverrideRemainingCell point={point} />
      </button>
      {/* Ô hành động rộng CỐ ĐỊNH 60px, khớp đúng ô chừa chỗ của header (N-04).
          Căn bằng margin trên chính nút gạt sẽ trôi mỗi lần ai đó đổi kích thước
          nút — ô cố định thì không. */}
      <span className="flex w-[60px] shrink-0 justify-center">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={pick(`Ép tay ${pointDisplayTag(point)} — ${point.name}`, `Manual override ${pointDisplayTag(point)} — ${point.name}`)}
          onClick={() => onToggle(point)}
          className={cn('flex h-5 w-9 items-center rounded-full border px-0.5 transition', active ? 'justify-end border-[var(--c-good)] bg-[var(--c-good-bg)]' : 'justify-start border-[var(--c-border)] bg-[var(--c-surface-2)]')}
        >
          <span className={cn('h-3.5 w-3.5 rounded-full', active ? 'bg-[var(--c-good)]' : 'bg-[var(--c-off)]')} />
        </button>
      </span>
    </div>
  )
}

function AnalogSection({ title, rows, selectedId, conflicts, onSelect, onOpenDetails, onForce, bulkSelection, onBulkToggle }: { title: string; rows: Point[]; selectedId?: string; conflicts: Map<string, string[]>; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onForce?: (point: Point) => void; bulkSelection?: Set<string> | null; onBulkToggle?: (id: string) => void }) {
  const { pick } = useI18n()
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="flex border-b border-[var(--c-border)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        {bulkSelection && <span className="w-[30px] shrink-0" />}
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(140px,200px)_minmax(150px,1fr)_70px_60px_120px_90px_84px_104px] items-center gap-x-3">
        <span>{pick('Điểm', 'Point')}</span><span>{pick('Tên điểm', 'Point name')}</span><span>{pick('Giá trị', 'Value')}</span><span>{pick('Đơn vị', 'Unit')}</span><span>{pick('Trạng thái', 'Status')}</span><span>Trend</span><span>{pick('Cập nhật', 'Updated')}</span><span>{pick('Còn lại', 'Remaining')}</span></div><span className="w-[76px] shrink-0" />
      </div>
      {rows.map((point) => <AnalogRow key={point.id} point={point} conflictIds={conflicts.get(point.id)} selected={point.id === selectedId} onSelect={onSelect} onOpenDetails={onOpenDetails} onForce={onForce} bulkSelection={bulkSelection} onBulkToggle={onBulkToggle} />)}
    </SectionFrame>
  )
}

/**
 * Ô chọn của một hàng cho ép tay hàng loạt — `T57-1.4`.
 *
 * Điểm KHÔNG ép tay được vẫn có ô chọn nhưng bị **vô hiệu** kèm `title` nói rõ
 * lý do, thay vì biến mất. Ẩn hẳn ô làm các hàng lệch nhau và người dùng không
 * biết vì sao hàng này chọn được còn hàng kia thì không — trong khi vô hiệu
 * kèm lý do trả lời luôn câu hỏi đó.
 *
 * `bulkSelection === null` (vai trò dưới `operator`) thì không render gì: người
 * chỉ-đọc không nên thấy một cột dẫn tới lệnh ghi mà họ không được phép phát.
 */
function BulkSelectCell({ point, bulkSelection, onBulkToggle }: {
  point: Point
  bulkSelection?: Set<string> | null
  onBulkToggle?: (id: string) => void
}) {
  const { pick } = useI18n()
  if (!bulkSelection || !onBulkToggle) return null
  const selectable = isBulkSelectable(point)
  return (
    <span className="flex w-[30px] shrink-0 justify-center">
      <input
        type="checkbox"
        checked={bulkSelection.has(point.id)}
        disabled={!selectable}
        onChange={() => onBulkToggle(point.id)}
        aria-label={pick(
          `Chọn ${pointDisplayTag(point)} — ${point.name} để ép tay hàng loạt`,
          `Select ${pointDisplayTag(point)} — ${point.name} for bulk override`
        )}
        title={selectable ? undefined : pick('Điểm này không ép tay được', 'This point cannot be overridden')}
        className="h-4 w-4 accent-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-40"
      />
    </span>
  )
}

/**
 * Ô "Còn lại" trong bảng — `T57-1.3`.
 *
 * Điểm KHÔNG bị ép tay để TRỐNG chứ không hiện `—`: trên một bảng 29 hàng mà
 * 26 hàng hiện `—` thì ba hàng có số bị chìm mất, và `—` ở đây sẽ bị đọc nhầm
 * thành "đang ép nhưng không rõ còn bao lâu". Chỉ hàng đang bị ép mới có nội
 * dung ở cột này, và khi đó `OverrideRemaining` phân biệt tiếp ba trạng thái.
 */
function OverrideRemainingCell({ point }: { point: Point }) {
  if (point.forced !== true) return <span aria-hidden="true" />
  return <OverrideRemaining remainingS={point.overrideExpiresInS} compact />
}

/** Sparkline khi chưa có buffer: một điểm nếu đã đo được, rỗng nếu chưa.
 *  Vẽ điểm 0 cho point chưa từng được poll là bịa một số đo (REV-FE-04). */
function sparklineFallback(point: Point): number[] {
  const value = pointNumber(point)
  return value === null ? [] : [value]
}

function AnalogRow({ point, conflictIds, selected, onSelect, onOpenDetails, onForce, bulkSelection, onBulkToggle }: { point: Point; conflictIds?: string[]; selected: boolean; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onForce?: (point: Point) => void; bulkSelection?: Set<string> | null; onBulkToggle?: (id: string) => void }) {
  const { pick } = useI18n()
  const trendBuffer = useTrendBuffer(point.id, point.value, point.trend)
  const flash = useValueFlash(point.value)
  // Kênh Signal Type = "none" ("Không hoạt động") là người dùng CHỦ Ý chưa
  // nối cảm biến — Core trả quality=bad đúng thiết kế (không có dữ liệu
  // thật), nhưng hiện đỏ "BAD" y hệt một fault phần cứng là báo sai mức độ
  // nghiêm trọng (cùng họ với domain Local I/O ở Dashboard, đã sửa ở backend
  // F-DASH-LOCALIO-01). Tách hiển thị: chấm/màu trung tính + nhãn riêng.
  const notConfigured = isChannelNotConfigured(point)
  /* F-UX-08 — `uncertain` KHÔNG phải một dạng nhẹ của `bad`, và tuyệt đối không
     mang mức cảnh báo. Nhãn cũ "Lỗi - HIGH" vi phạm cả hai luật của
     `UX_REQ_PA3_WEB` §1.1 (bảng chất lượng điểm) và §1.3 (severity là năm mức
     của ISA-18.2, không dính gì tới quality): nó biến "đo được nhưng không đảm
     bảo" thành "đang lỗi mức HIGH", tức là bịa ra một mức ưu tiên xử lý mà
     không producer nào phát ra. */
  const statusText = notConfigured
    ? pick('Chưa cấu hình', 'Not configured')
    : point.quality === 'good' ? pick('Bình thường', 'Normal')
      /* Giữ đúng bộ từ vựng viết hoa mà `QualityBadge` dùng ở mọi nơi khác
         (UNCERTAIN/BAD/STALE/OFFLINE) — một trang nói "Lỗi - HIGH" còn trang
         bên cạnh nói "UNCERTAIN" cho cùng một điểm là cách chắc chắn để người
         trực kết luận hai chỗ đang đo hai thứ khác nhau. */
      : point.quality.toUpperCase()
  return (
    /* N-04 (kiểm tra viên độc lập): header và hàng phải dùng CHÍNH một template
       grid. Bản trước bọc nút hành động trong một lớp `flex` bên ngoài grid của
       hàng, nên cột `1fr` (Tên điểm) nuốt toàn bộ phần chênh và mọi cột PHÍA SAU
       nó lệch trái ~65-70 px so với header của chính bảng — và chỉ lệch ở AO/VP
       (có nút) chứ không lệch ở UI (không nút), tức bảng lệch không đều trong
       cùng một trang. */
    <div className={cn('flex w-full items-center border-b border-[var(--c-border)] px-3 text-xs transition last:border-0', selected && 'bg-[var(--c-accent-bg)]')}>
      <BulkSelectCell point={point} bulkSelection={bulkSelection} onBulkToggle={onBulkToggle} />
      <button type="button" onClick={() => onSelect(point.id)} onDoubleClick={() => onOpenDetails(point)} className="grid min-w-0 flex-1 grid-cols-[minmax(140px,200px)_minmax(150px,1fr)_70px_60px_120px_90px_84px_104px] items-center gap-x-3 py-2 text-left transition hover:bg-[var(--c-accent-bg)]">
        <span className="mono min-w-0 truncate font-semibold" title={point.kind === 'virtual' ? point.id : pointDisplayTag(point)}>{point.kind === 'virtual' ? point.id : pointDisplayTag(point)}</span>
        <span className="min-w-0 truncate font-semibold" title={point.kind === 'virtual' ? (point.name && point.name !== point.id ? point.name : point.tag) : point.name}>{point.kind === 'virtual' ? (point.name && point.name !== point.id ? point.name : point.tag) : point.name}{conflictIds?.length ? ' ⚠' : ''}</span>
        <span className={cn('mono rounded px-1', flash)}>{notConfigured ? NO_DATA : point.signalType === 'multistate' || typeof point.value !== 'number' ? formatPointValue(point) : point.value.toFixed(1)}</span>
        {/* AO: số ở cột bên là tín hiệu ra thô của Core, nên nhãn phải là đơn vị
            tín hiệu thật (`rawUnit`: V hay mA theo MODE của kênh) chứ không
            phải "V" đóng cứng — kênh 4-20mA trước đây bị dán nhãn V
            (F-OUT-002, 2026-08-19). */}
        <span className="mono text-[var(--c-text-dim)]">{notConfigured ? NO_DATA : point.unit ?? (point.kind === 'AO' ? point.rawUnit ?? 'V' : '-')}</span>
        <span className="inline-flex items-center gap-2"><Circle className="h-2.5 w-2.5 fill-current" style={{ color: notConfigured ? statusFill('inactive') : statusFill(point.quality) }} />{statusText}</span>
        {/* F-UX-06 — ô này TỪNG là một `<span onClick>` mở thẳng hộp thoại ép
            tay. Một vùng bấm không nhãn, không viền, không con trỏ, nằm dưới
            tiêu đề cột "Trend", mà lại là đường vào lệnh ghi ra cơ cấu chấp
            hành: người dùng bấm nhầm mới biết nó có; người dùng cần nó thì
            không có cách nào biết. Nay nó chỉ còn là biểu đồ, và lệnh ép tay đi
            qua nút có nhãn ở cuối hàng. */}
        <span><Sparkline values={trendBuffer.length > 0 ? trendBuffer : sparklineFallback(point)} color={notConfigured ? 'var(--c-text-dim)' : point.quality === 'good' ? 'var(--c-accent-2)' : point.quality === 'bad' ? 'var(--c-fault-fg)' : 'var(--c-warn-fg)'} /></span>
        <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
        <OverrideRemainingCell point={point} />
      </button>
      {/* N-05 (kiểm tra viên độc lập): điều kiện phải gồm `canForcePoint`, không
          chỉ `onForce`. `DetailPanel` và modal đã dùng `canForcePoint` nên một VP
          `writable: false` bị từ chối ở đó — nhưng bảng vẫn bày nút. Trước bản sửa
          F-UX-06 đây là một vùng bấm ẩn nên không ai thấy; F-UX-06 biến nó thành
          một LỜI HỨA CÓ NHÃN. Bảng mời ghi còn khung chi tiết của cùng điểm lại từ
          chối là mâu thuẫn tệ hơn bẫy cũ trên một HMI vận hành. */}
      <span className="flex w-[76px] shrink-0 justify-end">
        {onForce && canForcePoint(point) && (
          <button
            type="button"
            onClick={() => onForce(point)}
            className="rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 text-[11px] font-semibold text-[var(--c-accent)] transition hover:border-[var(--c-accent)]"
          >
            {point.kind === 'virtual' ? pick('Ghi', 'Write') : pick('Ép tay', 'Override')}
          </button>
        )}
      </span>
    </div>
  )
}

/**
 * Hộp thoại ép tay hàng loạt — `T57-1.4`, đề xuất §6.2-P1a.
 *
 * TRIỆU CHỨNG: chạy thử một AHU cần ép 3–5 điểm liên tiếp. Hôm nay phải mở 5
 * hộp thoại, mỗi cái nhập lại thời hạn — vừa chậm, vừa dễ để sót một điểm chưa
 * nhả, và năm thời hạn lệch nhau nghĩa là năm thời điểm tự nhả khác nhau ngay
 * giữa lúc đang chạy thử.
 *
 * NGUYÊN NHÂN GỐC: giao diện ánh xạ 1-1 với hợp đồng backend (`PUT /points/{id}`
 * là một điểm một request), nên thao tác của người dùng bị chẻ theo hình dạng
 * của API thay vì theo hình dạng của công việc.
 *
 * CÁCH SỬA: một hộp thoại gom N điểm, một thời hạn dùng chung, và **vẫn** gửi
 * N request tuần tự — nhưng người dùng chỉ phải quyết định một lần. Kết quả báo
 * theo TỪNG điểm vì đây không phải một giao dịch nguyên tử và không được giả vờ
 * là như vậy.
 *
 * Đặc tả trực quan: `docs/04_uiux/KX-DDC24-UX-WEB-OPERATIONS-001_VI.md` §2.
 */
function BulkOverrideDialog({ points, actor, role, onClose, onDone, onSend }: {
  points: Point[]
  actor?: string
  role?: string
  onClose: () => void
  onDone: () => void
  onSend: (row: BulkPlanRow, value: number | boolean, ttlS: number) => Promise<void>
}) {
  const { pick } = useI18n()
  const [binaryValue, setBinaryValue] = useState('true')
  const [analogValue, setAnalogValue] = useState('100')
  const [durationMinutes, setDurationMinutes] = useState('10')
  const [acknowledged, setAcknowledged] = useState(false)
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [outcomes, setOutcomes] = useState<BulkOverrideOutcome[]>([])
  /* Kế hoạch được ĐÓNG BĂNG khi bắt đầu gửi. `plan` dẫn xuất từ prop `points`,
     mà `points` co lại ngay khi trang xoá lựa chọn — nếu render kết quả theo
     `plan` thì danh sách biến mất đúng lúc người dùng cần đọc nó nhất, ngay sau
     khi vừa phát N lệnh ghi ra cơ cấu chấp hành. */
  const [runPlan, setRunPlan] = useState<BulkPlanRow[]>([])
  /* Cờ huỷ ở `ref` chứ không ở state: `runBulkOverride` đọc nó qua closure
     giữa các `await`, và một giá trị state bị đóng băng tại lần render bắt đầu
     vòng lặp sẽ làm nút Huỷ không có tác dụng nào. */
  const abortRef = useRef(false)

  const parsedAnalog = Number(analogValue)
  /* `Number('')` trả `0`, hữu hạn — nên kiểm mỗi `isFinite` sẽ coi ô TRỐNG là
     hợp lệ và gửi `0` xuống mọi kênh analog đã chọn. Trên một van, `0 %` là
     "đóng hoàn toàn": im lặng biến một ô bỏ trống thành một lệnh vận hành. */
  const analogValid = analogValue.trim() !== '' && Number.isFinite(parsedAnalog)
  const parsedMinutes = Number(durationMinutes)
  const durationValid = Number.isFinite(parsedMinutes) && parsedMinutes > 0

  const plan = useMemo(
    () => planBulkOverride(points, binaryValue === 'true', analogValid ? parsedAnalog : 0),
    [points, binaryValue, analogValid, parsedAnalog]
  )
  const hasBinary = plan.some((row) => row.isBinary)
  const hasAnalog = plan.some((row) => !row.isBinary)
  const canApply = acknowledged && durationValid && (!hasAnalog || analogValid) && plan.length > 0

  async function apply() {
    abortRef.current = false
    setRunPlan(plan)
    setPhase('running')
    setOutcomes([])
    const ttlS = Math.round(parsedMinutes * 60)
    const result = await runBulkOverride(
      plan,
      (row) => onSend(row, row.nextValue, ttlS),
      {
        isAborted: () => abortRef.current,
        onProgress: (outcome) => setOutcomes((current) => [...current, outcome])
      }
    )
    setOutcomes(result)
    setPhase('done')
    onDone()
  }

  const summary = summarizeBulkOutcomes(outcomes)

  return (
    <Modal
      open
      size="xl"
      danger
      title={phase === 'done'
        ? pick(`${summary.sent} điểm đã ép, ${summary.failed} điểm thất bại`, `${summary.sent} overridden, ${summary.failed} failed`)
        : pick(`Ép tay ${plan.length} điểm cùng lúc`, `Override ${plan.length} points at once`)}
      cancelLabel={phase === 'done' ? pick('Đóng', 'Close') : pick('Huỷ', 'Cancel')}
      confirmLabel={phase === 'confirm' ? pick(`Áp dụng cho ${plan.length} điểm`, `Apply to ${plan.length} points`) : undefined}
      confirmDisabled={!canApply}
      confirmLoading={phase === 'running'}
      onConfirm={phase === 'confirm' ? () => { void apply() } : undefined}
      onClose={() => {
        // Đóng khi đang chạy = huỷ phần CHƯA gửi. Phần đã gửi vẫn đang bị ép.
        if (phase === 'running') abortRef.current = true
        onClose()
      }}
    >
      <div className="space-y-4">
        {phase === 'confirm' && (
          <>
            <div className="flex gap-3 rounded-[var(--radius)] border-2 border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-[var(--c-warn-fg)]">
              <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="text-sm">
                {pick(
                  `Lệnh này tạo override Local Manual (mức 2) trên ${plan.length} đầu ra vật lý. Bộ điều khiển tự nhả khi hết thời hạn, kể cả khi bạn đóng trình duyệt. Không có bộ chọn mức ưu tiên: mọi lệnh từ web đều là mức 2.`,
                  `This creates Local Manual (level 2) overrides on ${plan.length} physical outputs. The controller releases them when the duration expires, even if you close the browser. There is no priority selector: every command from the web is level 2.`
                )}
              </span>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">{pick('Từng điểm sẽ đổi như sau — kiểm lại trước khi xác nhận:', 'Each point changes as follows — review before confirming:')}</p>
              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
                <table className="w-full min-w-[520px] text-xs">
                  <thead>
                    <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-[10px] uppercase text-[var(--c-text-dim)]">
                      <th className="px-3 py-2 font-semibold">{pick('Điểm', 'Point')}</th>
                      <th className="px-3 py-2 font-semibold">{pick('Tên', 'Name')}</th>
                      <th className="px-3 py-2 text-right font-semibold">{pick('Hiện tại', 'Current')}</th>
                      <th className="px-3 py-2 text-center font-semibold" aria-hidden="true" />
                      <th className="px-3 py-2 font-semibold">{pick('Sẽ thành', 'Becomes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((row) => (
                      <tr key={row.pointId} className="border-b border-[var(--c-border)] last:border-0">
                        <td className="mono px-3 py-2 font-semibold">{row.displayTag}</td>
                        <td className="px-3 py-2">{row.name}</td>
                        {/* Không có số đo ⇒ `—`. Điền sẵn một con số đoán vào
                            bảng hậu quả của lệnh ghi ra thiết bị là đúng lỗi
                            F-UX-09, chỉ nguy hiểm hơn vì ở đây có N điểm. */}
                        <td className="mono px-3 py-2 text-right">{row.currentValue === undefined ? NO_DATA : formatValue(row.currentValue, row.unit)}</td>
                        <td className="px-3 py-2 text-center font-bold text-[var(--c-accent)]" aria-hidden="true">→</td>
                        <td className="mono px-3 py-2 font-semibold">{formatValue(row.nextValue, row.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {hasBinary && (
                <label className="block text-sm">
                  {pick('Giá trị mới cho nhóm nhị phân', 'New value for the binary group')}
                  <select value={binaryValue} onChange={(event) => setBinaryValue(event.target.value)} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3">
                    <option value="true">ON</option>
                    <option value="false">OFF</option>
                  </select>
                </label>
              )}
              {hasAnalog && (
                <label className="block text-sm">
                  {pick('Giá trị mới cho nhóm analog', 'New value for the analog group')}
                  <input
                    type="number"
                    value={analogValue}
                    aria-invalid={!analogValid}
                    onChange={(event) => setAnalogValue(event.target.value)}
                    className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3"
                  />
                  {!analogValid && <span role="alert" className="mt-1 block text-xs text-[var(--c-fault-fg)]">{pick('Giá trị analog phải là một số', 'The analog value must be a number')}</span>}
                </label>
              )}
            </div>

            <label className="block text-sm">
              {pick('Thời hạn dùng chung (phút) — do bộ điều khiển cưỡng chế', 'Shared duration (minutes) — enforced by the controller')}
              <input
                type="number"
                min="1"
                max="1440"
                value={durationMinutes}
                aria-invalid={!durationValid}
                onChange={(event) => setDurationMinutes(event.target.value)}
                className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3"
              />
              {!durationValid && <span role="alert" className="mt-1 block text-xs text-[var(--c-fault-fg)]">{pick('Thời hạn phải lớn hơn 0 phút', 'The duration must be greater than 0 minutes')}</span>}
            </label>

            <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-xs">
              <dt className="text-[var(--c-text-dim)]">{pick('Người thực hiện', 'Actor')}</dt>
              <dd>{actor ?? NO_DATA} · {role ?? NO_DATA}</dd>
            </dl>

            {/* Ma sát CỐ Ý: hộp thoại này gộp 3–5 lệnh nguy hiểm thành một cú
                bấm, nên phải trả lại một nhịp dừng. */}
            <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] p-3 text-sm">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--c-accent)]" />
              <span>{pick(
                `Tôi đã đọc bảng hậu quả phía trên và chịu trách nhiệm cho ${plan.length} lệnh này.`,
                `I have read the consequence table above and take responsibility for these ${plan.length} commands.`
              )}</span>
            </label>
          </>
        )}

        {phase !== 'confirm' && (
          <>
            <p className="text-sm text-[var(--c-text-dim)]">
              {pick(
                'Gửi TUẦN TỰ, mỗi điểm một lệnh riêng — backend không có API ghi hàng loạt.',
                'Sent SEQUENTIALLY, one command per point — the backend has no bulk write API.'
              )}
            </p>
            <p className="text-sm font-semibold">
              {pick(`${outcomes.length} / ${runPlan.length} điểm đã xử lý`, `${outcomes.length} / ${runPlan.length} points processed`)}
            </p>
            <ul className="divide-y divide-[var(--c-border)] rounded-[var(--radius)] border border-[var(--c-border)]">
              {runPlan.map((row) => {
                const outcome = outcomes.find((item) => item.pointId === row.pointId)
                return (
                  <li key={row.pointId} role={outcome?.status === 'failed' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                    <span className="mono w-[92px] shrink-0 font-semibold">{row.displayTag}</span>
                    <span className="min-w-[140px] flex-1 truncate">{row.name}</span>
                    <BulkOutcomeBadge status={outcome?.status} />
                    {outcome?.message && <span className="w-full text-[var(--c-fault-fg)] md:w-auto">{outcome.message}</span>}
                  </li>
                )
              })}
            </ul>
            {phase === 'done' && summary.sent > 0 && (
              <p className="rounded-[var(--radius)] border border-[var(--c-force)] bg-[var(--c-force-bg)] px-3 py-2 text-xs text-[var(--c-force)]">
                {pick(
                  `${summary.sent} điểm đã ép vẫn đang giữ quyền điều khiển và có đếm ngược riêng. Đóng hộp thoại này KHÔNG nhả chúng — xem khối "Ai đang giữ quyền điều khiển" trên trang Tổng quan.`,
                  `${summary.sent} overridden points still hold control with their own countdowns. Closing this dialog does NOT release them — see the "Who holds control" block on the overview page.`
                )}
              </p>
            )}
            {phase === 'done' && summary.skipped > 0 && (
              <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
                {pick(
                  `${summary.skipped} điểm bị bỏ qua do huỷ giữa chừng. Các điểm đã gửi trước đó vẫn đang bị ép.`,
                  `${summary.skipped} points were skipped because the run was cancelled. Points already sent remain overridden.`
                )}
              </p>
            )}
            {phase === 'running' && (
              <Button size="sm" variant="secondary" onClick={() => { abortRef.current = true }}>
                {pick('Huỷ phần còn lại', 'Cancel the rest')}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Trạng thái từng điểm — nhãn CHỮ kèm icon hình khác nhau, không chỉ màu
 *  (WCAG 2.2 §1.4.1). Tick tròn ↔ tam giác cảnh báo phân biệt được cả khi in
 *  đen trắng hoặc khi người dùng không phân biệt được đỏ–lục. */
function BulkOutcomeBadge({ status }: { status?: BulkOverrideStatus }) {
  const { pick } = useI18n()
  if (status === 'sent') {
    return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-good-fg)]"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{pick('ĐÃ ÉP', 'OVERRIDDEN')}</span>
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-fault-fg)]"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />{pick('THẤT BẠI', 'FAILED')}</span>
  }
  if (status === 'skipped') {
    return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-text-dim)]"><X className="h-3.5 w-3.5" aria-hidden="true" />{pick('ĐÃ BỎ QUA', 'SKIPPED')}</span>
  }
  return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-accent)]"><Circle className="h-3.5 w-3.5" aria-hidden="true" />{pick('ĐANG GỬI…', 'SENDING…')}</span>
}

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
      <div className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--c-accent)]">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function PointDetailsModal({
  point,
  conflictIds,
  onClose,
  onSave,
  onForce,
  onRelease
}: {
  point: Point
  conflictIds?: string[]
  onClose: () => void
  onSave: (point: Point, config: { tag: string; name: string; unit?: string; equipment?: string }) => Promise<void>
  onForce: (point: Point, value: number | boolean | string, durationSeconds: number) => Promise<void>
  onRelease: (point: Point) => Promise<void>
}) {
  const { pick } = useI18n()
  const toast = useToast()
  const [tagValue, setTagValue] = useState(point.tag)
  const [tagError, setTagError] = useState<string>()
  const [nameValue, setNameValue] = useState(point.name)
  const [nameError, setNameError] = useState<string>()
  const [unitValue, setUnitValue] = useState(selectUnitValue(point.unit))
  /* `T57-3.1`: thẻ thiết bị sửa ngay tại chỗ người đang nhìn điểm, không phải ở
     một màn hình quản trị riêng — gắn thẻ là việc làm rải rác trong lúc đi soát
     tủ, không phải một đợt cấu hình tập trung. */
  const [equipmentValue, setEquipmentValue] = useState(point.equipment ?? '')
  const [forceValue, setForceValue] = useState(defaultForceValue(point))
  const [forceDurationMinutes, setForceDurationMinutes] = useState('10')
  const [busy, setBusy] = useState<'save' | 'force' | 'release' | null>(null)
  const isAnalog = point.kind === 'UI' || point.kind === 'AO' || point.kind === 'virtual'
  const canForce = canForcePoint(point)
  const active = Boolean(point.value)
  const binaryState = active ? 'on' : 'off'
  const binaryTextColor = statusColor(binaryState)
  const groupText = `${point.kind} - ${kindLabel[point.kind]}`
  const nameInputRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    const localError = point.kind === 'virtual' ? validatePointTag(tagValue) : undefined
    const localNameError = validatePointName(nameValue)
    if (localError) {
      setTagError(localError)
      return
    }
    if (localNameError) {
      setNameError(localNameError)
      nameInputRef.current?.focus()
      return
    }
    try {
      setBusy('save')
      const nextTag = point.kind === 'virtual' ? normalizePointTag(tagValue) : point.tag
      const nextName = normalizePointName(nameValue)
      const nextUnit = isAnalog ? unitValue : undefined
      await onSave(point, { tag: nextTag, name: nextName, unit: nextUnit, equipment: equipmentValue.trim() })
      setTagValue(nextTag)
      setTagError(undefined)
      setNameError(undefined)
      setNameValue(nextName)
      if (nextUnit !== undefined) setUnitValue(nextUnit)
    } catch (err) {
      const errors = pointFieldErrors(err)
      const nameMessage = Object.entries(errors).find(([path]) => /\.(?:name|label)$|^(?:name|label)$/.test(path))?.[1]
      const tagMessage = Object.entries(errors).find(([path]) => /\.tag$|^tag$/.test(path))?.[1]
      setNameError(nameMessage)
      setTagError(tagMessage)
      if (nameMessage) window.requestAnimationFrame(() => nameInputRef.current?.focus())
      toast.push('error', err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleForce() {
    try {
      setBusy('force')
      await onForce(point, parseForceValue(point, forceValue), parseForceDurationSeconds(forceDurationMinutes))
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Force failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleRelease() {
    try {
      setBusy('release')
      await onRelease(point)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Release failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open title={`${pointDisplayTag(point)} details`} size="xl" cancelLabel={pick('Close', 'Close')} onClose={onClose}>
      <div className="space-y-5 text-[var(--c-text)]">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Tag</span>
                <input readOnly={point.kind !== 'virtual'} aria-invalid={Boolean(tagError)} aria-describedby={tagError ? `${point.id}-tag-error` : undefined} value={tagValue} onChange={(event) => setTagValue(event.target.value)} className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]" />
                {tagError && <span id={`${point.id}-tag-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{tagError}</span>}
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Point name', 'Point name')}</span>
                <input ref={nameInputRef} data-point-field="name" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${point.id}-name-error` : undefined} value={nameValue} onChange={(event) => setNameValue(event.target.value)} className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]" />
                {nameError && <span id={`${point.id}-name-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{nameError}</span>}
              </label>
              {/* `T57-3.1` (`ADR-042`): thẻ thiết bị công nghệ. Chuỗi tự do có
                  chuẩn hoá, KHÔNG phải khoá ngoại — mô hình thiết bị đầy đủ là
                  quyết định Rev B. */}
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Thiết bị công nghệ', 'Equipment')}</span>
                <input
                  value={equipmentValue}
                  maxLength={48}
                  placeholder={pick('AHU-1, FCU-03…', 'AHU-1, FCU-03…')}
                  aria-label={pick('Thiết bị công nghệ', 'Equipment')}
                  onChange={(event) => setEquipmentValue(event.target.value)}
                  className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]"
                />
                <span className="block text-xs text-[var(--c-text-dim)]">
                  {pick('Để trống nếu chưa gán. Dùng để nhóm điểm theo thiết bị ở trang Giám sát.', 'Leave empty if unassigned. Used to group points by equipment on the Monitor page.')}
                </span>
              </label>
            </div>
            <Button size="sm" variant="primary" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} onClick={handleSave}>{pick('Save basics', 'Save basics')}</Button>
            <PointNameConflictNotice pointId={point.id} conflictIds={conflictIds} />
          </div>

          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
            <div className="mono text-3xl font-bold text-[var(--c-accent)]" style={point.kind === 'DO' ? { color: binaryTextColor } : undefined}>
              {formatPointValue(point)}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <StatusBadge
                state={point.forced ? 'force' : isChannelNotConfigured(point) ? 'inactive' : point.quality}
                label={!point.forced && isChannelNotConfigured(point) ? pick('Chưa cấu hình', 'Not configured') : undefined}
              />
              <span className="mono text-xs text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
            </div>
          </div>
        </div>

        <dl className="grid gap-2 md:grid-cols-2">
          {point.kind !== 'virtual' && <PointInfo label="Point ID" value={point.id} />}
          <PointInfo label="Tag" value={point.tag} />
          <PointInfo label="I/O group" value={groupText} />
          <PointInfo label="Signal type" value={point.sensorType ?? '-'} />
          <PointInfo label="Current value" value={formatPointValue(point)} />
          <PointInfo label="Unit" value={point.unit || '-'} />
          <PointInfo label="Quality" value={point.quality} />
          <PointInfo label="Source" value={point.source} />
          <PointInfo label="Priority" value={point.priority ?? '-'} />
          <PointInfo label="Updated at" value={formatDateTime(point.updatedAt)} />
          <PointInfo label="Forced" value={point.forced ? 'Yes' : 'No'} />
          <PointInfo label="Fault" value={point.fault ? 'Yes' : 'No'} />
          <PointInfo label="Trend samples" value={point.trend?.length ?? 0} />
        </dl>

        {canForce && (
          <section className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--c-warn-fg)]">
              <ShieldAlert className="h-4 w-4" />
              {pick('Force output', 'Force output')}
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Force value', 'Force value')}</span>
                <PointForceInput point={point} value={forceValue} onChange={setForceValue} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Duration (min)', 'Duration (min)')}</span>
                <input type="number" min="1" step="1" value={forceDurationMinutes} onChange={(event) => setForceDurationMinutes(event.target.value)} className="mono h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger" icon={<Power className="h-4 w-4" />} loading={busy === 'force'} onClick={handleForce}>{pick('Force output', 'Force output')}</Button>
              {point.kind !== 'virtual' && <Button icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'release'} onClick={handleRelease}>{pick('Release force', 'Release force')}</Button>}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}

function PointInfo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-xs">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mono min-w-0 break-words font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

function DetailPanel({
  point,
  canMutate,
  editingName,
  editingNameValue,
  setEditingNameValue,
  editingUnit,
  editingUnitValue,
  setEditingUnitValue,
  editingTrend,
  editingTrendEnabled,
  onForce,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onStartEditUnit,
  onSaveEditUnit,
  onCancelEditUnit,
  onStartEditTrend,
  onSaveEditTrend,
  onCancelEditTrend,
  onToggleTrend,
  conflictIds
}: {
  point: Point
  canMutate: boolean
  editingName: string | null
  editingNameValue: string
  setEditingNameValue: (value: string) => void
  editingUnit: string | null
  editingUnitValue: string
  setEditingUnitValue: (value: string) => void
  editingTrend: string | null
  editingTrendEnabled: Record<string, boolean>
  onForce: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartEditUnit: () => void
  onSaveEditUnit: () => void
  onCancelEditUnit: () => void
  onStartEditTrend: () => void
  onSaveEditTrend: () => void
  onCancelEditTrend: () => void
  onToggleTrend: (id: string) => void
  conflictIds?: string[]
}) {
  const { pick } = useI18n()
  const active = Boolean(point.value)
  const isBinary = point.kind === 'DO' || typeof point.value === 'boolean'
  const isAnalog = point.kind === 'UI' || point.kind === 'AO' || point.kind === 'virtual'
  const binaryState = active ? 'on' : 'off'
  const binaryTextColor = statusColor(binaryState)
  const valuePanelStyle = isBinary
    ? { borderColor: active ? 'var(--c-good)' : 'var(--c-border)', backgroundColor: active ? 'var(--c-good-bg)' : 'var(--c-surface-2)' }
    : undefined
  const canForce = canForcePoint(point)
  const groupText = `${point.kind} - ${kindLabel[point.kind]}`
  const isEditing = editingName === point.id
  const isEditingUnit = editingUnit === point.id
  const isEditingTrend = editingTrend === point.id
  const trendEnabled = editingTrendEnabled[point.id] ?? point.trend != null
  return (
    <div className="space-y-3">
      <Panel title={pick('Chi tiết điểm', 'Point details')} action={<X className="h-4 w-4 text-[var(--c-accent)]" />}>
        <div className="space-y-4">
          <div><div className="text-2xl font-semibold">{pointDisplayTag(point)}</div>
            <div className="mt-1 flex items-center gap-2">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    className="h-8 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSaveEdit()
                      if (e.key === 'Escape') onCancelEdit()
                    }}
                  />
                  <Button size="sm" variant="primary" onClick={onSaveEdit}>{pick('Lưu', 'Save')}</Button>
                  <Button size="sm" variant="ghost" onClick={onCancelEdit}>{pick('Hủy', 'Cancel')}</Button>
                </div>
              ) : (
                <>
                  <div className="text-sm font-semibold">{point.name}</div>
                  <button onClick={onStartEdit} className="text-[var(--c-accent)] hover:text-[var(--c-accent-2)]" title={pick('Đổi tên', 'Rename')}>
                    <Pencil className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
          <PointNameConflictNotice pointId={point.id} conflictIds={conflictIds} />
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 text-center" style={valuePanelStyle}>
            <div className="mono text-2xl font-bold text-[var(--c-accent)]" style={isBinary ? { color: binaryTextColor } : undefined}>{formatPointValue(point)}</div>
            <div className="mt-1 flex items-center justify-center gap-2 text-xs font-semibold text-[var(--c-text-dim)]" style={isBinary ? { color: binaryTextColor } : undefined}>
              {isEditingUnit ? (
                <div className="flex items-center gap-1">
                  <select
                    value={editingUnitValue}
                    onChange={(e) => setEditingUnitValue(e.target.value)}
                    className="h-7 w-44 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-1 text-xs"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSaveEditUnit()
                      if (e.key === 'Escape') onCancelEditUnit()
                    }}
                  >
                    {POINT_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button onClick={onSaveEditUnit} className="text-[var(--c-good-fg)]">✓</button>
                  <button onClick={onCancelEditUnit} className="text-[var(--c-fault-fg)]">✗</button>
                </div>
              ) : (
                <>
                  <span>{active ? pick('Kích hoạt', 'Active') : pick('Không kích hoạt', 'Inactive')}</span>
                  {isAnalog && (
                    <>
                      <span>|</span>
                      <span className="mono">{point.unit ?? '-'}</span>
                      <button onClick={onStartEditUnit} className="text-[var(--c-accent)] hover:text-[var(--c-accent-2)]" title={pick('Đổi đơn vị', 'Change unit')}>
                        <Pencil className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          {/* PA3-F06/F07 — bốn dòng bịa dữ liệu đã bị xoá khỏi khối này:
              `Kiểu tín hiệu` mặc định `Dry Contact` khi backend không nói gì,
              `Bộ đếm kích hoạt` gán cứng `15` cho MỌI point, mô tả riêng cho
              `UI-05`, và `Trạng thái logic` ép `Boolean(value)` lên cả point
              analog nên một cảm biến 23.6 °C hiện "logic 1 / Kích hoạt".

              Nay: thiếu dữ liệu thì hiện `—`, và trạng thái nhị phân chỉ hiện
              với point THỰC SỰ nhị phân. */}
          <dl className="grid grid-cols-[118px_1fr] gap-y-3 text-xs">
            <dt className="text-[var(--c-text-dim)]">{pick('Nhóm I/O', 'I/O group')}</dt><dd>{groupText}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Kiểu tín hiệu', 'Signal type')}</dt><dd>{point.signalType ?? point.sensorType ?? NO_DATA}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Chất lượng', 'Quality')}</dt>
            <dd>
              {isChannelNotConfigured(point)
                ? <StatusBadge state="inactive" label={pick('Chưa cấu hình', 'Not configured')} />
                : <QualityBadge quality={point.quality} reason={point.qualityReason} />}
            </dd>
            {isBinary && (
              <>
                <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái hiện tại', 'Current status')}</dt>
                <dd className="font-semibold" style={{ color: binaryTextColor }}>{active ? pick('ON (Kích hoạt)', 'ON (Active)') : 'OFF'}</dd>
              </>
            )}
            {!isBinary && (
              <>
                <dt className="text-[var(--c-text-dim)]">{pick('Giá trị kỹ thuật', 'Engineering value')}</dt>
                <dd className="mono font-semibold">{formatPointValue(point)}</dd>
              </>
            )}
            {point.raw !== undefined && (
              <>
                <dt className="text-[var(--c-text-dim)]">{pick('Giá trị thô', 'Raw value')}</dt>
                <dd className="mono">{formatValue(point.raw, point.rawUnit)}</dd>
              </>
            )}
            <dt className="text-[var(--c-text-dim)]">{pick('Nguồn', 'Source')}</dt><dd>{point.source || NO_DATA}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Nguồn ưu tiên', 'Priority owner')}</dt><dd>{point.priority ?? NO_DATA}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Thời gian cập nhật', 'Updated at')}</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            {point.kind === 'modbus_rtu' && (
              <>
                <dt className="text-[var(--c-text-dim)]">Bus / Slave</dt>
                <dd className="mono">{point.busId !== undefined ? `Bus ${point.busId} · Slave ${point.slaveAddr ?? NO_DATA}` : NO_DATA}</dd>
                <dt className="text-[var(--c-text-dim)]">{pick('Kết nối', 'Online')}</dt>
                <dd>{point.online === undefined ? NO_DATA : point.online ? pick('Có', 'Yes') : pick('Không', 'No')}</dd>
              </>
            )}
            <dt className="text-[var(--c-text-dim)]">{pick('Mô tả', 'Description')}</dt><dd>{point.name || NO_DATA}</dd>
            {isAnalog && (
              <div className="col-span-2 flex items-center justify-between rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2">
                <span className="text-xs text-[var(--c-text-dim)]">{pick('Hiển thị trend', 'Show trend')}</span>
                {/* F-UX-10 — bản trước bày nút gạt ở chế độ XEM và giấu nút Lưu
                    sau biểu tượng bút chì: gạt xong thì giao diện đổi nhưng
                    không có gì được ghi xuống, và không có dấu hiệu nào nói
                    rằng còn phải bấm bút chì rồi bấm Lưu. Ngoài ra nút gạt là
                    `<span role="switch">` không có `tabIndex` nên bàn phím
                    không tới được (WCAG 2.2 §2.1.1).
                    Nay: chế độ xem chỉ ĐỌC trạng thái; nút gạt chỉ xuất hiện
                    khi đang sửa, và luôn đi kèm Lưu/Hủy. */}
                {isEditingTrend ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={trendEnabled}
                      aria-label={pick('Bật ghi trend cho điểm này', 'Enable trend logging for this point')}
                      className={cn('flex h-5 w-9 items-center rounded-full border px-0.5 transition', trendEnabled ? 'justify-end border-[var(--c-good)] bg-[var(--c-good-bg)]' : 'justify-start border-[var(--c-border)] bg-[var(--c-surface)]')}
                      onClick={() => onToggleTrend(point.id)}
                    >
                      <span className={cn('h-3.5 w-3.5 rounded-full', trendEnabled ? 'bg-[var(--c-good)]' : 'bg-[var(--c-off)]')} />
                    </button>
                    <button type="button" onClick={onSaveEditTrend} className="text-xs font-semibold text-[var(--c-good-fg)]">{pick('Lưu', 'Save')}</button>
                    <button type="button" onClick={onCancelEditTrend} className="text-xs font-semibold text-[var(--c-text-dim)]">{pick('Hủy', 'Cancel')}</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: trendEnabled ? 'var(--c-good-fg)' : 'var(--c-text-dim)' }}>
                      {trendEnabled ? pick('Đang bật', 'On') : pick('Đang tắt', 'Off')}
                    </span>
                    <button type="button" onClick={onStartEditTrend} className="text-[var(--c-accent)] hover:text-[var(--c-accent-2)]" title={pick('Cài đặt trend', 'Trend settings')} aria-label={pick('Sửa cài đặt trend', 'Edit trend settings')}>
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              state={isChannelNotConfigured(point) ? 'inactive' : point.quality}
              label={isChannelNotConfigured(point) ? pick('Chưa cấu hình', 'Not configured') : undefined}
            />
            {point.forced && <ForcedBadge remainingLabel={formatCountdown(point.overrideExpiresInS)} />}
          </div>
          {/* PA3-406: mọi lệnh ghi xuống điểm này đều để lại vết trong kho
              Activity. Không có đường dẫn tới đó thì câu hỏi "ai vừa ép cái
              này" lại phải trả lời bằng journalctl trên bo. */}
          <Link
            to={`/activity?objectId=${encodeURIComponent(point.id)}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--c-accent)]"
          >
            {pick('Xem vết audit của điểm này', 'View audit trail for this point')} →
          </Link>
          {canForce && (
            <div className="space-y-2">
              <Button
                className="w-full"
                variant={point.kind === 'virtual' ? 'primary' : 'danger'}
                disabled={!canMutate}
                onClick={onForce}
              >
                {point.kind === 'virtual' ? pick('Ghi giá trị', 'Write value') : pick('Ép giá trị', 'Force output')}
              </Button>
              {/* UX-REQ §10: thiếu quyền thì KHOÁ nút và nói ra quyền cần có.
                  Bày một nút bấm được rồi trả 403 là để người dùng tự phát
                  hiện giới hạn bằng cách va vào nó. */}
              {!canMutate && (
                <p className="text-xs text-[var(--c-text-dim)]">
                  {pick('Cần vai trò operator trở lên để điều khiển điểm này.', 'Operator role or higher is required to command this point.')}
                </p>
              )}
            </div>
          )}
        </div>
      </Panel>

      <PointHistoryPanel point={point} />
    </div>
  )
}

/**
 * Lịch sử THẬT của một point — PA3-403.
 *
 * Thay cho khối cũ dựng 5 dòng bằng `[0,1,2,3,4].map(...)` với giá trị luân
 * phiên ON/OFF và mốc thời gian cách nhau đúng 7 phút. Trông như dữ liệu vận
 * hành, nhưng không có dòng nào đến từ thiết bị — người đọc không có cách nào
 * phân biệt (PA3-F06).
 *
 * Nay đọc historian thật. Point chưa bật ghi lịch sử thì nói rõ là chưa bật,
 * chứ không bịa ra một chuỗi mẫu.
 */
function PointHistoryPanel({ point }: { point: Point }) {
  const { pick } = useI18n()
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error' | 'disabled' | 'unsupported'; rows: HistorySample[]; message?: string }>({ status: 'loading', rows: [] })

  useEffect(() => {
    let cancelled = false
    /* Historian hiện chỉ nhận ID canonical UI/AO/DO/VP. ID ổn định của
       Modbus RTU (ví dụ CK50804-DO1) là hợp lệ trong Point Catalog nhưng chưa
       thuộc contract `/history`; gọi thẳng sẽ tạo một lỗi validation ngay
       trong browser và đưa người vận hành tới Trends vốn cũng không đọc được.
       Hiển thị ranh giới khả dụng rõ ràng, không đổi ID hay bịa mẫu thay thế. */
    if (point.kind === 'modbus_rtu') {
      setState({ status: 'unsupported', rows: [] })
      return () => { cancelled = true }
    }
    if (point.logEnabled === false) {
      setState({ status: 'disabled', rows: [] })
      return () => { cancelled = true }
    }
    setState({ status: 'loading', rows: [] })
    const to = new Date()
    const from = new Date(to.getTime() - 60 * 60 * 1000)
    historyClient
      .query({ pointIds: [point.id], from, to, resolution: '1m', maxPoints: 60 })
      .then((response) => {
        if (cancelled) return
        const samples = response.series.find((series) => series.pointId === point.id)?.samples ?? []
        setState({ status: 'ready', rows: samples.slice(-12).reverse() })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ status: 'error', rows: [], message: error instanceof Error ? error.message : String(error) })
      })
    return () => { cancelled = true }
  }, [point.id, point.logEnabled])

  return (
    <Panel title={pick('Lịch sử 60 phút', 'Last 60 minutes')}>
      {state.status === 'loading' && <StateBlock state="loading" title={pick('Đang đọc lịch sử', 'Loading history')} />}
      {state.status === 'disabled' && (
        <StateBlock
          state="empty"
          title={pick('Điểm này chưa bật ghi lịch sử', 'History logging is off for this point')}
          detail={pick('Bật ghi lịch sử trong cấu hình điểm để có dữ liệu ở đây.', 'Enable logging in the point configuration to collect data here.')}
        />
      )}
      {state.status === 'unsupported' && (
        <StateBlock
          state="empty"
          title={pick('Lịch sử chưa hỗ trợ point Modbus RTU', 'History is not available for Modbus RTU points yet')}
          detail={pick('Dữ liệu hiện thời vẫn được đọc từ Point Catalog; không có mẫu lịch sử nào được suy đoán.', 'The current value still comes from the Point Catalog; no history samples are inferred.')}
        />
      )}
      {state.status === 'error' && (
        <StateBlock state="error" title={pick('Không đọc được lịch sử', 'History unavailable')} detail={state.message} />
      )}
      {state.status === 'ready' && state.rows.length === 0 && (
        <StateBlock state="empty" title={pick('Không có mẫu nào trong 60 phút qua', 'No samples in the last 60 minutes')} />
      )}
      {state.status === 'ready' && state.rows.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid grid-cols-[1fr_88px_78px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
            <span>{pick('Thời gian', 'Time')}</span><span>{pick('Giá trị', 'Value')}</span><span>{pick('Chất lượng', 'Quality')}</span>
          </div>
          {state.rows.map((sample) => (
            <div key={sample.timeMs} className="grid grid-cols-[1fr_88px_78px] border-t border-[var(--c-border)] px-3 py-2 text-xs">
              <span className="mono">{formatDateTime(sample.time)}</span>
              <span className="mono">{formatValue(sample.value, point.unit)}</span>
              <span className="font-semibold" style={{ color: statusColor(sample.quality.toLowerCase() as PointQuality) }}>{sample.quality}</span>
            </div>
          ))}
        </div>
      )}
      {state.status !== 'unsupported' && (
        <Link to={`/trends?points=${encodeURIComponent(point.id)}`} className="mt-3 inline-block text-xs font-semibold text-[var(--c-accent)]">
          {pick('Mở trong Trends', 'Open in Trends')} →
        </Link>
      )}
    </Panel>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  /* F-UX-07 — `sparklineFallback` cố ý trả mảng RỖNG cho point chưa có số đo
     ("Vẽ điểm 0 cho point chưa từng được poll là bịa một số đo", REV-FE-04),
     nhưng chỗ này lại nhận mảng rỗng rồi tự thay bằng `[0, 0]` và vẽ một đường
     nằm ngang ở đáy — đúng thứ mà fallback muốn tránh, chỉ là bịa ở một tầng
     thấp hơn. Không có mẫu thì không vẽ gì. */
  if (values.length === 0) return <span className="mono text-[11px] text-[var(--c-text-dim)]">{NO_DATA}</span>
  const safe = values.length > 1 ? values : [values[0], values[0]]
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  const span = Math.max(1, max - min)
  const points = safe.map((value, index) => `${(index / (safe.length - 1)) * 80},${24 - ((value - min) / span) * 20}`).join(' ')
  return <svg viewBox="0 0 80 28" className="h-7 w-20" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
