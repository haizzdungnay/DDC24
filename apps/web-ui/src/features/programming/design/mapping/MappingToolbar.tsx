import { Search, SlidersHorizontal } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { useI18n } from '../../../../shared/i18n'
import type { CatalogTruthState } from './mappingViewModel'

export interface MappingToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  programFilter?: string
  programs?: Array<{ programId: string; name: string }>
  onProgramFilterChange?: (value: string) => void
  category: 'ALL' | 'LOCAL' | 'VP' | 'MB_RTU'
  onCategoryChange: (value: 'ALL' | 'LOCAL' | 'VP' | 'MB_RTU') => void
  truth: CatalogTruthState
  error?: string | null
  direction: 'ALL' | 'INPUT' | 'OUTPUT' | 'INOUT'
  onDirectionChange: (value: 'ALL' | 'INPUT' | 'OUTPUT' | 'INOUT') => void
  dataType: string
  dataTypes: string[]
  onDataTypeChange: (value: string) => void
  counts: { variables: number; mapped: number; unmapped: number; review: number; catalog: number }
}

export function MappingToolbar({ query, onQueryChange, programFilter = 'ALL', programs = [], onProgramFilterChange, category, onCategoryChange, truth, error, direction, onDirectionChange, dataType, dataTypes, onDataTypeChange, counts }: MappingToolbarProps) {
  const { pick } = useI18n()
  const stale = truth.status === 'error' || truth.complete === false
  return (
    <div className="space-y-2">
      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          <span><strong>{truth.status === 'error' ? (error ?? pick('Catalog Point không sẵn sàng.', 'Point Catalog unavailable.')) : pick('Catalog Point chưa tải đủ.', 'Point Catalog not fully loaded.')}</strong> {pick('Map/Remove đang khóa; dữ liệu cũ chỉ dùng để inspect.', 'Map/Remove locked; stale data inspect-only.')}</span>
          {truth.lastSuccessAt && <span>{pick('Lần đọc thành công gần nhất:', 'Last successful read:')} {new Date(truth.lastSuccessAt).toLocaleTimeString('vi-VN')}</span>}
        </div>
      )}
      <section aria-label="Mapping toolbar" className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2">
        <label className="flex min-h-10 min-w-[15rem] flex-1 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text-dim)]">
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{pick('Tìm biến hoặc Point', 'Search variable or Point')}</span>
          <input role="searchbox" aria-label={pick('Tìm biến hoặc Point', 'Search variable or Point')} className="min-w-0 flex-1 bg-transparent text-[var(--c-text)] outline-none" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={pick('Tìm biến hoặc Point…', 'Search variable or Point…')} />
        </label>
        {programs.length > 0 && (
          <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]">
            <span>{pick('Chương trình', 'Program')}</span>
            <select aria-label={pick('Chương trình', 'Program')} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]" value={programFilter} onChange={(event) => onProgramFilterChange?.(event.target.value)}>
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              {programs.map((p) => (
                <option key={p.programId} value={p.programId}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]">
          <span>{pick('Loại Point', 'Point Category')}</span>
          <select aria-label={pick('Loại Point', 'Point Category')} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]" value={category} onChange={(event) => onCategoryChange(event.target.value as MappingToolbarProps['category'])}>
            <option value="ALL">{pick('Tất cả', 'All')}</option>
            <option value="LOCAL">LOCAL</option>
            <option value="VP">VP</option>
            <option value="MB_RTU">MB_RTU</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]"><span>{pick('Hướng', 'Direction')}</span><select aria-label={pick('Hướng Variable', 'Variable direction')} value={direction} onChange={(event) => onDirectionChange(event.target.value as MappingToolbarProps['direction'])} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]"><option value="ALL">{pick('Tất cả', 'All')}</option><option value="INPUT">INPUT</option><option value="OUTPUT">OUTPUT</option><option value="INOUT">INOUT</option></select></label>
        <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]"><span>{pick('Kiểu', 'Type')}</span><select aria-label={pick('Kiểu dữ liệu', 'Data type')} value={dataType} onChange={(event) => onDataTypeChange(event.target.value)} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]"><option value="ALL">{pick('Tất cả', 'All')}</option>{dataTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <button type="button" disabled className="inline-flex min-h-10 items-center gap-2 rounded border border-dashed border-[var(--c-border)] px-3 text-xs font-semibold text-[var(--c-text-dim)]" title={pick('Suggestions chỉ bật sau khi capability authority được công bố', 'Suggestions available after capability authority published')}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {pick('Gợi ý (Phase 1A)', 'Suggestions (Phase 1A)')}
        </button>
        <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Mapping counters">
          <StatusBadge state="online" label={`Mapped ${counts.mapped}`} />
          <StatusBadge state={counts.unmapped ? 'warning' : 'online'} label={`${pick('Chưa map', 'Unmapped')} ${counts.unmapped}`} />
          <StatusBadge state={counts.review ? 'warning' : 'online'} label={`Review ${counts.review}`} />
          <span className="rounded-full border border-[var(--c-border)] px-2.5 py-1 font-semibold text-[var(--c-text-dim)]">Catalog {truth.complete === false ? `${counts.catalog}+` : counts.catalog}</span>
        </div>
      </section>
    </div>
  )
}
