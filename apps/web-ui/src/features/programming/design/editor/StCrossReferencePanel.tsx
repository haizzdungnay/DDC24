import { useI18n } from '../../../../shared/i18n'
import type { StCursorSymbol } from './stReferenceIndex'

/**
 * `AC-ST-005` — "hover/ref absence shows unavailable, not guessed content".
 *
 * Khay này trả lời đúng một câu hỏi: định danh dưới con trỏ là gì, khai ở đâu,
 * bị đọc và bị ghi ở những đâu. Khi không tra được, nó nói **không xác định
 * được** kèm lý do, chứ không hiện một đích đến gần đúng. Một đích sai trong
 * editor điều khiển tốn nhiều thời gian hơn là không có đích nào.
 */
export function StCrossReferencePanel({
  cursorSymbol,
  note,
  onJump,
}: {
  cursorSymbol: StCursorSymbol | null
  note: string | null
  onJump: (offset: number, length: number) => void
}) {
  const { pick } = useI18n()
  const entry = cursorSymbol?.entry ?? null
  const reads = entry?.occurrences.filter((item) => item.role === 'READ') ?? []
  const writes = entry?.occurrences.filter((item) => item.role === 'WRITE') ?? []

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
      <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        {pick('Tham chiếu tại con trỏ', 'Cross reference at cursor')}
      </h4>
      {!cursorSymbol && (
        <p className="mt-1 text-xs text-[var(--c-text-dim)]">
          {pick('Đặt con trỏ lên một định danh để xem khai báo và nơi dùng. F12 nhảy tới khai báo.', 'Place the cursor on an identifier to see its declaration and uses. F12 jumps to the declaration.')}
        </p>
      )}
      {cursorSymbol && !entry && (
        <p className="mt-1 text-xs text-[var(--c-warn-fg)]">
          <span className="font-mono">{cursorSymbol.identifier}</span>
          {pick(' — không xác định được: không có khai báo VAR nào khớp trong POU này. Kiểm tra (Check) mới là nơi phán nguồn đúng hay sai.', ' — unavailable: no matching VAR declaration in this POU. Check is the authority on whether the source is valid.')}
        </p>
      )}
      {entry && (
        <div className="mt-1 space-y-1 text-xs">
          <p className="text-[var(--c-text)]">
            <span className="font-mono">{entry.name}</span>
            <span className="text-[var(--c-text-dim)]"> : </span>
            <span className="font-mono">{entry.typeName}</span>
            <span className="ml-2 rounded bg-[var(--c-surface-2)] px-1 py-0.5 text-[var(--c-text-dim)]">
              {entry.kind === 'FB_INSTANCE' ? pick('instance FB', 'FB instance') : pick('biến', 'variable')}
            </span>
          </p>
          <button
            type="button"
            className="rounded bg-[var(--c-surface-2)] px-2 py-1 text-[var(--c-text)] hover:text-[var(--c-accent)]"
            onClick={() => onJump(entry.declarationOffset, entry.name.length)}
          >
            {pick('Tới khai báo (F12)', 'Go to declaration (F12)')}
          </button>
          <OccurrenceRow
            label={pick('Đọc', 'Reads')}
            occurrences={reads}
            name={entry.name}
            onJump={onJump}
            emptyText={pick('không nơi nào đọc', 'never read')}
          />
          <OccurrenceRow
            label={pick('Ghi', 'Writes')}
            occurrences={writes}
            name={entry.name}
            onJump={onJump}
            emptyText={pick('không nơi nào ghi', 'never written')}
          />
        </div>
      )}
      {note && <p role="status" className="mt-1 text-xs text-[var(--c-warn-fg)]">{note}</p>}
    </div>
  )
}

function OccurrenceRow({
  label,
  occurrences,
  name,
  onJump,
  emptyText,
}: {
  label: string
  occurrences: readonly { offset: number }[]
  name: string
  onJump: (offset: number, length: number) => void
  emptyText: string
}) {
  return (
    <p className="flex flex-wrap items-center gap-1 text-[var(--c-text-dim)]">
      <span>{label} ({occurrences.length}):</span>
      {occurrences.length === 0 ? (
        <span>{emptyText}</span>
      ) : (
        occurrences.map((occurrence, index) => (
          <button
            key={occurrence.offset}
            type="button"
            aria-label={`${label} ${index + 1} — ${name}`}
            className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[var(--c-text)] hover:text-[var(--c-accent)]"
            onClick={() => onJump(occurrence.offset, name.length)}
          >
            #{index + 1}
          </button>
        ))
      )}
    </p>
  )
}
