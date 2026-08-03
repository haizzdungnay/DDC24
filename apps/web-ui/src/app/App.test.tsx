import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginRoute, RequireAdmin } from './App'

const authMocks = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'operator' | 'viewer' }))

vi.mock('../features/auth', async () => {
  const actual = await vi.importActual<typeof import('../features/auth')>('../features/auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'test', role: authMocks.role }, isAuthenticated: true })
  }
})

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

/**
 * Deep link phải sống sót qua màn đăng nhập.
 *
 * Lỗi tìm được ngày 2026-08-01 khi chạy trình duyệt THẬT trên board: route
 * `/login` viết là `isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />`.
 * Khi `login()` thành công, `setSession` làm route đó render lại với
 * `isAuthenticated = true` và `<Navigate to="/">` chạy đua với `navigate(returnTo)`
 * bên trong `LoginPage` — trên Chromium thật thì `<Navigate to="/">` thắng.
 *
 * Hậu quả: mở `/settings/users` khi chưa đăng nhập, đăng nhập xong lại rơi về
 * Dashboard. Toàn bộ cơ chế `state.from` + `safeReturnPath` thêm ngày 2026-07-31
 * để giữ deep link trở thành vô tác dụng ở đúng đường phổ biến nhất.
 */
describe('LoginRoute giữ deep link sau khi đăng nhập', () => {
  it('đưa về đúng đường dẫn trong state.from thay vì về trang chủ', () => {
    authMocks.role = 'admin'
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/settings/users' } }]}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/" element={<div>Dashboard</div>} />
          <Route path="/settings/users" element={<div>Users page</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Users page')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('về trang chủ khi state.from là đường dẫn ngoài, chặn open redirect', () => {
    authMocks.role = 'admin'
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '//evil.example/x' } }]}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})
