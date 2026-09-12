import { useEffect, useState } from 'react'

/**
 * Ngưỡng `lg` của Tailwind, dùng lại ở tầng JS.
 *
 * `AppShell` ẩn `TopBar` bằng lớp `lg:hidden`, nên bất kỳ quyết định nào phải
 * khớp với lần ẩn đó đều phải dùng ĐÚNG con số này. Khai một chỗ để hai bên
 * không trôi khỏi nhau.
 */
export const SHELL_DESKTOP_MIN_WIDTH_PX = 1024

/**
 * "Khung nhìn rộng ít nhất `px`" ở tầng RUNTIME, không phải CSS.
 *
 * Vì sao không dùng lớp `hidden lg:*`: ẩn bằng CSS vẫn để phần tử NẰM TRONG
 * DOM. Với một điều khiển mà hợp đồng là "mỗi khổ đúng MỘT", điều đó không đủ —
 * phép chọn theo vai trò vẫn thấy cả hai bản và mọi lần bấm thành mơ hồ
 * (`ISS-PGUI-03` đỏ với `strict mode violation: resolved to 2 elements` ở lane
 * 390 px, nơi bản thứ hai đang bị `hidden`). Cùng lập luận đã ghi ở
 * `useProgrammingViewport.ts` cho hình thái Inspector: hình thái là policy
 * runtime, không phải trang trí.
 *
 * Dùng `matchMedia` khi có, ngã về `innerWidth` + `resize` cho môi trường cũ và
 * cho jsdom.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const read = () => {
    if (typeof window === 'undefined') return false
    if (typeof window.matchMedia === 'function') return window.matchMedia(query).matches
    return window.innerWidth >= px
  }
  const [matches, setMatches] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia(query)
      const sync = (event: MediaQueryListEvent) => setMatches(event.matches)
      setMatches(media.matches)
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }
    const sync = () => setMatches(window.innerWidth >= px)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [px, query])

  return matches
}
