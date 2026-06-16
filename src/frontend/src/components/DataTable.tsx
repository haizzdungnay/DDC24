import type { ReactNode } from 'react'
import { cn } from '../utils'
import { StateBlock } from './StateBlock'

export interface Column<T> {
  key: string
  header: string
  className?: string
  render: (row: T) => ReactNode
}

export function DataTable<T>({ rows, columns, getRowKey, loading, error, emptyText, className, onRowClick }: {
  rows: T[]
  columns: Array<Column<T>>
  getRowKey: (row: T) => string
  loading?: boolean
  error?: Error | null
  emptyText?: string
  className?: string
  onRowClick?: (row: T) => void
}) {
  if (loading) return <StateBlock state="loading" title="Đang tải dữ liệu" />
  if (error) return <StateBlock state="error" title="Không tải được dữ liệu" detail={error.message} />
  if (!rows.length) return <StateBlock state="empty" title={emptyText ?? 'Chưa có dữ liệu'} />

  return (
    <div className={cn('overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]', className)}>
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--c-surface-2)] text-[10px] uppercase text-[var(--c-text-dim)]">
            <tr>
              {columns.map((column) => <th key={column.key} className={cn('border-b border-[var(--c-border)] px-3 py-2 font-semibold', column.className)}>{column.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('border-b border-[rgba(36,48,73,0.62)] transition last:border-0', onRowClick && 'cursor-pointer hover:bg-[rgba(34,211,238,0.07)]')}
              >
                {columns.map((column) => <td key={column.key} className={cn('px-3 py-2 align-middle', column.className)}>{column.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
