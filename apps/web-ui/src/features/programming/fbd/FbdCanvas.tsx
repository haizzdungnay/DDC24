import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type { FbdEditorAction, FbdSelection } from './commands'
import {
  buildFbdNetworkGeometry,
  FBD_MINIMAP_HEIGHT,
  FBD_MINIMAP_NODE_THRESHOLD,
  FBD_MINIMAP_WIDTH,
  type FbdPortGeometry,
} from './geometry'
import type { FbdDocument, FbdNetwork, FbdNode, FbdPoint, FbdWire } from './model'
import {
  clampScale,
  DEFAULT_VIEWPORT,
  nextViewport,
  screenToGraph,
  snapPoint,
  viewportSceneTransform,
  type FbdViewport,
  type ViewportRect,
} from './viewport'
import { boxSelectNodes, type FbdNodeBox } from './selection'
import {
  FbdGridPattern,
  FbdMarqueeLayer,
  FbdLayoutPreviewLayer,
  FbdNodesLayer,
  FbdWiresLayer,
  FbdWirePreviewLayer,
  FbdGhostLayer,
} from './FbdCanvasLayers'
import { fbdPaletteEntry, FBD_PALETTE, type FbdPaletteEntry } from './palette'
import { createUuid } from '../../../shared/crypto'
import { LIBRARY_DRAG_TYPE } from '../design/library/QuickLibraryPanel'
import { useSetFbdCanvasBridge, type FbdCanvasBridge } from '../design/workbench/WorkbenchMinimapPanel'
import { useFbdNodeDrag } from './useFbdNodeDrag'

export { LIBRARY_DRAG_TYPE }

export function buildPaletteNode(entry: FbdPaletteEntry): FbdNode {
  const ports = entry.buildPorts(entry.defaultType)
  return {
    id: createUuid(),
    kind: entry.kind,
    typeRef: entry.typeRef,
    executionOrder: 0,
    parameters: {},
    ports: ports.map((port, index) => ({
      id: createUuid(),
      name: port.name,
      direction: port.direction,
      dataType: port.dataType,
      unit: null,
      order: index,
    })),
  }
}

const ZOOM_STEP = 0.2

/** Đổi điểm client của Mini Map sang graph coordinate có tính phần letterbox
 * do `preserveAspectRatio="xMidYMid meet"`. Chia thẳng theo toàn bounding box
 * sẽ sai ở graph dài/hẹp và có thể đưa viewport sang nhầm vùng. */
export function minimapClientToGraph(
  client: FbdPoint,
  rect: ViewportRect,
  graphWidth: number,
  graphHeight: number,
): FbdPoint | null {
  if (rect.width <= 0 || rect.height <= 0 || graphWidth <= 0 || graphHeight <= 0) return null
  const scale = Math.min(rect.width / graphWidth, rect.height / graphHeight)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const renderedWidth = graphWidth * scale
  const renderedHeight = graphHeight * scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2
  return {
    x: Math.min(graphWidth, Math.max(0, (client.x - rect.left - offsetX) / scale)),
    y: Math.min(graphHeight, Math.max(0, (client.y - rect.top - offsetY) / scale)),
  }
}

interface PanState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
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

interface WireDragState {
  pointerId: number
  sourcePort: FbdPortGeometry
  cursor: FbdPoint
}

interface TouchPoint {
  x: number
  y: number
}

export interface FbdCanvasProps {
  network: FbdNetwork
  document?: FbdDocument
  layout: FbdDocument['layout']
  selection: FbdSelection | null
  issueNodeIds?: ReadonlySet<string>
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
  pendingPlacement?: { entryId: string } | null
  onCancelPlacement?: () => void
  onCommitPlacement?: () => void
  /** Ghost positions của Auto Layout; không tham gia geometry canonical. */
  layoutPreview?: Readonly<Record<string, FbdPoint>> | null
  showInlineMinimap?: boolean
  onBridgeChange?: (bridge: FbdCanvasBridge | null) => void
}

export function FbdCanvas({
  network,
  layout,
  selection,
  issueNodeIds,
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
  pendingPlacement,
  onCancelPlacement,
  onCommitPlacement,
  layoutPreview,
  showInlineMinimap = true,
  onBridgeChange,
}: FbdCanvasProps) {
  const [viewport, setViewport] = useState<FbdViewport>(DEFAULT_VIEWPORT)
  const [pan, setPan] = useState<PanState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [wireDrag, setWireDrag] = useState<WireDragState | null>(null)
  const [clickSourcePort, setClickSourcePort] = useState<FbdPortGeometry | null>(null)
  const [ghostPosition, setGhostPosition] = useState<FbdPoint | null>(null)
  const [nativeDragEntryId, setNativeDragEntryId] = useState<string | null>(null)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const [containerWidth, setContainerWidth] = useState<number>(0)

  const surfaceRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activePointersRef = useRef<Map<number, TouchPoint>>(new Map())
  const pinchStartDistRef = useRef<number | null>(null)
  const pinchStartViewportRef = useRef<FbdViewport | null>(null)
  const minimapPointerRef = useRef<number | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const nextH = Math.round(entry.contentRect.height)
          const nextW = Math.round(entry.contentRect.width)
          setContainerHeight((current) => (Math.abs(current - nextH) < 1 ? current : nextH))
          setContainerWidth((current) => (Math.abs(current - nextW) < 1 ? current : nextW))
        }
      })
      observer.observe(el)
      return () => observer.disconnect()
    }
  }, [])

  const geometry = useMemo(
    () => buildFbdNetworkGeometry(network, layout, { wireStyle }),
    [network, layout, wireStyle]
  )
  const nodesById = useMemo(
    () => new Map(network.nodes.map((node) => [node.id, node])),
    [network.nodes]
  )
  const portsById = useMemo(() => {
    const map = new Map<string, FbdPortGeometry>()
    for (const node of geometry.nodes) {
      for (const port of node.ports) {
        map.set(port.id, port)
      }
    }
    return map
  }, [geometry.nodes])

  const width = Math.max(geometry.width, containerWidth ? Math.floor(containerWidth / (viewport.scale || 1)) : 320, 320)
  /* CHIỀU CAO MẶT VẼ KHÔNG ĐƯỢC ĐỌC LẠI CHIỀU CAO DO CHÍNH NÓ TẠO RA.
   *
   * `containerHeight` là số `ResizeObserver` đo trên khay cuộn — mà mặt vẽ này
   * chính là nội dung của khay đó. Khi khay bị khung nhìn chặn (bố cục desktop
   * có chuỗi `min-h-0` đầy đủ) thì hai số độc lập nhau và công thức cũ chạy
   * đúng. Nhưng ở BẤT KỲ bố cục nào khay cao theo nội dung — mobile, và bất kỳ
   * lần nào một mắt `min-h-0` trong chuỗi cha bị đứt — thì nó thành vòng tự
   * nuôi: mặt vẽ cao `containerHeight + 800` ⇒ khay cao thêm 800 ⇒ vòng sau mặt
   * vẽ lại cao thêm 800, đo được đúng +800 px MỖI khung hình và không bao giờ
   * hội tụ. Trang không "giật" thấy được, nhưng mọi thao tác chờ bố cục đứng
   * yên đều treo — `TC-FBD-NAV-001`/`TC-FBD-DIAG-001` chết vì hết 60 s ở
   * "element is not stable", trên đúng lane mobile không có chuỗi chặn ấy.
   *
   * Ý đồ của số hạng này là "cho pan quá nội dung chừng một màn hình", nên đại
   * lượng đúng để lấy là CHIỀU CAO NHÌN THẤY, không phải chiều cao khay. Kẹp
   * bằng khung nhìn khiến công thức không còn tự tham chiếu: khi khay bị chặn,
   * giá trị y hệt trước; khi khay không bị chặn, vòng lặp mất hẳn. */
  const visibleHeight = Math.min(containerHeight || window.innerHeight, window.innerHeight)
  const height = Math.max(
    geometry.height + 600,
    Math.floor(visibleHeight / (viewport.scale || 1)) + 800,
    1600,
  )

  const { drag, beginDrag, moveDrag, endDrag, cancelDrag } = useFbdNodeDrag({
    canEdit,
    viewport,
    snapEnabled,
    snapSize,
    geometry,
    selection,
    selectionRevision,
    networkId: network.id,
    dispatch,
  })

  function select(next: FbdSelection) {
    dispatch({ type: 'SELECT', selection: next })
  }

  function navigateFromMinimap(clientX: number, clientY: number, element: SVGSVGElement) {
    const container = scrollRef.current
    if (!container) return
    const point = minimapClientToGraph(
      { x: clientX, y: clientY },
      element.getBoundingClientRect(),
      width,
      height,
    )
    if (!point) return
    /* Scene có thể đã được pan bằng translate pixel. Mini Map phải đưa chính
     * graph point về tâm vùng nhìn của scene hiện tại, không được giả x/y=0. */
    container.scrollLeft = viewport.x + point.x * viewport.scale - container.clientWidth / 2
    container.scrollTop = viewport.y + point.y * viewport.scale - container.clientHeight / 2
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

  const setBridge = useSetFbdCanvasBridge()

  useEffect(() => {
    return () => {
      setBridge?.(null)
      onBridgeChange?.(null)
    }
  }, [setBridge, onBridgeChange])

  useEffect(() => {
    const container = scrollRef.current
    const bridge: FbdCanvasBridge = {
      nodes: geometry.nodes,
      width,
      height,
      viewport,
      scale: viewport.scale,
      scrollPosition: container
        ? {
            left: container.scrollLeft,
            top: container.scrollTop,
            clientWidth: container.clientWidth,
            clientHeight: container.clientHeight,
          }
        : undefined,
      selection,
      onNavigate: (clientX, clientY, element) => navigateFromMinimap(clientX, clientY, element),
      onStepNavigate: (dx, dy) => {
        if (!container) return
        if (dx !== 0) container.scrollLeft += dx
        if (dy !== 0) container.scrollTop += dy
      },
      onZoomIn: () => setViewport((v) => nextViewport(v, { scale: v.scale + ZOOM_STEP })),
      onZoomOut: () => setViewport((v) => nextViewport(v, { scale: v.scale - ZOOM_STEP })),
      onResetZoom: () => setViewport(DEFAULT_VIEWPORT),
    }

    setBridge?.(bridge)
    onBridgeChange?.(bridge)
  }, [
    setBridge,
    geometry.nodes,
    height,
    onBridgeChange,
    selection,
    viewport,
    width,
  ])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || (!setBridge && !onBridgeChange)) return
    const handleScroll = () => {
      const scrollPos = {
        left: container.scrollLeft,
        top: container.scrollTop,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
      }
      setBridge?.((prev) => (prev ? { ...prev, scrollPosition: scrollPos } : null))
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [setBridge, onBridgeChange])

  // Cancel any gesture on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPan(null)
        cancelDrag()
        setMarquee(null)
        setWireDrag(null)
        setClickSourcePort(null)
        setGhostPosition(null)
        setNativeDragEntryId(null)
        pinchStartDistRef.current = null
        pinchStartViewportRef.current = null
        if (pendingPlacement) {
          onCancelPlacement?.()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pendingPlacement, onCancelPlacement, cancelDrag])

  // Window pointer listeners for reliable wire dragging across elements
  useEffect(() => {
    if (!wireDrag) return
    function handleWindowPointerMove(e: PointerEvent) {
      if (e.pointerId !== wireDrag?.pointerId) return
      const sceneRect = getSceneRect()
      const cursor = screenToGraph({ x: e.clientX, y: e.clientY }, viewport, sceneRect)
      setWireDrag((prev) => (prev ? { ...prev, cursor } : null))
    }
    function handleWindowPointerUp(e: PointerEvent) {
      if (e.pointerId === wireDrag?.pointerId) {
        setWireDrag(null)
      }
    }
    function handleWindowPointerCancel(e: PointerEvent) {
      if (e.pointerId === wireDrag?.pointerId) {
        setWireDrag(null)
      }
    }
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerCancel)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerCancel)
    }
  }, [wireDrag, viewport])

  // Viewport Pan / Marquee on Canvas Background
  function handleBgPointerDown(event: React.PointerEvent<SVGRectElement>) {
    if (pendingPlacement) return
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

    if (pendingPlacement) {
      const sceneRect = getSceneRect()
      const pt = screenToGraph({ x: event.clientX, y: event.clientY }, viewport, sceneRect)
      const effectiveSnap = snapEnabled ? snapSize : 0
      setGhostPosition(snapPoint(pt, effectiveSnap, event.altKey))
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

    if (wireDrag) {
      setWireDrag(null)
    }

    // Click-to-place placement commit
    if (pendingPlacement) {
      const entry = fbdPaletteEntry(pendingPlacement.entryId)
      if (canEdit && entry && entry.featureState === 'AVAILABLE') {
        const sceneRect = getSceneRect()
        const pt = screenToGraph({ x: event.clientX, y: event.clientY }, viewport, sceneRect)
        const effectiveSnap = snapEnabled ? snapSize : 0
        const position = snapPoint(pt, effectiveSnap, event.altKey)
        const node = buildPaletteNode(entry)
        dispatch({
          type: 'ADD_NODE',
          networkId: network.id,
          node,
          position,
        })
        onCommitPlacement?.()
      } else {
        onCancelPlacement?.()
      }
      setGhostPosition(null)
      return
    }

    if (pan && event.pointerId === pan.pointerId) {
      setPan(null)
      return
    }

    if (marquee && event.pointerId === marquee.pointerId) {
      const moved =
        Math.hypot(event.clientX - marquee.startScreenX, event.clientY - marquee.startScreenY) > 3

      if (!moved) {
        // Simple click on background -> clear selection and clickSourcePort
        dispatch({ type: 'SELECT', selection: null })
        setClickSourcePort(null)
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
    setWireDrag(null)
    setClickSourcePort(null)
    pinchStartDistRef.current = null
    pinchStartViewportRef.current = null
    if (pendingPlacement) {
      onCancelPlacement?.()
      setGhostPosition(null)
    }
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
    const newX = mouseScreen.x - sceneRect.left - anchorGraph.x * newScale
    const newY = mouseScreen.y - sceneRect.top - anchorGraph.y * newScale

    setViewport({
      x: Math.round(newX),
      y: Math.round(newY),
      scale: newScale,
    })
  }

  // Port Wire Drag & Click Handlers
  function handlePortPointerDown(event: React.PointerEvent<SVGGElement>, port: FbdPortGeometry) {
    if (!canEdit || event.button !== 0) return
    if (port.direction !== 'OUTPUT') return
    const sceneRect = getSceneRect()
    const cursor = screenToGraph({ x: event.clientX, y: event.clientY }, viewport, sceneRect)
    setWireDrag({
      pointerId: event.pointerId,
      sourcePort: port,
      cursor,
    })
  }

  function handlePortPointerUp(event: React.PointerEvent<SVGGElement>, port: FbdPortGeometry) {
    if (!wireDrag) return
    const source = wireDrag.sourcePort
    setWireDrag(null)
    if (!canEdit) return
    if (source.id === port.id || port.direction !== 'INPUT') return

    const wire: FbdWire = {
      id: createUuid(),
      from: { nodeId: source.nodeId, portId: source.id },
      to: { nodeId: port.nodeId, portId: port.id },
    }
    dispatch({
      type: 'ADD_WIRE',
      networkId: network.id,
      wire,
    })
  }

  function handlePortClick(event: React.MouseEvent<SVGGElement>, port: FbdPortGeometry) {
    if (!canEdit) {
      select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
      return
    }

    const isCtrl = event.ctrlKey || event.metaKey
    const activeSource =
      clickSourcePort || (connectionFromPortId ? portsById.get(connectionFromPortId) : null)

    if (activeSource && activeSource.id !== port.id && port.direction === 'INPUT') {
      const wire: FbdWire = {
        id: createUuid(),
        from: { nodeId: activeSource.nodeId, portId: activeSource.id },
        to: { nodeId: port.nodeId, portId: port.id },
      }
      dispatch({ type: 'ADD_WIRE', networkId: network.id, wire })
      setClickSourcePort(null)
      return
    }

    if (port.direction === 'OUTPUT' && (isCtrl || activeSource === null)) {
      setClickSourcePort(port)
      dispatch({ type: 'BEGIN_OR_COMMIT_CONNECTION', portId: port.id })
      select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
      return
    }

    setClickSourcePort(null)
    select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
  }

  // Computed Wire Preview
  const wirePreview = useMemo(() => {
    if (wireDrag) {
      return {
        from: { x: wireDrag.sourcePort.cx, y: wireDrag.sourcePort.cy },
        to: wireDrag.cursor,
      }
    }
    if (clickSourcePort && ghostPosition) {
      return {
        from: { x: clickSourcePort.cx, y: clickSourcePort.cy },
        to: ghostPosition,
      }
    }
    return null
  }, [wireDrag, clickSourcePort, ghostPosition])

  // Computed Ghost Preview
  const ghost = useMemo(() => {
    const entryId = pendingPlacement?.entryId || nativeDragEntryId
    if (entryId && ghostPosition) {
      return {
        typeRef: entryId,
        x: ghostPosition.x,
        y: ghostPosition.y,
      }
    }
    return null
  }, [pendingPlacement, nativeDragEntryId, ghostPosition])

  function extractDragEntryId(event: React.DragEvent<SVGSVGElement>): string | null {
    const prefix = `${LIBRARY_DRAG_TYPE}/`
    const typeWithId = Array.from(event.dataTransfer.types).find((t) =>
      t.toLowerCase().startsWith(prefix.toLowerCase())
    )
    if (typeWithId) {
      const raw = typeWithId.slice(prefix.length)
      const matched = FBD_PALETTE.find((e) => e.id.toLowerCase() === raw.toLowerCase())
      return matched?.id ?? raw.toUpperCase()
    }
    const direct = event.dataTransfer.getData(LIBRARY_DRAG_TYPE)
    return direct || null
  }

  function handleDragEnter(event: React.DragEvent<SVGSVGElement>) {
    if (!canEdit) return
    const prefix = `${LIBRARY_DRAG_TYPE}/`
    const hasLibraryType = Array.from(event.dataTransfer.types).some(
      (t) =>
        t.toLowerCase() === LIBRARY_DRAG_TYPE.toLowerCase() ||
        t.toLowerCase().startsWith(prefix.toLowerCase())
    )
    if (!hasLibraryType) return
    const entryId = extractDragEntryId(event)
    if (entryId) {
      setNativeDragEntryId(entryId)
    }
  }

  function handleDragOver(event: React.DragEvent<SVGSVGElement>) {
    if (!canEdit) return
    const prefix = `${LIBRARY_DRAG_TYPE}/`
    const hasLibraryType = Array.from(event.dataTransfer.types).some(
      (t) =>
        t.toLowerCase() === LIBRARY_DRAG_TYPE.toLowerCase() ||
        t.toLowerCase().startsWith(prefix.toLowerCase())
    )
    if (!hasLibraryType) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'

    const entryId = extractDragEntryId(event)
    if (entryId && nativeDragEntryId !== entryId) {
      setNativeDragEntryId(entryId)
    }

    const sceneRect = getSceneRect()
    const rawClientX = (event as unknown as { clientX?: number }).clientX ?? (event as unknown as { pageX?: number }).pageX
    const rawClientY = (event as unknown as { clientY?: number }).clientY ?? (event as unknown as { pageY?: number }).pageY
    const clientX = typeof rawClientX === 'number' && Number.isFinite(rawClientX) ? rawClientX : 0
    const clientY = typeof rawClientY === 'number' && Number.isFinite(rawClientY) ? rawClientY : 0
    const pt = screenToGraph({ x: clientX, y: clientY }, viewport, sceneRect)
    const effectiveSnap = snapEnabled ? snapSize : 0
    setGhostPosition(snapPoint(pt, effectiveSnap, event.altKey))
  }

  function handleDragLeave(event: React.DragEvent<SVGSVGElement>) {
    // Chỉ reset khi con trỏ thật sự rời khỏi SVG surface (tránh reset khi di chuyển giữa các phần tử con bên trong SVG)
    if (event.relatedTarget && surfaceRef.current?.contains(event.relatedTarget as Node)) {
      return
    }
    setNativeDragEntryId(null)
    setGhostPosition(null)
  }

  function handleDrop(event: React.DragEvent<SVGSVGElement>) {
    if (!canEdit) return
    const entryId = event.dataTransfer.getData(LIBRARY_DRAG_TYPE) || extractDragEntryId(event)
    if (!entryId) return
    event.preventDefault()

    setNativeDragEntryId(null)
    setGhostPosition(null)

    const entry = fbdPaletteEntry(entryId)
    if (!entry || entry.featureState !== 'AVAILABLE') return

    const sceneRect = getSceneRect()
    const rawClientX = (event as unknown as { clientX?: number }).clientX ?? (event as unknown as { pageX?: number }).pageX
    const rawClientY = (event as unknown as { clientY?: number }).clientY ?? (event as unknown as { pageY?: number }).pageY
    const clientX = typeof rawClientX === 'number' && Number.isFinite(rawClientX) ? rawClientX : 0
    const clientY = typeof rawClientY === 'number' && Number.isFinite(rawClientY) ? rawClientY : 0
    const pt = screenToGraph({ x: clientX, y: clientY }, viewport, sceneRect)
    const effectiveSnap = snapEnabled ? snapSize : 0
    const position = snapPoint(pt, effectiveSnap, event.altKey)
    const node = buildPaletteNode(entry)
    dispatch({
      type: 'ADD_NODE',
      networkId: network.id,
      node,
      position,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={pick('Thu phóng canvas', 'Canvas zoom')}>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="h-7 rounded border border-[var(--c-border)] px-2 text-xs hover:bg-[var(--c-surface-2)]"
          onClick={() => setViewport((v) => nextViewport(v, { scale: v.scale - ZOOM_STEP }))}
        >
          {pick('Thu nhỏ', 'Zoom out')}
        </button>
        <span className="text-xs text-[var(--c-text-dim)]">{Math.round(viewport.scale * 100)}%</span>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="h-7 rounded border border-[var(--c-border)] px-2 text-xs hover:bg-[var(--c-surface-2)]"
          onClick={() => setViewport((v) => nextViewport(v, { scale: v.scale + ZOOM_STEP }))}
        >
          {pick('Phóng to', 'Zoom in')}
        </button>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="h-7 rounded border border-[var(--c-border)] px-2 text-xs hover:bg-[var(--c-surface-2)]"
          onClick={() => setViewport(DEFAULT_VIEWPORT)}
        >
          {pick('Vừa khung', 'Reset zoom')}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]"
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
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
            transform={viewportSceneTransform(viewport)}
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
              issueNodeIds={issueNodeIds}
              pick={pick}
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
              onPortPointerDown={handlePortPointerDown}
              onPortPointerUp={handlePortPointerUp}
              onPortClick={handlePortClick}
            />

            <FbdLayoutPreviewLayer nodes={geometry.nodes} positions={layoutPreview ?? null} />

            <FbdWirePreviewLayer preview={wirePreview} wireStyle={wireStyle} />

            <FbdGhostLayer ghost={ghost} />

            <FbdMarqueeLayer marquee={marquee} />
          </g>
        </svg>
      </div>

      {showInlineMinimap && geometry.nodes.length > FBD_MINIMAP_NODE_THRESHOLD && (
        <svg
          role="group"
          aria-label={pick('Bản đồ thu nhỏ', 'Minimap')}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          tabIndex={0}
          data-fbd-minimap="true"
          width={FBD_MINIMAP_WIDTH}
          height={FBD_MINIMAP_HEIGHT}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="rounded border border-[var(--c-border)] bg-[var(--c-surface-2)]"
          onPointerDown={(event) => {
            minimapPointerRef.current = event.pointerId
            event.currentTarget.setPointerCapture(event.pointerId)
            navigateFromMinimap(event.clientX, event.clientY, event.currentTarget)
          }}
          onPointerMove={(event) => {
            if (minimapPointerRef.current !== event.pointerId) return
            navigateFromMinimap(event.clientX, event.clientY, event.currentTarget)
          }}
          onPointerUp={(event) => {
            if (minimapPointerRef.current !== event.pointerId) return
            navigateFromMinimap(event.clientX, event.clientY, event.currentTarget)
            minimapPointerRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={(event) => {
            if (minimapPointerRef.current === event.pointerId) minimapPointerRef.current = null
          }}
          onKeyDown={(event) => {
            const container = scrollRef.current
            if (!container) return
            const step = snapSize * 4 * viewport.scale
            if (event.key === 'ArrowLeft') container.scrollLeft -= step
            else if (event.key === 'ArrowRight') container.scrollLeft += step
            else if (event.key === 'ArrowUp') container.scrollTop -= step
            else if (event.key === 'ArrowDown') container.scrollTop += step
            else return
            event.preventDefault()
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
