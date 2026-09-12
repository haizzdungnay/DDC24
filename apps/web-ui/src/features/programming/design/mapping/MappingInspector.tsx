import { CircleHelp, ShieldAlert } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { formatTechnicalDateTime } from '../../../../shared/dateTime'
import { useI18n } from '../../../../shared/i18n'
import { formatMappingValue, type MappingVariableRow } from './mappingViewModel'
import { mappingReasonText } from './mappingReasons'

export function MappingInspector({ row }: { row: MappingVariableRow | null }) {
  const { pick, locale } = useI18n()
  return (
    <aside className="min-w-0 max-w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4" aria-live="polite" aria-labelledby="mapping-inspector-title">
      <div className="flex items-start justify-between gap-2">
        <div><h2 id="mapping-inspector-title" className="text-sm font-semibold text-[var(--c-text)]">Binding Inspector</h2><p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Read-back authority · không tự suy diễn', 'Read-back authority · nothing inferred')}</p></div>
        <CircleHelp className="h-4 w-4 text-[var(--c-text-dim)]" aria-hidden="true" />
      </div>
      {!row ? (
        <p className="mt-4 text-sm text-[var(--c-text-dim)]">{pick('Chọn một biến hoặc mapping để inspect.', 'Select a variable or mapping to inspect.')}</p>
      ) : (
        <div className="mt-4 space-y-3 text-xs">
          <div><span className="text-[var(--c-text-dim)]">Variable</span><strong className="mt-1 block text-sm text-[var(--c-text)]">{row.name}</strong><span className="text-[var(--c-text-dim)]">{row.programName} · {row.type} · {row.direction}</span></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            <dt className="text-[var(--c-text-dim)]">Point</dt><dd className="font-mono text-[var(--c-text)]">{row.point ? `${row.point.category}:${row.point.deviceId ? `${row.point.deviceId}:` : ''}${row.point.pointId}` : '—'}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Giá trị', 'Value')}</dt><dd className="font-mono text-[var(--c-text)]">{formatMappingValue(row.liveValue, pick)}</dd>
            <dt className="text-[var(--c-text-dim)]">Quality</dt><dd><StatusBadge state={row.liveQuality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'} label={row.liveQuality} /></dd>
            <dt className="text-[var(--c-text-dim)]">Eligibility</dt><dd className="text-[var(--c-text)]">{row.eligibility}</dd>
            <dt className="text-[var(--c-text-dim)]">Observed</dt><dd className="whitespace-nowrap text-[var(--c-text)]">{formatTechnicalDateTime(row.observedAt, locale)}</dd>
          </dl>
          <div className="rounded border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-[var(--c-warn-fg)]">
            <ShieldAlert className="mr-1 inline h-4 w-4" aria-hidden="true" /><strong>{pick('Chưa xác minh — chưa chạy preview phía máy chủ', 'Unverified — server preview has not run')}</strong>
            <p className="mt-1">{pick('Owner, xung đột và verdict lưu chỉ lấy từ preview; FE không tự suy đoán.', 'Owner, conflicts, and the save verdict come only from preview; the frontend does not infer them.')}</p>
          </div>
          {/* `ISS-PGM03-05` — Inspector là bề mặt review, nên nó phải liệt kê
            * ĐỦ mọi lý do. Bản trước nối tất cả bằng `·` thành một đoạn văn,
            * còn hàng worklist chỉ in lý do đầu tiên: một biến vướng ba blocker
            * trông hệt một biến vướng một, và không chỗ nào đếm ra con số ấy.
            *
            * Mọi lý do trong danh sách này đều CHẶN gán — `mappingViewModel`
            * tính `assignable = reasons.length === 0`. Vì thế nhóm được ghi
            * thẳng là "chặn", không phân thành cảnh báo mềm; severity mềm/cứng
            * của server nằm ở bước xem trước (`verdict` + `issues[].severity`),
            * nơi máy chủ mới là authority. */}
          {row.compatibility.reasons.length > 0 && (
            <div className="rounded border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-2 text-[var(--c-warn-fg)]">
              <strong>{pick(`Chặn ánh xạ · ${row.compatibility.reasons.length} lý do`, `Blocking · ${row.compatibility.reasons.length} reasons`)}</strong>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {row.compatibility.reasons.map((reason, index) => (
                  <li key={`${reason.kind}-${index}`}>{mappingReasonText(reason, pick)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
