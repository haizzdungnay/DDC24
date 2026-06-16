import { Bell, CalendarDays, Gauge, HeartPulse, Home, LineChart, Network, Settings, ShieldCheck, SlidersHorizontal, TestTube2, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { DEVICE_DEFAULTS } from '../config'
import { useI18n } from '../i18n'
import { cn } from '../utils'

const items = [
  { to: '/', key: 'dashboard', icon: Home },
  { to: '/monitor', key: 'monitor', icon: SlidersHorizontal },
  { to: '/alarms', key: 'alarms', icon: Bell, badge: '5' },
  { to: '/trends', key: 'trends', icon: LineChart },
  { to: '/scheduler', key: 'scheduler', icon: CalendarDays },
  { to: '/network', key: 'network', icon: Network },
  { to: '/users', key: 'users', icon: Users },
  { to: '/settings', key: 'settings', icon: Settings },
  { to: '/health', key: 'health', icon: HeartPulse },
  { to: '/commissioning', key: 'commissioning', icon: TestTube2 },
  { to: '/validator', key: 'validator', icon: ShieldCheck }
] as const

export function NavRail() {
  const { t } = useI18n()
  return (
    <aside className="hidden w-[196px] shrink-0 border-r border-[var(--c-border)] bg-[rgba(7,14,27,0.72)] lg:flex lg:flex-col">
      <div className="border-b border-[var(--c-border)] p-5">
        <div className="text-3xl font-black leading-none"><span className="text-[var(--c-accent-2)]">DDC</span> 24</div>
        <div className="mt-1 text-sm text-[var(--c-accent)]">Controller</div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => cn('flex h-10 items-center gap-3 rounded-[var(--radius)] px-3 text-sm text-[var(--c-text-dim)] transition hover:bg-[rgba(45,127,249,0.14)] hover:text-[var(--c-text)]', isActive && 'border border-[rgba(34,211,238,0.34)] bg-[rgba(45,127,249,0.24)] text-white')}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="flex-1">{t(item.key)}</span>
              {'badge' in item && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--c-fault)] px-1 text-[10px] font-bold text-white">{item.badge}</span>}
            </NavLink>
          )
        })}
      </nav>
      <div className="p-4">
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(17,26,43,0.82)] p-3">
          <div className="mb-3 grid h-24 place-items-center rounded-[var(--radius)] border border-[rgba(34,211,238,0.18)] bg-[rgba(34,211,238,0.05)]">
            <Gauge className="h-10 w-10 text-[var(--c-accent)]" aria-hidden="true" />
          </div>
          <div className="text-[10px] uppercase text-[var(--c-text-dim)]">Model</div>
          <div className="text-xs font-semibold">DDC24-AC</div>
          <div className="mt-3 text-[10px] uppercase text-[var(--c-text-dim)]">Firmware</div>
          <div className="text-xs font-semibold">{DEVICE_DEFAULTS.firmware}</div>
          <div className="mt-3 text-[10px] uppercase text-[var(--c-text-dim)]">Serial</div>
          <div className="mono text-xs">{DEVICE_DEFAULTS.serial}</div>
        </div>
      </div>
    </aside>
  )
}
