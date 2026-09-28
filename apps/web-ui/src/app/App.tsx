import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import {
  ForcePasswordChangePage,
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
/* `T57-4.2` (`ADR-049`) — bốn lô nghiệp vụ NẶNG và ÍT MỞ tách khỏi chunk chính.
 *
 * Bốn màn hình mở đầu mỗi ca (Landing, Giám sát, Cảnh báo, Chẩn đoán) cố ý ở
 * lại chunk chính: chia chúng ra chỉ biến một lần tải thành hai lần chờ.
 *
 * Số đo nghiệm thu là THỜI GIAN MỞ TRANG ĐẦU TRÊN BOARD THẬT, không phải kích
 * thước tệp — `F-DOC-10` đã cho thấy so kích thước giữa hai lệnh build khác
 * nhau dẫn tới kết luận sai. */
const ModbusRtuLayout = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.ModbusRtuLayout })))
const ModbusDevicesPage = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.DevicesPage })))
const ModbusDiagnosticsPage = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.DiagnosticsPage })))
const ModbusMappingPage = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.MappingPage })))
const ModbusOverviewPage = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.OverviewPage })))
const ModbusPointsPage = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.PointsPage })))
const ModbusPortsPage = lazy(() => import('../features/modbus-rtu').then((module) => ({ default: module.PortsPage })))
// Modbus RTU không có import tĩnh nào ở đây nên barrel dùng được.
import { DisplaySettingsPage, NetworkPage, SettingsPage, TimeSettingsPage } from '../features/network'
/* QUY TẮC MỘT CHIỀU CHO MỖI FEATURE: hoặc TOÀN BỘ tĩnh, hoặc TOÀN BỘ động —
   không trộn trên cùng một barrel.
 *
 * Trước 2026-08-20, ba trang Cảnh báo được import TĨNH thẳng vào tệp nguồn còn
 * Xu hướng import ĐỘNG, với lý do ghi ngay tại đây: chạm barrel bằng import tĩnh
 * sẽ kéo `TrendsPage` (và thư viện biểu đồ) vào chunk chính và làm `lazy` mất
 * tác dụng — rollup báo đúng điều đó bằng `INEFFECTIVE_DYNAMIC_IMPORT`.
 *
 * Cách né đó đúng về bundling nhưng phá ranh giới feature, và
 * `verify_repository.py` bắt được: 8 trong 10 vi phạm dependency boundary trên
 * `main` sinh ra từ chính chỗ này. Hai bất biến xung đột thật, và bất biến kiến
 * trúc là bên thua trong im lặng.
 *
 * Lời giải không phải chọn một bên mà là bỏ điều kiện gây xung đột: khi feature
 * KHÔNG còn import tĩnh nào ở đây, barrel chỉ được chạm qua `import()` động nên
 * rollup giữ nguyên chunk riêng — `lazy` hoạt động VÀ ranh giới được tôn trọng.
 * Đây đúng là mô hình Modbus RTU ở trên đã dùng từ trước.
 *
 * Hệ quả có chủ ý: ba trang Cảnh báo chuyển từ eager sang lazy. Chúng nằm trong
 * `<Suspense fallback={<RouteLoading />}>` bên dưới nên hành vi điều hướng không
 * đổi, và chunk chính nhẹ đi vì cả feature rời khỏi đồ thị khởi động. */
const AlarmsPage = lazy(() => import('../features/operations').then((module) => ({ default: module.AlarmsPage })))
const AlarmHistoryPage = lazy(() => import('../features/operations').then((module) => ({ default: module.AlarmHistoryPage })))
const AlarmSettingsPage = lazy(() => import('../features/operations').then((module) => ({ default: module.AlarmSettingsPage })))
/* Xu hướng kéo theo cả thư viện biểu đồ (407 kB) — lô nặng nhất, và không phải
   màn hình mở đầu ca. */
const TrendsPage = lazy(() => import('../features/operations').then((module) => ({ default: module.TrendsPage })))
const SchedulerLayout = lazy(() => import('../features/scheduler').then((module) => ({ default: module.SchedulerLayout })))
const SchedulerGridPage = lazy(() => import('../features/scheduler').then((module) => ({ default: module.SchedulerGridPage })))
const ScheduleEditorPage = lazy(() => import('../features/scheduler').then((module) => ({ default: module.ScheduleEditorPage })))
const SchedulerRuntimePage = lazy(() => import('../features/scheduler').then((module) => ({ default: module.SchedulerRuntimePage })))
import { CommissioningPage, InputsPage, MonitorPage, OutputsPage, UserParametersPage, VirtualPointsPage } from '../features/points'
import { AppShell } from '../shared/components/AppShell'
import { RequireRole } from '../shared/components/RequireRole'
import { preloadTrendChart } from '../shared/components/TrendChart'
import { useI18n } from '../shared/i18n'
import { OverviewProvider } from '../shared/overview/OverviewProvider'
import { RealtimeProvider } from '../shared/realtime'
import { LEGACY_GRAPH_DEMO_ENABLED, PROGRAMMING_REV_A_ENABLED } from '../shared/config'
const ProgrammingRoutes = lazy(() => import('../features/programming').then((module) => ({ default: module.ProgrammingRoutes })))

function ProtectedShell() {
  const { isAuthenticated, session } = useAuth()
  const location = useLocation()
  /* T63-109 (PERF-FE-02): thư viện biểu đồ không còn trong đồ thị khởi động nên
     trang đăng nhập không tải nó. Ngay khi đã xác thực thì bắt đầu tải, để chunk
     về SONG SONG với dữ liệu của Dashboard chứ không nối đuôi sau nó. Chưa xác
     thực thì KHÔNG tải: nhánh đó chỉ chuyển hướng về `/login`. */
  useEffect(() => {
    if (isAuthenticated) void preloadTrendChart().catch(() => undefined)
  }, [isAuthenticated])
  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" replace state={{ from: returnTo }} />
  }
  /* `T57-3.17` (`ADR-047`): backend đã chặn mọi endpoint của phiên này, nên
     dựng shell đầy đủ chỉ tạo ra một màn hình toàn lỗi 403. Đưa thẳng tới việc
     cần làm. Đây là dẫn đường, KHÔNG phải lớp bảo vệ — lớp bảo vệ ở backend. */
  if (session?.mustChangePassword) return <ForcePasswordChangePage />
  /* PA3-205: `OverviewProvider` bọc NGOÀI shell vì cả TopBar lẫn Landing đều
     đọc cùng một snapshot. Đặt nó bên trong Dashboard sẽ đưa ta về đúng lỗi
     PA3-F12: hai vùng của một màn hình poll riêng và nói hai điều khác nhau. */
  return (
    <RealtimeProvider>
      <OverviewProvider>
        {/* `ADR-049` điều 2: mỗi ranh giới `lazy` phải có trạng thái tải THẬT.
            Màn hình trắng trong lúc tải là một kiểu hỏng, không phải một trạng
            thái tải — trên bo nhúng qua Wi-Fi yếu nó kéo dài đủ để người dùng
            tưởng thiết bị treo. */}
        <Suspense fallback={<RouteLoading />}>
          <AppShell />
        </Suspense>
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

/** Trạng thái tải cho ranh giới `lazy` — `ADR-049` điều 2. */
function RouteLoading() {
  return (
    <div className="grid min-h-[40vh] place-items-center p-6">
      <div role="status" className="text-sm text-[var(--c-text-dim)]">Đang tải màn hình…</div>
    </div>
  )
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
          <Route index element={<ModbusOverviewPage />} />
          <Route path="overview" element={<ModbusOverviewPage />} />
          <Route path="ports" element={<ModbusPortsPage />} />
          <Route path="devices" element={<ModbusDevicesPage />} />
          <Route path="points" element={<ModbusPointsPage />} />
          <Route path="mapping" element={<ModbusMappingPage />} />
          <Route path="diagnostics" element={<ModbusDiagnosticsPage />} />
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
