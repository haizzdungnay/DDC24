import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import { I18nProvider } from '../i18n'
import type { NetcfgResponse, NetcfgTransactionRequest } from '../types'
import { NetworkPage } from './NetworkPage'

const networkMocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'engineer' | 'operator' | 'viewer',
  network: {
    northbound: { deviceName: 'DDC-Test', ip: '10.1.2.3', dhcp: false, wifiEnabled: false, subnet: '255.255.255.0', gateway: '10.1.2.1', bacnetDeviceId: '1001', bacnetDeviceName: 'DDC-Test', bacnetPort: 47808, bmsLink: 'online' as const },
    southbound: []
  },
  getNetwork: vi.fn(),
  saveNetwork: vi.fn(),
  transaction: null as NetcfgResponse | null,
  getNetworkTransaction: vi.fn(),
  runNetworkTransaction: vi.fn()
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { username: 'test', role: networkMocks.role } })
}))

vi.mock('../api/client', () => {
  return {
    apiClient: {
      getNetwork: networkMocks.getNetwork,
      getNetworkTransaction: networkMocks.getNetworkTransaction,
      runNetworkTransaction: networkMocks.runNetworkTransaction,
      saveNetwork: networkMocks.saveNetwork
    }
  }
})

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'en')
  networkMocks.role = 'admin'
  networkMocks.network.northbound.deviceName = 'DDC-Test'
  networkMocks.getNetwork.mockReset()
  networkMocks.getNetwork.mockImplementation(async () => ({
    northbound: { ...networkMocks.network.northbound },
    southbound: [...networkMocks.network.southbound]
  }))
  networkMocks.saveNetwork.mockReset()
  networkMocks.saveNetwork.mockImplementation(async () => ({ result: 'success', applied: true, reload: 'none', warnings: [] }))
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
    capabilities: ['dns', 'management-hostname'],
    management: { hostname: window.location.hostname, mdnsName: window.location.hostname, stable: true },
    active: { interface: 'eth0', link: 'up', adminUp: true, carrier: true, reasonCode: 'OK', mode: 'static', ipv4: '10.1.2.3', prefixLength: 24, gateway: '10.1.2.1', dnsServers: [] }
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

  it('lets a viewer read aggregate network data without polling transaction state', async () => {
    networkMocks.role = 'viewer'
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('Network')).toBeInTheDocument()
    expect(networkMocks.getNetwork).toHaveBeenCalled()
    expect(networkMocks.getNetworkTransaction).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('IPv4')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stage' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save BACnet/WiFi' })).toBeDisabled()
  })

  it('stages manual DNS as part of the authoritative candidate', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      capabilities: ['dns', 'management-hostname'],
      configured: {
        interface: 'eth0', mode: 'static', ipv4: '10.1.2.3', netmask: '255.255.255.0', gateway: '10.1.2.1',
        dns: { mode: 'manual', servers: ['10.1.2.53'] }
      }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    const dns = await screen.findByLabelText('DNS servers')
    expect(dns).toHaveValue('10.1.2.53')
    await user.clear(dns)
    await user.type(dns, '1.1.1.1, 8.8.8.8')
    await user.click(screen.getByRole('button', { name: 'Stage' }))

    await waitFor(() => expect(networkMocks.runNetworkTransaction).toHaveBeenCalledWith('stage', {
      candidate: expect.objectContaining({ dns: { mode: 'manual', servers: ['1.1.1.1', '8.8.8.8'] } })
    }))
  })

  it('blocks Apply until the page is opened through the advertised stable hostname', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'staged',
      transactionId: 'tx-host-guard',
      pending: { interface: 'eth0', mode: 'static', ipv4: '10.1.2.3', netmask: '255.255.255.0', gateway: '10.1.2.1' },
      capabilities: ['dns', 'management-hostname'],
      management: { hostname: 'mkddc-qa', mdnsName: 'mkddc-qa.local', stable: true }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('MANAGEMENT HOST')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /mkddc-qa\.local/ })).toHaveAttribute('href', expect.stringContaining('mkddc-qa.local'))
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('fails closed when the authority does not advertise management-hostname', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'staged',
      transactionId: 'tx-old-helper',
      pending: { interface: 'eth0', mode: 'static', ipv4: '10.1.2.3', netmask: '255.255.255.0', gateway: '10.1.2.1' },
      capabilities: ['dns'],
      management: undefined
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('MANAGEMENT HOST')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByText('Stable mDNS hostname is not ready; Apply is locked to preserve the management path.')).toBeInTheDocument()
  })

  it('locks mutation after a lost Apply response until a fresh status reconciles it', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'staged',
      transactionId: 'tx-uncertain',
      pending: { interface: 'eth0', mode: 'static', ipv4: '10.1.2.3', netmask: '255.255.255.0', gateway: '10.1.2.1' }
    }
    networkMocks.runNetworkTransaction.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    const apply = await screen.findByRole('button', { name: 'Apply' })
    expect(apply).toBeEnabled()
    await user.click(apply)
    expect(await screen.findByText('Request outcome is unknown; network actions stay locked until a fresh authority status is received.')).toBeInTheDocument()
    expect(apply).toBeDisabled()

    networkMocks.transaction = { ...networkMocks.transaction, requestId: 'req-reconciled', state: 'awaiting_confirmation', rollbackRemainingS: 100 }
    await waitFor(() => expect(screen.queryByText('Request outcome is unknown; network actions stay locked until a fresh authority status is received.')).not.toBeInTheDocument(), { timeout: 2500 })
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('requires two stable unchanged authority samples before retrying an uncertain mutation', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'staged',
      transactionId: 'tx-stable',
      pending: { interface: 'eth0', mode: 'static', ipv4: '10.1.2.3', netmask: '255.255.255.0', gateway: '10.1.2.1' }
    }
    networkMocks.runNetworkTransaction.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    const apply = await screen.findByRole('button', { name: 'Apply' })
    await user.click(apply)
    const warning = 'Request outcome is unknown; network actions stay locked until a fresh authority status is received.'
    expect(await screen.findByText(warning)).toBeInTheDocument()

    networkMocks.transaction = { ...networkMocks.transaction, requestId: 'req-stable-1' }
    await waitFor(() => expect(networkMocks.getNetworkTransaction).toHaveBeenCalledTimes(3), { timeout: 2500 })
    expect(screen.getByText(warning)).toBeInTheDocument()
    expect(apply).toBeDisabled()

    networkMocks.transaction = { ...networkMocks.transaction, requestId: 'req-stable-2' }
    await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument(), { timeout: 2500 })
    expect(apply).toBeEnabled()
  })

  it('drops DHCP automatic DNS when switching the candidate to static', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      configured: { interface: 'eth0', mode: 'dhcp', dns: { mode: 'auto', servers: [] } }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    await user.selectOptions(await screen.findByLabelText('Mode'), 'static')
    expect(screen.getByLabelText('DNS mode')).toHaveValue('preserve')
    expect(screen.getByLabelText('DNS servers')).toBeDisabled()
    await user.type(screen.getByLabelText('IPv4'), '10.1.2.4')
    await user.type(screen.getByLabelText('Subnet Mask'), '255.255.255.0')
    await user.type(screen.getByLabelText('Gateway'), '10.1.2.1')
    await user.click(screen.getByRole('button', { name: 'Stage' }))

    await waitFor(() => expect(networkMocks.runNetworkTransaction).toHaveBeenCalledWith('stage', {
      candidate: expect.not.objectContaining({ dns: expect.anything() })
    }))
  })

  it('uses configured DHCP when active mode is unknown and shows carrier truth', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { interface: 'end1', link: 'down', adminUp: true, carrier: false, reasonCode: 'NO_CARRIER', mode: 'unknown', ipv4: '', prefixLength: 0, gateway: '' },
      configured: { interface: 'end1', mode: 'dhcp' }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('CONFIGURED PROFILE')).toBeInTheDocument()
    expect(screen.getByText('NO_CARRIER')).toBeInTheDocument()
    expect(screen.getByText('absent')).toBeInTheDocument()
    expect(screen.getByLabelText('Mode')).toHaveValue('dhcp')
    expect(screen.getByLabelText('Interface')).toHaveValue('end1')
    expect(screen.getByLabelText('IPv4')).toBeDisabled()
    expect(screen.getByLabelText('IPv4')).toHaveValue('')
    expect(screen.queryByText('0.0.0.0')).not.toBeInTheDocument()
  })

  it('blocks Apply while the managed Ethernet interface has no carrier', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'staged',
      transactionId: 'tx-no-carrier',
      pending: { interface: 'end1', mode: 'static', ipv4: '192.168.50.20', netmask: '255.255.255.0', gateway: '192.168.50.1' },
      active: { interface: 'end1', link: 'down', adminUp: true, carrier: false, reasonCode: 'NO_CARRIER', mode: 'unknown', ipv4: '', prefixLength: 0, gateway: '', dnsServers: [] }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('Ethernet link is not ready; connect the Ethernet cable before Apply.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('does not fabricate a static draft or zero-prefix netmask from unknown active state', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { interface: 'end1', link: 'up', adminUp: true, carrier: true, reasonCode: 'MODE_UNKNOWN', mode: 'unknown', ipv4: '169.254.1.2', prefixLength: 0, gateway: '' }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('No editable network candidate')).toBeInTheDocument()
    expect(screen.getByText('169.254.1.2')).toBeInTheDocument()
    expect(screen.getByText('MODE_UNKNOWN')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mode')).not.toBeInTheDocument()
    expect(screen.queryByText('Static IPv4')).not.toBeInTheDocument()
    expect(screen.queryByText('0.0.0.0')).not.toBeInTheDocument()
  })

  it('does not create a stageable draft from an unsupported configured mode', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { interface: 'end1', link: 'up', adminUp: true, carrier: true, reasonCode: 'MODE_UNKNOWN', mode: 'unknown', ipv4: '', prefixLength: 0, gateway: '' },
      configured: { interface: 'end1', mode: 'unknown' } as unknown as NonNullable<NetcfgResponse['configured']>
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('No editable network candidate')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mode')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stage' })).not.toBeInTheDocument()
  })

  it('resyncs an untouched draft when authoritative active values change', async () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByLabelText('IPv4')).toHaveValue('10.1.2.3')
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { ...idleTransaction().active!, ipv4: '10.2.3.4', prefixLength: 16, gateway: '10.2.0.1' }
    }

    await waitFor(() => expect(screen.getByLabelText('IPv4')).toHaveValue('10.2.3.4'), { timeout: 2500 })
    expect(screen.getByLabelText('Subnet Mask')).toHaveValue('255.255.0.0')
    expect(screen.getByLabelText('Gateway')).toHaveValue('10.2.0.1')
  })

  it('preserves an edited draft while ACTIVE / KERNEL continues ordinary polling', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    const ipv4 = await screen.findByLabelText('IPv4')
    await user.clear(ipv4)
    await user.type(ipv4, '10.8.8.8')
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { ...idleTransaction().active!, ipv4: '10.2.3.4', gateway: '10.2.3.1' }
    }

    expect(await screen.findByText('10.2.3.4/24', {}, { timeout: 2500 })).toBeInTheDocument()
    expect(screen.getByLabelText('IPv4')).toHaveValue('10.8.8.8')
    expect(screen.getByText('EDITABLE DRAFT')).toBeInTheDocument()
    expect(screen.getByText('Editable candidate; this is not a realtime mirror of ACTIVE / KERNEL.')).toBeInTheDocument()
  })

  it('reloads backend-normalized BACnet and WiFi values after save', async () => {
    const user = userEvent.setup()
    networkMocks.saveNetwork.mockImplementation(async () => {
      networkMocks.network.northbound.deviceName = 'DDC-Canonical'
      return { result: 'success', applied: true, reload: 'none', warnings: [] }
    })
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    const deviceName = await screen.findByLabelText('Device Name')
    await user.clear(deviceName)
    await user.type(deviceName, 'DDC Typed')
    await user.click(screen.getByRole('button', { name: 'Save BACnet/WiFi' }))

    await waitFor(() => expect(screen.getByLabelText('Device Name')).toHaveValue('DDC-Canonical'))
    expect(networkMocks.saveNetwork).toHaveBeenCalledTimes(1)
  })
})
