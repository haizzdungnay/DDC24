import { Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiClient } from '../api/client'
import { IS_DEMO } from '../config'
import { useApi } from '../hooks/useApi'
import { useRealtime } from '../realtime'
import { useI18n } from '../i18n'
import { NavDrawer, NavRail } from './NavRail'
import { TopBar } from './TopBar'

export function AppShell() {
  const { connectionState } = useRealtime()
  const { session } = useAuth()
  const { t } = useI18n()
  const alarms = useApi(apiClient.getAlarms, [], { refreshMs: 1000 })
  const health = useApi(apiClient.getHealth, [], { refreshMs: 5000 })
  const me = useApi(() => IS_DEMO ? Promise.resolve(session) : apiClient.getMe(), [session], { refreshMs: IS_DEMO ? undefined : 30000 })
  const [navOpen, setNavOpen] = useState(false)
  const alarmCount = alarms.data?.filter((alarm) => (alarm.active ?? (alarm.status === 'active' || alarm.status === 'acked')) || alarm.status === 'unack').length ?? 0
  const currentUser = me.data ?? session

  useEffect(() => {
    const refresh = () => { void alarms.refetch() }
    window.addEventListener('mkddc:alarms-updated', refresh)
    return () => window.removeEventListener('mkddc:alarms-updated', refresh)
  }, [alarms.refetch])

  return (
    <div className="min-h-screen bg-[var(--c-bg)] text-[var(--c-text)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] border-x border-[var(--c-border)]">
        <NavRail alarmCount={alarmCount} device={health.data} />
        {/* WEB-UX-010: ngăn kéo thay cho thanh bên khi màn hình dưới 1024px. */}
        <NavDrawer open={navOpen} alarmCount={alarmCount} device={health.data} onClose={() => setNavOpen(false)} />
        <div className="min-w-0 flex-1">
          <TopBar connectionState={connectionState} alarmCount={alarmCount} currentUser={currentUser} onOpenNav={() => setNavOpen(true)} />
          {connectionState !== 'connected' && (
            <div className="sticky top-16 z-30 border-b border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-5 py-2 text-sm text-[var(--c-warn-fg)]">
              {t('reconnecting')}
            </div>
          )}
          <main className="p-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
