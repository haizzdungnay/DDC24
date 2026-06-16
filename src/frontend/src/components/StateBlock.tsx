import { AlertTriangle, LoaderCircle, WifiOff } from 'lucide-react'
import { Button } from './Button'

export function StateBlock({ state, title, detail, onRetry }: { state: 'loading' | 'empty' | 'error' | 'offline'; title: string; detail?: string; onRetry?: () => void }) {
  const Icon = state === 'loading' ? LoaderCircle : state === 'offline' ? WifiOff : AlertTriangle
  return (
    <div className="grid min-h-[180px] place-items-center rounded-[var(--radius)] border border-dashed border-[var(--c-border)] bg-[rgba(17,26,43,0.58)] p-6 text-center">
      <div>
        <Icon className={state === 'loading' ? 'mx-auto h-8 w-8 animate-spin text-[var(--c-accent)]' : 'mx-auto h-8 w-8 text-[var(--c-warn)]'} aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold">{title}</h3>
        {detail && <p className="mt-1 max-w-sm text-xs text-[var(--c-text-dim)]">{detail}</p>}
        {onRetry && <Button className="mt-4" size="sm" onClick={onRetry}>Retry</Button>}
      </div>
    </div>
  )
}
