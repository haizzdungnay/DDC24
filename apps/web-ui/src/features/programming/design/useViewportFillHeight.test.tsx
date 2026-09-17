/**
 * `#677` — hook đo chiều cao còn lại phải HỘI TỤ.
 *
 * Một test chỉ khẳng định "chiều cao đúng" không bắt được lỗi này: vòng lặp cũ
 * cho ra giá trị ĐÚNG ở mỗi vòng, nó chỉ không bao giờ dừng. Nên phần lớn các
 * ca dưới đây đếm số lần đổi state và soi tập phần tử được quan sát, chứ không
 * chỉ so một con số.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
    const root = join(__dirname, '..')
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
