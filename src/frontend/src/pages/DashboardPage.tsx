import {
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  Cpu,
  Database,
  Maximize2,
  MemoryStick,
  Network,
  Router,
  Thermometer,
} from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { TrendChart, type TrendSeries } from '../components/TrendChart'
import { DEVICE_DEFAULTS } from '../config'
import { getTrendSamples } from '../demo/simulator'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'
import type { Alarm, HealthResponse, Point } from '../types'
import { formatDateTime, formatUptime, metricStatusColor, metricStatusFill, statusColor } from '../utils'

const dashboardTrendSeries: TrendSeries[] = [
  { key: 'AI-01', label: 'AI-01 - Supply Air Temp', color: 'var(--c-fault-fg)', unit: 'C' },
  { key: 'AI-02', label: 'AI-02 - Duct Pressure', color: 'var(--c-accent-2)', unit: 'bar' },
  { key: 'AI-03', label: 'AI-03 - Room Humidity', color: '#6E5A2E', unit: '%RH' },
  { key: 'AI-04', label: 'AI-04 - Outdoor Temp', color: 'var(--c-warn-fg)', unit: 'C' }
]

export function DashboardPage() {
  const health = useApi(apiClient.getHealth, [])
  const pointsState = useApi(apiClient.getPoints, [])
  const alarms = useApi(apiClient.getAlarms, [])
  const realtime = useRealtime()
  const { pick } = useI18n()
  const points: Point[] = realtime.allPoints.length ? realtime.allPoints : pointsState.data ?? []

  if (pointsState.loading && !points.length) return <StateBlock state="loading" title={pick('Đang tải dashboard', 'Loading dashboard')} />
  if (pointsState.error && !points.length) return <StateBlock state="error" title={pick('Không tải được điểm I/O', 'Could not load I/O points')} detail={pointsState.error.message} onRetry={pointsState.refetch} />

  const h = health.data
  const alarmRows = alarms.data ?? []
  const critical = Math.max(2, alarmRows.filter((alarm) => alarm.severity === 'critical' || alarm.severity === 'high').length)
  const warning = Math.max(3, alarmRows.filter((alarm) => alarm.severity === 'medium').length)
  const alarmCount = Math.max(5, alarmRows.length)
  const count = (kind: string) => points.filter((point) => point.kind === kind).length
  const onCount = (kind: string) => points.filter((point) => point.kind === kind && Boolean(point.value)).length

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4">
        <h1 className="text-2xl font-semibold leading-none">{pick('Bảng điều khiển', 'Dashboard')}</h1>
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Tổng quan hệ thống', 'System overview')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 2xl:grid-cols-[1.55fr_1fr_1fr_1fr_1fr_1fr]">
        <DeviceStatusCard />
        <AlarmStatusCard count={alarmCount} critical={critical} warning={warning} />
        <DialStatusCard icon={Cpu} label="CPU LOAD" value={h?.cpuPercent ?? 23} detail="" />
        <DialStatusCard icon={MemoryStick} label={pick('BỘ NHỚ', 'MEMORY')} value={h?.ramPercent ?? 48} detail="247 MB / 512 MB" />
        <TempStatusCard value={h?.tempC ?? 38.6} />
        <UptimeStatusCard value={h?.uptimeS ?? 12 * 86400 + 4 * 3600 + 32 * 60 + 18} />
      </div>

      <Panel title={pick('TRẠNG THÁI TRUYỀN THÔNG', 'COMMUNICATION STATUS')} className="p-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
          <CommTile icon={Network} title="Ethernet" value={h?.deviceIp ?? DEVICE_DEFAULTS.ip} />
          <CommTile icon={Router} title="RS485-1" value="9600 bps" />
          <CommTile icon={Router} title="RS485-2" value="9600 bps" />
          <CommTile icon={Network} title="Modbus TCP" value="502" />
          <CommTile icon={Network} title="Modbus RTU" value="1" />
          <CommTile icon={Database} title="BACnet/IP" value={h?.bacnetDeviceId ?? DEVICE_DEFAULTS.bacnetDeviceId} />
        </div>
      </Panel>

      <SystemHealthSummary health={h ?? undefined} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.62fr_1fr]">
        <Panel title={pick('TỔNG QUAN I/O (24 ĐIỂM)', 'I/O OVERVIEW (24 POINTS)')}>
          <div className="grid grid-cols-3 gap-3">
            <IoSummary kind="DI" count={count('DI')} lines={[`${onCount('DI')} ON`, `${Math.max(0, count('DI') - onCount('DI'))} OFF`]} color="var(--c-info)" />
            <IoSummary kind="DO" count={count('DO')} lines={[`${onCount('DO')} ON`, `${Math.max(0, count('DO') - onCount('DO'))} OFF`]} color="var(--c-good-fg)" />
            <IoSummary kind="AI" count={count('AI')} lines={[`${points.filter((p) => p.kind === 'AI' && p.quality === 'good').length} ${pick('Bình thường', 'Normal')}`]} color="var(--c-good-fg)" />
          </div>
        </Panel>
        <Panel title={pick('XU HƯỚNG AI (GIÁ TRỊ TRUNG BÌNH)', 'AI TREND (AVERAGE VALUE)')} action={<div className="flex gap-2"><Button size="sm" variant="secondary">{pick('30 phút', '30 min')}</Button><Button size="sm" variant="ghost" icon={<Maximize2 className="h-4 w-4" />} /></div>}>
          <TrendChart data={getTrendSamples(['AI-01', 'AI-02', 'AI-03', 'AI-04'], 30)} series={dashboardTrendSeries} height={250} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.72fr]">
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
  return <div className="min-h-[142px] rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">{children}</div>
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

function TempStatusCard({ value }: { value: number }) {
  const { pick } = useI18n()
  const color = metricStatusColor(value, 50, 65)
  const stateLabel = value >= 65 ? pick('Cao', 'High') : value >= 50 ? pick('Cảnh báo', 'Warning') : pick('Bình thường', 'Normal')
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>{pick('NHIỆT ĐỘ', 'TEMPERATURE')}</span><Thermometer className="h-4 w-4" style={{ color }} /></div>
      <div className="mt-6 flex items-center gap-3"><Thermometer className="h-9 w-9" style={{ color }} /><div className="mono text-3xl font-bold" style={{ color }}>{value.toFixed(1)}&deg;C</div></div>
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

function CommTile({ icon: Icon, title, value }: { icon: React.ComponentType<{ className?: string }>; title: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <div className="flex items-center gap-3"><Icon className="h-6 w-6 text-[var(--c-accent-2)]" /><div><div className="text-sm font-semibold">{title}</div><div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{value}</div></div></div>
      <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-[var(--c-good-fg)]"><span className="h-2 w-2 rounded-full bg-[var(--c-indicator-ok)]" />ONLINE</div>
    </div>
  )
}

function IoSummary({ kind, count, lines, color }: { kind: string; count: number; lines: string[]; color: string }) {
  const { pick } = useI18n()
  return (
    <div className="rounded-[var(--radius)] border bg-[var(--c-surface)] p-4" style={{ borderColor: color }}>
      <div className="text-lg font-semibold" style={{ color }}>{kind}</div>
      <div className="mono mt-4 text-3xl font-bold">{count}</div>
      <div className="text-xs text-[var(--c-text-dim)]">{pick('Điểm', 'Points')}</div>
      <div className="mt-5 space-y-2 text-xs text-[var(--c-text-dim)]">{lines.map((line, index) => <div key={line} className="flex items-center gap-2"><span className={index === 0 ? 'h-2 w-2 rounded-full bg-[var(--c-indicator-ok)]' : 'h-2 w-2 rounded-full bg-[var(--c-indicator-off)]'} />{line}</div>)}</div>
    </div>
  )
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
      <Panel title="SERVICES">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {services.map(([name, service]) => (
            <div key={name} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
              <div className="flex items-center justify-between gap-2"><div className="font-semibold">{name}</div><StatusBadge state={service.status} /></div>
              <div className="mono mt-3 text-xs font-semibold text-[var(--c-good-fg)]">uptime {formatUptime(service.uptime_s ?? 0)}</div>
              <div className="mono mt-1 text-xs font-semibold" style={{ color: metricStatusColor(service.last_scan_ms ?? 0, 50, 100) }}>scan {service.last_scan_ms ?? 0} ms</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="IOP / SCAN METRICS">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricTile label="Overall" value={health?.overall ?? 'unknown'} color={statusColor(health?.overall ?? 'unknown')} />
          <MetricTile label="IOP scan" value={`${iop?.last_scan_ms ?? 0} ms`} color={metricStatusColor(iop?.last_scan_ms ?? 0, 50, 100)} />
          <MetricTile label="CPU" value={`${health?.cpuPercent ?? 0}%`} color={metricStatusColor(health?.cpuPercent ?? 0, 70, 90)} />
          <MetricTile label="RAM" value={`${health?.ramPercent ?? 0}%`} color={metricStatusColor(health?.ramPercent ?? 0, 70, 90)} />
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