import { Navigate, Route, Routes } from 'react-router-dom'
import { ProgrammingLayout } from './layout/ProgrammingLayout'
import { OverviewPage } from './overview/OverviewPage'
import { DesignWorkspacePage } from './design/DesignWorkspacePage'
import { CheckCommissionPage } from './commission/CheckCommissionPage'
import { RuntimeServicePage } from './runtime/RuntimeServicePage'
import { LibraryPage } from './library/LibraryPage'
import { LegacyTabRedirect, LegacyDesignRedirect } from './shared/LegacyTabRedirect'

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
        <Route path="projects/:projectId/design" element={<LegacyDesignRedirect />} />
        <Route path="projects/:projectId/commission" element={<CheckCommissionPage />} />
        <Route path="projects/:projectId/library" element={<LibraryPage />} />
        <Route path="runtime" element={<RuntimeServicePage />} />

        {/* T59-306: `programs` và `mapping` nay là ROUTE ĐÍCH của IA sáu trang
            (DDD §8), không còn là redirect. `design` trở thành lối vào cũ và
            chuyển hướng theo đúng tab đang yêu cầu — đảo chiều để deep-link cũ
            vẫn chạy mà IA mới là nguồn sự thật. */}
        <Route path="projects/:projectId/programs" element={<DesignWorkspacePage route="programs" />} />
        <Route path="projects/:projectId/mapping" element={<DesignWorkspacePage route="mapping" />} />
        <Route path="projects/:projectId/task" element={<LegacyTabRedirect tab="execution" />} />
      </Route>
      <Route path="*" element={<Navigate to="/eng/programming" replace />} />
    </Routes>
  )
}
