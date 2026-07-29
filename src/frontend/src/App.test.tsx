import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirePermission } from './App'
import { permissions } from './auth/permissions'
import { loginReturnPath } from './pages/LoginPage'

const authMocks = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'engineer' | 'operator' | 'viewer' }))

vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({ session: { username: 'test', role: authMocks.role } })
}))

beforeEach(() => { authMocks.role = 'admin' })
afterEach(cleanup)

describe('RequirePermission', () => {
  function renderRoute() {
    return render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<div>Dashboard</div>} />
          <Route path="/admin" element={<RequirePermission permission={permissions.settingsManage}><div>Network settings</div></RequirePermission>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it.each(['admin', 'engineer'] as const)('renders settings content for %s', (role) => {
    authMocks.role = role
    renderRoute()
    expect(screen.getByText('Network settings')).toBeInTheDocument()
  })

  it.each(['operator', 'viewer'] as const)('redirects %s from a settings route', (role) => {
    authMocks.role = role
    renderRoute()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Network settings')).not.toBeInTheDocument()
  })
})

describe('loginReturnPath', () => {
  it('restores a protected Network deep link after login', () => {
    expect(loginReturnPath({ from: '/settings/network' })).toBe('/settings/network')
  })

  it('rejects external and recursive login destinations', () => {
    expect(loginReturnPath({ from: '//example.com' })).toBe('/')
    expect(loginReturnPath({ from: '/login' })).toBe('/')
  })
})
