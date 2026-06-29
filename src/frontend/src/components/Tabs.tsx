import { useState } from 'react'
import type { ReactNode } from 'react'

export interface TabDef {
  key: string
  label: string
  icon?: ReactNode
}

interface TabsProps {
  tabs: TabDef[]
  defaultTab?: string
  children: (activeKey: string) => ReactNode
}

export function Tabs({ tabs, defaultTab, children }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key ?? '')
  return (
    <div>
      <div className="flex gap-1 border-b border-[var(--c-border)] pb-px" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            className={`inline-flex items-center gap-1.5 rounded-t-[var(--radius)] border-b-2 px-4 py-2 text-sm font-semibold transition ${active === tab.key ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'}`}
            onClick={() => setActive(tab.key)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-4" role="tabpanel">{children(active)}</div>
    </div>
  )
}
