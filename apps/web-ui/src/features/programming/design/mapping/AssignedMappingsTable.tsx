import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { formatTechnicalDateTime } from '../../../../shared/dateTime'
import { useI18n } from '../../../../shared/i18n'
import { formatMappingValue, type MappingVariableRow } from './mappingViewModel'
import { Button } from '../../../../shared/components/Button'
import { Pencil, Unlink } from 'lucide-react'

export function AssignedMappingsTable({ rows, onSelect, canMutate, mutationDisabled, onChange, onRemove }: { rows: MappingVariableRow[]; onSelect: (id: string) => void; canMutate: boolean; mutationDisabled: boolean; onChange: (row: MappingVariableRow) => void; onRemove: (row: MappingVariableRow) => void }) {
  const { pick, locale } = useI18n()
  const assigned = rows.filter((row) => row.bindingId)
  return (
    <section className="flex min-h-0 min-w-0 max-w-full flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]" aria-labelledby="assigned-mappings-title">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--c-border)] px-4 py-3">
        <div>
          <h2 id="assigned-mappings-title" className="text-sm font-semibold text-[var(--c-text)]">{pick('Ánh xạ đã gán', 'Assigned Mappings')}</h2>
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Read-back của Draft hiện tại', 'Read-back of the current Draft')}</p>
        </div>
        <span className="text-xs font-semibold text-[var(--c-text-dim)]">{assigned.length} binding</span>
      </div>
      {assigned.length === 0 ? (
        <p className="p-4 text-sm text-[var(--c-text-dim)]">{pick('Chưa có ánh xạ nào trong Draft.', 'The Draft has no mapping yet.')}</p>
      ) : (
        <>
          <div className="h-[34rem] min-h-0 max-h-[calc(100vh-18rem)] flex-1 divide-y divide-[var(--c-border)] overflow-y-scroll [scrollbar-gutter:stable] md:hidden">
            {assigned.map((row) => (
              /* `ISS-PGM03-05` — thẻ mobile KHÔNG có hàng tiêu đề để dựa vào,
                 nên mỗi ô phải tự mang nhãn. Bốn ô trần trước đây buộc người
                 đọc suy ra `READ · REAL` là "hướng và kiểu" từ hình dạng chuỗi. */
              <div key={row.id} className="grid w-full grid-cols-2 gap-2 p-3 text-left text-xs">
                <span className="min-w-0"><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{pick('Biến', 'Variable')}</span><button type="button" onClick={() => onSelect(row.id)} className="text-left font-semibold text-[var(--c-accent)] hover:underline">{row.name}</button></span>
                <span className="min-w-0 truncate text-right"><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">Point</span><span className="font-mono">{row.point ? `${row.point.category}:${row.point.pointId}` : '—'}</span></span>
                <span><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{pick('Hướng/kiểu', 'Direction/type')}</span>{row.direction} · {row.type}</span>
                <span className="flex flex-wrap items-center justify-end gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{pick('Giá trị', 'Value')}</span><span className="font-mono">{formatMappingValue(row.liveValue, pick)}</span><StatusBadge state={row.liveQuality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'} label={row.liveQuality} /></span>
                {canMutate && <span className="col-span-2 flex justify-end gap-1"><Button size="sm" className="min-h-11" variant="ghost" disabled={mutationDisabled} icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => onChange(row)}>{pick('Đổi', 'Change')}</Button><Button size="sm" className="min-h-11" variant="danger" disabled={mutationDisabled} icon={<Unlink className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => onRemove(row)}>{pick('Gỡ ánh xạ', 'Remove mapping')}</Button></span>}
              </div>
            ))}
          </div>
          <div className="h-[34rem] min-h-0 max-h-[calc(100vh-18rem)] flex-1 hidden max-w-full overflow-auto md:block [scrollbar-gutter:stable]">
            <table className="w-full min-w-[44rem] text-left text-xs">
              <thead className="border-b border-[var(--c-border)] text-[var(--c-text-dim)]"><tr><th className="px-4 py-2">{pick('Biến', 'Variable')}</th><th className="px-4 py-2">Point</th><th className="px-4 py-2">{pick('Hướng/kiểu', 'Direction/type')}</th><th className="px-4 py-2">{pick('Giá trị', 'Value')}</th><th className="px-4 py-2">Quality</th><th className="px-4 py-2">{pick('Cập nhật', 'Updated')}</th>{canMutate && <th className="px-4 py-2">{pick('Thao tác', 'Actions')}</th>}</tr></thead>
              <tbody>
                {assigned.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--c-border)] last:border-0 hover:bg-[var(--c-surface-2)]">
                    <td className="px-4 py-2"><button type="button" className="font-semibold text-[var(--c-accent)] hover:underline" onClick={() => onSelect(row.id)}>{row.name}</button></td>
                    <td className="px-4 py-2 font-mono">{row.point ? `${row.point.category}:${row.point.deviceId ? `${row.point.deviceId}:` : ''}${row.point.pointId}` : '—'}</td>
                    <td className="px-4 py-2">{row.direction} · {row.type}</td>
                    <td className="px-4 py-2 font-mono">{formatMappingValue(row.liveValue, pick)}</td>
                    <td className="px-4 py-2"><StatusBadge state={row.liveQuality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'} label={row.liveQuality} /></td>
                    <td className="px-4 py-2 whitespace-nowrap text-[var(--c-text-dim)]">{formatTechnicalDateTime(row.observedAt, locale)}</td>
                    {canMutate && <td className="px-4 py-2"><span className="flex gap-1"><Button size="sm" className="min-h-11" variant="ghost" disabled={mutationDisabled} icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => onChange(row)}>{pick('Đổi', 'Change')}</Button><Button size="sm" className="min-h-11" variant="danger" disabled={mutationDisabled} icon={<Unlink className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => onRemove(row)}>{pick('Gỡ', 'Remove')}</Button></span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
