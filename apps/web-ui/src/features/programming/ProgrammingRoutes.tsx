import { Navigate, Route, Routes } from 'react-router-dom'
import { ProgrammingLayout } from './layout/ProgrammingLayout'
import { OverviewPage } from './overview/OverviewPage'
import { DesignWorkspacePage } from './design/DesignWorkspacePage'
import { CheckCommissionPage } from './commission/CheckCommissionPage'
import { RuntimeServicePage } from './runtime/RuntimeServicePage'
import { LibraryPage } from './library/LibraryPage'
import { LegacyDesignRedirect, LegacyProgramsRedirect, LegacyTabRedirect } from './shared/LegacyTabRedirect'
import { ProgramsWorkspaceRoute } from './design/ProgramsWorkspaceRoute'
import { PROGRAMS_WORKSPACE_V2_ENABLED } from '../../shared/config'

/** Route tương đối canonical của đúng sáu workspace theo UX-WEB-PROG-001 §2. */
export const PROGRAMMING_WORKSPACE_PATHS = {
  overview: '',
  programs: 'programs',
  mapping: 'projects/:projectId/mapping',
  library: 'projects/:projectId/library',
  commission: 'projects/:projectId/commission',
  runtime: 'runtime'
} as const

export const PROGRAMMING_LEGACY_PROGRAMS_PATH = 'projects/:projectId/programs'

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
        {/* `/design` giữ NGUYÊN một element ở cả hai trạng thái cờ: nó phải
            phân nhánh theo `?tab=` trước, rồi mới hỏi cờ cho nhánh Chương
            trình. Đổi hẳn sang redirect Programs sẽ nuốt `?tab=mapping`. */}
        <Route path="projects/:projectId/design" element={<LegacyDesignRedirect />} />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.commission} element={<CheckCommissionPage />} />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.library} element={<LibraryPage />} />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.runtime} element={<RuntimeServicePage />} />

        {/* `programsWorkspaceV2` chỉ cut-over PGM-02. Khi cờ tắt, route cũ vẫn
            mount workspace hiện hành; khi bật, cả `/programs` và `/design`
            đều replace sang canonical query route. */}
        <Route
          path={PROGRAMMING_LEGACY_PROGRAMS_PATH}
          element={PROGRAMS_WORKSPACE_V2_ENABLED ? <LegacyProgramsRedirect /> : <DesignWorkspacePage route="programs" />}
        />
        <Route
          path={PROGRAMMING_WORKSPACE_PATHS.programs}
          element={PROGRAMS_WORKSPACE_V2_ENABLED ? <ProgramsWorkspaceRoute /> : <Navigate to="/eng/programming" replace />}
        />
        <Route path={PROGRAMMING_WORKSPACE_PATHS.mapping} element={<DesignWorkspacePage route="mapping" />} />
        <Route path="projects/:projectId/task" element={<LegacyTabRedirect tab="execution" />} />
      </Route>
      <Route path="*" element={<Navigate to="/eng/programming" replace />} />
    </Routes>
  )
}
