import { AlertTriangle } from 'lucide-react'

export function PointNameConflictNotice({ pointId, conflictIds }: { pointId: string; conflictIds?: string[] }) {
  if (!conflictIds?.length) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Display name conflict: {pointId} also matches {conflictIds.join(', ')}. Runtime data remains available; rename this display name to a unique value to reduce the conflict.
      </span>
    </div>
  )
}
