import type { FbdDocument, FbdNetwork, FbdNode, FbdPoint } from './model'

/**
 * `T59-806` / `AC-FBD-001` — hình học của canvas node–edge.
 *
 * Module thuần: nhận một network và bảng `layout` của tài liệu, trả về toạ độ
 * để vẽ. Nó KHÔNG đọc DOM, không giữ state, và không quyết định gì về ngữ
 * nghĩa — thứ tự thực thi vẫn là `executionOrder` do người dùng đặt, không bao
 * giờ suy ra từ x/y (nếu suy ra thì kéo một block sang trái sẽ âm thầm đổi
 * chương trình đang chạy).
 *
 * Node chưa có toạ độ được xếp **tất định**: INPUT bên trái, OUTPUT bên phải,
 * còn lại ở giữa theo `executionOrder`. Tất định là điều kiện để hai lần mở
 * cùng một tài liệu cho cùng một hình — và để test so sánh được.
 */

export const FBD_NODE_WIDTH = 168
export const FBD_NODE_HEADER_HEIGHT = 38
export const FBD_PORT_ROW_HEIGHT = 22
export const FBD_NODE_PADDING_BOTTOM = 10
export const FBD_COLUMN_GAP = 220
export const FBD_ROW_GAP = 28
export const FBD_CANVAS_MARGIN = 24
/**
 * `AC-FBD-012` — ngưỡng bật minimap.
 *
 * Dưới ngưỡng, cả sơ đồ nằm gọn trong khung nhìn nên minimap chỉ là thêm thứ
 * để nhìn. Trên ngưỡng, người dùng bắt đầu cuộn và cần biết mình đang ở đâu.
 */
export const FBD_MINIMAP_NODE_THRESHOLD = 24
export const FBD_MINIMAP_WIDTH = 176
export const FBD_MINIMAP_HEIGHT = 104

export interface FbdPortGeometry {
  id: string
  nodeId: string
  direction: 'INPUT' | 'OUTPUT'
  /** Tâm của chấm port, toạ độ canvas. */
  cx: number
  cy: number
}

export interface FbdNodeGeometry {
  id: string
  x: number
  y: number
  width: number
  height: number
  ports: readonly FbdPortGeometry[]
  /** `true` khi toạ độ do tự xếp, chưa phải do người dùng đặt. */
  auto: boolean
}

export interface FbdWireGeometry {
  id: string
  path: string
  from: FbdPoint
  to: FbdPoint
}

export interface FbdNetworkGeometry {
  nodes: readonly FbdNodeGeometry[]
  byNodeId: ReadonlyMap<string, FbdNodeGeometry>
  byPortId: ReadonlyMap<string, FbdPortGeometry>
  wires: readonly FbdWireGeometry[]
  width: number
  height: number
  minX: number
  minY: number
}

export function fbdNodeHeight(node: FbdNode, customHeight?: number): number {
  const inputs = node.ports.filter((port) => port.direction === 'INPUT').length
  const outputs = node.ports.filter((port) => port.direction === 'OUTPUT').length
  const rows = Math.max(inputs, outputs, 1)
  const naturalHeight = FBD_NODE_HEADER_HEIGHT + rows * FBD_PORT_ROW_HEIGHT + FBD_NODE_PADDING_BOTTOM
  return typeof customHeight === 'number' && customHeight > naturalHeight ? customHeight : naturalHeight
}

export function fbdNodeMinWidth(_node?: FbdNode): number {
  return 120
}

function approxPortLabelLength(name: string, dataType?: string | null, unit?: string | null): number {
  let len = name.length
  if (dataType) {
    len += 3 + dataType.length
    if (unit && unit.trim()) {
      len += 3 + unit.trim().length
    }
  }
  return len
}

export function fbdNodeAutoWidth(node: FbdNode): number {
  let requiredWidth = FBD_NODE_WIDTH
  const sorted = [...node.ports].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const inputs = sorted.filter((port) => port.direction === 'INPUT')
  const outputs = sorted.filter((port) => port.direction === 'OUTPUT')
  const rows = Math.max(inputs.length, outputs.length)

  for (let i = 0; i < rows; i++) {
    const inp = inputs[i]
    const out = outputs[i]
    if (inp && out) {
      const inpLen = approxPortLabelLength(inp.name, inp.dataType, inp.unit)
      const outLen = approxPortLabelLength(out.name, out.dataType, out.unit)
      const needed = Math.ceil((inpLen + outLen) * 6.5 + 38)
      if (needed > requiredWidth) requiredWidth = needed
    } else if (inp) {
      const inpLen = approxPortLabelLength(inp.name, inp.dataType, inp.unit)
      const needed = Math.ceil(inpLen * 6.5 + 28)
      if (needed > requiredWidth) requiredWidth = needed
    } else if (out) {
      const outLen = approxPortLabelLength(out.name, out.dataType, out.unit)
      const needed = Math.ceil(outLen * 6.5 + 28)
      if (needed > requiredWidth) requiredWidth = needed
    }
  }

  const param = node.parameters?.variable ?? node.parameters?.instance ?? node.parameters?.value
  const primaryText = typeof param === 'string' && param.trim() ? param.trim() : node.typeRef
  const headerNeeded = Math.ceil(primaryText.length * 7.5 + 40)
  if (headerNeeded > requiredWidth) requiredWidth = headerNeeded

  return Math.ceil(requiredWidth / 8) * 8
}

/**
 * Vị trí tất định cho các node chưa có toạ độ.
 *
 * Cột 0 là INPUT, cột cuối là OUTPUT, ở giữa là phần còn lại theo
 * `executionOrder` — đọc từ trái sang phải đúng chiều dữ liệu chảy, nên một
 * tài liệu chưa từng được kéo tay vẫn mở ra thành hình đọc được ngay.
 */
function autoPositions(network: FbdNetwork): Map<string, FbdPoint> {
  const ordered = [...network.nodes].sort(
    (left, right) => left.executionOrder - right.executionOrder || left.id.localeCompare(right.id),
  )
  const inputs = ordered.filter((node) => node.kind === 'INPUT')
  const outputs = ordered.filter((node) => node.kind === 'OUTPUT')
  const middle = ordered.filter((node) => node.kind !== 'INPUT' && node.kind !== 'OUTPUT')

  const columns: FbdNode[][] = [inputs, ...middle.map((node) => [node]), outputs]
  const positions = new Map<string, FbdPoint>()
  columns.forEach((column, columnIndex) => {
    let cursorY = FBD_CANVAS_MARGIN
    for (const node of column) {
      positions.set(node.id, { x: FBD_CANVAS_MARGIN + columnIndex * FBD_COLUMN_GAP, y: cursorY })
      cursorY += fbdNodeHeight(node) + FBD_ROW_GAP
    }
  })
  return positions
}

function portGeometry(node: FbdNode, origin: FbdPoint, nodeWidth: number = FBD_NODE_WIDTH): FbdPortGeometry[] {
  const sorted = [...node.ports].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const inputs = sorted.filter((port) => port.direction === 'INPUT')
  const outputs = sorted.filter((port) => port.direction === 'OUTPUT')
  const rowCenter = (index: number) =>
    origin.y + FBD_NODE_HEADER_HEIGHT + index * FBD_PORT_ROW_HEIGHT + FBD_PORT_ROW_HEIGHT / 2

  return [
    ...inputs.map((port, index) => ({
      id: port.id,
      nodeId: node.id,
      direction: 'INPUT' as const,
      cx: origin.x,
      cy: rowCenter(index),
    })),
    ...outputs.map((port, index) => ({
      id: port.id,
      nodeId: node.id,
      direction: 'OUTPUT' as const,
      cx: origin.x + nodeWidth,
      cy: rowCenter(index),
    })),
  ]
}

/**
 * Đường dây Cubic Bézier: ngang từ port OUTPUT sang port INPUT.
 */
export function fbdWirePathBezier(from: FbdPoint, to: FbdPoint): string {
  const distance = Math.max(40, Math.abs(to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`
}

function bezierIntersectsRect(from: FbdPoint, to: FbdPoint, rect: FbdObstacle, padding = 6): boolean {
  const distance = Math.max(40, Math.abs(to.x - from.x) / 2)
  const p0 = from
  const p1 = { x: from.x + distance, y: from.y }
  const p2 = { x: to.x - distance, y: to.y }
  const p3 = to

  const rx1 = rect.x - padding
  const ry1 = rect.y - padding
  const rx2 = rect.x + rect.width + padding
  const ry2 = rect.y + rect.height + padding

  for (let step = 1; step <= 9; step++) {
    const t = step / 10
    const mt = 1 - t
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    if (x >= rx1 && x <= rx2 && y >= ry1 && y <= ry2) {
      return true
    }
  }
  return false
}

/**
 * Đường nối vuông góc đi từ tâm port `from` đến tâm port `to`.
 */
export interface FbdObstacle {
  id?: string
  x: number
  y: number
  width: number
  height: number
}

function segmentIntersectsRect(
  seg: { x1: number; y1: number; x2: number; y2: number },
  rect: FbdObstacle,
  padding = 4,
): boolean {
  const rx1 = rect.x - padding
  const ry1 = rect.y - padding
  const rx2 = rect.x + rect.width + padding
  const ry2 = rect.y + rect.height + padding

  const sx1 = Math.min(seg.x1, seg.x2)
  const sx2 = Math.max(seg.x1, seg.x2)
  const sy1 = Math.min(seg.y1, seg.y2)
  const sy2 = Math.max(seg.y1, seg.y2)

  if (sx2 < rx1 || sx1 > rx2 || sy2 < ry1 || sy1 > ry2) {
    return false
  }

  if (seg.y1 === seg.y2) {
    return seg.y1 >= ry1 && seg.y1 <= ry2 && sx2 > rx1 && sx1 < rx2
  }
  if (seg.x1 === seg.x2) {
    return seg.x1 >= rx1 && seg.x1 <= rx2 && sy2 > ry1 && sy1 < ry2
  }

  return true
}

export function fbdWirePathOrthogonal(
  from: FbdPoint,
  to: FbdPoint,
  cornerRadius = 0,
  obstacles?: readonly FbdObstacle[],
  sourceNode?: FbdObstacle,
  targetNode?: FbdObstacle,
): string {
  const obsList = obstacles
    ? obstacles.filter(
        (o) =>
          o.x + o.width >= Math.min(from.x, to.x) - 40 &&
          o.x <= Math.max(from.x, to.x) + 40,
      )
    : []

  if (from.y === to.y && to.x >= from.x) {
    const isBlocked = obsList.some((o) =>
      segmentIntersectsRect({ x1: from.x + 8, y1: from.y, x2: to.x - 8, y2: from.y }, o),
    )
    if (!isBlocked) {
      return `M ${from.x} ${from.y} H ${to.x}`
    }
  }

  if (to.x >= from.x + 40) {
    const midX = (from.x + to.x) / 2
    const standardBlocked = obsList.some(
      (o) =>
        segmentIntersectsRect({ x1: from.x, y1: from.y, x2: midX, y2: from.y }, o) ||
        segmentIntersectsRect({ x1: midX, y1: from.y, x2: midX, y2: to.y }, o) ||
        segmentIntersectsRect({ x1: midX, y1: to.y, x2: to.x, y2: to.y }, o),
    )

    if (!standardBlocked) {
      if (cornerRadius <= 0) {
        return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`
      }
      const r = Math.min(cornerRadius, Math.abs(midX - from.x) / 2, Math.abs(to.y - from.y) / 2)
      const signY = to.y >= from.y ? 1 : -1
      const p1x = midX - r
      const p1y = from.y
      const p2x = midX
      const p2y = from.y + signY * r
      const p3y = to.y - signY * r
      const p4x = midX + r
      const p4y = to.y
      return `M ${from.x} ${from.y} H ${p1x} Q ${midX} ${p1y} ${p2x} ${p2y} V ${p3y} Q ${midX} ${to.y} ${p4x} ${p4y} H ${to.x}`
    }

    // Tránh chướng ngại vật: tìm kênh đứng không bị đè lên khối
    const candidates = [
      from.x + 24,
      to.x - 24,
      ...obsList.flatMap((o) => [o.x - 16, o.x + o.width + 16]),
    ].filter((vx) => vx >= from.x + 16 && vx <= to.x - 16)

    candidates.sort((a, b) => Math.abs(a - midX) - Math.abs(b - midX))

    for (const vx of candidates) {
      const hit = obsList.some(
        (o) =>
          segmentIntersectsRect({ x1: from.x, y1: from.y, x2: vx, y2: from.y }, o) ||
          segmentIntersectsRect({ x1: vx, y1: from.y, x2: vx, y2: to.y }, o) ||
          segmentIntersectsRect({ x1: vx, y1: to.y, x2: to.x, y2: to.y }, o),
      )
      if (!hit) {
        return `M ${from.x} ${from.y} H ${vx} V ${to.y} H ${to.x}`
      }
    }

    // Nếu bị chắn ngang hoàn toàn: đi vòng qua đỉnh hoặc đáy các khối chắn
    const blocking = obsList.filter(
      (o) =>
        o.x + o.width > from.x + 16 &&
        o.x < to.x - 16 &&
        Math.max(from.y, to.y) >= o.y - 8 &&
        Math.min(from.y, to.y) <= o.y + o.height + 8,
    )
    if (blocking.length > 0) {
      const minY = Math.min(...blocking.map((o) => o.y))
      const maxY = Math.max(...blocking.map((o) => o.y + o.height))
      const topY = minY - 24
      const botY = maxY + 24
      const detourY =
        topY >= 24 && Math.abs(topY - (from.y + to.y) / 2) <= Math.abs(botY - (from.y + to.y) / 2)
          ? topY
          : botY
      const exitX = from.x + 20
      const entryX = to.x - 20
      return `M ${from.x} ${from.y} H ${exitX} V ${detourY} H ${entryX} V ${to.y} H ${to.x}`
    }

    return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`
  }

  // Loopback / ngược chiều: to.x < from.x + 40
  const allInSpan = [
    ...obsList,
    ...(sourceNode ? [sourceNode] : []),
    ...(targetNode ? [targetNode] : []),
  ].filter(
    (o) =>
      o.x + o.width >= Math.min(from.x, to.x) - 30 &&
      o.x <= Math.max(from.x, to.x) + 30,
  )

  let corridorY: number
  if (allInSpan.length > 0) {
    const minY = Math.min(...allInSpan.map((o) => o.y), from.y, to.y)
    const maxY = Math.max(...allInSpan.map((o) => o.y + o.height), from.y, to.y)
    const topY = minY - 24
    const botY = maxY + 24
    corridorY =
      topY >= 24 && Math.abs(topY - (from.y + to.y) / 2) <= Math.abs(botY - (from.y + to.y) / 2)
        ? topY
        : botY
  } else {
    corridorY = from.y < to.y ? Math.min(from.y, to.y) - 30 : Math.max(from.y, to.y) + 30
  }

  const offset = 24
  const fromX_exit = from.x + offset
  const toX_entry = to.x - offset
  return `M ${from.x} ${from.y} H ${fromX_exit} V ${corridorY} H ${toX_entry} V ${to.y} H ${to.x}`
}

/**
 * Đường dây: hỗ trợ BEZIER (mặc định) và ORTHOGONAL.
 */
export function fbdWirePath(
  from: FbdPoint,
  to: FbdPoint,
  style: 'ORTHOGONAL' | 'BEZIER' = 'BEZIER',
  obstacles?: readonly FbdObstacle[],
  sourceNode?: FbdObstacle,
  targetNode?: FbdObstacle,
): string {
  if (style === 'ORTHOGONAL') {
    return fbdWirePathOrthogonal(from, to, 0, obstacles, sourceNode, targetNode)
  }
  if (to.x < from.x + 40 && obstacles && obstacles.length > 0) {
    return fbdWirePathOrthogonal(from, to, 8, obstacles, sourceNode, targetNode)
  }
  if (obstacles && obstacles.length > 0) {
    const hits = obstacles.some((o) => bezierIntersectsRect(from, to, o))
    if (hits) {
      return fbdWirePathOrthogonal(from, to, 12, obstacles, sourceNode, targetNode)
    }
  }
  return fbdWirePathBezier(from, to)
}

export interface BuildFbdNetworkGeometryOptions {
  wireStyle?: 'ORTHOGONAL' | 'BEZIER'
  nodeSizes?: Readonly<Record<string, { width?: number; height?: number }>>
}

export function buildFbdNetworkGeometry(
  network: FbdNetwork,
  layout?: FbdDocument['layout'],
  options?: BuildFbdNetworkGeometryOptions,
): FbdNetworkGeometry {
  const auto = autoPositions(network)
  const stored = layout?.nodes ?? {}
  const wireStyle = options?.wireStyle ?? 'BEZIER'

  const nodeSizes = options?.nodeSizes

  const nodes: FbdNodeGeometry[] = network.nodes.map((node) => {
    const saved = stored[node.id]
    const origin = saved ?? auto.get(node.id) ?? { x: FBD_CANVAS_MARGIN, y: FBD_CANVAS_MARGIN }
    const customSize = nodeSizes?.[node.id]
    const width =
      typeof customSize?.width === 'number' && customSize.width > 0
        ? customSize.width
        : fbdNodeAutoWidth(node)
    const height = fbdNodeHeight(node, customSize?.height)
    return {
      id: node.id,
      x: origin.x,
      y: origin.y,
      width,
      height,
      ports: portGeometry(node, origin, width),
      auto: saved === undefined,
    }
  })

  const byNodeId = new Map(nodes.map((node) => [node.id, node]))
  const byPortId = new Map<string, FbdPortGeometry>()
  for (const node of nodes) for (const port of node.ports) byPortId.set(port.id, port)

  const wires: FbdWireGeometry[] = []
  for (const wire of network.wires) {
    const from = byPortId.get(wire.from.portId)
    const to = byPortId.get(wire.to.portId)
    /* Wire trỏ tới port không còn tồn tại là lỗi ngữ nghĩa mà validator đã bắt
     * (`FBD-SEM-WIRE-001`). Canvas chỉ đơn giản không vẽ nó — vẽ một dây đi tới
     * toạ độ bịa ra sẽ làm người dùng đi tìm một block không có thật. */
    if (!from || !to) continue
    const start = { x: from.cx, y: from.cy }
    const end = { x: to.cx, y: to.cy }
    const sourceNode = byNodeId.get(wire.from.nodeId)
    const targetNode = byNodeId.get(wire.to.nodeId)
    const obstacles = nodes.filter((n) => n.id !== wire.from.nodeId && n.id !== wire.to.nodeId)
    wires.push({
      id: wire.id,
      path: fbdWirePath(start, end, wireStyle, obstacles, sourceNode, targetNode),
      from: start,
      to: end,
    })
  }

  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }

  for (const wire of wires) {
    minX = Math.min(minX, wire.from.x, wire.to.x)
    minY = Math.min(minY, wire.from.y, wire.to.y)
    maxX = Math.max(maxX, wire.from.x, wire.to.x)
    maxY = Math.max(maxY, wire.from.y, wire.to.y)
  }

  const width = Math.max(maxX - minX, 0) + FBD_CANVAS_MARGIN
  const height = Math.max(maxY - minY, 0) + FBD_CANVAS_MARGIN
  return { nodes, byNodeId, byPortId, wires, width, height, minX, minY }
}
