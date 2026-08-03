import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'

vi.mock('../../shared/config', () => ({
  API_ORIGIN: '',
  AUTH_MODE: 'jwt',
  IS_DEMO: false
}))

// vi.mock được hoist lên đầu file nên factory không đọc được biến top-level;
// vi.hoisted là cách tạo mock dùng chung đúng thứ tự.
const mocks = vi.hoisted(() => ({
  setAuthHeaderProvider: vi.fn(),
  setHistoryAuthHeaderProvider: vi.fn()
}))
vi.mock('../../shared/api/client', () => ({ setAuthHeaderProvider: mocks.setAuthHeaderProvider }))
vi.mock('../../shared/api/history', () => ({ setHistoryAuthHeaderProvider: mocks.setHistoryAuthHeaderProvider }))

import { AuthProvider, useAuth } from './AuthProvider'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
)

function mockLoginResponse(body: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/auth/login')) {
      return { ok: true, json: async () => body } as unknown as Response
    }
    return { ok: true, json: async () => ({}) } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  mocks.setAuthHeaderProvider.mockClear()
  mocks.setHistoryAuthHeaderProvider.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AuthProvider role defaulting', () => {
  // F-07: `role: body.role ?? 'admin'` cấp giao diện admin đầy đủ khi response
  // login thiếu field `role` (BE cũ / BE đổi hợp đồng / reverse proxy lọc field).
  // Default phải là quyền THẤP NHẤT.
  it('falls back to viewer when the login response omits role', async () => {
    mockLoginResponse({ token: 'jwt-abc' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hook = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await hook.result.current.login('pw', 'someone')
    })

    expect(hook.result.current.session?.role).toBe('viewer')
    expect(warn).toHaveBeenCalled()
  })

  it('keeps the role the server actually returned', async () => {
    mockLoginResponse({ token: 'jwt-abc', role: 'operator' })
    const hook = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await hook.result.current.login('pw', 'op1')
    })

    expect(hook.result.current.session?.role).toBe('operator')
  })
})

describe('AuthProvider logout revocation', () => {
  // F-04: BE có đầy đủ đường thu hồi (POST /auth/logout → AuthService.Revoke)
  // nhưng FE chỉ xoá state local, nên JWT vừa dùng vẫn hợp lệ tới hết TTL 1 giờ
  // và toàn bộ cơ chế `revoked` phía BE là code chết.
  it('calls POST /auth/logout with the session token before clearing state', async () => {
    const fetchMock = mockLoginResponse({ token: 'jwt-abc', role: 'admin' })
    const hook = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await hook.result.current.login('pw', 'admin')
    })
    expect(hook.result.current.isAuthenticated).toBe(true)
    fetchMock.mockClear()

    act(() => {
      hook.result.current.logout()
    })

    // Session bị xoá ngay, không phụ thuộc kết quả mạng.
    expect(hook.result.current.isAuthenticated).toBe(false)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/auth/logout')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc')
  })

  // Một lần thu hồi thất bại không được chặn hay đảo ngược việc đã đăng xuất.
  it('still logs out locally when the revoke request fails', async () => {
    mockLoginResponse({ token: 'jwt-abc', role: 'admin' })
    const hook = renderHook(() => useAuth(), { wrapper })
    await act(async () => {
      await hook.result.current.login('pw', 'admin')
    })

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    act(() => {
      hook.result.current.logout()
    })
    expect(hook.result.current.isAuthenticated).toBe(false)
  })

  // Không có token (demo/mock/apikey) thì không gọi endpoint thu hồi.
  it('does not call the revoke endpoint when there is no bearer token', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const hook = renderHook(() => useAuth(), { wrapper })

    act(() => {
      hook.result.current.logout()
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
