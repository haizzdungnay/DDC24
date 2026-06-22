import { Bell, ChevronDown, CircleHelp, LogOut, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { IS_DEMO } from '../config'
import { useI18n } from '../i18n'
import type { ConnectionState, CurrentUser } from '../types'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'

export function TopBar({ connectionState, alarmCount, currentUser }: { connectionState: ConnectionState; alarmCount: number; currentUser: CurrentUser | null }) {
  const [now, setNow] = useState(new Date())
  const { logout } = useAuth()
  const { lang, locale, setLang, t, pick } = useI18n()

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const online = connectionState === 'connected'
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-[var(--c-border)] bg-[var(--c-surface)] px-5">
      <div className="flex items-center gap-3">
        <div className="hidden h-9 w-px bg-[var(--c-border)] lg:block" />
        <StatusBadge state={online ? 'online' : 'offline'} label={`${t('system')}: ${online ? t('online') : t('offline')}`} />
        <StatusBadge state={IS_DEMO ? 'demo' : 'live'} label={IS_DEMO ? t('demo') : t('live')} />
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden border-r border-[var(--c-border)] pr-6 text-right md:block">
          <div className="mono text-sm font-semibold">{now.toLocaleTimeString(locale, { hour12: false })}</div>
          <div className="text-xs text-[var(--c-text-dim)]">{now.toLocaleDateString(locale)}</div>
        </div>
        <button className="relative grid h-10 w-10 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)]" aria-label={pick("Cảnh báo", "Alarms")}>
          <Bell className="h-5 w-5" aria-hidden="true" />
          {alarmCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[10px] font-bold">{alarmCount}</span>}
        </button>
        <button className="grid h-10 w-10 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)]" aria-label={pick("Trợ giúp", "Help")}><CircleHelp className="h-5 w-5" /></button>
        <button className="grid h-10 w-10 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)]" aria-label={pick("Người dùng", "User")}><UserRound className="h-5 w-5" /></button>
        <div className="hidden min-w-[132px] md:block">
          <div className="text-sm font-semibold">{currentUser?.username ?? 'N/A'}</div>
          <div className="text-xs text-[var(--c-text-dim)]">{currentUser?.role ?? 'N/A'}</div>
        </div>
        <button className="flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-xs font-semibold" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} aria-label={pick("Đổi ngôn ngữ", "Toggle language")}>
          {lang.toUpperCase()} <ChevronDown className="h-4 w-4" />
        </button>
        <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={logout}>{t('logout')}</Button>
      </div>
    </header>
  )
}
