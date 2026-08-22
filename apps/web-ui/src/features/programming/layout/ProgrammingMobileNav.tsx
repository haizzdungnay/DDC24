import { Activity, Cable, ClipboardCheck, Home, Library, PencilRuler } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'

interface NavItem {
  key: string
  label: [string, string]
  shortLabel: [string, string]
  to: string | null
  icon: typeof Home
  end?: boolean
}

/** `T59-503` — bottom navigation sáu workspace; mỗi target cao tối thiểu 44 px,
 * tên truy cập giữ tên đầy đủ dù nhãn nhìn thấy được rút gọn cho màn 390 px. */
export function ProgrammingMobileNav({ projectId }: { projectId: string | null }) {
  const { pick } = useI18n()
  const items: NavItem[] = [
    { key: 'overview', label: ['Tổng quan', 'Overview'], shortLabel: ['Tổng quan', 'Overview'], to: '/eng/programming', icon: Home, end: true },
    { key: 'programs', label: ['Chương trình', 'Programs'], shortLabel: ['Chương trình', 'Programs'], to: projectId ? `/eng/programming/projects/${projectId}/programs` : null, icon: PencilRuler },
    { key: 'mapping', label: ['Điểm & Ánh xạ', 'Points & Mapping'], shortLabel: ['Ánh xạ', 'Mapping'], to: projectId ? `/eng/programming/projects/${projectId}/mapping` : null, icon: Cable },
    { key: 'library', label: ['Thư viện điều khiển', 'Control Library'], shortLabel: ['Thư viện', 'Library'], to: projectId ? `/eng/programming/projects/${projectId}/library` : null, icon: Library },
    { key: 'commission', label: ['Kiểm tra & Vận hành', 'Check & Commission'], shortLabel: ['Kiểm tra', 'Check'], to: projectId ? `/eng/programming/projects/${projectId}/commission` : null, icon: ClipboardCheck },
    { key: 'runtime', label: ['Runtime & Bảo trì', 'Runtime & Service'], shortLabel: ['Runtime', 'Runtime'], to: '/eng/programming/runtime', icon: Activity }
  ]

  return (
    <nav aria-label={pick('Điều hướng sáu workspace Lập trình', 'Six Programming workspaces navigation')} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-[var(--c-border)] bg-[var(--c-surface)]/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur md:hidden">
      {items.map(({ key, label, shortLabel, to, icon: Icon, end }) =>
        to ? (
          <NavLink
            key={key}
            to={to}
            end={end}
            aria-label={pick(...label)}
            className={({ isActive }) => `flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] px-0.5 text-center text-[0.62rem] font-medium leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-accent)] ${isActive ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span aria-hidden="true">{pick(...shortLabel)}</span>
          </NavLink>
        ) : (
          <span key={key} aria-disabled="true" aria-label={pick(...label)} className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[0.62rem] leading-tight text-[var(--c-text-dim)] opacity-45">
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span aria-hidden="true">{pick(...shortLabel)}</span>
          </span>
        )
      )}
    </nav>
  )
}
