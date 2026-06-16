import { Cpu, Database, HeartPulse, MemoryStick, Thermometer, Timer } from 'lucide-react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Gauge } from '../components/Gauge'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { useApi } from '../hooks/useApi'
import { formatUptime } from '../utils'

export function SystemHealthPage() {
  const state = useApi(apiClient.getHealth, [])
  if (state.loading && !state.data) return <StateBlock state="loading" title="Đang tải health" />
  if (state.error && !state.data) return <StateBlock state="error" title="Không tải được health" detail={state.error.message} onRetry={state.refetch} />
  const health = state.data
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">System Health</h1><p className="text-sm text-[var(--c-text-dim)]">Trạng thái process, CPU, RAM, scan và IOP</p></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel><Gauge label="CPU" value={health?.cpuPercent ?? 0} /></Panel>
        <Panel><Gauge label="RAM" value={health?.ramPercent ?? 0} /></Panel>
        <Panel><Gauge label="Temp" value={health?.tempC ?? 0} unit="C" max={80} /></Panel>
      </div>
      <Panel title="Services">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(health?.services ?? {}).map(([name, service]) => <div key={name} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-4"><div className="flex items-center justify-between"><div className="font-semibold">{name}</div><StatusBadge state={service.status} /></div><div className="mono mt-3 text-xs text-[var(--c-text-dim)]">uptime {formatUptime(service.uptime_s ?? 0)}</div><div className="mono mt-1 text-xs text-[var(--c-text-dim)]">scan {service.last_scan_ms ?? 0} ms</div></div>)}
        </div>
      </Panel>
      <Panel title="Runtime counters">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Tile icon={HeartPulse} label="Overall" value={health?.overall ?? 'unknown'} />
          <Tile icon={Timer} label="Uptime" value={formatUptime(health?.uptimeS ?? 0)} />
          <Tile icon={Cpu} label="CPU" value={`${health?.cpuPercent ?? 0}%`} />
          <Tile icon={MemoryStick} label="RAM" value={`${health?.ramPercent ?? 0}%`} />
          <Tile icon={Database} label="Firmware" value={health?.firmware ?? 'n/a'} />
        </div>
      </Panel>
    </div>
  )
}

function Tile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(11,18,32,0.48)] p-4"><Icon className="h-5 w-5 text-[var(--c-accent)]" /><div className="mt-3 text-xs uppercase text-[var(--c-text-dim)]">{label}</div><div className="mono mt-1 text-lg font-semibold">{value}</div></div>
}
