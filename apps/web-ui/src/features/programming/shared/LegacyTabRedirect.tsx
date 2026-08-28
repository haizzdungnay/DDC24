import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { canonicalProgramsPath, programsWorkspacePath } from './programsRoute'

/**
 * `/projects/:projectId/programs` và `/design` là producer legacy của PGM-02
 * v2. Chỉ mang allowlist, dùng `replace`, đổi alias `program`→`pou` khi cần và
 * luôn kết thúc ở một pathname khác nên không tạo redirect loop.
 */
export function LegacyProgramsRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  if (!projectId) return <Navigate to="/eng/programming" replace />
  return <Navigate to={canonicalProgramsPath(projectId, { search: location.search, hash: location.hash })} replace />
}

/**
 * UX-WEB-PROG-001 §11.1 — ba route cũ của IA sáu trang chuyển sang tab của
 * workspace Thiết kế, giữ nguyên `projectId` và mọi query khác (chỉ thêm
 * `tab`). Dùng `replace` để không để lại route cũ trong lịch sử trình duyệt
 * (VS-PROG-032).
 *
 * Dòng thứ năm của bảng §11.1 (`/runtime` không tab → `?tab=runtime`) KHÔNG
 * dựng được bằng một `<Route>` riêng vì nó trùng path với route thật
 * `RuntimeServicePage`; `RuntimeServicePage` tự mặc định tab `runtime` khi
 * thiếu query, đúng quy tắc "tab không hợp lệ rơi về mặc định" (§0.1).
 */
export function LegacyTabRedirect({ tab }: { tab: 'programs' | 'mapping' | 'execution' }) {
  const { projectId } = useParams<{ projectId: string }>()
  const { hash } = useLocation()
  const [searchParams] = useSearchParams()
  if (!projectId) return <Navigate to="/eng/programming" replace />
  const query = new URLSearchParams(searchParams)
  query.set('tab', tab)
  return <Navigate to={{ pathname: `/eng/programming/projects/${projectId}/design`, search: `?${query.toString()}`, hash }} replace />
}

/**
 * T59-306 — `/design` là LỐI VÀO CŨ. IA sáu trang (DDD §8) đặt `programs` và
 * `mapping` làm route đích, nên chuyển hướng đi theo `?tab=` mà deep-link cũ
 * mang theo. Giữ nguyên mọi query khác (`program`, `line`, `column`) để một link
 * lỗi cũ vẫn mở đúng chỗ.
 */
export function LegacyDesignRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  const { hash } = useLocation()
  const [searchParams] = useSearchParams()
  if (!projectId) return <Navigate to="/eng/programming" replace />
  const query = new URLSearchParams(searchParams)
  const tab = query.get('tab')
  query.delete('tab')
  if (tab === 'execution') query.set('tab', 'execution')
  const suffix = query.toString()
  /* `/design` phải PHÂN NHÁNH theo `?tab=` trước khi nghĩ tới PGM-02 v2: cho
   * cả `/design?tab=mapping` đi vào redirect Programs là đưa deep-link Ánh xạ
   * sang một workspace khác. Chỉ nhánh `programs` mới hỏi `programsWorkspacePath`
   * xem cut-over đang bật hay tắt. */
  if (tab === 'mapping') {
    return <Navigate to={{ pathname: `/eng/programming/projects/${projectId}/mapping`, search: suffix ? `?${suffix}` : '', hash }} replace />
  }
  return <Navigate to={programsWorkspacePath(projectId, { search: suffix, hash })} replace />
}
