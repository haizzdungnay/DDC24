import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { Point, VirtualPoint } from '../../shared/types'
import { MonitorPage } from './MonitorPage'

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  updatePointConfig: vi.fn(),
  forcePoint: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as VirtualPoint[], refetch: vi.fn() }))

vi.mock('../../shared/api/client', () => ({
  POINT_UNIT_OPTIONS: [{ value: '', label: 'None' }],
  aiUnitFromPointUnit: () => 0,
  pointUnitFromAiUnit: () => '',
  apiClient: api
}))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (loader: unknown) => loader === api.getVirtualPoints
    ? { data: hookState.virtualPoints, loading: false, error: null, refetch: hookState.refetch }
    : { data: hookState.points, loading: false, error: null, refetch: hookState.refetch }
}))
vi.mock('../../shared/realtime', () => ({
  useRealtime: () => ({ allPoints: [], lastPointEventAt: undefined, connectionState: 'connected', forcePoint: vi.fn() })
}))
// WEB-UX-005: trang giờ đọc vai trò để khoá đường ghi. Test này kiểm phần sửa
// metadata điểm nên cần vai trò admin.
vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'admin', role: 'admin', loginAt: '2026-08-01T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
  }
})

const uiPoint: Point = {
  id: 'UI-01', tag: 'UI-01', name: 'Shared Room', kind: 'UI', value: 23, unit: 'degC', quality: 'good',
  source: 'core', updatedAt: new Date().toISOString()
}

function renderPage() {
  return render(<I18nProvider><ToastProvider><MonitorPage /></ToastProvider></I18nProvider>)
}

describe('MonitorPage point metadata recovery', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = [uiPoint]
    hookState.virtualPoints = [{
      id: 'VP9', tag: 'VP_DISABLED', name: ' shared room ', label: ' shared room ', signalType: 'float',
      enabled: false, writable: true, logEnabled: false
    }]
    api.updatePointName.mockResolvedValue({ id: 'UI-01', name: 'Recovered Room' })
    api.updatePointConfig.mockResolvedValue({ id: 'UI-01', name: 'Recovered Room' })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('includes disabled virtual points in conflicts and saves modal recovery as name-only', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('UI-01 also matches VP9')
    const uiRow = screen.getAllByRole('button').find((button) => button.textContent?.includes('UI-01') && button.textContent.includes('Shared Room'))
    expect(uiRow).toBeDefined()
    fireEvent.doubleClick(uiRow!)

    const dialog = await screen.findByRole('dialog', { name: 'UI-01 details' })
    const name = within(dialog).getByRole('textbox', { name: 'Point name' })
    await user.clear(name)
    await user.type(name, 'Recovered Room')
    await user.click(within(dialog).getByRole('button', { name: 'Save basics' }))

    expect(api.updatePointName).toHaveBeenCalledWith('UI-01', 'Recovered Room')
    expect(api.updatePointConfig).not.toHaveBeenCalled()
    expect(name).toHaveValue('Recovered Room')
  })
})
