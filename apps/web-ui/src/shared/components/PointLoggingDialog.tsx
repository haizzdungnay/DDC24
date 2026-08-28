import { useEffect, useId, useRef, useState } from 'react'
import { roleCan } from '../auth/capabilities'
import type { UserRole } from '../types'
import type { ChangeEvent, JSX, KeyboardEvent } from 'react'
import { AlertTriangle, CalendarClock, Database, X } from 'lucide-react'
import { Button } from './Button'

export const HISTORIAN_INTERVALS = ['1s', '3s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '60m'] as const

export type HistorianInterval = (typeof HISTORIAN_INTERVALS)[number]
/* `WEB-RBAC-001` — chính sách ghi lịch sử là CẤU HÌNH thiết bị, nên nó đi theo
 * năng lực `settings.manage` (engineer + admin) chứ không theo một danh sách vai
 * viết tay ở đây. Server quyết định thật: `PUT /points/{id}/config` và
 * `PUT /trends/config` đều khai `settings.manage`. */
export type PointLoggingRole = UserRole
export type PointLoggingState = 'off' | 'scheduled' | 'recording' | 'error'
export type PointLoggingKind = 'UI' | 'AO' | 'DO' | 'VP'

export interface PointLoggingPoint {
  id: string
  label?: string
  kind: PointLoggingKind
}

export interface PointLoggingPolicy {
  pointId: string
  generation: number
  dbLoggingEnabled: boolean
  dbInterval: HistorianInterval
  retentionDays: number
  maxRetentionDays?: number
  maxRetentionDaysByInterval?: Partial<Record<HistorianInterval, number>>
  startAtUtc: string
  state: PointLoggingState
  health?: string
  lastError?: string
}

export interface PointLoggingPatch {
  pointId: string
  generation: number
  dbLoggingEnabled: boolean
  dbInterval: HistorianInterval
  retentionDays: number
  startAtUtc: string | null
}

export type HistorianPolicyFormValue = PointLoggingPatch

export type PointLoggingErrorKind = 'field' | 'capacity' | 'storage' | 'conflict' | 'unknown'
export type PointLoggingErrorField = 'enabled' | 'interval' | 'retentionDays' | 'startAtUtc' | 'form'

export interface PointLoggingError {
  kind: PointLoggingErrorKind
  message: string
  field?: PointLoggingErrorField
  code?: string
}

interface LoggingApiErrorShape {
  message?: string
  status?: number
  details?: Array<{ path?: string; message?: string; reason?: string }>
}

export interface PointLoggingDialogProps {
  open: boolean
  point: PointLoggingPoint
  policy: PointLoggingPolicy
  role: PointLoggingRole
  serverNowUtc: string
  loading?: boolean
  errors?: PointLoggingError[]
  onClose: () => void
  onSubmit?: (patch: PointLoggingPatch) => void
}

type StartMode = 'immediate' | 'future'

const controlClass = 'mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text)] outline-none transition focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
const focusableSelector = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function PointLoggingDialog({
  open,
  point,
  policy,
  role,
  serverNowUtc,
  loading = false,
  errors = [],
  onClose,
  onSubmit
}: PointLoggingDialogProps): JSX.Element | null {
  const titleId = useId()
  const enabledId = useId()
  const intervalId = useId()
  const retentionId = useId()
  const futureId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const firstControlRef = useRef<HTMLInputElement>(null)
  const intervalRef = useRef<HTMLSelectElement>(null)
  const futureRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openIdentityRef = useRef<string | null>(null)
  const serverNowAnchorRef = useRef(serverNowUtc)
  const [step, setStep] = useState<1 | 2>(1)
  const [enabled, setEnabled] = useState(policy.dbLoggingEnabled)
  const [interval, setInterval] = useState<HistorianInterval>(policy.dbInterval)
  const [retentionDays, setRetentionDays] = useState(policy.retentionDays)
  const [localRetentionError, setLocalRetentionError] = useState('')
  const [startMode, setStartMode] = useState<StartMode>(initialStartMode(policy, serverNowUtc))
  const [futureStart, setFutureStart] = useState(toUTCInputValue(policy.startAtUtc))
  const [localStartError, setLocalStartError] = useState('')
  const editable = roleCan(role, 'settings.manage')

  useEffect(() => {
    if (!open) {
      openIdentityRef.current = null
      return
    }
    const identity = `${point.id}:${policy.generation}`
    if (openIdentityRef.current === identity) return
    openIdentityRef.current = identity
    serverNowAnchorRef.current = serverNowUtc
    setStep(1)
    setEnabled(policy.dbLoggingEnabled)
    setInterval(policy.dbInterval)
    setRetentionDays(policy.retentionDays)
    setLocalRetentionError('')
    setStartMode(initialStartMode(policy, serverNowUtc))
    setFutureStart(toUTCInputValue(policy.startAtUtc))
    setLocalStartError('')
  }, [open, point.id, policy.generation, policy.dbInterval, policy.dbLoggingEnabled, policy.startAtUtc, serverNowUtc])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = editable ? firstControlRef.current : closeRef.current
    target?.focus()
    return () => previousFocus?.focus()
  }, [editable, open])

  useEffect(() => {
    if (!open || !editable || step !== 2) return
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
  }, [editable, open, step])

  const intervalError = fieldError(errors, 'interval')
  const retentionError = localRetentionError || fieldError(errors, 'retentionDays')
  const enabledError = fieldError(errors, 'enabled')
  const startError = localStartError || fieldError(errors, 'startAtUtc')

  useEffect(() => {
    if (!open || !editable) return
    if (step === 1 && intervalError) intervalRef.current?.focus()
    if (step === 1 && retentionError) document.getElementById(retentionId)?.focus()
    if (step === 2 && startError) futureRef.current?.focus()
  }, [editable, intervalError, open, retentionError, retentionId, startError, step])

  if (!open) return null

  const globalErrors = errors.filter((error) => error.kind !== 'field' || !error.field || error.field === 'form')
  const dialogName = `Logging - ${point.label ?? point.id}`

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function submit() {
    if (!onSubmit) return
    const retentionMax = maxRetentionDaysFor(policy, interval)
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > retentionMax) {
      setLocalRetentionError(`Retention must be between 1 and ${retentionMax} days.`)
      return
    }
    let startAtUtc: string | null = null
    if (enabled && startMode === 'future') {
      const candidate = utcInputToRFC3339(futureStart)
      if (!candidate || Date.parse(candidate) <= Date.parse(serverNowAnchorRef.current)) {
        setLocalStartError('Start time must be after server time.')
        return
      }
      startAtUtc = candidate
    }
    setLocalStartError('')
    onSubmit({
      pointId: policy.pointId,
      generation: policy.generation,
      dbLoggingEnabled: enabled,
      dbInterval: interval,
      retentionDays,
      startAtUtc
    })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.62)] p-4" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={dialogName}
        tabIndex={-1}
        className="panel-shadow w-full max-w-xl rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 text-[var(--c-text)]"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--c-accent)]">{point.kind} / {point.id}</p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold">{dialogName}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            tabIndex={editable ? -1 : 0}
            className="rounded-[var(--radius)] p-1.5 text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
            aria-label="Close logging dialog"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {globalErrors.length > 0 && (
          <div className="mt-4 space-y-2">
            {globalErrors.map((error, index) => <LoggingErrorAlert key={`${error.kind}-${error.code ?? index}`} error={error} />)}
          </div>
        )}

        {!editable ? (
          <ReadOnlyPolicy policy={policy} role={role} />
        ) : step === 1 ? (
          <div className="mt-5">
            <StepMarker current={1} />
            <label className="mt-5 flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4" htmlFor={enabledId}>
              <input
                ref={firstControlRef}
                id={enabledId}
                type="checkbox"
                aria-label="Enable logging"
                className="mt-0.5 h-4 w-4 accent-[var(--c-accent)]"
                checked={enabled}
                disabled={loading}
                aria-invalid={Boolean(enabledError)}
                aria-describedby={enabledError ? `${enabledId}-error` : undefined}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>
                <span className="block text-sm font-semibold">Enable logging</span>
                <span className="mt-1 block text-xs text-[var(--c-text-dim)]">Capture one coherent runtime snapshot on each due cycle.</span>
              </span>
            </label>
            {enabledError && <FieldError id={`${enabledId}-error`} message={enabledError} />}

            <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-[var(--c-text-dim)]" htmlFor={intervalId}>
              Logging interval
            </label>
            <select
              ref={intervalRef}
              id={intervalId}
              className={controlClass}
              value={interval}
              disabled={loading || !enabled}
              aria-invalid={Boolean(intervalError)}
              aria-describedby={intervalError ? `${intervalId}-error` : undefined}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const next = event.target.value as HistorianInterval
                setInterval(next)
                const max = maxRetentionDaysFor(policy, next)
                setLocalRetentionError(retentionDays > max ? `Retention cannot exceed ${max} days for ${next}.` : '')
              }}
            >
              {HISTORIAN_INTERVALS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            {intervalError && <FieldError id={`${intervalId}-error`} message={intervalError} />}

            <RetentionControl
              id={retentionId}
              interval={interval}
              value={retentionDays}
              policy={policy}
              disabled={loading || !enabled}
              error={retentionError}
              onChange={(value) => {
                setRetentionDays(value)
                const max = maxRetentionDaysFor(policy, interval)
                setLocalRetentionError(value > max ? `Retention cannot exceed ${max} days for ${interval}.` : '')
              }}
            />
          </div>
        ) : (
          <div className="mt-5">
            <StepMarker current={2} />
            {enabled ? (
              <fieldset className="mt-5 space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">Activation</legend>
                <StartChoice
                  checked={startMode === 'immediate'}
                  label="Start immediately"
                  description={`Use controller time ${serverNowAnchorRef.current}.`}
                  disabled={loading}
                  onChange={() => { setStartMode('immediate'); setLocalStartError('') }}
                />
                <StartChoice
                  checked={startMode === 'future'}
                  label="Future UTC time"
                  description="Schedule activation without interpreting browser local time."
                  disabled={loading}
                  onChange={() => setStartMode('future')}
                />
                {startMode === 'future' && (
                  <label className="block pl-7 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-dim)]" htmlFor={futureId}>
                    Start time (UTC)
                    <input
                      ref={futureRef}
                      id={futureId}
                      type="datetime-local"
                      step="60"
                      className={controlClass}
                      value={futureStart}
                      disabled={loading}
                      aria-invalid={Boolean(startError)}
                      aria-describedby={startError ? `${futureId}-error` : undefined}
                      onChange={(event) => { setFutureStart(event.target.value); setLocalStartError('') }}
                    />
                    {startError && <FieldError id={`${futureId}-error`} message={startError} />}
                  </label>
                )}
              </fieldset>
            ) : (
              <div className="mt-5 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 text-sm">
                Logging will be switched off for this point.
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-4 text-xs">
              <span className="text-[var(--c-text-dim)]">Interval</span><strong className="text-right">{interval}</strong>
              <span className="text-[var(--c-text-dim)]">Retention</span><strong className="text-right">{retentionDays} days</strong>
              <span className="text-[var(--c-text-dim)]">Generation</span><strong className="text-right">{policy.generation}</strong>
              <span className="text-[var(--c-text-dim)]">Start</span><strong className="break-all text-right">{enabled ? (startMode === 'immediate' ? 'Immediately' : `${futureStart || 'Not set'} UTC`) : 'Off'}</strong>
            </div>
          </div>
        )}

        <footer className="mt-6 flex justify-end gap-2">
          {!editable ? (
            <Button variant="primary" onClick={onClose}>Close</Button>
          ) : step === 1 ? (
            <>
              <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
              <Button variant="primary" onClick={() => setStep(2)} disabled={loading}>Next</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStep(1)} disabled={loading}>Back</Button>
              <Button variant="primary" loading={loading} disabled={!onSubmit} onClick={submit}>Save logging policy</Button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

function StepMarker({ current }: { current: 1 | 2 }) {
  return (
    <div className="grid grid-cols-2 gap-2" aria-label={`Step ${current} of 2`}>
      {['Policy', 'Activation'].map((label, index) => (
        <div key={label} className={`rounded-full px-3 py-1.5 text-center text-xs font-semibold ${current === index + 1 ? 'bg-[var(--c-accent)] text-[var(--c-on-accent)]' : 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'}`}>
          {index + 1}. {label}
        </div>
      ))}
    </div>
  )
}

// Rev A fallback keeps the UI useful with older controllers; new controllers should report this map.
const REV_A_RETENTION_MAX: Record<HistorianInterval, number> = {
  '1s': 30,
  '3s': 60,
  '5s': 90,
  '15s': 180,
  '30s': 365,
  '1m': 730,
  '3m': 1095,
  '5m': 1460,
  '15m': 1825,
  '30m': 2555,
  '60m': 3650
}

function maxRetentionDaysFor(policy: PointLoggingPolicy, interval: HistorianInterval): number {
  const reported = policy.maxRetentionDaysByInterval?.[interval]
  if (Number.isFinite(reported) && reported! > 0) return Math.floor(reported!)
  if (interval === policy.dbInterval && Number.isFinite(policy.maxRetentionDays) && policy.maxRetentionDays! > 0) return Math.floor(policy.maxRetentionDays!)
  return REV_A_RETENTION_MAX[interval]
}

function RetentionControl({
  id,
  interval,
  value,
  policy,
  disabled,
  error,
  onChange
}: {
  id: string
  interval: HistorianInterval
  value: number
  policy: PointLoggingPolicy
  disabled: boolean
  error: string
  onChange: (value: number) => void
}) {
  const max = maxRetentionDaysFor(policy, interval)
  const presetValues = [30, 90, 180].filter((preset) => preset <= max)
  return (
    <fieldset className="mt-5 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">Data retention</legend>
      <p className="mt-1 text-xs text-[var(--c-text-dim)]">
        Rolling retention keeps the newest data for up to {max} days; older data becomes eligible for safe prune after v2 activation.
      </p>
      <p className="mt-1 text-xs text-[var(--c-text-dim)]">At {interval}, maximum {max} days.</p>
      {(interval === '1s' || interval === '3s' || interval === '5s') && <p className="mt-1 text-xs text-[var(--c-warn-fg)]">Fine raw detail remains in the RAM tail; the current archive stores 15-second aggregates for this rolling window.</p>}
      <p className="mt-1 text-xs text-[var(--c-text-dim)]">Shadow/readiness mode does not delete existing history.</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Retention presets">
        {presetValues.map((preset) => (
          <label key={preset} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs">
            <input
              type="radio"
              name={`${id}-preset`}
              aria-label={`${preset} days`}
              checked={value === preset}
              disabled={disabled}
              onChange={() => onChange(preset)}
            />
            {preset} days
          </label>
        ))}
      </div>
      <label className="mt-3 block text-xs font-semibold text-[var(--c-text-dim)]" htmlFor={id}>
        Retention (days, custom allowed)
        <input
          id={id}
          type="number"
          min={1}
          max={max}
          step={1}
          className={controlClass}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      {error && <FieldError id={`${id}-error`} message={error} />}
    </fieldset>
  )
}

function StartChoice({ checked, label, description, disabled, onChange }: { checked: boolean; label: string; description: string; disabled: boolean; onChange: () => void }) {
  return (
    <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3">
      <input type="radio" name="logging-start" aria-label={label} className="mt-0.5 accent-[var(--c-accent)]" checked={checked} disabled={disabled} onChange={onChange} />
      <span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-[var(--c-text-dim)]">{description}</span></span>
    </label>
  )
}

function ReadOnlyPolicy({ policy, role }: { policy: PointLoggingPolicy; role: PointLoggingRole }) {
  return (
    <div className="mt-5">
      <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
        Logging policy is read-only for {role}.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <dt className="text-[var(--c-text-dim)]">State</dt><dd className="text-right font-semibold capitalize">{policy.state}</dd>
        <dt className="text-[var(--c-text-dim)]">Interval</dt><dd className="text-right font-semibold">{policy.dbInterval}</dd>
        <dt className="text-[var(--c-text-dim)]">Retention</dt><dd className="text-right font-semibold">{policy.retentionDays} days</dd>
        <dt className="text-[var(--c-text-dim)]">Start UTC</dt><dd className="break-all text-right font-semibold">{policy.startAtUtc}</dd>
        <dt className="text-[var(--c-text-dim)]">Generation</dt><dd className="text-right font-semibold">{policy.generation}</dd>
      </dl>
    </div>
  )
}

function LoggingErrorAlert({ error }: { error: PointLoggingError }) {
  const heading = {
    capacity: 'Capacity limit',
    storage: 'Storage unavailable',
    conflict: 'Configuration conflict',
    unknown: 'Logging update failed',
    field: 'Invalid policy'
  }[error.kind]
  const Icon = error.kind === 'storage' ? Database : error.kind === 'conflict' ? CalendarClock : AlertTriangle
  return (
    <div role="alert" className="flex gap-3 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span><strong className="block">{heading}</strong><span className="mt-0.5 block">{error.message}</span></span>
    </div>
  )
}

function FieldError({ id, message }: { id: string; message: string }) {
  return <span id={id} role="alert" className="mt-1 block text-xs text-[var(--c-fault-fg)]">{message}</span>
}

function fieldError(errors: PointLoggingError[], field: PointLoggingErrorField): string {
  return errors.find((error) => error.kind === 'field' && error.field === field)?.message ?? ''
}

function initialStartMode(policy: PointLoggingPolicy, serverNowUtc: string): StartMode {
  if (!policy.dbLoggingEnabled) return 'immediate'
  return Date.parse(policy.startAtUtc) > Date.parse(serverNowUtc) ? 'future' : 'immediate'
}

function toUTCInputValue(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(value)
  return match?.[1] ?? ''
}

function utcInputToRFC3339(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null
  const candidate = `${value.length === 16 ? `${value}:00` : value}Z`
  return Number.isFinite(Date.parse(candidate)) ? candidate : null
}

export function pointLoggingErrorsFromApiError(error: unknown): PointLoggingError[] {
  if (!error || typeof error !== 'object') return [{ kind: 'unknown', message: String(error) }]
  const apiError = error as LoggingApiErrorShape
  const fallback = apiError.message || 'Logging policy update failed.'
  if (!Array.isArray(apiError.details) || apiError.details.length === 0) {
    return [{ kind: apiError.status === 507 ? 'storage' : apiError.status === 409 ? 'conflict' : 'unknown', message: fallback }]
  }
  return apiError.details.map((detail) => {
    const reason = detail.reason ?? ''
    const message = detail.message || fallback
    if (reason === 'historian_capacity_exceeded') return { kind: 'capacity', message, code: reason }
    if (reason === 'historian_storage_unavailable') return { kind: 'storage', message, code: reason }
    if (reason === 'config_conflict' || reason === 'point_namespace_conflicted' || reason === 'historian_generation_conflict') {
      return { kind: 'conflict', message, code: reason }
    }
    if (reason === 'historian_interval_invalid' || detail.path?.includes('dbInterval')) {
      return { kind: 'field', field: 'interval', message, code: reason }
    }
    if (reason === 'historian_retention_invalid' || reason === 'historian_retention_exceeded' || detail.path?.includes('retentionDays')) {
      return { kind: 'field', field: 'retentionDays', message, code: reason }
    }
    if (reason === 'historian_start_in_past' || detail.path?.includes('startAtUtc')) {
      return { kind: 'field', field: 'startAtUtc', message, code: reason }
    }
    return { kind: 'field', field: 'form', message, code: reason || undefined }
  })
}
