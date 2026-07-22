import { AlertTriangle, CheckCircle2, Info, WifiOff } from 'lucide-react'
import { useId, type ComponentType, type SVGProps } from 'react'
import { cn } from '../utils'
import { Button } from './Button'

export type HistoryPresentationState = 'complete' | 'partial' | 'unavailable' | 'no-history'

export interface HistoryGapDetail {
  pointId: string
  generation: number
  fromUtc: string
  toUtc: string
  reason: string
  detail?: string
}

export interface HistoryStateBannerProps {
  state: HistoryPresentationState
  gaps?: HistoryGapDetail[]
  title?: string
  detail?: string
  onRetry?: () => void
  className?: string
}

interface StateCopy {
  label: string
  title: string
  detail: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  className: string
  labelClassName: string
}

const stateCopy: Record<HistoryPresentationState, StateCopy> = {
  complete: {
    label: 'Complete',
    title: 'History complete',
    detail: 'All requested history is available.',
    Icon: CheckCircle2,
    className: 'border-[rgba(47,164,90,0.38)] bg-[rgba(47,164,90,0.08)]',
    labelClassName: 'text-[var(--c-good-fg)]',
  },
  partial: {
    label: 'Partial',
    title: 'History is partial',
    detail: 'Available samples remain visible; missing intervals are not connected.',
    Icon: AlertTriangle,
    className: 'border-[rgba(232,181,0,0.52)] bg-[rgba(232,181,0,0.10)]',
    labelClassName: 'text-[var(--c-warn-fg)]',
  },
  unavailable: {
    label: 'Unavailable',
    title: 'History unavailable',
    detail: 'Historical data could not be loaded.',
    Icon: WifiOff,
    className: 'border-[rgba(213,32,42,0.42)] bg-[rgba(213,32,42,0.08)]',
    labelClassName: 'text-[var(--c-fault-fg)]',
  },
  'no-history': {
    label: 'No history',
    title: 'No history',
    detail: 'No samples exist in the requested range.',
    Icon: Info,
    className: 'border-[var(--c-border)] bg-[var(--c-surface-2)]',
    labelClassName: 'text-[var(--c-text-dim)]',
  },
}

function readableReason(reason: string): string {
  return reason.replace(/_/g, ' ').trim() || 'unspecified reason'
}

export function HistoryStateBanner({ state, gaps = [], title, detail, onRetry, className }: HistoryStateBannerProps) {
  const copy = stateCopy[state]
  const titleId = useId()
  const detailId = useId()
  const isAlert = state === 'partial' || state === 'unavailable'
  const showGapEvidence = state === 'partial'
  const Icon = copy.Icon

  return (
    <section
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      className={cn('rounded-[var(--radius)] border p-3 text-[var(--c-text)]', copy.className, className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            data-testid="history-state-icon"
            aria-hidden="true"
            className={cn('mt-0.5 h-5 w-5 shrink-0', copy.labelClassName)}
          />
          <div className="min-w-0">
            <div className={cn('text-[11px] font-bold uppercase tracking-[0.12em]', copy.labelClassName)}>{copy.label}</div>
            <h3 id={titleId} className="mt-0.5 text-sm font-semibold">{title ?? copy.title}</h3>
            <p id={detailId} className="mt-1 text-xs leading-5 text-[var(--c-text-dim)]">{detail ?? copy.detail}</p>
            {showGapEvidence && <p className="mt-1 text-xs font-semibold">{gaps.length} history gaps reported.</p>}
          </div>
        </div>
        {state === 'unavailable' && onRetry && (
          <Button className="shrink-0 self-start" size="sm" onClick={onRetry} aria-label="Retry history query">
            Retry
          </Button>
        )}
      </div>

      {showGapEvidence && gaps.length === 0 && (
        <p className="mt-3 border-t border-[var(--c-border)] pt-2 text-xs text-[var(--c-text-dim)]">No gap details were supplied.</p>
      )}

      {showGapEvidence && gaps.length > 0 && (
        <details className="mt-3 border-t border-[var(--c-border)] pt-2 text-xs">
          <summary className="cursor-pointer select-none font-semibold text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]">
            Gap details ({gaps.length})
          </summary>
          <ol className="mt-2 grid gap-2 sm:grid-cols-2">
            {gaps.map((gap, index) => (
              <li key={`${gap.pointId}:${gap.generation}:${gap.fromUtc}:${gap.toUtc}:${index}`} className="rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-2">
                <div className="font-semibold">{gap.pointId} generation {gap.generation}</div>
                <div className="mt-1 break-words text-[var(--c-text-dim)]">
                  <time dateTime={gap.fromUtc}>{gap.fromUtc}</time>
                  {' to '}
                  <time dateTime={gap.toUtc}>{gap.toUtc}</time>
                </div>
                <div className="mt-1"><span className="font-medium">Reason:</span> {readableReason(gap.reason)}</div>
                {gap.detail && <div className="mt-1 text-[var(--c-text-dim)]">{gap.detail}</div>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}
