import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * `T61-304` — MỘT vòng tiêu điểm cho mọi bề mặt phủ của sản phẩm.
 *
 * Tách khỏi `Modal` vì từ lát này có bề mặt phủ THỨ HAI: khay Inspector của
 * PGM-04 ở khổ tablet/mobile. Chép logic sang đó sẽ là hai vòng tiêu điểm với
 * hai danh sách "phần tử bấm được" — và chúng sẽ trôi khỏi nhau đúng vào ngày
 * ai đó thêm một loại điều khiển mới, ở đúng chỗ người dùng bàn phím không có
 * đường thoát.
 */
const focusableSelector = [
  '[data-modal-initial-focus]',
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/**
 * Các phần tử tham gia VÒNG TAB của một bề mặt phủ.
 *
 * `tabindex="-1"` bị loại, và đó là điểm mấu chốt: tiêu đề mang
 * `data-modal-initial-focus tabIndex={-1}` để nhận tiêu điểm ban đầu, nhưng nó
 * KHÔNG phải một điểm dừng Tab. Trước khi luật này ra đời, tiêu đề lọt vào danh
 * sách qua nhánh `[data-modal-initial-focus]` của bộ chọn và trở thành phần tử
 * ĐẦU TIÊN, nên Tab từ nút cuối cùng cuộn vòng về... một cái tiêu đề không bấm
 * được. Người dùng bàn phím mất một nhịp Tab thừa ở MỌI hộp thoại của sản phẩm.
 */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.getAttribute('aria-hidden') !== 'true' && element.getAttribute('tabindex') !== '-1',
  )
}

/**
 * Cuộn vòng `Tab`/`Shift+Tab` bên trong `container`.
 *
 * Không có phần tử bấm được nào thì `Tab` bị chặn và tiêu điểm về chính vùng
 * phủ: để nó đi tiếp là thả người dùng bàn phím ra sau một tấm nền mờ mà họ
 * không nhìn thấy mình đang ở đâu.
 */
export function trapTabKey(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return
  const focusable = focusableElements(container)
  if (!focusable.length) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
