import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestGuardedNavigation } from '../../hooks/useDirtyGuard'
import { useNavigate } from 'react-router-dom'
import { roleAtLeast, useAuth, ROUTE_MIN_ROLE } from '../../../features/auth'
import { useI18n } from '../../i18n'
import type { UserRole } from '../../types'

/**
 * Command palette — PA3-204.
 *
 * VÌ SAO CẦN
 *
 * Giao diện có hơn 20 đích đến. Người làm commissioning đi tới lui giữa Monitor,
 * Modbus và Diagnostics hàng chục lần một ca; mỗi lần phải mở đúng nhóm trong
 * thanh bên rồi tìm mục. `Ctrl/⌘+K` cắt việc đó xuống một lần gõ.
 *
 * LUẬT AN NINH
 *
 * Danh sách đích là HẰNG SỐ trong file này, không đến từ dữ liệu backend
 * (PA3-D06 — cùng lý do với resolver drill-down). Và nó lọc theo `ROUTE_MIN_ROLE`
 * dùng chung với route guard: bày ra một đích mà bấm vào là "không đủ quyền"
 * chỉ làm người dùng mất thời gian. Đây là tiện ích UX, KHÔNG phải hàng rào —
 * hàng rào vẫn ở `RequireRole` và ở backend.
 */

interface Destination {
  to: string
  vi: string
  en: string
  /** Từ khoá phụ để gõ tắt tìm ra, ví dụ "io" ra Monitor. */
  keywords: string
}

const destinations: Destination[] = [
  { to: '/', vi: 'Bảng điều khiển', en: 'Dashboard', keywords: 'dashboard landing home tong quan trang chu' },
  { to: '/monitor', vi: 'Giám sát điểm', en: 'Monitor points', keywords: 'monitor point io giam sat diem' },
  { to: '/monitor?state=forced', vi: 'Điểm đang ép tay', en: 'Points under override', keywords: 'forced override ep tay' },
  { to: '/monitor?state=offline', vi: 'Điểm mất liên lạc', en: 'Offline points', keywords: 'offline mat lien lac' },
  { to: '/alarms', vi: 'Cảnh báo', en: 'Alarms', keywords: 'alarm canh bao' },
  { to: '/alarms/history', vi: 'Lịch sử cảnh báo', en: 'Alarm history', keywords: 'alarm history lich su canh bao' },
  { to: '/trends', vi: 'Xu hướng', en: 'Trends', keywords: 'trend chart bieu do xu huong' },
  { to: '/diagnostics', vi: 'Chẩn đoán', en: 'Diagnostics', keywords: 'diagnostics cpu ram service chan doan' },
  { to: '/eng/scheduler', vi: 'Lịch vận hành', en: 'Scheduler', keywords: 'schedule lich van hanh' },
  { to: '/eng/commissioning', vi: 'Chạy thử', en: 'Commissioning', keywords: 'commissioning test chay thu' },
  { to: '/eng/inputs', vi: 'Cấu hình Inputs', en: 'Inputs configuration', keywords: 'input ui cau hinh' },
  { to: '/eng/outputs', vi: 'Cấu hình Outputs', en: 'Outputs configuration', keywords: 'output ao do cau hinh' },
  { to: '/eng/virtual-points', vi: 'Điểm ảo', en: 'Virtual points', keywords: 'virtual vp diem ao' },
  { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU', keywords: 'modbus rtu bus device slave' },
  { to: '/eng/alarm-settings', vi: 'Cấu hình cảnh báo', en: 'Alarm configuration', keywords: 'alarm setting cau hinh canh bao' },
  { to: '/settings/network', vi: 'Mạng', en: 'Network', keywords: 'network ip mang' },
  { to: '/settings/device', vi: 'Thiết bị', en: 'Device', keywords: 'device thiet bi' },
  { to: '/settings/time', vi: 'Thời gian', en: 'Time', keywords: 'time ntp thoi gian' },
  { to: '/settings/users', vi: 'Người dùng', en: 'Users', keywords: 'user account nguoi dung' }
]

/** Bỏ dấu tiếng Việt để gõ "giam sat" cũng ra "Giám sát". */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

function allowedForRole(to: string, role: UserRole | undefined): boolean {
  const required = ROUTE_MIN_ROLE[to.split('?')[0]]
  return required === undefined || roleAtLeast(role, required)
}

export function CommandPalette() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { lang, pick } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const available = useMemo(() => destinations.filter((item) => allowedForRole(item.to, session?.role)), [session?.role])
  const results = useMemo(() => {
    const needle = fold(query.trim())
    if (!needle) return available.slice(0, 8)
    return available
      .filter((item) => fold(`${item.vi} ${item.en} ${item.keywords} ${item.to}`).includes(needle))
      .slice(0, 8)
  }, [available, query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
    // Trả tiêu điểm về nơi người dùng đang đứng; nếu không, người dùng bàn phím
    // bị ném về đầu tài liệu sau mỗi lần đóng.
    openerRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => { setActiveIndex(0) }, [query])

  if (!open) return null

  function go(to: string) {
    close()
    /* N-07: xin phép guard trước. Ctrl+K là đường điều hướng duy nhất trong
       ứng dụng không đi qua `<a href>`, nên nếu bỏ qua bước này thì mọi trang
       cấu hình vẫn mất bản nháp qua chính lối tắt mà người dùng thạo việc hay
       dùng nhất. */
    if (requestGuardedNavigation(to)) return
    navigate(to)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (results.length ? (index - 1 + results.length) % results.length : 0))
      return
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      go(results[activeIndex].to)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(0,0,0,0.5)] p-4 pt-[12vh]" role="presentation" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pick('Tìm nhanh trang', 'Quick navigation')}
        className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <label className="flex h-12 items-center gap-3 border-b border-[var(--c-border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pick('Đi tới trang… (gõ không dấu cũng được)', 'Go to page… (accent-insensitive)')}
            aria-label={pick('Tìm trang', 'Search pages')}
            aria-controls="command-palette-results"
            className="w-full bg-transparent text-sm outline-none"
          />
          <kbd className="shrink-0 rounded border border-[var(--c-border)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-dim)]">ESC</kbd>
        </label>
        <ul id="command-palette-results" role="listbox" aria-label={pick('Kết quả', 'Results')} className="max-h-[46vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[var(--c-text-dim)]">
              {pick('Không có trang nào khớp', 'No matching page')}
            </li>
          )}
          {results.map((item, index) => (
            <li key={item.to}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(item.to)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${index === activeIndex ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'text-[var(--c-text)]'}`}
              >
                <span>{lang === 'vi' ? item.vi : item.en}</span>
                <span className="mono shrink-0 text-xs text-[var(--c-text-dim)]">{item.to}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
