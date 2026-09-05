import { useI18n } from '../../../shared/i18n'
import { useProgrammingLibraryEntrySource } from '../api/queries'
import type { ProgrammingLibraryEntry } from '../model/types'

/**
 * `T61-404` / `ISS-PGM04-13` — xem mã nguồn đã lưu của MỘT phiên bản khối.
 *
 * Trước lát này Inspector không có Preview và hợp đồng đọc không mang `source`,
 * nên người dùng phải quyết định có chèn một khối hay không mà không đọc được nó
 * — và khi sửa, họ phải dán lại toàn bộ mã của một khối họ chưa từng nhìn thấy.
 *
 * Ba luật của khung này, và cả ba đều là điều kiện để nó có ích:
 *
 *  1. **Đúng phiên bản đang chọn.** Hook nhận `libraryRevisionId` của chính
 *     phiên bản người dùng mở, không có nhánh "bản mới nhất". Một Preview lặng
 *     lẽ hiển thị bản mới nhất khi người dùng mở bản cũ là cách họ đọc sai thứ
 *     thiết bị đang chạy mà không có dấu hiệu nào.
 *  2. **Không bao giờ dựng mã nguồn từ chữ ký.** Khi máy chủ nói không có mã
 *     nguồn, khung này nói ra lý do và dừng. Ghép một khung ST "trông giống" từ
 *     `interface` là bịa ra một thứ chưa từng chạy trên thiết bị nào.
 *  3. **Chỉ ĐỌC.** Không có nút nào ở đây phát ra một mutation.
 */
export function LibrarySourcePreview({ entry }: { entry: ProgrammingLibraryEntry }) {
  const { pick } = useI18n()
  const source = useProgrammingLibraryEntrySource(entry.libraryRevisionId, entry.entryId)

  if (source.status === 'loading') {
    return (
      <p role="status" data-testid="library-source-loading" className="text-sm text-[var(--c-text-dim)]">
        {pick('Đang đọc mã nguồn từ máy chủ…', 'Reading the source from the server…')}
      </p>
    )
  }
  if (source.status === 'error' || !source.data) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" data-testid="library-source-error" className="text-sm text-[var(--c-fault-fg)]">
          {source.error ?? pick('Không đọc được mã nguồn.', 'Could not read the source.')}
        </p>
        <div>
          <button
            type="button"
            className="rounded-[var(--radius)] border border-[var(--c-border)] px-3 py-1.5 text-sm"
            onClick={() => source.refresh()}
          >
            {pick('Thử đọc lại', 'Try reading again')}
          </button>
        </div>
      </div>
    )
  }

  const view = source.data
  /* Danh tính phiên bản hiện NGAY TRÊN nội dung, không ở đâu khác: đọc một đoạn
     mã mà không biết nó thuộc bản nào thì không dùng để quyết định được gì. */
  const identity = (
    <p className="text-xs text-[var(--c-text-dim)]" data-testid="library-source-identity">
      {view.scope} · {view.libraryVersion} · {view.libraryState} ·{' '}
      <span className="font-mono">{view.contentSha256.slice(0, 12)}…</span>
    </p>
  )

  if (view.availability !== 'AVAILABLE' || view.source === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {identity}
        <p
          role="note"
          data-testid="library-source-unavailable"
          data-availability={view.availability}
          className="text-sm text-[var(--c-warn-fg)]"
        >
          {view.availability === 'NOT_STORED'
            ? pick(
                'Thiết bị không lưu mã nguồn của khối này.',
                'The device does not store the source of this block.'
              )
            : pick(
                'Máy chủ không xác nhận được mã nguồn của phiên bản này.',
                'The server could not verify the source of this version.'
              )}
          {view.reason ? ` ${view.reason}.` : ''}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {identity}
      {/* `readOnly` chứ không phải `disabled`: một `textarea` bị `disabled`
          không nhận được tiêu điểm bàn phím, nên người dùng bàn phím không cuộn
          và không bôi đen để chép được — đúng hai việc duy nhất cần làm ở đây. */}
      <textarea
        readOnly
        data-testid="library-source-viewer"
        aria-label={
          view.language === 'FBD'
            ? pick(`Nội dung FBD của ${view.name}`, `FBD content of ${view.name}`)
            : pick(`Mã nguồn ST của ${view.name}`, `ST source of ${view.name}`)
        }
        value={view.source}
        rows={14}
        className="w-full min-w-0 rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5 font-mono text-xs"
      />
    </div>
  )
}
