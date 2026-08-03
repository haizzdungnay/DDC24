import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORIAN_INTERVALS,
  PointLoggingDialog,
  pointLoggingErrorsFromApiError,
  type PointLoggingPolicy
} from './PointLoggingDialog'

const offPolicy: PointLoggingPolicy = {
  pointId: 'UI-01',
  generation: 2,
  dbLoggingEnabled: false,
  dbInterval: '15s',
  retentionDays: 180,
  startAtUtc: '2026-07-20T02:00:00Z',
  state: 'off',
  health: 'healthy'
}

afterEach(cleanup)

describe('PointLoggingDialog', () => {
  it('builds an enabled future-UTC patch through the two-step flow', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <PointLoggingDialog
        open
        point={{ id: 'UI-01', label: 'Supply temperature', kind: 'UI' }}
        policy={offPolicy}
        role="admin"
        serverNowUtc="2026-07-20T03:00:00Z"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Enable logging' }))
    const interval = screen.getByRole('combobox', { name: 'Logging interval' })
    expect(interval.querySelectorAll('option')).toHaveLength(HISTORIAN_INTERVALS.length)
    expect(HISTORIAN_INTERVALS).toHaveLength(11)
    await user.selectOptions(interval, '3m')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(screen.getByRole('radio', { name: 'Future UTC time' }))
    fireEvent.change(screen.getByLabelText('Start time (UTC)'), { target: { value: '2026-07-21T04:05' } })
    await user.click(screen.getByRole('button', { name: 'Save logging policy' }))

    expect(onSubmit).toHaveBeenCalledWith({
      pointId: 'UI-01',
      generation: 2,
      dbLoggingEnabled: true,
      dbInterval: '3m',
      retentionDays: 180,
      startAtUtc: '2026-07-21T04:05:00Z'
    })
  })

  it('uses a null start for immediate activation and validates future times against server UTC', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <PointLoggingDialog
        open
        point={{ id: 'AO-01', kind: 'AO' }}
        policy={{ ...offPolicy, pointId: 'AO-01' }}
        role="admin"
        serverNowUtc="2026-07-20T03:00:00Z"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Enable logging' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('radio', { name: 'Future UTC time' }))
    fireEvent.change(screen.getByLabelText('Start time (UTC)'), { target: { value: '2026-07-20T02:00' } })
    await user.click(screen.getByRole('button', { name: 'Save logging policy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Start time must be after server time')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('radio', { name: 'Start immediately' }))
    await user.click(screen.getByRole('button', { name: 'Save logging policy' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startAtUtc: null }))
  })

  it('supports retention presets and enforces the interval-dependent maximum', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <PointLoggingDialog
        open
        point={{ id: 'UI-01', kind: 'UI' }}
        policy={{ ...offPolicy, dbInterval: '1s', retentionDays: 30, maxRetentionDaysByInterval: { '1s': 30 } }}
        role="admin"
        serverNowUtc="2026-07-20T03:00:00Z"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Enable logging' }))
    expect(screen.getByText(/rolling retention/i)).toHaveTextContent('30 days')
    fireEvent.change(screen.getByRole('spinbutton', { name: /retention/i }), { target: { value: '31' } })
    expect(screen.getByRole('spinbutton', { name: /retention/i })).toHaveValue(31)
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot exceed 30 days/i)

    await user.click(screen.getByRole('radio', { name: '30 days' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Save logging policy' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ retentionDays: 30 }))
  })

  it('updates the maximum when the interval changes and maps retention field errors', async () => {
    const user = userEvent.setup()
    render(
      <PointLoggingDialog
        open
        point={{ id: 'UI-01', kind: 'UI' }}
        policy={{ ...offPolicy, retentionDays: 180, maxRetentionDaysByInterval: { '1s': 30, '15s': 180 } }}
        role="admin"
        serverNowUtc="2026-07-20T03:00:00Z"
        errors={[{ kind: 'field', field: 'retentionDays', message: 'Retention is too long.' }]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Enable logging' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Logging interval' }), '1s')
    expect(screen.getByText(/maximum 30 days/i)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /retention/i })).toHaveFocus()
    expect(screen.getByRole('spinbutton', { name: /retention/i })).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders structured field, capacity, storage, and conflict errors as alerts', async () => {
    render(
      <PointLoggingDialog
        open
        point={{ id: 'VP-01', kind: 'VP' }}
        policy={{ ...offPolicy, pointId: 'VP-01', dbLoggingEnabled: true }}
        role="admin"
        serverNowUtc="2026-07-20T03:00:00Z"
        errors={[
          { kind: 'field', field: 'interval', message: 'Choose a supported interval.' },
          { kind: 'capacity', message: 'Historian capacity exceeded.' },
          { kind: 'storage', message: 'Storage is unavailable.' },
          { kind: 'conflict', message: 'Policy changed on the controller.' }
        ]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Logging interval' })).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Logging interval' })).toHaveFocus())
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(4)
    expect(alerts.map((alert) => alert.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Historian capacity exceeded.'),
      expect.stringContaining('Storage is unavailable.'),
      expect.stringContaining('Policy changed on the controller.')
    ]))
  })

  it('does not reset an in-progress future schedule when server time polling refreshes', async () => {
    const user = userEvent.setup()
    const props = {
      open: true,
      point: { id: 'UI-01', kind: 'UI' as const },
      policy: offPolicy,
      role: 'admin' as const,
      onClose: vi.fn(),
      onSubmit: vi.fn()
    }
    const { rerender } = render(<PointLoggingDialog {...props} serverNowUtc="2026-07-20T03:00:00Z" />)
    await user.click(screen.getByRole('checkbox', { name: 'Enable logging' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Logging interval' }), '3m')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('radio', { name: 'Future UTC time' }))
    fireEvent.change(screen.getByLabelText('Start time (UTC)'), { target: { value: '2026-07-21T04:05' } })

    rerender(<PointLoggingDialog {...props} serverNowUtc="2026-07-20T03:00:10Z" />)

    expect(screen.getByRole('radio', { name: 'Future UTC time' })).toBeChecked()
    expect(screen.getByLabelText('Start time (UTC)')).toHaveValue('2026-07-21T04:05')
    expect(screen.getByText('3m')).toBeInTheDocument()
  })

  it('maps backend validation reasons into structured UI errors', () => {
    expect(pointLoggingErrorsFromApiError({
      message: 'update rejected',
      status: 507,
      details: [
        { path: '$', reason: 'historian_capacity_exceeded', message: 'capacity exceeded' },
        { path: 'points[0].startAtUtc', reason: 'historian_start_in_past', message: 'start invalid' },
        { path: 'points[0].retentionDays', reason: 'historian_retention_exceeded', message: 'retention too long' },
        { path: '$', reason: 'historian_generation_conflict', message: 'generation changed' }
      ]
    })).toEqual([
      { kind: 'capacity', message: 'capacity exceeded', code: 'historian_capacity_exceeded' },
      { kind: 'field', field: 'startAtUtc', message: 'start invalid', code: 'historian_start_in_past' },
      { kind: 'field', field: 'retentionDays', message: 'retention too long', code: 'historian_retention_exceeded' },
      { kind: 'conflict', message: 'generation changed', code: 'historian_generation_conflict' }
    ])
  })

  it('is read-only for viewer and operator roles', () => {
    const { rerender } = render(
      <PointLoggingDialog
        open
        point={{ id: 'DO-01', kind: 'DO' }}
        policy={{ ...offPolicy, pointId: 'DO-01', dbLoggingEnabled: true }}
        role="viewer"
        serverNowUtc="2026-07-20T03:00:00Z"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Logging policy is read-only for viewer.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Enable logging' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save logging policy' })).not.toBeInTheDocument()

    rerender(
      <PointLoggingDialog
        open
        point={{ id: 'DO-01', kind: 'DO' }}
        policy={{ ...offPolicy, pointId: 'DO-01', dbLoggingEnabled: true }}
        role="operator"
        serverNowUtc="2026-07-20T03:00:00Z"
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Logging policy is read-only for operator.')).toBeInTheDocument()
  })

  it('traps focus, closes on Escape, and restores focus to the opener', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open logging</button>
          <PointLoggingDialog
            open={open}
            point={{ id: 'UI-01', kind: 'UI' }}
            policy={offPolicy}
            role="admin"
            serverNowUtc="2026-07-20T03:00:00Z"
            onClose={() => setOpen(false)}
            onSubmit={vi.fn()}
          />
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open logging' })
    await user.click(opener)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable logging' })).toHaveFocus())

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
