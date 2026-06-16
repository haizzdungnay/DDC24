import { Server } from 'lucide-react'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { getDemoNetwork } from '../demo/simulator'
import type { NetworkNode } from '../types'

export function NetworkPage() {
  const root = getDemoNetwork()
  const devices = [root, ...(root.children ?? [])]
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Network</h1><p className="text-sm text-[var(--c-text-dim)]">Topology controller và thiết bị con</p></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><Stat label="Controllers Online" value="3" /><Stat label="Devices Online" value="12" /><Stat label="Network Health" value="98.6%" /><Stat label="Alerts Active" value="2" warn /></div>
      <Panel title="Topology">
        <div className="grid-bg min-h-[420px] rounded-[var(--radius)] border border-[var(--c-border)] p-6">
          <Tree node={root} />
        </div>
      </Panel>
      <Panel title="Devices">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{devices.map((node) => <div key={node.id} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-4"><div className="flex items-center gap-2"><Server className="h-5 w-5 text-[var(--c-accent)]" /><span className="font-semibold">{node.label}</span></div><div className="mono mt-2 text-xs text-[var(--c-text-dim)]">{node.ip}</div><StatusBadge className="mt-3" state={node.status} /></div>)}</div>
      </Panel>
    </div>
  )
}

function Tree({ node }: { node: NetworkNode }) {
  return <div className="flex flex-col items-center gap-5"><div className="rounded-[var(--radius)] border border-[rgba(34,211,238,0.4)] bg-[rgba(17,26,43,0.92)] p-4 text-center"><Server className="mx-auto h-6 w-6 text-[var(--c-accent)]" /><div className="mt-2 font-semibold">{node.label}</div><div className="mono text-xs text-[var(--c-text-dim)]">{node.ip}</div><StatusBadge className="mt-2" state={node.status} /></div>{node.children && <div className="grid w-full gap-4 md:grid-cols-3">{node.children.map((child) => <Tree key={child.id} node={child} />)}</div>}</div>
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-4"><div className={warn ? 'mono text-3xl font-bold text-[var(--c-warn)]' : 'mono text-3xl font-bold text-[var(--c-good)]'}>{value}</div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}
