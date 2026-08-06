import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { ControllerDiagram } from '../../shared/components/ControllerDiagram'
import { Panel } from '../../shared/components/Panel'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { useRealtime } from '../../shared/realtime'

export function DiagramPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const realtime = useRealtime()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const healthState = useApi(apiClient.getHealth, [], { refreshMs: 1000 })
  /* FE-DIAG-01: sơ đồ cần dữ liệu mạng THẬT. Trước đây nó tự gọi `getDemoNetwork()`
   * bên trong nên số slave Modbus và địa chỉ BACnet là của simulator kể cả trên
   * board. */
  const networkState = useApi(apiClient.getNetwork, [], { refreshMs: 5000 })
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
            network={networkState.data ?? undefined}
            dataAgeLabel={dataAgeLabel}
            onOpenNetwork={() => navigate('/settings/network')}
          />
        </Panel>
      </div>
    </div>
  )
}
