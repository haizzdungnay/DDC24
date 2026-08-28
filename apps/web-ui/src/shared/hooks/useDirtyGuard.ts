import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * `useDirtyGuard` — khối hạ tầng `BB-2` của Plan 57, đóng finding `F-UX-12`
 * (`REV-FE-UIUX-UC-2026-08-18` §7.1).
 *
 * TRIỆU CHỨNG
 *
 * Bản nháp cấu hình của `OutputsPage`, `AlarmSettingsPage`, `VirtualIoPage` và
 * `UserParametersPage` nằm hoàn toàn trong state cục bộ của React. Đóng tab,
 * bấm Back, hay bấm một mục trên thanh điều hướng là **mất sạch, không một lời
 * cảnh báo**. Trên trang cấu hình ngõ ra, thứ bị mất là các con số quyết định
 * hành vi vật lý của cơ cấu chấp hành (`safeValue`, `minPv`/`maxPv`), nên
 * người vận hành có thể tin là mình đã đặt xong trong khi thiết bị vẫn chạy
 * theo cấu hình cũ.
 *
 * NGUYÊN NHÂN GỐC
 *
 * Dirty-guard từng được thêm **ad-hoc cho riêng `InputsPage`** khi xử lý một
 * finding của chính trang đó (FE-010), rồi lặp lại lần hai trong
 * `programming/design/DesignWorkspacePage.tsx` (D-01). Vì không ai nâng nó
 * thành một khối dùng chung, bốn trang cấu hình còn lại không có gì cả — đúng
 * cơ chế sinh lỗi số 3 mà review mô tả: bản vá nằm ở một chỗ, chỗ bên cạnh
 * không biết tới nó.
 *
 * CÁCH SỬA
 *
 * Gom cả ba lớp chặn vào một hook, dùng lại nguyên vẹn logic đã chạy thật ở
 * `InputsPage`:
 *
 *  1. `beforeunload` — chặn đóng tab / F5 / gõ URL khác. Đây là lớp duy nhất
 *     trình duyệt cho phép; nội dung thông báo do trình duyệt quyết định, ta
 *     chỉ được `preventDefault()`.
 *  2. Chặn điều hướng **trong ứng dụng** bằng cách bắt sự kiện `click` ở pha
 *     capture của `document`. React Router `7.x` không cho chặn `<Link>` bằng
 *     API công khai ổn định, nhưng mọi `<Link>` cuối cùng đều render ra một
 *     `<a href>` — bắt ở đó là đủ và không phụ thuộc phiên bản router.
 *  3. `requestGuardedNavigation()` cho các đường đi **không phải `<a>`** — hiện
 *     do `CommandPalette` (Ctrl/⌘+K) gọi trước khi `navigate()`. Guard đăng ký
 *     mình ở cấp module khi dirty và gỡ khi hết.
 *
 * KHÔNG PHỦ (ghi ra thay vì để người đọc tự suy): **nút Back/Forward của trình
 * duyệt**. Chúng không đi qua `<a href>` và không bắn `beforeunload` cho điều
 * hướng SPA. Chặn đúng cách cần `useBlocker` của data router — ứng dụng hiện
 * dùng `<BrowserRouter>` + `<Routes>` nên chưa có. Đây là khoảng hở đã biết,
 * không phải điều đã được xử lý.
 *
 * LUẬT KHÔNG ĐƯỢC PHÁ: **không dirty thì không chặn gì.** Effect trả về sớm
 * khi `dirty === false`, nên không listener nào được gắn. Một dirty-guard bật
 * thường trực sẽ dạy người dùng bấm "rời đi" theo phản xạ, và khi nó chặn thật
 * thì không ai đọc nữa.
 */
/**
 * Guard đang hoạt động, ở cấp module.
 *
 * N-07 (kiểm tra viên độc lập): `requestNavigation` từng được docstring và
 * CHANGELOG mô tả như "lớp chặn thứ ba", nhưng `grep` toàn `src` cho thấy
 * KHÔNG nơi nào gọi nó — mã chết chưa từng chạy. Đồng thời `CommandPalette`
 * gọi thẳng `navigate(to)` nên lách được cả ba lớp: mở Ctrl+K rồi nhảy trang là
 * mất bản nháp không một lời cảnh báo.
 *
 * Đăng ký ở cấp module thay vì dựng thêm một React context: chỉ có TỐI ĐA một
 * trang dirty tại một thời điểm (trang là đơn vị điều hướng), nên một ô nhớ là
 * đủ và không kéo theo provider mới bọc quanh toàn ứng dụng.
 */
let activeGuard: ((destination: string) => void) | null = null

/**
 * Xin phép điều hướng bằng lệnh (không qua `<a href>`).
 *
 * @returns `true` nếu guard đã chặn và tự mở hộp thoại — nơi gọi PHẢI dừng lại.
 *          `false` nghĩa là không có gì cần giữ, cứ điều hướng như thường.
 */
export function requestGuardedNavigation(destination: string): boolean {
  if (!activeGuard) return false
  activeGuard(destination)
  return true
}

export interface DirtyGuard {
  /** Đích đang chờ xác nhận; `null` nghĩa là không có gì bị chặn. */
  pendingNavigation: string | null
  /** Xin phép rời trang tới `destination` (dùng cho nút không phải `<a>`). */
  requestNavigation: (destination: string) => void
  /** Ở lại trang, huỷ đích đang chờ. */
  cancelNavigation: () => void
  /** Đi tới đích đang chờ ngay lập tức (gọi sau khi đã lưu hoặc đã bỏ nháp). */
  leaveNow: () => void
}

export function useDirtyGuard(dirty: boolean): DirtyGuard {
  const navigate = useNavigate()
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  /* Đích được giữ thêm trong ref vì `leaveNow` thường bị gọi bên trong một
   * promise `.then()` sau khi lưu xong: lúc đó closure của lần render cũ vẫn
   * còn hiệu lực nhưng state có thể đã đổi. Ref cho ta giá trị mới nhất mà
   * không cần phụ thuộc thứ tự render. */
  const pendingRef = useRef<string | null>(null)

  const setPending = useCallback((destination: string | null) => {
    pendingRef.current = destination
    setPendingNavigation(destination)
  }, [])

  useEffect(() => {
    if (!dirty) return undefined
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const interceptInternalLink = (event: MouseEvent) => {
      /* Chỉ chặn cú bấm "mở trong tab này": chuột giữa, Ctrl/Cmd-click,
       * Shift-click đều mở cửa sổ/tab khác nên trang hiện tại — cùng bản nháp
       * của nó — vẫn còn nguyên, không có gì để mất. */
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target || anchor.download) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      /* Liên kết chỉ khác HASH thì KHÔNG phải rời trang — và chặn nó là một lỗi
       * trợ năng do chính guard này tạo ra.
       *
       * `AppShell` mở đầu mỗi trang bằng skip link `<a href="#main-content">`,
       * điểm dừng Tab đầu tiên và là cơ chế WCAG 2.2 §2.4.1 (Bypass Blocks).
       * So bằng `url.href` thì `/eng/outputs#main-content` khác
       * `/eng/outputs`, nên guard nuốt luôn cú bấm: người dùng bàn phím không
       * nhảy được tới nội dung, và nếu họ chọn "Bỏ thay đổi, rời đi" thì app
       * điều hướng về CHÍNH TRANG ĐANG ĐỨNG rồi xoá bản nháp — một bẫy mất dữ
       * liệu do đúng bản vá chống mất dữ liệu gây ra.
       *
       * So bằng `pathname + search` là ranh giới đúng: đổi hash là di chuyển
       * TRONG trang, không có gì để mất. */
      const here = `${window.location.pathname}${window.location.search}`
      if (`${url.pathname}${url.search}` === here) return
      event.preventDefault()
      event.stopPropagation()
      setPending(`${url.pathname}${url.search}${url.hash}`)
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    globalThis.document.addEventListener('click', interceptInternalLink, true)
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload)
      globalThis.document.removeEventListener('click', interceptInternalLink, true)
    }
  }, [dirty, setPending])

  const requestNavigation = useCallback((destination: string) => {
    /* Không dirty thì đi thẳng — hook không được biến thành một lớp hỏi thừa. */
    if (!dirty) {
      navigate(destination)
      return
    }
    setPending(destination)
  }, [dirty, navigate, setPending])

  /* Chỉ đăng ký khi thật sự dirty, và gỡ đăng ký khi hết — nếu không, một trang
     đã lưu xong vẫn chặn Ctrl+K của người dùng. */
  useEffect(() => {
    if (!dirty) return undefined
    activeGuard = (destination: string) => setPending(destination)
    return () => { activeGuard = null }
  }, [dirty, setPending])

  const cancelNavigation = useCallback(() => setPending(null), [setPending])

  const leaveNow = useCallback(() => {
    const destination = pendingRef.current
    setPending(null)
    if (destination) navigate(destination)
  }, [navigate, setPending])

  return { pendingNavigation, requestNavigation, cancelNavigation, leaveNow }
}
