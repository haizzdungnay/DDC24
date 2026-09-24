import {
  FBD_CANVAS_MARGIN,
  FBD_COLUMN_GAP,
  FBD_NODE_WIDTH,
  FBD_ROW_GAP,
  fbdNodeAutoWidth,
  fbdNodeHeight,
} from './geometry'
import type { FbdNetwork, FbdNode, FbdPoint } from './model'

export interface AutoLayoutOptions {
  scope?: 'SELECTED' | 'ALL'
  selectedNodeIds?: string[]
  columnGap?: number
  rowGap?: number
  margin?: number
  nodeSizes?: Readonly<Record<string, { width?: number; height?: number }>>
}

export interface AutoLayoutResult {
  positions: Record<string, FbdPoint>
  warnings: string[]
}

const COORD_MIN = -100_000
const COORD_MAX = 100_000

function isValidCoord(val: number): boolean {
  return Number.isFinite(val) && val >= COORD_MIN && val <= COORD_MAX
}

function isSourceNode(node: FbdNode): boolean {
  return (
    node.kind === 'INPUT' ||
    node.kind === 'CONSTANT' ||
    node.kind === 'SIGNAL_READ' ||
    !node.ports.some((port) => port.direction === 'INPUT')
  )
}

function isSinkNode(node: FbdNode): boolean {
  return (
    node.kind === 'OUTPUT' ||
    node.kind === 'SIGNAL_PUBLISH' ||
    !node.ports.some((port) => port.direction === 'OUTPUT')
  )
}

function getNodeWidth(
  node: FbdNode,
  nodeSizes?: Readonly<Record<string, { width?: number; height?: number }>>,
): number {
  const custom = nodeSizes?.[node.id]?.width
  return typeof custom === 'number' && custom > 0 ? custom : fbdNodeAutoWidth(node)
}

function getNodeHeight(
  node: FbdNode,
  nodeSizes?: Readonly<Record<string, { width?: number; height?: number }>>,
): number {
  return fbdNodeHeight(node, nodeSizes?.[node.id]?.height)
}

export function computeAutoLayout(
  network: FbdNetwork,
  currentPositions: Record<string, FbdPoint> = {},
  options?: AutoLayoutOptions,
): AutoLayoutResult {
  const scope = options?.scope ?? 'ALL'
  const selectedNodeIds = new Set(options?.selectedNodeIds ?? [])
  const columnGap = options?.columnGap ?? FBD_COLUMN_GAP
  const rowGap = options?.rowGap ?? FBD_ROW_GAP
  const margin = options?.margin ?? FBD_CANVAS_MARGIN

  const nodesToLayout =
    scope === 'SELECTED'
      ? network.nodes.filter((node) => selectedNodeIds.has(node.id))
      : network.nodes

  if (nodesToLayout.length === 0) {
    return { positions: { ...currentPositions }, warnings: [] }
  }

  const nodeMap = new Map(nodesToLayout.map((n) => [n.id, n]))
  const nodeIdSet = new Set(nodesToLayout.map((n) => n.id))

  // Bám theo kết nối dây thực tế để xếp layer DAG:
  // Khối truyền dữ liệu nằm bên trái, khối nhận dữ liệu nằm bên phải
  const rawAdj = new Map<string, string[]>()
  for (const node of nodesToLayout) {
    rawAdj.set(node.id, [])
  }
  for (const wire of network.wires) {
    if (
      nodeIdSet.has(wire.from.nodeId) &&
      nodeIdSet.has(wire.to.nodeId) &&
      wire.from.nodeId !== wire.to.nodeId
    ) {
      const list = rawAdj.get(wire.from.nodeId)!
      if (!list.includes(wire.to.nodeId)) {
        list.push(wire.to.nodeId)
      }
    }
  }

  // Phá chu trình (feedback edges của FUNCTION_BLOCK hoặc loopback):
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const cycleEdges = new Set<string>()

  function breakCycles(u: string) {
    visiting.add(u)
    visited.add(u)
    for (const v of rawAdj.get(u) ?? []) {
      if (visiting.has(v)) {
        cycleEdges.add(`${u}->${v}`)
      } else if (!visited.has(v)) {
        breakCycles(v)
      }
    }
    visiting.delete(u)
  }

  const sortedByOrder = [...nodesToLayout].sort(
    (a, b) => a.executionOrder - b.executionOrder || a.id.localeCompare(b.id),
  )
  for (const node of sortedByOrder) {
    if (!visited.has(node.id)) {
      breakCycles(node.id)
    }
  }

  const forwardEdges = new Map<string, string[]>()
  const inEdges = new Map<string, string[]>()
  for (const node of nodesToLayout) {
    forwardEdges.set(node.id, [])
    inEdges.set(node.id, [])
  }
  for (const node of nodesToLayout) {
    for (const targetId of rawAdj.get(node.id) ?? []) {
      if (!cycleEdges.has(`${node.id}->${targetId}`)) {
        forwardEdges.get(node.id)!.push(targetId)
        inEdges.get(targetId)!.push(node.id)
      }
    }
  }

  // Gán layer tổng thể (longest path trên DAG):
  const layers = new Map<string, number>()
  for (const node of nodesToLayout) {
    if (isSourceNode(node)) {
      layers.set(node.id, 0)
    } else if (isSinkNode(node)) {
      layers.set(node.id, 2)
    } else {
      layers.set(node.id, 1)
    }
  }

  const inDegree = new Map<string, number>()
  for (const node of nodesToLayout) {
    inDegree.set(node.id, inEdges.get(node.id)!.length)
  }

  const queue: string[] = []
  for (const node of nodesToLayout) {
    if (inDegree.get(node.id) === 0) {
      queue.push(node.id)
    }
  }

  while (queue.length > 0) {
    const u = queue.shift()!
    const uLayer = layers.get(u) ?? 0
    for (const v of forwardEdges.get(u) ?? []) {
      const minRequired = uLayer + 1
      if ((layers.get(v) ?? 0) < minRequired) {
        layers.set(v, minRequired)
      }
      const remaining = inDegree.get(v)! - 1
      inDegree.set(v, remaining)
      if (remaining === 0) {
        queue.push(v)
      }
    }
  }

  let maxIntermediateLayer = 0
  for (const node of nodesToLayout) {
    if (!isSourceNode(node) && !isSinkNode(node)) {
      maxIntermediateLayer = Math.max(maxIntermediateLayer, layers.get(node.id) ?? 1)
    }
  }
  for (const node of nodesToLayout) {
    if (isSinkNode(node)) {
      const cur = layers.get(node.id) ?? 2
      const target = Math.max(cur, maxIntermediateLayer + 1)
      layers.set(node.id, target)
    }
  }

  const distinctLayers = Array.from(new Set(layers.values())).sort((a, b) => a - b)
  const columns: FbdNode[][] = distinctLayers.map((l) =>
    nodesToLayout.filter((n) => layers.get(n.id) === l),
  )

  const newPositions: Record<string, FbdPoint> = { ...currentPositions }
  const warnings: string[] = []
  const nodeYMap = new Map<string, number>()

  const effectiveRowGap = network.wires.length > 0 ? Math.max(rowGap, 36) : rowGap

  if (network.wires.length === 0) {
    // Khi không có dây nối: xếp chồng chuẩn từ trên xuống theo executionOrder
    columns.forEach((col) => {
      col.sort((a, b) => a.executionOrder - b.executionOrder || a.id.localeCompare(b.id))
      let cursorY = margin
      for (const node of col) {
        nodeYMap.set(node.id, cursorY)
        cursorY += getNodeHeight(node, options?.nodeSizes) + rowGap
      }
    })
  } else {
    // Khi có dây nối: 2-way Sugiyama placement (căn Y theo mạch kết nối)
    // B1: Khởi tạo cột 0
    columns[0].sort((a, b) => a.executionOrder - b.executionOrder || a.id.localeCompare(b.id))
    let initY = margin
    for (const node of columns[0]) {
      nodeYMap.set(node.id, initY)
      initY += getNodeHeight(node, options?.nodeSizes) + effectiveRowGap
    }

    // B2: Chiều xuôi (forward pass) các cột 1..N
    for (let c = 1; c < columns.length; c++) {
      const col = columns[c]
      for (const node of col) {
        const preds = inEdges.get(node.id) ?? []
        if (preds.length > 0) {
          const bary =
            preds.reduce((sum, pid) => {
              const pn = nodeMap.get(pid)!
              return sum + (nodeYMap.get(pid) ?? margin) + getNodeHeight(pn, options?.nodeSizes) / 2
            }, 0) / preds.length
          nodeYMap.set(node.id, bary - getNodeHeight(node, options?.nodeSizes) / 2)
        } else {
          nodeYMap.set(node.id, margin + node.executionOrder * 80)
        }
      }

      col.sort((a, b) => (nodeYMap.get(a.id) ?? 0) - (nodeYMap.get(b.id) ?? 0) || a.executionOrder - b.executionOrder)

      let cursorY = margin
      for (const node of col) {
        const desired = nodeYMap.get(node.id) ?? cursorY
        const y = Math.max(cursorY, Math.round(desired / 8) * 8)
        nodeYMap.set(node.id, y)
        cursorY = y + getNodeHeight(node, options?.nodeSizes) + effectiveRowGap
      }
    }

    // B3: Chiều ngược (backward pass) trên cột 0 để gom input gần khối đích
    columns[0].sort((a, b) => {
      const sA = forwardEdges.get(a.id) ?? []
      const sB = forwardEdges.get(b.id) ?? []
      const baryA =
        sA.length > 0
          ? sA.reduce((sum, sid) => {
              const sn = nodeMap.get(sid)!
              return sum + (nodeYMap.get(sid) ?? margin) + getNodeHeight(sn, options?.nodeSizes) / 2
            }, 0) / sA.length
          : a.executionOrder * 1000
      const baryB =
        sB.length > 0
          ? sB.reduce((sum, sid) => {
              const sn = nodeMap.get(sid)!
              return sum + (nodeYMap.get(sid) ?? margin) + getNodeHeight(sn, options?.nodeSizes) / 2
            }, 0) / sB.length
          : b.executionOrder * 1000
      return baryA - baryB || a.executionOrder - b.executionOrder || a.id.localeCompare(b.id)
    })

    let curY0 = margin
    for (const node of columns[0]) {
      const succs = forwardEdges.get(node.id) ?? []
      let desired = curY0
      if (succs.length > 0) {
        const bary =
          succs.reduce((sum, sid) => {
            const sn = nodeMap.get(sid)!
            return sum + (nodeYMap.get(sid) ?? margin) + getNodeHeight(sn, options?.nodeSizes) / 2
          }, 0) / succs.length
        desired = bary - getNodeHeight(node, options?.nodeSizes) / 2
      }
      const y = Math.max(curY0, Math.round(desired / 8) * 8)
      nodeYMap.set(node.id, y)
      curY0 = y + getNodeHeight(node, options?.nodeSizes) + effectiveRowGap
    }

    // B4: Tinh chỉnh xuôi lần 2 cho các cột 1..N
    for (let c = 1; c < columns.length; c++) {
      const col = columns[c]
      col.sort((a, b) => {
        const predsA = inEdges.get(a.id) ?? []
        const predsB = inEdges.get(b.id) ?? []
        const baryA =
          predsA.length > 0
            ? predsA.reduce((sum, pid) => {
                const pn = nodeMap.get(pid)!
                return sum + (nodeYMap.get(pid) ?? margin) + getNodeHeight(pn, options?.nodeSizes) / 2
              }, 0) / predsA.length
            : a.executionOrder * 1000
        const baryB =
          predsB.length > 0
            ? predsB.reduce((sum, pid) => {
                const pn = nodeMap.get(pid)!
                return sum + (nodeYMap.get(pid) ?? margin) + getNodeHeight(pn, options?.nodeSizes) / 2
              }, 0) / predsB.length
            : b.executionOrder * 1000
        return baryA - baryB || a.executionOrder - b.executionOrder || a.id.localeCompare(b.id)
      })

      let cursorY = margin
      for (const node of col) {
        const preds = inEdges.get(node.id) ?? []
        let desired = cursorY
        if (preds.length > 0) {
          const bary =
            preds.reduce((sum, pid) => {
              const pn = nodeMap.get(pid)!
              return sum + (nodeYMap.get(pid) ?? margin) + getNodeHeight(pn, options?.nodeSizes) / 2
            }, 0) / preds.length
          desired = bary - getNodeHeight(node, options?.nodeSizes) / 2
        }
        const y = Math.max(cursorY, Math.round(desired / 8) * 8)
        nodeYMap.set(node.id, y)
        cursorY = y + getNodeHeight(node, options?.nodeSizes) + effectiveRowGap
      }
    }
  }

  // Toạ độ cột X theo bề rộng thực tế của các khối (tránh chồng lấn chiều ngang)
  let cursorX = margin
  columns.forEach((col) => {
    const colX = cursorX
    let maxColWidth = FBD_NODE_WIDTH
    for (const node of col) {
      const w = getNodeWidth(node, options?.nodeSizes)
      if (w > maxColWidth) maxColWidth = w
      const targetPoint: FbdPoint = {
        x: colX,
        y: nodeYMap.get(node.id)!,
      }
      if (isValidCoord(targetPoint.x) && isValidCoord(targetPoint.y)) {
        newPositions[node.id] = targetPoint
      } else {
        warnings.push(
          `Node ${node.id} auto-layout coordinate (${targetPoint.x}, ${targetPoint.y}) out of bounds or invalid`,
        )
      }
    }
    const minColGap = network.wires.length > 0 ? Math.max(columnGap, 280) : columnGap
    const step = maxColWidth > minColGap - 40 ? maxColWidth + 40 : minColGap
    cursorX += step
  })

  return {
    positions: newPositions,
    warnings,
  }
}

export function alignNodes(
  nodes: FbdNode[],
  positions: Record<string, FbdPoint>,
  alignment: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM',
): Record<string, FbdPoint> {
  if (nodes.length === 0) {
    return { ...positions }
  }

  const result: Record<string, FbdPoint> = { ...positions }

  switch (alignment) {
    case 'LEFT': {
      let minX = Infinity
      for (const node of nodes) {
        const p = positions[node.id]
        if (p && p.x < minX) minX = p.x
      }
      if (Number.isFinite(minX)) {
        for (const node of nodes) {
          const p = positions[node.id]
          if (p) {
            result[node.id] = { x: minX, y: p.y }
          }
        }
      }
      break
    }
    case 'RIGHT': {
      let maxX = -Infinity
      for (const node of nodes) {
        const p = positions[node.id]
        if (p && p.x > maxX) maxX = p.x
      }
      if (Number.isFinite(maxX)) {
        for (const node of nodes) {
          const p = positions[node.id]
          if (p) {
            result[node.id] = { x: maxX, y: p.y }
          }
        }
      }
      break
    }
    case 'TOP': {
      let minY = Infinity
      for (const node of nodes) {
        const p = positions[node.id]
        if (p && p.y < minY) minY = p.y
      }
      if (Number.isFinite(minY)) {
        for (const node of nodes) {
          const p = positions[node.id]
          if (p) {
            result[node.id] = { x: p.x, y: minY }
          }
        }
      }
      break
    }
    case 'BOTTOM': {
      let maxBottom = -Infinity
      for (const node of nodes) {
        const p = positions[node.id]
        if (p) {
          const bottom = p.y + fbdNodeHeight(node)
          if (bottom > maxBottom) maxBottom = bottom
        }
      }
      if (Number.isFinite(maxBottom)) {
        for (const node of nodes) {
          const p = positions[node.id]
          if (p) {
            result[node.id] = { x: p.x, y: maxBottom - fbdNodeHeight(node) }
          }
        }
      }
      break
    }
  }

  return result
}

export function distributeNodes(
  nodes: FbdNode[],
  positions: Record<string, FbdPoint>,
  direction: 'HORIZONTAL' | 'VERTICAL',
): Record<string, FbdPoint> {
  if (nodes.length < 3) {
    return { ...positions }
  }

  const validNodes = nodes.filter((n) => positions[n.id] !== undefined)
  if (validNodes.length < 3) {
    return { ...positions }
  }

  const result: Record<string, FbdPoint> = { ...positions }

  if (direction === 'HORIZONTAL') {
    const sorted = [...validNodes].sort(
      (a, b) => positions[a.id].x - positions[b.id].x,
    )
    const firstX = positions[sorted[0].id].x
    const lastX = positions[sorted[sorted.length - 1].id].x
    const step = (lastX - firstX) / (sorted.length - 1)

    sorted.forEach((node, index) => {
      const orig = positions[node.id]
      result[node.id] = { x: firstX + index * step, y: orig.y }
    })
  } else {
    const sorted = [...validNodes].sort(
      (a, b) => positions[a.id].y - positions[b.id].y,
    )
    const firstY = positions[sorted[0].id].y
    const lastY = positions[sorted[sorted.length - 1].id].y
    const step = (lastY - firstY) / (sorted.length - 1)

    sorted.forEach((node, index) => {
      const orig = positions[node.id]
      result[node.id] = { x: orig.x, y: firstY + index * step }
    })
  }

  return result
}
