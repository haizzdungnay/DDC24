import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../../../shared/i18n'
import { useProgrammingLibraryPaged, type ProgrammingLibraryPagedState } from '../../api/queries'
import {
  catalogCategories,
  catalogEntriesOf,
  filterCatalog,
  isInsertable,
  type CatalogEntry
} from './libraryCatalog'
import { categoryLabel } from '../../library/libraryPresentation'
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
/**
 * `DEV-PROG-016` — kiểu dữ liệu của thao tác kéo khối thư viện.
 *
 * Không dùng `text/plain`: trình duyệt sẽ để `<textarea>` tự chèn chuỗi đó, bỏ
 * qua đường dựng khai báo instance (`AC-ST-002`) và bỏ qua lịch sử Undo của
 * editor. Một kiểu riêng khiến chỉ đúng bề mặt biết cách chèn mới nhận.
 */
export const LIBRARY_DRAG_TYPE = 'application/x-mkddc-library-entry'

/**
 * Một khoá tuỳ chọn → mục catalog đang hiện, hoặc không gì cả.
 *
 * Khoá cũ (trước `T61-203`) là `entryId` TRẦN. Người dùng đã có Yêu thích lưu
 * theo dạng ấy trên thiết bị, và vứt chúng đi trong một lần nâng cấp là bắt
 * người ta gắn sao lại từ đầu vì một chuyện họ không gây ra. Nên khoá cũ vẫn
 * được nhận: nó khớp khi phần sau dấu `/` của một khoá mới trùng nó.
 *
 * Khoá không phân giải được (khối đã bị xoá, hoặc thuộc Project khác) đơn giản
 * KHÔNG hiện. Đó cũng là phép vô hiệu hoá: danh sách tuỳ chọn không cần dọn
 * chủ động, vì thứ nó trỏ tới không còn thì nó không vẽ ra gì.
 */
function resolvePreference(byKey: Map<string, CatalogEntry>, key: string): CatalogEntry[] {
  const exact = byKey.get(key)
  if (exact) return [exact]
  if (key.includes('/')) return []
  for (const entry of byKey.values()) {
    if (entry.entryId === key) return [entry]
  }
  return []
}

export function QuickLibraryPanel({
  library,
  language,
  onInsert,
  canInsert,
  onClose,
  variant = 'popover',
  projectId
}: {
  library: ProgrammingLibraryPagedState
  /** Ngôn ngữ POU đang mở — mục ràng buộc ngôn ngữ khác bị loại. */
  language: 'ST' | 'FBD'
  /**
   * `DEV-PROG-002` — `docked` là panel CẮM CỐ ĐỊNH bên phải trình soạn thảo
   * (đẩy chỗ, không phủ lên); `popover` là bản nổi cũ.
   *
   * Khác biệt không chỉ là CSS: bản nổi phải là `role="dialog"` vì nó che nội
   * dung phía dưới và bẫy Escape; bản cắm là một vùng của trang, nên khai
   * `dialog` ở đó sẽ nói với trình đọc màn hình rằng phần còn lại đang bị chặn
   * trong khi không hề.
   */
  variant?: 'popover' | 'docked'
  /** Đích của "Xem thêm khối…" (Control Library, PGM-04). Không có Project thì
   *  không có đích thật ⇒ liên kết không hiện, không trỏ vào chỗ trống. */
  projectId?: string
  /**
   * Chèn mục vào bề mặt đang mở. Panel KHÔNG biết cách chèn: ST dựng đoạn mã
   * tại con trỏ, FBD thêm node vào canvas. Trả `true` khi chèn thật sự xảy ra —
   * Recent chỉ ghi sau khi có `true`.
   */
  onInsert: (entry: CatalogEntry) => boolean
  /**
   * Bề mặt có nhận được mục này không, và nếu không thì vì sao. Một mục dùng
   * được ở ST vẫn có thể chưa vẽ được trên canvas FBD; nói ra lý do đúng chỗ
   * tốt hơn là ẩn mục đi và để người dùng đi tìm nó.
   */
  canInsert?: (entry: CatalogEntry) => { ok: true } | { ok: false; reason: string }
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

  const entries = useMemo(() => catalogEntriesOf(library.items), [library.items])
  const categories = useMemo(() => catalogCategories(entries), [entries])
  const filtered = useMemo(
    () => filterCatalog(entries, { query, category: category || undefined, language }),
    [entries, query, category, language]
  )
  /* `T61-203` — tra theo KHOÁ ĐỊNH DANH (`scope/entryId`), không theo `entryId`
     trần. `GET /libraries` trả mọi library revision, nên một `Map` khoá bằng
     `entryId` giữ lại bản gặp sau cùng — tức một version tuỳ ý, và sau lần
     publish kế tiếp Yêu thích trỏ vào một revision đã DEPRECATED. `catalogEntriesOf`
     nay đã gom theo khoá và chọn version hiện hành, nên `Map` này có đúng một
     mục cho mỗi khối. */
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries])
  const favorites = preferences.favorites.flatMap((key) => resolvePreference(byKey, key))
  const recent = preferences.recent.flatMap((key) => resolvePreference(byKey, key))

  function surfaceBlock(entry: CatalogEntry): string | null {
    if (!canInsert) return null
    const verdict = canInsert(entry)
    return verdict.ok ? null : verdict.reason
  }

  function insert(entry: CatalogEntry) {
    if (!isInsertable(entry) || surfaceBlock(entry) !== null) return
    const inserted = onInsert(entry)
    /* Recent chỉ đổi SAU khi chèn thành công: ghi trước là dựng một lịch sử
     * thao tác chưa từng xảy ra. */
    if (!inserted) return
    const next = recordRecent(preferences, entry.key)
    setPreferences(next)
    void pushLibraryPreferences(next).then(setSyncState)
  }

  function star(entry: CatalogEntry) {
    const next = toggleFavorite(preferences, entry.key)
    setPreferences(next)
    void pushLibraryPreferences(next).then(setSyncState)
  }

  const docked = variant === 'docked'
  /* Nội dung đã tải vẫn được vẽ khi lần đọc mới hỏng — xem chú thích ở khối
     danh sách bên dưới. */
  const showList = library.status === 'ready' || entries.length > 0
  return (
    <div
      {...(docked
        ? { 'aria-label': pick('Thư viện nhanh', 'Quick library'), role: 'region' as const }
        : { 'aria-label': pick('Thư viện nhanh', 'Quick library'), role: 'dialog' as const })}
      data-testid="quick-library-panel"
      data-variant={variant}
      className={docked
        ? 'flex w-72 shrink-0 flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]'
        : 'panel-shadow absolute right-0 top-0 z-20 w-80 overflow-hidden rounded-[var(--radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)]'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {docked && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--c-border)] px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
            {pick('Thư viện nhanh', 'Quick library')}
          </span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            onClick={onClose}
          >
            {pick('Thu gọn', 'Collapse')}
          </button>
        </div>
      )}
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

      <div className={docked ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-80 overflow-y-auto'}>
        {library.status === 'loading' && (
          <p className="px-3 py-2 text-xs text-[var(--c-text-dim)]">{pick('Đang tải catalog…', 'Loading the catalog…')}</p>
        )}
        {library.status === 'error' && (
          <div className="flex flex-col items-start gap-2 px-3 py-2">
            <p role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {library.error ?? pick('Không đọc được thư viện.', 'Could not read the library.')}
            </p>
            {typeof library.refresh === 'function' && (
              <button
                type="button"
                onClick={() => library.refresh()}
                className="rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-1 text-xs text-[var(--c-text)] hover:bg-[var(--c-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              >
                {pick('Thử lại', 'Retry')}
              </button>
            )}
          </div>
        )}

        {/* `T61-202` — điều kiện vẽ là CÓ NỘI DUNG, không phải `status === 'ready'`.
            Engine phân trang giữ lại danh sách đã tải khi một lần đọc hỏng; nếu
            ở đây vẫn đòi `ready` thì đúng lúc lỗi màn hình lại trống trơn, và
            "giữ danh sách" của engine không tới được người dùng. */}
        {showList && favorites.length > 0 && (
          <Section title={pick('Yêu thích', 'Favorites')} entries={favorites} favorites={preferences.favorites} onInsert={insert} onStar={star} surfaceBlock={surfaceBlock} />
        )}
        {showList && recent.length > 0 && (
          <Section title={pick('Gần đây', 'Recent')} entries={recent} favorites={preferences.favorites} onInsert={insert} onStar={star} surfaceBlock={surfaceBlock} />
        )}
        {showList && (
          <Section
            title={pick('Catalog', 'Catalog')}
            entries={filtered}
            favorites={preferences.favorites}
            onInsert={insert}
            onStar={star}
            surfaceBlock={surfaceBlock}
            emptyLabel={library.hasMore
              ? pick(
                'Không khớp mục nào trong phần đã tải — còn khối chưa tải.',
                'No entry matches what has been loaded — more blocks remain.'
              )
              : pick('Không khớp mục nào.', 'No entry matches.')}
          />
        )}

        {/* `T61-202` — đường đi tới khối thứ 101 trở đi.
            Không có nút này thì "danh sách đã cắt" và "thư viện chỉ có ngần ấy"
            trông hệt nhau, và người dùng dừng tìm ở mục cuối cùng họ thấy. */}
        {(library.hasMore || library.loadMoreError !== null) && (
          <div className="px-3 py-2">
            {library.loadMoreError !== null && (
              <p role="alert" className="pb-1 text-[11px] text-[var(--c-fault-fg)]">
                {library.loadMoreError}
              </p>
            )}
            <button
              type="button"
              data-testid="quick-library-load-more"
              disabled={library.loadingMore || !library.hasMore}
              onClick={library.loadMore}
              className="w-full rounded border border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text-dim)] hover:text-[var(--c-accent)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            >
              {library.loadingMore
                ? pick('Đang tải thêm…', 'Loading more…')
                : library.loadMoreError !== null
                  ? pick('Thử lại trang này', 'Retry this page')
                  : pick(`Tải thêm khối (đã tải ${entries.length})`, `Load more blocks (${entries.length} loaded)`)}
            </button>
          </div>
        )}
      </div>

      {/* `DEV-PROG-002` — lối sang Control Library (PGM-04), nơi sở hữu toàn bộ
          catalog kèm phiên bản và chữ ký. Quick Library cố ý chỉ là lối tắt:
          nhân bản trang quản lý thư viện vào đây sẽ là hai bề mặt cùng nói về
          một catalog và có thể nói khác nhau. */}
      {projectId && (
        <Link
          to={`/eng/programming/projects/${projectId}/library`}
          className="border-t border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-accent)] underline"
        >
          {pick('Xem thêm khối…', 'More blocks…')}
        </Link>
      )}

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
  surfaceBlock,
  emptyLabel
}: {
  title: string
  entries: readonly CatalogEntry[]
  favorites: readonly string[]
  onInsert: (entry: CatalogEntry) => void
  onStar: (entry: CatalogEntry) => void
  surfaceBlock: (entry: CatalogEntry) => string | null
  emptyLabel?: string
}) {
  return (
    <section>
      <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{title}</p>
      {entries.length === 0 && emptyLabel && <p className="px-3 pb-2 text-xs text-[var(--c-text-dim)]">{emptyLabel}</p>}
      <ul aria-label={title} className="flex flex-col gap-1 px-1 pb-1">
        {entries.map((entry) => (
          <BlockCard
            key={entry.key}
            entry={entry}
            favorite={favorites.includes(entry.key)}
            blocked={surfaceBlock(entry)}
            onInsert={onInsert}
            onStar={onStar}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * `DEV-PROG-002` — thẻ một khối, có SƠ ĐỒ CHÂN.
 *
 * Trước lát này mỗi mục là một dòng chỉ có tên. Người đang tìm khối để chèn phải
 * nhớ hoặc đoán khối đó nhận gì và trả gì — mà đúng thông tin ấy backend đã
 * công bố sẵn trong `signature.ports`. Vẽ nó ra là dùng dữ liệu đã có, không
 * phải bịa thêm: mục nào backend không đọc được chữ ký (`SIGNATURE_UNAVAILABLE`)
 * thì thẻ nói thẳng là không có chân nào để vẽ, chứ không vẽ một hộp trống trông
 * như khối không có đầu vào.
 *
 * Menu `⋯` mở phần chi tiết ngay trong thẻ (kind, nhóm, phiên bản thư viện, 12
 * ký tự đầu của `contentSha256`, danh sách chân đầy đủ). Nó là `<details>` của
 * trình duyệt: đã có sẵn ngữ nghĩa mở/đóng cho trình đọc màn hình và đi được
 * bằng bàn phím.
 */
function BlockCard({
  entry, favorite, blocked, onInsert, onStar,
}: {
  entry: CatalogEntry
  favorite: boolean
  blocked: string | null
  onInsert: (entry: CatalogEntry) => void
  onStar: (entry: CatalogEntry) => void
}) {
  const { pick } = useI18n()
  const insertable = isInsertable(entry) && blocked === null
  /* `T61-203` — mọi lý do đến từ THANG BẬC DÙNG CHUNG (`libraryUsability`), thứ
     tự y hệt PGM-04. Bản trước không có nhánh `DEPRECATED`, nên một khối đã
     ngừng sử dụng vẫn chèn được từ đây trong khi PGM-04 chặn nó. */
  const reason =
    entry.usability.kind === 'REVIEW_REQUIRED'
      ? pick('Chờ review sản phẩm', 'Awaiting product review')
      : entry.usability.kind === 'DEPRECATED'
        ? pick('Ngừng sử dụng', 'Deprecated')
        : entry.usability.kind === 'SIGNATURE_UNAVAILABLE'
          ? pick('Thiếu chữ ký từ thiết bị', 'Signature unavailable from the device')
          : blocked
  /* Tương thích chỉ được NÓI RA khi nó không phải `compatible`. Im lặng ở đây
     là cách một khối `REQUIRES_MIGRATION` trông hệt một khối bình thường —
     đúng thứ `compatibilityDisplay` fail-closed sinh ra để chặn. */
  const compatibilityNote =
    entry.compatibility.kind === 'requires-migration'
      ? pick('Cần nâng cấp phiên bản thư viện', 'Library version migration required')
      : entry.compatibility.kind === 'unknown'
        ? pick('Chưa đo được tương thích', 'Compatibility not measured')
        : null
  const inputs = entry.ports.filter((port) => port.direction === 'INPUT')
  const outputs = entry.ports.filter((port) => port.direction === 'OUTPUT')
  const label = pick(entry.labelVi, entry.labelEn)
  const rows = Math.max(inputs.length, outputs.length)

  return (
    <li
      data-testid="quick-library-card"
      data-entry={entry.entryId}
      /* `DEV-PROG-016` — kéo-thả vào trình soạn thảo.
       *
       * Chỉ mục DÙNG ĐƯỢC mới kéo được: kéo một mục `REVIEW_REQUIRED` rồi thả
       * xuống và không có gì xảy ra là một cách dạy người dùng rằng kéo-thả
       * "hên xui". Kiểu dữ liệu riêng (`application/x-mkddc-library-entry`) chứ
       * không phải `text/plain`: `text/plain` sẽ được TEXTAREA tự chèn nguyên
       * chuỗi, bỏ qua đường dựng khai báo instance và bỏ qua cả lịch sử Undo. */
      draggable={insertable}
      onDragStart={(event) => {
        if (!insertable) return
        event.dataTransfer.setData(LIBRARY_DRAG_TYPE, entry.entryId)
        event.dataTransfer.setData(`${LIBRARY_DRAG_TYPE}/${entry.entryId}`, '')
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]">
      <div className="flex items-center gap-1 border-b border-[var(--c-border)] px-1.5 py-1">
        <span className="mono shrink-0 rounded bg-[var(--c-surface-2)] px-1 text-[10px] text-[var(--c-text-dim)]">
          {entry.scope === 'SYSTEM' ? 'SYS' : 'PRJ'}
        </span>
        {/* `ISS-STED-17` / `ADR-054` điểm 3 — nhãn mở rộng nhà sản xuất phải ở
            ĐÂY, nơi người dùng CHỌN khối. Nằm trong tài liệu thì không ai đọc
            đúng lúc: kỹ sư viết cả một chương trình quanh `PID` rồi mới biết
            nó không chuyển được sang PLC hãng khác.

            Chỉ gắn cho mở rộng, không gắn nhãn "IEC" cho phần còn lại: dán
            nhãn lên 42/46 mục làm nhiễu đúng 4 mục cần chú ý. */}
        {entry.iecClassification === 'MANUFACTURER_EXTENSION' && (
          <span
            data-testid="library-extension-badge"
            className="mono shrink-0 rounded bg-[var(--c-warn-bg)] px-1 text-[10px] text-[var(--c-warn-fg)]"
            title={pick('Không thuộc thư viện chuẩn IEC 61131-3 — mở rộng của Mekong',
                        'Not part of the IEC 61131-3 standard library — Mekong extension')}
          >
            {pick('MỞ RỘNG', 'EXT')}
          </span>
        )}
        <button
          type="button"
          disabled={!insertable}
          aria-disabled={!insertable}
          /* Nhãn tường minh vì hai nút bên cạnh cũng mang tên mục; nhãn vẫn
             CHỨA tên đang hiện (WCAG 2.5.3). */
          aria-label={pick(`Chèn ${entry.name}`, `Insert ${entry.name}`)}
          title={reason ?? pick(`Chèn ${entry.name}`, `Insert ${entry.name}`)}
          onClick={() => onInsert(entry)}
          className="mono min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs font-semibold text-[var(--c-text)] hover:bg-[var(--c-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {entry.name}
        </button>
        <button
          type="button"
          onClick={() => onStar(entry)}
          aria-pressed={favorite}
          title={pick(`Yêu thích ${entry.name}`, `Favorite ${entry.name}`)}
          className="shrink-0 rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
        >
          <Star className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="px-1.5 py-1">
        {label !== entry.name && <p className="truncate text-[11px] text-[var(--c-text-dim)]">{label}</p>}
        {entry.ports.length === 0 ? (
          <p className="text-[10px] text-[var(--c-warn-fg)]">
            {pick('Thiết bị không công bố chân của khối này.', 'The device does not publish this block\u2019s pins.')}
          </p>
        ) : (
          <ul className="mt-0.5 flex flex-col gap-0.5" aria-label={pick(`Chân của ${entry.name}`, `Pins of ${entry.name}`)}>
            {Array.from({ length: rows }, (_, index) => (
              <li key={index} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="mono min-w-0 truncate text-[var(--c-text-dim)]">
                  {inputs[index] ? `\u2192 ${inputs[index].name}` : ''}
                </span>
                <span className="mono min-w-0 truncate text-right text-[var(--c-text-dim)]">
                  {outputs[index] ? `${outputs[index].name} \u2192` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {reason && <p className="mt-0.5 text-[10px] text-[var(--c-warn-fg)]">{reason}</p>}
        {compatibilityNote && (
          <p data-testid="quick-library-compatibility" className="mt-0.5 text-[10px] text-[var(--c-text-dim)]">
            {compatibilityNote}
          </p>
        )}
        <details className="mt-0.5">
          <summary
            className="flex cursor-pointer items-center gap-1 text-[10px] text-[var(--c-text-dim)] hover:text-[var(--c-text)]"
            aria-label={pick(`Chi tiết ${entry.name}`, `Details for ${entry.name}`)}
          >
            <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
            {pick('Chi tiết', 'Details')}
          </summary>
          <dl className="mt-0.5 flex flex-col gap-0.5 text-[10px]">
            <DetailRow label={pick('Loại', 'Kind')} value={entry.kind} />
            <DetailRow
              label={pick('Nhóm', 'Category')}
              value={entry.category ? categoryLabel(entry.category, pick) : pick('— chưa phân loại', '— not categorised')}
            />
            <DetailRow label={pick('Phiên bản', 'Version')} value={entry.libraryVersion} />
            {/* 12 ký tự đầu là đủ để đối chiếu bằng mắt với hồ sơ Revision; in
                cả 64 ký tự vào một panel rộng 18rem chỉ cho ra một khối chữ
                không ai đọc. Bản đầy đủ ở Control Library. */}
            <DetailRow label="contentSha256" value={`${entry.contentSha256.slice(0, 12)}…`} />
            {entry.ports.map((port) => (
              <DetailRow
                key={`${port.direction}-${port.name}`}
                label={port.name}
                value={`${port.direction} · ${port.dataType}`}
              />
            ))}
          </dl>
        </details>
      </div>
    </li>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mono min-w-0 truncate text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

/**
 * Vỏ LAZY: hook `useProgrammingLibraryPaged` fetch ngay khi mount, nên panel
 * chỉ được mount lúc người dùng mở — mở tab Chương trình KHÔNG tạo traffic
 * `GET /libraries` (cùng quyết định #02 đã áp cho `/point-catalog`).
 *
 * `T61-202` — và nó đọc CÙNG engine phân trang với Control Library của PGM-04.
 * Bản trước gọi `useProgrammingLibrary`, một hook riêng đọc đúng một trang
 * `limit: 100` rồi bỏ `nextCursor`: khối thứ 101 trở đi không bao giờ tới được
 * Quick Library, và không có bề mặt nào nói ra điều đó.
 */
export function QuickLibraryHost(props: {
  projectId?: string
  language: 'ST' | 'FBD'
  onInsert: (entry: CatalogEntry) => boolean
  canInsert?: (entry: CatalogEntry) => { ok: true } | { ok: false; reason: string }
  onClose: () => void
  variant?: 'popover' | 'docked'
}) {
  const library = useProgrammingLibraryPaged({ projectId: props.projectId })
  return (
    <QuickLibraryPanel
      library={library}
      language={props.language}
      onInsert={props.onInsert}
      canInsert={props.canInsert}
      onClose={props.onClose}
      variant={props.variant}
      projectId={props.projectId}
    />
  )
}
