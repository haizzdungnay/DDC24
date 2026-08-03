import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { LoginPage } from './LoginPage'

const mocks = vi.hoisted(() => ({ login: vi.fn(async () => {}) }))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ login: mocks.login, logout: vi.fn(), session: null, isAuthenticated: false, getAuthHeader: () => ({}) })
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
  mocks.login.mockClear()
})
afterEach(cleanup)

function renderLogin() {
  return render(
    <MemoryRouter>
      <I18nProvider><LoginPage /></I18nProvider>
    </MemoryRouter>
  )
}

/**
 * WEB-UX-002 — trang đăng nhập không được khẳng định thứ nó không biết.
 *
 * Trang này render TRƯỚC khi có phiên, trong khi mọi endpoint trạng thái đều đòi
 * tối thiểu quyền `viewer`. Bốn badge `core / iobus / web / IOP` gán cứng
 * `state="online"` vì vậy là khẳng định bịa 100%: một board đã chết vẫn khoe
 * "tất cả online" ngay màn hình đầu tiên kỹ thuật viên nhìn thấy.
 */
describe('LoginPage does not fabricate device state', () => {
  it('renders no service status badges before authentication', () => {
    renderLogin()

    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument()
    for (const service of ['core', 'iobus', 'web', 'IOP']) {
      expect(screen.queryByText(service)).not.toBeInTheDocument()
    }
  })

  it('does not show per-device values that are unknowable before login', () => {
    renderLogin()

    // Giá trị dự phòng của biến build-time `VITE_DEVICE_IP` / `VITE_BACNET_DEVICE_ID`.
    expect(screen.queryByText('192.168.1.100')).not.toBeInTheDocument()
    expect(screen.queryByText('47808')).not.toBeInTheDocument()
    expect(screen.queryByText('BACnet ID')).not.toBeInTheDocument()
  })

  /* Nguyên tắc §3.1.3 của plan 45: không để nút chết. */
  it('removes the controls that were never wired to anything', () => {
    renderLogin()

    expect(screen.queryByText(/remember/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /SSO/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

/**
 * WEB-UX-009 — ô tên đăng nhập trước đây là `value="admin" readOnly`.
 *
 * Backend đã hiện thực đủ ba vai trò với `auth.Require(...)` trên từng endpoint
 * và có cả API tạo tài khoản, nhưng không tài khoản nào đăng nhập được qua Web
 * vì form luôn gửi `admin`. Toàn bộ công RBAC ở backend nằm chết, và trên thực
 * tế mọi người dùng Web đều thao tác dưới quyền cao nhất.
 */
describe('LoginPage multi-user sign-in', () => {
  it('sends the username the operator actually typed', async () => {
    const user = userEvent.setup()
    renderLogin()

    const usernameInput = screen.getByLabelText('Username')
    expect(usernameInput).not.toHaveAttribute('readonly')

    await user.type(usernameInput, 'operator1')
    await user.type(screen.getByLabelText('Password'), 'pw-1234')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('pw-1234', 'operator1'))
  })

  it('no longer hard-codes admin', () => {
    renderLogin()
    expect(screen.getByLabelText('Username')).toHaveValue('')
  })

  it('refuses to submit an empty username instead of silently sending admin', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('Password'), 'pw-1234')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(mocks.login).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a username')).toBeInTheDocument()
  })

  it('trims surrounding whitespace so a stray space does not fail the login', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('Username'), '  admin  ')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('pw', 'admin'))
  })

  /* Biểu tượng con mắt trước đây chỉ là hình vẽ, không bấm được. */
  it('makes the eye icon actually reveal the password', async () => {
    const user = userEvent.setup()
    renderLogin()

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('surfaces a rejected login instead of leaving the form silent', async () => {
    mocks.login.mockRejectedValueOnce(new Error('Đăng nhập thất bại'))
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('Username'), 'viewer1')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Đăng nhập thất bại')).toBeInTheDocument()
  })
})
