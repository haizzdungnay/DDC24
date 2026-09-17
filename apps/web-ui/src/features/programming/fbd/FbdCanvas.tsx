import { Crosshair, Maximize, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import type { FbdRuntimeOverlay } from './runtimeOverlay'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject } from 'react'
import type { FbdEditorAction, FbdSelection } from './commands'
import {
  buildFbdNetworkGeometry,
  FBD_MINIMAP_HEIGHT,
  FBD_MINIMAP_NODE_THRESHOLD,
  FBD_MINIMAP_WIDTH,
  type FbdPortGeometry,
} from './geometry'
import {
  FBD_PROFILE_ID,
  FBD_SCHEMA_VERSION,
  type FbdDocument,
  type FbdNetwork,
  type FbdNode,
  type FbdPoint,
} from './model'
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
import { userPouPaletteEntry, type UserPouInterface } from './userPou'
import { FbdNodeHoverCard } from './FbdNodeHoverCard'
import { FbdBlockPropertiesModal } from './FbdBlockPropertiesModal'
import { createUuid } from '../../../shared/crypto'
import { LIBRARY_DRAG_TYPE } from '../design/library/QuickLibraryPanel'
import { useSetFbdCanvasBridge, type FbdCanvasBridge } from '../design/workbench/WorkbenchMinimapPanel'
import { useFbdNodeDrag } from './useFbdNodeDrag'
import type {
  ProgrammingBinding,
  ProgrammingPointCatalogEntry,
  ProgrammingProgram,
  ProgrammingVariable,
} from '../model/types'
import {
  describeWireRejection,
  evaluateWireCandidate,
  nodeAtPoint,
  orientWireEndpoints,
  portAtPoint,
  resolveWireDropTarget,
  type FbdWireCandidate,
} from './wiring'
import { fbdNodesBounds, fitViewport, zoomAroundCenter, zoomAroundPoint } from './fitView'
import { FbdContextMenu, type FbdContextMenuItem } from './FbdContextMenu'

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
/** Bước zoom của `Ctrl + wheel`. Nhỏ hơn bước nút bấm vì con lăn phát nhiều
 * nhịp liên tiếp. */
const WHEEL_ZOOM_STEP = 0.12
/** Bước cuộn của một nhịp con lăn khi trình duyệt không cấp `deltaY` theo px. */
const WHEEL_LINE_HEIGHT = 40

/** Đổi điểm client của Mini Map sang graph coordinate có tính phần letterbox
 * do `preserveAspectRatio="xMidYMid meet"`. Chia thẳng theo toàn bounding box
 * sẽ sai ở graph dài/hẹp và có thể đưa viewport sang nhầm vùng. */
export function minimapClientToGraph(
  client: FbdPoint,
  rect: ViewportRect,
  graphWidth: number,
  graphHeight: number,
  viewBoxOrigin?: FbdPoint,
): FbdPoint | null {
  if (rect.width <= 0 || rect.height <= 0 || graphWidth <= 0 || graphHeight <= 0) return null
  const scale = Math.min(rect.width / graphWidth, rect.height / graphHeight)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const renderedWidth = graphWidth * scale
  const renderedHeight = graphHeight * scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2
  const ox = viewBoxOrigin?.x ?? 0
  const oy = viewBoxOrigin?.y ?? 0
  return {
    x: ox + Math.min(graphWidth, Math.max(0, (client.x - rect.left - offsetX) / scale)),
    y: oy + Math.min(graphHeight, Math.max(0, (client.y - rect.top - offsetY) / scale)),
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
  /** `Ctrl`/`Shift` khi bắt đầu ⇒ cộng vào vùng chọn hiện có thay vì thay thế. */
  additive: boolean
}

interface WireDragState {
  pointerId: number
  sourcePort: FbdPortGeometry
  startClientX: number
  startClientY: number
  cursor: FbdPoint
  /** Định danh của dây sẽ được ghi. Giữ NGUYÊN suốt cử chỉ để phán quyết hiện
   * trên màn hình đúng là phán quyết của dây được ghi. */
  wireId: string
  candidate: FbdWireCandidate | null
}

interface TouchPoint {
  x: number
  y: number
}

type FbdContextTarget =
  | { kind: 'canvas' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'port'; nodeId: string; portId: string; direction: 'INPUT' | 'OUTPUT' }
  | { kind: 'wire'; wireId: string }

interface ContextMenuState {
  clientX: number
  clientY: number
  graph: FbdPoint
  target: FbdContextTarget
}

/** Lệnh khung nhìn mà tầng gọi (thanh công cụ, phím tắt) cần gọi được.
 *
 * Đưa qua một `ref` chứ không qua callback prop: mọi lệnh ở đây đều đọc
 * `viewport` hiện tại, nên phát chúng ra ngoài theo state sẽ bắt cả cây con
 * render lại mỗi nhịp pan. */
export interface FbdViewCommands {
  fitAll: () => void
  fitSelection: () => void
  zoom100: () => void
  zoomIn: () => void
  zoomOut: () => void
}

/** Thao tác clipboard do editor sở hữu (nó giữ vùng đệm và biết network đích). */
export interface FbdCanvasClipboard {
  hasContent: boolean
  copy: (nodeIds: readonly string[]) => void
  cut: (nodeIds: readonly string[]) => void
  paste: (at: FbdPoint | null) => void
  duplicate: (nodeIds: readonly string[]) => void
}

export interface FbdCanvasProps {
  network: FbdNetwork
  document?: FbdDocument
  layout: FbdDocument['layout']
  selection: FbdSelection | null
  issueNodeIds?: ReadonlySet<string>
  /** Giá trị runtime đã trình bày xong; `null` = chế độ này không có nguồn. */
  runtime?: FbdRuntimeOverlay | null
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
  /** Vùng đệm sao chép của editor; vắng thì menu ẩn các mục clipboard. */
  clipboard?: FbdCanvasClipboard
  /** Canvas ghi các lệnh khung nhìn của mình vào đây cho editor gọi. */
  viewCommandsRef?: MutableRefObject<FbdViewCommands | null>
  /** Thêm khối tại một điểm graph (menu "Thêm khối tại đây"). */
  onAddBlockAt?: (at: FbdPoint) => void
  userPouInterfaces?: readonly UserPouInterface[]
  /** Yêu cầu mở picker ánh xạ điểm cho một cổng. */
  onRequestPortMapping?: (info: { nodeId: string; portId: string; portName: string; nodeName: string; portDirection: 'INPUT' | 'OUTPUT'; portDataType: string }) => void
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  programs?: readonly ProgrammingProgram[]
}

export function FbdCanvas({
  network,
  document: fbdDocument,
  layout,
  selection,
  issueNodeIds,
  runtime,
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
  clipboard,
  viewCommandsRef,
  onAddBlockAt,
  userPouInterfaces,
  onRequestPortMapping,
  bindings,
  variables,
  pointCatalogItems,
  programs,
}: FbdCanvasProps) {
  const [propertiesModalNodeId, setPropertiesModalNodeId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<FbdViewport>(DEFAULT_VIEWPORT)
  const [pan, setPan] = useState<PanState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [wireDrag, setWireDrag] = useState<WireDragState | null>(null)
  const [clickSourcePort, setClickSourcePort] = useState<FbdPortGeometry | null>(null)
  const [clickWireId, setClickWireId] = useState<string | null>(null)
  const [clickCandidate, setClickCandidate] = useState<FbdWireCandidate | null>(null)
  const [reconnectWireId, setReconnectWireId] = useState<string | null>(null)
  const [ghostPosition, setGhostPosition] = useState<FbdPoint | null>(null)
  const [nativeDragEntryId, setNativeDragEntryId] = useState<string | null>(null)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const [containerWidth, setContainerWidth] = useState<number>(0)
  const [hover, setHover] = useState<{ nodeId: string | null; portId: string | null; wireId: string | null }>(
    { nodeId: null, portId: null, wireId: null },
  )
  const [hoverTooltip, setHoverTooltip] = useState<{
    nodeId: string
    position: { x: number; y: number }
  } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  /** Câu phản hồi hiện trên mặt vẽ (lý do từ chối nối, kết quả fit…). Vùng
   * `aria-live` của editor chỉ dành cho trình đọc màn hình; thao tác chuột cần
   * một câu người dùng ĐỌC ĐƯỢC ngay tại chỗ tay đang làm. */
  const [flash, setFlash] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)

  const surfaceRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activePointersRef = useRef<Map<number, TouchPoint>>(new Map())
  const pinchStartDistRef = useRef<number | null>(null)
  const pinchStartViewportRef = useRef<FbdViewport | null>(null)
  const minimapPointerRef = useRef<number | null>(null)
  const pointerInsideRef = useRef(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFlash = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setFlash({ text, tone })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), 4000)
  }, [])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

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

  /** Tài liệu dùng cho phép kiểm hợp lệ của dây. Prop `document` là nguồn đúng
   * (validator cần thấy cả graph); vắng nó thì dựng một tài liệu một-network
   * quanh chính network đang vẽ, đủ cho mọi luật trong `validateFbdWireCandidate`. */
  const validationDocument = useMemo<FbdDocument>(() => {
    if (fbdDocument) return fbdDocument
    const document: FbdDocument = {
      $schema: '../../fbd_v1.schema.json',
      schemaVersion: FBD_SCHEMA_VERSION,
      profileId: FBD_PROFILE_ID,
      graphId: network.id,
      name: network.name,
      networks: [network],
      ...(layout ? { layout } : {}),
    }
    return document
  }, [fbdDocument, network, layout])

  /** Khi nối lại, phép xem trước phải bỏ chính dây cũ trước khi kiểm `wire.id`
   * và driver của INPUT. Đây cũng là đúng tài liệu reducer dùng để quyết định
   * atomic: ứng viên sai thì dây cũ vẫn còn nguyên. */
  const clickValidationDocument = useMemo<FbdDocument>(() => {
    if (!reconnectWireId) return validationDocument
    return {
      ...validationDocument,
      networks: validationDocument.networks.map((item) => item.id === network.id
        ? { ...item, wires: item.wires.filter((wire) => wire.id !== reconnectWireId) }
        : item),
    }
  }, [validationDocument, network.id, reconnectWireId])

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

  /** Các khối đang chọn, theo mọi dạng selection. */
  const selectedNodeIds = useMemo<string[]>(() => {
    if (!selection || selection.networkId !== network.id) return []
    if (selection.kind === 'node') return [selection.nodeId]
    if (selection.kind === 'multi-node') return [...selection.nodeIds]
    if (selection.kind === 'port') return [selection.nodeId]
    if (selection.kind === 'wire') {
      const wire = network.wires.find((item) => item.id === selection.wireId)
      return wire ? [wire.from.nodeId, wire.to.nodeId] : []
    }
    return []
  }, [selection, network.id, network.wires])

  function selectNodes(ids: readonly string[]) {
    if (ids.length === 0) {
      dispatch({ type: 'SELECT', selection: null })
      return
    }
    if (ids.length === 1) {
      dispatch({ type: 'SELECT', selection: { kind: 'node', networkId: network.id, nodeId: ids[0] } })
      return
    }
    dispatch({ type: 'SELECT', selection: { kind: 'multi-node', networkId: network.id, nodeIds: [...ids] } })
  }

  function navigateFromMinimap(clientX: number, clientY: number, element: SVGSVGElement) {
    const container = scrollRef.current
    if (!container) return
    const vbAttr = element.getAttribute('viewBox')?.trim()
    const parts = vbAttr ? vbAttr.split(/\s+/).map(Number) : []
    const [vx, vy, vw, vh] =
      parts.length === 4 && parts.every((n) => Number.isFinite(n) && !Number.isNaN(n))
        ? parts
        : [0, 0, width, height]
    const point = minimapClientToGraph(
      { x: clientX, y: clientY },
      element.getBoundingClientRect(),
      vw,
      vh,
      { x: vx, y: vy },
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

  function toGraph(clientX: number, clientY: number): FbdPoint {
    return screenToGraph({ x: clientX, y: clientY }, viewport, getSceneRect())
  }

  const isGestureActive = Boolean(
    drag || pan || marquee || wireDrag || clickSourcePort || contextMenu || pendingPlacement
  )
  const tooltipId = 'fbd-node-hover-card'
  const hoverTooltipNode = hoverTooltip ? nodesById.get(hoverTooltip.nodeId) ?? null : null
  const hoverTooltipGeometry = hoverTooltip ? geometry.byNodeId.get(hoverTooltip.nodeId) ?? null : null

  const getNodeScreenPosition = useCallback((nodeId: string, element?: Element | null): { x: number; y: number } | null => {
    if (element && typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect()
      if (rect && (rect.width > 0 || rect.height > 0 || rect.x > 0 || rect.y > 0)) {
        return { x: rect.right, y: rect.top }
      }
    }
    const placed = geometry.nodes.find((n) => n.id === nodeId)
    if (placed) {
      const sceneRect = getSceneRect()
      return {
        x: sceneRect.left + viewport.x + (placed.x + placed.width) * viewport.scale,
        y: sceneRect.top + viewport.y + placed.y * viewport.scale,
      }
    }
    return null
  }, [geometry.nodes, viewport])

  const handleNodePointerEnter = useCallback((event: React.PointerEvent<SVGGElement>, nodeId: string) => {
    if (isGestureActive) return
    const hasClientCoords = typeof event.clientX === 'number' && Number.isFinite(event.clientX) && (event.clientX !== 0 || event.clientY !== 0)
    const pos = hasClientCoords
      ? { x: event.clientX, y: event.clientY }
      : getNodeScreenPosition(nodeId, event.currentTarget)
    if (!pos) return
    setHoverTooltip({ nodeId, position: pos })
  }, [isGestureActive, getNodeScreenPosition])

  const handleNodePointerLeave = useCallback((_event: React.PointerEvent<SVGGElement>, nodeId: string) => {
    setHoverTooltip((current) => (current?.nodeId === nodeId ? null : current))
  }, [])

  const handleNodeFocus = useCallback((event: React.FocusEvent<SVGGElement>, nodeId: string) => {
    if (isGestureActive) return
    const pos = getNodeScreenPosition(nodeId, event.currentTarget)
    if (!pos) return
    setHoverTooltip({ nodeId, position: pos })
  }, [isGestureActive, getNodeScreenPosition])

  const handleNodeBlur = useCallback((_event: React.FocusEvent<SVGGElement>, nodeId: string) => {
    setHoverTooltip((current) => (current?.nodeId === nodeId ? null : current))
  }, [])

  const handleBeginDrag = useCallback((event: React.PointerEvent<SVGGElement>, node: FbdNode) => {
    setHoverTooltip(null)
    beginDrag(event, node)
  }, [beginDrag])

  /* ------------------------------------------------------------------ *
   * Điều hướng nhanh: Fit All / Fit Selection / 100% / zoom quanh tâm.
   * ------------------------------------------------------------------ */

  function viewSize(): { cw: number; ch: number } {
    const container = scrollRef.current
    return {
      cw: containerWidth || container?.clientWidth || 0,
      ch: containerHeight || container?.clientHeight || 0,
    }
  }

  function resetScroll() {
    const container = scrollRef.current
    if (!container) return
    container.scrollLeft = 0
    container.scrollTop = 0
  }

  function fitAll() {
    const bounds = fbdNodesBounds(geometry.nodes)
    const { cw, ch } = viewSize()
    if (!bounds || cw <= 0 || ch <= 0) {
      setViewport(DEFAULT_VIEWPORT)
      resetScroll()
      return
    }
    setViewport(fitViewport(bounds, { containerWidth: cw, containerHeight: ch, maxScale: 1 }))
    resetScroll()
  }

  function fitSelection(ids: readonly string[] = selectedNodeIds) {
    if (ids.length === 0) {
      showFlash(pick('Chưa chọn khối nào — đã vừa cả sơ đồ.', 'Nothing selected — fitted the whole diagram.'))
      fitAll()
      return
    }
    const bounds = fbdNodesBounds(geometry.nodes, ids)
    const { cw, ch } = viewSize()
    if (!bounds || cw <= 0 || ch <= 0) {
      setViewport(DEFAULT_VIEWPORT)
      resetScroll()
      return
    }
    setViewport(fitViewport(bounds, { containerWidth: cw, containerHeight: ch, maxScale: 2 }))
    resetScroll()
  }

  function zoom100() {
    const { cw, ch } = viewSize()
    setViewport((current) => (cw > 0 && ch > 0 ? zoomAroundCenter(current, 1, cw, ch) : DEFAULT_VIEWPORT))
  }

  function zoomBy(delta: number) {
    const { cw, ch } = viewSize()
    setViewport((current) =>
      cw > 0 && ch > 0
        ? zoomAroundCenter(current, current.scale + delta, cw, ch)
        : nextViewport(current, { scale: current.scale + delta }),
    )
  }

  /* Ghi lệnh khung nhìn cho tầng gọi. `ref` chứ không state: phím tắt chỉ cần
   * đọc lệnh mới nhất, và phát nó ra ngoài sẽ kéo cả cây render theo mỗi pan. */
  useEffect(() => {
    if (!viewCommandsRef) return
    viewCommandsRef.current = {
      fitAll,
      fitSelection,
      zoom100,
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(-ZOOM_STEP),
    }
    return () => {
      viewCommandsRef.current = null
    }
  })

  const setBridge = useSetFbdCanvasBridge()

  useEffect(() => {
    return () => {
      setBridge?.(null)
      onBridgeChange?.(null)
    }
  }, [setBridge, onBridgeChange])

  /* CHỈ phát cầu nối khi có người tiêu thụ.
   *
   * `setBridge` là setter state của `FbdCanvasBridgeProvider`, nằm CAO hơn cả
   * workspace — nên mỗi lần phát là một lần re-render cả cây con. Effect này phụ
   * thuộc `geometry.nodes`, tức nó bắn MỘT LẦN MỖI KHỐI được chèn. Với 25 lần
   * `Insert` liên tiếp, đó là 25 lượt re-render toàn cây chen vào giữa chuỗi phím;
   * khi máy bận (cả bộ e2e chạy song song) vài phím rơi mất và `TC-FBD-NAV-001`
   * đỏ ở `25/256 block` — chạy riêng thì xanh, chạy cả bộ thì không.
   *
   * Người tiêu thụ duy nhất là cột Mini Map của khay đáy, và cột đó chỉ tồn tại
   * khi canvas KHÔNG tự dựng minimap nội tuyến. Dưới ngưỡng đó không ai đọc cầu
   * nối, nên phát là trả giá re-render cho một giá trị không ai dùng. */
  const bridgeHasConsumer = !showInlineMinimap

  useEffect(() => {
    if (!bridgeHasConsumer) return
    const container = scrollRef.current
    const bridge: FbdCanvasBridge = {
      nodes: geometry.nodes,
      wires: geometry.wires,
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
      onZoomIn: () => zoomBy(ZOOM_STEP),
      onZoomOut: () => zoomBy(-ZOOM_STEP),
      onResetZoom: () => fitAll(),
    }

    setBridge?.(bridge)
    onBridgeChange?.(bridge)
  }, [
    bridgeHasConsumer,
    setBridge,
    geometry.nodes,
    geometry.wires,
    height,
    onBridgeChange,
    selection,
    viewport,
    width,
  ])

  useEffect(() => {
    const container = scrollRef.current
    if (!bridgeHasConsumer) return
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
  }, [bridgeHasConsumer, setBridge, onBridgeChange])

  // Cancel any gesture on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setHoverTooltip(null)
        setPan(null)
        cancelDrag()
        setMarquee(null)
        setWireDrag(null)
        setClickSourcePort(null)
        setClickWireId(null)
        setClickCandidate(null)
        setReconnectWireId(null)
        setGhostPosition(null)
        setNativeDragEntryId(null)
        setContextMenu(null)
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

  /* `Space` giữ = chế độ pan, đúng mẫu của mọi editor đồ hoạ.
   *
   * Chỉ nhận khi con trỏ đang ở TRÊN canvas: `Space` là phím kích hoạt native
   * của button và phím cách của ô nhập liệu, nên chặn nó toàn cục sẽ làm hỏng
   * bàn phím của phần còn lại của trang. */
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      return target.isContentEditable || Boolean(target.closest('input, select, textarea, button, [role="menuitem"]'))
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== ' ' && event.code !== 'Space') return
      if (!pointerInsideRef.current || isEditableTarget(event.target)) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.key !== ' ' && event.code !== 'Space') return
      setSpaceHeld(false)
    }
    function handleBlur() {
      setSpaceHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  /* ------------------------------------------------------------------ *
   * Cử chỉ con trỏ. Một đường xử lý duy nhất, gọi được từ cả handler
   * của SVG lẫn listener trên `window`.
   *
   * Trước bản này `pointermove`/`pointerup` của pan và marquee nằm trên
   * `<rect>` nền và dựa vào pointer capture, còn cử chỉ kéo dây lại nghe trên
   * `window` — hai mô hình song song, và chính chỗ nối giữa chúng là nơi cử
   * chỉ kéo dây bị rơi: dây chỉ được tạo bởi `onPointerUp` của ĐÚNG phần tử
   * cổng đích, nên nhả chuột lệch vài pixel là mất cử chỉ mà không báo gì.
   * ------------------------------------------------------------------ */

  const processPointerMove = (clientX: number, clientY: number, altKey: boolean) => {
    const graph = toGraph(clientX, clientY)

    if (pendingPlacement) {
      const effectiveSnap = snapEnabled ? snapSize : 0
      setGhostPosition(snapPoint(graph, effectiveSnap, altKey))
    }

    if (pan) {
      setViewport((v) => nextViewport(v, { x: pan.originX + (clientX - pan.startX), y: pan.originY + (clientY - pan.startY) }))
      return
    }

    if (marquee) {
      setMarquee((current) => (current ? { ...current, currentX: graph.x, currentY: graph.y } : null))
      return
    }

    if (wireDrag) {
      const candidate = resolveWireDropTarget({
        document: validationDocument,
        network,
        geometry,
        source: wireDrag.sourcePort,
        cursor: graph,
        wireId: wireDrag.wireId,
      })
      setWireDrag((current) => (current ? { ...current, cursor: graph, candidate } : null))
      return
    }

    if (clickSourcePort && clickWireId) {
      const candidate = resolveWireDropTarget({
        document: clickValidationDocument,
        network,
        geometry,
        source: clickSourcePort,
        cursor: graph,
        wireId: clickWireId,
      })
      setGhostPosition(graph)
      setClickCandidate(candidate)
    }

    // Không có cử chỉ nào: chỉ theo dõi phần tử dưới con trỏ để phản hồi hover.
    const port = portAtPoint(geometry.nodes, graph)
    const node = port ? null : nodeAtPoint(geometry.nodes, graph)
    setHover((current) => {
      const nextNodeId = port ? port.nodeId : node?.id ?? null
      const nextPortId = port?.id ?? null
      if (current.nodeId === nextNodeId && current.portId === nextPortId) return current
      return { ...current, nodeId: nextNodeId, portId: nextPortId }
    })
  }

  const commitWireDrag = (clientX: number, clientY: number) => {
    if (!wireDrag) return
    /* Pointerup có thể mang vị trí mới hơn pointermove cuối cùng (đặc biệt khi
     * rê nhanh rồi nhả). Phán quyết lại tại đúng điểm nhả; dùng candidate lưu
     * từ frame trước sẽ làm preview xanh nhưng lúc nhả lại mất dây, hoặc nối
     * nhầm cổng vừa rời khỏi. */
    const cursor = toGraph(clientX, clientY)
    const candidate = resolveWireDropTarget({
      document: validationDocument,
      network,
      geometry,
      source: wireDrag.sourcePort,
      cursor,
      wireId: wireDrag.wireId,
    })
    setWireDrag(null)
    if (!canEdit) return
    /* Một click chuột cũng phát pointerdown/up. Nếu con trỏ chưa thật sự di
     * chuyển, để `click` ngay sau đó xử lý chế độ nối hai nhịp; không hiện lỗi
     * "thả ở chỗ trống" cho một thao tác chọn cổng hoàn toàn hợp lệ. */
    if (Math.hypot(clientX - wireDrag.startClientX, clientY - wireDrag.startClientY) <= 3) return
    if (!candidate) {
      showFlash(pick(
        'Nhả dây ở chỗ trống — chưa có cổng nào nhận. Kéo tới một cổng hoặc thả lên thân khối.',
        'Released on empty space — no port to land on. Drop on a port or on a block body.',
      ), 'error')
      return
    }
    if (!candidate.ok) {
      showFlash(describeWireRejection(candidate.code, pick), 'error')
      return
    }
    dispatch({ type: 'ADD_WIRE', networkId: network.id, wire: candidate.wire })
  }

  const finishGesture = (clientX: number, clientY: number, pointerId: number) => {
    activePointersRef.current.delete(pointerId)
    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null
      pinchStartViewportRef.current = null
    }

    if (wireDrag && wireDrag.pointerId === pointerId) {
      commitWireDrag(clientX, clientY)
      return
    }

    if (pan && pan.pointerId === pointerId) {
      setPan(null)
      return
    }

    if (marquee && marquee.pointerId === pointerId) {
      const moved = Math.hypot(clientX - marquee.startScreenX, clientY - marquee.startScreenY) > 3
      if (!moved) {
        /* Bấm một nhịp trên chỗ trống = bỏ chọn. Cũng huỷ luôn cổng nguồn của
         * cử chỉ nối bằng click, nếu không nó sẽ còn treo sau khi vùng chọn
         * đã trống. */
        dispatch({ type: 'SELECT', selection: null })
        if (clickSourcePort || connectionFromPortId) dispatch({ type: 'CANCEL_CONNECTION' })
        setClickSourcePort(null)
        setClickWireId(null)
        setClickCandidate(null)
        setReconnectWireId(null)
      } else {
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

        const hit = boxSelectNodes(boxes, { left, top, width: w, height: h }, 'intersect')
        const merged = marquee.additive
          ? Array.from(new Set([...selectedNodeIds, ...hit]))
          : hit
        selectNodes(merged)
      }
      setMarquee(null)
    }
  }

  // Viewport Pan / Marquee on Canvas Background
  function handleBgPointerDown(event: React.PointerEvent<SVGRectElement>) {
    setHoverTooltip(null)
    if (pendingPlacement) return
    if (contextMenu) setContextMenu(null)
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

    /* Pan = nút giữa, hoặc `Space` + nút trái. KHÔNG còn nhận nút phải (nút
     * phải nay mở menu ngữ cảnh) và KHÔNG còn nhận `Shift` + nút trái
     * (`Shift`/`Ctrl` + kéo nay là chọn vùng CỘNG THÊM). Đó là bộ quy ước của
     * editor desktop mà yêu cầu đòi, và hai phím cũ đã chiếm mất hai cử chỉ
     * phổ biến hơn hẳn. */
    const isMiddle = event.button === 1
    const isSpacePan = event.button === 0 && spaceHeld
    const isTouchPan = event.pointerType === 'touch' && !marqueeMode && event.button === 0

    if (isMiddle || isSpacePan || isTouchPan) {
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
      const pt = toGraph(event.clientX, event.clientY)
      event.currentTarget.setPointerCapture(event.pointerId)
      setMarquee({
        pointerId: event.pointerId,
        startScreenX: event.clientX,
        startScreenY: event.clientY,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
      })
    }
  }

  function handleSurfacePointerMove(event: React.PointerEvent<SVGSVGElement>) {
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

    processPointerMove(event.clientX, event.clientY, event.altKey)
  }

  /* Chỉ còn phục vụ nhánh ĐẶT KHỐI (click-to-place). Mọi cử chỉ khác kết thúc
   * ở listener `window` — nếu cả hai cùng kết thúc một cử chỉ thì `ADD_WIRE`
   * bị phát hai lần với cùng một UUID và lần thứ hai sinh một thông báo từ
   * chối vô cớ. */
  function handleBgPointerUp(event: React.PointerEvent<SVGRectElement>) {
    if (pendingPlacement) {
      activePointersRef.current.delete(event.pointerId)
      const entry = fbdPaletteEntry(pendingPlacement.entryId)
      if (canEdit && entry && entry.featureState === 'AVAILABLE') {
        const pt = toGraph(event.clientX, event.clientY)
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
    }
  }

  function handleBgPointerCancel(event: React.PointerEvent<SVGRectElement>) {
    activePointersRef.current.delete(event.pointerId)
    setHoverTooltip(null)
    setPan(null)
    setMarquee(null)
    setWireDrag(null)
    setClickSourcePort(null)
    setClickWireId(null)
    setClickCandidate(null)
    setReconnectWireId(null)
    if (connectionFromPortId) dispatch({ type: 'CANCEL_CONNECTION' })
    pinchStartDistRef.current = null
    pinchStartViewportRef.current = null
    if (pendingPlacement) {
      onCancelPlacement?.()
      setGhostPosition(null)
    }
  }

  /* Cử chỉ có thể kết thúc NGOÀI mặt vẽ — nhả chuột trên thanh công cụ, trên
   * panel bên, ngoài cửa sổ. Nghe trên `window` trong lúc có cử chỉ là cách duy
   * nhất để không bỏ rơi nó (và là chỗ cử chỉ kéo dây trước đây chết). */
  useEffect(() => {
    if (!pan && !marquee && !wireDrag) return
    function handleMove(event: PointerEvent) {
      processPointerMove(event.clientX, event.clientY, event.altKey)
    }
    function handleUp(event: PointerEvent) {
      finishGesture(event.clientX, event.clientY, event.pointerId)
    }
    function handleCancel(event: PointerEvent) {
      activePointersRef.current.delete(event.pointerId)
      setHoverTooltip(null)
      setPan(null)
      setMarquee(null)
      setWireDrag(null)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
    }
  })

  /* ------------------------------------------------------------------ *
   * Con lăn: quy ước desktop editor.
   *   wheel              → cuộn dọc   (để trình duyệt tự cuộn khay)
   *   Shift + wheel      → cuộn ngang
   *   Ctrl/Cmd + wheel   → zoom quanh CON TRỎ
   *
   * Bản trước cho wheel trần zoom và `preventDefault()` vô điều kiện, nên trên
   * một sơ đồ cao hơn khung nhìn người dùng KHÔNG có cách nào cuộn xuống bằng
   * con lăn — cuộn là thao tác thường dùng nhất, và nó đã bị một thao tác ít
   * dùng hơn chiếm chỗ.
   * ------------------------------------------------------------------ */
  function handleWheel(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'deltaX' | 'deltaY' | 'deltaMode' | 'clientX' | 'clientY' | 'preventDefault'>) {
    setHoverTooltip(null)
    const container = scrollRef.current

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const sceneRect = getSceneRect()
      const anchorLocal = { x: event.clientX - sceneRect.left, y: event.clientY - sceneRect.top }
      const direction = event.deltaY < 0 ? 1 : -1
      setViewport((current) =>
        zoomAroundPoint(current, current.scale + direction * WHEEL_ZOOM_STEP, anchorLocal),
      )
      return
    }

    if (!container) return

    if (event.shiftKey) {
      event.preventDefault()
      container.scrollLeft += wheelDelta(event.deltaY || event.deltaX, event.deltaMode)
      return
    }

    /* Cuộn dọc: KHÔNG `preventDefault`. Khay là `overflow-auto`, nên để trình
     * duyệt cuộn giữ đúng quán tính, thanh cuộn và hành vi hệ điều hành. */
    if (event.deltaX !== 0 && event.deltaY === 0) {
      event.preventDefault()
      container.scrollLeft += wheelDelta(event.deltaX, event.deltaMode)
    }
  }

  function wheelDelta(delta: number, deltaMode: number): number {
    if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT
    if (deltaMode === 2) return delta * (scrollRef.current?.clientHeight ?? WHEEL_LINE_HEIGHT * 10)
    return delta
  }

  /* Chrome có thể gắn `wheel` của tầng delegation React theo nhánh passive.
   * Khi đó `preventDefault()` trong handler JSX không giữ được Ctrl+wheel cho
   * canvas và trình duyệt xử lý nó như page zoom. Gắn trực tiếp lên SVG với
   * `{ passive: false }` để hợp đồng desktop editor có hiệu lực trên input
   * chuột thật; bỏ `onWheel` JSX để một nhịp không chạy hai lần. */
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const listener = (event: WheelEvent) => handleWheel(event)
    surface.addEventListener('wheel', listener, { passive: false })
    return () => surface.removeEventListener('wheel', listener)
  })

  /* ------------------------------------------------------------------ *
   * Cổng: bắt đầu / kết thúc cử chỉ nối dây.
   * ------------------------------------------------------------------ */

  function handlePortPointerDown(event: React.PointerEvent<SVGGElement>, port: FbdPortGeometry) {
    if (!canEdit || event.button !== 0) return
    setHoverTooltip(null)
    if (contextMenu) setContextMenu(null)
    /* Khi đã có đầu cố định (nối bằng hai click hoặc reconnect), pointerdown
     * trên cổng thứ hai thuộc về nhịp click hoàn tất. Không được khởi động một
     * wire-drag mới rồi xoá mất đầu đang giữ trước khi sự kiện `click` tới. */
    if (clickSourcePort) return
    /* Kéo từ đầu NÀO cũng được. Bản trước chỉ nhận `OUTPUT`, nên nửa số cử chỉ
     * tự nhiên (nhắm cổng vào rồi kéo về nguồn) im lặng không làm gì. Chiều
     * canonical do `orientWireEndpoints` chuẩn hoá lúc ghi. */
    const cursor = toGraph(event.clientX, event.clientY)
    setWireDrag({
      pointerId: event.pointerId,
      sourcePort: port,
      startClientX: event.clientX,
      startClientY: event.clientY,
      cursor,
      wireId: createUuid(),
      candidate: null,
    })
    setClickSourcePort(null)
    setClickWireId(null)
    setClickCandidate(null)
    setReconnectWireId(null)
  }

  function handlePortPointerUp(event: React.PointerEvent<SVGGElement>, port: FbdPortGeometry) {
    /* Port nằm trong node và cần chặn `endDrag` của node cha, nhưng chặn nổi
     * bọt cũng đồng nghĩa listener `window` không thấy pointerup. Kết thúc cử
     * chỉ ngay tại đây; cùng `finishGesture` vẫn được listener `window` dùng
     * khi nhả trên thân khối, vùng trống hoặc ngoài canvas. */
    event.stopPropagation()
    finishGesture(event.clientX, event.clientY, event.pointerId)
    void port
  }

  function handlePortClick(event: React.MouseEvent<SVGGElement>, port: FbdPortGeometry) {
    setHoverTooltip(null)
    if (!canEdit) {
      select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
      return
    }

    const isCtrl = event.ctrlKey || event.metaKey
    const activeSource =
      clickSourcePort || (connectionFromPortId ? portsById.get(connectionFromPortId) : null)

    if (activeSource && activeSource.id !== port.id && activeSource.direction === port.direction) {
      /* Hai cổng cùng chiều không thể thành dây. Với chế độ nối hai click bình
       * thường, coi click này là ý định chọn cổng khác (Inspector phải đổi theo
       * selection), đồng thời đóng đầu nguồn cũ. Reconnect giữ đầu cố định thì
       * báo lỗi để người dùng không hiểu nhầm đầu nào đang được bảo toàn. */
      if (reconnectWireId) {
        showFlash(describeWireRejection('connect-incompatible', pick), 'error')
        return
      }
      setClickSourcePort(null)
      setClickWireId(null)
      setClickCandidate(null)
      dispatch({ type: 'CANCEL_CONNECTION' })
      select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
      return
    }

    if (activeSource && activeSource.id !== port.id) {
      const endpoints = orientWireEndpoints(activeSource, port)
      const wireId = reconnectWireId || clickWireId || createUuid()
      const verdict = endpoints
        ? evaluateWireCandidate(clickValidationDocument, endpoints, wireId)
        : { ok: false as const, code: 'connect-incompatible' as const, wire: null }
      if (!verdict.ok || !verdict.wire) {
        showFlash(describeWireRejection(verdict.code, pick), 'error')
        return
      }
      dispatch(reconnectWireId
        ? { type: 'RECONNECT_WIRE', networkId: network.id, wireId: reconnectWireId, wire: verdict.wire }
        : { type: 'ADD_WIRE', networkId: network.id, wire: verdict.wire })
      setClickSourcePort(null)
      setClickWireId(null)
      setClickCandidate(null)
      setReconnectWireId(null)
      setGhostPosition(null)
      return
    }

    if (port.direction === 'OUTPUT' && (isCtrl || activeSource === null)) {
      setClickSourcePort(port)
      setClickWireId(createUuid())
      setClickCandidate(null)
      setReconnectWireId(null)
      dispatch({ type: 'BEGIN_OR_COMMIT_CONNECTION', portId: port.id })
      select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
      return
    }

    setClickSourcePort(null)
    setClickWireId(null)
    setClickCandidate(null)
    setReconnectWireId(null)
    if (activeSource) dispatch({ type: 'CANCEL_CONNECTION' })
    select({ kind: 'port', networkId: network.id, nodeId: port.nodeId, portId: port.id })
  }

  /* ------------------------------------------------------------------ *
   * Chọn khối: `Ctrl`/`Shift + Click` cộng/trừ vùng chọn.
   * ------------------------------------------------------------------ */
  function handleNodeClick(event: React.MouseEvent<SVGGElement>, nodeId: string) {
    setHoverTooltip(null)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    if (!additive) {
      select({ kind: 'node', networkId: network.id, nodeId })
      return
    }
    const current = new Set(selectedNodeIds)
    if (current.has(nodeId)) current.delete(nodeId)
    else current.add(nodeId)
    selectNodes(Array.from(current))
  }

  /* ------------------------------------------------------------------ *
   * Menu chuột phải.
   * ------------------------------------------------------------------ */

  function openContextMenu(event: React.MouseEvent, target: FbdContextTarget) {
    event.preventDefault()
    event.stopPropagation()
    setHoverTooltip(null)
    setPan(null)
    setMarquee(null)
    setWireDrag(null)
    setContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      graph: toGraph(event.clientX, event.clientY),
      target,
    })
  }

  function handleSurfaceContextMenu(event: React.MouseEvent<SVGSVGElement>) {
    /* Mọi phần tử con đã tự mở menu của nó và `stopPropagation`; tới được đây
     * nghĩa là chuột phải rơi vào chỗ trống. Vẫn hit-test lại theo toạ độ để
     * chuột phải vào VÙNG BẮT (rộng hơn hình vẽ) của một cổng cũng ra menu
     * cổng. */
    if (event.defaultPrevented) return
    const graph = toGraph(event.clientX, event.clientY)
    const port = portAtPoint(geometry.nodes, graph)
    if (port) {
      openContextMenu(event, { kind: 'port', nodeId: port.nodeId, portId: port.id, direction: port.direction })
      return
    }
    const node = nodeAtPoint(geometry.nodes, graph)
    if (node) {
      openContextMenu(event, { kind: 'node', nodeId: node.id })
      return
    }
    openContextMenu(event, { kind: 'canvas' })
  }

  function wiresOfNode(nodeId: string): string[] {
    const node = nodesById.get(nodeId)
    if (!node) return []
    const portIds = new Set(node.ports.map((port) => port.id))
    return network.wires
      .filter((wire) => portIds.has(wire.from.portId) || portIds.has(wire.to.portId))
      .map((wire) => wire.id)
  }

  function wiresOfPort(portId: string): string[] {
    return network.wires
      .filter((wire) => wire.from.portId === portId || wire.to.portId === portId)
      .map((wire) => wire.id)
  }

  function disconnect(wireIds: readonly string[]) {
    if (wireIds.length === 0) {
      showFlash(pick('Không có dây nào để ngắt.', 'There is no wire to disconnect.'))
      return
    }
    dispatch({ type: 'DELETE_WIRES', networkId: network.id, wireIds: [...wireIds] })
  }

  function beginReconnect(wireId: string, fixedEnd: 'source' | 'target') {
    const wire = network.wires.find((item) => item.id === wireId)
    if (!wire) {
      showFlash(pick('Dây cần nối lại không còn tồn tại.', 'The wire to reconnect no longer exists.'), 'error')
      return
    }
    const fixedPortId = fixedEnd === 'source' ? wire.from.portId : wire.to.portId
    const fixedPort = portsById.get(fixedPortId)
    if (!fixedPort) {
      showFlash(pick('Không tìm thấy đầu dây cần giữ.', 'The endpoint to preserve was not found.'), 'error')
      return
    }
    setClickSourcePort(fixedPort)
    setClickWireId(wireId)
    setClickCandidate(null)
    setReconnectWireId(wireId)
    setGhostPosition({ x: fixedPort.cx, y: fixedPort.cy })
    select({ kind: 'wire', networkId: network.id, wireId })
    showFlash(fixedEnd === 'source'
      ? pick('Đang giữ đầu nguồn OUT — chọn cổng IN mới.', 'Source OUT is fixed — select a new IN port.')
      : pick('Đang giữ đầu đích IN — chọn cổng OUT mới.', 'Target IN is fixed — select a new OUT port.'))
  }

  /* Dựng thẳng trong thân render, không `useMemo`: mọi mục trong menu đóng
   * quanh hàm/state của lần render này, nên một memo ở đây chỉ tạo ra nguy cơ
   * giữ lại closure cũ. Thân hàm thoát ngay khi menu đóng. */
  function buildContextMenuModel(): { title: string; items: FbdContextMenuItem[] } | null {
    if (!contextMenu) return null
    const state = contextMenu
    const items: FbdContextMenuItem[] = []
    const viewItems: FbdContextMenuItem[] = [
      { id: 'fit-all', label: pick('Vừa cả sơ đồ', 'Fit all'), shortcut: 'Ctrl+1', run: () => fitAll() },
      { id: 'fit-selection', label: pick('Vừa vùng chọn', 'Fit selection'), shortcut: 'Ctrl+2', disabled: selectedNodeIds.length === 0, run: () => fitSelection() },
      { id: 'zoom-100', label: pick('Thu phóng 100%', 'Zoom to 100%'), shortcut: 'Ctrl+0', run: () => zoom100() },
    ]

    if (state.target.kind === 'node') {
      const nodeId = state.target.nodeId
      const node = nodesById.get(nodeId)
      const targetIds = selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId]
      const label = targetIds.length > 1
        ? pick(`${targetIds.length} khối đang chọn`, `${targetIds.length} selected blocks`)
        : pick('Khối', 'Block')

      if (node && (node.kind === 'INPUT' || node.kind === 'OUTPUT') && targetIds.length === 1 && onRequestPortMapping) {
        const varName = typeof node.parameters?.variable === 'string' ? node.parameters.variable.trim() : ''
        const portDef = node.ports[0]
        items.push({
          id: 'map-point',
          label: pick('Ánh xạ điểm…', 'Map point…'),
          disabled: !canEdit || !varName,
          run: () => onRequestPortMapping({
            nodeId,
            portId: portDef?.id ?? node.id,
            portName: varName || node.typeRef,
            nodeName: varName || node.kind,
            portDirection: node.kind === 'INPUT' ? 'INPUT' : 'OUTPUT',
            portDataType: node.typeRef,
          }),
        })
      }
      items.push(
        {
          id: 'properties',
          label: pick('Thuộc tính', 'Properties'),
          run: () => {
            select({ kind: 'node', networkId: network.id, nodeId })
            setPropertiesModalNodeId(nodeId)
          },
        },
        { id: 'copy', label: pick('Sao chép', 'Copy'), shortcut: 'Ctrl+C', disabled: !clipboard, run: () => clipboard?.copy(targetIds) },
        { id: 'cut', label: pick('Cắt', 'Cut'), shortcut: 'Ctrl+X', disabled: !clipboard || !canEdit, run: () => clipboard?.cut(targetIds) },
        { id: 'duplicate', label: pick('Nhân đôi', 'Duplicate'), shortcut: 'Ctrl+D', disabled: !clipboard || !canEdit, run: () => clipboard?.duplicate(targetIds) },
        { id: 'disconnect', label: pick('Ngắt hết dây của khối', 'Disconnect all wires'), disabled: !canEdit, run: () => disconnect(targetIds.flatMap(wiresOfNode)) },
        { id: 'fit-selection', label: pick('Vừa vùng chọn', 'Fit selection'), shortcut: 'Ctrl+2', run: () => { selectNodes(targetIds); fitSelection(targetIds) } },
        { id: 'delete', label: pick('Xóa', 'Delete'), shortcut: 'Delete', danger: true, disabled: !canEdit, run: () => { selectNodes(targetIds); dispatch({ type: 'DELETE_SELECTION' }) } },
      )
      return { title: label, items }
    }

    if (state.target.kind === 'port') {
      const { portId, nodeId, direction } = state.target
      items.push(
        { id: 'select-port', label: pick('Chọn cổng', 'Select port'), run: () => select({ kind: 'port', networkId: network.id, nodeId, portId }) },
      )
      if (direction === 'OUTPUT') {
        items.push({
          id: 'begin-connection',
          label: pick('Bắt đầu nối từ cổng này', 'Start a wire from this port'),
          shortcut: 'Enter',
          disabled: !canEdit,
          run: () => {
            const port = portsById.get(portId)
            if (port) setClickSourcePort(port)
            dispatch({ type: 'BEGIN_OR_COMMIT_CONNECTION', portId })
          },
        })
      }
      items.push(
        { id: 'disconnect', label: pick('Ngắt dây tại cổng này', 'Disconnect this port'), disabled: !canEdit, run: () => disconnect(wiresOfPort(portId)) },
      )
      if (onRequestPortMapping) {
        const node = nodesById.get(nodeId)
        const portDef = node?.ports.find((p) => p.id === portId)
        if (node && portDef && (node.kind === 'INPUT' || node.kind === 'OUTPUT')) {
          const varName = typeof node.parameters?.variable === 'string' ? node.parameters.variable.trim() : ''
          items.push({
            id: 'map-point',
            label: pick('Ánh xạ điểm…', 'Map point…'),
            disabled: !canEdit || !varName,
            run: () => onRequestPortMapping({
              nodeId,
              portId: portDef.id,
              portName: varName || portDef.name,
              nodeName: varName || node.typeRef,
              portDirection: node.kind === 'INPUT' ? 'INPUT' : 'OUTPUT',
              portDataType: node.typeRef,
            }),
          })
        }
      }
      return { title: pick('Cổng', 'Port'), items }
    }

    if (state.target.kind === 'wire') {
      const wireId = state.target.wireId
      items.push(
        { id: 'select-wire', label: pick('Chọn dây', 'Select wire'), run: () => select({ kind: 'wire', networkId: network.id, wireId }) },
        { id: 'reconnect-target', label: pick('Nối lại đầu đích (giữ OUT)', 'Reconnect target (keep OUT)'), disabled: !canEdit, run: () => beginReconnect(wireId, 'source') },
        { id: 'reconnect-source', label: pick('Nối lại đầu nguồn (giữ IN)', 'Reconnect source (keep IN)'), disabled: !canEdit, run: () => beginReconnect(wireId, 'target') },
        { id: 'disconnect', label: pick('Ngắt dây', 'Disconnect'), shortcut: 'Delete', danger: true, disabled: !canEdit, run: () => disconnect([wireId]) },
      )
      return { title: pick('Dây nối', 'Wire'), items }
    }

    items.push(
      { id: 'paste', label: pick('Dán tại đây', 'Paste here'), shortcut: 'Ctrl+V', disabled: !clipboard?.hasContent || !canEdit, run: () => clipboard?.paste(state.graph) },
      { id: 'add-block', label: pick('Thêm khối tại đây', 'Add block here'), shortcut: 'Insert', disabled: !onAddBlockAt || !canEdit, run: () => onAddBlockAt?.(state.graph) },
      { id: 'select-all', label: pick('Chọn tất cả', 'Select all'), shortcut: 'Ctrl+A', disabled: geometry.nodes.length === 0, run: () => selectNodes(geometry.nodes.map((node) => node.id)) },
      { id: 'deselect', label: pick('Bỏ chọn', 'Deselect'), shortcut: 'Esc', disabled: !selection, run: () => dispatch({ type: 'SELECT', selection: null }) },
      ...viewItems,
    )
    return { title: pick('Mặt vẽ', 'Canvas'), items }
  }

  const contextMenuModel = buildContextMenuModel()

  // Computed Wire Preview
  const wirePreview = useMemo(() => {
    if (wireDrag) {
      /* Đầu dây bám vào TÂM cổng ứng viên khi đã bắt được đích: dây xem trước
       * phải chỉ đúng chỗ nó sẽ nối, không phải chỗ con trỏ đang đứng. */
      const to = wireDrag.candidate
        ? { x: wireDrag.candidate.port.cx, y: wireDrag.candidate.port.cy }
        : wireDrag.cursor
      return {
        from: { x: wireDrag.sourcePort.cx, y: wireDrag.sourcePort.cy },
        to,
        state: wireDrag.candidate ? (wireDrag.candidate.ok ? 'valid' as const : 'invalid' as const) : 'pending' as const,
      }
    }
    if (clickSourcePort && ghostPosition) {
      const to = clickCandidate
        ? { x: clickCandidate.port.cx, y: clickCandidate.port.cy }
        : ghostPosition
      return {
        from: { x: clickSourcePort.cx, y: clickSourcePort.cy },
        to,
        state: clickCandidate ? (clickCandidate.ok ? 'valid' as const : 'invalid' as const) : 'pending' as const,
      }
    }
    return null
  }, [wireDrag, clickSourcePort, clickCandidate, ghostPosition])

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

    const rawClientX = (event as unknown as { clientX?: number }).clientX ?? (event as unknown as { pageX?: number }).pageX
    const rawClientY = (event as unknown as { clientY?: number }).clientY ?? (event as unknown as { pageY?: number }).pageY
    const clientX = typeof rawClientX === 'number' && Number.isFinite(rawClientX) ? rawClientX : 0
    const clientY = typeof rawClientY === 'number' && Number.isFinite(rawClientY) ? rawClientY : 0
    const pt = toGraph(clientX, clientY)
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
    const rawPayload = event.dataTransfer.getData(LIBRARY_DRAG_TYPE) || extractDragEntryId(event)
    if (!rawPayload) return
    event.preventDefault()

    setNativeDragEntryId(null)
    setGhostPosition(null)

    let entry: FbdPaletteEntry | undefined
    if (rawPayload.startsWith('pou:')) {
      const pouName = rawPayload.slice('pou:'.length)
      const pou = userPouInterfaces?.find((p) => p.name === pouName)
      if (!pou) return
      try {
        entry = userPouPaletteEntry(pou)
      } catch (err) {
        showFlash(err instanceof Error ? err.message : pick('Không thể dùng khối này', 'Cannot use this block'), 'error')
        return
      }
    } else {
      entry = fbdPaletteEntry(rawPayload)
    }

    if (!entry || entry.featureState !== 'AVAILABLE') return

    const rawClientX = (event as unknown as { clientX?: number }).clientX ?? (event as unknown as { pageX?: number }).pageX
    const rawClientY = (event as unknown as { clientY?: number }).clientY ?? (event as unknown as { pageY?: number }).pageY
    const clientX = typeof rawClientX === 'number' && Number.isFinite(rawClientX) ? rawClientX : 0
    const clientY = typeof rawClientY === 'number' && Number.isFinite(rawClientY) ? rawClientY : 0
    const pt = toGraph(clientX, clientY)
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

  /* Cụm thu phóng NỔI TRÊN canvas, không phải một hàng riêng phía trên nó.
   *
   * Là một hàng riêng, nó lấy 36 px chiều cao ở mọi thời điểm — trên một trang
   * mà chỗ vẽ đã là tài nguyên khan hiếm nhất (đo 2026-09-13 tại 1680×941:
   * canvas chỉ còn 312 px trên tổng 941). Nổi ở góc canvas là mẫu quen của mọi
   * IDE sơ đồ, và ảnh chuẩn `PGM-02B` cũng đặt nó như vậy.
   *
   * Nhãn giữ NGUYÊN chuỗi cũ qua `aria-label`: đây là ba nút mà cả test đơn vị
   * lẫn e2e chọn theo tên, và đổi tên để "gọn hơn" là đổi hợp đồng trợ năng. */
  const zoomButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text)] hover:bg-[var(--c-surface-2)]'

  const surfaceCursor = spaceHeld
    ? pan ? 'cursor-grabbing' : 'cursor-grab'
    : wireDrag
      ? 'cursor-crosshair'
      : pendingPlacement
        ? 'cursor-copy'
        : 'cursor-default'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]"
      >
        <div
          className="pointer-events-none sticky top-0 z-10 flex h-0 items-start justify-between"
          role="group"
          aria-label={pick('Thu phóng canvas', 'Canvas zoom')}
        >
          {/* Dải phản hồi thao tác. Nằm cùng hàng nổi với cụm thu phóng để
              không lấy thêm chiều cao của mặt vẽ. */}
          <div className="m-1.5 max-w-[60%]">
            {flash && (
              <p
                role="status"
                data-fbd-canvas-flash={flash.tone}
                className={
                  flash.tone === 'error'
                    ? 'pointer-events-auto rounded-[var(--radius)] border border-[var(--c-danger-fg)] bg-[var(--c-danger-bg)] px-2 py-1 text-[11px] text-[var(--c-danger-fg)] shadow-sm'
                    : 'pointer-events-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]/95 px-2 py-1 text-[11px] text-[var(--c-text-dim)] shadow-sm'
                }
              >
                {flash.text}
              </p>
            )}
          </div>
          <div className="pointer-events-auto m-1.5 flex items-center gap-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]/95 p-1 shadow-sm">
            <button
              type="button"
              data-fbd-canvas-control="true"
              aria-label={pick('Thu nhỏ', 'Zoom out')}
              title={pick('Thu nhỏ', 'Zoom out')}
              className={zoomButtonClass}
              onClick={() => zoomBy(-ZOOM_STEP)}
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fbd-canvas-control="true"
              aria-label={pick('Thu phóng 100%', 'Zoom to 100%')}
              title={pick('Thu phóng 100% (Ctrl+0)', 'Zoom to 100% (Ctrl+0)')}
              className="min-w-[3.5ch] rounded border border-transparent px-1 text-center text-xs tabular-nums text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)]"
              onClick={() => zoom100()}
            >
              {Math.round(viewport.scale * 100)}%
            </button>
            <button
              type="button"
              data-fbd-canvas-control="true"
              aria-label={pick('Phóng to', 'Zoom in')}
              title={pick('Phóng to', 'Zoom in')}
              className={zoomButtonClass}
              onClick={() => zoomBy(ZOOM_STEP)}
            >
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fbd-canvas-control="true"
              aria-label={pick('Vừa khung', 'Reset zoom')}
              title={pick('Vừa cả sơ đồ (Ctrl+1)', 'Fit all (Ctrl+1)')}
              className={zoomButtonClass}
              onClick={() => fitAll()}
            >
              <Maximize className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fbd-canvas-control="true"
              aria-label={pick('Vừa vùng chọn', 'Fit selection')}
              title={pick('Vừa vùng chọn (Ctrl+2)', 'Fit selection (Ctrl+2)')}
              className={zoomButtonClass}
              disabled={selectedNodeIds.length === 0}
              onClick={() => fitSelection()}
            >
              <Scan className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="mx-0.5 h-5 w-px bg-[var(--c-border)]" aria-hidden="true" />
            <span
              className="inline-flex h-7 items-center gap-1 rounded px-1 text-[10px] text-[var(--c-text-dim)]"
              title={pick(
                'Ctrl+lăn: thu phóng quanh con trỏ · Shift+lăn: cuộn ngang · lăn: cuộn dọc · nút giữa hoặc Space+kéo: di chuyển mặt vẽ · chuột phải: menu',
                'Ctrl+wheel: zoom at cursor · Shift+wheel: scroll sideways · wheel: scroll · middle-drag or Space+drag: pan · right-click: menu',
              )}
            >
              <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">
                {pick(
                  'Ctrl+lăn thu phóng, Shift+lăn cuộn ngang, lăn cuộn dọc, nút giữa hoặc Space kéo để di chuyển, chuột phải mở menu.',
                  'Ctrl+wheel zooms, Shift+wheel scrolls sideways, wheel scrolls, middle-drag or Space-drag pans, right-click opens the menu.',
                )}
              </span>
            </span>
          </div>
        </div>
        <svg
          ref={surfaceRef}
          role="group"
          aria-label={pick(`Sơ đồ ${network.name}`, `${network.name} diagram`)}
          data-fbd-network-id={network.id}
          width={width * viewport.scale}
          height={height * viewport.scale}
          viewBox={`0 0 ${width} ${height}`}
          className={`block touch-none ${surfaceCursor}`}
          onContextMenu={handleSurfaceContextMenu}
          onPointerMove={handleSurfacePointerMove}
          onPointerEnter={() => { pointerInsideRef.current = true }}
          onPointerLeave={() => {
            pointerInsideRef.current = false
            setSpaceHeld(false)
            setHover({ nodeId: null, portId: null, wireId: null })
            setHoverTooltip(null)
          }}
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
              hoverWireId={hover.wireId}
              onWireHover={(wireId) =>
                setHover((current) => (current.wireId === wireId ? current : { ...current, wireId }))
              }
              onWireContextMenu={(event, wireId) => openContextMenu(event, { kind: 'wire', wireId })}
            />

            <FbdNodesLayer
              nodes={geometry.nodes}
              nodesById={nodesById}
              selection={selection}
              issueNodeIds={issueNodeIds}
              runtime={runtime}
              pick={pick}
              connectionFromPortId={connectionFromPortId}
              canEdit={canEdit}
              networkId={network.id}
              tempPositions={drag?.currentPositions ?? null}
              select={select}
              beginDrag={handleBeginDrag}
              moveDrag={moveDrag}
              endDrag={endDrag}
              cancelDrag={cancelDrag}
              registerPort={registerPort}
              onPortPointerDown={handlePortPointerDown}
              onPortPointerUp={handlePortPointerUp}
              onPortClick={handlePortClick}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={(event, nodeId) => openContextMenu(event, { kind: 'node', nodeId })}
              onPortContextMenu={(event, port) =>
                openContextMenu(event, { kind: 'port', nodeId: port.nodeId, portId: port.id, direction: port.direction })
              }
              hoverNodeId={hover.nodeId}
              hoverPortId={hover.portId}
              activeTooltipNodeId={!isGestureActive ? hoverTooltip?.nodeId ?? null : null}
              tooltipId={tooltipId}
              bindings={bindings}
              variables={variables}
              pointCatalogItems={pointCatalogItems}
              onNodePointerEnter={handleNodePointerEnter}
              onNodePointerLeave={handleNodePointerLeave}
              onNodeFocus={handleNodeFocus}
              onNodeBlur={handleNodeBlur}
              wiringSourcePortId={wireDrag?.sourcePort.id ?? clickSourcePort?.id ?? null}
              candidatePortId={wireDrag?.candidate?.port.id ?? clickCandidate?.port.id ?? null}
              candidateOk={wireDrag?.candidate?.ok ?? clickCandidate?.ok ?? true}
              dropTargetNodeId={(wireDrag?.candidate ?? clickCandidate)?.via === 'node'
                ? (wireDrag?.candidate ?? clickCandidate)?.port.nodeId ?? null
                : null}
            />

            <FbdLayoutPreviewLayer nodes={geometry.nodes} positions={layoutPreview ?? null} />

            <FbdWirePreviewLayer preview={wirePreview} wireStyle={wireStyle} />

            <FbdGhostLayer ghost={ghost} />

            <FbdMarqueeLayer marquee={marquee} />
          </g>
        </svg>
      </div>

      {contextMenu && contextMenuModel && (
        <FbdContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          title={contextMenuModel.title}
          items={contextMenuModel.items}
          onClose={() => setContextMenu(null)}
        />
      )}

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

      {hoverTooltip && !isGestureActive && hoverTooltipNode && hoverTooltipGeometry && (
        <FbdNodeHoverCard
          id={tooltipId}
          node={hoverTooltipNode}
          nodeGeometry={hoverTooltipGeometry}
          runtimeReading={runtime?.byNodeId.get(hoverTooltipNode.id) ?? null}
          portReadings={runtime?.byPortId}
          bindings={bindings}
          variables={variables}
          pointCatalogItems={pointCatalogItems}
          position={hoverTooltip.position}
        />
      )}

      {propertiesModalNodeId && nodesById.get(propertiesModalNodeId) && (
        <FbdBlockPropertiesModal
          node={nodesById.get(propertiesModalNodeId)!}
          nodeGeometry={geometry.byNodeId.get(propertiesModalNodeId)}
          network={network}
          document={fbdDocument}
          programs={programs}
          bindings={bindings}
          variables={variables}
          pointCatalogItems={pointCatalogItems}
          runtime={runtime}
          issueNodeIds={issueNodeIds}
          onClose={() => setPropertiesModalNodeId(null)}
          onRequestPortMapping={onRequestPortMapping}
        />
      )}
    </div>
  )
}
