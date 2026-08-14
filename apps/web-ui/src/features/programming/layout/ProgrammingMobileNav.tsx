import { Activity, ClipboardCheck, Home, PencilRuler } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'

interface NavItem {
  key: string
  label: [string, string]
  to: string | null
  icon: typeof Home
  end?: boolean
}

/** Điều hướng bốn workspace theo asset PGM-01 mobile; không dựng deep link giả. */
export function ProgrammingMobileNav({ projectId }: { projectId: string | null }) {
  const { pick } = useI18n()
  const items: NavItem[] = [
    { key: 'overview', label: ['Tổng quan', 'Overview'], to: '/eng/programming', icon: Home, end: true },
    { key: 'design', label: ['Thiết kế', 'Design'], to: projectId ? `/eng/programming/projects/${projectId}/design` : null, icon: PencilRuler },
    { key: 'check', label: ['Kiểm tra', 'Check'], to: projectId ? `/eng/programming/projects/${projectId}/commission` : null, icon: ClipboardCheck },
    { key: 'runtime', label: ['Runtime', 'Runtime'], to: '/eng/programming/runtime', icon: Activity }
  ]

  return (
    <nav aria-label={pick('Điều hướng workspace Lập trình', 'Programming workspace navigation')} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[var(--c-border)] bg-[var(--c-surface)]/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur md:hidden">
      {items.map(({ key, label, to, icon: Icon, end }) =>
        to ? (
          <NavLink
            key={key}
            to={to}
            end={end}
            className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] px-1 text-[0.68rem] font-medium ${isActive ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{pick(...label)}</span>
          </NavLink>
        ) : (
          <span key={key} aria-disabled="true" className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.68rem] text-[var(--c-text-dim)] opacity-45">
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{pick(...label)}</span>
          </span>
        )
      )}
    </nav>
  )
}
