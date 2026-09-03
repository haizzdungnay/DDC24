import type { FbdNode, FbdPoint } from './model'
import type { FbdNodeGeometry, FbdWireGeometry } from './geometry'
import { FBD_NODE_HEADER_HEIGHT, FBD_NODE_WIDTH } from './geometry'
import type { FbdSelection } from './commands'

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
  select: (next: FbdSelection) => void
  beginDrag: (event: React.PointerEvent<SVGGElement>, node: FbdNode) => void
  moveDrag: (event: React.PointerEvent<SVGGElement>) => void
  endDrag: (event: React.PointerEvent<SVGGElement>) => void
  cancelDrag: () => void
  registerPort: (portId: string, element: SVGGElement | null) => void
}

export function FbdNodesLayer({
  nodes,
  nodesById,
  selection,
  connectionFromPortId,
  canEdit,
  networkId,
  tempPositions,
  select,
  beginDrag,
  moveDrag,
  endDrag,
  cancelDrag,
  registerPort,
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

        return (
          <g key={placed.id} transform={dx !== 0 || dy !== 0 ? `translate(${dx}, ${dy})` : undefined}>
            <g
              role="button"
              tabIndex={0}
              aria-label={`#${node.executionOrder} · ${node.typeRef} · ${node.kind}`}
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
                stroke={isSelected ? 'var(--c-accent)' : 'var(--c-border)'}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text x={placed.x + 10} y={placed.y + 18} className="text-[11px]" fill="var(--c-text)">
                #{node.executionOrder} · {node.typeRef}
              </text>
              <text x={placed.x + 10} y={placed.y + 32} className="text-[10px]" fill="var(--c-text-dim)">
                {node.kind}
              </text>
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
                  onClick={() => select({ kind: 'port', networkId, nodeId: placed.id, portId: port.id })}
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
                  >
                    {definition.name}
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
