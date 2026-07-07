import { useId, useState } from 'react'
import type { JSX } from 'react'
import { Button } from './Button'

export type AlarmDurationAction = 'ack' | 'off'
export type AlarmDurationChoice = { permanent: boolean; durationS?: number }

type DurationValue = '60' | '120' | '300' | '600' | '1200' | 'permanent' | 'custom'

const durationOptions: Array<{ value: DurationValue; label: string }> = [
  { value: '60', label: '1m' },
  { value: '120', label: '2m' },
  { value: '300', label: '5m' },
  { value: '600', label: '10m' },
  { value: '1200', label: '20m' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'custom', label: 'Custom' }
]

export function AlarmDurationDialog(props: {
  action: AlarmDurationAction
  alarmLabel: string
  open: boolean
  loading?: boolean
  onCancel: () => void
  onConfirm: (choice: AlarmDurationChoice) => void
}): JSX.Element | null {
  const { action, alarmLabel, open, loading, onCancel, onConfirm } = props
  const titleId = useId()
  const selectId = useId()
  const customId = useId()
  const [duration, setDuration] = useState<DurationValue>('300')
  const [customMinutes, setCustomMinutes] = useState('1')

  if (!open) return null

  const actionLabel = action === 'ack' ? 'Ack' : 'Off'
  const customMinuteNumber = Number(customMinutes)
  const customValid = Number.isFinite(customMinuteNumber) && customMinuteNumber >= 1
  const confirmDisabled = loading || (duration === 'custom' && !customValid)

  function confirm() {
    if (duration === 'permanent') {
      onConfirm({ permanent: true })
      return
    }

    const durationS = duration === 'custom' ? Math.floor(customMinuteNumber * 60) : Number(duration)
    onConfirm({ permanent: false, durationS })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.62)] p-4" role="presentation" onMouseDown={onCancel}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel-shadow w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold">{actionLabel} alarm</h2>
        <p className="mt-2 text-sm text-[var(--c-text-dim)]">{alarmLabel}</p>

        <label className="mt-5 block text-xs font-semibold uppercase text-[var(--c-text-dim)]" htmlFor={selectId}>
          Duration
        </label>
        <select
          id={selectId}
          className="mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text)] outline-none transition focus:border-[var(--c-accent)]"
          value={duration}
          onChange={(event) => setDuration(event.target.value as DurationValue)}
          disabled={loading}
        >
          {durationOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {duration === 'custom' && (
          <div className="mt-4">
            <label className="block text-xs font-semibold uppercase text-[var(--c-text-dim)]" htmlFor={customId}>
              Minutes
            </label>
            <input
              id={customId}
              className="mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text)] outline-none transition focus:border-[var(--c-accent)]"
              type="number"
              min={1}
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
              disabled={loading}
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={action === 'off' ? 'danger' : 'primary'} onClick={confirm} loading={loading} disabled={confirmDisabled}>
            {actionLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}
