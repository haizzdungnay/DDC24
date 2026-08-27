import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgrammingRevisionComparison, useProgrammingRuntimeMonitor } from './queries'

const client = vi.hoisted(() => ({ request: vi.fn() }))
const pick = vi.hoisted(() => (viText: string) => viText)
vi.mock('./authClient', () => ({ useProgrammingApiClient: () => client }))
vi.mock('../../../shared/i18n', () => ({
  useI18n: () => ({ pick }),
}))

function snapshot(stamp: string) {
  return {
    schemaVersion: '1.0',
    activeRevisionId: 'revision-active',
    producer: { capturedMonotonicNs: stamp },
    safeState: false,
    task: null,
    items: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useProgrammingRuntimeMonitor — vòng đời LIVE T59-812', () => {
  beforeEach(() => client.request.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('EDIT không subscribe; LIVE subscribe; rời LIVE hủy timer và bỏ response đang bay', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>()
    client.request.mockReturnValue(pending.promise)
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useProgrammingRuntimeMonitor(enabled),
      { initialProps: { enabled: false } },
    )
    expect(client.request).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))
    rerender({ enabled: false })
    expect(clearIntervalSpy).toHaveBeenCalled()

    await act(async () => pending.resolve(snapshot('1000')))
    expect(result.current.data).toBeNull()
    expect(result.current.status).toBe('loading')
    unmount()
  })

  it('không mở request monitor chồng nhau; nhiều refresh được gộp thành một lượt kế', async () => {
    const first = deferred<ReturnType<typeof snapshot>>()
    client.request
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(snapshot('1001'))

    const { result, unmount } = renderHook(() => useProgrammingRuntimeMonitor(true))
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.refresh()
      result.current.refresh()
      result.current.refresh()
    })
    expect(client.request).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve(snapshot('1000')))
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))
    /* Ba yêu cầu xen giữa chỉ sinh đúng một lượt kế, không ba request. */
    expect(client.request).toHaveBeenCalledTimes(2)
    unmount()
  })
})

/**
 * `T59-819` — hook ghép trang của khay So sánh.
 *
 * Đây là chỗ FE dễ nói dối nhất trong cả làn: nó giữ state qua nhiều request,
 * nên một guard sai sẽ ghép diff của cặp Revision này vào header của cặp kia,
 * hoặc lặp/bỏ sót đúng phần danh sách mà người vận hành đang dựa vào để quyết
 * định có nạp chương trình xuống thiết bị hay không. Bộ diff ở máy chủ đã có
 * test golden riêng; những ca dưới đây khoá phần FE tự làm.
 */
function changesPage(overrides: Record<string, unknown> = {}) {
  return {
    fromRevisionId: 'rev-active',
    toRevisionId: 'rev-candidate',
    impact: {},
    changes: [],
    stHunks: [],
    fbdChanges: [],
    truncated: false,
    nextCursor: null,
    ...overrides,
  }
}

function hunk(objectId: string) {
  return {
    objectId, changeType: 'ADDED',
    beforeStartLine: 1, beforeLineCount: 0, afterStartLine: 1, afterLineCount: 1,
    beforeText: [], afterText: ['x := 1;'], truncated: false, coarse: false,
  }
}

describe('useProgrammingRevisionComparison — ghép trang không được lặp hay bỏ sót', () => {
  beforeEach(() => client.request.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('cặp Revision chưa đủ ⇒ không phát request nào', async () => {
    const { result } = renderHook(() => useProgrammingRevisionComparison(undefined, 'rev-candidate'))
    expect(client.request).not.toHaveBeenCalled()
    expect(result.current.status).toBe('loading')
    expect(result.current.data).toBeNull()
  })

  it('trang đầu KHÔNG mang cursor; đọc tiếp nối đúng đuôi danh sách', async () => {
    client.request
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-a')], truncated: true, nextCursor: '200' }))
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-b')], truncated: false, nextCursor: null }))

    const { result } = renderHook(() => useProgrammingRevisionComparison('rev-active', 'rev-candidate'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    // Bịa một cursor ở lần gọi đầu là cách bỏ mất chính phần đầu danh sách.
    expect(client.request.mock.calls[0][1]).not.toHaveProperty('query')
    expect(result.current.data?.truncated).toBe(true)

    await act(async () => { result.current.loadMore('200') })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(client.request.mock.calls[1][1]).toMatchObject({ query: { cursor: '200' } })
    expect(result.current.data?.stHunks?.map((item) => item.objectId)).toEqual(['object-a', 'object-b'])
    // Trang cuối phải HẠ cờ cắt: giữ nó bật sẽ cảnh báo thiếu sót không có thật.
    expect(result.current.data?.truncated).toBe(false)
    expect(result.current.data?.nextCursor).toBeNull()
  })

  it('gọi lại cùng một cursor không phát thêm request và không nhân đôi mục', async () => {
    client.request
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-a')], truncated: true, nextCursor: '200' }))
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-b')] }))

    const { result } = renderHook(() => useProgrammingRevisionComparison('rev-active', 'rev-candidate'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => { result.current.loadMore('200') })
    await waitFor(() => expect(result.current.loadingMore).toBe(false))
    await act(async () => { result.current.loadMore('200') })

    expect(client.request).toHaveBeenCalledTimes(2)
    expect(result.current.data?.stHunks).toHaveLength(2)
  })

  it('máy chủ trả cursor lặp ⇒ dừng fail-closed thay vì quay vòng vô hạn', async () => {
    client.request
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-a')], truncated: true, nextCursor: '200' }))
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-b')], truncated: true, nextCursor: '200' }))

    const { result } = renderHook(() => useProgrammingRevisionComparison('rev-active', 'rev-candidate'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => { result.current.loadMore('200') })
    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull())
    expect(result.current.loadMoreError).toContain('cursor lặp')
    // Phần đã tải vẫn đúng nên vẫn phải hiện; và `truncated` vẫn bật để danh
    // sách tự khai là chưa đầy đủ.
    expect(result.current.error).toBeNull()
    expect(result.current.data?.stHunks).toHaveLength(2)
    expect(result.current.data?.truncated).toBe(true)
    // Không mời thử lại một cursor mà máy chủ đã chứng minh là quay vòng.
    expect(result.current.data?.nextCursor).toBeNull()
  })

  it('lỗi khi đọc tiếp vẫn cho thử lại đúng cursor đó, không khoá chết phần còn lại', async () => {
    client.request
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-a')], truncated: true, nextCursor: '200' }))
      .mockRejectedValueOnce(new Error('mạng hỏng'))
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-b')] }))

    const { result } = renderHook(() => useProgrammingRevisionComparison('rev-active', 'rev-candidate'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => { result.current.loadMore('200') })
    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull())
    /* Lỗi trang tiếp KHÔNG được vứt phần đã tải, nếu không nút thử lại cũng
       biến mất cùng danh sách. */
    expect(result.current.data?.stHunks).toHaveLength(1)
    expect(result.current.error).toBeNull()

    await act(async () => { result.current.loadMore('200') })
    await waitFor(() => expect(result.current.loadMoreError).toBeNull())
    expect(result.current.data?.stHunks?.map((item) => item.objectId)).toEqual(['object-a', 'object-b'])
  })

  it('máy chủ trả bảng của cặp Revision KHÁC ⇒ từ chối, không vẽ nhầm', async () => {
    client.request.mockResolvedValueOnce(changesPage({ toRevisionId: 'rev-khac' }))

    const { result } = renderHook(() => useProgrammingRevisionComparison('rev-active', 'rev-candidate'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toContain('cặp Revision khác')
  })

  it('đổi cặp Revision ⇒ KHÔNG giữ lại diff cũ trong lúc chờ trang mới', async () => {
    const second = deferred<ReturnType<typeof changesPage>>()
    client.request
      .mockResolvedValueOnce(changesPage({ stHunks: [hunk('object-a')] }))
      .mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(
      ({ to }: { to: string }) => useProgrammingRevisionComparison('rev-active', to),
      { initialProps: { to: 'rev-candidate' } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.stHunks).toHaveLength(1)

    rerender({ to: 'rev-candidate-2' })
    /* Ghép header của cặp mới với diff của cặp cũ là đúng loại nói dối màn So
       sánh không được phép mắc. */
    expect(result.current.status).toBe('loading')
    expect(result.current.data).toBeNull()

    await act(async () => {
      second.resolve(changesPage({ toRevisionId: 'rev-candidate-2', stHunks: [hunk('object-b')] }))
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.stHunks?.map((item) => item.objectId)).toEqual(['object-b'])
  })
})
