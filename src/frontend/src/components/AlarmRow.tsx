import { BellRing } from 'lucide-react'
import type { Alarm } from '../types'
import { formatDateTime } from '../utils'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'

function triggerText(alarm: Alarm): string {
  if (!alarm.triggerLevel) return ''
  return alarm.threshold ? `${alarm.triggerLevel} ${alarm.threshold}` : alarm.triggerLevel
}

export function AlarmRow({ alarm, onAck, onReturn }: { alarm: Alarm; onAck?: (alarm: Alarm) => void; onReturn?: (alarm: Alarm) => void }) {
  const state = alarm.severity === 'critical' || alarm.severity === 'high' ? 'fault' : alarm.severity === 'medium' ? 'uncertain' : 'ok'
  const trigger = triggerText(alarm)
  const canReturn = alarm.status === 'acked' && alarm.active !== false && alarm.returnable !== false
  return (
    <div className="grid grid-cols-[140px_96px_1fr_92px] items-center gap-3 border-b border-[var(--c-border)] px-3 py-3 text-xs last:border-0 max-lg:grid-cols-1">
      <span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span>
      <StatusBadge state={state} label={alarm.severity.toUpperCase()} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          <BellRing className="h-4 w-4 text-[var(--c-accent)]" />
          <span className="min-w-0 truncate">{alarm.message}</span>
          {trigger && (
            <span className="mono shrink-0 rounded border border-[var(--c-warn)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--c-warn-fg)]" title="Triggered threshold">
              TRIP {trigger}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-[var(--c-text-dim)]">{alarm.source} · {alarm.value || 'n/a'} · {alarm.detail}</div>
      </div>
      {canReturn ? (
        <Button size="sm" variant="secondary" onClick={() => onReturn?.(alarm)}>Return</Button>
      ) : (
        <Button size="sm" variant={alarm.status === 'acked' ? 'ghost' : 'secondary'} disabled={alarm.status === 'acked' || alarm.status === 'cleared'} onClick={() => onAck?.(alarm)}>
          {alarm.status === 'acked' ? 'Acked' : alarm.status === 'cleared' ? 'Cleared' : 'Ack'}
        </Button>
      )}
    </div>
  )
}
