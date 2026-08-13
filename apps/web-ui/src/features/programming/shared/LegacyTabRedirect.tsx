import { Navigate, useParams, useSearchParams } from 'react-router-dom'

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
  const [searchParams] = useSearchParams()
  const query = new URLSearchParams(searchParams)
  query.set('tab', tab)
  return <Navigate to={`/eng/programming/projects/${projectId}/design?${query.toString()}`} replace />
}
