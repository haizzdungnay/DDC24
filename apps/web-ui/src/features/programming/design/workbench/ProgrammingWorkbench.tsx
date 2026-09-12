import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingDiagnostic } from '../../model/types'
import { ProblemsDrawer } from '../../shared/ProblemsDrawer'
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

type TabId = 'problems' | 'search' | 'references' | 'watch'

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
}) {
  const { pick } = useI18n()
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
    setTab('watch')
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
    { id: 'watch',
      label: mode === 'SIMULATE'
        ? pick('Watch (Mô phỏng)', 'Watch (Simulation)')
        : pick('Watch (Trực tiếp)', 'Watch (Live)'),
      count: watch ? watch.length : null, available: watch !== null && watch !== undefined },
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
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--c-border)] px-2 py-1">
        <button
          type="button"
          className="min-h-11 rounded px-2 py-1 text-xs text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? pick('Thu gọn', 'Collapse') : pick('Mở rộng', 'Expand')}
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
          className="overflow-auto p-2"
          style={{ height }}
        >
          {/* Ảnh chuẩn PGM-02B chia khay đáy thành 3 cột (x=196..839, x=839..1214, x=1214..1672):
           * Cột trái (~643px, co giãn): dải tab và nội dung tab đang chọn.
           * Cột giữa (~375px): bảng Runtime Watch hiển thị thường trực.
           * Cột phải (~458px): Mini Map (T9-01 / chuẩn bị kết nối dữ liệu canvas ở T9-02). */}
          <div className="grid h-full min-[1440px]:grid-cols-[minmax(0,1fr)_375px_458px] divide-x divide-[var(--c-border)]">
            {/* Cột trái: Nội dung tab đang chọn */}
            <div data-testid="workbench-problems-column" className="h-full overflow-auto pr-2">
              {tab === 'problems' && (
                <ProblemsPanel
                  problems={problems}
                  emptyState={problemsEmptyState}
                  revisionId={problemsRevisionId}
                  checkOwnerHref={checkOwnerHref}
                  pick={pick}
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
              {tab === 'watch' && (
                /* AC: "unavailable tab giải thích capability". Hiện một danh sách
                 * rỗng sẽ đọc như "không có giá trị nào", trong khi sự thật là
                 * "chế độ này không có nguồn giá trị runtime nào cả". */
                watch === null || watch === undefined ? (
                  <Unavailable reason={pick(
                    'Watch cần nguồn giá trị runtime. Chế độ EDIT chỉ có Draft, không có giá trị nào để hiện — chuyển sang LIVE để xem gói đang chạy.',
                    'Watch needs a runtime value source. EDIT mode only has the draft, so there is nothing to show — switch to LIVE to see the running package.',
                  )} />
                ) : (
                  <p className="text-xs text-[var(--c-text-dim)]">
                    {pick(
                      'Bảng Runtime Watch đang hiển thị thường trực ở cột giữa.',
                      'Runtime Watch panel is permanently displayed in the middle column.',
                    )}
                  </p>
                )
              )}
            </div>

            {/* Cột giữa: Runtime Watch thường trực */}
            <div data-testid="workbench-watch-column" className="flex h-full flex-col overflow-auto px-2">
              <div className="mb-1 text-xs font-semibold text-[var(--c-text-dim)]">
                {mode === 'SIMULATE'
                  ? pick('Watch (Mô phỏng)', 'Watch (Simulation)')
                  : pick('Watch (Trực tiếp)', 'Watch (Live)')}
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
            </div>

            {/* Cột phải: Mini Map (T9-02) */}
            <div data-testid="workbench-minimap-column" className="flex h-full flex-col overflow-auto pl-2">
              <WorkbenchMinimapPanel bridge={fbdBridge} />
            </div>
          </div>
        </div>
      )}
    </section>
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
}: {
  problems: readonly WorkbenchProblem[]
  emptyState: 'not-checked' | 'no-problems'
  revisionId: string | null
  checkOwnerHref: string
  pick: (vi: string, en: string) => string
}) {
  const diagnostics = useMemo<ProgrammingDiagnostic[]>(() => problems.map((problem) => ({
    code: problem.code,
    severity: problem.severity ?? 'ERROR',
    messageKey: '',
    message: problem.jumpLabel
      ? `${problem.jumpLabel} · ${problem.detail}`
      : `${pick('không neo vào vị trí nào', 'not anchored to a location')} · ${problem.detail}`,
    args: { workbenchProblemId: problem.id },
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
