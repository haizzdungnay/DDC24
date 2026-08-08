import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { ModbusSlave, NetcfgResponse, NetcfgTransactionRequest } from '../../shared/types'
import { NetworkPage } from './NetworkPage'

const networkMocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'engineer' | 'operator' | 'viewer',
  network: {
    northbound: { deviceName: 'DDC-Test', ip: '10.1.2.3', dhcp: false, wifiEnabled: false, subnet: '255.255.255.0', gateway: '10.1.2.1', bacnetDeviceId: '1001', bacnetDeviceName: 'DDC-Test', bacnetPort: 47808, bmsLink: 'online' as const, activeBacnetPort: 47808 as number | null, firmware: '9.9.9-test', serial: '' },
    southbound: [] as ModbusSlave[]
  },
  getNetwork: vi.fn(),
  saveNetwork: vi.fn(),
  transaction: null as NetcfgResponse | null,
  getNetworkTransaction: vi.fn(),
  runNetworkTransaction: vi.fn()
}))

vi.mock('../auth', () => ({
  useAuth: () => ({ session: { username: 'test', role: networkMocks.role } })
}))

vi.mock('../../shared/api/client', () => {
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
const realLocation = window.location

/** jsdom luôn phục vụ từ `localhost`; vài test cần origin là chính địa chỉ thiết bị. */
function withOriginHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, hostname, host: hostname, protocol: 'http:', port: '', pathname: '/settings/network' }
  })
}

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

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
  function renderPage() {
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )
  }

  it('exposes only two buttons and runs stage plus apply in one click', async () => {
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

    // Thanh nút CHỈ có hai nút; tên lệnh giao thức không được lộ ra.
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    for (const gone of ['Stage', 'Apply', 'Confirm', 'Rollback']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument()
    }

    // Một lần bấm phải chạy CẢ stage lẫn apply.
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(networkMocks.runNetworkTransaction).toHaveBeenCalledWith('stage', expect.anything()))
    await waitFor(() => expect(networkMocks.runNetworkTransaction).toHaveBeenCalledWith('apply', { transactionId: 'tx-1' }))
  })

  it('locks the form to a transaction staged by another client', async () => {
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

    await waitFor(() => expect(ipv4).toHaveValue('10.9.8.7'), { timeout: 7000 })
    expect(ipv4).toBeDisabled()
    expect(screen.getByText('The form is locked to the authoritative pending candidate.')).toBeInTheDocument()

    // Giao dịch của client khác: form khoá và không cho ghi đè.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
  }, 15000)

  it('lets a viewer read authority state but disables all mutations', async () => {
    networkMocks.role = 'viewer'
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('Network')).toBeInTheDocument()
    expect(networkMocks.getNetworkTransaction).toHaveBeenCalled()
    expect(screen.getByLabelText('IPv4')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
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
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(networkMocks.runNetworkTransaction).toHaveBeenCalledWith('stage', {
      candidate: expect.objectContaining({ dns: { mode: 'manual', servers: ['1.1.1.1', '8.8.8.8'] } })
    }))
  })

  /* Cổng cũ đòi origin PHẢI trùng hostname mDNS nên khoá Apply vĩnh viễn với mọi
     lối vào từ xa (IP LAN, DDNS, reverse proxy) — thiết bị không cấu hình được
     từ xa dù thao tác hoàn toàn an toàn. Nay không khoá, và cũng không mời người
     dùng mở một URL `.local` mà đường truy cập của họ không phân giải được. */
  it('neither locks Save nor advertises an mDNS URL when opened outside the stable hostname', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      capabilities: ['dns', 'management-hostname'],
      management: { hostname: 'mkddc-qa', mdnsName: 'mkddc-qa.local', stable: true }
    }
    renderPage()

    expect(await screen.findByLabelText('IPv4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: /mkddc-qa\.local/ })).not.toBeInTheDocument()
  })

  /* Hai thẻ này là chi tiết chẩn đoán, không phải thứ người vận hành cần đọc mỗi
     lần mở trang: mã giao dịch không hành động được, còn hostname quản trị chỉ
     gây nhiễu khi truy cập không đi qua mDNS. */
  it('drops the MANAGEMENT HOST and TRANSACTION cards from the authority row', async () => {
    renderPage()

    expect(await screen.findByText('ACTIVE / KERNEL')).toBeInTheDocument()
    expect(screen.getByText('CONFIGURED PROFILE')).toBeInTheDocument()
    expect(screen.getByText('PENDING CANDIDATE')).toBeInTheDocument()
    expect(screen.queryByText('MANAGEMENT HOST')).not.toBeInTheDocument()
    expect(screen.queryByText('TRANSACTION')).not.toBeInTheDocument()
  })

  /* Authority từ chối mọi candidate mang tên interface khác cái nó được cấu hình
     (INTERFACE_NOT_ALLOWED), nên ô gõ tự do chỉ dẫn người dùng vào một lỗi phải
     đi hết một vòng server mới biết. */
  it('offers the interface as a list built from what the authority publishes', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { interface: 'eth0', link: 'up', adminUp: true, carrier: true, reasonCode: 'OK', mode: 'static', ipv4: '10.1.2.3', prefixLength: 24, gateway: '10.1.2.1', dnsServers: [] },
      configured: { interface: 'eth1', mode: 'static', ipv4: '10.1.2.3', netmask: '255.255.255.0', gateway: '10.1.2.1' }
    }
    renderPage()

    const select = await screen.findByLabelText('Interface')
    expect(select.tagName).toBe('SELECT')
    expect(Array.from(select.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['eth0', 'eth1'])
  })

  /* Trường hợp DUY NHẤT còn chặn: chứng minh được phiên đang đi qua chính địa chỉ
     sắp bị đổi, tức lưu là tự cắt đường quản trị của mình. */
  it('blocks Save when the session runs through the very address being changed', async () => {
    withOriginHostname('10.1.2.3')
    networkMocks.transaction = {
      ...idleTransaction(),
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

    const ipv4 = await screen.findByLabelText('IPv4')
    await userEvent.setup().clear(ipv4)
    await userEvent.setup().type(ipv4, '10.1.2.9')

    expect(await screen.findByText(/open through the very address being changed \(10\.1\.2\.3\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('keeps Save usable when the authority advertises no management hostname at all', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      capabilities: ['dns'],
      management: undefined
    }
    renderPage()

    expect(await screen.findByLabelText('IPv4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  /* Nguyên nhân gốc của sự cố trên bo Foxlinx 2026-08-08: netcfg trỏ vào `end1`
     trong khi bo đặt tên Ethernet là `eth0`. Thông điệp "hãy cắm cáp" khiến kỹ
     thuật viên đi tìm sai chỗ. */
  it('names the missing interface instead of blaming the Ethernet cable', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { interface: 'end1', link: 'unknown', adminUp: false, carrier: false, reasonCode: 'INTERFACE_NOT_FOUND', mode: 'unknown', ipv4: '', prefixLength: 0, gateway: '', dnsServers: [] }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText(/The device has no interface "end1"/)).toBeInTheDocument()
    expect(screen.queryByText('Ethernet link is not ready; connect the Ethernet cable before Apply.')).not.toBeInTheDocument()
  })

  /* Không có lối này thì một bo mà authority chưa đọc được profile sẽ không bao
     giờ cấu hình được qua Web — trang mạng read-only vĩnh viễn. */
  it('lets an admin author a candidate when the authority has no configured profile', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      active: { interface: 'eth0', link: 'up', adminUp: true, carrier: true, reasonCode: 'NO_ACTIVE_ADDRESS', mode: 'unknown', ipv4: '', prefixLength: 0, gateway: '', dnsServers: [] }
    }
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    expect(await screen.findByText('No editable network candidate')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Author a network candidate' }))

    expect(await screen.findByLabelText('Mode')).toHaveValue('static')
    expect(screen.getByLabelText('Interface')).toHaveValue('eth0')
    expect(screen.getByLabelText('IPv4')).toHaveValue('')
  })

  it('locks mutation after a lost Apply response until a fresh status reconciles it', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'awaiting_confirmation',
      rollbackRemainingS: 110,
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

    const keep = await screen.findByRole('button', { name: 'Keep changes' })
    expect(keep).toBeEnabled()
    await user.click(keep)
    expect(await screen.findByText('Request outcome is unknown; network actions stay locked until a fresh authority status is received.')).toBeInTheDocument()
    expect(keep).toBeDisabled()

    // Trạng thái mới cho thấy confirm THỰC SỰ đã tới authority dù phản hồi bị mất:
    // fingerprint đổi ⇒ khoá được mở ngay, không phải chờ đủ hai mẫu ổn định.
    networkMocks.transaction = { ...networkMocks.transaction, requestId: 'req-reconciled', state: 'confirmed', rollbackRemainingS: undefined }
    await waitFor(() => expect(screen.queryByText('Request outcome is unknown; network actions stay locked until a fresh authority status is received.')).not.toBeInTheDocument(), { timeout: 7000 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('requires two stable unchanged authority samples before retrying an uncertain mutation', async () => {
    const user = userEvent.setup()
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'awaiting_confirmation',
      rollbackRemainingS: 110,
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

    const keep = await screen.findByRole('button', { name: 'Keep changes' })
    await user.click(keep)
    const warning = 'Request outcome is unknown; network actions stay locked until a fresh authority status is received.'
    expect(await screen.findByText(warning)).toBeInTheDocument()

    networkMocks.transaction = { ...networkMocks.transaction, requestId: 'req-stable-1' }
    await waitFor(() => expect(networkMocks.getNetworkTransaction).toHaveBeenCalledTimes(3), { timeout: 7000 })
    expect(screen.getByText(warning)).toBeInTheDocument()
    expect(keep).toBeDisabled()

    networkMocks.transaction = { ...networkMocks.transaction, requestId: 'req-stable-2' }
    await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument(), { timeout: 7000 })
    expect(keep).toBeEnabled()
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
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

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
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
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
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByLabelText('IPv4')).toHaveValue('10.2.3.4'), { timeout: 7000 })
    expect(screen.getByLabelText('Subnet Mask')).toHaveValue('255.255.0.0')
    expect(screen.getByLabelText('Gateway')).toHaveValue('10.2.0.1')
  }, 15000)

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

    expect(await screen.findByText('10.2.3.4/24', {}, { timeout: 7000 })).toBeInTheDocument()
    expect(screen.getByLabelText('IPv4')).toHaveValue('10.8.8.8')
    expect(screen.getByText('EDITABLE DRAFT')).toBeInTheDocument()
    expect(screen.getByText('Editable candidate; this is not a realtime mirror of ACTIVE / KERNEL.')).toBeInTheDocument()
  }, 15000)

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

    // F-09: lưu khởi động lại field bus nên phải qua xác nhận hậu quả trước.
    expect(networkMocks.saveNetwork).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Save and apply' }))

    await waitFor(() => expect(screen.getByLabelText('Device Name')).toHaveValue('DDC-Canonical'))
    expect(networkMocks.saveNetwork).toHaveBeenCalledTimes(1)
  })

  // F-09: huỷ ở hộp thoại thì tuyệt đối không được ghi gì xuống thiết bị.
  it('does not save when the restart confirmation is dismissed', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Save BACnet/WiFi' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(networkMocks.saveNetwork).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('NetworkPage truthful telemetry', () => {
  function renderPage() {
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )
  }

  function slave(overrides: Partial<ModbusSlave>): ModbusSlave {
    return {
      address: 1, name: 'Meter-A', profile: 'Meter', baudRate: 9600,
      pollState: 'online', errorRate: 0, lastPollMs: 10, totalPolls: 100, totalErrors: 0,
      ...overrides
    }
  }

  // F-02: công thức cũ chỉ trừ slave 'offline' trong khi backend không bao giờ
  // phát 'offline', nên Poll health luôn 100% kể cả khi field bus đã hỏng.
  it('reports poll health from the share of slaves that are actually online', async () => {
    networkMocks.network.southbound = [
      slave({ address: 1, pollState: 'online' }),
      slave({ address: 2, pollState: 'offline', errorRate: 100 }),
      slave({ address: 3, pollState: 'offline', errorRate: 100 }),
      slave({ address: 4, pollState: 'offline', errorRate: 100 })
    ]
    renderPage()

    // Bám đúng ô KPI "Poll health": chuỗi "100%" cũng xuất hiện ở cột error rate
    // của các slave offline nên khẳng định toàn trang sẽ mơ hồ.
    const tile = (await screen.findByText('Poll health')).closest('div')?.parentElement
    expect(tile).toHaveTextContent('25%')
    expect(tile).not.toHaveTextContent('100%')
    expect(screen.getByText('1/4 online')).toBeInTheDocument()
  })

  // Chưa có số đo thì KHÔNG được kết luận khoẻ hay hỏng.
  it('shows an em dash instead of a health percentage when no slave has been measured', async () => {
    networkMocks.network.southbound = [
      slave({ address: 1, pollState: 'unknown', errorRate: null, lastPollMs: null, totalPolls: null, totalErrors: null })
    ]
    renderPage()

    await screen.findByText('0/1 online')
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  // F-03: error rate từng bị gán cứng 0 nên thanh lỗi luôn rỗng. Thiếu số đo
  // phải hiện "—", không phải "0.0%".
  it('never renders a zero error rate for a slave that has no measurement', async () => {
    networkMocks.network.southbound = [
      slave({ address: 7, pollState: 'unknown', errorRate: null, lastPollMs: null, totalPolls: null, totalErrors: null })
    ]
    renderPage()

    await screen.findByText('Meter-A')
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('renders the real per-slave error rate measured by the field bus', async () => {
    networkMocks.network.southbound = [
      slave({ address: 12, name: 'PM-212', errorRate: 25, totalPolls: 200, totalErrors: 50, pollState: 'offline' })
    ]
    renderPage()

    expect(await screen.findByText('25%')).toBeInTheDocument()
    expect(screen.getByText('50/200')).toBeInTheDocument()
  })

  // F-10: hai trường này từng gán cứng "N/A".
  it('shows the running firmware version and says when no serial is provisioned', async () => {
    renderPage()

    expect(await screen.findByText('9.9.9-test')).toBeInTheDocument()
    expect(screen.getByText('not provisioned')).toBeInTheDocument()
  })
})

describe('NetworkPage candidate validation and failure reporting', () => {
  function renderPage() {
    render(
      <I18nProvider>
        <ToastProvider>
          <NetworkPage />
        </ToastProvider>
      </I18nProvider>
    )
  }

  // F-08: trước đây gõ địa chỉ sai vẫn phải bấm Validate rồi chờ authority từ chối.
  it('blocks Validate and Stage while the candidate has an invalid IPv4', async () => {
    const user = userEvent.setup()
    renderPage()

    const ipv4 = await screen.findByLabelText('IPv4')
    await user.clear(ipv4)
    await user.type(ipv4, '192.168.1.999')

    expect(await screen.findByText('Not a valid IPv4 address.')).toBeInTheDocument()
    expect(ipv4).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(networkMocks.runNetworkTransaction).not.toHaveBeenCalled()
  })

  it('rejects a gateway outside the candidate subnet before contacting the authority', async () => {
    const user = userEvent.setup()
    renderPage()

    const gateway = await screen.findByLabelText('Gateway')
    await user.clear(gateway)
    await user.type(gateway, '10.9.9.1')

    expect(await screen.findByText('Gateway must be in the same subnet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('rejects the network address of the candidate subnet', async () => {
    const user = userEvent.setup()
    renderPage()

    const ipv4 = await screen.findByLabelText('IPv4')
    await user.clear(ipv4)
    await user.type(ipv4, '10.1.2.0')

    expect(await screen.findByText('Must not be the network or broadcast address.')).toBeInTheDocument()
  })

  // F-05: state 'failed' với result 'accepted' từng không hiển thị bất kỳ lý do
  // nào — đúng những gì quan sát được trên board thật.
  it('explains a failed transaction even when the authority result is accepted', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      result: 'accepted',
      state: 'failed',
      reasonCode: 'HEALTH_CHECK_FAILED',
      message: 'health check failed after apply',
      transactionId: 'tx-failed-1'
    }
    renderPage()

    expect(await screen.findByText('health check failed after apply')).toBeInTheDocument()
    // Lý do nay là BANNER, không nằm trong thẻ GIAO DỊCH đã bỏ — và hướng dẫn nói
    // bằng ngôn ngữ người vận hành ("lưu lại") thay vì tên lệnh giao thức "Stage".
    expect(screen.getByText(/save again/i)).toBeInTheDocument()
    expect(screen.queryByText('TRANSACTION')).not.toBeInTheDocument()
  })

  // F-12: countdown phải là MM:SS, không phải số giây thô.
  it('renders the rollback countdown as MM:SS with an old to new address diff', async () => {
    networkMocks.transaction = {
      ...idleTransaction(),
      state: 'awaiting_confirmation',
      transactionId: 'tx-1',
      rollbackRemainingS: 102,
      pending: { interface: 'eth0', mode: 'static', ipv4: '10.1.2.80', netmask: '255.255.255.0' }
    }
    renderPage()

    // Đếm ngược và đối chiếu cũ→mới nay nằm trong hộp thoại xác nhận tự bật.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('01:42')
    expect(dialog).toHaveTextContent('10.1.2.3/24')
    expect(dialog).toHaveTextContent('10.1.2.80')
    expect(dialog).toHaveTextContent(/rolls back automatically/i)
    expect(screen.getByRole('button', { name: 'Keep changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Roll back now' })).toBeInTheDocument()
  })

  // F-13: WCAG 2.1 AA §4.1.2 — trình đọc màn hình phải biết trạng thái bật/tắt.
  it('exposes the WiFi toggle as a switch with its checked state', async () => {
    renderPage()

    const toggle = await screen.findByRole('switch', { name: /WiFi/ })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })
})
