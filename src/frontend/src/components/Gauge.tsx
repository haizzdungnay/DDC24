import { cn, statusColor } from '../utils'

interface GaugeProps {
  label: string
  value: number
  unit?: string
  max?: number
  state?: 'good' | 'uncertain' | 'bad'
  className?: string
}

export function Gauge({ label, value, unit = '%', max = 100, state = 'good', className }: GaugeProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const color = statusColor(state)
  return (
    <div className={cn('flex items-center gap-3', className)} aria-label={`${label} ${value}${unit}`}>
      <div
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(143,161,189,0.18) 0deg)` }}
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--c-surface)]">
          <span className="mono text-lg font-semibold">{Math.round(value)}{unit}</span>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase text-[var(--c-text-dim)]">{label}</div>
        <div className="mt-1 h-1.5 w-24 rounded-full bg-[rgba(143,161,189,0.16)]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
    </div>
  )
}
