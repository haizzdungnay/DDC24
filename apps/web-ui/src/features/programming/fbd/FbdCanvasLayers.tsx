import type { FbdNode, FbdPoint } from './model'
import type { FbdNodeGeometry, FbdPortGeometry, FbdWireGeometry } from './geometry'
import {
  FBD_NODE_HEADER_HEIGHT,
  FBD_NODE_PADDING_BOTTOM,
  FBD_NODE_WIDTH,
  FBD_PORT_ROW_HEIGHT,
  fbdWirePathBezier,
  fbdWirePathOrthogonal,
} from './geometry'
import type { FbdSelection } from './commands'
import { fbdPaletteEntry } from './palette'
import { formatNodeParameterSummary, formatPortLabel } from './nodeLabel'

export interface FbdGridPatternProps {
  networkId: string
  snapSize: number
  gridVisible: boolean
}

export function FbdGridPattern({ networkId, snapSize, gridVisible }: FbdGridPatternProps) {
  if (!gridVisible) return null
  const patternId = `fbd-grid-${networkId}`
  return (
    <defs>
      <pattern
        id={patternId}
        width={snapSize * 2}
        height={snapSize * 2}
        patternUnits="userSpaceOnUse"
      >
        <circle cx={snapSize} cy={snapSize} r={1} fill="var(--c-border)" opacity={0.6} />
      </pattern>
    </defs>
  )
}

export interface FbdWiresLayerProps {
  wires: readonly FbdWireGeometry[]
  selection: FbdSelection | null
  networkId: string
  pick: (vi: string, en: string) => string
  select: (next: FbdSelection) => void
}

export function FbdWiresLayer({ wires, selection, networkId, pick, select }: FbdWiresLayerProps) {
  return (
    <>
      <g aria-hidden="true">
        {wires.map((wire) => (
          <path
            key={`shadow-${wire.id}`}
            d={wire.path}
            fill="none"
            stroke="var(--c-bg)"
            strokeWidth={5}
          />
        ))}
      </g>
      {wires.map((wire) => {
        const active = selection?.kind === 'wire' && selection.wireId === wire.id
        return (
          <path
            key={wire.id}
            role="button"
            tabIndex={0}
            aria-label={pick(`Dây nối tới ${wire.to.x},${wire.to.y}`, `Wire to ${wire.to.x},${wire.to.y}`)}
            aria-pressed={active}
            d={wire.path}
            fill="none"
            stroke={active ? 'var(--c-accent)' : 'var(--c-text-dim)'}
            strokeWidth={active ? 2.5 : 1.5}
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            onClick={() => select({ kind: 'wire', networkId, wireId: wire.id })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                select({ kind: 'wire', networkId, wireId: wire.id })
              }
            }}
          />
        )
      })}
    </>
  )
}

export interface FbdNodesLayerProps {
  nodes: readonly FbdNodeGeometry[]
  nodesById: Map<string, FbdNode>
  selection: FbdSelection | null
  connectionFromPortId: string | null
  canEdit: boolean
  networkId: string
  tempPositions: Map<string, FbdPoint> | null
  issueNodeIds?: ReadonlySet<string>
  pick?: (vi: string, en: string) => string
  select: (next: FbdSelection) => void
  beginDrag: (event: React.PointerEvent<SVGGElement>, node: FbdNode) => void
  moveDrag: (event: React.PointerEvent<SVGGElement>) => void
  endDrag: (event: React.PointerEvent<SVGGElement>) => void
  cancelDrag: () => void
  registerPort: (portId: string, element: SVGGElement | null) => void
  onPortPointerDown?: (event: React.PointerEvent<SVGGElement>, port: FbdPortGeometry) => void
  onPortPointerUp?: (event: React.PointerEvent<SVGGElement>, port: FbdPortGeometry) => void
  onPortClick?: (event: React.MouseEvent<SVGGElement>, port: FbdPortGeometry) => void
}

export function FbdNodesLayer({
  nodes,
  nodesById,
  selection,
  connectionFromPortId,
  canEdit,
  networkId,
  tempPositions,
  issueNodeIds,
  pick,
  select,
  beginDrag,
  moveDrag,
  endDrag,
  cancelDrag,
  registerPort,
  onPortPointerDown,
  onPortPointerUp,
  onPortClick,
}: FbdNodesLayerProps) {
  return (
    <>
      {nodes.map((placed) => {
        const node = nodesById.get(placed.id)
        if (!node) return null

        const currentPos = tempPositions?.get(placed.id) ?? { x: placed.x, y: placed.y }
        const dx = currentPos.x - placed.x
        const dy = currentPos.y - placed.y

        const isSelected =
          (selection?.kind === 'node' && selection.nodeId === placed.id) ||
          (selection?.kind === 'multi-node' && selection.nodeIds.includes(placed.id))

        const hasIssue = issueNodeIds?.has(placed.id) === true
        const issueNotice = hasIssue
          ? pick
            ? pick(' · Có lỗi chẩn đoán', ' · Has diagnostic issue')
            : ' · Có lỗi chẩn đoán'
          : ''

        const paramSummary = formatNodeParameterSummary(node.kind, node.parameters)

        return (
          <g
            key={placed.id}
            data-fbd-node-id={placed.id}
            transform={dx !== 0 || dy !== 0 ? `translate(${dx}, ${dy})` : undefined}
          >
            <g
              role="button"
              tabIndex={0}
              aria-label={`#${node.executionOrder} · ${node.typeRef} · ${node.kind}${issueNotice}`}
              aria-pressed={isSelected}
              className={
                canEdit
                  ? 'cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]'
                  : 'cursor-pointer'
              }
              onClick={(e) => {
                // If ctrl or shift is pressed, allow multi-selection handled elsewhere or default to single
                if (!e.defaultPrevented) {
                  select({ kind: 'node', networkId, nodeId: placed.id })
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  select({ kind: 'node', networkId, nodeId: placed.id })
                }
              }}
              onPointerDown={(event) => beginDrag(event, node)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            >
              <rect
                x={placed.x}
                y={placed.y}
                width={placed.width}
                height={placed.height}
                rx={6}
                fill="var(--c-surface-2)"
                stroke={
                  isSelected
                    ? 'var(--c-accent)'
                    : hasIssue
                    ? 'var(--c-warn-fg)'
                    : 'var(--c-border)'
                }
                strokeWidth={isSelected || hasIssue ? 2 : 1}
              />
              {hasIssue && (
                <circle
                  cx={placed.x + placed.width - 12}
                  cy={placed.y + 12}
                  r={4}
                  fill="var(--c-warn-fg)"
                  data-fbd-node-issue="true"
                  aria-hidden="true"
                />
              )}
              <text x={placed.x + 10} y={placed.y + 16} className="text-[11px]" fill="var(--c-text)">
                #{node.executionOrder} · {node.typeRef}
              </text>
              <text
                x={placed.x + 10}
                y={placed.y + (paramSummary ? 26 : 30)}
                className="text-[9px]"
                fill="var(--c-text-dim)"
              >
                {node.kind}
              </text>
              {paramSummary && (
                <text
                  x={placed.x + 10}
                  y={placed.y + 35}
                  data-fbd-node-param="true"
                  className="text-[9px] font-mono"
                  fill="var(--c-text)"
                >
                  {paramSummary}
                </text>
              )}
              <line
                x1={placed.x}
                y1={placed.y + FBD_NODE_HEADER_HEIGHT - 4}
                x2={placed.x + FBD_NODE_WIDTH}
                y2={placed.y + FBD_NODE_HEADER_HEIGHT - 4}
                stroke="var(--c-border)"
                strokeWidth={1}
              />
            </g>
            {placed.ports.map((port) => {
              const definition = node.ports.find((item) => item.id === port.id)
              if (!definition) return null
              const selected = selection?.kind === 'port' && selection.portId === port.id
              const isSource = connectionFromPortId === port.id
              return (
                <g
                  key={port.id}
                  ref={(element) => registerPort(port.id, element)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.typeRef} ${definition.direction} ${definition.name} ${definition.dataType}${definition.unit ? ` ${definition.unit}` : ''}`}
                  aria-pressed={selected}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  onPointerDown={(event) => {
                    // Ngăn node drag nuốt cử chỉ wire (G4)
                    event.stopPropagation()
                    onPortPointerDown?.(event, port)
                  }}
                  onPointerUp={(event) => {
                    event.stopPropagation()
                    onPortPointerUp?.(event, port)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (onPortClick) {
                      onPortClick(event, port)
                    } else {
                      select({ kind: 'port', networkId, nodeId: placed.id, portId: port.id })
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      select({ kind: 'port', networkId, nodeId: placed.id, portId: port.id })
                    }
                  }}
                >
                  <circle
                    cx={port.cx}
                    cy={port.cy}
                    r={selected || isSource ? 6 : 4}
                    fill={selected || isSource ? 'var(--c-accent)' : 'var(--c-surface)'}
                    stroke={selected || isSource ? 'var(--c-accent)' : 'var(--c-border)'}
                    strokeWidth={1.5}
                  />
                  <text
                    x={port.direction === 'INPUT' ? port.cx + 10 : port.cx - 10}
                    y={port.cy + 3}
                    textAnchor={port.direction === 'INPUT' ? 'start' : 'end'}
                    className="text-[10px]"
                    fill="var(--c-text-dim)"
                    data-fbd-port-text="true"
                  >
                    {formatPortLabel(definition.name, definition.dataType, definition.unit)}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </>
  )
}

export interface FbdMarqueeLayerProps {
  marquee: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
}

export function FbdMarqueeLayer({ marquee }: FbdMarqueeLayerProps) {
  if (!marquee) return null
  const left = Math.min(marquee.startX, marquee.currentX)
  const top = Math.min(marquee.startY, marquee.currentY)
  const width = Math.abs(marquee.currentX - marquee.startX)
  const height = Math.abs(marquee.currentY - marquee.startY)

  return (
    <rect
      data-fbd-marquee="true"
      x={left}
      y={top}
      width={width}
      height={height}
      fill="var(--c-accent)"
      fillOpacity={0.15}
      stroke="var(--c-accent)"
      strokeWidth={1.5}
      strokeDasharray="4 2"
      pointerEvents="none"
    />
  )
}

export interface FbdWirePreviewLayerProps {
  preview: {
    from: FbdPoint
    to: FbdPoint
  } | null
  wireStyle?: 'ORTHOGONAL' | 'BEZIER'
}

export function FbdWirePreviewLayer({ preview, wireStyle = 'BEZIER' }: FbdWirePreviewLayerProps) {
  if (!preview) return null

  const d =
    wireStyle === 'ORTHOGONAL'
      ? fbdWirePathOrthogonal(preview.from, preview.to)
      : fbdWirePathBezier(preview.from, preview.to)

  return (
    <g data-fbd-wire-preview="true" pointerEvents="none" aria-hidden="true">
      {/* Shadow path */}
      <path
        d={d}
        fill="none"
        stroke="var(--c-bg)"
        strokeWidth={5}
      />
      {/* Dashed preview line */}
      <path
        d={d}
        fill="none"
        stroke="var(--c-accent)"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      {/* End circle */}
      <circle
        cx={preview.to.x}
        cy={preview.to.y}
        r={4}
        fill="var(--c-accent)"
      />
    </g>
  )
}

export interface FbdGhostLayerProps {
  ghost: {
    typeRef: string
    x: number
    y: number
  } | null
}

export function FbdGhostLayer({ ghost }: FbdGhostLayerProps) {
  if (!ghost) return null

  const entry = fbdPaletteEntry(ghost.typeRef)
  const dummyPorts = entry ? entry.buildPorts(entry.defaultType) : []
  const inputs = dummyPorts.filter((p) => p.direction === 'INPUT').length
  const outputs = dummyPorts.filter((p) => p.direction === 'OUTPUT').length
  const rows = Math.max(inputs, outputs, 1)
  const height = FBD_NODE_HEADER_HEIGHT + rows * FBD_PORT_ROW_HEIGHT + FBD_NODE_PADDING_BOTTOM
  const width = FBD_NODE_WIDTH

  return (
    <g
      data-fbd-ghost="true"
      transform={`translate(${ghost.x}, ${ghost.y})`}
      pointerEvents="none"
      aria-hidden="true"
      opacity={0.65}
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={6}
        fill="var(--c-surface-2)"
        stroke="var(--c-accent)"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <text x={10} y={18} className="text-[11px]" fill="var(--c-text)">
        {ghost.typeRef}
      </text>
      {entry && (
        <text x={10} y={32} className="text-[10px]" fill="var(--c-text-dim)">
          {entry.kind}
        </text>
      )}
      <line
        x1={0}
        y1={FBD_NODE_HEADER_HEIGHT - 4}
        x2={width}
        y2={FBD_NODE_HEADER_HEIGHT - 4}
        stroke="var(--c-border)"
        strokeWidth={1}
      />
    </g>
  )
}
