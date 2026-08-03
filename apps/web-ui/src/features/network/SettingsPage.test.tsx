import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { ConfigDevice } from '../../shared/types'
import { SettingsPage } from './SettingsPage'

const mocks = vi.hoisted(() => ({
  getConfigDevice: vi.fn(),
  putConfigDevice: vi.fn(),
  refetch: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({
  apiClient: { getConfigDevice: mocks.getConfigDevice, putConfigDevice: mocks.putConfigDevice }
}))

let apiState: { data: ConfigDevice | null; loading: boolean; error: Error | null }

vi.mock('../../shared/hooks/useApi', () => ({
  useApi: () => ({ ...apiState, refetch: mocks.refetch })
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
  apiState = { data: { deviceId: 24, deviceName: 'DDC-01', description: 'AHU loop', location: 'Panel A' }, loading: false, error: null }
  mocks.putConfigDevice.mockReset()
  mocks.putConfigDevice.mockResolvedValue({ result: 'success', applied: true, reload: 'none', warnings: [] })
})
afterEach(cleanup)

function renderPage() {
  return render(<I18nProvider><ToastProvider><SettingsPage /></ToastProvider></I18nProvider>)
}

/**
 * WEB-UX-006 — nút Lưu cũ chỉ gọi `toast.push('success', '… (demo)')` và không
 * gửi request nào. Người vận hành đổi tên thiết bị, thấy thông báo xanh, rời
 * trang, và không có gì được lưu.
 */
describe('SettingsPage device configuration', () => {
  it('sends the edited configuration to the real endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    const nameInput = screen.getByLabelText('Device name')
    await user.clear(nameInput)
    await user.type(nameInput, 'DDC-Floor-3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.putConfigDevice).toHaveBeenCalledWith(
      expect.objectContaining({ deviceName: 'DDC-Floor-3', deviceId: 24, location: 'Panel A' })
    ))
    expect(screen.queryByText(/\(demo\)/)).not.toBeInTheDocument()
  })

  it('reports a save failure instead of claiming success', async () => {
    mocks.putConfigDevice.mockRejectedValue(new Error('device_name is required'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Device name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('device_name is required')).toBeInTheDocument())
    expect(screen.queryByText('Device configuration saved')).not.toBeInTheDocument()
  })

  it('keeps Save disabled until something actually changed', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(screen.getByLabelText('Description'), '!')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  /* Cùng luật với `validateConfigDevice` ở backend — chặn tại chỗ thay vì để
     người dùng ăn một vòng request hỏng. */
  it('blocks saving an empty device name', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.clear(screen.getByLabelText('Device name'))
    expect(screen.getByText('Device name is required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(mocks.putConfigDevice).not.toHaveBeenCalled()
  })

  it('blocks a BACnet device id outside 1…4194302', async () => {
    const user = userEvent.setup()
    renderPage()

    const idInput = screen.getByLabelText('Device ID (BACnet)')
    await user.clear(idInput)
    await user.type(idInput, '99999999')
    expect(screen.getByText(/1…4194302/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  /* Nguyên tắc §3.1.3: không để nút chết. 4 thẻ "Mục phụ" trông như nút nhưng
     không có onClick nào. */
  it('no longer renders the dead Secondary items cards', () => {
    renderPage()
    for (const label of ['Secondary items', 'Backup & Restore', 'Licenses']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('surfaces a load error rather than an empty form', () => {
    apiState = { data: null, loading: false, error: new Error('forbidden') }
    renderPage()
    expect(screen.getByText('Could not load device configuration')).toBeInTheDocument()
  })
})
