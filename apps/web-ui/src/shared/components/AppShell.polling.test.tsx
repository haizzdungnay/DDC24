import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import type { OverviewContextValue } from '../overview/OverviewProvider'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { OverviewResponse } from '../types'
import { AppShell } from './AppShell'

/* T63-108 (PERF-API-03) — shell không còn vòng poll `/alarms` riêng mỗi 1 s khi
 * snapshot overview đáng tin, và `/system/status` chỉ còn mỗi 30 s. Đỏ ngay khi
 * ai đó nối lại `useApi(apiClient.getAlarms, …, { refreshMs: 1000 })`. */

const mocks = vi.hoisted(() => ({
  getAlarms: vi.fn(),
  getHealth: vi.fn(),
  getMe: vi.fn(),
  overview: null as OverviewContextValue | null,
  // Phiên PHẢI ổn định giữa các lần render như `AuthProvider` thật: `me` dùng nó làm deps.
  auth: { logout: () => {}, session: { username: 'op1', role: 'operator' } }
}))

vi.mock('../api/client', () => ({ apiClient: { getAlarms: mocks.getAlarms, getHealth: mocks.getHealth, getMe: mocks.getMe } }))
vi.mock('../realtime', () => ({ useRealtime: () => ({ connectionState: 'connected' }) }))
vi.mock('../overview/OverviewProvider', () => ({ useOptionalOverview: () => mocks.overview }))
vi.mock('../../features/auth', async () => {
  const actual = await vi.importActual<typeof import('../../features/auth')>('../../features/auth')
  return { ...actual, useAuth: () => mocks.auth }
})

function trustedOverview(total: number, unacked: number): OverviewContextValue {
  const data = {
    controller: { deviceName: 'DDC24' },
    overallState: 'good',
    overallReasonCode: 'ok',
    lastDataAt: null,
    alarms: { critical: 0, high: total, medium: 0, low: 0, info: 0, unacked, total: total + 1, activeOrUnacked: total },
    degraded: []
  } as unknown as OverviewResponse
  return { data, status: 'ready', error: null, receivedAt: Date.now(), refresh: vi.fn(async () => {}) }
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.setItem('mkddc-lang', 'en')
  mocks.getAlarms.mockReset().mockResolvedValue([])
  mocks.getHealth.mockReset().mockResolvedValue({ overall: 'ok', services: {}, deviceName: 'DDC24', firmware: 'FW' })
  mocks.getMe.mockReset().mockResolvedValue({ username: 'op1', role: 'operator' })
  mocks.overview = trustedOverview(3, 1)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider>
        <ThemeProvider>
          <Routes><Route element={<AppShell />}><Route path="/" element={<div>home</div>} /></Route></Routes>
        </ThemeProvider>
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('AppShell polling budget (T63-108)', () => {
  // `total` của snapshot cố ý lớn hơn `activeOrUnacked` một đơn vị: chuông phải hiện số sau.
  it('takes the bell count from the overview snapshot and does not poll /alarms', async () => {
    renderShell()
    await advance(0)
    for (let i = 0; i < 10; i++) await advance(1000)
    expect(mocks.getAlarms).not.toHaveBeenCalled()
    const bell = screen.getByRole('link', { name: 'Alarms' })
    expect(bell).toHaveTextContent('3')
  })

  it('reads /system/status once per 30 s, not every 5 s', async () => {
    renderShell()
    await advance(0)
    expect(mocks.getHealth).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 29; i++) await advance(1000)
    expect(mocks.getHealth).toHaveBeenCalledTimes(1)
    await advance(1000)
    expect(mocks.getHealth).toHaveBeenCalledTimes(2)
  })

  it('falls back to /alarms when the backend marks alarms degraded', async () => {
    mocks.overview = { ...trustedOverview(0, 0), data: { ...trustedOverview(0, 0).data!, degraded: ['alarms'] } }
    mocks.getAlarms.mockResolvedValue([{ id: 'A1', status: 'active', active: true, severity: 'high', time: '', message: '', source: '', value: '', detail: '' }])
    renderShell()
    await advance(0)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(1)
    await advance(1000)
    expect(mocks.getAlarms).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('link', { name: 'Alarms' })).toHaveTextContent('1')
  })
})
