import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import { I18nProvider } from '../i18n'
import type { NetcfgResponse, NetcfgTransactionRequest } from '../types'
import { NetworkPage } from './NetworkPage'

const networkMocks = vi.hoisted(() => ({
  transaction: null as NetcfgResponse | null,
  getNetworkTransaction: vi.fn(),
  runNetworkTransaction: vi.fn()
}))

vi.mock('../api/client', () => {
  return {
    apiClient: {
      getNetwork: vi.fn(async () => ({
        northbound: { deviceName: 'DDC-Test', ip: '10.1.2.3', dhcp: false, wifiEnabled: false, subnet: '255.255.255.0', gateway: '10.1.2.1', bacnetDeviceId: '1001', bacnetDeviceName: 'DDC-Test', bacnetPort: 47808, bmsLink: 'online' },
        southbound: []
      })),
      getNetworkTransaction: networkMocks.getNetworkTransaction,
      runNetworkTransaction: networkMocks.runNetworkTransaction,
      saveNetwork: vi.fn(async () => ({ result: 'success', applied: true, reload: 'none', warnings: [] }))
    }
  }
})

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'en')
  networkMocks.transaction = idleTransaction()
  networkMocks.getNetworkTransaction.mockReset()
  networkMocks.getNetworkTransaction.mockImplementation(async () => networkMocks.transaction)
  networkMocks.runNetworkTransaction.mockReset()
  networkMocks.runNetworkTransaction.mockImplementation(async (action: string, payload: NetcfgTransactionRequest) => {
    if (!networkMocks.transaction) throw new Error('missing test transaction')
    if (action === 'stage') {
      networkMocks.transaction = {
        ...networkMocks.transaction,
        requestId: 'req-stage',
        state: 'staged',
        transactionId: 'tx-1',
        pending: payload.candidate
      }
    }
    return networkMocks.transaction
  })
})
afterEach(cleanup)

function idleTransaction(): NetcfgResponse {
  return {
    version: 1,
    requestId: 'req-status',
    result: 'accepted',
    reasonCode: 'OK',
    state: 'idle',
    active: { interface: 'eth0', link: 'up', mode: 'static', ipv4: '10.1.2.3', prefixLength: 24, gateway: '10.1.2.1' }
  }
}

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
    expect(screen.getByLabelText('IPv4')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stage' })).toBeDisabled()
  })

  it('loads and locks a transaction staged by another client before Apply', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    const ipv4 = await screen.findByLabelText('IPv4')
    expect(ipv4).toHaveValue('10.1.2.3')
    networkMocks.transaction = {
      ...idleTransaction(),
      requestId: 'req-remote-stage',
      state: 'staged',
      transactionId: 'tx-remote',
      pending: {
        interface: 'eth0',
        mode: 'static',
        ipv4: '10.9.8.7',
        netmask: '255.255.255.0',
        gateway: '10.9.8.1'
      }
    }

    await waitFor(() => expect(ipv4).toHaveValue('10.9.8.7'), { timeout: 2500 })
    expect(ipv4).toBeDisabled()
    expect(screen.getByText('The form is locked to the authoritative pending candidate.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(networkMocks.runNetworkTransaction).toHaveBeenCalledWith('apply', { transactionId: 'tx-remote' }))
  })
})
