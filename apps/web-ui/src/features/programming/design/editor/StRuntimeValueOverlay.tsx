import { useI18n } from '../../../../shared/i18n'

export type StRuntimeQuality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'OFFLINE' | 'UNKNOWN'
export type StRuntimeFreshness = 'LIVE' | 'STALE' | 'UNAVAILABLE'

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
  | { status: 'ready'; items: readonly StRuntimeOverlayItem[] }

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
    item.quality === 'BAD' || item.quality === 'OFFLINE' || item.quality === 'UNKNOWN'
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

export function StRuntimeValueOverlay({ state }: { state: StRuntimeOverlayState }) {
  const { pick } = useI18n()

  return (
    <section
      aria-label={pick('Lớp giá trị runtime ST', 'ST runtime value overlay')}
      className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          {pick('Giá trị runtime', 'Runtime values')}
        </h4>
        <span className="rounded-full border border-[var(--c-border)] px-2 py-0.5 text-[11px] text-[var(--c-text-dim)]">
          {pick('Chỉ đọc', 'Read only')}
        </span>
      </div>

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]" role="status">
          {pick('Đang tải giá trị runtime…', 'Loading runtime values…')}
        </p>
      )}
      {state.status === 'unavailable' && (
        <p className="mt-2 text-xs text-[var(--c-fault-fg)]" role="status">
          {pick('Không đọc được giá trị runtime.', 'Runtime values unavailable.')}
          {state.reason ? ` ${state.reason}` : ''}
        </p>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]" role="status">
          {pick('Chưa có biến runtime cho POU này.', 'No runtime variables for this POU.')}
        </p>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <ul
          className="mt-2 flex flex-wrap gap-2"
          aria-label={pick('Giá trị runtime theo biến', 'Runtime values by variable')}
        >
          {state.items.map((item) => {
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
                <span className="ml-2">{item.quality} · {item.freshness} · {stateLabel}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
