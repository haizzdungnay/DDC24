import { useId, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
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

/** Một bộ lọc đang áp: nhận biết được bằng mắt VÀ gỡ được bằng bàn phím. */
export interface ActiveMappingFilter {
  key: string
  /** Tên bộ lọc, đã dịch. */
  label: string
  /** Giá trị đang áp, đã dịch khi là nhãn UI (`Chưa gán`) và giữ nguyên khi là
   *  định danh kỹ thuật (`MB_RTU`, `REAL`, `AHU-01`). */
  value: string
  clear: () => void
}

const SELECT_CLASS = 'rounded bg-[var(--c-surface-2)] py-1 text-[var(--c-text)] outline-none [color-scheme:dark]'
const FIELD_CLASS = 'flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text-dim)]'

export function MappingToolbar({ query, onQueryChange, programFilter = 'ALL', programs = [], onProgramFilterChange, category, onCategoryChange, truth, error, canRetry = false, onRetry, onRestart, direction, onDirectionChange, dataType, dataTypes, onDataTypeChange, access, onAccessChange, status, onStatusChange, counts, equipment, equipmentOptions, onEquipmentChange, suggestionsEnabled, suggestionsActive, suggestionsBlockedReason, onToggleSuggestions }: MappingToolbarProps) {
  const { pick, locale } = useI18n()
  const stale = truth.status === 'error' || truth.complete === false
  const advancedId = useId()
  const suggestionsNoteId = useId()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  /* `ISS-PGM03-05` — bộ lọc Advanced không được biến mất khỏi nhận thức của
   * người dùng chỉ vì drawer đang đóng. Mỗi bộ lọc đang áp phải có một chip
   * NÓI RA nó đang áp và một nút gỡ đi tới được bằng Tab. */
  const programName = programs.find((program) => program.programId === programFilter)?.name
  const advancedFilters: ActiveMappingFilter[] = [
    ...(programFilter !== 'ALL' && onProgramFilterChange
      ? [{ key: 'program', label: pick('Chương trình', 'Program'), value: programName ?? programFilter, clear: () => onProgramFilterChange('ALL') }]
      : []),
    ...(category !== 'ALL' ? [{ key: 'category', label: pick('Loại Point', 'Point Category'), value: category, clear: () => onCategoryChange('ALL') }] : []),
    ...(equipment !== 'ALL'
      ? [{ key: 'equipment', label: pick('Thiết bị', 'Equipment'), value: equipment === UNASSIGNED_EQUIPMENT ? pick('Chưa gán', 'Unassigned') : equipment, clear: () => onEquipmentChange('ALL') }]
      : []),
    ...(access !== 'ALL' ? [{ key: 'access', label: pick('Quyền', 'Access'), value: access === 'READ' ? pick('Đọc', 'Read') : pick('Ghi', 'Write'), clear: () => onAccessChange('ALL') }] : []),
    ...(status !== 'ALL'
      ? [{ key: 'status', label: pick('Trạng thái', 'Status'), value: status === 'UNMAPPED' ? pick('Chưa map', 'Unmapped') : status === 'GOOD' ? 'Good' : 'Offline', clear: () => onStatusChange('ALL') }]
      : []),
  ]
  const primaryFilters: ActiveMappingFilter[] = [
    ...(query.trim() ? [{ key: 'query', label: pick('Tìm kiếm', 'Search'), value: query.trim(), clear: () => onQueryChange('') }] : []),
    ...(direction !== 'ALL' ? [{ key: 'direction', label: pick('Hướng', 'Direction'), value: direction, clear: () => onDirectionChange('ALL') }] : []),
    ...(dataType !== 'ALL' ? [{ key: 'dataType', label: pick('Kiểu', 'Type'), value: dataType, clear: () => onDataTypeChange('ALL') }] : []),
  ]
  const activeFilters = [...primaryFilters, ...advancedFilters]

  function clearAll() {
    for (const filter of activeFilters) filter.clear()
  }

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
      <section aria-label="Mapping toolbar" className="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2">
        {/* Hàng primary — `ISS-PGM03-05`: chỉ Tìm kiếm, Hướng, Kiểu, Gợi ý và
          * lối vào Advanced. Tám control cùng cấp như bản trước làm hàng này
          * xuống dòng ở 1280×800 và làm bộ lọc trông ngang hàng với hành động. */}
        <div data-testid="mapping-toolbar-primary" className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 min-w-[15rem] flex-1 items-center gap-2 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text-dim)]">
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{pick('Tìm biến hoặc Point', 'Search variable or Point')}</span>
            <input role="searchbox" aria-label={pick('Tìm biến hoặc Point', 'Search variable or Point')} className="min-w-0 flex-1 bg-transparent text-[var(--c-text)] outline-none" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={pick('Tìm biến hoặc Point…', 'Search variable or Point…')} />
          </label>
          <label className={FIELD_CLASS}>
            <span>{pick('Hướng', 'Direction')}</span>
            <select aria-label={pick('Hướng Variable', 'Variable direction')} value={direction} onChange={(event) => onDirectionChange(event.target.value as MappingToolbarProps['direction'])} className={SELECT_CLASS}>
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              <option value="INPUT">INPUT</option>
              <option value="OUTPUT">OUTPUT</option>
              <option value="INOUT">INOUT</option>
            </select>
          </label>
          <label className={FIELD_CLASS}>
            <span>{pick('Kiểu', 'Type')}</span>
            <select aria-label={pick('Kiểu dữ liệu', 'Data type')} value={dataType} onChange={(event) => onDataTypeChange(event.target.value)} className={SELECT_CLASS}>
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              {dataTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={!suggestionsEnabled}
            aria-pressed={suggestionsActive}
            aria-describedby={suggestionsNoteId}
            onClick={onToggleSuggestions}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded border px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]',
              suggestionsEnabled ? 'border-[var(--c-border)] text-[var(--c-text)]' : 'border-dashed border-[var(--c-border)] text-[var(--c-text-dim)]',
              suggestionsActive && 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]'
            )}
            title={suggestionsEnabled
              ? pick('Chỉ hiện Point tương thích VÀ nằm trên kênh bo xác nhận có thật', 'Show only Points that are compatible AND on a channel the board confirms')
              : suggestionsBlockedReason}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {pick('Gợi ý', 'Suggestions')}
          </button>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls={advancedId}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="inline-flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] px-3 text-xs font-semibold text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          >
            {pick('Bộ lọc nâng cao', 'Advanced filters')}
            <span className={cn('rounded-full border px-1.5 text-[10px] font-bold', advancedFilters.length > 0 ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)]')}>
              {advancedFilters.length}
            </span>
          </button>
          {activeFilters.length > 0 && (
            <button type="button" onClick={clearAll} className="inline-flex min-h-10 items-center gap-2 rounded border border-[var(--c-border)] px-3 text-xs font-semibold text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]">
              <X className="h-3.5 w-3.5" aria-hidden="true" />{pick('Xóa tất cả bộ lọc', 'Clear all filters')}
            </button>
          )}
        </div>
        {/* Trạng thái bật/tắt nói bằng CHỮ, không chỉ bằng viền đổi màu — và
          * để ngoài nút để tên truy cập của nút vẫn đúng là "Gợi ý". `aria-pressed`
          * lo phần ngữ nghĩa, câu này lo phần đọc được bằng mắt lẫn bằng
          * screen reader (`aria-describedby`). */}
        <p id={suggestionsNoteId} className="text-[11px] text-[var(--c-text-dim)]">
          <strong>{suggestionsActive ? pick('Gợi ý đang BẬT.', 'Suggestions are ON.') : pick('Gợi ý đang TẮT.', 'Suggestions are OFF.')}</strong>{' '}
          {pick('Gợi ý chỉ xếp hạng ứng viên để dễ chọn; nó không tự lưu và không đổi Draft.', 'Suggestions only rank candidates; they never save anything and never change the Draft.')}
        </p>
        {activeFilters.length > 0 && (
          <ul aria-label={pick('Bộ lọc đang áp', 'Active filters')} className="flex flex-wrap items-center gap-1.5">
            {activeFilters.map((filter) => (
              <li key={filter.key}>
                <button
                  type="button"
                  onClick={filter.clear}
                  aria-label={pick(`Xóa bộ lọc ${filter.label}: ${filter.value}`, `Clear ${filter.label} filter: ${filter.value}`)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                >
                  {filter.label}: {filter.value}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div id={advancedId} hidden={!advancedOpen} className="flex flex-wrap items-center gap-2 border-t border-[var(--c-border)] pt-2">
          {programs.length > 0 && (
            <label className={FIELD_CLASS}>
              <span>{pick('Chương trình', 'Program')}</span>
              <select aria-label={pick('Chương trình', 'Program')} className={SELECT_CLASS} value={programFilter} onChange={(event) => onProgramFilterChange?.(event.target.value)}>
                <option value="ALL">{pick('Tất cả', 'All')}</option>
                {programs.map((p) => (
                  <option key={p.programId} value={p.programId}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className={FIELD_CLASS}>
            <span>{pick('Loại Point', 'Point Category')}</span>
            <select aria-label={pick('Loại Point', 'Point Category')} className={SELECT_CLASS} value={category} onChange={(event) => onCategoryChange(event.target.value as MappingToolbarProps['category'])}>
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              <option value="LOCAL">LOCAL</option>
              <option value="VP">VP</option>
              <option value="MB_RTU">MB_RTU</option>
            </select>
          </label>
          {equipmentOptions.length > 0 && (
            <label className={FIELD_CLASS}>
              <span>{pick('Thiết bị', 'Equipment')}</span>
              <select
                aria-label={pick('Thiết bị', 'Equipment')}
                value={equipment}
                onChange={(event) => onEquipmentChange(event.target.value)}
                className={SELECT_CLASS}
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
          <label className={FIELD_CLASS}>
            <span>{pick('Quyền', 'Access')}</span>
            <select aria-label={pick('Quyền truy cập Point', 'Point access')} value={access} onChange={(event) => onAccessChange(event.target.value as AccessFilter)} className={SELECT_CLASS}>
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              <option value="READ">{pick('Đọc', 'Read')}</option>
              <option value="WRITE">{pick('Ghi', 'Write')}</option>
            </select>
          </label>
          <label className={FIELD_CLASS}>
            <span>{pick('Trạng thái', 'Status')}</span>
            <select aria-label={pick('Trạng thái Point', 'Point status')} value={status} onChange={(event) => onStatusChange(event.target.value as StatusFilter)} className={SELECT_CLASS}>
              <option value="ALL">{pick('Tất cả', 'All')}</option>
              <option value="GOOD">Good</option>
              <option value="UNMAPPED">{pick('Chưa map', 'Unmapped')}</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </label>
        </div>
      </section>
      {/* `ISS-PGM03-05` — cụm đếm KHÔNG còn nằm trong cụm lọc. Đặt chung khiến
        * "Mapped 12" trông như một bộ lọc bấm được, và làm hàng lọc dài thêm
        * đúng bốn ô. Nó là tóm tắt trạng thái, nên đứng riêng và NÓI RA khi
        * catalog chưa đủ để bốn con số này được tin. */}
      <section aria-label={pick('Tóm tắt ánh xạ', 'Mapping summary')} className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2 text-xs">
        <span className="font-semibold text-[var(--c-text-dim)]">{pick(`${counts.variables} biến`, `${counts.variables} variables`)}</span>
        <StatusBadge state="online" label={`Mapped ${counts.mapped}`} />
        <StatusBadge state={counts.unmapped ? 'warning' : 'online'} label={`${pick('Chưa map', 'Unmapped')} ${counts.unmapped}`} />
        <StatusBadge state={counts.review ? 'warning' : 'online'} label={`Review ${counts.review}`} />
        <span className="rounded-full border border-[var(--c-border)] px-2.5 py-1 font-semibold text-[var(--c-text-dim)]">
          {truth.complete === false
            ? pick(`Catalog ${counts.catalog}+ · đang tải/chưa đủ`, `Catalog ${counts.catalog}+ · loading/incomplete`)
            : pick(`Catalog ${counts.catalog} · đã đủ`, `Catalog ${counts.catalog} · complete`)}
        </span>
        {stale && (
          <span className="text-[var(--c-warn-fg)]">
            {pick('Số liệu chưa đầy đủ: catalog chưa đọc xong nên bốn con số trên là cận dưới, không phải tổng đã xác minh.', 'Counts are incomplete: the catalog has not finished loading, so these four numbers are a lower bound, not a verified total.')}
          </span>
        )}
      </section>
    </div>
  )
}
