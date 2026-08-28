import { useMemo, useRef, useState, type Dispatch } from 'react'
import type { FbdEditorAction, FbdSelection } from './commands'
import {
  buildFbdNetworkGeometry,
  FBD_MINIMAP_HEIGHT,
  FBD_MINIMAP_NODE_THRESHOLD,
  FBD_MINIMAP_WIDTH,
  FBD_NODE_HEADER_HEIGHT,
  FBD_NODE_WIDTH,
} from './geometry'
import type { FbdDocument, FbdNetwork, FbdNode } from './model'

/**
 * `T59-806` / `AC-FBD-001` — canvas node–edge thật.
 *
 * Bản trước vẽ block thành các thẻ xếp lưới và liệt kê dây thành một hàng nút
 * `abcd1234 → ef567890`. Nghĩa là **dây bị giấu**: thứ duy nhất một sơ đồ FBD
 * tồn tại để nói — cái gì nối vào cái gì — lại là thứ người dùng phải tự ghép
 * bằng cách đối chiếu tám ký tự đầu của UUID.
 *
 * Canvas này vẽ bằng SVG thuần, KHÔNG thêm thư viện: ngân sách chunk R1 chỉ
 * còn ~17 KiB gzip (`GATE-PROG-ST-EDITOR-DEP-001`), mà một thư viện canvas
 * cũng cần chừng đó hoặc hơn — và chính plan `WP-05` đã đặt sẵn đường lùi
 * "SVG fallback nếu spike gate đỏ".
 *
 * Bàn phím vẫn đi trước: mỗi block, mỗi port và mỗi dây là một phần tử nhận
 * tiêu điểm với `role="button"` và nhãn đọc được, nên toàn bộ luồng chọn/nối
 * cũ chạy y nguyên trên canvas mới.
 */

const MIN_SCALE = 0.4
const MAX_SCALE = 2.5
const ZOOM_STEP = 0.2

interface DragState {
  nodeId: string
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  dx: number
  dy: number
}

export function FbdCanvas({
  network,
  layout,
  selection,
  connectionFromPortId,
  canEdit,
  dispatch,
  pick,
  registerPort,
}: {
  network: FbdNetwork
  layout: FbdDocument['layout']
  selection: FbdSelection | null
  connectionFromPortId: string | null
  canEdit: boolean
  dispatch: Dispatch<FbdEditorAction>
  pick: (vi: string, en: string) => string
  registerPort: (portId: string, element: SVGGElement | null) => void
}) {
  const [scale, setScale] = useState(1)
  const [drag, setDrag] = useState<DragState | null>(null)
  const surfaceRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const geometry = useMemo(() => buildFbdNetworkGeometry(network, layout), [network, layout])
  const nodesById = useMemo(() => new Map(network.nodes.map((node) => [node.id, node])), [network.nodes])

  /* Trong lúc kéo, hình học được dịch tại chỗ chứ KHÔNG dispatch từng frame:
   * mỗi dispatch là một mục lịch sử, nên kéo một block sẽ nuốt sạch undo
   * stack. Một thao tác kéo = một lệnh, phát khi thả tay. */
  const dragged = drag
    ? { id: drag.nodeId, x: drag.originX + drag.dx, y: drag.originY + drag.dy }
    : null
  const view = useMemo(() => {
    if (!dragged) return geometry
    return buildFbdNetworkGeometry(network, {
      schemaVersion: 1,
      nodes: { ...(layout?.nodes ?? {}), [dragged.id]: { x: dragged.x, y: dragged.y } },
    })
  }, [geometry, dragged, network, layout])

  const width = Math.max(view.width, 320)
  const height = Math.max(view.height, 200)

  function select(next: FbdSelection) {
    dispatch({ type: 'SELECT', selection: next })
  }

  function beginDrag(event: React.PointerEvent<SVGGElement>, node: FbdNode) {
    if (!canEdit || event.button !== 0) return
    const placed = geometry.byNodeId.get(node.id)
    if (!placed) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: placed.x,
      originY: placed.y,
      dx: 0,
      dy: 0,
    })
  }

  function moveDrag(event: React.PointerEvent<SVGGElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return
    setDrag({
      ...drag,
      dx: (event.clientX - drag.startX) / scale,
      dy: (event.clientY - drag.startY) / scale,
    })
  }

  function endDrag(event: React.PointerEvent<SVGGElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const moved = Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5
    if (moved) {
      dispatch({
        type: 'SET_NODE_POSITION',
        networkId: network.id,
        nodeId: drag.nodeId,
        x: drag.originX + drag.dx,
        y: drag.originY + drag.dy,
      })
    }
    setDrag(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={pick('Thu phóng canvas', 'Canvas zoom')}>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 text-xs"
          onClick={() => setScale((current) => Math.max(MIN_SCALE, Number((current - ZOOM_STEP).toFixed(2))))}
        >
          {pick('Thu nhỏ', 'Zoom out')}
        </button>
        <span className="text-xs text-[var(--c-text-dim)]">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 text-xs"
          onClick={() => setScale((current) => Math.min(MAX_SCALE, Number((current + ZOOM_STEP).toFixed(2))))}
        >
          {pick('Phóng to', 'Zoom in')}
        </button>
        <button
          type="button"
          data-fbd-canvas-control="true"
          className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 text-xs"
          onClick={() => setScale(1)}
        >
          {pick('Vừa khung', 'Reset zoom')}
        </button>
      </div>
      <div ref={scrollRef} className="overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]">
        <svg
          ref={surfaceRef}
          role="group"
          aria-label={pick(`Sơ đồ ${network.name}`, `${network.name} diagram`)}
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-none"
        >
          <g aria-hidden="true">
            {view.wires.map((wire) => (
              <path
                key={`shadow-${wire.id}`}
                d={wire.path}
                fill="none"
                stroke="var(--c-bg)"
                strokeWidth={5}
              />
            ))}
          </g>
          {view.wires.map((wire) => {
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
                onClick={() => select({ kind: 'wire', networkId: network.id, wireId: wire.id })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    select({ kind: 'wire', networkId: network.id, wireId: wire.id })
                  }
                }}
              />
            )
          })}
          {view.nodes.map((placed) => {
            const node = nodesById.get(placed.id)
            if (!node) return null
            const active = selection?.kind === 'node' && selection.nodeId === placed.id
            return (
              <g key={placed.id}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`#${node.executionOrder} · ${node.typeRef} · ${node.kind}`}
                  aria-pressed={active}
                  className={canEdit ? 'cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]' : 'cursor-pointer'}
                  onClick={() => select({ kind: 'node', networkId: network.id, nodeId: placed.id })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      select({ kind: 'node', networkId: network.id, nodeId: placed.id })
                    }
                  }}
                  onPointerDown={(event) => beginDrag(event, node)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <rect
                    x={placed.x}
                    y={placed.y}
                    width={placed.width}
                    height={placed.height}
                    rx={6}
                    fill="var(--c-surface-2)"
                    stroke={active ? 'var(--c-accent)' : 'var(--c-border)'}
                    strokeWidth={active ? 2 : 1}
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
                      onClick={() => select({ kind: 'port', networkId: network.id, nodeId: placed.id, portId: port.id })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          select({ kind: 'port', networkId: network.id, nodeId: placed.id, portId: port.id })
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
        </svg>
      </div>
      {view.nodes.length > FBD_MINIMAP_NODE_THRESHOLD && (
        /* `AC-FBD-012` — sơ đồ vượt ngưỡng thì khung nhìn không còn chứa hết,
         * và người dùng cần biết mình đang ở đâu trong cái tổng thể. Minimap
         * chỉ VẼ vị trí, không phải một canvas thứ hai: nhấp vào nó cuộn khung
         * chính tới đó. */
        <svg
          role="group"
          aria-label={pick('Bản đồ thu nhỏ', 'Minimap')}
          width={FBD_MINIMAP_WIDTH}
          height={FBD_MINIMAP_HEIGHT}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="rounded border border-[var(--c-border)] bg-[var(--c-surface-2)]"
          onClick={(event) => {
            const container = scrollRef.current
            const box = event.currentTarget.getBoundingClientRect()
            if (!container || box.width === 0 || box.height === 0) return
            const ratioX = (event.clientX - box.left) / box.width
            const ratioY = (event.clientY - box.top) / box.height
            container.scrollLeft = ratioX * width * scale - container.clientWidth / 2
            container.scrollTop = ratioY * height * scale - container.clientHeight / 2
          }}
        >
          {view.nodes.map((placed) => (
            <rect
              key={placed.id}
              x={placed.x}
              y={placed.y}
              width={placed.width}
              height={placed.height}
              fill={selection?.kind === 'node' && selection.nodeId === placed.id ? 'var(--c-accent)' : 'var(--c-text-dim)'}
            />
          ))}
        </svg>
      )}
      {network.nodes.length === 0 && (
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Network trống — thêm block để bắt đầu.', 'Empty network — add a block to begin.')}</p>
      )}
    </div>
  )
}
