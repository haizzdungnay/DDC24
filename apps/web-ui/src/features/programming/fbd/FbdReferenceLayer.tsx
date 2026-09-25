import React from 'react'
import type { FbdPoint } from './model'
import type { FbdSelection } from './commands'
import type { FbdReferenceLayerGeometry } from './referenceGeometry'
import { FBD_REF_HIT_PADDING } from './referenceGeometry'
import type { FbdRuntimeOverlay } from './runtimeOverlay'

export interface FbdReferenceLayerProps {
  networkId: string
  geometry: FbdReferenceLayerGeometry
  selection: FbdSelection | null
  hoverWireId?: string | null
  hoverStub?: { kind: 'source' | 'sink'; wireId?: string; portId?: string } | null
  peekWireId?: string | null
  onHoverStub?: (target: {
    kind: 'source' | 'sink'
    wireId?: string
    portId?: string
    nodeId?: string
    clientX: number
    clientY: number
  } | null) => void
  onSelectWire?: (wireId: string) => void
  onContextMenuStub?: (
    event: React.MouseEvent,
    target:
      | { kind: 'reference-source'; networkId: string; nodeId: string; portId: string; wireIds: readonly string[]; offset: number }
      | { kind: 'reference-sink'; networkId: string; wireId: string; offset: number }
  ) => void
  onStartOffsetDrag?: (
    event: React.PointerEvent,
    kind: 'source' | 'sink',
    wireId: string,
    initialOffset: number,
    portAnchor: FbdPoint
  ) => void
  onDoubleClickSink?: (sourceNodeId: string, sourcePortId: string) => void
  onDoubleClickSource?: (sinkNodeId: string, sinkPortId: string) => void
  pick: (vi: string, en: string) => string
  runtime?: FbdRuntimeOverlay | null
}

export function FbdReferenceLayer({
  networkId,
  geometry,
  selection,
  hoverWireId,
  hoverStub,
  peekWireId,
  onHoverStub,
  onSelectWire,
  onContextMenuStub,
  onStartOffsetDrag,
  onDoubleClickSink,
  onDoubleClickSource,
  pick,
}: FbdReferenceLayerProps) {
  const { sources, sinks, byWireId } = geometry
  if (sources.length === 0 && sinks.length === 0) return null

  // Active wire IDs from selection
  const selectedWireId = selection?.kind === 'wire' ? selection.wireId : null

  // Determine active peek wire
  const activePeekWireId = peekWireId || hoverWireId || hoverStub?.wireId

  return (
    <g className="fbd-reference-layer" data-fbd-reference-layer="true">
      {/* 1. Lớp Ghost / Peek Wire khi hover */}
      {activePeekWireId && byWireId.has(activePeekWireId) && (() => {
        const pair = byWireId.get(activePeekWireId)!
        const sx = pair.source.portAnchor.x
        const sy = pair.source.portAnchor.y
        const tx = pair.sink.portAnchor.x
        const ty = pair.sink.portAnchor.y
        const dx = tx - sx
        const curve = Math.max(30, Math.min(120, Math.abs(dx) * 0.4))
        const cp1x = sx + (dx >= 0 ? curve : 60)
        const cp2x = tx - (dx >= 0 ? curve : 60)
        const d = `M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ty}, ${tx} ${ty}`
        return (
          <path
            key={`peek-${activePeekWireId}`}
            d={d}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="6 4"
            className="fbd-peek-wire pointer-events-none"
            data-testid="fbd-peek-wire"
          />
        )
      })()}

      {/* 2. Lớp Source Stubs */}
      {sources.map((src) => {
        const isSelected = src.wireIds.some((id) => id === selectedWireId)
        const isHovered =
          src.wireIds.some((id) => id === hoverWireId) ||
          (hoverStub?.kind === 'source' && hoverStub.portId === src.portId)
        const strokeColor = isSelected ? 'var(--c-accent)' : isHovered ? '#1d4ed8' : 'var(--c-border)'
        const fillColor = isSelected
          ? 'var(--c-accent)'
          : isHovered
            ? 'var(--c-surface-2)'
            : 'var(--c-surface)'
        const textColor = isSelected ? '#ffffff' : 'var(--c-text)'

        // Compute max characters that fit cleanly inside width
        const maxCharsFit = Math.max(6, Math.floor((src.width - 20) / 6.5))
        const label =
          src.signalName.length > maxCharsFit
            ? src.signalName.slice(0, maxCharsFit - 1) + '…'
            : src.signalName

        return (
          <g
            key={`source-${src.nodeId}-${src.portId}`}
            data-fbd-source-stub={src.portId}
            data-testid={`fbd-source-stub-${src.portId}`}
            role="button"
            tabIndex={0}
            aria-label={pick(`Tín hiệu tham chiếu ${src.signalName}`, `Reference signal ${src.signalName}`)}
            aria-haspopup="menu"
            className="cursor-pointer"
            onPointerEnter={(e) =>
              onHoverStub?.({
                kind: 'source',
                nodeId: src.nodeId,
                portId: src.portId,
                wireId: src.wireIds[0],
                clientX: e.clientX,
                clientY: e.clientY,
              })
            }
            onPointerLeave={() => onHoverStub?.(null)}
            onClick={(e) => {
              e.stopPropagation()
              if (src.wireIds[0]) onSelectWire?.(src.wireIds[0])
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              const firstWire = src.wireIds[0] ? byWireId.get(src.wireIds[0]) : null
              if (firstWire) {
                onDoubleClickSource?.(firstWire.sink.nodeId, firstWire.sink.portId)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onContextMenuStub?.(e, {
                kind: 'reference-source',
                networkId,
                nodeId: src.nodeId,
                portId: src.portId,
                wireIds: src.wireIds,
                offset: src.offset,
              })
            }}
          >
            {/* Neck connection line */}
            <path d={src.neckPath} fill="none" stroke={strokeColor} strokeWidth={1.5} className="pointer-events-none" />
            {/* Neck hit path for dragging to stretch wire */}
            <path
              d={src.neckPath}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              className="cursor-ew-resize"
              pointerEvents="all"
              aria-label={pick('Kéo để thay đổi độ dài dây nối', 'Drag to extend wire length')}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onStartOffsetDrag?.(e, 'source', src.wireIds[0], src.offset, src.portAnchor)
              }}
            />

            {/* Chevron Tag Body */}
            <path
              d={src.path}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={1.5}
              className="transition-colors"
            />

            {/* Drag grip handle at neck junction */}
            <g
              className="cursor-ew-resize"
              pointerEvents="all"
              aria-label={pick('Kéo để thay đổi độ dài dây nối', 'Drag to extend wire length')}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onStartOffsetDrag?.(e, 'source', src.wireIds[0], src.offset, src.portAnchor)
              }}
            >
              <line
                x1={src.x - 2}
                y1={src.y + 4}
                x2={src.x - 2}
                y2={src.y + src.height - 4}
                stroke={strokeColor}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.8}
              />
              <rect x={src.x - 6} y={src.y} width={8} height={src.height} fill="transparent" />
            </g>

            {/* Signal Name Label */}
            <text
              x={src.textX}
              y={src.textY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fontWeight={600}
              fill={textColor}
              className="pointer-events-none select-none font-mono"
            >
              {label}
            </text>

            {/* Fan-out Count Badge */}
            {src.fanOutCount > 1 && (
              <g transform={`translate(${src.x + src.width + 8}, ${src.y + src.height / 2})`}>
                <circle r={7} fill="var(--c-surface-2)" stroke={strokeColor} strokeWidth={1} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={9}
                  fontWeight={700}
                  fill="var(--c-text-dim)"
                  className="pointer-events-none select-none"
                >
                  {src.fanOutCount}
                </text>
              </g>
            )}

            {/* Hit area for easy mouse catching */}
            <rect
              x={src.x - FBD_REF_HIT_PADDING}
              y={src.y - FBD_REF_HIT_PADDING}
              width={src.width + FBD_REF_HIT_PADDING * 2}
              height={src.height + FBD_REF_HIT_PADDING * 2}
              fill="transparent"
            />
          </g>
        )
      })}

      {/* 3. Lớp Sink Stubs */}
      {sinks.map((sink) => {
        const isSelected = sink.wireId === selectedWireId
        const isHovered =
          sink.wireId === hoverWireId ||
          (hoverStub?.kind === 'sink' && hoverStub.wireId === sink.wireId)
        const strokeColor = isSelected ? 'var(--c-accent)' : isHovered ? '#1d4ed8' : 'var(--c-border)'
        const fillColor = isSelected
          ? 'var(--c-accent)'
          : isHovered
            ? 'var(--c-surface-2)'
            : 'var(--c-surface)'
        const textColor = isSelected ? '#ffffff' : 'var(--c-text)'

        const maxCharsFit = Math.max(6, Math.floor((sink.width - 20) / 6.5))
        const label =
          sink.signalName.length > maxCharsFit
            ? sink.signalName.slice(0, maxCharsFit - 1) + '…'
            : sink.signalName

        return (
          <g
            key={`sink-${sink.wireId}`}
            data-fbd-sink-stub={sink.wireId}
            data-testid={`fbd-sink-stub-${sink.wireId}`}
            role="button"
            tabIndex={0}
            aria-label={pick(`Đích tham chiếu ${sink.signalName}`, `Sink reference ${sink.signalName}`)}
            aria-haspopup="menu"
            className="cursor-pointer"
            onPointerEnter={(e) =>
              onHoverStub?.({
                kind: 'sink',
                nodeId: sink.nodeId,
                portId: sink.portId,
                wireId: sink.wireId,
                clientX: e.clientX,
                clientY: e.clientY,
              })
            }
            onPointerLeave={() => onHoverStub?.(null)}
            onClick={(e) => {
              e.stopPropagation()
              onSelectWire?.(sink.wireId)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onDoubleClickSink?.(sink.sourceNodeId, sink.sourcePortId)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onContextMenuStub?.(e, {
                kind: 'reference-sink',
                networkId,
                wireId: sink.wireId,
                offset: sink.offset,
              })
            }}
          >
            {/* Neck connection line */}
            <path d={sink.neckPath} fill="none" stroke={strokeColor} strokeWidth={1.5} className="pointer-events-none" />
            {/* Neck hit path for dragging to stretch wire */}
            <path
              d={sink.neckPath}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              className="cursor-ew-resize"
              pointerEvents="all"
              aria-label={pick('Kéo để thay đổi độ dài dây nối', 'Drag to extend wire length')}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onStartOffsetDrag?.(e, 'sink', sink.wireId, sink.offset, sink.portAnchor)
              }}
            />

            {/* Chevron Tag Body */}
            <path
              d={sink.path}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={1.5}
              className="transition-colors"
            />

            {/* Drag grip handle at right edge */}
            <g
              className="cursor-ew-resize"
              pointerEvents="all"
              aria-label={pick('Kéo để thay đổi độ dài dây nối', 'Drag to extend wire length')}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onStartOffsetDrag?.(e, 'sink', sink.wireId, sink.offset, sink.portAnchor)
              }}
            >
              <line
                x1={sink.x + sink.width + 2}
                y1={sink.y + 4}
                x2={sink.x + sink.width + 2}
                y2={sink.y + sink.height - 4}
                stroke={strokeColor}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.8}
              />
              <rect x={sink.x + sink.width - 2} y={sink.y} width={8} height={sink.height} fill="transparent" />
            </g>

            {/* Signal Name Label */}
            <text
              x={sink.textX}
              y={sink.textY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fontWeight={600}
              fill={textColor}
              className="pointer-events-none select-none font-mono"
            >
              {label}
            </text>

            {/* Hit area */}
            <rect
              x={sink.x - FBD_REF_HIT_PADDING}
              y={sink.y - FBD_REF_HIT_PADDING}
              width={sink.width + FBD_REF_HIT_PADDING * 2}
              height={sink.height + FBD_REF_HIT_PADDING * 2}
              fill="transparent"
            />
          </g>
        )
      })}
    </g>
  )
}
