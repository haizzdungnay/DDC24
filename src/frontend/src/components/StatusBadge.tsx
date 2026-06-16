import { AlertTriangle, CheckCircle2, Circle, Info, Lock, WifiOff, XCircle } from 'lucide-react'
import type { HealthStatus, PointQuality } from '../types'
import { cn, statusColor } from '../utils'

type BadgeState = HealthStatus | PointQuality | 'online' | 'offline' | 'force' | 'demo' | 'live'

const labelMap: Record<string, string> = {
  ok: 'OK',
  good: 'GOOD',
  online: 'ONLINE',
  degraded: 'DEGRADED',
  uncertain: 'UNCERTAIN',
  stale: 'STALE',
  fault: 'FAULT',
  bad: 'BAD',
  offline: 'OFFLINE',
  force: 'FORCED',
  unknown: 'UNKNOWN',
  'n/a': 'N/A',
  demo: 'DEMO',
  live: 'LIVE'
}

function Icon({ state }: { state: BadgeState }) {
  if (state === 'ok' || state === 'good' || state === 'online') return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'fault' || state === 'bad' || state === 'offline') return <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'force') return <Lock className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'demo' || state === 'live') return <Info className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'unknown' || state === 'n/a') return <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
  return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
}

export function StatusBadge({ state, label, className }: { state: BadgeState; label?: string; className?: string }) {
  const color = state === 'demo' ? 'var(--c-accent)' : state === 'live' ? 'var(--c-good)' : statusColor(state)
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none', className)}
      style={{ color, borderColor: color, backgroundColor: 'rgba(255,255,255,0.035)' }}
    >
      <Icon state={state} />
      {label ?? labelMap[state]}
    </span>
  )
}

export function Dot({ state }: { state: BadgeState }) {
  const color = statusColor(state === 'demo' || state === 'live' ? 'online' : state)
  return <Circle className="h-2.5 w-2.5 fill-current" aria-hidden="true" style={{ color }} />
}
