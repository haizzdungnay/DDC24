import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthProvider'
import { can, permissions, type Permission } from './auth/permissions'
import { AppShell } from './components/AppShell'
import { RealtimeProvider } from './realtime'
import { AlarmSettingsPage } from './pages/AlarmSettingsPage'
import { InputsPage } from './pages/InputsPage'
import { AlarmHistoryPage, AlarmsPage } from './pages/AlarmsPage'
import { CommissioningPage } from './pages/CommissioningPage'
import { DashboardPage } from './pages/DashboardPage'
import { DisplaySettingsPage } from './pages/DisplaySettingsPage'
import { LoginPage, loginReturnPath } from './pages/LoginPage'
import { MonitorPage } from './pages/MonitorPage'
import { NetworkPage } from './pages/NetworkPage'
import { ProgrammingPage } from './pages/ProgrammingPage'
import { SchedulerPage } from './pages/SchedulerPage'
import { SettingsPage } from './pages/SettingsPage'
import { TimeSettingsPage } from './pages/TimeSettingsPage'
import { TrendsPage } from './pages/TrendsPage'
import { UserInfoPage } from './pages/UserInfoPage'
import { UsersPage } from './pages/UsersPage'
import { DiagramPage } from './pages/DiagramPage'
import { AuxFunctionsPage } from './pages/AuxFunctionsPage'
import { OutputsPage } from './pages/OutputsPage'
import { UserParametersPage } from './pages/UserParametersPage'
import { VirtualPointsPage } from './pages/VirtualIoPage'
import { HelpPage } from './pages/HelpPage'
import { LEGACY_GRAPH_DEMO_ENABLED } from './config'

function ProtectedShell() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <RealtimeProvider>
      <AppShell />
    </RealtimeProvider>
  )
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { session } = useAuth()
  return can(session?.role, permission) ? children : <Navigate to="/" replace />
}

function SettingsIndex() {
  const { session } = useAuth()
  return <Navigate to={can(session?.role, permissions.settingsManage) ? '/settings/device' : '/settings/display'} replace />
}

function LoginRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  return isAuthenticated
    ? <Navigate to={loginReturnPath(location.state)} replace />
    : <LoginPage />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="monitor" element={<MonitorPage />} />
        <Route path="alarms" element={<AlarmsPage />} />
        <Route path="alarms/history" element={<AlarmHistoryPage />} />
        <Route path="trends" element={<TrendsPage />} />
        <Route path="me" element={<UserInfoPage />} />
        <Route path="help" element={<HelpPage />} />

        <Route path="settings" element={<SettingsIndex />} />
        <Route path="settings/display" element={<RequirePermission permission={permissions.selfManage}><DisplaySettingsPage /></RequirePermission>} />
        <Route path="settings/users" element={<RequirePermission permission={permissions.usersManage}><UsersPage /></RequirePermission>} />
        <Route path="settings/network" element={<RequirePermission permission={permissions.settingsManage}><NetworkPage /></RequirePermission>} />
        <Route path="settings/time" element={<RequirePermission permission={permissions.settingsManage}><TimeSettingsPage /></RequirePermission>} />
        <Route path="settings/device" element={<RequirePermission permission={permissions.settingsManage}><SettingsPage /></RequirePermission>} />

        <Route path="eng/scheduler" element={<RequirePermission permission={permissions.settingsManage}><SchedulerPage /></RequirePermission>} />
        <Route path="eng/commissioning" element={<RequirePermission permission={permissions.operate}><CommissioningPage /></RequirePermission>} />
        <Route path="eng/programming" element={LEGACY_GRAPH_DEMO_ENABLED ? <ProgrammingPage /> : <Navigate to="/" replace />} />
        <Route path="eng/inputs" element={<RequirePermission permission={permissions.settingsManage}><InputsPage /></RequirePermission>} />
        <Route path="eng/outputs" element={<RequirePermission permission={permissions.settingsManage}><OutputsPage /></RequirePermission>} />
        <Route path="eng/virtual-points" element={<RequirePermission permission={permissions.settingsManage}><VirtualPointsPage /></RequirePermission>} />
        <Route path="eng/virtual-io" element={<Navigate to="/eng/virtual-points" replace />} />
        <Route path="eng/user-parameters" element={<RequirePermission permission={permissions.settingsManage}><UserParametersPage /></RequirePermission>} />
        <Route path="eng/diagram" element={<DiagramPage />} />
        <Route path="eng/aux" element={<RequirePermission permission={permissions.systemRelease}><AuxFunctionsPage /></RequirePermission>} />
        <Route path="eng/alarm-settings" element={<RequirePermission permission={permissions.settingsManage}><AlarmSettingsPage /></RequirePermission>} />

        <Route path="users" element={<Navigate to="/settings/users" replace />} />
        <Route path="network" element={<Navigate to="/settings/network" replace />} />
        <Route path="scheduler" element={<Navigate to="/eng/scheduler" replace />} />
        <Route path="commissioning" element={<Navigate to="/eng/commissioning" replace />} />
        <Route path="validator" element={<Navigate to={LEGACY_GRAPH_DEMO_ENABLED ? '/eng/programming' : '/'} replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
