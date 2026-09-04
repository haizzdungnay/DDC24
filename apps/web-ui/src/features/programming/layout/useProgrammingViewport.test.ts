import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROGRAMMING_AUTHORING_MIN_WIDTH_PX,
  PROGRAMMING_INSPECTOR_DOCK_MIN_WIDTH_PX,
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
