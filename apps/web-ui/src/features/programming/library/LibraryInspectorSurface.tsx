import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Panel } from '../../../shared/components/Panel'
import { trapTabKey } from '../../../shared/components/focusTrap'
import { useI18n } from '../../../shared/i18n'
import type { ProgrammingInspectorMode } from '../layout/useProgrammingViewport'

/**
 * `T61-304` — VỎ của Inspector PGM-04: cắm, khay, hay toàn màn.
 *
 * Vì sao không làm bằng CSS thuần (`SPEC-PGM04-VISUAL-001` §1, và đúng mục
 * "Không được đóng khi" của `ISS-PGM04-09`):
 *
 * - Bản trước là một `<Panel>` trong lưới CSS: từ `lg` trở lên nó dính bên
 *   phải, dưới đó nó **xếp xuống dưới danh sách**. Ở khổ tablet, người dùng
 *   chọn một khối rồi phải cuộn qua hết lưới thẻ mới thấy chi tiết — và không
 *   có gì nói cho họ biết là phải cuộn.
 * - `role="dialog"`, `aria-modal`, bẫy tiêu điểm và `Esc` chỉ đúng ở hai hình
 *   thái PHỦ. Bật chúng ở khay cắm là nhốt người dùng bàn phím vào một vùng họ
 *   chưa từng "mở", và `Esc` sẽ đóng một thứ không đóng được. Đó là lý do hình
 *   thái là policy runtime chứ không phải một lớp Tailwind.
 *
 * Trả tiêu điểm là phần đắt nhất: đóng khay mà không trả tiêu điểm thì tiêu
 * điểm rơi về `<body>`, và người dùng bàn phím phải `Tab` lại từ đầu trang để
 * quay về đúng thẻ họ vừa mở.
 */
export function LibraryInspectorSurface({
  mode,
  open,
  title,
  onClose,
  children,
}: {
  mode: ProgrammingInspectorMode
  /** Có khối đang chọn không. Ở hình thái phủ, `false` ⇒ không vẽ gì. */
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const { pick } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const overlay = mode !== 'dock'

  useEffect(() => {
    if (!overlay || !open) return undefined
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
      dialog.querySelector<HTMLElement>('[data-modal-initial-focus]')?.focus()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [overlay, open, onClose])

  if (!overlay) {
    /* CẮM: một vùng của trang, không phải hộp thoại. Không `role="dialog"`,
       không bẫy tiêu điểm, không `Esc` — xem chú thích đầu tệp. */
    return (
      <Panel className="min-w-0 lg:sticky lg:top-4 lg:self-start" title={title}>
        {children}
      </Panel>
    )
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 bg-[rgba(0,0,0,0.62)]"
      role="presentation"
      data-testid="library-inspector-backdrop"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-inspector-title"
        tabIndex={-1}
        data-testid="library-inspector-drawer"
        data-mode={mode}
        /* Khay phủ TỪ PHẢI ở tablet; TOÀN MÀN dưới 768 px. Hai hình thái khác
           nhau về hình dạng, không khác nhau về ngữ nghĩa — cả hai đều là hộp
           thoại, nên cả hai cùng bẫy tiêu điểm và cùng đóng bằng `Esc`. */
        className={`absolute right-0 top-0 flex h-dvh flex-col border-l border-[var(--c-border)] bg-[var(--c-surface)] ${
          mode === 'fullscreen' ? 'w-full border-l-0' : 'w-[22rem] max-w-full'
        }`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => trapTabKey(event, dialogRef.current)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--c-border)] px-4 py-3">
          <h2
            id="library-inspector-title"
            data-modal-initial-focus
            tabIndex={-1}
            className="text-sm font-semibold text-[var(--c-text)]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={pick('Đóng khay chi tiết', 'Close the detail panel')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--c-text-dim)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </section>
    </div>
  )
}
