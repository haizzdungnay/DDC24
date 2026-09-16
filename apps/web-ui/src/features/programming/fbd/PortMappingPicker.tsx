/**
 * Panel chọn điểm để ánh xạ trực tiếp từ context menu cổng FBD.
 *
 * Hiện như dialog nổi giữa màn hình, có ô tìm kiếm và bộ lọc category.
 * Chọn point → caller gọi preview + upsertBinding.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import type { ProgrammingPointCatalogEntry } from '../model/types'

export interface PortMappingPickerProps {
  portDirection: 'INPUT' | 'OUTPUT'
  portDataType: string
  portName: string
  nodeName: string
  points: readonly ProgrammingPointCatalogEntry[]
  loading?: boolean
  onSelect: (point: ProgrammingPointCatalogEntry) => void
  onClose: () => void
}

type CategoryFilter = '' | 'LOCAL' | 'VP' | 'MB_RTU'

function matchesDirection(point: ProgrammingPointCatalogEntry, portDir: 'INPUT' | 'OUTPUT'): boolean {
  if (portDir === 'INPUT') {
    if (point.mapping?.input) return point.mapping.input.status === 'SUPPORTED'
    return point.direction === 'READ' || point.direction === 'READ_WRITE'
  }
  if (point.mapping?.output) return point.mapping.output.status === 'SUPPORTED'
  return point.direction === 'WRITE' || point.direction === 'READ_WRITE'
}

export function PortMappingPicker({
  portDirection,
  portDataType,
  portName,
  nodeName,
  points,
  loading,
  onSelect,
  onClose,
}: PortMappingPickerProps) {
  const { pick } = useI18n()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('')
  const [focusIndex, setFocusIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const needle = query.toLowerCase()
    return points.filter((p) => {
      if (!matchesDirection(p, portDirection)) return false
      if (category && p.category !== category) return false
      if (needle) {
        const haystack = [p.name, p.displayId, p.pointId, p.equipment, p.description]
          .filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [points, portDirection, category, query])

  useEffect(() => { setFocusIndex(0) }, [filtered.length, query, category])
  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex((i) => Math.min(filtered.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex((i) => Math.max(0, i - 1)) }
    if (e.key === 'Enter' && filtered[focusIndex]) { e.preventDefault(); onSelect(filtered[focusIndex]) }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${focusIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  const categories: { value: CategoryFilter; label: string }[] = [
    { value: '', label: pick('Tất cả', 'All') },
    { value: 'LOCAL', label: 'I/O' },
    { value: 'VP', label: 'VP' },
    { value: 'MB_RTU', label: 'Modbus' },
  ]

  const dirLabel = portDirection === 'INPUT' ? pick('Đầu vào', 'Input') : pick('Đầu ra', 'Output')

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        role="dialog"
        aria-label={pick('Chọn điểm ánh xạ', 'Select mapping point')}
        className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--c-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--c-text)]">
              {pick('Ánh xạ điểm', 'Map Point')}
            </h2>
            <p className="text-xs text-[var(--c-text-dim)]">
              {nodeName} · {portName} ({portDataType}) · {dirLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{pick('Đóng', 'Close')}</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative border-b border-[var(--c-border)] px-4 py-2">
          <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--c-text-dim)]" aria-hidden="true" />
          <input
            ref={searchRef}
            className="w-full rounded border border-[var(--c-border)] bg-transparent py-1.5 pl-8 pr-2 text-xs text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
            placeholder={pick('Tìm điểm…', 'Find point…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Category chips */}
        <div className="flex gap-1 border-b border-[var(--c-border)] px-4 py-1.5">
          {categories.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                category === c.value
                  ? 'bg-[var(--c-accent)] text-white'
                  : 'bg-[var(--c-surface-2,var(--c-surface))] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <p className="px-4 py-8 text-center text-xs text-[var(--c-text-dim)]">
              {pick('Đang tải danh mục điểm…', 'Loading point catalog…')}
            </p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-[var(--c-text-dim)]">
              {pick('Không tìm thấy điểm phù hợp.', 'No compatible points found.')}
            </p>
          )}
          {filtered.map((point, i) => (
            <button
              key={point.pointId + (point.deviceId ?? '')}
              type="button"
              data-index={i}
              className={`flex w-full items-start gap-3 px-4 py-2 text-left text-xs transition ${
                i === focusIndex
                  ? 'bg-[var(--c-accent-bg,rgba(59,130,246,0.1))] text-[var(--c-text)]'
                  : 'text-[var(--c-text)] hover:bg-[var(--c-surface-2,var(--c-surface))]'
              }`}
              onClick={() => onSelect(point)}
              onMouseEnter={() => setFocusIndex(i)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{point.displayId ?? point.pointId}</span>
                  <span className="rounded-full bg-[var(--c-surface-2,var(--c-surface))] px-1.5 py-0.5 text-[10px] text-[var(--c-text-dim)]">{point.category}</span>
                  <span className="rounded-full bg-[var(--c-surface-2,var(--c-surface))] px-1.5 py-0.5 text-[10px] text-[var(--c-text-dim)]">{point.direction}</span>
                </div>
                <p className="mt-0.5 text-[var(--c-text-dim)]">
                  {point.name}
                  {point.unit ? ` · ${point.unit}` : ''}
                  {point.equipment ? ` · ${point.equipment}` : ''}
                </p>
                {point.sourceDetail && (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--c-text-dim)]">{point.sourceDetail}</p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[var(--c-text-dim)]">{point.dataType}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--c-border)] px-4 py-2 text-xs text-[var(--c-text-dim)]">
          <span>{filtered.length} {pick('điểm phù hợp', 'compatible points')}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          >
            {pick('Hủy', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

