import {
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  Cpu,
  Database,
  ListFilter,
  Maximize2,
  MemoryStick,
  Network,
  Router,
  Thermometer,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { can, permissions } from '../auth/permissions'
import { Button } from '../components/Button'
import { ControllerDiagram } from '../components/ControllerDiagram'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { TrendChart, type TrendSeries } from '../components/TrendChart'
import { DEVICE_DEFAULTS } from '../config'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'
import type { Alarm, HealthResponse, HealthStatus, Point, TrendSample } from '../types'
import { formatDateTime, formatUptime, isFreshIso, mergePointsById, metricStatusColor, metricStatusFill, pointDisplayTag, statusColor } from '../utils'

const dashboardTrendColors = ['var(--c-fault-fg)', 'var(--c-accent-2)', '#6E5A2E', 'var(--c-warn-fg)']
const dashboardTrendSampleLimit = 60
const dashboardTrendPrefsKey = 'mkddc:dashboard-trend-points:v1'
const defaultDashboardTrendIds = ['UI-01', 'UI-02', 'UI-03', 'UI-04']
const REALTIME_STALE_MS = 2500
const emptyPoints: Point[] = []

function readDashboardTrendIds(): string[] | null {
  try {
    const raw = window.localStorage.getItem(dashboardTrendPrefsKey)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string'))).slice(0, 4)
  } catch {
    return null
  }
}

function writeDashboardTrendIds(ids: string[]) {
  try {
    window.localStorage.setItem(dashboardTrendPrefsKey, JSON.stringify(ids))
  } catch {
    // localStorage can be unavailable in private or locked browser modes.
  }
}

export function DashboardPage() {
  const { session } = useAuth()
  const canManageSettings = can(session?.role, permissions.settingsManage)
  const navigate = useNavigate()
  const health = useApi(apiClient.getHealth, [], { refreshMs: 1000 })
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const alarms = useApi(apiClient.getAlarms, [], { refreshMs: 1000 })
  const realtime = useRealtime()
  const { pick } = useI18n()
  const polledPoints = pointsState.data ?? emptyPoints
  const points: Point[] = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polledPoints, realtime.allPoints)
    : polledPoints
  const trendCandidates = useMemo(() => points
    .filter((point) => pointNumber(point.value) !== null)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })), [points])
  const storedTrendIdsRef = useRef<string[] | null | undefined>(undefined)
  if (storedTrendIdsRef.current === undefined) storedTrendIdsRef.current = readDashboardTrendIds()
  const [selectedTrendIds, setSelectedTrendIds] = useState<string[]>(() => storedTrendIdsRef.current ?? [])
  const [trendSelectionReady, setTrendSelectionReady] = useState(false)
  const [trendPickerOpen, setTrendPickerOpen] = useState(false)
  const initializedTrendSelectionRef = useRef(false)
  const trendPoints = useMemo(() => selectedTrendIds
    .map((id) => trendCandidates.find((point) => point.id === id))
    .filter((point): point is Point => Boolean(point)), [selectedTrendIds, trendCandidates])
  const trendSeries = useMemo<TrendSeries[]>(() => trendPoints.map((point, index) => ({
    key: point.id,
    label: point.kind === 'virtual' ? pointDisplayTag(point) : `${point.id} - ${point.name}`,
    color: dashboardTrendColors[index % dashboardTrendColors.length],
    unit: point.unit
  })), [trendPoints])
  const trendPointsRef = useRef<Point[]>([])
  const [trendSamples, setTrendSamples] = useState<TrendSample[]>([])

  useEffect(() => {
    if (!trendCandidates.length) return
    const availableIds = new Set(trendCandidates.map((point) => point.id))
    setSelectedTrendIds((current) => {
      if (!initializedTrendSelectionRef.current) {
        initializedTrendSelectionRef.current = true
        const storedIds = storedTrendIdsRef.current
        if (storedIds !== null && storedIds !== undefined) return storedIds.filter((id) => availableIds.has(id)).slice(0, 4)
        const preferred = defaultDashboardTrendIds
          .map((id) => trendCandidates.find((point) => point.id === id))
          .filter((point): point is Point => Boolean(point))
        const defaults = [...preferred, ...trendCandidates.filter((point) => !preferred.some((item) => item.id === point.id))].slice(0, 4)
        return defaults.map((point) => point.id)
      }
      const retained = current.filter((id) => availableIds.has(id)).slice(0, 4)
      return retained.length === current.length && retained.every((id, index) => id === current[index]) ? current : retained
    })
    setTrendSelectionReady(true)
  }, [trendCandidates])

  useEffect(() => {
    if (trendSelectionReady) writeDashboardTrendIds(selectedTrendIds)
  }, [selectedTrendIds, trendSelectionReady])

  useEffect(() => {
    trendPointsRef.current = trendPoints
    if (!trendPoints.length) setTrendSamples((current) => current.length ? [] : current)
  }, [trendPoints])

  useEffect(() => {
    setTrendSamples([])
  }, [selectedTrendIds])

  useEffect(() => {
    const appendSample = () => {
      const sample = makeTrendSample(trendPointsRef.current)
      if (!sample) return
      setTrendSamples((current) => [...current, sample].slice(-dashboardTrendSampleLimit))
    }

    appendSample()
    const timerId = window.setInterval(appendSample, 1000)
    return () => window.clearInterval(timerId)
  }, [])

  if (pointsState.loading && !points.length) return <StateBlock state="loading" title={pick('Đang tải dashboard', 'Loading dashboard')} />
  if (pointsState.error && !points.length) return <StateBlock state="error" title={pick('Không tải được điểm I/O', 'Could not load I/O points')} detail={pointsState.error.message} onRetry={pointsState.refetch} />

  const h = health.data
  const alarmRows = alarms.data ?? []
  const critical = alarmRows.filter((alarm) => alarm.severity === 'critical').length
  const warning = alarmRows.filter((alarm) => alarm.severity === 'high' || alarm.severity === 'medium' || alarm.severity === 'low').length
  const alarmCount = alarmRows.length
  const dataAgeLabel = realtime.lastPointEventAt ? new Date(realtime.lastPointEventAt).toLocaleTimeString('vi-VN') : 'API'
  const cpuPercent = h?.cpuPercent ?? 23
  const cpuDetail = [formatPercent(cpuPercent), formatCpuClock(h?.cpuClockMhz)].filter(Boolean).join(' | ')

  function toggleTrendPoint(id: string) {
    setSelectedTrendIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 4 ? [...current, id] : current)
  }

  const ramDetail = (() => {
    if (typeof h?.ramUsedMb === 'number' && typeof h?.ramTotalMb === 'number' && h.ramTotalMb > 0) {
      return `${Math.round(h.ramUsedMb)} MB / ${Math.round(h.ramTotalMb)} MB`
    }
    if (typeof h?.ramUsedMb === 'number') return `${Math.round(h.ramUsedMb)} MB`
    if (typeof h?.ramTotalMb === 'number') return `/ ${Math.round(h.ramTotalMb)} MB`
    return ''
  })()

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-4">
        <h1 className="text-2xl font-semibold leading-none">{pick('Bảng điều khiển', 'Dashboard')}</h1>
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Tổng quan hệ thống', 'System overview')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <DeviceStatusCard />
        <AlarmStatusCard count={alarmCount} critical={critical} warning={warning} />
        <DialStatusCard icon={Cpu} label="CPU LOAD" value={cpuPercent} detail={cpuDetail} />
        <DialStatusCard icon={MemoryStick} label={pick('BỘ NHỚ', 'MEMORY')} value={h?.ramPercent ?? 48} detail={ramDetail} />
        <TempStatusCard value={h?.tempC} />
        <UptimeStatusCard value={h?.uptimeS ?? 12 * 86400 + 4 * 3600 + 32 * 60 + 18} />
      </div>

      <Panel title={pick('TRẠNG THÁI TRUYỀN THÔNG', 'COMMUNICATION STATUS')} className="p-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
          <CommTile icon={Network} title="Ethernet" value={h?.deviceIp} status={h?.deviceIp ? 'ok' : 'unknown'} />
          <CommTile icon={Router} title="RS485-1" value={scanValue(h?.services.iobus)} status={h?.services.iobus?.status ?? 'unknown'} />
          <CommTile icon={Router} title="RS485-2" status="unknown" />
          <CommTile icon={Network} title="Modbus TCP" status="unknown" />
          <CommTile icon={Network} title="Modbus RTU" value={scanValue(h?.services.iobus)} status={h?.services.iobus?.status ?? 'unknown'} />
          <CommTile icon={Database} title="BACnet/IP" value={h?.bacnetDeviceId} status={h?.bacnetDeviceId ? 'ok' : 'unknown'} />
        </div>
      </Panel>

      <SystemHealthSummary health={h ?? undefined} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.9fr]">
        <Panel
          title={pick('Controller Diagram', 'Controller Diagram')}
          className="p-3"
          action={<Button size="sm" variant="secondary" onClick={() => navigate('/eng/diagram')}>{pick('Open', 'Open')}</Button>}
        >
          <ControllerDiagram
            points={points}
            health={h ?? undefined}
            dataAgeLabel={dataAgeLabel}
            compact
            onOpenNetwork={canManageSettings ? () => navigate('/settings/network') : undefined}
          />
        </Panel>
        <Panel className="p-3" title={pick('XU HƯỚNG POINT', 'POINT TREND')} action={<div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" icon={<ListFilter className="h-4 w-4" />} onClick={() => setTrendPickerOpen(true)}>{pick('Điểm', 'Points')} {selectedTrendIds.length}/4</Button><Button size="sm" variant="secondary">{pick('Live', 'Live')}</Button><Button size="sm" variant="ghost" icon={<Maximize2 className="h-4 w-4" />} onClick={() => navigate('/trends')} title={pick('Mở rộng xu hướng', 'Expand trends')} /></div>}>
          {trendSamples.length > 1 && trendSeries.length
            ? <TrendChart data={trendSamples} series={trendSeries} height={320} showTable={false} />
            : <StateBlock state="empty" title={pick('Chưa có dữ liệu point trend live', 'No live point trend data')} detail={pick('Biểu đồ sẽ tự chạy khi /points hoặc WebSocket có giá trị point.', 'Chart starts when /points or WebSocket provides point values.')} />}
        </Panel>
      </div>

      <Modal open={trendPickerOpen} title={pick('Chọn điểm hiển thị', 'Select displayed points')} cancelLabel={pick('Xong', 'Done')} onClose={() => setTrendPickerOpen(false)}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p>{pick('Chọn tối đa 4 point analog hoặc digital cho biểu đồ live.', 'Choose up to 4 analog or digital points for the live chart.')}</p>
          <span className="shrink-0 font-semibold text-[var(--c-text)]" aria-live="polite">{selectedTrendIds.length}/4</span>
        </div>
        <div className="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {trendCandidates.map((point) => {
            const selected = selectedTrendIds.includes(point.id)
            return (
              <label key={point.id} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-[var(--c-text)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                <input type="checkbox" checked={selected} disabled={!selected && selectedTrendIds.length >= 4} onChange={() => toggleTrendPoint(point.id)} />
                <span className="min-w-0 flex-1"><span className="block font-semibold">{point.id}</span><span className="block truncate text-xs text-[var(--c-text-dim)]">{point.name}</span></span>
                <span className="text-xs text-[var(--c-text-dim)]">{point.unit ?? '-'}</span>
              </label>
            )
          })}
        </div>
      </Modal>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title={pick('SỰ KIỆN GẦN NHẤT', 'RECENT EVENTS')}>
          <RecentEvents rows={alarmRows} />
          <div className="mt-4 text-center">
            <Link to="/alarms" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--c-accent)]">{pick('Xem tất cả sự kiện', 'View all events')} <ChevronRight className="h-4 w-4" /></Link>
          </div>
        </Panel>
        <Panel title={pick('THÔNG TIN THIẾT BỊ', 'DEVICE INFORMATION')}>
          <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
            <dt className="text-[var(--c-text-dim)]">{pick('Tên thiết bị', 'Device name')}</dt><dd>{h?.deviceName ?? DEVICE_DEFAULTS.name}</dd>
            <dt className="text-[var(--c-text-dim)]">Model</dt><dd>DDC24-AC</dd>
            <dt className="text-[var(--c-text-dim)]">Firmware</dt><dd>{h?.firmware ?? DEVICE_DEFAULTS.firmware} (Build 20250515)</dd>
            <dt className="text-[var(--c-text-dim)]">Serial</dt><dd className="mono">{DEVICE_DEFAULTS.serial}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Địa chỉ IP', 'IP address')}</dt><dd className="mono">{h?.deviceIp ?? DEVICE_DEFAULTS.ip}</dd>
            <dt className="text-[var(--c-text-dim)]">MAC Address</dt><dd className="mono">00:0D:18:24:AC:01</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Thời gian hệ thống', 'System time')}</dt><dd>23/05/2025 14:32:18</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Vị trí lắp đặt', 'Installation location')}</dt><dd>{pick('Tủ ĐK trung tâm - Tầng 1', 'Central control cabinet - Floor 1')}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Mô tả', 'Description')}</dt><dd>DDC 24 điểm - HVAC System</dd>
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[126px] rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">{children}</div>
}

function pointNumber(value: Point['value']) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return null
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(2))}%`
}

function formatCpuClock(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  return value >= 1000 ? `${Number((value / 1000).toFixed(2))} GHz` : `${Math.round(value)} MHz`
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

function DeviceStatusCard() {
  const { pick } = useI18n()
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>{pick('TRẠNG THÁI THIẾT BỊ', 'DEVICE STATUS')}</span><ChevronRight className="h-4 w-4 text-[var(--c-accent)]" /></div>
      <div className="mt-6 flex items-center gap-5">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-[var(--c-surface-2)]"><div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--c-good)]"><Check className="h-8 w-8 text-[var(--c-bg)]" /></div></div>
        <div><div className="text-xl font-bold text-[var(--c-good-fg)]">ONLINE</div><div className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Thiết bị hoạt động\nbình thường', 'Device operating\nnormally').split('\n').map((line) => <span key={line}>{line}<br /></span>)}</div></div>
      </div>
    </StatusCard>
  )
}

function AlarmStatusCard({ count, critical, warning }: { count: number; critical: number; warning: number }) {
  const { pick } = useI18n()
  return (
    <StatusCard>
      <div className="text-[11px] font-semibold uppercase text-[var(--c-fault-fg)]">{pick('CẢNH BÁO', 'ALARMS')}</div>
      <div className="mt-5 flex items-center gap-4"><BellRing className="h-8 w-8 text-[var(--c-fault-fg)]" /><span className="mono text-3xl font-bold text-[var(--c-fault-fg)]">{count}</span></div>
      <div className="mt-3 text-xs text-[var(--c-text-dim)]">{pick('Tổng cảnh báo', 'Total alarms')}</div>
      <div className="mt-3 flex gap-3 text-xs"><span className="font-semibold text-[var(--c-fault-fg)]">{critical} Critical</span><span className="font-semibold text-[var(--c-warn-fg)]">{warning} Warning</span></div>
    </StatusCard>
  )
}

function DialStatusCard({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: number; detail: string }) {
  const { pick } = useI18n()
  const color = metricStatusColor(value, 70, 90)
  const fillColor = metricStatusFill(value, 70, 90)
  const stateLabel = value >= 90 ? pick('Cao', 'High') : value >= 70 ? pick('Cảnh báo', 'Warning') : pick('Bình thường', 'Normal')
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>{label}</span><Icon className="h-4 w-4" style={{ color }} /></div>
      <div className="mt-4 grid place-items-center"><MiniDial value={value} fillColor={fillColor} textColor={color} /></div>
      <div className="mt-3 text-center text-xs font-semibold" style={{ color }}>{stateLabel}</div>
      {detail && <div className="mono mt-2 text-center text-xs text-[var(--c-text-dim)]">{detail}</div>}
    </StatusCard>
  )
}

function TempStatusCard({ value }: { value?: number }) {
  const { pick } = useI18n()
  const numericValue = typeof value === 'number' ? value : null
  const color = numericValue === null ? 'var(--c-text-dim)' : metricStatusColor(numericValue, 50, 65)
  const stateLabel = numericValue === null
    ? pick('Không có dữ liệu', 'No data')
    : numericValue >= 65 ? pick('Cao', 'High') : numericValue >= 50 ? pick('Cảnh báo', 'Warning') : pick('Bình thường', 'Normal')
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>{pick('NHIỆT ĐỘ', 'TEMPERATURE')}</span><Thermometer className="h-4 w-4" style={{ color }} /></div>
      <div className="mt-6 flex items-center gap-3"><Thermometer className="h-9 w-9" style={{ color }} /><div className="mono text-3xl font-bold" style={{ color }}>{numericValue === null ? 'N/A' : <>{numericValue.toFixed(1)}&deg;C</>}</div></div>
      <div className="mt-4 text-xs font-semibold" style={{ color }}>{stateLabel}</div>
    </StatusCard>
  )
}

function UptimeStatusCard({ value }: { value: number }) {
  const { pick } = useI18n()
  const color = value > 0 ? 'var(--c-good-fg)' : 'var(--c-warn-fg)'
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>UPTIME</span><Clock3 className="h-4 w-4" style={{ color }} /></div>
      <div className="mt-6 flex items-center gap-3"><Clock3 className="h-10 w-10" style={{ color }} /><div className="mono text-lg font-bold" style={{ color }}>{formatUptime(value)}</div></div>
      <div className="mt-4 text-xs font-semibold" style={{ color }}>{pick('Hoạt động liên tục', 'Continuous operation')}</div>
    </StatusCard>
  )
}

function MiniDial({ value, fillColor, textColor }: { value: number; fillColor: string; textColor: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: `conic-gradient(${fillColor} ${pct * 3.6}deg, rgba(74,79,85,0.16) 0deg)` }}><div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--c-surface)]"><span className="mono text-xl font-bold" style={{ color: textColor }}>{Math.round(value)}%</span></div></div>
}

function CommTile({ icon: Icon, title, value, status = 'unknown' }: { icon: React.ComponentType<{ className?: string }>; title: string; value?: string; status?: HealthStatus }) {
  const normalized = normalizeCommStatus(status)
  const statusText = normalized === 'ok' ? 'ONLINE' : normalized === 'degraded' ? 'DEGRADED' : normalized === 'fault' ? 'FAULT' : 'N/A'
  const statusClass = normalized === 'ok'
    ? 'text-[var(--c-good-fg)]'
    : normalized === 'degraded'
      ? 'text-[var(--c-warn-fg)]'
      : normalized === 'fault'
        ? 'text-[var(--c-fault-fg)]'
        : 'text-[var(--c-text-dim)]'
  const dotClass = normalized === 'ok'
    ? 'bg-[var(--c-indicator-ok)]'
    : normalized === 'degraded'
      ? 'bg-[var(--c-warn-fg)]'
      : normalized === 'fault'
        ? 'bg-[var(--c-fault-fg)]'
        : 'bg-[var(--c-indicator-off)]'
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <div className="flex items-center gap-3"><Icon className="h-6 w-6 text-[var(--c-accent-2)]" /><div><div className="text-sm font-semibold">{title}</div><div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{value || 'N/A'}</div></div></div>
      <div className={`mt-3 flex items-center gap-2 text-xs font-semibold ${statusClass}`}><span className={`h-2 w-2 rounded-full ${dotClass}`} />{statusText}</div>
    </div>
  )
}

function normalizeCommStatus(status?: HealthStatus): HealthStatus {
  if (status === 'ok' || status === 'degraded' || status === 'fault') return status
  return 'unknown'
}

function scanValue(service?: { last_scan_ms?: number }) {
  return typeof service?.last_scan_ms === 'number' && service.last_scan_ms > 0 ? `${service.last_scan_ms} ms` : undefined
}

function RecentEvents({ rows }: { rows: Alarm[] }) {
  const { pick } = useI18n()
  const displayRows = rows.slice(0, 5)
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[148px_92px_minmax(150px,1fr)_minmax(170px,1.2fr)] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>{pick('Thời gian', 'Time')}</span><span>{pick('Mức độ', 'Severity')}</span><span>{pick('Sự kiện', 'Event')}</span><span>{pick('Chi tiết', 'Detail')}</span>
      </div>
      {displayRows.map((alarm) => <div key={alarm.id} className="grid grid-cols-[148px_92px_minmax(150px,1fr)_minmax(170px,1.2fr)] items-center border-t border-[var(--c-border)] px-3 py-3 text-xs"><span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span><SeverityPill alarm={alarm} /><span className="font-semibold">{alarm.message}</span><span className="text-[var(--c-text-dim)]">{alarm.detail || alarm.value}</span></div>)}
    </div>
  )
}

function SeverityPill({ alarm }: { alarm: Alarm }) {
  const label = alarm.severity === 'critical' ? 'CRITICAL' : alarm.severity === 'high' ? 'WARNING' : 'INFO'
  const cls = label === 'CRITICAL' ? 'border-[rgba(213,32,42,0.52)] bg-[rgba(213,32,42,0.10)] text-[var(--c-fault-fg)]' : label === 'WARNING' ? 'border-[rgba(232,181,0,0.60)] bg-[rgba(232,181,0,0.18)] text-[var(--c-warn-fg)]' : 'border-[rgba(42,92,138,0.42)] bg-[rgba(42,92,138,0.10)] text-[var(--c-info)]'
  return <span className={`w-fit rounded-[var(--radius)] border px-2 py-1 text-[10px] font-bold ${cls}`}>{label}</span>
}

function SystemHealthSummary({ health }: { health?: HealthResponse }) {
  const { pick } = useI18n()
  const services = Object.entries(health?.services ?? {})
  const iop = health?.services.IOP ?? health?.services.iobus
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
      <Panel title="SERVICES" className="p-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-3">
          {services.map(([name, service]) => (
            <div key={name} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
              <div className="flex items-center justify-between gap-2"><div className="font-semibold">{name}</div><StatusBadge state={service.status} /></div>
              {typeof service.uptime_s === 'number' && service.uptime_s > 0 && <div className="mono mt-3 text-xs font-semibold text-[var(--c-good-fg)]">uptime {formatUptime(service.uptime_s)}</div>}
              {typeof service.last_scan_ms === 'number' && service.last_scan_ms > 0 && <div className="mono mt-1 text-xs font-semibold" style={{ color: metricStatusColor(service.last_scan_ms, 50, 100) }}>scan {service.last_scan_ms} ms</div>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="IOP / SCAN METRICS" className="self-start p-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricTile label="Overall" value={health?.overall ?? 'unknown'} color={statusColor(health?.overall ?? 'unknown')} />
          <MetricTile label="IOP latency" value={typeof iop?.last_scan_ms === 'number' && iop.last_scan_ms > 0 ? `${iop.last_scan_ms} ms` : 'N/A'} color={typeof iop?.last_scan_ms === 'number' && iop.last_scan_ms > 0 ? metricStatusColor(iop.last_scan_ms, 50, 100) : 'var(--c-text-dim)'} />
        </div>
      </Panel>
      <span className="sr-only">{pick('Thông tin sức khỏe hệ thống', 'System health information')}</span>
    </div>
  )
}

function MetricTile({ label, value, color = 'var(--c-text)' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
      <div className="text-xs uppercase text-[var(--c-text-dim)]">{label}</div>
      <div className="mono mt-2 text-lg font-semibold" style={{ color }}>{value}</div>
    </div>
  )
}
