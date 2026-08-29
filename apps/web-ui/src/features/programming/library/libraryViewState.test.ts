import { describe, expect, it } from 'vitest'
import {
  LIBRARY_VIEW_STATUSES,
  hasActiveLibraryFilter,
  libraryFiltersKey,
  libraryListUsable,
  libraryViewState,
  rememberLibraryRead,
  type LibraryFilterInput,
  type LibraryReadInput,
  type LibraryViewInput,
  type LibraryViewMemory,
} from './libraryViewState'
import type { ProgrammingLibraryEntry } from '../model/types'

function entry(overrides: Partial<ProgrammingLibraryEntry> = {}): ProgrammingLibraryEntry {
  return {
    scope: 'PROJECT',
    libraryRevisionId: 'rev-1',
    libraryVersion: '1.0.0',
    libraryState: 'PUBLISHED',
    entryId: 'e1',
    kind: 'FUNCTION_BLOCK',
    name: 'PID',
    featureState: 'AVAILABLE',
    contentSha256: 'sha',
    dependencies: [],
    stateLayoutKnown: true,
    stateSizeBytes: 0,
    ...overrides,
  }
}

const TWO = [entry(), entry({ entryId: 'e2', name: 'TON' })]

function view(overrides: Partial<LibraryViewInput> = {}) {
  return libraryViewState({
    list: { status: 'ready', items: TWO },
    canEdit: true,
    hasProject: true,
    ...overrides,
  })
}

function read(overrides: Partial<LibraryReadInput> = {}): LibraryReadInput {
  return { status: 'ready', items: [], ...overrides }
}

function memory(overrides: Partial<LibraryViewMemory> = {}): LibraryViewMemory {
  return { key: libraryFiltersKey(undefined), items: TWO, hasMore: false, at: 1000, ...overrides }
}

const FILTERED: LibraryFilterInput = { query: 'PID' }

describe('libraryViewState — tám trạng thái của SPEC-PGM04-VISUAL-001 §3', () => {
  it('mỗi đầu vào chỉ rơi vào MỘT trạng thái, và luôn là một trạng thái có tên', () => {
    const cases: LibraryViewInput[] = [
      { list: { status: 'loading', items: null } },
      { list: { status: 'ready', items: TWO } },
      { list: { status: 'ready', items: [] }, filters: FILTERED },
      { list: { status: 'ready', items: [] } },
      { list: { status: 'error', items: [], failure: 'error' } },
      { list: { status: 'error', items: [], failure: 'offline' } },
      { list: { status: 'error', items: [], failure: 'permission' } },
      { list: { status: 'ready', items: TWO }, detail: { status: 'error' } },
    ]
    const seen = cases.map((input) => libraryViewState(input).status)
    expect(seen).toEqual([
      'loading',
      'ready',
      'empty-filter',
      'empty-project',
      'error',
      'offline',
      'no-permission',
      'detail-error',
    ])
    // Mỗi trạng thái khai báo phải với tới được; một nhánh không đầu vào nào
    // chạm tới là một nhánh chưa ai kiểm.
    expect(new Set(seen)).toEqual(new Set(LIBRARY_VIEW_STATUSES))
  })

  it('loading CHỈ khi chưa có gì để vẽ', () => {
    expect(view({ list: { status: 'loading', items: null } }).status).toBe('loading')
    expect(view({ list: { status: 'loading', items: [] } }).status).toBe('loading')
  })

  it('đọc lại trên nền dữ liệu đang hiện KHÔNG quay về loading', () => {
    // Dựng skeleton mỗi lần refresh là tự xoá một danh sách người dùng đang đọc
    // dở. §3 chỉ cho `loading` ở "request đầu chưa về".
    const state = view({ list: { status: 'loading', items: TWO } })
    expect(state.status).toBe('ready')
    expect(state.refreshing).toBe(true)
    expect(state.stale).toBe(true)
    expect(state.groups).toHaveLength(2)
  })
})

describe('LUẬT 1 — error KHÔNG BAO GIỜ suy thành empty', () => {
  it('lỗi với 0 hàng và KHÔNG bộ lọc vẫn là error, không phải empty-project', () => {
    // "Thư viện không có khối nào" mời người dùng đi tạo lại thứ có thể đang tồn
    // tại. "Không đọc được thư viện" mời họ thử lại. Hai câu, hai hành động.
    const state = view({ list: { status: 'error', items: [], error: 'HTTP 500' } })
    expect(state.status).toBe('error')
    expect(state.status).not.toBe('empty-project')
    expect(state.action).toBe('retry')
    expect(state.retryable).toBe(true)
    expect(state.message).toBe('HTTP 500')
  })

  it('lỗi với 0 hàng và CÓ bộ lọc vẫn là error, không phải empty-filter', () => {
    const state = view({ list: { status: 'error', items: [] }, filters: FILTERED })
    expect(state.status).toBe('error')
    expect(state.action).toBe('retry')
  })

  it('chưa từng đọc xong (`items: null`) khi lỗi cũng không thành empty', () => {
    expect(view({ list: { status: 'error', items: null } }).status).toBe('error')
  })

  it('mất mạng với 0 hàng là offline, không phải empty', () => {
    expect(view({ list: { status: 'error', items: [], failure: 'offline' } }).status).toBe('offline')
    expect(view({ list: { status: 'ready', items: [] }, online: false }).status).toBe('offline')
  })

  it('thiếu quyền đọc với 0 hàng là no-permission, không phải empty', () => {
    const state = view({ list: { status: 'error', items: [], failure: 'permission' } })
    expect(state.status).toBe('no-permission')
    // Bấm lại không đổi được RBAC; một nút luôn hỏng chỉ dạy người ta bỏ qua nút.
    expect(state.retryable).toBe(false)
    expect(state.action).toBe('none')
  })

  it('chỉ MỘT lần đọc thành công mới cho phép kết luận "rỗng"', () => {
    // Bất biến gộp: quét mọi tổ hợp lỗi × bộ lọc, không tổ hợp nào được ra `empty-*`.
    for (const failure of ['error', 'offline', 'permission'] as const) {
      for (const filters of [undefined, FILTERED]) {
        for (const items of [null, [] as ProgrammingLibraryEntry[]]) {
          const state = view({ list: { status: 'error', items, failure }, filters })
          expect(state.status).not.toBe('empty-filter')
          expect(state.status).not.toBe('empty-project')
        }
      }
    }
  })
})

describe('LUẬT 2 — empty-filter khác empty-project', () => {
  it('có bộ lọc mà 0 kết quả ⇒ đề nghị XOÁ BỘ LỌC', () => {
    const state = view({ list: { status: 'ready', items: [] }, filters: FILTERED })
    expect(state.status).toBe('empty-filter')
    expect(state.action).toBe('clear-filter')
  })

  it('mọi mảnh bộ lọc đều đủ để thành empty-filter', () => {
    for (const filters of [
      { query: 'PID' },
      { scope: 'PROJECT' },
      { kind: 'FUNCTION' },
      { category: 'control' },
    ]) {
      expect(view({ list: { status: 'ready', items: [] }, filters }).status).toBe('empty-filter')
    }
  })

  it('không bộ lọc mà 0 kết quả ⇒ đề nghị TẠO KHỐI', () => {
    const state = view({ list: { status: 'ready', items: [] } })
    expect(state.status).toBe('empty-project')
    expect(state.action).toBe('create-block')
  })

  it('ô tìm chỉ toàn khoảng trắng KHÔNG phải bộ lọc', () => {
    // Chuỗi đó không được gửi lên server, nên mời "xoá bộ lọc" là mời người dùng
    // xoá một thứ không ảnh hưởng gì tới kết quả.
    const state = view({ list: { status: 'ready', items: [] }, filters: { query: '   ' } })
    expect(state.status).toBe('empty-project')
    expect(hasActiveLibraryFilter({ query: '   ' })).toBe(false)
    expect(hasActiveLibraryFilter({ query: ' PID ' })).toBe(true)
  })

  it('empty-project thiếu quyền: KHÔNG mời tạo, nhưng nút vẫn hiện kèm lý do', () => {
    // §3 cấm "ẩn nút mà không nói lý do". Không mời ≠ giấu.
    const state = view({ list: { status: 'ready', items: [] }, canEdit: false })
    expect(state.status).toBe('empty-project')
    expect(state.action).toBe('none')
    expect(state.write).toEqual({ visible: true, enabled: false, reason: 'NEEDS_PERMISSION' })
  })

  it('hai màn rỗng không bao giờ trùng hành động', () => {
    const filtered = view({ list: { status: 'ready', items: [] }, filters: FILTERED })
    const project = view({ list: { status: 'ready', items: [] } })
    expect(filtered.status).not.toBe(project.status)
    expect(filtered.action).not.toBe(project.action)
  })
})

describe('LUẬT 3 — lỗi chi tiết KHÔNG làm hỏng danh sách', () => {
  it('detail-error giữ nguyên danh sách và giữ nó dùng được', () => {
    const ok = view({ list: { status: 'ready', items: TWO }, detail: { status: 'ready', key: 'PROJECT/e1' } })
    const broken = view({
      list: { status: 'ready', items: TWO },
      detail: { status: 'error', key: 'PROJECT/e1', error: 'HTTP 500' },
    })
    expect(broken.status).toBe('detail-error')
    // Cùng danh sách, từng hàng một: Inspector hỏng không được cắt xén lưới.
    expect(broken.groups).toEqual(ok.groups)
    expect(libraryListUsable(broken)).toBe(true)
    expect(broken.stale).toBe(false)
    // Lỗi nằm trong `detail`, không leo lên `message` của danh sách.
    expect(broken.detail).toEqual({ kind: 'error', key: 'PROJECT/e1', message: 'HTTP 500' })
    expect(broken.message).toBeNull()
  })

  it('danh sách hỏng là tin lớn hơn: detail-error không đè lên error/offline', () => {
    const state = view({
      list: { status: 'error', items: TWO, error: 'HTTP 500' },
      detail: { status: 'error', error: 'chi tiết hỏng' },
    })
    expect(state.status).toBe('error')
    // Nhưng lỗi chi tiết không mất đi đâu.
    expect(state.detail.kind).toBe('error')
  })

  it('chưa chọn khối thì Inspector là `none`, không phải lỗi', () => {
    expect(view().detail).toEqual({ kind: 'none' })
    expect(view({ detail: { status: 'idle' } }).detail).toEqual({ kind: 'none' })
  })

  it('lỗi phân trang cũng không hạ danh sách xuống error', () => {
    // Cùng họ với luật 3: mất trang thứ tư không phải mất danh sách.
    const state = view({
      list: { status: 'ready', items: TWO, hasMore: true, loadMoreError: 'HTTP 503' },
    })
    expect(state.status).toBe('ready')
    expect(state.groups).toHaveLength(2)
    expect(state.more).toEqual({ kind: 'error', message: 'HTTP 503' })
    expect(state.message).toBeNull()
  })
})

describe('giữ dữ liệu đã tải khi offline/error', () => {
  it('lỗi mà chỗ gọi còn cầm dữ liệu ⇒ giữ danh sách và đánh dấu stale', () => {
    const state = view({ list: { status: 'error', items: TWO, error: 'HTTP 500' } })
    expect(state.status).toBe('error')
    expect(state.groups).toHaveLength(2)
    expect(state.stale).toBe(true)
    expect(libraryListUsable(state)).toBe(true)
  })

  it('hook xoá items khi lỗi ⇒ ảnh chụp giữ màn hình khỏi trắng', () => {
    // `useProgrammingLibraryPaged` đặt `items: []` ở nhánh lỗi trang đầu, nên
    // không có ảnh chụp thì một lần refresh hỏng xoá sạch màn hình.
    const state = view({ list: { status: 'error', items: [] }, retained: memory() })
    expect(state.status).toBe('error')
    expect(state.groups).toHaveLength(2)
    expect(state.stale).toBe(true)
    expect(state.lastSuccessAt).toBe(1000)
  })

  it('offline giữ phần đã tải, đúng ô "cấm xoá nội dung đang hiện"', () => {
    const state = view({ list: { status: 'error', items: TWO, failure: 'offline' }, online: false })
    expect(state.status).toBe('offline')
    expect(state.groups).toHaveLength(2)
    expect(state.stale).toBe(true)
    expect(state.action).toBe('retry')
  })

  it('mất mạng nhưng lần đọc gần nhất THÀNH CÔNG thì không gọi là stale', () => {
    // `stale` nói về nguồn gốc của dữ liệu đang vẽ, không phải về mạng. Gắn nhãn
    // "cũ" cho thứ vừa về từ server là nói dối theo chiều ngược lại.
    const state = view({ list: { status: 'ready', items: TWO }, online: false })
    expect(state.status).toBe('offline')
    expect(state.stale).toBe(false)
  })

  it('no-permission là ngoại lệ DUY NHẤT: nội dung cũ bị bỏ', () => {
    // Mọi lỗi khác nói "chưa đọc lại được"; 403 nói "có thể không còn là của bạn
    // để xem". Giữ nội dung cũ sau một phán quyết RBAC là tự mở một lỗ rò.
    const state = view({ list: { status: 'error', items: TWO, failure: 'permission' }, retained: memory() })
    expect(state.status).toBe('no-permission')
    expect(state.groups).toEqual([])
    expect(state.stale).toBe(false)
  })

  it('ảnh chụp của bộ lọc KHÁC không được đem ra trả lời bộ lọc hiện tại', () => {
    const state = view({
      list: { status: 'error', items: [] },
      filters: FILTERED,
      retained: memory({ key: libraryFiltersKey({ scope: 'SYSTEM' }) }),
    })
    expect(state.groups).toEqual([])
    expect(state.stale).toBe(false)
  })

  it('nhiều version của một entry vẫn là MỘT thẻ', () => {
    // Gom bằng `groupLibraryEntries` chứ không đếm hàng thô: hai thẻ trùng tên
    // làm người dùng sửa một thẻ rồi thấy thẻ kia vẫn mang giá trị cũ.
    const state = view({
      list: {
        status: 'ready',
        items: [entry({ libraryVersion: '1.0.0' }), entry({ libraryVersion: '1.1.0', libraryRevisionId: 'rev-2' })],
      },
    })
    expect(state.status).toBe('ready')
    expect(state.groups).toHaveLength(1)
    expect(state.groups[0].versions).toHaveLength(2)
  })
})

describe('đường ghi — khoá thì nói lý do, không bao giờ ẩn', () => {
  it('nút ghi hiện ở MỌI trạng thái', () => {
    const inputs: LibraryViewInput[] = [
      { list: { status: 'loading', items: null } },
      { list: { status: 'ready', items: TWO } },
      { list: { status: 'ready', items: [] } },
      { list: { status: 'error', items: [], failure: 'error' } },
      { list: { status: 'error', items: [], failure: 'offline' } },
      { list: { status: 'error', items: [], failure: 'permission' } },
    ]
    for (const input of inputs) {
      for (const canEdit of [true, false]) {
        expect(libraryViewState({ ...input, canEdit, hasProject: true }).write.visible).toBe(true)
      }
    }
  })

  it('lý do đi từ BỀN tới TẠM: quyền → project → mạng', () => {
    // Nói "mất mạng" với người vốn không có quyền ghi là chỉ họ sửa sai thứ.
    expect(view({ canEdit: false, hasProject: false, online: false }).write.reason).toBe('NEEDS_PERMISSION')
    expect(view({ canEdit: true, hasProject: false, online: false }).write.reason).toBe('NO_PROJECT')
    expect(view({ canEdit: true, hasProject: true, online: false }).write.reason).toBe('OFFLINE')
    expect(view().write).toEqual({ visible: true, enabled: true, reason: null })
  })
})

describe('phân trang', () => {
  it('còn trang / hết trang / đang tải thêm là ba câu khác nhau', () => {
    expect(view({ list: { status: 'ready', items: TWO, hasMore: true } }).more).toEqual({ kind: 'available' })
    expect(view({ list: { status: 'ready', items: TWO, hasMore: false } }).more).toEqual({ kind: 'complete' })
    expect(view({ list: { status: 'ready', items: TWO, hasMore: true, loadingMore: true } }).more)
      .toEqual({ kind: 'loading' })
  })

  it('không có hàng nào thì không mời tải thêm', () => {
    expect(view({ list: { status: 'ready', items: [], hasMore: true } }).more).toEqual({ kind: 'complete' })
  })

  it('ảnh chụp mang theo cờ còn-trang của chính nó', () => {
    const state = view({ list: { status: 'error', items: [] }, retained: memory({ hasMore: true }) })
    expect(state.more).toEqual({ kind: 'available' })
  })
})

describe('rememberLibraryRead — reducer giữ ảnh chụp', () => {
  const key = libraryFiltersKey(undefined)

  it('đọc thành công thay ảnh chụp, kể cả khi kết quả rỗng', () => {
    const next = rememberLibraryRead(memory(), read({ items: [], lastSuccessAt: 42 }), key)
    expect(next).toEqual({ key, items: [], hasMore: false, at: 42 })
  })

  it('lỗi thường GIỮ ảnh chụp — đây là thứ chống xoá trắng màn hình', () => {
    const previous = memory()
    expect(rememberLibraryRead(previous, read({ status: 'error', items: [] }), key)).toBe(previous)
    expect(rememberLibraryRead(previous, read({ status: 'error', items: [], failure: 'offline' }), key))
      .toBe(previous)
    expect(rememberLibraryRead(previous, read({ status: 'loading', items: null }), key)).toBe(previous)
  })

  it('403 XOÁ ảnh chụp', () => {
    expect(rememberLibraryRead(memory(), read({ status: 'error', items: [], failure: 'permission' }), key))
      .toBeNull()
  })

  it('đổi bộ lọc XOÁ ảnh chụp: nó trả lời câu hỏi cũ', () => {
    const previous = memory({ key: libraryFiltersKey({ scope: 'SYSTEM' }) })
    expect(rememberLibraryRead(previous, read({ status: 'loading', items: null }), key)).toBeNull()
  })

  it('ảnh chụp là BẢN SAO, không phải tham chiếu vào mảng của hook', () => {
    // Hook phân trang `push` thêm trang mới vào mảng của nó; giữ tham chiếu là
    // để ảnh chụp tự đổi nội dung sau lưng màn hình.
    const items = [entry()]
    const next = rememberLibraryRead(null, read({ items }), key)
    items.push(entry({ entryId: 'e9' }))
    expect(next?.items).toHaveLength(1)
  })
})

describe('libraryFiltersKey', () => {
  it('không trộn hai bộ lọc khác nhau vào một khoá', () => {
    expect(libraryFiltersKey({ scope: 'A B' })).not.toBe(libraryFiltersKey({ scope: 'A', kind: 'B' }))
    expect(libraryFiltersKey({ query: ' PID ' })).toBe(libraryFiltersKey({ query: 'PID' }))
  })
})
