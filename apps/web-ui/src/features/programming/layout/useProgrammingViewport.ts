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
