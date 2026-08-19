import { useCallback, useState } from 'react'
import {
  readSavedViews,
  removeSavedView,
  renameSavedView,
  upsertSavedView,
  writeSavedViews,
  type SavedView
} from '../savedViews'

/**
 * Bọc `savedViews` thành state của React — `T57-2.3`.
 *
 * Đọc localStorage MỘT lần lúc dựng (lazy initializer): đọc lại ở mỗi render sẽ
 * trả về mảng mới mỗi lần và làm mọi `useMemo` phụ thuộc nó mất tác dụng.
 * Mọi thao tác ghi đều ghi cả state lẫn localStorage trong cùng một bước, nên
 * không có cửa sổ nào hai nguồn lệch nhau.
 */
export interface SavedViewsApi {
  views: SavedView[]
  save: (name: string, params: Record<string, string>) => void
  rename: (from: string, to: string) => void
  remove: (name: string) => void
}

export function useSavedViews(scope: string): SavedViewsApi {
  const [views, setViews] = useState<SavedView[]>(() => readSavedViews(scope))

  const commit = useCallback((next: SavedView[]) => {
    setViews(next)
    writeSavedViews(scope, next)
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

  return { views, save, rename, remove }
}
