import type { FbdNetwork, FbdPoint } from './model'
import type { FbdNetworkGeometry, FbdNodeGeometry } from './geometry'
import type { FbdWireReferenceMap } from './wireReferences'

export const FBD_REF_STUB_WIDTH = 96
export const FBD_REF_STUB_HEIGHT = 20
export const FBD_REF_CHEVRON_ARROW = 6
export const FBD_REF_PORT_GAP = 8
export const FBD_REF_CORNER_RADIUS = 4
export const FBD_REF_STUB_STACK_GAP = 4
export const FBD_REF_MAX_LABEL_LEN = 32
export const FBD_REF_HIT_PADDING = 4

export function computeStubWidth(
  signalNameOrSource?: string | FbdNodeGeometry | null,
  sourceOrDest?: FbdNodeGeometry | null,
  destNodeGeom?: FbdNodeGeometry | null
): number {
  let signalName = ''
  let sourceNode: FbdNodeGeometry | null = null
  let destNode: FbdNodeGeometry | null = null

  if (typeof signalNameOrSource === 'string') {
    signalName = signalNameOrSource
    sourceNode = sourceOrDest ?? null
    destNode = destNodeGeom ?? null
  } else {
    sourceNode = signalNameOrSource ?? null
    destNode = sourceOrDest ?? null
  }

  // Base width calculated from signal name length so full name fits
  // font-mono 10px character is ~6.2px wide. Chevron arrow is 6px. Paddings ~24px.
  const neededWidth = signalName
    ? Math.max(FBD_REF_STUB_WIDTH, Math.ceil(signalName.length * 6.5) + 26)
    : FBD_REF_STUB_WIDTH

  if (sourceNode && destNode) {
    const deltaX = destNode.x - (sourceNode.x + sourceNode.width)
    if (deltaX > 0) {
      if (deltaX <= 80) {
        return Math.max(36, Math.round(deltaX - 24))
      }
      const minSpan = neededWidth * 2 + 32
      if (deltaX < minSpan) {
        return Math.max(36, Math.floor((deltaX - 32) / 2))
      }
    }
  }
  return neededWidth
}

export function computeSourceStubPath(x: number, y: number, width: number, height: number, arrow: number): string {
  const xStart = x
  const yTop = y
  const w = width
  const h = height
  const a = arrow
  const cy = yTop + h / 2
  return `M ${xStart} ${yTop} L ${xStart + w - a} ${yTop} L ${xStart + w} ${cy} L ${xStart + w - a} ${yTop + h} L ${xStart} ${yTop + h} Z`
}

export function computeSinkStubPath(x: number, y: number, width: number, height: number, arrow: number): string {
  const xStart = x
  const xEnd = x + width
  const yTop = y
  const h = height
  const a = arrow
  const cy = yTop + h / 2
  return `M ${xStart} ${yTop} L ${xEnd - a} ${yTop} L ${xEnd} ${cy} L ${xEnd - a} ${yTop + h} L ${xStart} ${yTop + h} L ${xStart + a} ${cy} Z`
}

export interface FbdSourceStubGeometry {
  nodeId: string
  portId: string
  portAnchor: FbdPoint
  offset: number
  x: number
  y: number
  width: number
  height: number
  neckPath: string
  path: string
  textX: number
  textY: number
  signalName: string
  fanOutCount: number
  wireIds: readonly string[]
  valueChipCenter: FbdPoint
}

export interface FbdSinkStubGeometry {
  wireId: string
  nodeId: string
  portId: string
  portAnchor: FbdPoint
  offset: number
  x: number
  y: number
  width: number
  height: number
  neckPath: string
  path: string
  textX: number
  textY: number
  signalName: string
  sourceNodeId: string
  sourcePortId: string
  valueChipCenter: FbdPoint
}

export interface FbdReferenceLayerGeometry {
  sources: readonly FbdSourceStubGeometry[]
  sinks: readonly FbdSinkStubGeometry[]
  byWireId: ReadonlyMap<string, { source: FbdSourceStubGeometry; sink: FbdSinkStubGeometry }>
}

export function computeReferenceGeometry(
  network: FbdNetwork,
  geometry: FbdNetworkGeometry,
  wireReferences: FbdWireReferenceMap,
  tempOffsets?: {
    sources?: ReadonlyMap<string, number>
    sinks?: ReadonlyMap<string, number>
  }
): FbdReferenceLayerGeometry {
  const refWires = network.wires.filter((w) => Boolean(wireReferences[w.id]) && geometry.byPortId.has(w.from.portId) && geometry.byPortId.has(w.to.portId))
  if (refWires.length === 0) {
    return { sources: [], sinks: [], byWireId: new Map() }
  }

  // 1. Nhóm các wire theo cổng OUTPUT phát
  const wiresBySourcePort = new Map<string, typeof refWires>()
  for (const wire of refWires) {
    const key = `${wire.from.nodeId}:${wire.from.portId}`
    const group = wiresBySourcePort.get(key) ?? []
    group.push(wire)
    wiresBySourcePort.set(key, group)
  }

  const sources: FbdSourceStubGeometry[] = []
  const sinks: FbdSinkStubGeometry[] = []
  const byWireId = new Map<string, { source: FbdSourceStubGeometry; sink: FbdSinkStubGeometry }>()
  const sourceStubByKey = new Map<string, FbdSourceStubGeometry>()

  // 2. Tính toạ độ Source Stubs
  for (const [key, group] of wiresBySourcePort.entries()) {
    const firstWire = group[0]
    const portGeom = geometry.byPortId.get(firstWire.from.portId)
    const sourceNodeGeom = geometry.byNodeId.get(firstWire.from.nodeId)
    if (!portGeom) continue

    const refItem = wireReferences[firstWire.id]
    const signalName = refItem?.signalName || 'SIG'
    const wireIds = group.map((w) => w.id)

    // Xác định khoảng cách hẹp nhất tới các đích để tự co độ rộng nếu cần
    let minWidth = computeStubWidth(signalName, sourceNodeGeom)
    for (const w of group) {
      const destNodeGeom = geometry.byNodeId.get(w.to.nodeId)
      const wWidth = computeStubWidth(signalName, sourceNodeGeom, destNodeGeom)
      if (wWidth < minWidth) minWidth = wWidth
    }

    const savedOffset = typeof refItem?.sourceOffset === 'number' && refItem.sourceOffset >= 8
      ? refItem.sourceOffset
      : FBD_REF_PORT_GAP
    const offset = tempOffsets?.sources?.get(key) ?? savedOffset

    const cx = portGeom.cx
    const cy = portGeom.cy
    const xStart = cx + offset
    const yTop = cy - FBD_REF_STUB_HEIGHT / 2
    const width = minWidth
    const height = FBD_REF_STUB_HEIGHT
    const arrow = FBD_REF_CHEVRON_ARROW

    const neckPath = `M ${cx} ${cy} L ${xStart} ${cy}`
    const path = computeSourceStubPath(xStart, yTop, width, height, arrow)
    const textX = Math.round(xStart + (width - arrow) / 2)
    const textY = cy
    const valueChipCenter: FbdPoint = {
      x: Math.round(xStart + width / 2),
      y: Math.round(yTop - 8),
    }

    const sourceStub: FbdSourceStubGeometry = {
      nodeId: firstWire.from.nodeId,
      portId: firstWire.from.portId,
      portAnchor: { x: cx, y: cy },
      offset,
      x: xStart,
      y: yTop,
      width,
      height,
      neckPath,
      path,
      textX,
      textY,
      signalName,
      fanOutCount: group.length,
      wireIds,
      valueChipCenter,
    }

    sources.push(sourceStub)
    sourceStubByKey.set(key, sourceStub)
  }

  // 3. Tính toạ độ Sink Stubs
  for (const wire of refWires) {
    const portGeom = geometry.byPortId.get(wire.to.portId)
    const destNodeGeom = geometry.byNodeId.get(wire.to.nodeId)
    const sourceNodeGeom = geometry.byNodeId.get(wire.from.nodeId)
    if (!portGeom) continue

    const refItem = wireReferences[wire.id]
    const signalName = refItem?.signalName || 'SIG'
    const width = computeStubWidth(signalName, sourceNodeGeom, destNodeGeom)
    const height = FBD_REF_STUB_HEIGHT
    const arrow = FBD_REF_CHEVRON_ARROW

    const savedOffset = typeof refItem?.sinkOffset === 'number' && refItem.sinkOffset >= 8
      ? refItem.sinkOffset
      : FBD_REF_PORT_GAP
    const offset = tempOffsets?.sinks?.get(wire.id) ?? savedOffset

    const cx = portGeom.cx
    const cy = portGeom.cy
    const xEnd = cx - offset
    const xStart = xEnd - width
    const yTop = cy - height / 2

    const neckPath = `M ${xEnd} ${cy} L ${cx} ${cy}`
    const path = computeSinkStubPath(xStart, yTop, width, height, arrow)
    const textX = Math.round(xStart + width / 2)
    const textY = cy
    const valueChipCenter: FbdPoint = {
      x: Math.round(xStart + width / 2),
      y: Math.round(yTop - 8),
    }

    const sinkStub: FbdSinkStubGeometry = {
      wireId: wire.id,
      nodeId: wire.to.nodeId,
      portId: wire.to.portId,
      portAnchor: { x: cx, y: cy },
      offset,
      x: xStart,
      y: yTop,
      width,
      height,
      neckPath,
      path,
      textX,
      textY,
      signalName,
      sourceNodeId: wire.from.nodeId,
      sourcePortId: wire.from.portId,
      valueChipCenter,
    }

    sinks.push(sinkStub)

    const sourceKey = `${wire.from.nodeId}:${wire.from.portId}`
    const sourceStub = sourceStubByKey.get(sourceKey)
    if (sourceStub) {
      byWireId.set(wire.id, { source: sourceStub, sink: sinkStub })
    }
  }

  return { sources, sinks, byWireId }
}
