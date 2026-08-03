import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PointLoggingControl } from './PointLoggingControl'
import type { PointLoggingPolicy, PointLoggingState } from './PointLoggingDialog'

const states: PointLoggingState[] = ['off', 'scheduled', 'recording', 'error']

function policy(state: PointLoggingState): PointLoggingPolicy {
  return {
    pointId: 'UI-01',
    generation: 1,
    dbLoggingEnabled: state !== 'off',
    dbInterval: '15s',
    retentionDays: 180,
    startAtUtc: '2026-07-21T03:00:00Z',
    state,
    health: state === 'error' ? 'fault' : 'healthy',
    lastError: state === 'error' ? 'Writer unavailable' : undefined
  }
}

afterEach(cleanup)

describe('PointLoggingControl', () => {
  it.each(['UI', 'AO', 'DO', 'VP'] as const)('uses the shared control for %s points', (kind) => {
    const id = kind === 'VP' ? 'VP1' : `${kind}-01`
    render(<PointLoggingControl point={{ id, kind }} policy={{ ...policy('off'), pointId: id }} role="viewer" serverNowUtc="2026-07-20T03:00:00Z" />)
    expect(screen.getByRole('region', { name: `Logging for ${id}` })).toHaveTextContent(`${kind} / ${id}`)
  })

  it('keeps an off policy off while the inactive v2 writer reports degraded health', () => {
    render(<PointLoggingControl point={{ id: 'UI-01', kind: 'UI' }} policy={{ ...policy('off'), health: 'degraded', lastError: 'historian writer not active' }} role="viewer" serverNowUtc="2026-07-20T03:00:00Z" />)
    expect(screen.getByLabelText('Logging status: off')).toBeInTheDocument()
    expect(screen.queryByLabelText('Logging status: error')).not.toBeInTheDocument()
  })

  it.each(states)('shows the %s textual status', (state) => {
    render(
      <PointLoggingControl
        point={{ id: 'UI-01', label: 'Supply temperature', kind: 'UI' }}
        policy={policy(state)}
        role="viewer"
        serverNowUtc="2026-07-20T03:00:00Z"
      />
    )
    expect(screen.getByText(state, { exact: false })).toBeInTheDocument()
  })

  it('opens an editable dialog only for admins', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <PointLoggingControl
        point={{ id: 'UI-01', label: 'Supply temperature', kind: 'UI' }}
        policy={policy('off')}
        role="admin"
        serverNowUtc="2026-07-20T03:00:00Z"
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Configure logging for Supply temperature' }))
    expect(screen.getByRole('dialog', { name: 'Logging - Supply temperature' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enable logging' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Close logging dialog' }))

    rerender(
      <PointLoggingControl
        point={{ id: 'UI-01', label: 'Supply temperature', kind: 'UI' }}
        policy={policy('off')}
        role="operator"
        serverNowUtc="2026-07-20T03:00:00Z"
        onChange={onChange}
      />
    )
    expect(screen.queryByRole('button', { name: /Configure logging/ })).not.toBeInTheDocument()
    expect(screen.getByText('Read-only for operator')).toBeInTheDocument()
  })

  it('keeps the dialog open and maps a rejected PUT to a structured capacity alert', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn().mockRejectedValue({
      message: 'capacity exceeded',
      status: 507,
      details: [{ path: '$', reason: 'historian_capacity_exceeded', message: 'No historian capacity remains.' }]
    })
    render(<PointLoggingControl point={{ id: 'AO-01', kind: 'AO' }} policy={{ ...policy('off'), pointId: 'AO-01' }} role="admin" serverNowUtc="2026-07-20T03:00:00Z" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Configure logging for AO-01' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Save logging policy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No historian capacity remains.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
