import { AlertTriangle, ArchiveX, Library, Lock } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { blockSignatureLine, categoryLabel, metadataValue, scopeLabel } from './libraryPresentation'
import type { LibraryEntryGroup } from '../model/library'

/**
 * `T61-303` — thẻ khối của PGM-04, theo `SPEC-PGM04-VISUAL-001` §2.
 *
 * Thứ tự đọc là một phần của spec, không phải sở thích trình bày: người trực ca
 * quét cột này để tìm một khối, và thứ họ cần TRƯỚC khi mở chi tiết là chữ ký —
 * đó là `AC-PGM04-01`. Một thẻ chỉ có tên bắt họ mở từng khối một để biết khối
 * nào nhận REAL và khối nào nhận BOOL.
 *
 * Mọi trường VẮNG đều hiện `—` KÈM lý do. Ô trống đọc như "đã điền rồi và nội
 * dung rỗng", nên người dùng sẽ không đi tìm chỗ để điền.
 */
export interface LibraryCardUsage {
  /** `null` = chưa đọc được bản nháp, KHÁC 0 = không POU nào dùng. */
  draftCount: number | null
}

export function LibraryBlockCard({
  group,
  selected,
  usage,
  tabIndex,
  onSelect,
  cardRef,
}: {
  group: LibraryEntryGroup
  selected: boolean
  usage: LibraryCardUsage
  tabIndex: number
  onSelect: () => void
  cardRef?: (element: HTMLButtonElement | null) => void
}) {
  const { pick } = useI18n()
  const entry = group.current
  const signature = blockSignatureLine(entry)
  const deprecated = entry.libraryState === 'DEPRECATED'
  /* `featureState` của MÁY CHỦ là authority, không phải một danh sách tên khối
     đối chiếu ở FE. Đối chiếu theo tên sẽ gắn nhãn "chờ review Controls/Safety"
     lên một khối PROJECT chỉ vì người dùng đặt tên trùng, và sẽ gỡ nhãn khỏi
     một khối SYSTEM thật khi profile sinh ra lạc hậu. */
  const reviewRequired = entry.featureState === 'REVIEW_REQUIRED'

  return (
    <button
      type="button"
      ref={cardRef}
      /* Giữ vai `button` gốc và đánh dấu lựa chọn bằng `aria-current`: lưới này
         là một danh sách nút mở khay chi tiết, không phải một hộp chọn giá trị.
         `tabIndex` luân phiên để cả lưới là MỘT điểm dừng tab — 200 khối mà 200
         điểm dừng thì phím `Tab` thành vô dụng (`SPEC-PGM04-VISUAL-001` §5). */
      aria-current={selected ? 'true' : undefined}
      tabIndex={tabIndex}
      data-testid="library-block-card"
      data-entry={group.key}
      onClick={onSelect}
      className={`flex min-w-0 flex-col gap-1.5 rounded-[var(--radius)] border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${
        selected
          ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)]'
          : 'border-[var(--c-border)] bg-[var(--c-surface-2)] hover:border-[var(--c-line-strong)]'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Library className="h-4 w-4 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
        <span className="truncate font-semibold text-[var(--c-text)]">{group.name}</span>
        {group.scope === 'SYSTEM' && (
          <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--c-text-dim)]" aria-label={pick('Chỉ đọc', 'Read-only')} />
        )}
      </span>

      <span className="flex flex-wrap items-center gap-1 text-xs">
        <span className="rounded border border-[var(--c-border)] px-1.5 py-0.5 text-[var(--c-text-dim)]">{entry.kind}</span>
        {/* Nhãn phạm vi bằng tiếng người và KHÔNG dùng chữ "Core": sản phẩm đã
            có `mkddc-core`, và hai nghĩa cho một từ đúng chỗ người trực ca đọc
            nhanh là một cái bẫy (`AUTH …-PGM04-001` §Q4). */}
        <span className="rounded bg-[var(--c-surface)] px-1.5 py-0.5 text-[var(--c-text-dim)]">
          {scopeLabel(group.scope, false)}
        </span>
        {metadataValue(entry.category) ? (
          <span className="rounded bg-[var(--c-surface)] px-1.5 py-0.5 text-[var(--c-text-dim)]">
            {categoryLabel(entry.category as string, pick)}
          </span>
        ) : (
          <span
            className="rounded bg-[var(--c-surface)] px-1.5 py-0.5 text-[var(--c-text-dim)]"
            title={pick('Khối này chưa được phân loại', 'This block has no category yet')}
          >
            {pick('— chưa phân loại', '— not categorised')}
          </span>
        )}
      </span>

      {/* `AC-PGM04-01` — chữ ký đọc được TRƯỚC khi mở chi tiết. */}
      {signature.kind === 'ready' ? (
        <span className="truncate font-mono text-xs text-[var(--c-text)]" title={signature.text}>
          {signature.text}
        </span>
      ) : (
        <span className="text-xs text-[var(--c-warn-fg)]">
          {pick('Chưa đọc được chữ ký của khối này.', 'This block signature could not be read.')}
        </span>
      )}

      <span className="line-clamp-2 text-xs text-[var(--c-text-dim)]">
        {metadataValue(entry.description) ?? pick('— chưa có mô tả', '— no description yet')}
      </span>

      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--c-text-dim)]">
        <span>
          {entry.libraryVersion} · {entry.libraryState}
        </span>
        {group.versions.length > 1 && (
          <span>{pick('· %n phiên bản', '· %n versions').replace('%n', String(group.versions.length))}</span>
        )}
        {/* Số nơi dùng của BẢN NHÁP Project này, và nhãn nói đúng phạm vi ấy.
            Gọi nó là "nơi dùng" trống không sẽ hứa rộng hơn sự thật: phần đã
            niêm phong nằm ở khay Used-In và phủ mọi Project. */}
        {usage.draftCount === null ? (
          <span className="text-[var(--c-warn-fg)]">{pick('· chưa đo được nơi dùng', '· usage not measured')}</span>
        ) : (
          <span>
            {pick('· %n POU trong bản nháp', '· %n POUs in the draft').replace('%n', String(usage.draftCount))}
          </span>
        )}
      </span>

      {(reviewRequired || deprecated) && (
        <span className="flex flex-wrap items-center gap-1">
          {reviewRequired && (
            <span className="flex items-center gap-1 rounded bg-[var(--c-warn-bg)] px-1.5 py-0.5 text-xs text-[var(--c-warn-fg)]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {pick('Chờ review Controls/Safety', 'Awaiting Controls/Safety review')}
            </span>
          )}
          {deprecated && (
            <span className="flex items-center gap-1 rounded bg-[var(--c-warn-bg)] px-1.5 py-0.5 text-xs text-[var(--c-warn-fg)]">
              <ArchiveX className="h-3.5 w-3.5" aria-hidden="true" />
              {pick('Ngừng sử dụng', 'Deprecated')}
            </span>
          )}
        </span>
      )}
    </button>
  )
}
