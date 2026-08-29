import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * `DEV-PROG-024` — chiều cao còn lại THẬT của viewport, đo từ mép trên của
 * chính phần tử.
 *
 * Vì sao tồn tại: workspace Thiết kế trước nay chốt chiều cao bằng một hằng số
 * đoán chrome phía trên — `calc(100vh - 32rem)`, rồi `20rem`, rồi `18rem`. Ba
 * lần đoán, ba lần phải đo lại bằng tay, và mỗi lần một thứ khác trong app
 * shell đổi (thanh ngữ cảnh, một banner cảnh báo, một tiêu đề rút gọn) là con
 * số ấy sai tiếp mà không ai biết:
 *
 *  - đoán THIẾU  ⇒ cột dài quá đáy, trang tràn dọc và người dùng phải cuộn để
 *    thấy hết chỗ mình vừa gõ;
 *  - đoán THỪA   ⇒ một dải trống dưới đáy màn hình, và chỗ gõ bị bóp lại đúng
 *    bằng phần trống đó — đây là thứ người dùng báo ngày 2026-08-29 ("chiều dọc
 *    editor quá ngắn").
 *
 * Hook này bỏ hẳn phép đoán: hỏi trình duyệt phần tử đang bắt đầu ở đâu, rồi
 * lấy phần còn lại. Chrome phía trên đổi bao nhiêu cũng không cần ai sửa lại
 * một con số.
 */
export interface ViewportFillOptions {
  /** Lề chừa dưới đáy viewport. */
  bottomGapPx: number
  /**
   * Sàn. Dưới mức này thì THÔI không bóp nữa và để trang cuộn: một cửa sổ quá
   * thấp không có ngân sách để chia, và bóp tiếp chỉ tạo ra một khe soạn thảo
   * hai dòng. Sàn phải NHỎ hơn ngân sách của khổ màn phổ biến nhất, nếu không
   * chính nó thành nguyên nhân tràn dọc (`DEV-PROG-021`).
   */
  minPx: number
  /** Chỉ chốt chiều cao từ bề rộng này trở lên; hẹp hơn thì trả `null`. */
  minViewportWidthPx: number
}

export function useViewportFillHeight<T extends HTMLElement>(
  options: ViewportFillOptions,
): [(node: T | null) => void, number | null] {
  const { bottomGapPx, minPx, minViewportWidthPx } = options
  const nodeRef = useRef<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  const measure = useCallback(() => {
    const node = nodeRef.current
    if (!node) return
    if (window.innerWidth < minViewportWidthPx) {
      setHeight((current) => (current === null ? current : null))
      return
    }
    /* Toạ độ TÀI LIỆU (`rect.top + scrollY`), không phải toạ độ viewport: đọc
     * `rect.top` trần sẽ đổi theo từng lần cuộn, và chiều cao cột sẽ nhảy trong
     * lúc người dùng đang cuộn. */
    const top = node.getBoundingClientRect().top + window.scrollY
    const next = Math.max(minPx, Math.round(window.innerHeight - top - bottomGapPx))
    /* Chốt bằng ngưỡng 1 px: `ResizeObserver` dưới đây quan sát `body`, mà
     * chính chiều cao ta vừa đặt lại làm `body` đổi. Không có ngưỡng thì hai
     * bên đẩy nhau thành vòng lặp render vô tận. */
    setHeight((current) => (current !== null && Math.abs(current - next) < 1 ? current : next))
  }, [bottomGapPx, minPx, minViewportWidthPx])

  const observerRef = useRef<ResizeObserver | null>(null)

  const attach = useCallback((node: T | null) => {
    nodeRef.current = node
    if (node) measure()
  }, [measure])

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    /* jsdom và các môi trường cũ không có `ResizeObserver`. Thiếu nó thì hook
     * vẫn đúng ở lần đo đầu và khi đổi cỡ cửa sổ — chỉ mất khả năng bám theo
     * một banner xuất hiện giữa chừng. */
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => measure())
      observer.observe(document.body)
      observerRef.current = observer
    }
    return () => {
      window.removeEventListener('resize', measure)
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [measure])

  return [attach, height]
}
