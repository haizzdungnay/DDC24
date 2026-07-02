import { BellRing } from 'lucide-react'
import type { Alarm } from '../types'
import { formatDateTime } from '../utils'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'

export function AlarmRow({ alarm, onAck }: { alarm: Alarm; onAck?: (alarm: Alarm) => void }) {
  const state = alarm.severity === 'critical' || alarm.severity === 'high' ? 'fault' : alarm.severity === 'medium' ? 'uncertain' : 'ok'
  return (
    <div className="grid grid-cols-[140px_96px_1fr_92px] items-center gap-3 border-b border-[var(--c-border)] px-3 py-3 text-xs last:border-0 max-lg:grid-cols-1">
      <span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span>
      <StatusBadge state={state} label={alarm.severity.toUpperCase()} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-[var(--c-accent)]" />{alarm.message}</div>
        <div className="mt-1 truncate text-[var(--c-text-dim)]">{alarm.source} · {alarm.value || 'n/a'} · {alarm.detail}</div>
      </div>
      <Button size="sm" variant={alarm.status === 'acked' ? 'ghost' : 'secondary'} disabled={alarm.status === 'acked'} onClick={() => onAck?.(alarm)}>
        {alarm.status === 'acked' ? 'Acked' : 'Ack'}
      </Button>
    </div>
  )
}
