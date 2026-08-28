import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { UserAccessResponse } from '../../shared/types'
import { UsersPage } from './UsersPage'

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUserAccess: vi.fn(),
  createUser: vi.fn(),
  setUserRole: vi.fn(),
  resetUserPassword: vi.fn(),
  deleteUser: vi.fn(),
  refetch: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({
  apiClient: {
    listUsers: mocks.listUsers,
    getUserAccess: mocks.getUserAccess,
    createUser: mocks.createUser,
    setUserRole: mocks.setUserRole,
    resetUserPassword: mocks.resetUserPassword,
    deleteUser: mocks.deleteUser
  }
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ session: { username: 'admin', role: 'admin', loginAt: '2026-08-01T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
}))

let apiState: { data: UserAccessResponse | null; loading: boolean; error: Error | null }

vi.mock('../../shared/hooks/useApi', () => ({
  useApi: () => ({ ...apiState, refetch: mocks.refetch })
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
  /* `T57-3.16`: trang nay đọc một nguồn duy nhất gồm cả dấu vết truy cập, nên
     fixture đi theo hình dạng đó. */
  apiState = {
    data: {
      users: [
        { username: 'admin', role: 'admin', lastLoginAt: '2026-08-19T03:00:00Z', lastLoginRemote: '10.0.0.9', lastFailedLoginAt: null, activeSessions: 1 },
        { username: 'admin2', role: 'admin', lastLoginAt: null, lastLoginRemote: null, lastFailedLoginAt: null, activeSessions: 0 },
        { username: 'op1', role: 'operator', lastLoginAt: '2026-08-18T22:10:00Z', lastLoginRemote: null, lastFailedLoginAt: '2026-08-19T02:59:00Z', activeSessions: 0, mustChangePassword: true },
        { username: 'view1', role: 'viewer', lastLoginAt: null, lastLoginRemote: null, lastFailedLoginAt: null, activeSessions: 0 }
      ],
      sessions: [
        { username: 'admin', role: 'admin', issuedAt: '2026-08-19T03:00:00Z', lastSeenAt: '2026-08-19T03:05:00Z', remote: '10.0.0.9' }
      ],
      sessionsSince: '2026-08-19T02:00:00Z',
      activityWindow: 2000
    },
    loading: false,
    error: null
  }
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.createUser.mockResolvedValue({ username: 'new', role: 'viewer' })
  mocks.setUserRole.mockResolvedValue({ username: 'op1', role: 'admin' })
  mocks.resetUserPassword.mockResolvedValue(undefined)
  mocks.deleteUser.mockResolvedValue(undefined)
})
afterEach(cleanup)

/** Bọc danh sách tài khoản thành đúng hình dạng `getUserAccess` trả về. */
function accessFixture(users: Array<{ username: string; role: 'admin' | 'operator' | 'viewer' }>): UserAccessResponse {
  return {
    users: users.map((user) => ({ ...user, lastLoginAt: null, lastLoginRemote: null, lastFailedLoginAt: null, activeSessions: 0 })),
    sessions: [],
    sessionsSince: '2026-08-19T02:00:00Z',
    activityWindow: 2000
  }
}


function renderPage() {
  return render(<I18nProvider><ToastProvider><UsersPage /></ToastProvider></I18nProvider>)
}

/**
 * WEB-UX-011 — trang này trước đây dài đúng 20 dòng và là vỏ rỗng: bảng dựng từ
 * `getDemoUsers()` kể cả ở bản live, nên trên board thật nó hiển thị năm tài
 * khoản không tồn tại, còn `users.conf` chỉ có mỗi `admin`. Nút "Thêm user",
 * nút sửa và nút liên kết đều không có `onClick`.
 */
describe('UsersPage lists real accounts', () => {
  it('renders the accounts returned by the API, not the demo fixture', () => {
    renderPage()

    // Mỗi tài khoản có một ô chọn vai trò gắn nhãn theo username, nên đây là
    // cách chắc chắn nhất để khẳng định đúng hàng đó tồn tại.
    expect(screen.getByLabelText('Role for admin')).toHaveValue('admin')
    expect(screen.getByLabelText('Role for op1')).toHaveValue('operator')
    expect(screen.getByText('op1')).toBeInTheDocument()
    // Tên trong `getDemoUsers()` cũ.
    expect(screen.queryByText('operator2')).not.toBeInTheDocument()
    expect(screen.queryByText('maintenance')).not.toBeInTheDocument()
  })

  /* Backend chỉ lưu username + role (UserDTO). Một cột luôn hiển thị sai còn tệ
     hơn không có cột. */
  it('drops the columns that have no backing data', () => {
    renderPage()
    expect(screen.queryByText('Full name')).not.toBeInTheDocument()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
  })

  it('surfaces a load failure instead of an empty table', () => {
    apiState = { data: null, loading: false, error: new Error('forbidden') }
    renderPage()
    expect(screen.getByText('Could not load users')).toBeInTheDocument()
  })
})

describe('UsersPage create', () => {
  it('creates a user through the real endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Username'), 'tech1')
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'operator')
    await user.type(within(dialog).getByLabelText('Password'), 'secret123')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith('tech1', 'operator', 'secret123'))
  })

  it('refuses a password shorter than the minimum instead of sending it', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Username'), 'tech1')
    await user.type(within(dialog).getByLabelText('Password'), '123')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(mocks.createUser).not.toHaveBeenCalled()
    /* Khớp TOÀN VĂN chuỗi của toast, không dùng regex bộ phận.
     *
     * Từ `T57-1.9`, luật thiết bị được công bố thường trực ngay dưới ô nhập
     * ("Rule enforced by the device: at least 6 characters…"), nên một regex
     * `/at least 6 characters/` khớp CẢ hai phần tử và test hỏng vì mơ hồ —
     * tệ hơn: nó có thể xanh nhờ đoạn văn tĩnh ngay cả khi guard bị gỡ mất.
     * Khớp toàn văn chỉ trúng đúng thông báo từ chối. */
    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument()
  })

  it('reports a rejected creation rather than claiming success', async () => {
    mocks.createUser.mockRejectedValue(new Error('user exists'))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Username'), 'admin')
    await user.type(within(dialog).getByLabelText('Password'), 'secret123')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('user exists')).toBeInTheDocument()
  })
})

describe('UsersPage role changes', () => {
  it('sends the new role to the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(screen.getByLabelText('Role for op1'), 'admin')
    await waitFor(() => expect(mocks.setUserRole).toHaveBeenCalledWith('op1', 'admin'))
  })

  /**
   * Guard last-admin, phản chiếu `ErrLastAdmin` của backend. Backend vẫn là nơi
   * chặn thật, nhưng khoá ở đây để người quản trị không tự đưa mình vào tình
   * huống mất hẳn đường quản trị rồi mới biết.
   */
  it('locks the role selector when only one admin is left', () => {
    apiState = { data: accessFixture([
      { username: 'admin', role: 'admin' },
      { username: 'op1', role: 'operator' }
    ]), loading: false, error: null }
    renderPage()

    expect(screen.getByLabelText('Role for admin')).toBeDisabled()
    expect(screen.getByLabelText('Role for op1')).toBeEnabled()
  })

  it('keeps role selectors enabled while more than one admin remains', () => {
    renderPage()
    expect(screen.getByLabelText('Role for admin')).toBeEnabled()
    expect(screen.getByLabelText('Role for admin2')).toBeEnabled()
  })
})

describe('UsersPage reset password and delete', () => {
  it('resets a password through the real endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Reset password for op1' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('New password'), 'brand-new-1')
    await user.click(within(dialog).getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(mocks.resetUserPassword).toHaveBeenCalledWith('op1', 'brand-new-1'))
  })

  it('asks for confirmation before deleting and then calls the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Delete op1' }))
    expect(mocks.deleteUser).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('op1')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mocks.deleteUser).toHaveBeenCalledWith('op1'))
  })

  it('refuses to delete the last admin or the signed-in account', () => {
    apiState = { data: accessFixture([
      { username: 'admin', role: 'admin' },
      { username: 'op1', role: 'operator' }
    ]), loading: false, error: null }
    renderPage()

    expect(screen.getByRole('button', { name: 'Delete admin' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete op1' })).toBeEnabled()
  })
})
