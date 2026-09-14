/**
 * Điều hướng nhanh của canvas FBD — Fit All / Fit Selection / 100%.
 *
 * Trước bản này canvas chỉ có ba nút `+ / − / Vừa khung`, mà "Vừa khung" thực
 * ra là `setViewport(DEFAULT_VIEWPORT)`: nó trả zoom về 100% và đưa gốc về
 * (0,0) — KHÔNG đưa sơ đồ vào khung nhìn. Trên một sơ đồ vừa bị pan ra ngoài,
 * nút duy nhất mang tên "vừa khung" lại không tìm lại được nội dung.
 *
 * Module thuần: chỉ hình học. Nó không biết DOM, nên tính được và test được
 * tách khỏi React.
 */
import { clampScale, MAX_FBD_SCALE, MIN_FBD_SCALE, type FbdViewport } from './viewport'
import type { FbdNodeGeometry } from './geometry'
import type { FbdPoint } from './model'

/** Lề giữ lại quanh nội dung khi fit, theo pixel màn hình. */
export const FBD_FIT_MARGIN = 32

export interface FbdBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function fbdBoundsSize(bounds: FbdBounds): { width: number; height: number } {
  return { width: Math.max(0, bounds.maxX - bounds.minX), height: Math.max(0, bounds.maxY - bounds.minY) }
}

export function fbdBoundsCenter(bounds: FbdBounds): FbdPoint {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

/**
 * Hộp bao của các khối. `ids` rỗng hoặc không khớp khối nào ⇒ `null` (phía gọi
 * phải tự quyết định nói gì, không được lặng lẽ fit vào một hộp bằng 0).
 */
export function fbdNodesBounds(
  nodes: readonly FbdNodeGeometry[],
  ids?: readonly string[] | ReadonlySet<string> | null,
): FbdBounds | null {
  const wanted = ids == null ? null : ids instanceof Set ? ids : new Set(ids)
  let bounds: FbdBounds | null = null
  for (const node of nodes) {
    if (wanted && !wanted.has(node.id)) continue
    const next: FbdBounds = {
      minX: node.x,
      minY: node.y,
      maxX: node.x + node.width,
      maxY: node.y + node.height,
    }
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, next.minX),
          minY: Math.min(bounds.minY, next.minY),
          maxX: Math.max(bounds.maxX, next.maxX),
          maxY: Math.max(bounds.maxY, next.maxY),
        }
      : next
  }
  return bounds
}

export interface FitViewportOptions {
  containerWidth: number
  containerHeight: number
  /** Trần zoom của phép fit. Fit All giữ 1 để chữ còn đọc được; Fit Selection
   * cho phép phóng to hơn vì mục đích của nó là xem kỹ vùng đang chọn. */
  maxScale?: number
  margin?: number
}

/**
 * Viewport đưa `bounds` vào giữa khung nhìn.
 *
 * Kết quả luôn kèm giả định `scrollLeft = scrollTop = 0` — canvas đặt lại cuộn
 * khi áp dụng. Có hai hệ dịch chuyển cùng tồn tại (cuộn native của khay + phép
 * `translate` của scene); trộn cả hai trong một phép fit là cách chắc chắn để
 * sơ đồ nhảy tới chỗ không ai đoán được.
 */
export function fitViewport(bounds: FbdBounds, options: FitViewportOptions): FbdViewport {
  const margin = options.margin ?? FBD_FIT_MARGIN
  const maxScale = options.maxScale ?? 1
  const { width, height } = fbdBoundsSize(bounds)
  const availableWidth = Math.max(1, options.containerWidth - margin * 2)
  const availableHeight = Math.max(1, options.containerHeight - margin * 2)

  const rawScale = Math.min(
    width > 0 ? availableWidth / width : maxScale,
    height > 0 ? availableHeight / height : maxScale,
  )
  const scale = clampScale(
    Math.min(Number.isFinite(rawScale) ? rawScale : maxScale, maxScale),
    MIN_FBD_SCALE,
    Math.min(maxScale, MAX_FBD_SCALE),
  )

  const center = fbdBoundsCenter(bounds)
  return {
    x: Math.round(options.containerWidth / 2 - center.x * scale),
    y: Math.round(options.containerHeight / 2 - center.y * scale),
    scale,
  }
}

/**
 * Đổi zoom mà GIỮ NGUYÊN điểm ở giữa khung nhìn.
 *
 * Dùng cho nút 100% và cho `+/−`: đổi `scale` mà không sửa `x/y` sẽ đẩy nội
 * dung trôi đi một đoạn tỉ lệ với khoảng cách tới gốc — đúng cái mà yêu cầu
 * gọi là "zoom về tâm không liên quan".
 */
export function zoomAroundCenter(
  viewport: FbdViewport,
  nextScale: number,
  containerWidth: number,
  containerHeight: number,
): FbdViewport {
  const scale = clampScale(nextScale)
  const current = clampScale(viewport.scale)
  if (scale === current) return viewport
  const centerX = (containerWidth / 2 - viewport.x) / current
  const centerY = (containerHeight / 2 - viewport.y) / current
  return {
    x: Math.round(containerWidth / 2 - centerX * scale),
    y: Math.round(containerHeight / 2 - centerY * scale),
    scale,
  }
}

/**
 * Đổi zoom mà giữ nguyên điểm graph dưới con trỏ — hành vi `Ctrl + wheel` của
 * mọi editor desktop.
 */
export function zoomAroundPoint(
  viewport: FbdViewport,
  nextScale: number,
  /** Điểm neo theo pixel, đã trừ gốc của mặt vẽ. */
  anchorLocal: FbdPoint,
): FbdViewport {
  const scale = clampScale(nextScale)
  const current = clampScale(viewport.scale)
  if (scale === current) return viewport
  const graphX = (anchorLocal.x - viewport.x) / current
  const graphY = (anchorLocal.y - viewport.y) / current
  return {
    x: Math.round(anchorLocal.x - graphX * scale),
    y: Math.round(anchorLocal.y - graphY * scale),
    scale,
  }
}
