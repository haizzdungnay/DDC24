import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import { I18nProvider } from '../i18n'
import type { NetcfgResponse, NetcfgTransactionRequest } from '../types'
import { NetworkPage } from './NetworkPage'

vi.mock('../api/client', () => {
  let transaction: NetcfgResponse = {
    version: 1 as const,
    requestId: 'req-status',
    result: 'accepted' as const,
    reasonCode: 'OK',
    state: 'idle' as const,
    active: { interface: 'eth0', link: 'up' as const, mode: 'static' as const, ipv4: '10.1.2.3', prefixLength: 24, gateway: '10.1.2.1' }
  }
  return {
    apiClient: {
      getNetwork: vi.fn(async () => ({
        northbound: { deviceName: 'DDC-Test', ip: '10.1.2.3', dhcp: false, wifiEnabled: false, subnet: '255.255.255.0', gateway: '10.1.2.1', bacnetDeviceId: '1001', bacnetDeviceName: 'DDC-Test', bacnetPort: 47808, bmsLink: 'online' },
        southbound: []
      })),
      getNetworkTransaction: vi.fn(async () => transaction),
      runNetworkTransaction: vi.fn(async (action: string, payload: NetcfgTransactionRequest) => {
        if (action === 'stage') {
          transaction = { ...transaction, requestId: 'req-stage', state: 'staged' as const, transactionId: 'tx-1', pending: payload.candidate }
        }
        return transaction
      }),
      saveNetwork: vi.fn(async () => ({ result: 'success', applied: true, reload: 'none', warnings: [] }))
    }
  }
})

beforeEach(() => localStorage.setItem('mkddc-lang', 'en'))
afterEach(cleanup)

describe('NetworkPage authority flow', () => {
  it('shows kernel state separately and enables Apply only after Stage', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('ACTIVE / KERNEL')).toBeInTheDocument()
    expect(screen.getByText('PENDING CANDIDATE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Stage' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled())
    expect(screen.getByText('staged')).toBeInTheDocument()
  })
})
