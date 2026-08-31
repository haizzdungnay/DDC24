import { CircleAlert, Database, Radio, Server } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { formatMappingValue, type MappingPointRow } from './mappingViewModel'

export type PointKindFilter = 'ALL' | 'UI' | 'AO' | 'DO' | 'VP' | 'MB_RTU'

export function PointCatalogPane({ rows, selectedKey, onSelect, pointKind, onPointKindChange }: {
  rows: MappingPointRow[]
  selectedKey: string | null
  onSelect: (key: string) => void
  pointKind: PointKindFilter
  onPointKindChange: (value: PointKindFilter) => void
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] 2xl:h-[39rem] 2xl:max-h-[calc(100vh-18rem)]" aria-labelledby="mapping-points-title">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-4 py-3"><div><h2 id="mapping-points-title" className="text-sm font-semibold text-[var(--c-text)]">Điểm khả dụng</h2><p className="mt-1 text-xs text-[var(--c-text-dim)]">Canonical Point · giá trị chỉ đọc</p></div><Database className="h-5 w-5 text-[var(--c-accent)]" aria-hidden="true" /></div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--c-border)] px-4 py-2" role="group" aria-label="Phân loại Point">
        {(['ALL', 'UI', 'AO', 'DO', 'VP', 'MB_RTU'] as const).map((kind) => (
          <button key={kind} type="button" aria-pressed={pointKind === kind} onClick={() => onPointKindChange(kind)} className={`rounded border px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${pointKind === kind ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)] hover:border-[var(--c-accent)] hover:text-[var(--c-text)]'}`}>
            {kind === 'ALL' ? 'Tất cả' : kind}
          </button>
        ))}
        <span className="text-xs text-[var(--c-text-dim)]">{rows.length} Point đang inspect</span>
      </div>
      <div data-testid="mapping-point-list" className="min-h-0 flex-1 divide-y divide-[var(--c-border)] overflow-y-auto [scrollbar-gutter:stable]">
        {rows.length === 0 ? <p className="p-4 text-sm text-[var(--c-text-dim)]">Catalog không có Point khớp bộ lọc.</p> : rows.map((row) => {
          const state = row.quality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'
          const unsupported = row.eligibility === 'UNSUPPORTED_BY_CORE' || row.eligibility === 'UNSUPPORTED_IDENTITY'
          return <button key={row.key} type="button" aria-pressed={selectedKey === row.key} aria-label={`${row.category} ${row.name}`} onClick={() => onSelect(row.key)} className={`grid min-h-[3.5rem] w-full shrink-0 gap-2 px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] md:grid-cols-[minmax(8rem,1fr)_5rem_5rem_6rem] ${selectedKey === row.key ? 'bg-[var(--c-accent-bg)]' : 'hover:bg-[var(--c-surface-2)]'}`}>
            <span className="min-w-0"><span className="flex items-center gap-2 font-semibold text-[var(--c-text)]">{row.name}{unsupported && <CircleAlert className="h-3.5 w-3.5 text-[var(--c-warn-fg)]" aria-label="Core chưa hỗ trợ" />}</span><span className="mt-1 block truncate font-mono text-[11px] text-[var(--c-text-dim)]">{row.category}:{row.deviceId ? `${row.deviceId}:` : ''}{row.pointId}</span></span>
            <span className="text-xs text-[var(--c-text-dim)]"><strong className="block text-[var(--c-text)]">{row.dataType}</strong>{row.unit ?? '—'}</span>
            <span className="font-mono text-xs text-[var(--c-text)]">{formatMappingValue(row.value)}</span>
            <span className="flex flex-wrap items-start gap-1"><StatusBadge state={state} label={row.quality} />{unsupported ? <span className="flex items-center gap-1 text-[10px] text-[var(--c-warn-fg)]"><Radio className="h-3 w-3" aria-hidden="true" />Core chưa hỗ trợ</span> : row.writable ? <span className="text-[10px] text-[var(--c-good-fg)]">Ghi được</span> : <span className="text-[10px] text-[var(--c-text-dim)]">Chỉ đọc</span>}</span>
          </button>
        })}
      </div>
      <p className="border-t border-[var(--c-border)] px-4 py-2 text-[11px] text-[var(--c-text-dim)]"><Server className="mr-1 inline h-3 w-3" aria-hidden="true" />Backend/Core là authority; catalog không chứng minh Point đã map được vào runtime.</p>
    </section>
  )
}
