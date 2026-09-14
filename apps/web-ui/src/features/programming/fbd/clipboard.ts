/**
 * Copy / Cut / Paste / Duplicate một vùng con của sơ đồ FBD.
 *
 * Reducer đã có `PASTE_SUBGRAPH` từ lâu — kèm kiểm trần khối/dây, kiểm định
 * danh mới và một bước hoàn tác duy nhất — nhưng KHÔNG có đường nào trong giao
 * diện đi tới nó: không phím tắt, không menu, không nút. Nó là mã chết, và
 * người dùng phải dựng lại từng khối bằng tay. Module này là phần biến đổi dữ
 * liệu còn thiếu giữa vùng chọn trên canvas và action đó.
 *
 * Thuần và không sinh id: hàm nhận `newId` từ phía gọi. Nhờ vậy test kiểm được
 * phép ánh xạ id thay vì chỉ kiểm "có khác id cũ không".
 */
import type { FbdNodeGeometry } from './geometry'
import type { FbdNetwork, FbdNode, FbdPoint, FbdWire } from './model'

export interface FbdSubgraph {
  nodes: readonly FbdNode[]
  wires: readonly FbdWire[]
  /** Toạ độ CỤ THỂ của từng khối trong vùng con — kể cả khối trước đó do tự
   * xếp mà chưa có bản ghi layout. Dán ra một chỗ mới thì vị trí phải xác
   * định, không được để bản dán tự xếp lại rồi rơi trúng bản gốc. */
  layout: Readonly<Record<string, FbdPoint>>
}

/**
 * Trích vùng con theo danh sách khối đang chọn.
 *
 * Chỉ giữ dây có CẢ HAI đầu nằm trong vùng chọn: một dây nửa trong nửa ngoài
 * khi dán sẽ phải bịa ra một đầu, tức bịa ra kết nối mà người dùng không yêu
 * cầu. Khối giữ nguyên thứ tự `executionOrder` tương đối, vì `PASTE_SUBGRAPH`
 * cấp lại thứ tự theo đúng thứ tự phần tử trong mảng.
 */
export function extractSubgraph(
  network: FbdNetwork,
  nodeIds: readonly string[],
  positions: ReadonlyMap<string, FbdNodeGeometry> | Readonly<Record<string, FbdPoint>>,
): FbdSubgraph | null {
  const wanted = new Set(nodeIds)
  const nodes = network.nodes
    .filter((node) => wanted.has(node.id))
    .sort((left, right) => left.executionOrder - right.executionOrder || left.id.localeCompare(right.id))
  if (nodes.length === 0) return null

  const inside = new Set(nodes.map((node) => node.id))
  const wires = network.wires.filter(
    (wire) => inside.has(wire.from.nodeId) && inside.has(wire.to.nodeId),
  )

  const layout: Record<string, FbdPoint> = {}
  for (const node of nodes) {
    const point = readPosition(positions, node.id)
    if (point) layout[node.id] = { x: point.x, y: point.y }
  }

  return {
    nodes: nodes.map(cloneNode),
    wires: wires.map((wire) => ({
      id: wire.id,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
    layout,
  }
}

function readPosition(
  positions: ReadonlyMap<string, FbdNodeGeometry> | Readonly<Record<string, FbdPoint>>,
  nodeId: string,
): FbdPoint | null {
  if (positions instanceof Map) {
    const geometry = positions.get(nodeId)
    return geometry ? { x: geometry.x, y: geometry.y } : null
  }
  const point = (positions as Record<string, FbdPoint | undefined>)[nodeId]
  return point ? { x: point.x, y: point.y } : null
}

function cloneNode(node: FbdNode): FbdNode {
  return {
    ...node,
    parameters: { ...node.parameters },
    ports: node.ports.map((port) => ({ ...port })),
  }
}

export interface RemapSubgraphOptions {
  newId: () => string
  /** Dịch chuyển bản dán so với bản gốc. Dán đúng chỗ cũ làm hai khối trùng
   * khít nhau và người dùng không thấy gì xảy ra. */
  offset?: FbdPoint
  /** Đặt góc trên-trái của vùng dán vào đúng điểm này (dán tại con trỏ). Ưu
   * tiên hơn `offset` khi có. */
  origin?: FbdPoint | null
}

/**
 * Cấp định danh mới cho toàn vùng con và viết lại hai đầu dây theo bảng ánh xạ.
 *
 * Cấp lại id cho cả CỔNG, không riêng khối: `identitiesAreNew` trong reducer
 * kiểm mọi định danh, và hai khối dùng chung id cổng là một tài liệu không
 * canonical được.
 */
export function remapSubgraph(subgraph: FbdSubgraph, options: RemapSubgraphOptions): FbdSubgraph {
  const { newId } = options
  const nodeIdMap = new Map<string, string>()
  const portIdMap = new Map<string, string>()

  const nodes = subgraph.nodes.map((node) => {
    const nextNodeId = newId()
    nodeIdMap.set(node.id, nextNodeId)
    return {
      ...cloneNode(node),
      id: nextNodeId,
      ports: node.ports.map((port) => {
        const nextPortId = newId()
        portIdMap.set(port.id, nextPortId)
        return { ...port, id: nextPortId }
      }),
    }
  })

  const wires: FbdWire[] = []
  for (const wire of subgraph.wires) {
    const fromNode = nodeIdMap.get(wire.from.nodeId)
    const toNode = nodeIdMap.get(wire.to.nodeId)
    const fromPort = portIdMap.get(wire.from.portId)
    const toPort = portIdMap.get(wire.to.portId)
    if (!fromNode || !toNode || !fromPort || !toPort) continue
    wires.push({
      id: newId(),
      from: { nodeId: fromNode, portId: fromPort },
      to: { nodeId: toNode, portId: toPort },
    })
  }

  const offset = resolveOffset(subgraph, options)
  const layout: Record<string, FbdPoint> = {}
  for (const [oldId, point] of Object.entries(subgraph.layout)) {
    const nextId = nodeIdMap.get(oldId)
    if (!nextId) continue
    layout[nextId] = { x: point.x + offset.x, y: point.y + offset.y }
  }

  return { nodes, wires, layout }
}

function resolveOffset(subgraph: FbdSubgraph, options: RemapSubgraphOptions): FbdPoint {
  if (options.origin) {
    const points = Object.values(subgraph.layout)
    if (points.length === 0) return { x: 0, y: 0 }
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    return { x: options.origin.x - minX, y: options.origin.y - minY }
  }
  return options.offset ?? { x: 0, y: 0 }
}

/** Bước dịch mặc định của Paste/Duplicate khi không dán tại con trỏ. */
export const FBD_PASTE_OFFSET: FbdPoint = { x: 32, y: 32 }
