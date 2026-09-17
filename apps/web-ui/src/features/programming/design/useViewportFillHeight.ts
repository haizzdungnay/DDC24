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

/**
 * Tập phần tử quyết định mép trên của `node`: mọi anh-chị-em đứng TRƯỚC nó
 * trên đường đi từ chính nó lên `<body>`.
 *
 * VÌ SAO KHÔNG PHẢI `document.body` (#677). Bản trước quan sát
 * `document.body`, tức quan sát đúng phần tử mà kết quả của phép đo làm thay
 * đổi: `measure()` đặt chiều cao cho cột ⇒ `body` cao theo ⇒ observer gọi lại
 * `measure()`. Ghi chú cũ đã lường trước rủi ro và chốt bằng ngưỡng
 * `Math.abs(current - next) < 1`, nhưng ngưỡng ấy chỉ chặn được trôi dần chứ
 * không chặn được DAO ĐỘNG: thanh cuộn dọc hiện lên làm viewport hẹp lại, nội
 * dung phía trên xuống dòng, mép trên tụt xuống, chiều cao cột giảm, thanh
 * cuộn biến mất, và vòng quay lại từ đầu với biên độ lớn hơn 1 px. Đo được
 * ngày 2026-09-12: `TC-FBD-NAV-001` (desktop) và `TC-FBD-DIAG-001` (mobile)
 * chết ở `element is not stable` sau 116–118 lần thử — Playwright chờ bố cục
 * đứng yên trên một bố cục không bao giờ đứng yên.
 *
 * Chrome phía TRÊN thì khác về bản chất: chiều cao của nó không phụ thuộc
 * chiều cao ta đặt cho `node`, nên quan sát nó vẫn bắt được một banner xuất
 * hiện giữa chừng — thứ `DEV-PROG-024` sinh ra để bám theo — mà không khép
 * kín vòng phản hồi. Phần tử nằm DƯỚI hoặc BÊN TRONG `node` cố ý không có mặt
 * ở đây: chúng là hệ quả của phép đo, không phải đầu vào của nó.
 */
function chromeAbove(node: Element): Element[] {
  const above: Element[] = []
  const root = node.ownerDocument?.body ?? null
  let current: Element | null = node
  while (current && current !== root) {
    for (let prev = current.previousElementSibling; prev; prev = prev.previousElementSibling) {
      above.push(prev)
    }
    current = current.parentElement
  }
  return above
}

/** Bập bênh bố cục khép vòng trong vài ms; thao tác người dùng thì không. */
const OSCILLATION_WINDOW_MS = 250

export function useViewportFillHeight<T extends HTMLElement>(
  options: ViewportFillOptions,
): [(node: T | null) => void, number | null] {
  const { bottomGapPx, minPx, minViewportWidthPx } = options
  const nodeRef = useRef<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  /* Giá trị NGAY TRƯỚC giá trị đang giữ, kèm thời điểm đổi — hai dữ kiện đủ để
   * nhận ra chuỗi `A → B → A`. Là `ref` chứ không phải state: nó là dữ liệu
   * chẩn đoán của phép đo, render lại vì nó thì đúng bằng việc tự tạo thêm một
   * vòng nữa. */
  const historyRef = useRef<{ previous: number | null; atMs: number }>({ previous: null, atMs: 0 })
  /* Hẹn giờ của phép đo bị hoãn (xem lớp chặn bập bênh dưới), và `measure` mới
   * nhất để hẹn giờ ấy gọi lại. Phải đi qua `ref` vì `measure` tham chiếu chính
   * nó, và vì `measure` đổi danh tính mỗi khi options đổi. */
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const measureRef = useRef<(() => void) | null>(null)

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
    /* Chặn BẬP BÊNH — lớp cuối, cho trường hợp chrome phía trên bị chính chiều
     * cao ta đặt tác động GIÁN TIẾP: cột cao hơn ⇒ trang có thanh cuộn dọc ⇒
     * viewport hẹp đi 15 px ⇒ một dòng trong chrome xuống dòng ⇒ mép trên tụt
     * ⇒ cột thấp lại ⇒ mất thanh cuộn ⇒ quay về đầu. Đường này đi vòng qua bố
     * cục nên không phần tử nào để loại khỏi tập quan sát: nhận ra nó phải bằng
     * hình dạng của chuỗi giá trị, `A → B → A`.
     *
     * Cửa sổ thời gian là thứ phân biệt bập bênh với thao tác thật. Một vòng
     * phản hồi bố cục khép lại trong vài mili giây; người dùng mở rồi đóng một
     * banner thì cách nhau hàng trăm. Nên chỉ chặn khi giá trị cũ quay lại
     * NGAY, và sau `OSCILLATION_WINDOW_MS` thì mọi giá trị lại được nhận bình
     * thường.
     *
     * Bản đầu của lớp này viết thêm ở đây rằng "không có trạng thái khoá vĩnh
     * viễn nào để rơi vào". Câu ấy đúng về LỚP CHẶN và sai về GIÁ TRỊ, và chỗ
     * hiểu lẫn đó đã để lọt một cú tràn dọc 100 px — xem khối dưới. Giữ lại
     * đính chính này ở đây thay vì chỉ sửa mã: câu trấn an cũ mới là thứ làm
     * người đọc sau không đi kiểm. */
    const history = historyRef.current
    const now = performance.now()
    if (next === history.previous && now - history.atMs < OSCILLATION_WINDOW_MS) {
      /* CHẶN thì đúng, nhưng BỎ RƠI thì sai — và bản đầu của lớp này `return`
       * thẳng, tức bỏ rơi.
       *
       * Trong một dao động thật, bỏ rơi vô hại: nhịp sau tới ngay. Nhưng
       * `A → B → A` cũng là hình dạng của một THAO TÁC THẬT rồi DỪNG — người
       * dùng kéo mép cửa sổ ra, kéo trả lại trong vài chục ms, rồi thả tay.
       * Lúc ấy phép đo bị chặn là phép đo ĐÚNG và CUỐI CÙNG: không sự kiện nào
       * tới sau nó, nên cột giữ mãi chiều cao trung gian. Đo được ở ca jsdom:
       * cột 676 px trong viewport 900 px bắt đầu ở mép 300 px — tài liệu
       * 1000 px, tràn dọc 100 px, đúng cú `DEV-PROG-021` mà hook này sinh ra
       * để chặn.
       *
       * Nên hoãn chứ đừng bỏ: hẹn đo lại đúng lúc cửa sổ khép. Dao động thật
       * không vì thế mà sống lại — lúc hẹn giờ chạy, nó chỉ đọc trạng thái DOM
       * tại thời điểm đó và vẫn đi qua đúng lớp chặn này, nên nhịp đổi giá trị
       * vẫn bị giữ ở mức một lần mỗi cửa sổ. */
      if (retryRef.current === null) {
        retryRef.current = setTimeout(() => {
          retryRef.current = null
          measureRef.current?.()
        }, OSCILLATION_WINDOW_MS - (now - history.atMs))
      }
      return
    }

    /* So sánh BẰNG trên số đã làm tròn, không phải ngưỡng `< 1`.
     *
     * Hai vế đều là số nguyên nên hai cách cho cùng kết quả; khác nhau ở chỗ
     * ngưỡng `< 1` đọc như một van an toàn chống vòng lặp, và nó đã được tin
     * cậy đúng như thế. Nó không phải van an toàn: vòng lặp bị cắt ở hai chỗ
     * khác — hook không còn quan sát thứ do chính nó thay đổi (`chromeAbove`),
     * và chuỗi `A → B → A` bị chặn ngay trên. Giữ lại một ngưỡng trông-như-van
     * chỉ mời lần sửa sau quan sát `body` trở lại và tin rằng đã có gì đó đỡ. */
    setHeight((current) => {
      if (current === next) return current
      historyRef.current = { previous: current, atMs: now }
      return next
    })
  }, [bottomGapPx, minPx, minViewportWidthPx])

  const observerRef = useRef<ResizeObserver | null>(null)

  /* Gắn observer phải đi theo NODE, không theo effect.
   *
   * `useLayoutEffect` của lần mount chạy TRƯỚC callback ref ở đây — đo được
   * `nodeRef.current === null` trên trang thật ngày 2026-09-17. Bản cũ không
   * lộ ra điều đó vì nó quan sát `document.body`, một phần tử luôn sẵn có và
   * không cần node để gắn vào. Chuyển sang quan sát chrome phía trên mà vẫn
   * gắn trong effect thì observer KHÔNG BAO GIỜ được tạo: hook đo đúng một
   * lần lúc trang chưa dựng xong chrome rồi giữ mãi con số đó. Đo được cột
   * cao 963 px theo `top=93.5`, trong khi chrome dựng xong đẩy `top` lên
   * 139.5 — tài liệu 1123 px trên viewport 1080 px, tràn dọc 43 px, đúng cú
   * `DEV-PROG-021` mà `AC-4` cấm. */
  const observeChrome = useCallback((node: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    /* jsdom và các môi trường cũ không có `ResizeObserver`. Thiếu nó thì hook
     * vẫn đúng ở lần đo đầu và khi đổi cỡ cửa sổ — chỉ mất khả năng bám theo
     * một banner xuất hiện giữa chừng. */
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    for (const element of chromeAbove(node)) observer.observe(element)
    observerRef.current = observer
  }, [measure])

  const attach = useCallback((node: T | null) => {
    nodeRef.current = node
    observeChrome(node)
    if (node) measure()
  }, [measure, observeChrome])

  useLayoutEffect(() => {
    measureRef.current = measure
    measure()
    /* Node đã gắn từ lần render trước (callback ref không chạy lại), hoặc
     * `measure` vừa đổi vì options đổi — cả hai đều cần một observer mới. */
    observeChrome(nodeRef.current)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      observerRef.current?.disconnect()
      observerRef.current = null
      if (retryRef.current !== null) {
        clearTimeout(retryRef.current)
        retryRef.current = null
      }
    }
  }, [measure, observeChrome])

  return [attach, height]
}
