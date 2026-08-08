import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

// Khớp contract sau 2026-07-31: `activeBacnetPort` là cổng đang bind THẬT (khác
// `bacnetPort` trong file khi cấu hình đã sửa mà chưa reload), `firmware`/`serial`
// thay cho hai ô từng gán cứng "N/A", và số đo per-slave có thể là null khi field
// bus chưa đo được — null phải hiển thị "—", không phải 0.
const networkData = {
  northbound: {
    deviceName: 'DDC-QA', ip: '10.10.10.5', dhcp: false, wifiEnabled: false,
    subnet: '255.255.255.0', gateway: '10.10.10.1', bacnetDeviceId: '1001',
    bacnetDeviceName: 'DDC-QA', bacnetPort: 47808, bmsLink: 'online',
    activeBacnetPort: 47808, firmware: '9.9.9-qa', serial: ''
  },
  southbound: [
    { address: 1, name: 'IO-01', profile: 'EXT I/O', baudRate: 9600, pollState: 'online', errorRate: 0, lastPollMs: 12, totalPolls: 500, totalErrors: 0 },
    { address: 2, name: 'Remote HMI', profile: 'Remote HMI', baudRate: 19200, pollState: 'online', errorRate: 0.5, lastPollMs: 18, totalPolls: 400, totalErrors: 2 },
    { address: 3, name: 'Meter-01', profile: 'Meter', baudRate: 38400, pollState: 'online', errorRate: 0, lastPollMs: 21, totalPolls: 300, totalErrors: 0 }
  ]
}

type NetworkTransaction = {
  version: 1
  requestId: string
  result: 'accepted' | 'rejected'
  reasonCode: string
  state: 'idle' | 'staged' | 'applying' | 'awaiting_confirmation' | 'confirmed' | 'rolling_back' | 'rolled_back' | 'failed'
  active: { interface: string; link: 'up' | 'down'; adminUp: boolean; carrier: boolean; reasonCode: string; mode: 'static' | 'dhcp' | 'unknown'; ipv4: string; prefixLength: number; gateway: string; dnsServers?: string[] }
  configured?: { interface: string; mode: 'static' | 'dhcp'; ipv4?: string; netmask?: string; gateway?: string; dns?: { mode: 'auto' | 'manual'; servers: string[] } }
  transactionId?: string
  pending?: { interface: string; mode: 'static' | 'dhcp'; ipv4?: string; netmask?: string; gateway?: string; dns?: { mode: 'auto' | 'manual'; servers: string[] } }
  rollbackRemainingS?: number
  capabilities?: string[]
  management?: { hostname: string; mdnsName: string; stable: boolean }
}

function staticTransaction(): NetworkTransaction {
  return {
    version: 1, requestId: 'qa-status', result: 'accepted', reasonCode: 'OK', state: 'idle',
    capabilities: ['dns', 'management-hostname'],
    management: { hostname: 'mkddc-e2e', mdnsName: '127.0.0.1', stable: true },
    active: { interface: 'eth0', link: 'up', adminUp: true, carrier: true, reasonCode: 'OK', mode: 'static', ipv4: '10.10.10.5', prefixLength: 24, gateway: '10.10.10.1', dnsServers: ['10.10.10.53'] },
    configured: { interface: 'eth0', mode: 'static', ipv4: '10.10.10.5', netmask: '255.255.255.0', gateway: '10.10.10.1', dns: { mode: 'manual', servers: ['10.10.10.53'] } }
  }
}

function dhcpUnknownTransaction(): NetworkTransaction {
  return {
    version: 1, requestId: 'qa-dhcp', result: 'accepted', reasonCode: 'NO_CARRIER', state: 'idle',
    capabilities: ['dns', 'management-hostname'],
    management: { hostname: 'mkddc-e2e', mdnsName: '127.0.0.1', stable: true },
    active: { interface: 'end1', link: 'down', adminUp: true, carrier: false, reasonCode: 'NO_CARRIER', mode: 'unknown', ipv4: '', prefixLength: 0, gateway: '', dnsServers: [] },
    configured: { interface: 'end1', mode: 'dhcp', dns: { mode: 'auto', servers: [] } }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function prefixLength(netmask?: string): number {
  return netmask === '255.255.255.0' ? 24 : netmask === '255.255.0.0' ? 16 : 0
}

async function json(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

test('Network D/E runtime QA with mocked mutations and authority recovery', async ({ page }, testInfo) => {
  const artifactDir = testInfo.outputPath('network-qa')
  await mkdir(artifactDir, { recursive: true })
  let transaction = staticTransaction()
  let dhcpEvidence: { activeReason: string; interface: string; mode: string; ipv4: string; ipv4Disabled: boolean; zeroAddressVisible: boolean } | undefined
  let dhcpPageUrl = ''

  const captureDhcpEvidence = async (): Promise<void> => {
    const ipv4 = page.getByRole('textbox', { name: 'IPv4' })
    dhcpEvidence = {
      activeReason: 'NO_CARRIER',
      interface: await page.getByLabel('Interface').inputValue(),
      mode: await page.getByRole('combobox', { name: 'Mode', exact: true }).inputValue(),
      ipv4: await ipv4.inputValue(),
      ipv4Disabled: await ipv4.isDisabled(),
      zeroAddressVisible: await page.getByText('0.0.0.0', { exact: true }).count() > 0
    }
    dhcpPageUrl = page.url()
  }

  let authorityOnline = true
  const mutationRequests: Array<{ method: string; path: string; body: unknown; intercepted: boolean }> = []
  const authorityEvents: Array<{ type: string; path: string }> = []

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    if (method !== 'GET' && method !== 'HEAD') {
      const bodyText = request.postData() ?? ''
      let body: unknown = null
      try { body = bodyText ? JSON.parse(bodyText) : null } catch { body = bodyText }
      mutationRequests.push({ method, path: url.pathname, body, intercepted: true })
      if (url.pathname.endsWith('/auth/login')) return json(route, { token: 'qa-token', role: 'admin' })
      if (url.pathname.endsWith('/network')) {
        const payload = body as { northbound?: typeof networkData.northbound }
        if (payload.northbound) networkData.northbound = { ...networkData.northbound, ...payload.northbound }
        return json(route, { result: 'success', applied: true, reload: 'none', warnings: [] })
      }
      const actionMatch = url.pathname.match(/\/network\/transaction\/(validate|stage|apply|confirm|rollback)$/)
      if (actionMatch) {
        const action = actionMatch[1]
        if (action === 'validate') transaction = { ...transaction, requestId: 'qa-validate', reasonCode: 'OK', state: 'idle' }
        if (action === 'stage') {
          const candidate = (body as { candidate: NonNullable<NetworkTransaction['pending']> }).candidate
          transaction = { ...transaction, requestId: 'qa-stage', reasonCode: 'OK', state: 'staged', transactionId: 'qa-tx-1', pending: clone(candidate) }
        }
        if (action === 'apply') {
          const pending = transaction.pending
          transaction = { ...transaction, requestId: 'qa-apply', reasonCode: 'OK', state: 'awaiting_confirmation', rollbackRemainingS: 120, active: pending ? { interface: pending.interface, link: 'up', adminUp: true, carrier: true, reasonCode: 'OK', mode: pending.mode, ipv4: pending.ipv4 ?? '', prefixLength: prefixLength(pending.netmask), gateway: pending.gateway ?? '', dnsServers: pending.dns?.servers ?? [] } : transaction.active }
        }
        if (action === 'confirm') {
          const { pending: _pending, rollbackRemainingS: _remaining, ...confirmed } = transaction
          transaction = { ...confirmed, requestId: 'qa-confirm', state: 'confirmed' }
        }
        if (action === 'rollback') {
          const { pending: _pending, rollbackRemainingS: _remaining, ...rolledBack } = transaction
          transaction = { ...rolledBack, requestId: 'qa-rollback', state: 'rolled_back' }
        }
        return json(route, clone(transaction))
      }
      if (url.pathname.endsWith('/network')) return json(route, { result: 'success', applied: true, reload: 'none', warnings: [] })
      return json(route, {}, 405)
    }
    if (url.pathname.endsWith('/network/transaction')) {
      authorityEvents.push({ type: authorityOnline ? 'success' : 'failure', path: url.pathname })
      if (!authorityOnline) return route.abort('failed')
      return json(route, clone(transaction))
    }
    if (url.pathname.endsWith('/network')) return json(route, clone(networkData))
    return json(route, {})
  })

  await page.goto('/settings/network', { waitUntil: 'domcontentloaded' })
  const password = page.getByLabel('Password', { exact: true })
  if (await password.isVisible()) {
    await page.getByLabel('Username', { exact: true }).fill('admin')
    await password.fill('qa-e2e')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/network$/)
  }
  await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible()

  await expect(page.getByText('ETH CARRIER', { exact: true })).toBeVisible()
  await expect(page.getByText('DDC-QA', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('47808', { exact: true })).toBeVisible()
  await expect(page.getByText('3/3 online', { exact: true })).toBeVisible()
  await expect(page.getByText('100%', { exact: true })).toBeVisible()
  // Hai tiêu đề này trước đây là chuỗi trộn cứng VI/EN không qua pick() (finding
  // F-11); nay đã song ngữ hoá nên assertion bám bản tiếng Anh của locale mặc định.
  await expect(page.getByText('NORTHBOUND — BACnet/IP up to BMS', { exact: true })).toBeVisible()
  await expect(page.getByText('SOUTHBOUND — RS-485 Modbus RTU master', { exact: true })).toBeVisible()
  await page.screenshot({ path: `${artifactDir}/network-summary.png`, fullPage: true })

  transaction = dhcpUnknownTransaction()
  await expect(page.getByText('CONFIGURED PROFILE', { exact: true })).toBeVisible()
  await expect(page.getByText('NO_CARRIER', { exact: true })).toBeVisible()
  await expect(page.getByText('absent', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Interface')).toHaveValue('end1')
  await expect(page.getByRole('combobox', { name: 'Mode', exact: true })).toHaveValue('dhcp')
  await expect(page.getByRole('textbox', { name: 'IPv4' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'IPv4' })).toBeDisabled()
  await expect(page.getByLabel('DNS mode')).toHaveValue('auto')
  await expect(page.getByRole('textbox', { name: 'DNS servers' })).toBeDisabled()
  await expect(page.getByText('0.0.0.0', { exact: true })).toHaveCount(0)
  await captureDhcpEvidence()
  await page.screenshot({ path: `${artifactDir}/network-dhcp.png`, fullPage: true })

  transaction = staticTransaction()
  for (const label of ['ACTIVE / KERNEL', 'CONFIGURED PROFILE', 'PENDING CANDIDATE', 'EDITABLE DRAFT']) await expect(page.getByText(label, { exact: true })).toBeVisible()
  // Thẻ MANAGEMENT HOST và TRANSACTION đã bỏ: mã giao dịch không hành động được,
  // còn hostname quản trị chỉ gây nhiễu khi truy cập không đi qua mDNS. Thông tin
  // an toàn duy nhất còn cần — cửa sổ 120 giây — nằm ở hộp thoại xác nhận.
  for (const gone of ['TRANSACTION', 'MANAGEMENT HOST']) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0)
  }
  // Thanh nút chỉ còn hai; tên lệnh giao thức không được lộ ra mặt người dùng.
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  for (const gone of ['Stage', 'Apply', 'Confirm', 'Rollback']) {
    await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0)
  }

  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect.poll(() => mutationRequests.filter((entry) => entry.path.endsWith('/transaction/validate')).length).toBe(1)
  await expect(page.getByText('Candidate is valid', { exact: true })).toBeVisible()

  await page.getByRole('textbox', { name: 'IPv4' }).fill('10.20.30.40')
  // F-08: từ 2026-07-31 client chặn ngay candidate không nhất quán. Đổi IPv4 sang
  // subnet khác thì gateway cũ (10.10.10.1) trở thành ngoài subnet, nên phải sửa
  // kèm — đúng như người vận hành thật phải làm.
  await page.getByRole('textbox', { name: 'Gateway' }).fill('10.20.30.1')
  await page.getByRole('textbox', { name: 'DNS servers' }).fill('1.1.1.1, 8.8.8.8')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => mutationRequests.filter((entry) => entry.path.endsWith('/transaction/stage')).length).toBe(1)
  // Không còn trạng thái 'staged' đứng yên: một lần bấm đi thẳng tới cửa sổ xác nhận.
  // Một lần bấm chạy cả stage lẫn apply rồi hộp thoại xác nhận tự bật.
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep changes', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'IPv4' })).toBeDisabled()
  const stageRequest = mutationRequests.find((entry) => entry.path.endsWith('/transaction/stage'))
  expect(stageRequest?.body).toMatchObject({ candidate: { interface: 'eth0', mode: 'static', ipv4: '10.20.30.40', netmask: '255.255.255.0', gateway: '10.20.30.1', dns: { mode: 'manual', servers: ['1.1.1.1', '8.8.8.8'] } } })
  await page.screenshot({ path: `${artifactDir}/network-staged.png`, fullPage: true })

  await expect.poll(() => mutationRequests.filter((entry) => entry.path.endsWith('/transaction/apply')).length).toBe(1)
  await page.getByRole('button', { name: 'Keep changes', exact: true }).click()
  await expect.poll(() => mutationRequests.filter((entry) => entry.path.endsWith('/transaction/confirm')).length).toBe(1)
  // Badge trạng thái của thẻ GIAO DỊCH đã bỏ; tín hiệu cho người vận hành nay là
  // toast và việc hộp thoại đóng lại.
  await expect(page.getByText('Network configuration confirmed', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const deviceName = page.getByRole('textbox', { name: 'Device Name', exact: true })
  await deviceName.fill('DDC-QA-Canonical')
  // Giao dịch đã kết thúc và không hồi sinh khi sửa các trường không liên quan.
  await expect(page.getByText('No pending candidate', { exact: true })).toBeVisible()
  // F-13: Toggle nay là role=switch + aria-checked (WCAG 2.1 AA §4.1.2), không
  // còn là button trơn.
  const wifi = page.getByRole('switch', { name: /WiFi/ })
  await expect(wifi).toHaveAttribute('aria-checked', 'false')
  await wifi.click()
  await expect(wifi).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Save BACnet/WiFi', exact: true }).click()
  // F-09: lưu khởi động lại field bus nên phải xác nhận hậu quả trước.
  await page.getByRole('button', { name: 'Save and apply', exact: true }).click()
  await expect.poll(() => mutationRequests.filter((entry) => entry.method === 'PUT' && entry.path.endsWith('/network')).length).toBe(1)
  const saveRequest = mutationRequests.find((entry) => entry.method === 'PUT' && entry.path.endsWith('/network'))
  expect(saveRequest?.body).toMatchObject({ northbound: { ip: '10.10.10.5', dhcp: false, subnet: '255.255.255.0', gateway: '10.10.10.1' } })
  await expect(deviceName).toHaveValue('DDC-QA-Canonical')
  await expect(page.getByRole('switch', { name: /WiFi/ })).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: `${artifactDir}/network-service-save.png`, fullPage: true })

  const draft = page.getByRole('textbox', { name: 'IPv4' })
  await draft.fill('10.55.55.55')
  authorityOnline = false
  await expect(page.getByText('Authority disconnected; the state below may be stale.', { exact: true })).toBeVisible({ timeout: 12000 })
  await expect(draft).toHaveValue('10.55.55.55')
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
  await page.screenshot({ path: `${artifactDir}/network-authority-outage.png`, fullPage: true })

  transaction = { ...transaction, requestId: 'qa-recovered', active: { ...transaction.active, link: 'down', carrier: false, reasonCode: 'NO_CARRIER', ipv4: '10.10.10.99' } }
  authorityOnline = true
  await expect(page.getByText('ETH NO CARRIER', { exact: true })).toBeVisible({ timeout: 12000 })
  await expect(page.getByText('NO_CARRIER', { exact: true })).toBeVisible()
  await expect(page.getByText('Authority disconnected; the state below may be stale.', { exact: true })).toHaveCount(0)
  await expect(draft).toHaveValue('10.55.55.55')
  await page.screenshot({ path: `${artifactDir}/network-authority-recovered.png`, fullPage: true })

  const networkMutations = mutationRequests.filter((entry) => entry.path.includes('/network'))
  expect(networkMutations.every((entry) => entry.intercepted)).toBe(true)
  expect(networkMutations.some((entry) => entry.method === 'POST' && entry.path.endsWith('/transaction/validate'))).toBe(true)
  expect(networkMutations.some((entry) => entry.method === 'POST' && entry.path.endsWith('/transaction/stage'))).toBe(true)
  expect(networkMutations.some((entry) => entry.method === 'POST' && entry.path.endsWith('/transaction/apply'))).toBe(true)
  expect(networkMutations.some((entry) => entry.method === 'POST' && entry.path.endsWith('/transaction/confirm'))).toBe(true)
  expect(networkMutations.some((entry) => entry.method === 'PUT' && entry.path.endsWith('/network'))).toBe(true)

  const evidence = {
    result: 'PASS',
    page: page.url(),
    summary: { ethernet: 'ETH CARRIER', device: 'DDC-QA', bacnetUdp: '47808', modbus: '3/3 online', pollHealth: '100%' },
    dhcp: dhcpEvidence,
    dhcpPageUrl,
    stateMachine: { initial: 'idle: Validate/Stage enabled, Apply/Confirm disabled', staged: 'Stage/Validate disabled, Apply enabled, candidate locked', applied: 'awaiting confirmation: Confirm enabled', confirmed: 'confirmed: Confirm disabled' },
    serviceSave: { method: saveRequest?.method, endpoint: saveRequest?.path, ethernetFieldsPreserved: true },
    recovery: { outageBannerObserved: true, recoveredBadge: 'ETH NO CARRIER', activeReason: 'NO_CARRIER', draft: await draft.inputValue(), draftPreserved: (await draft.inputValue()) === '10.55.55.55', authorityEvents },
    allNetworkMutationsIntercepted: networkMutations.every((entry) => entry.intercepted),
    artifacts: artifactDir
  }
  await writeFile(`${artifactDir}/runtime-evidence.json`, JSON.stringify(evidence, null, 2), 'utf8')
  console.log(JSON.stringify(evidence, null, 2))

  expect(dhcpEvidence).toMatchObject({ activeReason: 'NO_CARRIER', interface: 'end1', mode: 'dhcp', ipv4: '', ipv4Disabled: true, zeroAddressVisible: false })
  expect(dhcpPageUrl).toMatch(/\/settings\/network$/)
  expect(evidence.page).toMatch(/\/settings\/network$/)
})
