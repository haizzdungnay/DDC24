import { Activity, Cable, ClipboardCheck, Home, Library, PencilRuler } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'

interface NavItem {
  key: string
  label: [string, string]
  to: string | null
  icon: typeof Home
  end?: boolean
}

/** `T59-503` — sáu workspace canonical trên desktop/tablet. Route phụ thuộc
 * Project chỉ mở khi đã đọc được đúng `projectId`; không dùng Project đầu tiên
 * để che một deep-link sai định danh. */
export function ProgrammingDesktopNav({ projectId }: { projectId: string | null }) {
  const { pick } = useI18n()
  const items: NavItem[] = [
    { key: 'overview', label: ['Tổng quan', 'Overview'], to: '/eng/programming', icon: Home, end: true },
    { key: 'programs', label: ['Chương trình', 'Programs'], to: projectId ? `/eng/programming/projects/${projectId}/programs` : null, icon: PencilRuler },
    { key: 'mapping', label: ['Điểm & Ánh xạ', 'Points & Mapping'], to: projectId ? `/eng/programming/projects/${projectId}/mapping` : null, icon: Cable },
    { key: 'library', label: ['Thư viện điều khiển', 'Control Library'], to: projectId ? `/eng/programming/projects/${projectId}/library` : null, icon: Library },
    { key: 'commission', label: ['Kiểm tra & Vận hành', 'Check & Commission'], to: projectId ? `/eng/programming/projects/${projectId}/commission` : null, icon: ClipboardCheck },
    { key: 'runtime', label: ['Runtime & Bảo trì', 'Runtime & Service'], to: '/eng/programming/runtime', icon: Activity }
  ]

  return (
    <nav aria-label={pick('Điều hướng sáu workspace Lập trình trên desktop', 'Six Programming workspaces navigation (desktop)')} className="hidden gap-1 overflow-x-auto border-b border-[var(--c-border)] md:flex">
      {items.map(({ key, label, to, icon: Icon, end }) =>
        to ? (
          <NavLink
            key={key}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] ${
                isActive ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {pick(...label)}
          </NavLink>
        ) : (
          <span key={key} aria-disabled="true" className="flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-[var(--c-text-dim)] opacity-45">
            <Icon className="h-4 w-4" aria-hidden="true" />
            {pick(...label)}
          </span>
        )
      )}
    </nav>
  )
}
