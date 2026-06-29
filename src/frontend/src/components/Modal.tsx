import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import { cn } from '../utils'
import { Button } from './Button'

const sizeClass = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl'
}

export function Modal({ open, title, children, confirmLabel, cancelLabel, danger, size = 'md', onConfirm, onClose }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  size?: keyof typeof sizeClass
  onConfirm?: () => void
  onClose: () => void
}) {
  const { t, pick } = useI18n()
  const confirmText = confirmLabel ?? t('confirm')
  const cancelText = cancelLabel ?? t('cancel')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.62)] p-4" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn('panel-shadow w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5', sizeClass[size])}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button className="rounded-[var(--radius)] p-1 text-[var(--c-text-dim)] hover:bg-[rgba(42,92,138,0.08)] hover:text-[var(--c-text)]" onClick={onClose} aria-label={pick('Đóng', 'Close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 text-sm text-[var(--c-text-dim)]">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
          {onConfirm && <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmText}</Button>}
        </div>
      </section>
    </div>
  )
}
