import { useState, useCallback, type Dispatch } from 'react'
import type { FbdEditorAction, FbdSelection } from './commands'
import type { FbdNodeGeometry } from './geometry'
import type { FbdNode, FbdPoint } from './model'
import { snapPoint, type FbdViewport } from './viewport'

export interface DragState {
  pointerId: number
  nodeId: string
  startX: number
  startY: number
  origins: Map<string, FbdPoint>
  currentPositions: Map<string, FbdPoint>
  isMulti: boolean
}

export interface UseFbdNodeDragOptions {
  canEdit: boolean
  viewport: FbdViewport
  snapEnabled: boolean
  snapSize: number
  geometry: {
    byNodeId: ReadonlyMap<string, FbdNodeGeometry>
  }
  selection: FbdSelection | null
  selectionRevision?: number
  networkId: string
  dispatch: Dispatch<FbdEditorAction>
}

export interface UseFbdNodeDragReturn {
  drag: DragState | null
  beginDrag: (event: React.PointerEvent<SVGGElement>, node: FbdNode) => void
  moveDrag: (event: React.PointerEvent<SVGGElement>) => void
  endDrag: (event: React.PointerEvent<SVGGElement>) => void
  cancelDrag: () => void
}

export function useFbdNodeDrag({
  canEdit,
  viewport,
  snapEnabled,
  snapSize,
  geometry,
  selection,
  selectionRevision,
  networkId,
  dispatch,
}: UseFbdNodeDragOptions): UseFbdNodeDragReturn {
  const [drag, setDrag] = useState<DragState | null>(null)

  // Node Dragging Handlers
  function beginDrag(event: React.PointerEvent<SVGGElement>, node: FbdNode) {
    if (!canEdit || event.button !== 0) return
    const placed = geometry.byNodeId.get(node.id)
    if (!placed) return

    event.currentTarget.setPointerCapture(event.pointerId)

    const isPartOfMulti =
      selection?.kind === 'multi-node' && selection.nodeIds.includes(node.id)

    const targetNodeIds = isPartOfMulti ? selection.nodeIds : [node.id]
    const origins = new Map<string, FbdPoint>()
    const currentPositions = new Map<string, FbdPoint>()

    for (const id of targetNodeIds) {
      const geo = geometry.byNodeId.get(id)
      if (geo) {
        origins.set(id, { x: geo.x, y: geo.y })
        currentPositions.set(id, { x: geo.x, y: geo.y })
      }
    }

    setDrag({
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      origins,
      currentPositions,
      isMulti: isPartOfMulti,
    })
  }

  function moveDrag(event: React.PointerEvent<SVGGElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const currentScale = viewport.scale || 1
    const rawDx = (event.clientX - drag.startX) / currentScale
    const rawDy = (event.clientY - drag.startY) / currentScale

    const bypassAlt = Boolean(event.altKey)
    const effectiveSnap = snapEnabled ? snapSize : 0

    const nextPositions = new Map<string, FbdPoint>()
    for (const [id, origin] of drag.origins.entries()) {
      const rawPos = { x: origin.x + rawDx, y: origin.y + rawDy }
      const snapped = snapPoint(rawPos, effectiveSnap, bypassAlt)
      nextPositions.set(id, snapped)
    }

    setDrag({
      ...drag,
      currentPositions: nextPositions,
    })
  }

  function endDrag(event: React.PointerEvent<SVGGElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const currentScale = viewport.scale || 1
    const rawDx = (event.clientX - drag.startX) / currentScale
    const rawDy = (event.clientY - drag.startY) / currentScale

    const moved = Math.abs(rawDx) > 0.5 || Math.abs(rawDy) > 0.5
    if (moved) {
      if (drag.isMulti) {
        const moves: Array<{ nodeId: string; x: number; y: number }> = []
        for (const [id, pos] of drag.currentPositions.entries()) {
          moves.push({ nodeId: id, x: pos.x, y: pos.y })
        }
        dispatch({
          type: 'MULTI_MOVE',
          networkId,
          moves,
          expectedSelectionRevision: selectionRevision,
        })
      } else {
        const pos = drag.currentPositions.get(drag.nodeId)
        if (pos) {
          dispatch({
            type: 'SET_NODE_POSITION',
            networkId,
            nodeId: drag.nodeId,
            x: pos.x,
            y: pos.y,
          })
        }
      }
    }
    setDrag(null)
  }

  const cancelDrag = useCallback(() => setDrag(null), [])

  return { drag, beginDrag, moveDrag, endDrag, cancelDrag }
}
