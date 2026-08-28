import { useCallback, useEffect, useState } from 'react'
import { pullPreferences, pushSavedViews, type PreferenceSyncState } from '../preferences'
import {
  readSavedViews,
  removeSavedView,
  renameSavedView,
  upsertSavedView,
  writeSavedViews,
  type SavedView
} from '../savedViews'

/**
 * Bọc `savedViews` thành state của React — `T57-2.3`, đồng bộ thiết bị `T57-3.2`.
 *
 * Đọc localStorage MỘT lần lúc dựng (lazy initializer): đọc lại ở mỗi render sẽ
 * trả về mảng mới mỗi lần và làm mọi `useMemo` phụ thuộc nó mất tác dụng.
 * Mọi thao tác ghi đều ghi cả state lẫn localStorage trong cùng một bước, nên
 * không có cửa sổ nào hai nguồn lệch nhau.
 *
 * Từ `T57-3.2`, bộ nhớ cục bộ là BỘ ĐỆM còn thiết bị là nguồn chân lý khi đọc
 * được. `syncState` nói ra chính điều đó để giao diện không khẳng định "đã lưu
 * theo tài khoản" trong lúc thực ra chỉ lưu được trên máy này.
 */
export interface SavedViewsApi {
  views: SavedView[]
  save: (name: string, params: Record<string, string>) => void
  rename: (from: string, to: string) => void
  remove: (name: string) => void
  /** `local-only` = thiết bị không đọc/ghi được tuỳ chọn; đang chạy trên bộ đệm. */
  syncState: PreferenceSyncState
}

export function useSavedViews(scope: string): SavedViewsApi {
  const [views, setViews] = useState<SavedView[]>(() => readSavedViews(scope))
  const [syncState, setSyncState] = useState<PreferenceSyncState>('idle')

  /* Kéo về một lần khi trang gắn vào cây. Không poll: tuỳ chọn chỉ đổi khi
     chính người dùng đổi nó, và một vòng poll cho dữ liệu tĩnh là chi phí
     thường trực trên một bo nhúng để đổi lấy không gì cả. */
  useEffect(() => {
    let active = true
    void pullPreferences().then((state) => {
      if (!active) return
      setSyncState(state)
      if (state === 'synced') setViews(readSavedViews(scope))
    })
    return () => { active = false }
  }, [scope])

  const commit = useCallback((next: SavedView[]) => {
    setViews(next)
    writeSavedViews(scope, next)
    /* Ghi cục bộ TRƯỚC rồi mới đẩy: đẩy hỏng thì thao tác của người dùng vẫn
       còn đó để thử lại, thay vì biến mất cùng lỗi mạng. */
    void pushSavedViews().then(setSyncState)
  }, [scope])

  const save = useCallback((name: string, params: Record<string, string>) => {
    commit(upsertSavedView(readSavedViews(scope), name, params))
  }, [commit, scope])

  const rename = useCallback((from: string, to: string) => {
    commit(renameSavedView(readSavedViews(scope), from, to))
  }, [commit, scope])

  const remove = useCallback((name: string) => {
    commit(removeSavedView(readSavedViews(scope), name))
  }, [commit, scope])

  return { views, save, rename, remove, syncState }
}
