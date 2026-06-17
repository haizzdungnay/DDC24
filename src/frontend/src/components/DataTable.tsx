import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
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
  const { pick } = useI18n()
  if (loading) return <StateBlock state="loading" title={pick('Đang tải dữ liệu', 'Loading data')} />
  if (error) return <StateBlock state="error" title={pick('Không tải được dữ liệu', 'Could not load data')} detail={error.message} />
  if (!rows.length) return <StateBlock state="empty" title={emptyText ?? pick('Chưa có dữ liệu', 'No data')} />

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
                className={cn('border-b border-[var(--c-border)] transition last:border-0', onRowClick && 'cursor-pointer hover:bg-[rgba(42,92,138,0.08)]')}
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
