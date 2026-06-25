import { Bell, CalendarDays, Activity, ChevronDown, ChevronRight, Clock3, Gauge, Home, LineChart, ListChecks, Network, Settings, ShieldCheck, SlidersHorizontal, TestTube2, UserRound, Users } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n'
import { PRODUCT_INFO } from '../productInfo'
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
      { to: '/trends', key: 'trends', icon: LineChart },
      { to: '/me', key: 'me', icon: UserRound }
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
      { to: '/eng/user-parameters', key: 'user-parameters', icon: ListChecks },
      { to: '/eng/diagram', key: 'diagram', icon: Network },
      { to: '/eng/aux', key: 'aux', icon: Settings },
      { to: '/eng/alarm-settings', key: 'alarm-settings', icon: Bell }
    ]
  }
] as const

type GroupId = typeof groups[number]['id']

export function NavRail({ alarmCount, device }: { alarmCount: number; device: HealthResponse | null }) {
  const { t } = useI18n()
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>({ overview: true, settings: true, engineering: true })
  const deviceTitle = device?.deviceName ?? PRODUCT_INFO.name
  const firmware = device?.firmware ?? PRODUCT_INFO.firmware
  const deviceSubtitle = firmware ? `FW ${firmware}` : PRODUCT_INFO.code

  function toggleGroup(id: GroupId) {
    setOpenGroups((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 border-r border-[var(--c-border)] bg-[var(--c-surface)] lg:flex lg:flex-col">
      <div className="border-b border-[var(--c-border)] p-5">
        <div className="truncate text-2xl font-black leading-none text-[var(--c-text)]" title={deviceTitle}>{deviceTitle}</div>
        <div className="mt-1 truncate text-sm text-[var(--c-text-dim)]" title={deviceSubtitle}>{deviceSubtitle}</div>
      </div>
      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-label="Main navigation">
        {groups.map((group) => {
          const isOpen = openGroups[group.id]
          const Chevron = isOpen ? ChevronDown : ChevronRight
          return (
            <section key={group.id}>
              <button
                type="button"
                className="flex h-8 w-full items-center justify-between rounded-[var(--radius)] px-2 text-[10px] font-bold uppercase tracking-wide text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.id)}
              >
                <span>{t(group.titleKey)}</span>
                <Chevron className="h-4 w-4" aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="mt-1 space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={'end' in item ? item.end : false}
                        className={({ isActive }) => cn(
                          'flex h-10 items-center gap-3 rounded-[var(--radius)] border border-transparent border-l-4 border-l-transparent px-3 text-sm text-[var(--c-text-dim)] transition hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]',
                          isActive && 'border-[var(--c-border)] border-l-[var(--c-line-strong)] bg-[var(--c-surface-2)] font-semibold text-[var(--c-text)]'
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        <span className="flex-1">{t(item.key)}</span>
                        {item.key === 'alarm-log' && alarmCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[10px] font-bold text-white">{alarmCount}</span>}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </nav>
      <div className="shrink-0 p-4">
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
          <div className="mb-3 grid h-20 place-items-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
            <Gauge className="h-9 w-9 text-[var(--c-text-dim)]" aria-hidden="true" />
          </div>
          <div className="text-[10px] uppercase text-[var(--c-text-dim)]">Model</div>
          <div className="text-xs font-semibold">{PRODUCT_INFO.model}</div>
          <div className="mt-3 text-[10px] uppercase text-[var(--c-text-dim)]">Firmware</div>
          <div className="text-xs font-semibold">{firmware}</div>
          <div className="mt-3 text-[10px] uppercase text-[var(--c-text-dim)]">Serial</div>
          <div className="mono text-xs">{PRODUCT_INFO.serial}</div>
        </div>
      </div>
    </aside>
  )
}
