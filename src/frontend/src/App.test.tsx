import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAdmin } from './App'

const authMocks = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'operator' | 'viewer' }))

vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({ session: { username: 'test', role: authMocks.role } })
}))

beforeEach(() => { authMocks.role = 'admin' })
afterEach(cleanup)

describe('RequireAdmin', () => {
  function renderRoute() {
    return render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<div>Dashboard</div>} />
          <Route path="/admin" element={<RequireAdmin><div>Network admin</div></RequireAdmin>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders admin content for an admin session', () => {
    renderRoute()
    expect(screen.getByText('Network admin')).toBeInTheDocument()
  })

  it('redirects a non-admin session', () => {
    authMocks.role = 'viewer'
    renderRoute()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Network admin')).not.toBeInTheDocument()
  })
})
