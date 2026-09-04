import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { StateBlock } from '../../../shared/components/StateBlock'
import { useI18n } from '../../../shared/i18n'
import { LibraryBlockCard } from './LibraryBlockCard'
import type { LibraryEntryGroup } from '../model/library'
import type { LibraryViewAction, LibraryViewStatus } from './libraryViewState'

/**
 * `T61-303`/`T61-306` — lưới thẻ khối và bàn phím của nó.
 *
 * Hai luật đến từ `SPEC-PGM04-VISUAL-001` §5, và cả hai đều là luật dùng được
 * chứ không phải luật trang trí:
 *
 *  1. **Lưới là MỘT điểm dừng tab.** Roving tabindex: đúng một thẻ mang
 *     `tabIndex=0`. Một thư viện 200 khối mà mỗi thẻ là một điểm dừng thì phím
 *     `Tab` không còn đi tới được Inspector — người dùng bàn phím mất luôn nửa
 *     màn hình.
 *  2. **`←/→/↑/↓` đi giữa thẻ, `Home`/`End` về đầu/cuối.** Lưới đổi số cột theo
 *     khổ màn, nên `↑/↓` phải nhảy đúng một HÀNG chứ không phải một thẻ; số cột
 *     đo từ bố cục thật, không đoán từ breakpoint.
 */
export function LibraryCardGrid({
  state,
  groups,
  errorMessage,
  action,
  stale,
  draftUsageCount,
  isFavorite,
  onToggleFavorite,
  focusCardRef,
  onRetry,
  onClearFilters,
  onCreate,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  selectedKey,
  onSelect,
}: {
  state: LibraryViewStatus
  groups: LibraryEntryGroup[]
  errorMessage: string | null
  action: LibraryViewAction
  stale: boolean
  /** `null` = chưa đọc được bản nháp. KHÁC 0 = không POU nào dùng. */
  draftUsageCount: (group: LibraryEntryGroup) => number | null
  /** `T61-303` — Yêu thích dùng chung kho với Quick Library. */
  isFavorite: (group: LibraryEntryGroup) => boolean
  onToggleFavorite: (group: LibraryEntryGroup) => void
  /**
   * `T61-304` — đường TRẢ TIÊU ĐIỂM về đúng thẻ sau khi đóng khay.
   *
   * Ref của thẻ nằm trong lưới; trang là nơi biết khay vừa đóng. Thay vì nâng
   * toàn bộ map ref lên trang (một chi tiết nội bộ của lưới), lưới gán vào đây
   * một hàm "hãy tiêu điểm thẻ này". Không có đường ấy thì tiêu điểm rơi về
   * `<body>` và người dùng bàn phím phải `Tab` lại từ đầu trang.
   */
  focusCardRef?: React.MutableRefObject<((key: string) => void) | null>
  onRetry: () => void
  onClearFilters: () => void
  onCreate: (() => void) | null
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: string | null
  onLoadMore: () => void
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const { pick } = useI18n()
  const listRef = useRef<HTMLUListElement | null>(null)
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())

  const registerCard = useCallback((key: string) => (element: HTMLButtonElement | null) => {
    if (element) cardRefs.current.set(key, element)
    else cardRefs.current.delete(key)
  }, [])

  /* Tiêu điểm TÁCH khỏi lựa chọn, theo `SPEC-PGM04-VISUAL-001` §5: mũi tên DI
     CHUYỂN giữa thẻ, `Enter` mới MỞ khay chi tiết. Gộp hai thứ lại thì mỗi lần
     lướt qua một thẻ là một lần đổi URL và một request Used-In — đi từ đầu tới
     cuối một thư viện 200 khối sẽ bắn 200 request cho những khối không ai định
     xem. */
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const focusIndex = focusKey === null ? -1 : groups.findIndex((group) => group.key === focusKey)
  const selectedIndex = groups.findIndex((group) => group.key === selectedKey)
  // Thẻ mang `tabIndex=0`: nơi tiêu điểm đang ở, nếu không thì thẻ đang chọn,
  // nếu không nữa thì thẻ đầu. Danh sách ngắn lại làm chỉ số cũ hết hiệu lực,
  // và `findIndex` trả `-1` đã tự xử lý điều đó.
  const activeIndex = focusIndex >= 0 ? focusIndex : selectedIndex >= 0 ? selectedIndex : 0

  useEffect(() => {
    if (!focusCardRef) return undefined
    focusCardRef.current = (key: string) => {
      setFocusKey(key)
      cardRefs.current.get(key)?.focus()
    }
    return () => { focusCardRef.current = null }
  }, [focusCardRef])

  useEffect(() => {
    // Danh sách ngắn lại thì bỏ ref của thẻ đã biến mất, nếu không map cứ phình.
    const alive = new Set(groups.map((group) => group.key))
    for (const key of [...cardRefs.current.keys()]) if (!alive.has(key)) cardRefs.current.delete(key)
  }, [groups])

  function columnCount(): number {
    const list = listRef.current
    if (!list) return 1
    const items = [...list.querySelectorAll<HTMLElement>('[data-testid="library-block-card"]')]
    if (items.length < 2) return 1
    /* Đếm số thẻ nằm cùng một hàng bằng toạ độ THẬT. jsdom trả 0 cho mọi kích
       thước, nên nhánh này rơi về 1 cột ở test — và một cột vẫn cho `↑/↓` chạy
       đúng như `←/→`. */
    const top = items[0].getBoundingClientRect().top
    const sameRow = items.filter((item) => Math.abs(item.getBoundingClientRect().top - top) < 1).length
    return Math.max(1, sameRow)
  }

  function focusCard(index: number) {
    const clamped = Math.min(Math.max(index, 0), groups.length - 1)
    const group = groups[clamped]
    if (!group) return
    setFocusKey(group.key)
    cardRefs.current.get(group.key)?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (groups.length === 0) return
    const columns = columnCount()
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusCard(activeIndex + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusCard(activeIndex - 1)
        break
      case 'ArrowDown':
        event.preventDefault()
        focusCard(activeIndex + columns)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusCard(activeIndex - columns)
        break
      case 'Home':
        event.preventDefault()
        focusCard(0)
        break
      case 'End':
        event.preventDefault()
        focusCard(groups.length - 1)
        break
      default:
        break
    }
  }

  if (state === 'loading') {
    /* Skeleton khớp HÌNH HỌC thẻ thật (`SPEC-PGM04-VISUAL-001` §3): cùng số
       dòng, cùng chiều cao. Một spinner giữa màn hình trống làm bố cục nhảy một
       nhịp khi dữ liệu về, và cú nhảy ấy rơi đúng lúc người dùng vừa đưa chuột
       tới chỗ họ tưởng là nút. */
    return (
      <ul aria-busy="true" aria-label={pick('Đang tải danh sách khối', 'Loading blocks')}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <li key={index} aria-hidden="true"
            className="flex h-[8.5rem] animate-pulse flex-col gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
            <span className="h-4 w-1/2 rounded bg-[var(--c-border)]" />
            <span className="h-3 w-1/3 rounded bg-[var(--c-border)]" />
            <span className="h-3 w-full rounded bg-[var(--c-border)]" />
            <span className="h-3 w-3/4 rounded bg-[var(--c-border)]" />
          </li>
        ))}
      </ul>
    )
  }
  if (state === 'no-permission') {
    return (
      <StateBlock
        state="empty"
        title={pick('Vai hiện tại không xem được Thư viện điều khiển.', 'The current role cannot view the Control Library.')}
        detail={errorMessage ?? undefined}
      />
    )
  }
  if (state === 'offline' && groups.length === 0) {
    return (
      <StateBlock
        state="error"
        /* KHÔNG nói "mất kết nối": nhánh này gom cả trình duyệt offline lẫn máy
           chủ trả 503/504. Đổ cho mạng của người dùng khi thật ra thiết bị đang
           quá tải sẽ khiến họ đi kiểm dây mạng thay vì đi kiểm tủ. */
        title={pick('Chưa đọc được Thư viện điều khiển — thiết bị hoặc mạng chưa phản hồi.',
                    'Control Library unreachable — the controller or the network is not responding.')}
        detail={errorMessage ?? undefined}
        onRetry={onRetry}
      />
    )
  }
  if (state === 'error' && groups.length === 0) {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được Thư viện điều khiển.', 'Could not load the Control Library.')}
        detail={errorMessage ?? undefined}
        onRetry={onRetry}
      />
    )
  }
  /* `T61-302` — tab PROJECT nhưng chưa phân giải được `projectId`.
     Đây KHÔNG phải "thư viện rỗng" và cũng không phải lỗi máy chủ: yêu cầu chưa
     hề được gửi, vì FE biết trước là nó sẽ bị store từ chối. Nói đúng câu ấy là
     khác biệt giữa "bạn chưa chọn Project" và "thiết bị hỏng" — hai câu dẫn tới
     hai người khác nhau để hỏi. */
  if (state === 'no-project') {
    return (
      <StateBlock
        state="empty"
        title={pick('Chưa chọn Project nên chưa đọc được thư viện của Project.',
                    'No project is selected, so the project library cannot be read.')}
        detail={pick('Khối hệ thống vẫn xem được ở tab Hệ thống.',
                     'System blocks are still available on the System tab.')}
      />
    )
  }
  if (state === 'empty-filter') {
    return (
      <div className="flex flex-col items-start gap-3">
        <StateBlock state="empty" title={pick('Không có khối nào khớp bộ lọc.', 'No blocks match the filters.')} />
        {/* `SPEC-PGM04-VISUAL-001` §3 đòi đúng một hành động ở đây, và nó phải
            là XOÁ BỘ LỌC: người dùng vừa thu hẹp tới mức không còn gì, nên thứ
            họ cần là đường quay lại, không phải một lời giải thích. */}
        <Button size="sm" onClick={onClearFilters}>{pick('Xoá bộ lọc', 'Clear filters')}</Button>
      </div>
    )
  }
  if (state === 'empty-project') {
    return (
      <div className="flex flex-col items-start gap-3">
        <StateBlock
          state="empty"
          title={pick('Thư viện của Project này chưa có khối nào.', 'This project library has no blocks yet.')}
          detail={action === 'create-block'
            ? pick('Dùng nút Tạo khối để bắt đầu.', 'Use Create block to get started.')
            : pick('Vai hiện tại không tạo được khối.', 'The current role cannot create blocks.')}
        />
        {action === 'create-block' && onCreate && (
          <Button size="sm" onClick={onCreate}>{pick('Tạo khối PROJECT', 'Create a PROJECT block')}</Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {stale && (
        <p className="text-xs text-[var(--c-warn-fg)]" role="status">
          {pick('Danh sách này là bản đã tải trước đó.', 'This list is a previously loaded copy.')}
        </p>
      )}
      <ul
        ref={listRef}
        onKeyDown={handleKeyDown}
        aria-label={pick('Danh sách khối Thư viện điều khiển', 'Control Library blocks')}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {groups.map((group, index) => (
          <li key={group.key} className="flex min-w-0">
            <LibraryBlockCard
              group={group}
              selected={group.key === selectedKey}
              usage={{ draftCount: draftUsageCount(group) }}
              favorite={isFavorite(group)}
              onToggleFavorite={() => onToggleFavorite(group)}
              tabIndex={index === activeIndex ? 0 : -1}
              cardRef={registerCard(group.key)}
              onSelect={() => {
                setFocusKey(group.key)
                onSelect(group.key)
              }}
            />
          </li>
        ))}
      </ul>
      {(hasMore || loadMoreError) && (
        <div className="flex flex-col items-start gap-1">
          {loadMoreError && (
            /* Lỗi của RIÊNG trang vừa xin — danh sách phía trên vẫn dùng được.
               Xoá nó đi vì trang thứ tư lỗi là đánh đổi không ai chọn. */
            <p role="alert" className="text-xs text-[var(--c-fault-fg)]">{loadMoreError}</p>
          )}
          {hasMore && (
            <Button size="sm" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? pick('Đang tải…', 'Loading…') : pick('Tải thêm khối', 'Load more blocks')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
