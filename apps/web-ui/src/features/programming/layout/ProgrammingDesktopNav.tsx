import { Activity, ClipboardCheck, Home, Library, PencilRuler } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'

interface NavItem {
  key: string
  label: [string, string]
  to: string | null
  icon: typeof Home
  end?: boolean
}

/**
 * D-01/D-04 (`REV-PROG-ASBUILT-GAP-2026-08-14` §8) — desktop trước bản vá
 * này chỉ thấy tiêu đề "Lập trình điều khiển" toàn cục, không có cách nào
 * khác ngoài nút ngữ cảnh trong từng trang để đi Overview/Design/Check/
 * Runtime. `ProgrammingMobileNav` đã có đúng bốn mục này cho `md:hidden`;
 * component này là bản tương đương desktop (`hidden md:flex`), cùng danh
 * sách bốn workspace, không dựng deep-link giả khi chưa có `projectId`.
 */
export function ProgrammingDesktopNav({ projectId }: { projectId: string | null }) {
  const { pick } = useI18n()
  const items: NavItem[] = [
    { key: 'overview', label: ['Tổng quan', 'Overview'], to: '/eng/programming', icon: Home, end: true },
    { key: 'design', label: ['Thiết kế', 'Design'], to: projectId ? `/eng/programming/projects/${projectId}/design` : null, icon: PencilRuler },
    { key: 'library', label: ['Thư viện', 'Library'], to: projectId ? `/eng/programming/projects/${projectId}/library` : null, icon: Library },
    { key: 'check', label: ['Kiểm tra', 'Check'], to: projectId ? `/eng/programming/projects/${projectId}/commission` : null, icon: ClipboardCheck },
    { key: 'runtime', label: ['Runtime', 'Runtime'], to: '/eng/programming/runtime', icon: Activity }
  ]

  return (
    <nav aria-label={pick('Điều hướng workspace Lập trình trên desktop', 'Programming workspace navigation (desktop)')} className="hidden gap-1 border-b border-[var(--c-border)] md:flex">
      {items.map(({ key, label, to, icon: Icon, end }) =>
        to ? (
          <NavLink
            key={key}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
                isActive ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {pick(...label)}
          </NavLink>
        ) : (
          <span key={key} aria-disabled="true" className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-[var(--c-text-dim)] opacity-45">
            <Icon className="h-4 w-4" aria-hidden="true" />
            {pick(...label)}
          </span>
        )
      )}
    </nav>
  )
}
