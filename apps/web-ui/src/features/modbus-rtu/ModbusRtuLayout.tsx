import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth, roleAtLeast } from '../auth'
import { ConfigStateBanner } from './components/ConfigStateBanner'

export function ModbusRtuLayout() {
  const location = useLocation()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const readOnlyHint = canEdit ? undefined : 'Chỉ vai trò Admin được thay đổi cấu hình Modbus RTU.'

  const currentPath = location.pathname

  const tabs = [
    { label: 'Tổng quan', path: '/eng/modbus-rtu' },
    { label: 'Thiết bị', path: '/eng/modbus-rtu/devices' },
    { label: 'Points', path: '/eng/modbus-rtu/points' },
    { label: 'Diagnostics', path: '/eng/modbus-rtu/diagnostics' }
  ]

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text)]">Modbus RTU Management</h1>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">
            Cấu hình, theo dõi thiết bị trường và giám sát telemetry giao tiếp RS485-1 / RS485-2.
          </p>
        </div>

        {/* Sub-navigation Tabs */}
        <nav className="flex space-x-1 border-b border-[var(--c-border)]" aria-label="Modbus RTU Sections">
          {tabs.map((tab) => {
            const isActive =
              tab.path === '/eng/modbus-rtu'
                ? currentPath === '/eng/modbus-rtu' || currentPath === '/eng/modbus-rtu/'
                : currentPath.startsWith(tab.path)
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-[var(--c-primary,#2563eb)] text-[var(--c-primary,#2563eb)]'
                    : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:text-[var(--c-text)]'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </header>

      {!canEdit && (
        <div role="note" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
          Chế độ chỉ xem. {readOnlyHint}
        </div>
      )}

      {/* Config State Banner */}
      <ConfigStateBanner />

      {/* Content Outlet */}
      <main className="mt-4">
        <Outlet />
      </main>
    </div>
  )
}
