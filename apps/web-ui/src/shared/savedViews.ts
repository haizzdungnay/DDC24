/**
 * Khung nhìn đặt tên — `T57-2.3` (phần lưu trữ của khối `BB-1`).
 *
 * VÌ SAO CẦN
 *
 * `T57-2.1` đã đưa bộ lọc vào URL, nên một khung nhìn *gửi được*. Thứ còn
 * thiếu là *đặt tên được*: bộ lọc mà một người dựng lại mỗi sáng — "các điểm
 * Modbus chất lượng xấu", "8 điểm của AHU-1" — vẫn phải bấm lại từng ô, hoặc
 * phải tự lưu bookmark ngoài ứng dụng. Với ca trực đổi người, thứ không đặt
 * tên được thì không bàn giao được.
 *
 * PHẠM VI THẬT — ĐỌC TRƯỚC KHI DÙNG
 *
 * Khung nhìn ở đây nằm trong `localStorage` của **trình duyệt này**, gắn theo
 * tên tài khoản đang đăng nhập. Nó KHÔNG đi theo người dùng sang máy khác:
 * việc đó cần `T57-3.2` (endpoint lưu tuỳ chọn người dùng trên thiết bị) và
 * `T57-3.2` thuộc Wave 3, chưa mở cổng. Giao diện phải nói ra giới hạn này chứ
 * không được để người dùng tự phát hiện lúc ngồi máy khác.
 *
 * Khoá lưu có tên tài khoản để hai người dùng chung một máy trạm không thấy
 * khung nhìn của nhau — không phải vì bảo mật (localStorage đọc được hết), mà
 * vì lẫn khung nhìn của người khác là một kiểu nhiễu khó hiểu.
 */

export interface SavedView {
  name: string
  /** Ảnh chụp bộ lọc. Ngữ nghĩa từng khoá do trang sở hữu, module này không suy diễn. */
  params: Record<string, string>
}

export const SAVED_VIEW_NAME_MAX = 40

let currentAccount: string | null = null

/** `AuthProvider` gọi khi phiên đổi. Dùng biến module thay vì hook để trang
 *  không có `AuthProvider` trong cây (ví dụ Trends trong test) vẫn dùng được. */
export function setSavedViewAccount(account: string | null): void {
  currentAccount = account && account.trim() ? account.trim() : null
}

export function savedViewsStorageKey(scope: string): string {
  return `mkddc:views:v1:${scope}:${currentAccount ?? 'local'}`
}

export function readSavedViews(scope: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(savedViewsStorageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const view = item as Partial<SavedView>
      if (typeof view.name !== 'string' || !view.name.trim()) return []
      const params = view.params
      if (typeof params !== 'object' || params === null) return []
      const clean: Record<string, string> = {}
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') clean[key] = value
      }
      return [{ name: view.name, params: clean }]
    })
  } catch {
    /* localStorage bị khoá (chế độ riêng tư) hoặc dữ liệu hỏng. Khung nhìn là
       tiện ích, không phải dữ liệu vận hành — hỏng thì mất tiện ích, không
       được phép làm hỏng trang. */
    return []
  }
}

export function writeSavedViews(scope: string, views: SavedView[]): void {
  try {
    window.localStorage.setItem(savedViewsStorageKey(scope), JSON.stringify(views))
  } catch {
    // Xem chú thích ở `readSavedViews`.
  }
}

/** Thêm mới hoặc GHI ĐÈ khung nhìn trùng tên. Trùng tên là ý định "cập nhật
 *  khung nhìn này", không phải tạo bản thứ hai cùng tên — hai mục cùng tên
 *  trong danh sách chọn là thứ không thao tác được. */
export function upsertSavedView(views: SavedView[], name: string, params: Record<string, string>): SavedView[] {
  const clean = normalizeName(name)
  if (!clean) return views
  const next = views.filter((view) => view.name !== clean)
  return [...next, { name: clean, params: { ...params } }].sort(byName)
}

export function renameSavedView(views: SavedView[], from: string, to: string): SavedView[] {
  const clean = normalizeName(to)
  if (!clean) return views
  const target = views.find((view) => view.name === from)
  if (!target) return views
  return [...views.filter((view) => view.name !== from && view.name !== clean), { ...target, name: clean }].sort(byName)
}

export function removeSavedView(views: SavedView[], name: string): SavedView[] {
  return views.filter((view) => view.name !== name)
}

export function findSavedView(views: SavedView[], name: string | null | undefined): SavedView | undefined {
  if (!name) return undefined
  return views.find((view) => view.name === name)
}

function normalizeName(name: string): string {
  return name.trim().slice(0, SAVED_VIEW_NAME_MAX)
}

function byName(left: SavedView, right: SavedView): number {
  return left.name.localeCompare(right.name, 'vi', { sensitivity: 'base' })
}
