import { AlertTriangle, CheckCircle2, Info, Lock, WifiOff, XCircle } from 'lucide-react'
import type { HealthStatus, PointQuality } from '../types'
import { cn, statusColor, statusFill } from '../utils'

type BadgeState = HealthStatus | PointQuality | 'normal' | 'online' | 'offline' | 'live' | 'connected' | 'disconnected' | 'force' | 'forced' | 'critical' | 'safety' | 'demo' | 'warn' | 'warning' | 'on' | 'off' | 'stopped' | 'inactive' | 'alarm'

const labelMap: Record<string, string> = {
  normal: 'NORMAL',
  on: 'ON',
  ok: 'OK',
  good: 'GOOD',
  online: 'ONLINE',
  live: 'LIVE',
  connected: 'CONNECTED',
  degraded: 'DEGRADED',
  warn: 'WARN',
  warning: 'WARNING',
  uncertain: 'UNCERTAIN',
  stale: 'STALE',
  fault: 'FAULT',
  bad: 'BAD',
  offline: 'OFFLINE',
  disconnected: 'DISCONNECTED',
  off: 'OFF',
  stopped: 'STOPPED',
  inactive: 'INACTIVE',
  force: 'FORCED',
  forced: 'FORCED',
  alarm: 'ALARM',
  critical: 'CRITICAL',
  safety: 'SAFETY',
  unknown: 'UNKNOWN',
  'n/a': 'N/A',
  demo: 'DEMO'
}

function Icon({ state }: { state: BadgeState }) {
  if (state === 'normal' || state === 'ok' || state === 'good' || state === 'online' || state === 'on' || state === 'live' || state === 'connected') return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'fault' || state === 'bad' || state === 'offline' || state === 'disconnected' || state === 'alarm') return <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'force' || state === 'forced') return <Lock className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'critical' || state === 'safety') return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'demo') return <Info className="h-3.5 w-3.5" aria-hidden="true" />
  if (state === 'off' || state === 'stopped' || state === 'inactive' || state === 'unknown' || state === 'n/a') return <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
  return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
}

/**
 * Nền của badge — WEB-UX-008.
 *
 * Trước đây là 7 chuỗi `rgba()` viết tay, mỗi chuỗi lặp lại giá trị RGB của một
 * token màu. Hai hệ quả: (1) đổi token thì nền badge không đổi theo, nên bảng
 * màu tự lệch khỏi chính nó; (2) vì là màu tối phủ alpha lên nền xám, nền badge
 * TỐI ĐI, kéo tụt tương phản của đúng dòng chữ nằm trên nó — 13/14 biến thể
 * trượt 4.5:1.
 *
 * Nay trỏ vào các token `--c-*-bg`, vốn là màu đặc pha về phía trắng. Nền luôn
 * sáng hơn chữ, và một lần sửa token là mọi badge đổi theo.
 */
function badgeBackground(state: BadgeState): string {
  const raw = String(state).toLowerCase()
  if (raw === 'demo') return 'var(--c-accent-bg)'
  if (raw === 'normal' || raw === 'ok' || raw === 'good' || raw === 'online' || raw === 'on' || raw === 'live' || raw === 'connected') return 'var(--c-good-bg)'
  if (raw === 'off' || raw === 'stopped' || raw === 'inactive' || raw === 'unknown' || raw === 'n/a') return 'var(--c-off-bg)'
  if (raw === 'warn' || raw === 'warning' || raw === 'uncertain' || raw === 'stale' || raw === 'degraded') return 'var(--c-warn-bg)'
  if (raw === 'fault' || raw === 'bad' || raw === 'offline' || raw === 'disconnected' || raw === 'alarm') return 'var(--c-fault-bg)'
  if (raw === 'critical' || raw === 'safety') return 'var(--c-critical-bg)'
  if (raw === 'force' || raw === 'forced') return 'var(--c-force-bg)'
  return 'var(--c-surface)'
}

export function StatusBadge({ state, label, className }: { state: BadgeState; label?: string; className?: string }) {
  const color = state === 'demo' ? 'var(--c-accent)' : statusColor(state)
  const fill = state === 'demo' ? 'var(--c-accent)' : statusFill(state)
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none', className)}
      style={{ color, borderColor: fill, backgroundColor: badgeBackground(state) }}
    >
      <span style={{ color: fill }}><Icon state={state} /></span>
      {label ?? labelMap[state]}
    </span>
  )
}

export function Dot({ state, label }: { state: BadgeState; label?: string }) {
  const color = state === 'demo' ? 'var(--c-accent)' : statusColor(state)
  const fill = state === 'demo' ? 'var(--c-accent)' : statusFill(state)
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color }}>
      <span style={{ color: fill }}><Icon state={state} /></span>
      {label ?? labelMap[state]}
    </span>
  )
}