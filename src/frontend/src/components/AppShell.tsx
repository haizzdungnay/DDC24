import { Outlet } from 'react-router-dom'
import { useRealtime } from '../realtime'
import { useI18n } from '../i18n'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'

export function AppShell() {
  const { connectionState } = useRealtime()
  const { t } = useI18n()
  return (
    <div className="min-h-screen bg-[var(--c-bg)] text-[var(--c-text)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] border-x border-[var(--c-border)]">
        <NavRail />
        <div className="min-w-0 flex-1">
          <TopBar connectionState={connectionState} alarmCount={5} />
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
