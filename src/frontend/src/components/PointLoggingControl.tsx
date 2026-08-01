import { useState } from 'react'
import type { JSX } from 'react'
import { CalendarClock, Database, Settings2 } from 'lucide-react'
import { Button } from './Button'
import {
  PointLoggingDialog,
  pointLoggingErrorsFromApiError,
  type PointLoggingDialogProps,
  type PointLoggingError,
  type PointLoggingPatch,
  type PointLoggingState
} from './PointLoggingDialog'

export interface PointLoggingControlProps extends Omit<PointLoggingDialogProps, 'open' | 'onClose' | 'onSubmit'> {
  onChange?: (patch: PointLoggingPatch) => void | Promise<void>
}

const statusStyle: Record<PointLoggingState, string> = {
  off: 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]',
  scheduled: 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]',
  recording: 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]',
  error: 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
}

export function PointLoggingControl({ point, policy, role, serverNowUtc, loading = false, errors = [], onChange }: PointLoggingControlProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [localErrors, setLocalErrors] = useState<PointLoggingError[]>([])
  const state = effectiveState(policy.state, policy.health)
  const label = point.label ?? point.id
  const busy = loading || submitting

  async function save(patch: PointLoggingPatch) {
    if (!onChange || busy) return
    setSubmitting(true)
    setLocalErrors([])
    try {
      await onChange(patch)
      setOpen(false)
    } catch (error) {
      setLocalErrors(pointLoggingErrorsFromApiError(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4" aria-label={`Logging for ${label}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--c-accent)]">{point.kind} / {point.id}</p>
          <h3 className="mt-1 truncate text-sm font-semibold text-[var(--c-text)]">{label}</h3>
        </div>
        <LoggingStateBadge state={state} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <dt className="text-[var(--c-text-dim)]">Interval</dt><dd className="text-right font-semibold text-[var(--c-text)]">{policy.dbInterval}</dd>
        <dt className="text-[var(--c-text-dim)]">Retention</dt><dd className="text-right font-semibold text-[var(--c-text)]">{policy.retentionDays} days</dd>
        <dt className="text-[var(--c-text-dim)]">Generation</dt><dd className="text-right font-semibold text-[var(--c-text)]">{policy.generation}</dd>
        {state === 'scheduled' && <><dt className="text-[var(--c-text-dim)]">Starts UTC</dt><dd className="break-all text-right font-semibold text-[var(--c-text)]">{policy.startAtUtc}</dd></>}
      </dl>

      {state === 'error' && policy.lastError && (
        <p role="alert" className="mt-3 text-xs text-[var(--c-fault-fg)]">{policy.lastError}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--c-border)] pt-3">
        {role === 'admin' ? (
          <>
            <span className="text-xs text-[var(--c-text-dim)]">Admin policy control</span>
            <Button
              size="sm"
              icon={<Settings2 className="h-4 w-4" aria-hidden="true" />}
              aria-label={`Configure logging for ${label}`}
              disabled={!onChange || busy}
              onClick={() => { setLocalErrors([]); setOpen(true) }}
            >
              Configure
            </Button>
          </>
        ) : (
          <span className="text-xs font-medium text-[var(--c-text-dim)]">Read-only for {role}</span>
        )}
      </div>

      <PointLoggingDialog
        open={open}
        point={point}
        policy={policy}
        role={role}
        serverNowUtc={serverNowUtc}
        loading={busy}
        errors={[...errors, ...localErrors]}
        onClose={() => { if (!busy) setOpen(false) }}
        onSubmit={(patch) => void save(patch)}
      />
    </section>
  )
}

function LoggingStateBadge({ state }: { state: PointLoggingState }) {
  const Icon = state === 'recording' ? Database : CalendarClock
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase leading-none ${statusStyle[state]}`}
      aria-label={`Logging status: ${state}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {state}
    </span>
  )
}

function effectiveState(state: PointLoggingState, health?: string): PointLoggingState {
  const normalizedHealth = health?.toLowerCase()
  if (state === 'error' || (state !== 'off' && (normalizedHealth === 'degraded' || normalizedHealth === 'fault' || normalizedHealth === 'bad' || normalizedHealth === 'error'))) return 'error'
  return state
}
