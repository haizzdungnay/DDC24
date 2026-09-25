/**
 * `#677` — hook đo chiều cao còn lại phải HỘI TỤ.
 *
 * Một test chỉ khẳng định "chiều cao đúng" không bắt được lỗi này: vòng lặp cũ
 * cho ra giá trị ĐÚNG ở mỗi vòng, nó chỉ không bao giờ dừng. Nên phần lớn các
 * ca dưới đây đếm số lần đổi state và soi tập phần tử được quan sát, chứ không
 * chỉ so một con số.
 */
/// <reference lib="es2022.array" />
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { useEffect, useState } from 'react'
import { cleanup, render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewportFillHeight, type ViewportFillOptions } from './useViewportFillHeight'

/* Cấu hình thật của `DesignWorkspacePage` — dùng đúng nó để AC-4 nói về hành
 * vi được giao chứ không về một bộ số bịa riêng cho test. */
const WORKSPACE_OPTIONS: ViewportFillOptions = {
  bottomGapPx: 24,
  minPx: 384,
  minViewportWidthPx: 1024,
}

/** `ResizeObserver` điều khiển được: ghi lại target và chỉ bắn khi test bảo. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  targets: Element[] = []
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }
  observe(target: Element) { this.targets.push(target) }
  unobserve(target: Element) { this.targets = this.targets.filter((t) => t !== target) }
  disconnect() { this.targets = [] }
  /** Bắn như thể `target` vừa đổi kích thước — không làm gì nếu không quan sát nó. */
  static fire(target: Element) {
    for (const instance of FakeResizeObserver.instances) {
      if (instance.targets.includes(target)) instance.callback()
    }
  }
  static allTargets(): Element[] {
    return FakeResizeObserver.instances.flatMap((instance) => instance.targets)
  }
}

/* Bố cục thật thu nhỏ: hai dải chrome phía trên, rồi cột workspace. */
function Harness({
  options = WORKSPACE_OPTIONS,
  onHeight,
}: {
  options?: ViewportFillOptions
  onHeight?: (h: number | null) => void
}) {
  const [attach, height] = useViewportFillHeight<HTMLDivElement>(options)
  onHeight?.(height)
  return (
    <div data-testid="shell">
      <header data-testid="app-header" />
      <div data-testid="context-strip" />
      <div data-testid="column" ref={attach} style={height === null ? undefined : { height }}>
        <div data-testid="column-child" />
      </div>
    </div>
  )
}

let topPx = 300

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  topPx = 300
  setViewport(1440, 900)
  /* jsdom không làm bố cục: mọi `getBoundingClientRect` trả 0. Giả lập mép
   * trên bằng một biến test điều khiển được, để mô phỏng chrome phía trên. */
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ top: topPx, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: topPx, toJSON: () => ({}) }) as DOMRect,
  )
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  /* Ca nào bật hẹn giờ giả phải trả lại đồng hồ thật, nếu không ca sau treo. */
  vi.useRealTimers()
  /* `globals: false` trong `vite.config.ts` nên RTL KHÔNG tự dọn giữa các ca;
   * thiếu dòng này thì cây DOM của ca trước còn nguyên và `getByTestId` gặp
   * nhiều phần tử trùng tên. */
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useViewportFillHeight — phạm vi quan sát (AC-3)', () => {
  it('không quan sát document.body', () => {
    render(<Harness />)
    expect(FakeResizeObserver.allTargets()).not.toContain(document.body)
  })

  it('không quan sát chính phần tử được đặt chiều cao, cũng không quan sát con của nó', () => {
    const { getByTestId } = render(<Harness />)
    const targets = FakeResizeObserver.allTargets()
    /* Đây là điều kiện đủ để không có vòng phản hồi: mọi thứ hook ĐẶT chiều
     * cao đều phải nằm ngoài tập nó ĐỌC. */
    expect(targets).not.toContain(getByTestId('column'))
    expect(targets).not.toContain(getByTestId('column-child'))
    expect(targets).not.toContain(document.documentElement)
  })

  it('vẫn quan sát chrome phía trên, nên không mất khả năng bám banner của DEV-PROG-024', () => {
    const { getByTestId } = render(<Harness />)
    const targets = FakeResizeObserver.allTargets()
    expect(targets).toContain(getByTestId('app-header'))
    expect(targets).toContain(getByTestId('context-strip'))
  })

  it('banner phía trên cao lên thì chiều cao được đo lại', () => {
    const heights: (number | null)[] = []
    const { getByTestId } = render(<Harness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBe(900 - 300 - 24)

    topPx = 360                                   /* banner chen vào, cột tụt xuống */
    act(() => { FakeResizeObserver.fire(getByTestId('context-strip')) })
    expect(heights.at(-1)).toBe(900 - 360 - 24)
  })
})

describe('useViewportFillHeight — hội tụ (AC-2)', () => {
  it('đặt chiều cao xong thì body đổi cũng không kích hoạt thêm vòng đo nào', () => {
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    const rendersAfterMount = heights.length

    /* Chính vòng cũ: chiều cao vừa đặt làm `body` cao lên. Hook không còn quan
     * sát `body`, nên không ai được đánh thức và bố cục đứng yên. */
    act(() => { FakeResizeObserver.fire(document.body) })

    expect(heights.length).toBe(rendersAfterMount)
    expect(heights.at(-1)).toBe(900 - 300 - 24)
  })

  it('dừng sau hữu hạn vòng ngay cả khi mép trên dao động theo chiều cao đã đặt (thanh cuộn hiện/mất)', () => {
    /* Tái hiện đúng dao động > 1 px mà ngưỡng `< 1` không chặn được: cột cao
     * hơn 560 px ⇒ trang có thanh cuộn ⇒ viewport hẹp lại ⇒ chrome xuống dòng
     * ⇒ mép trên tụt 40 px ⇒ cột thấp lại ⇒ mất thanh cuộn ⇒ lặp. */
    const settled: (number | null)[] = []
    const { getByTestId } = render(
      <Harness onHeight={(h) => { if (settled.at(-1) !== h) settled.push(h) }} />,
    )

    for (let i = 0; i < 200; i += 1) {
      const columnHeight = 900 - topPx - 24
      topPx = columnHeight > 560 ? 340 : 300
      /* Bắn MỌI phần tử: kể cả bố cục có reflow toàn trang thì cũng phải hội tụ. */
      act(() => {
        FakeResizeObserver.fire(document.body)
        FakeResizeObserver.fire(getByTestId('app-header'))
        FakeResizeObserver.fire(getByTestId('context-strip'))
      })
    }

    /* 200 nhịp reflow mà số lần đổi giá trị phải nhỏ và hữu hạn. Bản cũ đổi
     * mỗi nhịp (≥ 200) — đó là thứ làm Playwright chờ hết 60 s rồi bỏ cuộc ở
     * `element is not stable`. */
    expect(settled.length).toBeLessThan(6)
    /* Và phải DỪNG HẲN, không chỉ chậm lại: 50 nhịp cuối không đổi gì nữa. */
    const before = settled.length
    for (let i = 0; i < 50; i += 1) {
      act(() => {
        FakeResizeObserver.fire(getByTestId('app-header'))
        FakeResizeObserver.fire(getByTestId('context-strip'))
      })
    }
    expect(settled.length).toBe(before)
  })
})

describe('useViewportFillHeight — hành vi DEV-PROG-024/021 giữ nguyên (AC-4, AC-5)', () => {
  it('lấp đúng phần còn lại của viewport', () => {
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBe(900 - 300 - 24)
  })

  it('giữ sàn 384 px ở khổ 800 px thay vì bóp tiếp', () => {
    setViewport(1440, 800)
    topPx = 600                                  /* ngân sách còn 176 px */
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBe(384)
  })

  it('trả null dưới ngưỡng bề rộng, để màn hẹp tự cuộn', () => {
    setViewport(390, 844)
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBeNull()
  })

  it('chạy đúng khi môi trường không có ResizeObserver (jsdom)', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBe(900 - 300 - 24)

    /* Không có RO thì `resize` vẫn phải bám được — đó là mức tối thiểu hook
     * cam kết trong chú thích của nó. */
    setViewport(1440, 1000)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(heights.at(-1)).toBe(1000 - 300 - 24)
  })
})

describe('AC-3 — không còn observe(document.body) trong features/programming', () => {
  it('quét toàn bộ mã nguồn', () => {
    const root = join(cwd(), 'src/features/programming')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry)) continue
        if (/\.test\.tsx?$/.test(entry)) continue
        const source = readFileSync(full, 'utf8')
        /* Bắt cả `observe(document.body)` lẫn `observe(window.document.body)`
         * và biến thể có khoảng trắng. */
        if (/\.observe\(\s*(?:window\.)?document\.body\s*\)/.test(source)) offenders.push(full)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})

describe('useViewportFillHeight — observer phải gắn được khi node xuất hiện MUỘN', () => {
  /* Hồi quy đo được ngày 2026-09-17 trên trang thật.
   *
   * `useLayoutEffect` của lần mount chạy TRƯỚC callback ref, nên ở trang thật
   * `nodeRef.current` còn `null` lúc effect chạy. Bản sửa đầu tiên của #677 gắn
   * observer TRONG effect — đúng chỗ bản cũ gắn `observe(document.body)`, mà
   * `document.body` thì không cần node nên chỗ ấy vô hại với nó. Hệ quả:
   * observer không bao giờ được tạo, hook đo đúng một lần lúc chrome chưa dựng
   * xong rồi giữ mãi con số đó, và trang tràn dọc 43 px ở 1920×1080 —
   * `e2e/programming-workspace-height.spec.ts` bắt được, còn các ca jsdom ở
   * trên thì không, vì `Harness` của chúng gắn ref ngay từ lần render đầu.
   *
   * Ca này dựng lại đúng thứ tự của trang thật: cột chỉ xuất hiện ở lần render
   * thứ hai. */
  function LateHarness({ onHeight }: { onHeight?: (h: number | null) => void }) {
    const [attach, height] = useViewportFillHeight<HTMLDivElement>(WORKSPACE_OPTIONS)
    const [ready, setReady] = useState(false)
    useEffect(() => { setReady(true) }, [])
    onHeight?.(height)
    return (
      <div>
        <header data-testid="late-header" />
        {ready ? <div data-testid="late-column" ref={attach} style={height === null ? undefined : { height }} /> : null}
      </div>
    )
  }

  it('quan sát chrome phía trên dù effect chạy khi ref còn null', () => {
    const { getByTestId } = render(<LateHarness />)
    expect(FakeResizeObserver.allTargets()).toContain(getByTestId('late-header'))
  })

  it('vẫn đo lại khi chrome dựng xong sau lần đo đầu', () => {
    const heights: (number | null)[] = []
    const { getByTestId } = render(<LateHarness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBe(900 - 300 - 24)

    /* Chrome dựng xong đẩy cột xuống — không đo lại thì cột thừa 60 px và
     * trang tràn dọc đúng bằng chỗ ấy. */
    topPx = 360
    act(() => { FakeResizeObserver.fire(getByTestId('late-header')) })
    expect(heights.at(-1)).toBe(900 - 360 - 24)
  })
})

describe('useViewportFillHeight — phép đo bị lớp chống bập bênh chặn KHÔNG được bỏ rơi', () => {
  /* Khiếm khuyết do chính #677 sinh ra, phát hiện ngày 2026-09-17.
   *
   * Lớp chặn chuỗi `A → B → A` là đúng và cần thiết, nhưng bản đầu của nó
   * `return` thẳng: phép đo bị chặn biến mất hẳn thay vì được hoãn. Trong một
   * dao động thật thì không sao — sự kiện tiếp theo tới ngay sau đó. Vấn đề là
   * khi `A → B → A` là THAO TÁC THẬT rồi DỪNG: người dùng kéo mép cửa sổ ra
   * rồi kéo trả lại trong vài chục ms và thả tay. Giá trị đúng cuối cùng bị
   * chặn, không sự kiện nào tới nữa, và cột giữ mãi chiều cao trung gian —
   * đúng cú tràn dọc `DEV-PROG-021` mà AC-4 cấm, chỉ khác là nay do lớp sửa
   * của #677 gây ra chứ không do hằng số đoán.
   *
   * Cửa sổ thời gian là thứ phân biệt hai tình huống, nên bản sửa giữ nguyên
   * việc CHẶN và chỉ bỏ việc BỎ RƠI: hẹn đo lại đúng lúc cửa sổ khép. */
  it('cửa sổ chặn khép thì giá trị đúng vẫn phải tới nơi', () => {
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    expect(heights.at(-1)).toBe(900 - 300 - 24)

    let nowMs = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers()

    /* Kéo cửa sổ cao lên. */
    nowMs += 10
    setViewport(1440, 1000)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(heights.at(-1)).toBe(1000 - 300 - 24)

    /* Kéo trả lại NGAY — chuỗi `A → B → A` trong cùng cửa sổ. */
    nowMs += 10
    setViewport(1440, 900)
    act(() => { window.dispatchEvent(new Event('resize')) })
    /* Bị chặn ở đúng thời điểm này là HÀNH VI ĐÚNG: hook chưa phân biệt được
     * bập bênh với thao tác thật, và chặn là phía an toàn. */
    expect(heights.at(-1)).toBe(1000 - 300 - 24)

    /* Rồi người dùng thả tay: không còn sự kiện nào. Khi cửa sổ khép, phép đo
     * bị hoãn phải tới nơi — nếu không, cột cao 676 px trong viewport 900 px
     * bắt đầu ở mép 300 px, tức tài liệu 1000 px: tràn dọc 100 px. */
    act(() => {
      nowMs += 400
      vi.advanceTimersByTime(400)
    })
    expect(heights.at(-1)).toBe(900 - 300 - 24)
  })

  it('không tự sinh vòng đo vô hạn khi không có gì bị chặn', () => {
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    const rendersAfterMount = heights.length

    vi.useFakeTimers()
    act(() => { vi.advanceTimersByTime(5_000) })

    /* Không có phép đo nào bị hoãn thì không có hẹn giờ nào được đặt. */
    expect(heights.length).toBe(rendersAfterMount)
  })
})

describe('useViewportFillHeight — chrome MỚI xuất hiện phía trên phải được bám theo', () => {
  /* Khiếm khuyết do chính #677 sinh ra, phát hiện ngày 2026-09-17.
   *
   * Bản cũ `observe(document.body)` bám được MỌI kiểu chrome đổi, vì bất kỳ
   * dải nào chèn thêm phía trên cũng làm `body` cao lên. Bản sửa thu hẹp tập
   * quan sát xuống `chromeAbove(node)` — đúng để cắt vòng phản hồi, nhưng tập
   * ấy được chốt MỘT LẦN lúc gắn node và không bao giờ tính lại: options của
   * `DesignWorkspacePage` là ba số nguyên, nên `measure`/`observeChrome`/
   * `attach` giữ nguyên danh tính qua mọi lần render, callback ref không chạy
   * lại, và `useLayoutEffect` cũng không.
   *
   * Hệ quả: một banner xuất hiện GIỮA CHỪNG như một phần tử MỚI phía trên cột
   * không nằm trong tập quan sát, và các dải chrome cũ thì không đổi kích
   * thước — nên không phép đo nào chạy. Cột giữ nguyên chiều cao tính theo mép
   * trên CŨ, dài quá đáy đúng bằng chiều cao banner: lại là cú tràn dọc
   * `DEV-PROG-021` mà AC-4 cấm, và lần này nó ăn mất đúng năng lực
   * `DEV-PROG-024` mà hook sinh ra để có.
   *
   * Chú thích cũ ở `chromeAbove` khẳng định quan sát chrome phía trên "vẫn bắt
   * được một banner xuất hiện giữa chừng". Câu ấy chỉ đúng khi banner làm một
   * phần tử ĐÃ quan sát cao lên, và sai khi banner là phần tử MỚI — nên bản vá
   * đính chính nó tại chỗ chứ không chỉ sửa mã.
   *
   * Cách sửa: nghe THÊM/BỚT CON TRỰC TIẾP trên các phần tử cha, rồi tính lại
   * tập chrome và đo lại. Không `subtree`, nên mọi thay đổi bên TRONG cột —
   * gõ chữ, thêm khối FBD — không kích hoạt gì; và đặt chiều cao là một đổi
   * thuộc tính `style`, cũng không kích hoạt gì. Vòng phản hồi vẫn hở. */
  function BannerHarness({
    withBanner,
    onHeight,
  }: {
    withBanner: boolean
    onHeight?: (h: number | null) => void
  }) {
    const [attach, height] = useViewportFillHeight<HTMLDivElement>(WORKSPACE_OPTIONS)
    onHeight?.(height)
    return (
      <div data-testid="banner-shell">
        <header data-testid="banner-header" />
        {withBanner ? <div data-testid="late-banner" /> : null}
        <div data-testid="banner-column" ref={attach} style={height === null ? undefined : { height }}>
          <div data-testid="banner-column-child" />
        </div>
      </div>
    )
  }

  it('banner chèn thêm sau khi mount thì chiều cao được đo lại', async () => {
    const heights: (number | null)[] = []
    const record = (h: number | null) => heights.push(h)
    const { rerender } = render(<BannerHarness withBanner={false} onHeight={record} />)
    expect(heights.at(-1)).toBe(900 - 300 - 24)

    /* Banner cao 60 px chen vào giữa chrome cũ và cột: mép trên tụt xuống.
     * Không đo lại thì cột vẫn 576 px trên mép 360 px — tài liệu 936 px trong
     * viewport 900 px, tràn dọc đúng 36 px. */
    topPx = 360
    await act(async () => {
      rerender(<BannerHarness withBanner onHeight={record} />)
    })
    expect(heights.at(-1)).toBe(900 - 360 - 24)
  })

  it('banner mới rồi cũng được quan sát, nên nó cao lên tiếp vẫn bám được', async () => {
    const heights: (number | null)[] = []
    const record = (h: number | null) => heights.push(h)
    const { rerender, getByTestId } = render(<BannerHarness withBanner={false} onHeight={record} />)

    topPx = 360
    await act(async () => {
      rerender(<BannerHarness withBanner onHeight={record} />)
    })
    expect(FakeResizeObserver.allTargets()).toContain(getByTestId('late-banner'))

    topPx = 420
    act(() => { FakeResizeObserver.fire(getByTestId('late-banner')) })
    expect(heights.at(-1)).toBe(900 - 420 - 24)
  })

  it('thêm/bớt phần tử BÊN TRONG cột không kích hoạt đo lại — vòng phản hồi vẫn hở', async () => {
    const heights: (number | null)[] = []
    const { getByTestId } = render(<BannerHarness withBanner={false} onHeight={(h) => heights.push(h)} />)
    const rendersAfterMount = heights.length

    /* Đúng thứ hook KHÔNG được phản ứng: nội dung bên trong phần tử mà chính
     * nó đặt chiều cao. Nghe `subtree` ở đây là nối lại vòng phản hồi mà #677
     * sinh ra để cắt. */
    await act(async () => {
      getByTestId('banner-column').appendChild(document.createElement('div'))
    })
    expect(heights.length).toBe(rendersAfterMount)
  })
})

describe('useViewportFillHeight — bố cục LƯỠNG ỔN phải dừng hẳn, không chỉ chậm lại', () => {
  /* Khiếm khuyết thứ tư do chính #677 sinh ra, phát hiện ngày 2026-09-17.
   *
   * Ca hội tụ `AC-2` ở trên chạy ĐỒNG BỘ: nó không đẩy hẹn giờ và không cho
   * `performance.now()` tiến, nên lớp hoãn của lớp chặn bập bênh không bao giờ
   * chạy trong ca đó. Khẳng định mạnh nhất của nó — "50 nhịp cuối không đổi gì
   * nữa" — vì thế là tính chất của HARNESS, không phải của mã.
   *
   * Cho thời gian chạy thật thì lộ ra: 200 nhịp reflow trong 3200 ms cho 14
   * lần đổi giá trị, chuỗi `576 ↔ 536` đều đặn một lần mỗi cửa sổ 250 ms và
   * KHÔNG BAO GIỜ DỪNG. Tức `AC-2` ("số lần đổi state là hữu hạn và nhỏ") chỉ
   * đúng trong test chứ không đúng trên trình duyệt: bố cục vẫn rung, chỉ chậm
   * hơn 60 lần. Nguyên nhân là bố cục lưỡng ổn KHÔNG CÓ điểm bất động để hội
   * tụ về, nên mọi lớp "đo lại cho đúng" đều chỉ đổi nhịp rung chứ không dừng
   * được — phải CHỌN một giá trị mới dừng.
   *
   * Các ca dưới đây đẩy thời gian thật và khoá cả ba mặt: dừng hẳn, chọn đúng
   * giá trị không tràn, và không nuốt mất thao tác thật của người dùng. */
  function runOscillation(
    settled: (number | null)[],
    getByTestId: (id: string) => HTMLElement,
    ticks: number,
    clock: { nowMs: number },
  ) {
    for (let i = 0; i < ticks; i += 1) {
      const columnHeight = 900 - topPx - 24
      topPx = columnHeight > 560 ? 340 : 300
      act(() => {
        clock.nowMs += 16
        vi.advanceTimersByTime(16)
        FakeResizeObserver.fire(document.body)
        FakeResizeObserver.fire(getByTestId('app-header'))
        FakeResizeObserver.fire(getByTestId('context-strip'))
      })
    }
  }

  function startClock() {
    const clock = { nowMs: 1_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs)
    vi.useFakeTimers()
    return clock
  }

  it('dừng HẲN khi thời gian chạy thật, và chốt vào giá trị KHÔNG TRÀN', () => {
    const settled: (number | null)[] = []
    const { getByTestId } = render(
      <Harness onHeight={(h) => { if (settled.at(-1) !== h) settled.push(h) }} />,
    )
    const clock = startClock()

    runOscillation(settled, getByTestId, 200, clock)
    const afterOscillation = settled.length
    expect(afterOscillation).toBeLessThan(6)

    /* Không chỉ ít — phải HẾT. Bản chưa chốt cho 14 lần đổi ở đây và vẫn tăng
     * đều; 100 nhịp nữa mà không thêm lần nào mới là dừng thật. */
    runOscillation(settled, getByTestId, 100, clock)
    expect(settled.length).toBe(afterOscillation)

    /* Và phải dừng ở giá trị THẤP hơn trong cặp. Cột thấp hơn phần còn lại của
     * viewport chỉ để thừa một dải trống; cột cao hơn thì đẩy tài liệu dài quá
     * đáy — cú `DEV-PROG-021` mà `AC-4` cấm. */
    expect(settled.at(-1)).toBe(536)
  })

  it('một thao tác người dùng RỒI DỪNG vẫn tới nơi — chốt không nuốt mất nó', () => {
    /* Chiều ngược lại của ca trên. `A → B → A` rồi im cũng đi qua lớp chặn
     * đúng một lần, nên nếu chốt kích hoạt ngay chu kỳ đầu thì nó sẽ nuốt mất
     * giá trị cuối của người dùng — đúng khiếm khuyết mà lớp hoãn sinh ra để
     * sửa. Chốt vì thế đòi HAI chu kỳ liên tiếp, và ca này khoá con số đó. */
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    const clock = startClock()

    /* Kéo cửa sổ NHỎ LẠI rồi TO LẠI — chiều này mới phân biệt được ngưỡng.
     * Chốt luôn chọn giá trị nhỏ hơn trong cặp, nên nếu thao tác đi theo chiều
     * to-rồi-nhỏ thì giá trị đúng TÌNH CỜ trùng với giá trị chốt và ca không
     * canh được gì. Đi theo chiều nhỏ-rồi-to thì giá trị đúng là giá trị LỚN
     * hơn, và một cái chốt kích hoạt sớm sẽ kẹp người dùng xuống 476 px —
     * cột ngắn hơn 100 px so với chỗ họ vừa kéo tới. */
    clock.nowMs += 10
    setViewport(1440, 800)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(heights.at(-1)).toBe(800 - 300 - 24)

    clock.nowMs += 10
    setViewport(1440, 900)
    act(() => { window.dispatchEvent(new Event('resize')) })

    act(() => { clock.nowMs += 400; vi.advanceTimersByTime(400) })
    expect(heights.at(-1)).toBe(900 - 300 - 24)
  })

  it('đã chốt rồi, một giá trị NGOÀI cặp vẫn gỡ chốt — người dùng đổi cỡ cửa sổ không bị kẹt', () => {
    /* Chốt là trạng thái, và mọi trạng thái đều phải có lối ra. Bản đầu của
     * lớp chặn bập bênh từng khẳng định suông rằng "không có trạng thái khoá
     * vĩnh viễn nào để rơi vào" và câu đó đã sai một lần rồi, nên lần này lối
     * ra được khoá bằng ca test. */
    const settled: (number | null)[] = []
    const { getByTestId } = render(
      <Harness onHeight={(h) => { if (settled.at(-1) !== h) settled.push(h) }} />,
    )
    const clock = startClock()
    runOscillation(settled, getByTestId, 200, clock)
    expect(settled.at(-1)).toBe(536)

    /* Người dùng kéo cửa sổ thấp hẳn xuống: giá trị mới không thuộc cặp đang
     * chốt, nên nó phải được nhận. */
    topPx = 300
    setViewport(1440, 800)
    act(() => { clock.nowMs += 16; vi.advanceTimersByTime(16); window.dispatchEvent(new Event('resize')) })
    /* 476 — ngoài cặp `{576, 536}` và vẫn trên sàn 384, nên nó đo đúng việc gỡ
     * chốt chứ không lẫn với phép kẹp sàn. */
    expect(settled.at(-1)).toBe(800 - 300 - 24)

    /* Và đây mới là chỗ chốt PHẢI được gỡ chứ không chỉ bị bỏ qua: người dùng
     * kéo tiếp về đúng một giá trị THUỘC cặp cũ, ngay trong cửa sổ 250 ms. Nếu
     * chốt còn sống thì giá trị này bị nuốt và cửa sổ của họ kẹt ở 476 px. */
    setViewport(1440, 900)
    act(() => { clock.nowMs += 16; vi.advanceTimersByTime(16); window.dispatchEvent(new Event('resize')) })
    expect(settled.at(-1)).toBe(900 - 300 - 24)
  })
})

describe('useViewportFillHeight — chốt lưỡng ổn không được đóng nhầm vào thao tác ĐỔI CỠ CỬA SỔ', () => {
  /* Khiếm khuyết thứ năm do chính #677 sinh ra, phát hiện ngày 2026-09-17.
   *
   * Lớp chốt ở khối trên phân biệt "bố cục lưỡng ổn" với "thao tác người dùng"
   * bằng HÌNH DẠNG của chuỗi giá trị: hai chu kỳ "bị chặn rồi vẫn đổi" liên
   * tiếp thì chốt. Nhưng hai tình huống ấy cho CÙNG một hình dạng — chuỗi giá
   * trị không mang thông tin nào phân biệt được chúng. Ca "một thao tác người
   * dùng RỒI DỪNG vẫn tới nơi" ở trên không lộ ra điều đó vì nó chỉ đảo chiều
   * MỘT lần, tức đúng một chu kỳ, tức ngay dưới ngưỡng. Kéo qua lại thêm một
   * nhịp nữa là chạm ngưỡng, và bộ đếm còn cộng dồn qua cả những khoảng im
   * lặng hàng giờ vì không có gì làm nó hết hạn.
   *
   * Thứ phân biệt hai tình huống nằm ở NGUỒN của phép đo, không ở chuỗi giá
   * trị: bố cục lưỡng ổn tự lật mà không có đầu vào nào từ ngoài, còn đổi cỡ
   * cửa sổ thì phát `resize` — sự kiện mà bố cục không tự tạo ra được. */
  function startClock() {
    const clock = { nowMs: 1_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs)
    vi.useFakeTimers()
    return clock
  }

  it('hai đợt kéo cửa sổ cách nhau hàng giờ không cộng dồn thành một bố cục lưỡng ổn', () => {
    const heights: (number | null)[] = []
    render(<Harness onHeight={(h) => heights.push(h)} />)
    const clock = startClock()
    const drag = (viewportHeight: number, dtMs = 10) => {
      clock.nowMs += dtMs
      setViewport(1440, viewportHeight)
      act(() => { vi.advanceTimersByTime(dtMs); window.dispatchEvent(new Event('resize')) })
    }
    const flush = (ms: number) => act(() => { clock.nowMs += ms; vi.advanceTimersByTime(ms) })

    /* Đợt 1 — kéo qua lại rồi dừng lại ĐÚNG chỗ đã xuất phát. Chuỗi này để
     * lại trạng thái chẩn đoán mà bản trước không bao giờ dọn: phép đo cuối
     * trùng giá trị đang giữ nên nó thoát sớm, và cờ "vừa bị chặn" nằm lại. */
    drag(800)
    drag(900)
    drag(800)
    flush(400)

    /* Một giờ trôi qua. Mọi suy luận về bập bênh của đợt 1 đã phải hết hiệu
     * lực từ lâu — nhưng bản trước không có gì làm chúng hết hạn.
     *
     * Chỉ ĐỒNG HỒ tiến, không đẩy hẹn giờ: hook không còn hẹn giờ nào đang
     * chờ ở đây (đã `flush` ngay trên), và `advanceTimersByTime(3_600_000)`
     * sẽ bắn hết mọi hẹn giờ của MỌI module trong cùng môi trường — đo được
     * ngày 2026-09-17: nó làm `LibraryPage.test.tsx` gọi máy chủ và đỏ một ca
     * hoàn toàn không liên quan, trong khi chạy riêng thì xanh. Thứ ca này
     * cần là `performance.now()` đã đi xa, chứ không phải một giờ hẹn giờ
     * được thực thi. */
    clock.nowMs += 3_600_000

    /* Đợt 2 — một thao tác kéo qua lại bình thường khác, rồi dừng ở 900 px. */
    drag(900)
    drag(800)
    flush(400)
    drag(900, 16)
    flush(400)

    /* Cột phải theo đúng cửa sổ cuối. Bản trước cộng dồn chu kỳ của đợt 1 vào
     * đợt 2, chạm ngưỡng chốt, rồi kẹp cột vào giá trị NHỎ hơn của cặp: đo
     * được 476 px trong một cửa sổ 900 px đáng cho 576 px — mất 100 px chỗ gõ,
     * đúng cú `DEV-PROG-021` mà `AC-4` cấm. */
    expect(heights.at(-1)).toBe(900 - 300 - 24)
  })

  it('đã chốt vì lưỡng ổn THẬT, một lần đổi cỡ cửa sổ vẫn gỡ chốt dù giá trị mới THUỘC cặp', () => {
    /* Ca "giá trị NGOÀI cặp gỡ chốt" ở khối trên không với tới tình huống này:
     * ở đó giá trị mới tự nó đã nằm ngoài cặp nên chốt không chặn. Còn khi
     * người dùng kéo cửa sổ về đúng một giá trị THUỘC cặp, chuỗi giá trị
     * không phân biệt được họ với bố cục đang lật — chỉ nguồn phép đo phân
     * biệt được. */
    const settled: (number | null)[] = []
    const { getByTestId } = render(
      <Harness onHeight={(h) => { if (settled.at(-1) !== h) settled.push(h) }} />,
    )
    const clock = { nowMs: 1_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs)
    vi.useFakeTimers()

    /* Lưỡng ổn thật: chỉ `ResizeObserver` bắn, không `resize` nào. */
    for (let i = 0; i < 200; i += 1) {
      const columnHeight = 900 - topPx - 24
      topPx = columnHeight > 560 ? 340 : 300
      act(() => {
        clock.nowMs += 16
        vi.advanceTimersByTime(16)
        FakeResizeObserver.fire(getByTestId('app-header'))
        FakeResizeObserver.fire(getByTestId('context-strip'))
      })
    }
    expect(settled.at(-1)).toBe(536)

    /* Người dùng đổi cỡ cửa sổ, và giá trị mới rơi đúng vào GIÁ TRỊ KIA của
     * cặp đang chốt. Đây là đầu vào từ ngoài, nên nó phải được nhận. */
    topPx = 300
    act(() => { clock.nowMs += 16; vi.advanceTimersByTime(16); window.dispatchEvent(new Event('resize')) })
    expect(settled.at(-1)).toBe(576)
  })
})
