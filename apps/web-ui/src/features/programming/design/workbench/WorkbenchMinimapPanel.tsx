import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

import { useI18n } from '../../../../shared/i18n'
import type { FbdSelection } from '../../fbd/commands'
import type { FbdNodeGeometry } from '../../fbd/geometry'
import type { FbdViewport } from '../../fbd/viewport'

export interface FbdCanvasBridge {
  nodes: readonly FbdNodeGeometry[]
  width: number
  height: number
  viewport: FbdViewport
  scale: number
  scrollPosition?: { left: number; top: number; clientWidth: number; clientHeight: number }
  selection?: FbdSelection | null
  onNavigate?: (clientX: number, clientY: number, element: SVGSVGElement) => void
  onStepNavigate?: (dx: number, dy: number) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onResetZoom?: () => void
}

const FbdCanvasBridgeContext = createContext<FbdCanvasBridge | null>(null)
const FbdCanvasSetBridgeContext = createContext<Dispatch<SetStateAction<FbdCanvasBridge | null>> | null>(null)

export function FbdCanvasBridgeProvider({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<FbdCanvasBridge | null>(null)
  return (
    <FbdCanvasSetBridgeContext.Provider value={setBridge}>
      <FbdCanvasBridgeContext.Provider value={bridge}>
        {children}
      </FbdCanvasBridgeContext.Provider>
    </FbdCanvasSetBridgeContext.Provider>
  )
}

export function useFbdCanvasBridge(): FbdCanvasBridge | null {
  return useContext(FbdCanvasBridgeContext)
}

export function useSetFbdCanvasBridge(): Dispatch<SetStateAction<FbdCanvasBridge | null>> | null {
  return useContext(FbdCanvasSetBridgeContext)
}

export interface WorkbenchMinimapPanelProps {
  bridge?: FbdCanvasBridge | null
}

export function WorkbenchMinimapPanel({ bridge: propBridge }: WorkbenchMinimapPanelProps) {
  const { pick } = useI18n()
  const contextBridge = useFbdCanvasBridge()
  const bridge = propBridge !== undefined ? propBridge : contextBridge
  const pointerIdRef = useRef<number | null>(null)

  if (!bridge || bridge.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="mb-1 text-xs font-semibold text-[var(--c-text-dim)]">
          {pick('Bản đồ thu nhỏ', 'Mini Map')}
        </div>
        <div
          role="region"
          aria-label={pick('Bản đồ thu nhỏ', 'Mini Map')}
          className="flex flex-1 items-center justify-center rounded border border-dashed border-[var(--c-border)] p-2 text-center text-xs text-[var(--c-text-dim)]"
        >
          {pick('Bản đồ thu nhỏ chỉ khả dụng cho sơ đồ khối FBD', 'Mini Map is only available for FBD diagrams')}
        </div>
      </div>
    )
  }

  const scroll = bridge.scrollPosition
  const scale = bridge.scale || bridge.viewport?.scale || 1
  const vpX = scroll ? (scroll.left - (bridge.viewport?.x ?? 0)) / scale : 0
  const vpY = scroll ? (scroll.top - (bridge.viewport?.y ?? 0)) / scale : 0
  const vpW = scroll ? scroll.clientWidth / scale : bridge.width
  const vpH = scroll ? scroll.clientHeight / scale : bridge.height

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-[var(--c-text-dim)]">
          {pick('Bản đồ thu nhỏ', 'Mini Map')}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label={pick('Thu phóng canvas', 'Canvas zoom')}>
          <button
            type="button"
            data-fbd-canvas-control="true"
            aria-label={pick('Thu nhỏ', 'Zoom out')}
            title={pick('Thu nhỏ', 'Zoom out')}
            className="flex h-5 w-5 items-center justify-center rounded border border-[var(--c-border)] text-xs hover:bg-[var(--c-surface-2)]"
            onClick={() => bridge.onZoomOut?.()}
          >
            -
          </button>
          <span className="text-[11px] text-[var(--c-text-dim)]">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            data-fbd-canvas-control="true"
            aria-label={pick('Phóng to', 'Zoom in')}
            title={pick('Phóng to', 'Zoom in')}
            className="flex h-5 w-5 items-center justify-center rounded border border-[var(--c-border)] text-xs hover:bg-[var(--c-surface-2)]"
            onClick={() => bridge.onZoomIn?.()}
          >
            +
          </button>
          <button
            type="button"
            data-fbd-canvas-control="true"
            aria-label={pick('Vừa khung', 'Reset zoom')}
            title={pick('Vừa khung', 'Reset zoom')}
            className="flex h-5 items-center justify-center rounded border border-[var(--c-border)] px-1 text-[10px] hover:bg-[var(--c-surface-2)]"
            onClick={() => bridge.onResetZoom?.()}
          >
            {pick('Vừa khung', 'Fit')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <svg
          role="group"
          aria-label={pick('Bản đồ thu nhỏ', 'Mini Map')}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          tabIndex={0}
          data-fbd-minimap="true"
          width="100%"
          height="100%"
          viewBox={`0 0 ${bridge.width} ${bridge.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="max-h-full max-w-full rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--c-accent)]"
          onPointerDown={(event) => {
            pointerIdRef.current = event.pointerId
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // ponytail: mock test environment may omit pointer capture APIs
            }
            bridge.onNavigate?.(event.clientX, event.clientY, event.currentTarget)
          }}
          onPointerMove={(event) => {
            if (pointerIdRef.current !== event.pointerId) return
            bridge.onNavigate?.(event.clientX, event.clientY, event.currentTarget)
          }}
          onPointerUp={(event) => {
            if (pointerIdRef.current !== event.pointerId) return
            bridge.onNavigate?.(event.clientX, event.clientY, event.currentTarget)
            pointerIdRef.current = null
            try {
              event.currentTarget.releasePointerCapture(event.pointerId)
            } catch {
              // ponytail: mock test environment may omit pointer capture APIs
            }
          }}
          onPointerCancel={(event) => {
            if (pointerIdRef.current === event.pointerId) pointerIdRef.current = null
          }}
          onKeyDown={(event) => {
            const step = 32 * scale
            if (event.key === 'ArrowLeft') {
              bridge.onStepNavigate?.(-step, 0)
              event.preventDefault()
            } else if (event.key === 'ArrowRight') {
              bridge.onStepNavigate?.(step, 0)
              event.preventDefault()
            } else if (event.key === 'ArrowUp') {
              bridge.onStepNavigate?.(0, -step)
              event.preventDefault()
            } else if (event.key === 'ArrowDown') {
              bridge.onStepNavigate?.(0, step)
              event.preventDefault()
            }
          }}
        >
          {bridge.nodes.map((placed) => (
            <rect
              key={placed.id}
              data-fbd-minimap-node="true"
              data-fbd-node-id={placed.id}
              x={placed.x}
              y={placed.y}
              width={placed.width}
              height={placed.height}
              fill={
                (bridge.selection?.kind === 'node' && bridge.selection.nodeId === placed.id) ||
                (bridge.selection?.kind === 'multi-node' && bridge.selection.nodeIds.includes(placed.id))
                  ? 'var(--c-accent)'
                  : 'var(--c-text-dim)'
              }
            />
          ))}
          <rect
            data-testid="minimap-viewport-indicator"
            x={Math.max(0, vpX)}
            y={Math.max(0, vpY)}
            width={Math.max(10, Math.min(bridge.width, vpW))}
            height={Math.max(10, Math.min(bridge.height, vpH))}
            fill="var(--c-accent)"
            fillOpacity={0.12}
            stroke="var(--c-accent)"
            strokeWidth={1.5}
            className="pointer-events-none"
          />
        </svg>
      </div>
    </div>
  )
}
