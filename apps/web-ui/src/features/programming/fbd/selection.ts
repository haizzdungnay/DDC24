import type { FbdSelection } from './commands'
import type { FbdDocument, FbdNode, FbdPoint, FbdWire } from './model'

export interface FbdNodeBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface FbdSelectBox {
  left: number
  top: number
  width: number
  height: number
}

export interface FbdSubgraphClipboard {
  schemaVersion: 1
  networkId: string
  nodes: FbdNode[]
  internalWires: FbdWire[]
  layoutNodes: Record<string, FbdPoint>
}

export interface PastedSubgraphResult {
  nodes: FbdNode[]
  wires: FbdWire[]
  layoutNodes: Record<string, FbdPoint>
  remappedNodeIds: string[]
}

export function toggleNodeSelection(
  current: string[],
  targetId: string,
  mode: 'replace' | 'toggle' | 'range',
  allOrderedIds?: string[],
): string[] {
  if (mode === 'replace') {
    return [targetId]
  }

  if (mode === 'toggle') {
    const set = new Set(current)
    if (set.has(targetId)) {
      set.delete(targetId)
    } else {
      set.add(targetId)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }

  // mode === 'range'
  if (!allOrderedIds || allOrderedIds.length === 0) {
    return [targetId]
  }

  const targetIndex = allOrderedIds.indexOf(targetId)
  if (targetIndex < 0) {
    return [targetId]
  }

  if (current.length === 0) {
    return [targetId]
  }

  const anchorId = current[0]
  const anchorIndex = allOrderedIds.indexOf(anchorId)
  if (anchorIndex < 0) {
    return [targetId]
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  const rangeNodes = allOrderedIds.slice(start, end + 1)
  return Array.from(new Set(rangeNodes)).sort((a, b) => a.localeCompare(b))
}

export function boxSelectNodes(
  nodes: FbdNodeBox[],
  box: FbdSelectBox,
  mode: 'intersect' | 'contain' = 'intersect',
): string[] {
  const boxLeft = Math.min(box.left, box.left + box.width)
  const boxRight = Math.max(box.left, box.left + box.width)
  const boxTop = Math.min(box.top, box.top + box.height)
  const boxBottom = Math.max(box.top, box.top + box.height)

  const selected: string[] = []

  for (const node of nodes) {
    const nodeLeft = node.x
    const nodeRight = node.x + node.width
    const nodeTop = node.y
    const nodeBottom = node.y + node.height

    if (mode === 'contain') {
      const isContained =
        nodeLeft >= boxLeft &&
        nodeRight <= boxRight &&
        nodeTop >= boxTop &&
        nodeBottom <= boxBottom
      if (isContained) {
        selected.push(node.id)
      }
    } else {
      // intersect
      const noOverlap =
        nodeRight < boxLeft ||
        nodeLeft > boxRight ||
        nodeBottom < boxTop ||
        nodeTop > boxBottom
      if (!noOverlap) {
        selected.push(node.id)
      }
    }
  }

  return selected.sort((a, b) => a.localeCompare(b))
}

export function isNodeSelected(selection: FbdSelection | null, nodeId: string): boolean {
  if (!selection) return false
  if (selection.kind === 'node') {
    return selection.nodeId === nodeId
  }
  if (selection.kind === 'multi-node') {
    return selection.nodeIds.includes(nodeId)
  }
  return false
}

export function getSelectedNodeIds(selection: FbdSelection | null): string[] {
  if (!selection) return []
  if (selection.kind === 'node') {
    return [selection.nodeId]
  }
  if (selection.kind === 'multi-node') {
    return [...selection.nodeIds].sort((a, b) => a.localeCompare(b))
  }
  return []
}

export function copySubgraph(
  doc: FbdDocument,
  networkId: string,
  nodeIds: string[],
): FbdSubgraphClipboard | null {
  if (!nodeIds || nodeIds.length === 0) return null
  const network = doc.networks.find((n) => n.id === networkId)
  if (!network) return null

  const nodeIdSet = new Set(nodeIds)
  const matchedNodes = network.nodes.filter((n) => nodeIdSet.has(n.id))
  if (matchedNodes.length === 0) return null

  // Chỉ lấy internal wires: cả fromNodeId lẫn toNodeId đều nằm trong nodeIdSet
  const internalWires = network.wires.filter(
    (w) => nodeIdSet.has(w.from.nodeId) && nodeIdSet.has(w.to.nodeId),
  )

  const layoutNodes: Record<string, FbdPoint> = {}
  if (doc.layout?.nodes) {
    for (const node of matchedNodes) {
      if (doc.layout.nodes[node.id]) {
        layoutNodes[node.id] = { ...doc.layout.nodes[node.id] }
      }
    }
  }

  return {
    schemaVersion: 1,
    networkId,
    nodes: JSON.parse(JSON.stringify(matchedNodes)) as FbdNode[],
    internalWires: JSON.parse(JSON.stringify(internalWires)) as FbdWire[],
    layoutNodes,
  }
}

function defaultUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return '00000000-0000-4000-8000-000000000000'
}

export function createPastedSubgraph(
  clipboard: {
    schemaVersion: 1
    networkId: string
    nodes: FbdNode[]
    internalWires: FbdWire[]
    layoutNodes?: Record<string, FbdPoint>
  },
  offset?: FbdPoint,
  uuidGenerator?: () => string,
): PastedSubgraphResult {
  const gen = uuidGenerator ?? defaultUuid
  const nodeMap = new Map<string, string>()
  const portMap = new Map<string, string>()

  const newNodes: FbdNode[] = clipboard.nodes.map((node) => {
    const newNodeId = gen()
    nodeMap.set(node.id, newNodeId)

    const newPorts = node.ports.map((port) => {
      const newPortId = gen()
      portMap.set(port.id, newPortId)
      return {
        ...port,
        id: newPortId,
      }
    })

    return {
      ...node,
      id: newNodeId,
      ports: newPorts,
    }
  })

  const newWires: FbdWire[] = clipboard.internalWires.map((wire) => {
    const newWireId = gen()
    const fromNodeId = nodeMap.get(wire.from.nodeId) ?? wire.from.nodeId
    const fromPortId = portMap.get(wire.from.portId) ?? wire.from.portId
    const toNodeId = nodeMap.get(wire.to.nodeId) ?? wire.to.nodeId
    const toPortId = portMap.get(wire.to.portId) ?? wire.to.portId

    return {
      ...wire,
      id: newWireId,
      from: { nodeId: fromNodeId, portId: fromPortId },
      to: { nodeId: toNodeId, portId: toPortId },
    }
  })

  const dx = offset?.x ?? 0
  const dy = offset?.y ?? 0
  const newLayoutNodes: Record<string, FbdPoint> = {}

  if (clipboard.layoutNodes) {
    for (const [oldId, point] of Object.entries(clipboard.layoutNodes)) {
      const newId = nodeMap.get(oldId)
      if (newId) {
        newLayoutNodes[newId] = {
          x: Math.round(point.x + dx),
          y: Math.round(point.y + dy),
        }
      }
    }
  }

  const remappedNodeIds = Array.from(nodeMap.values())

  return {
    nodes: newNodes,
    wires: newWires,
    layoutNodes: newLayoutNodes,
    remappedNodeIds,
  }
}
