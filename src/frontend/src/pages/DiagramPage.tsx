import { useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { can, permissions } from '../auth/permissions'
import { ControllerDiagram } from '../components/ControllerDiagram'
import { Panel } from '../components/Panel'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'

export function DiagramPage() {
  const { session } = useAuth()
  const canManageSettings = can(session?.role, permissions.settingsManage)
  const { t } = useI18n()
  const navigate = useNavigate()
  const realtime = useRealtime()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const healthState = useApi(apiClient.getHealth, [], { refreshMs: 1000 })
  const points = realtime.allPoints.length ? realtime.allPoints : pointsState.data ?? []
  const dataAgeLabel = realtime.lastEventAt ? new Date(realtime.lastEventAt).toLocaleTimeString('vi-VN') : 'API'

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--c-border)] px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--c-text)]">{t('diagram')}</h1>
        <p className="mt-0.5 text-xs text-[var(--c-text-dim)]">{t('diagram-sub')}</p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <Panel className="p-3" title={t('diagram')}>
          <ControllerDiagram
            points={points}
            health={healthState.data ?? undefined}
            dataAgeLabel={dataAgeLabel}
            onOpenNetwork={canManageSettings ? () => navigate('/settings/network') : undefined}
          />
        </Panel>
      </div>
    </div>
  )
}
