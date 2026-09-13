import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
  PROGRAMMING_FBD_FOUR_COLUMN_MIN_WIDTH_PX,
  PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX,
  PROGRAMMING_WORKBENCH_COLUMNS_MIN_WIDTH_PX,
  PROGRAMMING_WORKBENCH_MINIMAP_MIN_WIDTH_PX,
  useMinWidth,
  useProgrammingInspectorMode,
} from './useProgrammingViewport'

/**
 * `T61-304` — hình thái Inspector, đo TRỰC TIẾP ở hook.
 *
 * Bộ này tồn tại vì một lý do cụ thể: jsdom **không có** `window.matchMedia` và
 * `innerWidth` mặc định là `1024`, nên mọi test dựng cây React đều rơi vào
 * nhánh dự phòng và đều nhận `'dock'`. Một bản làm nhánh ấy luôn trả `'dock'`
 * sẽ xanh qua toàn bộ bộ test giao diện — và người dùng tablet nhận lại đúng
 * cái CSS stack mà `T61-304` gỡ bỏ.
 */
const originalWidth = window.innerWidth

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

afterEach(() => {
  setWidth(originalWidth)
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('useProgrammingInspectorMode — nhánh dự phòng khi thiếu matchMedia', () => {
  it('chia đúng ba hình thái theo bề rộng, KHÔNG đoán mọi khổ thành desktop', () => {
    // Ngưỡng lấy từ chính hằng đã khoá, nhưng kỳ vọng viết bằng chuỗi TUYỆT
    // ĐỐI: so với hằng của sản phẩm thì hai vế cùng đổi và test xanh vĩnh viễn.
    expect(typeof window.matchMedia).toBe('undefined')

    setWidth(PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX)
    expect(renderHook(() => useProgrammingInspectorMode()).result.current).toBe('dock')

    setWidth(PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX - 1)
    expect(renderHook(() => useProgrammingInspectorMode()).result.current).toBe('drawer')

    setWidth(PROGRAMMING_AUTHORING_MIN_WIDTH_PX)
    expect(renderHook(() => useProgrammingInspectorMode()).result.current).toBe('drawer')

    setWidth(PROGRAMMING_AUTHORING_MIN_WIDTH_PX - 1)
    expect(renderHook(() => useProgrammingInspectorMode()).result.current).toBe('fullscreen')

    setWidth(390)
    expect(renderHook(() => useProgrammingInspectorMode()).result.current).toBe('fullscreen')
  })
})

describe('useProgrammingInspectorMode — nhánh matchMedia', () => {
  function stubMatchMedia(mode: 'dock' | 'drawer' | 'fullscreen') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: (query: string) => ({
        matches: query.includes('min-width: 1024px')
          ? mode === 'dock'
          : query.includes('max-width: 767px') ? mode === 'fullscreen' : false,
        media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
      }),
    })
  }

  for (const mode of ['dock', 'drawer', 'fullscreen'] as const) {
    it(`trả đúng ${mode}`, () => {
      stubMatchMedia(mode)
      expect(renderHook(() => useProgrammingInspectorMode()).result.current).toBe(mode)
    })
  }
})

/**
 * `REV-PGM02-FE-REFACTOR-2026-09-13` — ngưỡng ngoài thang mặc định của Tailwind
 * PHẢI đo được ở JavaScript, vì CSS không đo được chúng một cách tin cậy.
 *
 * Lý do rất cụ thể. Bố cục bốn cột của FBD và cột Mini Map của khay đáy từng
 * viết bằng một biến thể arbitrary cho 1440 px đấu với `md:`/`lg:`. Tailwind v4 xuất mọi
 * biến thể breakpoint không-mặc-định vào một cụm đứng TRƯỚC `sm/md/lg/xl`, nên
 * ở ≥1440 px hai rule cùng khớp và bản `md:`/`lg:` — đứng sau — thắng. Đo trên
 * Chrome 2026-09-13 tại 1680 px: Inspector `position: fixed` (đè lên thanh hành
 * động header) và khay đáy `grid-template-columns: 1025px 375px` (không có cột
 * Mini Map).
 *
 * Cả hai nay do `useMinWidth` quyết. Bộ này khoá chính nó — hai nhánh, vì jsdom
 * không có `matchMedia` còn trình duyệt thật thì có, và một bản chỉ đúng ở một
 * nhánh là một bản sẽ hỏng đúng ở nơi không ai chạy test.
 */
describe('useMinWidth — ngưỡng bố cục do JavaScript quyết', () => {
  it('nhánh dự phòng (không có matchMedia) so đúng theo innerWidth, bao gồm chính ngưỡng', () => {
    expect(typeof window.matchMedia).toBe('undefined')

    setWidth(1440)
    expect(renderHook(() => useMinWidth(1440)).result.current).toBe(true)

    setWidth(1439)
    expect(renderHook(() => useMinWidth(1440)).result.current).toBe(false)

    setWidth(1024)
    expect(renderHook(() => useMinWidth(1024)).result.current).toBe(true)

    setWidth(1023)
    expect(renderHook(() => useMinWidth(1024)).result.current).toBe(false)
  })

  it('nhánh matchMedia hỏi ĐÚNG truy vấn của ngưỡng được truyền vào', () => {
    const asked: string[] = []
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: (query: string) => {
        asked.push(query)
        return {
          matches: query === '(min-width: 1440px)',
          media: query, onchange: null,
          addEventListener: () => {}, removeEventListener: () => {},
          addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
        }
      },
    })

    expect(renderHook(() => useMinWidth(1440)).result.current).toBe(true)
    expect(renderHook(() => useMinWidth(1024)).result.current).toBe(false)
    /* Truy vấn phải mang đúng con số. Một bản ghim cứng `1440px` sẽ xanh ở ca
       đầu và sai ở mọi ngưỡng khác — đúng kiểu lỗi mà hai chỗ dùng chung hook
       này không thể tự phát hiện. */
    expect(asked).toContain('(min-width: 1440px)')
    expect(asked).toContain('(min-width: 1024px)')
  })

  it('hai hằng ngưỡng của bố cục Programming giữ đúng giá trị hợp đồng', () => {
    /* Viết bằng số TUYỆT ĐỐI: so hằng với chính nó thì test xanh vĩnh viễn.
       `TC-FBD-RESP-001` khoá 1440 cho bốn cột FBD; khay đáy dùng 1024 cho hai
       cột và 1440 cho cột Mini Map. */
    expect(PROGRAMMING_FBD_FOUR_COLUMN_MIN_WIDTH_PX).toBe(1440)
    expect(PROGRAMMING_WORKBENCH_MINIMAP_MIN_WIDTH_PX).toBe(1440)
    expect(PROGRAMMING_WORKBENCH_COLUMNS_MIN_WIDTH_PX).toBe(1024)
  })
})
