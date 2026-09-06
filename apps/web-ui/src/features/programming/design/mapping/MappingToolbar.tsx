import { Search, SlidersHorizontal } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { formatTechnicalTime } from '../../../../shared/dateTime'
import { useI18n } from '../../../../shared/i18n'
import { cn } from '../../../../shared/utils'
import { UNASSIGNED_EQUIPMENT, type AccessFilter, type CatalogTruthState, type StatusFilter } from './mappingViewModel'

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
  canRetry?: boolean
  onRetry?: () => void
  onRestart?: () => void
  direction: 'ALL' | 'INPUT' | 'OUTPUT' | 'INOUT'
  onDirectionChange: (value: 'ALL' | 'INPUT' | 'OUTPUT' | 'INOUT') => void
  dataType: string
  dataTypes: string[]
  onDataTypeChange: (value: string) => void
  /* `ISS-PIO-10` (F-PIO-025, đề bài §28) — hai bộ lọc còn thiếu.
   * `Access` lọc Point theo quyền đọc/ghi; `Status` lọc CẢ HAI danh sách để
   * màn hình không tự mâu thuẫn (xem `matchesVariableStatus`). */
  access: AccessFilter
  onAccessChange: (value: AccessFilter) => void
  status: StatusFilter
  onStatusChange: (value: StatusFilter) => void
  counts: { variables: number; mapped: number; unmapped: number; review: number; catalog: number }
  /* `ISS-PIO-13`: nút Gợi ý từng bị khoá cứng kèm tooltip "chỉ bật sau khi
   * capability authority được công bố". Authority đó nay có thật
   * (`GET /api/v1/system/capabilities`, `ISS-PIO-12`), nên nút mở — nhưng chỉ
   * khi ĐỦ hai điều kiện, và khi thiếu thì `suggestionsBlockedReason` phải nói
   * ra thiếu cái gì thay vì để lại một tooltip vĩnh viễn không ai gỡ. */
  /* `ISS-PIO-07`: `ADR-042` đã dựng khái niệm thiết bị công nghệ cho trang
   * Giám sát, nhưng tab Ánh xạ không lọc theo AHU-01 được — đó là mất mát cụ
   * thể nhất mà `F-PIO-006` nêu. */
  equipment: string
  equipmentOptions: string[]
  onEquipmentChange: (value: string) => void
  suggestionsEnabled: boolean
  suggestionsActive: boolean
  suggestionsBlockedReason?: string
  onToggleSuggestions: () => void
}

export function MappingToolbar({ query, onQueryChange, programFilter = 'ALL', programs = [], onProgramFilterChange, category, onCategoryChange, truth, error, canRetry = false, onRetry, onRestart, direction, onDirectionChange, dataType, dataTypes, onDataTypeChange, access, onAccessChange, status, onStatusChange, counts, equipment, equipmentOptions, onEquipmentChange, suggestionsEnabled, suggestionsActive, suggestionsBlockedReason, onToggleSuggestions }: MappingToolbarProps) {
  const { pick, locale } = useI18n()
  const stale = truth.status === 'error' || truth.complete === false
  return (
    <div className="space-y-2">
      {stale && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          <span><strong>{truth.status === 'error' ? (error ?? pick('Catalog Point không sẵn sàng.', 'Point Catalog unavailable.')) : pick('Catalog Point chưa tải đủ.', 'Point Catalog not fully loaded.')}</strong> {pick('Map/Remove đang khóa; dữ liệu cũ chỉ dùng để inspect.', 'Map/Remove locked; stale data inspect-only.')}</span>
          <span className="flex flex-wrap items-center gap-2">
            {truth.lastSuccessAt && <span>{pick('Lần đọc đầy đủ gần nhất:', 'Last complete read:')} {formatTechnicalTime(truth.lastSuccessAt, locale)}</span>}
            {truth.status === 'error' && canRetry && onRetry && (
              <button type="button" onClick={onRetry} className="rounded border border-current px-2 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]">
                {pick('Thử lại trang lỗi', 'Retry failed page')}
              </button>
            )}
            {truth.status === 'error' && onRestart && (
              <button type="button" onClick={onRestart} className="rounded border border-current px-2 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]">
                {pick('Đọc lại từ đầu', 'Restart from first page')}
              </button>
            )}
          </span>
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
        {equipmentOptions.length > 0 && (
          <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]">
            <span>{pick('Thiết bị', 'Equipment')}</span>
            <select
              aria-label={pick('Thiết bị', 'Equipment')}
              value={equipment}
              onChange={(event) => onEquipmentChange(event.target.value)}
              className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]"
            >
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              {equipmentOptions.map((option) => (
                <option key={option} value={option}>
                  {option === UNASSIGNED_EQUIPMENT ? pick('Chưa gán', 'Unassigned') : option}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]">
          <span>{pick('Quyền', 'Access')}</span>
          <select aria-label={pick('Quyền truy cập Point', 'Point access')} value={access} onChange={(event) => onAccessChange(event.target.value as AccessFilter)} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]">
            <option value="ALL">{pick('Tất cả', 'All')}</option>
            <option value="READ">{pick('Đọc', 'Read')}</option>
            <option value="WRITE">{pick('Ghi', 'Write')}</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]">
          <span>{pick('Trạng thái', 'Status')}</span>
          <select aria-label={pick('Trạng thái Point', 'Point status')} value={status} onChange={(event) => onStatusChange(event.target.value as StatusFilter)} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]">
            <option value="ALL">{pick('Tất cả', 'All')}</option>
            <option value="GOOD">Good</option>
            <option value="UNMAPPED">{pick('Chưa map', 'Unmapped')}</option>
            <option value="OFFLINE">Offline</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]"><span>{pick('Kiểu', 'Type')}</span><select aria-label={pick('Kiểu dữ liệu', 'Data type')} value={dataType} onChange={(event) => onDataTypeChange(event.target.value)} className="rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]"><option value="ALL">{pick('Tất cả', 'All')}</option>{dataTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <button
          type="button"
          disabled={!suggestionsEnabled}
          aria-pressed={suggestionsActive}
          onClick={onToggleSuggestions}
          className={cn(
            'inline-flex min-h-10 items-center gap-2 rounded border px-3 text-xs font-semibold',
            suggestionsEnabled ? 'border-[var(--c-border)] text-[var(--c-text)]' : 'border-dashed border-[var(--c-border)] text-[var(--c-text-dim)]',
            suggestionsActive && 'border-[var(--c-accent)] text-[var(--c-accent)]'
          )}
          title={suggestionsEnabled
            ? pick('Chỉ hiện Point tương thích VÀ nằm trên kênh bo xác nhận có thật', 'Show only Points that are compatible AND on a channel the board confirms')
            : suggestionsBlockedReason}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {pick('Gợi ý', 'Suggestions')}
        </button>
        <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Mapping counters">
          <StatusBadge state="online" label={`Mapped ${counts.mapped}`} />
          <StatusBadge state={counts.unmapped ? 'warning' : 'online'} label={`${pick('Chưa map', 'Unmapped')} ${counts.unmapped}`} />
          <StatusBadge state={counts.review ? 'warning' : 'online'} label={`Review ${counts.review}`} />
          <span className="rounded-full border border-[var(--c-border)] px-2.5 py-1 font-semibold text-[var(--c-text-dim)]">
            {truth.complete === false
              ? pick(`Catalog ${counts.catalog}+ · đang tải/chưa đủ`, `Catalog ${counts.catalog}+ · loading/incomplete`)
              : pick(`Catalog ${counts.catalog} · đã đủ`, `Catalog ${counts.catalog} · complete`)}
          </span>
        </div>
      </section>
    </div>
  )
}
