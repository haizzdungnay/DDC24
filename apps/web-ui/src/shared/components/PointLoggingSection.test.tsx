import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistorianConfig, UserRole } from '../types'
import { PointLoggingSection } from './PointLoggingSection'

const mocks = vi.hoisted(() => ({
  role: 'viewer' as UserRole,
  getHistorianConfig: vi.fn(),
  putHistorianConfig: vi.fn()
}))

vi.mock('../../features/auth', () => ({
  useAuth: () => ({ session: { username: 'test', role: mocks.role } })
}))

vi.mock('../api/client', () => ({
  apiClient: {
    getHistorianConfig: mocks.getHistorianConfig,
    putHistorianConfig: mocks.putHistorianConfig
  }
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.role = 'viewer'
})

function config(pointId: string): HistorianConfig {
  return {
    revision: 7,
    serverNowUtc: '2026-07-20T03:00:00Z',
    namespaceRevision: 4,
    capacity: { enabledPoints: 0, reservedBytes: 0, budgetBytes: 1024 ** 3, freeBytes: 2 * 1024 ** 3, requiredFreeBytes: 512 * 1024 ** 2 },
      retentionMaxDaysByInterval: { '1s': 30, '15s': 180 },
      points: [{ pointId, generation: 2, dbLoggingEnabled: false, dbInterval: '15s', retentionDays: 180, hotCacheEnabled: true, hotCacheHours: 48, startAtUtc: '2026-07-20T03:00:00Z', state: 'off', health: 'degraded', lastError: 'historian writer not active' }]
  }
}

describe('PointLoggingSection integration', () => {
  it.each([
    ['UI-01', 'UI'], ['AO-01', 'AO'], ['DO-01', 'DO'], ['VP1', 'VP']
  ] as const)('loads the shared policy for %s', async (pointId, kind) => {
    mocks.getHistorianConfig.mockResolvedValue(config(pointId))
    render(<PointLoggingSection pointId={pointId} label={pointId} kind={kind} />)
    expect(await screen.findByRole('region', { name: `Logging for ${pointId}` })).toHaveTextContent('off')
    if (kind === 'VP') expect(screen.getByText(/independent from the Virtual Point diagnostic log/i)).toBeInTheDocument()
  })

  it('allows an admin to submit an atomic revisioned point patch', async () => {
    const user = userEvent.setup()
    mocks.role = 'admin'
    mocks.getHistorianConfig.mockResolvedValue(config('AO-01'))
    mocks.putHistorianConfig.mockResolvedValue({ ...config('AO-01'), revision: 8 })
    render(<PointLoggingSection pointId="AO-01" label="Damper" kind="AO" />)
    await user.click(await screen.findByRole('button', { name: 'Configure logging for Damper' }))
    await user.click(screen.getByRole('checkbox', { name: 'Enable logging' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Logging interval' }), '3m')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Save logging policy' }))
    await waitFor(() => expect(mocks.putHistorianConfig).toHaveBeenCalledWith({
      baseRevision: 7,
      baseNamespaceRevision: 4,
      points: [{ pointId: 'AO-01', generation: 2, dbLoggingEnabled: true, dbInterval: '3m', retentionDays: 180, startAtUtc: null }]
    }))
  })

  it.each(['viewer', 'operator'] as const)('keeps %s read-only without issuing a PUT', async (role) => {
    mocks.role = role
    mocks.getHistorianConfig.mockResolvedValue(config('DO-01'))
    render(<PointLoggingSection pointId="DO-01" label="Fan" kind="DO" />)
    expect(await screen.findByText(`Read-only for ${role}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Configure logging/ })).not.toBeInTheDocument()
    expect(mocks.putHistorianConfig).not.toHaveBeenCalled()
  })
})
