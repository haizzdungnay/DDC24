import { AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { programmingErrorCopy } from '../api/errorCopy'
import type { ProgrammingDiagnostic } from '../model/types'

/**
 * `ProblemsDrawer` — dùng chung cho ba tab của PGM-02 và cho PGM-03
 * (DDD-FE-PROG-001 §2). Diagnostic canonical đến từ `GET /checks/{checkId}`;
 * đây chỉ hiển thị lại, không tự tính lỗi. Nhiều lỗi không spam toast — luôn
 * gom vào đây (UX §16.2).
 */
export function ProblemsDrawer({
  diagnostics,
  onSelect
}: {
  diagnostics: ProgrammingDiagnostic[]
  onSelect?: (diagnostic: ProgrammingDiagnostic) => void
}) {
  const { pick } = useI18n()
  if (diagnostics.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-3 text-sm text-[var(--c-text-dim)]">
        {pick('Không có lỗi.', 'No problems.')}
      </div>
    )
  }
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)]" role="region" aria-label={pick('Danh sách lỗi', 'Problems list')}>
      <ul className="divide-y divide-[var(--c-border)]">
        {diagnostics.map((diagnostic, index) => {
          const Icon = diagnostic.severity === 'ERROR' ? AlertCircle : diagnostic.severity === 'WARNING' ? AlertTriangle : Info
          const iconClass = diagnostic.severity === 'ERROR' ? 'text-[var(--c-fault-fg)]' : diagnostic.severity === 'WARNING' ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-info)]'
          const location = diagnostic.location
          const locationText = location ? [location.programId && `program ${String(location.programId).slice(0, 8)}`, location.line !== undefined && `dòng ${location.line}`].filter(Boolean).join(' · ') : undefined
          return (
            <li key={`${diagnostic.code}-${index}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-2)] focus-visible:bg-[var(--c-surface-2)]"
                onClick={() => onSelect?.(diagnostic)}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
                <span>
                  <span className="block font-mono text-xs text-[var(--c-text-dim)]">{diagnostic.code}{locationText ? ` · ${locationText}` : ''}</span>
                  <span className="block text-[var(--c-text)]">{programmingErrorCopy(pick, diagnostic.code)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
