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

export type FbdBreakpoint = 'xl' | 'lg' | 'md' | 'sm'
export type FbdDockMode = 'dock-4col' | 'drawer' | 'overlay'

export const FBD_BREAKPOINT_XL_MIN_WIDTH_PX = 1440
export const FBD_BREAKPOINT_LG_MIN_WIDTH_PX = 1024
export const FBD_BREAKPOINT_MD_MIN_WIDTH_PX = 768

const FBD_XL_QUERY = `(min-width: ${FBD_BREAKPOINT_XL_MIN_WIDTH_PX}px)`
const FBD_LG_QUERY = `(min-width: ${FBD_BREAKPOINT_LG_MIN_WIDTH_PX}px)`
const FBD_MD_QUERY = `(min-width: ${FBD_BREAKPOINT_MD_MIN_WIDTH_PX}px)`

function readFbdViewport(): { breakpoint: FbdBreakpoint; dockMode: FbdDockMode } {
  if (typeof window === 'undefined') return { breakpoint: 'xl', dockMode: 'dock-4col' }
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia(FBD_XL_QUERY).matches) return { breakpoint: 'xl', dockMode: 'dock-4col' }
    if (window.matchMedia(FBD_LG_QUERY).matches) return { breakpoint: 'lg', dockMode: 'drawer' }
    if (window.matchMedia(FBD_MD_QUERY).matches) return { breakpoint: 'md', dockMode: 'overlay' }
    return { breakpoint: 'sm', dockMode: 'overlay' }
  }
  const width = window.innerWidth
  if (width >= FBD_BREAKPOINT_XL_MIN_WIDTH_PX) return { breakpoint: 'xl', dockMode: 'dock-4col' }
  if (width >= FBD_BREAKPOINT_LG_MIN_WIDTH_PX) return { breakpoint: 'lg', dockMode: 'drawer' }
  if (width >= FBD_BREAKPOINT_MD_MIN_WIDTH_PX) return { breakpoint: 'md', dockMode: 'overlay' }
  return { breakpoint: 'sm', dockMode: 'overlay' }
}

export function useFbdViewport(): { breakpoint: FbdBreakpoint; dockMode: FbdDockMode } {
  const [viewport, setViewport] = useState<{ breakpoint: FbdBreakpoint; dockMode: FbdDockMode }>(readFbdViewport)

  useEffect(() => {
    const sync = () => setViewport(readFbdViewport())
    sync()
    if (typeof window.matchMedia === 'function') {
      const queries = [
        window.matchMedia(FBD_XL_QUERY),
        window.matchMedia(FBD_LG_QUERY),
        window.matchMedia(FBD_MD_QUERY),
      ]
      for (const query of queries) query.addEventListener?.('change', sync)
      return () => {
        for (const query of queries) query.removeEventListener?.('change', sync)
      }
    }
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return viewport
}

