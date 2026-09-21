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
import { FBD_LABEL_MAX_CHARS, formatNodeParameterSummary, formatPortLabel, truncateText } from './nodeLabel'
import type { FbdRuntimeOverlay, FbdRuntimeReading } from './runtimeOverlay'
import { resolvePortMappingInfo } from './FbdNodeHoverCard'
import type {
  ProgrammingBinding,
  ProgrammingPointCatalogEntry,
  ProgrammingVariable,
} from '../model/types'

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
  /** Dây đang dưới con trỏ, do canvas bắt theo toạ độ. */
  hoverWireId?: string | null
  onWireHover?: (wireId: string | null) => void
  onWireContextMenu?: (event: React.MouseEvent<SVGPathElement>, wireId: string) => void
}

/** Bề dày vùng BẮT CHUỘT của một dây.
 *
 * Dây vẽ 1.5 px. Một mục tiêu 1.5 px là mục tiêu không bấm được bằng chuột:
 * yêu cầu "wire phải selectable, click/right-click để disconnect" không thể
 * đạt nếu người dùng phải trúng đúng một pixel rưỡi. Đường bắt là một `path`
 * trong suốt vẽ trùng đường thật, dày hơn một bậc độ lớn. */
export const FBD_WIRE_HIT_WIDTH = 14

export function FbdWiresLayer({
  wires,
  selection,
  networkId,
  pick,
  select,
  hoverWireId,
  onWireHover,
  onWireContextMenu,
}: FbdWiresLayerProps) {
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
        const hovered = hoverWireId === wire.id
        return (
          <path
            key={wire.id}
            data-fbd-wire-id={wire.id}
            role="button"
            tabIndex={0}
            aria-label={pick(`Dây nối tới ${wire.to.x},${wire.to.y}`, `Wire to ${wire.to.x},${wire.to.y}`)}
            aria-pressed={active}
            d={wire.path}
            fill="none"
            stroke={active ? 'var(--c-accent)' : hovered ? 'var(--c-text)' : 'var(--c-text-dim)'}
            strokeWidth={active ? 2.5 : hovered ? 2.5 : 1.5}
            /* Vùng bắt rộng nằm ở CHÍNH phần tử tương tác, qua
               `strokeLinecap`/`paint-order` không đủ — dùng `stroke` vô hình
               thứ hai bên dưới sẽ tách tiêu điểm bàn phím khỏi hình vẽ. Đặt
               `pointerEvents="stroke"` cùng một `strokeWidth` lớn cho một
               `path` chị em trong suốt là cách giữ MỘT phần tử tương tác duy
               nhất cho mỗi dây. */
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            onMouseEnter={() => onWireHover?.(wire.id)}
            onMouseLeave={() => onWireHover?.(null)}
            onClick={() => select({ kind: 'wire', networkId, wireId: wire.id })}
            onContextMenu={(event) => onWireContextMenu?.(event, wire.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                select({ kind: 'wire', networkId, wireId: wire.id })
              }
            }}
          />
        )
      })}
      {/* Lớp bắt chuột: trong suốt, không nhận tiêu điểm, chỉ để chuột trúng
          dây dễ hơn. Vẽ SAU đường thật nên nó nằm trên và nhận sự kiện trước;
          nó chuyển tiếp thao tác về cùng một lệnh chọn/menu như đường thật. */}
      <g aria-hidden="true">
        {wires.map((wire) => (
          <path
            key={`hit-${wire.id}`}
            data-fbd-wire-hit={wire.id}
            d={wire.path}
            fill="none"
            stroke="transparent"
            strokeWidth={FBD_WIRE_HIT_WIDTH}
            strokeLinecap="round"
            pointerEvents="stroke"
            className="cursor-pointer"
            onMouseEnter={() => onWireHover?.(wire.id)}
            onMouseLeave={() => onWireHover?.(null)}
            onClick={() => select({ kind: 'wire', networkId, wireId: wire.id })}
            onContextMenu={(event) => onWireContextMenu?.(event, wire.id)}
          />
        ))}
      </g>
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
  staleNodeIds?: ReadonlySet<string>
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
  /** Chọn khối qua chuột. Nhận cả event để `Ctrl`/`Shift+Click` cộng/trừ vùng
   * chọn thay vì luôn thay thế nó. */
  onNodeClick?: (event: React.MouseEvent<SVGGElement>, nodeId: string) => void
  onNodeContextMenu?: (event: React.MouseEvent<SVGGElement>, nodeId: string) => void
  onPortContextMenu?: (event: React.MouseEvent<SVGGElement>, port: FbdPortGeometry) => void
  /** Khối / cổng / dây đang dưới con trỏ — canvas bắt theo toạ độ graph nên
   * vùng hover khớp đúng vùng bắt chuột, không khớp hình vẽ. */
  hoverNodeId?: string | null
  hoverPortId?: string | null
  /** Cổng nguồn của cử chỉ kéo dây đang diễn ra. */
  wiringSourcePortId?: string | null
  /** Cổng đích mà cử chỉ kéo dây đang bám vào, kèm phán quyết hợp lệ. */
  candidatePortId?: string | null
  candidateOk?: boolean
  /** Khối mà cử chỉ kéo dây đang trỏ vào (bắt đích qua thân khối). */
  dropTargetNodeId?: string | null
  /** Khối đang hiển thị tooltip (nếu có). */
  activeTooltipNodeId?: string | null
  /** Id của tooltip để liên kết aria-describedby. */
  tooltipId?: string
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  onNodePointerEnter?: (event: React.PointerEvent<SVGGElement>, nodeId: string) => void
  onNodePointerLeave?: (event: React.PointerEvent<SVGGElement>, nodeId: string) => void
  onNodeFocus?: (event: React.FocusEvent<SVGGElement>, nodeId: string) => void
  onNodeBlur?: (event: React.FocusEvent<SVGGElement>, nodeId: string) => void
}

/** Bán kính vùng BẮT CHUỘT của một cổng, theo đơn vị graph.
 *
 * Cổng vẽ `r=4`. Kéo dây trước đây đòi nhả chuột trúng đúng hình tròn 8 px ấy,
 * nên "kéo từ OUT sang IN" gần như không làm được bằng tay. Vòng bắt trong
 * suốt này là mục tiêu thật của con trỏ; `FBD_PORT_HIT_RADIUS` trong
 * `wiring.ts` là cùng một con số ở phía tính toán. */
export const FBD_PORT_HIT_RADIUS_PX = 13

export function FbdNodesLayer({
  nodes,
  nodesById,
  selection,
  connectionFromPortId,
  canEdit,
  networkId,
  tempPositions,
  issueNodeIds,
  staleNodeIds,
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
  onNodeClick,
  onNodeContextMenu,
  onPortContextMenu,
  hoverNodeId,
  hoverPortId,
  wiringSourcePortId,
  candidatePortId,
  candidateOk = true,
  dropTargetNodeId,
  activeTooltipNodeId,
  tooltipId,
  bindings,
  variables,
  pointCatalogItems,
  onNodePointerEnter,
  onNodePointerLeave,
  onNodeFocus,
  onNodeBlur,
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
        const isStale = !hasIssue && staleNodeIds?.has(placed.id) === true
        const issueNotice = hasIssue
          ? pick
            ? pick(' · Có lỗi chẩn đoán', ' · Has diagnostic issue')
            : ' · Có lỗi chẩn đoán'
          : isStale
          ? pick
            ? pick(' · STALE DIAGNOSTIC', ' · STALE DIAGNOSTIC')
            : ' · STALE DIAGNOSTIC'
          : ''

        const paramSummary = formatNodeParameterSummary(node.kind, node.parameters)
        const identity = fbdNodeIdentity(node)
        const nodeReading = runtime?.byNodeId.get(placed.id) ?? null
        const isHovered = hoverNodeId === placed.id
        const isDropTarget = dropTargetNodeId === placed.id
        const dropStroke = candidateOk ? 'var(--c-good-fg)' : 'var(--c-danger-fg)'

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
              aria-describedby={activeTooltipNodeId === placed.id ? tooltipId : undefined}
              aria-pressed={isSelected}
              className={
                canEdit
                  ? 'cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]'
                  : 'cursor-pointer'
              }
              onClick={(event) => {
                if (event.defaultPrevented) return
                if (onNodeClick) onNodeClick(event, placed.id)
                else select({ kind: 'node', networkId, nodeId: placed.id })
              }}
              onContextMenu={(event) => onNodeContextMenu?.(event, placed.id)}
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
              onPointerEnter={(event) => onNodePointerEnter?.(event, placed.id)}
              onPointerLeave={(event) => onNodePointerLeave?.(event, placed.id)}
              onFocus={(event) => onNodeFocus?.(event, placed.id)}
              onBlur={(event) => onNodeBlur?.(event, placed.id)}
            >
              <rect
                x={placed.x}
                y={placed.y}
                width={placed.width}
                height={placed.height}
                rx={6}
                fill="var(--c-surface-2)"
                stroke={
                  isDropTarget
                    ? dropStroke
                    : isSelected
                    ? 'var(--c-accent)'
                    : hasIssue
                    ? 'var(--c-warn-fg)'
                    : isHovered
                    ? 'var(--c-text-dim)'
                    : 'var(--c-border)'
                }
                strokeWidth={isDropTarget ? 2.5 : isSelected || hasIssue ? 2 : 1}
                strokeDasharray={isDropTarget ? '6 3' : undefined}
              />
              {(hasIssue || isStale) && (
                <circle
                  cx={placed.x + placed.width - 12}
                  cy={placed.y + 12}
                  r={4}
                  fill={hasIssue ? 'var(--c-warn-fg)' : 'var(--c-text-dim)'}
                  data-fbd-node-issue={hasIssue ? 'true' : 'stale'}
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
              const isSource = connectionFromPortId === port.id || wiringSourcePortId === port.id
              const isHoveredPort = hoverPortId === port.id
              const isCandidate = candidatePortId === port.id
              /* Ba trạng thái thị giác xếp theo độ ưu tiên, không trộn nhau:
                 đích của cử chỉ kéo (xanh/đỏ theo phán quyết) > nguồn/đang
                 chọn (màu nhấn) > đang hover (viền đậm). Người dùng phải đọc
                 được "hệ thống đang nhận thao tác gì" chỉ bằng màu. */
              const emphasised = isCandidate || selected || isSource || isHoveredPort
              const portFill = isCandidate
                ? (candidateOk ? 'var(--c-good-fg)' : 'var(--c-danger-fg)')
                : selected || isSource
                  ? 'var(--c-accent)'
                  : isHoveredPort
                    ? 'var(--c-accent-bg)'
                    : 'var(--c-surface)'
              const portStroke = isCandidate
                ? (candidateOk ? 'var(--c-good-fg)' : 'var(--c-danger-fg)')
                : selected || isSource || isHoveredPort
                  ? 'var(--c-accent)'
                  : 'var(--c-border)'
              return (
                <g
                  key={port.id}
                  ref={(element) => registerPort(port.id, element)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.typeRef} ${definition.direction} ${definition.name} ${definition.dataType}${definition.unit ? ` ${definition.unit}` : ''}`}
                  aria-pressed={selected}
                  className={
                    canEdit
                      ? 'cursor-crosshair focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]'
                      : 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]'
                  }
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
                  onContextMenu={(event) => onPortContextMenu?.(event, port)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      select({ kind: 'port', networkId, nodeId: placed.id, portId: port.id })
                    }
                  }}
                >
                  {/* Vùng bắt chuột — trong suốt và vẽ TRƯỚC hình cổng, nên nó
                      mở rộng mục tiêu mà không phủ lên hình. Không có nó thì
                      mọi cử chỉ kéo dây phải trúng một hình tròn 8 px. */}
                  <circle
                    data-fbd-port-hit={port.id}
                    cx={port.cx}
                    cy={port.cy}
                    r={FBD_PORT_HIT_RADIUS_PX}
                    fill="transparent"
                    stroke="none"
                  />
                  {/* Vành sáng chỉ ra cổng đang được cử chỉ nhắm tới. */}
                  {isCandidate && (
                    <circle
                      data-fbd-port-candidate={port.id}
                      cx={port.cx}
                      cy={port.cy}
                      r={11}
                      fill="none"
                      stroke={candidateOk ? 'var(--c-good-fg)' : 'var(--c-danger-fg)'}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                    />
                  )}
                  <circle
                    cx={port.cx}
                    cy={port.cy}
                    r={emphasised ? 6 : 4}
                    fill={portFill}
                    stroke={portStroke}
                    strokeWidth={1.5}
                  />
                  {(() => {
                    const mappingInfo = resolvePortMappingInfo(
                      definition,
                      node,
                      bindings,
                      variables,
                      pointCatalogItems,
                      runtime?.byPortId,
                    )
                    return (
                      <>
                  {mappingInfo.title && <title>{mappingInfo.title}</title>}
                  <text
                    x={port.direction === 'INPUT' ? port.cx + 10 : port.cx - 10}
                    y={port.cy + 3}
                    textAnchor={port.direction === 'INPUT' ? 'start' : 'end'}
                    className={mappingInfo.isMapped ? "text-[10px] font-semibold" : "text-[10px]"}
                    fill={mappingInfo.isMapped ? "var(--c-accent)" : "var(--c-text-dim)"}
                    data-fbd-port-text="true"
                    data-fbd-port-mapped={mappingInfo.isMapped ? "true" : undefined}
                  >
                    {mappingInfo.isMapped
                      ? truncateText(mappingInfo.display, FBD_LABEL_MAX_CHARS)
                      : formatPortLabel(definition.name, definition.dataType, definition.unit)}
                  </text>
                  {/* Giá trị tại CHÂN, vẽ bên ngoài khối để không đè nhãn chân.
                      Chỉ vẽ khi nó KHÁC giá trị đại diện của khối — nếu không,
                      cùng một con số hiện hai lần cạnh nhau. */}
                  {portReading && portReading !== nodeReading && !mappingInfo.isMapped && (
                    <FbdRuntimeChip
                      x={port.direction === 'INPUT' ? port.cx - 8 : port.cx + 8}
                      y={port.cy - 8}
                      anchor={port.direction === 'INPUT' ? 'end' : 'start'}
                      reading={portReading}
                    />
                  )}
                      </>
                    )
                  })()}
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
