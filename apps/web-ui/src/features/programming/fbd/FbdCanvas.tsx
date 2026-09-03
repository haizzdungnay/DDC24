import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type { FbdEditorAction, FbdSelection } from './commands'
import {
  buildFbdNetworkGeometry,
  FBD_MINIMAP_HEIGHT,
  FBD_MINIMAP_NODE_THRESHOLD,
  FBD_MINIMAP_WIDTH,
} from './geometry'
import type { FbdDocument, FbdNetwork, FbdNode, FbdPoint } from './model'
import {
  clampScale,
  DEFAULT_VIEWPORT,
  nextViewport,
  screenToGraph,
  snapPoint,
  type FbdViewport,
  type ViewportRect,
} from './viewport'
import { boxSelectNodes, type FbdNodeBox } from './selection'
import {
  FbdGridPattern,
  FbdMarqueeLayer,
  FbdNodesLayer,
  FbdWiresLayer,
} from './FbdCanvasLayers'

const ZOOM_STEP = 0.2

interface PanState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

interface DragState {
  pointerId: number
  nodeId: string
  startX: number
  startY: number
  origins: Map<string, FbdPoint>
  currentPositions: Map<string, FbdPoint>
  isMulti: boolean
}

interface MarqueeState {
  pointerId: number
  startScreenX: number
  startScreenY: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface TouchPoint {
  x: number
  y: number
}

export interface FbdCanvasProps {
  network: FbdNetwork
  layout: FbdDocument['layout']
  selection: FbdSelection | null
  connectionFromPortId: string | null
  canEdit: boolean
  dispatch: Dispatch<FbdEditorAction>
  pick: (vi: string, en: string) => string
  registerPort: (portId: string, element: SVGGElement | null) => void
  wireStyle?: 'ORTHOGONAL' | 'BEZIER'
  gridVisible?: boolean
  snapEnabled?: boolean
  snapSize?: 4 | 8 | 16 | 32
  marqueeMode?: boolean
  selectionRevision?: number
}

export function FbdCanvas({
  network,
  layout,
  selection,
  connectionFromPortId,
  canEdit,
  dispatch,
  pick,
  registerPort,
  wireStyle = 'BEZIER',
  gridVisible = true,
  snapEnabled = true,
  snapSize = 8,
  marqueeMode = false,
  selectionRevision,
}: FbdCanvasProps) {
  const [viewport, setViewport] = useState<FbdViewport>(DEFAULT_VIEWPORT)
  const [pan, setPan] = useState<PanState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)

  const surfaceRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activePointersRef = useRef<Map<number, TouchPoint>>(new Map())
  const pinchStartDistRef = useRef<number | null>(null)
  const pinchStartViewportRef = useRef<FbdViewport | null>(null)

  const geometry = useMemo(
    () => buildFbdNetworkGeometry(network, layout, { wireStyle }),
    [network, layout, wireStyle]
  )
  const nodesById = useMemo(
    () => new Map(network.nodes.map((node) => [node.id, node])),
    [network.nodes]
  )

  const width = Math.max(geometry.width, 320)
  const height = Math.max(geometry.height, 200)

  function select(next: FbdSelection) {
    dispatch({ type: 'SELECT', selection: next })
  }

  function getSceneRect(): ViewportRect {
    if (surfaceRef.current) {
      const rect = surfaceRef.current.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width || width,
        height: rect.height || height,
      }
    }
    return { left: 0, top: 0, width, height }
  }

  // Cancel any gesture on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPan(null)
        setDrag(null)
        setMarquee(null)
        pinchStartDistRef.current = null
        pinchStartViewportRef.current = null
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Viewport Pan / Marquee on Canvas Background
  function handleBgPointerDown(event: React.PointerEvent<SVGRectElement>) {
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    // Pinch-to-zoom multi-touch (2 fingers)
    if (activePointersRef.current.size === 2) {
      setPan(null)
      setMarquee(null)
      const pts = Array.from(activePointersRef.current.values())
      pinchStartDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      pinchStartViewportRef.current = viewport
      return
    }

    const isMiddle = event.button === 1
    const isRight = event.button === 2
    const isSpaceLeft = event.button === 0 && event.shiftKey // or space / gesture
    const isTouchPan = event.pointerType === 'touch' && !marqueeMode && event.button === 0

    if (isMiddle || isRight || isSpaceLeft || isTouchPan) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setPan({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: viewport.x,
        originY: viewport.y,
      })
      return
    }

    // Marquee selection: Left click on background (or touch if marqueeMode = true)
    if (event.button === 0) {
      const sceneRect = getSceneRect()
      const pt = screenToGraph({ x: event.clientX, y: event.clientY }, viewport, sceneRect)
      event.currentTarget.setPointerCapture(event.pointerId)
      setMarquee({
        pointerId: event.pointerId,
        startScreenX: event.clientX,
        startScreenY: event.clientY,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      })
    }
  }

  function handleBgPointerMove(event: React.PointerEvent<SVGRectElement>) {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    // Handle 2-finger pinch
    if (activePointersRef.current.size === 2 && pinchStartDistRef.current && pinchStartViewportRef.current) {
      const pts = Array.from(activePointersRef.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (pinchStartDistRef.current > 0) {
        const factor = dist / pinchStartDistRef.current
        const newScale = clampScale(pinchStartViewportRef.current.scale * factor)
        setViewport((v) => nextViewport(v, { scale: newScale }))
      }
      return
    }

    if (pan && event.pointerId === pan.pointerId) {
      const dx = event.clientX - pan.startX
      const dy = event.clientY - pan.startY
      setViewport((v) => nextViewport(v, { x: pan.originX + dx, y: pan.originY + dy }))
      return
    }

    if (marquee && event.pointerId === marquee.pointerId) {
      const sceneRect = getSceneRect()
      const pt = screenToGraph({ x: event.clientX, y: event.clientY }, viewport, sceneRect)
      setMarquee({
        ...marquee,
        currentX: pt.x,
        currentY: pt.y,
      })
    }
  }

  function handleBgPointerUp(event: React.PointerEvent<SVGRectElement>) {
    activePointersRef.current.delete(event.pointerId)
    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null
      pinchStartViewportRef.current = null
    }

    if (pan && event.pointerId === pan.pointerId) {
      setPan(null)
      return
    }

    if (marquee && event.pointerId === marquee.pointerId) {
      const moved =
        Math.hypot(event.clientX - marquee.startScreenX, event.clientY - marquee.startScreenY) > 3

      if (!moved) {
        // Simple click on background -> clear selection
        dispatch({ type: 'SELECT', selection: null })
      } else {
        // Execute box selection
        const left = Math.min(marquee.startX, marquee.currentX)
        const top = Math.min(marquee.startY, marquee.currentY)
        const w = Math.abs(marquee.currentX - marquee.startX)
        const h = Math.abs(marquee.currentY - marquee.startY)

        const boxes: FbdNodeBox[] = geometry.nodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
        }))

        const selectedIds = boxSelectNodes(boxes, { left, top, width: w, height: h }, 'intersect')

        if (selectedIds.length === 0) {
          dispatch({ type: 'SELECT', selection: null })
        } else if (selectedIds.length === 1) {
          dispatch({
            type: 'SELECT',
            selection: { kind: 'node', networkId: network.id, nodeId: selectedIds[0] },
          })
        } else {
          dispatch({
            type: 'SELECT',
            selection: { kind: 'multi-node', networkId: network.id, nodeIds: selectedIds },
          })
        }
      }
      setMarquee(null)
    }
  }

  function handleBgPointerCancel(event: React.PointerEvent<SVGRectElement>) {
    activePointersRef.current.delete(event.pointerId)
    setPan(null)
    setMarquee(null)
    pinchStartDistRef.current = null
    pinchStartViewportRef.current = null
  }

  // Wheel Zoom with anchor preservation
  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const sceneRect = getSceneRect()
    const mouseScreen: FbdPoint = { x: event.clientX, y: event.clientY }
    const anchorGraph = screenToGraph(mouseScreen, viewport, sceneRect)

    const zoomDelta = event.deltaY < 0 ? 0.15 : -0.15
    const newScale = clampScale(viewport.scale + zoomDelta)

    if (newScale === viewport.scale) return

    // Keep point under cursor invariant
    // mouseScreen.x = sceneRect.left + newViewportX + anchorGraph.x * newScale
    const newX = mouseScreen.x - sceneRect.left - anchorGraph.x * newScale
    const newY = mouseScreen.y - sceneRect.top - anchorGraph.y * newScale

    setViewport({
      x: Math.round(newX),
      y: Math.round(newY),
      scale: newScale,
    })
  }

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
          networkId: network.id,
          moves,
          expectedSelectionRevision: selectionRevision,
        })
      } else {
        const pos = drag.currentPositions.get(drag.nodeId)
        if (pos) {
          dispatch({
            type: 'SET_NODE_POSITION',
            networkId: network.id,
            nodeId: drag.nodeId,
            x: pos.x,
            y: pos.y,
          })
        }
      }
    }
    setDrag(null)
  }

  function cancelDrag() {
    setDrag(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={pick('Thu phóng canvas', 'Canvas zoom')}>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 text-xs"
          onClick={() => setViewport((v) => nextViewport(v, { scale: v.scale - ZOOM_STEP }))}
        >
          {pick('Thu nhỏ', 'Zoom out')}
        </button>
        <span className="text-xs text-[var(--c-text-dim)]">{Math.round(viewport.scale * 100)}%</span>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 text-xs"
          onClick={() => setViewport((v) => nextViewport(v, { scale: v.scale + ZOOM_STEP }))}
        >
          {pick('Phóng to', 'Zoom in')}
        </button>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 text-xs"
          onClick={() => setViewport(DEFAULT_VIEWPORT)}
        >
          {pick('Vừa khung', 'Reset zoom')}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]"
      >
        <svg
          ref={surfaceRef}
          role="group"
          aria-label={pick(`Sơ đồ ${network.name}`, `${network.name} diagram`)}
          data-fbd-network-id={network.id}
          width={width * viewport.scale}
          height={height * viewport.scale}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-none"
          onContextMenu={(e) => e.preventDefault()}
          onWheel={handleWheel}
        >
          <FbdGridPattern networkId={network.id} snapSize={snapSize} gridVisible={gridVisible} />

          {/* Background rect for Pan and Marquee */}
          <rect
            data-fbd-canvas-bg="true"
            x={0}
            y={0}
            width={width}
            height={height}
            fill={gridVisible ? `url(#fbd-grid-${network.id})` : 'transparent'}
            onPointerDown={handleBgPointerDown}
            onPointerMove={handleBgPointerMove}
            onPointerUp={handleBgPointerUp}
            onPointerCancel={handleBgPointerCancel}
          />

          {/* Scene Transform Group */}
          <g
            data-fbd-scene="true"
            data-fbd-network-id={network.id}
            transform={
              viewport.x !== 0 || viewport.y !== 0
                ? `translate(${viewport.x}, ${viewport.y}) scale(1)`
                : undefined
            }
          >
            <FbdWiresLayer
              wires={geometry.wires}
              selection={selection}
              networkId={network.id}
              pick={pick}
              select={select}
            />

            <FbdNodesLayer
              nodes={geometry.nodes}
              nodesById={nodesById}
              selection={selection}
              connectionFromPortId={connectionFromPortId}
              canEdit={canEdit}
              networkId={network.id}
              tempPositions={drag?.currentPositions ?? null}
              select={select}
              beginDrag={beginDrag}
              moveDrag={moveDrag}
              endDrag={endDrag}
              cancelDrag={cancelDrag}
              registerPort={registerPort}
            />

            <FbdMarqueeLayer marquee={marquee} />
          </g>
        </svg>
      </div>

      {geometry.nodes.length > FBD_MINIMAP_NODE_THRESHOLD && (
        <svg
          role="group"
          aria-label={pick('Bản đồ thu nhỏ', 'Minimap')}
          width={FBD_MINIMAP_WIDTH}
          height={FBD_MINIMAP_HEIGHT}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="rounded border border-[var(--c-border)] bg-[var(--c-surface-2)]"
          onClick={(event) => {
            const container = scrollRef.current
            const box = event.currentTarget.getBoundingClientRect()
            if (!container || box.width === 0 || box.height === 0) return
            const ratioX = (event.clientX - box.left) / box.width
            const ratioY = (event.clientY - box.top) / box.height
            container.scrollLeft = ratioX * width * viewport.scale - container.clientWidth / 2
            container.scrollTop = ratioY * height * viewport.scale - container.clientHeight / 2
          }}
        >
          {geometry.nodes.map((placed) => (
            <rect
              key={placed.id}
              x={placed.x}
              y={placed.y}
              width={placed.width}
              height={placed.height}
              fill={
                selection?.kind === 'node' && selection.nodeId === placed.id
                  ? 'var(--c-accent)'
                  : 'var(--c-text-dim)'
              }
            />
          ))}
        </svg>
      )}

      {network.nodes.length === 0 && (
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick('Network trống — thêm block để bắt đầu.', 'Empty network — add a block to begin.')}
        </p>
      )}
    </div>
  )
}
