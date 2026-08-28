import { CircleHelp, ShieldAlert } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { formatMappingValue, type MappingVariableRow } from './mappingViewModel'

export function MappingInspector({ row }: { row: MappingVariableRow | null }) {
  return <aside className="min-w-0 max-w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4" aria-live="polite" aria-labelledby="mapping-inspector-title">
    <div className="flex items-start justify-between gap-2"><div><h2 id="mapping-inspector-title" className="text-sm font-semibold text-[var(--c-text)]">Binding Inspector</h2><p className="mt-1 text-xs text-[var(--c-text-dim)]">Read-back authority · không tự suy diễn</p></div><CircleHelp className="h-4 w-4 text-[var(--c-text-dim)]" aria-hidden="true" /></div>
    {!row ? <p className="mt-4 text-sm text-[var(--c-text-dim)]">Chọn một biến hoặc mapping để inspect.</p> : <div className="mt-4 space-y-3 text-xs">
      <div><span className="text-[var(--c-text-dim)]">Variable</span><strong className="mt-1 block text-sm text-[var(--c-text)]">{row.name}</strong><span className="text-[var(--c-text-dim)]">{row.programName} · {row.type} · {row.direction}</span></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2"><dt className="text-[var(--c-text-dim)]">Point</dt><dd className="font-mono text-[var(--c-text)]">{row.point ? `${row.point.category}:${row.point.deviceId ? `${row.point.deviceId}:` : ''}${row.point.pointId}` : '—'}</dd><dt className="text-[var(--c-text-dim)]">Giá trị</dt><dd className="font-mono text-[var(--c-text)]">{formatMappingValue(row.liveValue)}</dd><dt className="text-[var(--c-text-dim)]">Quality</dt><dd><StatusBadge state={row.liveQuality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'} label={row.liveQuality} /></dd><dt className="text-[var(--c-text-dim)]">Eligibility</dt><dd className="text-[var(--c-text)]">{row.eligibility}</dd><dt className="text-[var(--c-text-dim)]">Observed</dt><dd className="text-[var(--c-text)]">{row.observedAt ? new Date(row.observedAt).toLocaleString('vi-VN') : '—'}</dd></dl>
      <div className="rounded border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-[var(--c-warn-fg)]"><ShieldAlert className="mr-1 inline h-4 w-4" aria-hidden="true" /><strong>Chưa xác minh — API chưa cung cấp authority</strong><p className="mt-1">Owner/Published Signal/consumer không được suy đoán từ FE.</p></div>
      {row.compatibility.reasons.length > 0 && <p className="rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2 text-[var(--c-text-dim)]">{row.compatibility.reasons.join(' · ')}</p>}
    </div>}
  </aside>
}
