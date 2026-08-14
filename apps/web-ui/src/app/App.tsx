import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  LoginPage,
  ROUTE_MIN_ROLE,
  UserInfoPage,
  UsersPage,
  safeReturnPath,
  useAuth
} from '../features/auth'
import {
  ActivityPage,
  AuxFunctionsPage,
  DashboardPage,
  DiagramPage,
  HelpPage,
  ProgrammingPage,
  SystemDiagnosticsPage,
  UnavailableFeaturePage
} from '../features/dashboard'
import { DevicesPage, DiagnosticsPage, MappingPage, ModbusRtuLayout, OverviewPage, PointsPage, PortsPage } from '../features/modbus-rtu'
import { DisplaySettingsPage, NetworkPage, SettingsPage, TimeSettingsPage } from '../features/network'
import { AlarmHistoryPage, AlarmSettingsPage, AlarmsPage, TrendsPage } from '../features/operations'
import { ScheduleEditorPage, SchedulerGridPage, SchedulerLayout, SchedulerRuntimePage } from '../features/scheduler'
import { CommissioningPage, InputsPage, MonitorPage, OutputsPage, UserParametersPage, VirtualPointsPage } from '../features/points'
import { AppShell } from '../shared/components/AppShell'
import { RequireRole } from '../shared/components/RequireRole'
import { useI18n } from '../shared/i18n'
import { OverviewProvider } from '../shared/overview/OverviewProvider'
import { RealtimeProvider } from '../shared/realtime'
import { LEGACY_GRAPH_DEMO_ENABLED, PROGRAMMING_REV_A_ENABLED } from '../shared/config'
import { ProgrammingRoutes } from '../features/programming/ProgrammingRoutes'

function ProtectedShell() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" replace state={{ from: returnTo }} />
  }
  /* PA3-205: `OverviewProvider` bọc NGOÀI shell vì cả TopBar lẫn Landing đều
     đọc cùng một snapshot. Đặt nó bên trong Dashboard sẽ đưa ta về đúng lỗi
     PA3-F12: hai vùng của một màn hình poll riêng và nói hai điều khác nhau. */
  return (
    <RealtimeProvider>
      <OverviewProvider>
        <AppShell />
      </OverviewProvider>
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
        {/* PA3-206/F13: Diagnostics là trang THẬT, mở cho `viewer`. Trước đây
            `SystemHealthPage` chỉ re-export Dashboard, nên không có nơi nào
            chứa CPU/RAM/service ngoài chính trang chủ. */}
        <Route path="diagnostics" element={<SystemDiagnosticsPage />} />
        {/* PA3-406: đích của deep link "xem vết audit" từ Point Detail và từ
            bảng hoạt động trên Landing. Viewer đọc được — audit là bằng chứng
            vận hành, không phải đặc quyền quản trị. */}
        <Route path="activity" element={<ActivityPage />} />
        <Route path="eng/diagnostics" element={<Navigate to="/diagnostics" replace />} />
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

        {/* Scheduler Engine v3.1 — 3 route + Editor 6 tab, theo khuôn
            ModbusRtuLayout. Dựng 11 route rời như đặc tả §17 liệt kê sẽ làm
            người dùng mất dấu bối cảnh giữa "lịch nào" và "màn nào". */}
        <Route path="eng/scheduler" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/scheduler']}><SchedulerLayout /></RequireRole>}>
          <Route index element={<SchedulerGridPage />} />
          <Route path="runtime" element={<SchedulerRuntimePage />} />
          <Route path=":id" element={<ScheduleEditorPage />} />
        </Route>
        <Route path="eng/commissioning" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/commissioning']}><CommissioningPage /></RequireRole>} />
        {/* WEB-UX-007: thay `<Navigate to="/" replace />` im lặng bằng lời giải
            thích. Bấm vào menu rồi bị đá về Dashboard không kèm lý do là cách
            nhanh nhất để người dùng kết luận sản phẩm hỏng. */}
        {/* TASK-PROG-500: `PROGRAMMING_REV_A_ENABLED` (mặc định TẮT) thay hẳn
            route demo graph cũ bằng bốn workspace thật khi bật. Đây là cờ
            RIÊNG với `LEGACY_GRAPH_DEMO_ENABLED` — hai tính năng không còn
            liên quan tới nhau (UX-WEB-PROG-001 §15/§28). */}
        <Route
          path="eng/programming/*"
          element={PROGRAMMING_REV_A_ENABLED
            ? <RequireRole role={ROUTE_MIN_ROLE['/eng/programming']}><ProgrammingRoutes /></RequireRole>
            : LEGACY_GRAPH_DEMO_ENABLED
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
        {/* MBR-B301: mỗi tab một page riêng. Trước 2026-08-05 cả ba route
            `devices`/`points`/`diagnostics` cùng trỏ về `ModbusRtuPage` monolith
            nên ba tab hiển thị y hệt nhau và tiêu đề H1 lặp hai lần — xem
            `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md` FE-MB-01. */}
        <Route path="eng/modbus-rtu" element={<RequireRole role={ROUTE_MIN_ROLE['/eng/modbus-rtu']}><ModbusRtuLayout /></RequireRole>}>
          <Route index element={<OverviewPage />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="ports" element={<PortsPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="points" element={<PointsPage />} />
          <Route path="mapping" element={<MappingPage />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
        </Route>
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
