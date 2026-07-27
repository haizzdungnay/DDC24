import { useAuth } from '../auth/AuthProvider'
import { can, permissions } from '../auth/permissions'
import { historianPolicyFor, useHistorianConfig } from '../hooks/useHistorianConfig'
import { PointLoggingControl, type PointLoggingControlProps } from './PointLoggingControl'

export interface PointLoggingSectionProps {
  pointId: string
  label: string
  kind: 'UI' | 'AO' | 'DO' | 'VP'
}

export function PointLoggingSection({ pointId, label, kind }: PointLoggingSectionProps) {
  const { session } = useAuth()
  const canManagePolicy = can(session?.role, permissions.databaseManage)
  const historian = useHistorianConfig()
  const policy = historianPolicyFor(historian.data, pointId)

  if (historian.loading && !historian.data) {
    return <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 text-sm text-[var(--c-text-dim)]">Loading database logging policy...</div>
  }
  if (historian.error && !historian.data) {
    return <div role="alert" className="rounded-[var(--radius)] border border-[rgba(213,32,42,0.38)] bg-[rgba(213,32,42,0.08)] p-4 text-sm text-[var(--c-fault-fg)]">Database logging policy unavailable: {historian.error.message}</div>
  }
  if (!policy || !historian.data) {
    return <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-4 text-sm text-[var(--c-text-dim)]">Database logging is not available for {pointId}.</div>
  }

  const controlPolicy: PointLoggingControlProps['policy'] = {
    pointId: policy.pointId,
    generation: policy.generation,
    dbLoggingEnabled: policy.dbLoggingEnabled,
    dbInterval: policy.dbInterval,
    retentionDays: policy.retentionDays,
    maxRetentionDays: policy.maxRetentionDays,
    maxRetentionDaysByInterval: historian.data.retentionMaxDaysByInterval,
    startAtUtc: policy.startAtUtc,
    state: policy.state,
    health: policy.health,
    lastError: policy.lastError
  }

  return (
    <div className="space-y-2">
      <PointLoggingControl
        point={{ id: pointId, label, kind }}
        policy={controlPolicy}
        role={session?.role ?? 'viewer'}
        canManagePolicy={canManagePolicy}
        serverNowUtc={historian.data.serverNowUtc}
        loading={historian.loading}
        onChange={canManagePolicy ? async (patch) => {
          await historian.savePoint(patch)
          await historian.refetch()
        } : undefined}
      />
      {kind === 'VP' && <p className="text-xs text-[var(--c-text-dim)]">Database logging is independent from the Virtual Point diagnostic log settings.</p>}
      <p className="text-xs text-[var(--c-text-dim)]">Capacity: {formatBytes(historian.data.capacity.reservedBytes)} reserved of {formatBytes(historian.data.capacity.budgetBytes)}; {formatBytes(historian.data.capacity.freeBytes)} free.</p>
    </div>
  )
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'unknown'
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.round(value / 1024)} KiB`
}
