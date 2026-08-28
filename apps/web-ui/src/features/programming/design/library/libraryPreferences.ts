import { apiClient } from '../../../../shared/api/client'

/**
 * `T59-804` — Recent/Favorites của Quick Library.
 *
 * Ba ràng buộc của plan được giữ đúng: **namespaced** (`programmingLibrary`
 * trong túi tuỳ chọn, không đụng `views` của Monitor/Trends), **bounded** (trần
 * cứng ở dưới), và **không giữ bản sao chữ ký** — chỉ lưu `entryId`. Chép chữ ký
 * vào tuỳ chọn nghĩa là một ngày nào đó Favorites sẽ mô tả một block khác với
 * catalog thật.
 *
 * Recent chỉ được cập nhật SAU khi chèn thành công; đó là lý do `recordRecent`
 * tách khỏi hàm chèn thay vì gọi kèm lúc bấm.
 */
export const LIBRARY_RECENT_LIMIT = 12
export const LIBRARY_FAVORITE_LIMIT = 24

export interface LibraryPreferences {
  favorites: string[]
  recent: string[]
}

const EMPTY: LibraryPreferences = { favorites: [], recent: [] }
const STORAGE_KEY = 'mkddc-programming-library'

function sanitize(value: unknown): LibraryPreferences {
  if (typeof value !== 'object' || value === null) return EMPTY
  const bag = value as Record<string, unknown>
  const ids = (raw: unknown, limit: number): string[] => {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    for (const item of raw) {
      if (typeof item !== 'string') continue
      const id = item.trim()
      if (id === '' || id.length > 64) continue
      seen.add(id)
      if (seen.size >= limit) break
    }
    return [...seen]
  }
  return {
    favorites: ids(bag.favorites, LIBRARY_FAVORITE_LIMIT),
    recent: ids(bag.recent, LIBRARY_RECENT_LIMIT)
  }
}

/** Bộ đệm cục bộ để mất mạng không làm mất lựa chọn của người dùng — cùng luật
 *  hoà giải với `shared/preferences.ts`: thiết bị là nguồn chân lý khi đọc được. */
export function readLocalLibraryPreferences(): LibraryPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitize(JSON.parse(raw)) : EMPTY
  } catch {
    return EMPTY
  }
}

export function writeLocalLibraryPreferences(value: LibraryPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(value)))
  } catch {
    /* Trình duyệt chặn storage: tuỳ chọn chỉ sống trong phiên này. */
  }
}

export function toggleFavorite(current: LibraryPreferences, entryId: string): LibraryPreferences {
  const favorites = current.favorites.includes(entryId)
    ? current.favorites.filter((id) => id !== entryId)
    : [entryId, ...current.favorites].slice(0, LIBRARY_FAVORITE_LIMIT)
  return { ...current, favorites }
}

/** Đưa mục vừa chèn lên đầu Recent, khử trùng lặp và cắt theo trần. */
export function recordRecent(current: LibraryPreferences, entryId: string): LibraryPreferences {
  const recent = [entryId, ...current.recent.filter((id) => id !== entryId)].slice(0, LIBRARY_RECENT_LIMIT)
  return { ...current, recent }
}

/**
 * Kéo tuỳ chọn thư viện từ thiết bị. Không đọc được thì giữ bộ đệm cục bộ và
 * trả `'local-only'` để nơi gọi nói ra, thay vì im lặng dùng bản cũ.
 */
export async function pullLibraryPreferences(): Promise<{ value: LibraryPreferences; state: 'synced' | 'local-only' }> {
  try {
    const remote = (await apiClient.getMyPreferences()) as Record<string, unknown>
    const value = sanitize(remote?.programmingLibrary)
    writeLocalLibraryPreferences(value)
    return { value, state: 'synced' }
  } catch {
    return { value: readLocalLibraryPreferences(), state: 'local-only' }
  }
}

/**
 * Ghi cục bộ TRƯỚC rồi mới đẩy lên, và đẩy bằng MERGE chứ không ghi đè cả túi:
 * `views` của Monitor/Trends nằm cùng chỗ, nên một lần `PUT` toàn bộ sẽ xoá
 * khung nhìn của người dùng vì họ vừa bấm một ngôi sao trong thư viện.
 */
export async function pushLibraryPreferences(value: LibraryPreferences): Promise<'synced' | 'local-only'> {
  const clean = sanitize(value)
  writeLocalLibraryPreferences(clean)
  try {
    let bag: Record<string, unknown> = {}
    try {
      bag = ((await apiClient.getMyPreferences()) as Record<string, unknown>) ?? {}
    } catch {
      bag = {}
    }
    await apiClient.putMyPreferences({ ...bag, programmingLibrary: clean })
    return 'synced'
  } catch {
    return 'local-only'
  }
}
