import { describe, expect, it, vi } from 'vitest'
import { ProgrammingApiError, ProgrammingNoResponseError } from './generated/client'
import {
  LIBRARY_RECONCILE_ATTEMPTS,
  classifyLibraryFailure,
  libraryIntentVisible,
  reconcileLibraryMutation,
  type LibraryMutationIntent,
} from './libraryReconcile'
import type { ProgrammingLibraryEntry } from '../model/types'

const ENTRY_ID = '44444444-4444-4444-8444-444444444444'
const REVISION_ID = '33333333-3333-4333-8333-333333333333'

function apiError(status: number): ProgrammingApiError {
  return new ProgrammingApiError(status, {
    error: {
      code: 'PRG-ERR-CONFLICT-001', messageKey: 'programming.error.conflict',
      retryable: false, keepsRunningRevision: true, correlationId: 'c'
    }
  } as never)
}

function entry(overrides: Partial<ProgrammingLibraryEntry> = {}): ProgrammingLibraryEntry {
  return {
    scope: 'PROJECT', libraryRevisionId: REVISION_ID, libraryVersion: '1.0.0', libraryState: 'DRAFT',
    entryId: ENTRY_ID, kind: 'FUNCTION', name: 'SCALE_LIN', featureState: 'AVAILABLE',
    contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
    compatibility: { state: 'UNKNOWN', requiredVersion: null, availableVersion: null, reason: null },
    ...overrides,
  }
}

function intent(overrides: Partial<LibraryMutationIntent> = {}): LibraryMutationIntent {
  return {
    kind: 'save', entryId: ENTRY_ID, name: 'SCALE_LIN',
    idempotencyKey: 'key-1', correlationId: 'corr-1', ifMatch: '"draft:3"',
    ...overrides,
  }
}

describe('T61-402 — phân loại một lần ghi hỏng', () => {
  /*
  Ranh giới duy nhất thật sự quan trọng: CÓ nhận được dòng trạng thái HTTP hay
  không. Có mã HTTP ⇒ máy chủ đã trả lời, transaction đã ngã ngũ. Không có mã
  nào ⇒ request có thể đã tới nơi và đã commit.
  */
  it('không có phản hồi nào là KHÔNG BIẾT, và giữ nguyên nguyên nhân gốc', () => {
    for (const reason of ['timeout', 'abort', 'network'] as const) {
      const classified = classifyLibraryFailure(new ProgrammingNoResponseError(reason, 15000))
      expect(classified.failure).toBe('unknown')
      expect(classified.reason).toBe(reason)
    }
  })

  it('409/412/428 là xung đột — phải tải lại, không phải bấm lại', () => {
    for (const status of [409, 412, 428]) {
      expect(classifyLibraryFailure(apiError(status)).failure).toBe('conflict')
    }
  })

  it('4xx khác là bị từ chối, 5xx là lỗi máy chủ — hai lời khuyên khác nhau', () => {
    for (const status of [400, 403, 404, 413, 422]) {
      expect(classifyLibraryFailure(apiError(status)).failure).toBe('rejected')
    }
    for (const status of [500, 503]) {
      expect(classifyLibraryFailure(apiError(status)).failure).toBe('server')
    }
  })

  it('một lỗi lạ fail-closed về KHÔNG BIẾT, không về "đã hỏng"', () => {
    // Nói "đã hỏng" khi chưa biết là mời người dùng bấm lại một thao tác có thể
    // đã chạy. Đó là đúng lớp hỏng mà mô-đun này sinh ra để chặn.
    expect(classifyLibraryFailure(new Error('gì đó lạ')).failure).toBe('unknown')
    expect(classifyLibraryFailure(undefined).failure).toBe('unknown')
  })
})

describe('T61-402 — ý định đã thấy được trên máy chủ chưa', () => {
  it('SỬA: chỉ kết luận khi TÊN trên máy chủ khớp tên vừa gửi', () => {
    /* "Entry có mặt" không nói được gì về một lần SỬA — nó vốn đã có mặt từ
       trước. Một phép kiểm chỉ hỏi sự tồn tại sẽ xác nhận mọi lần sửa, kể cả lần
       chưa hề tới máy chủ. */
    expect(libraryIntentVisible(intent({ name: 'SCALE_LIN_V2' }), [entry()])).toBeNull()
    expect(libraryIntentVisible(intent({ name: 'SCALE_LIN_V2' }), [entry({ name: 'SCALE_LIN_V2' })])).toBe(true)
  })

  it('TẠO: không thấy entry nào là chưa vào', () => {
    expect(libraryIntentVisible(intent(), [])).toBe(false)
  })

  it('XOÁ: vắng mặt là bằng chứng dương, còn mặt là chưa vào', () => {
    expect(libraryIntentVisible(intent({ kind: 'delete', name: undefined }), [])).toBe(true)
    expect(libraryIntentVisible(intent({ kind: 'delete', name: undefined }), [entry()])).toBe(false)
  })

  it('DEPRECATE: mọi entry của revision phải là DEPRECATED; không đọc thấy revision là chưa biết', () => {
    const deprecated = intent({ kind: 'deprecate', name: undefined, libraryRevisionId: REVISION_ID })
    expect(libraryIntentVisible(deprecated, [])).toBeNull()
    expect(libraryIntentVisible(deprecated, [entry({ libraryState: 'DEPRECATED' })])).toBe(true)
    expect(libraryIntentVisible(deprecated, [
      entry({ libraryState: 'DEPRECATED' }),
      entry({ entryId: 'other', libraryState: 'PUBLISHED' }),
    ])).toBe(false)
  })
})

describe('T61-402 — đọc lại có chặn trên', () => {
  const noSleep = () => Promise.resolve()

  it('xác nhận ngay khi máy chủ đã thấy, và lấy ETag đọc lại được', async () => {
    const readEntries = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([entry({ name: 'SCALE_LIN_V2' })])
    const readEtag = vi.fn().mockResolvedValue('"draft:4"')
    const result = await reconcileLibraryMutation({
      intent: intent({ name: 'SCALE_LIN_V2' }), readEntries, readEtag, sleep: noSleep
    })
    expect(result).toEqual({ outcome: 'succeeded', attempts: 2, etag: '"draft:4"' })
    expect(readEntries).toHaveBeenCalledTimes(2)
  })

  it('có CHẶN TRÊN: hết lượt thì dừng, và kết luận là KHÔNG BIẾT', async () => {
    const readEntries = vi.fn().mockResolvedValue([])
    const readEtag = vi.fn()
    const attempts: number[] = []
    const result = await reconcileLibraryMutation({
      intent: intent({ name: 'SCALE_LIN_V2' }), readEntries, readEtag, sleep: noSleep,
      onAttempt: (attempt) => attempts.push(attempt)
    })
    expect(result.outcome).toBe('unknown')
    expect(result.attempts).toBe(LIBRARY_RECONCILE_ATTEMPTS)
    expect(readEntries).toHaveBeenCalledTimes(LIBRARY_RECONCILE_ATTEMPTS)
    expect(attempts).toEqual([1, 2, 3, 4])
    // Không đọc được kết quả thì cũng không đi đọc ETag: không có gì để xác nhận.
    expect(readEtag).not.toHaveBeenCalled()
  })

  it('một lượt đọc hỏng không bị quy thành "đã hỏng" — vẫn đọc tiếp', async () => {
    const readEntries = vi.fn()
      .mockRejectedValueOnce(new Error('mạng chập'))
      .mockResolvedValue([entry({ name: 'SCALE_LIN_V2' })])
    const result = await reconcileLibraryMutation({
      intent: intent({ name: 'SCALE_LIN_V2' }), readEntries,
      readEtag: () => Promise.resolve('"draft:4"'), sleep: noSleep
    })
    expect(result.outcome).toBe('succeeded')
    expect(result.attempts).toBe(2)
  })

  it('xác nhận được nhưng không đọc nổi ETag thì vẫn là thành công, ETag để null', async () => {
    // `null` ở đây nghĩa là "chưa đọc được ETag", và chỗ gọi phải giữ nguyên ETag
    // cũ chứ không bịa một số mới.
    const result = await reconcileLibraryMutation({
      intent: intent({ kind: 'delete', name: undefined }),
      readEntries: () => Promise.resolve([]),
      readEtag: () => Promise.reject(new Error('đọc ETag hỏng')),
      sleep: noSleep
    })
    expect(result).toEqual({ outcome: 'succeeded', attempts: 1, etag: null })
  })

  it('nghỉ giữa các lượt đúng số lượt còn lại, không nghỉ sau lượt cuối', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    await reconcileLibraryMutation({
      intent: intent({ name: 'SCALE_LIN_V2' }),
      readEntries: () => Promise.resolve([]), readEtag: () => Promise.resolve(null),
      sleep, attempts: 3, delayMs: 10
    })
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10)
  })
})
