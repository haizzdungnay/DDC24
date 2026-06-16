import type { ReactNode } from 'react'
import { cn } from '../utils'

export function Panel({ title, subtitle, action, children, className }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('panel-shadow rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(17,26,43,0.86)] p-4', className)}>
      {(title || subtitle || action) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-[var(--c-text)]">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-[var(--c-text-dim)]">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
