import { useI18n } from '../../../../../shared/i18n'
import { Link } from 'react-router-dom'
import type { InspectorField } from '../inspectorContext'

export interface ReferencesSectionProps {
  usedBy: InspectorField<readonly string[]>
  uses: InspectorField<readonly string[]>
  executionTabHref?: string
}

function ReferenceList({ value }: { value: InspectorField<readonly string[]> }) {
  const { pick } = useI18n()
  if (!value.known) {
    return <p className="italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</p>
  }
  if (value.value.length === 0) {
    return <p className="text-[var(--c-text-dim)]">{pick('không có', 'none')}</p>
  }
  return (
    <ul className="space-y-0.5">
      {value.value.map((name) => <li key={name} className="truncate font-mono text-[11px] text-[var(--c-text)]" title={name}>{name}</li>)}
    </ul>
  )
}

export function ReferencesSection({ usedBy, uses, executionTabHref }: ReferencesSectionProps) {
  const { pick } = useI18n()
  return (
    <details className="mt-3 border-t border-[var(--c-border)]/70 pt-2 text-xs" data-testid="inspector-references-section">
      <summary className="cursor-pointer font-medium text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
        {pick('Tham chiếu', 'References')}
      </summary>
      <div className="mt-2 space-y-3">
        <div>
          <h4 className="mb-1 font-medium text-[var(--c-text)]">{pick('Được dùng bởi', 'Used by')}</h4>
          <ReferenceList value={usedBy} />
        </div>
        <div>
          <h4 className="mb-1 font-medium text-[var(--c-text)]">{pick('Sử dụng', 'Uses')}</h4>
          <ReferenceList value={uses} />
        </div>
        <div>
          <h4 className="mb-1 font-medium text-[var(--c-text)]">{pick('Gọi hàm', 'Calls')}</h4>
          <p className="italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</p>
        </div>
        {executionTabHref && (
          <Link className="inline-flex min-h-9 items-center text-[var(--c-accent)] underline" to={executionTabHref}>
            {pick('Mở cấu hình Task toàn cục', 'Open global task configuration')}
          </Link>
        )}
      </div>
    </details>
  )
}
