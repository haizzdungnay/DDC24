import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthProvider'
import { ROUTE_MIN_ROLE } from './auth/roles'
import { AppShell } from './components/AppShell'
import { RequireRole } from './components/RequireRole'
import { useI18n } from './i18n'
import { UnavailableFeaturePage } from './pages/UnavailableFeaturePage'
import { RealtimeProvider } from './realtime'
import { AlarmSettingsPage } from './pages/AlarmSettingsPage'
import { InputsPage } from './pages/InputsPage'
import { AlarmHistoryPage, AlarmsPage } from './pages/AlarmsPage'
import { CommissioningPage } from './pages/CommissioningPage'
import { DashboardPage } from './pages/DashboardPage'
import { DisplaySettingsPage } from './pages/DisplaySettingsPage'
import { LoginPage, safeReturnPath } from './pages/LoginPage'
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

/**
 * @deprecated WEB-UX-005 thay bằng `RequireRole`.
 *
 * Giữ lại chỉ để không phá import bên ngoài. Hai khiếm khuyết khiến nó không
 * dùng được: so bằng `=== 'admin'` nên loại luôn `operator` khỏi những trang mà
 * backend cho phép, và khi thiếu quyền thì `Navigate` im lặng về `/` — đúng lỗi
 * B5a mà plan 45 phải sửa.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  return session?.role === 'admin' ? children : <Navigate to="/" replace />
}

/**
 * Route `/login`.
 *
 * Trước đây viết thẳng là
 * `isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />`, và nó nuốt
 * mất deep link: khi `login()` thành công, `setSession` làm route này render
 * lại với `isAuthenticated = true`, và `<Navigate to="/">` chạy đua với lệnh
 * `navigate(returnTo)` bên trong `LoginPage`. Trên trình duyệt thật ở board,
 * `<Navigate to="/">` thắng — mở `/settings/users` khi chưa đăng nhập, đăng
 * nhập xong lại rơi về Dashboard.
 *
 * Nghĩa là `safeReturnPath` và `state.from` của `ProtectedShell` — vốn thêm vào
 * ngày 2026-07-31 đúng để giữ deep link — không có tác dụng ở đường này. Lỗi chỉ
 * lộ ra khi chạy trình duyệt thật; test jsdom có timing khác nên không bắt được.
 *
 * Nay cả hai nhánh cùng đọc một nguồn: `state.from`.
 */
export function LoginRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) return <LoginPage />
  return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />
}

export function App() {
  const { pick } = useI18n()
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

        {/* WEB-UX-005: quyền tối thiểu của từng route lấy từ `ROUTE_MIN_ROLE`
            trong `auth/roles.ts`, vốn suy trực tiếp từ bảng route của backend.
            Trước đây KHÔNG route nào được bọc — `RequireAdmin` có định nghĩa
            nhưng không dùng ở đâu — nên `viewer` vào được cả trang ép output lẫn
            trang quản lý người dùng. */}
        <Route path="settings" element={<Navigate to="/settings/device" replace />} />
        <Route path="settings/display" element={<DisplaySettingsPage />} />
        <Route path="settings/users" element={<RequireRole role={ROUTE_MIN_ROLE['/settings/users']}><UsersPage /></RequireRole>} />
        {/* F-06: KHÔNG gate. ADR-017 §2.7 cho viewer|operator đọc trạng thái
            authority; mọi mutation vẫn Admin-only ở cả backend (POST/PUT) lẫn
            trong trang (canManageNetwork). */}
        <Route path="settings/network" element={<NetworkPage />} />
        <Route path="settings/time" element={<RequireRole role={ROUTE_MIN_ROLE['/settings/time']}><TimeSettingsPage /></RequireRole>} />
        <Route path="settings/device" element={<RequireRole role={ROUTE_MIN_ROLE['/settings/device']}><SettingsPage /></RequireRole>} />

        <Route path="eng/scheduler" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/scheduler']}><SchedulerPage /></RequireRole>} />
        <Route path="eng/commissioning" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/commissioning']}><CommissioningPage /></RequireRole>} />
        {/* WEB-UX-007: thay `<Navigate to="/" replace />` im lặng bằng lời giải
            thích. Bấm vào menu rồi bị đá về Dashboard không kèm lý do là cách
            nhanh nhất để người dùng kết luận sản phẩm hỏng. */}
        <Route
          path="eng/programming"
          element={LEGACY_GRAPH_DEMO_ENABLED
            ? <ProgrammingPage />
            : <UnavailableFeaturePage
                title={pick('Lập trình đồ hoạ chưa khả dụng', 'Graphical programming is not available')}
                reason={pick(
                  'Canvas lập trình dạng sơ đồ khối thuộc phạm vi Rev B theo REVA_SCOPE_ROADMAP §3. Bản Rev A hiện tại cấu hình logic qua các trang Điểm ảo, Lịch vận hành và Cảnh báo.',
                  'The block-diagram programming canvas is Rev B scope per REVA_SCOPE_ROADMAP §3. This Rev A build configures logic through the Virtual points, Scheduler and Alarm settings pages.'
                )}
              />}
        />
        <Route path="eng/inputs" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/inputs']}><InputsPage /></RequireRole>} />
        <Route path="eng/outputs" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/outputs']}><OutputsPage /></RequireRole>} />
        <Route path="eng/virtual-points" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/virtual-points']}><VirtualPointsPage /></RequireRole>} />
        <Route path="eng/virtual-io" element={<Navigate to="/eng/virtual-points" replace />} />
        <Route path="eng/user-parameters" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/user-parameters']}><UserParametersPage /></RequireRole>} />
        <Route path="eng/diagram" element={<DiagramPage />} />
        <Route path="eng/aux" element={<AuxFunctionsPage />} />
        <Route path="eng/alarm-settings" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/alarm-settings']}><AlarmSettingsPage /></RequireRole>} />

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
