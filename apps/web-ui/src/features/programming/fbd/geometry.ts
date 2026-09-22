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

export function fbdNodeHeight(node: FbdNode): number {
  const inputs = node.ports.filter((port) => port.direction === 'INPUT').length
  const outputs = node.ports.filter((port) => port.direction === 'OUTPUT').length
  const rows = Math.max(inputs, outputs, 1)
  return FBD_NODE_HEADER_HEIGHT + rows * FBD_PORT_ROW_HEIGHT + FBD_NODE_PADDING_BOTTOM
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

function portGeometry(node: FbdNode, origin: FbdPoint): FbdPortGeometry[] {
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
      cx: origin.x + FBD_NODE_WIDTH,
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

/**
 * Đường nối vuông góc đi từ tâm port `from` đến tâm port `to`.
 */
export function fbdWirePathOrthogonal(from: FbdPoint, to: FbdPoint, cornerRadius = 0): string {
  if (from.y === to.y && to.x >= from.x) {
    return `M ${from.x} ${from.y} H ${to.x}`
  }

  if (to.x >= from.x + 40) {
    const midX = (from.x + to.x) / 2
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

  // Loopback / ngược chiều: to.x < from.x + 40
  const offset = 24
  const fromX_exit = from.x + offset
  const toX_entry = to.x - offset
  const midY = from.y < to.y ? Math.min(from.y, to.y) - 30 : Math.max(from.y, to.y) + 30

  if (cornerRadius <= 0) {
    return `M ${from.x} ${from.y} H ${fromX_exit} V ${midY} H ${toX_entry} V ${to.y} H ${to.x}`
  }

  return `M ${from.x} ${from.y} H ${fromX_exit} V ${midY} H ${toX_entry} V ${to.y} H ${to.x}`
}

/**
 * Đường dây: hỗ trợ BEZIER (mặc định) và ORTHOGONAL.
 */
export function fbdWirePath(
  from: FbdPoint,
  to: FbdPoint,
  style: 'ORTHOGONAL' | 'BEZIER' = 'BEZIER',
): string {
  return style === 'ORTHOGONAL' ? fbdWirePathOrthogonal(from, to) : fbdWirePathBezier(from, to)
}

export interface BuildFbdNetworkGeometryOptions {
  wireStyle?: 'ORTHOGONAL' | 'BEZIER'
}

export function buildFbdNetworkGeometry(
  network: FbdNetwork,
  layout?: FbdDocument['layout'],
  options?: BuildFbdNetworkGeometryOptions,
): FbdNetworkGeometry {
  const auto = autoPositions(network)
  const stored = layout?.nodes ?? {}
  const wireStyle = options?.wireStyle ?? 'BEZIER'

  const nodes: FbdNodeGeometry[] = network.nodes.map((node) => {
    const saved = stored[node.id]
    const origin = saved ?? auto.get(node.id) ?? { x: FBD_CANVAS_MARGIN, y: FBD_CANVAS_MARGIN }
    return {
      id: node.id,
      x: origin.x,
      y: origin.y,
      width: FBD_NODE_WIDTH,
      height: fbdNodeHeight(node),
      ports: portGeometry(node, origin),
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
    wires.push({ id: wire.id, path: fbdWirePath(start, end, wireStyle), from: start, to: end })
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
