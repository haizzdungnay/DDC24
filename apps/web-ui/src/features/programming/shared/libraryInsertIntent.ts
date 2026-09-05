/**
 * `T61-405` / `ISS-PGM04-14` — Ý ĐỊNH chèn khối, mang từ PGM-04 sang PGM-02.
 *
 * ## Quyết định canonical (thay cho câu chữ lai của Plan61)
 *
 * PGM-04 (Thư viện) **chỉ điều hướng**. Nó không ghi vào Draft, không có
 * adapter chèn, và không tạo bước Hoàn tác nào. Phép chèn thật — cùng bước
 * Hoàn tác của nó — thuộc về **PGM-02** (bộ soạn thảo), vì đó là nơi người dùng
 * nhìn thấy mã nguồn thay đổi và có `Ctrl+Z` trong tầm tay.
 *
 * Plan61 `T61-405` từng mô tả "PGM-04 gọi shared insertion adapter", trong khi
 * authority `AUTH-PROG-2026-08-29-PGM04-003` và chính mã nguồn
 * (`TargetPouChooser` + `onChoose` của `LibraryPage`) làm điều ngược lại. Hai mô
 * tả không thể cùng đúng, và giữ cả hai là cách một người đọc plan rồi triển
 * khai một adapter ghi thẳng từ Thư viện — đúng thứ mà zero-mutation cấm.
 *
 * ## Vì sao ý định phải đi qua URL, và phải đủ danh tính
 *
 * Trước lát này đường điều hướng chỉ mang `pou`, `mode` và `returnTo`: người
 * dùng chọn một khối ở Thư viện, bấm Chèn, và hạ cánh vào bộ soạn thảo **mà
 * không có gì nói khối nào**. Họ phải tự tìm lại khối ấy trong Thư viện nhanh —
 * tức là thao tác chọn ban đầu bị vứt đi.
 *
 * Ý định mang **cả hai** định danh: `entryId` nói khối nào, `libraryRevisionId`
 * nói **bản nào**. Thiếu một trong hai thì không có ý định nào cả (fail closed):
 * chèn "một khối cùng tên ở bản khác" là chèn một thứ khác thứ người dùng đã
 * đọc, và không có dấu hiệu nào.
 */

import {
  insertUsabilityBlock,
  type CompatibilityDisplay,
  type InsertUsabilityBlock,
  type LibraryUsability,
} from '../library/libraryPresentation'

export const LIBRARY_INSERT_INTENT_PARAMS = ['insertEntry', 'insertLibraryRevision'] as const

export interface LibraryInsertIntent {
  entryId: string
  libraryRevisionId: string
}

function toParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string' ? new URLSearchParams(search) : new URLSearchParams(search)
}

/**
 * Đọc ý định từ query. `null` khi KHÔNG có ý định nào — và "thiếu một nửa" cũng
 * là không có: một `entryId` không kèm revision là một lời mời chèn bản mới
 * nhất, đúng thứ `T61-404` đã khoá lại ở đường đọc.
 */
export function readLibraryInsertIntent(search: string | URLSearchParams): LibraryInsertIntent | null {
  const params = toParams(search)
  const entryId = params.get('insertEntry')?.trim() ?? ''
  const libraryRevisionId = params.get('insertLibraryRevision')?.trim() ?? ''
  if (entryId === '' || libraryRevisionId === '') return null
  return { entryId, libraryRevisionId }
}

/** Tham số để GẮN ý định vào một đường điều hướng. */
export function libraryInsertIntentParams(intent: LibraryInsertIntent): Record<string, string> {
  return { insertEntry: intent.entryId, insertLibraryRevision: intent.libraryRevisionId }
}

/**
 * Bỏ ý định khỏi query, giữ nguyên MỌI tham số khác.
 *
 * Ý định là một lệnh dùng một lần. Để nó nằm lại trên URL nghĩa là mỗi lần tải
 * lại trang, bộ soạn thảo lại mời chèn cùng một khối — và người dùng bấm Đồng ý
 * theo phản xạ sẽ chèn nó hai lần.
 */
export function clearLibraryInsertIntent(search: string | URLSearchParams): URLSearchParams {
  const params = toParams(search)
  for (const key of LIBRARY_INSERT_INTENT_PARAMS) params.delete(key)
  return params
}

export type LibraryInsertResolution<TEntry> =
  | { status: 'ready'; entry: TEntry }
  /** Đúng khối đúng bản, nhưng khối ấy KHÔNG dùng được. Xem `T61-406` dưới đây. */
  | { status: 'blocked'; entry: TEntry; reason: Exclude<InsertUsabilityBlock, null> }
  /** Không có khối nào mang `entryId` ấy trong danh mục đang tải. */
  | { status: 'unknown-entry' }
  /** Có khối, nhưng nó thuộc một bản thư viện KHÁC bản người dùng đã đọc. */
  | { status: 'revision-mismatch'; available: string }

/**
 * Phân giải ý định thành đúng một khối trong danh mục đang tải.
 *
 * Bốn kết quả, và ba kết quả xấu KHÔNG được gộp: "không có khối này" là một
 * danh mục chưa tải xong hoặc một khối đã bị xoá, "khối này thuộc bản khác" là
 * một thay đổi thư viện xảy ra giữa lúc người dùng bấm Chèn và lúc bộ soạn thảo
 * mở ra, còn "khối này không dùng được" là một luật của sản phẩm. Ba câu ấy dẫn
 * tới ba hành động khác nhau của người vận hành.
 *
 * Không có nhánh nào trả về "khối gần đúng": chèn nhầm bản là một lỗi im lặng,
 * và ở đây không có gì bù lại được nó.
 *
 * ## `T61-406` — vì sao phép chặn phải nằm Ở ĐÂY chứ không chỉ ở PGM-04
 *
 * Ý định đi qua **URL**. Nút Chèn của PGM-04 bị khoá cho khối `REVIEW_REQUIRED`
 * / `DEPRECATED` / `SIGNATURE_UNAVAILABLE` / `REQUIRES_MIGRATION`, nhưng một URL
 * gõ tay, một liên kết dán lại, hay một bookmark cũ đều tới thẳng bộ soạn thảo
 * mà không đi qua cái nút ấy. Nếu phép chặn chỉ sống trong `disabled` của một
 * `<button>` thì nó không phải một luật — nó là một lời khuyên, và
 * `ISS-PGM04-15` từ chối đóng với đúng câu đó ("guard chỉ tồn tại ở UI nhưng
 * test direct intent có thể bypass").
 *
 * Phép chặn đọc `usability`/`compatibility` từ **danh mục do máy chủ trả**, chứ
 * không từ tham số URL. Đó là điểm khác biệt quan trọng: một trường mang trong
 * URL là lời khai của bên gọi, còn danh mục là câu trả lời của authority.
 */
export function resolveLibraryInsertIntent<
  TEntry extends {
    entryId: string
    libraryRevisionId: string
    usability: LibraryUsability
    compatibility: CompatibilityDisplay
  },
>(
  intent: LibraryInsertIntent,
  entries: readonly TEntry[],
): LibraryInsertResolution<TEntry> {
  const matching = entries.filter((entry) => entry.entryId === intent.entryId)
  if (matching.length === 0) return { status: 'unknown-entry' }
  const exact = matching.find((entry) => entry.libraryRevisionId === intent.libraryRevisionId)
  if (!exact) return { status: 'revision-mismatch', available: matching[0].libraryRevisionId }
  const reason = insertUsabilityBlock(exact.usability, exact.compatibility)
  if (reason !== null) return { status: 'blocked', entry: exact, reason }
  return { status: 'ready', entry: exact }
}
