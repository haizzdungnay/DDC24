/**
 * Menu chuột phải của canvas FBD.
 *
 * Trước bản này canvas làm đúng một việc với chuột phải: `onContextMenu` gọi
 * `preventDefault()` rồi thôi. Tức là nó chặn menu của trình duyệt mà không
 * đưa ra menu nào thay thế — chuột phải trở thành phím không có tác dụng. Mọi
 * thao tác cơ bản (Xoá, Nhân đôi, Ngắt dây, Vừa vùng chọn) vì thế chỉ tới được
 * bằng cách đưa con trỏ lên thanh công cụ.
 *
 * Menu là DOM thường (`position: fixed`), không phải phần tử SVG: nó phải nổi
 * trên mọi lớp của mặt vẽ và không bị `viewBox` của SVG co giãn theo zoom.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface FbdContextMenuItem {
  id: string
  label: string
  /** Phím tắt tương ứng, hiện ở cột phải. Rỗng nghĩa là chỉ có ở menu này. */
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  run: () => void
}

export interface FbdContextMenuProps {
  /** Toạ độ client nơi người dùng bấm chuột phải. */
  x: number
  y: number
  title: string
  items: readonly FbdContextMenuItem[]
  onClose: () => void
}

const MENU_MIN_WIDTH = 208
const VIEWPORT_PADDING = 8

export function FbdContextMenu({ x, y, title, items, onClose }: FbdContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const enabledItems = items.filter((item) => !item.disabled)

  /* Kẹp vào khung nhìn SAU khi đo: một menu mở ở mép phải mà tràn ra ngoài là
   * một menu có mục không bấm được. Đo bằng `useLayoutEffect` để không thấy
   * một frame ở chỗ sai. */
  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const width = rect.width || MENU_MIN_WIDTH
    const height = rect.height || 0
    const maxLeft = window.innerWidth - width - VIEWPORT_PADDING
    const maxTop = window.innerHeight - height - VIEWPORT_PADDING
    setPosition({
      left: Math.max(VIEWPORT_PADDING, Math.min(x, Math.max(VIEWPORT_PADDING, maxLeft))),
      top: Math.max(VIEWPORT_PADDING, Math.min(y, Math.max(VIEWPORT_PADDING, maxTop))),
    })
  }, [x, y, items.length])

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
    first?.focus()
  }, [])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    /* `capture` để một lần bấm ra ngoài đóng menu TRƯỚC khi canvas coi đó là
     * một cử chỉ mới (bấm ra ngoài vừa đóng menu vừa bắt đầu marquee là hai
     * việc trong một lần bấm). */
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose])

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const current = buttons.indexOf(window.document.activeElement as HTMLButtonElement)
    let next = current
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = current <= 0 ? buttons.length - 1 : current - 1
    else if (event.key === 'Home') next = 0
    else next = buttons.length - 1
    buttons[next]?.focus()
  }

  if (items.length === 0) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={title}
      data-fbd-context-menu="true"
      tabIndex={-1}
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 min-w-[13rem] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] py-1 shadow-lg"
      style={{ left: position.left, top: position.top }}
    >
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
        {title}
      </p>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-fbd-context-item={item.id}
          disabled={item.disabled}
          /* Chạy ở `pointerup` chứ không ở `click`: menu được mở bằng
             `contextmenu`, và ở một số trình duyệt nút chuột phải nhả ra
             không sinh `click` trên phần tử vừa xuất hiện dưới con trỏ. */
          onClick={() => {
            item.run()
            onClose()
          }}
          className={[
            'flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs',
            item.disabled
              ? 'cursor-not-allowed text-[var(--c-text-dim)] opacity-60'
              : item.danger
                ? 'text-[var(--c-danger-fg)] hover:bg-[var(--c-danger-bg)] focus-visible:bg-[var(--c-danger-bg)]'
                : 'text-[var(--c-text)] hover:bg-[var(--c-surface-2)] focus-visible:bg-[var(--c-surface-2)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--c-accent)]',
          ].join(' ')}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span className="font-mono text-[10px] text-[var(--c-text-dim)]">{item.shortcut}</span>
          )}
        </button>
      ))}
      {enabledItems.length === 0 && (
        <p className="px-3 py-1.5 text-xs text-[var(--c-text-dim)]">
          {/* Không bao giờ mở một menu rỗng không giải thích gì. */}
          &mdash;
        </p>
      )}
    </div>
  )
}
