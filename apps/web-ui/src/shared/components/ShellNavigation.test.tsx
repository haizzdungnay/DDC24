import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { ThemeProvider } from '../theme/ThemeProvider'
import { NavDrawer, NavRail } from './NavRail'
import { TopBar } from './TopBar'

const authMocks = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'operator' | 'viewer' }))

vi.mock('../../features/auth', async () => {
  const actual = await vi.importActual<typeof import('../../features/auth')>('../../features/auth')
  return {
    ...actual,
    useAuth: () => ({ logout: vi.fn(), session: { username: 'test', role: authMocks.role } })
  }
})

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'en')
  authMocks.role = 'admin'
})
afterEach(cleanup)

function renderNavigation(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <I18nProvider><ThemeProvider>{node}</ThemeProvider></I18nProvider>
    </MemoryRouter>
  )
}

describe('shell user navigation', () => {
  it('links header shortcuts to Alarm, Help, and User info', () => {
    renderNavigation(<TopBar connectionState="connected" alarmCount={0} currentUser={{ username: 'admin', role: 'admin' }} />)

    expect(screen.getByRole('link', { name: 'Alarms' })).toHaveAttribute('href', '/alarms')
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help')
    expect(screen.getByRole('link', { name: 'User' })).toHaveAttribute('href', '/me')
  })

  it('does not expose User info in the sidebar', () => {
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    expect(screen.queryByRole('link', { name: 'User info' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'User' })).not.toBeInTheDocument()
  })

  it('does not expose the legacy Programming demo without its explicit demo flag', () => {
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    expect(screen.queryByRole('link', { name: 'Programming' })).not.toBeInTheDocument()
  })

  // F-06: ADR-017 §2.7 cho viewer|operator ĐỌC trạng thái network authority, và
  // backend đã cấp quyền đó cho GET từ trước. Ẩn hẳn mục này khiến cả quyền
  // read-only ở backend lẫn nhánh chỉ-đọc trong NetworkPage thành mã chết.
  // Mutation vẫn Admin-only ở cả hai phía nên vẫn an toàn.
  it('exposes read-only Network status to non-admin roles', () => {
    authMocks.role = 'operator'
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    expect(screen.getByRole('link', { name: 'Network' })).toHaveAttribute('href', '/settings/network')
  })

  it('shows Model and Firmware in two columns without Serial', () => {
    renderNavigation(<NavRail alarmCount={0} device={{ overall: 'ok', services: {}, firmware: 'FW-TEST' }} />)

    const model = screen.getByText('Model')
    expect(model.parentElement?.parentElement).toHaveClass('grid-cols-2')
    expect(screen.getByText('FW-TEST')).toBeInTheDocument()
    expect(screen.queryByText('FW FW-TEST')).not.toBeInTheDocument()
    expect(screen.queryByText('Serial')).not.toBeInTheDocument()
  })

  it('labels the sidebar alarm destination as Alarm', () => {
    renderNavigation(<NavRail alarmCount={2} device={null} />)
    expect(screen.getByRole('link', { name: 'Alarm2' })).toHaveAttribute('href', '/alarms')
    expect(screen.queryByText('Alarm log')).not.toBeInTheDocument()
  })
})

/**
 * WEB-UX-009 — menu phải khớp quyền thật.
 *
 * Bày ra một danh sách mục mà bấm vào đâu cũng ra trang "không đủ quyền" là tự
 * tạo việc cho người dùng. Lọc ở đây dùng CHUNG `ROUTE_MIN_ROLE` với `RequireRole`
 * để hai bên không lệch nhau.
 */
describe('sidebar reflects the signed-in role', () => {
  it('hides admin-only destinations from a viewer', () => {
    authMocks.role = 'viewer'
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    for (const label of ['Users', 'Device', 'Time/Date', 'Scheduler', 'Alarm settings', 'Inputs Config', 'Virtual Points']) {
      expect(screen.queryByRole('link', { name: label }), `viewer vẫn thấy "${label}"`).not.toBeInTheDocument()
    }
    // Nhưng vẫn giữ toàn bộ màn hình theo dõi chỉ-đọc.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Monitoring' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Network' })).toBeInTheDocument()
  })

  it('gives an operator the write destinations but not the admin ones', () => {
    authMocks.role = 'operator'
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    expect(screen.getByRole('link', { name: 'Commissioning' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Outputs Config' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Device' })).not.toBeInTheDocument()
  })

  it('shows everything to an admin', () => {
    authMocks.role = 'admin'
    renderNavigation(<NavRail alarmCount={0} device={null} />)

    for (const label of ['Users', 'Device', 'Time/Date', 'Scheduler', 'Commissioning', 'Outputs Config']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})

/**
 * WEB-UX-010 — dưới 1024px `NavRail` là `hidden … lg:flex` và trước đây KHÔNG có
 * gì thay thế: mở web trên điện thoại hay tablet là mất sạch điều hướng, chỉ còn
 * cách gõ tay URL. Với thiết bị mà kỹ thuật viên thường xem qua điện thoại ngay
 * tại tủ, đó là mất hẳn khả năng dùng ngoài hiện trường.
 */
describe('mobile navigation drawer', () => {
  it('renders nothing until it is opened', () => {
    renderNavigation(<NavDrawer open={false} alarmCount={0} device={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes the same destinations as the sidebar', () => {
    renderNavigation(<NavDrawer open alarmCount={0} device={null} onClose={vi.fn()} />)

    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(within(drawer).getByRole('link', { name: 'Network' })).toHaveAttribute('href', '/settings/network')
  })

  it('applies the same role filter as the sidebar', () => {
    authMocks.role = 'viewer'
    renderNavigation(<NavDrawer open alarmCount={0} device={null} onClose={vi.fn()} />)

    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderNavigation(<NavDrawer open alarmCount={0} device={null} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes after navigating so the drawer does not cover the page it just opened', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderNavigation(<NavDrawer open alarmCount={0} device={null} onClose={onClose} />)

    await user.click(screen.getByRole('link', { name: 'Monitoring' }))
    expect(onClose).toHaveBeenCalled()
  })

  /* Một lớp phủ chiếm toàn màn hình mà Tab vẫn đi được xuống nội dung bên dưới
     là bẫy cho người dùng bàn phím và trình đọc màn hình. */
  it('traps focus inside the panel', async () => {
    const user = userEvent.setup()
    renderNavigation(
      <>
        <NavDrawer open alarmCount={0} device={null} onClose={vi.fn()} />
        <button type="button">Outside</button>
      </>
    )

    const drawer = screen.getByRole('dialog')
    const focusable = within(drawer).getAllByRole('button').concat(within(drawer).getAllByRole('link'))
    focusable[focusable.length - 1].focus()
    await user.tab()

    expect(drawer.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Outside' }))
  })

  it('marks itself as a modal dialog for assistive technology', () => {
    renderNavigation(<NavDrawer open alarmCount={0} device={null} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})
