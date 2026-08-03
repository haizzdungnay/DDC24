import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import { cn } from '../utils'
import { Button } from './Button'

const sizeClass = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl'
}

export function Modal({ open, title, children, confirmLabel, cancelLabel, danger, size = 'md', returnFocusRef, confirmLoading, confirmDisabled, onConfirm, onClose }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  size?: keyof typeof sizeClass
  returnFocusRef?: RefObject<HTMLElement | null>
  /* Hộp thoại xác nhận cho hành động tác động vật lý (WEB-UX-004) và cho đổi mật
     khẩu (WEB-UX-003) đều gọi API. Không có trạng thái chờ ở nút xác nhận thì
     người dùng bấm hai lần vì tưởng lần đầu trượt — với lệnh ghi ra AO/DO, lần
     bấm thứ hai là một lệnh ghi thật nữa. */
  confirmLoading?: boolean
  confirmDisabled?: boolean
  onConfirm?: () => void
  onClose: () => void
}) {
  const { t, pick } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const confirmText = confirmLabel ?? t('confirm')
  const cancelText = cancelLabel ?? t('cancel')

  useEffect(() => {
    const rememberOutsideFocus = (event: Event) => {
      const target = event.target
      if (target instanceof HTMLElement && !dialogRef.current?.contains(target)) lastOutsideFocusRef.current = target
    }
    document.addEventListener('focusin', rememberOutsideFocus)
    document.addEventListener('pointerdown', rememberOutsideFocus, true)
    return () => {
      document.removeEventListener('focusin', rememberOutsideFocus)
      document.removeEventListener('pointerdown', rememberOutsideFocus, true)
    }
  }, [])

  useEffect(() => {
    if (wasOpenRef.current && !open) (returnFocusRef?.current ?? lastOutsideFocusRef.current)?.focus()
    wasOpenRef.current = open
  }, [open, returnFocusRef])

  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !dialog.contains(active)) firstFocusable(dialog)?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = focusableElements(dialog)
    if (!focusable.length) {
      event.preventDefault()
      dialog.focus()
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.62)] p-4" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={cn('panel-shadow w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5', sizeClass[size])}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button className="rounded-[var(--radius)] p-1 text-[var(--c-text-dim)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-text)]" onClick={onClose} aria-label={pick('Đóng', 'Close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 text-sm text-[var(--c-text-dim)]">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
          {onConfirm && <Button variant={danger ? 'danger' : 'primary'} loading={confirmLoading} disabled={confirmDisabled} onClick={onConfirm}>{confirmText}</Button>}
        </div>
      </section>
    </div>
  )
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

function firstFocusable(dialog: HTMLElement): HTMLElement | undefined {
  return focusableElements(dialog)[0]
}
