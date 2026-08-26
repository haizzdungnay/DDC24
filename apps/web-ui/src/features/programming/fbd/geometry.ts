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
 * Đường dây: bezier ngang từ port OUTPUT sang port INPUT.
 *
 * Đi ngang chứ không đi thẳng để hai dây cùng đích không chồng khít lên nhau,
 * và để dây nối ngược (đích nằm bên trái nguồn) vẫn nhìn ra được là một dây
 * chứ không thành một vạch đè lên các block.
 */
export function fbdWirePath(from: FbdPoint, to: FbdPoint): string {
  const distance = Math.max(40, Math.abs(to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`
}

export function buildFbdNetworkGeometry(network: FbdNetwork, layout?: FbdDocument['layout']): FbdNetworkGeometry {
  const auto = autoPositions(network)
  const stored = layout?.nodes ?? {}

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
    wires.push({ id: wire.id, path: fbdWirePath(start, end), from: start, to: end })
  }

  const width = nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) + FBD_CANVAS_MARGIN
  const height = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) + FBD_CANVAS_MARGIN
  return { nodes, byNodeId, byPortId, wires, width, height }
}
