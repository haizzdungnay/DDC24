import { apiClient } from './api/client'
import { readSavedViews, writeSavedViews, type SavedView } from './savedViews'

/**
 * Đồng bộ tuỳ chọn người dùng với thiết bị — `T57-3.2` (`ADR-043`).
 *
 * VÌ SAO VẪN GIỮ `localStorage`
 *
 * `T57-2.3` lưu khung nhìn trong trình duyệt, và giới hạn đó là thật: đổi máy
 * trạm là mất. Nay thiết bị có chỗ lưu, nhưng **không** vì thế mà bỏ bộ đệm cục
 * bộ — bo có thể không đọc được tệp tuỳ chọn, mạng có thể đứt giữa ca, và một
 * bộ lọc biến mất vì lý do hạ tầng là kiểu hỏng người dùng không truy được.
 *
 * LUẬT HOÀ GIẢI: **thiết bị là nguồn chân lý khi đọc được**.
 *
 *  1. Mở phiên ⇒ kéo tuỳ chọn từ thiết bị về, ghi đè bộ đệm cục bộ. Người dùng
 *     vừa đăng nhập mong thấy khung nhìn của *tài khoản mình*, không phải của
 *     người ngồi máy này trước đó.
 *  2. Không đọc được ⇒ giữ nguyên bộ đệm và **nói ra** (nơi gọi quyết định cách
 *     nói). Im lặng dùng bản cũ là để người dùng tin nhầm rằng mình đang sửa
 *     bản trên thiết bị.
 *  3. Mọi lần ghi đều ghi cục bộ TRƯỚC rồi mới đẩy lên. Đẩy hỏng thì thao tác
 *     của người dùng vẫn còn đó để thử lại.
 */

/** Hình dạng túi tuỳ chọn. Backend không hiểu nội dung (`ADR-043`), nên hợp
 *  đồng này thuộc về FE và chỉ FE. */
export interface UserPreferences {
  /** Khung nhìn đặt tên, theo phạm vi (`monitor`, `trends`). */
  views?: Record<string, SavedView[]>
}

export type PreferenceSyncState = 'idle' | 'synced' | 'local-only'

const VIEW_SCOPES = ['monitor', 'trends'] as const

/**
 * Kéo tuỳ chọn từ thiết bị về bộ đệm cục bộ.
 *
 * Trả `'local-only'` khi thiết bị không trả lời — nơi gọi phải hiện điều đó chứ
 * không được coi như đã đồng bộ.
 */
export async function pullPreferences(): Promise<PreferenceSyncState> {
  try {
    const remote = await apiClient.getMyPreferences() as UserPreferences
    const views = remote?.views
    if (views && typeof views === 'object') {
      for (const scope of VIEW_SCOPES) {
        const list = views[scope]
        if (Array.isArray(list)) writeSavedViews(scope, sanitizeViews(list))
      }
    }
    return 'synced'
  } catch {
    return 'local-only'
  }
}

/** Đẩy toàn bộ khung nhìn hiện có lên thiết bị. Gọi sau mỗi lần người dùng đổi. */
export async function pushSavedViews(): Promise<PreferenceSyncState> {
  const views: Record<string, SavedView[]> = {}
  for (const scope of VIEW_SCOPES) views[scope] = readSavedViews(scope)
  try {
    await apiClient.putMyPreferences({ views })
    return 'synced'
  } catch {
    return 'local-only'
  }
}

/** Loại mục méo mó đến từ thiết bị — cùng luật với `readSavedViews`: một mục
 *  hỏng không được phép làm hỏng cả danh sách. */
function sanitizeViews(list: unknown[]): SavedView[] {
  return list.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const view = item as Partial<SavedView>
    if (typeof view.name !== 'string' || !view.name.trim()) return []
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(view.params ?? {})) {
      if (typeof value === 'string') params[key] = value
    }
    return [{ name: view.name, params }]
  })
}
