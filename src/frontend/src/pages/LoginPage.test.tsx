import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { LoginPage } from './LoginPage'

const authMocks = vi.hoisted(() => ({ login: vi.fn() }))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ login: authMocks.login })
}))

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'en')
  authMocks.login.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LoginPage RBAC identity', () => {
  it('submits the selected account instead of forcing admin', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><I18nProvider><LoginPage /></I18nProvider></MemoryRouter>)

    const username = screen.getByLabelText('Username')
    await user.clear(username)
    await user.type(username, 'engineer')
    await user.type(screen.getByLabelText('Password'), 'RbacTest123!')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(authMocks.login).toHaveBeenCalledWith('RbacTest123!', 'engineer')
  })
})
