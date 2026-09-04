import { useEffect, useState } from 'react'

export const PROGRAMMING_AUTHORING_MIN_WIDTH_PX = 768
const MOBILE_AUTHORING_QUERY = `(max-width: ${PROGRAMMING_AUTHORING_MIN_WIDTH_PX - 1}px)`

function readMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') return window.matchMedia(MOBILE_AUTHORING_QUERY).matches
  return window.innerWidth < PROGRAMMING_AUTHORING_MIN_WIDTH_PX
}

/**
 * Policy runtime, không chỉ CSS: dưới 768 px phải truyền `canEdit=false` tới
 * editor để textarea, reducer FBD và shortcut cùng fail closed.
 */
export function useProgrammingMobileReadOnly(): boolean {
  const [mobile, setMobile] = useState(readMobileViewport)

  useEffect(() => {
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia(MOBILE_AUTHORING_QUERY)
      const sync = (event: MediaQueryListEvent) => setMobile(event.matches)
      setMobile(query.matches)
      query.addEventListener('change', sync)
      return () => query.removeEventListener('change', sync)
    }
    const sync = () => setMobile(readMobileViewport())
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return mobile
}

/**
 * `T61-304` — hình thái của Inspector PGM-04, theo `SPEC-PGM04-VISUAL-001` §1.
 *
 * | Khổ | Hình thái |
 * |---|---|
 * | `>= 1024 px` | CẮM cố định bên phải (không phủ lên danh sách) |
 * | `768–1023 px` | KHAY phủ từ phải, nền mờ |
 * | `< 768 px` | TOÀN MÀN |
 *
 * Đây là policy RUNTIME, không phải CSS. Lý do: `role="dialog"`, `aria-modal`,
 * bẫy tiêu điểm và `Esc` chỉ được bật ở hai hình thái phủ. Làm bằng CSS thuần
 * thì ở desktop cây DOM vẫn là một hộp thoại — bẫy tiêu điểm ở một khay CẮM là
 * nhốt người dùng bàn phím vào một vùng họ chưa từng "mở", và `Esc` sẽ đóng một
 * thứ không đóng được.
 */
export type ProgrammingInspectorMode = 'dock' | 'drawer' | 'fullscreen'

export const PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX = 1024
const DOCK_QUERY = `(min-width: ${PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX}px)`

function readInspectorMode(): ProgrammingInspectorMode {
  if (typeof window === 'undefined') return 'dock'
  const matches = (query: string) =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : null
  const dock = matches(DOCK_QUERY)
  if (dock === null) {
    /* jsdom cũ và môi trường không có `matchMedia`: rơi về `innerWidth`. KHÔNG
       mặc định 'dock' ở đây — một khổ hẹp bị đoán thành desktop sẽ trả về đúng
       cái CSS stack mà lát này gỡ bỏ. */
    const width = window.innerWidth
    if (width >= PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX) return 'dock'
    return width >= PROGRAMMING_AUTHORING_MIN_WIDTH_PX ? 'drawer' : 'fullscreen'
  }
  if (dock) return 'dock'
  return matches(MOBILE_AUTHORING_QUERY) ? 'fullscreen' : 'drawer'
}

export function useProgrammingInspectorMode(): ProgrammingInspectorMode {
  const [mode, setMode] = useState<ProgrammingInspectorMode>(readInspectorMode)

  useEffect(() => {
    const sync = () => setMode(readInspectorMode())
    sync()
    if (typeof window.matchMedia === 'function') {
      const queries = [window.matchMedia(DOCK_QUERY), window.matchMedia(MOBILE_AUTHORING_QUERY)]
      for (const query of queries) query.addEventListener('change', sync)
      return () => { for (const query of queries) query.removeEventListener('change', sync) }
    }
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return mode
}
