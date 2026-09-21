import { useEffect, useMemo, useState } from 'react'
import { Filter, Search, X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'

export type StRuntimeQuality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'OFFLINE' | 'UNKNOWN' | 'UNAVAILABLE'
export type StRuntimeFreshness = 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'SIMULATION'

/**
 * Dữ liệu đã được BE/Core gắn quality/freshness. FE chỉ trình bày và tuyệt đối
 * không suy ra policy điều khiển từ các nhãn này.
 */
export interface StRuntimeOverlayItem {
  variableId: string
  variableName: string
  value: unknown
  /** `false` là authority nói ô raw không hợp lệ; dù raw bit là 0 cũng phải ẩn. */
  valid: boolean
  unit?: string
  quality: StRuntimeQuality
  freshness: StRuntimeFreshness
  observedAt?: string
}

export type StRuntimeOverlayState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason?: string }
  | {
      status: 'ready'
      items: readonly StRuntimeOverlayItem[]
      /**
       * `T59-810` — Core đã khởi động lại giữa hai snapshot (mốc monotonic
       * lùi). Giá trị trước và sau một lần restart KHÔNG thuộc cùng một mạch:
       * bộ đếm, trạng thái FB và LKG đều có thể đã khác. Nối tiếp im lặng là
       * nói dối về tính liên tục, nên phải nói ra.
       */
      producerRestarted?: boolean
    }

export interface StRuntimePresentation {
  displayValue: string
  state: 'live' | 'uncertain' | 'stale' | 'invalid'
}

function scalarDisplay(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * Một giá trị chỉ được vẽ khi authority đánh dấu valid, còn dữ liệu và không ở
 * quality/freshness mất hiệu lực. STALE được phép giữ last-known value nhưng có
 * nhãn chữ rõ; BAD/OFFLINE/UNKNOWN/UNAVAILABLE luôn là `—`, không bao giờ thành 0.
 */
export function presentStRuntimeValue(item: StRuntimeOverlayItem): StRuntimePresentation {
  const displayValue = scalarDisplay(item.value)
  const invalid = !item.valid || displayValue === null || item.freshness === 'UNAVAILABLE' ||
    item.quality === 'BAD' || item.quality === 'OFFLINE' || item.quality === 'UNKNOWN' ||
    item.quality === 'UNAVAILABLE'
  if (invalid) return { displayValue: '—', state: 'invalid' }
  if (item.freshness === 'STALE' || item.quality === 'STALE') return { displayValue, state: 'stale' }
  if (item.quality === 'UNCERTAIN') return { displayValue, state: 'uncertain' }
  return { displayValue, state: 'live' }
}

const STATE_CLASS: Record<StRuntimePresentation['state'], string> = {
  live: 'border-[var(--c-good-fg)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]',
  uncertain: 'border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]',
  stale: 'border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]',
  invalid: 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]',
}

function readHiddenFromStorage(storageKey: string): readonly string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return []
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeHiddenToStorage(storageKey: string, hidden: readonly string[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (hidden.length === 0) {
      window.localStorage.removeItem(storageKey)
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(hidden))
    }
  } catch {
    // Không ghi được (quota hoặc môi trường hạn chế), tiếp tục im lặng.
  }
}

export function StRuntimeValueOverlay({
  state,
  programId,
  title,
  mode = 'LIVE',
}: {
  state: StRuntimeOverlayState
  programId?: string
  title?: string
  mode?: 'LIVE' | 'SIMULATION'
}) {
  const { pick } = useI18n()
  const storageKey = mode === 'LIVE'
    ? `mkddc.programming.runtimeOverlay.hidden.${programId ?? 'global'}`
    : `mkddc.programming.runtimeOverlay.hidden.sim.${programId ?? 'global'}`
  const [hiddenNames, setHiddenNames] = useState<readonly string[]>(() => readHiddenFromStorage(storageKey))
  const [query, setQuery] = useState('')
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  useEffect(() => {
    setHiddenNames(readHiddenFromStorage(storageKey))
  }, [storageKey])

  const updateHiddenNames = (next: readonly string[] | ((prev: readonly string[]) => readonly string[])) => {
    setHiddenNames((prev) => {
      const computed = typeof next === 'function' ? next(prev) : next
      writeHiddenToStorage(storageKey, computed)
      return computed
    })
  }

  const items = state.status === 'ready' ? state.items : []
  const totalCount = items.length

  const filteredItems = useMemo(() => {
    if (items.length === 0) return []
    const trimmed = query.trim().toLowerCase()
    return items.filter((item) => {
      if (hiddenNames.includes(item.variableName)) return false
      if (trimmed && !item.variableName.toLowerCase().includes(trimmed)) return false
      return true
    })
  }, [items, hiddenNames, query])

  const selectedCount = useMemo(() => {
    return items.filter((item) => !hiddenNames.includes(item.variableName)).length
  }, [items, hiddenNames])

  const pickerItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return items
    return items.filter((item) => item.variableName.toLowerCase().includes(trimmed))
  }, [items, query])

  return (
    <section
      aria-label={mode === 'SIMULATION'
        ? pick('Lớp giá trị mô phỏng', 'Simulation value layer')
        : pick('Lớp giá trị runtime ST', 'ST runtime value overlay')}
      className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
            {title ?? (mode === 'SIMULATION' ? pick('Giá trị quan sát', 'Observations') : pick('Giá trị runtime', 'Runtime values'))}
          </h4>
          {state.status === 'ready' && items.length > 0 && (
            <span
              className="rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[11px] font-mono text-[var(--c-text-dim)]"
              data-testid="runtime-overlay-count"
            >
              {selectedCount === totalCount ? `${totalCount}` : `${selectedCount}/${totalCount}`}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {state.status === 'ready' && items.length > 0 && (
            <>
              {/* Ô tìm kiếm nhanh */}
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--c-text-dim)]" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={pick('Tìm biến…', 'Search variable…')}
                  aria-label={pick('Tìm kiếm biến runtime', 'Search runtime variables')}
                  className="h-6 w-28 rounded border border-[var(--c-border)] bg-[var(--c-bg)] pl-7 pr-6 text-xs text-[var(--c-text)] placeholder:text-[var(--c-text-dim)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--c-accent)] sm:w-36"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 text-[var(--c-text-dim)] hover:text-[var(--c-text)] focus-visible:outline-none"
                    aria-label={pick('Xoá tìm kiếm', 'Clear search')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Nút bật/tắt bảng chọn biến */}
              <button
                type="button"
                onClick={() => setIsPickerOpen((open) => !open)}
                aria-expanded={isPickerOpen}
                aria-controls="runtime-variable-picker"
                title={pick('Chọn biến hiển thị', 'Select visible variables')}
                data-testid="runtime-filter-button"
                className={`flex h-6 items-center gap-1 rounded border px-2 text-xs transition-colors ${
                  isPickerOpen || hiddenNames.length > 0
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10 text-[var(--c-accent)] font-medium'
                    : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text)] hover:bg-[var(--c-surface-3)]'
                } focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--c-accent)]`}
              >
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{pick('Chọn biến', 'Select variables')}</span>
                {hiddenNames.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-[var(--c-accent)] px-1.5 py-0.2 text-[10px] font-bold text-white">
                    {selectedCount}
                  </span>
                )}
              </button>
            </>
          )}

          <span className="rounded-full border border-[var(--c-border)] px-2 py-0.5 text-[11px] text-[var(--c-text-dim)]">
            {mode === 'SIMULATION' ? pick('Mô phỏng', 'Simulation') : pick('Chỉ đọc', 'Read only')}
          </span>
        </div>
      </div>

      {state.status === 'ready' && items.length > 0 && isPickerOpen && (
        <div
          id="runtime-variable-picker"
          data-testid="runtime-variable-picker"
          className="mt-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-1.5 text-xs">
            <span className="font-semibold text-[var(--c-text)]">
              {pick('Chọn biến hiển thị', 'Select visible variables')}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => updateHiddenNames([])}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--c-accent)] hover:bg-[var(--c-surface-3)]"
              >
                {pick('Hiện tất cả', 'Show all')}
              </button>
              <span className="text-[var(--c-border)]">|</span>
              <button
                type="button"
                onClick={() => updateHiddenNames(items.map((i) => i.variableName))}
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--c-text-dim)] hover:bg-[var(--c-surface-3)] hover:text-[var(--c-text)]"
              >
                {pick('Bỏ chọn tất cả', 'Deselect all')}
              </button>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="ml-1 rounded p-0.5 text-[var(--c-text-dim)] hover:bg-[var(--c-surface-3)] hover:text-[var(--c-text)]"
                aria-label={pick('Đóng', 'Close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-1.5 grid max-h-36 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
            {pickerItems.map((item) => {
              const isChecked = !hiddenNames.includes(item.variableName)
              return (
                <label
                  key={item.variableId}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-[var(--c-surface-3)]"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateHiddenNames((prev) => prev.filter((name) => name !== item.variableName))
                      } else {
                        updateHiddenNames((prev) => [...prev, item.variableName])
                      }
                    }}
                    className="rounded border-[var(--c-border)] text-[var(--c-accent)] focus:ring-0"
                  />
                  <span className="truncate font-mono text-[var(--c-text)]" title={item.variableId}>
                    {item.variableName}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]" role="status">
          {pick('Đang tải giá trị runtime…', 'Loading runtime values…')}
        </p>
      )}
      {state.status === 'unavailable' && (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]" role="status">
          {mode === 'SIMULATION'
            ? (state.reason ?? pick('Không đọc được giá trị mô phỏng.', 'Simulation values unavailable.'))
            : pick('Không đọc được giá trị runtime.', 'Runtime values unavailable.') + (state.reason ? ` ${state.reason}` : '')}
        </p>
      )}
      {state.status === 'ready' && state.producerRestarted && (
        <p className="mt-2 rounded bg-[var(--c-warn-bg)] px-2 py-1 text-xs text-[var(--c-warn-fg)]" role="status">
          {pick(
            'Core đã khởi động lại — giá trị bên dưới bắt đầu một mạch mới, không nối tiếp số liệu trước đó.',
            'Core restarted — the values below begin a new run and do not continue the previous series.',
          )}
        </p>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]" role="status">
          {pick('Chưa có biến runtime cho POU này.', 'No runtime variables for this POU.')}
        </p>
      )}
      {state.status === 'ready' && items.length > 0 && filteredItems.length === 0 && (
        <div
          data-testid="runtime-overlay-empty-filter"
          className="mt-2 rounded border border-dashed border-[var(--c-border)] p-3 text-center text-xs text-[var(--c-text-dim)]"
        >
          <p>{pick('Không có biến nào khớp với bộ lọc.', 'No variables match the filter.')}</p>
          <button
            type="button"
            onClick={() => {
              setQuery('')
              updateHiddenNames([])
            }}
            className="mt-1.5 rounded bg-[var(--c-surface-2)] px-2 py-1 text-xs font-medium text-[var(--c-accent)] hover:bg-[var(--c-surface-3)]"
          >
            {pick('Hiện tất cả biến', 'Show all variables')}
          </button>
        </div>
      )}
      {state.status === 'ready' && filteredItems.length > 0 && (
        <ul
          className="mt-2 flex flex-wrap gap-2"
          aria-label={pick('Giá trị runtime theo biến', 'Runtime values by variable')}
        >
          {filteredItems.map((item) => {
            const presentation = presentStRuntimeValue(item)
            const stateLabel = presentation.state === 'live'
              ? pick('Trực tiếp', 'Live')
              : presentation.state === 'stale'
                ? pick('Dữ liệu đã cũ', 'Stale data')
                : presentation.state === 'uncertain'
                  ? pick('Không chắc chắn', 'Uncertain')
                  : pick('Không hợp lệ', 'Invalid')
            return (
              <li
                key={item.variableId}
                className={`min-w-36 rounded border px-2 py-1 text-xs ${STATE_CLASS[presentation.state]}`}
                title={item.observedAt}
              >
                <span className="block font-mono font-semibold text-[var(--c-text)]">{item.variableName}</span>
                <span className="font-mono">
                  {presentation.displayValue}{presentation.displayValue !== '—' && item.unit ? ` ${item.unit}` : ''}
                </span>
                <span className="ml-2">
                  {item.quality} · {item.freshness === 'SIMULATION' ? (
                    <span className="rounded-full border border-[var(--c-border)] px-1 text-[10px]">
                      {pick('MÔ PHỎNG', 'SIMULATION')}
                    </span>
                  ) : (
                    item.freshness
                  )} · {stateLabel}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
