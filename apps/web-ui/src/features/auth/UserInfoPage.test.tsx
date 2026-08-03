import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { ToastProvider } from '../../shared/components/Toast'
import { UserInfoPage } from './UserInfoPage'

const mocks = vi.hoisted(() => ({
  changeMyPassword: vi.fn(async () => {}),
  logout: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({
  apiClient: { changeMyPassword: mocks.changeMyPassword }
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    session: { username: 'operator1', role: 'operator', loginAt: '2026-08-01T03:04:05.000Z' },
    logout: mocks.logout,
    login: vi.fn(),
    isAuthenticated: true,
    getAuthHeader: () => ({})
  })
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
  mocks.changeMyPassword.mockClear()
  mocks.changeMyPassword.mockResolvedValue(undefined)
})
afterEach(cleanup)

function renderPage() {
  return render(
    <I18nProvider><ToastProvider><UserInfoPage /></ToastProvider></I18nProvider>
  )
}

/**
 * WEB-UX-003 — trang này từng trưng 3 giá trị bịa trong ô "Phiên": IP
 * `192.168.1.42`, "lần đăng nhập gần nhất" `2026-06-15 17:25:04`, và một đồng hồ
 * đếm ngược auto-logout 15 phút không dẫn tới hành động nào. Hai giá trị đầu là
 * chỉ dấu an ninh — bịa chúng ra là chủ động che dấu hiệu xâm nhập.
 */
describe('UserInfoPage session panel', () => {
  it('drops the fabricated session values', () => {
    renderPage()

    expect(screen.queryByText('192.168.1.42')).not.toBeInTheDocument()
    expect(screen.queryByText('2026-06-15 17:25:04')).not.toBeInTheDocument()
    expect(screen.queryByText(/Last login/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Auto-logout/i)).not.toBeInTheDocument()
  })

  it('shows the real session login time from the auth session', () => {
    renderPage()
    expect(screen.getByText('Logged in at')).toBeInTheDocument()
    // formatDateTime dùng locale vi-VN; chỉ cần khẳng định không phải mốc bịa cũ.
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })
})

/**
 * Trước đây `submitPassword` validate xong là bắn ngay toast thành công mà không
 * gọi API. Người dùng đóng hộp thoại tin rằng mật khẩu đã đổi, trong khi mật
 * khẩu cũ vẫn dùng được — nếu họ đổi vì nghi bị lộ thì thông báo giả đó chính là
 * thứ giữ cửa mở.
 */
describe('UserInfoPage change password', () => {
  it('calls the real endpoint with the current password', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Change password/i }))
    await user.type(screen.getByLabelText('Current password'), 'old-secret')
    await user.type(screen.getByLabelText('New password'), 'new-secret')
    await user.type(screen.getByLabelText('Confirm password'), 'new-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.changeMyPassword).toHaveBeenCalledWith('old-secret', 'new-secret'))
    expect(screen.queryByText(/\(demo\)/)).not.toBeInTheDocument()
  })

  it('reports failure instead of claiming success when the server rejects', async () => {
    mocks.changeMyPassword.mockRejectedValue(new Error('invalid old password'))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Change password/i }))
    await user.type(screen.getByLabelText('Current password'), 'wrong')
    await user.type(screen.getByLabelText('New password'), 'new-secret')
    await user.type(screen.getByLabelText('Confirm password'), 'new-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('invalid old password')).toBeInTheDocument())
    // Hộp thoại phải ở nguyên để người dùng sửa, không được đóng như đã thành công.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuses to submit without the current password', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Change password/i }))
    await user.type(screen.getByLabelText('New password'), 'new-secret')
    await user.type(screen.getByLabelText('Confirm password'), 'new-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.changeMyPassword).not.toHaveBeenCalled()
  })
})
