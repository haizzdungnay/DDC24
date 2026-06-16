import { Filter, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { apiClient } from '../api/client'
import { AlarmRow } from '../components/AlarmRow'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import type { Alarm } from '../types'

type AlarmFilter = 'all' | Alarm['status']

export function AlarmsPage() {
  const state = useApi(apiClient.getAlarms, [])
  const toast = useToast()
  const [filter, setFilter] = useState<AlarmFilter>('all')
  const [query, setQuery] = useState('')
  const alarms = state.data ?? []
  const rows = useMemo(() => alarms.filter((alarm) => (filter === 'all' || alarm.status === filter) && `${alarm.message} ${alarm.source}`.toLowerCase().includes(query.toLowerCase())), [alarms, filter, query])

  async function ack(alarm: Alarm) {
    try {
      await apiClient.ackAlarm(alarm.id)
      await state.refetch()
      toast.push('success', `Ack ${alarm.id}`)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Ack failed')
    }
  }

  if (state.loading && !alarms.length) return <StateBlock state="loading" title="Đang tải alarm" />
  if (state.error && !alarms.length) return <StateBlock state="error" title="Không tải được alarm" detail={state.error.message} onRetry={state.refetch} />

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Alarms</h1><p className="text-sm text-[var(--c-text-dim)]">Theo dõi, lọc và acknowledge cảnh báo</p></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Summary label="Active" value={alarms.filter((a) => a.status === 'active').length} accent="fault" />
        <Summary label="Unacknowledged" value={alarms.filter((a) => a.status === 'unack').length} accent="warn" />
        <Summary label="Shelved" value={alarms.filter((a) => a.status === 'shelved').length} accent="info" />
        <Summary label="Today" value={alarms.length} accent="good" />
      </div>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {(['all', 'active', 'unack', 'acked', 'shelved'] as const).map((item) => <Button key={item} size="sm" variant={filter === item ? 'primary' : 'secondary'} onClick={() => setFilter(item)}>{item}</Button>)}
          <label className="ml-auto flex h-9 min-w-[260px] items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
            <Search className="h-4 w-4 text-[var(--c-text-dim)]" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Tìm kiếm alarm..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Button size="sm" icon={<Filter className="h-4 w-4" />}>Filter</Button>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(11,18,32,0.38)]">
          {rows.map((alarm) => <AlarmRow key={alarm.id} alarm={alarm} onAck={ack} />)}
          {!rows.length && <StateBlock state="empty" title="Không có alarm phù hợp" />}
        </div>
      </Panel>
    </div>
  )
}

function Summary({ label, value, accent }: { label: string; value: number; accent: 'fault' | 'warn' | 'info' | 'good' }) {
  const color = accent === 'fault' ? 'var(--c-fault)' : accent === 'warn' ? 'var(--c-warn)' : accent === 'info' ? 'var(--c-info)' : 'var(--c-good)'
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-4"><div className="mono text-4xl font-bold" style={{ color }}>{value}</div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}
