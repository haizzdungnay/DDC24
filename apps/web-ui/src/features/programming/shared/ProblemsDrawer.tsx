import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, GripHorizontal, Info, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../shared/i18n'
import { programmingErrorCopy } from '../api/errorCopy'
import type { ProgrammingDiagnostic } from '../model/types'
import { diagnosticFreshness, type OpenBufferContext, type StaleReason } from './diagnosticFreshness'

/** Câu giải thích VÌ SAO một diagnostic không còn nói về buffer đang mở.
 *
 * Mỗi lý do dẫn tới một hành động khác nhau của người dùng, nên chúng không
 * được gộp thành một câu chung: "buffer đã đổi" thì chạy lại Kiểm tra là đủ,
 * còn "thuộc revision khác" thì chạy lại cũng vô ích cho tới khi mở đúng
 * revision. Một nhãn "cũ" không nói lý do sẽ khiến người dùng thử sai cách. */
function staleCopy(
  pick: (vi: string, en: string) => string,
  reason: StaleReason,
  revisionId?: string
): string {
  switch (reason) {
    case 'SOURCE_CHANGED':
      return pick('buffer đã đổi sau Kiểm tra', 'buffer changed after the check')
    case 'REVISION_MISMATCH':
      return revisionId
        ? pick(`kết quả thuộc revision ${revisionId}`, `result belongs to revision ${revisionId}`)
        : pick('kết quả thuộc revision khác', 'result belongs to another revision')
    case 'POU_MISMATCH':
      return pick('kết quả thuộc POU khác', 'result belongs to another POU')
    case 'PROFILE_CHANGED':
      return pick('hồ sơ ngôn ngữ đã đổi', 'language profile changed')
  }
}

/**
 * `ProblemsDrawer` — khay Vấn đề của **PGM-05** (`Kiểm tra & Đưa vào vận hành`).
 * Diagnostic canonical đến từ `GET /checks/{checkId}`; đây chỉ hiển thị lại,
 * không tự tính lỗi. Nhiều lỗi không spam toast — luôn gom vào đây (UX §16.2).
 *
 * `ISS-STED-05` — docstring cũ viết *"dùng chung cho ba tab của PGM-02 và cho
 * PGM-05 (DDD-FE-PROG-001 §2)"* trong khi component này **chưa bao giờ** được
 * mount ở PGM-02: khay Vấn đề của PGM-02 là `ProgrammingWorkbench`
 * (`design/workbench/`), một component khác. Câu sai đó khiến người đọc tin
 * rằng PGM-02 đã có khay lỗi dùng chung, nên không ai đi tìm lý do POU ST
 * không hiện lỗi. Nay ghi đúng chỗ nó thật sự sống, và ghi luôn nơi khay của
 * PGM-02 nằm.
 */
export function ProblemsDrawer({
  diagnostics,
  onSelect,
  emptyState = 'no-problems',
  onEmptyAction,
  openBuffer,
  onRecheck
}: {
  diagnostics: ProgrammingDiagnostic[]
  onSelect?: (diagnostic: ProgrammingDiagnostic) => void
  /** Rỗng vì chưa có kết quả Check khác với Check đã chạy nhưng không có lỗi. */
  emptyState?: 'not-checked' | 'no-problems' | 'check-failed' | 'checking' | 'unknown'
  onEmptyAction?: () => void
  /** `ISS-STED-18` — bối cảnh buffer ĐANG MỞ, để khay biết diagnostic nào còn
   * nói về thứ người dùng đang nhìn. Vắng mặt thì mọi mục hiện như trước
   * (không nhãn), vì khi đó khay không có cơ sở nào để phán quyết. */
  openBuffer?: OpenBufferContext
  /** Chạy lại Kiểm tra. `ISS-STED-18` yêu cầu mục STALE phải có đường thoát,
   * không chỉ có nhãn. */
  onRecheck?: () => void
}) {
  const { pick } = useI18n()
  const hasStale =
    openBuffer !== undefined &&
    diagnostics.some((item) => diagnosticFreshness(item, openBuffer).freshness === 'STALE')
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('programming.problems.collapsed') === 'true')
  const [panelHeight, setPanelHeight] = useState(() => {
    const stored = Number(localStorage.getItem('programming.problems.height'))
    return Number.isFinite(stored) && stored >= 160 && stored <= 320 ? stored : 160
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) return
      const next = clampPanelHeight(resizeRef.current.startHeight - (event.clientY - resizeRef.current.startY))
      setPanelHeight(next)
    }
    const stopResize = () => {
      if (!resizeRef.current) return
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('programming.problems.height', String(panelHeight))
  }, [panelHeight])

  useEffect(() => {
    localStorage.setItem('programming.problems.collapsed', String(collapsed))
  }, [collapsed])
  const emptyCopy = problemsEmptyCopy(pick, emptyState)
  const content = diagnostics.length === 0 ? (
    <div role="status" className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-info)]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--c-text)]">{emptyCopy.title}</p>
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">{emptyCopy.detail}</p>
          {onEmptyAction && emptyState !== 'no-problems' && (
            <button type="button" className="mt-3 min-h-10 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-3 py-2 text-xs font-semibold text-[var(--c-accent)] hover:brightness-95" onClick={onEmptyAction}>
              {pick('Mở Kiểm tra', 'Open Check')}
            </button>
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)]" role="region" aria-label={pick('Danh sách lỗi', 'Problems list')}>
      {hasStale && onRecheck ? (
        /* `ISS-STED-18` — mục CŨ phải có ĐƯỜNG THOÁT, không chỉ có nhãn: người
         * dùng thấy "cũ" mà không có cách làm nó mới lại thì nhãn chỉ là lời
         * than phiền. */
        <div className="flex items-center justify-between gap-2 border-b border-[var(--c-border)] px-3 py-2 text-xs">
          <span className="text-[var(--c-warn-fg)]">
            {pick(
              'Một số lỗi không còn khớp nội dung đang mở.',
              'Some problems no longer match the open content.'
            )}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 font-semibold hover:bg-[var(--c-surface-2)]"
            onClick={onRecheck}
          >
            {pick('Chạy lại Kiểm tra', 'Run check again')}
          </button>
        </div>
      ) : null}
      <ul className="divide-y divide-[var(--c-border)]">
        {diagnostics.map((diagnostic, index) => {
          const Icon = diagnostic.severity === 'ERROR' ? AlertCircle : diagnostic.severity === 'WARNING' ? AlertTriangle : Info
          const iconClass = diagnostic.severity === 'ERROR' ? 'text-[var(--c-fault-fg)]' : diagnostic.severity === 'WARNING' ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-info)]'
          /* ISS-STED-02 — severity phải tới cả người KHÔNG nhìn thấy màu.
           *
           * Icon mang `aria-hidden`, nên severity chỉ tồn tại dưới dạng hình
           * dạng + màu. Điều đó vô hại khi mọi diagnostic đều là ERROR — không
           * có gì để phân biệt. Từ lúc kênh WARNING mang dữ liệu thật, "lỗi" và
           * "cảnh báo" là hai hành động khác nhau của người dùng: một cái chặn
           * phát hành, một cái không. Sự khác biệt ấy không được phép chỉ nằm
           * ở màu. */
          /* `ISS-STED-18` — mục CŨ không được gạch như lỗi hiện tại, và cũng
           * không được biến mất im lặng: ẩn nó đi làm người dùng tưởng lỗi đã
           * hết. Nó ở lại danh sách, mang nhãn nói rõ VÌ SAO cũ. */
          const freshness = openBuffer ? diagnosticFreshness(diagnostic, openBuffer) : undefined
          const staleReason = freshness?.freshness === 'STALE' ? freshness.reason : undefined
          const staleText = staleReason ? staleCopy(pick, staleReason, freshness?.diagnosticRevisionId) : ''
          const severityLabel = diagnostic.severity === 'ERROR'
            ? pick('Lỗi', 'Error')
            : diagnostic.severity === 'WARNING'
              ? pick('Cảnh báo', 'Warning')
              : pick('Thông tin', 'Info')
          const location = diagnostic.location
          const locationText = location
            ? [
              location.programId && pick(`chương trình ${String(location.programId).slice(0, 8)}`, `program ${String(location.programId).slice(0, 8)}`),
              location.line !== undefined && pick(`dòng ${location.line}`, `line ${location.line}`),
              location.column !== undefined && pick(`cột ${location.column}`, `col ${location.column}`),
              location.bindingId && pick(`biến ${location.bindingId}`, `variable ${location.bindingId}`)
            ].filter(Boolean).join(' · ')
            : undefined
          const codeText = [diagnostic.code, diagnostic.detailCode].filter(Boolean).join(' · ')
          const messageText = diagnostic.message || programmingErrorCopy(pick, diagnostic.detailCode ?? diagnostic.code)
          return (
            <li key={`${diagnostic.code}-${index}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-2)] focus-visible:bg-[var(--c-surface-2)]"
                onClick={() => onSelect?.(diagnostic)}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
                <span>
                  <span className="sr-only">{severityLabel}: </span>
                  {staleReason ? (
                    <span
                      className="mb-0.5 inline-block rounded-[var(--radius)] border border-[var(--c-warn-fg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-warn-fg)]"
                      title={staleText}
                    >
                      {pick('CŨ', 'STALE')} · {staleText}
                    </span>
                  ) : null}
                  <span className="block font-mono text-xs text-[var(--c-text-dim)]">{codeText}{locationText ? ` · ${locationText}` : ''}</span>
                  <span className="block text-[var(--c-text)]">{messageText}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
  return (
    <section className="mt-4 border-t border-[var(--c-line-strong)] bg-[var(--c-surface)] pt-2" aria-label={pick('Khay vấn đề', 'Problems tray')}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
          {pick('Vấn đề', 'Problems')}
          <span className="ml-1 rounded-full bg-[var(--c-fault-bg)] px-1.5 py-0.5 text-[var(--c-fault-fg)]">
            {diagnostics.length > 0 ? diagnostics.length : emptyCopy.badge}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hidden min-h-9 items-center gap-1 rounded border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text)] hover:bg-[var(--c-surface-2)] min-[1280px]:flex"
            aria-controls="programming-problems-panel"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            {collapsed ? pick('Mở rộng', 'Expand') : pick('Thu gọn', 'Collapse')}
          </button>
          <button ref={triggerRef} type="button" className="min-h-10 rounded border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text)] hover:bg-[var(--c-surface-2)] min-[1280px]:hidden" onClick={() => setOpen(true)} aria-expanded={open}>
            {pick('Mở khay', 'Open tray')}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div
          role="separator"
          aria-label={pick('Đổi chiều cao khay vấn đề', 'Resize problems tray')}
          aria-orientation="horizontal"
          aria-valuemin={160}
          aria-valuemax={320}
          aria-valuenow={panelHeight}
          tabIndex={0}
          className="mt-2 hidden h-3 cursor-row-resize items-center justify-center border-y border-[var(--c-border)] text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] min-[1280px]:flex"
          onPointerDown={(event) => {
            resizeRef.current = { startY: event.clientY, startHeight: panelHeight }
            document.body.style.cursor = 'row-resize'
            document.body.style.userSelect = 'none'
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            setPanelHeight((current) => clampPanelHeight(current + (event.key === 'ArrowUp' ? 16 : -16)))
          }}
        >
          <GripHorizontal className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
      <div
        id="programming-problems-panel"
        className={`mt-2 hidden overflow-auto min-[1280px]:block ${collapsed ? 'h-0' : ''}`}
        style={collapsed ? undefined : { height: panelHeight }}
        hidden={collapsed}
      >
        {content}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 min-[1280px]:hidden" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label={pick('Đóng khay vấn đề', 'Close problems tray')} onClick={() => { setOpen(false); triggerRef.current?.focus() }} />
          <div ref={panelRef} role="dialog" aria-modal="true" aria-label={pick('Danh sách lỗi', 'Problems list')} tabIndex={-1} onKeyDown={(event) => {
            if (event.key !== 'Tab' || !panelRef.current) return
            const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled])')]
            if (focusable.length === 0) { event.preventDefault(); panelRef.current.focus(); return }
            const first = focusable[0]; const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
          }} className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-auto rounded-t-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between"><h4 className="font-semibold text-[var(--c-text)]">{pick('Vấn đề', 'Problems')}</h4><button type="button" className="min-h-10 min-w-10 rounded p-2" aria-label={pick('Đóng', 'Close')} onClick={() => { setOpen(false); triggerRef.current?.focus() }}><X className="h-4 w-4" aria-hidden="true" /></button></div>
            {content}
          </div>
        </div>
      )}
    </section>
  )
}

function problemsEmptyCopy(
  pick: (vi: string, en: string) => string,
  state: 'not-checked' | 'no-problems' | 'check-failed' | 'checking' | 'unknown',
): { badge: string | number; title: string; detail: string } {
  if (state === 'no-problems') {
    return {
      badge: 0,
      title: pick('Check gần nhất đã đạt, không có lỗi.', 'The latest Check passed with no problems.'),
      detail: pick('Kết quả này thuộc đúng bản Draft hiện hành.', 'This result belongs to the current Draft revision.'),
    }
  }
  if (state === 'check-failed') {
    return {
      badge: pick('Không đạt', 'Failed'),
      title: pick('Check gần nhất không đạt.', 'The latest Check failed.'),
      detail: pick('Mở Kiểm tra để xem danh sách diagnostic canonical.', 'Open Check to view the canonical diagnostics.'),
    }
  }
  if (state === 'checking') {
    return {
      badge: pick('Đang kiểm tra', 'Checking'),
      title: pick('Check đang được xử lý.', 'Check is in progress.'),
      detail: pick('Mở Kiểm tra để theo dõi trạng thái và kết quả.', 'Open Check to follow its state and result.'),
    }
  }
  if (state === 'unknown') {
    return {
      badge: 'UNKNOWN',
      title: pick('Chưa xác minh được kết quả Check.', 'The Check result could not be verified.'),
      detail: pick('Mở Kiểm tra để đọc lại nguồn canonical; UI không suy diễn kết quả.', 'Open Check to read the canonical source; the UI does not infer a result.'),
    }
  }
  return {
    badge: pick('Chưa kiểm tra', 'Not checked'),
    title: pick('Chưa có kết quả Check cho bản Draft này.', 'No Check result exists for this Draft revision.'),
    detail: pick('Lưu Draft rồi chạy Kiểm tra để tạo danh sách vấn đề chính thức.', 'Save the draft, then run Check to create the canonical problems list.'),
  }
}

function clampPanelHeight(value: number): number {
  return Math.min(320, Math.max(160, Math.round(value)))
}
