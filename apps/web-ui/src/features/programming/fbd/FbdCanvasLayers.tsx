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
import { formatNodeParameterSummary, formatPortLabel, truncateText } from './nodeLabel'
import type { FbdRuntimeOverlay, FbdRuntimeReading } from './runtimeOverlay'

/**
 * Danh tính hiển thị của một khối — thứ người đọc sơ đồ tìm TRƯỚC TIÊN.
 *
 * Bản trước lấy `#<thứ tự thực thi> · <typeRef>` làm nhãn chính, nên một nút
 * vào tên `AI_Temp_SAT` hiện ra là `#0 · REAL`: hai thông tin đúng nhưng không
 * phải thứ ai cũng cần đọc đầu tiên, còn TÊN BIẾN — thứ duy nhất nói khối này
 * là gì — bị đẩy xuống dòng thứ ba cỡ 9 px. Ảnh chuẩn `PGM-02B` làm ngược lại,
 * và nó đúng: danh tính lên trước, phân loại xuống sau.
 *
 * Thứ tự thực thi KHÔNG mất đi — nó chuyển thành huy hiệu nhỏ ở góc, và vẫn
 * nguyên trong `aria-label` để mọi phép chọn theo tên không đổi.
 */
export function fbdNodeIdentity(node: FbdNode): { primary: string; secondary: string | null } {
  const parameter = formatNodeParameterSummary(node.kind, node.parameters)
  switch (node.kind) {
    case 'INPUT':
    case 'OUTPUT':
    case 'SIGNAL_READ':
    case 'SIGNAL_PUBLISH':
      /* Chưa đặt tên biến thì nói thẳng là chưa đặt, không mượn tạm `typeRef`
         làm tên — một khối tên `REAL` trông y như một khối đã cấu hình xong. */
      return { primary: parameter ?? node.typeRef, secondary: parameter ? node.typeRef : null }
    case 'CONSTANT':
      return { primary: parameter ?? node.typeRef, secondary: node.typeRef }
    case 'FUNCTION_BLOCK':
      /* Loại đứng trước (PID), tên thực thể đứng sau (FB_PID_01) — đúng thứ tự
         ảnh chuẩn, và đúng thứ tự người ta hỏi: "khối gì" rồi mới "khối nào". */
      return { primary: node.typeRef, secondary: parameter }
    default:
      return { primary: node.typeRef, secondary: null }
  }
}

const RUNTIME_CHIP_FILL: Record<FbdRuntimeReading['state'], string> = {
  live: 'var(--c-good-bg)',
  uncertain: 'var(--c-warn-bg)',
  stale: 'var(--c-warn-bg)',
  invalid: 'var(--c-surface-2)',
}
const RUNTIME_CHIP_TEXT: Record<FbdRuntimeReading['state'], string> = {
  live: 'var(--c-good-fg)',
  uncertain: 'var(--c-warn-fg)',
  stale: 'var(--c-warn-fg)',
  invalid: 'var(--c-text-dim)',
}

export function fbdRuntimeChipText(reading: FbdRuntimeReading): string {
  return reading.unit ? `${reading.display} ${reading.unit}` : reading.display
}

/**
 * Ô giá trị runtime vẽ trên khối.
 *
 * Bề rộng tính theo SỐ KÝ TỰ chứ không đo DOM: một ô đổi bề rộng theo từng giá
 * trị sẽ làm sơ đồ nhảy mỗi nhịp cập nhật, mà yêu cầu số 7 cấm đúng điều đó.
 * `minWidth` giữ ô không co lại khi giá trị ngắn đi (`TRUE` → `9.1`).
 */
function FbdRuntimeChip({ x, y, anchor, reading }: {
  x: number
  y: number
  anchor: 'start' | 'end'
  reading: FbdRuntimeReading
}) {
  const text = truncateText(fbdRuntimeChipText(reading), 12)
  const width = Math.max(46, text.length * 6.2 + 10)
  const left = anchor === 'end' ? x - width : x
  return (
    <g data-fbd-runtime-chip="true" data-fbd-runtime-state={reading.state} pointerEvents="none">
      <title>{`${reading.name}: ${fbdRuntimeChipText(reading)}`}</title>
      <rect
        x={left}
        y={y}
        width={width}
        height={16}
        rx={8}
        fill={RUNTIME_CHIP_FILL[reading.state]}
        stroke={RUNTIME_CHIP_TEXT[reading.state]}
        strokeWidth={1}
      />
      <text
        x={left + width / 2}
        y={y + 11.5}
        textAnchor="middle"
        className="text-[10px] font-semibold"
        fill={RUNTIME_CHIP_TEXT[reading.state]}
      >
        {text}
      </text>
    </g>
  )
}

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
  /** Giá trị runtime đã trình bày xong; `null` = chế độ này không có nguồn. */
  runtime?: FbdRuntimeOverlay | null
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
  runtime,
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
        const identity = fbdNodeIdentity(node)
        const nodeReading = runtime?.byNodeId.get(placed.id) ?? null

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
              {/* Nhãn CHÍNH là danh tính của khối (tên biến / loại khối), không
                  phải thứ tự thực thi. Xem `fbdNodeIdentity`. */}
              <text
                x={placed.x + 10}
                y={placed.y + 15}
                className="text-[11px] font-semibold"
                fill="var(--c-text)"
                {...(identity.primary === paramSummary ? { 'data-fbd-node-param': 'true' } : {})}
              >
                {truncateText(identity.primary)}
              </text>
              {identity.secondary && (
                <text
                  x={placed.x + 10}
                  y={placed.y + 27}
                  className="text-[9px] font-mono"
                  fill="var(--c-text-dim)"
                  {...(identity.secondary === paramSummary ? { 'data-fbd-node-param': 'true' } : {})}
                >
                  {truncateText(identity.secondary)}
                </text>
              )}
              {/* Thứ tự thực thi giữ nguyên ý nghĩa nhưng lui về huy hiệu góc:
                  nó quyết định chương trình chạy thế nào nên không được bỏ, mà
                  cũng không phải thứ đọc trước tiên. */}
              <text
                x={placed.x + placed.width - (hasIssue ? 22 : 8)}
                y={placed.y + 13}
                textAnchor="end"
                className="text-[9px] tabular-nums"
                fill="var(--c-text-dim)"
              >
                #{node.executionOrder}
              </text>
              <line
                x1={placed.x}
                y1={placed.y + FBD_NODE_HEADER_HEIGHT - 4}
                x2={placed.x + FBD_NODE_WIDTH}
                y2={placed.y + FBD_NODE_HEADER_HEIGHT - 4}
                stroke="var(--c-border)"
                strokeWidth={1}
              />
              {/* Giá trị runtime của cả khối. Vẽ NGOÀI mép dưới chứ không chen
                  vào giữa các hàng chân: chen vào sẽ đổi chiều cao khối theo
                  việc có hay không có giá trị, tức topology nhảy mỗi lần thiết
                  bị mất/khôi phục kết nối. */}
              {nodeReading && (
                <FbdRuntimeChip
                  x={placed.x + placed.width - 6}
                  y={placed.y + placed.height - 8}
                  anchor="end"
                  reading={nodeReading}
                />
              )}
            </g>
            {placed.ports.map((port) => {
              const definition = node.ports.find((item) => item.id === port.id)
              if (!definition) return null
              const portReading = runtime?.byPortId.get(port.id) ?? null
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
                  {/* Giá trị tại CHÂN, vẽ bên ngoài khối để không đè nhãn chân.
                      Chỉ vẽ khi nó KHÁC giá trị đại diện của khối — nếu không,
                      cùng một con số hiện hai lần cạnh nhau. */}
                  {portReading && portReading !== nodeReading && (
                    <FbdRuntimeChip
                      x={port.direction === 'INPUT' ? port.cx - 8 : port.cx + 8}
                      y={port.cy - 8}
                      anchor={port.direction === 'INPUT' ? 'end' : 'start'}
                      reading={portReading}
                    />
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
    </>
  )
}

/** `TC-FBD-LAYOUT-001` — lớp ghost chỉ đọc. Vị trí xem trước không thay thế
 * geometry canonical và không nhận pointer/focus, nên Cancel luôn là 0 diff. */
export function FbdLayoutPreviewLayer({
  nodes,
  positions,
}: {
  nodes: readonly FbdNodeGeometry[]
  positions: Readonly<Record<string, FbdPoint>> | null
}) {
  if (!positions) return null
  return (
    <g data-fbd-layout-preview="true" aria-hidden="true" pointerEvents="none">
      {nodes.map((node) => {
        const point = positions[node.id]
        if (!point) return null
        return (
          <g key={node.id} data-fbd-layout-preview-node={node.id}>
            <rect
              x={point.x}
              y={point.y}
              width={node.width}
              height={node.height}
              rx={6}
              fill="var(--c-accent-bg)"
              fillOpacity={0.45}
              stroke="var(--c-accent)"
              strokeWidth={2}
              strokeDasharray="7 4"
            />
            <text x={point.x + 8} y={point.y + 16} className="text-[10px]" fill="var(--c-accent)">
              #{node.id.slice(0, 8)}
            </text>
          </g>
        )
      })}
    </g>
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
