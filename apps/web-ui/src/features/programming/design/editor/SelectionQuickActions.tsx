import { useI18n } from '../../../../shared/i18n'

/**
 * Thanh lệnh nhanh nổi theo vùng chọn — ST Editor Quick Control đề xuất #1
 * (đã duyệt). Chỉ hiện khi có vùng chọn không rỗng trong `SourceEditor`; chỉ
 * biến đổi TEXT trong buffer local qua `onComment`/`onWrapIf` — không tự
 * Lưu, không tự Kiểm tra. `onWrapIf` chỉ có một khối được hỗ trợ (`IF`) vì
 * `FOR`/`WHILE`/`REPEAT`/`CASE` bị loại khỏi Rev A.0 ST subset (an toàn thời
 * gian thực — xem `quickControl.ts`).
 */
export function SelectionQuickActions({
  top,
  left,
  onComment,
  onWrapIf,
  onJumpBracket,
  canJumpBracket,
}: {
  top: number
  left: number
  onComment: () => void
  onWrapIf: () => void
  onJumpBracket: () => void
  canJumpBracket: boolean
}) {
  const { pick } = useI18n()
  return (
    <div
      role="toolbar"
      aria-label={pick('Lệnh nhanh vùng chọn', 'Selection quick actions')}
      className="absolute z-20 flex items-center gap-0.5 rounded-full border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-0.5 text-xs shadow-lg"
      style={{ top: `${top}px`, left: `${left}px` }}
      /* Vùng chọn trong textarea bị mất ngay khi click chuyển focus sang
       * đây — chặn `mousedown` (không phải `click`) để textarea giữ
       * nguyên `selectionStart/End` tới khi handler `onClick` của nút thật
       * sự chạy xong. */
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[var(--c-text)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-accent)]"
        title={pick('Ghi chú (Ctrl+/)', 'Comment (Ctrl+/)')}
        onClick={onComment}
      >
        <span className="mono" aria-hidden="true">(*·*)</span>
        {pick('Ghi chú', 'Comment')}
      </button>
      <span className="h-4 w-px bg-[var(--c-border)]" aria-hidden="true" />
      <button
        type="button"
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[var(--c-text)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-accent)]"
        title={pick('Bọc khối IF', 'Wrap in IF block')}
        onClick={onWrapIf}
      >
        <span className="mono" aria-hidden="true">⌐¬</span>
        {pick('Bọc IF', 'Wrap IF')}
      </button>
      {canJumpBracket && (
        <>
          <span className="h-4 w-px bg-[var(--c-border)]" aria-hidden="true" />
          <button
            type="button"
            className="flex items-center gap-1 rounded-full px-2 py-1 text-[var(--c-text)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-accent)]"
            title={pick('Nhảy ngoặc khớp (Ctrl+Shift+\\)', 'Jump to matching bracket (Ctrl+Shift+\\)')}
            onClick={onJumpBracket}
          >
            <span className="mono" aria-hidden="true">↔</span>
            {pick('Nhảy ngoặc', 'Jump bracket')}
          </button>
        </>
      )}
    </div>
  )
}
