import {
  FBD_CANVAS_MARGIN,
  FBD_COLUMN_GAP,
  FBD_ROW_GAP,
  fbdNodeHeight,
} from './geometry'
import type { FbdNetwork, FbdNode, FbdPoint } from './model'

export interface AutoLayoutOptions {
  scope?: 'SELECTED' | 'ALL'
  selectedNodeIds?: string[]
  columnGap?: number
  rowGap?: number
  margin?: number
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

  const ordered = [...nodesToLayout].sort(
    (left, right) =>
      left.executionOrder - right.executionOrder || left.id.localeCompare(right.id),
  )

  const sources: FbdNode[] = []
  const sinks: FbdNode[] = []
  const intermediate: FbdNode[] = []

  for (const node of ordered) {
    if (isSourceNode(node)) {
      sources.push(node)
    } else if (isSinkNode(node)) {
      sinks.push(node)
    } else {
      intermediate.push(node)
    }
  }

  const columns: FbdNode[][] = [sources, intermediate, sinks].filter(
    (col) => col.length > 0,
  )

  const newPositions: Record<string, FbdPoint> = { ...currentPositions }
  const warnings: string[] = []

  columns.forEach((col, colIndex) => {
    let cursorY = margin
    const colX = margin + colIndex * columnGap
    for (const node of col) {
      const targetPoint: FbdPoint = { x: colX, y: cursorY }
      if (isValidCoord(targetPoint.x) && isValidCoord(targetPoint.y)) {
        newPositions[node.id] = targetPoint
      } else {
        warnings.push(
          `Node ${node.id} auto-layout coordinate (${targetPoint.x}, ${targetPoint.y}) out of bounds or invalid`,
        )
      }
      cursorY += fbdNodeHeight(node) + rowGap
    }
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
