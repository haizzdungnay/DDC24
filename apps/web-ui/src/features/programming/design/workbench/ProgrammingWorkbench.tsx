import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../../shared/i18n'

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
}

export interface WorkbenchSearchHit {
  offset: number
  line: number
  preview: string
}

const MIN_HEIGHT = 120
const MAX_HEIGHT = 520
const DEFAULT_HEIGHT = 200

type TabId = 'problems' | 'search' | 'references' | 'watch' | 'trace'

export function ProgrammingWorkbench({
  mode,
  sourceLabel,
  problems,
  symbols,
  source,
  onJumpToOffset,
  checkOwnerHref,
}: {
  mode: WorkbenchMode
  /** Nguồn dữ liệu đang hiển thị, ví dụ `Draft · AHU_FanControl`. */
  sourceLabel: string
  problems: readonly WorkbenchProblem[]
  symbols: readonly WorkbenchSymbol[]
  /** Nguồn của POU đang mở; `null` khi POU không phải văn bản (FBD). */
  source: string | null
  onJumpToOffset: (offset: number, length: number) => void
  /** Nơi thật sự sở hữu kết quả Check (PGM-03) — nêu đích danh thay vì im lặng. */
  checkOwnerHref: string
}) {
  const { pick } = useI18n()
  const [open, setOpen] = useState(true)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [tab, setTab] = useState<TabId>('problems')
  const [query, setQuery] = useState('')
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)

  const hits = useMemo<WorkbenchSearchHit[]>(() => {
    if (!source || query.trim().length === 0) return []
    const needle = query.toLocaleLowerCase()
    const haystack = source.toLocaleLowerCase()
    const output: WorkbenchSearchHit[] = []
    let at = haystack.indexOf(needle)
    while (at !== -1 && output.length < 200) {
      const lineStart = source.lastIndexOf('\n', at - 1) + 1
      const lineEnd = source.indexOf('\n', at)
      output.push({
        offset: at,
        line: source.slice(0, at).split('\n').length,
        preview: source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim().slice(0, 120),
      })
      at = haystack.indexOf(needle, at + Math.max(1, needle.length))
    }
    return output
  }, [source, query])

  /* Đổi POU/mode thì kết quả tìm kiếm của tài liệu CŨ phải biến mất. Giữ lại
   * là đúng lớp lỗi mà AC "switching mode không giữ samples từ source cũ" tồn
   * tại để chặn. */
  useEffect(() => { setQuery('') }, [sourceLabel, mode])

  const modeBadge = (
    <span className="rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--c-text-dim)]">
      {mode} · {sourceLabel}
    </span>
  )

  const tabs: Array<{ id: TabId; label: string; count: number | null; available: boolean }> = [
    { id: 'problems', label: pick('Vấn đề', 'Problems'), count: problems.length, available: true },
    { id: 'search', label: pick('Tìm kiếm', 'Search'), count: source ? hits.length : null, available: source !== null },
    { id: 'references', label: pick('Tham chiếu', 'Cross reference'), count: symbols.length, available: symbols.length > 0 || source !== null },
    { id: 'watch', label: 'Watch', count: null, available: mode !== 'EDIT' },
    { id: 'trace', label: 'Trace', count: null, available: mode !== 'EDIT' },
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
              aria-controls={`workbench-panel-${item.id}`}
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
          {tab === 'problems' && (
            <ProblemsPanel problems={problems} checkOwnerHref={checkOwnerHref} pick={pick} />
          )}
          {tab === 'search' && (
            source === null ? (
              <Unavailable reason={pick('POU này không phải mã nguồn văn bản — dùng khay Vấn đề để tìm block lỗi.', 'This POU is not text source — use Problems to locate faulty blocks.')} />
            ) : (
              <SearchPanel query={query} setQuery={setQuery} hits={hits} onJumpToOffset={onJumpToOffset} queryLength={query.length} pick={pick} />
            )
          )}
          {tab === 'references' && (
            symbols.length === 0 ? (
              <Unavailable reason={pick('Chưa nhận diện khai báo nào trong POU đang mở.', 'No declarations detected in the open POU.')} />
            ) : (
              <ReferencesPanel symbols={symbols} pick={pick} />
            )
          )}
          {(tab === 'watch' || tab === 'trace') && (
            /* AC: "unavailable tab giải thích capability". Hiện một danh sách
             * rỗng ở đây sẽ đọc như "không có giá trị nào", trong khi sự thật
             * là "chế độ EDIT không có nguồn giá trị runtime nào cả". */
            <Unavailable
              reason={pick(
                `${tab === 'watch' ? 'Watch' : 'Trace'} cần nguồn giá trị runtime. Chế độ EDIT chỉ có Draft, không có giá trị nào để hiện — chuyển sang LIVE khi capability đó sẵn sàng.`,
                `${tab === 'watch' ? 'Watch' : 'Trace'} needs a runtime value source. EDIT mode only has the Draft, so there is nothing to show — switch to LIVE once that capability ships.`,
              )}
            />
          )}
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
  checkOwnerHref,
  pick,
}: {
  problems: readonly WorkbenchProblem[]
  checkOwnerHref: string
  pick: (vi: string, en: string) => string
}) {
  return (
    <div className="space-y-2">
      {problems.length === 0 ? (
        <p className="text-xs text-[var(--c-text-dim)]">{pick('Draft không có vấn đề nào ở lớp cấu trúc.', 'No structural problems in the draft.')}</p>
      ) : (
        <ul className="space-y-1">
          {problems.map((problem) => (
            <li key={problem.id} className="text-xs">
              {problem.onJump && problem.jumpLabel ? (
                <button
                  type="button"
                  className="min-h-11 w-full rounded px-2 py-1 text-left text-[var(--c-warn-fg)] hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  onClick={problem.onJump}
                >
                  <span className="font-mono">{problem.code}</span> · {problem.jumpLabel}
                  <span className="block text-[var(--c-text-dim)]">{problem.detail}</span>
                </button>
              ) : (
                <p className="px-2 py-1 text-[var(--c-warn-fg)]">
                  <span className="font-mono">{problem.code}</span> · {pick('không neo vào vị trí nào', 'not anchored to a location')}
                  <span className="block text-[var(--c-text-dim)]">{problem.detail}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* D-01: PGM-02 KHÔNG sở hữu kết quả Check. Nói đích danh nơi sở hữu
        * thay vì để người dùng tưởng khay này đã là toàn bộ sự thật. */}
      <p className="border-t border-[var(--c-border)] pt-2 text-xs text-[var(--c-text-dim)]">
        {pick('Khay này chỉ hiện vấn đề cấu trúc của Draft. Kết quả Kiểm tra (diagnostic của compiler) thuộc trang ', 'This panel only shows structural draft problems. Check results (compiler diagnostics) live in ')}
        <a className="text-[var(--c-accent)] underline" href={checkOwnerHref}>{pick('Kiểm tra & Đưa vào vận hành', 'Check & Commission')}</a>.
      </p>
    </div>
  )
}

function SearchPanel({
  query,
  setQuery,
  hits,
  onJumpToOffset,
  queryLength,
  pick,
}: {
  query: string
  setQuery: (value: string) => void
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
      {query.trim().length > 0 && hits.length === 0 && (
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
        </li>
      ))}
    </ul>
  )
}
