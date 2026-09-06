import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, ExternalLink, LockKeyhole, Unlink } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { Button } from '../../../../shared/components/Button'
import { useI18n } from '../../../../shared/i18n'
import { formatMappingValue, type MappingVariableRow } from './mappingViewModel'
import { mappingReasonText } from './mappingReasons'

export function VariableWorklist({ rows, selectedId, onSelect, onOpenSource, canMutate, mutationDisabled, onMap }: {
  rows: MappingVariableRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenSource: (row: MappingVariableRow) => void
  canMutate: boolean
  mutationDisabled: boolean
  onMap: (row: MappingVariableRow) => void
}) {
  const { pick } = useI18n()
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] 2xl:h-[39rem] 2xl:max-h-[calc(100vh-18rem)]" aria-labelledby="mapping-variables-title">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-4 py-3">
        <div><h2 id="mapping-variables-title" className="text-sm font-semibold text-[var(--c-text)]">{pick('Biến chương trình', 'Program Variables')}</h2><p className="mt-1 text-xs text-[var(--c-text-dim)]">{rows.length} {pick('biến interface · thay đổi chỉ ghi sau bước xem trước', 'interface variables · changes are written only after preview')}</p></div>
        <span className="rounded-full bg-[var(--c-accent-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--c-accent)]">{canMutate ? 'EDIT' : 'READ-ONLY'}</span>
      </div>
      <div data-testid="mapping-variable-list" className="min-h-0 flex-1 divide-y divide-[var(--c-border)] overflow-y-auto [scrollbar-gutter:stable]">
        {rows.length === 0 ? <p className="p-4 text-sm text-[var(--c-text-dim)]">{pick('Chưa có biến I/O có thể inspect.', 'No I/O variables available to inspect.')}</p> : rows.map((row) => {
          const selected = row.id === selectedId
          const qualityState = row.liveQuality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'
          const statusText = row.bindingStatus === 'UNMAPPED' ? pick('Chưa map', 'Unmapped') : row.bindingStatus === 'POINT_UNAVAILABLE' ? pick('Point không còn', 'Point unavailable') : row.bindingStatus === 'INCOMPATIBLE' ? pick('Không tương thích', 'Incompatible') : row.eligibility === 'UNSUPPORTED_BY_CORE' ? pick('Core chưa hỗ trợ', 'Unsupported by Core') : row.eligibility === 'UNSUPPORTED_DIRECTION' ? pick('Hướng chưa hỗ trợ', 'Unsupported direction') : pick('Đã map', 'Mapped')
          return (
            <div key={row.id} className={`grid gap-2 p-3 transition hover:bg-[var(--c-surface-2)] xl:grid-cols-[minmax(10rem,1.2fr)_7rem_5rem_6rem_minmax(8rem,1fr)_6rem_auto] ${selected ? 'bg-[var(--c-accent-bg)]' : ''}`}>
              <button type="button" aria-pressed={selected} aria-label={`${row.programName} · ${row.name} · ${statusText}`} onClick={() => onSelect(row.id)} className="min-w-0 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]">
                <span className="flex items-center gap-2"><span className="font-semibold text-[var(--c-text)]">{row.name}</span>{row.bindingStatus === 'POINT_UNAVAILABLE' && <CircleAlert className="h-4 w-4 text-[var(--c-warn-fg)]" aria-label={pick('Point không còn', 'Point unavailable')} />}</span>
                <span className="mt-1 block truncate text-xs text-[var(--c-text-dim)]">{row.point ? `${row.point.category}:${row.point.deviceId ? `${row.point.deviceId}:` : ''}${row.point.pointId}` : pick('Chưa có Point', 'No Point')}</span>
              </button>
              <span className="flex items-center truncate text-xs text-[var(--c-text-dim)]" title={row.programName}><span className="truncate">{row.programName}</span></span>
              <span className="flex items-center gap-1 text-xs font-semibold text-[var(--c-text-dim)]">{row.direction === 'INPUT' ? <ArrowDownToLine className="h-3.5 w-3.5 text-[var(--c-accent)]" aria-hidden="true" /> : row.direction === 'OUTPUT' ? <ArrowUpFromLine className="h-3.5 w-3.5 text-[var(--c-good-fg)]" aria-hidden="true" /> : <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />}{row.direction}</span>
              <span className="text-xs text-[var(--c-text-dim)]"><strong className="block text-[var(--c-text)]">{row.type}</strong>{row.bindingStatus}</span>
              <span className="min-w-0 text-xs"><strong className="block truncate text-[var(--c-text)]">{row.pointName ?? '—'}</strong><span className="text-[var(--c-text-dim)]">{row.compatibility.reasons[0] ? mappingReasonText(row.compatibility.reasons[0], pick) : 'Read-back authority'}</span></span>
              <span className="flex items-start gap-2 text-xs"><strong className="font-mono text-[var(--c-text)]">{formatMappingValue(row.liveValue, pick)}</strong><StatusBadge state={qualityState} label={row.liveQuality} /></span>
              <div className="flex flex-wrap items-center justify-end gap-1">
                <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => onOpenSource(row)}>{pick('Mở nguồn', 'Open source')}</Button>
                {canMutate && <Button size="sm" variant="secondary" disabled={mutationDisabled || !selected || row.direction === 'INOUT'} icon={<Unlink className="h-3.5 w-3.5" aria-hidden="true" />} title={mutationDisabled ? pick('Cần Project, Point đã chọn và Point Catalog đầy đủ trước khi xem trước', 'A project, selected point, and complete Point Catalog are required before preview') : undefined} aria-label={`${pick(row.bindingId ? 'Đổi ánh xạ' : 'Ánh xạ', row.bindingId ? 'Change mapping' : 'Map')} ${row.programName} · ${row.name}`} onClick={() => onMap(row)}>{pick(row.bindingId ? 'Đổi' : 'Map', row.bindingId ? 'Change' : 'Map')}</Button>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
