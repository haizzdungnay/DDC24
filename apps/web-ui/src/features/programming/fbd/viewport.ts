import type { FbdPoint } from './model'

export interface FbdViewport {
  x: number
  y: number
  scale: number
}

export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

export const DEFAULT_VIEWPORT: FbdViewport = {
  x: 0,
  y: 0,
  scale: 1,
}

export const MIN_FBD_SCALE = 0.4
export const MAX_FBD_SCALE = 2.5

export function clampScale(scale: number, min = MIN_FBD_SCALE, max = MAX_FBD_SCALE): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    return 1
  }
  return Math.min(Math.max(scale, min), max)
}

export function screenToGraph(
  screenPoint: FbdPoint,
  viewport: FbdViewport,
  sceneRect: ViewportRect
): FbdPoint {
  const scale = viewport.scale || 1
  return {
    x: (screenPoint.x - sceneRect.left - viewport.x) / scale,
    y: (screenPoint.y - sceneRect.top - viewport.y) / scale,
  }
}

export function graphToScreen(
  graphPoint: FbdPoint,
  viewport: FbdViewport,
  sceneRect: ViewportRect
): FbdPoint {
  const scale = viewport.scale || 1
  return {
    x: sceneRect.left + viewport.x + graphPoint.x * scale,
    y: sceneRect.top + viewport.y + graphPoint.y * scale,
  }
}

export function snapPoint(point: FbdPoint, snapSize: number, bypassAlt = false): FbdPoint {
  if (bypassAlt || snapSize <= 0) {
    return point
  }
  return {
    x: Math.round(point.x / snapSize) * snapSize,
    y: Math.round(point.y / snapSize) * snapSize,
  }
}

export function nextViewport(
  current: FbdViewport,
  update: Partial<FbdViewport>
): FbdViewport {
  const rawX = update.x !== undefined && Number.isFinite(update.x) ? update.x : current.x
  const rawY = update.y !== undefined && Number.isFinite(update.y) ? update.y : current.y
  const rawScale =
    update.scale !== undefined && Number.isFinite(update.scale)
      ? clampScale(update.scale)
      : current.scale

  return {
    x: rawX,
    y: rawY,
    scale: rawScale,
  }
}
