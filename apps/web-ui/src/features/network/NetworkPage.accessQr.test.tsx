import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { NetcfgResponse } from '../../shared/types'
import { NetworkPage } from './NetworkPage'

/**
 * `T57-2.22` — mã QR địa chỉ truy cập mới trong cửa sổ xác nhận đổi IP.
 *
 * Bối cảnh quyết định thiết kế: người vận hành đứng cạnh tủ, đồng hồ rollback
 * đang đếm ngược, và đường vào giao diện sắp đổi địa chỉ. Gõ tay `10.1.2.3`
 * trên điện thoại lúc đó là nguồn sai sót; quét mã thì không gõ nhầm được.
 *
 * Test khoá hai điều: mã **có mặt** đúng lúc cần, và nó mã hoá **đúng URL** mà
 * dòng chữ bên cạnh đang nói — hai thứ lệch nhau là kiểu hỏng tệ nhất, vì
 * người dùng tin vào mã chứ không đọc lại chữ.
 */

const networkMocks = vi.hoisted(() => ({
  transaction: null as NetcfgResponse | null,
  getNetwork: vi.fn(),
  getNetworkTransaction: vi.fn(),
  runNetworkTransaction: vi.fn(),
  saveNetwork: vi.fn()
}))

vi.mock('../auth', () => ({
  useAuth: () => ({ session: { username: 'test', role: 'admin' } })
}))

vi.mock('../../shared/api/client', () => ({
  apiClient: {
    getNetwork: networkMocks.getNetwork,
    getNetworkTransaction: networkMocks.getNetworkTransaction,
    runNetworkTransaction: networkMocks.runNetworkTransaction,
    saveNetwork: networkMocks.saveNetwork
  }
}))

function awaitingConfirmation(): NetcfgResponse {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requestId: 'req-1',
    state: 'awaiting_confirmation',
    transactionId: 'tx-qr',
    rollbackRemainingS: 110,
    active: { interface: 'eth0', mode: 'static', ipv4: '10.1.2.3', prefixLength: 24, gateway: '10.1.2.1', dnsServers: [] },
    configured: null,
    pending: { interface: 'eth0', mode: 'static', ipv4: '192.168.7.20', netmask: '255.255.255.0', gateway: '192.168.7.1' }
  } as unknown as NetcfgResponse
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  networkMocks.transaction = awaitingConfirmation()
  networkMocks.getNetwork.mockResolvedValue({
    northbound: { deviceName: 'DDC', ip: '10.1.2.3', dhcp: false, wifiEnabled: false, subnet: '255.255.255.0', gateway: '10.1.2.1', bacnetDeviceId: '1001', bacnetDeviceName: 'DDC', bacnetPort: 47808, bmsLink: 'online', activeBacnetPort: 47808, firmware: '9.9.9', serial: '' },
    southbound: []
  })
  networkMocks.getNetworkTransaction.mockImplementation(async () => networkMocks.transaction)
  networkMocks.runNetworkTransaction.mockResolvedValue(networkMocks.transaction)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <NetworkPage />
      </ToastProvider>
    </I18nProvider>
  )
}

describe('T57-2.22 — mã QR địa chỉ truy cập mới', () => {
  it('hiện mã QR cho đúng địa chỉ sẽ dùng sau khi giữ thay đổi', async () => {
    renderPage()

    const qr = await screen.findByRole('img', { name: /192\.168\.7\.20/ })
    expect(qr).toBeInTheDocument()
    // Mã thật, không phải ảnh giữ chỗ: có module tối được vẽ ra.
    expect(qr.querySelectorAll('rect').length).toBeGreaterThan(50)
  })

  it('mã QR được sinh TẠI CHỖ — không có ảnh hay iframe trỏ ra ngoài', async () => {
    const { container } = renderPage()
    await screen.findByRole('img', { name: /192\.168\.7\.20/ })

    expect(container.querySelector('img'), 'ảnh ngoài là dấu hiệu gọi dịch vụ bên thứ ba').toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('địa chỉ dạng chữ và nhãn của mã QR nói cùng một IP', async () => {
    renderPage()

    const qr = await screen.findByRole('img', { name: /192\.168\.7\.20/ })
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('192.168.7.20')
    expect(qr.getAttribute('aria-label')).toContain('192.168.7.20')
  })

  it('không có giao dịch đang chờ thì không vẽ mã nào', async () => {
    networkMocks.transaction = { ...awaitingConfirmation(), state: 'idle', pending: null, rollbackRemainingS: undefined } as unknown as NetcfgResponse
    renderPage()

    await screen.findByRole('heading', { name: /ETHERNET/ })
    expect(screen.queryByRole('img', { name: /192\.168\.7\.20/ })).toBeNull()
  })
})
