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
 * chiều cao ta đặt cho `node`, nên quan sát nó không khép kín vòng phản hồi.
 * Phần tử nằm DƯỚI hoặc BÊN TRONG `node` cố ý không có mặt ở đây: chúng là hệ
 * quả của phép đo, không phải đầu vào của nó.
 *
 * ĐÍNH CHÍNH (2026-09-17). Bản đầu của chú thích này viết thêm rằng quan sát
 * chrome phía trên "vẫn bắt được một banner xuất hiện giữa chừng — thứ
 * `DEV-PROG-024` sinh ra để bám theo". Câu ấy chỉ đúng khi banner làm một phần
 * tử ĐÃ có trong tập này cao lên, và SAI khi banner là một phần tử MỚI: tập
 * trả về đây được chốt một lần lúc gắn node và không tự tính lại. Bản cũ
 * `observe(document.body)` không có chỗ hở đó, vì mọi dải chèn thêm đều làm
 * `body` cao lên. Khoảng hở được bịt bằng `ancestorsOf` ngay dưới — không phải
 * bằng việc nới tập này rộng ra, vì nới rộng là nối lại đúng vòng phản hồi.
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

/**
 * Các phần tử mà việc thêm/bớt CON TRỰC TIẾP có thể chèn một dải chrome mới
 * vào phía trên `node`: chuỗi cha của nó, tính cả `<body>`.
 *
 * VÌ SAO CẦN (#677). `chromeAbove` cho biết tập phần tử phải NGHE KÍCH THƯỚC,
 * nhưng chính tập ấy có thể đổi — và nó chỉ được tính lúc gắn node. Options
 * của `DesignWorkspacePage` là ba số nguyên, nên `measure`, `observeChrome` và
 * `attach` giữ nguyên danh tính qua mọi lần render: callback ref không chạy
 * lại, `useLayoutEffect` cũng không, và tập quan sát đứng yên suốt vòng đời
 * trang. Một banner xuất hiện giữa chừng như phần tử MỚI vì thế không được ai
 * nghe, các dải cũ thì không đổi kích thước, và hook không đo lại: cột giữ
 * chiều cao tính theo mép trên CŨ và dài quá đáy đúng bằng banner. Đo được ở
 * ca jsdom: mép trên 360 px, cột kẹt ở 576 px thay vì 516 px ⇒ tài liệu
 * 936 px trong viewport 900 px, tràn dọc 36 px — cú `DEV-PROG-021` mà `AC-4`
 * cấm, ăn mất đúng năng lực `DEV-PROG-024` mà hook sinh ra để có.
 *
 * Nghe `childList` trên chuỗi cha là phép vá HẸP NHẤT bịt được chỗ đó:
 *
 *  - KHÔNG `subtree`, nên thêm/bớt bên trong `node` — gõ chữ, thêm khối FBD —
 *    không kích hoạt gì. Nghe `subtree` mới là nối lại vòng phản hồi.
 *  - KHÔNG nghe `attributes`, nên việc đặt `style.height` của chính phép đo
 *    không tự gọi lại mình.
 *
 * Cha thì cao lên theo chiều cao ta đặt, nên chúng cố ý CHỈ được nghe về cấu
 * trúc, không bao giờ về kích thước.
 */
function ancestorsOf(node: Element): Element[] {
  const chain: Element[] = []
  const root = node.ownerDocument?.body ?? null
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    chain.push(parent)
    if (parent === root) break
  }
  return chain
}

/** Bập bênh bố cục khép vòng trong vài ms; thao tác người dùng thì không. */
const OSCILLATION_WINDOW_MS = 250

export function useViewportFillHeight<T extends HTMLElement>(
  options: ViewportFillOptions,
): [(node: T | null) => void, number | null] {
  const { bottomGapPx, minPx, minViewportWidthPx } = options
  const nodeRef = useRef<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  /* Bản sao của `height` đọc được NGAY trong `measure`.
   * Bản trước lấy giá trị hiện hành bằng dạng updater của `setHeight` rồi ghi
   * `historyRef` bên trong updater ấy. Updater của React phải THUẦN — nó có
   * thể được gọi lại (StrictMode gọi hai lần, render bị huỷ thì gọi lại) — nên
   * mọi phép ghi đặt trong đó phải là phép gán luỹ đẳng mới an toàn. Phép đếm
   * `oscillationCyclesRef` dưới đây KHÔNG luỹ đẳng, nên toàn bộ phần quyết định
   * chuyển ra ngoài và chỉ hook này ghi `height`, nhờ đó bản sao không lệch. */
  const heightRef = useRef<number | null>(null)
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
  /* Số chu kỳ LIÊN TIẾP "bị lớp chặn chặn, rồi vẫn đổi giá trị". Đây là thứ
   * phân biệt hai tình huống mà lớp chặn không phân biệt được tại thời điểm
   * chặn: một thao tác người dùng kết thúc cho đúng MỘT chu kỳ, còn một bố cục
   * LƯỠNG ỔN cho vô hạn — xem `latchRef`. */
  const oscillationCyclesRef = useRef(0)
  /* Bật khi lớp chặn dưới vừa chặn một phép đo, tắt lại ở lần áp dụng kế tiếp.
   * Đây mới là tín hiệu đúng, và bản đầu của lớp chốt này đã khoá nhầm vào
   * một tín hiệu khác — "phép đo TỚI TỪ hẹn giờ mà áp dụng được" — rồi không
   * chốt được gì: khi hẹn giờ chạy, giá trị thường CHƯA đổi nên nó thoát sớm,
   * còn lần đổi thật lại tới từ nhịp thường ngay sau khi cửa sổ hết hạn. Đo
   * được: bộ đếm đứng yên ở 0 suốt 200 nhịp. Cái đáng đếm là "đã bị chặn rồi
   * sau đó vẫn đổi", bất kể ai mang giá trị mới tới. */
  const blockedSinceApplyRef = useRef(false)
  /* Chốt cho bố cục lưỡng ổn: cặp hai giá trị thay nhau, giá trị đã chốt, và
   * lần cuối cặp ấy còn hoạt động. `null` là chưa chốt. */
  const latchRef = useRef<{ pair: readonly [number, number]; atMs: number } | null>(null)

  const measure = useCallback(() => {
    const node = nodeRef.current
    if (!node) return
    if (window.innerWidth < minViewportWidthPx) {
      if (heightRef.current !== null) {
        heightRef.current = null
        setHeight(null)
      }
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

    /* CHỐT bố cục lưỡng ổn — lớp sau cùng, cho trường hợp KHÔNG CÓ điểm bất
     * động nào để hội tụ về.
     *
     * Lớp hoãn ngay dưới sửa đúng việc bỏ rơi phép đo, nhưng nó không làm cho
     * một bố cục lưỡng ổn dừng lại: mỗi lần cửa sổ khép, giá trị đối diện được
     * nhận, bố cục lật lại, rồi chặn tiếp. Đo được ngày 2026-09-17 với thời
     * gian chạy thật: 200 nhịp reflow trong 3200 ms cho 14 lần đổi giá trị —
     * chuỗi `576 ↔ 536` đều đặn một lần mỗi cửa sổ, KHÔNG BAO GIỜ DỪNG. Ca
     * hội tụ `AC-2` không thấy điều này vì nó chạy đồng bộ, nên hẹn giờ hoãn
     * không bao giờ bắn trong ca đó — khẳng định "50 nhịp cuối không đổi gì
     * nữa" của nó là tính chất của harness, không phải của mã.
     *
     * Khi hai giá trị thay nhau mà không giá trị nào là điểm bất động, cách
     * duy nhất để dừng là CHỌN một giá trị. Chọn giá trị NHỎ HƠN: nó là giá
     * trị không tràn: cột thấp hơn phần còn lại của viewport thì thừa một dải
     * trống dưới đáy, còn cột cao hơn thì đẩy tài liệu dài quá đáy — đúng cú
     * `DEV-PROG-021` mà `AC-4` cấm. Giữa hai bề mặt hỏng, dải trống là bề mặt
     * hỏng an toàn.
     *
     * Chốt chỉ giữ khi cặp ấy CÒN hoạt động. Mỗi phép đo bị chốt chặn sẽ làm
     * mới `atMs`, nên trong lúc bố cục còn lật thì chốt còn nóng; khi bố cục
     * đứng yên thì không sự kiện nào tới nữa và chốt nguội sau một cửa sổ. Một
     * giá trị NGOÀI cặp — người dùng đổi cỡ cửa sổ thật — gỡ chốt ngay. Nhờ
     * hai lối ra đó, chốt không phải trạng thái khoá vĩnh viễn: đây đúng là
     * câu mà bản đầu của lớp chặn dưới đã nói sai một lần, nên lần này nó được
     * bảo đảm bằng hai ca test chứ không bằng một câu trấn an. */
    const latch = latchRef.current
    if (latch) {
      const inPair = next === latch.pair[0] || next === latch.pair[1]
      if (inPair && now - latch.atMs < OSCILLATION_WINDOW_MS) {
        latchRef.current = { pair: latch.pair, atMs: now }
        return
      }
      latchRef.current = null
      oscillationCyclesRef.current = 0
    }

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
      blockedSinceApplyRef.current = true
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
    const current = heightRef.current
    if (current === next) return

    /* Đếm NGOÀI updater, vì lý do ghi ở `heightRef`. Một phép đo tới từ đường
     * hoãn mà lại áp dụng được nghĩa là cửa sổ đã khép mà bố cục vẫn đổi;
     * hai lần LIÊN TIẾP như thế là bố cục đang lật qua lật lại chứ không phải
     * một thao tác đã kết thúc. Bất kỳ phép đo thường nào cũng đặt lại bộ đếm,
     * nên chỉ chuỗi liên tiếp mới chốt. */
    /* Một chu kỳ "bị chặn rồi vẫn đổi" = một lần bố cục lật qua lớp chặn. Một
     * thao tác người dùng kết thúc cho đúng MỘT chu kỳ rồi im; bố cục lưỡng ổn
     * cho vô hạn. Một lần đổi KHÔNG qua chặn đặt lại bộ đếm, nên chỉ chuỗi
     * liên tiếp mới chốt. */
    oscillationCyclesRef.current = blockedSinceApplyRef.current ? oscillationCyclesRef.current + 1 : 0
    blockedSinceApplyRef.current = false

    let applied = next
    if (oscillationCyclesRef.current >= 2 && current !== null) {
      latchRef.current = { pair: [current, next] as const, atMs: now }
      applied = Math.min(current, next)
    }

    historyRef.current = { previous: current, atMs: now }
    heightRef.current = applied
    setHeight(applied)
  }, [bottomGapPx, minPx, minViewportWidthPx])

  /* Đổi cỡ VIEWPORT là đầu vào TỪ NGOÀI, nên nó xoá sạch mọi suy luận về bập
   * bênh đang tích luỹ.
   *
   * VÌ SAO CẦN (#677, 2026-09-17). Lớp chốt phân biệt "bố cục lưỡng ổn" với
   * "thao tác người dùng" bằng HÌNH DẠNG của chuỗi giá trị: hai chu kỳ "bị
   * chặn rồi vẫn đổi" liên tiếp thì chốt. Nhưng hai tình huống ấy cho CÙNG
   * một hình dạng — người dùng kéo mép cửa sổ qua lại vài nhịp cũng sinh đúng
   * hai chu kỳ. Đo được: kéo 900 → 800 → 900, mỗi nhịp cách nhau vài chục ms,
   * đủ cho bộ đếm chạm ngưỡng; chốt đóng vào cặp `{476, 576}` và kẹp cột ở
   * 476 px trong khi cửa sổ 900 px đáng cho 576 px. Người dùng mất đúng 100 px
   * chỗ gõ và không có cách nào lấy lại trừ khi kéo ra một giá trị thứ ba —
   * đúng cú `DEV-PROG-021` mà `AC-4` cấm, lần này do chính lớp chống lưỡng ổn
   * của `#677` gây ra trên một trang KHÔNG hề lưỡng ổn.
   *
   * Thứ phân biệt hai tình huống không nằm trong chuỗi giá trị mà ở NGUỒN của
   * phép đo. Bố cục lưỡng ổn tự lật: không sự kiện nào từ ngoài, chỉ
   * `ResizeObserver` bắn vì chính chiều cao ta vừa đặt. Người dùng đổi cỡ cửa
   * sổ thì có `resize` của `window` — một đầu vào mà bố cục không tự tạo ra
   * được. Nên phép đo đến từ đường ấy đặt lại bộ đếm và gỡ chốt: mọi suy luận
   * tích luỹ trước đó nói về một viewport đã không còn.
   *
   * Lớp chốt không vì thế yếu đi: một bố cục thật sự lưỡng ổn không phát
   * `resize` bao giờ, nên nó vẫn bị chốt sau đúng hai chu kỳ như cũ. */
  const measureFromViewportChange = useCallback(() => {
    latchRef.current = null
    oscillationCyclesRef.current = 0
    blockedSinceApplyRef.current = false
    measure()
  }, [measure])

  const observerRef = useRef<ResizeObserver | null>(null)
  /* Người nghe CẤU TRÚC chuỗi cha, và `observeChrome` mới nhất để nó gọi lại.
   * Phải đi qua `ref` vì callback của nó tham chiếu chính `observeChrome`. */
  const structureRef = useRef<MutationObserver | null>(null)
  const observeChromeRef = useRef<((node: T | null) => void) | null>(null)

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
    structureRef.current?.disconnect()
    structureRef.current = null
    if (!node) return

    /* jsdom và các môi trường cũ không có `ResizeObserver`. Thiếu nó thì hook
     * vẫn đúng ở lần đo đầu và khi đổi cỡ cửa sổ — chỉ mất khả năng bám theo
     * chrome phía trên đổi chiều cao tại chỗ. */
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => measure())
      for (const element of chromeAbove(node)) observer.observe(element)
      observerRef.current = observer
    }

    /* Tập `chromeAbove` đổi khi cây phía trên đổi, nên phải tính LẠI chứ không
     * chỉ đo lại: một banner mới vừa đẩy mép trên xuống, vừa là phần tử mà lần
     * sau nó cao lên ta cũng phải nghe. Gọi lại chính hàm này làm đúng cả hai,
     * và việc nó `disconnect()` người nghe hiện tại — kể cả người nghe vừa gọi
     * nó — là có chủ ý: mọi bản ghi còn chờ đều thành thừa sau khi đo lại. */
    if (typeof MutationObserver !== 'undefined') {
      const structure = new MutationObserver(() => {
        observeChromeRef.current?.(nodeRef.current)
        measure()
      })
      for (const parent of ancestorsOf(node)) structure.observe(parent, { childList: true })
      structureRef.current = structure
    }
  }, [measure])

  const attach = useCallback((node: T | null) => {
    nodeRef.current = node
    observeChrome(node)
    if (node) measure()
  }, [measure, observeChrome])

  useLayoutEffect(() => {
    measureRef.current = measure
    observeChromeRef.current = observeChrome
    measure()
    /* Node đã gắn từ lần render trước (callback ref không chạy lại), hoặc
     * `measure` vừa đổi vì options đổi — cả hai đều cần một observer mới. */
    observeChrome(nodeRef.current)
    window.addEventListener('resize', measureFromViewportChange)
    return () => {
      window.removeEventListener('resize', measureFromViewportChange)
      observerRef.current?.disconnect()
      observerRef.current = null
      structureRef.current?.disconnect()
      structureRef.current = null
      if (retryRef.current !== null) {
        clearTimeout(retryRef.current)
        retryRef.current = null
      }
      latchRef.current = null
      oscillationCyclesRef.current = 0
      blockedSinceApplyRef.current = false
    }
  }, [measure, measureFromViewportChange, observeChrome])

  return [attach, height]
}
