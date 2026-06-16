import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type React from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '../utils'

type ToastKind = 'success' | 'error' | 'warn' | 'info'
interface ToastItem { id: number; kind: ToastKind; message: string }
interface ToastContextValue { push: (kind: ToastKind, message: string) => void }
const ToastContext = createContext<ToastContextValue | null>(null)

const color = { success: 'text-[var(--c-good)]', error: 'text-[var(--c-fault)]', warn: 'text-[var(--c-warn)]', info: 'text-[var(--c-info)]' }
const icon = { success: CheckCircle2, error: XCircle, warn: AlertTriangle, info: Info }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random()
    setItems((current) => [...current, { id, kind, message }])
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3600)
  }, [])
  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
        {items.map((item) => {
          const Icon = icon[item.kind]
          return (
            <div key={item.id} className="panel-shadow flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm">
              <Icon className={cn('mt-0.5 h-4 w-4', color[item.kind])} aria-hidden="true" />
              <span>{item.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
