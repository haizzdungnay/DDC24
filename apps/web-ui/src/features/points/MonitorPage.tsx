import { Circle, Pencil, Power, RefreshCw, RotateCcw, Save, Search, ShieldAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { POINT_UNIT_OPTIONS, aiUnitFromPointUnit, apiClient, pointUnitFromAiUnit } from '../../shared/api/client'
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
import { useI18n } from '../../shared/i18n'
import { useRealtime } from '../../shared/realtime'
import type { Point, PointKind, PointQuality, VirtualPoint } from '../../shared/types'
import { canonicalVirtualPointId, cn, formatDateTime, formatTime, formatValue, isFreshIso, mergePointsById, pointDisplayTag, pointNumber, statusColor, statusFill } from '../../shared/utils'

const MAX_TREND_POINTS = 18
const REALTIME_STALE_MS = 2500

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
      updatedAt: meta.updatedAt ?? point.updatedAt
    }]
  })
}

function canForcePoint(point: Point): boolean {
  return point.kind === 'DO' || point.kind === 'AO' || (point.kind === 'virtual' && point.writable === true)
}

function defaultForceValue(point: Point): string {
  if (point.kind === 'DO') return String(!point.value)
  if (point.kind === 'virtual') return String(point.value ?? '')
  return String(pointNumber(point))
}

function parseForceValue(point: Point, raw: string): number | boolean | string {
  const value = raw.trim()
  if (point.kind === 'DO' || point.signalType === 'boolean') return value === 'true' || value === '1' || value.toUpperCase() === 'ON'
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
  const [kind, setKind] = useState<PointKind | 'all'>('all')
  const [quality, setQuality] = useState<PointQuality | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [forceOpen, setForceOpen] = useState(false)
  const [forceValue, setForceValue] = useState('1')
  const [forceDurationMinutes, setForceDurationMinutes] = useState('10')
  const [pointModalId, setPointModalId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [editingUnit, setEditingUnit] = useState<string | null>(null)
  const [editingUnitValue, setEditingUnitValue] = useState('')
  const [editingTrend, setEditingTrend] = useState<string | null>(null)
  const [editingTrendEnabled, setEditingTrendEnabled] = useState<Record<string, boolean>>({})
  const forceReleaseTimers = useRef<Record<string, number>>({})

  const polledPoints = pointsState.data ?? []
  const rawPoints = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polledPoints, realtime.allPoints)
    : polledPoints
  const points = useMemo(() => visibleMonitorPoints(rawPoints, virtualState.data ?? []), [rawPoints, virtualState.data])
  const nameConflicts = useMemo(() => pointNameConflicts([
    ...rawPoints.map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...(virtualState.data ?? []).map((point) => ({ id: canonicalVirtualPointId(point.id), name: point.name ?? point.label, kind: 'virtual' }))
  ]), [rawPoints, virtualState.data])
  const selected = points.find((point) => point.id === selectedId) ?? points.find((point) => point.id === 'UI-01') ?? points[0]
  const modalPoint = pointModalId ? points.find((point) => point.id === pointModalId) : null
  const offline = realtime.connectionState !== 'connected'

  const filtered = useMemo(() => points.filter((point) => {
    const matchesKind = kind === 'all' || point.kind === kind
    const matchesQuality = quality === 'all' || point.quality === quality
    const haystack = `${point.id} ${point.tag} ${point.name}`.toLowerCase()
    return matchesKind && matchesQuality && haystack.includes(query.toLowerCase())
  }).sort((a, b) => a.id.localeCompare(b.id)), [kind, points, quality, query])

  const groups = useMemo(() => ({
    UI: filtered.filter((point) => point.kind === 'UI'),
    DO: filtered.filter((point) => point.kind === 'DO'),
    AO: filtered.filter((point) => point.kind === 'AO'),
    Virtual: filtered.filter((point) => point.kind === 'virtual')
  }), [filtered])

  const analogPoints = points.filter((point) => point.kind === 'UI' || point.kind === 'AO' || point.kind === 'virtual')
  const stats = {
    total: points.length,
    ui: points.filter((point) => point.kind === 'UI').length,
    do: points.filter((point) => point.kind === 'DO').length,
    ao: points.filter((point) => point.kind === 'AO').length,
    virtual: points.filter((point) => point.kind === 'virtual').length,
    on: points.filter((point) => Boolean(point.value)).length,
    analogTotal: analogPoints.length,
    analogGood: analogPoints.filter((point) => point.quality === 'good').length,
    abnormal: points.filter((point) => point.quality !== 'good').length
  }

  useEffect(() => () => {
    Object.values(forceReleaseTimers.current).forEach((timerId) => window.clearTimeout(timerId))
    forceReleaseTimers.current = {}
  }, [])

  function openPointModal(point: Point) {
    setSelectedId(point.id)
    setPointModalId(point.id)
  }

  async function savePointBasics(point: Point, config: { tag: string; name: string; unit?: string }) {
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
        name
      })
    }
    toast.push('success', pick(`Updated ${pointDisplayTag(point)}`, `Updated ${pointDisplayTag(point)}`))
    await pointsState.refetch()
  }

  async function forcePointWithDuration(point: Point, value: number | boolean | string, durationSeconds: number) {
    if (!canForcePoint(point)) return
    if (!canForce) {
      denyForce()
      return
    }
    if (forceReleaseTimers.current[point.id]) {
      window.clearTimeout(forceReleaseTimers.current[point.id])
      delete forceReleaseTimers.current[point.id]
    }
    if (point.kind === 'virtual') {
      await apiClient.forcePoint(point.id, value)
      toast.push('success', pick(`Wrote ${pointDisplayTag(point)}`, `Wrote ${pointDisplayTag(point)}`))
      await pointsState.refetch()
      return
    }
    if (realtime.forcePoint(point.id, value as number | boolean, durationSeconds)) {
      toast.push('success', pick(`Force sent to ${pointDisplayTag(point)}`, `Force sent to ${pointDisplayTag(point)}`))
      window.setTimeout(() => void pointsState.refetch(), 250)
      window.setTimeout(() => void pointsState.refetch(), 1000)
      return
    }
    await apiClient.forcePoint(point.id, value)
    forceReleaseTimers.current[point.id] = window.setTimeout(() => {
      void apiClient.forcePoint(point.id, value, true)
        .then(() => pointsState.refetch())
        .finally(() => {
          delete forceReleaseTimers.current[point.id]
        })
    }, durationSeconds * 1000)
    toast.push('success', pick(`Force sent to ${pointDisplayTag(point)}`, `Force sent to ${pointDisplayTag(point)}`))
    await pointsState.refetch()
  }

  async function releasePoint(point: Point) {
    if (!canForcePoint(point)) return
    if (!canForce) {
      denyForce()
      return
    }
    if (forceReleaseTimers.current[point.id]) {
      window.clearTimeout(forceReleaseTimers.current[point.id])
      delete forceReleaseTimers.current[point.id]
    }
    await apiClient.forcePoint(point.id, point.value as number | boolean, true)
    toast.push('success', pick(`Released ${pointDisplayTag(point)}`, `Released ${pointDisplayTag(point)}`))
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
    const enabled = editingTrendEnabled[point.id] ?? true
    try {
      await apiClient.updatePointConfig(point.id, { trendEnabled: enabled })
      toast.push('success', pick(`Đã cập nhật trend ${point.id}`, `Updated trend for ${point.id}`))
      setEditingTrend(null)
      pointsState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Update failed')
    }
  }

  function cancelEditTrend() {
    setEditingTrend(null)
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
  if (pointsState.loading && !pointsState.data && !realtime.allPoints.length) {
    return <StateBlock state="loading" title={pick('Đang tải điểm I/O', 'Loading I/O points')} />
  }
  if (pointsState.error && !pointsState.data && !realtime.allPoints.length) {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được điểm I/O', 'Could not load I/O points')}
        detail={pointsState.error.message}
        onRetry={pointsState.refetch}
      />
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
      <div>
        <h1 className="text-xl font-semibold leading-tight">Monitor I/O</h1>
        <p className="text-xs text-[var(--c-text-dim)]">{pick('Giám sát trạng thái điểm I/O', 'Monitor I/O point states')}</p>
      </div>

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
        <StatCard label={pick('Điểm ON', 'ON points')} value={stats.on} detail={`${Math.round((stats.on / Math.max(1, stats.total)) * 100)}%`} />
        {/* `detail` từng gán cứng "100%" nên thẻ này luôn khẳng định mọi điểm
            analog bình thường, kể cả khi không đọc được điểm nào. */}
        <StatCard label={pick('Điểm UI/AO bình thường', 'Normal UI/AO points')} value={stats.analogGood} detail={stats.analogTotal ? `${Math.round((stats.analogGood / stats.analogTotal) * 100)}%` : '—'} />
        <StatCard label={pick('Điểm lỗi / mất tín hiệu', 'Fault / signal-loss points')} value={stats.abnormal} detail={stats.total ? `${Math.round((stats.abnormal / stats.total) * 100)}%` : '—'} danger />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_1fr_132px]">
        <select value={kind} onChange={(event) => setKind(event.target.value as PointKind | 'all')} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Nhóm I/O - Tất cả', 'I/O group - All')}</option><option value="UI">UI</option><option value="DO">DO</option><option value="AO">AO</option><option value="virtual">{pick('Ảo', 'Virtual')}</option>
        </select>
        <select value={quality} onChange={(event) => setQuality(event.target.value as PointQuality | 'all')} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Trạng thái - Tất cả', 'Status - All')}</option><option value="good">Good</option><option value="uncertain">Uncertain</option><option value="bad">Bad</option><option value="stale">Stale</option>
        </select>
        <label className="flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder={pick('Tìm kiếm điểm...', 'Search points...')} />
          <Search className="h-4 w-4 text-[var(--c-text-dim)]" />
        </label>
        <Button icon={<RefreshCw className="h-4 w-4" />} onClick={pointsState.refetch}>{pick('Làm mới', 'Refresh')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_334px]">
        <div className={cn('space-y-3', offline && 'stale')}>
          <DigitalSection title="DO - DIGITAL OUTPUT" rows={groups.DO} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} onToggle={requestForce} />
          <AnalogSection title="UI - UNIVERSAL INPUT" rows={groups.UI} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} />
          <AnalogSection title="AO - ANALOG OUTPUT" rows={groups.AO} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} onForce={requestForce} />
          <AnalogSection title="VIRTUAL POINTS" rows={groups.Virtual} selectedId={selected?.id} conflicts={nameConflicts} onSelect={setSelectedId} onOpenDetails={openPointModal} onForce={requestForce} />
        </div>
        {selected && <DetailPanel
          point={selected}
          note={note}
          setNote={setNote}
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
          onCancelEditTrend={cancelEditTrend}
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

      <Modal open={forceOpen} title={`${selected?.kind === 'virtual' ? 'Write' : 'Force'} ${selected?.id ?? ''}`} danger={selected?.kind !== 'virtual'} confirmLabel={selected?.kind === 'virtual' ? 'Write' : pick('Force output', 'Force output')} onConfirm={confirmForce} onClose={() => setForceOpen(false)}>
        <div className="space-y-4">
          <div className="flex gap-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-[var(--c-warn-fg)]">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            {pick('Force uses the duration below. Use only for commissioning or controlled troubleshooting.', 'Force uses the duration below. Use only for commissioning or controlled troubleshooting.')}
          </div>
          <label className="block text-sm">{pick('Giá trị Force', 'Force value')}<input value={forceValue} onChange={(event) => setForceValue(event.target.value)} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" /></label>
          {selected?.kind !== 'virtual' && <label className="block text-sm">{pick('Force duration (minutes)', 'Force duration (minutes)')}<input type="number" min="1" step="1" value={forceDurationMinutes} onChange={(event) => setForceDurationMinutes(event.target.value)} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" /></label>}
        </div>
      </Modal>
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

function DigitalSection({ title, rows, selectedId, conflicts, onSelect, onOpenDetails, onToggle }: { title: string; rows: Point[]; selectedId?: string; conflicts: Map<string, string[]>; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onToggle: (point: Point) => void }) {
  const { pick } = useI18n()
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="grid grid-cols-[70px_minmax(150px,1fr)_112px_128px_58px] border-b border-[var(--c-border)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>{pick('Điểm', 'Point')}</span><span>{pick('Tên điểm', 'Point name')}</span><span>{pick('Trạng thái', 'Status')}</span><span>{pick('Thời gian cập nhật', 'Updated at')}</span><span />
      </div>
      {rows.map((point) => <DigitalRow key={point.id} point={point} conflictIds={conflicts.get(point.id)} selected={point.id === selectedId} onSelect={onSelect} onOpenDetails={onOpenDetails} onToggle={onToggle} />)}
    </SectionFrame>
  )
}

function DigitalRow({ point, conflictIds, selected, onSelect, onOpenDetails, onToggle }: { point: Point; conflictIds?: string[]; selected: boolean; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onToggle: (point: Point) => void }) {
  const active = Boolean(point.value)
  const state = active ? 'on' : 'off'
  const stateFillColor = statusFill(state)
  const stateTextColor = statusColor(state)
  return (
    <button type="button" onClick={() => onSelect(point.id)} onDoubleClick={() => onOpenDetails(point)} className={cn('grid w-full grid-cols-[70px_minmax(150px,1fr)_112px_128px_58px] items-center border-b border-[var(--c-border)] px-3 py-2 text-left text-xs transition last:border-0 hover:bg-[var(--c-accent-bg)]', selected && 'bg-[var(--c-accent-bg)]')}>
      <span className="mono font-semibold">{pointDisplayTag(point)}</span>
      <span className="truncate font-semibold">{point.name}{conflictIds?.length ? ' ⚠' : ''}</span>
      <span className="inline-flex items-center gap-2 font-semibold" style={{ color: stateTextColor }}><Circle className="h-2.5 w-2.5 fill-current" style={{ color: stateFillColor }} />{active ? 'ON' : 'OFF'}</span>
      <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
      <span onClick={(event) => { event.stopPropagation(); onToggle(point) }} className={cn('ml-auto flex h-5 w-9 items-center rounded-full border px-0.5 transition', active ? 'justify-end border-[var(--c-good)] bg-[var(--c-good-bg)]' : 'justify-start border-[var(--c-border)] bg-[var(--c-surface-2)]')} role="switch" aria-checked={active} tabIndex={0}>
        <span className={cn('h-3.5 w-3.5 rounded-full', active ? 'bg-[var(--c-good)]' : 'bg-[var(--c-off)]')} />
      </span>
    </button>
  )
}

function AnalogSection({ title, rows, selectedId, conflicts, onSelect, onOpenDetails, onForce }: { title: string; rows: Point[]; selectedId?: string; conflicts: Map<string, string[]>; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onForce?: (point: Point) => void }) {
  const { pick } = useI18n()
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="grid grid-cols-[70px_minmax(150px,1fr)_70px_60px_120px_90px_84px] border-b border-[var(--c-border)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>{pick('Điểm', 'Point')}</span><span>{pick('Tên điểm', 'Point name')}</span><span>{pick('Giá trị', 'Value')}</span><span>{pick('Đơn vị', 'Unit')}</span><span>{pick('Trạng thái', 'Status')}</span><span>Trend</span><span>{pick('Cập nhật', 'Updated')}</span>
      </div>
      {rows.map((point) => <AnalogRow key={point.id} point={point} conflictIds={conflicts.get(point.id)} selected={point.id === selectedId} onSelect={onSelect} onOpenDetails={onOpenDetails} onForce={onForce} />)}
    </SectionFrame>
  )
}

/** Sparkline khi chưa có buffer: một điểm nếu đã đo được, rỗng nếu chưa.
 *  Vẽ điểm 0 cho point chưa từng được poll là bịa một số đo (REV-FE-04). */
function sparklineFallback(point: Point): number[] {
  const value = pointNumber(point)
  return value === null ? [] : [value]
}

function AnalogRow({ point, conflictIds, selected, onSelect, onOpenDetails, onForce }: { point: Point; conflictIds?: string[]; selected: boolean; onSelect: (id: string) => void; onOpenDetails: (point: Point) => void; onForce?: (point: Point) => void }) {
  const { pick } = useI18n()
  const trendBuffer = useTrendBuffer(point.id, point.value, point.trend)
  const statusText = point.quality === 'good' ? pick('Bình thường', 'Normal') : point.quality === 'uncertain' ? pick('Lỗi - HIGH', 'Fault - HIGH') : point.quality.toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(point.id)} onDoubleClick={() => onOpenDetails(point)} className={cn('grid w-full grid-cols-[70px_minmax(150px,1fr)_70px_60px_120px_90px_84px] items-center border-b border-[var(--c-border)] px-3 py-2 text-left text-xs transition last:border-0 hover:bg-[var(--c-accent-bg)]', selected && 'bg-[var(--c-accent-bg)]')}>
      <span className="mono font-semibold">{pointDisplayTag(point)}</span>
      <span className="truncate font-semibold">{point.name}{conflictIds?.length ? ' ⚠' : ''}</span>
      <span className="mono">{typeof point.value === 'number' ? point.value.toFixed(1) : formatValue(point.value, point.unit)}</span>
      <span className="mono text-[var(--c-text-dim)]">{point.unit ?? (point.kind === 'AO' ? 'V' : '-')}</span>
      <span className="inline-flex items-center gap-2"><Circle className="h-2.5 w-2.5 fill-current" style={{ color: statusFill(point.quality) }} />{statusText}</span>
      <span onClick={(event) => { if (onForce) { event.stopPropagation(); onForce(point) } }}><Sparkline values={trendBuffer.length > 0 ? trendBuffer : sparklineFallback(point)} color={point.quality === 'good' ? 'var(--c-accent-2)' : point.quality === 'bad' ? 'var(--c-fault-fg)' : 'var(--c-warn-fg)'} /></span>
      <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
    </button>
  )
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
  onSave: (point: Point, config: { tag: string; name: string; unit?: string }) => Promise<void>
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
      await onSave(point, { tag: nextTag, name: nextName, unit: nextUnit })
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
            </div>
            <Button size="sm" variant="primary" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} onClick={handleSave}>{pick('Save basics', 'Save basics')}</Button>
            <PointNameConflictNotice pointId={point.id} conflictIds={conflictIds} />
          </div>

          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
            <div className="mono text-3xl font-bold text-[var(--c-accent)]" style={point.kind === 'DO' ? { color: binaryTextColor } : undefined}>
              {formatValue(point.value, point.unit)}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <StatusBadge state={point.forced ? 'force' : point.quality} />
              <span className="mono text-xs text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
            </div>
          </div>
        </div>

        <dl className="grid gap-2 md:grid-cols-2">
          {point.kind !== 'virtual' && <PointInfo label="Point ID" value={point.id} />}
          <PointInfo label="Tag" value={point.tag} />
          <PointInfo label="I/O group" value={groupText} />
          <PointInfo label="Signal type" value={point.sensorType ?? '-'} />
          <PointInfo label="Current value" value={formatValue(point.value, point.unit)} />
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
                {point.kind === 'DO' ? (
                  <select value={forceValue} onChange={(event) => setForceValue(event.target.value)} className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]">
                    <option value="true">ON</option>
                    <option value="false">OFF</option>
                  </select>
                ) : (
                  <input type={point.kind === 'virtual' && (point.signalType === 'string' || point.signalType === 'datetime') ? 'text' : 'number'} value={forceValue} onChange={(event) => setForceValue(event.target.value)} className="mono h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]" />
                )}
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
  note,
  setNote,
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
  note: string
  setNote: (value: string) => void
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
  const history = [0, 1, 2, 3, 4].map((index) => ({ time: new Date(Date.now() - index * 7 * 60_000).toISOString(), value: index % 2 === 0 ? active : !active }))
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
            <div className="mono text-2xl font-bold text-[var(--c-accent)]" style={isBinary ? { color: binaryTextColor } : undefined}>{formatValue(point.value, point.unit)}</div>
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
          <dl className="grid grid-cols-[118px_1fr] gap-y-3 text-xs">
            <dt className="text-[var(--c-text-dim)]">{pick('Nhóm I/O', 'I/O group')}</dt><dd>{groupText}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Kiểu tín hiệu', 'Signal type')}</dt><dd>{point.sensorType ?? 'Dry Contact'}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái hiện tại', 'Current status')}</dt><dd className="font-semibold" style={isBinary ? { color: binaryTextColor } : undefined}>{active ? pick('ON (Kích hoạt)', 'ON (Active)') : 'OFF'}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái logic', 'Logic state')}</dt><dd>{active ? 1 : 0}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Thời gian thay đổi', 'Changed at')}</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Thời gian cập nhật', 'Updated at')}</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Bộ đếm kích hoạt', 'Activation count')}</dt><dd>15</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Mô tả', 'Description')}</dt><dd>{point.id === 'UI-05' ? pick('Ngõ vào universal dạng tiếp điểm', 'Universal input dry contact') : point.name}</dd>
            {isAnalog && (
              <div className="col-span-2 flex items-center justify-between rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2">
                <span className="text-xs text-[var(--c-text-dim)]">{pick('Hiển thị trend', 'Show trend')}</span>
                {isEditingTrend ? (
                  <div className="flex items-center gap-1">
                    <button onClick={onSaveEditTrend} className="text-xs font-semibold text-[var(--c-good-fg)]">{pick('Lưu', 'Save')}</button>
                    <button onClick={onCancelEditTrend} className="text-xs font-semibold text-[var(--c-text-dim)]">{pick('Hủy', 'Cancel')}</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className={cn('flex h-5 w-9 items-center rounded-full border px-0.5 transition cursor-pointer', trendEnabled ? 'justify-end border-[var(--c-good)] bg-[var(--c-good-bg)]' : 'justify-start border-[var(--c-border)] bg-[var(--c-surface)]')}
                      onClick={() => onToggleTrend(point.id)}
                      role="switch"
                      aria-checked={trendEnabled}
                    >
                      <span className={cn('h-3.5 w-3.5 rounded-full', trendEnabled ? 'bg-[var(--c-good)]' : 'bg-[var(--c-off)]')} />
                    </span>
                    <button onClick={onStartEditTrend} className="text-[var(--c-accent)] hover:text-[var(--c-accent-2)]" title={pick('Cài đặt trend', 'Trend settings')}>
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </dl>
          <StatusBadge state={point.forced ? 'force' : point.quality} />
          {canForce && <Button className="w-full" variant={point.kind === 'virtual' ? 'primary' : 'danger'} onClick={onForce}>{point.kind === 'virtual' ? 'Write value' : 'Force output'}</Button>}
        </div>
      </Panel>

      <Panel title={pick('Lịch sử trạng thái', 'Status history')}>
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid grid-cols-[1fr_86px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]"><span>{pick('Thời gian', 'Time')}</span><span>{pick('Trạng thái', 'Status')}</span></div>
          {history.map((item) => {
            const itemState = item.value ? 'on' : 'off'
            return <div key={item.time} className="grid grid-cols-[1fr_86px] border-t border-[var(--c-border)] px-3 py-2 text-xs"><span className="mono">{formatDateTime(item.time)}</span><span className="font-semibold" style={{ color: statusColor(itemState) }}>{item.value ? 'ON' : 'OFF'} ●</span></div>
          })}
        </div>
        <button className="mt-3 text-xs font-semibold text-[var(--c-accent)]">{pick('Xem thêm lịch sử', 'View more history')} →</button>
      </Panel>

      <Panel title={pick('Ghi chú', 'Notes')}>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={pick('Nhập ghi chú...', 'Enter notes...')} className="min-h-[84px] w-full resize-none rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm outline-none" />
        <Button className="mt-3 w-full" variant="primary" icon={<Save className="h-4 w-4" />}>{pick('Lưu ghi chú', 'Save note')}</Button>
      </Panel>
    </div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const safe = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0]
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  const span = Math.max(1, max - min)
  const points = safe.map((value, index) => `${(index / (safe.length - 1)) * 80},${24 - ((value - min) / span) * 20}`).join(' ')
  return <svg viewBox="0 0 80 28" className="h-7 w-20" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
