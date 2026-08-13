import { Navigate, Route, Routes } from 'react-router-dom'
import { ProgrammingLayout } from './layout/ProgrammingLayout'
import { OverviewPage } from './overview/OverviewPage'
import { DesignWorkspacePage } from './design/DesignWorkspacePage'
import { CheckCommissionPage } from './commission/CheckCommissionPage'
import { RuntimeServicePage } from './runtime/RuntimeServicePage'
import { LegacyTabRedirect } from './shared/LegacyTabRedirect'

/**
 * TASK-PROG-500 — bốn route chuẩn của `DDD-FE-PROG-001` §0.1/UX §11, cộng ba
 * chuyển hướng route cũ còn dựng được bằng `<Route>` (dòng thứ tư của bảng
 * §11.1 — `.../commission` — giữ nguyên, không phải redirect; dòng thứ năm —
 * `/runtime` không tab — do `RuntimeServicePage` tự mặc định, xem
 * `shared/LegacyTabRedirect.tsx`).
 *
 * Mount tại `App.tsx` dưới dạng `eng/programming/*` nên `Routes` ở đây dùng
 * path tương đối, độc lập với path tuyệt đối bên ngoài.
 */
export function ProgrammingRoutes() {
  return (
    <Routes>
      <Route element={<ProgrammingLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="projects/:projectId/design" element={<DesignWorkspacePage />} />
        <Route path="projects/:projectId/commission" element={<CheckCommissionPage />} />
        <Route path="runtime" element={<RuntimeServicePage />} />

        {/* UX-WEB-PROG-001 §11.1 — route cũ của IA sáu trang */}
        <Route path="projects/:projectId/programs" element={<LegacyTabRedirect tab="programs" />} />
        <Route path="projects/:projectId/mapping" element={<LegacyTabRedirect tab="mapping" />} />
        <Route path="projects/:projectId/task" element={<LegacyTabRedirect tab="execution" />} />
      </Route>
      <Route path="*" element={<Navigate to="/eng/programming" replace />} />
    </Routes>
  )
}
