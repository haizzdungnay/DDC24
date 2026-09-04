import { AlertTriangle, ArchiveX, Library, Lock, Star } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import {
  blockSignatureLine,
  categoryLabel,
  compatibilityDisplay,
  metadataValue,
  scopeLabel,
} from './libraryPresentation'
import { iecClassificationOf } from '../design/library/iecClassification'
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
/**
 * `T61-303` — nơi dùng, và ĐÂY LÀ HAI SỰ THẬT KHÁC NHAU.
 *
 * `draftCount` đo bản nháp của **Project đang mở**, tính ở FE từ
 * `objects[].dependencies`. Used-In authoritative (`GET /library-usages`) phủ
 * mọi Revision đã niêm phong và mọi Project — nó **không** nằm trên thẻ, vì đo
 * nó tốn một request cho mỗi khối và một lưới 200 thẻ sẽ bắn 200 request cho
 * những khối không ai định xem.
 *
 * Vì vậy thẻ nói rõ con số nó đang cầm là con số NÀO, và nói ra rằng phần còn
 * lại đo ở khay Nơi sử dụng. Gộp hai thứ thành một số là cách "0" trên thẻ đọc
 * thành "không ai dùng khối này" — một câu mời người ta xoá một khối có thể
 * đang điều khiển tủ.
 */
export interface LibraryCardUsage {
  /** `null` = chưa đọc được bản nháp, KHÁC 0 = không POU nào dùng. */
  draftCount: number | null
}

export function LibraryBlockCard({
  group,
  selected,
  usage,
  favorite,
  tabIndex,
  onSelect,
  onToggleFavorite,
  cardRef,
}: {
  group: LibraryEntryGroup
  selected: boolean
  usage: LibraryCardUsage
  /** `T61-303` — Yêu thích dùng CHUNG kho với Quick Library (`libraryEntryKey`
   *  = `scope/entryId`), nên gắn sao ở đây thì bên kia thấy ngay. */
  favorite: boolean
  tabIndex: number
  onSelect: () => void
  onToggleFavorite: () => void
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
  /* `T61-203` — nhãn MỞ RỘNG NHÀ SẢN XUẤT phải hiện ở CẢ HAI bề mặt chọn khối.
     Trước lát này chỉ Quick Library có nó, nên người chọn khối từ Control
     Library không hề biết `PID` nằm ngoài IEC 61131-3 — đúng thông tin mà
     `ISS-STED-17` đặt ở màn chọn khối vì đọc trong tài liệu là đọc quá muộn. */
  const extension = iecClassificationOf(entry.name) === 'MANUFACTURER_EXTENSION'
  /* `T61-303` — tương thích đọc từ HỢP ĐỒNG, không đoán từ version hay tên.
     So version ở FE là dựng một luật thứ hai cạnh luật của máy chủ, và hai luật
     thì có ngày nói khác nhau về cùng một khối. `compatibilityDisplay` đã
     fail-closed: trường vắng ⇒ `unknown`, không phải "không sao". */
  const compatibility = compatibilityDisplay(entry)

  return (
    /* `T61-303` — nút Yêu thích là ANH EM của nút thẻ, không nằm trong nó: một
       `<button>` lồng trong `<button>` là HTML không hợp lệ, và trình duyệt sẽ
       tự tháo nó ra khỏi cây theo cách không ai đoán được.

       Cả hai cùng nhận `tabIndex` luân phiên, nên cả lưới vẫn tốn một hằng số
       điểm dừng `Tab` (thẻ đang đứng + nút sao của nó) chứ không phải N điểm
       dừng theo số thẻ — đúng điều `SPEC-PGM04-VISUAL-001` §5 bảo vệ. Cho nút
       sao `tabIndex={-1}` sẽ là một chức năng không ai dùng được bằng bàn phím. */
    <div className="relative flex min-w-0 flex-1">
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
        {extension && (
          <span
            data-testid="library-extension-badge"
            className="mono shrink-0 rounded bg-[var(--c-warn-bg)] px-1 text-[10px] text-[var(--c-warn-fg)]"
            title={pick('Không thuộc thư viện chuẩn IEC 61131-3 — mở rộng của Mekong',
                        'Not part of the IEC 61131-3 standard library — Mekong extension')}
          >
            {pick('MỞ RỘNG', 'EXT')}
          </span>
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
          <span className="text-[var(--c-warn-fg)]">
            {pick('· chưa đọc được bản nháp', '· draft not read')}
          </span>
        ) : (
          <span data-testid="library-card-draft-usage">
            {pick('· %n POU trong bản nháp', '· %n POUs in the draft').replace('%n', String(usage.draftCount))}
          </span>
        )}
        {/* Phần CÒN LẠI của sự thật, nói thẳng ra. Không có nó thì "0 POU trong
            bản nháp" đọc thành "không ai dùng khối này" — và đó là câu mời
            người ta xoá một khối có thể đang điều khiển tủ ở Revision đã niêm
            phong hoặc ở Project khác. */}
        <span data-testid="library-card-sealed-usage" className="text-[var(--c-text-dim)]">
          {pick('· nơi dùng đã niêm phong: xem khay Nơi sử dụng',
                '· sealed usage: see the Used-In panel')}
        </span>
      </span>

      {/* `T61-303` — tương thích và nguồn chữ ký: nói ra khi KHÔNG chắc chắn.
          Im lặng ở đây làm một khối `REQUIRES_MIGRATION` trông hệt khối bình
          thường, và người dùng nâng version mà không biết mình đang nâng. */}
      {compatibility.kind !== 'compatible' && (
        <span
          data-testid="library-card-compatibility"
          className={compatibility.kind === 'requires-migration'
            ? 'text-xs text-[var(--c-warn-fg)]'
            : 'text-xs text-[var(--c-text-dim)]'}
        >
          {compatibility.kind === 'requires-migration'
            ? pick('Cần nâng cấp phiên bản thư viện', 'Library version migration required')
            : pick('Chưa đo được tương thích', 'Compatibility not measured')}
        </span>
      )}

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
      <button
        type="button"
        tabIndex={tabIndex}
        aria-pressed={favorite}
        data-testid="library-card-favorite"
        /* Nhãn CHỨA tên khối đang hiện (WCAG 2.5.3): ba nút quanh đây cùng nói
           về một khối, và "Yêu thích" trống không thì trình đọc màn hình đọc ra
           ba lần giống hệt nhau. */
        title={favorite
          ? pick(`Bỏ yêu thích ${group.name}`, `Unfavorite ${group.name}`)
          : pick(`Yêu thích ${group.name}`, `Favorite ${group.name}`)}
        aria-label={favorite
          ? pick(`Bỏ yêu thích ${group.name}`, `Unfavorite ${group.name}`)
          : pick(`Yêu thích ${group.name}`, `Favorite ${group.name}`)}
        onClick={onToggleFavorite}
        /* `min-h/min-w` 1,75rem = 28 px: trên ngưỡng 24 px của WCAG 2.5.8, và
           một ngôi sao 14 px không kèm vùng chạm là nút chỉ bấm trúng bằng
           chuột. */
        className={`absolute right-1.5 top-1.5 flex min-h-[1.75rem] min-w-[1.75rem] items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${
          favorite ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-accent)]'
        }`}
      >
        <Star className="h-3.5 w-3.5" aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}
