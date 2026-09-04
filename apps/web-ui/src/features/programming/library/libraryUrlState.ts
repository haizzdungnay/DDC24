import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'

/**
 * `T61-302` — TAB phạm vi và bộ lọc của PGM-04, tách khỏi React.
 *
 * Tệp này thuần: nhận `URLSearchParams`, trả `URLSearchParams`. Lý do không
 * phải gọn gàng — mọi luật ở đây đều là luật "không nói dối", và kiểm chúng
 * phải làm được mà không dựng cây component, không router, không jsdom.
 *
 * BA LUẬT, theo thứ tự quan trọng:
 *
 * 1. **Chỉ có hai tab.** `SYSTEM` và `PROJECT`. Không có `USER`: sản phẩm không
 *    có phạm vi ấy ở API lẫn ở Product authority, và một tab rỗng vẽ ra một
 *    khả năng không tồn tại. Giá trị lạ trong URL — kể cả đúng chữ `USER` —
 *    rơi về mặc định chứ không tạo tab thứ ba.
 * 2. **Tab KHÔNG phải bộ lọc.** Nó là điều hướng: "Xoá bộ lọc" không được đổi
 *    tab, và một tab đang chọn không được làm trạng thái rỗng đọc thành
 *    "không khớp bộ lọc". Hai thứ ấy dẫn tới hai hành động khác nhau — xoá bộ
 *    lọc, hay tạo khối đầu tiên.
 * 3. **URL chuẩn tắc bỏ giá trị mặc định.** `?scope=SYSTEM` khi SYSTEM đang là
 *    mặc định là một tham số không mang tin; giữ nó lại thì hai đường dẫn khác
 *    nhau mô tả cùng một màn hình, và người dùng không biết cái nào để gửi đi.
 */

export const LIBRARY_SCOPE_TABS = ['SYSTEM', 'PROJECT'] as const
export type LibraryScopeTab = (typeof LIBRARY_SCOPE_TABS)[number]

export const LIBRARY_KINDS = ['FUNCTION', 'FUNCTION_BLOCK', 'CONVERSION'] as const
export type LibraryKindFilter = (typeof LIBRARY_KINDS)[number] | ''

/** Các tham số bộ lọc — CỐ Ý không gồm `scope`. Xem luật 2. */
export const LIBRARY_FILTER_PARAMS = ['kind', 'category', 'q'] as const

export interface LibraryUrlState {
  scope: LibraryScopeTab
  kind: LibraryKindFilter
  category: string
  query: string
}

export interface LibraryUrlContext {
  /** Có `projectId` phân giải được không. Quyết định tab mặc định. */
  hasProject: boolean
}

/**
 * Tab mặc định khi URL không nói gì.
 *
 * Có Project ⇒ `PROJECT`: đây là Thư viện CỦA một Project, và mọi đường ghi
 * (tạo, sửa, ngừng dùng) chỉ áp cho khối PROJECT. Mở ra thấy khối hệ thống
 * trước là đặt thứ người dùng không sửa được lên trước thứ họ tới để sửa.
 *
 * Không có Project ⇒ `SYSTEM`: đó là phạm vi DUY NHẤT đo được khi thiếu
 * `projectId`, nên mặc định vào nó thì màn hình không bao giờ mở ra ở một trạng
 * thái chặn.
 */
export function defaultLibraryScope(context: LibraryUrlContext): LibraryScopeTab {
  return context.hasProject ? 'PROJECT' : 'SYSTEM'
}

function readScope(raw: string | null, context: LibraryUrlContext): LibraryScopeTab {
  return (LIBRARY_SCOPE_TABS as readonly string[]).includes(raw ?? '')
    ? (raw as LibraryScopeTab)
    : defaultLibraryScope(context)
}

function readKind(raw: string | null): LibraryKindFilter {
  return (LIBRARY_KINDS as readonly string[]).includes(raw ?? '') ? (raw as LibraryKindFilter) : ''
}

/**
 * Phân loại lạ bị BỎ, không được truyền tiếp.
 *
 * Registry là nơi `category` được định nghĩa. Một giá trị ngoài registry đi
 * thẳng lên server sẽ trả về 0 kết quả, và màn hình nói "không khớp bộ lọc" cho
 * một bộ lọc không tồn tại — người dùng đi tìm lỗi ở dữ liệu của họ.
 */
function readCategory(raw: string | null): string {
  if (!raw) return ''
  return PROGRAMMING_LIBRARY_CATEGORY_ORDER.some((item) => item.id === raw) ? raw : ''
}

export function readLibraryUrlState(
  params: URLSearchParams,
  context: LibraryUrlContext,
): LibraryUrlState {
  return {
    scope: readScope(params.get('scope'), context),
    kind: readKind(params.get('kind')),
    category: readCategory(params.get('category')),
    /* Chuỗi chỉ toàn khoảng trắng KHÔNG phải một truy vấn: nó không đổi kết quả
       nhưng lại làm màn hình rỗng đọc thành "không khớp bộ lọc". */
    query: (params.get('q') ?? '').trim(),
  }
}

/**
 * Ghi một mảnh trạng thái vào URL, giữ nguyên mọi tham số khác (`entry`,
 * `panel`, `returnTo` là của mô-đun khác — mô-đun này không được xoá chúng).
 */
export function writeLibraryUrlState(
  current: URLSearchParams,
  patch: Partial<LibraryUrlState>,
  context: LibraryUrlContext,
): URLSearchParams {
  const next = new URLSearchParams(current)
  if (patch.scope !== undefined) {
    // Mặc định thì BỎ tham số — xem luật 3.
    if (patch.scope === defaultLibraryScope(context)) next.delete('scope')
    else next.set('scope', patch.scope)
  }
  if (patch.kind !== undefined) {
    if (patch.kind === '') next.delete('kind')
    else next.set('kind', patch.kind)
  }
  if (patch.category !== undefined) {
    if (patch.category === '') next.delete('category')
    else next.set('category', patch.category)
  }
  if (patch.query !== undefined) {
    if (patch.query.trim() === '') next.delete('q')
    else next.set('q', patch.query)
  }
  return next
}

/**
 * Xoá bộ lọc — và CHỈ bộ lọc.
 *
 * Tab được giữ nguyên (luật 2), nhưng vẫn được chuẩn hoá: một `?scope=PROJECT`
 * trùng mặc định bị bỏ đi, nên "Xoá bộ lọc" luôn đưa về đúng MỘT đường dẫn cho
 * mỗi tab. `entry`/`panel`/`returnTo` không bị đụng tới: xoá bộ lọc không phải
 * là đóng khối đang mở, và càng không phải là quên đường quay lại.
 */
export function clearLibraryFilters(
  current: URLSearchParams,
  context: LibraryUrlContext,
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of LIBRARY_FILTER_PARAMS) next.delete(key)
  const scope = readScope(next.get('scope'), context)
  if (scope === defaultLibraryScope(context)) next.delete('scope')
  else next.set('scope', scope)
  return next
}

/**
 * Số bộ lọc đang áp — con số trên nút "Bộ lọc" ở khổ hẹp.
 *
 * Tab KHÔNG được đếm. Nếu đếm, nút luôn hiện ít nhất `1` và con số thôi mang
 * tin: người dùng không còn phân biệt được "đang lọc gì đó" với "đang xem một
 * tab".
 */
export function activeLibraryFilterCount(state: LibraryUrlState): number {
  return (state.kind === '' ? 0 : 1) + (state.category === '' ? 0 : 1) + (state.query === '' ? 0 : 1)
}

/**
 * Phạm vi này ĐO ĐƯỢC chưa — hàng rào fail-closed trước khi phát request.
 *
 * `PROJECT` mà không có `projectId` bị store từ chối
 * (`store/library.go`: "PROJECT library search bắt buộc projectId"), và lỗi ấy
 * lên tới giao diện dưới dạng một sự cố máy chủ. Nhưng nó không phải sự cố: đó
 * là một yêu cầu thiếu ngữ cảnh mà FE biết trước là thiếu. Hỏi ở đây rồi KHÔNG
 * gửi là khác biệt giữa "màn hình nói bạn chưa chọn Project" và "màn hình nói
 * thiết bị hỏng".
 */
export function libraryScopeIsMeasurable(
  scope: LibraryScopeTab,
  context: LibraryUrlContext,
): boolean {
  return scope === 'SYSTEM' || context.hasProject
}
