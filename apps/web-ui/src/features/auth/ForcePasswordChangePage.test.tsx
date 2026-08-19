import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { ForcePasswordChangePage } from './ForcePasswordChangePage'

/**
 * `T57-3.17` (`ADR-047`) — màn hình buộc đổi mật khẩu.
 *
 * Test này khoá phần DẪN ĐƯỜNG, không phải phần bảo vệ: lớp cưỡng chế nằm ở
 * backend (`useraccess_test.go` khoá nó), còn ở đây điều cần đúng là người dùng
 * hiểu ngay việc phải làm và không bị chặn bởi một luật chặt hơn luật thiết bị.
 */

const mocks = vi.hoisted(() => ({
  changeMyPassword: vi.fn(),
  logout: vi.fn(),
  clearPasswordChangeRequirement: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({
  apiClient: { changeMyPassword: mocks.changeMyPassword }
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    session: { username: 'op1', role: 'operator', loginAt: '2026-08-19T00:00:00Z', mustChangePassword: true },
    logout: mocks.logout,
    clearPasswordChangeRequirement: mocks.clearPasswordChangeRequirement,
    isAuthenticated: true,
    login: vi.fn(),
    getAuthHeader: () => ({})
  })
}))

function renderPage() {
  return render(<I18nProvider><ForcePasswordChangePage /></I18nProvider>)
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.changeMyPassword.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('T57-3.17 — màn hình buộc đổi mật khẩu', () => {
  it('nói rõ vì sao bị chặn, kèm tên tài khoản đang đăng nhập', () => {
    renderPage()
    expect(screen.getByText(/mật khẩu do người khác đặt/)).toBeInTheDocument()
    expect(screen.getByText(/op1/)).toBeInTheDocument()
  })

  it('đổi mật khẩu thành công thì gỡ trạng thái chặn ngay, không bắt đăng nhập lại', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'tam12345')
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'matkhau-moi-1')
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'matkhau-moi-1')
    await user.click(screen.getByRole('button', { name: /Đặt mật khẩu mới/ }))

    expect(mocks.changeMyPassword).toHaveBeenCalledWith('tam12345', 'matkhau-moi-1')
    expect(mocks.clearPasswordChangeRequirement).toHaveBeenCalled()
  })

  it('hai lần nhập không khớp thì chặn nút và nói ra, không gọi API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'tam12345')
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'matkhau-moi-1')
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'go-nham')

    expect(screen.getByText('Hai lần nhập chưa khớp.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Đặt mật khẩu mới/ })).toBeDisabled()
    expect(mocks.changeMyPassword).not.toHaveBeenCalled()
  })

  it('KHÔNG siết chặt hơn luật thiết bị: 6 ký tự là đủ để bấm được', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'tam12345')
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'abcdef')
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'abcdef')

    expect(
      screen.getByRole('button', { name: /Đặt mật khẩu mới/ }),
      'ADR-037: chỉ báo độ mạnh là khuyến nghị, không phải cổng chặn'
    ).toBeEnabled()
  })

  it('lỗi từ backend hiện nguyên văn thay vì nuốt đi', async () => {
    mocks.changeMyPassword.mockRejectedValue(new Error('invalid old password'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'sai-mat-khau')
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'matkhau-moi-1')
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'matkhau-moi-1')
    await user.click(screen.getByRole('button', { name: /Đặt mật khẩu mới/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid old password')
    expect(mocks.clearPasswordChangeRequirement).not.toHaveBeenCalled()
  })

  it('vẫn có đường đăng xuất — người mở nhầm tài khoản đồng nghiệp cần lối ra', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    expect(mocks.logout).toHaveBeenCalled()
  })
})
