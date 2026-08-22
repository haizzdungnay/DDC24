import { Navigate, Route, Routes } from 'react-router-dom'
import { ProgrammingLayout } from './layout/ProgrammingLayout'
import { OverviewPage } from './overview/OverviewPage'
import { DesignWorkspacePage } from './design/DesignWorkspacePage'
import { CheckCommissionPage } from './commission/CheckCommissionPage'
import { RuntimeServicePage } from './runtime/RuntimeServicePage'
import { LibraryPage } from './library/LibraryPage'
import { LegacyTabRedirect, LegacyDesignRedirect } from './shared/LegacyTabRedirect'

/** Route tương đối canonical của đúng sáu workspace theo UX-WEB-PROG-001 §2. */
export const PROGRAMMING_WORKSPACE_PATHS = {
  overview: '',
  programs: 'projects/:projectId/programs',
  mapping: 'projects/:projectId/mapping',
  library: 'projects/:projectId/library',
  commission: 'projects/:projectId/commission',
  runtime: 'runtime'
} as const

/**
 * `T59-503` — sáu route chuẩn PGM-01..06 và các lối vào của IA cũ.
 * Redirect giữ query/hash để deep-link diagnostic và tab cũ không mất ngữ
 * cảnh; route canonical không phụ thuộc thứ tự nội bộ của Plan.
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
        <Route path={PROGRAMMING_WORKSPACE_PATHS.commission} element={<CheckCommissionPage />} />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.library} element={<LibraryPage />} />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.runtime} element={<RuntimeServicePage />} />

        {/* T59-306: `programs` và `mapping` nay là ROUTE ĐÍCH của IA sáu trang
            (DDD §8), không còn là redirect. `design` trở thành lối vào cũ và
            chuyển hướng theo đúng tab đang yêu cầu — đảo chiều để deep-link cũ
            vẫn chạy mà IA mới là nguồn sự thật. */}
        <Route path={PROGRAMMING_WORKSPACE_PATHS.programs} element={<DesignWorkspacePage route="programs" />} />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.mapping} element={<DesignWorkspacePage route="mapping" />} />
        <Route path="projects/:projectId/task" element={<LegacyTabRedirect tab="execution" />} />
      </Route>
      <Route path="*" element={<Navigate to="/eng/programming" replace />} />
    </Routes>
  )
}
