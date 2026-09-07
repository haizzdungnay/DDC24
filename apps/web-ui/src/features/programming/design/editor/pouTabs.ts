import type { ProgrammingProgram } from '../../model/types'

/**
 * `T59-821` / `PGM02-V22-WP-15` — mô hình tab đa POU (`UD-PROG-014` phương án B).
 *
 * Ảnh ST hiện hai tab cùng lúc và ảnh FBD hiện một tab FBD cạnh một tab ST, tức
 * tab **bắc qua cả hai ngôn ngữ** trong cùng một workspace.
 *
 * Hai bất biến không được vi phạm (`UD-PROG-003`, DDD §3.5):
 *
 * 1. **`objectId` là trục định danh**, không phải tên POU. Đổi tên một POU
 *    không được tạo ra một tab thứ hai cho cùng một thứ, và hai POU trùng tên
 *    phải là hai tab riêng.
 * 2. **Hai tab không bao giờ chia chung một buffer soạn thảo.** Buffer sống
 *    theo `objectId` ở `ProgramsTab`; tab chỉ chọn xem cái nào đang hiện.
 *
 * `UD-PROG-014` để ngỏ năm điều và bắt team chốt khi implement. Chốt ở đây, có
 * test cho từng điều, để không thành mỗi người một kiểu:
 *
 * | # | Điều để ngỏ | Chốt |
 * |---|---|---|
 * | 1 | Số tab tối đa và hành vi khi vượt | **8** (`TC-FBD-UX-002`); vượt thì đóng tab **sạch** ít dùng nhất. Không còn tab sạch nào ⇒ **TỪ CHỐI mở** kèm lý do đọc được |
 * | 2 | Đóng tab có Draft bẩn | Phải xác nhận; `closePouTab` trả `needsConfirm` chứ không tự đóng |
 * | 3 | Đổi mode | Áp cho **toàn workspace** — mode không nằm trong state này |
 * | 4 | Tab sống qua reload | **Không**. Xem lý do ở `POU_TAB_LIMIT` bên dưới |
 * | 5 | Tab trỏ tới POU đã bị xoá ở phiên khác | Tab **ở lại** và tự khai là không còn tồn tại; cấm tự đóng im lặng |
 *
 * Điều 1 chọn đóng tab sạch thay vì từ chối ngay: người dùng mở POU thứ chín
 * gần như luôn chỉ đang đọc lướt, và bắt họ tự dọn tab là bắt làm việc thủ công
 * cho một giới hạn do ta đặt ra. Nhưng đóng một tab **bẩn** để lấy chỗ thì
 * không bao giờ được — đó là vứt công việc của người ta để phục vụ một con số.
 */

/**
 * Trần số tab mở cùng lúc.
 *
 * Task 8 chốt 8 tab cho cả ST và FBD. Luật đuổi tab chỉ chọn tab SẠCH, ít dùng
 * nhất; mọi tab bẩn đều được giữ và việc mở tab thứ chín bị từ chối nếu cả tám
 * tab đang có thay đổi chưa lưu.
 */
export const POU_TAB_LIMIT = 8

/**
 * Điều 4 — tab KHÔNG sống qua reload, và đây là lựa chọn có chủ ý.
 *
 * Khôi phục tab đòi một nơi lưu, và mọi nơi lưu đều sinh ra cùng một lớp lỗi:
 * tab được khôi phục trỏ tới một POU đã bị xoá hoặc đổi tên ở phiên khác, ở
 * đúng thời điểm người dùng chưa nhìn màn hình. Sau tải lại, workspace mở đúng
 * POU mà ĐỊA CHỈ nói tới — một trạng thái luôn đúng vì nó đọc từ nguồn thật.
 */
export const POU_TABS_SURVIVE_RELOAD = false

export interface PouTab {
  /** `objectId` của POU. KHÔNG BAO GIỜ là tên. */
  key: string
  /**
   * Tên tại thời điểm mở gần nhất. Chỉ dùng để hiển thị khi POU đã biến mất —
   * lúc đó không còn nguồn nào khác để gọi tên thứ người dùng đang mở.
   */
  lastKnownName: string
  language: 'ST' | 'FBD'
}

export interface PouTabsState {
  tabs: readonly PouTab[]
  /** `null` khi chưa mở tab nào. */
  activeKey: string | null
  /**
   * Thứ tự dùng gần đây nhất trước, dùng để chọn tab đem đóng khi chạm trần.
   * Tách khỏi `tabs` vì thứ tự HIỂN THỊ phải ổn định: sắp lại tab mỗi lần bấm
   * làm người dùng mất chỗ và bấm nhầm.
   */
  recentKeys: readonly string[]
}

/** Trục định danh của một POU. `objectId` khi có; tài liệu v1 không có thì `programId`. */
export function pouTabKey(program: Pick<ProgrammingProgram, 'programId' | 'objectId'>): string {
  return program.objectId ?? program.programId
}

export function emptyPouTabs(): PouTabsState {
  return { tabs: [], activeKey: null, recentKeys: [] }
}

export type OpenPouTabResult =
  | { ok: true; state: PouTabsState; evictedKey: string | null }
  /** Chạm trần và mọi tab đều bẩn. Không đóng bừa một tab của người ta. */
  | { ok: false; reason: 'LIMIT_ALL_DIRTY' }

/**
 * Mở (hoặc kích hoạt lại) tab của một POU.
 *
 * `dirtyKeys` là tập tab có thay đổi chưa lưu — người gọi biết điều đó, mô hình
 * này thì không, và đoán thay họ là cách một buffer bẩn bị đóng mất.
 */
export function openPouTab(
  state: PouTabsState,
  program: Pick<ProgrammingProgram, 'programId' | 'objectId' | 'name' | 'language'>,
  dirtyKeys: ReadonlySet<string> = new Set(),
): OpenPouTabResult {
  const key = pouTabKey(program)
  const existing = state.tabs.find((tab) => tab.key === key)
  if (existing) {
    // Đổi tên ở phiên này thì cập nhật nhãn, KHÔNG tạo tab thứ hai: định danh
    // là `objectId`, và tên chỉ là thứ vẽ lên tab.
    const tabs = state.tabs.map((tab) => (
      tab.key === key ? { ...tab, lastKnownName: program.name, language: program.language } : tab
    ))
    return { ok: true, state: { tabs, activeKey: key, recentKeys: touch(state.recentKeys, key) }, evictedKey: null }
  }

  let tabs = state.tabs
  let evictedKey: string | null = null
  if (tabs.length >= POU_TAB_LIMIT) {
    const victim = leastRecentlyUsedClean(state, dirtyKeys)
    if (victim === null) return { ok: false, reason: 'LIMIT_ALL_DIRTY' }
    evictedKey = victim
    tabs = tabs.filter((tab) => tab.key !== victim)
  }

  const opened: PouTab = { key, lastKnownName: program.name, language: program.language }
  return {
    ok: true,
    state: {
      tabs: [...tabs, opened],
      activeKey: key,
      recentKeys: touch(state.recentKeys.filter((candidate) => candidate !== evictedKey), key),
    },
    evictedKey,
  }
}

export type ClosePouTabResult =
  | { ok: true; state: PouTabsState }
  /** Tab có thay đổi chưa lưu — người gọi phải hỏi trước, cấm mất buffer im lặng. */
  | { ok: false; reason: 'NEEDS_CONFIRM' }

export function closePouTab(
  state: PouTabsState,
  key: string,
  options: { dirty?: boolean; confirmed?: boolean } = {},
): ClosePouTabResult {
  if (options.dirty && !options.confirmed) return { ok: false, reason: 'NEEDS_CONFIRM' }
  const tabs = state.tabs.filter((tab) => tab.key !== key)
  if (tabs.length === state.tabs.length) return { ok: true, state }
  const recentKeys = state.recentKeys.filter((candidate) => candidate !== key)
  const activeKey = state.activeKey === key
    // Về tab dùng gần đây nhất còn lại, không phải tab bên cạnh: người dùng vừa
    // ở đó, nên đó là chỗ họ mong quay lại.
    ? recentKeys.find((candidate) => tabs.some((tab) => tab.key === candidate)) ?? tabs[tabs.length - 1]?.key ?? null
    : state.activeKey
  return { ok: true, state: { tabs, activeKey, recentKeys } }
}

export function activatePouTab(state: PouTabsState, key: string): PouTabsState {
  if (!state.tabs.some((tab) => tab.key === key)) return state
  return { ...state, activeKey: key, recentKeys: touch(state.recentKeys, key) }
}

/**
 * Điều 5 — tab trỏ tới POU không còn trong tài liệu.
 *
 * Trả `true` để giao diện đánh dấu tab đó là không còn tồn tại. Tuyệt đối không
 * tự đóng: một tab tự biến mất che đi chính sự kiện người dùng cần biết — có ai
 * đó vừa xoá POU họ đang mở.
 */
export function isPouTabMissing(tab: PouTab, programs: readonly ProgrammingProgram[]): boolean {
  return !programs.some((program) => pouTabKey(program) === tab.key)
}

function touch(recentKeys: readonly string[], key: string): readonly string[] {
  return [key, ...recentKeys.filter((candidate) => candidate !== key)]
}

function leastRecentlyUsedClean(state: PouTabsState, dirtyKeys: ReadonlySet<string>): string | null {
  for (let index = state.recentKeys.length - 1; index >= 0; index -= 1) {
    const key = state.recentKeys[index]
    if (!dirtyKeys.has(key) && state.tabs.some((tab) => tab.key === key)) return key
  }
  // Tab chưa từng được kích hoạt không nằm trong `recentKeys`; chúng vẫn là ứng
  // viên hợp lệ nếu sạch.
  const untouched = state.tabs.find((tab) => !dirtyKeys.has(tab.key) && !state.recentKeys.includes(tab.key))
  return untouched?.key ?? null
}
