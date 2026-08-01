import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { ROUTE_MIN_ROLE, roleAtLeast } from '../auth/roles'
import type { UserRole } from '../types'
import { RequireRole } from './RequireRole'

const authMocks = vi.hoisted(() => ({ role: 'admin' as UserRole | null }))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: authMocks.role ? { username: 'test', role: authMocks.role, loginAt: '2026-08-01T00:00:00Z' } : null })
}))

beforeEach(() => {
  authMocks.role = 'admin'
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
})
afterEach(cleanup)

function renderGate(required: UserRole) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <RequireRole role={required}><div>Engineering content</div></RequireRole>
      </I18nProvider>
    </MemoryRouter>
  )
}

/**
 * WEB-UX-005 — trước đây `RequireAdmin` có định nghĩa nhưng KHÔNG bọc route nào,
 * nên một phiên `viewer` vào thẳng được trang chạy thử, trang ép output và trang
 * quản lý người dùng.
 */
describe('RequireRole', () => {
  it('lets a higher role through, not just an exact match', () => {
    authMocks.role = 'admin'
    renderGate('operator')
    expect(screen.getByText('Engineering content')).toBeInTheDocument()
  })

  it('blocks a role below the requirement', () => {
    authMocks.role = 'viewer'
    renderGate('operator')
    expect(screen.queryByText('Engineering content')).not.toBeInTheDocument()
  })

  it('blocks when there is no session at all', () => {
    authMocks.role = null
    renderGate('viewer')
    expect(screen.queryByText('Engineering content')).not.toBeInTheDocument()
  })

  /* Không được đá về `/` trong im lặng — đúng lỗi B5a mà plan 45 phải sửa. */
  it('explains what is missing instead of silently redirecting', () => {
    authMocks.role = 'viewer'
    renderGate('admin')
    expect(screen.getByText('Insufficient permission')).toBeInTheDocument()
    expect(screen.getByText(/requires role ADMIN/)).toBeInTheDocument()
    expect(screen.getByText(/Current role: VIEWER/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Dashboard/ })).toBeInTheDocument()
  })
})

/**
 * Ma trận này phải khớp `auth.Require(...)` trong `web/backend/http.go`. Nếu
 * backend siết thêm một endpoint mà bảng ở đây không đổi theo, người dùng sẽ vào
 * được trang rồi ăn 403 ở từng nút.
 */
describe('ROUTE_MIN_ROLE mirrors the backend route table', () => {
  it('requires operator for the routes that write to physical outputs', () => {
    expect(ROUTE_MIN_ROLE['/eng/commissioning']).toBe('operator')
    expect(ROUTE_MIN_ROLE['/eng/outputs']).toBe('operator')
  })

  it('requires admin for configuration and account routes', () => {
    for (const route of ['/eng/inputs', '/eng/virtual-points', '/eng/alarm-settings', '/eng/scheduler', '/settings/time', '/settings/device', '/settings/users']) {
      expect(ROUTE_MIN_ROLE[route]).toBe('admin')
    }
  })

  it('leaves read-only monitoring routes ungated', () => {
    for (const route of ['/', '/monitor', '/alarms', '/trends', '/settings/network', '/settings/display']) {
      expect(ROUTE_MIN_ROLE[route]).toBeUndefined()
    }
  })

  it('orders the roles the same way roleRank does in the backend', () => {
    expect(roleAtLeast('admin', 'operator')).toBe(true)
    expect(roleAtLeast('operator', 'viewer')).toBe(true)
    expect(roleAtLeast('operator', 'admin')).toBe(false)
    expect(roleAtLeast('viewer', 'operator')).toBe(false)
    expect(roleAtLeast(undefined, 'viewer')).toBe(false)
  })
})
