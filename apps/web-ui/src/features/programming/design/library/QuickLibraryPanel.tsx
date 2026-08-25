import { useEffect, useMemo, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { useProgrammingLibrary } from '../../api/queries'
import type { ProgrammingLibraryPage, RemoteState } from '../../model/types'
import {
  catalogCategories,
  catalogEntries,
  filterCatalog,
  isInsertable,
  stInsertionSnippet,
  type CatalogEntry
} from './libraryCatalog'
import {
  pullLibraryPreferences,
  pushLibraryPreferences,
  readLocalLibraryPreferences,
  recordRecent,
  toggleFavorite,
  type LibraryPreferences
} from './libraryPreferences'

/**
 * `T59-804` (`PGM02-V22-WP-03`) — Quick Library của PGM-02.
 *
 * Nó KHÔNG có danh sách block riêng: mọi mục đến từ `GET /programming/libraries`
 * — đúng catalog mà PGM-04 đang dùng. Mục chưa dùng được không bị giấu mà được
 * nói ra: `REVIEW_REQUIRED` (có thật, chờ review sản phẩm) và
 * `SIGNATURE_UNAVAILABLE` (backend trả mục nhưng chữ ký không đọc được — không
 * đoán port). Giấu chúng đi sẽ biến "chưa hỗ trợ" thành "không tồn tại", và đó
 * là câu trả lời sai cho người đang tìm khối PID.
 */
export function QuickLibraryPanel({
  library,
  language,
  onInsert,
  onClose
}: {
  library: RemoteState<ProgrammingLibraryPage>
  /** Ngôn ngữ POU đang mở — mục ràng buộc ngôn ngữ khác bị loại. */
  language: 'ST' | 'FBD'
  /** Chèn đoạn ST tại con trỏ. Trả `true` khi chèn thật sự xảy ra. */
  onInsert: (snippet: string) => boolean
  onClose: () => void
}) {
  const { pick } = useI18n()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('')
  const [preferences, setPreferences] = useState<LibraryPreferences>(() => readLocalLibraryPreferences())
  const [syncState, setSyncState] = useState<'idle' | 'synced' | 'local-only'>('idle')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void pullLibraryPreferences().then(({ value, state }) => {
      if (cancelled) return
      setPreferences(value)
      setSyncState(state)
    })
    window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      cancelled = true
    }
  }, [])

  const entries = useMemo(() => catalogEntries(library.data), [library.data])
  const categories = useMemo(() => catalogCategories(entries), [entries])
  const filtered = useMemo(
    () => filterCatalog(entries, { query, category: category || undefined, language }),
    [entries, query, category, language]
  )
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.entryId, entry])), [entries])
  const favorites = preferences.favorites.flatMap((id) => byId.get(id) ?? [])
  const recent = preferences.recent.flatMap((id) => byId.get(id) ?? [])

  function insert(entry: CatalogEntry) {
    if (!isInsertable(entry)) return
    const inserted = onInsert(stInsertionSnippet(entry))
    /* Recent chỉ đổi SAU khi chèn thành công: ghi trước là dựng một lịch sử
     * thao tác chưa từng xảy ra. */
    if (!inserted) return
    const next = recordRecent(preferences, entry.entryId)
    setPreferences(next)
    void pushLibraryPreferences(next).then(setSyncState)
  }

  function star(entry: CatalogEntry) {
    const next = toggleFavorite(preferences, entry.entryId)
    setPreferences(next)
    void pushLibraryPreferences(next).then(setSyncState)
  }

  return (
    <div
      role="dialog"
      aria-label={pick('Thư viện nhanh', 'Quick library')}
      className="panel-shadow absolute right-0 top-0 z-20 w-80 overflow-hidden rounded-[var(--radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <input
        ref={searchRef}
        aria-label={pick('Tìm khối thư viện', 'Find a library block')}
        className="mono w-full border-b border-[var(--c-border)] bg-transparent px-3 py-2 text-xs text-[var(--c-text)] outline-none"
        placeholder={pick('Tìm khối…', 'Find a block…')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex flex-wrap gap-1 border-b border-[var(--c-border)] px-2 py-1.5">
        <CategoryChip label={pick('Tất cả', 'All')} active={category === ''} onClick={() => setCategory('')} />
        {categories.map((item) => (
          <CategoryChip key={item} label={item} active={category === item} onClick={() => setCategory(item)} />
        ))}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {library.status === 'loading' && (
          <p className="px-3 py-2 text-xs text-[var(--c-text-dim)]">{pick('Đang tải catalog…', 'Loading the catalog…')}</p>
        )}
        {library.status === 'error' && (
          <p role="alert" className="px-3 py-2 text-xs text-[var(--c-fault-fg)]">
            {library.error ?? pick('Không đọc được thư viện.', 'Could not read the library.')}
          </p>
        )}

        {library.status === 'ready' && favorites.length > 0 && (
          <Section title={pick('Yêu thích', 'Favorites')} entries={favorites} favorites={preferences.favorites} onInsert={insert} onStar={star} />
        )}
        {library.status === 'ready' && recent.length > 0 && (
          <Section title={pick('Gần đây', 'Recent')} entries={recent} favorites={preferences.favorites} onInsert={insert} onStar={star} />
        )}
        {library.status === 'ready' && (
          <Section
            title={pick('Catalog', 'Catalog')}
            entries={filtered}
            favorites={preferences.favorites}
            onInsert={insert}
            onStar={star}
            emptyLabel={pick('Không khớp mục nào.', 'No entry matches.')}
          />
        )}
      </div>

      {syncState === 'local-only' && (
        <p className="border-t border-[var(--c-border)] px-3 py-1.5 text-[10px] text-[var(--c-warn-fg)]">
          {pick(
            'Thiết bị chưa lưu được Yêu thích/Gần đây — lựa chọn chỉ nằm trên trình duyệt này.',
            'The device could not store favorites/recent — they stay in this browser only.'
          )}
        </p>
      )}
    </div>
  )
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] ${
        active ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
      }`}
    >
      {label}
    </button>
  )
}

function Section({
  title,
  entries,
  favorites,
  onInsert,
  onStar,
  emptyLabel
}: {
  title: string
  entries: readonly CatalogEntry[]
  favorites: readonly string[]
  onInsert: (entry: CatalogEntry) => void
  onStar: (entry: CatalogEntry) => void
  emptyLabel?: string
}) {
  const { pick } = useI18n()
  return (
    <section>
      <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{title}</p>
      {entries.length === 0 && emptyLabel && <p className="px-3 pb-2 text-xs text-[var(--c-text-dim)]">{emptyLabel}</p>}
      <ul aria-label={title}>
        {entries.map((entry) => {
          const insertable = isInsertable(entry)
          const reason =
            entry.usability.kind === 'REVIEW_REQUIRED'
              ? pick('Chờ review sản phẩm', 'Awaiting product review')
              : entry.usability.kind === 'SIGNATURE_UNAVAILABLE'
                ? pick('Thiếu chữ ký từ thiết bị', 'Signature unavailable from the device')
                : null
          return (
            <li key={`${entry.scope}-${entry.entryId}`} className="flex items-center gap-1 px-1">
              <button
                type="button"
                disabled={!insertable}
                aria-disabled={!insertable}
                /* Nhãn tường minh vì nút Yêu thích bên cạnh cũng mang tên mục;
                   nhãn vẫn chứa tên đang hiện (WCAG 2.5.3). */
                aria-label={pick(`Chèn ${entry.name}`, `Insert ${entry.name}`)}
                onClick={() => onInsert(entry)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--c-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
                title={reason ?? undefined}
              >
                <span className="mono shrink-0 rounded bg-[var(--c-surface-2)] px-1 text-[10px] text-[var(--c-text-dim)]">
                  {entry.scope === 'SYSTEM' ? 'SYS' : 'PRJ'}
                </span>
                <span className="mono min-w-0 flex-1 truncate text-[var(--c-text)]">{entry.name}</span>
                {reason && <span className="shrink-0 text-[10px] text-[var(--c-warn-fg)]">{reason}</span>}
              </button>
              <button
                type="button"
                onClick={() => onStar(entry)}
                aria-pressed={favorites.includes(entry.entryId)}
                title={pick(`Yêu thích ${entry.name}`, `Favorite ${entry.name}`)}
                className="shrink-0 rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
              >
                <Star className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Vỏ LAZY: hook `useProgrammingLibrary` fetch ngay khi mount, nên panel chỉ
 * được mount lúc người dùng mở — mở tab Chương trình KHÔNG tạo traffic
 * `GET /libraries` (cùng quyết định #02 đã áp cho `/point-catalog`).
 */
export function QuickLibraryHost(props: {
  projectId?: string
  language: 'ST' | 'FBD'
  onInsert: (snippet: string) => boolean
  onClose: () => void
}) {
  const library = useProgrammingLibrary({ projectId: props.projectId })
  return (
    <QuickLibraryPanel
      library={library}
      language={props.language}
      onInsert={props.onInsert}
      onClose={props.onClose}
    />
  )
}
