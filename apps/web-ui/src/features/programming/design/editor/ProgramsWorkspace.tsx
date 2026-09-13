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
/* Bề ngang mặc định lấy theo ẢNH CHUẨN `PGM-02B` đo ở 1680 px: cây POU ~240,
 * canvas ~660, Thư viện nhanh ~230, Inspector ~342.
 *
 * Con số cũ (`inspector: 240`) là chỗ đau nhất: Inspector nay mang năm mục
 * (Chung / Tham số / Vào/Ra / Trạng thái / Thuộc tính) với các ô nhập số, và ở
 * 240 px thì nhãn `ManualOut` cùng ô giá trị của nó không đủ chỗ nằm cùng hàng.
 * Người dùng vẫn kéo lại được, và kích thước đó nhớ theo trình duyệt.
 *
 * Khổ mà bộ số của ảnh chuẩn mới có chỗ để sống.
 *
 * Ảnh chuẩn `PGM-02B` đo ở 1680 px. Áp NGUYÊN bộ số ấy xuống 1440 px — khổ
 * laptop kỹ sư phổ biến, và cũng đúng ngưỡng bắt đầu dựng bốn cột — thì ba cột
 * phụ chiếm 752 px trên 1190 px khả dụng và canvas chỉ còn 408 px. Đo được
 * 2026-09-13: vùng vẽ 364×215. Canvas là vùng làm việc CHÍNH; nó không được
 * nhận phần thừa. */
const REFERENCE_LAYOUT_MIN_WIDTH_PX = 1600

/** Bề ngang mặc định theo ảnh chuẩn `PGM-02B` đo ở 1680 px. */
const DEFAULT_WIDTHS_REFERENCE: Record<ProgramsPanel, number> = { explorer: 216, library: 216, inspector: 320 }

/** Bộ gọn cho 1440–1599 px: vẫn đủ bốn cột, nhưng canvas giữ được phần lớn. */
const DEFAULT_WIDTHS_COMPACT: Record<ProgramsPanel, number> = { explorer: 192, library: 180, inspector: 256 }

function defaultWidths(): Record<ProgramsPanel, number> {
  if (typeof window === 'undefined') return DEFAULT_WIDTHS_REFERENCE
  return window.innerWidth >= REFERENCE_LAYOUT_MIN_WIDTH_PX ? DEFAULT_WIDTHS_REFERENCE : DEFAULT_WIDTHS_COMPACT
}

/* Giữ tên cũ cho `clampPanelWidth`: nó chỉ cần MỘT mốc rơi-về khi nhận `NaN`,
   và mốc ấy không được phụ thuộc khổ màn hình — nếu không, cùng một giá trị
   hỏng sẽ kẹp ra hai kết quả khác nhau trên hai máy. */
const DEFAULT_WIDTHS: Record<ProgramsPanel, number> = DEFAULT_WIDTHS_REFERENCE
const MIN_WIDTHS: Record<ProgramsPanel, number> = { explorer: 168, library: 168, inspector: 208 }
const MAX_WIDTHS: Record<ProgramsPanel, number> = { explorer: 360, library: 320, inspector: 420 }

export function clampPanelWidth(panel: ProgramsPanel, width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTHS[panel]
  return Math.min(MAX_WIDTHS[panel], Math.max(MIN_WIDTHS[panel], Math.round(width)))
}

function readWidths(): Record<ProgramsPanel, number> {
  /* Lựa chọn ĐÃ LƯU của người dùng luôn thắng mặc định theo khổ: họ đã kéo tay
     một lần, và ghi đè nó mỗi lần đổi màn hình là lấy lại quyền họ vừa dùng. */
  const fallback = defaultWidths()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<ProgramsPanel, unknown>>
    return {
      explorer: clampPanelWidth('explorer', Number(parsed.explorer ?? fallback.explorer)),
      library: clampPanelWidth('library', Number(parsed.library ?? fallback.library)),
      inspector: clampPanelWidth('inspector', Number(parsed.inspector ?? fallback.inspector)),
    }
  } catch {
    return fallback
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
  libraryMounted = true,
  inspectorOpen,
}: {
  explorerOpen: boolean
  libraryOpen: boolean
  /**
   * Cột Thư viện nhanh có ĐƯỢC DỰNG ở khổ hiện tại hay không.
   *
   * Khác `libraryOpen` (`false` = khay thu về thanh ray 44 px vẫn bấm mở lại
   * được). `false` ở đây nghĩa là khổ này không có cột Thư viện — `TC-FBD-RESP-001`
   * khoá điều đó cho FBD dưới `1440 px` — nên track phải về `0`. Giữ `44 px`
   * cho một cột không tồn tại chính là khoảng trống mép phải mà một lần sửa
   * trước đã chữa bằng cách hoán vị thứ tự cột, tức chữa triệu chứng ở chỗ
   * khác và làm vỡ `AC-PGM02-004`.
   */
  libraryMounted?: boolean
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
    '--pgm-library-width': `${libraryMounted ? (libraryOpen ? widths.library : 44) : 0}px`,
    '--pgm-inspector-width': `${inspectorOpen ? widths.inspector : 44}px`,
  } as CSSProperties), [explorerOpen, inspectorOpen, libraryMounted, libraryOpen, widths])

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
      /* THỨ TỰ TRACK LÀ HỢP ĐỒNG, KHÔNG PHẢI SỞ THÍCH.
       *
       * `AC-PGM02-004` khoá bốn cột theo đúng thứ tự trái→phải: POU Explorer →
       * Editor → Thư viện nhanh → Inspector, và e2e đo bằng TOẠ ĐỘ THẬT chứ
       * không bằng tên lớp. Một lần hoán vị `inspector`/`library` ở đây để khay
       * Thư viện chạm mép phải đã làm đỏ đúng tiêu chí ấy — đổi thứ tự đọc của
       * một màn hình soạn thảo là đổi hợp đồng, nên nó phải đi qua quyết định
       * sản phẩm chứ không qua một lần chỉnh bố cục. Khoảng trống mép phải khi
       * Inspector thu gọn là track 44 px của chính nó (thanh ray thu gọn có nút
       * mở lại), không phải chỗ trống. */
      className={className ?? "grid min-w-0 gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[var(--pgm-explorer-width)_6px_minmax(320px,1fr)_6px_var(--pgm-library-width)_6px_var(--pgm-inspector-width)] lg:gap-0"}
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
