import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import { RealtimeProvider } from './realtime'
import { AlarmsPage } from './pages/AlarmsPage'
import { CommissioningPage } from './pages/CommissioningPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { MonitorPage } from './pages/MonitorPage'
import { NetworkPage } from './pages/NetworkPage'
import { SchedulerPage } from './pages/SchedulerPage'
import { SettingsPage } from './pages/SettingsPage'
import { SystemHealthPage } from './pages/SystemHealthPage'
import { TrendsPage } from './pages/TrendsPage'
import { UsersPage } from './pages/UsersPage'
import { ValidatorPage } from './pages/ValidatorPage'

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
        <Route path="trends" element={<TrendsPage />} />
        <Route path="scheduler" element={<SchedulerPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="health" element={<SystemHealthPage />} />
        <Route path="commissioning" element={<CommissioningPage />} />
        <Route path="validator" element={<ValidatorPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
