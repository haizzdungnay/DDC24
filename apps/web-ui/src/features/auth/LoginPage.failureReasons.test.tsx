import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { LoginPage, toLoginError } from './LoginPage'
import { LoginError } from './loginError'

/**
 * Test khoá HÀNH VI cho `T57-1.10` — phân biệt lý do đăng nhập hỏng.
 *
 * Hai mệnh đề an toàn được khoá cứng ở đây:
 *  1. **Không** có thông điệp "tài khoản bị khoá" — backend không có cơ chế đó
 *     (`ADR-037` điều 4), nên hiện nó là bịa ra một trạng thái hệ thống.
 *  2. **Không** phân biệt "sai tên" với "sai mật khẩu" — backend cố ý trả cùng
 *     một `401` để chống dò tài khoản, và FE không được suy diễn thêm.
 */

const mocks = vi.hoisted(() => ({ login: vi.fn(async () => {}) }))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ login: mocks.login, logout: vi.fn(), session: null, isAuthenticated: false, getAuthHeader: () => ({}) })
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  mocks.login.mockReset()
  mocks.login.mockResolvedValue(undefined)
})
afterEach(cleanup)

function renderLogin() {
  return render(<MemoryRouter><I18nProvider><LoginPage /></I18nProvider></MemoryRouter>)
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Tên đăng nhập'), 'op1')
  await user.type(screen.getByLabelText('Mật khẩu'), 'saibet')
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))
}

describe('toLoginError — phân loại', () => {
  it('giữ nguyên loại của LoginError', () => {
    const pick = (vi_: string) => vi_
    expect(toLoginError(new LoginError('unreachable', 'x'), pick).kind).toBe('unreachable')
    expect(toLoginError(new LoginError('credentials', 'x'), pick).kind).toBe('credentials')
  })

  it('lỗi lạ xếp vào `server`, KHÔNG phải `credentials`', () => {
    // Gợi ý người dùng đi gõ lại mật khẩu cho một lỗi không liên quan tới mật
    // khẩu là dẫn họ đi sai hướng, và họ sẽ thử lại nhiều lần vô ích.
    const pick = (vi_: string) => vi_
    expect(toLoginError(new TypeError('boom'), pick).kind).toBe('server')
    expect(toLoginError('chuỗi lạ', pick).kind).toBe('server')
  })
})

describe('ba nguyên nhân cho ba thông điệp khác nhau', () => {
  it('sai thông tin đăng nhập ⇒ nói sai tên HOẶC mật khẩu, kèm gợi ý Caps Lock', async () => {
    mocks.login.mockRejectedValue(new LoginError('credentials', 'Tên đăng nhập hoặc mật khẩu không đúng.'))
    const user = userEvent.setup()
    renderLogin()
    await submit(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Tên đăng nhập hoặc mật khẩu không đúng.')
    expect(alert).toHaveTextContent(/Caps Lock/)
  })

  it('không tới được backend ⇒ chỉ sang mạng/nguồn, KHÔNG nói gì về mật khẩu', async () => {
    mocks.login.mockRejectedValue(new LoginError('unreachable', 'Không kết nối được tới thiết bị.'))
    const user = userEvent.setup()
    renderLogin()
    await submit(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Không kết nối được tới thiết bị.')
    expect(alert).toHaveTextContent(/mạng|nguồn/)
    expect(alert).not.toHaveTextContent(/mật khẩu không đúng/)
  })

  it('backend lỗi máy chủ ⇒ nói rõ KHÔNG phải vấn đề thông tin đăng nhập', async () => {
    mocks.login.mockRejectedValue(new LoginError('server', 'Thiết bị trả lỗi máy chủ (HTTP 500).'))
    const user = userEvent.setup()
    renderLogin()
    await submit(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('HTTP 500')
    expect(alert).toHaveTextContent(/nhật ký dịch vụ web/)
  })

  it('ba loại cho ra ba văn bản KHÁC NHAU, không phải cùng một câu', async () => {
    const texts: string[] = []
    for (const error of [
      new LoginError('credentials', 'A'),
      new LoginError('unreachable', 'B'),
      new LoginError('server', 'C')
    ]) {
      mocks.login.mockRejectedValue(error)
      const user = userEvent.setup()
      renderLogin()
      await submit(user)
      texts.push((await screen.findByRole('alert')).textContent ?? '')
      cleanup()
    }
    expect(new Set(texts).size).toBe(3)
  })
})

describe('không bịa trạng thái hệ thống', () => {
  it('KHÔNG bao giờ hiện "tài khoản bị khoá" — backend không có cơ chế khoá', async () => {
    for (const kind of ['credentials', 'unreachable', 'server'] as const) {
      mocks.login.mockRejectedValue(new LoginError(kind, 'x'))
      const user = userEvent.setup()
      renderLogin()
      await submit(user)
      const alert = await screen.findByRole('alert')
      expect(alert.textContent ?? '').not.toMatch(/khoá tài khoản|tài khoản bị khoá|locked/i)
      cleanup()
    }
  })

  it('KHÔNG tiết lộ trường nào sai — chống dò tài khoản', async () => {
    mocks.login.mockRejectedValue(new LoginError('credentials', 'Tên đăng nhập hoặc mật khẩu không đúng.'))
    const user = userEvent.setup()
    renderLogin()
    await submit(user)
    const text = (await screen.findByRole('alert')).textContent ?? ''
    expect(text).not.toMatch(/tài khoản không tồn tại|không tìm thấy người dùng|user not found/i)
  })
})
