import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export type ProgramsPanel = 'explorer' | 'library' | 'inspector'

const STORAGE_KEY = 'mkddc-pgm02-panel-widths-v1'
const DEFAULT_WIDTHS: Record<ProgramsPanel, number> = { explorer: 208, library: 196, inspector: 240 }
const MIN_WIDTHS: Record<ProgramsPanel, number> = { explorer: 168, library: 168, inspector: 208 }
const MAX_WIDTHS: Record<ProgramsPanel, number> = { explorer: 360, library: 320, inspector: 420 }

export function clampPanelWidth(panel: ProgramsPanel, width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTHS[panel]
  return Math.min(MAX_WIDTHS[panel], Math.max(MIN_WIDTHS[panel], Math.round(width)))
}

function readWidths(): Record<ProgramsPanel, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIDTHS
    const parsed = JSON.parse(raw) as Partial<Record<ProgramsPanel, unknown>>
    return {
      explorer: clampPanelWidth('explorer', Number(parsed.explorer ?? DEFAULT_WIDTHS.explorer)),
      library: clampPanelWidth('library', Number(parsed.library ?? DEFAULT_WIDTHS.library)),
      inspector: clampPanelWidth('inspector', Number(parsed.inspector ?? DEFAULT_WIDTHS.inspector)),
    }
  } catch {
    return DEFAULT_WIDTHS
  }
}

/**
 * Bố cục bốn cột của PGM-02. Chỉ panel phụ đổi kích thước; Editor nhận toàn bộ
 * phần còn lại để không làm co vùng gõ xuống dưới 320 px. Kích thước được nhớ
 * theo trình duyệt và không đi vào Draft/runtime contract.
 */
export function useProgramsWorkspaceGrid({
  explorerOpen,
  libraryOpen,
  inspectorOpen,
}: {
  explorerOpen: boolean
  libraryOpen: boolean
  inspectorOpen: boolean
}) {
  const [widths, setWidths] = useState(readWidths)
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)) } catch { /* private mode/quota */ }
  }, [widths])

  const style = useMemo<CSSProperties>(() => ({
    '--pgm-explorer-width': `${explorerOpen ? widths.explorer : 44}px`,
    '--pgm-library-width': `${libraryOpen ? widths.library : 44}px`,
    '--pgm-inspector-width': `${inspectorOpen ? widths.inspector : 44}px`,
  } as CSSProperties), [explorerOpen, inspectorOpen, libraryOpen, widths])

  function beginResize(panel: ProgramsPanel, direction: 1 | -1, event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth < 1024) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = widthsRef.current[panel]
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)

    const move = (moveEvent: PointerEvent) => {
      const next = clampPanelWidth(panel, startWidth + ((moveEvent.clientX - startX) * direction))
      setWidths((current) => ({ ...current, [panel]: next }))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  return { style, beginResize }
}

/**
 * Khung layout bốn cột duy nhất của PGM-02. Tách markup này khỏi EditorPane để
 * luật track, editor tối thiểu 320 px và bảy slot không bị sao chép khi thêm
 * trạng thái ST/FBD mới.
 */
export function ProgramsWorkspace({
  style,
  children,
  onKeyDown,
  className,
}: {
  style: CSSProperties
  children: ReactNode
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  className?: string
}) {
  return (
    <div
      data-testid="programs-workspace"
      style={style}
      className={className ?? "grid min-w-0 gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[var(--pgm-explorer-width)_6px_minmax(320px,1fr)_6px_var(--pgm-inspector-width)_6px_var(--pgm-library-width)] lg:gap-0"}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

export function WorkspaceResizeHandle({
  label,
  panel,
  direction,
  onPointerDown,
}: {
  label: string
  panel: ProgramsPanel
  direction: 1 | -1
  onPointerDown: (panel: ProgramsPanel, direction: 1 | -1, event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={`workspace-resize-${panel}`}
      className="group relative hidden h-full cursor-col-resize touch-none lg:block"
      onPointerDown={(event) => onPointerDown(panel, direction, event)}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--c-border)] transition-colors group-hover:bg-[var(--c-accent)] group-focus-visible:bg-[var(--c-accent)]" />
    </button>
  )
}
