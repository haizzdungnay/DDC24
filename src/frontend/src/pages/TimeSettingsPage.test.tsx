import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import { I18nProvider } from '../i18n'
import { advanceRfc3339WithOffset, TimeSettingsPage } from './TimeSettingsPage'

const timeConfig = {
  timezone: 'Asia/Ho_Chi_Minh',
  ntpEnabled: true,
  ntpServers: ['pool.ntp.org'],
  systemTime: '',
  revision: 4
}

const timeStatus = {
  nowUtc: '2026-07-18T03:00:00Z',
  nowLocal: '2026-07-18T10:00:00+07:00',
  timezone: 'Asia/Ho_Chi_Minh',
  mode: 'ntp' as const,
  synchronized: true,
  source: 'pool.ntp.org',
  offsetMs: 1.8,
  lastSyncUtc: '2026-07-18T02:58:31Z',
  rtcPresent: true,
  rtcUtc: '2026-07-18T02:59:59Z',
  health: 'healthy' as const,
  warnings: []
}

const api = vi.hoisted(() => ({
  getTimeConfig: vi.fn(),
  getTimeStatus: vi.fn(),
  putTimeConfig: vi.fn()
}))

vi.mock('../api/client', () => ({ apiClient: api }))

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TimeSettingsPage />
      </ToastProvider>
    </I18nProvider>
  )
}

describe('TimeSettingsPage', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    api.getTimeConfig.mockResolvedValue({ ...timeConfig })
    api.getTimeStatus.mockResolvedValue({ ...timeStatus })
    api.putTimeConfig.mockResolvedValue({ result: 'success', applied: true, reload: 'none', warnings: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('advances and displays the controller-local RFC3339 offset instead of converting it back to UTC', () => {
    expect(advanceRfc3339WithOffset('2026-07-27T10:53:27+07:00', 5000)).toBe('2026-07-27T10:53:32.000+07:00')
    expect(advanceRfc3339WithOffset('2026-07-27T03:53:27Z', 5000)).toBe('2026-07-27T03:53:32.000Z')
  })

  it('loads config and status, then refreshes status without a fake sync toast', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Loading time settings')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('pool.ntp.org')).toBeInTheDocument()
    expect(screen.getByText('pool.ntp.org', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText(/^2026-07-18T10:00:/)).toBeInTheDocument()
    expect(screen.getByText(/^UTC 2026-07-18T03:00:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.getTimeConfig).toHaveBeenCalledOnce()
    expect(api.getTimeStatus).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Refresh status' }))

    await waitFor(() => expect(api.getTimeStatus).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/synchronized \(demo\)/i)).not.toBeInTheDocument()
  })

  it('validates explicit RFC3339 offset and confirms manual clock changes before save', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('pool.ntp.org')

    await user.click(screen.getByRole('checkbox', { name: 'Enable NTP' }))
    const manual = screen.getByRole('textbox', { name: 'Manual time' })
    expect(manual).toHaveAttribute('placeholder', '2026-07-18T10:00:00+07:00')

    await user.type(manual, '2026-07-18T10:00:00')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Use RFC3339 with Z or an explicit offset.')).toBeInTheDocument()
    expect(api.putTimeConfig).not.toHaveBeenCalled()

    await user.clear(manual)
    await user.type(manual, '2026-07-18T10:00:00+07:00')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('dialog', { name: 'Confirm manual time change' })).toBeInTheDocument()
    expect(api.putTimeConfig).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.putTimeConfig).toHaveBeenCalledWith({
      timezone: 'Asia/Ho_Chi_Minh',
      ntpEnabled: false,
      ntpServers: ['pool.ntp.org'],
      systemTime: '2026-07-18T10:00:00+07:00',
      baseRevision: 4,
      operationId: expect.any(String)
    }))
  })

  it('shows load and save failures and prevents duplicate save submissions', async () => {
    api.getTimeConfig.mockRejectedValueOnce(new Error('config offline'))
    renderPage()

    expect(await screen.findByText('Could not load time settings')).toBeInTheDocument()
    expect(screen.getByText('config offline')).toBeInTheDocument()
    cleanup()

    api.getTimeConfig.mockResolvedValueOnce({ ...timeConfig })
    let rejectSave!: (error: Error) => void
    api.putTimeConfig.mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject }))
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue('pool.ntp.org')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Timezone' }), 'UTC')
    const save = screen.getByRole('button', { name: 'Save' })
    await user.click(save)
    await user.click(save)
    expect(api.putTimeConfig).toHaveBeenCalledOnce()

    rejectSave(new Error('save rejected'))
    expect(await screen.findByText(/save rejected/i)).toBeInTheDocument()
  })

  it('shows an authoritative timezone outside the curated list instead of a different fallback option', async () => {
    api.getTimeConfig.mockResolvedValueOnce({ ...timeConfig, timezone: 'Asia/Shanghai', revision: 6 })
    api.getTimeStatus.mockResolvedValueOnce({ ...timeStatus, timezone: 'Asia/Shanghai', nowLocal: '2026-07-18T11:00:00+08:00' })
    const user = userEvent.setup()
    renderPage()

    const timezone = await screen.findByRole('combobox', { name: 'Timezone' })
    expect(timezone).toHaveValue('Asia/Shanghai')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.selectOptions(timezone, 'Asia/Ho_Chi_Minh')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.putTimeConfig).toHaveBeenCalledWith(expect.objectContaining({
      timezone: 'Asia/Ho_Chi_Minh',
      baseRevision: 6
    })))
  })
})
