import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingPointCatalogEntry } from '../../model/types'

export interface InsertVariableOption { name: string; type: string }

const QUALITY_DOT_CLASS: Record<ProgrammingPointCatalogEntry['quality'], string> = {
  GOOD: 'bg-[var(--c-good)]',
  UNCERTAIN: 'bg-[var(--c-warn)]',
  STALE: 'bg-[var(--c-warn)]',
  BAD: 'bg-[var(--c-fault)]',
  OFFLINE: 'bg-[var(--c-fault)]',
  UNKNOWN: 'bg-[var(--c-text-dim)]',
}

/**
 * Panel chèn nhanh Point & Variable — ST Editor Quick Control đề xuất #3 (đã
 * duyệt, quyết định #02). CHỈ chèn tên thô vào buffer local tại vị trí con
 * trỏ — không tạo Binding (việc ánh xạ Point↔Variable vẫn ở tab Điểm & Ánh
 * xạ), không tự Lưu. `pointCatalogStatus`/`pointCatalog`/`onEnsureLoaded` đến
 * từ `useLazyProgrammingPointCatalog` ở `ProgramsTab` (cha) — panel gọi
 * `onEnsureLoaded()` khi mở, hook tự quyết định có cần fetch hay dùng cache.
 */
export function InsertPointVariablePanel({
  variables,
  pointCatalogStatus,
  pointCatalogItems,
  pointCatalogError,
  onEnsureLoaded,
  onInsert,
  onClose,
  variant = 'popover',
}: {
  variables: readonly InsertVariableOption[]
  pointCatalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems: readonly ProgrammingPointCatalogEntry[]
  pointCatalogError: string | null
  onEnsureLoaded: () => void
  onInsert: (name: string, detail?: { dataType?: string; unit?: string }) => void
  onClose: () => void
  variant?: 'popover' | 'embedded'
}) {
  const { pick } = useI18n()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onEnsureLoaded()
    window.setTimeout(() => searchRef.current?.focus(), 0)
    // chỉ chạy đúng một lần khi panel mount (mở) — `onEnsureLoaded` tự
    // idempotent theo trạng thái cache, không cần liệt kê vào deps.
  }, [])

  const filteredVariables = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return variables
    return variables.filter((item) => item.name.toLocaleLowerCase().includes(needle))
  }, [variables, query])

  const filteredPoints = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return pointCatalogItems
    return pointCatalogItems.filter((item) => item.pointId.toLocaleLowerCase().includes(needle) || item.name.toLocaleLowerCase().includes(needle))
  }, [pointCatalogItems, query])

  return (
    <div
      role="dialog"
      aria-label={pick('Chèn nhanh Point/Variable', 'Insert point/variable')}
      className={`panel-shadow overflow-hidden rounded-[var(--radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)] ${
        variant === 'embedded' ? 'w-full' : 'absolute right-0 top-0 z-20 w-72'
      }`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}
    >
      <input
        ref={searchRef}
        className="mono w-full border-b border-[var(--c-border)] bg-transparent px-3 py-2 text-xs text-[var(--c-text)] outline-none"
        placeholder={pick('Tìm Point/Variable…', 'Find point/variable…')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-72 overflow-y-auto">
        <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{pick('Biến đã khai báo', 'Declared variables')}</p>
        {filteredVariables.length === 0 && <p className="px-3 pb-2 text-xs text-[var(--c-text-dim)]">{pick('Không có.', 'None.')}</p>}
        {filteredVariables.map((variable) => (
          <button
            key={variable.name}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-[var(--c-surface-2)]"
            onClick={() => onInsert(variable.name, { dataType: variable.type })}
          >
            <span className="mono flex-1 truncate text-[var(--c-text)]">{variable.name}</span>
            <span className="mono shrink-0 text-[var(--c-text-dim)]">{variable.type}</span>
          </button>
        ))}

        <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">Point</p>
        {pointCatalogStatus === 'loading' && <p className="px-3 pb-2 text-xs text-[var(--c-text-dim)]">{pick('Đang tải…', 'Loading…')}</p>}
        {pointCatalogStatus === 'error' && (
          <div className="px-3 pb-2 text-xs text-[var(--c-fault-fg)]">
            <p>{pointCatalogError}</p>
            <button
              type="button"
              className="mt-1 rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-0.5 text-xs text-[var(--c-text)] hover:bg-[var(--c-surface)]"
              onClick={onEnsureLoaded}
            >
              {pick('Thử lại', 'Retry')}
            </button>
          </div>
        )}
        {pointCatalogStatus === 'ready' && filteredPoints.length === 0 && <p className="px-3 pb-2 text-xs text-[var(--c-text-dim)]">{pick('Không có.', 'None.')}</p>}
        {pointCatalogStatus === 'ready' && filteredPoints.map((point) => (
          <button
            key={`${point.category}-${point.pointId}`}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-[var(--c-surface-2)]"
            onClick={() => onInsert(point.pointId, { dataType: point.dataType, unit: point.unit })}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${QUALITY_DOT_CLASS[point.quality]}`} aria-hidden="true" />
            <span className="mono shrink-0 rounded bg-[var(--c-surface-2)] px-1 text-[10px] text-[var(--c-text-dim)]">{point.category}</span>
            <span className="mono flex-1 truncate text-[var(--c-text)]">{point.pointId}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
