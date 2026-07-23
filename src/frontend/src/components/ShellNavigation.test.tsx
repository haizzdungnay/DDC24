import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ logout: vi.fn() })
}))

beforeEach(() => localStorage.setItem('mkddc-lang', 'en'))
afterEach(cleanup)

function renderNavigation(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <I18nProvider>{node}</I18nProvider>
    </MemoryRouter>
  )
}

describe('shell user navigation', () => {
  it('links header shortcuts to Alarm, Help, and User info', () => {
    renderNavigation(<TopBar connectionState="connected" alarmCount={0} currentUser={{ username: 'admin', role: 'admin' }} />)

    expect(screen.getByRole('link', { name: 'Alarms' })).toHaveAttribute('href', '/alarms')
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help')
    expect(screen.getByRole('link', { name: 'User' })).toHaveAttribute('href', '/me')
  })

  it('does not expose User info in the sidebar', () => {
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    expect(screen.queryByRole('link', { name: 'User info' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'User' })).not.toBeInTheDocument()
  })

  it('shows Model and Firmware in two columns without Serial', () => {
    renderNavigation(<NavRail alarmCount={0} device={{ overall: 'ok', services: {}, firmware: 'FW-TEST' }} />)

    const model = screen.getByText('Model')
    expect(model.parentElement?.parentElement).toHaveClass('grid-cols-2')
    expect(screen.getByText('FW-TEST')).toBeInTheDocument()
    expect(screen.queryByText('FW FW-TEST')).not.toBeInTheDocument()
    expect(screen.queryByText('Serial')).not.toBeInTheDocument()
  })

  it('labels the sidebar alarm destination as Alarm', () => {
    renderNavigation(<NavRail alarmCount={2} device={null} />)
    expect(screen.getByRole('link', { name: 'Alarm2' })).toHaveAttribute('href', '/alarms')
    expect(screen.queryByText('Alarm log')).not.toBeInTheDocument()
  })
})
