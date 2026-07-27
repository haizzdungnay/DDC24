import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { DashboardPage } from './DashboardPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { username: 'admin', role: 'admin' } })
}))

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getPoints: vi.fn(),
  getAlarms: vi.fn(),
  refetch: vi.fn()
}))

const uiPoints = Array.from({ length: 4 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  return {
    id: `UI-${number}`,
    tag: `UI-${number}`,
    name: `Sensor ${number}`,
    kind: 'UI' as const,
    value: 20 + index,
    unit: 'degC',
    quality: 'good' as const,
    source: 'test',
    updatedAt: '2026-07-23T08:00:00Z'
  }
})

const points = [
  ...uiPoints,
  { ...uiPoints[0], id: 'AO-01', tag: 'AO-01', name: 'Valve command', kind: 'AO' as const, value: 42, unit: '%' },
  { ...uiPoints[0], id: 'DO-01', tag: 'DO-01', name: 'Supply fan', kind: 'DO' as const, value: true, unit: undefined },
  { ...uiPoints[0], id: 'VP1', tag: 'Calculated load', name: 'Calculated load', kind: 'virtual' as const, value: 68, unit: '%' }
]

vi.mock('../api/client', () => ({
  apiClient: {
    getHealth: mocks.getHealth,
    getPoints: mocks.getPoints,
    getAlarms: mocks.getAlarms
  }
}))

vi.mock('../hooks/useApi', () => ({
  useApi: (fetcher: unknown) => {
    const data = fetcher === mocks.getPoints
      ? points
      : fetcher === mocks.getHealth
        ? { overall: 'ok', services: {} }
        : []
    return { data, loading: false, error: null, refetch: mocks.refetch }
  }
}))

vi.mock('../realtime', () => ({
  useRealtime: () => ({ allPoints: [], lastPointEventAt: null })
}))

vi.mock('../components/ControllerDiagram', () => ({
  ControllerDiagram: () => <div>Controller diagram</div>
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
})
afterEach(cleanup)

describe('Dashboard live trend point picker', () => {
  it('allows changing the displayed points while enforcing a maximum of four', async () => {
    const user = userEvent.setup()
    const view = render(
      <MemoryRouter>
        <I18nProvider><DashboardPage /></I18nProvider>
      </MemoryRouter>
    )

    await user.click(await screen.findByRole('button', { name: 'Points 4/4' }))
    expect(screen.getByRole('heading', { name: 'POINT TREND' })).toBeInTheDocument()
    const analogOutput = screen.getByRole('checkbox', { name: /AO-01/ })
    expect(analogOutput).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /UI-01/ }))
    expect(analogOutput).toBeEnabled()
    await user.click(analogOutput)

    expect(screen.getByText('4/4')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /DO-01/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /VP1/ })).toBeDisabled()

    await waitFor(() => expect(JSON.parse(localStorage.getItem('mkddc:dashboard-trend-points:v1') ?? '[]')).toEqual(['UI-02', 'UI-03', 'UI-04', 'AO-01']))
    view.unmount()

    render(
      <MemoryRouter>
        <I18nProvider><DashboardPage /></I18nProvider>
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Points 4/4' }))
    expect(screen.getByRole('checkbox', { name: /UI-01/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /AO-01/ })).toBeChecked()
  })
})
