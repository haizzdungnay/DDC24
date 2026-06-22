import { Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { apiClient } from '../api/client'
import { IS_DEMO } from '../config'
import { useApi } from '../hooks/useApi'
import { useRealtime } from '../realtime'
import { useI18n } from '../i18n'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'

export function AppShell() {
  const { connectionState } = useRealtime()
  const { session } = useAuth()
  const { t } = useI18n()
  const alarms = useApi(apiClient.getAlarms, [], { refreshMs: 1000 })
  const health = useApi(apiClient.getHealth, [], { refreshMs: 5000 })
  const me = useApi(() => IS_DEMO ? Promise.resolve(session) : apiClient.getMe(), [session], { refreshMs: IS_DEMO ? undefined : 30000 })
  const alarmCount = alarms.data?.length ?? 0
  const currentUser = me.data ?? session

  return (
    <div className="min-h-screen bg-[var(--c-bg)] text-[var(--c-text)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] border-x border-[var(--c-border)]">
        <NavRail alarmCount={alarmCount} device={health.data} />
        <div className="min-w-0 flex-1">
          <TopBar connectionState={connectionState} alarmCount={alarmCount} currentUser={currentUser} />
          {connectionState !== 'connected' && (
            <div className="sticky top-16 z-30 border-b border-[rgba(224,161,6,0.42)] bg-[rgba(224,161,6,0.12)] px-5 py-2 text-sm text-[var(--c-warn-fg)]">
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
