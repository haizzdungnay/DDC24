import { Bell, CalendarDays, Activity, ChevronDown, ChevronRight, Clock3, Gauge, Home, LineChart, Network, PanelLeft, PanelLeftClose, Settings, ShieldCheck, SlidersHorizontal, TestTube2, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n'
import { PRODUCT_INFO } from '../productInfo'
import { LEGACY_GRAPH_DEMO_ENABLED } from '../config'
import type { HealthResponse } from '../types'
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

export function NavRail({ alarmCount, device }: { alarmCount: number; device: HealthResponse | null }) {
  const { t } = useI18n()
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>({ overview: true, settings: true, engineering: true })
  const [collapsed, setCollapsed] = useState(false)
  const deviceTitle = device?.deviceName ?? PRODUCT_INFO.name
  const firmware = device?.firmware ?? PRODUCT_INFO.firmware

  function toggleGroup(id: GroupId) {
    setOpenGroups((current) => ({ ...current, [id]: !current[id] }))
  }

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
        {groups.map((group) => {
          const isOpen = collapsed || openGroups[group.id]
          const Chevron = isOpen ? ChevronDown : ChevronRight
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
                  {group.items.filter((item) => item.key !== 'programming' || LEGACY_GRAPH_DEMO_ENABLED).map((item) => {
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={'end' in item ? item.end : false}
                        title={collapsed ? t(item.key) : undefined}
                        className={({ isActive }) => cn(
                          'flex h-10 items-center gap-3 rounded-[var(--radius)] border border-transparent border-l-4 border-l-transparent px-3 text-sm text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]',
                          collapsed && 'relative justify-center px-0',
                          isActive && 'border-[var(--c-border)] border-l-[var(--c-line-strong)] bg-[var(--c-surface-2)] font-semibold text-[var(--c-text)]'
                        )}
                      >
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="flex-1">{t(item.key)}</span>}
                        {!collapsed && item.key === 'alarm-log' && alarmCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[10px] font-bold text-white">{alarmCount}</span>}
                        {collapsed && item.key === 'alarm-log' && alarmCount > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[9px] font-bold text-white">{alarmCount}</span>}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </nav>
      {!collapsed && (
        <div className="shrink-0 p-4">
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
            <div className="mb-3 aspect-[1168/676] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
              <img
                src="/mk-ddc-24-front-panel.png"
                alt="MK-DDC-24 front panel"
                className="h-full w-full object-cover"
              />
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
      )}
    </aside>
  )
}
