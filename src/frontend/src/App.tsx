import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import { RealtimeProvider } from './realtime'
import { AlarmSettingsPage } from './pages/AlarmSettingsPage'
import { InputsPage } from './pages/InputsPage'
import { AlarmHistoryPage, AlarmsPage } from './pages/AlarmsPage'
import { CommissioningPage } from './pages/CommissioningPage'
import { DashboardPage } from './pages/DashboardPage'
import { DisplaySettingsPage } from './pages/DisplaySettingsPage'
import { LoginPage } from './pages/LoginPage'
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

export function App() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="monitor" element={<MonitorPage />} />
        <Route path="alarms" element={<AlarmsPage />} />
        <Route path="alarms/history" element={<AlarmHistoryPage />} />
        <Route path="trends" element={<TrendsPage />} />
        <Route path="me" element={<UserInfoPage />} />

        <Route path="settings" element={<Navigate to="/settings/device" replace />} />
        <Route path="settings/display" element={<DisplaySettingsPage />} />
        <Route path="settings/users" element={<UsersPage />} />
        <Route path="settings/network" element={<NetworkPage />} />
        <Route path="settings/time" element={<TimeSettingsPage />} />
        <Route path="settings/device" element={<SettingsPage />} />

        <Route path="eng/scheduler" element={<SchedulerPage />} />
        <Route path="eng/commissioning" element={<CommissioningPage />} />
        <Route path="eng/programming" element={<ProgrammingPage />} />
        <Route path="eng/inputs" element={<InputsPage />} />
        <Route path="eng/outputs" element={<OutputsPage />} />
        <Route path="eng/user-parameters" element={<UserParametersPage />} />
        <Route path="eng/diagram" element={<DiagramPage />} />
        <Route path="eng/aux" element={<AuxFunctionsPage />} />
        <Route path="eng/alarm-settings" element={<AlarmSettingsPage />} />

        <Route path="users" element={<Navigate to="/settings/users" replace />} />
        <Route path="network" element={<Navigate to="/settings/network" replace />} />
        <Route path="scheduler" element={<Navigate to="/eng/scheduler" replace />} />
        <Route path="commissioning" element={<Navigate to="/eng/commissioning" replace />} />
        <Route path="validator" element={<Navigate to="/eng/programming" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
