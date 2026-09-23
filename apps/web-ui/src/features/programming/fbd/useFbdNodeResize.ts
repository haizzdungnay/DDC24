import { useState, useCallback } from 'react'
import type { FbdViewport } from './viewport'

export type FbdResizeMode = 'WIDTH' | 'HEIGHT' | 'BOTH'

export interface FbdResizeState {
  pointerId: number
  nodeId: string
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  currentWidth: number
  currentHeight: number
  mode: FbdResizeMode
}

export interface UseFbdNodeResizeOptions {
  canEdit: boolean
  viewport: FbdViewport
  snapEnabled: boolean
  snapSize: number
  minWidth?: (nodeId: string) => number
  minHeight?: (nodeId: string) => number
  onResizeEnd: (nodeId: string, width: number, height: number) => void
}

export interface UseFbdNodeResizeReturn {
  resize: FbdResizeState | null
  beginResize: (
    event: React.PointerEvent<SVGElement>,
    nodeId: string,
    mode: FbdResizeMode,
    currentWidth: number,
    currentHeight: number,
  ) => void
  moveResize: (event: React.PointerEvent<SVGElement>) => void
  endResize: (event: React.PointerEvent<SVGElement>) => void
  cancelResize: () => void
}

export function useFbdNodeResize({
  canEdit,
  viewport,
  snapEnabled,
  snapSize,
  minWidth,
  minHeight,
  onResizeEnd,
}: UseFbdNodeResizeOptions): UseFbdNodeResizeReturn {
  const [resize, setResize] = useState<FbdResizeState | null>(null)

  function beginResize(
    event: React.PointerEvent<SVGElement>,
    nodeId: string,
    mode: FbdResizeMode,
    currentWidth: number,
    currentHeight: number,
  ) {
    if (!canEdit || event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    setResize({
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: currentWidth,
      startHeight: currentHeight,
      currentWidth,
      currentHeight,
      mode,
    })
  }

  function moveResize(event: React.PointerEvent<SVGElement>) {
    if (!resize || event.pointerId !== resize.pointerId) return
    const currentScale = viewport.scale || 1
    const rawDx = (event.clientX - resize.startX) / currentScale
    const rawDy = (event.clientY - resize.startY) / currentScale

    const minW = minWidth ? minWidth(resize.nodeId) : 120
    const minH = minHeight ? minHeight(resize.nodeId) : 60

    let nextWidth = resize.startWidth
    let nextHeight = resize.startHeight

    if (resize.mode === 'WIDTH' || resize.mode === 'BOTH') {
      const rawWidth = resize.startWidth + rawDx
      nextWidth = Math.max(minW, rawWidth)
      if (snapEnabled && snapSize > 0) {
        nextWidth = Math.round(nextWidth / snapSize) * snapSize
        nextWidth = Math.max(minW, nextWidth)
      }
    }

    if (resize.mode === 'HEIGHT' || resize.mode === 'BOTH') {
      const rawHeight = resize.startHeight + rawDy
      nextHeight = Math.max(minH, rawHeight)
      if (snapEnabled && snapSize > 0) {
        nextHeight = Math.round(nextHeight / snapSize) * snapSize
        nextHeight = Math.max(minH, nextHeight)
      }
    }

    setResize({
      ...resize,
      currentWidth: Math.round(nextWidth),
      currentHeight: Math.round(nextHeight),
    })
  }

  function endResize(event: React.PointerEvent<SVGElement>) {
    if (!resize || event.pointerId !== resize.pointerId) return
    if (resize.currentWidth !== resize.startWidth || resize.currentHeight !== resize.startHeight) {
      onResizeEnd(resize.nodeId, resize.currentWidth, resize.currentHeight)
    }
    setResize(null)
  }

  const cancelResize = useCallback(() => setResize(null), [])

  return { resize, beginResize, moveResize, endResize, cancelResize }
}
