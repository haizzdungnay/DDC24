import { groupLibraryEntries, type LibraryEntryGroup } from '../model/library'
import type { ProgrammingLibraryEntry } from '../model/types'

/**
 * `T61-206` — mô hình TRẠNG THÁI của màn PGM-04 Control Library.
 *
 * `libraryPresentation.ts` trả lời "một khối hiện ra như thế nào". Tệp này trả
 * lời câu hỏi đứng trước đó: **màn hình đang ở tình huống nào**, và tình huống
 * ấy mời người dùng làm gì. Hai câu hỏi tách nhau vì chúng hỏng theo hai kiểu
 * khác nhau — và kiểu hỏng ở đây tốn kém hơn: một khối vẽ sai thì người dùng
 * thấy ngay, còn một màn hình nói "thư viện không có khối nào" trong khi sự
 * thật là "không đọc được thư viện" thì người dùng tin, rồi đi tạo lại thứ đang
 * có sẵn.
 *
 * Đây là mô-đun THUẦN: không React, không fetch, không đồng hồ. Ma trận trạng
 * thái của `SPEC-PGM04-VISUAL-001` §3 phải kiểm được mà không dựng cây
 * component, vì bảy nhánh trạng thái dựng bằng render test là bảy nhánh không
 * ai chạy đủ.
 */

/**
 * Tám trạng thái của §3 (`review-required` và `target-chooser` không nằm đây:
 * chúng thuộc về MỘT khối và đã có `insertBlockReason` trong
 * `libraryPresentation.ts` — nhân đôi chúng sẽ tạo ra hai luật cho một câu hỏi).
 *
 * `detail-error` là trạng thái của MÀN HÌNH chứ không phải của danh sách: nó chỉ
 * xuất hiện khi danh sách vẫn dùng được. Xem `libraryListUsable`.
 */
export type LibraryViewStatus =
  | 'loading'
  | 'ready'
  | 'empty-filter'
  | 'empty-project'
  | 'error'
  | 'offline'
  | 'no-permission'
  | 'detail-error'

/** Dùng cho test bao phủ: thêm một trạng thái mà quên nhánh xử lý sẽ lộ ra ở đây. */
export const LIBRARY_VIEW_STATUSES: readonly LibraryViewStatus[] = [
  'loading',
  'ready',
  'empty-filter',
  'empty-project',
  'error',
  'offline',
  'no-permission',
  'detail-error',
]

/**
 * Phân loại nguyên nhân đọc hỏng theo authority HTTP/transport.
 *
 * Cố ý trùng tên với `ProgrammingMonitorFailure` bên `api/queries.ts`: chỗ đó đã
 * có `classifyProgrammingMonitorFailure` đọc `status` của `ProgrammingApiError`,
 * nên tệp này KHÔNG viết lại phép phân loại và tuyệt đối không đoán "offline"
 * bằng cách dò chuỗi message — message đã qua i18n, và một bản dịch mới sẽ âm
 * thầm biến mọi lỗi thành lỗi chung.
 *
 * Vắng `failure` ⇒ coi là `'error'`. Đoán rộng hơn thế là tự cấp cho mình một
 * chẩn đoán mình không có bằng chứng.
 */
export type LibraryReadFailure = 'permission' | 'offline' | 'error'

/**
 * Lần đọc danh sách, đúng hình dạng `useProgrammingLibraryPaged` đang trả
 * (`status`/`items`/`error`/`hasMore`/`loadingMore`/`loadMoreError`), nên nối
 * vào giao diện là một dòng.
 *
 * `items === null` nghĩa là "chưa từng đọc xong lần nào". `items === []` nghĩa
 * là "đọc xong và không có gì" — hai câu khác nhau, và toàn bộ luật `error` ≠
 * `empty` nằm ở chỗ phân biệt được chúng.
 *
 * Cảnh báo cho chỗ gọi: `items` phải là kết quả của BỘ LỌC HIỆN TẠI. Hook nào
 * giữ lại items của bộ lọc cũ trong lúc đọc lại thì mô-đun này không phát hiện
 * được — đó là lý do `retained` (bên dưới) mang theo khoá bộ lọc.
 */
export interface LibraryReadInput {
  status: 'loading' | 'ready' | 'error'
  items: ProgrammingLibraryEntry[] | null
  error?: string | null
  failure?: LibraryReadFailure | null
  hasMore?: boolean
  loadingMore?: boolean
  /** Lỗi của RIÊNG trang vừa xin thêm. Không bao giờ là lỗi của cả danh sách. */
  loadMoreError?: string | null
  lastSuccessAt?: number | null
}

/**
 * Bộ lọc đang áp. Chỉ những thứ NGƯỜI DÙNG XOÁ ĐƯỢC mới được kể ở đây —
 * `projectId` là ngữ cảnh, không phải bộ lọc, nên không nằm trong này: nếu tính
 * nó là bộ lọc thì mọi màn rỗng đều thành `empty-filter` và nút "Xoá bộ lọc"
 * sẽ không xoá được gì.
 */
export interface LibraryFilterInput {
  scope?: string
  kind?: string
  category?: string
  query?: string
}

/** Trạng thái của Inspector. `idle` = chưa chọn khối nào. */
export interface LibraryDetailInput {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string | null
  /** Khoá khối đang mở (`LibraryEntryGroup.key`), để bề mặt gắn đúng chỗ lỗi. */
  key?: string | null
}

/**
 * Ảnh chụp lần đọc thành công gần nhất, do chỗ gọi giữ giữa các lần render.
 *
 * Tồn tại vì hook phân trang XOÁ `items` khi trang đầu hỏng
 * (`useProgrammingLibraryPaged`: nhánh lỗi đặt `items: []`). Không có ảnh chụp
 * này thì một lần refresh hỏng sẽ xoá trắng một danh sách đang đọc dở — đúng
 * điều §3 cấm ở ô `error`/`offline`.
 *
 * `key` là khoá bộ lọc mà ảnh chụp thuộc về. Trả lời câu hỏi của bộ lọc B bằng
 * các dòng đọc dưới bộ lọc A là nói dối, nên ảnh chụp lệch khoá bị bỏ chứ không
 * bị vẽ ra.
 */
export interface LibraryViewMemory {
  key: string
  items: ProgrammingLibraryEntry[]
  hasMore: boolean
  /** Unix ms của lần đọc thành công đã tạo ra ảnh chụp, nếu chỗ gọi biết. */
  at: number | null
}

export interface LibraryViewInput {
  list: LibraryReadInput
  filters?: LibraryFilterInput
  retained?: LibraryViewMemory | null
  detail?: LibraryDetailInput
  /** `roleCan(session?.role, 'program.edit')` — quyền GHI, không phải quyền đọc. */
  canEdit?: boolean
  hasProject?: boolean
  /** `navigator.onLine`. Mặc định `true`: không có tin gì thì coi là còn mạng. */
  online?: boolean
}

/** Hành động chính mà trạng thái hiện tại mời người dùng làm. Đúng MỘT. */
export type LibraryViewAction = 'none' | 'retry' | 'clear-filter' | 'create-block'

export type LibraryWriteBlock = 'NEEDS_PERMISSION' | 'NO_PROJECT' | 'OFFLINE'

/**
 * Đường ghi (nút "Khối PROJECT mới").
 *
 * `visible` là hằng `true` ở mức KIỂU, không phải một giá trị tính ra. §3 cấm
 * ẩn nút ghi khi thiếu quyền: ẩn đi làm người dùng tưởng thiết bị không có khả
 * năng đó rồi đi hỏi sai người. Khai bằng kiểu để không ai vô tình gán `false`.
 */
export interface LibraryWriteAffordance {
  visible: true
  enabled: boolean
  /** Lý do bị khoá, thành lời cho `aria-describedby`. `null` khi không bị khoá. */
  reason: LibraryWriteBlock | null
}

export type LibraryDetailView =
  | { kind: 'none' }
  | { kind: 'loading'; key: string | null }
  | { kind: 'ready'; key: string | null }
  | { kind: 'error'; key: string | null; message: string | null }

/** Phân trang. Lỗi ở đây KHÔNG BAO GIỜ là trạng thái của cả màn hình. */
export type LibraryMoreView =
  | { kind: 'complete' }
  | { kind: 'available' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string | null }

export interface LibraryViewState {
  status: LibraryViewStatus
  /**
   * Khối để vẽ, đã gom theo entry (`groupLibraryEntries` — một entry nhiều
   * version chỉ là MỘT thẻ). LUÔN là mảng, và ở `error`/`offline`/`detail-error`
   * vẫn giữ nguyên phần đã tải được.
   */
  groups: LibraryEntryGroup[]
  /** `true` khi `groups` KHÔNG đến từ lần đọc thành công hiện tại. */
  stale: boolean
  /** Đang đọc lại trên nền dữ liệu đang hiện — skeleton không được thay danh sách. */
  refreshing: boolean
  /** Message lỗi của lần đọc danh sách, đã i18n bởi chỗ gọi. */
  message: string | null
  retryable: boolean
  action: LibraryViewAction
  write: LibraryWriteAffordance
  detail: LibraryDetailView
  more: LibraryMoreView
  lastSuccessAt: number | null
}

/**
 * Khoá bộ lọc — hai bộ lọc khác nhau là hai câu hỏi khác nhau.
 *
 * Phân tách bằng `NUL` vì ký tự đó không gõ được vào ô tìm kiếm; nối bằng dấu
 * cách sẽ làm `scope="A B"` đụng `scope="A", kind="B"` — hai câu hỏi khác nhau
 * mà dùng chung một ảnh chụp.
 */
export function libraryFiltersKey(filters: LibraryFilterInput | undefined): string {
  const value = filters ?? {}
  return [
    value.scope ?? '',
    value.kind ?? '',
    value.category ?? '',
    (value.query ?? '').trim(),
  ].join('\u0000')
}

/**
 * Có bộ lọc nào đang áp không — cái quyết định `empty-filter` hay `empty-project`.
 *
 * Chuỗi chỉ toàn khoảng trắng KHÔNG tính là bộ lọc: nó không được gửi lên server
 * (`LibraryPage` trim trước khi đặt `query`), nên tính nó là bộ lọc sẽ đề nghị
 * người dùng "xoá bộ lọc" trong khi chẳng có bộ lọc nào ảnh hưởng tới kết quả.
 */
export function hasActiveLibraryFilter(filters: LibraryFilterInput | undefined): boolean {
  return libraryFiltersKey(filters) !== libraryFiltersKey(undefined)
}

/**
 * Reducer giữ ảnh chụp: nhận ảnh chụp cũ + lần đọc mới, trả ảnh chụp mới.
 *
 * Ba luật, theo thứ tự:
 *
 * 1. Đọc thành công ⇒ thay ảnh chụp (kể cả khi kết quả rỗng — "0 kết quả" là
 *    một sự thật, không phải một khoảng trống).
 * 2. Bị từ chối vì QUYỀN ⇒ **xoá** ảnh chụp. Đây là ngoại lệ duy nhất của luật
 *    "không xoá trắng màn hình": mọi lỗi khác chỉ nói "chưa đọc lại được", còn
 *    403 nói "phần này có thể không còn là của bạn để xem". Giữ lại nội dung cũ
 *    sau một phán quyết RBAC là tự mở một lỗ rò.
 * 3. Đổi bộ lọc ⇒ xoá ảnh chụp, vì nó trả lời câu hỏi cũ.
 *
 * Ngoài ba luật đó thì GIỮ. Mất mạng, 500, timeout — nội dung trên màn hình vẫn
 * là nội dung đã đọc được thật.
 */
export function rememberLibraryRead(
  memory: LibraryViewMemory | null,
  list: LibraryReadInput,
  filtersKey: string,
): LibraryViewMemory | null {
  if (list.status === 'ready') {
    return {
      key: filtersKey,
      items: [...(list.items ?? [])],
      hasMore: list.hasMore ?? false,
      at: list.lastSuccessAt ?? null,
    }
  }
  if (list.status === 'error' && (list.failure ?? 'error') === 'permission') return null
  if (memory && memory.key !== filtersKey) return null
  return memory
}

/**
 * Danh sách còn dùng được không — tức người dùng còn chọn được một khối để đọc.
 *
 * Là một luật DẪN XUẤT, không phải một cờ lưu riêng: chừng nào còn hàng thì còn
 * dùng được, bất kể màn hình đang mang nhãn `error`, `offline` hay
 * `detail-error`. Viết thành hàm để test bám vào bất biến ("lỗi chi tiết không
 * làm hỏng danh sách") thay vì bám vào cách cài đặt.
 */
export function libraryListUsable(state: Pick<LibraryViewState, 'groups'>): boolean {
  return state.groups.length > 0
}

function detailView(input: LibraryDetailInput | undefined): LibraryDetailView {
  if (!input || input.status === 'idle') return { kind: 'none' }
  const key = input.key ?? null
  if (input.status === 'loading') return { kind: 'loading', key }
  if (input.status === 'error') return { kind: 'error', key, message: input.error ?? null }
  return { kind: 'ready', key }
}

function writeAffordance(
  canEdit: boolean,
  hasProject: boolean,
  online: boolean,
): LibraryWriteAffordance {
  /* Thứ tự lý do là một phần hợp đồng, và nó đi từ BỀN tới TẠM. Nói "mất mạng"
     với người vốn không có quyền ghi là chỉ họ đi sửa sai thứ: mạng về, nút vẫn
     khoá, và họ mất thêm một vòng nữa mới biết lý do thật. */
  if (!canEdit) return { visible: true, enabled: false, reason: 'NEEDS_PERMISSION' }
  if (!hasProject) return { visible: true, enabled: false, reason: 'NO_PROJECT' }
  /* Mất mạng thì khoá luôn đường ghi thay vì để người dùng điền xong cả form mới
     biết không gửi được. §3 chỉ cấm ẩn nút, không cấm khoá nút — và nút khoá vẫn
     hội tụ được, vẫn mang lý do. */
  if (!online) return { visible: true, enabled: false, reason: 'OFFLINE' }
  return { visible: true, enabled: true, reason: null }
}

function moreView(list: LibraryReadInput, hasMore: boolean, hasContent: boolean): LibraryMoreView {
  /* Lỗi trang kế được báo TRƯỚC cả "còn trang nữa": nút phải đổi thành "thử
     lại" chứ không im lặng mời bấm tiếp một thao tác vừa hỏng. Nhưng nó dừng
     lại trong `more` — `status` của màn hình không đổi, vì danh sách đã tải vẫn
     đọc được và cuộn được. */
  if (list.loadMoreError) return { kind: 'error', message: list.loadMoreError }
  if (list.loadingMore) return { kind: 'loading' }
  if (!hasContent) return { kind: 'complete' }
  return hasMore ? { kind: 'available' } : { kind: 'complete' }
}

/**
 * Dựng trạng thái màn hình từ đầu vào thô. Hàm thuần, không nhớ gì giữa hai lần
 * gọi (phần cần nhớ nằm ở `rememberLibraryRead`).
 *
 * Thứ tự quyết định là toàn bộ nội dung của lát này, nên viết thẳng ra đây:
 *
 * 1. `no-permission` — phán quyết dứt khoát của server, đứng trên cả tín hiệu
 *    `navigator.onLine` (vốn chỉ là phỏng đoán của trình duyệt).
 * 2. `offline` — mất mạng, dù biết qua trình duyệt hay qua lỗi transport.
 * 3. `error` — mọi lỗi đọc còn lại.
 * 4. `loading` — CHỈ khi chưa có gì để vẽ. Còn nội dung mà vẫn dựng skeleton là
 *    tự xoá một danh sách đang đọc dở mỗi lần refresh.
 * 5. `ready` / `empty-filter` / `empty-project` — và ba nhánh này chỉ với tới
 *    được sau một lần đọc THÀNH CÔNG. Đó chính là chỗ luật "`error` không bao
 *    giờ suy thành `empty`" được ép: danh sách rỗng vì lỗi không đi qua đây.
 * 6. `detail-error` nâng cấp từ `ready` — và CHỈ từ `ready`. Danh sách hỏng là
 *    tin lớn hơn Inspector hỏng; đè nhãn `detail-error` lên một danh sách đang
 *    lỗi sẽ giấu mất tin lớn hơn. Lỗi chi tiết vẫn nằm trong `state.detail` ở
 *    mọi trạng thái, không mất đi đâu.
 */
export function libraryViewState(input: LibraryViewInput): LibraryViewState {
  const list = input.list
  const filtersKey = libraryFiltersKey(input.filters)
  const retained = input.retained && input.retained.key === filtersKey ? input.retained : null
  const online = input.online ?? true
  const failure: LibraryReadFailure | null =
    list.status === 'error' ? list.failure ?? 'error' : null

  /* `fresh` chỉ tồn tại sau một lần đọc THÀNH CÔNG, kể cả khi rỗng — đó là bằng
     chứng cho "thư viện không có khối nào". `carried` là thứ chỗ gọi còn cầm
     (hook giữ items qua lỗi), `retained` là đường lùi cho hook xoá items khi
     lỗi. Không có cái nào thì màn hình không có nội dung, và nó phải nói ra
     chứ không được vẽ một danh sách rỗng. */
  const fresh = list.status === 'ready' ? list.items ?? [] : null
  const carried = list.items && list.items.length > 0 ? list.items : null
  const held = fresh ?? carried ?? retained?.items ?? null
  const hasContent = held !== null && held.length > 0
  const fromMemory = held !== null && held === retained?.items
  const hasMore = fromMemory ? retained?.hasMore ?? false : list.hasMore ?? false

  let status: LibraryViewStatus
  if (failure === 'permission') status = 'no-permission'
  else if (!online || failure === 'offline') status = 'offline'
  else if (failure !== null) status = 'error'
  else if (fresh === null && !hasContent) status = 'loading'
  else if (fresh === null) status = 'ready'
  else if (fresh.length === 0) status = hasActiveLibraryFilter(input.filters) ? 'empty-filter' : 'empty-project'
  else status = 'ready'

  /* Ngoại lệ có chủ đích của luật "giữ nội dung": xem `rememberLibraryRead` §2.
     Một phán quyết RBAC không phải một sự cố tạm thời. */
  const visible = status === 'no-permission' ? [] : held ?? []
  const groups = groupLibraryEntries([...visible])

  const detail = detailView(input.detail)
  if (status === 'ready' && detail.kind === 'error') status = 'detail-error'

  const write = writeAffordance(input.canEdit ?? false, input.hasProject ?? false, online)

  let action: LibraryViewAction = 'none'
  if (status === 'error' || status === 'offline') action = 'retry'
  else if (status === 'empty-filter') action = 'clear-filter'
  /* §3: nút Tạo khối chỉ là hành động CHÍNH khi ghi được. Khi không ghi được,
     nút vẫn phải hiện (xem `write`) nhưng màn hình không được mời người dùng
     bấm vào một thứ sẽ từ chối họ. */
  else if (status === 'empty-project' && write.enabled) action = 'create-block'

  return {
    status,
    groups,
    stale: groups.length > 0 && fresh === null,
    refreshing: list.status === 'loading' && hasContent,
    message: list.error ?? null,
    /* `no-permission` không có nút Thử lại: RBAC không đổi vì bấm lại, và một
       nút luôn hỏng chỉ dạy người dùng bỏ qua các nút. */
    retryable: status === 'error' || status === 'offline',
    action,
    write,
    detail,
    more: moreView(list, hasMore, groups.length > 0),
    lastSuccessAt: fromMemory ? retained?.at ?? null : list.lastSuccessAt ?? retained?.at ?? null,
  }
}
