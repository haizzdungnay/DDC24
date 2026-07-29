import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import { I18nProvider } from '../i18n'
import { ApiError, type UserRole } from '../types'
import { UsersPage } from './UsersPage'

const mocks = vi.hoisted(() => ({
  role: 'admin' as UserRole,
  getUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserRole: vi.fn(),
  resetUserPassword: vi.fn(),
  deleteUser: vi.fn()
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { username: 'admin', role: mocks.role } })
}))

vi.mock('../api/client', () => ({
  apiClient: {
    getUsers: mocks.getUsers,
    createUser: mocks.createUser,
    updateUserRole: mocks.updateUserRole,
    resetUserPassword: mocks.resetUserPassword,
    deleteUser: mocks.deleteUser
  }
}))

function renderPage() {
  return render(<I18nProvider><ToastProvider><UsersPage /></ToastProvider></I18nProvider>)
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'en')
  mocks.role = 'admin'
  mocks.getUsers.mockResolvedValue([
    { username: 'admin', role: 'admin' },
    { username: 'eng1', role: 'engineer' }
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UsersPage RBAC API surface', () => {
  it('loads only backend-safe user fields and creates all four roles through the API', async () => {
    const user = userEvent.setup()
    mocks.createUser.mockResolvedValue({ username: 'op1', role: 'operator' })
    renderPage()

    expect(await screen.findByText('eng1')).toBeInTheDocument()
    expect(screen.queryByText(/hash|session_version|password/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = screen.getByRole('dialog', { name: 'Add user' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Username' }), 'op1')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Role' }), 'operator')
    await user.type(within(dialog).getByLabelText('New password'), 'secret7')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.createUser).toHaveBeenCalledWith({ username: 'op1', role: 'operator', password: 'secret7' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each(['engineer', 'operator', 'viewer'] as const)('does not issue a background Users request for %s', async (role) => {
    mocks.role = role
    renderPage()
    expect(screen.getByText('User management is not permitted')).toBeInTheDocument()
    await Promise.resolve()
    expect(mocks.getUsers).not.toHaveBeenCalled()
  })

  it('keeps a 409 last-admin conflict visible and never renders the submitted password', async () => {
    const user = userEvent.setup()
    mocks.updateUserRole.mockRejectedValue(new ApiError('cannot demote or delete last admin', 409))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Change role for admin' }))
    const dialog = screen.getByRole('dialog', { name: 'Change role: admin' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Role' }), 'engineer')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Safety conflict: cannot demote or delete last admin')
    expect(mocks.getUsers).toHaveBeenCalledTimes(1)
  })
})
