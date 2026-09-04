import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import { cn } from '../utils'
import { Button } from './Button'
import { trapTabKey } from './focusTrap'

const sizeClass = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl'
}

const responsiveSizeClass = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl'
}

export function Modal({ open, title, children, descriptionId, confirmLabel, cancelLabel, danger, size = 'md', mobileFullscreen = false, returnFocusRef, confirmLoading, confirmDisabled, onConfirm, onClose }: {
  open: boolean
  title: string
  children: ReactNode
  descriptionId?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  size?: keyof typeof sizeClass
  /** Safety workflows need the full mobile viewport so impact and re-auth are
      not squeezed into a small floating card. Desktop keeps the normal dialog. */
  mobileFullscreen?: boolean
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
  }, [onClose, open])

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    trapTabKey(event, dialogRef.current)
  }

  if (!open) return null
  return (
    <div className={cn('fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.62)]', mobileFullscreen ? 'p-0 sm:p-4' : 'p-4')} role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          'panel-shadow w-full border border-[var(--c-border)] bg-[var(--c-surface)] p-5',
          mobileFullscreen
            ? 'flex h-dvh max-h-dvh max-w-none flex-col rounded-none border-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-[var(--radius)] sm:border'
            : 'rounded-[var(--radius)]',
          mobileFullscreen ? responsiveSizeClass[size] : sizeClass[size]
        )}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="modal-title" data-modal-initial-focus tabIndex={-1} className="text-lg font-semibold">{title}</h2>
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--c-text-dim)] hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-text)]" onClick={onClose} aria-label={pick('Đóng', 'Close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={cn('mt-4 text-sm text-[var(--c-text-dim)]', mobileFullscreen && 'min-h-0 flex-1 overflow-y-auto')}>{children}</div>
        <div className={cn('mt-6 flex justify-end gap-2', mobileFullscreen && 'border-t border-[var(--c-border)] pt-4')}>
          <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
          {onConfirm && <Button variant={danger ? 'danger' : 'primary'} loading={confirmLoading} disabled={confirmDisabled} onClick={onConfirm}>{confirmText}</Button>}
        </div>
      </section>
    </div>
  )
}
