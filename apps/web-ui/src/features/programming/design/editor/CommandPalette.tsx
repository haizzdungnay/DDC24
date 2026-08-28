import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { filterPaletteEntries, paletteEntryKey, type PaletteEntry } from './quickControl'

const KIND_TAG: Record<PaletteEntry['kind'], [string, string]> = {
  program: ['Chương trình', 'Program'],
  variable: ['Biến', 'Variable'],
  command: ['Lệnh', 'Command'],
}

/**
 * Bảng lệnh nhanh (`Ctrl+P`) — ST Editor Quick Control đề xuất #2 (đã duyệt,
 * quyết định #01/#04). Tìm xuyên suốt toàn Draft (mọi Program + biến ST đã
 * khai báo + ba lệnh cố định); danh sách truyền vào ĐÃ được `ProgramsTab`
 * dựng qua `useMemo` phụ thuộc `buffers` — component này chỉ lọc theo chuỗi
 * gõ (`filterPaletteEntries`, rẻ), không tự tokenize lại ST.
 */
export function CommandPalette({
  open,
  entries,
  onClose,
  onSelect,
}: {
  open: boolean
  entries: readonly PaletteEntry[]
  onClose: () => void
  onSelect: (entry: PaletteEntry) => void
}) {
  const { pick } = useI18n()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const filtered = useMemo(() => filterPaletteEntries(entries, query), [entries, query])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActiveIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => setActiveIndex(0), [query])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePalette()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose, open])

  if (!open) return null

  function commit(entry: PaletteEntry | undefined) {
    if (!entry) return
    onSelect(entry)
    closePalette()
  }

  function closePalette() {
    onClose()
    returnFocusRef.current?.focus()
  }

  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href]')]
    if (focusable.length === 0) { event.preventDefault(); dialogRef.current.focus(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-[rgba(0,0,0,0.55)] p-4 pt-24" role="presentation" onMouseDown={closePalette}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={pick('Bảng lệnh nhanh', 'Command palette')}
        tabIndex={-1}
        className="panel-shadow h-fit w-full max-w-md overflow-hidden rounded-[var(--radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)]"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-center border-b border-[var(--c-border)]">
        <input
          ref={inputRef}
          className="mono w-full bg-transparent px-3 py-2 text-sm text-[var(--c-text)] outline-none"
          placeholder={pick('Nhảy tới Program, biến, hoặc chạy lệnh…', 'Jump to a program, variable, or run a command…')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(filtered.length - 1, index + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)) }
            else if (event.key === 'Enter') { event.preventDefault(); commit(filtered[activeIndex]) }
          }}
        />
          <button type="button" className="mr-1 min-h-10 min-w-10 rounded p-2" aria-label={pick('Đóng', 'Close')} onClick={closePalette}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <ul role="listbox" aria-label={pick('Kết quả', 'Results')} className="max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-[var(--c-text-dim)]">{pick('Không có kết quả.', 'No results.')}</li>
          )}
          {filtered.map((entry, index) => (
            <li key={paletteEntryKey(entry)}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${index === activeIndex ? 'bg-[var(--c-accent-bg)]' : 'hover:bg-[var(--c-surface-2)]'}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(entry)}
              >
                <span className="mono shrink-0 rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--c-text-dim)]">
                  {pick(...KIND_TAG[entry.kind])}
                </span>
                <span className="flex-1 truncate text-[var(--c-text)]">{entry.label}</span>
                <span className="mono shrink-0 truncate text-xs text-[var(--c-text-dim)]">{entry.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mono flex gap-3 border-t border-[var(--c-border)] px-3 py-1.5 text-[10px] text-[var(--c-text-dim)]">
          <span>↑↓ {pick('chọn', 'navigate')}</span>
          <span>Enter {pick('mở', 'open')}</span>
          <span>Esc {pick('đóng', 'close')}</span>
        </div>
      </section>
    </div>
  )
}
