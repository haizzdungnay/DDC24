import { X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useI18n } from '../../../shared/i18n'

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** Drawer ngữ cảnh dưới 1024 px: khóa scroll nền, trap focus, Escape và trả
 * focus về đúng trigger. Đây chỉ là bề mặt đọc, không chứa mutation. */
export function ProgrammingContextDrawer({
  open,
  returnFocusRef,
  onClose,
  children
}: {
  open: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  children: ReactNode
}) {
  const { pick } = useI18n()
  const drawerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstFocusable(drawerRef.current)?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [open, returnFocusRef])

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return
    const focusable = focusableElements(drawerRef.current)
    if (!focusable.length) {
      event.preventDefault()
      drawerRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(0,0,0,0.62)]" role="presentation" onMouseDown={onClose}>
      <aside
        id="programming-context-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="programming-context-drawer-title"
        tabIndex={-1}
        className="panel-shadow h-full w-[min(30rem,100vw)] overflow-y-auto border-l border-[var(--c-border)] bg-[var(--c-surface)] p-5"
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="programming-context-drawer-title" className="text-lg font-semibold">
            {pick('Ngữ cảnh Lập trình', 'Programming context')}
          </h2>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-[var(--radius)] text-[var(--c-text-dim)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-text)]"
            onClick={onClose}
            aria-label={pick('Đóng ngữ cảnh Lập trình', 'Close Programming context')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </aside>
    </div>
  )
}

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

function firstFocusable(container: HTMLElement | null): HTMLElement | undefined {
  return focusableElements(container)[0]
}
