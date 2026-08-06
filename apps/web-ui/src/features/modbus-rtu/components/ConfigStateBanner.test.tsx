import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStateBanner } from './ConfigStateBanner'
import { ModbusConfigProvider } from '../useModbusConfig'

const api = vi.hoisted(() => ({
  getModbusCandidate: vi.fn(),
  getModbusConfigState: vi.fn(),
  getModbusPorts: vi.fn(),
  saveModbusCandidate: vi.fn(),
  applyModbusConfig: vi.fn(),
  discardModbusCandidate: vi.fn()
}))
vi.mock('../../../shared/api/client', () => ({ apiClient: api }))

const auth = vi.hoisted(() => ({ role: 'admin' as string }))
vi.mock('../../auth', () => ({
  useAuth: () => ({ session: { role: auth.role } }),
  roleAtLeast: (role: string | undefined, min: string) => {
    const order = ['viewer', 'operator', 'admin']
    return order.indexOf(role ?? '') >= order.indexOf(min)
  }
}))

function renderBanner() {
  render(
    <ModbusConfigProvider>
      <ConfigStateBanner />
    </ModbusConfigProvider>
  )
}

describe('ConfigStateBanner', () => {
  beforeEach(() => {
    auth.role = 'admin'
    api.getModbusCandidate.mockResolvedValue({ config: {}, base_revision: 4 })
    api.getModbusPorts.mockResolvedValue([])
    api.getModbusConfigState.mockResolvedValue({
      state: 'CLEAN',
      active_revision: 4,
      active_checksum: 'abcdef0123456789',
      diff: [],
      running_on_iobus: { reachable: true, config_revision: 4, generation: 2, in_sync: true }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  /* TF-MBRTU-04 — bản trước hiển thị chuỗi viết cứng "Đồng bộ thành công" và
   * `Active rev {revision ?? 1}`. Câu đầu đúng kể cả khi iobus chạy cấu hình
   * tuần trước; câu sau bịa revision 1 cho hệ thống chưa apply lần nào. */
  it('nói KHÔNG RÕ khi không liên lạc được iobus, thay vì "đã đồng bộ"', async () => {
    api.getModbusConfigState.mockResolvedValue({
      state: 'CLEAN', active_revision: 4, diff: [], running_on_iobus: { reachable: false }
    })
    renderBanner()

    const sync = await screen.findByTestId('iobus-sync')
    expect(sync).toHaveTextContent('không liên lạc được')
    expect(sync).not.toHaveTextContent('Đồng bộ thành công')
  })

  it('báo LỆCH khi iobus chạy revision khác bản đã lưu', async () => {
    api.getModbusConfigState.mockResolvedValue({
      state: 'CLEAN', active_revision: 9, diff: [],
      running_on_iobus: { reachable: true, config_revision: 7, in_sync: false }
    })
    renderBanner()
    expect(await screen.findByTestId('iobus-sync')).toHaveTextContent('LỆCH')
  })

  it('hiện revision thật, không bịa số 1 khi chưa apply lần nào', async () => {
    api.getModbusConfigState.mockResolvedValue({
      state: 'CLEAN', active_revision: 0, diff: [], running_on_iobus: { reachable: false }
    })
    renderBanner()
    expect(await screen.findByTestId('active-revision')).toHaveTextContent('0')
  })

  /* TF-MBRTU-05 — vòng đời candidate: nút Áp dụng chỉ bật khi CÓ thay đổi. */
  it('khoá nút Áp dụng khi không có thay đổi nào chờ', async () => {
    renderBanner()
    await waitFor(() => expect(screen.getByTestId('apply-config')).toBeDisabled())
    expect(screen.getByTestId('config-lifecycle')).toHaveTextContent('Không có thay đổi chờ áp dụng')
  })

  it('liệt kê thay đổi và cho áp dụng khi bản nháp DIRTY', async () => {
    api.getModbusConfigState.mockResolvedValue({
      state: 'DIRTY',
      active_revision: 4,
      diff: [{ kind: 'point', action: 'modified', id: 'MB-KWH', field: 'scale', before: '1', after: '0.1' }],
      running_on_iobus: { reachable: true, config_revision: 4, in_sync: true }
    })
    api.applyModbusConfig.mockResolvedValue({ result: 'success', revision: 5, reload_mode: 'control' })
    renderBanner()

    const applyButton = await screen.findByTestId('apply-config')
    await waitFor(() => expect(applyButton).toBeEnabled())
    expect(screen.getByTestId('config-lifecycle')).toHaveTextContent('Có 1 thay đổi chưa áp dụng')
    expect(screen.getByText(/scale 1 → 0\.1/)).toBeInTheDocument()

    await userEvent.click(applyButton)
    await waitFor(() => expect(api.applyModbusConfig).toHaveBeenCalledTimes(1))
    // MBR-B203: apply phải mang operation_id để lần thử lại là idempotent.
    expect(api.applyModbusConfig.mock.calls[0][0].operation_id).toMatch(/^op-/)
    expect(api.applyModbusConfig.mock.calls[0][0].base_revision).toBe(4)
  })

  /* Restart dịch vụ CÓ gián đoạn I/O; người dùng phải được nói rõ chứ không chỉ
   * thấy "thành công" (MBR-B212). */
  it('nói rõ khi phải restart dịch vụ thay vì áp tại ranh giới transaction', async () => {
    api.getModbusConfigState.mockResolvedValue({
      state: 'DIRTY', active_revision: 4,
      diff: [{ kind: 'device', action: 'added', id: 'mtr-2' }],
      running_on_iobus: { reachable: true, config_revision: 4, in_sync: true }
    })
    api.applyModbusConfig.mockResolvedValue({
      result: 'success', revision: 5, reload_mode: 'service_restart'
    })
    renderBanner()
    await userEvent.click(await screen.findByTestId('apply-config'))
    expect(await screen.findByText(/gián đoạn I\/O/)).toBeInTheDocument()
  })

  /* Đ-04: viewer xem được trạng thái nhưng không có nút mutation nào. */
  it('không hiện nút thao tác cho vai trò viewer', async () => {
    auth.role = 'viewer'
    renderBanner()
    await screen.findByTestId('config-lifecycle')
    expect(screen.queryByTestId('apply-config')).not.toBeInTheDocument()
    expect(screen.queryByText('Lưu nháp')).not.toBeInTheDocument()
  })
})
