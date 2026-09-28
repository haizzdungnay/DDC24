import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useLazyProgrammingLibraryCatalog,
  useLazyProgrammingPointCatalog,
  useProgrammingLibraryPaged,
  useProgrammingRevision,
  useProgrammingRevisionComparison,
  useProgrammingCheck,
  useProgrammingRuntimeMonitor,
} from './queries'

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

describe('useProgrammingResource — không làm rơi lượt đọc khi định danh đổi', () => {
  beforeEach(() => { client.request.mockReset() })

  it('Revision đổi khi request cũ còn bay: bỏ response cũ và đọc đúng Revision mới', async () => {
    const first = deferred<{ revisionId: string }>()
    client.request
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ revisionId: 'rev-b' })

    const { result, rerender } = renderHook(
      ({ revisionId }: { revisionId: string }) => useProgrammingRevision(revisionId),
      { initialProps: { revisionId: 'rev-a' } },
    )
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))

    rerender({ revisionId: 'rev-b' })
    await act(async () => first.resolve({ revisionId: 'rev-a' }))

    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.data).toEqual({ revisionId: 'rev-b' }))
    expect(client.request.mock.calls[1][1]).toEqual({ path: { revisionId: 'rev-b' } })
  })
})

describe('useProgrammingCheck — deep-link chưa có Check', () => {
  beforeEach(() => { client.request.mockReset() })

  it('không gửi request và không báo lỗi khi thiếu checkId; đọc khi ID xuất hiện', async () => {
    client.request.mockResolvedValue({ checkId: 'check-1', state: 'FAILED' })
    const { result, rerender } = renderHook(
      ({ checkId }: { checkId?: string }) => useProgrammingCheck(checkId),
      { initialProps: { checkId: undefined as string | undefined } },
    )
    expect(result.current.status).toBe('loading')
    expect(result.current.error).toBeNull()
    expect(client.request).not.toHaveBeenCalled()

    rerender({ checkId: 'check-1' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(client.request).toHaveBeenCalledWith('getProgrammingCheck', { path: { checkId: 'check-1' } })

    rerender({ checkId: undefined })
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('useProgrammingRuntimeMonitor — vòng đời LIVE T59-812', () => {
  /* Thân KHỐI, không phải biểu thức: `mockReset()` trả về CHÍNH mock, và
     vitest coi giá trị hàm trả về từ `beforeEach` là hàm dọn dẹp — nên nó gọi
     `client.request()` một lần nữa sau mỗi test. Với một mock đang `reject`,
     lần gọi thừa ấy thành unhandled rejection và test đỏ ở một chỗ không liên
     quan gì tới thứ nó đang đo. */
  beforeEach(() => { client.request.mockReset() })
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
  /* Thân KHỐI, không phải biểu thức: `mockReset()` trả về CHÍNH mock, và
     vitest coi giá trị hàm trả về từ `beforeEach` là hàm dọn dẹp — nên nó gọi
     `client.request()` một lần nữa sau mỗi test. Với một mock đang `reject`,
     lần gọi thừa ấy thành unhandled rejection và test đỏ ở một chỗ không liên
     quan gì tới thứ nó đang đo. */
  beforeEach(() => { client.request.mockReset() })
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

/**
 * `T61-202` / `ISS-PGM04-05` — MỘT engine phân trang cho mọi bề mặt đọc
 * `/libraries`.
 *
 * Trước lát này có ba đường đọc và cả ba xin đúng một trang `limit: 100` rồi bỏ
 * `nextCursor`. Cái giá không phải là mã trùng: nó là mã PHÂN KỲ — Quick
 * Library chưa từng có `loadMore`, nên mọi lần "sửa phân trang" ở PGM-04 đều
 * không chạm tới PGM-02, và không ai nhận ra vì cả hai màn hình vẫn hiện một
 * danh sách trông đầy đủ.
 *
 * Fixture ở đây cố ý là 125 mục chia hai trang (100 + 25): ngưỡng 100 là đúng
 * chỗ bản cũ cắt, nên một fixture nhỏ hơn sẽ xanh cho cả bản hỏng.
 */
function libraryEntry(index: number) {
  return {
    scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
    entryId: `BLK_${index}`, kind: 'FUNCTION', name: `BLK_${index}`, featureState: 'AVAILABLE',
    contentSha256: 'a'.repeat(64), dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0,
  }
}

function libraryPageOf(from: number, count: number, nextCursor: string | null) {
  return {
    items: Array.from({ length: count }, (_, offset) => libraryEntry(from + offset)),
    nextCursor,
  }
}

function entryIdsOf(items: readonly { entryId: string }[]): string[] {
  return items.map((item) => item.entryId)
}

describe('useProgrammingLibraryPaged — engine phân trang dùng chung T61-202', () => {
  /* Thân KHỐI, không phải biểu thức: `mockReset()` trả về CHÍNH mock, và
     vitest coi giá trị hàm trả về từ `beforeEach` là hàm dọn dẹp — nên nó gọi
     `client.request()` một lần nữa sau mỗi test. Với một mock đang `reject`,
     lần gọi thừa ấy thành unhandled rejection và test đỏ ở một chỗ không liên
     quan gì tới thứ nó đang đo. */
  beforeEach(() => { client.request.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('125 mục qua hai trang: không mục nào rơi, không mục nào nhân đôi', async () => {
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockResolvedValueOnce(libraryPageOf(101, 25, null))

    const { result } = renderHook(() => useProgrammingLibraryPaged({ projectId: 'p-1' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items).toHaveLength(100)
    expect(result.current.hasMore).toBe(true)

    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.items).toHaveLength(125))
    // Số TUYỆT ĐỐI ở cả hai đầu: một khẳng định `> 100` sẽ xanh kể cả khi trang
    // hai chỉ về được một nửa.
    expect(result.current.items[0]?.entryId).toBe('BLK_1')
    expect(result.current.items[124]?.entryId).toBe('BLK_125')
    expect(new Set(entryIdsOf(result.current.items)).size).toBe(125)
    expect(result.current.hasMore).toBe(false)
  })

  it('trang chồng lấn: mục lặp bị khử theo (libraryRevisionId, entryId), không theo vị trí', async () => {
    // Máy chủ trả lại 20 mục cuối của trang trước. Ghép thô sẽ cho 145 mục với
    // 20 thẻ trùng — và hai thẻ cùng tên tệ hơn một thẻ thiếu: người dùng sửa
    // một thẻ rồi thấy thẻ kia vẫn mang giá trị cũ.
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockResolvedValueOnce(libraryPageOf(81, 45, null))

    const { result } = renderHook(() => useProgrammingLibraryPaged({}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.hasMore).toBe(false))
    expect(result.current.items).toHaveLength(125)
    expect(new Set(entryIdsOf(result.current.items)).size).toBe(125)
  })

  it('cùng entryId ở library revision KHÁC là hai mục, không phải một', async () => {
    // Khử trùng theo entryId trần sẽ nuốt mất bản PROJECT của một khối trùng
    // tên với bản SYSTEM — đúng lớp lỗi mà tuple định danh sinh ra để chặn.
    client.request
      .mockResolvedValueOnce({ items: [libraryEntry(1)], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({
        items: [{ ...libraryEntry(1), libraryRevisionId: 'prj-9', scope: 'PROJECT' }],
        nextCursor: null,
      })

    const { result } = renderHook(() => useProgrammingLibraryPaged({}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.items.map((item) => item.libraryRevisionId)).toEqual(['sys-1', 'prj-9'])
  })

  it('trang sau lỗi: danh sách đã tải giữ nguyên, và cursor đó thử lại được', async () => {
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockRejectedValueOnce(new Error('PRG-ERR-UNAVAILABLE-001'))
      .mockResolvedValueOnce(libraryPageOf(101, 25, null))

    const { result } = renderHook(() => useProgrammingLibraryPaged({}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull())
    expect(result.current.items).toHaveLength(100)
    expect(result.current.status).toBe('ready')
    expect(result.current.hasMore).toBe(true)

    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.items).toHaveLength(125))
    expect(result.current.loadMoreError).toBeNull()
  })

  it('cursor lặp: ghép trang vừa nhận rồi DỪNG, không quay vòng vô hạn', async () => {
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockResolvedValueOnce(libraryPageOf(101, 25, 'cursor-2'))

    const { result } = renderHook(() => useProgrammingLibraryPaged({}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.items).toHaveLength(125))
    expect(result.current.hasMore).toBe(false)
    expect(result.current.loadMoreError).not.toBeNull()
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  it('đổi bộ lọc ⇒ trang đã ghép bị bỏ, không trộn kết quả của hai bộ lọc', async () => {
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockResolvedValueOnce(libraryPageOf(101, 25, null))
      .mockResolvedValueOnce({ items: [libraryEntry(500)], nextCursor: null })

    const { result, rerender } = renderHook(
      ({ query }: { query?: string }) => useProgrammingLibraryPaged({ query }),
      { initialProps: {} as { query?: string } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { result.current.loadMore() })
    await waitFor(() => expect(result.current.items).toHaveLength(125))

    rerender({ query: 'scale' })
    await waitFor(() => expect(entryIdsOf(result.current.items)).toEqual(['BLK_500']))
    expect(result.current.hasMore).toBe(false)
  })

  it('enabled=false ⇒ KHÔNG gọi máy chủ; bật lên mới đọc trang đầu', async () => {
    client.request.mockResolvedValue(libraryPageOf(1, 3, null))
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useProgrammingLibraryPaged({}, { enabled }),
      { initialProps: { enabled: false } },
    )
    /* PHẢI xả microtask trước khi khẳng định "chưa gọi": request nằm sau một
       `Promise.resolve().then(...)`, nên một khẳng định ĐỒNG BỘ ngay sau render
       sẽ xanh kể cả với bản bỏ qua `enabled` hoàn toàn. */
    await act(async () => { await Promise.resolve() })
    expect(client.request).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(client.request).toHaveBeenCalledTimes(1)
  })
})

describe('useLazyProgrammingLibraryCatalog — nạp trễ nhưng ĐẦY ĐỦ T61-202', () => {
  /* Thân KHỐI, không phải biểu thức: `mockReset()` trả về CHÍNH mock, và
     vitest coi giá trị hàm trả về từ `beforeEach` là hàm dọn dẹp — nên nó gọi
     `client.request()` một lần nữa sau mỗi test. Với một mock đang `reject`,
     lần gọi thừa ấy thành unhandled rejection và test đỏ ở một chỗ không liên
     quan gì tới thứ nó đang đo. */
  beforeEach(() => { client.request.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('chưa ai hỏi ⇒ không request; hỏi rồi ⇒ rút cạn mọi trang', async () => {
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockResolvedValueOnce(libraryPageOf(101, 25, null))

    const { result } = renderHook(() => useLazyProgrammingLibraryCatalog('p-1'))
    // Xả microtask trước khi khẳng định "chưa ai hỏi" — xem chú thích ở test
    // `enabled=false` phía trên.
    await act(async () => { await Promise.resolve() })
    expect(client.request).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')

    await act(async () => { result.current.ensureLoaded() })
    /* Tra cứu chữ ký cần danh sách ĐẦY ĐỦ: Inspector không có nút "tải thêm",
       nên một trang thiếu ở đây hiện thành "không xác định được chữ ký" cho một
       khối mà thư viện có công bố. */
    await waitFor(() => expect(result.current.items).toHaveLength(125))
    expect(result.current.status).toBe('ready')
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  it('một trang hỏng ⇒ dừng lại với phần đã đọc, không gõ cửa máy chủ vô hạn', async () => {
    client.request
      .mockResolvedValueOnce(libraryPageOf(1, 100, 'cursor-2'))
      .mockImplementation(() => Promise.reject(new Error('PRG-ERR-UNAVAILABLE-001')))

    const { result } = renderHook(() => useLazyProgrammingLibraryCatalog('p-1'))
    await act(async () => { result.current.ensureLoaded() })
    await waitFor(() => expect(result.current.items).toHaveLength(100))
    // Số TUYỆT ĐỐI: hai lần gọi = trang đầu + đúng một lần thử trang hai.
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))
    await act(async () => { await Promise.resolve() })
    expect(client.request).toHaveBeenCalledTimes(2)
  })
})

function pointPageOf(start: number, count: number, nextCursor: string | null) {
  return {
    schemaVersion: '1.0',
    items: Array.from({ length: count }, (_, index) => ({ category: 'VP', pointId: `VP${start + index}` })),
    nextCursor,
  }
}

describe('useLazyProgrammingPointCatalog — nạp trễ nhưng ĐẦY ĐỦ (Issue #790)', () => {
  beforeEach(() => { client.request.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('chưa ai hỏi ⇒ không request; hỏi rồi ⇒ rút cạn mọi trang với limit 500', async () => {
    client.request
      .mockResolvedValueOnce(pointPageOf(1, 500, 'cursor-2'))
      .mockResolvedValueOnce(pointPageOf(501, 4, null))

    const { result } = renderHook(() => useLazyProgrammingPointCatalog())
    await act(async () => { await Promise.resolve() })
    expect(client.request).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')

    await act(async () => { result.current.ensureLoaded() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    // Mục thứ 501..504 là đúng phần mà bản cũ (một request không phân trang) làm rơi.
    expect(result.current.data?.items).toHaveLength(504)
    expect(result.current.data?.items.at(-1)).toMatchObject({ pointId: 'VP504' })
    expect(client.request).toHaveBeenCalledTimes(2)
    expect(client.request).toHaveBeenNthCalledWith(1, 'getProgrammingPointCatalog', { query: { limit: 500 } })
    expect(client.request).toHaveBeenNthCalledWith(2, 'getProgrammingPointCatalog', { query: { limit: 500, cursor: 'cursor-2' } })

    // Gọi lại khi đã `ready` không tạo request mới (one-shot).
    await act(async () => { result.current.ensureLoaded() })
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  it('cursor lặp ⇒ dừng với lỗi, không quay vô hạn', async () => {
    client.request
      .mockResolvedValueOnce(pointPageOf(1, 500, 'cursor-2'))
      .mockResolvedValueOnce(pointPageOf(501, 4, 'cursor-2'))

    const { result } = renderHook(() => useLazyProgrammingPointCatalog())
    await act(async () => { result.current.ensureLoaded() })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(client.request).toHaveBeenCalledTimes(2)
  })
})

describe('useProgrammingPointCatalog — enabled flag ISS-#565', () => {
  beforeEach(() => { client.request.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('enabled=false không fetch và không poll', async () => {
    const { useProgrammingPointCatalog } = await import('./queries')
    client.request.mockResolvedValue({ schemaVersion: '1.0', items: [] })
    const { result } = renderHook(() => useProgrammingPointCatalog(false))
    await waitFor(() => expect(result.current.status).toBe('loading'))
    expect(client.request).not.toHaveBeenCalled()
  })

  it('enabled=true fetch ngay', async () => {
    const { useProgrammingPointCatalog } = await import('./queries')
    client.request.mockResolvedValue({ schemaVersion: '1.0', items: [] })
    const { result } = renderHook(() => useProgrammingPointCatalog(true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(client.request).toHaveBeenCalledWith('getProgrammingPointCatalog', expect.objectContaining({
      query: { limit: 500 },
      signal: expect.any(AbortSignal),
    }))
  })

  it('chống chồng request', async () => {
    const { useProgrammingPointCatalog } = await import('./queries')
    const first = deferred<{ schemaVersion: string; items: unknown[] }>()
    client.request.mockReturnValue(first.promise)
    const { result } = renderHook(() => useProgrammingPointCatalog(true))
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))
    
    const firstSignal = client.request.mock.calls[0][1].signal as AbortSignal
    act(() => { result.current.refresh() })
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))
    expect(firstSignal.aborted).toBe(true)

    first.resolve({ schemaVersion: '1.0', items: [] })
    await act(async () => { await Promise.resolve() })
    expect(client.request).toHaveBeenCalledTimes(2)
  })
})
