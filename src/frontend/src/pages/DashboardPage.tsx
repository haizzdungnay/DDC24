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
import { TrendChart } from '../components/TrendChart'
import { DEVICE_DEFAULTS } from '../config'
import { getTrendSamples } from '../demo/simulator'
import { useApi } from '../hooks/useApi'
import { useRealtime } from '../realtime'
import type { Alarm, Point } from '../types'
import { formatDateTime, formatUptime } from '../utils'

export function DashboardPage() {
  const health = useApi(apiClient.getHealth, [])
  const pointsState = useApi(apiClient.getPoints, [])
  const alarms = useApi(apiClient.getAlarms, [])
  const realtime = useRealtime()
  const points: Point[] = realtime.allPoints.length ? realtime.allPoints : pointsState.data ?? []

  if (pointsState.loading && !points.length) return <StateBlock state="loading" title="Đang tải dashboard" />
  if (pointsState.error && !points.length) return <StateBlock state="error" title="Không tải được điểm I/O" detail={pointsState.error.message} onRetry={pointsState.refetch} />

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
        <h1 className="text-2xl font-semibold leading-none">Dashboard</h1>
        <p className="text-sm text-[var(--c-text-dim)]">Tổng quan hệ thống</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 2xl:grid-cols-[1.55fr_1fr_1fr_1fr_1fr_1fr]">
        <DeviceStatusCard />
        <AlarmStatusCard count={alarmCount} critical={critical} warning={warning} />
        <DialStatusCard icon={Cpu} label="CPU LOAD" value={h?.cpuPercent ?? 23} detail="" />
        <DialStatusCard icon={MemoryStick} label="BỘ NHỚ" value={h?.ramPercent ?? 48} detail="247 MB / 512 MB" />
        <TempStatusCard value={h?.tempC ?? 38.6} />
        <UptimeStatusCard value={h?.uptimeS ?? 12 * 86400 + 4 * 3600 + 32 * 60 + 18} />
      </div>

      <Panel title="TRẠNG THÁI TRUYỀN THÔNG" className="p-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
          <CommTile icon={Network} title="Ethernet" value={h?.deviceIp ?? DEVICE_DEFAULTS.ip} />
          <CommTile icon={Router} title="RS485-1" value="9600 bps" />
          <CommTile icon={Router} title="RS485-2" value="9600 bps" />
          <CommTile icon={Network} title="Modbus TCP" value="502" />
          <CommTile icon={Network} title="Modbus RTU" value="1" />
          <CommTile icon={Database} title="BACnet/IP" value={h?.bacnetDeviceId ?? DEVICE_DEFAULTS.bacnetDeviceId} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.62fr_1fr]">
        <Panel title="TỔNG QUAN I/O (24 ĐIỂM)">
          <div className="grid grid-cols-3 gap-3">
            <IoSummary kind="DI" count={count('DI')} lines={[`${onCount('DI')} ON`, `${Math.max(0, count('DI') - onCount('DI'))} OFF`]} color="var(--c-info)" />
            <IoSummary kind="DO" count={count('DO')} lines={[`${onCount('DO')} ON`, `${Math.max(0, count('DO') - onCount('DO'))} OFF`]} color="var(--c-good)" />
            <IoSummary kind="AI" count={count('AI')} lines={[`${points.filter((p) => p.kind === 'AI' && p.quality === 'good').length} Bình thường`]} color="var(--c-force)" />
          </div>
        </Panel>
        <Panel title="XU HƯỚNG AI (GIÁ TRỊ TRUNG BÌNH)" action={<div className="flex gap-2"><Button size="sm" variant="secondary">30 phút</Button><Button size="sm" variant="ghost" icon={<Maximize2 className="h-4 w-4" />} /></div>}>
          <TrendChart data={getTrendSamples()} height={250} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.72fr]">
        <Panel title="SỰ KIỆN GẦN NHẤT">
          <RecentEvents rows={alarmRows} />
          <div className="mt-4 text-center">
            <Link to="/alarms" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--c-accent)]">Xem tất cả sự kiện <ChevronRight className="h-4 w-4" /></Link>
          </div>
        </Panel>
        <Panel title="THÔNG TIN THIẾT BỊ">
          <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
            <dt className="text-[var(--c-text-dim)]">Tên thiết bị</dt><dd>{h?.deviceName ?? DEVICE_DEFAULTS.name}</dd>
            <dt className="text-[var(--c-text-dim)]">Model</dt><dd>DDC24-AC</dd>
            <dt className="text-[var(--c-text-dim)]">Firmware</dt><dd>{h?.firmware ?? DEVICE_DEFAULTS.firmware} (Build 20250515)</dd>
            <dt className="text-[var(--c-text-dim)]">Serial</dt><dd className="mono">{DEVICE_DEFAULTS.serial}</dd>
            <dt className="text-[var(--c-text-dim)]">Địa chỉ IP</dt><dd className="mono">{h?.deviceIp ?? DEVICE_DEFAULTS.ip}</dd>
            <dt className="text-[var(--c-text-dim)]">MAC Address</dt><dd className="mono">00:0D:18:24:AC:01</dd>
            <dt className="text-[var(--c-text-dim)]">Thời gian hệ thống</dt><dd>23/05/2025 14:32:18</dd>
            <dt className="text-[var(--c-text-dim)]">Vị trí lắp đặt</dt><dd>Tủ ĐK trung tâm - Tầng 1</dd>
            <dt className="text-[var(--c-text-dim)]">Mô tả</dt><dd>DDC 24 điểm - HVAC System</dd>
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[142px] rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-4">{children}</div>
}

function DeviceStatusCard() {
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>TRẠNG THÁI THIẾT BỊ</span><ChevronRight className="h-4 w-4 text-[var(--c-accent)]" /></div>
      <div className="mt-6 flex items-center gap-5">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-[rgba(47,191,113,0.18)] shadow-[0_0_28px_rgba(47,191,113,0.35)]"><div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--c-good)]"><Check className="h-8 w-8 text-white" /></div></div>
        <div><div className="text-xl font-bold text-[var(--c-good)]">ONLINE</div><div className="mt-1 text-xs text-[var(--c-text-dim)]">Thiết bị hoạt động<br />bình thường</div></div>
      </div>
    </StatusCard>
  )
}

function AlarmStatusCard({ count, critical, warning }: { count: number; critical: number; warning: number }) {
  return (
    <StatusCard>
      <div className="text-[11px] font-semibold uppercase text-[var(--c-fault)]">CẢNH BÁO</div>
      <div className="mt-5 flex items-center gap-4"><BellRing className="h-8 w-8 text-[var(--c-fault)]" /><span className="mono text-3xl font-bold text-[var(--c-fault)]">{count}</span></div>
      <div className="mt-3 text-xs text-[var(--c-text-dim)]">Tổng cảnh báo</div>
      <div className="mt-3 flex gap-3 text-xs"><span className="font-semibold text-[var(--c-fault)]">{critical} Critical</span><span className="font-semibold text-[var(--c-warn)]">{warning} Warning</span></div>
    </StatusCard>
  )
}

function DialStatusCard({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; detail: string }) {
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>{label}</span><Icon className="h-4 w-4" /></div>
      <div className="mt-4 grid place-items-center">
        <MiniDial value={value} />
      </div>
      {detail && <div className="mono mt-3 text-center text-xs text-[var(--c-text-dim)]">{detail}</div>}
    </StatusCard>
  )
}

function TempStatusCard({ value }: { value: number }) {
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>NHIỆT ĐỘ</span><Thermometer className="h-4 w-4" /></div>
      <div className="mt-6 flex items-center gap-3"><Thermometer className="h-9 w-9 text-[var(--c-text-dim)]" /><div className="mono text-3xl font-bold">{value.toFixed(1)}°C</div></div>
      <div className="mt-4 text-xs font-semibold text-[var(--c-good)]">Bình thường</div>
    </StatusCard>
  )
}

function UptimeStatusCard({ value }: { value: number }) {
  return (
    <StatusCard>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]"><span>UPTIME</span><Clock3 className="h-4 w-4" /></div>
      <div className="mt-6 flex items-center gap-3"><Clock3 className="h-10 w-10 text-[var(--c-text-dim)]" /><div className="mono text-lg font-bold">{formatUptime(value)}</div></div>
      <div className="mt-4 text-xs text-[var(--c-text-dim)]">Hoạt động liên tục</div>
    </StatusCard>
  )
}

function MiniDial({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: `conic-gradient(var(--c-accent-2) ${pct * 3.6}deg, rgba(143,161,189,0.16) 0deg)` }}><div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--c-surface)]"><span className="mono text-xl font-bold">{Math.round(value)}%</span></div></div>
}

function CommTile({ icon: Icon, title, value }: { icon: React.ComponentType<{ className?: string }>; title: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(11,18,32,0.52)] p-3">
      <div className="flex items-center gap-3"><Icon className="h-6 w-6 text-[var(--c-accent-2)]" /><div><div className="text-sm font-semibold">{title}</div><div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{value}</div></div></div>
      <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-[var(--c-good)]"><span className="h-2 w-2 rounded-full bg-[var(--c-good)]" />ONLINE</div>
    </div>
  )
}

function IoSummary({ kind, count, lines, color }: { kind: string; count: number; lines: string[]; color: string }) {
  return (
    <div className="rounded-[var(--radius)] border bg-[rgba(11,18,32,0.48)] p-4" style={{ borderColor: color }}>
      <div className="text-lg font-semibold" style={{ color }}>{kind}</div>
      <div className="mono mt-4 text-3xl font-bold">{count}</div>
      <div className="text-xs text-[var(--c-text-dim)]">Điểm</div>
      <div className="mt-5 space-y-2 text-xs text-[var(--c-text-dim)]">{lines.map((line, index) => <div key={line} className="flex items-center gap-2"><span className={index === 0 ? 'h-2 w-2 rounded-full bg-[var(--c-good)]' : 'h-2 w-2 rounded-full bg-[var(--c-text-dim)]'} />{line}</div>)}</div>
    </div>
  )
}

function RecentEvents({ rows }: { rows: Alarm[] }) {
  const displayRows = rows.slice(0, 5)
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[148px_92px_minmax(150px,1fr)_minmax(170px,1.2fr)] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>Thời gian</span><span>Mức độ</span><span>Sự kiện</span><span>Chi tiết</span>
      </div>
      {displayRows.map((alarm) => <div key={alarm.id} className="grid grid-cols-[148px_92px_minmax(150px,1fr)_minmax(170px,1.2fr)] items-center border-t border-[rgba(36,48,73,0.58)] px-3 py-3 text-xs"><span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span><SeverityPill alarm={alarm} /><span className="font-semibold">{alarm.message}</span><span className="text-[var(--c-text-dim)]">{alarm.detail || alarm.value}</span></div>)}
    </div>
  )
}

function SeverityPill({ alarm }: { alarm: Alarm }) {
  const label = alarm.severity === 'critical' ? 'CRITICAL' : alarm.severity === 'high' ? 'WARNING' : 'INFO'
  const cls = label === 'CRITICAL' ? 'border-[rgba(229,72,77,0.42)] bg-[rgba(229,72,77,0.14)] text-[var(--c-fault)]' : label === 'WARNING' ? 'border-[rgba(224,161,6,0.42)] bg-[rgba(224,161,6,0.14)] text-[var(--c-warn)]' : 'border-[rgba(91,141,239,0.42)] bg-[rgba(91,141,239,0.14)] text-[var(--c-info)]'
  return <span className={`w-fit rounded-[var(--radius)] border px-2 py-1 text-[10px] font-bold ${cls}`}>{label}</span>
}
