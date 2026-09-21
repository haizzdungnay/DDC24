import { createContext, useContext, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { PanelRightClose } from 'lucide-react'
import { stCodeMapEntries } from '../editor/StCodeMap'

import { useI18n } from '../../../../shared/i18n'
import type { FbdSelection } from '../../fbd/commands'
import type { FbdNodeGeometry, FbdWireGeometry } from '../../fbd/geometry'
import type { FbdViewport } from '../../fbd/viewport'

export interface FbdCanvasBridge {
  nodes: readonly FbdNodeGeometry[]
  wires?: readonly FbdWireGeometry[]
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

export const MINIMAP_MIN_DIMENSION = 64
export const MINIMAP_PADDING_RATIO = 0.08
export const MINIMAP_MIN_PADDING = 24

export interface MinimapViewBox {
  x: number
  y: number
  width: number
  height: number
}

export function computeMinimapViewBox(nodes: readonly FbdNodeGeometry[]): MinimapViewBox {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: MINIMAP_MIN_DIMENSION, height: MINIMAP_MIN_DIMENSION }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + Math.max(0, node.width))
    maxY = Math.max(maxY, node.y + Math.max(0, node.height))
  }

  const boundsWidth = Math.max(0, maxX - minX)
  const boundsHeight = Math.max(0, maxY - minY)
  const contentWidth = Math.max(MINIMAP_MIN_DIMENSION, boundsWidth)
  const contentHeight = Math.max(MINIMAP_MIN_DIMENSION, boundsHeight)
  const contentMinX = minX - (contentWidth - boundsWidth) / 2
  const contentMinY = minY - (contentHeight - boundsHeight) / 2
  const maxDim = Math.max(contentWidth, contentHeight)
  const padding = Math.max(MINIMAP_MIN_PADDING, Math.round(maxDim * MINIMAP_PADDING_RATIO))

  /* Khi bbox nhỏ hơn sàn, mở đều về hai phía để một khối đơn không bị dồn lên
   * góc trên-trái. Dùng floor/ceil cho hai biên thay vì round kích thước riêng
   * để viewBox luôn bao trọn node có toạ độ thập phân. */
  const viewBoxX = Math.floor(contentMinX - padding)
  const viewBoxY = Math.floor(contentMinY - padding)
  const viewBoxRight = Math.ceil(contentMinX + contentWidth + padding)
  const viewBoxBottom = Math.ceil(contentMinY + contentHeight + padding)

  return {
    x: viewBoxX,
    y: viewBoxY,
    width: viewBoxRight - viewBoxX,
    height: viewBoxBottom - viewBoxY,
  }
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

function StMinimapContent({
  source,
  onNavigate,
  onCollapse,
}: {
  source: string
  onNavigate: (offset: number) => void
  onCollapse?: () => void
}) {
  const { pick } = useI18n()
  const [tab, setTab] = useState<'outline' | 'map'>('outline')
  const entries = useMemo(() => stCodeMapEntries(source), [source])
  const lines = useMemo(() => {
    const raw = source.split('\n')
    let offset = 0
    return raw.map((text, idx) => {
      /* Chốt offset ĐẦU dòng trước khi cộng dồn: trả thẳng `offset` sau phép
       * cộng là trả vị trí dòng KẾ TIẾP, khiến click dòng N nhảy xuống N+1. */
      const lineOffset = offset
      offset += text.length + 1
      return { line: idx + 1, text, offset: lineOffset }
    })
  }, [source])

  return (
    <div className="flex h-full flex-col">
      {/* Header bar with title, tabs, and collapse button */}
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-[var(--c-text-dim)]">
            {pick('Bản đồ thu nhỏ', 'Mini Map')}
          </span>
          <span className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.2 font-mono text-[10px] font-semibold text-[var(--c-accent)]">
            ST
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Tabs: Dàn ý (Hàm / Cấu trúc) vs Bản đồ mã */}
          <div className="flex items-center rounded-lg border border-[var(--c-border)] bg-[var(--c-bg)] p-0.5" role="tablist" aria-label={pick('Chế độ xem bản đồ', 'Map view mode')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'outline'}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                tab === 'outline'
                  ? 'bg-[var(--c-accent)] text-white shadow-sm'
                  : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
              onClick={() => setTab('outline')}
            >
              {pick('Dàn ý & Hàm', 'Outline')} ({entries.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'map'}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                tab === 'map'
                  ? 'bg-[var(--c-accent)] text-white shadow-sm'
                  : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
              onClick={() => setTab('map')}
            >
              {pick('Bản đồ mã', 'Code map')} ({lines.length})
            </button>
          </div>

          {onCollapse && (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded border border-[var(--c-border)] text-xs text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)] transition"
              onClick={onCollapse}
              aria-label={pick('Thu gọn Bản đồ', 'Collapse Mini Map')}
              title={pick('Thu gọn Bản đồ', 'Collapse Mini Map')}
            >
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        role="region"
        aria-label={pick('Bản đồ mã nguồn ST', 'ST code map')}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--c-border)] bg-[var(--c-surface-2)]/60 text-xs"
      >
        {tab === 'outline' ? (
          /* Tab Dàn ý & Hàm: danh sách cuộn dọc có thanh trượt riêng */
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1">
            {entries.length === 0 ? (
              <p className="p-3 text-center text-xs text-[var(--c-text-dim)]">
                {pick('Không tìm thấy cấu trúc POU, VAR hay khối lệnh điều khiển nào.', 'No POU, VAR, or control structures found.')}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-1" tabIndex={0} role="list">
                {entries.map((entry) => {
                  let kindBadge = 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
                  let kindLabel: string = entry.kind
                  if (entry.kind === 'POU') {
                    kindBadge = 'bg-sky-950/60 text-sky-300 border border-sky-800/60'
                    kindLabel = 'POU'
                  } else if (entry.kind === 'VAR_BLOCK') {
                    kindBadge = 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                    kindLabel = 'VAR'
                  } else if (entry.kind === 'BRANCH') {
                    kindBadge = 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                    kindLabel = 'BRANCH'
                  } else if (entry.kind === 'LOOP') {
                    kindBadge = 'bg-purple-950/60 text-purple-300 border border-purple-800/60'
                    kindLabel = 'LOOP'
                  }

                  return (
                    <div key={`${entry.line}-${entry.offset}`} role="listitem">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded border border-transparent px-2 py-1.5 text-left transition hover:border-[var(--c-border)] hover:bg-[var(--c-surface)] group"
                        onClick={() => onNavigate(entry.offset)}
                        title={`Line ${entry.line}: ${entry.label}`}
                      >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="w-8 shrink-0 text-right font-mono text-[11px] font-bold text-[var(--c-accent)]">
                          {entry.line}
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.2 text-[9px] font-mono font-semibold ${kindBadge}`}>
                          {kindLabel}
                        </span>
                        <span className="min-w-0 truncate font-mono text-[11px] text-[var(--c-text)] group-hover:text-[var(--c-accent)]">
                          {entry.label}
                        </span>
                      </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          /* Tab Bản đồ mã: hiển thị toàn bộ các dòng mã thu nhỏ, cuộn dọc */
          <div className="min-h-0 flex-1 overflow-y-auto p-1 font-mono text-[10px]" tabIndex={0} role="list">
            {lines.map((l) => (
              <div
                key={l.line}
                role="listitem"
                tabIndex={0}
                onClick={() => onNavigate(l.offset)}
                onKeyDown={(e) => { if (e.key === 'Enter') onNavigate(l.offset) }}
                className="flex cursor-pointer items-baseline gap-2 rounded px-1.5 py-0.5 leading-tight text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface)] hover:text-[var(--c-text)]"
              >
                <span className="w-8 shrink-0 text-right opacity-50 select-none">{l.line}</span>
                <span className="min-w-0 truncate">{l.text || ' '}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
  stSource?: string | null
  onJumpToOffset?: ((offset: number, length: number) => void) | null
  onCollapse?: () => void
}

export function WorkbenchMinimapPanel({ bridge: propBridge, stSource, onJumpToOffset, onCollapse }: WorkbenchMinimapPanelProps) {
  const { pick } = useI18n()
  const contextBridge = useFbdCanvasBridge()
  const bridge = propBridge !== undefined ? propBridge : contextBridge
  const pointerIdRef = useRef<number | null>(null)
  const [minimapZoom, setMinimapZoom] = useState(1)

  if (!bridge || bridge.nodes.length === 0) {
    if (stSource) {
      return (
        <StMinimapContent
          source={stSource}
          onNavigate={(offset) => onJumpToOffset?.(offset, 1)}
          onCollapse={onCollapse}
        />
      )
    }

    return (
      <div className="flex h-full flex-col">
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-[var(--c-text-dim)]">
            {pick('Bản đồ thu nhỏ', 'Mini Map')}
          </span>
          {onCollapse && (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded border border-[var(--c-border)] text-xs text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
              onClick={onCollapse}
              aria-label={pick('Thu gọn Bản đồ', 'Collapse Mini Map')}
              title={pick('Thu gọn Bản đồ', 'Collapse Mini Map')}
            >
              <PanelRightClose className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
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

  const activeBridge = bridge
  const base = computeMinimapViewBox(activeBridge.nodes)
  const w = base.width / minimapZoom
  const h = base.height / minimapZoom
  const effectiveViewBox = {
    x: Math.round(base.x + (base.width - w) / 2),
    y: Math.round(base.y + (base.height - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  }
  const scroll = activeBridge.scrollPosition
  const scale = activeBridge.scale || activeBridge.viewport?.scale || 1
  const vpX = scroll ? (scroll.left - (activeBridge.viewport?.x ?? 0)) / scale : 0
  const vpY = scroll ? (scroll.top - (activeBridge.viewport?.y ?? 0)) / scale : 0
  const vpW = scroll ? scroll.clientWidth / scale : activeBridge.width
  const vpH = scroll ? scroll.clientHeight / scale : activeBridge.height

  const indicatorW = Math.min(base.width, Math.max(10, vpW))
  const indicatorH = Math.min(base.height, Math.max(10, vpH))
  const indicatorX = Math.max(base.x, Math.min(base.x + base.width - indicatorW, vpX))
  const indicatorY = Math.max(base.y, Math.min(base.y + base.height - indicatorH, vpY))

  /* `#732` — chuyển THẲNG toạ độ con trỏ thật cho canvas, không dịch gì ở đây.
   *
   * Bản trước đổi con trỏ sang toạ độ graph bằng `effectiveViewBox`, rồi chiếu
   * ngược ra một "client ảo" bằng `activeBridge.width/height` để canvas giải mã
   * lại. Canvas (`FbdCanvas.navigateFromMinimap`) giải mã bằng thuộc tính
   * `viewBox` của chính phần tử này — tức hệ của bước ĐẦU, không phải hệ của
   * bước chiếu ngược. Hai hệ chỉ trùng khi `effectiveViewBox` đúng bằng
   * `(0, 0, bridge.width, bridge.height)`; ngoài ra chúng lệch nhau đúng tỉ số
   * hai bề rộng, đo được là `6320 / 5716 = 1,105668` ⇒ bấm Mini Map đưa khung
   * nhìn tới điểm cách chỗ bấm 255 px graph, càng xa gốc `viewBox` càng lệch.
   *
   * Cả vòng mã hoá–giải mã ấy lẽ ra là phép đồng nhất: phép đổi ở canvas nhận
   * cùng phần tử, cùng `rect`, cùng `viewBox` (thuộc tính `viewBox` dưới đây
   * render từ chính `effectiveViewBox`) và kẹp vào cùng biên. Nên cách sửa
   * đúng tầng là bỏ hẳn vòng đó đi, không phải chỉnh cho hai đầu khớp nhau —
   * còn vòng thì còn chỗ để hai hệ lệch lại.
   *
   * Ba nhánh dự phòng của bản cũ vốn đã chuyển thẳng `clientX/clientY` như
   * dòng dưới, và chúng là những nhánh cho kết quả ĐÚNG. Nay mọi lối đi đều
   * dùng chung đúng một đường. */
  function handleNavigate(clientX: number, clientY: number, element: SVGSVGElement) {
    activeBridge.onNavigate?.(clientX, clientY, element)
  }

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
            onClick={() => setMinimapZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
          >
            -
          </button>
          <span className="text-[11px] text-[var(--c-text-dim)]">
            {Math.round(minimapZoom * 100)}%
          </span>
          <button
            type="button"
            data-fbd-canvas-control="true"
            aria-label={pick('Phóng to', 'Zoom in')}
            title={pick('Phóng to', 'Zoom in')}
            className="flex h-5 w-5 items-center justify-center rounded border border-[var(--c-border)] text-xs hover:bg-[var(--c-surface-2)]"
            onClick={() => setMinimapZoom((z) => Math.min(2.5, Number((z + 0.2).toFixed(1))))}
          >
            +
          </button>
          <button
            type="button"
            data-fbd-canvas-control="true"
            aria-label={pick('Vừa khung', 'Reset zoom')}
            title={pick('Vừa khung', 'Reset zoom')}
            className="flex h-5 items-center justify-center rounded border border-[var(--c-border)] px-1 text-[10px] hover:bg-[var(--c-surface-2)]"
            onClick={() => setMinimapZoom(1)}
          >
            {pick('Vừa khung', 'Fit')}
          </button>
          {onCollapse && (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded border border-[var(--c-border)] text-xs text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
              onClick={onCollapse}
              aria-label={pick('Thu gọn Bản đồ', 'Collapse Mini Map')}
              title={pick('Thu gọn Bản đồ', 'Collapse Mini Map')}
            >
              <PanelRightClose className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
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
          viewBox={`${effectiveViewBox.x} ${effectiveViewBox.y} ${effectiveViewBox.width} ${effectiveViewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="max-h-full max-w-full rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--c-accent)]"
          onPointerDown={(event) => {
            pointerIdRef.current = event.pointerId
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // ponytail: mock test environment may omit pointer capture APIs
            }
            handleNavigate(event.clientX, event.clientY, event.currentTarget)
          }}
          onPointerMove={(event) => {
            if (pointerIdRef.current !== event.pointerId) return
            handleNavigate(event.clientX, event.clientY, event.currentTarget)
          }}
          onPointerUp={(event) => {
            if (pointerIdRef.current !== event.pointerId) return
            handleNavigate(event.clientX, event.clientY, event.currentTarget)
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
              activeBridge.onStepNavigate?.(-step, 0)
              event.preventDefault()
            } else if (event.key === 'ArrowRight') {
              activeBridge.onStepNavigate?.(step, 0)
              event.preventDefault()
            } else if (event.key === 'ArrowUp') {
              activeBridge.onStepNavigate?.(0, -step)
              event.preventDefault()
            } else if (event.key === 'ArrowDown') {
              activeBridge.onStepNavigate?.(0, step)
              event.preventDefault()
            }
          }}
        >
          {activeBridge.wires?.map((wire) => (
            <path
              key={wire.id}
              data-fbd-minimap-wire="true"
              d={wire.path}
              fill="none"
              stroke="var(--c-text-dim)"
              strokeWidth={1}
              aria-hidden="true"
            />
          ))}
          {activeBridge.nodes.map((placed) => (
            <rect
              key={placed.id}
              data-fbd-minimap-node="true"
              data-fbd-node-id={placed.id}
              x={placed.x}
              y={placed.y}
              width={placed.width}
              height={placed.height}
              fill={
                (activeBridge.selection?.kind === 'node' && activeBridge.selection.nodeId === placed.id) ||
                (activeBridge.selection?.kind === 'multi-node' && activeBridge.selection.nodeIds.includes(placed.id))
                  ? 'var(--c-accent)'
                  : 'var(--c-text-dim)'
              }
            />
          ))}
          <rect
            data-testid="minimap-viewport-indicator"
            x={indicatorX}
            y={indicatorY}
            width={indicatorW}
            height={indicatorH}
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
