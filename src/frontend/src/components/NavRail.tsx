import { Bell, CalendarDays, Activity, ChevronDown, ChevronRight, Clock3, Gauge, Home, LineChart, Network, PanelLeft, PanelLeftClose, Settings, ShieldCheck, SlidersHorizontal, TestTube2, Users, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ROUTE_MIN_ROLE, roleAtLeast } from '../auth/roles'
import { useI18n } from '../i18n'
import { PRODUCT_INFO } from '../productInfo'
import { LEGACY_GRAPH_DEMO_ENABLED } from '../config'
import type { HealthResponse, UserRole } from '../types'
import { cn } from '../utils'

const groups = [
  {
    id: 'overview',
    titleKey: 'overview',
    items: [
      { to: '/', key: 'dashboard', icon: Home, end: true },
      { to: '/monitor', key: 'monitor', icon: SlidersHorizontal },
      { to: '/alarms', key: 'alarm-log', icon: Bell },
      { to: '/trends', key: 'trends', icon: LineChart }
    ]
  },
  {
    id: 'settings',
    titleKey: 'settings',
    items: [
      { to: '/settings/display', key: 'display', icon: Gauge },
      { to: '/settings/users', key: 'users', icon: Users },
      { to: '/settings/network', key: 'network', icon: Network },
      { to: '/settings/time', key: 'time', icon: Clock3 },
      { to: '/settings/device', key: 'device', icon: Settings }
    ]
  },
  {
    id: 'engineering',
    titleKey: 'engineering',
    items: [
      { to: '/eng/scheduler', key: 'scheduler', icon: CalendarDays },
      { to: '/eng/commissioning', key: 'commissioning', icon: TestTube2 },
      { to: '/eng/programming', key: 'programming', icon: ShieldCheck },
      { to: '/eng/inputs', key: 'inputs', icon: Activity },
      { to: '/eng/outputs', key: 'outputs', icon: Zap },
      { to: '/eng/virtual-points', key: 'virtual-points', icon: SlidersHorizontal },
      // { to: '/eng/user-parameters', key: 'user-parameters', icon: ListChecks },
      // { to: '/eng/aux', key: 'aux', icon: Settings },
      { to: '/eng/alarm-settings', key: 'alarm-settings', icon: Bell }
    ]
  }
] as const

type GroupId = typeof groups[number]['id']

/**
 * Lọc mục menu theo vai trò — WEB-UX-009.
 *
 * Bổ sung cho `RequireRole` chứ không thay thế: gate ở route là thứ chặn thật,
 * còn đây chỉ tránh việc bày ra một danh sách mục mà bấm vào đâu cũng ra trang
 * "không đủ quyền". Vì vậy hàm này CỐ Ý dùng chung `ROUTE_MIN_ROLE` với gate —
 * hai bảng riêng sẽ lệch nhau ngay lần đầu ai đó siết quyền một route.
 *
 * Riêng `/settings/network` giữ nguyên cho mọi vai trò, theo ADR-017 §2.7 và
 * finding F-06: viewer|operator được đọc trạng thái authority, và trang tự khoá
 * toàn bộ nút mutation.
 */
function isVisibleForRole(to: string, role: UserRole | undefined): boolean {
  const required = ROUTE_MIN_ROLE[to]
  return required === undefined || roleAtLeast(role, required)
}

/**
 * Danh sách mục điều hướng — dùng chung cho thanh bên máy tính và ngăn kéo di
 * động (WEB-UX-010). Một nguồn duy nhất, để hai chỗ không trôi khỏi nhau.
 */
function NavGroups({ alarmCount, collapsed, role, onNavigate }: {
  alarmCount: number
  collapsed: boolean
  role: UserRole | undefined
  onNavigate?: () => void
}) {
  const { t } = useI18n()
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>({ overview: true, settings: true, engineering: true })

  function toggleGroup(id: GroupId) {
    setOpenGroups((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <>
      {groups.map((group) => {
        const isOpen = collapsed || openGroups[group.id]
        const Chevron = isOpen ? ChevronDown : ChevronRight
        const items = group.items.filter((item) =>
          (item.key !== 'programming' || LEGACY_GRAPH_DEMO_ENABLED) && isVisibleForRole(item.to, role)
        )
        if (!items.length) return null
        return (
          <section key={group.id}>
            {!collapsed && (
              <button
                type="button"
                className="flex h-8 w-full items-center justify-between rounded-[var(--radius)] px-2 text-[10px] font-bold uppercase tracking-wide text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.id)}
              >
                <span>{t(group.titleKey)}</span>
                <Chevron className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {isOpen && (
              <div className={cn('mt-1 space-y-1', collapsed && 'mt-0')}>
                {/* Network hiển thị cho MỌI session hợp lệ: ADR-017 §2.7 cho
                    viewer|operator đọc trạng thái authority, và trang tự khoá
                    toàn bộ nút mutation khi role không phải admin. Ẩn hẳn mục
                    này từng khiến cả nhánh chỉ-đọc ở backend lẫn ở component
                    trở thành mã chết (finding F-06). */}
                {items.map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={'end' in item ? item.end : false}
                      title={collapsed ? t(item.key) : undefined}
                      onClick={onNavigate}
                      className={({ isActive }) => cn(
                        'flex h-10 items-center gap-3 rounded-[var(--radius)] border border-transparent border-l-4 border-l-transparent px-3 text-sm text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]',
                        collapsed && 'relative justify-center px-0',
                        isActive && 'border-[var(--c-border)] border-l-[var(--c-line-strong)] bg-[var(--c-surface-2)] font-semibold text-[var(--c-text)]'
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      {!collapsed && <span className="flex-1">{t(item.key)}</span>}
                      {!collapsed && item.key === 'alarm-log' && alarmCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[10px] font-bold text-[var(--c-on-fault)]">{alarmCount}</span>}
                      {collapsed && item.key === 'alarm-log' && alarmCount > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[9px] font-bold text-[var(--c-on-fault)]">{alarmCount}</span>}
                    </NavLink>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

function DeviceCard({ firmware }: { firmware: string }) {
  return (
    <div className="shrink-0 p-4">
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
        <div className="mb-3 aspect-[1168/676] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
          <img src="/mk-ddc-24-front-panel.png" alt="MK-DDC-24 front panel" className="h-full w-full object-cover" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase text-[var(--c-text-dim)]">Model</div>
            <div className="truncate text-xs font-semibold" title={PRODUCT_INFO.model}>{PRODUCT_INFO.model}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase text-[var(--c-text-dim)]">Firmware</div>
            <div className="truncate text-xs font-semibold" title={firmware}>{firmware}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function NavRail({ alarmCount, device }: { alarmCount: number; device: HealthResponse | null }) {
  const { t } = useI18n()
  const { session } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const deviceTitle = device?.deviceName ?? PRODUCT_INFO.name
  const firmware = device?.firmware ?? PRODUCT_INFO.firmware
  const ToggleIcon = collapsed ? PanelLeft : PanelLeftClose

  return (
    <aside className={cn(
      'sticky top-0 hidden h-screen shrink-0 border-r border-[var(--c-border)] bg-[var(--c-surface)] transition-[width] duration-200 lg:flex lg:flex-col',
      collapsed ? 'w-[68px]' : 'w-[232px]'
    )}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? t('expand-sidebar') : t('collapse-sidebar')}
        title={collapsed ? t('expand-sidebar') : t('collapse-sidebar')}
        className="absolute -right-3 top-20 z-40 grid h-6 w-6 place-items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)] shadow-sm transition hover:text-[var(--c-text)]"
      >
        <ToggleIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <div className="border-b border-[var(--c-border)] p-5">
        <div className="truncate text-2xl font-black leading-none text-[var(--c-text)]" title={deviceTitle}>{collapsed ? PRODUCT_INFO.code : deviceTitle}</div>
      </div>
      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-label="Main navigation">
        <NavGroups alarmCount={alarmCount} collapsed={collapsed} role={session?.role} />
      </nav>
      {!collapsed && <DeviceCard firmware={firmware} />}
    </aside>
  )
}

/**
 * Ngăn kéo điều hướng cho màn hình dưới 1024px — WEB-UX-010.
 *
 * `NavRail` là `hidden … lg:flex`, và trước đây KHÔNG có gì thay thế nó bên
 * dưới ngưỡng đó: mở web trên điện thoại hay tablet là mất sạch điều hướng, chỉ
 * còn cách gõ tay URL. Với một thiết bị mà kỹ thuật viên thường xem qua điện
 * thoại ngay tại tủ, đó là mất hẳn khả năng dùng ngoài hiện trường.
 *
 * Bẫy focus và phím Escape theo đúng mẫu `Modal.tsx` đã có sẵn, chứ không phát
 * minh lại: một lớp phủ chiếm toàn màn hình mà Tab vẫn đi được xuống nội dung
 * bên dưới là bẫy cho người dùng bàn phím và trình đọc màn hình.
 */
export function NavDrawer({ open, alarmCount, device, onClose }: {
  open: boolean
  alarmCount: number
  device: HealthResponse | null
  onClose: () => void
}) {
  const { t, pick } = useI18n()
  const { session } = useAuth()
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const deviceTitle = device?.deviceName ?? PRODUCT_INFO.name

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    } else if (wasOpenRef.current) {
      // Trả tiêu điểm về đúng nút đã mở ngăn kéo; nếu không, sau khi đóng người
      // dùng bàn phím bị ném về đầu tài liệu.
      openerRef.current?.focus()
    }
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    firstFocusable(panelRef.current)?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusable = focusableElements(panel)
    if (!focusable.length) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex lg:hidden" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={pick('Điều hướng', 'Navigation')}
        tabIndex={-1}
        className="flex h-full w-[268px] max-w-[85vw] flex-col border-r border-[var(--c-border)] bg-[var(--c-surface)]"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--c-border)] p-4">
          <div className="truncate text-xl font-black leading-none text-[var(--c-text)]" title={deviceTitle}>{deviceTitle}</div>
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
            onClick={onClose}
            aria-label={pick('Đóng điều hướng', 'Close navigation')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-label={t('overview')}>
          {/* Đóng ngăn kéo ngay khi điều hướng: để nó mở che mất trang vừa mở là
              buộc người dùng thao tác thừa một bước trên màn hình nhỏ nhất. */}
          <NavGroups alarmCount={alarmCount} collapsed={false} role={session?.role} onNavigate={onClose} />
        </nav>
      </div>
      <div className="flex-1 bg-[rgba(0,0,0,0.62)]" />
    </div>
  )
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusableElements(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return []
  return [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

function firstFocusable(panel: HTMLElement | null): HTMLElement | undefined {
  return focusableElements(panel)[0]
}
