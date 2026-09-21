import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, PanelRight, PanelRightClose } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingDiagnostic } from '../../model/types'
import type { OpenBufferContext } from '../../shared/diagnosticFreshness'
import { ProblemsDrawer } from '../../shared/ProblemsDrawer'
import {
  PROGRAMMING_WORKBENCH_COLUMNS_MIN_WIDTH_PX,
  useMinWidth,
  useWorkbenchOwnsMinimap,
} from '../../layout/useProgrammingViewport'
import { WorkbenchMinimapPanel, type FbdCanvasBridge } from './WorkbenchMinimapPanel'
import { WorkbenchWatchPanel, type WatchRow } from './WorkbenchWatchPanel'

/**
 * `T59-807` / `PGM02-V22-WP-06-R1` — workbench dưới đáy, dùng CHUNG cho mọi bề
 * mặt soạn thảo.
 *
 * Trước lát này, mỗi loại thông tin sống ở một chỗ khác nhau và theo một luật
 * khác nhau: lỗi Draft FBD nằm trong chính editor FBD, tham chiếu ST nằm trong
 * editor ST, tìm kiếm nằm trong thanh công cụ ST. Người dùng không có MỘT chỗ
 * để hỏi "chương trình này đang có vấn đề gì".
 *
 * Hai luật của workbench, và cả hai đều là chống-nói-dối:
 *
 * 1. **Mỗi tab tự khai nguồn của nó** (`EDIT`/`SIMULATE`/`LIVE` + revision hay
 *    session). Một khay dữ liệu không nói nguồn là một khay có thể đang hiện
 *    số của Active trong khi người dùng đang sửa Draft.
 * 2. **Tab chưa có capability thì GIẢI THÍCH, không hiện rỗng.** Một danh sách
 *    rỗng đọc như "không có gì" — trong khi sự thật là "chưa đo được". Hai câu
 *    đó dẫn tới hai hành động khác nhau.
 */

export type WorkbenchMode = 'EDIT' | 'SIMULATE' | 'LIVE'

export interface WorkbenchProblem {
  id: string
  code: string
  detail: string
  severity?: ProgrammingDiagnostic['severity']
  /** `null` = lỗi không neo vào vị trí nào; nút nhảy sẽ không hiện. */
  jumpLabel: string | null
  onJump?: () => void
  location?: ProgrammingDiagnostic['location']
}

export interface WorkbenchSymbol {
  name: string
  typeName: string
  kindLabel: string
  reads: number
  writes: number
  onJump: () => void
  /**
   * `DEV-PROG-017` — TỪNG chỗ dùng, không chỉ con số đếm.
   *
   * Một con số "7 tham chiếu" trả lời được "có nhiều không" nhưng không trả lời
   * được "ở đâu" — mà đó mới là câu người đang sửa một biến cần. Danh sách rỗng
   * là một câu trả lời thật (khai báo rồi nhưng chưa dùng), khác hẳn không có
   * trường này.
   */
  occurrences?: readonly { line: number; role: 'READ' | 'WRITE'; preview: string; onJump: () => void }[]
}

/**
 * `T59-811` — một dòng Watch trong workbench.
 *
 * Đã được **trình bày sẵn** (`display`/`state`) chứ không phải giá trị thô:
 * luật "null/BAD/OFFLINE không bao giờ thành 0" sống ở `presentStRuntimeValue`,
 * và diễn giải lại lần thứ hai ở đây là hai chỗ để lệch nhau.
 *
 * `DEV-PROG-003` mở rộng thành đúng kiểu của khay Watch (thêm kiểu dữ liệu,
 * quality thô, mốc đọc và giá trị số để vẽ xu hướng).
 */
export type WorkbenchWatchRow = WatchRow

export interface WorkbenchSearchHit {
  offset: number
  line: number
  preview: string
}

const MIN_HEIGHT = 120
const MAX_HEIGHT = 520
/**
 * `DEV-PROG-001` — 200 → 150 px.
 *
 * Workbench và trình soạn thảo chia CÙNG một ngân sách chiều cao, nên mỗi pixel
 * mặc định ở đây là một pixel lấy khỏi chỗ người ta gõ. Đo ở 1440×900 sau khi
 * khay phụ rời khỏi cột giữa: workbench chiếm 260 px và editor chỉ còn ~209 px.
 * Khay Vấn đề của một Draft sạch chỉ có hai dòng chữ, nên 150 px đã dư — và tay
 * kéo vẫn còn đó cho lúc danh sách lỗi dài thật.
 */
/* `DEV-PROG-021` — đo trên trình duyệt thật: ở 1280×800, cột soạn thảo chỉ có
   512 px ngân sách, mà workbench chiếm 211 px (41%) khiến chỗ gõ còn 158 px —
   khoảng tám dòng. Workbench là nơi TRA CỨU, chỗ gõ là nơi LÀM VIỆC; khi phải
   chia nhau một màn hình chật thì nơi làm việc được ưu tiên. Người dùng vẫn kéo
   to nó lên bất cứ lúc nào, và chiều cao đó giữ trong phiên. */
/* Bằng đúng `MIN_HEIGHT`: đây là sàn của thanh, và một mặc định NHỎ HƠN sàn sẽ
   làm `aria-valuenow` nằm ngoài `[valuemin, valuemax]` — trình đọc màn hình đọc
   ra một giá trị vô nghĩa, và axe bắt đúng lỗi đó. */
/* `PGM-02B` — 120 → 173 px. Ảnh chuẩn đo được khay đáy chiếm y=729..901, tức
   173 px. Con số này THAY THẾ mặc định 120 px của `DEV-PROG-021`, nhưng không
   bác bỏ lập luận của nó: ngân sách chiều cao vẫn là thứ chia nhau, nên 173 px
   chỉ đúng ở khổ lớn mà ảnh chuẩn mô tả. Sàn `MIN_HEIGHT` giữ nguyên 120 px để
   người dùng ở màn hình chật vẫn thu về đúng mức cũ, và chiều cao đó giữ trong
   phiên. */
const DEFAULT_HEIGHT = 173
const STORAGE_KEY = 'mkddc:programming-workbench:v1'

interface StoredWorkbenchState {
  open?: unknown
  height?: unknown
}

function getInitialWorkbenchState(): { open: boolean; height: number } {
  const isDesktop = typeof window !== 'undefined' ? window.innerWidth >= 1440 : false
  const fallback = {
    open: isDesktop,
    height: isDesktop ? DEFAULT_HEIGHT : MIN_HEIGHT,
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as StoredWorkbenchState
    if (!parsed || typeof parsed !== 'object') return fallback
    const validOpen = typeof parsed.open === 'boolean' ? parsed.open : fallback.open
    const validHeight =
      typeof parsed.height === 'number' && Number.isFinite(parsed.height)
        ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parsed.height))
        : fallback.height
    return { open: validOpen, height: validHeight }
  } catch {
    return fallback
  }
}

type TabId = 'problems' | 'search' | 'references'

export function ProgrammingWorkbench({
  mode,
  sourceLabel,
  problems,
  problemsEmptyState = 'not-checked',
  problemsRevisionId = null,
  symbols,
  source,
  onJumpToOffset,
  checkOwnerHref,
  watch,
  traceOwnerHref: _traceOwnerHref,
  watchAddRequest,
  fbdBridge,
  stMinimap = false,
  openBuffer,
}: {
  mode: WorkbenchMode
  /** Nguồn dữ liệu đang hiển thị, ví dụ `Draft · AHU_FanControl`. */
  sourceLabel: string
  problems: readonly WorkbenchProblem[]
  /** `ISS-STED-05` — "chưa kiểm tra" và "đã kiểm tra, không có lỗi" là hai câu
   * KHÁC NHAU dẫn tới hai hành động khác nhau. Gộp chúng thành một dòng rỗng
   * chung là cách người dùng ST tin rằng chương trình đã sạch trong khi chưa
   * ai kiểm nó. */
  problemsEmptyState?: 'not-checked' | 'no-problems'
  problemsRevisionId?: string | null
  symbols: readonly WorkbenchSymbol[]
  /** Nguồn của POU đang mở; `null` khi POU không phải văn bản (FBD). */
  source: string | null
  onJumpToOffset: (offset: number, length: number) => void
  /** Nơi thật sự sở hữu kết quả Check (PGM-05) — nêu đích danh thay vì im lặng. */
  checkOwnerHref: string
  /**
   * Giá trị runtime của POU đang mở, chiếu từ **chính** snapshot trang cha đã
   * poll. `null`/`undefined` = chế độ hiện tại không có nguồn giá trị nào.
   */
  watch?: readonly WorkbenchWatchRow[] | null
  /** PGM-06 sở hữu phiên Trace; workbench chỉ trỏ tới, không mở phiên thứ hai. */
  traceOwnerHref?: string
  /**
   * `DEV-PROG-003` — yêu cầu theo dõi một biến, phát từ nháy đúp trong trình
   * soạn thảo. `nonce` là bắt buộc: nháy đúp HAI LẦN vào cùng một biến vẫn phải
   * mở lại khay, mà so sánh theo tên thì lần thứ hai không có gì đổi.
   */
  watchAddRequest?: { name: string; nonce: number } | null
  /** Cầu nối dữ liệu FBD Canvas sang Mini Map (T9-02) */
  fbdBridge?: FbdCanvasBridge | null
  stMinimap?: boolean
  openBuffer?: OpenBufferContext
}) {
  const { pick } = useI18n()
  /* Số cột của khay đáy do JAVASCRIPT quyết, không do utility quyết — lý do đầy
     đủ ở chú thích cạnh chính cái lưới bên dưới. Hai hook, hai ngưỡng: `lg`
     (1024) mở hai cột, `1440` mở cột Mini Map. */
  const workbenchOwnsMinimap = useWorkbenchOwnsMinimap()
  const twoColumnGrid = useMinWidth(PROGRAMMING_WORKBENCH_COLUMNS_MIN_WIDTH_PX)
  /* `PGM-02B` — MỞ SẴN. Quyết định này THAY THẾ `DEV-PROG-024`, vốn chốt thu gọn
   * sẵn.
   *
   * Lập luận cũ của `DEV-PROG-024` đo ở 1280×800: khay chiếm 181 px, tức 35%
   * ngân sách dọc, để nói "Draft không có vấn đề nào" — trong khi chỗ gõ chỉ còn
   * 254 px. Lập luận đó KHÔNG SAI, và nó vẫn đúng ở khổ chật. Cái đổi là ảnh
   * chuẩn PGM-02B mô tả khổ 1672 px, nơi ngân sách dọc dư để khay mở sẵn mà
   * không lấn chỗ gõ, và nơi Runtime Watch cần hiện thường trực chứ không nằm
   * sau một cú bấm.
   *
   * Ràng buộc từ `DEV-PROG-024` vẫn giữ: dải tab đứng nguyên tại chỗ với đủ số
   * đếm trên nhãn, và người dùng thu gọn được bất cứ lúc nào — chiều cao đó giữ
   * trong phiên. */
  const [open, setOpen] = useState(() => getInitialWorkbenchState().open)
  const [height, setHeight] = useState(() => getInitialWorkbenchState().height)
  const [tab, setTab] = useState<TabId>('problems')
  const [query, setQuery] = useState('')
  const [watchCollapsed, setWatchCollapsed] = useState(() => {
    try { return localStorage.getItem('mkddc-workbench-watch-collapsed') === 'true' } catch { return false }
  })
  const [minimapCollapsed, setMinimapCollapsed] = useState(() => {
    try { return localStorage.getItem('mkddc-workbench-minimap-collapsed') === 'true' } catch { return false }
  })

  useEffect(() => {
    try {
      localStorage.setItem('mkddc-workbench-watch-collapsed', String(watchCollapsed))
    } catch {
      // Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh)
    }
  }, [watchCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem('mkddc-workbench-minimap-collapsed', String(minimapCollapsed))
    } catch {
      // Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh)
    }
  }, [minimapCollapsed])

  const [watchWidthPx, setWatchWidthPx] = useState(() => {
    try {
      const v = Number(localStorage.getItem('mkddc-workbench-watch-width'))
      if (Number.isFinite(v) && v >= 200 && v <= 700) return v
    } catch { /* Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh) */ }
    return 375
  })

  const [minimapWidthPx, setMinimapWidthPx] = useState(() => {
    try {
      const v = Number(localStorage.getItem('mkddc-workbench-minimap-width'))
      if (Number.isFinite(v) && v >= 200 && v <= 800) return v
    } catch { /* Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh) */ }
    return 458
  })

  useEffect(() => {
    try { localStorage.setItem('mkddc-workbench-watch-width', String(watchWidthPx)) } catch { /* Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh) */ }
  }, [watchWidthPx])

  useEffect(() => {
    try { localStorage.setItem('mkddc-workbench-minimap-width', String(minimapWidthPx)) } catch { /* Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh) */ }
  }, [minimapWidthPx])

  const watchWidth = watchCollapsed ? '44px' : String(watchWidthPx) + 'px'
  const minimapWidth = minimapCollapsed ? '44px' : String(minimapWidthPx) + 'px'

  const gridStyle = useMemo(() => {
    if (!open) return undefined
    if (workbenchOwnsMinimap) {
      return { gridTemplateColumns: `minmax(0,1fr) ${watchWidth} ${minimapWidth}` }
    }
    if (twoColumnGrid) {
      return { gridTemplateColumns: `minmax(0,1fr) ${watchWidth}` }
    }
    return undefined
  }, [open, workbenchOwnsMinimap, twoColumnGrid, watchWidth, minimapWidth])
  /** `DEV-PROG-017` — tìm bằng biểu thức chính quy. Tắt theo mặc định: đa số lần
   *  tìm là tìm một cái tên, và `.` hay `(` trong tên sẽ đổi nghĩa nếu luôn bật. */
  const [regex, setRegex] = useState(false)
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)

  /**
   * `DEV-PROG-017` — kết quả tìm kiếm, chữ thường hoặc biểu thức chính quy.
   *
   * Biểu thức hỏng KHÔNG âm thầm rơi về tìm chữ thường: người dùng đang gõ dở
   * `IF (` thì "0 kết quả" là câu trả lời đúng cho một mẫu chưa hoàn chỉnh, còn
   * lặng lẽ đi tìm chuỗi `IF (` là trả lời một câu hỏi khác câu họ hỏi. Lỗi
   * được NÓI RA và bề mặt gọi hiển thị nó.
   */
  const search = useMemo<{ hits: WorkbenchSearchHit[]; error: string | null }>(() => {
    if (!source || query.trim().length === 0) return { hits: [], error: null }
    const output: WorkbenchSearchHit[] = []
    const push = (at: number) => {
      const lineStart = source.lastIndexOf('\n', at - 1) + 1
      const lineEnd = source.indexOf('\n', at)
      output.push({
        offset: at,
        line: source.slice(0, at).split('\n').length,
        preview: source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim().slice(0, 120),
      })
    }
    if (regex) {
      let pattern: RegExp
      try {
        pattern = new RegExp(query, 'gi')
      } catch (error) {
        return { hits: [], error: error instanceof Error ? error.message : String(error) }
      }
      let match = pattern.exec(source)
      while (match !== null && output.length < 200) {
        push(match.index)
        /* Mẫu khớp chuỗi RỖNG (`a*`) làm `lastIndex` đứng yên và vòng lặp không
         * bao giờ kết thúc — đẩy `lastIndex` lên một là điều kiện dừng, không
         * phải một tinh chỉnh. */
        if (match[0].length === 0) pattern.lastIndex += 1
        match = pattern.exec(source)
      }
      return { hits: output, error: null }
    }
    const needle = query.toLocaleLowerCase()
    const haystack = source.toLocaleLowerCase()
    let at = haystack.indexOf(needle)
    while (at !== -1 && output.length < 200) {
      push(at)
      at = haystack.indexOf(needle, at + Math.max(1, needle.length))
    }
    return { hits: output, error: null }
  }, [source, query, regex])
  const hits = search.hits

  /* Đổi POU/mode thì kết quả tìm kiếm của tài liệu CŨ phải biến mất. Giữ lại
   * là đúng lớp lỗi mà AC "switching mode không giữ samples từ source cũ" tồn
   * tại để chặn. */
  useEffect(() => { setQuery('') }, [sourceLabel, mode])

  /* `DEV-PROG-003` — nháy đúp một biến trong trình soạn thảo phải ĐƯA NGƯỜI
   * DÙNG TỚI khay Watch, không chỉ âm thầm thêm một dòng vào một khay đang
   * đóng. Chỉ chuyển tab khi khay Watch thật sự có nguồn giá trị; ở chế độ EDIT
   * nó không có, và nhảy sang một khay chỉ để hiện lời giải thích là cướp tiêu
   * điểm của người đang gõ. */
  useEffect(() => {
    if (!watchAddRequest || watch === null || watch === undefined) return
    setWatchCollapsed(false)
    setOpen(true)
  }, [watchAddRequest, watch])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, height }))
    } catch {
      // Bỏ qua lỗi lưu trữ cục bộ (hạn ngạch / chế độ ẩn danh)
    }
  }, [open, height])

  const modeBadge = (
    <span className="rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--c-text-dim)]">
      {mode} · {sourceLabel}
    </span>
  )

  const tabs: Array<{ id: TabId; label: string; count: number | null; available: boolean }> = [
    { id: 'problems', label: pick('Vấn đề', 'Problems'), count: problems.length, available: true },
    { id: 'search', label: pick('Tìm kiếm', 'Search'), count: source ? hits.length : null, available: source !== null },
    { id: 'references', label: pick('Tham chiếu', 'Cross reference'), count: symbols.length, available: symbols.length > 0 || source !== null },
    /* `T59-816` — nhãn khay phải nói ĐÚNG nguồn. Ở SIMULATE các con số này đến
       từ worker mô phỏng chứ không từ tủ; gọi chúng là "Trực tiếp" là cách
       nhanh nhất để một người trực ca đọc một giá trị mô phỏng như thể thiết bị
       đang cho ra nó. */
  ]

  return (
    <section
      className="mt-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]"
      aria-label={pick('Bàn làm việc', 'Workbench')}
    >
      {/* Một `separator` NHẬN TIÊU ĐIỂM là window splitter theo ARIA, nên nó
        * bắt buộc có giá trị: thiếu `aria-valuenow` thì screen reader đọc được
        * cái tay kéo nhưng không đọc được nó đang ở đâu. Quét axe của dự án bắt
        * đúng lỗi này (`aria-required-attr`) ngay lần chạy đầu. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={pick('Kéo để đổi chiều cao bàn làm việc', 'Drag to resize the workbench')}
        aria-valuenow={height}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        tabIndex={0}
        className="h-1.5 cursor-row-resize rounded-t-[var(--radius)] bg-[var(--c-border)]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height }
        }}
        onPointerMove={(event) => {
          const state = resizeRef.current
          if (!state || state.pointerId !== event.pointerId) return
          const next = state.startHeight + (state.startY - event.clientY)
          setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next)))
        }}
        onPointerUp={() => { resizeRef.current = null }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') { event.preventDefault(); setHeight((current) => Math.min(MAX_HEIGHT, current + 24)) }
          if (event.key === 'ArrowDown') { event.preventDefault(); setHeight((current) => Math.max(MIN_HEIGHT, current - 24)) }
        }}
      />
      {/* Dải tab nằm TRONG cột 1, không phải một hàng trải hết bề ngang.
        *
        * Trải hết bề ngang thì nó ăn mất một hàng của CẢ khay, nên Watch và Mini
        * Map bắt đầu thấp hơn dải tab đúng chiều cao dải đó — chỗ trống duy nhất
        * còn lại của khay bị bỏ không ở hai cột phải. Dải tab chỉ điều khiển nội
        * dung cột 1, nên nó thuộc về cột 1; hai cột kia khi đó kéo trọn chiều cao
        * khay theo `align-items: stretch` mặc định của grid. */}
      <div
        className="grid grid-cols-1 divide-y divide-[var(--c-border)] lg:divide-x lg:divide-y-0"
        style={gridStyle}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--c-border)] px-2 py-1">
            <button
              type="button"
              className="min-h-11 rounded px-2 py-1 text-xs text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              {open
                ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
              <span className="sr-only">{open ? pick('Thu gọn', 'Collapse') : pick('Mở rộng', 'Expand')}</span>
            </button>
            <div role="tablist" aria-label={pick('Khay bàn làm việc', 'Workbench panels')} className="flex flex-wrap gap-1">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`workbench-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  /* `aria-controls` CHỈ khi khay đang mở và đây là tab đang chọn.
                   * Khay thu gọn thì `<div role="tabpanel">` không có trong cây, nên
                   * một `aria-controls` trỏ vào `id` không tồn tại là vi phạm
                   * `aria-valid-attr-value` thật — axe bắt đúng, và trình đọc màn
                   * hình thì hứa với người dùng một vùng không có ở đó. */
                  aria-controls={open && tab === item.id ? `workbench-panel-${item.id}` : undefined}
                  className={`min-h-11 rounded px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${
                    tab === item.id ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'
                  }`}
                  onClick={() => { setTab(item.id); setOpen(true) }}
                >
                  {item.label}{item.count === null ? '' : ` (${item.count})`}
                </button>
              ))}
            </div>
            <span className="ml-auto">{modeBadge}</span>
          </div>
          {open && (
            <div
              role="tabpanel"
              id={`workbench-panel-${tab}`}
              aria-labelledby={`workbench-tab-${tab}`}
              data-testid="workbench-problems-column"
              className="overflow-auto p-2"
              style={{ height }}
            >
              {/* Ảnh chuẩn PGM-02B chia khay đáy thành 3 cột (x=196..839, x=839..1214, x=1214..1672):
           * Cột trái (~643px, co giãn): dải tab và nội dung tab đang chọn.
           * Cột giữa (~375px): bảng Runtime Watch hiển thị thường trực.
           * Cột phải (~458px): Mini Map.
           *
           * Cột thứ ba từng CỐ Ý vắng mặt, với lý do ghi ngay tại đây: logic Mini
           * Map nằm trong `FbdCanvas`, nên dựng một ô rỗng ở đây chỉ hứa một thứ
           * không tồn tại, và một bản sao thứ hai của minimap sẽ lệch khỏi bản gốc
           * ngay lần canvas đổi khung nhìn đầu tiên. Điều kiện để thêm cột cũng đã
           * ghi sẵn: "khi `FbdCanvas` công bố được khung nhìn ra ngoài". `T9-02`
           * làm đúng việc đó bằng `FbdCanvasBridge`, nên cột thứ ba nay có nguồn
           * dữ liệu THẬT — không phải bản sao, mà là cùng một khung nhìn.
           *
           * `375px` và `458px` là những con số TUYỆT ĐỐI, nên chúng phải có khổ
           * để sống. Lưới này trước đây áp dụng ở MỌI bề ngang: trên màn 412 px,
           * cột Watch một mình đã chiếm 375 px và cột trái (`minmax(0,1fr)`) co về
           * gần 0 — danh sách Vấn đề vẫn nằm trong DOM nhưng bị chính cột Watch
           * che, nên mọi cú bấm vào một diagnostic đều rơi vào
           * `workbench-watch-column` ("intercepts pointer events") cho tới khi hết
           * giờ. `TC-FBD-DIAG-001` ở lane mobile chết vì đúng lỗi này, và nó không
           * phải lỗi của phép đo: người dùng thật trên điện thoại cũng không bấm
           * được vào Vấn đề.
           *
           * Nên ba chặng, không phải một: dưới `lg` xếp CHỒNG (cùng nội dung, cùng
           * thứ tự đọc, chỉ khác trục); từ `lg` hai cột; từ `1440px` — khổ mà ảnh
           * chuẩn PGM-02B mô tả — đủ chỗ cho cả cột Mini Map.
           *
           * CHẶNG THỨ BA PHẢI ĐI QUA JAVASCRIPT, KHÔNG QUA MỘT UTILITY THỨ HAI.
           *
           * Bản trước viết `lg:grid-cols-[…375px]` cạnh một biến thể arbitrary
           * cho 1440 px dựng `grid-cols-[…458px]`.
           * Tailwind v4 xuất mọi biến thể breakpoint KHÔNG-mặc-định — cả
           * `min-[…]` arbitrary lẫn breakpoint tự khai trong `@theme` — vào một
           * cụm nằm TRƯỚC `sm/md/lg/xl` (đo được 2026-09-13: cụm tự khai ở thứ
           * tự 765, `sm` ở 779, `lg` ở 848). Hai rule cùng khớp ở ≥1440 px, cùng
           * độ đặc hiệu, nên bản `lg:` — đứng sau — thắng. Kết quả đo tại
           * 1680 px: `grid-template-columns: 1025px 375px`, tức cột Mini Map
           * KHÔNG BAO GIỜ tồn tại và khay Mini Map rơi xuống một hàng riêng kéo
           * hết bề ngang — đúng "thanh placeholder" mà người dùng nhìn thấy.
           *
           * `useWorkbenchOwnsMinimap()` đã là nguồn sự thật DUY NHẤT cho câu hỏi
           * "ai giữ Mini Map ở khổ này" (canvas giữ dưới 1440, khay giữ từ 1440).
           * Cho chính nó quyết luôn số cột thì lưới và nội dung không thể lệch
           * nhau, và một style nội tuyến thì không có rule nào chen vào trước
           * được. */}
              {tab === 'problems' && (
                <ProblemsPanel
                  problems={problems}
                  emptyState={problemsEmptyState}
                  revisionId={problemsRevisionId}
                  checkOwnerHref={checkOwnerHref}
                  pick={pick}
                  openBuffer={openBuffer}
                />
              )}
              {tab === 'search' && (
                source === null ? (
                  <Unavailable reason={pick('Không xác định được kết quả tìm kiếm vì POU này không phải mã nguồn văn bản — dùng khay Vấn đề để tìm block lỗi.', 'Search results are unavailable because this POU is not text source — use Problems to locate faulty blocks.')} />
                ) : (
                  <SearchPanel
                    query={query}
                    setQuery={setQuery}
                    regex={regex}
                    setRegex={setRegex}
                    error={search.error}
                    hits={hits}
                    onJumpToOffset={onJumpToOffset}
                    queryLength={query.length}
                    pick={pick}
                  />
                )
              )}
              {tab === 'references' && (
                symbols.length === 0 ? (
                  <Unavailable reason={pick('Không xác định được tham chiếu vì chưa có chỉ mục cho POU đang mở.', 'Cross references are unavailable because the open POU has no index.')} />
                ) : (
                  <ReferencesPanel symbols={symbols} pick={pick} />
                )
              )}
            </div>
          )}
        </div>

        {/* Cột giữa: Runtime Watch thường trực */}
        {open && (
          watchCollapsed ? (
            <div data-testid="workbench-watch-column" className="relative flex h-full w-[44px] min-w-[44px] flex-col items-center border-l border-[var(--c-border)] p-1">
              <button
                type="button"
                className="flex h-full w-full flex-col items-center justify-start gap-2 py-2 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                aria-label={pick('Mở rộng Watch', 'Expand Watch')}
                title={pick('Mở rộng Watch', 'Expand Watch')}
                onClick={() => setWatchCollapsed(false)}
              >
                <PanelRight className="h-4 w-4 rotate-180" aria-hidden="true" />
                <span className="[writing-mode:vertical-lr] text-[10px] font-semibold uppercase tracking-wider">
                  Watch
                </span>
              </button>
            </div>
          ) : (
            <Stretched
              testId="workbench-watch-column"
              resizeHandle={
                <ColumnResizeHandle
                  label={pick('Kéo để đổi chiều rộng cột Watch', 'Drag to resize the Watch column')}
                  testId="workbench-resize-watch"
                  value={watchWidthPx}
                  min={200}
                  max={700}
                  onResize={setWatchWidthPx}
                />
              }
            >
              <div className="mb-1 flex items-center justify-between gap-1 text-xs font-semibold text-[var(--c-text-dim)]">
                <span>
                  {mode === 'SIMULATE'
                    ? pick('Watch (Mô phỏng)', 'Watch (Simulation)')
                    : pick('Watch (Trực tiếp)', 'Watch (Live)')}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  aria-label={pick('Thu gọn Watch', 'Collapse Watch')}
                  title={pick('Thu gọn Watch', 'Collapse Watch')}
                  onClick={() => setWatchCollapsed(true)}
                >
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              {watch === null || watch === undefined ? (
                <p className="text-xs text-[var(--c-text-dim)]">
                  {pick(
                    'Chưa có nguồn giá trị runtime cho chế độ này.',
                    'No runtime watch source available for this mode.',
                  )}
                </p>
              ) : (
                <WorkbenchWatchPanel rows={watch} addRequest={watchAddRequest} />
              )}
            </Stretched>
          )
        )}

        {/* Cột phải: Mini Map (T9-02).
         * Chỉ dựng khi khay SỞ HỮU Mini Map. Dưới `1440px` chủ sở hữu là
         * canvas (`FbdEditorPane`), nên dựng thêm một ô ở đây sẽ vừa tạo một
         * hàng chồng thừa, vừa đặt hai bản cùng vai trò trong cùng một DOM. */}
        {open && workbenchOwnsMinimap && (
          minimapCollapsed ? (
            <div data-testid="workbench-minimap-column" className="relative flex h-full w-[44px] min-w-[44px] flex-col items-center border-l border-[var(--c-border)] p-1">
              <button
                type="button"
                className="flex h-full w-full flex-col items-center justify-start gap-2 py-2 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                aria-label={pick('Mở rộng Bản đồ thu nhỏ', 'Expand Mini Map')}
                title={pick('Mở rộng Bản đồ thu nhỏ', 'Expand Mini Map')}
                onClick={() => setMinimapCollapsed(false)}
              >
                <PanelRight className="h-4 w-4 rotate-180" aria-hidden="true" />
                <span className="[writing-mode:vertical-lr] text-[10px] font-semibold uppercase tracking-wider">
                  {pick('Bản đồ', 'Mini Map')}
                </span>
              </button>
            </div>
          ) : (
            <Stretched
              testId="workbench-minimap-column"
              resizeHandle={
                <ColumnResizeHandle
                  label={pick('Kéo để đổi chiều rộng cột Bản đồ thu nhỏ', 'Drag to resize the Mini Map column')}
                  testId="workbench-resize-minimap"
                  value={minimapWidthPx}
                  min={200}
                  max={800}
                  onResize={setMinimapWidthPx}
                />
              }
            >
              <WorkbenchMinimapPanel
                bridge={fbdBridge}
                stSource={stMinimap ? source : null}
                onJumpToOffset={onJumpToOffset}
                onCollapse={() => setMinimapCollapsed(true)}
              />
            </Stretched>
          )
        )}
      </div>
    </section>
  )
}

/**
 * Ô lưới kéo trọn chiều cao hàng mà KHÔNG tự nới hàng ra.
 *
 * Chiều cao hàng do cột 1 quyết (dải tab + `height` người dùng kéo). Một ô
 * `overflow-auto` bình thường vẫn đóng góp max-content vào track `auto`, nên một
 * bảng Watch dài sẽ kéo cả khay cao lên thay vì tự cuộn. Lớp `absolute inset-0`
 * tách nội dung khỏi phép đo track: hàng giữ nguyên, nội dung cuộn bên trong.
 */
function ColumnResizeHandle({
  label,
  testId,
  value,
  min,
  max,
  onResize,
}: {
  label: string
  testId: string
  value: number
  min: number
  max: number
  onResize: (nextWidth: number) => void
}) {
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className="group absolute -left-[5px] top-0 bottom-0 z-30 hidden w-[10px] cursor-col-resize items-center justify-center touch-none lg:flex focus-visible:outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: value }
      }}
      onPointerMove={(event) => {
        const state = resizeRef.current
        if (!state || state.pointerId !== event.pointerId) return
        const dx = event.clientX - state.startX
        const next = Math.min(max, Math.max(min, Math.round(state.startWidth - dx)))
        onResize(next)
      }}
      onPointerUp={() => { resizeRef.current = null }}
      onPointerCancel={() => { resizeRef.current = null }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onResize(Math.min(max, value + 24))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onResize(Math.max(min, value - 24))
        }
      }}
    >
      <span className="h-full w-1 rounded-full bg-transparent transition-colors group-hover:bg-[var(--c-accent)] group-focus-visible:bg-[var(--c-accent)]" />
    </button>
  )
}

function Stretched({ testId, children, resizeHandle }: { testId: string; children: ReactNode; resizeHandle?: ReactNode }) {
  return (
    <div className="relative min-h-0">
      {resizeHandle}
      <div data-testid={testId} className="absolute inset-0 flex flex-col overflow-auto p-2">
        {children}
      </div>
    </div>
  )
}

function Unavailable({ reason }: { reason: string }) {
  return <p role="status" className="text-xs text-[var(--c-text-dim)]">{reason}</p>
}

function ProblemsPanel({
  problems,
  emptyState,
  revisionId,
  checkOwnerHref,
  pick,
  openBuffer,
}: {
  problems: readonly WorkbenchProblem[]
  emptyState: 'not-checked' | 'no-problems'
  revisionId: string | null
  checkOwnerHref: string
  pick: (vi: string, en: string) => string
  openBuffer?: OpenBufferContext
}) {
  const diagnostics = useMemo<ProgrammingDiagnostic[]>(() => problems.map((problem) => ({
    code: problem.code,
    severity: problem.severity ?? 'ERROR',
    messageKey: '',
    message: problem.jumpLabel
      ? `${problem.jumpLabel} · ${problem.detail}`
      : `${pick('không neo vào vị trí nào', 'not anchored to a location')} · ${problem.detail}`,
    args: { workbenchProblemId: problem.id },
    location: problem.location,
  })), [pick, problems])

  const problemFor = (diagnostic: ProgrammingDiagnostic) => {
    const id = diagnostic.args?.workbenchProblemId
    return typeof id === 'string' ? problems.find((problem) => problem.id === id) : undefined
  }

  return (
    <div className="space-y-2">
      {problems.length === 0 && (
        <p className="text-xs text-[var(--c-text-dim)]">
          {emptyState === 'no-problems'
            ? (revisionId
                ? pick(`Kiểm tra revision ${revisionId}: không có vấn đề nào.`, `Check on revision ${revisionId}: no problems.`)
                : pick('Đã Kiểm tra: không có vấn đề nào.', 'Checked: no problems.'))
            : pick('Chưa Kiểm tra — POU ST chưa có kết quả nào. Draft không có vấn đề cấu trúc.',
                   'Not checked yet — no result for ST POUs. No structural problems in the draft.')}
        </p>
      )}
      {problems.length > 0 && (
        <ProblemsDrawer
          variant="embedded"
          diagnostics={diagnostics}
          emptyState={emptyState}
          openBuffer={openBuffer}
          isSelectable={(diagnostic) => {
            const problem = problemFor(diagnostic)
            return Boolean(problem?.onJump && problem.jumpLabel)
          }}
          onSelect={(diagnostic) => problemFor(diagnostic)?.onJump?.()}
        />
      )}
      {/* D-01: PGM-02 vẫn KHÔNG sở hữu kết quả Check — nó chỉ ĐỌC lại. Nói
        * đích danh nơi sở hữu thay vì để người dùng tưởng khay này là nơi chạy
        * Kiểm tra. Câu cũ ("chỉ hiện vấn đề cấu trúc") đã sai từ ISS-STED-05:
        * khay nay hiện cả diagnostic Check của POU ST. */}
      <p className="border-t border-[var(--c-border)] pt-2 text-xs text-[var(--c-text-dim)]">
        {pick('Vấn đề cấu trúc của Draft (FBD) và diagnostic của Kiểm tra gần nhất (ST). Chạy Kiểm tra ở trang ', 'Structural draft problems (FBD) and the latest check diagnostics (ST). Run checks in ')}
        <a className="text-[var(--c-accent)] underline" href={checkOwnerHref}>{pick('Kiểm tra & Đưa vào vận hành', 'Check & Commission')}</a>.
      </p>
    </div>
  )
}

function SearchPanel({
  query,
  setQuery,
  regex,
  setRegex,
  error,
  hits,
  onJumpToOffset,
  queryLength,
  pick,
}: {
  query: string
  setQuery: (value: string) => void
  regex: boolean
  setRegex: (value: boolean) => void
  /** Lỗi biên dịch biểu thức; `null` = mẫu hợp lệ. */
  error: string | null
  hits: readonly WorkbenchSearchHit[]
  onJumpToOffset: (offset: number, length: number) => void
  queryLength: number
  pick: (vi: string, en: string) => string
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-[var(--c-text-dim)]">
        {pick('Tìm trong POU đang mở', 'Search the open POU')}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-[var(--c-text-dim)]">
        <input
          type="checkbox"
          checked={regex}
          onChange={(event) => setRegex(event.target.checked)}
        />
        {pick('Biểu thức chính quy', 'Regular expression')}
      </label>
      {/* Mẫu hỏng phải NÓI RA. Rơi về tìm chữ thường sẽ trả lời một câu hỏi
          khác câu người dùng vừa hỏi, và họ không có cách nào biết. */}
      {error && (
        <p role="alert" className="text-xs text-[var(--c-fault-fg)]">
          {pick('Biểu thức không hợp lệ: ', 'Invalid expression: ')}{error}
        </p>
      )}
      {!error && query.trim().length > 0 && hits.length === 0 && (
        <p className="text-xs text-[var(--c-text-dim)]">{pick('Không có kết quả.', 'No matches.')}</p>
      )}
      <ul className="space-y-1">
        {hits.map((hit) => (
          <li key={hit.offset}>
            <button
              type="button"
              className="min-h-11 w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              onClick={() => onJumpToOffset(hit.offset, queryLength)}
            >
              <span className="text-[var(--c-text-dim)]">{pick('Dòng', 'Line')} {hit.line}</span>{' '}
              <span className="font-mono text-[var(--c-text)]">{hit.preview}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReferencesPanel({ symbols, pick }: { symbols: readonly WorkbenchSymbol[]; pick: (vi: string, en: string) => string }) {
  return (
    <ul className="space-y-1">
      {symbols.map((symbol) => (
        <li key={symbol.name}>
          <button
            type="button"
            className="min-h-11 w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            onClick={symbol.onJump}
          >
            <span className="font-mono text-[var(--c-text)]">{symbol.name}</span>
            <span className="text-[var(--c-text-dim)]"> : {symbol.typeName} · {symbol.kindLabel}</span>
            <span className="block text-[var(--c-text-dim)]">
              {pick('Đọc', 'Reads')} {symbol.reads} · {pick('Ghi', 'Writes')} {symbol.writes}
            </span>
          </button>
          {/* `DEV-PROG-017` — TỪNG chỗ dùng. Con số đếm trả lời "có nhiều
              không"; danh sách này trả lời "ở đâu", và đó mới là câu người đang
              sửa một biến cần. Gập lại theo mặc định để khay không dài ra gấp
              mười khi POU có 36 ký hiệu. */}
          {symbol.occurrences && symbol.occurrences.length > 0 && (
            <details className="ml-2 border-l border-[var(--c-border)] pl-2">
              <summary className="cursor-pointer text-[11px] text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
                {pick(`Xem ${symbol.occurrences.length} chỗ dùng`, `Show ${symbol.occurrences.length} usages`)}
              </summary>
              <ul>
                {symbol.occurrences.map((occurrence, index) => (
                  <li key={`${symbol.name}-${index}`}>
                    <button
                      type="button"
                      className="w-full rounded px-1 py-0.5 text-left text-[11px] hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                      onClick={occurrence.onJump}
                    >
                      <span className="text-[var(--c-text-dim)]">
                        {pick('Dòng', 'Line')} {occurrence.line} ·{' '}
                        {occurrence.role === 'WRITE' ? pick('ghi', 'write') : pick('đọc', 'read')}
                      </span>{' '}
                      <span className="font-mono text-[var(--c-text)]">{occurrence.preview}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
