import type { Point } from '../types'
import { cn, formatTime, formatValue, statusColor } from '../utils'
import { StatusBadge } from './StatusBadge'

export function PointCard({ point, stale = false, compact = false, onClick }: { point: Point; stale?: boolean; compact?: boolean; onClick?: () => void }) {
  const state = point.forced ? 'force' : point.quality
  const borderColor = statusColor(state)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('w-full rounded-[var(--radius)] border bg-[var(--c-surface)] p-3 text-left transition hover:-translate-y-0.5 hover:bg-[var(--c-surface-2)]', stale && 'stale', compact ? 'min-h-[104px]' : 'min-h-[136px]')}
      style={{ borderColor }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-[var(--c-accent)]">{point.id}</div>
          <div className="mt-1 line-clamp-1 text-xs text-[var(--c-text-dim)]">{point.name}</div>
        </div>
        <StatusBadge state={state} label={point.forced ? 'FORCED' : undefined} />
      </div>
      <div className="mono mt-4 text-2xl font-semibold text-[var(--c-text)]">{formatValue(point.value, point.unit)}</div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--c-text-dim)]">
        <span>{point.source}</span>
        <span>{formatTime(point.updatedAt)}</span>
      </div>
    </button>
  )
}
