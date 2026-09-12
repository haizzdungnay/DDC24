import { CircleAlert, Database, Radio, Server } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { useI18n } from '../../../../shared/i18n'
import { formatMappingValue, type MappingPointRow } from './mappingViewModel'
import { pointDisplayId, pointKindLabel, pointSourceLabel } from './pointSourceLabels'
import { mappingReasonsText } from './mappingReasons'

export type PointKindFilter = 'ALL' | 'UI' | 'AO' | 'DO' | 'VP' | 'MB_RTU'

export function PointCatalogPane({ rows, selectedKey, onSelect, pointKind, onPointKindChange, filterSummary }: {
  rows: MappingPointRow[]
  selectedKey: string | null
  onSelect: (key: string) => void
  pointKind: PointKindFilter
  onPointKindChange: (value: PointKindFilter) => void
  /** Điều kiện lọc đang áp, đã dịch. Rỗng = không lọc gì. */
  filterSummary?: string
}) {
  /* `ISS-PGUI-02` — bảng này từng viết cứng toàn bộ nhãn bằng tiếng Việt, nên
     giao diện English hiện "Điểm khả dụng", "Chỉ đọc", "Ghi được", "đang
     inspect" (`PM-006`). Mọi chữ dành cho người đọc nay đi qua `pick`; định
     danh kỹ thuật (`UI`/`UO`/`DO`/`MB_RTU`, `dataType`, `quality`) giữ nguyên
     vì dịch chúng sẽ làm màn hình không còn khớp tài liệu và API. */
  const { pick } = useI18n()
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] 2xl:h-[39rem] 2xl:max-h-[calc(100vh-18rem)]" aria-labelledby="mapping-points-title">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-4 py-3"><div><h2 id="mapping-points-title" className="text-sm font-semibold text-[var(--c-text)]">{pick('Điểm khả dụng', 'Available Points')}</h2><p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Canonical Point · giá trị chỉ đọc', 'Canonical Point · read-only values')}</p></div><Database className="h-5 w-5 text-[var(--c-accent)]" aria-hidden="true" /></div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--c-border)] px-4 py-2" role="group" aria-label={pick('Phân loại Point', 'Point category')}>
        {(['ALL', 'UI', 'AO', 'DO', 'VP', 'MB_RTU'] as const).map((kind) => (
          <button key={kind} type="button" aria-pressed={pointKind === kind} onClick={() => onPointKindChange(kind)} className={`rounded border px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${pointKind === kind ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)] hover:border-[var(--c-accent)] hover:text-[var(--c-text)]'}`}>
            {pointKindLabel(kind, pick)}
          </button>
        ))}
        <span className="text-xs text-[var(--c-text-dim)]">{pick(`${rows.length} Point đang inspect`, `${rows.length} Points inspected`)}</span>
      </div>
      <div data-testid="mapping-point-list" className="min-h-0 flex-1 divide-y divide-[var(--c-border)] overflow-y-auto [scrollbar-gutter:stable]">
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-[var(--c-text-dim)]">
            <p>{pick('Catalog không có Point khớp bộ lọc.', 'No Point in the catalog matches the filter.')}</p>
            {/* Nói ra ĐIỀU KIỆN đang áp. "Không khớp bộ lọc" mà không kể ra bộ
              * lọc nào buộc người dùng tự đi dò lại từng ô trên toolbar. */}
            {filterSummary && <p className="mt-1">{pick(`Đang áp bộ lọc: ${filterSummary}. Xóa bớt bộ lọc để thấy thêm Point.`, `Active filters: ${filterSummary}. Clear some filters to see more Points.`)}</p>}
          </div>
        ) : rows.map((row) => {
          const state = row.quality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'
          /* ISS-PIO-32 — nhãn KHÔNG được đoán nguyên nhân. Chip cũ ghi cứng
           * "Core chưa hỗ trợ" cho mọi lý do, kể cả những lý do không thuộc về
           * Core: điểm MB_RTU bị chặn vì catalog chưa phát `extIndex`, không
           * phải vì compiler thiếu năng lực. Chip nay chỉ nói TRẠNG THÁI, còn
           * NGUYÊN NHÂN lấy nguyên văn từ server. */
          const unsupported = row.eligibility === 'UNSUPPORTED_BY_CORE'
            || row.eligibility === 'UNSUPPORTED_IDENTITY'
            || row.eligibility === 'SERVER_DECISION_MISSING'
          const blockedReason = mappingReasonsText(row.compatibilityReasons, pick)
          return <button key={row.key} type="button" aria-pressed={selectedKey === row.key} aria-label={`${pointDisplayId(row)} ${row.name} ${pointSourceLabel(row)}${row.sourceDetail ? ` ${row.sourceDetail}` : ''}`} onClick={() => onSelect(row.key)} className={`grid min-h-[3.5rem] w-full shrink-0 gap-2 px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] md:grid-cols-[minmax(8rem,1fr)_5rem_5rem_6rem] ${selectedKey === row.key ? 'bg-[var(--c-accent-bg)]' : 'hover:bg-[var(--c-surface-2)]'}`}>
            <span className="min-w-0">
              {/* ISS-PIO-09 — danh tính THEO NGUỒN thay cho `category:deviceId:pointId`.
                  Dòng dưới trước đây đọc ra `MB_RTU:bus-1-slave-3:VFD_Frequency`:
                  không thanh ghi, không mã hàm, và `bus-1-slave-3` là danh tính
                  canonical của tầng Programming chứ không phải tên thiết bị trong tủ. */}
              <span className="flex items-center gap-2 font-semibold text-[var(--c-text)]"><span className="font-mono text-xs text-[var(--c-accent)]">{pointDisplayId(row)}</span>{row.name}{unsupported && <CircleAlert className="h-3.5 w-3.5 text-[var(--c-warn-fg)]" aria-label={blockedReason || pick('Chưa map được', 'Cannot be mapped')} />}</span>
              <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-[var(--c-text-dim)]">
                <span className="font-semibold uppercase tracking-wide">{pointSourceLabel(row)}</span>
                {row.sourceDetail && <span className="font-mono">{row.sourceDetail}</span>}
              </span>
            </span>
            <span className="text-xs text-[var(--c-text-dim)]"><strong className="block text-[var(--c-text)]">{row.dataType}</strong>{row.unit ?? '—'}</span>
            <span className="font-mono text-xs text-[var(--c-text)]">{formatMappingValue(row.value, pick)}</span>
            <span className="flex flex-wrap items-start gap-1"><StatusBadge state={state} label={row.quality} />{unsupported ? <span title={blockedReason} className="flex items-center gap-1 text-[10px] text-[var(--c-warn-fg)]"><Radio className="h-3 w-3" aria-hidden="true" />{pick('Chưa map được', 'Cannot be mapped')}</span> : row.writable ? <span className="text-[10px] text-[var(--c-good-fg)]">{pick('Ghi được', 'Writable')}</span> : <span className="text-[10px] text-[var(--c-text-dim)]">{pick('Chỉ đọc', 'Read-only')}</span>}</span>
          </button>
        })}
      </div>
      <p className="border-t border-[var(--c-border)] px-4 py-2 text-[11px] text-[var(--c-text-dim)]"><Server className="mr-1 inline h-3 w-3" aria-hidden="true" />{pick('Backend/Core là authority; catalog không chứng minh Point đã map được vào runtime.', 'Backend/Core is the authority; the catalog does not prove a Point is mapped into the runtime.')}</p>
    </section>
  )
}
