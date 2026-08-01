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
  primary: 'bg-[var(--c-accent)] text-[var(--c-on-accent)] border-[var(--c-accent)] hover:brightness-105',
  secondary: 'bg-[var(--c-surface-2)] text-[var(--c-text)] border-[var(--c-border)] hover:border-[var(--c-accent)]',
  danger: 'bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)] border-[var(--c-fault)] hover:bg-[var(--c-fault-bg)]',
  ghost: 'bg-transparent text-[var(--c-text-dim)] border-transparent hover:text-[var(--c-text)] hover:bg-[var(--c-accent-bg)]'
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
