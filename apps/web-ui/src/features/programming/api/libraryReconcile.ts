import { ProgrammingApiError, ProgrammingNoResponseError } from './generated/client'
import type { ProgrammingLibraryEntry } from '../model/types'

/**
 * `T61-402` / `ISS-PGM04-12` — điều gì xảy ra khi một lần GHI không trả lời.
 *
 * Trước lát này mọi lỗi mạng đều rơi vào một dải lỗi chung có nút bấm lại. Đó là
 * lời khuyên SAI cho đúng trường hợp nguy hiểm nhất: nếu máy chủ đã commit mà
 * phản hồi mất trên đường về, người dùng không biết gì và bấm lại — và mỗi lần
 * bấm lại sinh một `X-Idempotency-Key` MỚI, nên máy chủ coi đó là một ý định
 * khác và ghi thêm một lần nữa.
 *
 * Mô-đun này thuần và không phụ thuộc React: nó phát biểu ba thứ mà một hook
 * không kiểm được nếu trộn lẫn với state — phân loại lỗi, danh tính của một lần
 * ghi, và phép đọc lại có chặn trên.
 */

/**
 * Phân loại một lần ghi hỏng.
 *
 * Ranh giới duy nhất thật sự quan trọng: **có nhận được dòng trạng thái HTTP
 * hay không**. Có mã HTTP nghĩa là máy chủ đã trả lời và transaction đã ngã ngũ
 * — hỏng là hỏng, không ghi gì. Không có mã nào nghĩa là KHÔNG BIẾT: request có
 * thể đã tới nơi và đã commit.
 */
export type LibraryMutationFailure =
  /** 409/412/428 — phải TẢI LẠI rồi quyết định; bấm lại với ETag cũ sẽ 409 mãi. */
  | 'conflict'
  /** 4xx khác — payload sai, bấm lại y hệt không bao giờ thành công. */
  | 'rejected'
  /** 5xx — máy chủ đã trả lời, transaction đã rollback; bấm lại được. */
  | 'server'
  /** Không có phản hồi nào — kết quả trên máy chủ KHÔNG BIẾT. */
  | 'unknown'

export interface LibraryFailureClass {
  failure: LibraryMutationFailure
  /** Chỉ có nghĩa khi `failure === 'unknown'`. */
  reason?: 'timeout' | 'abort' | 'network'
  status?: number
  /** Mã lỗi public của máy chủ, nếu có. */
  code?: string
}

export function classifyLibraryFailure(reason: unknown): LibraryFailureClass {
  if (reason instanceof ProgrammingNoResponseError) {
    return { failure: 'unknown', reason: reason.reason }
  }
  if (reason instanceof ProgrammingApiError) {
    const status = reason.status
    if (status === 409 || status === 412 || status === 428) {
      return { failure: 'conflict', status, code: reason.envelope.error.code }
    }
    if (status >= 500) return { failure: 'server', status, code: reason.envelope.error.code }
    return { failure: 'rejected', status, code: reason.envelope.error.code }
  }
  /* Một lỗi không nhận dạng được KHÔNG được quy về "hỏng chắc chắn". Nói "đã
     hỏng" khi chưa biết là mời người dùng bấm lại một thao tác có thể đã chạy —
     đúng cái hại mà cả mô-đun này sinh ra để chặn. Fail-closed về `unknown`. */
  return { failure: 'unknown', reason: 'network' }
}

/**
 * Danh tính của MỘT lần ghi, giữ nguyên qua mọi lần đối soát.
 *
 * `idempotencyKey` và `ifMatch` đều nằm trong hash ngữ nghĩa mà máy chủ băm để
 * nhận diện một request lặp. Đổi **bất kỳ** cái nào trong hai — kể cả "làm mới"
 * ETag cho đúng — là gửi một ý định KHÁC: khoá cũ với body khác bị máy chủ từ
 * chối bằng `ErrIdempotencyConflict`, còn khoá mới thì được ghi thêm một lần
 * nữa. Vì vậy đối soát dùng lại NGUYÊN VẸN bộ ba này.
 */
export interface LibraryMutationIntent {
  kind: 'save' | 'delete' | 'deprecate'
  entryId: string
  idempotencyKey: string
  correlationId: string
  ifMatch: string
  /** Chỉ có ở `save` — dùng để nhận ra entry đã ghi khi đọc lại. */
  name?: string
  /** Chỉ có ở `deprecate`. */
  libraryRevisionId?: string
}

/**
 * Ý định này đã THẤY ĐƯỢC trên máy chủ chưa.
 *
 * Chỉ `true` là một KẾT LUẬN. `false` ("chưa thấy") và `null` ("không đọc được
 * gì để so") đều dẫn tới cùng một hành động — đọc lại — và cùng một câu trả lời
 * cuối cùng nếu hết lượt: không biết.
 *
 * Đọc từ danh sách mà máy chủ vừa trả về, không từ cache của màn hình: một phép
 * đối soát đọc lại chính bộ nhớ của mình thì luôn "xác nhận" đúng thứ nó vừa
 * đoán.
 *
 * `null` nghĩa là CHƯA KẾT LUẬN ĐƯỢC — khác hẳn `false`.
 */
export function libraryIntentVisible(
  intent: LibraryMutationIntent,
  entries: ProgrammingLibraryEntry[]
): boolean | null {
  const matching = entries.filter((entry) => entry.entryId === intent.entryId)
  if (intent.kind === 'delete') {
    return matching.length === 0
  }
  if (intent.kind === 'deprecate') {
    const revision = entries.filter((entry) => entry.libraryRevisionId === intent.libraryRevisionId)
    if (revision.length === 0) return null
    return revision.every((entry) => entry.libraryState === 'DEPRECATED')
  }
  if (matching.length === 0) return false
  /* Với một lần SỬA, "entry có mặt" chưa nói được gì — nó vốn đã có mặt từ
     trước. Chỉ khi tên trên máy chủ khớp tên vừa gửi thì mới kết luận được là
     lần ghi ấy đã vào. Tên không khớp thì CHƯA BIẾT, không phải "đã hỏng". */
  if (intent.name === undefined) return null
  return matching.some((entry) => entry.name === intent.name) ? true : null
}

/** Trần của phép đối soát. Có chặn trên là điều kiện, không phải tuỳ chọn: một
 *  vòng lặp không trần sẽ quay mãi trên một máy chủ đã chết. */
export const LIBRARY_RECONCILE_ATTEMPTS = 4
export const LIBRARY_RECONCILE_DELAY_MS = 750

/**
 * Chỉ có HAI kết luận, và đó là chủ ý.
 *
 * Không có `'failed'`: một phép ĐỌC không bao giờ chứng minh được rằng một lần
 * ghi đã hỏng — nó chỉ chứng minh được rằng lần ghi đã VÀO. Thêm một nhánh
 * "thất bại" ở đây sẽ là một lời khẳng định không có cơ sở, đúng lúc người dùng
 * cần sự thật nhất.
 */
export type LibraryReconcileOutcome = 'succeeded' | 'unknown'

export interface LibraryReconcileResult {
  outcome: LibraryReconcileOutcome
  attempts: number
  /** ETag đọc lại được từ máy chủ. `null` khi không đọc được. */
  etag: string | null
}

/**
 * Đọc lại có chặn trên, KHÔNG gửi thêm một mutation nào.
 *
 * Đây là toàn bộ phép phục hồi tự động được phép chạy. Nó chỉ ĐỌC: `readEntries`
 * và `readEtag` là hai đường đọc của máy chủ. Gửi lại lần ghi — dù với đúng khoá
 * cũ — là một quyết định của người dùng, không phải của một vòng lặp.
 *
 * `sleep` được tiêm vào để test chạy không cần đồng hồ thật; một `setTimeout`
 * cứng ở đây là cách một bộ test đứng chờ ba giây mỗi lần chạy.
 */
export async function reconcileLibraryMutation(options: {
  intent: LibraryMutationIntent
  readEntries: () => Promise<ProgrammingLibraryEntry[]>
  readEtag: () => Promise<string | null>
  sleep?: (ms: number) => Promise<void>
  attempts?: number
  delayMs?: number
  onAttempt?: (attempt: number, of: number) => void
}): Promise<LibraryReconcileResult> {
  const total = options.attempts ?? LIBRARY_RECONCILE_ATTEMPTS
  const delay = options.delayMs ?? LIBRARY_RECONCILE_DELAY_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  for (let attempt = 1; attempt <= total; attempt += 1) {
    options.onAttempt?.(attempt, total)
    let visible: boolean | null
    try {
      visible = libraryIntentVisible(options.intent, await options.readEntries())
    } catch {
      /* Không đọc được cũng là CHƯA BIẾT. Coi một lần đọc hỏng là "chưa ghi" sẽ
         báo thất bại cho một thao tác có thể đã thành công. */
      visible = null
    }
    if (visible === true) {
      let etag: string | null = null
      try {
        etag = await options.readEtag()
      } catch {
        etag = null
      }
      return { outcome: 'succeeded', attempts: attempt, etag }
    }
    if (attempt < total) await sleep(delay)
  }
  /* Hết lượt mà vẫn chưa thấy: KHÔNG kết luận "đã hỏng". Với `delete` thì
     "không thấy entry" là bằng chứng dương và đã trả về ở trên; với `save` thì
     "chưa thấy" có thể chỉ là chưa kịp. Nói `unknown` là câu trả lời đúng, và
     là câu duy nhất không đẩy người dùng tới một lần bấm lại mù. */
  return { outcome: 'unknown', attempts: total, etag: null }
}
