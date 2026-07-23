import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  loading?: boolean
}

const variantClass = {
  primary: 'bg-[var(--c-accent)] text-white border-[var(--c-accent)] hover:brightness-105',
  secondary: 'bg-[var(--c-surface-2)] text-[var(--c-text)] border-[var(--c-border)] hover:border-[var(--c-accent)]',
  danger: 'bg-[rgba(229,72,77,0.16)] text-[var(--c-fault-fg)] border-[rgba(229,72,77,0.42)] hover:bg-[rgba(229,72,77,0.24)]',
  ghost: 'bg-transparent text-[var(--c-text-dim)] border-transparent hover:text-[var(--c-text)] hover:bg-[rgba(42,92,138,0.08)]'
}

const sizeClass = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn('inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border font-medium transition disabled:cursor-not-allowed disabled:opacity-50', variantClass[variant], sizeClass[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
})
